/** 既存の闘技場13階級・5連戦を、実ゲームの戦闘処理で検証する。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseCsv } from '../game/js/csv.js';
import { makeEnemy, curedBy } from '../game/js/battle.js';
import { maxHp, maxMp } from '../game/js/character.js';
import { useItemOutsideBattle, FIELD_ITEM_EFFECTS } from '../game/js/dungeon.js';
import { loadData, prepareParty, fight, rngFor, PROFILES, sourceFingerprint } from './balance.mjs';

const readData = (name) => readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8').replace(/^\uFEFF/, '');
function arenaFingerprint() {
  const hash = createHash('sha256').update(sourceFingerprint());
  for (const file of ['data/arena.json', 'data/arena_tiers.csv', 'data/arena_battles.csv', 'sim/arena-balance.mjs']) {
    hash.update(file).update(readFileSync(new URL(`../${file}`, import.meta.url)));
  }
  return hash.digest('hex');
}
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const percentile = (values, fraction) => values.length
  ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))] : null;

export function loadArenaData(data) {
  const config = JSON.parse(readData('arena.json'));
  const tiers = parseCsv(readData('arena_tiers.csv')).rows.map((row) => ({ ...row, rank: Number(row.rank) }));
  const rows = parseCsv(readData('arena_battles.csv')).rows;
  const matches = new Map();
  if (tiers.length !== config.tiers) throw new Error('闘技場の階級数が設定と一致しません。');
  for (const tier of tiers) {
    const battles = rows.filter((row) => row.tier_id === tier.id)
      .sort((a, b) => Number(a.battle) - Number(b.battle)).map((row) => ({
        battle: Number(row.battle), enemies: row.enemies.split('|').map((token) => {
          const [id, level] = token.split(':');
          const monster = data.monsters.get(id);
          const lv = Number(level);
          if (!monster || !Number.isInteger(lv) || lv < 1) throw new Error(`${tier.id}: 対戦相手 ${token} が不正です。`);
          return { id, lv, boss: monster.isBoss ?? false };
        }),
      }));
    if (battles.length !== config.battles_per_tier || battles.some((battle, index) => battle.battle !== index + 1 || !battle.enemies.length)) {
      throw new Error(`${tier.id}: 連戦の番号・戦数を確認してください。`);
    }
    matches.set(tier.id, battles);
  }
  return { config, tiers, matches };
}

function partyState(data, game) {
  return game.party.map((member) => ({
    id: member.id, job: member.job, lv: member.lv, xp: member.xp,
    hp: member.hp, maxHp: maxHp(data, member), mp: member.mp, maxMp: maxMp(data, member),
    persist: [...(member.persist ?? [])], ap: { ...member.ap },
  }));
}

function remainingRatio(party, current, maximum) {
  const max = party.reduce((sum, member) => sum + member[maximum], 0);
  return max ? party.reduce((sum, member) => sum + member[current], 0) / max : 0;
}

function availableItems(data, game) {
  return Object.entries(game.items).filter(([, count]) => count > 0)
    .map(([id]) => data.items.get(id)).filter((item) => item && FIELD_ITEM_EFFECTS.includes(item.effect));
}

/** 戦間の道具UIと同じ処理を使う。回復スキルや自然回復は挟まない。 */
export function useArenaIntermissionItems(data, game) {
  const actions = [];
  // 在庫は有限。1回につき必ず1個消費するので、この上限までに止まる。
  const limit = Object.values(game.items).reduce((sum, count) => sum + Math.max(0, count), 0);
  for (let step = 0; step < limit; step++) {
    const items = availableItems(data, game);
    let action = null;
    const dead = game.party.findIndex((member) => member.hp <= 0);
    const revive = items.find((item) => item.effect === 'revive_pct');
    if (dead >= 0 && revive) action = { itemId: revive.id, target: dead };
    if (!action) {
      for (const [target, member] of game.party.entries()) {
        if (member.hp <= 0 || !member.persist?.length) continue;
        const cure = items.filter((item) => item.effect === 'cure_status'
          && member.persist.some((id) => curedBy(data.statusEffects.get(id), item.name)))
          .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))[0];
        if (cure) { action = { itemId: cure.id, target }; break; }
      }
    }
    const alive = game.party.map((member, target) => ({ member, target }))
      .filter(({ member }) => member.hp > 0);
    if (!action) {
      const hurt = alive.filter(({ member }) => member.hp / maxHp(data, member) < 0.6)
        .sort((a, b) => a.member.hp / maxHp(data, a.member) - b.member.hp / maxHp(data, b.member))[0];
      const heal = items.filter((item) => item.effect.startsWith('heal_hp'))
        .sort((a, b) => Number(b.value) - Number(a.value))[0];
      if (hurt && heal) action = { itemId: heal.id, target: hurt.target };
    }
    if (!action) {
      const low = alive.filter(({ member }) => maxMp(data, member) > 0 && member.mp / maxMp(data, member) < 0.3)
        .sort((a, b) => a.member.mp / maxMp(data, a.member) - b.member.mp / maxMp(data, b.member))[0];
      const mana = items.filter((item) => item.effect.startsWith('heal_mp'))
        .sort((a, b) => Number(b.value) - Number(a.value))[0];
      if (low && mana) action = { itemId: mana.id, target: low.target };
    }
    if (!action) break;
    useItemOutsideBattle(data, game, action.itemId, action.target);
    actions.push(action);
  }
  return actions;
}

const partyTemplates = new WeakMap();

function arenaParty(data, arena, tier, profile, preparation, { level, stage } = {}) {
  const maximumStar = Math.max(...[...data.dungeons.values()].map((dungeon) => dungeon.rank));
  const star = Math.min(tier.rank, maximumStar);
  const reference = [...data.dungeons.values()].find((dungeon) => dungeon.rank === star && dungeon.kind === '標準');
  if (!reference) throw new Error(`★${star}の標準ダンジョンがありません。`);
  const floors = data.dungeonFloors.filter((row) => row.dungeonId === reference.id).sort((a, b) => a.floor - b.floor);
  const topTier = tier.rank > maximumStar;
  const partyLevel = level ?? (Number(tier.recommended_level) || (topTier ? data.balance.player.level_cap : Math.round(mean(floors.map((row) => row.enemyLevel)))));
  const partyStage = stage ?? (topTier ? 5 : Math.min(5, 1 + Math.floor(star / 3)));
  const finalMatch = arena.matches.get(tier.id).at(-1);
  const bossId = finalMatch.enemies.find((enemy) => enemy.boss)?.id;
  if (!bossId) throw new Error(`${tier.id}の最終戦にボスがいません。`);
  const dungeon = { ...reference, bossId };
  if (!partyTemplates.has(data)) partyTemplates.set(data, new Map());
  const templates = partyTemplates.get(data);
  const key = JSON.stringify([tier.id, bossId, profile, preparation, partyLevel, partyStage]);
  if (!templates.has(key)) templates.set(key, prepareParty(data, dungeon, profile, preparation, { level: partyLevel, stage: partyStage }));
  const game = structuredClone(templates.get(key));
  if (topTier) game.rank = 'S';
  return { game, referenceDungeonId: reference.id, equipmentStar: star, level: partyLevel, stage: partyStage, bossId };
}

/** 1回の5連戦。敗退時の記録は残すが、持出し費用は実ゲームと同じく巻戻す。 */
export function runArena(data, arena, tierId, {
  seed = 1, accuracy = 0.8, profile = 'balanced', preparation = 'standard', level, stage, intermissionItems = true,
} = {}) {
  const tier = arena.tiers.find((row) => row.id === tierId);
  if (!tier) throw new Error(`闘技場の階級 ${tierId} がありません。`);
  const setup = arenaParty(data, arena, tier, profile, preparation, { level, stage });
  const { game } = setup;
  const start = partyState(data, game);
  const initialItems = { ...game.items };
  const rng = rngFor(seed);
  const matches = arena.matches.get(tierId);
  const battles = [];
  for (const row of matches) {
    const partyBefore = partyState(data, game);
    // challenge-page.startBattle と同じく、ダンジョン補正・冠付き・宿の初戦補正は使わない。
    const enemies = row.enemies.map((enemy) => makeEnemy(data, enemy.id, { lv: enemy.lv, boss: enemy.boss }));
    const enemyDetails = enemies.map((enemy) => ({
      id: enemy.monsterId, lv: enemy.lv, boss: enemy.boss, maxHp: enemy.maxHp,
      weak: [...enemy.weak], resist: [...enemy.resist], attackElement: enemy.attackElement,
    }));
    const battleSeed = Math.floor(rng() * 0x100000000);
    const result = fight(data, game, enemies, battleSeed, accuracy, false);
    const partyAfter = partyState(data, game);
    const fieldItems = result.win && intermissionItems && row.battle < matches.length
      ? useArenaIntermissionItems(data, game) : [];
    battles.push({
      battle: row.battle, seed: battleSeed, win: result.win, result: result.b.result ?? 'question_limit',
      questions: result.questions, rounds: result.rounds, enemies: enemyDetails,
      partyBefore, partyAfter, intermissionItems: fieldItems, itemsRemaining: { ...game.items },
      enemyHpRemaining: result.b.enemies.map((enemy) => ({ id: enemy.monsterId, hp: enemy.hp, statuses: Object.keys(enemy.statuses) })),
      log: [...result.b.log],
    });
    if (!result.win) break;
    // 闘技場の勝利後は fight 内の finishBattle のみ。EXP/AP・自然回復・ドロップはない。
  }
  const win = battles.length === matches.length && battles.every((battle) => battle.win);
  const partyEnd = partyState(data, game);
  const consumedByItem = Object.fromEntries(Object.entries(initialItems)
    .map(([id, count]) => [id, count - (game.items[id] ?? 0)]).filter(([, count]) => count > 0));
  return {
    tierId, rank: tier.rank, seed, accuracy, profile, preparation,
    referenceDungeonId: setup.referenceDungeonId, equipmentStar: setup.equipmentStar,
    level: setup.level, stage: setup.stage, preparedForMonster: setup.bossId,
    win, battlesWon: battles.filter((battle) => battle.win).length,
    questions: battles.reduce((sum, battle) => sum + battle.questions, 0),
    hpRemaining: remainingRatio(partyEnd, 'hp', 'maxHp'), mpRemaining: remainingRatio(partyEnd, 'mp', 'maxMp'),
    consumed: Object.values(consumedByItem).reduce((sum, count) => sum + count, 0),
    consumedByItem, inventoryLoss: win ? consumedByItem : {}, initialItems,
    rewards: { xp: 0, ap: 0, gold: 0 }, partyStart: start, partyEnd, battles,
  };
}

/** 各戦の通過率は、その戦まで到達した試行を分母にする。踏破率の分母は全試行。 */
export function evaluateArenaScenario(data, arena, tierId, options = {}, runs = 80, detailCount = 2) {
  if (!Number.isInteger(runs) || runs < 1) throw new Error('runs は1以上の整数を指定してください。');
  const samples = Array.from({ length: runs }, (_, index) => runArena(data, arena, tierId, {
    ...options, seed: ((options.seed ?? 41041) + index * 7919) >>> 0,
  }));
  const wins = samples.filter((sample) => sample.win);
  const failures = samples.filter((sample) => !sample.win);
  const detail = Math.max(0, Math.floor(detailCount));
  const first = samples[0];
  return {
    tierId, rank: first.rank, profile: first.profile, preparation: first.preparation, accuracy: first.accuracy,
    referenceDungeonId: first.referenceDungeonId, equipmentStar: first.equipmentStar,
    level: first.level, stage: first.stage, preparedForMonster: first.preparedForMonster,
    intermissionItems: options.intermissionItems !== false,
    runs, wins: wins.length, clearRate: wins.length / runs,
    clearQuestions: mean(wins.map((sample) => sample.questions)),
    clearQuestionsP90: percentile(wins.map((sample) => sample.questions), 0.9),
    attemptQuestions: mean(samples.map((sample) => sample.questions)),
    hpRemaining: mean(wins.map((sample) => sample.hpRemaining)),
    mpRemaining: mean(wins.map((sample) => sample.mpRemaining)),
    consumablesPerClear: mean(wins.map((sample) => sample.consumed)),
    battles: arena.matches.get(tierId).map((row) => {
      const attempted = samples.flatMap((sample) => sample.battles.filter((battle) => battle.battle === row.battle));
      const cleared = attempted.filter((battle) => battle.win);
      return {
        battle: row.battle, enemies: row.enemies, attempts: attempted.length, wins: cleared.length,
        winRateWhenReached: attempted.length ? cleared.length / attempted.length : null,
        questions: mean(attempted.map((battle) => battle.questions)),
        winQuestions: mean(cleared.map((battle) => battle.questions)),
        questionsP90: percentile(attempted.map((battle) => battle.questions), 0.9),
      };
    }),
    seedDetails: {
      fastestClears: [...wins].sort((a, b) => a.questions - b.questions || a.seed - b.seed).slice(0, detail),
      longestAttempts: [...samples].sort((a, b) => b.questions - a.questions || a.seed - b.seed).slice(0, detail),
      deepestFailures: [...failures].sort((a, b) => b.battlesWon - a.battlesWon || b.questions - a.questions).slice(0, detail),
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => {
    const index = args.indexOf(name);
    if (index < 0) return fallback;
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} の値を指定してください。`);
    return args[index + 1];
  };
  if (args.includes('--help')) {
    console.log('node sim/arena-balance.mjs --runs 80 --tiers 1,3,6,9,12,13 --profiles balanced --preparations standard,prepared --accuracy .8 --details 2 --output report.json');
    console.log('任意: --seed 41041 / --level 99 / --stage 5 / --intermission-items none / --override balance-patch.json');
    return;
  }
  const sourceBefore = arenaFingerprint();
  const data = loadData();
  const override = arg('--override', null);
  const patch = override ? JSON.parse(readFileSync(override, 'utf8')) : {};
  if (override) {
    function merge(target, source) {
      for (const [key, value] of Object.entries(source)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) { target[key] ??= {}; merge(target[key], value); }
        else target[key] = value;
      }
    }
    merge(data.balance, patch);
  }
  const arena = loadArenaData(data);
  const selected = arg('--tiers', arena.tiers.map((tier) => tier.rank).join(',')).split(',');
  const tiers = selected.map((value) => {
    const tier = arena.tiers.find((row) => row.id === value || row.rank === Number(value));
    if (!tier) throw new Error(`階級 ${value} がありません。`);
    return tier;
  });
  const profiles = arg('--profiles', 'balanced').split(',');
  const preparations = arg('--preparations', 'standard,prepared').split(',');
  const accuracies = arg('--accuracy', '.8').split(',').map(Number);
  const runs = Number(arg('--runs', '80'));
  const details = Number(arg('--details', '2'));
  const seed = Number(arg('--seed', '41041'));
  const rawLevel = arg('--level', null), rawStage = arg('--stage', null);
  const level = rawLevel == null ? undefined : Number(rawLevel);
  const stage = rawStage == null ? undefined : Number(rawStage);
  const itemPolicy = arg('--intermission-items', 'fixed');
  if (!Number.isInteger(runs) || runs < 1 || !Number.isInteger(details) || details < 0 || !Number.isInteger(seed)) throw new Error('runs・details・seed は適切な整数を指定してください。');
  if (accuracies.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) throw new Error('accuracy は0〜1で指定してください。');
  if (profiles.some((profile) => !PROFILES[profile])) throw new Error('未登録の編成です。');
  if (preparations.some((value) => !['standard', 'prepared'].includes(value))) throw new Error('preparations は standard / prepared です。');
  if (!['fixed', 'none'].includes(itemPolicy)) throw new Error('intermission-items は fixed / none です。');
  const scenarios = [];
  for (const tier of tiers) for (const profile of profiles) for (const preparation of preparations) for (const accuracy of accuracies) {
    if (tier.rank < PROFILES[profile].minStar) continue;
    const result = evaluateArenaScenario(data, arena, tier.id, {
      profile, preparation, accuracy, seed, level, stage, intermissionItems: itemPolicy !== 'none',
    }, runs, details);
    scenarios.push(result);
    console.log(JSON.stringify({ tier: tier.id, rank: tier.rank, profile, preparation, accuracy, runs,
      clearRate: result.clearRate, questions: result.clearQuestions,
      battleQuestions: result.battles.map((battle) => battle.winQuestions), hp: result.hpRemaining, mp: result.mpRemaining }));
  }
  const output = arg('--output', null);
  if (output) writeFileSync(output, JSON.stringify({
    schema: 1, engine: 'game/js/battle.js', lifecycle: 'game/js/pages/challenge-page.js',
    sourceSha256: sourceBefore, sourceUnchangedAtCompletion: sourceBefore === arenaFingerprint(), override: patch,
    sampling: { seed, stride: 7919, runsPerScenario: runs, detailCount: details },
    assumptions: {
      party: '推奨Lvのある★1級はLv5、★2級はLv10。それ以降の★3〜12は同★標準ダンジョンの平均敵Lv。13級はLv99・★12装備・第5段スキル。両条件の装備段階は同じ。明示的なlevel/stage指定があれば優先。',
      preparation: 'preparedは各階級の最終チャンピオンに耐性・属性を合わせる。装備・技能の合法性は共通preparePartyに従う。',
      battle: 'CSVの既存65戦。makeEnemyにdungeonIdを渡さず、冠付きなし、firstBattle=false、逃走なし。乱数を先読みしない共通fight方策。',
      attrition: 'HP・MP・持続異常・残り道具を持越し。勝利後はfinishBattleのみ。自然回復・EXP/AP・レベルアップ・ドロップなし。',
      intermission: itemPolicy === 'none' ? '戦間の道具使用なし。戦闘中は有限在庫から使う。'
        : '戦間は実useItemOutsideBattleで蘇生、持続異常治療、HP60%未満、MP30%未満の順に有限在庫から使う。戦闘中も同じ在庫を使う。',
      loss: '敗退時は実ゲームで消耗品も戻る。seed詳細のconsumedは試行中の使用数、inventoryLossは成功時だけ。',
      interpretation: '各戦winRateWhenReachedは到達試行が分母。clearRateは全試行が分母。nullはその戦への到達・踏破例がない。操作時間の実測ではない。',
    }, scenarios,
  }, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
