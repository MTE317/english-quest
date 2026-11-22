/** 実際のゲームJSを使う再現可能な戦闘検証。旧Python版の別実装とは混ぜない。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { PROFILES, prepareParty } from './party-fixtures.mjs';
export { PROFILES, prepareParty };
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildGameData, GAME_FILES } from '../game/js/gamedata.js';
import { parseCsv } from '../game/js/csv.js';
import { maxHp, maxMp, gainXp, gearDef, gearEffects, affixSum } from '../game/js/character.js';
import { memberMods } from '../game/js/growth.js';
import { createBattle, nextTurn, actionOptions, setPending, resolvePending, finishBattle, battleRewards, skillMp, battleStats, curedBy, enemyIntent } from '../game/js/battle.js';
import { makeEncounter, planBounty } from '../game/js/encounter.js';
import { rollBattleLoot } from '../game/js/loot.js';
import { recoverAfterBattle, useItemOutsideBattle } from '../game/js/dungeon.js';

export function loadData() {
  const raw = Object.fromEntries(Object.entries(GAME_FILES).map(([key, name]) => {
    const s = readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8').replace(/^\uFEFF/, '');
    return [key, name.endsWith('.json') ? JSON.parse(s) : parseCsv(s).rows];
  }));
  return buildGameData(raw);
}
export function rngFor(seed) {
  let n = seed >>> 0;
  return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; };
}

export function applyBalancePatch(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] ??= {}; applyBalancePatch(target[key], value);
    } else target[key] = value;
  }
}

export function sourceFingerprint() {
  const files = [...Object.values(GAME_FILES).map(name => `data/${name}`),
    'game/js/battle.js', 'game/js/character.js', 'game/js/growth.js', 'game/js/dungeon.js',
    'game/js/encounter.js', 'game/js/loot.js', 'game/js/workshop.js', 'game/js/game-state.js',
    'game/js/gamedata.js', 'sim/build-catalog.json', 'sim/party-fixtures.mjs', 'sim/balance.mjs'];
  const hash = createHash('sha256');
  for (const file of [...new Set(files)].sort()) hash.update(file + '\0').update(readFileSync(new URL(`../${file}`, import.meta.url)));
  return hash.digest('hex');
}
function affinity(data, enemy, elements) {
  if (!elements.length) return 1;
  return elements.reduce((sum, id) => sum + (enemy.weak.includes(id) ? data.balance.battle.weak : enemy.resist.includes(id) ? data.balance.battle.resist : 1), 0) / elements.length;
}
function attackEstimate(data, game, b, i, skill, target) {
  const m = game.party[i]; const st = battleStats(data, game, b, i); const e = b.enemies[target];
  const def = m.equip.weapon && gearDef(data, m.equip.weapon); const wt = data.weaponTypes.get(def?.kind);
  const fx = skill?.effect ?? {}; const base = fx.base ?? 'weapon';
  const mag = base === 'mag' || base === 'weapon' && wt?.attackStat === 'mag';
  let elements = base === 'weapon' ? (wt?.elements ?? []).filter(x => x !== 'none') : (skill?.elements ?? []);
  if (base === 'weapon') {
    if (def?.addedElement) elements.push(def.addedElement);
    if (m.equip.weapon) elements.push(...Object.keys(gearEffects(m.equip.weapon)).filter(key => key.startsWith('ELEMENT:')).map(key => key.slice(8)));
    elements = [...new Set(elements)];
    if (b.allies[i].imbue && !mag) elements = [b.allies[i].imbue];
  }
  if (fx.element && fx.element !== 'best') elements = [fx.element];
  let em = affinity(data, e, elements);
  if (fx.element === 'best') em = Math.max(...(skill.elements?.length ? skill.elements : ['wind', 'earth', 'water']).map(id => affinity(data, e, [id])));
  if (fx.noresist) em = Math.max(1, em);
  let damage = ((mag ? st.mag : st.str) + st.attack) * (fx.m ?? 1) * em * 100 / (100 + (mag ? e.res : e.def) * (1 - (fx.defign ?? 0)));
  // 旧12編成の方策は保持し、新36案では新効果と通常攻撃の武器特性も見積もる。
  // 実戦処理や将来の乱数は呼ばず、現在見えている状態だけを使う近似値。
  if (game.simulationFixture?.catalogBuildId) {
    const rules = data.balance.battle_formulas;
    const mods = memberMods(data, m);
    let bonus = Object.keys(e.statuses).length || Object.keys(e.debuffs).length
      ? (mods.vs_debuffed ?? 0) + affixSum(m, 'VS_DEBUFFED') / 100 : 0;
    bonus += Math.min(rules.status_damage_cap, Object.keys(e.statuses)
      .reduce((sum, id) => sum + affixSum(m, `VS_STATUS:${id}`) / 100, 0));
    if (!b.allies[i].firstAttackUsed) bonus += Math.min(rules.first_hit_cap, affixSum(m, 'FIRST_HIT') / 100);
    if (skill?.kind === 'attack' && b.allies[i].normalSkillReady) bonus += Math.min(rules.normal_skill_cap, affixSum(m, 'NORMAL_SKILL') / 100);
    if (mods.lowhp_dmg && m.hp < maxHp(data, m) * .5) bonus += mods.lowhp_dmg;
    for (const type of e.types) bonus += affixSum(m, `TYPE_BONUS:${type}`) / 100 + affixSum(m, `特効:${type}`) / 100;
    damage *= 1 + bonus;
    if (em > 1) damage *= (fx.wb ?? 1) * (base === 'weapon' ? wt?.traits.weak_damage_mul ?? 1 : 1)
      * (1 + (mods.weak_all ?? 0)) * (1 + Math.min(.6, affixSum(m, 'WEAK_DMG') / 100));
    const crit = Math.min(rules.crit_cap, st.crit + (fx.crt ?? 0));
    damage *= 1 + crit * (Math.min(rules.crit_multiplier_cap,
      data.balance.battle.crit_mult + (mods.crit_dmg ?? 0) + affixSum(m, 'CRIT_DMG') / 100) - 1);
    if (skill && base === 'weapon') damage *= wt?.traits.weapon_skill_mul ?? 1;
    if (!skill) {
      if (m.equip.offhand) damage *= 1 + data.balance.battle.dual_wield_second_hit
        * (st.str + st.offhandAttack) / Math.max(1, st.str + st.attack);
      damage *= 1 + Math.min(rules.extra_hit_cap, affixSum(m, 'EXTRA_HIT') / 100) * .5;
    }
  }
  const hits = fx.hits ?? (base === 'weapon' ? wt?.hits ?? [1] : [1]);
  let score = Math.min(e.hp, damage * hits.reduce((s, x) => s + x, 0));
  if (fx.st) {
    const status = data.statusByName.get(fx.st[0]);
    if (status && !e.statuses[status.id]) score += Math.min(e.hp * .15, damage * .45) * fx.st[1];
  }
  return score;
}

/** 未来の乱数を読まない固定ルールの方策。人間の最適操作を表すものではない。 */
export function chooseAction(data, game, b) {
  const i = b.turn.i, member = game.party[i];
  const options = actionOptions(data, game, b, i);
  const skills = options.skills.filter(x => !x.reason).map(x => x.skill);
  const alive = game.party.map((m, j) => ({ j, m, missing: maxHp(data, m) - m.hp, ratio: m.hp / maxHp(data, m) })).filter(x => x.m.hp > 0).sort((a, z) => a.ratio - z.ratio);
  const dead = game.party.findIndex(m => m.hp <= 0);
  const items = options.items.filter(x => !x.reason).map(x => x.item);
  const catalog = Boolean(game.simulationFixture?.catalogBuildId);
  if (dead >= 0) {
    const revive = skills.find(s => s.kind === 'revive');
    if (revive) return { type: 'skill', skillId: revive.id, target: dead };
    const item = items.find(it => it.effect === 'revive_pct');
    if (item) return { type: 'item', itemId: item.id, target: dead };
  }
  const hurt = alive.filter(x => x.ratio < .68);
  // 道具特化は有限の持込品も主行動として評価する。他の型では従来の緊急使用を維持。
  if (catalog && i === 0 && game.simulationFixture.catalogBuildId === 'item_alchemist' && alive[0]?.ratio < .75) {
    const item = items.filter(it => it.effect === 'heal_hp').sort((a, z) => z.value - a.value)[0];
    if (item) return { type: 'item', itemId: item.id, target: alive[0].j };
  }
  if (hurt.length >= 2) {
    const heal = skills.find(s => s.kind === 'heal_all');
    if (heal) return { type: 'skill', skillId: heal.id, target: hurt[0].j };
  }
  if (alive[0]?.ratio < .58) {
    const heal = skills.find(s => s.kind === 'heal') ?? skills.find(s => s.kind === 'heal_all');
    if (heal) return { type: 'skill', skillId: heal.id, target: alive[0].j };
  }
  if (alive[0]?.ratio < .32) {
    const item = items.filter(it => it.effect === 'heal_hp').sort((a, z) => z.value - a.value)[0];
    if (item) return { type: 'item', itemId: item.id, target: alive[0].j };
  }
  for (const target of alive) {
    const statuses = Object.keys(b.allies[target.j].statuses);
    if (statuses.some(id => ['petrify', 'paralysis', 'sleep', 'silence', 'freeze'].includes(id))) {
      const cure = skills.find(s => ['cure_all', 'cure'].includes(s.kind)
        && statuses.some(id => curedBy(data.statusEffects.get(id), s.name)));
      if (cure) return { type: 'skill', skillId: cure.id, target: target.j };
      const item = items.find(it => it.effect === 'cure_status'
        && statuses.some(id => curedBy(data.statusEffects.get(id), it.name)));
      if (item) return { type: 'item', itemId: item.id, target: target.j };
    }
  }
  const living = b.enemies.map((e, j) => ({ e, j })).filter(x => x.e.hp > 0);
  const boss = living.some(x => x.e.boss);
  const durable = living.filter(x => x.e.hp > attackEstimate(data, game, b, i, null, x.j) * 3);
  const protectedTargets = new Set();
  if (catalog) {
    // 睡眠・凍結は主役の一撃まで保つ。味方の行動順だけを参照し、乱数の先読みはしない。
    if (i !== 0 && game.party[0].hp > 0) {
      const finishers = ['sleep', 'freeze'].filter(id => affixSum(game.party[0], `VS_STATUS:${id}`) > 0);
      for (const { e, j } of living) if (finishers.some(id => e.statuses[id])) protectedTargets.add(j);
      const primaryTurn = b.queue.findIndex(turn => turn.side === 'ally' && turn.i === 0);
      const setup = skills.find(s => finishers.includes(data.statusByName.get(s.effect.st?.[0])?.id));
      if (setup && primaryTurn >= 0) {
        const target = living.find(({ e, j }) => {
          const enemyTurn = b.queue.findIndex(turn => turn.side === 'enemy' && turn.i === j);
          return !finishers.some(id => e.statuses[id]) && (!e.boss || (e.controlGuardUntil ?? 0) < b.round)
            && (enemyTurn < 0 || primaryTurn < enemyTurn) && e.hp > attackEstimate(data, game, b, 0, null, j) * 1.3;
        });
        if (target) return { type: 'skill', skillId: setup.id, target: target.j };
      }
      if (protectedTargets.size === living.length && member.mp > maxMp(data, member) * .2) {
        const support = skills.find(s => ['party_buff', 'ally_buff', 'heal', 'heal_all'].includes(s.kind));
        if (support) return { type: 'skill', skillId: support.id, target: alive[0]?.j ?? i };
      }
    }
    const donor = skills.find(s => s.kind === 'mp_give');
    const recipient = alive.filter(x => x.j !== i && x.m.mp / maxMp(data, x.m) < .3)
      .sort((a, z) => a.m.mp / maxMp(data, a.m) - z.m.mp / maxMp(data, z.m))[0];
    if (donor && recipient && member.mp > maxMp(data, member) * .45 + skillMp(data, member, donor)) {
      return { type: 'skill', skillId: donor.id, target: recipient.j };
    }
    // 予告された全体攻撃に備える。毎巡の満タン回復連打は行わない。
    if (affixSum(member, 'OVERHEAL_SHIELD') > 0 && living.some(({ e }) => enemyIntent(data, e, b.round).warning)) {
      const unprotected = alive.filter(x => x.ratio > .7 && !(b.allies[x.j].buffs.barrier?.[0] > 0));
      const heal = unprotected.length > 1 ? skills.find(s => s.kind === 'heal_all') : skills.find(s => s.kind === 'heal');
      if (heal && unprotected.length) return { type: 'skill', skillId: heal.id, target: unprotected[0].j };
    }
    const taunt = skills.find(s => s.kind === 'self_buff' && s.effect.buff?.taunt && !b.allies[i].buffs.taunt);
    if (taunt && member.hp > maxHp(data, member) * .45 && (boss || living.length > 1)) {
      return { type: 'skill', skillId: taunt.id, target: i };
    }
  }
  const imbue = skills.find(s => s.kind === 'imbue' && s.elements[0] !== b.allies[i].imbue
    && durable.some(x => x.e.weak.includes(s.elements[0])));
  if (imbue && (boss || living.length >= 3)) return { type: 'skill', skillId: imbue.id, target: i };
  const buff = skills.find(s => s.kind === 'party_buff' && Object.entries(s.effect.buff ?? {}).some(([k]) => !b.partyBuffs[k])
    && (boss || ['bard', 'dancer'].includes(member.job)) && b.round <= 5);
  if (buff) return { type: 'skill', skillId: buff.id, target: i };
  const counter = skills.find(s => s.kind === 'self_buff' && s.effect.buff?.counter && !b.allies[i].buffs.counter && boss);
  if (counter) return { type: 'skill', skillId: counter.id, target: i };
  const selfBuff = skills.find(s => s.kind === 'self_buff' && s.effect.buff?.str && !b.allies[i].buffs.str && boss && b.round <= 2);
  if (selfBuff) return { type: 'skill', skillId: selfBuff.id, target: i };
  const debuff = skills.find(s => s.kind === 'debuff' && durable.some(x => Object.keys(s.effect.deb ?? {}).some(k => !x.e.debuffs[k]))
    && (boss || living.length >= 3));
  if (debuff) return { type: 'skill', skillId: debuff.id, target: durable[0].j };
  if (member.mp < maxMp(data, member) * .15 && ['white_mage', 'apothecary'].includes(member.job)) {
    const item = items.find(it => it.effect === 'heal_mp');
    if (item) return { type: 'item', itemId: item.id, target: i };
  }
  const choices = [];
  for (const { e, j } of living) {
    let normalScore = attackEstimate(data, game, b, i, null, j);
    if (catalog) {
      const type = data.weaponTypes.get(member.equip.weapon && gearDef(data, member.equip.weapon).kind);
      if (type?.traits.normal_all_mul) normalScore = living.reduce((sum, x) => sum + attackEstimate(data, game, b, i, null, x.j), 0)
        * (memberMods(data, member).whip ?? type.traits.normal_all_mul);
      if (type?.traits.splash_chance && living.length > 1) normalScore *= 1 + type.traits.splash_chance * type.traits.splash_mul;
      if (!b.allies[i].normalSkillReady && affixSum(member, 'NORMAL_SKILL') > 0) normalScore *= 1.3;
      if (affixSum(member, 'ATTACK_HEAL') > 0 && alive[0]?.ratio < .9) normalScore *= 1.15;
    }
    choices.push({ action: { type: 'attack', target: j }, score: protectedTargets.has(j) ? normalScore * .05
      : normalScore + (member.mp < maxMp(data, member) * .7 ? 12 + member.lv / 2 : 0) });
    for (const s of skills.filter(s => ['attack', 'fixed_damage', 'delayed'].includes(s.kind))) {
      let score = attackEstimate(data, game, b, i, s, j);
      if (s.effect.tgt === 'all' || ['fixed_damage', 'delayed'].includes(s.kind)) score = living.reduce((sum, target) => sum + attackEstimate(data, game, b, i, s, target.j), 0);
      if (s.effect.tgt === 'random') score *= Math.min(s.effect.n ?? 1, living.length + .6);
      if (s.effect.selfcost && member.hp < maxHp(data, member) * .5) score *= .5;
      score -= skillMp(data, member, s) * (member.mp < maxMp(data, member) * .4 ? 2.5 : .7);
      if (protectedTargets.has(j) || protectedTargets.size && (s.effect.tgt === 'all' || s.effect.tgt === 'random')) score *= .05;
      choices.push({ action: { type: 'skill', skillId: s.id, target: j }, score });
    }
    for (const s of skills.filter(s => s.kind === 'status' && s.effect.st)) {
      const status = data.statusByName.get(s.effect.st[0]);
      if (!status || e.statuses[status.id] || e.boss && ['petrify', 'doom'].includes(status.id)) continue;
      let score = 0;
      const targets = s.effect.tgt === 'all' ? living : [{ e, j }];
      for (const target of targets) {
        if (target.e.statuses[status.id]) continue;
        const bossMul = target.e.boss ? .75 : 1;
        if (status.kind.startsWith('dot')) score += target.e.maxHp * status.value * 2.4 * s.effect.st[1] * bossMul
          * (target.e.boss ? .65 : 1) * (1 + affixSum(member, 'DOT_POWER') / 100);
        else if (target.e.hp > attackEstimate(data, game, b, i, null, target.j) * 2) score += (target.e.str + target.e.mag) * .15 * s.effect.st[1] * bossMul;
        if (catalog) {
          const beneficiary = game.party.map((m, index) => ({ m, index, rate: affixSum(m, `VS_STATUS:${status.id}`) / 100 }))
            .filter(x => x.m.hp > 0 && x.rate > 0).sort((a, z) => z.rate - a.rate)[0];
          if (beneficiary) score += attackEstimate(data, game, b, beneficiary.index, null, target.j)
            * Math.min(data.balance.battle_formulas.status_damage_cap, beneficiary.rate) * s.effect.st[1] * bossMul;
          if (status.id === 'silence') score += target.e.mag * target.e.magicRate * .3 * s.effect.st[1] * bossMul;
        }
      }
      score -= skillMp(data, member, s) * (member.mp < maxMp(data, member) * .4 ? 2.5 : .7);
      choices.push({ action: { type: 'skill', skillId: s.id, target: j }, score });
    }
  }
  return choices.sort((a, z) => z.score - a.score)[0]?.action ?? { type: 'attack', target: 0 };
}

/** 戦間の道具も実ゲームの関数で消費する。有限の持込品だけを使う。 */
export function prepareNextBattle(data, game) {
  for (const [index, member] of game.party.entries()) {
    const item = [...data.items.values()].find(it => (game.items[it.id] ?? 0) > 0 && it.effect === 'revive_pct');
    if (member.hp <= 0 && item) useItemOutsideBattle(data, game, item.id, index);
  }
  for (let n = 0; n < 8; n++) {
    const candidates = game.party.map((m, i) => ({ m, i, ratio: m.hp / maxHp(data, m) }))
      .filter(x => x.m.hp > 0).sort((a, b) => a.ratio - b.ratio);
    const target = candidates[0];
    if (!target || target.ratio >= .65) break;
    const item = [...data.items.values()].filter(it => (game.items[it.id] ?? 0) > 0 && it.effect === 'heal_hp')
      .sort((a, b) => a.value - b.value)[0];
    if (!item) break;
    useItemOutsideBattle(data, game, item.id, target.i);
  }
  for (const [index, member] of game.party.entries()) {
    if (member.hp <= 0) continue;
    const statusItem = [...data.items.values()].find(it => (game.items[it.id] ?? 0) > 0 && it.effect === 'cure_status'
      && member.persist.some(id => curedBy(data.statusEffects.get(id), it.name)));
    if (statusItem) useItemOutsideBattle(data, game, statusItem.id, index);
    if (['white_mage', 'apothecary'].includes(member.job) && member.mp < maxMp(data, member) * .35) {
      const mana = [...data.items.values()].find(it => (game.items[it.id] ?? 0) > 0 && it.effect === 'heal_mp');
      if (mana) useItemOutsideBattle(data, game, mana.id, index);
    }
  }
}

export function fight(data, game, enemies, seed, accuracy = .8, firstBattle = false) {
  const b = createBattle(data, game, { enemies, seed, firstBattle, canFlee: false });
  const answers = rngFor(seed ^ 0x5f3759df); let questions = 0;
  while (nextTurn(data, game, b) && questions < 400) {
    setPending(b, chooseAction(data, game, b), { wordId: 'simulation' });
    resolvePending(data, game, b, answers() < accuracy); questions++;
  }
  if (b.result === 'win') finishBattle(data, game, b);
  return { b, questions, rounds: b.round, win: b.result === 'win' };
}

const partyTemplates = new WeakMap();
export function runExpedition(data, dungeonId, { seed = 1, accuracy = .8, profile = 'balanced', preparation = 'standard', level, stage, season = 'spring', elites = true, bounties = true } = {}) {
  const dg = data.dungeons.get(dungeonId);
  if (!partyTemplates.has(data)) partyTemplates.set(data, new Map());
  const templates = partyTemplates.get(data), key = JSON.stringify([dungeonId, profile, preparation, level, stage]);
  if (!templates.has(key)) templates.set(key, prepareParty(data, dg, profile, preparation, { level, stage }));
  const game = structuredClone(templates.get(key));
  const initialItems = { ...game.items }; const rng = rngFor(seed); const rows = data.dungeonFloors.filter(r => r.dungeonId === dg.id);
  const bounty = bounties ? planBounty(data, game, dungeonId, rng) : null;
  const results = []; let totalGold = 0, totalXp = 0, totalAp = 0, materials = 0, gear = 0, elitesSeen = 0;
  for (const row of rows) for (let bi = 0; bi < row.battles; bi++) {
    const boss = row.lastBattleIsBoss && bi === row.battles - 1;
    const maxElites = Math.max(0, Number(data.balance.dungeon?.elite_max_per_run ?? 1) - elitesSeen);
    if (results.length) prepareNextBattle(data, game);
    const bountyId = bounty?.floor === row.floor && bounty?.battle === bi ? bounty.monsterId : null;
    const enemies = makeEncounter(data, dg.id, row.floor, rng, { boss, season, elites, maxElites, bountyId });
    elitesSeen += enemies.filter(e => e.eliteId).length;
    const result = fight(data, game, enemies, seed * 1009 + row.floor * 37 + bi, accuracy, results.length === 0);
    results.push({ boss, bounty: Boolean(bountyId), questions: result.questions, rounds: result.rounds, win: result.win });
    if (!result.win) return summarize(false);
    const rewards = battleRewards(data, game, result.b);
    for (const [i, m] of game.party.entries()) {
      gainXp(data, m, rewards.xp[i]); m.ap[m.job] = (m.ap[m.job] ?? 0) + rewards.ap[i];
      totalXp += rewards.xp[i] / 4; totalAp += rewards.ap[i] / 4;
    }
    recoverAfterBattle(data, game);
    const survivors = game.party.filter(m => m.hp > 0);
    const dropBonus = Math.max(0, ...survivors.map(m => (memberMods(data, m).drop ?? 0) + affixSum(m, 'DROP') / 100));
    const goldBonus = Math.max(0, ...survivors.map(m => memberMods(data, m).gold ?? 0));
    const loot = rollBattleLoot(data, game, dg.id, row.floor, enemies, rng, { dropBonus });
    loot.gold = Math.round(loot.gold * (1 + goldBonus));
    for (const id of result.b.stolen ?? []) {
      const existing = loot.materials.find(entry => entry.id === id);
      if (existing) existing.count++;
      else loot.materials.push({ id, count: 1 });
    }
    totalGold += loot.gold; materials += loot.materials.reduce((a, x) => a + x.count, 0); gear += loot.gear.length;
  }
  return summarize(true);
  function summarize(win) {
    const consumed = Object.entries(initialItems).reduce((sum, [id, count]) => sum + count - (game.items[id] ?? 0), 0);
    const cost = Object.entries(initialItems).reduce((sum, [id, count]) => sum + (count - (game.items[id] ?? 0)) * Math.round((data.items.get(id)?.price ?? 0) * (1 - (data.ranks.find(r => r.id === game.rank)?.shopDiscount ?? 0))), 0);
    return { win, questions: results.reduce((a, x) => a + x.questions, 0), battles: results,
      hp: game.party.reduce((a, m) => a + m.hp, 0) / game.party.reduce((a, m) => a + maxHp(data, m), 0),
      mp: game.party.reduce((a, m) => a + m.mp, 0) / game.party.reduce((a, m) => a + maxMp(data, m), 0),
      consumed, cost: win ? cost : 0, gold: win ? totalGold : 0, xp: win ? totalXp : 0, ap: win ? totalAp : 0,
      materials: win ? materials : 0, gear: win ? gear : 0 };
  }
}

const average = xs => xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null;
function percentile(xs, p) { return xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] : null; }
export function evaluateScenario(data, dungeonId, options = {}, runs = 80) {
  const preparedGame = prepareParty(data, data.dungeons.get(dungeonId), options.profile ?? 'balanced', options.preparation ?? 'standard',
    { level: options.level, stage: options.stage });
  const setup = preparedGame.simulationFixture;
  const samples = Array.from({ length: runs }, (_, i) => runExpedition(data, dungeonId, { ...options, seed: (options.seed ?? 41041) + i * 7919 }));
  const wins = samples.filter(x => x.win); const battles = samples.flatMap(x => x.battles);
  const normal = battles.filter(x => !x.boss && !x.bounty), bosses = battles.filter(x => x.boss);
  const bountyBattles = battles.filter(x => x.bounty);
  const q = average(wins.map(x => x.questions));
  return { dungeonId, star: data.dungeons.get(dungeonId).rank, ...options, runs, wins: wins.length,
    fixture: { level: setup.level, stage: setup.stage, itemCap: setup.itemCap, enhancement: setup.enhancement,
      assembly: setup.assembly, initialItems: { ...preparedGame.items } },
    clearRate: wins.length / runs, normalWinRate: average(normal.map(x => Number(x.win))), bossWinRate: average(bosses.map(x => Number(x.win))),
    normalBattles: normal.length, normalWins: normal.filter(x => x.win).length, bossAttempts: bosses.length,
    failedBeforeBoss: samples.filter(x => !x.win && !x.battles.some(battle => battle.boss)).length,
    failedInNormalBattle: normal.filter(x => !x.win).length, failedAtBoss: bosses.filter(x => !x.win).length,
    failedAtBounty: bountyBattles.filter(x => !x.win).length,
    bountyEncounters: bountyBattles.length, bountyWinRate: average(bountyBattles.map(x => Number(x.win))),
    normalQuestions: average(normal.filter(x => x.win).map(x => x.questions)), bossQuestions: average(bosses.filter(x => x.win).map(x => x.questions)),
    normalQuestionsAll: average(normal.map(x => x.questions)), bossQuestionsAll: average(bosses.map(x => x.questions)),
    bossLossQuestions: average(bosses.filter(x => !x.win).map(x => x.questions)),
    clearQuestions: q, clearQuestionsP90: percentile(wins.map(x => x.questions), .9),
    estimatedClearMinutes: q == null ? null : (q * data.balance.balance_targets.seconds_per_question + data.balance.balance_targets.overhead_seconds) / 60,
    hpRemaining: average(wins.map(x => x.hp)), mpRemaining: average(wins.map(x => x.mp)),
    consumables: average(wins.map(x => x.consumed)), goldPerClear: average(wins.map(x => x.gold)),
    netGoldBeforeFees: average(wins.map(x => x.gold - x.cost - data.economy.get(data.dungeons.get(dungeonId).rank).inn_cheap)),
    xpPerMemberPerClear: average(wins.map(x => x.xp)), apPerMemberPerClear: average(wins.map(x => x.ap)),
    materialsPerClear: average(wins.map(x => x.materials)), gearPerClear: average(wins.map(x => x.gear)) };
}

async function main() {
  const args = process.argv.slice(2); const arg = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
  const data = loadData();
  const override = arg('--override', null);
  const patch = override ? JSON.parse(readFileSync(override, 'utf8')) : {};
  applyBalancePatch(data.balance, patch);
  const stars = arg('--stars', '1,3,6,9,12').split(',').map(Number), runs = Number(arg('--runs', '80'));
  const profiles = arg('--profiles', 'balanced').split(','), preparations = arg('--preparations', 'standard,prepared').split(',');
  const accuracies = arg('--accuracy', '.8').split(',').map(Number);
  const specific = arg('--dungeon', null);
  const kind = arg('--kind', '標準');
  const dungeons = specific ? [data.dungeons.get(specific)] : [...data.dungeons.values()].filter(d => stars.includes(d.rank) && (kind === 'all' || d.kind === kind));
  const seasons = arg('--seasons', 'spring').split(',');
  const seed = Number(arg('--seed', '914031'));
  const jobs = [];
  for (const dungeon of dungeons) for (const profile of profiles) for (const preparation of preparations) for (const accuracy of accuracies) for (const season of seasons) {
    if (dungeon.rank < PROFILES[profile].minStar) continue;
    jobs.push({ dungeonId: dungeon.id, options: { profile, preparation, accuracy, season, seed }, runs, patch });
  }
  const scenarios = Array(jobs.length); let next = 0;
  const workers = Math.max(1, Math.min(8, Number(arg('--workers', '1'))));
  async function runQueue() {
    while (next < jobs.length) {
      const index = next++, job = jobs[index];
      const result = workers === 1 ? evaluateScenario(data, job.dungeonId, job.options, runs)
        : await new Promise((resolve, reject) => {
          const worker = new Worker(new URL('./balance-worker.mjs', import.meta.url), { workerData: job });
          worker.once('message', resolve); worker.once('error', reject);
          worker.once('exit', code => { if (code) reject(new Error(`balance worker exit ${code}`)); });
        });
      scenarios[index] = result;
      console.log(JSON.stringify({ star: result.star, dungeon: job.dungeonId, ...job.options,
      win: +result.clearRate.toFixed(3), normalQ: result.normalQuestions?.toFixed(1), bossQ: result.bossQuestions?.toFixed(1),
      clearQ: result.clearQuestions?.toFixed(1), hp: result.hpRemaining?.toFixed(2), gold: result.netGoldBeforeFees?.toFixed(0) }));
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, runQueue));
  const out = arg('--output', null);
  if (out) writeFileSync(out, JSON.stringify({ schema: 1, engine: 'game/js/battle.js', sourceSha256: sourceFingerprint(), override: patch, assumptions: {
    policy: 'fixed heuristics; no future RNG inspection; known weaknesses; finite items incl. intermission; natural bounty encounters; no retreat',
    gear: 'legal craft/enchant/skill APIs; same base item level, quality 1.15, enhancement +0 to +3 between preparation variants; fixture assembly budget recorded separately',
    rewards: 'battle loot only; XP learning multiplier 1.0; quests and monthly fees excluded; counts are drops before backpack selection; wipes rollback rewards and consumable costs',
    timing: '6 seconds per answer including operation/animation plus 30 seconds; not a browser timing measurement',
  }, scenarios }, null, 2) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
