/** 初期装備・支度金からの入口確認。装備済みの比較用 fixture とは別の検証。 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData, chooseAction, prepareNextBattle, rngFor, sourceFingerprint } from './balance.mjs';
import { createNewGame } from '../game/js/game-state.js';
import { GameSession } from '../game/js/save.js';
import { maxHp, maxMp } from '../game/js/character.js';
import { nextTurn, setPending, resolvePending } from '../game/js/battle.js';
import { commonBlock, learnCommon, jobSkills, learnBlock, learnSkill } from '../game/js/growth.js';
import {
  startRun, startNextBattle, afterBattle, returnToTown, continueRun, resolveLoot,
  isBossBattle, useItemOutsideBattle,
} from '../game/js/dungeon.js';
import { buyItem, itemShopStock, stayInn, revive } from '../game/js/town.js';
import { cureAtTemple } from '../game/js/temple.js';

const SUPPLIES = Object.freeze({ potion: 3, ether: 2, revive_salts: 1, antidote: 2 });
const DEFAULT_DUNGEONS = ['mossy_cave', 'sunlit_forest'];
const mean = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const rounded = (value) => value == null ? null : Math.round(value * 1000) / 1000;
const sum = (values) => values.reduce((a, b) => a + b, 0);
const counts = (items) => ({ ...items });
const itemDifference = (before, after) => Object.fromEntries(
  [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .map(id => [id, (before[id] ?? 0) - (after[id] ?? 0)]).filter(([, n]) => n),
);
const gearIds = (game) => game.party.map(m => Object.fromEntries(
  Object.entries(m.equip).filter(([, gear]) => gear).map(([slot, gear]) => [slot, gear.id]),
));
const levels = (game) => game.party.map(m => m.lv);

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

/** AP・レベルを足さず、実際に満たした条件だけで自職を覚える。 */
function spendGrowth(data, game) {
  const learned = [];
  for (const [index, member] of game.party.entries()) {
    for (const node of [...data.commonTree].sort((a, b) => a.level - b.level)) {
      if (!commonBlock(data, member, node)) {
        learnCommon(data, member, node.id);
        learned.push({ member: index, common: node.id });
      }
    }
    // 初心者向けの単純な順番：低い段階から、同段階は CSV の職別 ID 順。
    for (const skill of jobSkills(data, member.job).sort((a, b) => a.stage - b.stage || a.id.localeCompare(b.id))) {
      if (!learnBlock(data, member, skill)) {
        learnSkill(data, member, skill.id);
        learned.push({ member: index, skill: skill.id, ap: skill.apToLearn });
      }
    }
  }
  return learned;
}

function buySupplies(data, game) {
  const before = game.gold;
  const bought = {};
  const missing = {};
  for (const [id, target] of Object.entries(SUPPLIES)) {
    const need = Math.max(0, target - (game.items[id] ?? 0));
    if (!need) continue;
    const stock = itemShopStock(data, game).find(entry => entry.item.id === id);
    if (!stock || game.gold < stock.price) { missing[id] = need; continue; }
    bought[id] = buyItem(data, game, id, need);
    if (bought[id] < need) missing[id] = need - bought[id];
  }
  return { gold: before - game.gold, bought, missing };
}

/** 次の冒険の前。蘇生・治療・普通の宿・不足分の補給を実料金で行う。 */
function prepareInTown(data, session) {
  const game = session.game;
  const before = game.gold;
  const record = { revive: 0, cure: 0, inn: 0, itemsUsed: {}, supplies: null, blocked: null };
  try {
    for (const [index, member] of game.party.entries()) {
      if (member.hp <= 0) {
        if (game.items.revive_salts > 0) {
          useItemOutsideBattle(data, game, 'revive_salts', index);
          record.itemsUsed.revive_salts = (record.itemsUsed.revive_salts ?? 0) + 1;
        } else record.revive += revive(data, game, index);
      }
      if (member.persist?.length) {
        const beforeCure = game.gold;
        if (game.items.antidote > 0 && member.persist.some(id => ['poison', 'toxic'].includes(id))) {
          useItemOutsideBattle(data, game, 'antidote', index);
          record.itemsUsed.antidote = (record.itemsUsed.antidote ?? 0) + 1;
        }
        if (member.persist.length) cureAtTemple(data, game, member);
        record.cure += beforeCure - game.gold;
      }
    }
    if (game.party.some(member => member.hp < maxHp(data, member) || member.mp < maxMp(data, member))) {
      record.inn = stayInn(data, game, false);
    }
    record.supplies = buySupplies(data, game);
  } catch (error) {
    record.blocked = error.message;
  }
  record.total = before - game.gold;
  session.save();
  return record;
}

/** 全ての遷移・報酬・全滅復元を実ゲームの GameSession 経由で処理する。 */
export function runOnboardingAttempt(data, session, dungeonId, { seed, accuracy = .8 } = {}) {
  const gameBefore = structuredClone(session.game);
  const record = {
    seed, startLevels: levels(session.game), startGold: session.game.gold, startItems: counts(session.game.items),
    battles: [], learned: [], questions: 0, correct: 0, grossGold: 0, grossXp: 0,
    discardedLoot: 0, bossEntryLevels: null, clear: false,
  };
  startRun(data, session, { dungeonId, stoneId: 'rs_1_001', quizState: { asked: 0 }, seed });
  const answers = rngFor(seed ^ 0x5f3759df);
  while (session.inDungeon) {
    while (session.run.state === 'loot') {
      resolveLoot(data, session, null);
      record.discardedLoot++;
    }
    if (session.run.state === 'cleared') {
      record.clear = true;
      record.itemsUsedBeforeRollback = itemDifference(record.startItems, session.game.items);
      record.levelsBeforeRollback = levels(session.game);
      returnToTown(data, session);
      break;
    }
    if (session.run.state === 'return_point') continueRun(session);
    if (session.run.state !== 'ready') throw new Error(`予期しない遠征状態: ${session.run.state}`);
    if (record.battles.length) prepareNextBattle(data, session.game);
    const boss = isBossBattle(data, session.run);
    if (boss) record.bossEntryLevels = levels(session.game);
    const entry = {
      boss, floor: session.run.floor, level: levels(session.game),
      hp: session.game.party.map(m => m.hp), mp: session.game.party.map(m => m.mp),
      questions: 0, correct: 0,
    };
    startNextBattle(data, session);
    const b = session.run.battle;
    entry.enemies = b.enemies.map(e => ({ id: e.monsterId, level: e.lv, elite: e.eliteId ?? null, bounty: !!e.bounty }));
    while (nextTurn(data, session.game, b)) {
      if (entry.questions >= 400) throw new Error(`戦闘が 400 問を超過: ${dungeonId} / seed ${seed}`);
      setPending(b, chooseAction(data, session.game, b), { wordId: 'onboarding', reason: 'neutral' });
      const correct = answers() < accuracy;
      resolvePending(data, session.game, b, correct);
      entry.questions++;
      if (correct) entry.correct++;
      session.run.quiz.asked++;
      session.save();
    }
    entry.result = b.result;
    entry.rounds = b.round;
    entry.survivors = session.game.party.filter(m => m.hp > 0).length;
    record.questions += entry.questions;
    record.correct += entry.correct;
    if (b.result !== 'win') {
      record.itemsUsedBeforeRollback = itemDifference(record.startItems, session.game.items);
      record.levelsBeforeRollback = levels(session.game);
    }
    const outcome = afterBattle(data, session);
    entry.gold = outcome.loot?.gold ?? 0;
    entry.growth = outcome.growth;
    record.grossGold += entry.gold;
    record.grossXp += sum(outcome.growth.map(growth => growth.xp));
    record.battles.push(entry);
  }
  // 道中の仲間ナビは閉じている。API上の抜け道を使わず、町へ戻ってから取得する。
  record.learned = spendGrowth(data, session.game);
  record.finalLevels = levels(session.game);
  record.finalGold = session.game.gold;
  record.retainedGold = session.game.gold - gameBefore.gold;
  record.retainedItemsUsed = itemDifference(record.startItems, session.game.items);
  record.finalItems = counts(session.game.items);
  record.finalAp = session.game.party.map(member => member.ap[member.job]);
  record.materialsReturned = sum(Object.values(session.game.storage.materials)) - sum(Object.values(gameBefore.storage.materials));
  record.gearReturned = session.game.storage.gear.length - gameBefore.storage.gear.length;
  if (JSON.stringify(gearIds(session.game)) !== JSON.stringify(gearIds(gameBefore))) throw new Error('初期装備が変更された');
  if (session.game.gold < 0) throw new Error('所持金が負数になった');
  return record;
}

function newSession(data) {
  const jobs = data.balance.new_game.party_jobs;
  const session = new GameSession({ storage: new MemoryStorage(), now: () => 0 });
  session.startNew(createNewGame(data, jobs.map((job, index) => ({ name: `初期${index + 1}`, job, icon: '◆' }))));
  return session;
}

function summarize(series) {
  const first = series.map(run => run.attempts[0]);
  const firstBattles = first.map(attempt => attempt.battles[0]);
  const firstBossEntries = first.filter(attempt => attempt.bossEntryLevels);
  const firstClears = first.filter(attempt => attempt.clear);
  const allAttempts = series.flatMap(run => run.attempts);
  const itemMean = (attempts, key) => Object.fromEntries(Object.keys(SUPPLIES).map(id => [id,
    rounded(mean(attempts.map(attempt => attempt[key]?.[id] ?? 0))),
  ]));
  const transitions = series.map(run => run.transition).filter(Boolean);
  return {
    seeds: series.length,
    firstAttempt: {
      firstNormalWins: firstBattles.filter(b => b.result === 'win').length,
      firstNormalWinRate: rounded(mean(firstBattles.map(b => Number(b.result === 'win')))),
      firstNormalQuestions: rounded(mean(firstBattles.map(b => b.questions))),
      bossReached: firstBossEntries.length,
      bossReachRate: rounded(firstBossEntries.length / first.length),
      bossEntryLevelMean: rounded(mean(firstBossEntries.flatMap(a => a.bossEntryLevels))),
      bossEntryLevelsRange: firstBossEntries.length
        ? [Math.min(...firstBossEntries.flatMap(a => a.bossEntryLevels)), Math.max(...firstBossEntries.flatMap(a => a.bossEntryLevels))] : null,
      clears: firstClears.length, clearRate: rounded(firstClears.length / first.length),
      questionsAllAttempts: rounded(mean(first.map(a => a.questions))),
      questionsOnClear: rounded(mean(firstClears.map(a => a.questions))),
      questionAccuracy: rounded(sum(first.map(a => a.correct)) / sum(first.map(a => a.questions))),
      endGoldMean: rounded(mean(first.map(a => a.finalGold))),
      retainedGoldMean: rounded(mean(first.map(a => a.retainedGold))),
      usedBeforeRollbackMean: itemMean(first, 'itemsUsedBeforeRollback'),
      retainedConsumptionMean: itemMean(first, 'retainedItemsUsed'),
      materialsReturnedMean: rounded(mean(first.map(a => a.materialsReturned))),
    },
    progression: {
      reachedTarget: series.filter(run => run.clears >= run.targetClears).length,
      reachedTargetRate: rounded(mean(series.map(run => Number(run.clears >= run.targetClears)))),
      clearsMean: rounded(mean(series.map(run => run.clears))),
      attemptsMean: rounded(mean(series.map(run => run.attempts.length))),
      attemptsToTargetMean: rounded(mean(series.filter(run => run.clears >= run.targetClears).map(run => run.attempts.length))),
      finalLevelMean: rounded(mean(series.flatMap(run => run.finalLevels))),
      finalGoldMean: rounded(mean(series.map(run => run.finalGold))),
      finalGoldRange: [Math.min(...series.map(run => run.finalGold)), Math.max(...series.map(run => run.finalGold))],
      replenishmentAndRestMean: rounded(mean(series.map(run => sum(run.town.map(town => town.total))))),
      materialsReturnedMean: rounded(mean(series.map(run => run.materials))),
      gearReturnedMean: rounded(mean(series.map(run => run.gear))),
      blocked: series.filter(run => run.blocked).map(run => ({ seed: run.seed, reason: run.blocked })),
      clearRateAcrossAttempts: rounded(mean(allAttempts.map(attempt => Number(attempt.clear)))),
      ...(transitions.length ? { standardAfterThreeNearClears: {
        trials: transitions.length,
        startLevelMean: rounded(mean(transitions.flatMap(t => t.attempt.startLevels))),
        clears: transitions.filter(t => t.attempt.clear).length,
        clearRate: rounded(mean(transitions.map(t => Number(t.attempt.clear)))),
        questionsMean: rounded(mean(transitions.map(t => t.attempt.questions))),
        questionsOnClear: rounded(mean(transitions.filter(t => t.attempt.clear).map(t => t.attempt.questions))),
        bossEntryLevelMean: rounded(mean(transitions.flatMap(t => t.attempt.bossEntryLevels ?? []))),
        townBeforeStandardCostMean: rounded(mean(transitions.map(t => t.town.total))),
        finalGoldMean: rounded(mean(transitions.map(t => t.attempt.finalGold))),
      } } : {}),
    },
  };
}

export function measureOnboarding(data, { seeds = 24, maxAttempts = 10, targetClears = 3, accuracy = .8, dungeons = DEFAULT_DUNGEONS } = {}) {
  const prototype = newSession(data);
  const starting = {
    gold: prototype.game.gold, party: prototype.game.party.map(m => ({
      job: m.job, level: m.lv, hp: m.hp, mp: m.mp, loadout: structuredClone(m.loadout),
    })), gear: gearIds(prototype.game),
  };
  starting.purchase = buySupplies(data, prototype.game);
  starting.goldAfterPurchase = prototype.game.gold;
  const results = [];
  for (const dungeonId of dungeons) {
    const series = [];
    for (let seed = 1; seed <= seeds; seed++) {
      const session = newSession(data);
      const purchase = buySupplies(data, session.game);
      const run = { seed, targetClears, initialPurchase: purchase, attempts: [], town: [], clears: 0, blocked: null };
      for (let attempt = 0; attempt < maxAttempts && run.clears < targetClears; attempt++) {
        if (attempt) {
          spendGrowth(data, session.game);
          const town = prepareInTown(data, session);
          run.town.push(town);
          if (town.blocked) { run.blocked = town.blocked; break; }
        }
        const outcome = runOnboardingAttempt(data, session, dungeonId, { seed: seed + attempt * 104729, accuracy });
        run.attempts.push(outcome);
        if (outcome.clear) run.clears++;
      }
      run.finalLevels = levels(session.game);
      run.finalGold = session.game.gold;
      run.materials = sum(Object.values(session.game.storage.materials));
      run.gear = session.game.storage.gear.length;
      run.learned = session.game.party.map(member => ({ job: member.job, common: member.common, skills: member.learned, ap: member.ap[member.job] }));
      if (dungeonId === 'sunlit_forest' && run.clears >= targetClears) {
        const town = prepareInTown(data, session);
        if (!town.blocked) run.transition = {
          town, attempt: runOnboardingAttempt(data, session, 'mossy_cave', { seed: seed + 15485863, accuracy }),
        };
      }
      series.push(run);
    }
    results.push({ dungeonId, name: data.dungeons.get(dungeonId).name, summary: summarize(series), series });
  }
  return { starting, results };
}

function fingerprint() {
  const hash = createHash('sha256').update(sourceFingerprint());
  for (const file of ['sim/onboarding.mjs', 'game/js/save.js', 'game/js/game-state.js', 'game/js/town.js', 'game/js/temple.js']) {
    hash.update(file).update(readFileSync(new URL(`../${file}`, import.meta.url)));
  }
  return hash.digest('hex');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (key, fallback) => { const i = args.indexOf(key); return i < 0 ? fallback : args[i + 1]; };
  const config = {
    seeds: Number(option('--seeds', 24)), maxAttempts: Number(option('--max-attempts', 10)),
    targetClears: Number(option('--target-clears', 3)), accuracy: Number(option('--accuracy', .8)),
  };
  const out = resolve(option('--out', fileURLToPath(new URL('./results/onboarding.json', import.meta.url))));
  const before = fingerprint();
  const data = loadData();
  const report = {
    version: 1, measuredAt: new Date().toISOString(), fingerprint: before, config,
    assumptions: {
      purpose: '新規ゲームの入口確認。合法な制作装備をそろえた比較条件の勝率とは分けて扱う。',
      engine: 'createNewGame → GameSession → startRun → startNextBattle → nextTurn / chooseAction / resolvePending → afterBattle → returnToTown',
      party: 'balance.new_game.party_jobs の 4 人。Lv1・初期装備を最後まで維持。強化・制作・エンチャント・装備更新なし。',
      supplies: '道具屋ランク1の実商品を buyItem で購入。回復薬3・魔力の水2・気付け薬1・毒消し2。以後は帰町時に不足分だけ補給。',
      growth: '帰町後に実APで自職スキルを低い段階・ID順に習得。共通ツリーは必要Lvとポイントを満たす順に取得。遠征中は仲間ナビが閉じるため、道中での取得・付替は行わない。',
      town: '既存気付け薬か実料金の神殿で蘇生。状態異常は毒消しまたは神殿治療。減少HP/MPは普通の宿で回復し、料金を記録。',
      actionPolicy: 'sim/balance.mjs の固定ルール chooseAction と prepareNextBattle を共有。未来乱数を見ない。最適な人間操作を保証するものではない。',
      accuracy: `固定seedの独立乱数で1問ごとに${config.accuracy * 100}%正答。SRSの新出・復習報酬倍率は中立1.0、詠唱/覚醒の追加恩恵なし。`,
      route: '全帰還ポイントで先へ進み、ボス踏破を試す。全滅時は実際の入場前snapshotへ戻り、経験値・消費品・お金の巻き戻しも反映。',
      rewards: '遭遇・季節・精鋭・賞金首・通常ドロップは実ゲームAPI。受注クエストなし。報酬装備は倉庫に保管し使用しない。バックパックあふれ分は放棄。',
      accounting: '失敗時の戦闘中消費と巻き戻し後の純消費を分記。最終所持金は最後の帰町直後（次の冒険用の休息・補給前）。',
      transition: '近場を目標回数踏破した seed は、町で有料休息・補給の後、同じ初期装備で標準へ1回挑む。移行結果と費用は近場単独の3周集計に混ぜない。',
      limits: '各24seedの小規模確認。5分の実時間や人間の判断・問題難度は直接測定しない。',
    },
    ...measureOnboarding(data, config),
  };
  report.sourceChangedWhileRunning = before !== fingerprint();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output: out, sourceChangedWhileRunning: report.sourceChangedWhileRunning,
    starting: report.starting, results: report.results.map(({ dungeonId, summary }) => ({ dungeonId, summary })) }, null, 2));
}
