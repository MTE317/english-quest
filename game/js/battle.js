// 戦闘：行動順・通常攻撃とスキル・1行動ごとに1問・属性・状態異常・道具・逃げる。
//
// - 戦闘の状態（battle）はすべて JSON にできる形で持つ。乱数も battle.rng に入れておくので、
//   セーブ（save.js の setBattle）から読み直すと同じ結果になる（読み込み直しで結果を変えられない）。
// - 味方の HP・MP は game.party の各キャラが持つ（戦闘のあとも続くため）。戦闘だけの状態異常・強化は battle.allies が持つ。
// - 1行動の流れ：nextTurn() → 味方の番なら actionOptions() で選べる行動を出す → setPending() で行動と問題を保存
//   → 答えたら resolvePending(正解か) → また nextTurn()
//
// 式は data/balance.json から読む。balance.json に式として書かれていないもの（説明の文だけのもの）は、
// シミュレーター（sim/battle.py・sim/core.py）と同じ式を BATTLE_FORMULAS に置いて使う（docs/requests.md で依頼済み）。
import { evaluate } from './expr.js';
import { computeStats, gearDef, weaponPower, maxHp, maxMp, gearEffects, affixSum } from './character.js?v=features-2';
import { actionSkills, memberMods, addMasteryKill } from './growth.js?v=features-2';
import { encounterMonsters, learnMonsterElements, hitEffectiveness } from './monster-knowledge.js';

/** balance.json にまだ式がないもの（sim と同じ） */
export const BATTLE_FORMULAS = Object.freeze({
  enemy_def: '(6 + 3.2*Lv) * def_mul',
  enemy_res: '(6 + 3.2*Lv) * res_mul',
  // 味方の攻撃：(能力値 + 武器の攻撃力) × 倍率 × 属性 × 100/(100 + 防御) × 会心 × 乱数
  ally_damage: 'atk * em * 100 / (100 + max(0, df)) * crit * r',
  enemy_damage: 'atk * 1.62 * 100 / (100 + df) * r',
  heal: '(MAG + wpow) * m * heal_mul',
  fixed_damage: '(20 + 6*itemLv) * em * 100 / (100 + RES * 0.3)',
  flee: 'max(0.10, min(0.95, 0.5 + spd_diff*0.01 + luk*0.002 + lv_diff*0.02))',
  xp_per_enemy: '6 + 3.2*enemyLv',
  overlevel: 'max(0, 1 - 0.25 * max(0, (Lv - enemyLv) - 1))',
  boss_xp_mul: 5,
  ally_rand: [0.95, 1.05],
  enemy_rand: [0.9, 1.1],
  turn_rand: [0.9, 1.1],
  taunt_weight: 4,
  boss_status_mul: 0.3, // ボスは状態異常にかかりにくい（同じものを重ねるたびに半分）
  boss_status_immune: ['petrify', 'doom'],
  imbue_mul: 1.1,
  confused_self_hit: 0.5,
  max_rounds: 30,
});

/** 武器種ごとの特性は data/weapon_types.csv の traits_json に集約する。 */
const weaponTraits = (data, gear) => gear
  ? data.weaponTypes.get(gearDef(data, gear).kind)?.traits ?? {}
  : {};

/** スキルの st にある名前で、status_effects.csv にないもの（sim と同じ扱い） */
export const STATUS_ALIASES = Object.freeze({ DEFダウン: { debuff: { def: 0.25 }, turns: 3 } });

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
const pick = (b, arr) => arr[Math.floor(rand(b) * arr.length)];
function weighted(b, arr, weightOf) {
  const total = arr.reduce((a, x) => a + weightOf(x), 0);
  let r = rand(b) * total;
  for (const x of arr) { r -= weightOf(x); if (r <= 0) return x; }
  return arr[arr.length - 1];
}

// 今はすべて BATTLE_FORMULAS から。balance.json に式が入ったらここで切りかえる
function f(data, key) {
  return BATTLE_FORMULAS[key];
}

// ---------------- 敵 ----------------
/**
 * 敵を1体作る
 * @param opts { lv, dungeonId, boss, eliteId }
 */
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
  const maxHpV = Math.round(evaluate(E.hp, env) * (boss ? E.boss_hp_mul : 1));
  const atk = evaluate(E.str_mag, env) * (boss ? E.boss_atk_mul : 1);
  return {
    monsterId, name: elite ? `${elite.prefix}${m.name}` : m.name, icon: m.icon, lv, boss, eliteId,
    types: m.types, weak: m.weak, resist: m.resist, magicRate: m.magicRate,
    status: elite?.mods.status?.id ?? m.status, statusRate: elite?.mods.status?.rate ?? m.statusRate,
    attackElement: elite?.mods.element ?? m.attackElement,
    evasion: em.other.eva ?? 0, regen: em.other.regen ?? 0,
    hp: maxHpV, maxHp: maxHpV, str: atk, mag: atk,
    def: evaluate(f(data, 'enemy_def'), env), res: evaluate(f(data, 'enemy_res'), env), spd: evaluate(E.spd, env),
    statuses: {}, debuffs: {}, statusHits: {}, revealed: false,
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
      statuses: Object.fromEntries((m.persist ?? []).map((id) => [id, { turns: 99, n: 1 }])),
      buffs: {}, imbue: null, once: [], endured: false,
    })),
    enemies, partyBuffs: {}, delayed: [], pending: null, log: [],
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
  return game.party[i].hp > 0 && !isPetrified(b, i);
}
const livingEnemies = (b) => b.enemies.map((e, i) => i).filter((i) => b.enemies[i].hp > 0);

/** 戦闘中の能力値（状態異常・強化を合わせたもの） */
function partyPassive(data, game, b, key) {
  return Math.max(0, ...game.party.map((m, index) => canAct(game, b, index) ? memberMods(data, m)[key] ?? 0 : 0));
}

export function battleStats(data, game, b, i) {
  const m = game.party[i];
  const st = { ...computeStats(data, m) };
  const a = b.allies[i];
  const down = Object.keys(a.statuses).some((id) => ['statdown'].includes(data.statusEffects.get(id)?.kind));
  for (const k of ['str', 'mag', 'def', 'res', 'spd']) {
    const buff = 1 + Math.min(data.balance.battle.buff_cap, bval(b.partyBuffs, k) + bval(a.buffs, k));
    st[k] = st[k] * buff * (down ? 1 - data.statusEffects.get('statdown').value : 1);
  }
  if (b.round <= 3) st.res *= 1 + partyPassive(data, game, b, 'start_res');
  if (has(a, 'dot_strdown', data)) st.str *= 1 - data.statusEffects.get('statdown').value; // 火傷は STR も下がる（sim と同じく能力ダウンと同じ幅）
  st.crit += bval(a.buffs, 'crt');
  st.evasion += bval(b.partyBuffs, 'eva') + bval(a.buffs, 'eva');
  return st;
}

function elementMul(data, enemy, el) {
  const bt = data.balance.battle;
  if (!el || el === 'none') return 1;
  if (enemy.weak.includes(el)) return bt.weak;
  if (enemy.resist.includes(el)) return bt.resist;
  return 1;
}

// ---------------- 行動順 ----------------
function startRound(data, game, b) {
  b.round += 1;
  const units = [];
  // 宿屋の良い部屋：遠征の最初の戦闘の1ターン目だけ SPD が上がる
  const first = b.firstBattle && b.round === 1;
  game.party.forEach((m, i) => {
    if (!canAct(game, b, i)) return;
    let spd = battleStats(data, game, b, i).spd * (1 + (first ? m.room?.spd1 ?? 0 : 0) + (b.round === 1 ? affixSum(m, 'FIRST_SPD') / 100 : 0));
    if (b.round === 1 && memberMods(data, m).first) spd += 1e6; // 早撃ち：1ターン目は必ず先に動く
    units.push({ side: 'ally', i, spd });
  });
  b.enemies.forEach((e, i) => {
    if (e.hp > 0) units.push({ side: 'enemy', i, spd: e.spd * (Object.keys(e.statuses).includes('statdown') ? 0.8 : 1) });
  });
  for (const u of units) u.spd *= between(b, f(data, 'turn_rand'));
  units.sort((x, y) => y.spd - x.spd);
  b.queue = units.map(({ side, i }) => ({ side, i }));
}

function endRound(data, game, b) {
  // 時間差の攻撃
  for (const d of b.delayed) {
    d.turns -= 1;
    if (d.turns === 0 && b.enemies[d.target].hp > 0) {
      hitEnemy(data, game, b, d.actor, d.target, d.damage, { ...d, prefix: '刻印が発動！' });
    }
  }
  b.delayed = b.delayed.filter((d) => d.turns > 0);
  tick(b.partyBuffs);
  for (const a of b.allies) tick(a.buffs);
}

function tick(buffs) {
  for (const k of Object.keys(buffs)) {
    buffs[k][1] -= 1;
    if (buffs[k][1] <= 0) delete buffs[k];
  }
}

function checkEnd(game, b) {
  if (b.result) return true;
  if (!b.enemies.some((e) => e.hp > 0)) { b.result = 'win'; log(b, '敵をすべて倒した！'); }
  else if (!game.party.some((m, i) => canAct(game, b, i))) { b.result = 'lose'; log(b, 'パーティは全滅した…'); }
  return !!b.result;
}

/**
 * 次に行動を選ぶ味方の番まで進める（敵の番・状態異常で動けない番はここで処理する）
 * @returns b.turn（味方の番 { side:'ally', i }）か null（戦闘が終わった）
 */
export function nextTurn(data, game, b) {
  if (b.turn || b.pending) return b.turn;
  for (let guard = 0; guard < 1000; guard++) {
    if (checkEnd(game, b)) return null;
    if (b.queue.length === 0) {
      if (b.round > 0) endRound(data, game, b);
      if (checkEnd(game, b)) return null;
      if (b.round >= f(data, 'max_rounds')) { b.result = 'lose'; log(b, '戦いが長引き、力尽きた…'); return null; }
      startRound(data, game, b);
      continue;
    }
    const u = b.queue.shift();
    if (u.side === 'enemy') {
      if (b.enemies[u.i].hp > 0) enemyTurn(data, game, b, u.i);
      continue;
    }
    if (!canAct(game, b, u.i)) continue;
    if (allyTurnStart(data, game, b, u.i)) {
      b.turn = u;
      return u;
    }
  }
  throw new Error('戦闘が進まない');
}

/** 味方の番のはじめ：継続ダメージ・死の宣告・動けない状態。動けるなら true */
function allyTurnStart(data, game, b, i) {
  const m = game.party[i];
  const a = b.allies[i];
  const mx = maxHp(data, m);
  for (const [id, s] of Object.entries(a.statuses)) {
    const st = data.statusEffects.get(id);
    if (!st) continue;
    if (st.kind === 'dot' || st.kind === 'dot_strdown') damageAlly(data, game, b, i, mx * st.value * (s.n ?? 1), `${m.name}は${st.name}で`);
    if (st.kind === 'dot_rising') { damageAlly(data, game, b, i, mx * st.value * s.n, `${m.name}は${st.name}で`); s.n += 1; }
    if (st.kind === 'doom' && s.turns <= 1) { m.hp = 0; log(b, `${m.name}に死の宣告が下った…`); }
  }
  const regen = bval(a.buffs, 'regen') + bval(b.partyBuffs, 'regen') + (memberMods(data, m).regen ?? 0);
  if (regen) healAlly(data, game, b, i, mx * regen);
  if (m.hp <= 0) { koAlly(game, b, i); return false; }
  let skip = null;
  for (const id of Object.keys(a.statuses)) {
    const st = data.statusEffects.get(id);
    if (!st) continue;
    if (['skip_until_hit', 'skip_once'].includes(st.kind)) skip = st.name;
    if (st.kind === 'skip_chance' && chance(b, st.value)) skip = st.name;
  }
  // 残りターンを減らす（戦闘のあとも残るものは減らさない）
  for (const [id, s] of Object.entries(a.statuses)) {
    const st = data.statusEffects.get(id);
    if (st?.persists) continue;
    s.turns -= 1;
    if (s.turns <= 0) { delete a.statuses[id]; if (st) log(b, `${m.name}の${st.name}が治った`); }
  }
  if (skip) { log(b, `${m.name}は${skip}で動けない`); return false; }
  return true;
}

function damageAlly(data, game, b, i, amount, prefix, source) {
  const m = game.party[i];
  const dmg = Math.max(1, Math.round(amount));
  if (m.hp > 0) recordHit(b, 'ally', i, dmg, source);
  m.hp = Math.max(0, m.hp - dmg);
  log(b, `${prefix} ${dmg}のダメージ`);
  if (m.hp <= 0 && memberMods(data, m).endure && !b.allies[i].endured) {
    m.hp = 1; b.allies[i].endured = true; log(b, `${m.name}は踏みとどまった！`); return;
  }
  if (m.hp <= 0) koAlly(game, b, i);
}
function koAlly(game, b, i) {
  const m = game.party[i];
  m.hp = 0;
  // 戦闘不能になると、戦闘のあとも残るもの以外の状態異常は消える
  b.allies[i].statuses = {};
  b.allies[i].buffs = {};
  log(b, `${m.name}は倒れた`);
}
function healAlly(data, game, b, i, amount) {
  const m = game.party[i];
  if (m.hp <= 0) return 0;
  if (has(b.allies[i], 'noheal', data)) { log(b, `${m.name}は呪いで回復できない`); return 0; }
  const before = m.hp;
  m.hp = Math.min(maxHp(data, m), Math.round(m.hp + amount));
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
  return s.effect.base === 'mag' || MAGIC_SKILL_KINDS.includes(s.kind) || ['debuff', 'delayed'].includes(s.kind);
}

/** スキルを今使えるか → 使えない理由（使えるなら ''） */
export function skillMp(data, member, skill) {
  const rate = data.balance.mp_rules?.skill_mp_per_lv ?? 0;
  return Math.ceil(skill.mp * (1 + rate * (member.lv - 1)));
}

function skillBlock(data, game, b, i, s) {
  const m = game.party[i];
  const a = b.allies[i];
  if (m.mp < skillMp(data, m, s)) return 'MP が足りない';
  if (s.effect.once && a.once.includes(s.id)) return 'この戦闘ではもう使った';
  if (ATTACK_SKILL_KINDS.includes(s.kind) && has(a, 'no_attack_skill', data)) return '恐怖で使えない';
  if (isMagicSkill(s) && has(a, 'no_magic', data)) return '沈黙で使えない';
  if (!isMagicSkill(s) && ['attack', 'fixed_damage', 'self_buff', 'imbue'].includes(s.kind) && has(a, 'no_phys_skill', data)) return '封印で使えない';
  if (s.kind === 'utility' && !['thief_p2_s1', 'hunter_p2_s1'].includes(s.id)) return '効果が設定されていません';
  if (s.effect.imbue_only && !a.imbue) return '剣気をまとっていない';
  return '';
}

const BATTLE_ITEM_EFFECTS = ['heal_hp', 'heal_hp_pct', 'heal_hp_all', 'heal_hp_all_pct', 'heal_mp', 'heal_mp_pct', 'revive_pct', 'cure_status',
  'buff_str', 'buff_mag', 'buff_def', 'buff_res', 'buff_spd', 'buff_crt', 'resist_elem_all', 'resist_status_all'];

/** 逃げられる確率 */
export function fleeRate(data, game, b) {
  const al = game.party.map((m, i) => i).filter((i) => canAct(game, b, i));
  const ae = b.enemies.filter((e) => e.hp > 0);
  if (!b.canFlee || ae.some((e) => e.boss) || al.some((i) => has(b.allies[i], 'noevade_noflee', data))) return 0;
  const avg = (arr) => arr.reduce((x, y) => x + y, 0) / Math.max(1, arr.length);
  const sts = al.map((i) => battleStats(data, game, b, i));
  return evaluate(f(data, 'flee'), {
    spd_diff: avg(sts.map((s) => s.spd)) - avg(ae.map((e) => e.spd)),
    luk: avg(sts.map((s) => s.luk)),
    lv_diff: avg(al.map((i) => game.party[i].lv)) - avg(ae.map((e) => e.lv)),
  });
}

/** 味方 i が選べる行動 */
export function actionOptions(data, game, b, i) {
  const skills = knownSkills(data, game.party[i]).map((s) => ({ skill: s, reason: skillBlock(data, game, b, i, s) }));
  const items = Object.entries(game.items ?? {}).filter(([, n]) => n > 0).map(([id, count]) => {
    const item = data.items.get(id);
    const ok = item && BATTLE_ITEM_EFFECTS.includes(item.effect);
    return { item, count, reason: ok ? '' : '戦闘では使えない' };
  }).filter((x) => x.item);
  const flee = fleeRate(data, game, b);
  return { skills, items, flee: { rate: flee, reason: flee > 0 ? '' : (b.enemies.some((e) => e.hp > 0 && e.boss) ? 'ボスからは逃げられない' : '逃げられない') } };
}

/** 行動の対象の選び方：'enemy'（敵1体）/ 'enemies'（敵全体）/ 'ally'（味方1人）/ 'ko_ally'（倒れた味方）/ 'allies' / 'self' / 'none' */
export function targetKind(data, action) {
  if (action.type === 'attack') return 'enemy';
  if (action.type === 'flee') return 'none';
  if (action.type === 'item') {
    const it = data.items.get(action.itemId);
    if (it.effect === 'revive_pct') return 'ko_ally';
    return it.target === 'ally' ? 'ally' : 'allies';
  }
  const s = data.skills.get(action.skillId);
  const tgt = s.effect.tgt;
  switch (s.kind) {
    case 'attack': return tgt === 'all' || tgt === 'random' ? 'enemies' : 'enemy';
    case 'utility': case 'status': case 'debuff': return tgt === 'all' ? 'enemies' : 'enemy';
    case 'fixed_damage': case 'delayed': return 'enemies';
    case 'heal': case 'cure': case 'ally_buff': case 'mp_give': return 'ally';
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
  const cm = correct ? 1 : between(b, data.balance.battle.wrong_answer_mult);
  b.pending = null;
  b.turn = null;
  if (!correct) log(b, `${m.name}の力が弱まった…（×${cm.toFixed(2)}）`);

  // 魅了：正解で解ける。不正解だと味方を攻撃する
  const charm = statusOfKind(a, 'charm', data);
  if (charm) {
    if (correct) { delete a.statuses[charm]; log(b, `${m.name}は正気に戻った！`); } else { selfHit(data, game, b, i); return { cm }; }
  }
  const conf = statusOfKind(a, 'random_target', data);
  if (conf && p.action.type !== 'item' && chance(b, data.statusEffects.get(conf).value)) {
    log(b, `${m.name}は混乱している！`);
    selfHit(data, game, b, i);
    return { cm };
  }
  // 出血：行動するとダメージ
  const bleed = statusOfKind(a, 'dot_on_action', data);
  if (bleed) damageAlly(data, game, b, i, maxHp(data, m) * data.statusEffects.get(bleed).value, `${m.name}は出血で`);
  if (m.hp <= 0) return { cm };

  const act = p.action;
  if (act.type === 'attack') {
    doAttack(data, game, b, i, null, act.target, cm);
    if (correct) {
      const max = maxMp(data, m);
      const recovery = Math.min(max - m.mp, Math.ceil(max * (data.balance.mp_rules?.normal_attack_regen_rate ?? 0)));
      if (recovery > 0) {
        m.mp += recovery;
        log(b, `${m.name}のMPが ${recovery} 回復`);
      }
    }
  }
  else if (act.type === 'skill') doSkill(data, game, b, i, data.skills.get(act.skillId), act.target, cm);
  else if (act.type === 'item') doItem(data, game, b, i, data.items.get(act.itemId), act.target, cm);
  else if (act.type === 'flee') doFlee(data, game, b, correct);
  checkEnd(game, b);
  return { cm };
}

function selfHit(data, game, b, i) {
  const targets = game.party.map((x, j) => j).filter((j) => game.party[j].hp > 0 && j !== i);
  if (!targets.length) return;
  const t = pick(b, targets);
  const st = battleStats(data, game, b, i);
  const ts = battleStats(data, game, b, t);
  const dmg = (st.str + st.attack) * f(data, 'confused_self_hit') * 100 / (100 + ts.def);
  damageAlly(data, game, b, t, dmg, `${game.party[i].name}は${game.party[t].name}を攻撃！`, { side: 'ally', i });
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
function attackDamage(data, game, b, i, e, skill, cm, { offhand = false } = {}) {
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
    els = (wt?.elements ?? []).filter((x) => x !== 'none');
    if (wdef?.addedElement) els = [...new Set([...els, wdef.addedElement])];
    if (weapon) els = [...new Set([...els, ...Object.keys(gearEffects(weapon)).filter((key) => key.startsWith('ELEMENT:')).map((key) => key.slice(8))])];
    hits = wt?.id === 'fist' && mods.fist ? [mods.fist, mods.fist] : wt?.hits?.length ? wt.hits : [1];
    if (a.imbue && kind === 'phys') { els = skill?.effect.imbue_only ? [a.imbue] : [...els.slice(0, 1), a.imbue]; imb = f(data, 'imbue_mul') + (mods.imbue ?? 0); }
  } else {
    kind = base === 'phys' ? 'phys' : 'mag';
    els = skill.elements;
    hits = [1];
  }
  if (skill?.effect.hits) hits = skill.effect.hits;
  const mult = skill?.effect.m ?? 1;
  const statVal = kind === 'phys'
    ? (skill?.effect.beststat ? Math.max(st.str, st.mag) : st.str) * (traits.str_mul ?? 1) + st.mag * (mods.mag2phys ?? 0)
    : st.mag * (traits.mag_mul ?? 1) * (1 + bval(a.buffs, 'magb'));
  const wpow = weaponPower(data, m, weapon) + st.mag * (mods.mag_to_atk ?? 0);
  const bard = game.party.find((x, j) => x.job === 'bard' && canAct(game, b, j));
  const song = bard ? data.balance.battle.bard_song + (weaponTraits(data, bard.equip.weapon).song_bonus ?? 0) : 0;
  const dm = 1 + Math.min(data.balance.battle.buff_cap, song + bval(b.partyBuffs, 'dmg') + (kind === 'phys' ? bval(a.buffs, 'str') : 0));
  // パッシブ：武器・属性・種別へのダメージ、ピンチのときのダメージ
  let pm = 1;
  for (const [names, v] of mods.wdmg ?? []) if (base === 'weapon' && wt && names.some((n) => nameIs(data.weaponTypes, wt.id, n))) pm += v;
  for (const [name, v] of mods.edmg ?? []) if (els.some((el) => nameIs(data.elements, el, name))) pm += v;
  for (const [names, v] of mods.tdmg ?? []) if (enemy.types.some((t) => names.some((n) => nameIs(data.monsterTypes, t, n)))) pm += v;
  for (const type of enemy.types) pm += ((weapon ? gearEffects(weapon)['特効:' + type] ?? 0 : 0) + affixSum(m, 'TYPE_BONUS:' + type)) / 100;
  if (wt?.id === 'gun' && base === 'phys' && skill) pm += mods.bullet ?? 0;
  if (els.some((id) => ['wind', 'earth', 'water'].includes(id) && enemy.weak.includes(id))) pm += mods.weak_wew ?? 0;
  if (Object.keys(enemy.debuffs).length || enemy.statuses.poison) pm += mods.vs_debuffed ?? 0;
  if (base === 'weapon' && traits.vs_status && enemy.statuses[traits.vs_status.id]) pm += (traits.vs_status.mul ?? 1) - 1;
  if (!skill) pm += mods.normal_damage ?? 0;
  if (kind === 'mag') pm += mods.magic_damage ?? 0;
  if (mods.lowhp_dmg && m.hp < maxHp(data, m) * 0.5) pm += mods.lowhp_dmg;
  const atk = (statVal + (base === 'weapon' || kind === 'mag' ? wpow : wpow * 0.8)) * mult * cm * dm * imb * pm;
  const pierce = kind === 'phys' ? (wt?.defPierce ?? 0) + (skill?.effect.defign ?? 0) : 0;
  const df = kind === 'phys' ? enemy.def * (1 - pierce) * (1 - bval(enemy.debuffs, 'def')) : enemy.res * (1 - bval(enemy.debuffs, 'res'));
  let em = els.length ? els.reduce((x, el) => x + elementMul(data, enemy, el), 0) / els.length : 1;
  if (em > 1 && mods.weak_all) em *= 1 + mods.weak_all;
  if (base === 'weapon' && em > 1) em *= traits.weak_damage_mul ?? 1;
  const pc = st.crit + (skill?.effect.crt ?? 0);
  const blind = statusOfKind(a, 'blind', data);
  let total = 0;
  let crits = 0;
  let misses = 0;
  for (const h of hits) {
    const crit = chance(b, pc);
    const hit = !(kind === 'phys' && blind && chance(b, data.statusEffects.get(blind).value * (traits.blind_miss_mul ?? 1)));
    if (crit) crits += 1;
    if (!hit) { misses += 1; continue; }
    total += h * evaluate(f(data, 'ally_damage'), {
      atk, em, df, crit: crit ? data.balance.battle.crit_mult + (mods.crit_dmg ?? 0) + (mods.crit_damage ?? 0) : 1, r: between(b, f(data, 'ally_rand')),
    });
  }
  return { damage: Math.round(total), crits, misses, em, elements: els };
}

function hitEnemy(data, game, b, i, e, damage, { prefix = '', em = 1, elements = [] } = {}) {
  const enemy = b.enemies[e];
  if (damage <= 0) return;
  const wasAlive = enemy.hp > 0;
  if (wasAlive) {
    learnMonsterElements(game, enemy, elements);
    recordHit(b, 'enemy', e, damage, { side: 'ally', i }, hitEffectiveness(em));
  }
  enemy.hp = Math.max(0, enemy.hp - damage);
  if (wasAlive && enemy.hp <= 0 && game.party[i]) {
    const m = game.party[i];
    addMasteryKill(data, m); // 武器の熟練度
    const km = memberMods(data, m).kill_mp;
    if (km) m.mp = Math.min(maxMp(data, m), m.mp + km);
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

function doAttack(data, game, b, i, skill, target, cm) {
  const m = game.party[i];
  const kind = skill ? targetKind(data, { type: 'skill', skillId: skill.id }) : 'enemy';
  const mainDef = m.equip.weapon ? gearDef(data, m.equip.weapon) : null;
  const wt = mainDef ? data.weaponTypes.get(mainDef.kind) : null;
  const allMul = !skill && wt?.traits.normal_all_mul != null
    ? memberMods(data, m).whip ?? wt.traits.normal_all_mul : null; // 鞭などの通常全体攻撃
  if (!skill) log(b, `${m.name}の攻撃！`);
  if (skill?.effect.tgt === 'random') {
    for (let n = 0; n < (skill.effect.n ?? 1); n++) {
      const alive = livingEnemies(b);
      if (!alive.length) break;
      const e = pick(b, alive);
      const r = attackDamage(data, game, b, i, e, skill, cm);
      hitEnemy(data, game, b, i, e, r.damage, { ...r, prefix: describeHit(r) });
    }
    return;
  }
  const targets = allMul ? livingEnemies(b) : attackTargets(b, kind, target);
  for (const e of targets) {
    const r = attackDamage(data, game, b, i, e, skill, cm);
    hitEnemy(data, game, b, i, e, Math.round(r.damage * (allMul ?? 1)), { ...r, prefix: describeHit(r) });
    if (!skill && m.equip.offhand && b.enemies[e].hp > 0) {
      const r2 = attackDamage(data, game, b, i, e, null, cm, { offhand: true });
      hitEnemy(data, game, b, i, e, Math.round(r2.damage * data.balance.battle.dual_wield_second_hit),
        { ...r2, prefix: `二刀目！${describeHit(r2)}` });
    }
    if (skill?.effect.st && b.enemies[e].hp > 0) inflictEnemy(data, b, e, skill.effect.st, cm, memberMods(data, m).stat_rate);
    const ap = memberMods(data, m).auto_poison;
    if (!skill && ap && b.enemies[e].hp > 0) inflictEnemy(data, b, e, [data.statusEffects.get('poison').name, ap], cm);
    // 通常攻撃で発動する武器固有の状態異常（鎚・鎌）
    if (!skill && r.damage > 0 && b.enemies[e].hp > 0 && wt?.traits.normal_status) {
      const effect = wt.traits.normal_status;
      const status = data.statusEffects.get(effect.id);
      if (status) inflictEnemy(data, b, e, [status.name, effect.chance], cm, memberMods(data, m).stat_rate);
    }
    // 槍の貫通：通常攻撃時に別の敵へ追加攻撃（連鎖しない）
    if (!skill && r.damage > 0 && wt?.traits.splash_chance) {
      const others = livingEnemies(b).filter((j) => j !== e);
      if (others.length && chance(b, wt.traits.splash_chance)) {
        const other = pick(b, others);
        const extra = attackDamage(data, game, b, i, other, null, cm);
        hitEnemy(data, game, b, i, other, Math.round(extra.damage * (wt.traits.splash_mul ?? 0.5)),
          { ...extra, prefix: `貫通！${describeHit(extra)}` });
      }
    }
    if (skill?.effect.drain) m.mp = Math.min(maxMp(data, m), m.mp + Math.min(10, Math.round(r.damage * skill.effect.drain / 10)));
  }
  if (skill?.effect.selfcost) {
    const before = m.hp;
    m.hp = Math.max(1, Math.round(m.hp - maxHp(data, m) * skill.effect.selfcost));
    recordHit(b, 'ally', i, before - m.hp);
    log(b, `${m.name}は反動を受けた`);
  }
}

/** 敵に状態異常をかける。st は ['毒', 0.3]（名前と確率） */
function inflictEnemy(data, b, e, [name, rate], cm, statRate = 0) {
  const enemy = b.enemies[e];
  const alias = STATUS_ALIASES[name];
  const st = data.statusByName.get(name);
  let p = rate * cm * (1 + statRate);
  const key = st?.id ?? name;
  if (enemy.boss) {
    if (st && f(data, 'boss_status_immune').includes(st.id)) p = 0;
    p *= f(data, 'boss_status_mul') * 0.5 ** (enemy.statusHits[key] ?? 0);
  }
  if (!chance(b, p)) { log(b, `${enemy.name}には効かなかった`); return; }
  enemy.statusHits[key] = (enemy.statusHits[key] ?? 0) + 1;
  if (alias) {
    for (const [k, v] of Object.entries(alias.debuff)) enemy.debuffs[k] = [v, alias.turns];
    log(b, `${enemy.name}の守りが下がった`);
  } else if (st) {
    enemy.statuses[st.id] = { turns: st.turns, n: 1 };
    log(b, `${enemy.name}は${st.name}になった`);
  }
}

// ---------------- スキル ----------------
function doSkill(data, game, b, i, s, target, cm) {
  const m = game.party[i];
  const a = b.allies[i];
  const block = skillBlock(data, game, b, i, s);
  if (block) { log(b, `${s.name}は使えなかった（${block}）`); return; }
  m.mp -= skillMp(data, m, s);
  if (s.effect.once) a.once.push(s.id);
  log(b, `${m.name}の${s.name}！`);
  const e = s.effect;
  const allies = (pred = (j) => game.party[j].hp > 0) => game.party.map((x, j) => j).filter(pred);
  const healAmt = () => {
    const st = battleStats(data, game, b, i);
    const traits = weaponTraits(data, m.equip.weapon);
    return evaluate(f(data, 'heal'), { MAG: st.mag, wpow: st.attack, m: e.m ?? 1, heal_mul: traits.heal_mul ?? 1 }) * cm * (1 + (memberMods(data, m).healp ?? 0));
  };
  switch (s.kind) {
    case 'utility': {
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
      doAttack(data, game, b, i, s, target, cm);
      break;
    case 'heal': {
      const t = game.party[target]?.hp > 0 ? target : i;
      const v = healAlly(data, game, b, t, healAmt() * between(b, f(data, 'ally_rand')));
      log(b, `${game.party[t].name}のHPが ${v} 回復`);
      break;
    }
    case 'heal_all': {
      const amt = healAmt();
      for (const j of allies()) healAlly(data, game, b, j, amt);
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
      game.party[t].hp = Math.max(1, Math.round(maxHp(data, game.party[t]) * (e.frac ?? 0.3) * cm));
      log(b, `${game.party[t].name}が起き上がった`);
      break;
    }
    case 'cure': case 'cure_all': {
      // 治せるのは status_effects.csv の cure 列にこのスキルの名前があるもの
      const ts = s.kind === 'cure_all' ? allies() : [game.party[target]?.hp > 0 ? target : i];
      for (const j of ts) cureAlly(data, game, b, j, (st) => curedBy(st, s.name) && chance(b, cm));
      break;
    }
    case 'party_buff': {
      const traitMul = weaponTraits(data, m.equip.weapon).party_buff_mul ?? 1;
      for (const [k, v] of Object.entries(e.buff ?? {})) {
        const song = s.job === 'bard' ? memberMods(data, m) : {};
        const base = (v + (k === 'dmg' ? song.song ?? 0 : 0)) * traitMul * cm;
        b.partyBuffs[k] = [Math.min(data.balance.battle.buff_cap, base), (e.turns ?? 1) + 1 + (song.song_turns ?? 0)];
      }
      log(b, '味方全員が力を得た');
      break;
    }
    case 'self_buff':
      for (const [k, v] of Object.entries(e.buff ?? {})) a.buffs[k] = [v * cm, (e.turns ?? 1) + 1];
      log(b, `${m.name}は構えた`);
      break;
    case 'ally_buff': {
      const t = game.party[target]?.hp > 0 ? target : i;
      for (const [k, v] of Object.entries(e.buff ?? {})) b.allies[t].buffs[k] = [v * cm, (e.turns ?? 1) + 1];
      log(b, `${game.party[t].name}は力を得た`);
      break;
    }
    case 'mp_give': {
      const t = game.party[target]?.hp > 0 ? target : i;
      const mx = maxMp(data, game.party[t]);
      const v = Math.round(mx * (e.frac ?? 0) * cm);
      game.party[t].mp = Math.min(mx, game.party[t].mp + v);
      log(b, `${game.party[t].name}のMPが ${v} 回復`);
      break;
    }
    case 'imbue':
      a.imbue = s.elements[0] ?? null;
      log(b, `${m.name}の武器に${data.elements.get(a.imbue)?.name ?? ''}の力が宿った`);
      break;
    case 'debuff': {
      const ts = e.tgt === 'all' ? livingEnemies(b) : attackTargets(b, 'enemy', target);
      for (const t of ts) {
        if (cm === 1 || chance(b, 0.5)) for (const [k, v] of Object.entries(e.deb ?? {})) b.enemies[t].debuffs[k] = [v, (e.turns ?? 1) + 1];
      }
      log(b, '敵の力が弱まった');
      break;
    }
    case 'status': {
      const ts = e.tgt === 'all' ? livingEnemies(b) : attackTargets(b, 'enemy', target);
      for (const t of ts) inflictEnemy(data, b, t, e.st, cm, memberMods(data, m).stat_rate);
      break;
    }
    case 'fixed_damage': {
      const itemLv = m.equip.weapon ? gearDef(data, m.equip.weapon).itemLv : 1;
      for (const t of livingEnemies(b)) {
        const en = b.enemies[t];
        const em = s.elements.length ? elementMul(data, en, s.elements[0]) : 1;
        const damage = Math.round(evaluate(f(data, 'fixed_damage'), { itemLv, em, RES: en.res }) * cm * between(b, f(data, 'enemy_rand')));
        hitEnemy(data, game, b, i, t, damage, { em, elements: s.elements.slice(0, 1) });
      }
      break;
    }
    case 'delayed':
      for (const t of livingEnemies(b)) {
        const r = attackDamage(data, game, b, i, t, { ...s, effect: { ...e, base: 'mag' } }, cm);
        b.delayed.push({ turns: e.delay ?? 1, target: t, actor: i, damage: r.damage, em: r.em, elements: r.elements });
      }
      log(b, `${e.delay ?? 1}ターン後に発動する`);
      break;
    default:
      log(b, 'しかし何も起こらなかった');
  }
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
  const alive = game.party.map((x, j) => j).filter((j) => game.party[j].hp > 0);
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
    case 'resist_elem_all': b.partyBuffs[`eres:${elOrGroup}`] = [Number(num) / 100 * cm, turns]; log(b, '味方全員が守りの香に包まれた'); break;
    case 'resist_status_all': b.partyBuffs[`sres:${elOrGroup}`] = [Number(num) / 100 * cm, turns]; log(b, '味方全員が守りの香に包まれた'); break;
    default:
      if (it.effect.startsWith('buff_')) {
        const k = it.effect.slice(5);
        b.allies[one].buffs[k] = [it.value / 100 * cm, turns];
        log(b, `${game.party[one].name}の力が上がった`);
      } else log(b, 'しかし何も起こらなかった');
  }
}

// ---------------- 逃げる ----------------
function doFlee(data, game, b, correct) {
  const p = fleeRate(data, game, b);
  if (chance(b, correct ? p : p / 2)) { b.result = 'fled'; log(b, 'うまく逃げ切った！'); } else log(b, '逃げられなかった！');
}

// ---------------- 敵の番 ----------------
function enemyTurn(data, game, b, e) {
  const enemy = b.enemies[e];
  for (const [id, s] of Object.entries(enemy.statuses)) {
    const st = data.statusEffects.get(id);
    if (st?.kind.startsWith('dot')) {
      const d = Math.round(enemy.maxHp * (enemy.boss ? st.value * 0.4 : st.value) * (s.n ?? 1));
      if (enemy.hp > 0) recordHit(b, 'enemy', e, d);
      enemy.hp = Math.max(0, enemy.hp - d);
      log(b, `${enemy.name}は${st.name}で ${d}のダメージ`);
    }
    if (st?.kind === 'doom' && s.turns <= 1 && !enemy.boss) { enemy.hp = 0; log(b, `${enemy.name}に死の宣告が下った`); }
  }
  if (enemy.regen && enemy.hp > 0) enemy.hp = Math.min(enemy.maxHp, Math.round(enemy.hp + enemy.maxHp * enemy.regen));
  if (enemy.hp <= 0) { log(b, `${enemy.name}を倒した！`); return; }
  let skip = null;
  for (const id of Object.keys(enemy.statuses)) {
    const st = data.statusEffects.get(id);
    if (!st) continue;
    if (['skip_until_hit', 'skip_once', 'petrify'].includes(st.kind)) skip = st.name;
    if (['skip_chance', 'random_target', 'charm'].includes(st.kind) && chance(b, st.kind === 'skip_chance' ? st.value : 0.5)) skip = st.name;
  }
  for (const [id, s] of Object.entries(enemy.statuses)) { s.turns -= 1; if (s.turns <= 0) delete enemy.statuses[id]; }
  tick(enemy.debuffs);
  if (skip) { log(b, `${enemy.name}は${skip}で動けない`); return; }

  const alive = game.party.map((x, j) => j).filter((j) => game.party[j].hp > 0);
  if (!alive.length) return;
  let t = weighted(b, alive, (j) => 1 + bval(b.allies[j].buffs, 'taunt') * f(data, 'taunt_weight'));
  // ナイトがかばう
  let cover = 1;
  const bt = data.balance.battle;
  const coverRate = (j) => Math.max(game.party[j].job === 'knight' ? bt.knight_cover_rate : 0, memberMods(data, game.party[j]).cover ?? 0);
  const knight = alive.find((j) => j !== t && coverRate(j) > 0 && canAct(game, b, j));
  if (knight != null && chance(b, coverRate(knight))) {
    t = knight; cover = 1 - bt.knight_cover_cut;
    log(b, `${game.party[t].name}がかばった！`);
  }
  const target = game.party[t];
  const ta = b.allies[t];
  const ts = battleStats(data, game, b, t);
  const magic = chance(b, enemy.magicRate) && !Object.keys(enemy.statuses).includes('silence');
  if (!has(ta, 'noevade_noflee', data) && chance(b, ts.evasion)) { log(b, `${target.name}はひらりとかわした`); return; }
  if (!magic && Object.keys(enemy.statuses).includes('blind') && chance(b, data.statusEffects.get('blind').value)) { log(b, `${enemy.name}の攻撃ははずれた`); return; }
  const atk = (magic ? enemy.mag : enemy.str) * (1 - bval(enemy.debuffs, 'str')) * (Object.keys(enemy.statuses).includes('fear') ? 0.8 : 1);
  const df = magic ? ts.res : ts.def;
  const cut = 1 - Math.min(0.8, bval(b.partyBuffs, 'cut') + bval(ta.buffs, 'cut') + (memberMods(data, target).damage_cut ?? 0) + (magic ? 0 : bval(ta.buffs, 'pcut')));
  const resist = enemy.attackElement
    ? bval(b.partyBuffs, `eres:${enemy.attackElement}`) + affixSum(target, `ELEM_RES:${enemy.attackElement}`) / 100 + partyPassive(data, game, b, 'party_eres')
    : 0;
  const ecut = 1 - Math.min(1, resist + (magic || enemy.attackElement ? partyPassive(data, game, b, 'party_ecut') : 0));
  const dmg = evaluate(f(data, 'enemy_damage'), { atk, df, r: between(b, f(data, 'enemy_rand')) }) * cover * cut * ecut;
  const elName = enemy.attackElement ? data.elements.get(enemy.attackElement)?.name : null;
  damageAlly(data, game, b, t, dmg, `${enemy.name}の${magic ? `${elName ?? ''}魔法` : '攻撃'}！ ${target.name}に`, { side: 'enemy', i: e });
  for (const id of Object.keys(ta.statuses)) if (data.statusEffects.get(id)?.kind === 'skip_until_hit') delete ta.statuses[id];
  if (target.hp <= 0) return;
  // 反撃
  if (!magic && ta.buffs.counter) {
    const r = attackDamage(data, game, b, t, e, null, 1);
    hitEnemy(data, game, b, t, e, r.damage, { ...r, prefix: `${target.name}の反撃！${describeHit(r)}` });
  }
  // 状態異常
  if (enemy.status && !b.partyBuffs.immune) {
    const st = data.statusEffects.get(enemy.status);
    if (st) {
      const partySres = Math.max(0, ...game.party.filter((x) => x.hp > 0).map((x) => memberMods(data, x).party_sres ?? 0));
      const resist = ts.statusResist + bval(b.partyBuffs, 'sres:すべて') + bval(b.partyBuffs, `sres:${st.group}`) + partySres;
      const immune = memberMods(data, target).nopoison && st.kind.startsWith('dot') && st.cure.includes('毒消し');
      if (!immune && chance(b, enemy.statusRate * Math.max(0, 1 - resist))) {
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
}

// ---------------- 戦闘のあと ----------------
/**
 * 戦闘が終わったときの片付け：戦闘のあとも残る状態異常を persist に残し、ほかは消す
 */
export function finishBattle(data, game, b) {
  game.party.forEach((m, i) => {
    m.persist = Object.keys(b.allies[i].statuses).filter((id) => data.statusEffects.get(id)?.persists);
    if (m.hp > maxHp(data, m)) m.hp = maxHp(data, m);
  });
  return b.result;
}

/** 勝ったときの経験値（1人あたり。倒れている人は0）と AP */
export function battleRewards(data, game, b) {
  const R = data.balance.rewards;
  const boss = b.enemies.some((e) => e.boss);
  const ap = boss ? R.ap_per_boss_battle : R.ap_per_battle;
  const xp = game.party.map((m, i) => {
    if (!canAct(game, b, i)) return 0;
    let sum = 0;
    for (const e of b.enemies) {
      let x = evaluate(f(data, 'xp_per_enemy'), { enemyLv: e.lv }) * (e.boss ? f(data, 'boss_xp_mul') : 1);
      if (e.eliteId) x *= data.elitePrefixes.find((p) => p.id === e.eliteId)?.rewardMul ?? 1;
      x *= evaluate(f(data, 'overlevel'), { Lv: m.lv, enemyLv: e.lv });
      sum += x;
    }
    return Math.round(sum * (1 + (memberMods(data, m).xp ?? 0) + (affixSum(m, 'EXP') + affixSum(m, '経験値')) / 100));
  });
  return { xp, ap: game.party.map((m, i) => (canAct(game, b, i) ? ap : 0)) };
}
