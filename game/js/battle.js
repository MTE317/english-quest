import { equipmentTier } from './equipment-scaling.js?v=equipment-rarity-1';
import { fixedBattleRewards } from './monster-rewards.js?v=public-rewards-1';
// 戦闘：行動順・通常攻撃とスキル・1行動ごとに1問・属性・状態異常・道具・逃げる。
//
// - 戦闘の状態（battle）はすべて JSON にできる形で持つ。乱数も battle.rng に入れておくので、
//   セーブ（save.js の setBattle）から読み直すと同じ結果になる（読み込み直しで結果を変えられない）。
// - 味方の HP・MP は game.party の各キャラが持つ（戦闘のあとも続くため）。戦闘だけの状態異常・強化は battle.allies が持つ。
// - 1行動の流れ：nextTurn() → 味方の番なら actionOptions() で選べる行動を出す → setPending() で行動と問題を保存
//   → 答えたら resolvePending(正解か) → また nextTurn()
//
// 式・効果の上限は data/balance.json から読む。BATTLE_FORMULAS は旧データ向けの既定値。
import { evaluate } from './expr.js?v=skill-growth-2';
import { trioItems, trioBlock, trioTargetBlock, clearTrio, finishTrioOpportunity, runTrio } from './trio-combat.js?v=jobs-31-33-1';
import { natureResources, natureBlock, natureTargetBlock, natureMpSave, natureEvasion, natureIncomingCut,
  natureAttackBonus, clearNature, finishNature, runNature } from './nature-combat.js?v=jobs-22-24-1';
import { civicItems, civicBlock, civicTargetBlock, clearCivic, finishCivicOpportunity, finishCivicEnemy,
  civicIncomingCut, civicAttackBonus, civicOnHit, runCivic } from './civic-combat.js?v=jobs-34-36-1';
import { computeStats, gearDef, weaponPower, spellPower, scytheSpellPower, maxHp, maxMp, gearEffects, affixSum, memberCanAct } from './character.js?v=unique-reroll-1';
import { actionSkills, ultimateSkill, memberMods, addMasteryKill, effectiveSkill } from './growth.js?v=unique-reroll-1';
import { encounterMonsters, learnMonsterElements, hitEffectiveness } from './monster-knowledge.js?v=monster-catalog-1';
import { masterTags, weaponSkill, songSkill, healingSkill, weaponAllowed, passiveRules, ruleNumber, matchesTag,
  masterDamageBonus, masterCritBonus, masterEvasionBonus, masterCutBonus, grantMasterEffect, masterBuff, masterMpSave,
  masterHealingBonus, masterStatusResist, masterStatusMultiplier, beginMasterAction, startMasterOpportunity, finishMasterOpportunity,
  masterCoverTarget, onMasterCover, hpPayment, spendHpPayment, ownedBlessing, advancedSkillBlock, advancedTargetBlock, payAdvancedCosts,
  masterShieldRoom, grantBlessing, absorbMasterShields, resolveBrokenBlessings,
  activeDuel, tacticalDefIgnore, prepareDuelAttack, targetedEvasion, readGuardCut, finishReadGuards,
  consumeStatusPreparation, clearDefeatedTacticalTargets, resetTacticalState, duelVictory, noteDuelHit, applyTacticalRules,
  directMagic, cloneCount, snapshotCloneDefense, cloneDefense, specialistAccuracy, specialistCrit,
  notePrimaryKill, recordSelfSupport, applySpecialistRules,
  activeMark, preparePursuitAttack, pursuitAccuracy, conditionalTargetCrit, pursuitDefIgnore, pursuitStatusBonus,
  recordPrimaryHits, preparationSnapshot, recordPreparation, applyPursuitJumpRules, isAirborne, landingAction,
  applyFirearmSeaArcaneRules, activeField, ownCurseMark } from './job-combat.js?v=jobs-19-21-1';

/** balance.json にまだ式がないもの（sim と同じ） */
export const BATTLE_FORMULAS = Object.freeze({
  enemy_def: '(6 + 3.2*Lv) * def_mul',
  enemy_res: '(6 + 3.2*Lv) * res_mul',
  // 味方の攻撃：(能力値 + 武器の攻撃力) × 倍率 × 属性 × 100/(100 + 防御) × 会心 × 乱数
  ally_damage: 'atk * em * 100 / (100 + max(0, df)) * crit * r',
  enemy_damage: 'atk * 1.62 * 100 / (100 + df) * r',
  heal: '(MAG + wpow) * m * heal_mul',
  fixed_damage: 'baseDamage * em * 100 / (100 + RES * 0.3)',
  flee: 'max(0.10, min(0.95, 0.5 + spd_diff*0.01 + luk*0.002 + lv_diff*0.02))',
  xp_per_enemy: '6 + 3.2*enemyLv',
  overlevel: 'max(0, 1 - 0.25 * max(0, (Lv - enemyLv) - 1))',
  boss_xp_mul: 5,
  ally_rand: [0.95, 1.05],
  enemy_rand: [0.9, 1.1],
  turn_rand: [0.9, 1.1],
  taunt_weight: 4,
  boss_status_mul: 0.75, // 毒・出血・弱体化をボス攻略にも使えるようにする
  boss_control_mul: 0.45,
  boss_dot_mul: 0.65,
  boss_status_immune: ['petrify', 'doom'],
  dot_tick_cap: 0.12,
  dot_power_cap: 1,
  status_rate_cap: 0.95,
  crit_cap: 0.85,
  crit_multiplier_cap: 3,
  evasion_cap: 0.6,
  status_resist_cap: 1,
  damage_cut_cap: 0.7,
  element_resist_cap: 0.8,
  minimum_damage_share: 0.08,
  debuff_cap: 0.5,
  lifesteal_rate_cap: 0.25,
  lifesteal_action_cap: 0.1,
  on_hit_mp_cap: 0.05,
  extra_hit_cap: 0.4,
  counter_affix_cap: 0.35,
  counter_power: 0.75,
  status_damage_cap: 0.6,
  first_hit_cap: 0.5,
  normal_skill_cap: 0.4,
  evade_counter_cap: 0.35,
  evade_counter_power: 0.65,
  critical_mp_cap: 0.05,
  bonus_mp_action_cap: 0.05,
  attack_heal_rate_cap: 0.2,
  attack_heal_action_cap: 0.08,
  overheal_shield_rate_cap: 0.6,
  overheal_shield_hp_cap: 0.2,
  overheal_shield_turns: 2,
  imbue_mul: 1.1,
  confused_self_hit: 0.5,
  max_rounds: 30,
});

/** 武器種ごとの特性は data/weapon_types.csv の traits_json に集約する。 */
const weaponTraits = (data, gear) => gear
  ? data.weaponTypes.get(gearDef(data, gear).kind)?.traits ?? {}
  : {};

/** スキルの st にある名前で、status_effects.csv にないもの（sim と同じ扱い） */
const ABILITY_KEYS = ['str', 'mag', 'def', 'res', 'spd'];
const OLD_DOWN_RATE = 0.2;
export const STATUS_ALIASES = Object.freeze({
  DEFダウン: { debuff: { def: 0.25 }, turns: 3 },
  能力ダウン: { debuff: Object.fromEntries(ABILITY_KEYS.map((key) => [key, OLD_DOWN_RATE])), turns: 3 },
});

const MAGIC_SKILL_KINDS = ['heal', 'heal_all', 'revive', 'cure', 'cure_all'];
const ATTACK_SKILL_KINDS = ['attack', 'fixed_damage', 'status', 'delayed', 'debuff'];

// ---------------- 乱数（battle.rng に状態を持つ） ----------------
export function rand(b) {
  // mulberry32
  b.rng = (b.rng + 0x6d2b79f5) >>> 0;
  let t = b.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (b, [lo, hi]) => lo + (hi - lo) * rand(b);
const chance = (b, p) => rand(b) < p;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const STATUS_TIERS = Object.freeze({ '★': 2, '◎': 1.5, '〇': 1, '△': 0.5, '×': 0 });

/** 全状態異常・弱体の味方側付与率。耐性100%は完全無効。 */
export function allyStatusChance(data, game, b, i, id, rate, stats = battleStats(data, game, b, i)) {
  const st = data.statusEffects.get(id);
  const group = st?.group ?? '弱体化';
  const resist = clamp(stats.statusResist + affixSum(game.party[i], `STATUS_RES:${id}`) / 100
    + bval(b.partyBuffs, 'sres:すべて')
    + bval(b.partyBuffs, 'sres:' + group) + partyPassive(data, game, b, 'party_sres')
    + masterStatusResist(data, game, b, i, id), 0, f(data, 'status_resist_cap'));
  if (st && memberMods(data, game.party[i]).nopoison && st.kind.startsWith('dot') && st.cure.includes('毒消し')) return 0;
  const shrine = mysticPassive(data, game.party[i], 'shrine_maiden_P04');
  const extra = shrine && b.allies[i].masterEffects?.kagura ? 1 - shrine.rate : 1;
  return clamp(rate * (1 - resist) * masterStatusMultiplier(data, game, b, i, id) * extra
    * (1 - clamp(bval(b.partyBuffs, 'immune'), 0, 1)), 0, 1);
}

/** 敵側の状態異常・能力弱体の共通付与率。 */
export function enemyStatusChance(data, enemy, round, id, rate, control = false) {
  let p = rate * (STATUS_TIERS[enemy.statusAffinity?.[id]] ?? 1);
  if (enemy.boss) {
    if (f(data, 'boss_status_immune').includes(id)) return 0;
    if (control) {
      if ((enemy.controlGuardUntil ?? 0) >= round && enemy.controlGuardUntil > 0) return 0;
      p *= f(data, 'boss_control_mul') * 0.5 ** (enemy.statusHits?.[id] ?? 0);
    } else p *= f(data, 'boss_status_mul');
  }
  return clamp(p, 0, f(data, 'status_rate_cap'));
}

/** 強化と弱体は別々に上限を適用してから差し引く。 */
export function statModifier(data, buff, debuff, boss = false) {
  return 1 + clamp(buff, 0, data.basicJobRules?.caps?.stat_buff ?? .5)
    - clamp(debuff, 0, boss ? .3 : data.basicJobRules?.caps?.stat_debuff ?? f(data, 'debuff_cap'));
}
const pick = (b, arr) => arr[Math.floor(rand(b) * arr.length)];
function weighted(b, arr, weightOf) {
  const total = arr.reduce((a, x) => a + weightOf(x), 0);
  let r = rand(b) * total;
  for (const x of arr) { r -= weightOf(x); if (r <= 0) return x; }
  return arr[arr.length - 1];
}

// 調整値はデータ側を優先。旧データ・旧セーブでも既定値で動く。
function f(data, key) {
  return data.balance.battle_formulas?.[key] ?? BATTLE_FORMULAS[key];
}
const ultimateRules = data => data.basicJobRules?.ultimate ?? {};
function gainUltimate(data, member, amount) {
  member.ultimateGauge = Math.max(0, Math.min(ultimateRules(data).gauge_max ?? 100, (member.ultimateGauge ?? 0) + Math.max(0, amount)));
}
const masterContext = (data, game, b) => ({ heal: (i, amount) => healAlly(data, game, b, i, amount) });

// ---------------- 敵 ----------------
/**
 * 敵を1体作る
 * @param opts { lv, dungeonId, boss, eliteId }
 */
const enemyMpCapacity = (level, boss) => Math.max(4, Math.round(6 + level * 0.6)) * (boss ? 2 : 1);

export function makeEnemy(data, monsterId, { lv, dungeonId = null, boss = false, eliteId = null } = {}) {
  const m = data.monsters.get(monsterId);
  if (!m) throw new Error(`monsters.csv に ${monsterId} がない`);
  const dg = dungeonId ? data.dungeons.get(dungeonId) : null;
  const star = dg?.rank ?? m.rank;
  const elite = eliteId ? data.elitePrefixes.find((e) => e.id === eliteId) : null;
  const em = elite?.mods ?? { muls: {}, other: {} };
  const E = data.balance.enemy;
  const muls = {
    hp_mul: m.hpMul * (em.muls.hp_mul ?? 1), atk_mul: m.atkMul * (em.muls.atk_mul ?? 1),
    def_mul: m.defMul * (em.muls.def_mul ?? 1), res_mul: m.resMul * (em.muls.res_mul ?? 1), spd_mul: m.spdMul * (em.muls.spd_mul ?? 1),
  };
  const env = {
    Lv: lv, ...muls, 'dungeon.enemy_mul': dg?.enemyMul ?? 1,
    'hp_rank_mul[★]': E.hp_rank_mul?.[star] ?? 1, 'atk_rank_mul[★]': E.atk_rank_mul?.[star] ?? 1,
  };
  const maxHpV = Math.round(evaluate(E.hp, env) * (boss ? E.boss_hp_mul * (E.hp_boss_rank_mul?.[star] ?? 1) : 1));
  const atk = evaluate(E.str_mag, env) * (boss ? E.boss_atk_mul * (E.atk_boss_rank_mul?.[star] ?? 1) : 1);
  const maxMp = enemyMpCapacity(lv, boss);
  return {
    mp: maxMp, maxMp,
    monsterId, name: elite ? `${elite.prefix}${m.name}` : m.name, icon: m.icon, lv, boss, eliteId,
    statusAffinity: m.statusAffinity, tactics: m.tactics, buffs: {},
    types: m.types, weak: m.weak, resist: m.resist, strongWeak: m.strongWeak, immune: m.immune, magicRate: m.magicRate,
    status: elite?.mods.status?.id ?? m.status, statusRate: elite?.mods.status?.rate ?? m.statusRate,
    attackElement: elite?.mods.element ?? m.attackElement,
    evasion: em.other.eva ?? 0, regen: em.other.regen ?? 0,
    hp: maxHpV, maxHp: maxHpV, str: atk, mag: atk,
    def: evaluate(f(data, 'enemy_def'), env), res: evaluate(f(data, 'enemy_res'), env), spd: evaluate(E.spd, env),
    statuses: {}, debuffs: {}, statusHits: {}, revealed: false, controlGuardUntil: 0,
  };
}

// ---------------- 戦闘を始める ----------------
/**
 * @param enemies makeEnemy で作った敵の配列
 * @param seed 乱数の種（整数）
 */
export function createBattle(data, game, { enemies, seed = Date.now(), canFlee = true, firstBattle = false } = {}) {
  encounterMonsters(game, enemies);
  const b = {
    v: 1, rng: seed >>> 0, round: 0, queue: [], turn: null, result: null, canFlee, firstBattle,
    allies: game.party.map((m) => ({
      statuses: Object.fromEntries((m.persist ?? []).filter((id) => data.statusEffects.has(id) && id !== 'stun' && id !== 'taunt').map((id) => [id, { turns: data.statusEffects.get(id).turns, n: 1, ...m.persistState?.[id],
        ...(id === 'weaken' && m.persistState?.[id]?.turns === 99 ? { turns: data.statusEffects.get(id).turns } : {}) }])),
      buffs: {}, masterEffects: {}, imbue: null, loaded: 0, weaponEnchant: null, jobOpportunities: 0, once: [], endured: false,
      firstAttackUsed: false, normalSkillReady: false, evadeCounterRound: -1, anger: 0,
    })),
    enemies, partyBuffs: {}, delayed: [], pending: null, log: [], actionClock: 0, field: null,
  };
  const curse = partyPassive(data, game, b, 'open_curse');
  if (curse) for (const enemy of b.enemies) {
    enemy.debuffs.def = [curse, f(data, 'max_rounds')];
    enemy.debuffs.res = [curse, f(data, 'max_rounds')];
  }
  log(b, `${enemies.map((e) => e.name).join('・')}が あらわれた！`);
  return b;
}

function log(b, text) {
  b.log.push(text);
  if (b.log.length > 40) b.log.splice(0, b.log.length - 40);
}

// 演出用の命中情報は処理中だけ集め、セーブには入れない。
const hitCollectors = new WeakMap();

export function collectBattleHits(b, advance) {
  const hits = [];
  hitCollectors.set(b, hits);
  try {
    advance();
    return hits;
  } finally {
    hitCollectors.delete(b);
  }
}

function recordHit(b, side, i, damage, source, effectiveness = 'normal') {
  if (damage > 0) hitCollectors.get(b)?.push({ target: { side, i }, source, damage, effectiveness });
}

// ---------------- 状態の見方 ----------------
const has = (unit, kind, data) => Object.keys(unit.statuses).some((id) => data.statusEffects.get(id)?.kind === kind);
const statusOfKind = (unit, kind, data) => Object.keys(unit.statuses).find((id) => data.statusEffects.get(id)?.kind === kind);
const bval = (buffs, k) => buffs[k]?.[0] ?? 0;

function isPetrified(b, i) {
  return Object.keys(b.allies[i].statuses).includes('petrify');
}
export function canAct(game, b, i) {
  return memberCanAct(game.party[i], isPetrified(b, i));
}
export const enemyCanAct = (enemy) => enemy.hp > 0 && !enemy.statuses?.petrify;
const livingEnemies = (b) => b.enemies.map((e, i) => i).filter((i) => enemyCanAct(b.enemies[i]));

/** 戦闘中の能力値（状態異常・強化を合わせたもの） */
function partyPassive(data, game, b, key) {
  return Math.max(0, ...game.party.map((m, index) => canAct(game, b, index) ? memberMods(data, m)[key] ?? 0 : 0));
}

export function battleStats(data, game, b, i) {
  const m = game.party[i];
  const st = { ...computeStats(data, m) };
  const a = b.allies[i];
  const down = Boolean(a.statuses.statdown);
  for (const k of ABILITY_KEYS) {
    const buff = bval(b.partyBuffs, k) + bval(a.buffs, k) + masterBuff(data, game, b, i, k)
      + (k === 'res' && b.round <= 3 ? partyPassive(data, game, b, 'start_res') : 0);
    const debuff = bval(a.buffs, 'down:' + k) + masterBuff(data, game, b, i, 'down:' + k) + (down ? OLD_DOWN_RATE : 0)
      + (k === 'str' && has(a, 'dot_strdown', data) ? OLD_DOWN_RATE : 0);
    st[k] *= statModifier(data, buff, debuff);
  }
  st.crit = Math.min(f(data, 'crit_cap'), st.crit + bval(a.buffs, 'crt') + masterBuff(data, game, b, i, 'crt') + masterCritBonus(data, game, b, i));
  st.evasion = Math.min(f(data, 'evasion_cap'), st.evasion + bval(b.partyBuffs, 'eva') + bval(a.buffs, 'eva') + masterBuff(data, game, b, i, 'eva') + masterEvasionBonus(data, game, b, i) + natureEvasion(data,game,b,i));
  return st;
}

/** 味方が受ける属性ダメージの補正。能力画面と戦闘で共用する。 */
export function allyElementMultiplier(data, game, b, index, element, magic = false) {
  const target = game.party[index];
  const resist = element
    ? bval(b.partyBuffs, `eres:${element}`) + bval(b.allies[index].buffs, `eres:${element}`) + affixSum(target, `ELEM_RES:${element}`) / 100 + partyPassive(data, game, b, 'party_eres')
    : 0;
  return 1 - Math.min(f(data, 'element_resist_cap'), resist + (magic || element ? partyPassive(data, game, b, 'party_ecut') : 0));
}

export function elementMul(data, enemy, el) {
  if (el === 'none') return 1;
  const bt = data.balance.battle;
  if (enemy.immune?.includes(el)) return 0;
  if (enemy.strongWeak?.includes(el)) return bval(enemy.buffs ?? {}, 'guard:' + el) ? 1.5 : 2;
  if (enemy.weak.includes(el)) return bval(enemy.buffs ?? {}, 'guard:' + el) ? 1 : bt.weak;
  if (enemy.resist.includes(el)) return bt.resist;
  return 1;
}

// ---------------- 行動順 ----------------
const enemyStatDebuff = (data, enemy, key) => Math.min(enemy.boss ? 0.3 : f(data, 'debuff_cap'),
  bval(enemy.debuffs, key) + Object.values(enemy.masterDebuffs ?? {}).filter(e => e.stat === key).reduce((sum, e) => sum + e.value, 0)
    + (enemy.statuses.statdown ? OLD_DOWN_RATE : 0));

function startRound(data, game, b) {
  b.round += 1;
  const units = [];
  // 宿屋の良い部屋：遠征の最初の戦闘の1ターン目だけ SPD が上がる
  const first = b.firstBattle && b.round === 1;
  game.party.forEach((m, i) => {
    if (m.hp <= 0) return;
    let spd = battleStats(data, game, b, i).spd * (1 + (first ? m.room?.spd1 ?? 0 : 0) + (b.round === 1 ? affixSum(m, 'FIRST_SPD') / 100 + ruleNumber(data, m, 'first_spd') : 0));
    if (b.round === 1 && memberMods(data, m).first) spd += 1e6; // 早撃ち：1ターン目は必ず先に動く
    units.push({ side: 'ally', i, spd });
  });
  b.enemies.forEach((e, i) => {
    if (enemyCanAct(e)) units.push({ side: 'enemy', i, spd: e.spd * statModifier(data, bval(e.buffs ?? {}, 'spd'), enemyStatDebuff(data, e, 'spd'), e.boss) });
  });
  for (const u of units) u.spd *= between(b, f(data, 'turn_rand'));
  units.sort((x, y) => y.spd - x.spd);
  b.queue = units.map(({ side, i, spd }) => ({ side, i, spd }));
}

function endRound(data, game, b) {
  // 時間差の攻撃
  for (const d of b.delayed) {
    d.turns -= 1;
    if (d.turns === 0 && enemyCanAct(b.enemies[d.target])) {
      hitEnemy(data, game, b, d.actor, d.target, d.damage, { ...d, prefix: '刻印が発動！' });
    }
  }
  b.delayed = b.delayed.filter((d) => d.turns > 0);
  for (const [i, m] of game.party.entries()) {
    if (m.hp > 0 && expireDoom(data, b, b.allies[i], m.name)) koAlly(game, b, i);
    // 石化などで行動列から外れた場合も一巡を一機会として期限を進める。
    if (b.allies[i].lastOpportunityRound !== b.round) {
      finishMasterOpportunity(data, game, b, i, masterContext(data, game, b), null, false);
      finishTrioOpportunity(b,i);
      finishCivicOpportunity(data,game,b,i);
      finishNature(data,game,b,i,natureContext(data,game,b,i));
    }
  }
  for (const enemy of b.enemies) {
    if (enemy.hp > 0 && expireDoom(data, b, enemy, enemy.name)) enemy.hp = 0;
  }
  tick(b.partyBuffs);
  for (const a of b.allies) tick(a.buffs);
}

function expireDoom(data, b, unit, name) {
  const id = statusOfKind(unit, 'doom', data);
  if (!id || --unit.statuses[id].turns > 0) return false;
  delete unit.statuses[id];
  log(b, name + 'に死の宣告が下った');
  return true;
}

function tick(buffs) {
  for (const k of Object.keys(buffs)) {
    buffs[k][1] -= 1;
    if (buffs[k][1] <= 0) delete buffs[k];
  }
}

function checkDefeat(game, b) {
  if (b.result || game.party.some((_, i) => canAct(game, b, i))) return false;
  b.result = 'lose';
  log(b, 'パーティは全滅した…');
  return true;
}

function checkEnd(game, b) {
  if (b.result || checkDefeat(game, b)) return true;
  if (!b.enemies.some(enemyCanAct)) {
    b.result = 'win';
    log(b, b.enemies.some((enemy) => enemy.hp > 0) ? '残りの敵はすべて石化した！' : '敵をすべて倒した！');
  }
  return !!b.result;
}

/**
 * 次に行動を選ぶ味方の番まで進める（敵の番・状態異常で動けない番はここで処理する）
 * @returns b.turn（味方の番 { side:'ally', i }）か null（戦闘が終わった）
 */
export function nextTurn(data, game, b) {
  if (b.turn || b.pending) return b.turn;
  for (let guard = 0; guard < 1000; guard++) {
    if (b.result) return null;
    if (b.queue.length === 0) {
      if (checkDefeat(game, b)) return null;
      if (b.round > 0) endRound(data, game, b);
      if (checkEnd(game, b)) return null;
      if (b.round >= f(data, 'max_rounds')) { b.result = 'lose'; log(b, '戦いが長引き、力尽きた…'); return null; }
      startRound(data, game, b);
      continue;
    }
    if (checkEnd(game, b)) return null;
    const u = b.queue.shift();
    if (u.side === 'enemy') {
      if (enemyCanAct(b.enemies[u.i])) enemyTurn(data, game, b, u.i);
      continue;
    }
    const m = game.party[u.i];
    const a = b.allies[u.i];
    if (m.hp <= 0) continue;
    if (allyTurnStart(data, game, b, u.i)) {
      const forced = forcedAction(data, b, a);
      if (!forced) {
        if (a.landingReady) {
          const landing=landingAction(b,u.i);
          const block=landing && skillBlock(data,game,b,u.i,a.landingReady.skill);
          if (!landing || block) {
            delete a.landingReady;
            log(b, `${m.name}の着地攻撃は中断された${block?'（'+block+'）':''}`);
          }
        }
        b.turn = u;
        return u;
      }
      a.normalSkillReady = false;
      delete a.landingReady;
      log(b, m.name + 'は' + forced.name + 'で攻撃が乱れた！');
      forcedAllyAttack(data, game, b, u.i, forced.kind === 'charm');
    }
    tickStatuses(data, b, a, m.name);
    finishMasterOpportunity(data, game, b, u.i, masterContext(data, game, b), null, false);
    finishTrioOpportunity(b,u.i);
    finishCivicOpportunity(data,game,b,u.i);
    finishNature(data,game,b,u.i,natureContext(data,game,b,u.i));
  }
  throw new Error('戦闘が進まない');
}

const START_DOT = new Set(['dot', 'dot_strdown', 'dot_rising']);

function tickStatuses(data, b, unit, name) {
  for (const [id, state] of Object.entries(unit.statuses)) {
    const st = data.statusEffects.get(id);
    if (st?.persists || st?.kind === 'petrify' || st?.kind === 'doom') continue;
    if (--state.turns > 0 && st?.kind !== 'skip_once') continue;
    delete unit.statuses[id];
    if (st) log(b, name + 'の' + st.name + 'が治った');
  }
}

function blockedAction(data, b, unit) {
  let skip = null;
  for (const id of Object.keys(unit.statuses)) {
    const st = data.statusEffects.get(id);
    if (!st) continue;
    if (['skip_until_hit', 'skip_once', 'petrify'].includes(st.kind)) skip = st;
    if (st.kind === 'skip_chance' && chance(b, st.value)) skip = st;
  }
  return skip;
}

function forcedAction(data, b, unit) {
  const charm = statusOfKind(unit, 'charm', data);
  if (charm) return data.statusEffects.get(charm);
  const confusion = data.statusEffects.get(statusOfKind(unit, 'random_target', data));
  return confusion && chance(b, confusion.value) ? confusion : null;
}

function updateMp(data, statuses, resources, maximum, regen) {
  if (!Number.isFinite(resources.mp) || !Number.isFinite(maximum)) return;
  const leak = data.statusEffects.get(statusOfKind({ statuses }, 'mp_drain', data));
  if (leak) resources.mp = Math.max(0, resources.mp - Math.max(1, Math.round(maximum * leak.value)));
  if (resources.hp > 0 && !statuses.petrify && regen > 0) {
    resources.mp = Math.min(maximum, resources.mp + Math.round(maximum * regen));
  }
}

function allyTurnStart(data, game, b, i) {
  const m = game.party[i];
  const a = b.allies[i];
  const mx = maxHp(data, m);
  const statuses = a.statuses;
  startMasterOpportunity(data, game, b, i, masterContext(data, game, b));
  for (const [id, state] of Object.entries(statuses)) {
    const st = data.statusEffects.get(id);
    if (!START_DOT.has(st?.kind)) continue;
    damageAlly(data, game, b, i, mx * st.value * (state.n ?? 1), m.name + 'は' + st.name + 'で');
    if (st.kind === 'dot_rising') state.n = (state.n ?? 1) + 1;
    if (m.hp <= 0) break;
  }
  const mods = memberMods(data, m);
  updateMp(data, statuses, m, maxMp(data, m), bval(a.buffs, 'mp_regen') + bval(b.partyBuffs, 'mp_regen'));
  if (m.hp <= 0) return false;
  const regen = bval(a.buffs, 'regen') + bval(b.partyBuffs, 'regen') + (mods.regen ?? 0);
  if (regen && !isPetrified(b, i)) healAlly(data, game, b, i, mx * regen);
  const skip = blockedAction(data, b, a);
  if (skip) log(b, m.name + 'は' + skip.name + 'で動けない');
  return !skip;
}

function allyBleed(data, game, b, i) {
  const m = game.party[i];
  const bleed = data.statusEffects.get(statusOfKind(b.allies[i], 'dot_on_action', data));
  if (bleed) damageAlly(data, game, b, i, maxHp(data, m) * bleed.value, m.name + 'は出血で');
  return m.hp > 0;
}

// コマンド確定後、問題を選ぶ前に出血を解決する。
export function prepareQuizAction(data, game, b) {
  if (!b.turn || b.pending || b.result) return false;
  if (b.turn.bleedProcessed) return true;
  const { i } = b.turn;
  if (allyBleed(data, game, b, i)) {
    b.turn.bleedProcessed = true;
    return true;
  }
  tickStatuses(data, b, b.allies[i], game.party[i].name);
  finishMasterOpportunity(data, game, b, i, masterContext(data, game, b), null, false);
  finishTrioOpportunity(b,i);
  finishCivicOpportunity(data,game,b,i);
  finishNature(data,game,b,i,natureContext(data,game,b,i));
  b.turn = null;
  return false;
}

function damageAlly(data, game, b, i, amount, prefix, source) {
  const m = game.party[i];
  let dmg = Math.max(1, Math.round(amount));
  if (source?.side === 'enemy') {
    dmg = absorbMasterShields(b, i, dmg, source, absorbed => log(b, `${m.name}の防護が${absorbed}のダメージを防いだ`));
    if (dmg <= 0) return;
    if (b.allies[i].gaugeHitClock !== (b.enemyActionClock ?? 0)) {
      gainUltimate(data, m, ultimateRules(data).gain_hit ?? 5);
      b.allies[i].gaugeHitClock = b.enemyActionClock ?? 0;
    }
  }
  const barrier = b.allies[i].buffs.barrier;
  // 生命障壁は敵の直接攻撃だけを吸収する。継続ダメージ・反動・混乱は防がない。
  if (m.hp > 0 && source?.side === 'enemy' && barrier?.[0] > 0) {
    const absorbed = Math.min(dmg, barrier[0]);
    dmg -= absorbed;
    barrier[0] -= absorbed;
    if (barrier[0] <= 0) delete b.allies[i].buffs.barrier;
    log(b, `${m.name}の生命障壁が ${absorbed}のダメージを防いだ`);
    if (dmg === 0) return;
  }
  if (m.hp > 0) recordHit(b, 'ally', i, dmg, source);
  m.hp = Math.max(0, m.hp - dmg);
  log(b, `${prefix} ${dmg}のダメージ`);
  const endure = passiveRules(data, m).find(rule => rule.endure);
  if (m.hp <= 0 && source?.side === 'enemy' && endure && !b.allies[i].endured) {
    m.hp = Math.max(1, Math.floor(maxHp(data, m) * endure.endure.hp_frac));
    b.allies[i].endured = true;
    if (endure.endure.buff) grantMasterEffect(b, i, endure.skill.id, { values: endure.endure.buff, remaining: endure.endure.turns });
    log(b, `${m.name}は不屈の意志で踏みとどまった！`); return;
  }
  if (m.hp <= 0 && memberMods(data, m).endure && !b.allies[i].endured) {
    m.hp = 1; b.allies[i].endured = true; log(b, `${m.name}は踏みとどまった！`); return;
  }
  if (m.hp <= 0) koAlly(game, b, i);
}
function koAlly(game, b, i) {
  const m = game.party[i];
  m.hp = 0;
  clearTrio(b, i);
  clearCivic(b, i);
  clearNature(b, i);
  for (const ally of b.allies) if (ally.machine?.guard?.target===i) delete ally.machine.guard;
  // 戦闘不能時に戦闘中の状態を解除する現行ルールを維持する。
  b.allies[i].statuses = {};
  m.persist = [];
  delete m.persistState;
  b.allies[i].buffs = {};
  b.allies[i].masterEffects = {};
  delete b.allies[i].familiar;
  delete b.allies[i].companion;
  delete b.allies[i].puppet;
  delete b.allies[i].puppetQuick;
  delete b.allies[i].decoy;
  delete b.allies[i].strategistOrder;
  delete b.allies[i].strategistUltimate;
  delete b.allies[i].analysisMarks;
  delete b.allies[i].insurance;
  delete b.allies[i].winCrit;
  clearMysticState(b, i);
  b.allies[i].rhythm=0;
  b.allies[i].lastDance=null;
  if(b.field?.source===i)delete b.field;
  for(const enemy of b.enemies)if(enemy.curseMarks)delete enemy.curseMarks[i];
  b.allies[i].anger = 0;
  resetTacticalState(b.allies[i]);
  delete b.allies[i].advancedAction;
  delete b.allies[i].masterCover;
  delete b.allies[i].masterCounter;
  b.allies[i].normalSkillReady = false;
  log(b, `${m.name}は倒れた`);
}
function healAlly(data, game, b, i, amount, overhealRate = 0) {
  const m = game.party[i];
  if (m.hp <= 0) return 0;
  if (has(b.allies[i], 'noheal', data)) { log(b, `${m.name}は呪いで回復できない`); return 0; }
  const before = m.hp;
  const maximum = maxHp(data, m);
  m.hp = Math.min(maximum, Math.round(m.hp + amount));
  if (overhealRate > 0) {
    const excess = Math.max(0, Math.round(amount) - (m.hp - before));
    const old = bval(b.allies[i].buffs, 'barrier');
    const shield = Math.min(Math.floor(maximum * f(data, 'overheal_shield_hp_cap')), Math.floor(excess * overhealRate),masterShieldRoom(data,game,b,i)+old);
    if (shield > 0) {
      putBuff(b.allies[i].buffs, 'barrier', shield, f(data, 'overheal_shield_turns') + 1);
      if (shield > old) log(b, `${m.name}に ${shield}の生命障壁ができた`);
    }
  }
  return m.hp - before;
}

// ---------------- 選べる行動 ----------------
/** そのキャラが使えるスキル（スキルの枠につけている通常スキル。growth.js） */
export function knownSkills(data, member) {
  return actionSkills(data, member);
}

/** 名前（「剣」「炎」「獣」）が id に当たるか */
const nameIs = (map, id, name) => map.get(id)?.name === name || id === name;

function isMagicSkill(s) {
  if (s.effect.master) return s.effect.base === 'mag' || masterTags(s).includes('magic') || songSkill(s);
  return s.effect.base === 'mag' || MAGIC_SKILL_KINDS.includes(s.kind) || ['debuff', 'delayed'].includes(s.kind);
}

/** スキルを今使えるか → 使えない理由（使えるなら ''） */
export function skillMp(data, member, skill, { battle = null, actor = null } = {}) {
  if (skill.effect?.jump_landing) return 0;
  skill = effectiveSkill(data, member, skill);
  const rate = data.balance.mp_rules?.skill_mp_per_lv ?? 0;
  const elements = skill.effect?.element ? [skill.effect.element] : skill.elements?.length ? skill.elements : ['none'];
  const neutralMagic = skill.kind === 'attack' && skill.effect?.base === 'mag'
    && elements.length > 0 && elements.every(id => id === 'none');
  const reduction = Math.min(data.basicJobRules?.caps?.mp_save ?? 0.5, affixSum(member, 'MP_SAVE') / 100
    + (neutralMagic ? memberMods(data, member).neutral_magic_mp_save ?? 0 : 0)
    + masterMpSave(data, member, skill, battle, actor) + natureMpSave(data,member,skill,battle,actor));
  if(skill.id==='druid_A07'&&actor!=null&&battle?.allies[actor]?.beast)return 0;
  const weaponSkill = skill.kind === 'attack' && (skill.effect?.base ?? 'weapon') === 'weapon';
  const weaponMul = weaponSkill ? weaponTraits(data, member.equip?.weapon).weapon_skill_mp_mul ?? 1 : 1;
  const multiplier = Math.max(1 - (data.basicJobRules?.caps?.mp_save ?? .5), (1 - reduction) * weaponMul);
  const value = Math.ceil(skill.mp * (1 + rate * (member.lv - 1)) * multiplier);
  return skill.mp > 0 && !skill.isFinal ? Math.max(data.basicJobRules?.rounding?.minimum_mp ?? 1, value) : value;
}

function skillBlock(data, game, b, i, s) {
  const m = game.party[i];
  const a = b.allies[i];
  if (!weaponAllowed(data, m, s)) return '対応する武器を装備すると使える';
  const advancedBlock = advancedSkillBlock(data, game, b, i, s);
  if (advancedBlock) return advancedBlock;
  const mysticBlock = mysticSkillBlock(b, i, s);
  if (mysticBlock) return mysticBlock;
  const trioReason = trioBlock(data, game, b, i, s);
  if (trioReason) return trioReason;
  const civicReason = civicBlock(data, game, b, i, s);
  if (civicReason) return civicReason;
  const natureReason = natureBlock(data,game,b,i,s);
  if (natureReason) return natureReason;
  if (s.isFinal && (m.ultimateGauge ?? 0) < (ultimateRules(data).gauge_max ?? 100)) return '必殺技ゲージが足りない';
  if (s.isFinal && ultimateRules(data).once_per_battle && a.once.includes(s.id)) return 'この戦闘ではもう使った';
  if (s.effect.require_weapon && (!m.equip.weapon || gearDef(data, m.equip.weapon).kind !== s.effect.require_weapon)) {
    return `${data.weaponTypes.get(s.effect.require_weapon)?.name ?? s.effect.require_weapon}を装備すると使える`;
  }
  if (m.mp < skillMp(data, m, s, { battle: b, actor: i })) return 'MP が足りない';
  if (s.effect.once && a.once.includes(s.id)) return 'この戦闘ではもう使った';
  if ((ATTACK_SKILL_KINDS.includes(s.kind) || masterTags(s).includes('attack_prepare')) && has(a, 'no_attack_skill', data)) return '恐怖で使えない';
  if (isMagicSkill(s) && has(a, 'no_magic', data)) return '沈黙で使えない';
  if (!isMagicSkill(s) && (['attack', 'fixed_damage', 'self_buff', 'imbue'].includes(s.kind) || masterTags(s).includes('physical')) && has(a, 'no_phys_skill', data)) return '封印で使えない';
  if (s.kind === 'utility' && !s.effect.master && !['thief_p2_s1', 'hunter_p2_s1'].includes(s.id)) return '効果が設定されていません';
  if (s.effect.imbue_only && !a.imbue) return '剣気をまとっていない';
  return '';
}

const BATTLE_ITEM_EFFECTS = ['heal_hp', 'heal_hp_pct', 'heal_hp_all', 'heal_hp_all_pct', 'heal_mp', 'heal_mp_pct', 'revive_pct', 'cure_status',
  'buff_str', 'buff_mag', 'buff_def', 'buff_res', 'buff_spd', 'buff_crt', 'resist_elem_all', 'resist_status_all'];

/** 逃げられる確率。装備の逃走補正は逃げる行動を選ぶ本人の分だけを足す。 */
export function fleeRate(data, game, b, actor = b.turn?.side === 'ally' ? b.turn.i : null) {
  const al = game.party.map((m, i) => i).filter((i) => canAct(game, b, i));
  const ae = b.enemies.filter(enemyCanAct);
  if (!b.canFlee || al.some((i) => has(b.allies[i], 'noevade_noflee', data))) return 0;
  const avg = (arr) => arr.reduce((x, y) => x + y, 0) / Math.max(1, arr.length);
  const sts = al.map((i) => battleStats(data, game, b, i));
  const base = evaluate(f(data, 'flee'), {
    spd_diff: avg(sts.map((s) => s.spd)) - avg(ae.map((e) => e.spd)),
    luk: avg(sts.map((s) => s.luk)),
    lv_diff: avg(al.map((i) => game.party[i].lv)) - avg(ae.map((e) => e.lv)),
  });
  const bonus = al.includes(actor) ? affixSum(game.party[actor], 'FLEE') / 100 + ruleNumber(data, game.party[actor], 'flee') : 0;
  return Math.max(0.1, Math.min(0.95, base + bonus));
}

/** 味方 i が選べる行動 */
export function actionOptions(data, game, b, i) {
  const entry = s => {
    const boost = !s.isFinal && s.kind === 'attack' && s.effect.base === 'mag'
      ? passiveRules(data, game.party[i]).find(rule => rule.mp_boost)?.mp_boost : null;
    const targetReasons = s.effect.rules?.move_mark ? Object.fromEntries(b.enemies.map((_,index)=>[index,activeMark(game,b,i)?.target===index?'現在の標的と別の敵を選ぶ':''])) : s.kind === 'utility' && s.effect.rules?.steal ? Object.fromEntries(b.enemies.map((enemy, index) => {
      const id = data.monsters.get(enemy.monsterId)?.materialCommon;
      return [index, enemy.stolen ? 'すでに盗んでいる' : id && data.materials.has(id) ? '' : '盗める通常物資を持っていない'];
    })) : {};
    const noTarget = Object.keys(targetReasons).length && b.enemies.every((enemy, index) => enemy.hp <= 0 || targetReasons[index]);
    return { skill: s, reason: skillBlock(data, game, b, i, s) || (noTarget ? '盗める通常物資を持つ敵がいない' : ''), targetReasons, boost: boost ? { mp: boost.mp, bonus: boost.damage } : null,
      hpCost: hpPayment(data,game,b,i,s), optionalBlessing: Boolean(s.effect.rules?.optional_blessing && ownedBlessing(b,i)),
      optionalClone: Boolean(s.effect.rules?.optional_clone && cloneCount(b.allies[i])),
      itemChoices: trioItems(data, game, s),
      civicItems: civicItems(data, game, s),
      natureChoices: natureResources(b,i,s),
      elements: s.effect.rules?.choose_element ?? s.effect.rules?.choose_mode ?? s.effect.choose_element ?? [] };
  };
  const skills = knownSkills(data, game.party[i]).map(entry);
  const ultimate = ultimateSkill(data, game.party[i]);
  const items = Object.entries(game.items ?? {}).filter(([, n]) => n > 0).map(([id, count]) => {
    const item = data.items.get(id);
    const ok = item && BATTLE_ITEM_EFFECTS.includes(item.effect);
    return { item, count, reason: ok ? '' : '戦闘では使えない' };
  }).filter((x) => x.item);
  const flee = fleeRate(data, game, b, i);
  return { landing: landingAction(b,i), skills, ultimate: ultimate ? { ...entry(ultimate), gauge: game.party[i].ultimateGauge ?? 0, max: ultimateRules(data).gauge_max ?? 100 } : null,
    items, flee: { rate: flee, reason: b.allies[i].beast ? '獣化中は使えない' : flee > 0 ? '' : '逃げられない' } };
}

/** 行動の対象の選び方：'enemy'（敵1体）/ 'enemies'（敵全体）/ 'ally'（味方1人）/ 'ko_ally'（倒れた味方）/ 'allies' / 'self' / 'none' */
export function targetKind(data, action, member = null) {
  if (action.type === 'attack') return 'enemy';
  if (action.type === 'landing') return 'enemy';
  if (action.type === 'flee') return 'none';
  if (action.type === 'item') {
    const it = data.items.get(action.itemId);
    if (it.effect === 'revive_pct') return 'ko_ally';
    return it.target === 'ally' ? 'ally' : 'allies';
  }
  const s = member ? effectiveSkill(data, member, data.skills.get(action.skillId)) : data.skills.get(action.skillId);
  const tgt = s.effect.tgt;
  if (s.effect.rules?.trio) return s.effect.rules.trio.targetKind;
  if (s.effect.rules?.civic) return s.effect.rules.civic.targetKind;
  if (s.id==='summoner_U01'&&action.element!=='fire') return 'self';
  if (s.effect.rules?.nature) return s.effect.rules.nature_target;
  if (tgt === 'selected_enemy') return 'enemy';
  if (tgt === 'self') return 'self';
  if (s.effect.rules?.revive && s.kind === 'heal_all') return 'ko_ally';
  switch (s.kind) {
    case 'jump': return 'enemy';
    case 'attack': return tgt === 'all' || tgt === 'random' ? 'enemies' : 'enemy';
    case 'utility': case 'status': case 'debuff': return tgt === 'all' ? 'enemies' : 'enemy';
    case 'fixed_damage': case 'delayed': return 'enemies';
    case 'heal': case 'cure': case 'ally_buff': case 'mp_give': return tgt === 'all' ? 'allies' : 'ally';
    case 'revive': return 'ko_ally';
    case 'self_buff': case 'imbue': return 'self';
    default: return 'allies';
  }
}

/**
 * 行動と問題を保存する（答える前に閉じても、同じ問題・同じ行動で再開する）
 * @param action { type: 'attack'|'skill'|'item'|'flee', skillId?, itemId?, target?: number }
 * @param question quiz.js の makeQuestion の結果（と出題の理由）
 */
export function setPending(b, action, question) {
  if (!b.turn) throw new Error('味方の番ではない');
  b.pending = { actor: b.turn.i, action, question };
}

/**
 * 答えの結果で行動する（正解なら全力、不正解なら wrong_answer_mult の範囲で弱くなる）
 * @returns { cm } 効果の倍率
 */
export function resolvePending(data, game, b, correct) {
  const p = b.pending;
  if (!p) throw new Error('答える問題がない');
  const i = p.actor;
  const m = game.party[i];
  const a = b.allies[i];
  // 通常攻撃の準備は次の選択行動だけに持ち越す。失敗・道具・回復で温存しない。
  const normalSkillReady = a.normalSkillReady ?? false;
  a.normalSkillReady = false;
  const cm = correct ? 1 : between(b, data.balance.battle.wrong_answer_mult);
  const bleedProcessed = b.turn?.bleedProcessed;
  b.pending = null;
  b.turn = null;
  if (!correct) log(b, `${m.name}の力が弱まった…（×${cm.toFixed(2)}）`);

  // 旧セーブや問題画面を経由しない呼び出しでは、ここで一度だけ出血を処理する。
  if (!bleedProcessed && !allyBleed(data, game, b, i)) {
    tickStatuses(data, b, a, m.name);
    finishMasterOpportunity(data, game, b, i, masterContext(data, game, b), null, false);
    finishTrioOpportunity(b,i);
    finishCivicOpportunity(data,game,b,i);
    finishNature(data,game,b,i,natureContext(data,game,b,i));
    if (b.queue.length) checkEnd(game, b);
    else checkDefeat(game, b);
    return { cm };
  }

  const reserved=a.landingReady;
  const act = reserved ? landingAction(b,i) ?? p.action : p.action;
  const chosenSkill = reserved && act.type==='landing' ? reserved.skill
    : act.type === 'skill' ? effectiveSkill(data, m, data.skills.get(act.skillId)) : null;
  beginMasterAction(data, game, b, i, chosenSkill);
  if (act.type === 'attack') {
    const beast=a.beast?{id:'druid_beast_attack',kind:'attack',elements:['blunt'],effect:{master:true,base:'phys',element:'blunt',m:.75,rules:{nature_beast:true,nature_normal_attack:true}}}:null;
    doAttack(data, game, b, i, beast, act.target, cm);
    if (correct) {
      const max = maxMp(data, m);
      const recovery = Math.min(max - m.mp, Math.ceil(max * (data.balance.mp_rules?.normal_attack_regen_rate ?? 0)));
      if (recovery > 0) {
        m.mp += recovery;
        log(b, `${m.name}のMPが ${recovery} 回復`);
      }
    }
  }
  else if (act.type === 'skill') doSkill(data, game, b, i, data.skills.get(act.skillId), act.target, cm, normalSkillReady, act);
  else if (act.type === 'landing' && reserved) {
    delete a.landingReady;
    a.advancedAction.damageBonus+=reserved.boost;
    doSkill(data,game,b,i,reserved.skill,act.target,cm*reserved.cm,normalSkillReady,act);
  }
  else if (act.type === 'item') { a.advancedAction.executed = true; doItem(data, game, b, i, data.items.get(act.itemId), act.target, cm); }
  else if (act.type === 'flee'&&!a.beast) { a.advancedAction.executed = true; doFlee(data, game, b, correct, i); }
  const performed = a.advancedAction?.executed;
  if (performed && chosenSkill && mysticSingleElement(chosenSkill) && !chosenSkill.isFinal) {
    const element = act.element ?? chosenSkill.effect.element;
    if (['light','dark'].includes(element) && a.mysticNext?.grantedClock !== b.actionClock) delete a.mysticNext;
    if (element === 'dark' && a.mysticDark?.grantedClock !== b.actionClock) delete a.mysticDark;
  }
  tickStatuses(data, b, a, m.name);
  finishMasterOpportunity(data, game, b, i, masterContext(data, game, b), chosenSkill ?? (act.type === 'attack' ? null : { kind: 'utility', effect: {} }));
  finishTrioOpportunity(b,i);
  finishCivicOpportunity(data,game,b,i);
  finishNature(data,game,b,i,natureContext(data,game,b,i));
  if (performed && correct && act.type !== 'flee' && !chosenSkill?.isFinal) gainUltimate(data, m, ultimateRules(data).gain_correct ?? 20);
  if (b.queue.length) checkEnd(game, b);
  else checkDefeat(game, b);
  return { cm };
}

function forcedAllyAttack(data, game, b, i, charmed) {
  const allyTargets = game.party.flatMap((m, j) => canAct(game, b, j) && (!charmed || j !== i) ? [{ side: 'ally', i: j }] : []);
  const targets = charmed ? allyTargets : [...allyTargets, ...livingEnemies(b).map((j) => ({ side: 'enemy', i: j }))];
  if (!targets.length || !allyBleed(data, game, b, i)) return;
  const member = game.party[i];
  const skills = charmed ? knownSkills(data, member).filter((skill) => skill.kind === 'attack' && !skillBlock(data, game, b, i, skill)) : [];
  const skill = pick(b, [null, ...skills]);
  if (skill) {
    member.mp -= skillMp(data, member, skill, { battle:b, actor:i });
    const hp=spendHpPayment(data,game,b,i,skill);
    if (hp>0) log(b, `${member.name}はHPを${hp}支払った`);
    if (skill.effect.once) b.allies[i].once.push(skill.id);
    log(b, member.name + 'は' + skill.name + 'を使った');
  }
  const target = pick(b, targets);
  if (target.side === 'enemy') {
    doAttack(data, game, b, i, null, target.i, 1);
    return;
  }
  const st = battleStats(data, game, b, i);
  const magic = skill?.effect.base === 'mag';
  const power = magic ? st.mag + spellPower(data, member) : st.str + st.attack;
  const victims = skill?.effect.tgt === 'all' ? allyTargets.sort((a,c)=>Number(c===target)-Number(a===target)).slice(0,skill.effect.target_limit??8) : [target];
  for (const victim of victims) {
    const defense = battleStats(data, game, b, victim.i);
    const damage = power * (skill?.effect.m ?? 1) * f(data, 'confused_self_hit') * 100 / (100 + (magic ? defense.res : defense.def));
    damageAlly(data, game, b, victim.i, damage, member.name + 'は' + game.party[victim.i].name + 'を攻撃！', { side: 'ally', i });
  }
}

// ---------------- 攻撃 ----------------
function attackTargets(b, kind, target) {
  if (kind === 'enemies') return livingEnemies(b);
  const alive = livingEnemies(b);
  return [alive.includes(target) ? target : alive[0]];
}

/**
 * 1回の攻撃のダメージ（会心・命中を含む）
 * @param skill null なら通常攻撃
 */
function attackDamage(data, game, b, i, e, skill, cm, { offhand = false, actionBonus = 0 } = {}) {
  const m = game.party[i];
  const a = b.allies[i];
  const st = battleStats(data, game, b, i);
  const enemy = b.enemies[e];
  const weapon = offhand ? m.equip.offhand : m.equip.weapon;
  const wdef = weapon ? gearDef(data, weapon) : null;
  const wt = wdef ? data.weaponTypes.get(wdef.kind) : null;
  const traits = wt?.traits ?? {};
  const base = skill?.effect.base ?? 'weapon';
  const mods = memberMods(data, m);
  let kind; let els; let hits;
  let imb = 1;
  if (base === 'weapon') {
    kind = wt?.attackStat === 'mag' ? 'mag' : 'phys';
    els = wt?.elements ?? ['blunt'];
    if (wdef?.addedElement) els = [...new Set([...els, wdef.addedElement])];
    if (weapon) els = [...new Set([...els, ...Object.keys(gearEffects(weapon)).filter((key) => key.startsWith('ELEMENT:')).map((key) => key.slice(8))])];
    hits = skill?.effect.master ? [1] : wt?.id === 'fist' && mods.fist ? [mods.fist, mods.fist] : wt?.hits?.length ? wt.hits : [1];
    if (a.imbue && kind === 'phys') { els = [a.imbue]; imb = f(data, 'imbue_mul') + (mods.imbue ?? 0); }
  } else {
    kind = base === 'phys' ? 'phys' : 'mag';
    els = skill.elements ?? [];
    hits = [1];
  }
  // データに記された固定属性・精霊の最適属性を実際の攻撃に反映する。
  if (skill?.effect.element === 'best') {
    const choices = skill.elements?.length ? skill.elements : ['wind', 'earth', 'water'];
    els = [choices.reduce((best, el) => elementMul(data, enemy, el) > elementMul(data, enemy, best) ? el : best, choices[0])];
  } else if (skill?.effect.element) els = [skill.effect.element];
  if (a.weaponEnchant?.remaining>0 && kind==='phys' && (!skill || skill.effect?.rules?.adaptive_enchant))
    els=[a.weaponEnchant.element];
  if(skill?.effect.rules?.secondary_element) els=[...new Set([...els,skill.effect.rules.secondary_element])];
  if (!els.length && kind === 'mag') els = ['none'];
  if (skill?.effect.hits) hits = skill.effect.hits;
  const mult = ((skill?.effect.m ?? 1) + (skill?.effect.rules?.rhythm_power ?? 0)*(a.advancedAction?.rhythmSpent ?? 0))
    * (skill && base === 'weapon' ? traits.weapon_skill_mul ?? 1 : 1);
  const qigong = masterTags(skill).includes('qigong') || skill?.effect.rules?.no_weapon_power;
  const statVal = skill?.effect.rules?.nature_snapshot?.mag ?? (skill?.effect.rules?.nature_beast ? st.mag : (kind === 'phys'
    ? (skill?.effect.beststat ? Math.max(st.str, st.mag) : st.str) * (qigong ? 1 : traits.str_mul ?? 1) + (qigong ? 0 : st.mag * (mods.mag2phys ?? 0))
      + st.mag*(skill?.effect.rules?.hybrid_mag_rate??0)
    : st.mag * (skill?.effect.master && base !== 'weapon' ? 1 : traits.mag_mul ?? 1) * (1 + bval(a.buffs, 'magb')))
    + (skill?.effect.rules?.companion_attack ? Math.floor(maxHp(data,m)*.08) : 0));
  const wpow = skill?.effect.rules?.nature_snapshot?.spell ?? (qigong ? 0 : skill && (base === 'mag'||skill.effect.rules?.nature_beast) ? spellPower(data, m) + (skill.effect.rules?.scythe_spell?scytheSpellPower(data,m):0)
    : weaponPower(data, m, weapon) + st.mag * (mods.mag_to_atk ?? 0));
  const bard = !data.basicJobRules && game.party.find((x, j) => x.job === 'bard' && canAct(game, b, j));
  const song = bard ? data.balance.battle.bard_song + (weaponTraits(data, bard.equip.weapon).song_bonus ?? 0) : 0;
  // STR/MAG の強化は battleStats に含む。ここで二重に掛けない。
  const dm = 1 + Math.min(data.balance.battle.buff_cap, song + bval(b.partyBuffs, 'dmg'));
  // パッシブ：武器・属性・種別へのダメージ、ピンチのときのダメージ
  let pm = 1;
  const masterBonus=masterDamageBonus(data,game,b,i,e,skill,els);
  pm += masterBonus;
  pm += mysticDamageBonus(data, game, b, i, skill, els);
  pm += civicAttackBonus(data,game,b,i,e,skill);
  pm += natureAttackBonus(data,game,b,i,skill,els);
  if (els.some(el => elementMul(data, enemy, el) > 1)) pm += skill?.effect.rules?.weak_damage ?? 0;
  for (const [names, v] of mods.wdmg ?? []) if (base === 'weapon' && wt && names.some((n) => nameIs(data.weaponTypes, wt.id, n))) pm += v;
  for (const [name, v] of mods.edmg ?? []) if (els.some((el) => nameIs(data.elements, el, name))) pm += v;
  // 複合属性でも装備による属性攻撃強化は最大の1系統だけ使う。
  pm += Math.max(0, ...els.map((el) => affixSum(m, `ELEM_DMG:${el}`) / 100));
  for (const [names, v] of mods.tdmg ?? []) if (enemy.types.some((t) => names.some((n) => nameIs(data.monsterTypes, t, n)))) pm += v;
  for (const type of enemy.types) pm += ((weapon ? gearEffects(weapon)['特効:' + type] ?? 0 : 0) + affixSum(m, 'TYPE_BONUS:' + type)) / 100;
  if (wt?.id === 'gun' && base === 'phys' && skill) pm += mods.bullet ?? 0;
  if (els.some((id) => ['wind', 'earth', 'water'].includes(id) && enemy.weak.includes(id))) pm += mods.weak_wew ?? 0;
  if (Object.keys(enemy.debuffs).length || Object.keys(enemy.statuses).length) pm += mods.vs_debuffed ?? 0;
  if (Object.keys(enemy.debuffs).length || Object.keys(enemy.statuses).length) {
    pm += affixSum(m, 'VS_DEBUFFED') / 100;
  }
  // 睡眠・凍結は hitEnemy で解ける前に判定する。異常の種類を重ねても上限は共有。
  const legacyDownBonus = enemy.debuffs.abilityDown ? Math.max(0, affixSum(m, 'VS_STATUS:statdown') / 100) : 0;
  let statusDamage = Object.keys(enemy.statuses).reduce((sum, id) => sum + Math.max(0, affixSum(m, `VS_STATUS:${id}`) / 100), legacyDownBonus);
  for (const [ids, rate, weaponType, element] of mods.status_count_damage ?? []) {
    if (weaponType && (base !== 'weapon' || wt?.id !== weaponType)) continue;
    if (element && !els.includes(element)) continue;
    statusDamage += [...new Set(ids)].filter(id => enemy.statuses[id]).length * rate;
  }
  pm += Math.min(f(data, 'status_damage_cap'), statusDamage) + actionBonus;
  if (base === 'weapon' && traits.vs_status && enemy.statuses[traits.vs_status.id]) pm += (traits.vs_status.mul ?? 1) - 1;
  if (!skill) pm += mods.normal_damage ?? 0;
  if (kind === 'mag') pm += mods.magic_damage ?? 0;
  if (mods.lowhp_dmg && m.hp < maxHp(data, m) * 0.5) pm += mods.lowhp_dmg;
  const attackBase = (statVal + (base === 'weapon' || kind === 'mag' || skill?.effect.rules?.nature_beast ? wpow : wpow * 0.8)) * mult * cm * dm * imb;
  const pierce = kind === 'phys'
    ? Math.min(data.basicJobRules?.caps?.def_ignore ?? .9, (qigong ? 0 : wt?.defPierce ?? 0) + (skill?.effect.defign ?? 0)
      + tacticalDefIgnore(b, i, skill) + pursuitDefIgnore(b,i,e,skill) + affixSum(m, 'DEF_PIERCE') / 100
      + (base==='weapon' && wt?.id==='gun' ? ruleNumber(data,m,'gun_def_ignore') : 0)) : 0;
  const defense = kind === 'phys' ? enemy.def * (1 - pierce) : enemy.res;
  const df = defense * statModifier(data, bval(enemy.buffs ?? {}, kind === 'phys' ? 'def' : 'res'),
    enemyStatDebuff(data, enemy, kind === 'phys' ? 'def' : 'res'), enemy.boss);
  let em = els.length ? Math.max(...els.map((el) => elementMul(data, enemy, el))) : 1;
  if(directMagic(skill) && em>1 && els.some(el=>['wind','earth','water'].includes(el)))
    pm+=ruleNumber(data,m,'field_weak_magic');
  if (skill?.effect.noresist && em > 0) em = Math.max(1, em);
  if (em > 1) em *= skill?.effect.wb ?? 1;
  if (em > 1 && mods.weak_all) em *= 1 + mods.weak_all;
  if (base === 'weapon' && em > 1) em *= traits.weak_damage_mul ?? 1;
  if (em > 1) em *= 1 + Math.min(0.6, affixSum(m, 'WEAK_DMG') / 100);
  const critBase = st.crit + (skill?.effect.crt ?? skill?.effect.crit ?? 0);
  const blind = statusOfKind(a, 'blind', data);
  const accuracy = specialistAccuracy(b,i,skill)+pursuitAccuracy(data,game,b,i,e,skill);
  const analyzed=masterTags(skill).some(tag=>['reaction','trap'].includes(tag))?0:a.analysisMarks?.[e]?.rate??0;
  let total = 0;
  let crits = 0;
  let misses = 0;
  for (const h of hits) {
    const hpBefore=Math.max(0,enemy.hp-Math.round(total));
    if (hpBefore<=0) break;
    const hit = accuracy+analyzed > 0
      ? chance(b, Math.min(1, (1-(kind==='phys'&&blind?data.statusEffects.get(blind).value*(traits.blind_miss_mul??1):0))
        *(1-(enemy.statuses.bind?0:enemy.evasion??0))+accuracy+analyzed))
      : !(kind === 'phys' && blind && chance(b, data.statusEffects.get(blind).value * (traits.blind_miss_mul ?? 1)))
        && !(!enemy.statuses.bind && enemy.evasion > 0 && chance(b, enemy.evasion));
    if (!hit) { misses += 1; continue; }
    const crit = chance(b, Math.min(f(data,'crit_cap'),critBase+specialistCrit(b,i,e,skill,hpBefore)+conditionalTargetCrit(data,game,b,i,e,skill)
      +(a.winCrit && (!skill||skill.job==='gambler'&&(!skill.effect.rules?.gamble||!a.advancedAction?.gambleRisk)) ? a.winCrit.rate : 0)));
    if (crit) crits += 1;
    total += h * evaluate(f(data, 'ally_damage'), {
      atk:attackBase*(pm-masterBonus+masterDamageBonus(data,game,b,i,e,skill,els,hpBefore)), em, df, crit: crit ? Math.min(f(data, 'crit_multiplier_cap'), data.balance.battle.crit_mult + (mods.crit_dmg ?? 0)
        + (mods.crit_damage ?? 0) + affixSum(m, 'CRIT_DMG') / 100) : 1, r: between(b, f(data, 'ally_rand')),
    });
  }
  if (a.advancedAction && !masterTags(skill).some(tag => ['reaction','trap'].includes(tag))) a.advancedAction.elements = [...new Set([...(a.advancedAction.elements ?? []), ...els])];
  return { damage: Math.round(total), crits, misses, landed: misses < hits.length, em, elements: els };
}

function hitEnemy(data, game, b, i, e, damage, { prefix = '', em = 1, elements = [], landed = damage > 0, primaryAction = false, allowKillEffects = true } = {}) {
  const enemy = b.enemies[e];
  if (!landed || enemy.hp <= 0) return;
  const wasAlive = enemy.hp > 0;
  if (damage === 0) {
    learnMonsterElements(game, enemy, elements);
    if (em === 0) log(b, enemy.name + 'には効かなかった');
    return;
  }
  if (wasAlive) {
    learnMonsterElements(game, enemy, elements);
    if (em > 1 && enemy.tactics === 'ward') {
      enemy.lastWeakElement = elements.find((id) => elementMul(data, enemy, id) > 1) ?? enemy.lastWeakElement;
    }
    recordHit(b, 'enemy', e, damage, i == null ? undefined : { side: 'ally', i }, hitEffectiveness(em));
  }
  enemy.hp = Math.max(0, enemy.hp - damage);
  if(i!=null&&game.party[i])civicOnHit(data,game,b,i,e,primaryAction);
  if (wasAlive && enemy.hp <= 0 && game.party[i]) {
    const m = game.party[i];
    notePrimaryKill(b,i,e,primaryAction);
    if (allowKillEffects) {
      const recovery = duelVictory(data, game, b, i, e, primaryAction);
      if (recovery) healAlly(data, game, b, i, recovery);
      addMasteryKill(data, m); // 武器の熟練度
      const km = memberMods(data, m).kill_mp;
      if (km) m.mp = Math.min(maxMp(data, m), m.mp + km);
      spreadPoison(data, game, b, i, enemy);
    }
    clearDefeatedTacticalTargets(b);
  }
  // 睡眠・凍結は攻撃を受けると覚める
  for (const id of Object.keys(enemy.statuses)) if (data.statusEffects.get(id)?.kind === 'skip_until_hit') delete enemy.statuses[id];
  log(b, `${prefix}${enemy.name}に ${damage}のダメージ`);
  if (enemy.hp <= 0) log(b, `${enemy.name}を倒した！`);
}

function describeHit({ crits, em, misses }) {
  const effectiveness = hitEffectiveness(em);
  return [crits ? '会心！' : '', effectiveness === 'weak' ? '弱点！' : effectiveness === 'resist' ? '効きにくい…' : '', misses ? 'はずれた…' : ''].join('');
}

function doAttack(data, game, b, i, skill, target, cm, { normalSkillReady = false, spentMp = 0, selectedTargets = null, secondaryTarget = null } = {}) {
  const m = game.party[i];
  const a = b.allies[i];
  if (a.advancedAction) a.advancedAction.executed = true;
  const kind = skill ? (skill.effect.rules?.nature_normal_attack||skill.effect.jump_landing?'enemy':targetKind(data, { type: 'skill', skillId: skill.id }, m)) : 'enemy';
  const mainDef = m.equip.weapon ? gearDef(data, m.equip.weapon) : null;
  const wt = mainDef ? data.weaponTypes.get(mainDef.kind) : null;
  const weaponAll = wt?.traits.normal_all_mul != null
    ? memberMods(data, m).whip ?? wt.traits.normal_all_mul : 0;
  const allMul = !skill ? Math.max(weaponAll, affixSum(m, 'NORMAL_ALL') / 100) || null : null;
  if (!skill) log(b, `${m.name}の攻撃！`);
  // 初撃は命中や正誤にかかわらず一行動で消費。全体・連打・二刀目には同じ倍率を渡す。
  const firstBonus = a.firstAttackUsed ? 0 : Math.min(f(data, 'first_hit_cap'), Math.max(0, affixSum(m, 'FIRST_HIT') / 100));
  const cycleBonus = skill && normalSkillReady ? Math.min(f(data, 'normal_skill_cap'), Math.max(0, affixSum(m, 'NORMAL_SKILL') / 100)) : 0;
  const actionBonus = firstBonus + cycleBonus;
  a.firstAttackUsed = true;
  if (firstBonus > 0) log(b, `${m.name}は初撃に力を込めた！`);
  if (cycleBonus > 0) log(b, `${m.name}は通常攻撃から技能へつないだ！`);
  let onHitMpGranted = false;
  let criticalMpGranted = false;
  const thunderCritMp = memberMods(data, m).thunder_crit_mp ?? 0;
  const gearCritMp = affixSum(m, 'CRIT_MP') / 100;
  let extraHitGranted = false;
  let absorbedHp = 0;
  let actualDamage = 0;
  let weakMpGranted = false;
  const primaryTarget=b.enemies[target]?.hp>0?target:livingEnemies(b)[0], primaryHits=[];
  // 正解通常の基礎5%回復とは別の枠。会心と命中の追加回復はこの枠を共有する。
  let mpRoom = skill ? spentMp : Math.ceil(maxMp(data, m) * f(data, 'bonus_mp_action_cap'));
  const grantMp = (requested, prefix) => {
    const recovery = Math.max(0, Math.min(mpRoom, maxMp(data, m) - m.mp, requested));
    if (!recovery) return;
    m.mp += recovery;
    mpRoom -= recovery;
    log(b, `${prefix}${m.name}のMPが${recovery}回復`);
  };
  const weaponHitBonus = (dealt, hit, primary = false) => {
    if (dealt <= 0) return;
    actualDamage += dealt;
    const weakMp = ruleNumber(data, m, 'normal_weak_mp');
    if (!skill && primary && cm === 1 && hit.em > 1 && weakMp > 0 && !weakMpGranted) {
      grantMp(Math.ceil(maxMp(data, m) * weakMp), '弱点を捉えた！');
      weakMpGranted = true;
    }
    // 吸血は武器を使った攻撃（通常／武器スキル）のみ。オーバーキル分は吸収しない。
    if (!skill || (skill.effect.base ?? 'weapon') === 'weapon') {
      const instant = skill?.effect.rules?.instant_lifesteal;
      const ongoing = Object.values(a.masterEffects ?? {}).reduce((sum,effect)=>sum+(effect.lifesteal??0),0);
      const rate = instant?.rate ?? Math.min(f(data, 'lifesteal_rate_cap'), affixSum(m, 'LIFESTEAL') / 100)
        + (skill?.effect.rules?.lifesteal ?? 0) + ongoing;
      if (rate > 0) {
        const cap = instant?.cap ?? Math.max(f(data,'lifesteal_action_cap'),ruleNumber(data,m,'lifesteal_cap'));
        const room = Math.max(0, Math.floor(maxHp(data, m) * cap) - absorbedHp);
        const healed = healAlly(data, game, b, i, Math.min(room, dealt * rate));
        absorbedHp += healed;
        if (healed) log(b, `${m.name}はHPを${healed}吸収した`);
      }
    }
    // MP回復は通常攻撃1行動につき1回だけ。複数体攻撃で無限に増えない。
    if (!skill && cm === 1 && !onHitMpGranted && affixSum(m, 'MP_ON_HIT') > 0) {
      grantMp(Math.ceil(maxMp(data, m) * Math.min(f(data, 'on_hit_mp_cap'), affixSum(m, 'MP_ON_HIT') / 100)), '');
      onHitMpGranted = true;
    }
    if (cm === 1 && hit?.crits > 0 && !criticalMpGranted) {
      const rate = gearCritMp + (hit.elements?.includes('thunder') ? thunderCritMp : 0);
      if (rate > 0) {
        grantMp(Math.ceil(maxMp(data, m) * Math.min(f(data, 'critical_mp_cap'), rate)), '会心の余韻！');
        criticalMpGranted = true;
      }
    }
    // 吸魔と会心回復を合わせても、この技能で払ったMPを超えて回収しない。
    if (cm === 1 && skill?.effect.drain) grantMp(Math.round(dealt * skill.effect.drain / 10), '');
  };
  const finishAttack = () => {
    recordPrimaryHits(b,i,primaryHits);
    const order=a.strategistOrder;
    if(order && (order.type==='damage'||order.type==='flank' && !skill && primaryHits.some(h=>h.target===order.enemy&&h.damage>0)))
      delete a.strategistOrder;
    if(a.strategistUltimate?.damage)delete a.strategistUltimate.damage;
    if(a.winCrit && (!skill||skill.job==='gambler'&&(!skill.effect.rules?.gamble||!a.advancedAction?.gambleRisk)))delete a.winCrit;
    for(const hit of primaryHits)if(a.analysisMarks?.[hit.target])delete a.analysisMarks[hit.target];
    const followupUsed=specialistFollowups(data,game,b,i,skill,cm,primaryTarget,secondaryTarget,primaryHits);
    resolveFamiliar(data,game,b,i,skill,cm,primaryTarget,primaryHits,followupUsed);
    if (a.advancedAction) a.advancedAction.actualDamage += actualDamage;
    if (!skill && cm === 1 && actualDamage > 0 && affixSum(m, 'NORMAL_SKILL') > 0) {
      a.normalSkillReady = true;
      log(b, `${m.name}は次の攻撃技能に備えた`);
    }
    if (skill?.effect.selfcost) {
      const before = m.hp;
      m.hp = Math.max(1, Math.round(m.hp - maxHp(data, m) * skill.effect.selfcost));
      recordHit(b, 'ally', i, before - m.hp);
      log(b, `${m.name}は反動を受けた`);
    }
    const rate = Math.min(f(data, 'attack_heal_rate_cap'), affixSum(m, 'ATTACK_HEAL') / 100);
    if (cm !== 1 || actualDamage <= 0 || rate <= 0) return;
    const targets = game.party.map((member, index) => ({ member, index, max: maxHp(data, member) }))
      .filter(({ member, max }) => member.hp > 0 && member.hp < max)
      .sort((x, y) => x.member.hp / x.max - y.member.hp / y.max);
    const weakest = targets[0];
    if (!weakest) return;
    const amount = Math.min(Math.floor(weakest.max * f(data, 'attack_heal_action_cap')), Math.round(actualDamage * rate));
    const healed = healAlly(data, game, b, weakest.index, amount);
    if (healed > 0) log(b, `${m.name}の攻撃が癒しとなり、${weakest.member.name}のHPが ${healed} 回復`);
  };
  if (skill?.effect.tgt === 'random') {
    if (a.advancedAction?.executed) prepareDuelAttack(game, b, i, livingEnemies(b));
    const randomHits = skill.effect.master && skill.effect.hits?.length ? skill.effect.hits : null;
    // 標的を持つ連撃は打撃先を先に抽選し、別対象を含むなら最初の打撃から追跡0で計算する。
    const plannedTargets=activeMark(game,b,i) ? Array.from({length:randomHits?.length??skill.effect.n??1},()=>pick(b,livingEnemies(b))) : null;
    if (a.advancedAction?.executed) preparePursuitAttack(data,game,b,i,plannedTargets??[]);
    const statusTargets = new Set();
    for (let n = 0; n < (randomHits?.length ?? skill.effect.n ?? 1); n++) {
      const alive = livingEnemies(b);
      if (!alive.length) break;
      const planned=plannedTargets?.[n];
      const e = planned!=null && b.enemies[planned]?.hp>0 ? planned : pick(b, alive);
      if (weaponSkill(skill) && a.advancedAction?.executed) (a.advancedAction.weaponTargets??=[]).push(e);
      const strike = randomHits ? { ...skill, effect: { ...skill.effect, hits: [randomHits[n]] } } : skill;
      const r = attackDamage(data, game, b, i, e, strike, cm, { actionBonus });
      const before = b.enemies[e].hp;
      hitEnemy(data, game, b, i, e, r.damage, { ...r, prefix: describeHit(r), primaryAction: true });
      primaryHits.push({target:e,damage:Math.max(0,before-b.enemies[e].hp),elements:r.elements,killed:before>0&&b.enemies[e].hp<=0});
      if (!statusTargets.has(e) && (!skill.effect.status_once_action || statusTargets.size === 0)) {
        if (r.landed && r.damage > 0) applyAttackStatuses(data, game, b, i, e, skill.effect, cm);
        applyMasterAttackAfter(data, game, b, i, e, skill, cm, { ...r, dealt: Math.max(0,before-b.enemies[e].hp) });
        statusTargets.add(e);
      }
      weaponHitBonus(Math.max(0, before - b.enemies[e].hp), r);
    }
    finishAttack();
    return;
  }
  const targets = (allMul ? livingEnemies(b) : selectedTargets ?? attackTargets(b, kind, target)).slice(0,skill?.effect.target_limit??b.enemies.length);
  if (a.advancedAction?.executed) preparePursuitAttack(data,game,b,i,targets);
  if (weaponSkill(skill) && a.advancedAction?.executed) a.advancedAction.weaponTargets=targets;
  if (a.advancedAction?.executed) prepareDuelAttack(game, b, i, targets);
  for (const e of targets) {
    const r = attackDamage(data, game, b, i, e, skill, cm, { actionBonus });
    const before = b.enemies[e].hp;
    const primaryDamage = Math.round(r.damage * (allMul ?? 1));
    hitEnemy(data, game, b, i, e, primaryDamage, { ...r, prefix: describeHit(r), primaryAction: true });
    const dealt = Math.max(0, before - b.enemies[e].hp);
    primaryHits.push({target:e,damage:dealt,elements:r.elements,killed:before>0&&b.enemies[e].hp<=0});
    const hits = [[dealt, r]];
    if (skill?.effect.rules?.companion_follow && a.companion?.hp>0 && b.enemies[e].hp>0) {
      const follow=skill.effect.rules.companion_follow;
      const followSkill={...skill,elements:[follow.element],effect:{...skill.effect,base:'phys',element:follow.element,m:follow.m,
        tags:['active','physical'],rules:{companion_attack:true,no_weapon_power:true}}};
      const extra=attackDamage(data,game,b,i,e,followSkill,cm);
      const beforeExtra=b.enemies[e].hp;
      hitEnemy(data,game,b,i,e,extra.damage,{...extra,prefix:'相棒の連携！'});
      const dealtExtra=Math.max(0,beforeExtra-b.enemies[e].hp);
      hits.push([dealtExtra,extra]);
    }
    // 追撃は通常攻撃1行動につき最大1回。追加ヒットからの再発動はなし。
    if (!skill && !extraHitGranted && dealt > 0 && b.enemies[e].hp > 0
      && chance(b, Math.min(f(data, 'extra_hit_cap'), affixSum(m, 'EXTRA_HIT') / 100))) {
      extraHitGranted = true;
      const beforeExtra = b.enemies[e].hp;
      hitEnemy(data, game, b, i, e, Math.round(primaryDamage * 0.5), { ...r, prefix: '追加攻撃！' });
      hits.push([Math.max(0, beforeExtra - b.enemies[e].hp), r]);
    }
    if (!skill && m.equip.offhand && b.enemies[e].hp > 0) {
      const r2 = attackDamage(data, game, b, i, e, null, cm, { offhand: true, actionBonus });
      const secondDamage = Math.round(r2.damage * data.balance.battle.dual_wield_second_hit);
      const beforeSecond = b.enemies[e].hp;
      hitEnemy(data, game, b, i, e, secondDamage, { ...r2, prefix: `二刀目！${describeHit(r2)}`, primaryAction: true });
      const secondDealt = Math.max(0, beforeSecond - b.enemies[e].hp);
      hits.push([secondDealt, r2]);
      // サブ武器の通常攻撃固有効果も命中時に発動する（例：鎚のスタン）
      const offhandTrait = weaponTraits(data, m.equip.offhand).normal_status;
      if (r2.landed && b.enemies[e].hp > 0 && offhandTrait) {
        const status = data.statusEffects.get(offhandTrait.id);
        if (status) inflictByActor(data, game, b, i, e, [status.name, offhandTrait.chance], cm);
      }
      if (r2.landed && b.enemies[e].hp > 0) {
        for (const [key, value] of Object.entries(gearEffects(m.equip.offhand))) {
          if (!key.startsWith('STATUS_ON_HIT:')) continue;
          const status = data.statusEffects.get(key.slice('STATUS_ON_HIT:'.length));
          if (status) inflictByActor(data, game, b, i, e, [status.name, Math.min(0.5, value / 100)], cm);
        }
      }
    }
    if (skill && r.landed && r.damage > 0) applyAttackStatuses(data, game, b, i, e, skill.effect, cm);
    if (skill) applyMasterAttackAfter(data, game, b, i, e, skill, cm, { ...r, dealt });
    const ap = memberMods(data, m).auto_poison;
    if (!skill && ap && r.landed && b.enemies[e].hp > 0) inflictByActor(data, game, b, i, e, [data.statusEffects.get('poison').name, ap], cm);
    // 通常攻撃で発動する武器固有の状態異常（鎚・鎌）
    if (!skill && r.landed && b.enemies[e].hp > 0 && wt?.traits.normal_status) {
      const effect = wt.traits.normal_status;
      const status = data.statusEffects.get(effect.id);
      if (status) inflictByActor(data, game, b, i, e, [status.name, effect.chance], cm);
    }
    // 専用武器の追加状態異常は本体の命中時だけ発動する。
    if (!skill && r.landed && b.enemies[e].hp > 0 && m.equip.weapon) {
      for (const [key, value] of Object.entries(gearEffects(m.equip.weapon))) {
        if (!key.startsWith('STATUS_ON_HIT:')) continue;
        const status = data.statusEffects.get(key.slice('STATUS_ON_HIT:'.length));
        if (status) inflictByActor(data, game, b, i, e, [status.name, Math.min(0.5, value / 100)], cm);
      }
    }
    for (const [index, [damage, hit]] of hits.entries()) weaponHitBonus(damage, hit, index === 0);
    // 槍の貫通：通常攻撃時に別の敵へ追加攻撃（連鎖しない）
    if (!skill && dealt > 0 && wt?.traits.splash_chance) {
      const others = livingEnemies(b).filter((j) => j !== e);
      if (others.length && chance(b, wt.traits.splash_chance)) {
        const other = pick(b, others);
        const extra = attackDamage(data, game, b, i, other, null, cm, { actionBonus });
        const beforeOther = b.enemies[other].hp;
        hitEnemy(data, game, b, i, other, Math.round(extra.damage * (wt.traits.splash_mul ?? 0.5)),
          { ...extra, prefix: `貫通！${describeHit(extra)}` });
        weaponHitBonus(Math.max(0, beforeOther - b.enemies[other].hp), extra);
      }
    }
  }
  finishAttack();
}

function specialistFollowups(data, game, b, actor, skill, cm, primaryTarget, secondaryTarget, hits) {
  const ally=b.allies[actor];
  if (!skill || !ally.advancedAction?.executed || game.party[actor].hp<=0) return false;
  const strike=(target,base,m,elements,label)=>{
    const followup={id:'specialist_followup',kind:'attack',elements,
      effect:{master:true,base,m,tags:['reaction','followup'],hits:[1],...(elements.length===1?{element:elements[0]}:{})}};
    const result=attackDamage(data,game,b,actor,target,followup,cm);
    hitEnemy(data,game,b,actor,target,result.damage,{...result,prefix:label,allowKillEffects:false});
  };
  const killed=hits.some(hit=>hit.target===primaryTarget&&hit.killed);
  const rule=skill.effect.rules?.kill_followup;
  if (rule && killed) {
    const candidates=livingEnemies(b).filter(target=>target!==primaryTarget);
    const next=candidates.includes(secondaryTarget)?secondaryTarget:candidates[0];
    if (next!=null)strike(next,'weapon',rule.m,[rule.element],'断ち継ぐ追撃！');
  }
  if (directMagic(skill)) {
    const preparation=Object.entries(ally.masterEffects??{}).find(([,effect])=>effect.nextMagicEcho);
    if (!preparation) return false;
    const [key,effect]=preparation;
    delete ally.masterEffects[key];
    const primary=hits.find(hit=>hit.target===primaryTarget&&hit.damage>0);
    if (primary && b.enemies[primaryTarget]?.hp>0) strike(primaryTarget,'mag',effect.nextMagicEcho.m,primary.elements,'影写しの追撃！');
    return true;
  }
  return Boolean(rule&&killed);
}

function arcaneReactionAllowed(game,b,actor){
  return game.party[actor]?.hp>0 && !['petrify','sleep','freeze','stun','paralysis','confusion','charm']
    .some(id=>b.allies[actor]?.statuses?.[id]);
}
function resolveFamiliar(data,game,b,actor,skill,cm,target,hits,followupUsed){
  const ally=b.allies[actor],familiar=ally.familiar;
  if(!familiar?.uses || !familiar.remaining || skill?.id==='witch_U01' || !ally.advancedAction?.executed
    || followupUsed || !arcaneReactionAllowed(game,b,actor))return;
  // 反応枠は主対象に固定し、全体攻撃でも追撃を複製しない。
  if(!hits.some(hit=>hit.target===target&&hit.damage>0)||!(b.enemies[target]?.hp>0))return;
  const enemy=b.enemies[target];
  familiar.uses--;
  if(familiar.mode==='pursuit'){
    const bonus=passiveRules(data,game.party[actor]).find(p=>p.familiar_condition)?.familiar_condition;
    const enhanced=bonus?.statuses.some(id=>ally.advancedAction.familiarStatuses?.[target]?.includes(id));
    const defense=enemy.res*statModifier(data,bval(enemy.buffs??{},'res'),enemyStatDebuff(data,enemy,'res'),enemy.boss);
    const damage=Math.max(0,Math.round(evaluate(f(data,'ally_damage'),{
      atk:familiar.power*familiar.m*familiar.cm*cm*(1+(enhanced?bonus.rate:0)),em:1,df:defense,crit:1,r:between(b,f(data,'ally_rand'))})));
    hitEnemy(data,game,b,actor,target,damage,{prefix:'使い魔の追撃！',elements:['none'],allowKillEffects:false});
  }else if(chance(b,enemyStatusChance(data,enemy,b.round,'statdown',familiar.mischiefRate*familiar.cm*cm))){
    enemy.masterDebuffs??={};const key='witch_familiar:'+actor,old=enemy.masterDebuffs[key];
    if(!old||old.value<=.1)enemy.masterDebuffs[key]={stat:'res',value:.1,turns:Math.max(old?.turns??0,2)};
    log(b,enemy.name+'のRESが下がった');
  }
  if(familiar.uses<=0)delete ally.familiar;
}

const CONTROL_KINDS = new Set(['skip_until_hit', 'skip_once', 'skip_chance', 'petrify', 'random_target', 'charm']);

function applyAttackStatuses(data, game, b, actor, target, effect, cm) {
  if (b.enemies[target].hp <= 0) return;
  const member = game.party[actor];
  const gunAttack = effect.base === 'weapon' && member.equip.weapon
    && gearDef(data, member.equip.weapon).kind === 'gun';
  const apply = (status) => {
    const multiplier = gunAttack && data.statusByName.get(status[0])?.id === 'petrify'
      ? 1 + (memberMods(data, member).gun_petrify_rate ?? 0) : 1;
    const success = inflictByActor(data, game, b, actor, target, [status[0], status[1] * multiplier], cm,
      !effect.ultimate && !effect.tags?.some(tag=>['reaction','trap','followup'].includes(tag)));
    const id = data.statusByName.get(status[0])?.id ?? status[0];
    if (success && effect.status_turns && b.enemies[target].statuses[id]) {
      const control = CONTROL_KINDS.has(data.statusEffects.get(id)?.kind);
      b.enemies[target].statuses[id].turns = b.enemies[target].boss && control ? Math.min(1, effect.status_turns) : effect.status_turns;
    }
  };
  if (effect.st) apply(effect.st);
  for (const status of effect.extra_st ?? []) apply(status);
  const typed=effect.rules?.type_status;
  if (typed && b.enemies[target].types?.includes(typed.type)) {
    const success=inflictByActor(data,game,b,actor,target,[typed.id,typed.rate],cm);
    if (success && b.enemies[target].statuses[typed.id]) b.enemies[target].statuses[typed.id].turns=typed.turns;
  }
}

function inflictByActor(data, game, b, actor, target, status, cm, allowPursuit = true) {
  const member = game.party[actor];
  const mods = memberMods(data, member);
  const id = data.statusByName.get(status[0])?.id ?? data.statusEffects.get(status[0])?.id ?? status[0];
  const targetId = data.statusEffects.has(id) ? id : 'statdown';
  const base = [status[0], status[1] + (allowPursuit ? pursuitStatusBonus(data, game, b, actor, target, id) : 0)];
  const danceCharm=base?.[0]==='charm' && b.allies[actor]?.advancedAction?.skillId==='dancer_A03'
    ? ruleNumber(data,member,'charm_bonus') : 0;
  return inflictEnemy(data, b, target, [base[0], Math.min(.95,base[1]+danceCharm)], cm,
    (mods.stat_rate ?? 0) + (affixSum(member, 'STATUS_RATE') + affixSum(member, `STATUS_RATE:${targetId}`)) / 100,
    { actor, potency: 1 + Math.min(f(data, 'dot_power_cap'), (mods.dot_power ?? 0)
      + (affixSum(member, 'DOT_POWER') + affixSum(member, `DOT_POWER:${targetId}`)) / 100) });
}

function spreadPoison(data, game, b, actor, defeated) {
  const member = game.party[actor], ally = b.allies[actor];
  if (!member || !canAct(game, b, actor) || ally.poisonSpreadRound === b.round) return;
  const rate = memberMods(data, member).poison_spread ?? 0;
  if (rate <= 0) return;
  const id = ['toxic', 'poison'].find(status => defeated.statuses[status]);
  if (!id) return;
  const target = b.enemies.findIndex(enemy => enemyCanAct(enemy) && !enemy.statuses[id] && enemy.statusAffinity?.[id] !== '×');
  if (target < 0) return;
  ally.poisonSpreadRound = b.round;
  inflictByActor(data, game, b, actor, target, [data.statusEffects.get(id).name, rate], 1);
}

/** 敵に状態異常をかける。継続ダメージと行動封じを別々に調整する。 */
function inflictEnemy(data, b, e, [name, rate], cm, statRate = 0, source = {}) {
  const enemy = b.enemies[e];
  enemy.statusHits ??= {};
  const alias = STATUS_ALIASES[name];
  const st = data.statusByName.get(name) ?? data.statusEffects.get(name);
  if (!st && !alias) return false;
  const key = st?.id ?? 'statdown';
  const control = Boolean(st && CONTROL_KINDS.has(st.kind));
  const p = enemyStatusChance(data, enemy, b.round, key, rate * cm * (1 + statRate), control);
  if (!chance(b, p)) { log(b, `${enemy.name}には効かなかった`); return false; }
  enemy.statusHits[key] = (enemy.statusHits[key] ?? 0) + 1;
  if (alias) {
    for (const [k, v] of Object.entries(alias.debuff)) putBuff(enemy.debuffs, k, v, alias.turns);
    if (name === '能力ダウン') putBuff(enemy.debuffs, 'abilityDown', 1, alias.turns);
    log(b, enemy.name + (name === '能力ダウン' ? 'の能力が下がった' : 'の守りが下がった'));
  } else if (st) {
    const current = enemy.statuses[st.id];
    enemy.statuses[st.id] = { turns: enemy.boss && control ? 1 : st.turns,
      n: current?.n ?? 1, actor: source.actor,
      potency: Math.max(current?.potency ?? 1, source.potency ?? 1) };
    if (enemy.boss && control) enemy.controlGuardUntil = b.round + 1;
    if (st.kind === 'maxhp_down') {
      enemy.baseMaxHp ??= enemy.maxHp;
      enemy.maxHp = Math.max(1, Math.round(enemy.baseMaxHp * (1 - st.value * (enemy.boss ? 0.5 : 1))));
      enemy.hp = Math.min(enemy.hp, enemy.maxHp);
    }
    log(b, `${enemy.name}は${st.name}になった`);
  }
  return true;
}

/** 弱い強化で強い強化を上書きしたり、弱い技で強い効果だけを延長しない。 */
function putBuff(buffs, key, value, turns) {
  const old = buffs[key];
  if (!old || value > old[0]) buffs[key] = [value, turns];
  else if (value === old[0]) buffs[key] = [value, Math.max(turns, old[1])];
}

// ---------------- スキル ----------------
function natureContext(data,game,b,i,cm=1){
  const member=game.party[i];
  return {
    stats:()=>battleStats(data,game,b,i),
    snapshot:()=>({mag:battleStats(data,game,b,i).mag,spell:spellPower(data,member)}),
    heal:(target,power,snapshot=null)=>{
      const st=battleStats(data,game,b,i),traits=weaponTraits(data,member.equip.weapon);
      const value=evaluate(f(data,'heal'),{MAG:snapshot?.mag??st.mag,wpow:snapshot?.spell??spellPower(data,member),m:power,heal_mul:traits.heal_mul??1})*cm;
      return healAlly(data,game,b,target,value);
    },
    healRaw:(target,value)=>healAlly(data,game,b,target,value),
    shield:(target,power,key)=>{
      const amount=(10+.5*member.lv+battleStats(data,game,b,i).res)*power*cm;
      const room=masterShieldRoom(data,game,b,target,key),value=Math.max(0,Math.floor(Math.min(room,amount,maxHp(data,game.party[target])*.5)));
      if(value)grantMasterEffect(b,target,key,{shield:value,remaining:2,source:i,skillId:key,grantedClock:b.actionClock});
      return value;
    },
    statusResist:(target,rate,key)=>grantMasterEffect(b,target,key,{statusResist:{multiplicative:true,statuses:[...data.statusEffects.keys()],rate},remaining:2,source:i,skillId:key,grantedClock:b.actionClock}),
    inflict:(target,status,rate,multiplier,turns)=>{
      const applied=inflictEnemy(data,b,target,[status,rate],multiplier,0,{actor:i});
      if(applied&&b.enemies[target].statuses[status])b.enemies[target].statuses[status].turns=b.enemies[target].boss?1:turns;
      return applied;
    },
    attack:(target,power,element,base,id,snapshot=null,status=null)=>{
      const original=data.skills.get(id),skill=original?effectiveSkill(data,member,original):null;
      const proxy={...skill,id,kind:'attack',elements:[element],effect:{...skill?.effect,base:base==='beast'?'phys':'mag',element,m:power,
        rules:{...skill?.effect?.rules,nature_beast:base==='beast',nature_forecast:Boolean(snapshot),nature_snapshot:snapshot}}};
      const result=attackDamage(data,game,b,i,target,proxy,cm);
      hitEnemy(data,game,b,i,target,result.damage,{...result,primaryAction:!snapshot});
      if(result.landed&&result.damage>0&&status){const applied=inflictEnemy(data,b,target,[status.id,status.rate],cm,0,{actor:i});
        if(applied)b.enemies[target].statuses[status.id].turns=b.enemies[target].boss?1:status.turns;}
      return result;
    },
  };
}

function doSkill(data, game, b, i, s, target, cm, normalSkillReady = false, action = {}) {
  if (!s.effect?.jump_landing) s = effectiveSkill(data, game.party[i], s);
  const m = game.party[i];
  const a = b.allies[i];
  const block = skillBlock(data, game, b, i, s);
  if (block) { log(b, `${s.name}は使えなかった（${block}）`); return; }
  if (s.effect.tgt === 'self') target = i;
  const targetBlock = advancedTargetBlock(data,game,b,i,s,target,action);
  if (targetBlock) { log(b, `${s.name}は使えなかった（${targetBlock}）`); return; }
  const trioReason = trioTargetBlock(data,game,b,i,s,target,action);
  if (trioReason) { log(b, `${s.name}は使えなかった（${trioReason}）`); return; }
  const civicReason = civicTargetBlock(data,game,b,i,s,target,action);
  if (civicReason) { log(b, `${s.name}は使えなかった（${civicReason}）`); return; }
  const natureReason = natureTargetBlock(data,game,b,i,s,target,action);
  if (natureReason) { log(b, `${s.name}は使えなかった（${natureReason}）`); return; }
  if (s.effect.rules?.mystic && (
    (s.kind === 'attack' && (s.effect.tgt === 'all' ? !livingEnemies(b).length : !enemyCanAct(b.enemies[target] ?? {hp:0})))
    || (s.kind === 'debuff' && !enemyCanAct(b.enemies[target] ?? {hp:0}))
    || (s.id === 'shrine_maiden_A09' && !game.party.some((member,index)=>index!==i && member.hp>0 && !isPetrified(b,index)))
  )) { log(b, `${s.name}は使えなかった（対象がいない）`); return; }
  if (s.effect.rules?.mystic && ['ally_buff', 'cure'].includes(s.kind)
    && s.effect.tgt !== 'self' && (!game.party[target] || game.party[target].hp <= 0 || isPetrified(b, target))) {
    log(b, `${s.name}は使えなかった（対象が行動できない）`); return;
  }
  if ((s.kind === 'mp_give' && s.effect.transfer || s.effect.rules?.cover?.target === 'selected') && target === i) {
    log(b, '自分以外の味方を選んでください'); return;
  }
  const choices = s.effect.rules?.choose_element ?? s.effect.rules?.choose_mode ?? s.effect.choose_element;
  if (choices?.length) {
    if (!choices.includes(action.element)) { log(b, '属性を選んでください'); return; }
    if (!s.effect.rules?.choose_mode) {
      const state = s.effect.rules?.element_status?.[action.element];
      s = { ...s, elements: [action.element], effect: { ...s.effect, element: action.element, ...(state ? { st: state } : {}) } };
    }
  }
  const boost = action.boost && !s.isFinal && s.kind === 'attack' && s.effect.base === 'mag'
    ? passiveRules(data, m).find(rule => rule.mp_boost)?.mp_boost : null;
  const spentMp = skillMp(data, m, s, { battle: b, actor: i }) + (boost?.mp ?? 0);
  if (m.mp < spentMp) { log(b, '追加分のMPが足りない'); return; }
  const supportBefore = s.kind !== 'attack' && !s.effect.rules?.stance ? supportSnapshot(data, game, b) : null;
  const preparationBefore = preparationSnapshot(a);
  if (boost) a.currentBoost = boost;
  payAdvancedCosts(data,game,b,i,s,action);
  payMysticCosts(b, i, s);
  a.advancedAction.skillId=s.id;
  if (a.advancedAction.paidHp > 0) log(b, `${m.name}はHPを${a.advancedAction.paidHp}支払った`);
  m.mp -= spentMp;
  a.advancedAction.mpPaid = spentMp;
  if (s.isFinal) { m.ultimateGauge = 0; if (ultimateRules(data).once_per_battle) a.once.push(s.id); }
  if (s.effect.once) a.once.push(s.id);
  log(b, `${m.name}の${s.name}！`);
  if (s.id === 'necromancer_U01') s = { ...s, effect: { ...s.effect, m: 1.8 + (a.advancedAction.soulSpent ?? 0) * .25 } };
  const e = s.effect;
  if (e.rules?.before_party_buff) {
    const rule = e.rules.before_party_buff;
    for (let j = 0; j < game.party.length; j++) if (game.party[j].hp > 0 && !isPetrified(b, j)) {
      grantMasterEffect(b, j, s.id, { values: Object.fromEntries(Object.entries(rule.values).map(([key,value])=>[key,value*cm])), remaining: rule.turns, source: i, skillId: s.id, party: true });
    }
  }
  const shieldRate = cm === 1 ? Math.min(f(data, 'overheal_shield_rate_cap'), affixSum(m, 'OVERHEAL_SHIELD') / 100) : 0;
  const allies = (pred = (j) => game.party[j].hp > 0) => game.party.map((x, j) => j).filter(pred);
  const healAmt = () => {
    const st = battleStats(data, game, b, i);
    const traits = weaponTraits(data, m.equip.weapon);
    return evaluate(f(data, 'heal'), { MAG: st.mag, wpow: spellPower(data, m), m: (e.m ?? 1)
      + (e.rules?.dance_ultimate ? (a.advancedAction?.rhythmSpent??0)*.10 : 0), heal_mul: traits.heal_mul ?? 1 }) * cm
      * (1 + (memberMods(data, m).healp ?? 0) + affixSum(m, 'HEAL_POWER') / 100 + masterHealingBonus(data, game, b, i, s));
  };
  if (e.master && s.kind === 'heal_all' && e.rules?.cure_statuses) {
    for (const j of allies()) if (!isPetrified(b, j)) masterCure(data, game, b, i, j, e.rules.cure_statuses, cm);
  }
  if (e.rules?.cure_before_heal) masterCure(data,game,b,i,i,e.rules.cure_before_heal,cm);
  if (e.rules?.companion_ultimate) summonCompanion(data,game,b,i,2,true);
  if (e.rules?.puppet_ultimate) summonPuppet(data,game,b,i,2,true);
  if(e.rules?.gamble){
    const gamble=e.rules.gamble,risk=e.rules.risk_only||action.element==='risk';
    const luck=Math.min(.10,Math.floor(battleStats(data,game,b,i).luk/5)/100);
    const chanceRate=Math.min(.75,gamble.chance+luck+ruleNumber(data,m,'gamble_chance')+(a.comebackTickets>0?.05:0));
    const won=risk&&chance(b,chanceRate),failed=risk&&!won;
    const insurance=a.insurance;
    const multiplier=risk?(won?gamble.win:gamble.fail+(insurance?.rate??0)):gamble.safe;
    s={...s,effect:{...s.effect,m:multiplier,element:s.effect.element||'pierce'}};
    a.advancedAction.gambleFailed=failed;a.advancedAction.gambleWon=won;a.advancedAction.gambleRisk=risk;
    if(risk){if(insurance)delete a.insurance;if(a.comebackTickets>0)a.comebackTickets--;}
    log(b,`${m.name}の${risk?(won?'大勝負成功':'大勝負失敗'):'堅実な選択'}！`);
  }
  if(e.rules?.decoy_burst && a.decoy){
    const full=a.decoy.hp>=a.decoy.maxHp*.5;
    if(full)s={...s,effect:{...s.effect,m:(s.effect.m??1)*1.10}};
    delete a.decoy;
  }
  if(e.rules?.nature){a.advancedAction.executed=true;runNature(data,game,b,i,s,target,cm,action,natureContext(data,game,b,i,cm));}
  else if (e.rules?.trio || e.rules?.civic) (e.rules?.civic ? runCivic : runTrio)(data,game,b,i,s,target,cm,action,{
    log: message=>log(b,message), spentMp, stats:()=>battleStats(data,game,b,i),
    elementMultiplier:(enemy,element)=>elementMul(data,enemy,element),
    elementName:element=>data.elements.get(element)?.name??element,
    heal:(t,power,cap=1)=>{
      const st=battleStats(data,game,b,i),traits=weaponTraits(data,m.equip.weapon);
      const amount=evaluate(f(data,'heal'),{MAG:st.mag,wpow:spellPower(data,m),m:power,heal_mul:traits.heal_mul??1})*cm
        *(1+(memberMods(data,m).healp??0)+affixSum(m,'HEAL_POWER')/100+masterHealingBonus(data,game,b,i,s));
      return healAlly(data,game,b,t,Math.min(amount,maxHp(data,game.party[t])*cap));
    },
    healRaw:(t,amount,cap=1)=>healAlly(data,game,b,t,Math.min(amount,maxHp(data,game.party[t])*cap)),
    cure:(t,ids,count)=>{const candidates=ids.map((id,index)=>({id,index,state:b.allies[t].statuses[id]})).filter(x=>x.state)
      .sort((x,y)=>(x.state.turns??Infinity)-(y.state.turns??Infinity)||x.index-y.index).slice(0,count);
      for(const {id} of candidates)delete b.allies[t].statuses[id];return candidates.length;},
    putBuff:(t,key,value,turns)=>putBuff(b.allies[t].buffs,key,value,turns),
    shield:(t,amount,key)=>{const room=masterShieldRoom(data,game,b,t,key);const value=Math.max(0,Math.floor(Math.min(room,amount*cm,maxHp(data,game.party[t])*.5)));
      if(value)grantMasterEffect(b,t,key,{shield:value,remaining:2,source:i,skillId:s.id,grantedClock:b.actionClock});return value;},
    attack:(t,power,element,base,status,finalMultiplier=1)=>{
      const elements=Array.isArray(element)?element:element?[element]:undefined;
      const bonus=s.id.startsWith('machinist_')&&['machinist_A02','machinist_A06'].includes(s.id)?a.machine?.overdrive?.rate??0:0;
      const known=game.catalog?.affinities?.[b.enemies[t]?.monsterId]?.elements??[];
      const weak=elements?.some(el=>b.enemies[t].weak?.includes(el)&&known.includes(el));
      const p05=passiveRules(data,m).find(x=>x.skill.id==='machinist_P05')?.trio?.level??0;
      const proxy={...s,elements:elements??s.elements,effect:{...s.effect,base,m:power,...(elements?{element:elements.length===1?elements[0]:undefined}:{}),st:status??undefined}};
      const result=attackDamage(data,game,b,i,t,proxy,cm);
      result.damage=Math.max(0,Math.round(result.damage*finalMultiplier*(1+bonus)*(s.id.startsWith('machinist_')&&weak&&p05?1+[0,.05,.08,.10][p05]:1)));
      hitEnemy(data,game,b,i,t,result.damage,{...result,primaryAction:true});
      if(result.landed&&result.damage>0&&status)applyAttackStatuses(data,game,b,i,t,proxy.effect,cm);
      return result;
    },
  });
  else switch (s.kind) {
    case 'jump': break; // 準備だけ。武器攻撃の資源と命中処理は着地時に一度だけ。
    case 'utility': {
      if (e.master) break;
      const enemy = b.enemies[target];
      if (!enemy || enemy.hp <= 0) break;
      if (s.id === 'hunter_p2_s1') {
        if (!chance(b, cm)) { log(b, '弱点を見極められなかった'); break; }
        enemy.revealed = true;
        learnMonsterElements(game, enemy, enemy.weak, true);
        const names = enemy.weak.map((id) => data.elements.get(id)?.name ?? id);
        log(b, `${enemy.name}の弱点：${names.join('・') || 'なし'}`);
      } else if (!enemy.stolen && chance(b, cm * 0.5)) {
        const id = data.monsters.get(enemy.monsterId)?.materialCommon;
        if (id && data.materials.has(id)) {
          enemy.stolen = true;
          (b.stolen ??= []).push(id);
          log(b, `${data.materials.get(id).name}を盗んだ`);
        }
      } else log(b, '盗めなかった');
      break;
    }
    case 'attack':
      if(e.rules?.proxy_attack){
        const source=action.sourceTarget,enemy=action.secondaryTarget;
        const proxy={id:s.id,job:s.job,kind:'attack',elements:['pierce'],effect:{master:true,base:'weapon',m:s.effect.m,
          element:'pierce',tags:['reaction','physical'],rules:{}}};
        const hit=attackDamage(data,game,b,source,enemy,proxy,cm);
        hitEnemy(data,game,b,i,enemy,hit.damage,{...hit,prefix:`${game.party[source].name}との連携！`});
      }else doAttack(data, game, b, i, s, target, cm, { normalSkillReady, spentMp, selectedTargets: action.targets ?? null, secondaryTarget: action.secondaryTarget ?? null });
      break;
    case 'heal': {
      const t = game.party[target]?.hp > 0 ? target : i;
      if (e.master && isPetrified(b, t)) break;
      const blessingBonus = e.rules?.heal_own_blessing && ownedBlessing(b,i,t) ? e.rules.heal_own_blessing : 0;
      const amount = e.rules?.ticket_heal ? maxHp(data,game.party[t])*e.rules.ticket_heal*cm
        : e.rules?.heal_frac ? maxHp(data,game.party[t])*e.rules.heal_frac*cm
        : healAmt()*(1+blessingBonus)*between(b,f(data,'ally_rand'));
      const v = healAlly(data, game, b, t, amount, shieldRate);
      log(b, `${game.party[t].name}のHPが ${v} 回復`);
      break;
    }
    case 'heal_all': {
      const amt = healAmt();
      for (const j of allies()) if (!e.master || !isPetrified(b, j)) healAlly(data, game, b, j, amt, shieldRate);
      if (e.cure) for (const j of allies()) cureAlly(data, game, b, j, () => chance(b, cm));
      if (e.revive_all) {
        for (const j of allies((x) => game.party[x].hp <= 0 && !isPetrified(b, x))) {
          game.party[j].hp = Math.max(1, Math.round(maxHp(data, game.party[j]) * e.revive_all * cm));
          log(b, `${game.party[j].name}が起き上がった`);
        }
      }
      log(b, '味方全員のHPが回復した');
      break;
    }
    case 'revive': {
      const t = game.party[target]?.hp <= 0 ? target : allies((x) => game.party[x].hp <= 0)[0];
      if (t == null) { log(b, 'しかし誰も倒れていない'); break; }
      if (isPetrified(b, t)) break;
      game.party[t].hp = Math.max(1, Math.round(maxHp(data, game.party[t]) * (e.frac ?? 0.3) * cm));
      log(b, `${game.party[t].name}が起き上がった`);
      break;
    }
    case 'cure': case 'cure_all': {
      if (e.master) {
        const ts = s.kind === 'cure_all' || e.tgt === 'all' ? allies() : [game.party[target]?.hp > 0 ? target : i];
        for (const j of ts) if (!isPetrified(b, j)) masterCure(data, game, b, i, j, e.rules?.cure_statuses ?? [], cm);
        break;
      }
      // 治せるのは status_effects.csv の cure 列にこのスキルの名前があるもの
      const ts = s.kind === 'cure_all' ? allies() : [game.party[target]?.hp > 0 ? target : i];
      for (const j of ts) cureAlly(data, game, b, j, (st) => curedBy(st, s.name) && chance(b, cm));
      break;
    }
    case 'party_buff': {
      if (e.master) break;
      const traitMul = (weaponTraits(data, m.equip.weapon).party_buff_mul ?? 1)
        * (1 + Math.min(0.5, affixSum(m, 'PARTY_BUFF_POWER') / 100));
      for (const [k, v] of Object.entries(e.buff ?? {})) {
        const song = s.job === 'bard' ? memberMods(data, m) : {};
        const base = (v + (k === 'dmg' ? song.song ?? 0 : 0)) * traitMul * cm;
        putBuff(b.partyBuffs, k, Math.min(k === 'immune' ? 1 : data.balance.battle.buff_cap, base),
          (e.turns ?? 1) + 1 + (song.song_turns ?? 0) + (s.job === 'dancer' ? memberMods(data, m).dance_turns ?? 0 : 0));
      }
      log(b, '味方全員が力を得た');
      break;
    }
    case 'self_buff':
      if (e.master) break;
      for (const [k, v] of Object.entries(e.buff ?? {})) putBuff(a.buffs, k, v * cm, (e.turns ?? 1) + 1);
      log(b, `${m.name}は構えた`);
      break;
    case 'ally_buff': {
      if (e.master) break;
      const t = game.party[target]?.hp > 0 ? target : i;
      for (const [k, v] of Object.entries(e.buff ?? {})) putBuff(b.allies[t].buffs, k, v * cm, (e.turns ?? 1) + 1);
      log(b, `${game.party[t].name}は力を得た`);
      break;
    }
    case 'mp_give': {
      const t = game.party[target]?.hp > 0 ? target : i;
      const mx = maxMp(data, game.party[t]);
      const requested = Math.max(0, Math.min(mx - game.party[t].mp, Math.round(mx * (e.frac ?? 0) * cm)));
      const v = e.transfer ? Math.min(m.mp, requested) : requested;
      if (e.transfer) m.mp -= v;
      game.party[t].mp = Math.min(mx, game.party[t].mp + v);
      log(b, `${game.party[t].name}のMPが ${v} 回復`);
      break;
    }
    case 'imbue':
      a.imbue = s.elements[0] ?? null;
      log(b, `${m.name}の武器に${data.elements.get(a.imbue)?.name ?? ''}の力が宿った`);
      break;
    case 'debuff': {
      const ts = e.tgt === 'all' ? livingEnemies(b).sort((a,c)=>Number(c===target)-Number(a===target)).slice(0,e.target_limit??8) : attackTargets(b, 'enemy', target);
      for (const t of ts) {
        for (const [k, v] of Object.entries(e.deb ?? {})) putBuff(b.enemies[t].debuffs, k,
          Math.min(f(data, 'debuff_cap'), v * cm), (e.turns ?? 1) + 1);
      }
      log(b, '敵の力が弱まった');
      break;
    }
    case 'status': {
      const ts = (action.targets ?? (e.tgt === 'all' ? livingEnemies(b) : attackTargets(b, 'enemy', target))).slice(0,e.target_limit??b.enemies.length);
      for (const t of ts) {
        const low=e.rules?.low_hp_status;
        const state=low && b.enemies[t].hp<=b.enemies[t].maxHp*low.threshold ? [e.st[0],low.rate] : e.st;
        const applied = inflictByActor(data, game, b, i, t, state, cm);
        const id = data.statusByName.get(e.st?.[0])?.id ?? e.st?.[0];
        if (applied && e.status_turns && b.enemies[t].statuses[id]) {
          const control = CONTROL_KINDS.has(data.statusEffects.get(id)?.kind);
          b.enemies[t].statuses[id].turns = b.enemies[t].boss && control ? Math.min(1, e.status_turns) : e.status_turns;
        }
      }
      break;
    }
    case 'fixed_damage': {
      const baseDamage = m.equip.weapon ? equipmentTier(data, gearDef(data, m.equip.weapon).star).fixedDamageBase
        : equipmentTier(data, 1).fixedDamageBase;
      for (const t of livingEnemies(b)) {
        const en = b.enemies[t];
        const elements = s.elements.length ? s.elements : ['none'];
        const em = Math.max(...elements.map((el) => elementMul(data, en, el)));
        const damage = Math.round(evaluate(f(data, 'fixed_damage'), { baseDamage, em, RES: en.res }) * cm * between(b, f(data, 'enemy_rand')));
        hitEnemy(data, game, b, i, t, damage, { em, elements, landed: true });
      }
      break;
    }
    case 'delayed':
      for (const t of livingEnemies(b)) {
        const r = attackDamage(data, game, b, i, t, { ...s, effect: { ...e, base: 'mag' } }, cm);
        b.delayed.push({ turns: e.delay ?? 1, target: t, actor: i, damage: r.damage, em: r.em, elements: r.elements, landed: r.landed });
      }
      log(b, `${e.delay ?? 1}ターン後に発動する`);
      break;
    default:
      log(b, 'しかし何も起こらなかった');
  }
  if (e.master) applyMasterSkillRules(data, game, b, i, s, target, cm, action);
  if(e.rules?.ticket_heal)a.comebackTickets=Math.max(0,(a.comebackTickets??0)-1);
  if(e.rules?.gamble){
    if(a.advancedAction.gambleFailed){
      if(e.rules.ultimate_ticket)a.comebackTickets=Math.min(2,(a.comebackTickets??0)+1);
      const rate=ruleNumber(data,m,'gamble_miss_heal');
      if(rate&&m.hp>0)healAlly(data,game,b,i,maxHp(data,m)*rate);
    }
    if(a.advancedAction.gambleWon){
      const rate=ruleNumber(data,m,'gamble_win_crit');
      if(rate)a.winCrit={rate,remaining:2,grantedClock:b.actionClock};
    }
  }
  recordPreparation(b,i,s,preparationBefore);
  if (e.rules?.move_blessing) {
    const blessing = ownedBlessing(b,i,action.sourceTarget);
    const moved = { ...blessing, shield: Math.min(blessing.shield,masterShieldRoom(data,game,b,target,'blessing')), grantedClock:b.actionClock };
    delete b.allies[action.sourceTarget].masterEffects.blessing;
    delete b.allies[target].masterEffects.blessing;
    if (moved.shield>0) b.allies[target].masterEffects.blessing=moved;
    log(b, `${game.party[target].name}へ加護を移した`);
  }
  if (supportBefore) {
    const after=supportSnapshot(data,game,b);
    a.advancedAction.effectiveSupport=supportImproved(supportBefore,after);
    recordSelfSupport(b,i,supportBefore,after,s);
  }
}

// ---------------- 基本職の構造化された追加効果 ----------------
// 時間の更新だけを支援の成功として数えず、実際の改善を比較する。
function supportSnapshot(data, game, b) {
  return game.party.map((member, index) => {
    const ally = b.allies[index], stats = battleStats(data, game, b, index);
    const effects = Object.values(ally.masterEffects ?? {});
    return { hp: member.hp, statuses: Object.keys(ally.statuses),
      shield: effects.reduce((sum,effect)=>sum+Math.max(0,effect.shield??0),0) + Math.max(0,ally.buffs.barrier?.[0]??0),
      regeneration: effects.reduce((sum,effect)=>sum+(effect.regen?.amount??0),0),
      values: [...ABILITY_KEYS.map(key=>stats[key]), stats.crit, stats.evasion,
        ...b.enemies.map((enemy,target)=>enemy.hp>0 && ally.distance?.remaining>0 && ally.distance.target===target ? ally.distance.evasion : 0),
        ...['cut','pcut','mcut'].map(key=>masterBuff(data,game,b,index,key)+bval(ally.buffs,key)+bval(b.partyBuffs,key))],
      statusChances: [...data.statusEffects.keys()].map(id=>allyStatusChance(data,game,b,index,id,1,stats)) };
  });
}
function supportImproved(before, after) {
  return after.some((next,index)=>{
    const old=before[index];
    return next.hp>old.hp || next.shield>old.shield || next.regeneration>old.regeneration
      || old.statuses.some(id=>!next.statuses.includes(id))
      || next.values.some((value,i)=>value>old.values[i]+1e-8)
      || next.statusChances.some((chance,i)=>chance<old.statusChances[i]-1e-8);
  });
}
function masterBaseHealing(data, game, b, actor) {
  const member = game.party[actor];
  return battleStats(data, game, b, actor).mag + spellPower(data, member);
}
function masterCure(data, game, b, actor, target, ids, cm) {
  const before = Object.keys(b.allies[target].statuses).length;
  cureAlly(data, game, b, target, status => ids.includes(status.id) && chance(b, cm));
  if (Object.keys(b.allies[target].statuses).length < before) {
    const rate = ruleNumber(data, game.party[actor], 'cure_heal_frac');
    if (rate) healAlly(data, game, b, target, maxHp(data, game.party[target]) * rate);
  }
}
function masterInspect(data, game, b, target, count) {
  const enemy = b.enemies[target];
  if (!enemy) return;
  const known = new Set(game.catalog?.affinities?.[enemy.monsterId]?.elements ?? []);
  const candidates = [...new Set([...(enemy.strongWeak ?? []), ...(enemy.weak ?? []), ...(enemy.resist ?? []), ...(enemy.immune ?? []), ...data.elements.keys()])]
    .filter(id => !known.has(id));
  const selected = candidates.slice(0, Math.max(0, count));
  learnMonsterElements(game, enemy, selected);
  log(b, selected.length ? `${enemy.name}の${selected.map(id => data.elements.get(id)?.name ?? id).join('・')}相性を見極めた` : '調査済みの相性に新しい情報はなかった');
}
function masterSteal(data, game, b, actor, target, rule, cm) {
  const enemy = b.enemies[target];
  if (!enemy || enemy.stolen) { log(b, 'すでに盗んでいる'); return; }
  const id = data.monsters.get(enemy.monsterId)?.materialCommon;
  if (!id || !data.materials.has(id)) { log(b, '盗める通常物資を持っていない'); return; }
  const rate = Math.min(data.basicJobRules?.caps?.status_rate ?? .95, rule.rate + ruleNumber(data, game.party[actor], 'steal_rate'));
  if (!chance(b, rate * cm)) { log(b, '盗めなかった'); return; }
  enemy.stolen = true;
  (b.stolen ??= []).push(id);
  log(b, `${data.materials.get(id).name}を盗んだ`);
  for (const passive of passiveRules(data, game.party[actor])) if (passive.steal_success_buff) {
    const { turns, ...values } = passive.steal_success_buff;
    grantMasterEffect(b, actor, passive.skill.id, { values, remaining: turns });
  }
}
function masterCleanseEnemy(enemy, count) {
  const keys = Object.keys(enemy?.buffs ?? {}).filter(key => !key.startsWith('permanent:'))
    .sort((left, right) => enemy.buffs[right][1] - enemy.buffs[left][1] || left.localeCompare(right));
  for (const key of keys.slice(0, count)) delete enemy.buffs[key];
  return Math.min(count, keys.length);
}
function applyMasterAttackAfter(data, game, b, actor, target, skill, cm, result) {
  applyMysticAttackAfter(data, game, b, actor, target, skill, cm, result);
  const rules = skill?.effect?.rules;
  if (!skill?.effect.master || !rules || !b.enemies[target]) return;
  const enemy = b.enemies[target];
  if (rules.cleanse_defense && result.landed) {
    const keys = Object.entries(enemy.buffs ?? {}).map(([key,state],index)=>({key,state,index}))
      .filter(({key,state})=>['def','pcut','cut'].includes(key) && Array.isArray(state) && state[0] > 0 && state[1] > 0)
      .sort((a,c)=>a.state[1]-c.state[1] || a.index-c.index).slice(0,rules.cleanse_defense.count);
    for (const {key} of keys) delete enemy.buffs[key];
    if (keys.length) log(b, `${enemy.name}の防御強化を崩した`);
  }
  if (rules.cleanse_buffs && (!rules.cleanse_buffs.requires_damage || result.landed && result.damage > 0)) {
    const n = masterCleanseEnemy(enemy, rules.cleanse_buffs.count);
    if (n) log(b, `${enemy.name}の強化を解除した`);
  }
  if (rules.remove_attack_buffs && result.landed && result.damage > 0) {
    const keys=Object.entries(enemy.buffs??{}).map(([key,state],index)=>({key,state,index}))
      .filter(({key,state})=>['str','spd','crt'].includes(key) && Array.isArray(state) && state[0]>0 && state[1]>0)
      .sort((a,c)=>a.state[1]-c.state[1]||a.index-c.index).slice(0,rules.remove_attack_buffs);
    for(const {key} of keys)delete enemy.buffs[key];
    if(keys.length)log(b,`${enemy.name}の攻撃強化を解除した`);
  }
  if (!result.landed || result.damage <= 0) return;
  if (rules.steal) masterSteal(data, game, b, actor, target, rules.steal, cm);
  if (enemy.hp <= 0) return;
  const after = rules.attack_after;
  if (after && chance(b, enemyStatusChance(data, enemy, b.round, 'statdown', after.rate * cm))) {
    for (const [key, value] of Object.entries(after.debuff ?? {})) {
      // 技能ごとに保持して異なる防御崩しは共通上限内で合算する。
      enemy.masterDebuffs ??= {};
      const old = enemy.masterDebuffs[`${skill.id}:${key}`];
      if (!old || value > old.value) enemy.masterDebuffs[`${skill.id}:${key}`] = { stat: key, value, turns: after.turns };
      else if (value === old.value) old.turns = Math.max(old.turns, after.turns);
    }
    log(b, `${enemy.name}の能力を崩した`);
  }
}
function applyMasterSkillRules(data, game, b, actor, skill, target, cm, action = {}) {
  const member = game.party[actor], ally = b.allies[actor], effect = skill.effect, rules = effect.rules ?? {};
  const living = game.party.map((m, i) => i).filter(i => game.party[i].hp > 0 && !isPetrified(b, i));
  const targets = skill.kind === 'party_buff' || effect.tgt === 'all' ? living : skill.kind === 'self_buff' ? [actor]
    : ['ally_buff', 'heal', 'cure', 'mp_give'].includes(skill.kind) ? [living.includes(target) ? target : actor] : [];
  const song = songSkill(skill);
  const passives = passiveRules(data, member);
  const songCount = new Set(Object.values(ally.masterEffects ?? {}).filter(e => e.song && e.skillId !== skill.id).map(e => e.skillId)).size;
  let support = 1;
  if (song) {
    support += passives.reduce((sum, p) => sum + (p.instrument?.song ?? 0) + (p.song_combo && songCount >= p.song_combo.count ? p.song_combo.rate : 0), 0);
    const formula = data.basicJobRules?.song_support ?? {};
    const mag = battleStats(data, game, b, actor).mag;
    support += (formula.mag_scale ?? .2) * mag / (mag + (formula.mag_divisor ?? 100));
  }
  if (skill.kind === 'party_buff') support *= (weaponTraits(data, member.equip?.weapon).party_buff_mul ?? 1)
    * (1 + Math.min(.5, affixSum(member, 'PARTY_BUFF_POWER') / 100));
  const duration = (effect.turns ?? rules.regen?.turns ?? 1) + (song ? ruleNumber(data, member, 'song_extend') : 0);
  if (Object.keys(effect.buff ?? {}).length || rules.regen || rules.mp_save) for (const t of targets) {
    const values = Object.fromEntries(Object.entries(effect.buff ?? {}).map(([key, value]) => [key, value * support * cm]));
    const regen = rules.regen;
    const healBonus = 1 + (memberMods(data, member).healp ?? 0) + affixSum(member, 'HEAL_POWER') / 100;
    const amount = regen ? (regen.frac ? maxHp(data, game.party[t]) * regen.frac : masterBaseHealing(data, game, b, actor) * regen.m) * support * cm * healBonus : 0;
    grantMasterEffect(b, t, skill.id, { values, source: actor, skillId: skill.id, song, remaining: duration,
      ...(regen ? { regen: { amount, trigger: regen.trigger } } : {}), ...(rules.mp_save ? { mpSave: rules.mp_save } : {}) });
  }
  if (rules.cover && (rules.cover.target !== 'selected' || target !== actor)) { const key=rules.cover.target==='all'?'masterUltimateCover':'masterCover'; ally[key]={...rules.cover,targetIndex:target,remaining:rules.cover.turns,grantedClock:b.actionClock}; }
  if (rules.counter) ally.masterCounter = { ...rules.counter, remaining: rules.counter.turns, grantedClock: b.actionClock, skillId: skill.id,
    ...(rules.counter.targeted ? {target} : {}) };
  if (rules.status_resist) for (const t of targets.length ? targets : [actor]) grantMasterEffect(b, t, skill.id, { statusResist: {...rules.status_resist}, remaining: rules.status_resist.turns });
  if (rules.next_mp_save) grantMasterEffect(b, actor, `${skill.id}:mp`, { nextMpSave: rules.next_mp_save, remaining: rules.next_mp_save.turns });
  if (rules.next_damage) grantMasterEffect(b, actor, `${skill.id}:damage`, { nextDamage: rules.next_damage, remaining: rules.next_damage.turns });
  if (rules.inspect && chance(b, cm)) masterInspect(data, game, b, target, rules.inspect.count);
  if (rules.steal && skill.kind === 'utility') masterSteal(data, game, b, actor, target, rules.steal, cm);
  if (rules.party_target_damage && b.enemies[target] && chance(b, cm)) {
    const rule = rules.party_target_damage;
    b.enemies[target].masterMarks ??= {};
    b.enemies[target].masterMarks[skill.id] = { rate: rule.rate, turns: rule.turns };
    masterInspect(data, game, b, target, rule.inspect ?? 1);
    log(b, `${b.enemies[target].name}への狩猟を解禁した`);
  }
  if (rules.trap && b.enemies[target]) {
    const trap = rules.trap;
    const selected=[target,...livingEnemies(b).filter(t=>t!==target)].slice(0,trap.targets??1);
    for(const target of selected){
    b.masterTraps=(b.masterTraps??[]).filter(t=>t.actor!==actor||t.target!==target);
    while(b.masterTraps.filter(t=>t.actor===actor).length >= trap.limit_total) b.masterTraps.splice(b.masterTraps.findIndex(t=>t.actor===actor),1);
    const traps = b.masterTraps;
    const own = traps.filter(x => x.actor === actor);
    if (own.filter(x => x.target === target).length >= (trap.limit_per_target ?? 1) || own.length >= (trap.limit_total ?? 2)) log(b, 'これ以上は罠を設置できない');
    else {
      traps.push({ actor, target, cm, skill: { ...skill, kind: 'attack', elements: [trap.element], effect: { ...effect, rules: { no_weapon_power: true }, tags: ['trap'], base: trap.base ?? 'phys', m: trap.m, element: trap.element, st: trap.st, status_turns: trap.status_turns, hits: [1] } } });
      log(b, `${b.enemies[target].name}へ罠を仕掛けた`);
    }}
  }
  if (rules.shield) for (const t of targets) {
    const value = Math.max(0,Math.floor(Math.min(masterShieldRoom(data,game,b,t,skill.id), masterBaseHealing(data, game, b, actor) * rules.shield.m * cm)));
    if (!value) continue;
    grantMasterEffect(b, t, skill.id, { values: {}, shield: value, remaining: rules.shield.turns, source: actor });
    log(b, `${game.party[t].name}へ防護を付与した`);
  }
  if (rules.blessing) for (const t of targets) {
    grantBlessing(data,game,b,actor,t,skill,battleStats(data,game,b,actor),cm);
    log(b, `${game.party[t].name}へ加護を付与した`);
  }
  if (rules.next_hp_cost) grantMasterEffect(b,actor,skill.id,{nextHpCost:rules.next_hp_cost,remaining:rules.next_hp_cost.turns});
  if (rules.calm) {
    const previous=ally.anger??0;
    ally.anger=0;
    delete ally.masterEffects[rules.calm.remove];
    if (previous>0) healAlly(data,game,b,actor,Math.floor(maxHp(data,member)*rules.calm.heal*cm));
  }
  if (rules.after_lifesteal) grantMasterEffect(b,actor,skill.id,{lifesteal:rules.after_lifesteal.rate,remaining:rules.after_lifesteal.turns});
  if (rules.after_weapon_buff) grantMasterEffect(b,actor,skill.id,{weaponDamage:rules.after_weapon_buff.damage*cm,
    values:{cut:-rules.after_weapon_buff.received*cm},remaining:rules.after_weapon_buff.turns});
  if (rules.revive && skill.kind !== 'revive') {
    const dead = game.party.map((m, i) => i).filter(i => game.party[i].hp <= 0 && !isPetrified(b, i));
    const selected = dead.includes(target) ? target : dead[0];
    if (selected != null) {
      game.party[selected].hp = Math.max(1, Math.floor(maxHp(data, game.party[selected]) * rules.revive.frac * cm));
      log(b, `${game.party[selected].name}が起き上がった`);
    }
  }
  if (rules.steal_buffs) {
    const count = b.enemies.reduce((sum, enemy) => sum + (enemy.hp > 0 ? masterCleanseEnemy(enemy, rules.steal_buffs.count) : 0), 0);
    if (count) for (const t of living) grantMasterEffect(b, t, `${skill.id}:mp`, { nextMpSave: { tag: 'active', rate: rules.steal_buffs.next_mp_save }, remaining: effect.turns ?? 2 });
    if (count) log(b, '敵の強化を奪い、味方の次の技能を支えた');
  }
  if (rules.song_end) for (const t of living) {
    const effects = b.allies[t].masterEffects ?? {};
    const owned = Object.keys(effects).filter(key => effects[key].song && effects[key].source === actor);
    if (!owned.length) continue;
    for (const key of owned) delete effects[key];
    grantMasterEffect(b, t, `${skill.id}:mp`, { nextMpSave: { tag: 'active', rate: rules.song_end.next_mp_save }, remaining: rules.song_end.turns });
  }
  applyTacticalRules(data, game, b, actor, skill, target, cm, action, battleStats(data, game, b, actor));
  applySpecialistRules(data,game,b,actor,skill,target,cm);
  applyPursuitJumpRules(data,game,b,actor,skill,target,cm);
  applyFirearmSeaArcaneRules(data,game,b,actor,skill,cm,living);
  applyArcaneSkillRules(data,game,b,actor,skill,target,cm,action,living);
  applyCompanionSkillRules(data,game,b,actor,skill,target,cm,action,living);
  applyCommandSkillRules(data,game,b,actor,skill,target,cm,action,living);
  applyMysticSkillRules(data,game,b,actor,skill,target,cm,living);
}
function grantOrder(b,target,type,rate,owner,extra={}){
  b.allies[target].strategistOrder={type,rate,source:owner,remaining:2,grantedClock:b.actionClock,...extra};
}
function putDecoy(data,game,b,owner,target,mult){
  const member=game.party[owner],stats=battleStats(data,game,b,owner);
  const base=Math.floor(10+.5*member.lv+stats.res);
  const maximum=Math.max(1,Math.min(Math.floor(maxHp(data,game.party[target])*.25),
    Math.floor(base*mult*(1+ruleNumber(data,member,'decoy_hp')))));
  b.allies[owner].decoy={target,hp:maximum,maxHp:maximum,remaining:2,uses:2,placedClock:b.actionClock};
}
function applyCommandSkillRules(data,game,b,actor,skill,target,cm,action,living){
  const rule=skill.effect.rules??{},ally=b.allies[actor],member=game.party[actor];
  if(skill.job==='strategist'){
    if(rule.order){const order=rule.order;
      grantOrder(b,target,order.type,Math.min(.70,(order.rate+(order.type==='guard'
        ?ruleNumber(data,member,'order_guard_bonus'):ruleNumber(data,member,'order_damage_bonus')))*cm),actor,
        {enemy:order.enemy?action.secondaryTarget:null,mpSave:order.mpSave??0});}
    if(rule.orders_party)for(const t of action.targets??[])grantOrder(b,t,'damage',
      (rule.orders_party.rate+ruleNumber(data,member,'order_damage_bonus'))*cm,actor);
    if(rule.order_speed){const queued=b.queue.find(u=>u.side==='ally'&&u.i===target);
      if(queued){queued.spd=(queued.spd??battleStats(data,game,b,target).spd)*(1+rule.order_speed*cm);
        b.queue=b.queue.map((u,j)=>({...u,queueIndex:j})).sort((x,y)=>(y.spd??0)-(x.spd??0)||x.queueIndex-y.queueIndex)
          .map(({queueIndex,...u})=>u);}}
    if(rule.order_front){const index=b.queue.findIndex(u=>u.side==='ally'&&u.i===target);
      if(index>=0)b.queue.unshift(...b.queue.splice(index,1));ally.orderFrontRound=b.round;}
    if(rule.analyze_accuracy)for(const t of living)(b.allies[t].analysisMarks??={})[target]={rate:rule.analyze_accuracy*cm,
      remaining:2,grantedClock:b.actionClock};
    if(rule.orders_ultimate)for(const t of living)b.allies[t].strategistUltimate={damage:rule.orders_ultimate.damage*cm,
      guard:rule.orders_ultimate.guard*cm,remaining:2,grantedClock:b.actionClock};
  }
  if(skill.job==='jester'){
    if(rule.decoy)putDecoy(data,game,b,actor,target,rule.decoy.m*cm);
    if(rule.decoy_move&&ally.decoy){ally.decoy.target=target;ally.decoy.maxHp=Math.min(ally.decoy.maxHp,
      Math.max(1,Math.floor(maxHp(data,game.party[target])*.25)));
      ally.decoy.hp=Math.min(ally.decoy.hp,ally.decoy.maxHp);}
    if(rule.decoy_repair&&ally.decoy){ally.decoy.hp=Math.min(ally.decoy.maxHp,ally.decoy.hp+Math.floor(ally.decoy.maxHp*rule.decoy_repair*cm));
      ally.decoyRepaired=true;}
    if(rule.smoke_evasion)for(const t of living)grantMasterEffect(b,t,skill.id,{values:{eva:rule.smoke_evasion*cm},remaining:1,source:actor});
    if(rule.decoy_lure)b.enemies[target].decoyLure={owner:actor,rate:Math.min(.90,(rule.decoy_lure+
      ruleNumber(data,member,'lure_bonus'))*cm),remaining:1};
    if(rule.decoy_ultimate)putDecoy(data,game,b,actor,action.secondaryTarget,1.30*cm);
  }
  if(skill.job==='gambler'&&rule.insurance)ally.insurance={rate:rule.insurance,remaining:2,grantedClock:b.actionClock};
  if(skill.job==='gambler'&&rule.gambler_shield){
    const amount=Math.min(masterShieldRoom(data,game,b,actor,skill.id),Math.floor((10+.5*member.lv+battleStats(data,game,b,actor).res)
      *rule.gambler_shield*cm));
    grantMasterEffect(b,actor,skill.id,{shield:amount,remaining:2,source:actor});
  }
}
// 追加19〜21職の一時資源。いずれも battle の JSON に含まれ、町には持ち越さない。
function mysticPassive(data, member, id) {
  return passiveRules(data, member).find(rule => rule.skill.id === id)?.mystic;
}
function mysticMagic(skill) {
  return skill?.kind === 'attack' && skill.effect?.base === 'mag'
    && !masterTags(skill).some(tag => ['reaction','trap','followup'].includes(tag));
}
function mysticSingleElement(skill) {
  return mysticMagic(skill) && !skill.effect.rules?.mystic?.elements?.length;
}
function clearMysticState(b, actor) {
  const ally = b.allies[actor];
  for (const key of ['soul','ghost','seals','lastPolarity','mysticNext','mysticDark','mysticGuard']) delete ally[key];
  for (const unit of b.allies) if (unit.masterEffects?.kagura?.source === actor) delete unit.masterEffects.kagura;
}
function mysticSkillBlock(b, actor, skill) {
  const r = skill.effect?.rules?.mystic;
  if (!r) return '';
  const a = b.allies[actor];
  if (r.requiresSoul && (a.soul ?? 0) < r.requiresSoul) return '魂が足りない';
  if (r.requiresSeal && (a.seals ?? 0) < r.requiresSeal) return '調和符が足りない';
  if (r.requiresGhost && (!a.ghost?.remaining || !a.ghost.charges)) return '亡霊がいない';
  return '';
}
function payMysticCosts(b, actor, skill) {
  const r = skill.effect?.rules?.mystic;
  if (!r) return;
  const a = b.allies[actor];
  const soul = r.consumeSoulUpTo ? Math.min(r.consumeSoulUpTo, a.soul ?? 0) : r.consumeSoul ?? 0;
  const seals = r.consumeSealUpTo ? Math.min(r.consumeSealUpTo, a.seals ?? 0) : r.consumeSeal ?? 0;
  a.soul = (a.soul ?? 0) - soul;
  a.seals = (a.seals ?? 0) - seals;
  a.advancedAction.soulSpent = soul;
  a.advancedAction.sealsSpent = seals;
  if (r.ghostChargeCost && a.ghost) {
    a.ghost.charges -= r.ghostChargeCost;
    if (!a.ghost.charges) delete a.ghost;
  }
}
function mysticDamageBonus(data, game, b, actor, skill, elements) {
  if (!mysticMagic(skill) || skill.isFinal) return 0;
  const a = b.allies[actor], member = game.party[actor];
  const element = skill.effect?.element;
  let bonus = 0;
  if (skill.id === 'necromancer_A06') bonus += mysticPassive(data, member, 'necromancer_P04')?.bonus ?? 0;
  if (mysticSingleElement(skill) && element === 'dark') bonus += a.mysticDark?.bonus ?? 0;
  if (mysticSingleElement(skill) && ['light','dark'].includes(element)) {
    bonus += a.mysticNext?.bonus ?? 0;
    if (a.lastPolarity && a.lastPolarity !== element) bonus += mysticPassive(data, member, 'onmyoji_P01')?.bonus ?? 0;
  }
  if (mysticSingleElement(skill) && elements.includes('light')) {
    bonus += Math.max(0, ...b.allies.map((unit, index) =>
      unit.masterEffects?.kagura?.source === index
        ? mysticPassive(data, game.party[index], 'shrine_maiden_P05')?.bonus ?? 0 : 0));
  }
  return bonus;
}
function mysticCut(data, game, b, target, magic, elements) {
  const a = b.allies[target], member = game.party[target];
  let cut = magic && a.ghost?.remaining ? mysticPassive(data, member, 'necromancer_P03')?.cut ?? 0 : 0;
  if (elements.some(id => ['light','dark'].includes(id))) cut += a.mysticGuard?.cut ?? 0;
  return cut;
}
function applyMysticAttackAfter(data, game, b, actor, target, skill, cm, result) {
  const r = skill?.effect?.rules?.mystic, dealt = result.dealt ?? result.damage;
  if (!result.landed || dealt <= 0) return;
  const a = b.allies[actor], member = game.party[actor], enemy = b.enemies[target];
  if (r?.grantSoul && !a.advancedAction?.soulGranted) {
    a.soul = Math.min(3, (a.soul ?? 0) + 1);
    a.advancedAction.soulGranted = true;
  }
  if (r?.drainRate) healAlly(data, game, b, actor, Math.min(dealt * r.drainRate, maxHp(data, member) * r.healCapMaxHp));
  if (r?.removeEnemyBuffs && enemy.hp > 0) masterCleanseEnemy(enemy, r.count);
  if (r?.statDebuff && enemy.hp > 0 && chance(b, enemyStatusChance(data, enemy, b.round, 'statdown', r.statDebuff.rate * cm))) {
    enemy.masterDebuffs ??= {};
    const key = skill.id + ':' + r.statDebuff.stat;
    const previous = enemy.masterDebuffs[key];
    if (!previous || previous.value <= r.statDebuff.value)
      enemy.masterDebuffs[key] = { stat:r.statDebuff.stat, value:r.statDebuff.value,
        turns:Math.max(previous?.turns ?? 0, r.statDebuff.turns ?? r.turns ?? 2) };
  }
  if ((member.job === 'onmyoji' || member.learned?.some(id=>id.startsWith('onmyoji_')))
    && mysticSingleElement(skill) && !skill.isFinal && ['light','dark'].includes(skill.effect.element)) {
    const element = skill.effect.element;
    const alternated = a.lastPolarity && a.lastPolarity !== element;
    if (alternated && !r?.noSameActionSealGain && !r?.noSealGain) a.seals = Math.min(2, (a.seals ?? 0) + 1);
    a.lastPolarity = element;
    if (alternated) {
      const guard = mysticPassive(data, member, 'onmyoji_P05');
      if (guard) a.mysticGuard = { cut:guard.cut, remaining:2, grantedClock:b.actionClock };
    }
  }
}
function mysticCure(data, game, b, actor, target, rule, cm) {
  const status = b.allies[target].statuses;
  const allowed = Array.isArray(rule.cure) ? rule.cure : null;
  const ids = Object.keys(status).filter(id => id !== 'petrify' && (
    allowed ? allowed.includes(id) : Boolean(data.statusEffects.get(id)?.cure?.length)))
    .sort((left,right) => (status[left].turns ?? 0) - (status[right].turns ?? 0) || left.localeCompare(right));
  const removed = ids.slice(0, Math.max(1, Math.floor((rule.cureCount ?? rule.count ?? 1) * cm)));
  for (const id of removed) {
    delete status[id];
    game.party[target].persist = (game.party[target].persist ?? []).filter(value => value !== id);
    if (game.party[target].persistState) delete game.party[target].persistState[id];
  }
  if (removed.length && !rule.preventNextStatus) {
    const healing = mysticPassive(data, game.party[actor], 'shrine_maiden_P01');
    if (healing) healAlly(data, game, b, target, maxHp(data, game.party[target]) * healing.bonus);
  }
  return removed.length;
}
function mysticShield(data, game, b, actor, target, rate, skillId, cm) {
  const member = game.party[actor], base = Math.floor(10 + .5 * member.lv + battleStats(data,game,b,actor).res);
  const amount = Math.max(0, Math.floor(Math.min(masterShieldRoom(data,game,b,target,skillId),base*rate*cm)));
  if (amount) grantMasterEffect(b,target,skillId,{shield:amount,remaining:2,source:actor});
}
function applyMysticSkillRules(data,game,b,actor,skill,target,cm,living) {
  const r = skill.effect.rules?.mystic;
  if (!r) return;
  const a = b.allies[actor], member = game.party[actor], effects = a.masterEffects;
  if (skill.id === 'necromancer_A02' || skill.id === 'necromancer_U01') {
    const ghost = r.afterGhost ?? { charges:r.ghostCharges, turns:r.turns };
    a.ghost = { charges:ghost.charges, remaining:ghost.turns, grantedClock:b.actionClock };
  }
  if (skill.id === 'necromancer_A07') {
    const enemy = b.enemies[target];
    if (enemy?.hp>0 && chance(b,enemyStatusChance(data,enemy,b.round,'statdown',r.statDebuff.rate*cm))) {
      enemy.masterDebuffs ??= {};
      enemy.masterDebuffs[skill.id] = {stat:'res',value:r.statDebuff.value,turns:r.turns};
    }
  }
  if (['necromancer_A08','onmyoji_A03','shrine_maiden_A07'].includes(skill.id)) {
    const bonus = skill.id === 'onmyoji_A03' ? mysticPassive(data,member,'onmyoji_P03')?.bonus ?? 0 : 0;
    mysticShield(data,game,b,actor,target,r.guard*(1+bonus),skill.id,cm);
  }
  if (skill.id === 'onmyoji_U01') for (const t of living) mysticShield(data,game,b,actor,t,
    r.shieldBaseRate+(a.advancedAction?.sealsSpent??0)*r.bonusPerSeal,skill.id,cm);
  if (skill.id === 'onmyoji_A07') a.mysticNext = {bonus:r.bonus*cm,remaining:r.turns,grantedClock:b.actionClock};
  if (['onmyoji_A08','shrine_maiden_A02'].includes(skill.id)) mysticCure(data,game,b,actor,target,r,cm);
  if (skill.id === 'shrine_maiden_A06' || skill.id === 'shrine_maiden_U01')
    for (const t of living) mysticCure(data,game,b,actor,t,
      skill.id === 'shrine_maiden_A06' ? {...r,count:r.cureCount} : r,cm);
  if (r.kagura) {
    for (const unit of b.allies) delete unit.masterEffects?.kagura;
    const mastery = mysticPassive(data,member,'shrine_maiden_P03');
    const rate = (r.rate ?? r.regen ?? r.cut ?? 0) *
      (mastery && ['regeneration','protection'].includes(r.kagura) ? 1+mastery.bonus : 1)*cm;
    for (const t of living) grantMasterEffect(b,t,'kagura',{
      source:actor,skillId:skill.id,kaguraKind:r.kagura,remaining:r.turns,
      ...(r.kagura === 'prevention' ? {statusResist:{multiplicative:true,statuses:r.statuses,rate}} : {}),
      ...(r.kagura === 'regeneration' ? {regen:{amount:maxHp(data,game.party[t])*rate,trigger:'end'}} : {}),
      ...(r.kagura === 'protection' ? {values:{cut:rate}} : {}),
    });
  }
  if (skill.id === 'shrine_maiden_A09') for (const t of living.filter(t=>t!==actor)) {
    const targetMember=game.party[t];
    targetMember.mp+=Math.min(r.restore,Math.floor(maxMp(data,targetMember)*r.mpRestoreCapMaxMp),
      maxMp(data,targetMember)-targetMember.mp);
  }
  if (skill.id === 'shrine_maiden_U01') for (const t of living)
    grantMasterEffect(b,t,skill.id,{source:actor,remaining:r.preventNextStatus.turns,preventCharges:1});
  if (a.advancedAction?.soulSpent && !skill.isFinal) {
    const echo = mysticPassive(data,member,'necromancer_P05');
    if (echo) a.mysticDark={bonus:echo.bonus,remaining:echo.turns,grantedClock:b.actionClock};
  }
}
function summonCompanion(data,game,b,actor,turns,ultimate=false){
  const ally=b.allies[actor],member=game.party[actor],stats=battleStats(data,game,b,actor);
  const base=Math.floor(10+maxHp(data,member)*.10+stats.str*.25);
  const maximum=Math.max(1,Math.min(Math.floor(maxHp(data,member)*.30),
    Math.floor(base*(1+ruleNumber(data,member,'companion_hp')))));
  if(ultimate&&ally.companion?.hp>0){ally.companion.hp=ally.companion.maxHp;return;}
  ally.companion={hp:ultimate?Math.max(1,Math.floor(maximum*.5)):maximum,maxHp:maximum,
    remaining:turns,grantedClock:b.actionClock,guard:null};
}
function summonPuppet(data,game,b,actor,turns,ultimate=false){
  const ally=b.allies[actor],member=game.party[actor],stats=battleStats(data,game,b,actor);
  const base=Math.floor(10+stats.def*.8);
  const maximum=Math.max(1,Math.min(Math.floor(maxHp(data,member)*.30),
    Math.floor(base*(1+ruleNumber(data,member,'puppet_hp')))));
  if(ultimate&&ally.puppet?.hp>0){ally.puppet.hp=ally.puppet.maxHp;ally.puppet.stance='attack';
    ally.puppet.remaining=Math.max(ally.puppet.remaining,turns);return;}
  ally.puppet={hp:ultimate?Math.max(1,Math.floor(maximum*.5)):maximum,maxHp:maximum,
    remaining:turns,grantedClock:b.actionClock,stance:'attack',guard:null};
}
function applyCompanionSkillRules(data,game,b,actor,skill,target,cm,action,living){
  if(!['beastmaster','puppeteer','dancer'].includes(skill.job))return;
  const rule=skill.effect.rules??{},ally=b.allies[actor],member=game.party[actor];
  if(rule.companion_summon)summonCompanion(data,game,b,actor,rule.companion_summon.turns);
  if(rule.companion_guard&&ally.companion)ally.companion.guard={target,remaining:rule.companion_guard.turns,
    placedClock:b.actionClock};
  if(rule.companion_repair&&ally.companion){ally.companionRepairs=(ally.companionRepairs??0)+1;
    ally.companion.hp=Math.min(ally.companion.maxHp,ally.companion.hp+
      Math.floor(ally.companion.maxHp*rule.companion_repair.rate*cm));}
  if(rule.party_next_cut)for(const t of living)grantMasterEffect(b,t,`${skill.id}:cut`,{
    values:{cut:rule.party_next_cut*cm},source:actor,remaining:1});
  if(rule.puppet_summon)summonPuppet(data,game,b,actor,rule.puppet_summon.turns);
  if(rule.puppet_stance&&ally.puppet)ally.puppet.stance=rule.puppet_stance;
  if(rule.puppet_guard&&ally.puppet)ally.puppet.guard={target,remaining:rule.puppet_guard.turns,
    placedClock:b.actionClock};
  if(rule.puppet_repair&&ally.puppet){ally.puppetRepairs=(ally.puppetRepairs??0)+1;
    ally.puppet.hp=Math.min(ally.puppet.maxHp,ally.puppet.hp+
      Math.floor(ally.puppet.maxHp*rule.puppet_repair.rate*cm));}
  if(rule.puppet_quick_stance&&ally.puppet){ally.puppet.stance=action.element;
    ally.puppetQuick={bonus:rule.puppet_quick_stance.bonus*cm,remaining:rule.puppet_quick_stance.turns,
      grantedClock:b.actionClock};}
  if(rule.puppet_shield){
    const def=battleStats(data,game,b,actor).def;
    const base=Math.floor(10+.5*member.lv+def);
    const bonus=ally.puppetQuick?.bonus??0;
    for(const t of living){const amount=Math.min(masterShieldRoom(data,game,b,t,skill.id),
      Math.floor(base*rule.puppet_shield.m*(1+bonus)*cm));
      if(amount>0)grantMasterEffect(b,t,skill.id,{shield:amount,source:actor,remaining:rule.puppet_shield.turns});
    }
    if(ally.puppetQuick)delete ally.puppetQuick;
  }
  if(rule.puppet_attack&&ally.puppetQuick)delete ally.puppetQuick;
  if(rule.puppet_slow&&b.enemies[target]?.hp>0&&chance(b,enemyStatusChance(data,b.enemies[target],b.round,'statdown',rule.puppet_slow.rate*cm))){
    b.enemies[target].masterDebuffs??={};b.enemies[target].masterDebuffs[skill.id]={stat:'spd',
      value:rule.puppet_slow.value,turns:rule.puppet_slow.turns};
  }
  const step=1+ruleNumber(data,member,'step_bonus');
  if(rule.dance_spd)for(const t of living)grantMasterEffect(b,t,skill.id,{values:{spd:rule.dance_spd*step*cm},
    source:actor,remaining:1});
  if(rule.dance_evasion)grantMasterEffect(b,target,skill.id,{values:{eva:rule.dance_evasion*step*cm},
    source:actor,remaining:1});
  if(rule.dance_next_damage)for(const t of living)grantMasterEffect(b,t,`${skill.id}:damage`,{
    nextDamage:{tag:'',rate:(rule.dance_next_damage+(ally.advancedAction?.rhythmSpent??0)*(rule.rhythm_bonus??0))*cm},
    source:actor,remaining:2});
  if(rule.dance_ultimate){
    const cureable=new Set(['poison','toxic','burn','bleed','curse','bind','fear','silence','blind','confusion','charm','weaken']);
    for(const t of living){
      const id=Object.keys(b.allies[t].statuses).filter(key=>cureable.has(key))
        .sort((a,c)=>(b.allies[t].statuses[a].turns??0)-(b.allies[t].statuses[c].turns??0)||a.localeCompare(c))[0];
      if(id)cureAlly(data,game,b,t,status=>status.id===id);
      grantMasterEffect(b,t,`${skill.id}:damage`,{nextDamage:{tag:'',rate:.10*cm},source:actor,remaining:2});
    }
    for(const e of livingEnemies(b))inflictByActor(data,game,b,actor,e,['charm',.35],cm);
  }
}
function arcaneShield(data,game,b,actor,target,skill,rate,turns){
  const stats=battleStats(data,game,b,actor),formula=data.basicJobRules.protection;
  const base=Math.floor(formula.base+formula.per_level*game.party[actor].lv+formula.stat_scale*stats.res);
  const amount=Math.min(masterShieldRoom(data,game,b,target,skill.id),Math.floor(base*rate));
  if(amount>0)grantMasterEffect(b,target,skill.id,{skillId:skill.id,source:actor,shield:amount,remaining:turns});
}
function arcaneFamiliar(data,game,b,actor,skill,rule,cm,mode){
  const member=game.party[actor],passive=passiveRules(data,member).find(p=>p.familiar_on_summon)?.familiar_on_summon;
  const mag=battleStats(data,game,b,actor).mag,spell=spellPower(data,member)+scytheSpellPower(data,member);
  b.allies[actor].familiar={mode,uses:rule.charges,remaining:rule.turns,grantedClock:b.actionClock,
    skillId:skill.id,cm,power:mag+spell,m:rule.power+(passive?.powerAdd??0),
    mischiefRate:.7+(passive?.statusRateAdd??0),mischiefBonus:passive?.statusRateAdd??0};
}
function arcaneMark(data,game,b,actor,target,skill,rule,cm){
  const enemy=b.enemies[target];if(!enemy?.hp)return;
  const power=rule.power??0,extra=rule.variant==='bitter'?ruleNumber(data,game.party[actor],'bitter_mark_power'):0;
  const stats=battleStats(data,game,b,actor);
  const next={variant:rule.variant,skillId:skill.id,source:actor,remaining:rule.turns,uses:rule.charges,
    grantedEnemyClock:b.enemyActionClock??0,cm,power:stats.mag+spellPower(data,game.party[actor]),
    m:power+extra,status:rule.status??null,
    statRate:(memberMods(data,game.party[actor]).stat_rate??0)+affixSum(game.party[actor],'STATUS_RATE')/100};
  enemy.curseMarks??={};const old=enemy.curseMarks[actor];
  if(old?.variant===next.variant&&old.m*old.cm>next.m*next.cm)return;
  if(old?.variant===next.variant&&old.m*old.cm===next.m*next.cm)next.remaining=Math.max(old.remaining,next.remaining);
  enemy.curseMarks[actor]=next;
}
function applyArcaneSkillRules(data,game,b,actor,skill,target,cm,action,living){
  const rules=skill.effect.rules??{},ally=b.allies[actor],state=ally.advancedAction;
  if(rules.field||rules.after_field){
    const rule=rules.field??rules.after_field,element=rules.field?.element??skill.effect.element;
    const old=b.field,next={element,rate:rule.rate,remaining:rule.turns,source:actor,skillId:skill.id,grantedClock:b.actionClock};
    if(old?.element===element&&old.rate>next.rate){} else {
      if(old?.element===element&&old.rate===next.rate)next.remaining=Math.max(old.remaining,next.remaining);
      b.field=next;
    }
  }
  if(rules.field_guard){
    const field=activeField(game,b);
    for(const t of living)grantMasterEffect(b,t,skill.id,{skillId:skill.id,source:actor,party:true,
      fieldGuard:{element:field.element,rate:rules.field_guard.snapshotFieldSourceCut*cm},remaining:rules.field_guard.turns});
  }
  if(rules.release_field && state.releasedField)grantMasterEffect(b,actor,skill.id,{skillId:skill.id,
    conditionalMagic:{elements:[state.releasedField.element],rate:rules.release_field.nextMagicDamage.rate*cm},
    remaining:rules.release_field.nextMagicDamage.turns});
  if(rules.familiar||rules.after_familiar)arcaneFamiliar(data,game,b,actor,skill,rules.familiar??rules.after_familiar,
    cm,rules.familiar?action.element:'pursuit');
  if(rules.familiar_mode&&ally.familiar)ally.familiar.mode=action.element;
  if(rules.familiar_shield)arcaneShield(data,game,b,actor,actor,skill,rules.familiar_shield.power*cm,rules.familiar_shield.turns);
  if(rules.release_familiar&&state.releasedFamiliar>0)grantMasterEffect(b,actor,skill.id,{skillId:skill.id,
    conditionalMagic:{elements:['none','fire','ice','wind','earth','thunder','water','light','dark'],
      rate:Math.min(rules.release_familiar.nextMagicDamage.cap,
        state.releasedFamiliar*rules.release_familiar.nextMagicDamage.perCharge)*cm},
    remaining:rules.release_familiar.nextMagicDamage.turns});
  if(rules.curse_mark){
    const targets=(action.targets??[target]).slice(0,rules.curse_mark.targetLimit??1);
    for(const t of targets)arcaneMark(data,game,b,actor,t,skill,rules.curse_mark,cm);
  }
  if(rules.hex_debuff && b.enemies[target]?.hp>0){
    const rule=rules.hex_debuff,enemy=b.enemies[target];
    if(chance(b,enemyStatusChance(data,enemy,b.round,'statdown',rule.rate*cm))){
      enemy.masterDebuffs??={};const key=skill.id+':str',old=enemy.masterDebuffs[key];
      if(!old||old.value<=rule.value)enemy.masterDebuffs[key]={stat:'str',value:rule.value,turns:Math.max(old?.turns??0,rule.turns)};
      log(b,enemy.name+'のSTRが下がった');
    }
  }
  if(rules.release_curse&&state.releasedMark)grantMasterEffect(b,actor,skill.id,{skillId:skill.id,
    conditionalMagic:{elements:rules.release_curse.nextMagicDamage.elements,
      rate:rules.release_curse.nextMagicDamage.rate*cm},remaining:rules.release_curse.nextMagicDamage.turns});
  if(rules.after_curse)for(const t of state.primaryDamageTargets??[])
    if(b.enemies[t]?.hp>0)arcaneMark(data,game,b,actor,t,skill,rules.after_curse,cm);
  if(rules.after_party_shield)for(const t of living)
    arcaneShield(data,game,b,actor,t,skill,rules.after_party_shield.power*cm,rules.after_party_shield.turns);
}

/** status_effects.csv の cure 列（「毒消し・万能薬・清めの光」）にその名前があるか */
export function curedBy(st, name) {
  return String(st.cure ?? '').split('・').map((x) => x.trim()).includes(name);
}

function cureAlly(data, game, b, j, pred) {
  const a = b.allies[j];
  let cured = 0;
  for (const id of Object.keys(a.statuses)) {
    const st = data.statusEffects.get(id);
    if (st && pred(st)) { delete a.statuses[id]; cured += 1; }
  }
  const m = game.party[j];
  m.persist = (m.persist ?? []).filter((id) => a.statuses[id]);
  for (const id of Object.keys(m.persistState ?? {})) if (!a.statuses[id]) delete m.persistState[id];
  log(b, cured ? `${m.name}の状態異常が治った` : `${m.name}には効果がなかった`);
}

// ---------------- 道具 ----------------
function doItem(data, game, b, i, it, target, cm) {
  const m = game.party[i];
  if (!game.items[it.id]) { log(b, `${it.name}を持っていない`); return; }
  const preserve = partyPassive(data, game, b, 'save');
  if (!(preserve > 0 && chance(b, preserve))) game.items[it.id] -= 1;
  if (game.items[it.id] <= 0) delete game.items[it.id];
  log(b, `${m.name}は${it.name}を使った`);
  cm *= 1 + (memberMods(data, m).itemp ?? 0); // 薬の知識
  const one = game.party[target] ? target : i;
  const alive = game.party.map((x, j) => j).filter((j) => canAct(game, b, j));
  const [elOrGroup, num] = String(it.valueText ?? '').split(':');
  const turns = (it.turns ?? 1) + 1;
  switch (it.effect) {
    case 'heal_hp': log(b, `HPが ${healAlly(data, game, b, one, it.value * cm)} 回復`); break;
    case 'heal_hp_pct': log(b, `HPが ${healAlly(data, game, b, one, maxHp(data, game.party[one]) * it.value / 100 * cm)} 回復`); break;
    case 'heal_hp_all': for (const j of alive) healAlly(data, game, b, j, it.value * cm); log(b, '味方全員のHPが回復した'); break;
    case 'heal_hp_all_pct': for (const j of alive) healAlly(data, game, b, j, maxHp(data, game.party[j]) * it.value / 100 * cm); log(b, '味方全員のHPが回復した'); break;
    case 'heal_mp': case 'heal_mp_pct': {
      const t = game.party[one];
      const mx = maxMp(data, t);
      const v = Math.round((it.effect === 'heal_mp' ? it.value : mx * it.value / 100) * cm);
      t.mp = Math.min(mx, t.mp + v);
      log(b, `${t.name}のMPが ${v} 回復`);
      break;
    }
    case 'revive_pct': {
      const t = game.party[one];
      if (t.hp > 0 || isPetrified(b, one)) { log(b, 'しかし効果がなかった'); break; }
      t.hp = Math.max(1, Math.round(maxHp(data, t) * it.value / 100 * cm));
      log(b, `${t.name}が起き上がった`);
      break;
    }
    case 'cure_status':
      // 治せるのは status_effects.csv の cure 列にこの道具の名前があるもの
      cureAlly(data, game, b, one, (st) => curedBy(st, it.name));
      break;
    case 'resist_elem_all': putBuff(b.partyBuffs, `eres:${elOrGroup}`, Number(num) / 100 * cm, turns); log(b, '味方全員が守りの香に包まれた'); break;
    case 'resist_status_all': putBuff(b.partyBuffs, `sres:${elOrGroup}`, Number(num) / 100 * cm, turns); log(b, '味方全員が守りの香に包まれた'); break;
    default:
      if (it.effect.startsWith('buff_')) {
        const k = it.effect.slice(5);
        putBuff(b.allies[one].buffs, k, it.value / 100 * cm, turns);
        log(b, `${game.party[one].name}の力が上がった`);
      } else log(b, 'しかし何も起こらなかった');
  }
}

// ---------------- 逃げる ----------------
function doFlee(data, game, b, correct, actor) {
  const p = fleeRate(data, game, b, actor);
  if (chance(b, correct ? p : p / 2)) { b.result = 'fled'; log(b, 'うまく逃げ切った！'); } else log(b, '逃げられなかった！');
}

// ---------------- 敵の番 ----------------
/** ボスの大技は固定周期。画面も同じ関数から次の行動を予告できる。 */
export function enemyIntent(data, enemy, round) {
  const rule = data.balance.boss_patterns ?? {};
  const every = Math.max(2, Number(rule.sweep_every ?? 3));
  const sweepMp = Number(rule.sweep_mp ?? 4);
  const enabled = rule.enabled !== false && enemy.boss && (enemy.mp ?? Infinity) >= sweepMp;
  const locked = enemy.statuses?.fear || (enemy.magicRate >= 0.5 ? enemy.statuses?.silence : enemy.statuses?.seal);
  const sweep = Boolean(enabled && !locked && round > 0 && round % every === 0);
  const warning = Boolean(enabled && !locked && round > 0 && (round + 1) % every === 0);
  const element = enemy.attackElement;
  const elementName = element ? data.elements.get(element)?.name ?? element : '';
  return { sweep, warning, mp: sweep ? sweepMp : 0, power: sweep ? Number(rule.sweep_power ?? 0.65) : 1,
    label: sweep ? `全体${elementName || '強'}攻撃` : warning ? `次の巡に全体${elementName || '強'}攻撃` : '通常攻撃' };
}

function finishEnemyTurn(enemy, data, b) {
  tickStatuses(data, b, enemy, enemy.name);
  tick(enemy.debuffs);
  if (enemy.buffs) tick(enemy.buffs);
  for (const collection of ['masterDebuffs', 'masterMarks']) for (const [key, state] of Object.entries(enemy[collection] ?? {})) {
    if (--state.turns <= 0) delete enemy[collection][key];
  }
  if (enemy.baseMaxHp && !Object.keys(enemy.statuses).some((id) => data.statusEffects.get(id)?.kind === 'maxhp_down')) {
    enemy.maxHp = enemy.baseMaxHp;
    delete enemy.baseMaxHp;
  }
}

function finishArcaneEnemy(data,game,b,index,{performed=false,magic=false,physical=false}={}){
  const enemy=b.enemies[index];
  for(const [owner,mark] of Object.entries(enemy.curseMarks??{})){
    const actor=Number(owner),ready=performed && enemy.hp>0 && mark.uses>0
      && arcaneReactionAllowed(game,b,actor) && b.allies[actor].counteredEnemyClock!==b.enemyActionClock;
    const matches=mark.variant==='bitter'||mark.variant==='binding'&&physical||mark.variant==='silencing'&&magic;
    if(ready&&matches){
      mark.uses--;
      let effective=false;
      if(mark.variant==='bitter'){
        const before=enemy.hp,defense=enemy.res*statModifier(data,bval(enemy.buffs??{},'res'),
          enemyStatDebuff(data,enemy,'res'),enemy.boss);
        const damage=Math.max(0,Math.round(evaluate(f(data,'ally_damage'),{
          atk:mark.power*mark.m*mark.cm,em:1,df:defense,crit:1,r:between(b,f(data,'ally_rand'))})));
        hitEnemy(data,game,b,actor,index,damage,{prefix:'苦呪印の反応！',elements:['none'],allowKillEffects:false});
        effective=enemy.hp<before;
      }else{
        const id=mark.status.id,existed=Boolean(enemy.statuses[id]);
        const applied=inflictEnemy(data,b,index,[id,mark.status.rate],mark.cm,mark.statRate??0,{actor});
        if(applied&&enemy.statuses[id])
          enemy.statuses[id].turns=enemy.boss&&CONTROL_KINDS.has(data.statusEffects.get(id)?.kind)
            ?Math.min(1,mark.status.turns):mark.status.turns;
        effective=applied&&!existed;
      }
      if(effective && b.allies[actor].curseBuffRound!==b.round){
        const bonus=passiveRules(data,game.party[actor]).find(p=>p.after_effective_curse)?.after_effective_curse;
        if(bonus){
          b.allies[actor].curseBuffRound=b.round;
          grantMasterEffect(b,actor,'hexer_P01',{skillId:'hexer_P01',values:bonus.values,remaining:bonus.turns});
        }
      }
    }
    if(--mark.remaining<=0||mark.uses<=0||enemy.hp<=0)delete enemy.curseMarks[owner];
  }
  finishEnemyTurn(enemy,data,b);
}
function absorbCompanionGuard(data,game,b,target,damage){
  const options=[];
  for(let owner=0;owner<game.party.length;owner++){
    if(game.party[owner].hp<=0)continue;
    for(const kind of ['companion','puppet','machine']){
      const unit=b.allies[owner][kind],guard=unit?.guard;
      if(!unit?.hp||!guard?.remaining||guard.target!==target||guard.usedClock===b.enemyActionClock)continue;
      options.push({owner,kind,unit,guard});
    }
    const decoy=b.allies[owner].decoy;
    if(decoy?.hp>0&&decoy.remaining>0&&decoy.uses>0&&decoy.target===target&&decoy.usedClock!==b.enemyActionClock)
      options.push({owner,kind:'decoy',unit:decoy,guard:{placedClock:decoy.placedClock}});
  }
  if(!options.length)return damage;
  const chosen=options.sort((a,c)=>c.guard.placedClock-a.guard.placedClock||c.owner-a.owner)[0];
  const cut=chosen.kind==='decoy'?0:chosen.kind==='machine'?0:ruleNumber(data,game.party[chosen.owner],chosen.kind==='companion'?'companion_cover_cut':'puppet_cover_cut');
  const incoming=Math.max(1,Math.round(damage*(1-Math.min(.70,cut))));
  const deviceReduction=chosen.kind==='machine'&&chosen.unit.mode==='guard'?(chosen.unit.modeBonus??0):0;
  const absorbed=Math.min(incoming,Math.floor(chosen.unit.hp/(1-deviceReduction)));
  chosen.unit.hp-=Math.min(chosen.unit.hp,Math.max(1,Math.round(absorbed*(1-deviceReduction))));
  if(chosen.kind==='decoy'){
    chosen.unit.usedClock=b.enemyActionClock;chosen.unit.uses--;
    const owner=game.party[chosen.owner],record=b.allies[chosen.owner];
    if(absorbed>0&&(record.decoyMpTriggers??0)<3){record.decoyMpTriggers=(record.decoyMpTriggers??0)+1;
      owner.mp=Math.min(maxMp(data,owner),owner.mp+ruleNumber(data,owner,'decoy_mp_gain'));}
  }else chosen.guard.usedClock=b.enemyActionClock;
  log(b,`${game.party[chosen.owner].name}の${chosen.kind==='companion'?'相棒':chosen.kind==='puppet'?'人形':chosen.kind==='machine'?'装置':'囮'}が${game.party[target].name}への${absorbed}ダメージを引き受けた`);
  if(chosen.unit.hp<=0)delete b.allies[chosen.owner][chosen.kind];
  if(chosen.kind==='decoy'&&chosen.unit.uses<=0)delete b.allies[chosen.owner].decoy;
  return chosen.kind==='machine'?Math.max(0,Math.round((incoming-absorbed)*(1-[0,.10,.15,.20][passiveRules(data,game.party[chosen.owner]).find(x=>x.skill.id==='machinist_P04')?.trio?.level??0]))):incoming-absorbed;
}
function finishCompanionEnemyAction(b){
  for(const ally of b.allies)for(const kind of ['companion','puppet','machine']){
    const guard=ally[kind]?.guard;
    if(guard&&--guard.remaining<=0)delete ally[kind].guard;
  }
  for(const ally of b.allies)if(ally.decoy&&--ally.decoy.remaining<=0)delete ally.decoy;
}
function enemyTurn(data, game, b, e) {
  const enemy = b.enemies[e];
  const trapBlocked = ['sleep','freeze','stun','petrify'].some(id=>enemy.statuses[id]);
  b.enemyActionClock = (b.enemyActionClock ?? 0) + 1;
  const finish=(intent={})=>{finishCompanionEnemyAction(b);finishArcaneEnemy(data,game,b,e,intent);finishCivicEnemy(b,e);};
  snapshotCloneDefense(b);
  // 罠は対象の行動機会に一度発動。反撃や資源蓄積を再帰させない。
  const triggered = (b.masterTraps ?? []).filter(trap => trap.target === e);
  b.masterTraps = (b.masterTraps ?? []).filter(trap => trap.target !== e);
  for (const trap of triggered) {
    if (game.party[trap.actor]?.hp <= 0 || enemy.hp <= 0) continue;
    const result = attackDamage(data, game, b, trap.actor, e, trap.skill, trap.cm);
    hitEnemy(data, game, b, trap.actor, e, result.damage, { ...result, prefix: '仕掛け罠！' });
    if (result.landed && result.damage > 0) applyAttackStatuses(data, game, b, trap.actor, e, trap.skill.effect, trap.cm);
  }
  if(enemy.hp<=0)return;
  enemy.maxMp ??= enemyMpCapacity(enemy.lv, enemy.boss);
  enemy.mp ??= enemy.maxMp;
  // 複数の継続ダメージを合わせた上限。特化は強いが割合ダメージだけの即殺を防ぐ。
  let dotRoom = Math.max(1, Math.round(enemy.maxHp * f(data, 'dot_tick_cap')));
  for (const [id, state] of Object.entries(enemy.statuses)) {
    const st = data.statusEffects.get(id);
    if (START_DOT.has(st?.kind)) {
      const desired = Math.round(enemy.maxHp * st.value * (enemy.boss ? f(data, 'boss_dot_mul') : 1)
        * (state.n ?? 1) * (state.potency ?? 1));
      const dealt = Math.min(enemy.hp, dotRoom, desired);
      if (dealt > 0) recordHit(b, 'enemy', e, dealt, state.actor == null ? undefined : { side: 'ally', i: state.actor });
      enemy.hp = Math.max(0, enemy.hp - dealt);
      dotRoom -= dealt;
      if (st.kind === 'dot_rising') state.n = Math.min(3, (state.n ?? 1) + 1);
      if (dealt > 0) log(b, `${enemy.name}は${st.name}で ${dealt}のダメージ`);
      if (enemy.hp <= 0) {
        const owner = game.party[state.actor];
        if (owner) {
          addMasteryKill(data, owner);
          owner.mp = Math.min(maxMp(data, owner), owner.mp + (memberMods(data, owner).kill_mp ?? 0));
          spreadPoison(data, game, b, state.actor, enemy);
        }
        break;
      }
    }
  }
  updateMp(data, enemy.statuses, enemy, enemy.maxMp, enemy.mpRegen ?? 0);
  if (enemy.regen && enemy.hp > 0 && !enemy.statuses.petrify && !has(enemy, 'noheal', data)) {
    enemy.hp = Math.min(enemy.maxHp, Math.round(enemy.hp + enemy.maxHp * enemy.regen));
  }
  const skip = enemy.hp > 0 && (blockedAction(data, b, enemy) || (trapBlocked ? {name:'行動不能'} : null));
  if (enemy.hp <= 0 || skip) {
    if (skip && enemy.boss) enemy.controlGuardUntil = b.round + 1;
    log(b, skip ? enemy.name + 'は' + skip.name + 'で動けない' : enemy.name + 'を倒した！');
    finish();
    return;
  }

  const forced = forcedAction(data, b, enemy);
  const forcedTargets = forced ? livingEnemies(b).filter((i) => i !== e || forced.kind === 'random_target')
    .map((i) => ({ side: 'enemy', i })) : null;
  if (forced?.kind === 'random_target') {
    game.party.forEach((_, i) => { if (canAct(game, b, i) && (enemy.sureHit || !isAirborne(b,i))) forcedTargets.push({ side: 'ally', i }); });
  }
  if (forcedTargets?.length === 0) {
    finish();
    return;
  }
  const bleed = data.statusEffects.get(statusOfKind(enemy, 'dot_on_action', data));
  if (bleed) {
    const state = enemy.statuses[bleed.id];
    const damage = Math.min(enemy.hp, dotRoom, Math.max(1, Math.round(enemy.maxHp * bleed.value * (state.potency ?? 1)
      * (enemy.boss ? f(data, 'boss_dot_mul') : 1))));
    if (damage > 0) {
      enemy.hp -= damage;
      recordHit(b, 'enemy', e, damage);
      log(b, `${enemy.name}は出血で ${damage}のダメージ`);
    }
    const owner = game.party[state.actor];
    if (enemy.hp === 0 && owner) {
      addMasteryKill(data, owner);
      owner.mp = Math.min(maxMp(data, owner), owner.mp + (memberMods(data, owner).kill_mp ?? 0));
      spreadPoison(data, game, b, state.actor, enemy);
    }
  }
  let forcedMagic=false;
  if (forced && enemy.hp > 0) {
    const target = pick(b, forcedTargets);
    const magic = forced.kind === 'charm' && (enemy.mp ?? 0) >= 2 && chance(b, enemy.magicRate);
    forcedMagic=magic;
    if (magic) enemy.mp -= 2;
    const victim = target.side === 'ally' ? battleStats(data, game, b, target.i) : b.enemies[target.i];
    const damage = Math.max(1, Math.round((magic ? enemy.mag : enemy.str) * f(data, 'confused_self_hit') * 100 / (100 + (magic ? victim.res : victim.def))));
    const prefix = enemy.name + 'の' + forced.name + 'による攻撃！ ';
    if (target.side === 'enemy') hitEnemy(data, game, b, null, target.i, damage, { prefix });
    else damageAlly(data, game, b, target.i, damage, prefix + game.party[target.i].name + 'に');
    if (enemy.boss) enemy.controlGuardUntil = b.round + 1;
  }
  if (forced || enemy.hp <= 0) {
    finish({performed:enemy.hp>0,magic:forcedMagic,physical:!forcedMagic});
    return;
  }

  const alive = game.party.map((x, j) => j).filter((j) => game.party[j].hp > 0);
  if (!alive.length) { finish(); return; }
  const intent = enemyIntent(data, enemy, b.round);
  if (!intent.sweep && enemy.tactics && (enemy.mp ?? 0) >= 3 && !enemy.statuses.silence && !enemy.statuses.fear) {
    const friend = enemy.tactics === 'heal' && b.enemies.find((unit) => enemyCanAct(unit) && !unit.statuses.curse && unit.hp <= unit.maxHp * 0.55);
    const ward = enemy.tactics === 'ward' && !enemy.buffs?.str && b.round % 3 === 1;
    const disrupt = enemy.tactics === 'disrupt' && b.round % 3 === 2;
    if (friend || ward || disrupt) {
      enemy.mp -= 3;
      if (ward) {
        putBuff(enemy.buffs ??= {}, 'str', 0.25, 3);
        if (enemy.lastWeakElement) {
          putBuff(enemy.buffs, 'guard:' + enemy.lastWeakElement, 1, 3);
          log(b, enemy.name + 'は' + (data.elements.get(enemy.lastWeakElement)?.name ?? enemy.lastWeakElement) + 'への守りを固めた');
        } else log(b, enemy.name + 'は力を高めた');
      } else if (disrupt) {
        const index = pick(b, alive);
        if (chance(b, allyStatusChance(data, game, b, index, 'statdown', 1))) {
          putBuff(b.allies[index].buffs, 'down:str', 0.25, 3);
          log(b, enemy.name + 'の妨害で' + game.party[index].name + 'の力が下がった');
        } else log(b, game.party[index].name + 'は妨害を防いだ');
      } else {
        friend.hp = Math.min(friend.maxHp, friend.hp + Math.round(friend.maxHp * 0.2));
        log(b, enemy.name + 'は' + friend.name + 'を回復した');
      }
      finish({performed:true,magic:true});
      return;
    }
  }
  if (intent.warning) log(b, `${enemy.name}が力をためている！ 次の巡は全体攻撃`);
  if (intent.sweep && Number.isFinite(enemy.mp)) enemy.mp -= intent.mp;
  if (intent.sweep) log(b, `${enemy.name}の${intent.label}！`);
  const tauntedBy = enemy.statuses.taunt?.actor;
  const eligible=alive.filter(index=>enemy.sureHit || !isAirborne(b,index));
  const tauntValid = eligible.includes(tauntedBy) && !['sleep', 'freeze', 'petrify', 'stun', 'paralysis'].some(id => b.allies[tauntedBy].statuses[id]);
  const lure=enemy.decoyLure,decoy=lure&&b.allies[lure.owner]?.decoy;
  const lured=!intent.sweep&&!intent.targetFixed&&decoy?.hp>0&&eligible.includes(decoy.target)
    &&chance(b,Math.min(.90,enemyStatusChance(data,enemy,b.round,'taunt',lure.rate,true)))?decoy.target:null;
  if(lure)delete enemy.decoyLure;
  const targets = intent.sweep ? alive : eligible.length ? [lured??(tauntValid ? tauntedBy : weighted(b, eligible, (j) => 1 + bval(b.allies[j].buffs, 'taunt') * f(data, 'taunt_weight')))] : [];
  if (!targets.length) {log(b,`${enemy.name}の攻撃は届かなかった`);finish();return;}
  const actionMagic = chance(b, enemy.magicRate) && !enemy.statuses.silence && (intent.sweep || (enemy.mp ?? Infinity) >= 2);
  if (actionMagic && !intent.sweep && Number.isFinite(enemy.mp)) enemy.mp -= 2;
  const stanceReactions = [], gearReactions = [];
  for (const original of targets) {
    if (!enemy.sureHit && isAirborne(b,original)) {log(b,`${game.party[original].name}は空中で攻撃を避けた`);continue;}
    let t = original;
    let cover = 1;
    const bt = data.balance.battle;
    const magic = actionMagic;
    const masterCover = !intent.sweep ? masterCoverTarget(data, game, b, original, magic) : null;
    if (masterCover && chance(b, masterCover.rate)) {
      t = masterCover.actor;
      onMasterCover(data, game, b, t);
      log(b, `${game.party[t].name}が${game.party[original].name}をかばった！`);
    }
    const coverRate = (j) => Math.min(0.9, Math.max(!data.basicJobRules && game.party[j].job === 'knight' ? bt.knight_cover_rate : 0, memberMods(data, game.party[j]).cover ?? 0));
    const knight = !intent.sweep && alive.find((j) => j !== t && !isAirborne(b,j) && coverRate(j) > 0 && canAct(game, b, j)
      && !has(b.allies[j], 'skip_until_hit', data) && !has(b.allies[j], 'skip_once', data));
    if (!masterCover && knight !== false && knight != null && chance(b, coverRate(knight))) {
      t = knight; cover = 1 - bt.knight_cover_cut;
      log(b, `${game.party[t].name}がかばった！`);
    }
    const target = game.party[t];
    if (target.hp <= 0) continue;
    const ta = b.allies[t];
    const ts = battleStats(data, game, b, t);
    if (ta.counterRound !== b.round) { ta.counterRound = b.round; ta.counterCount = 0; }
    const sharedCounterCap = data.basicJobRules?.caps?.counter_per_round ?? Infinity;
    const sureHit=Boolean(enemy.sureHit);
    const shadow=cloneDefense(b,t,{single:!intent.sweep,sureHit});
    if (shadow.substitute) {log(b,`${target.name}は影替わりで攻撃を防いだ`);continue;}
    if (!sureHit && !magic && enemy.statuses.blind && chance(b, data.statusEffects.get('blind').value)) { log(b, `${enemy.name}の攻撃ははずれた`); continue; }
    if (!sureHit && !has(ta, 'noevade_noflee', data) && chance(b, Math.min(f(data, 'evasion_cap'), ts.evasion + targetedEvasion(b, t, e) + shadow.evasion))) {
      log(b, `${target.name}はひらりとかわした`);
      const retaliation = Math.min(f(data, 'evade_counter_cap'), affixSum(target, 'EVA_COUNTER') / 100);
      gearReactions.push(() => {
      if (!magic && enemy.hp > 0 && canAct(game, b, t) && ta.evadeCounterRound !== b.round
        && ta.counterCount < sharedCounterCap && retaliation > 0 && chance(b, retaliation)) {
        ta.evadeCounterRound = b.round;
        ta.counterCount += 1;
        ta.counteredEnemyClock=b.enemyActionClock;
        // 回避反撃は一巡一回。初撃・技能準備・追撃・吸収・MP回復を呼び出さない。
        const r = attackDamage(data, game, b, t, e, null,
          f(data, 'evade_counter_power') * (1 + (memberMods(data, target).counter_power ?? 0)));
        hitEnemy(data, game, b, t, e, r.damage, { ...r, prefix: `${target.name}の回避反撃！${describeHit(r)}` });
      }
      });
      if (enemy.hp <= 0) break;
      continue;
    }
    const burn = !magic && enemy.statuses.burn ? 1 - OLD_DOWN_RATE : 1;
    const atk = (magic ? enemy.mag : enemy.str) * intent.power
      * statModifier(data, bval(enemy.buffs ?? {}, magic ? 'mag' : 'str'),
        enemyStatDebuff(data, enemy, magic ? 'mag' : 'str') + (1 - burn), enemy.boss)
      * (enemy.statuses.fear ? 0.8 : 1);
    const df = magic ? ts.res : ts.def;
    const gearCut = affixSum(target, magic ? 'MAGIC_CUT' : 'PHYS_CUT') / 100;
    const counterStance = !magic && !isAirborne(b,t) && ta.masterCounter && !ta.masterCounterUsed
      && (ta.masterCounter.target == null || ta.masterCounter.target === e) ? ta.masterCounter : null;
    const incomingElements = Array.isArray(enemy.attackElement) ? enemy.attackElement : String(enemy.attackElement ?? '').split('|');
    const orderCut=!intent.sweep&&t===original?Math.max(ta.strategistOrder?.type==='guard'?ta.strategistOrder.rate:0,
      ta.strategistUltimate?.guard??0):0;
    const cut = 1 - Math.min(f(data, 'damage_cut_cap'), bval(b.partyBuffs, 'cut') + bval(ta.buffs, 'cut')
      + (memberMods(data, target).damage_cut ?? 0) + gearCut + (magic ? 0 : bval(ta.buffs, 'pcut'))
      + masterBuff(data, game, b, t, 'cut') + masterBuff(data, game, b, t, magic ? 'mcut' : 'pcut')
      + masterCutBonus(data, game, b, t, magic, e) + mysticCut(data, game, b, t, magic, incomingElements)
      + (counterStance?.cut ?? 0) + readGuardCut(b, t, magic, incomingElements)
      + (masterCover && t !== original ? masterCover.cover.cut ?? 0 : 0)+orderCut+civicIncomingCut(data,game,b,t,e)+natureIncomingCut(data,game,b,t));
    const ecut = allyElementMultiplier(data, game, b, t, enemy.attackElement, magic);
    const dmg = evaluate(f(data, 'enemy_damage'), { atk, df, r: between(b, f(data, 'enemy_rand')) })
      * Math.max(f(data, 'minimum_damage_share'), cover * cut * ecut)
      * (activeField(game,b) && incomingElements.includes(b.field.element)?1+b.field.rate:1);
    const elName = enemy.attackElement ? data.elements.get(enemy.attackElement)?.name : null;
    const beforeHp = target.hp;
    if(orderCut>0){if(ta.strategistOrder?.type==='guard')delete ta.strategistOrder;
      if(ta.strategistUltimate)delete ta.strategistUltimate.guard;}
    const remaining=!intent.sweep&&t===original ? absorbCompanionGuard(data,game,b,t,dmg) : dmg;
    if(remaining>0)damageAlly(data, game, b, t, remaining, `${enemy.name}の${magic ? `${elName ?? ''}魔法` : '攻撃'}！ ${target.name}に`, { side: 'enemy', i: e });
    if (target.hp < beforeHp) noteDuelHit(game, b, t, e);
    if (masterCover && t !== original && target.hp < beforeHp) onMasterCover(data, game, b, t, true);
    for (const id of Object.keys(ta.statuses)) if (data.statusEffects.get(id)?.kind === 'skip_until_hit') delete ta.statuses[id];
    if (target.hp <= 0) continue;
    const counter = Math.min(1, bval(ta.buffs, 'counter') + Math.min(f(data, 'counter_affix_cap'), affixSum(target, 'COUNTER') / 100));
    // 反撃から追撃・吸収・追加状態異常は発生しない。
    if (enemy.status) {
      const st = data.statusEffects.get(enemy.status);
      if (enemy.status === 'statdown' && chance(b, allyStatusChance(data, game, b, t, 'statdown', enemy.statusRate, ts))) {
        for (const key of ABILITY_KEYS) putBuff(ta.buffs, 'down:' + key, OLD_DOWN_RATE, 3);
        log(b, target.name + 'の能力が下がった');
      }
      if (st) {
        const inflicted = chance(b, allyStatusChance(data, game, b, t, st.id, enemy.statusRate, ts));
        consumeStatusPreparation(b, t, st.id);
         if (inflicted && !ta.statuses[st.id] && ta.masterEffects?.shrine_maiden_U01?.preventCharges && st.id !== 'petrify') {
           delete ta.masterEffects.shrine_maiden_U01;
           log(b, `${target.name}の予防札が${st.name}を防いだ`);
         } else if (inflicted) {
          const cur = ta.statuses[st.id];
          if (cur && st.kind === 'dot') { cur.n = Math.min(3, cur.n + 1); cur.turns = st.turns; } else ta.statuses[st.id] = { turns: st.turns, n: 1 };
          if (st.persists && !target.persist.includes(st.id)) {
            target.persist.push(st.id);
            if (st.kind === 'maxhp_down') target.hp = Math.min(target.hp, maxHp(data, target));
          }
          log(b, `${target.name}は${st.name}になった`);
        }
      }
    }
    stanceReactions.push(() => {
    if (!magic && enemy.hp > 0 && counterStance && canAct(game, b, t)
      && !['sleep', 'freeze', 'stun', 'petrify', 'confusion', 'charm'].some(id => ta.statuses[id])) {
      if (ta.counterRound !== b.round) { ta.counterRound = b.round; ta.counterCount = 0; }
      if ((ta.counterCount ?? 0) < Math.min(sharedCounterCap, counterStance.limit ?? 1)) {
        ta.counterCount = (ta.counterCount ?? 0) + 1;
        ta.counteredEnemyClock=b.enemyActionClock;
        const skill = { id: 'reaction', kind: 'attack', elements: counterStance.element ? [counterStance.element] : [],
          effect: { master: true, base: 'weapon', m: counterStance.m, element: counterStance.element, hits: [1], tags: ['reaction'] } };
        const result = attackDamage(data, game, b, t, e, skill, 1);
        hitEnemy(data, game, b, t, e, result.damage, { ...result, prefix: `${target.name}の反撃！` });
      }
    }
    if (counterStance?.once) { ta.masterCounterUsed = true; delete ta.masterCounter; }
    });
    gearReactions.push(() => {
    if (!magic && !isAirborne(b,t) && enemy.hp > 0 && canAct(game,b,t) && ta.counterCount < sharedCounterCap
      && (!counterStance || ta.counterCount < (counterStance.limit ?? 1)) && chance(b, counter)) {
      ta.counterCount += 1;
      ta.counteredEnemyClock=b.enemyActionClock;
      const r = attackDamage(data, game, b, t, e, null, f(data, 'counter_power') * (1 + (memberMods(data, target).counter_power ?? 0)));
      hitEnemy(data, game, b, t, e, r.damage, { ...r, prefix: `${target.name}の反撃！${describeHit(r)}` });
    }
    });
    if (enemy.hp <= 0) break;
  }
  // 全体・複数打撃の途中で治療を割り込ませない。構え→加護→装備の優先順。
  for (const react of stanceReactions) react();
  resolveBrokenBlessings(data,game,b,{
    heal:(actor,amount)=>{const healed=healAlly(data,game,b,actor,amount);if(healed)log(b,`${game.party[actor].name}の加護が砕け、HPが${healed}回復した`);},
    canReact:actor=>canAct(game,b,actor)&&!isAirborne(b,actor)&&!['sleep','freeze','stun','paralysis','confusion','charm'].some(id=>b.allies[actor].statuses[id]),
    react:(actor,target,counter)=>{
      const skill={id:'blessing_reaction',kind:'attack',elements:[counter.element],effect:{master:true,base:counter.base,m:counter.m,
        element:counter.element,tags:['reaction','qigong'],rules:{no_weapon_power:true},hits:[1]}};
      const result=attackDamage(data,game,b,actor,target,skill,1);
      hitEnemy(data,game,b,actor,target,result.damage,{...result,prefix:`${game.party[actor].name}の加護が反照した！`});
    },
  });
  for (const react of gearReactions) react();
  finishReadGuards(b);
  finish({performed:true,magic:actionMagic,physical:!actionMagic});
}

// ---------------- 戦闘のあと ----------------
/**
 * 戦闘間では状態IDと残りターン・段階を保存する。一時効果は戦闘オブジェクト内だけに置く。
 */
export function finishBattle(data, game, b) {
  game.party.forEach((m, i) => {
    const ally = b.allies[i];
    m.persist = Object.keys(ally.statuses).filter((id) => id !== 'stun' && id !== 'taunt' && data.statusEffects.has(id));
    m.persistState = Object.fromEntries(m.persist.map((id) => [id, { ...ally.statuses[id] }]));
    ally.statuses = structuredClone(m.persistState);
    ally.buffs = {};
    ally.masterEffects = {};
    clearTrio(b,i);
    clearCivic(b,i);
    clearNature(b,i);
    delete ally.familiar;
    delete ally.companion;
    delete ally.puppet;
    delete ally.puppetQuick;
    delete ally.decoy;
    delete ally.strategistOrder;
    delete ally.strategistUltimate;
    delete ally.analysisMarks;
    delete ally.insurance;
    delete ally.winCrit;
    clearMysticState(b, i);
    ally.rhythm=0;
    ally.lastDance=null;
    ally.anger = 0;
    resetTacticalState(ally);
    delete ally.advancedAction;
    delete ally.masterCover;
    delete ally.masterCounter;
    ally.imbue = null;
    if (m.hp > maxHp(data, m)) m.hp = maxHp(data, m);
    if (ultimateRules(data).carry_over === false) m.ultimateGauge = 0;
  });
  b.partyBuffs = {};
  delete b.field;
  for(const enemy of b.enemies)delete enemy.curseMarks;
  b.delayed = [];
  return b.result;
}

/** 勝ったときの経験値（戦闘不能者も含む1人あたり）と AP */
export function battleRewards(data, game, b, { dungeonId } = {}) {
  const fixed = fixedBattleRewards(data, b.enemies, dungeonId);
  const R = data.balance.rewards;
  const boss = b.enemies.some((e) => e.boss);
  const ap = fixed ? fixed.reduce((sum, r) => sum + r.ap, 0) : boss ? R.ap_per_boss_battle : R.ap_per_battle;
  const xp = game.party.map((m, i) => {
    let sum = 0;
    for (const [index, e] of b.enemies.entries()) {
      let x = fixed ? fixed[index].exp : evaluate(f(data, 'xp_per_enemy'), { enemyLv: e.lv }) * (e.boss ? f(data, 'boss_xp_mul') : 1);
      if (e.eliteId) x *= data.elitePrefixes.find((p) => p.id === e.eliteId)?.rewardMul ?? 1;
      x *= evaluate(f(data, 'overlevel'), { Lv: m.lv, enemyLv: e.lv });
      sum += x;
    }
    return Math.round(sum * (1 + (memberMods(data, m).xp ?? 0) + (affixSum(m, 'EXP') + affixSum(m, '経験値')) / 100));
  });
  return { xp, ap: game.party.map((m, i) => (canAct(game, b, i) ? ap : 0)) };
}



