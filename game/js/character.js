// パーティのキャラ：能力値・装備8枠・レベル。
// 式は data/balance.json から読む。balance.json に式として書かれていないもの（説明の文だけのもの）は、
// シミュレーター（sim/core.py）と同じ式を下の SIM_FORMULAS に置いて使う。docs/requests.md で balance.json への追加を依頼済み。
import { evaluate, isFormula } from './expr.js';
import { memberMods, masteryMul, ensureLoadout } from './growth.js?v=skill-loadout-3';

export const STATS = ['hp', 'str', 'mag', 'def', 'res', 'spd', 'luk'];
export const STAT_LABEL = { hp: 'HP', str: 'STR', mag: 'MAG', def: 'DEF', res: 'RES', spd: 'SPD', luk: 'LUK' };

/** 装備の8枠（7つは仕様書のとおり。8つ目は二刀流の2本目として仮置き。docs/requests.md 参照） */
export const SLOTS = ['weapon', 'offhand', 'head', 'body', 'arm', 'cloak', 'accessory1', 'accessory2'];
export const SLOT_LABEL = {
  weapon: '武器', offhand: 'サブ武器', head: '頭', body: '体', arm: '腕', cloak: 'マント', accessory1: 'アクセサリー1', accessory2: 'アクセサリー2',
};
/** 枠 → equipment.csv の slot */
const SLOT_KIND = {
  weapon: 'weapon', offhand: 'weapon', head: 'head', body: 'body', arm: 'arm', cloak: 'cloak', accessory1: 'accessory', accessory2: 'accessory',
};
const ARMOR_SLOTS = ['head', 'body', 'arm'];

/** balance.json にまだ式がないもの（sim/core.py と同じ） */
export const SIM_FORMULAS = Object.freeze({
  weapon_power: '(8 + 1.6*itemLv) * quality * (1 + 0.05*enh) * power_mul * apt',
  cloak_res: '(6 + 1.3*itemLv) * 0.3',
  crit: '0.03 + 0.15 * LUK / (20 + 6*Lv) + crit_bonus',
  evasion: 'min(0.45, 0.02 + 0.08 * SPD / (20 + 6*Lv) + armor_evasion)',
  status_resist: 'min(0.8, 0.25 * LUK / (20 + 6*Lv))',
});

function formula(data, key) {
  const fromBalance = key === 'weapon_power' ? data.balance.weapon_power : null;
  if (fromBalance && isFormula(fromBalance)) return fromBalance;
  return SIM_FORMULAS[key];
}

// ---------------- 装備の実体 ----------------

/** 装備を1つ作る（倉庫や装備枠に入るもの） */
export function makeGear(game, equipId, opts = {}) {
  game.nextUid = (game.nextUid ?? 1);
  const gear = {
    uid: game.nextUid++, id: equipId, enh: opts.enh ?? 0, quality: opts.quality ?? 1,
    rarity: opts.rarity ?? 'common', affixes: opts.affixes ?? {},
  };
  return gear;
}

export function gearDef(data, gear) {
  const def = data.equipment.get(gear.id);
  if (!def) throw new Error(`equipment.csv に ${gear.id} がない`);
  return def;
}

// ---------------- 適正 ----------------

/** 適正の文字（S/A/B/C/×）。表にない組み合わせは × */
export function aptitudeGrade(data, jobId, def) {
  if (def.slot === 'weapon') return data.jobWeaponApt.get(jobId)?.[def.kind] || '×';
  if (def.armorWeight) return data.jobArmorApt.get(jobId)?.[def.armorWeight] || '×';
  return null; // マント・アクセサリーは適正なし
}
export function aptitudeMul(data, jobId, def) {
  const g = aptitudeGrade(data, jobId, def);
  if (g == null) return 1;
  return data.aptitude.get(g) ?? null; // null は装備不可
}

/**
 * その枠にその装備をつけられるか → { ok, reason }
 * member.equip を見て、両手武器と二刀流の組み合わせも確かめる
 */
export function canEquip(data, member, slot, gear) {
  const def = gearDef(data, gear);
  if (SLOT_KIND[slot] !== def.slot) return { ok: false, reason: `${SLOT_LABEL[slot]}の枠にはつけられない` };
  if (aptitudeMul(data, member.job, def) == null) return { ok: false, reason: 'このジョブでは装備できない（適正×）' };
  if (def.slot === 'weapon') {
    const wt = data.weaponTypes.get(def.kind);
    if (slot === 'offhand') {
      if (!wt.dualWield) return { ok: false, reason: `${wt.name}は二刀流できない` };
      const main = member.equip.weapon && gearDef(data, member.equip.weapon);
      if (!main) return { ok: false, reason: '先に武器の枠に装備する' };
      if (!data.weaponTypes.get(main.kind).dualWield) return { ok: false, reason: '今の武器では二刀流できない' };
    }
  }
  return { ok: true, reason: '' };
}

// ---------------- 能力値 ----------------

function grade(data, member, stat) {
  const job = data.jobsById.get(member.job);
  const letter = job.grades[stat];
  const g = data.balance.player.grade_points[letter];
  if (g == null) throw new Error(`${member.job} の ${stat} の段階「${letter}」が grade_points にない`);
  return g;
}

export function gearEffects(gear) {
  const out = {};
  const scale = gear.enh >= 10 ? 1.1 : gear.enh >= 5 ? 1.05 : 1;
  for (const [key, value] of Object.entries(gear.affixes ?? {})) out[key] = value * scale;
  for (const slot of gear.enchants ?? []) out[slot.stat] = (out[slot.stat] ?? 0) + slot.value;
  return out;
}

export function affixSum(member, key) {
  let v = 0;
  for (const gear of Object.values(member.equip ?? {})) if (gear) v += gearEffects(gear)[key] ?? 0;
  return v;
}

/** レベルとジョブだけで決まる能力値（装備なし） */
export function baseStat(data, member, stat) {
  const p = data.balance.player;
  const g = grade(data, member, stat);
  return evaluate(stat === 'hp' ? p.hp : p.other_stats, { g, Lv: member.lv });
}

/** 戦闘のあとも残る状態異常（衰弱など maxhp_down）による最大HPの割合 */
function persistHpFactor(data, member) {
  let f = 1;
  for (const id of member.persist ?? []) {
    const st = data.statusEffects?.get(id);
    if (st?.kind === 'maxhp_down') f -= st.value;
  }
  return Math.max(0.1, f);
}

export function maxHp(data, member) {
  const mods = memberMods(data, member);
  return Math.max(1, Math.round((baseStat(data, member, 'hp') + affixSum(member, 'HP')) * persistHpFactor(data, member) * (1 + (member.room?.hp ?? 0) + (mods.hp ?? 0))));
}
export function maxMp(data, member) {
  const mods = memberMods(data, member);
  return Math.round(evaluate(data.balance.player.mp, { gMAG: grade(data, member, 'mag'), Lv: member.lv }) * (1 + (member.room?.mp ?? 0) + (mods.mp ?? 0)));
}

/** 防具（頭・体・腕）1つぶんの防御の値 */
export function armorPieceValue(data, member, gear) {
  const def = gearDef(data, gear);
  const w = data.armorWeights.get(def.armorWeight);
  const total = evaluate(data.balance.armor_value, {
    itemLv: def.itemLv, def_res_mul: w.defResMul, quality: gear.quality, 強化値: gear.enh,
  });
  return (total / ARMOR_SLOTS.length) * (aptitudeMul(data, member.job, def) ?? 0);
}

/** 武器の攻撃力 */
export function weaponPower(data, member, gear) {
  if (!gear) return 0;
  const def = gearDef(data, gear);
  const wt = data.weaponTypes.get(def.kind);
  return evaluate(formula(data, 'weapon_power'), {
    itemLv: def.itemLv, quality: gear.quality, enh: gear.enh, power_mul: wt.powerMul,
    apt: aptitudeMul(data, member.job, def) ?? 0,
  }) * masteryMul(data, member, def.kind); // 武器の熟練度
}

/** 装備・ジョブ・レベルを合わせた能力値と、派生の値 */
export function computeStats(data, member) {
  const out = {};
  for (const s of STATS) out[s] = baseStat(data, member, s) + affixSum(member, s.toUpperCase());
  out.hp = maxHp(data, member);

  let armor = 0;
  let armorSpd = 0;
  let armorEva = 0;
  for (const slot of ARMOR_SLOTS) {
    const gear = member.equip[slot];
    if (!gear) continue;
    armor += armorPieceValue(data, member, gear);
    const w = data.armorWeights.get(gearDef(data, gear).armorWeight);
    armorSpd += w.spdMod;
    armorEva += w.evasionBonus;
  }
  out.def += armor;
  out.res += armor;
  if (member.equip.cloak) out.res += evaluate(formula(data, 'cloak_res'), { itemLv: gearDef(data, member.equip.cloak).itemLv }) * member.equip.cloak.quality * (1 + 0.05 * member.equip.cloak.enh);
  const mainDef = member.equip.weapon ? gearDef(data, member.equip.weapon) : null;
  const wt = mainDef ? data.weaponTypes.get(mainDef.kind) : null;
  out.spd += armorSpd / ARMOR_SLOTS.length + (wt?.spdMod ?? 0);

  // パッシブ・共通ツリー・ジョブを極めたボーナス（%）
  const mods = memberMods(data, member);
  for (const s of ['str', 'mag', 'def', 'res', 'spd', 'luk']) out[s] *= 1 + (mods[s] ?? 0);
  for (const s of STATS) if (s !== 'hp') out[s] = Math.round(out[s]);
  out.mp = maxMp(data, member);
  out.attack = Math.round(weaponPower(data, member, member.equip.weapon));
  out.offhandAttack = Math.round(weaponPower(data, member, member.equip.offhand));
  const env = { LUK: out.luk, SPD: out.spd, Lv: member.lv, crit_bonus: wt?.critBonus ?? 0, armor_evasion: armorEva / ARMOR_SLOTS.length };
  // 装備の効果（CRT・EVA・STATUS_RES は % の値）
  out.crit = evaluate(formula(data, 'crit'), env) + affixSum(member, 'CRT') / 100 + (mods.crt ?? 0);
  out.evasion = evaluate(formula(data, 'evasion'), env) + affixSum(member, 'EVA') / 100 + (mods.eva ?? 0);
  out.statusResist = evaluate(formula(data, 'status_resist'), env) + affixSum(member, 'STATUS_RES') / 100 + (member.room?.sres ?? 0) + (mods.sres ?? 0);
  const caps = data.balance.battle_formulas ?? {};
  out.crit = Math.max(0, Math.min(caps.crit_cap ?? 0.85, out.crit));
  out.evasion = Math.max(0, Math.min(caps.evasion_cap ?? 0.6, out.evasion));
  out.statusResist = Math.max(0, Math.min(caps.status_resist_cap ?? 0.9, out.statusResist));
  return out;
}

// ---------------- レベル ----------------

export function levelCap(data) { return data.balance.player.level_cap; }
export function xpToNext(data, lv) { return Math.round(evaluate(data.balance.player.xp_to_next, { Lv: lv })); }

/**
 * 経験値を足す（レベルが上がれば、上がった分だけ HP・MP も増える）
 * @returns 上がったレベルの数
 */
export function gainXp(data, member, amount) {
  const cap = levelCap(data);
  if (member.lv >= cap) { member.xp = 0; return 0; }
  member.xp += amount;
  let ups = 0;
  while (member.lv < cap && member.xp >= xpToNext(data, member.lv)) {
    member.xp -= xpToNext(data, member.lv);
    const oh = maxHp(data, member);
    const om = maxMp(data, member);
    member.lv += 1;
    ups += 1;
    if (member.hp > 0) member.hp += maxHp(data, member) - oh;
    member.mp += maxMp(data, member) - om;
  }
  if (member.lv >= cap) member.xp = 0;
  return ups;
}

// ---------------- 装備の付け外し（倉庫とのやりとり） ----------------

/** 倉庫（game.storage.gear）から装備をつける。前についていたものは倉庫へ戻す */
export function equipFromStorage(data, game, member, slot, uid) {
  const idx = game.storage.gear.findIndex((g) => g.uid === uid);
  if (idx < 0) throw new Error('倉庫にその装備がない');
  const gear = game.storage.gear[idx];
  const check = canEquip(data, member, slot, gear);
  if (!check.ok) throw new Error(check.reason);
  const previous = member.equip[slot];
  game.storage.gear.splice(idx, 1);
  member.equip[slot] = gear;
  if (previous) game.storage.gear.push(previous);
  // 両手武器にしたら、サブ武器は外す。二刀流できない武器にしたときも外す
  if (slot === 'weapon' && member.equip.offhand) {
    const wt = data.weaponTypes.get(gearDef(data, gear).kind);
    if (!wt.dualWield) unequip(data, game, member, 'offhand');
  }
  clampHpMp(data, member);
}

/** 外して倉庫へ */
export function unequip(data, game, member, slot) {
  const gear = member.equip[slot];
  if (!gear) return;
  member.equip[slot] = null;
  game.storage.gear.push(gear);
  if (slot === 'weapon' && member.equip.offhand) unequip(data, game, member, 'offhand');
  clampHpMp(data, member);
}

function clampHpMp(data, member) {
  member.hp = Math.min(member.hp, maxHp(data, member));
  member.mp = Math.min(member.mp, maxMp(data, member));
}

// ---------------- キャラを作る ----------------

/** そのジョブの最初の装備（start_weapon / start_armor_weight のうち、いちばん低い段階のもの） */
export function starterGearIds(data, jobId) {
  const job = data.jobsById.get(jobId);
  const lowest = (pred) => [...data.equipment.values()].filter(pred).sort((a, b) => a.itemLv - b.itemLv)[0]?.id ?? null;
  const out = {};
  if (job.startWeapon) out.weapon = lowest((e) => e.slot === 'weapon' && e.kind === job.startWeapon);
  if (job.startArmorWeight) {
    for (const s of ARMOR_SLOTS) out[s] = lowest((e) => e.slot === s && e.armorWeight === job.startArmorWeight);
  }
  return out;
}

/**
 * キャラを1人作る（Lv1・HP/MP 満タン・最初の装備つき）
 * @param spec { name, job, icon }
 */
export function createMember(data, game, spec, index) {
  if (!data.jobsById.has(spec.job)) throw new Error(`ジョブ ${spec.job} がない`);
  const member = {
    id: `m${index + 1}`, name: spec.name, icon: spec.icon, job: spec.job,
    lv: 1, xp: 0, hp: 0, mp: 0, ap: { [spec.job]: 0 }, persist: [], learned: [], common: [], mastery: {}, loadout: null,
    equip: Object.fromEntries(SLOTS.map((s) => [s, null])),
  };
  for (const [slot, id] of Object.entries(starterGearIds(data, spec.job))) {
    if (id) member.equip[slot] = makeGear(game, id);
  }
  if (data.skills) ensureLoadout(data, member);
  member.hp = maxHp(data, member);
  member.mp = maxMp(data, member);
  return member;
}
