/**
 * 36案の「核が発動するか」を、合法な prepared 編成と実戦闘APIで確かめる。
 * 勝率・遭遇頻度・攻略速度の測定ではない。確率効果は発動した最初の固定seedを記録する。
 * 味方の能力・装備・技能は盛らず、負傷/MP不足/状態/行動順と耐久標的だけを準備する。
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BUILD_CATALOG, prepareParty, assertBuildCore } from './party-fixtures.mjs';
import { loadData, sourceFingerprint } from './balance.mjs';
import { maxHp, maxMp, affixSum } from '../game/js/character.js';
import {
  createBattle, makeEnemy, canAct, actionOptions, setPending, resolvePending,
  nextTurn, collectBattleHits, skillMp, battleStats,
} from '../game/js/battle.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const STATUS_IDS = new Set(['poison', 'toxic', 'burn', 'bleed', 'sleep', 'paralysis', 'freeze', 'stun', 'bind', 'silence', 'blind', 'statdown']);
const DEFAULT_SEED = 360001;
const MAX_ATTEMPTS = 512;

function pickMonster(base, predicate = () => true) {
  const monsters = [...base.data.monsters.values()].filter((m) => !m.isBoss && m.role === 'normal' && m.rank <= base.build.minStar && predicate(m));
  monsters.sort((a, b) => Number(b.dungeons.includes(base.dungeon.id)) - Number(a.dungeons.includes(base.dungeon.id))
    || b.rank - a.rank || b.statusRate - a.statusRate || a.id.localeCompare(b.id));
  assert.ok(monsters.length, `${base.build.id}: 発動条件に適した公開モンスターがない`);
  return monsters[0];
}

function context(base, seed, { monsterId, count = 1, boss = false, soleSurvivor = false } = {}) {
  const game = clone(base.game);
  const id = monsterId ?? pickMonster(base).id;
  const originals = Array.from({ length: count }, () => makeEnemy(base.data, id, {
    lv: game.simulationFixture.level, dungeonId: base.dungeon.id, boss,
  }));
  const originalHp = originals.map((enemy) => enemy.maxHp);
  const enemies = originals.map((enemy) => ({ ...enemy, hp: enemy.maxHp * 10, maxHp: enemy.maxHp * 10 }));
  if (soleSurvivor) for (const member of game.party.slice(1)) member.hp = 0;
  const battle = createBattle(base.data, game, { enemies, seed, canFlee: false });
  battle.round = 1;
  return {
    ...base, game, battle, seed,
    conditions: { enemy: { monsterId: id, sourceRank: base.data.monsters.get(id).rank, count, boss, level: game.simulationFixture.level, originalMaxHp: originalHp, hpMultiplier: 10 },
      startRound: 1, soleSurvivor, answers: '全問正解', actionOrder: '発動条件を切り出すため指定', preparedStates: [] },
    actions: [],
  };
}

function copyContext(ctx) { return { ...ctx, game: clone(ctx.game), battle: clone(ctx.battle), conditions: clone(ctx.conditions), actions: clone(ctx.actions) }; }
function hp(ctx, i, value) { ctx.game.party[i].hp = value; ctx.conditions.preparedStates.push({ member: i, hp: value }); }
function mp(ctx, i, value) { ctx.game.party[i].mp = value; ctx.conditions.preparedStates.push({ member: i, mp: value }); }
function states(ctx, i, ids) {
  for (const id of ids) ctx.battle.allies[i].statuses[id] = { turns: 3, n: 1 };
  ctx.conditions.preparedStates.push({ member: i, statuses: ids });
}
function skillAction(id, target = 0) { return { type: 'skill', skillId: id, target }; }
function normalAction(target = 0) { return { type: 'attack', target }; }

function act(ctx, actor, action) {
  assert.ok(canAct(ctx.game, ctx.battle, actor), `${ctx.build.id}: 行動者が行動不能`);
  const options = actionOptions(ctx.data, ctx.game, ctx.battle, actor);
  if (action.type === 'skill') {
    const option = options.skills.find((row) => row.skill.id === action.skillId);
    assert.ok(option, `${ctx.build.id}: 装備していない技能 ${action.skillId}`);
    assert.equal(option.reason, '', `${ctx.build.id}: ${action.skillId}: ${option.reason}`);
  }
  if (action.type === 'item') {
    const option = options.items.find((row) => row.item.id === action.itemId);
    assert.ok(option && option.count > 0 && !option.reason, `${ctx.build.id}: 所持していない道具 ${action.itemId}`);
  }
  const enemyHp = ctx.battle.enemies.map((enemy) => enemy.hp);
  const allyHp = ctx.game.party.map((member) => member.hp);
  const allyMp = ctx.game.party.map((member) => member.mp);
  const logStart = ctx.battle.log.length;
  ctx.battle.turn = { side: 'ally', i: actor };
  setPending(ctx.battle, action, {});
  const hits = collectBattleHits(ctx.battle, () => resolvePending(ctx.data, ctx.game, ctx.battle, true));
  ctx.actions.push({ actor, ...action });
  return {
    damage: enemyHp.map((before, i) => before - ctx.battle.enemies[i].hp),
    healing: allyHp.map((before, i) => ctx.game.party[i].hp - before),
    mpChange: allyMp.map((before, i) => ctx.game.party[i].mp - before),
    hits, log: ctx.battle.log.slice(logStart),
  };
}

function enemyAct(ctx) {
  const logStart = ctx.battle.log.length;
  const enemyHp = ctx.battle.enemies.map((enemy) => enemy.hp);
  ctx.battle.turn = null;
  ctx.battle.queue = [{ side: 'enemy', i: 0 }, { side: 'ally', i: 0 }];
  const hits = collectBattleHits(ctx.battle, () => nextTurn(ctx.data, ctx.game, ctx.battle));
  ctx.actions.push({ actor: 'enemy', enemy: 0, then: 'ally_turn_start:0' });
  return { hits, log: ctx.battle.log.slice(logStart), damage: enemyHp.map((before, i) => before - ctx.battle.enemies[i].hp) };
}

function removeEffects(ctx, actor, keys) {
  for (const gear of Object.values(ctx.game.party[actor].equip)) if (gear) {
    for (const key of keys) delete gear.affixes?.[key];
    gear.enchants = (gear.enchants ?? []).filter((effect) => !keys.includes(effect.stat));
  }
}
function removePassive(ctx, actor, id) { ctx.game.party[actor].loadout.passives = ctx.game.party[actor].loadout.passives.filter((value) => value !== id); }
const damageTotal = (result) => result.damage.reduce((sum, value) => sum + value, 0);
const incoming = (result, actor = 0) => result.hits.filter((hit) => hit.target.side === 'ally' && hit.target.i === actor && hit.source?.side === 'enemy').reduce((sum, hit) => sum + hit.damage, 0);
const inflicted = (result, actor = 0) => result.hits.filter((hit) => hit.target.side === 'enemy' && hit.source?.side === 'ally' && hit.source.i === actor).reduce((sum, hit) => sum + hit.damage, 0);

function evidence(ctx, name, values, control = undefined) {
  return { name, seed: ctx.seed, conditions: ctx.conditions, actions: ctx.actions, values, ...(control ? { control } : {}) };
}
function search(base, name, options, attempt) {
  for (let offset = 0; offset < MAX_ATTEMPTS; offset++) {
    const ctx = context(base, base.seed + offset, options);
    const result = attempt(ctx);
    if (result) return { ...result, candidatesTried: offset + 1 };
  }
  throw new Error(`${name}: ${MAX_ATTEMPTS}個の固定seedで核効果を観測できなかった`);
}
function pairedStrike(ctx, action, omit) {
  const control = copyContext(ctx);
  const rng = ctx.battle.rng;
  omit(control);
  const actual = act(ctx, 0, action);
  const without = act(control, 0, action);
  assert.ok(damageTotal(actual) > damageTotal(without), `${ctx.build.id}: 核効果を除いた対照よりダメージが増えない (${damageTotal(actual)} <= ${damageTotal(without)})`);
  return { actual, without, rng };
}
function coreAttack(base) {
  const id = base.build.actions.find((id) => base.data.skills.get(id).kind === 'attack' && !base.data.skills.get(id).effect.st);
  return id ? skillAction(id) : normalAction();
}

function statusProbe(base) {
  const statusId = base.build.mechanics.find((id) => STATUS_IDS.has(id));
  const abilityDown = statusId === 'statdown';
  const candidates = [base.build, ...base.build.allies].flatMap((definition, actor) => (definition.actions ?? []).map((id) => ({ actor, skill: base.data.skills.get(id) })))
    .filter(({ skill }) => abilityDown ? skill.effect.st?.[0] === '能力ダウン' : base.data.statusByName.get(skill.effect.st?.[0])?.id === statusId);
  if (['sleep', 'freeze'].includes(statusId)) candidates.sort((a, b) => b.actor - a.actor);
  assert.ok(candidates.length, `${base.build.id}: 対応状態の付与技能がない`);
  const source = candidates[0];
  const result = search(base, `${statusId}付与と状態別特効`, {}, (ctx) => {
    act(ctx, source.actor, skillAction(source.skill.id));
    const target = ctx.battle.enemies[0];
    const status = abilityDown ? target.debuffs.abilityDown : target.statuses[statusId];
    if (!status) return null;
    const potency = abilityDown ? target.debuffs.str[0] : status.potency;
    const comparison = pairedStrike(ctx, coreAttack(base), (control) => removeEffects(control, 0, [`VS_STATUS:${statusId}`]));
    const observations = { statusId, appliedBy: source.actor, skillId: source.skill.id, potency,
      damageWithStatusEffect: damageTotal(comparison.actual), damageWithoutStatusEffect: damageTotal(comparison.without) };
    if (['sleep', 'freeze'].includes(statusId)) {
      assert.equal(ctx.battle.enemies[0].statuses[statusId], undefined, '攻撃で睡眠・凍結が解除されていない');
      observations.clearedByStrike = true;
    }
    if (['poison', 'toxic', 'burn', 'bleed'].includes(statusId)) {
      const tick = enemyAct(ctx);
      assert.ok(tick.log.some((line) => line.includes(base.data.statusEffects.get(statusId).name) && line.includes('ダメージ')));
      observations.dotDamage = tick.damage[0];
      assert.ok(observations.dotDamage > 0);
    }
    if (statusId === 'stun') {
      const turn = enemyAct(ctx);
      assert.ok(turn.log.some((line) => line.includes('スタンで動けない')));
      observations.enemyTurnSkipped = true;
    }
    return evidence(ctx, '技能付与→対応状態への強化打撃', observations,
      { omitted: [`VS_STATUS:${statusId}`], pairedRng: comparison.rng });
  });
  return base.build.mechanics.includes('evasion_counter') ? [result, evadeProbe(base)] : [result];
}

function evadeProbe(base) {
  const monster = pickMonster(base, (m) => m.magicRate === 0);
  return search(base, '回避反撃', { monsterId: monster.id, soleSurvivor: true }, (ctx) => {
    act(ctx, 0, skillAction('thief_p3_s1'));
    const turn = enemyAct(ctx);
    if (!turn.log.some((line) => line.includes('回避反撃'))) return null;
    assert.ok(inflicted(turn) > 0);
    assert.equal(incoming(turn), 0);
    return evidence(ctx, '煙玉・回避装備から物理回避反撃', {
      evasion: battleStats(ctx.data, ctx.game, ctx.battle, 0).evasion,
      counterChanceEquipment: affixSum(ctx.game.party[0], 'EVA_COUNTER'), counterDamage: inflicted(turn), damageTaken: incoming(turn),
    });
  });
}

function offensiveProbe(base) {
  const mechanics = base.build.mechanics;
  if (mechanics.includes('self_buff')) {
    const ctx = context(base, base.seed);
    const buff = base.build.actions.find((id) => base.data.skills.get(id).kind === 'self_buff');
    act(ctx, 0, skillAction(buff));
    const result = pairedStrike(ctx, coreAttack(base), (control) => { delete control.battle.allies[0].buffs.str; });
    return [evidence(ctx, '練気から大剣の攻撃技能', { damage: damageTotal(result.actual), withoutPreparation: damageTotal(result.without) }, { omitted: ['self STR buff'], pairedRng: result.rng })];
  }
  if (mechanics.includes('first_hit') || mechanics.includes('defense_pierce') && !mechanics.includes('weapon_splash') || mechanics.includes('species_bonus')) {
    const family = mechanics.includes('first_hit') ? 'FIRST_HIT' : mechanics.includes('species_bonus')
      ? base.game.simulationFixture.core[0].effects.find((key) => key.startsWith('TYPE_BONUS:')) : 'DEF_PIERCE';
    const ctx = context(base, base.seed, mechanics.includes('species_bonus') ? { monsterId: base.dungeon.bossId, boss: true } : {});
    const result = pairedStrike(ctx, coreAttack(base), (control) => removeEffects(control, 0, [family]));
    return [evidence(ctx, '装備条件に対応した攻撃強化', { family, equipmentValue: affixSum(ctx.game.party[0], family), damage: damageTotal(result.actual), withoutEffect: damageTotal(result.without),
      enemyDefense: ctx.battle.enemies[0].def, enemyTypes: ctx.battle.enemies[0].types }, { omitted: [family], pairedRng: result.rng })];
  }
  if (mechanics.includes('dual_wield') || mechanics.includes('weapon_splash') || mechanics.includes('normal_all')) {
    return [search(base, '通常攻撃の武器連携', { count: mechanics.includes('dual_wield') ? 1 : 3 }, (ctx) => {
      mp(ctx, 0, Math.floor(maxMp(ctx.data, ctx.game.party[0]) / 2));
      const result = act(ctx, 0, normalAction());
      const targets = new Set(result.hits.filter((hit) => hit.target.side === 'enemy').map((hit) => hit.target.i));
      const poisonCount = ctx.battle.enemies.filter((enemy) => enemy.statuses.poison).length;
      if (mechanics.includes('dual_wield') && !(result.log.some((line) => line.includes('二刀目')) && result.log.some((line) => line.includes('追加攻撃')))) return null;
      if (mechanics.includes('weapon_splash') && !result.log.some((line) => line.includes('貫通！'))) return null;
      if (mechanics.includes('normal_all') && !(targets.size === 3 && poisonCount > 0)) return null;
      assert.ok(result.mpChange[0] > 0);
      return evidence(ctx, '通常攻撃の手数・範囲と正解MP回復', { targetsHit: targets.size, damage: result.damage, hitCount: result.hits.length, poisonCount, mpRecovered: result.mpChange[0],
        events: result.log.filter((line) => /二刀目|追加攻撃|貫通！|毒になった/.test(line)) });
    })];
  }
  if (mechanics.includes('elemental_weakness')) {
    const imbues = base.build.actions.map((id) => base.data.skills.get(id)).filter((skill) => skill.kind === 'imbue');
    const monster = pickMonster(base, (m) => imbues.some((skill) => m.weak.includes(skill.elements[0])));
    const imbue = imbues.find((skill) => monster.weak.includes(skill.elements[0]));
    const ctx = context(base, base.seed, { monsterId: monster.id });
    act(ctx, 0, skillAction(imbue.id));
    const result = pairedStrike(ctx, coreAttack(base), (control) => removeEffects(control, 0, ['WEAK_DMG']));
    assert.ok(result.actual.log.some((line) => line.includes('弱点！')));
    return [evidence(ctx, '魔法剣で弱点属性を選び弓技能へつなぐ', { element: imbue.elements[0], enemyWeak: monster.weak, damage: damageTotal(result.actual), withoutWeakEquipment: damageTotal(result.without) }, { omitted: ['WEAK_DMG'], pairedRng: result.rng })];
  }
  if (mechanics.includes('area_magic')) {
    return base.build.actions.map((id) => {
      const skill = base.data.skills.get(id);
      const monster = pickMonster(base, (m) => skill.elements.some((element) => m.weak.includes(element)));
      const ctx = context(base, base.seed, { monsterId: monster.id, count: 3 });
      const result = act(ctx, 0, skillAction(id));
      assert.ok(result.damage.every((damage) => damage > 0));
      assert.ok(result.log.some((line) => line.includes('弱点！')));
      assert.ok(result.mpChange[0] < 0);
      return evidence(ctx, '対応属性の全体魔法', { skillId: id, elements: skill.elements, targetsDamaged: result.damage.length, damage: result.damage, mpSpent: -result.mpChange[0] });
    });
  }
  if (mechanics.includes('normal_to_skill')) {
    const ctx = context(base, base.seed);
    mp(ctx, 0, Math.floor(maxMp(ctx.data, ctx.game.party[0]) / 2));
    const normal = act(ctx, 0, normalAction());
    assert.equal(ctx.battle.allies[0].normalSkillReady, true);
    const result = pairedStrike(ctx, coreAttack(base), (control) => removeEffects(control, 0, ['NORMAL_SKILL']));
    assert.equal(ctx.battle.allies[0].normalSkillReady, false);
    return [evidence(ctx, '正解通常攻撃から技能を強化', { normalMpRecovered: normal.mpChange[0], skillDamage: damageTotal(result.actual), withoutCycleEffect: damageTotal(result.without), readinessConsumed: true }, { omitted: ['NORMAL_SKILL'], pairedRng: result.rng })];
  }
  throw new Error(`${base.build.id}: 攻撃系の発動プローブが未定義`);
}

function defensiveProbe(base) {
  const mechanics = base.build.mechanics;
  const physical = pickMonster(base, (m) => m.magicRate === 0);
  if (mechanics.includes('cover') || mechanics.includes('counter')) {
    const counter = mechanics.includes('counter');
    return [search(base, counter ? '被弾反撃' : 'かばう', { monsterId: physical.id, soleSurvivor: counter }, (ctx) => {
      act(ctx, 0, skillAction('warrior_p2_s1'));
      act(ctx, 0, skillAction(counter ? 'knight_p3_s3' : 'knight_p1_s1'));
      const turn = enemyAct(ctx);
      if (!turn.log.some((line) => line.includes(counter ? 'の反撃！' : `${ctx.game.party[0].name}がかばった`))) return null;
      if (counter) assert.ok(inflicted(turn) > 0 && incoming(turn) > 0);
      return evidence(ctx, counter ? '挑発・反撃の構えから物理反撃' : '挑発・守りの号令とかばう', {
        taunt: ctx.battle.allies[0].buffs.taunt?.[0], partyDef: ctx.battle.partyBuffs.def?.[0] ?? 0,
        damageTakenByGuardian: incoming(turn), counterDamage: inflicted(turn), events: turn.log,
      });
    })];
  }
  if (mechanics.includes('magic_mitigation')) {
    const monster = pickMonster(base, (m) => m.magicRate >= .5);
    return [search(base, '魔法軽減と回復', { monsterId: monster.id, soleSurvivor: true }, (ctx) => {
      act(ctx, 0, skillAction('bard_p1_s1'));
      const control = copyContext(ctx); removeEffects(control, 0, ['MAGIC_CUT']);
      const turn = enemyAct(ctx), without = enemyAct(control);
      if (!turn.log.some((line) => line.includes('魔法！')) || incoming(turn) === 0) return null;
      assert.ok(incoming(turn) < incoming(without));
      const healing = act(ctx, 0, skillAction('white_mage_p1_s1'));
      assert.ok(healing.healing[0] > 0);
      return evidence(ctx, '魔法軽減装備とRES支援から回復を維持', { damageTaken: incoming(turn), withoutMagicCut: incoming(without), healedHp: healing.healing[0] }, { omitted: ['MAGIC_CUT'] });
    })];
  }
  if (mechanics.includes('poison_immunity')) {
    const monster = pickMonster(base, (m) => m.status === 'poison' && m.statusRate > 0);
    return [search(base, '毒無効', { monsterId: monster.id, soleSurvivor: true }, (ctx) => {
      const control = copyContext(ctx); removePassive(control, 0, 'apothecary_p2_s4');
      const turn = enemyAct(ctx), without = enemyAct(control);
      if (!control.battle.allies[0].statuses.poison) return null;
      assert.equal(ctx.battle.allies[0].statuses.poison, undefined);
      return evidence(ctx, '解毒の体質で敵の毒付与を阻止', { enemyStatusRate: monster.statusRate, statusResistance: battleStats(ctx.data, ctx.game, ctx.battle, 0).statusResist,
        protected: true, controlPoisoned: true, events: turn.log, controlEvents: without.log }, { omittedPassive: 'apothecary_p2_s4' });
    })];
  }
  if (mechanics.includes('endure_once')) {
    const ctx = context(base, base.seed);
    hp(ctx, 0, Math.floor(maxHp(ctx.data, ctx.game.party[0]) * .3));
    const result = pairedStrike(ctx, coreAttack(base), (control) => removePassive(control, 0, 'warrior_p3_s2'));
    const low = evidence(ctx, '低HP時に逆境で打撃を強化', { damage: damageTotal(result.actual), withoutLowHpPassive: damageTotal(result.without) }, { omittedPassive: 'warrior_p3_s2' });
    const endure = search(base, '不倒', { monsterId: physical.id, soleSurvivor: true }, (sample) => {
      hp(sample, 0, 1);
      const turn = enemyAct(sample);
      if (!sample.battle.allies[0].endured) return null;
      assert.equal(sample.game.party[0].hp, 1);
      return evidence(sample, '致死打撃を不倒で耐える', { incomingDamage: incoming(turn), remainingHp: sample.game.party[0].hp, endured: true, events: turn.log });
    });
    return [low, endure];
  }
  if (mechanics.includes('lifesteal')) {
    const ctx = context(base, base.seed);
    hp(ctx, 0, Math.floor(maxHp(ctx.data, ctx.game.party[0]) * .45));
    const control = copyContext(ctx); removeEffects(control, 0, ['LIFESTEAL']);
    const withLife = act(ctx, 0, skillAction('warrior_p3_s1'));
    const withoutLife = act(control, 0, skillAction('warrior_p3_s1'));
    assert.ok(ctx.game.party[0].hp > control.game.party[0].hp);
    assert.ok(withLife.log.some((line) => line.includes('吸収した')) && withLife.log.some((line) => line.includes('反動')));
    return [evidence(ctx, 'HP消費技の反動を吸収で一部補う', { hpChange: withLife.healing[0], withoutLifestealHpChange: withoutLife.healing[0], hpRecoveredByLifesteal: ctx.game.party[0].hp - control.game.party[0].hp }, { omitted: ['LIFESTEAL'] })];
  }
  throw new Error(`${base.build.id}: 防御系の発動プローブが未定義`);
}

function supportiveProbe(base) {
  const mechanics = base.build.mechanics;
  if (mechanics.includes('critical_mp')) {
    return [search(base, '会心MP', {}, (ctx) => {
      mp(ctx, 0, Math.floor(maxMp(ctx.data, ctx.game.party[0]) / 2));
      const control = copyContext(ctx); removeEffects(control, 0, ['CRIT_MP']);
      const actual = act(ctx, 0, coreAttack(base)), without = act(control, 0, coreAttack(base));
      if (!actual.log.some((line) => line.includes('会心の余韻'))) return null;
      const restored = ctx.game.party[0].mp - control.game.party[0].mp;
      assert.ok(restored > 0);
      return evidence(ctx, '正解した魔法会心からMPを回収', { mpChange: actual.mpChange[0], withoutCriticalMpChange: without.mpChange[0], recoveredMp: restored, damage: damageTotal(actual) }, { omitted: ['CRIT_MP'] });
    })];
  }
  if (mechanics.includes('mp_transfer')) {
    const ctx = context(base, base.seed);
    mp(ctx, 0, Math.floor(maxMp(ctx.data, ctx.game.party[0]) * .7)); mp(ctx, 2, 0);
    const before = ctx.game.party.reduce((sum, member) => sum + member.mp, 0);
    const cost = skillMp(ctx.data, ctx.game.party[0], ctx.data.skills.get('bard_p3_s1'));
    const transfer = act(ctx, 0, skillAction('bard_p3_s1', 2));
    assert.ok(transfer.mpChange[2] > 0);
    assert.equal(ctx.game.party.reduce((sum, member) => sum + member.mp, 0), before - cost);
    const recovery = act(ctx, 0, normalAction());
    assert.ok(recovery.mpChange[0] > 0);
    return [evidence(ctx, 'MPを仲間へ移譲し正解通常攻撃で再補給', { transferredMp: transfer.mpChange[2], casterMpChange: transfer.mpChange[0], partyMpCost: cost, normalMpRecovered: recovery.mpChange[0] })];
  }
  if (mechanics.includes('attack_heal')) {
    const ctx = context(base, base.seed);
    hp(ctx, 1, Math.floor(maxHp(ctx.data, ctx.game.party[1]) * .25));
    const control = copyContext(ctx); removeEffects(control, 0, ['ATTACK_HEAL']);
    const actual = act(ctx, 0, coreAttack(base)), without = act(control, 0, coreAttack(base));
    assert.ok(actual.healing[1] > 0 && actual.healing[1] > without.healing[1]);
    return [evidence(ctx, '聖弾を当てて傷ついた仲間を回復', { damage: damageTotal(actual), healedAlly: 1, healedHp: actual.healing[1], withoutAttackHealing: without.healing[1] }, { omitted: ['ATTACK_HEAL'] })];
  }
  if (mechanics.includes('overheal_shield')) {
    const monster = pickMonster(base, (m) => m.magicRate === 0);
    return [search(base, '生命障壁', { monsterId: monster.id, soleSurvivor: true }, (ctx) => {
      act(ctx, 0, skillAction('white_mage_p1_s3'));
      const created = ctx.battle.allies[0].buffs.barrier?.[0] ?? 0;
      assert.ok(created > 0);
      const turn = enemyAct(ctx);
      if (!turn.log.some((line) => line.includes('生命障壁が'))) return null;
      const remaining = ctx.battle.allies[0].buffs.barrier?.[0] ?? 0;
      assert.ok(created > remaining);
      return evidence(ctx, '全体回復の余剰で障壁を張り打撃を吸収', { createdShieldHp: created, absorbedHp: created - remaining, remainingShieldHp: remaining, hpDamageAfterShield: incoming(turn) });
    })];
  }
  if (mechanics.includes('area_cure')) {
    const ctx = context(base, base.seed);
    states(ctx, 1, ['poison', 'blind']); states(ctx, 2, ['silence', 'paralysis']);
    act(ctx, 0, skillAction('dancer_p1_s3'));
    assert.equal(Object.keys(ctx.battle.allies[1].statuses).length + Object.keys(ctx.battle.allies[2].statuses).length, 0);
    return [evidence(ctx, '持ち出した清めの舞で複数味方を治療', { alliesCured: [1, 2], statusesCured: ['poison', 'blind', 'silence', 'paralysis'] })];
  }
  if (mechanics.includes('finite_inventory')) {
    const ctx = context(base, base.seed);
    const itemId = Object.keys(ctx.game.items).find((id) => ctx.data.items.get(id).effect === 'heal_hp');
    assert.ok(itemId, '比較用の有限回復道具がない');
    hp(ctx, 1, 1);
    const control = copyContext(ctx); removePassive(control, 0, 'apothecary_p1_s2');
    const before = ctx.game.items[itemId];
    const action = { type: 'item', itemId, target: 1 };
    const actual = act(ctx, 0, action), without = act(control, 0, action);
    assert.ok(actual.healing[1] > without.healing[1]);
    assert.equal(ctx.game.items[itemId] ?? 0, before - 1);
    return [evidence(ctx, '薬の知識で有限の回復道具を強化', { itemId, healedHp: actual.healing[1], withoutKnowledge: without.healing[1], inventoryBefore: before, inventoryAfter: ctx.game.items[itemId] ?? 0 }, { omittedPassive: 'apothecary_p1_s2' })];
  }
  if (mechanics.includes('party_buff')) {
    const ctx = context(base, base.seed, { monsterId: base.dungeon.bossId, boss: true });
    const skillId = base.build.actions.find((id) => base.data.skills.get(id).kind === 'party_buff' && base.data.skills.get(id).effect.buff?.dmg);
    assert.ok(skillId, '火力支援の核心技能がない');
    const control = copyContext(ctx); removeEffects(control, 0, ['PARTY_BUFF_POWER']);
    act(ctx, 0, skillAction(skillId)); act(control, 0, skillAction(skillId));
    assert.ok(ctx.battle.partyBuffs.dmg[0] > control.battle.partyBuffs.dmg[0]);
    const values = { skillId, partyDamageBonus: ctx.battle.partyBuffs.dmg[0], withoutBuffEquipmentBonus: control.battle.partyBuffs.dmg[0],
      durationIncludingCastRound: ctx.battle.partyBuffs.dmg[1] };
    if (mechanics.includes('regeneration')) {
      hp(ctx, 1, Math.floor(maxHp(ctx.data, ctx.game.party[1]) * .5));
      const before = ctx.game.party[1].hp;
      ctx.battle.turn = null; ctx.battle.queue = [{ side: 'ally', i: 1 }];
      nextTurn(ctx.data, ctx.game, ctx.battle);
      ctx.actions.push({ actor: 1, type: 'turn_start' });
      values.regeneratedAlly = 1; values.regeneratedHp = ctx.game.party[1].hp - before;
      assert.ok(values.regeneratedHp > 0);
    } else {
      const unbuffed = copyContext(ctx); delete unbuffed.battle.partyBuffs.dmg;
      const actual = act(ctx, 2, normalAction()), without = act(unbuffed, 2, normalAction());
      values.supportedAllyDamage = damageTotal(actual); values.withoutPartyDamageBuff = damageTotal(without);
      assert.ok(values.supportedAllyDamage > values.withoutPartyDamageBuff);
    }
    return [evidence(ctx, '装備・持続パッシブ・全体支援を組み合わせる', values, { omitted: ['PARTY_BUFF_POWER'], ...(mechanics.includes('regeneration') ? {} : { damageControl: 'party dmg buff only removed' }) })];
  }
  throw new Error(`${base.build.id}: 支援系の発動プローブが未定義`);
}

export function runBuildProbes(data) {
  const results = BUILD_CATALOG.builds.map((build, index) => {
    let game; let dungeon;
    try {
      dungeon = [...data.dungeons.values()].find((candidate) => candidate.rank === build.minStar && candidate.kind === '標準');
      assert.ok(dungeon, `${build.id}: minStarの標準ダンジョンがない`);
      game = prepareParty(data, dungeon, build.id, 'prepared');
      const core = assertBuildCore(data, game);
      const base = { data, build, dungeon, game, seed: DEFAULT_SEED + index * 1000 };
      const checks = build.category === 'status' ? statusProbe(base)
        : build.category === 'weapon' ? offensiveProbe(base)
        : build.category === 'defense' ? defensiveProbe(base)
        : build.category === 'support' ? supportiveProbe(base) : null;
      assert.ok(checks?.length, `${build.id}: 分類 ${build.category} の発動プローブが未定義`);
      return { id: build.id, name: build.name, passed: true, reason: checks.map((check) => check.name).join('／'),
        minStar: build.minStar, dungeonId: dungeon.id, level: game.simulationFixture.level, stage: game.simulationFixture.stage,
        core, assembly: game.simulationFixture.assembly, checks };
    } catch (error) {
      return { id: build.id, name: build.name, passed: false, reason: error.message,
        minStar: build.minStar, dungeonId: dungeon?.id, assembly: game?.simulationFixture.assembly };
    }
  });
  return {
    schemaVersion: 1, purpose: '合法編成の核効果が実戦闘APIで発動する証拠。勝率・発動頻度・攻略速度の証明ではない。',
    assumptions: { partySize: 4, preparation: 'prepared', dungeon: '各minStarの標準ダンジョン',
      actorStatistics: '合法fixtureから変更なし。対照群だけ指定効果/パッシブ/強化を除去。',
      enemySelection: '同★以下の公開モンスターを発動条件に合わせて選ぶ。試験対象が指定ダンジョンで実際に出現するという保証ではない。',
      controlledStates: '負傷・MP不足・対象状態・行動順・主役のみ生存の場面を明記して準備。敵HPは長持ちする標的として10倍。',
      seedSelection: `各ビルドの固定seedから順に最大${MAX_ATTEMPTS}候補を試し、観測できた最初の候補を保存。成功確率の推定には使わない。` },
    sourceSha256: sourceFingerprint(), probeSha256: createHash('sha256').update(readFileSync(new URL('./build-probes.mjs', import.meta.url))).digest('hex'),
    total: results.length, passed: results.filter((result) => result.passed).length, failed: results.filter((result) => !result.passed).length, results,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const at = process.argv.indexOf('--output');
  const output = at >= 0 ? process.argv[at + 1] : null;
  if (at >= 0 && (!output || output.startsWith('--'))) throw new Error('--output の後にJSONファイルのパスが必要です。');
  const report = runBuildProbes(loadData());
  if (output) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`); }
  else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (output) process.stdout.write(`${report.passed}/${report.total} builds passed; ${report.failed} failed. ${output}\n`);
  for (const result of report.results.filter((value) => !value.passed)) process.stderr.write(`${result.id}: ${result.reason}\n`);
  if (report.failed) process.exitCode = 1;
}
