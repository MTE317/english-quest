// パーティのキャラ：能力値・装備8枠・レベル。
// 式は data/balance.json から読む。balance.json に式として書かれていないもの（説明の文だけのもの）は、
// シミュレーター（sim/core.py）と同じ式を下の SIM_FORMULAS に置いて使う。docs/requests.md で balance.json への追加を依頼済み。
import { evaluate, isFormula } from './expr.js?v=skill-growth-2';
import { equipmentTier, rarityBonus } from './equipment-scaling.js?v=equipment-rarity-1';
import { memberMods, masteryMul, ensureLoadout, effectiveSkill, skillWeaponBlock } from './growth.js?v=advanced-jobs-1';

export const STATS = ['hp', 'mp', 'str', 'mag', 'def', 'res', 'spd', 'luk'];
export const STAT_LABEL = { hp: 'HP', mp: 'MP', str: 'STR', mag: 'MAG', def: 'DEF', res: 'RES', spd: 'SPD', luk: 'LUK' };

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

/** 装備を1つ作る（所持品や装備枠に入るもの） */
export function makeGear(game, equipId, opts = {}) {
  game.nextUid = (game.nextUid ?? 1);
  const gear = {
    uid: game.nextUid++, id: equipId, enh: opts.enh ?? 0,
    rarity: opts.rarity ?? 'common', affixes: opts.affixes ?? {},
    affixOrigins: opts.affixOrigins ?? {},
  };
  return gear;
}

export function gearDef(data, gear) {
  const def = data.equipment.get(gear.id);
  if (!def) throw new Error(`equipment.csv に ${gear.id} がない`);
  return def;
}

// ---------------- 適正 ----------------

/** 武器は全職で装備可能。表にない武器の適性もDとして扱う。 */
export function aptitudeGrade(data, jobId, def) {
  if (def.slot === 'weapon') {
    const value = data.jobWeaponApt.get(jobId)?.[def.kind];
    return value && value !== '×' ? value : 'D';
  }
  if (def.armorWeight) return data.jobArmorApt.get(jobId)?.[def.armorWeight] || '×';
  return null; // マント・アクセサリーは適正なし
}
export function aptitudeMul(data, jobId, def) {
  const g = aptitudeGrade(data, jobId, def);
  if (g == null) return 1;
  return data.aptitude.get(g) ?? (g === 'D' ? 0.55 : null);
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
  const letter = job.grades[stat] ?? (stat === 'mp' ? job.grades.mag : undefined);
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
  if (stat === 'mp') return evaluate(p.mp, { g, gMP: g, gMAG: g, Lv: member.lv });
  return evaluate(stat === 'hp' ? p.hp : p.other_stats, { g, Lv: member.lv });
}

/** 戦闘のあとも残る状態異常（衰弱など maxhp_down）による最大HPの割合 */
export function memberCanAct(member, petrified = member.persist?.includes('petrify')) {
  return member.hp > 0 && !petrified;
}

export function partyCanAct(game) {
  return game.party.some((member) => memberCanAct(member));
}

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
  return Math.max(0, Math.round((baseStat(data, member, 'mp') + affixSum(member, 'MP')) * (1 + (member.room?.mp ?? 0) + (mods.mp ?? 0))));
}

/** 防具（頭・体・腕）1つぶんの防御の値 */
export function armorPieceValue(data, member, gear) {
  const def = gearDef(data, gear);
  const w = data.armorWeights.get(def.armorWeight);
  const total = equipmentTier(data, def.star).armorBase * w.defResMul
    * rarityBonus(data, gear.rarity).base * (1 + 0.05 * gear.enh) * 1.6;
  return (total / ARMOR_SLOTS.length) * (aptitudeMul(data, member.job, def) ?? 0);
}

/** 武器の攻撃力 */
export function weaponPower(data, member, gear) {
  if (!gear) return 0;
  const def = gearDef(data, gear);
  const wt = data.weaponTypes.get(def.kind);
  return equipmentTier(data, def.star).weaponBase * rarityBonus(data, gear.rarity).base
    * (1 + 0.05 * gear.enh) * wt.powerMul * (aptitudeMul(data, member.job, def) ?? 0)
    * masteryMul(data, member, def.kind); // 武器の熟練度
}

/** 魔法用装備の補助値。物理武器威力や銃の倍率を魔法・回復へ転用しない。 */
export function spellPower(data, member, gear = member.equip?.weapon) {
  if (!gear) return 0;
  const def = gearDef(data, gear);
  const rules = data.basicJobRules?.spell_equipment ?? {};
  if (!(rules.types ?? ['staff', 'tome', 'instrument', 'fan']).includes(def.kind)) return 0;
  const base = (rules.base ?? 3) + (rules.per_level ?? 1.8) * equipmentTier(data, def.star).spellLevelBase;
  return Math.max(0, base * rarityBonus(data, gear.rarity).base * (1 + 0.05 * (gear.enh ?? 0))
    * (aptitudeMul(data, member.job, def) ?? 0));
}
/** 鎌術だけに使う術装備補助。通常の鎌の物理威力は加算しない。 */
export function scytheSpellPower(data, member) {
  const gear=member.equip?.weapon;
  if (!gear || gearDef(data,gear).kind!=='scythe') return 0;
  const def=gearDef(data,gear),rules=data.basicJobRules?.spell_equipment??{};
  return Math.max(0,((rules.base??3)+(rules.per_level??1.8)*equipmentTier(data,def.star).spellLevelBase)
    *rarityBonus(data,gear.rarity).base*(1+.05*(gear.enh??0))*(aptitudeMul(data,member.job,def)??0));
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
  if (member.equip.cloak) out.res += (equipmentTier(data, gearDef(data, member.equip.cloak).star).armorBase * 0.3) * rarityBonus(data, member.equip.cloak.rarity).base * (1 + 0.05 * member.equip.cloak.enh);
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
  out.statusResist = Math.max(0, Math.min(caps.status_resist_cap ?? 1, out.statusResist));
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

// ---------------- 装備の付け外し（所持品とのやりとり） ----------------

/** 所持品（game.storage.gear）から装備をつける。前についていたものは所持品へ戻す */
export function equipFromStorage(data, game, member, slot, uid) {
  const idx = game.storage.gear.findIndex((g) => g.uid === uid);
  if (idx < 0) throw new Error('所持品にその装備がない');
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

/** 外して所持品へ */
export function unequip(data, game, member, slot) {
  const gear = member.equip[slot];
  if (!gear) return;
  member.equip[slot] = null;
  game.storage.gear.push(gear);
  if (slot === 'weapon' && member.equip.offhand) unequip(data, game, member, 'offhand');
  clampHpMp(data, member);
}

/** 汎用おすすめの評価。敵の弱点や特定の状態耐性への対策は固定枠で指定する。 */
function recommendationProfile(data, member, skills) {
  const job = data.jobsById.get(member.job);
  const ref = job.statReference ?? '';
  let physical = /STR/.test(ref) ? 2 : 0;
  let magical = /MAG/.test(ref) ? 2 : 0;
  if (!physical && !magical) {
    const magicalStart = data.weaponTypes.get(job.startWeapon)?.attackStat === 'mag';
    physical = magicalStart ? 0 : 2;
    magical = magicalStart ? 2 : 0;
  }
  let healing = /回復/.test(job.role ?? '') ? 2 : 0;
  for (const skill of skills) {
    if (skill.effect?.base === 'mag') magical++;
    if (['weapon', 'str', 'spd', 'luk'].includes(skill.effect?.base)) physical++;
    if (skill.kind === 'heal') { magical++; healing++; }
  }
  return { magic: magical / (physical + magical), healing: healing > 0,
    scythe: skills.some(skill => skill.effect?.rules?.scythe_spell),
    tank: /護衛|防御|かばう/.test(job.role ?? '') };
}

function recommendationScore(data, member, profile) {
  const st = computeStats(data, member);
  const wt = member.equip.weapon && data.weaponTypes.get(gearDef(data, member.equip.weapon).kind);
  const traits = wt?.traits ?? {};
  const rate = key => Math.max(0, Math.min(100, affixSum(member, key))) / 100;
  const physical = (st.str * (traits.str_mul ?? 1) + st.attack)
    * (traits.weapon_skill_mul ?? 1) * (1 + st.crit * (0.5 + rate('CRIT_DMG')))
    * (1 + rate('DEF_PIERCE') * 0.25 + rate('EXTRA_HIT') * 0.5);
  // サブ武器は通常攻撃だけに寄与するため、通常攻撃と技能を半々とした汎用評価。
  const offType = member.equip.offhand && data.weaponTypes.get(gearDef(data, member.equip.offhand).kind);
  const offhand = offType
    ? (st.str * (offType.traits?.str_mul ?? 1) + st.offhandAttack)
      * (data.balance.battle.dual_wield_second_hit ?? 0.5) * 0.5 : 0;
  const spell = spellPower(data, member) + (profile.scythe ? scytheSpellPower(data, member) : 0);
  const magical = (st.mag * (traits.mag_mul ?? 1) + spell)
    * (profile.healing ? (traits.heal_mul ?? 1) * (1 + rate('HEAL_POWER')) : 1);
  const offense = (1 - profile.magic) * (physical + offhand) + profile.magic * magical;
  // HPとMPは他の能力より桁が大きいため重みを下げる。適性・熟練・追加効果は実能力へ反映済み。
  return offense + (st.def + st.res + st.hp / 8) * (profile.tank ? 0.65 : 0.3)
    + st.mp * (profile.magic ? 0.12 : 0.04) + st.spd * 0.5 + st.luk * 0.1
    + st.evasion * 30 + st.statusResist * 15
    + (rate('PHYS_CUT') + rate('MAGIC_CUT')) * (profile.tank ? 60 : 30)
    + rate('MP_SAVE') * (profile.magic ? 20 : 10);
}

/** 現在装備と所持品から選ぶ。他メンバーの装備・固定枠・使用可能な技能を保護する。 */
export function equipRecommended(data, game, member) {
  // 評価中のパッシブ正規化などで実セーブを書き換えない。
  const probe = structuredClone(member);
  const original = { ...member.equip };
  const pool = [...new Map([...Object.values(original), ...game.storage.gear]
    .filter(Boolean).map(gear => [gear.uid, gear])).values()];
  const locks = member.equipmentLocks ?? {};
  const ids = [...(member.loadout?.actions ?? []), ...(member.loadout?.passives ?? []), member.loadout?.ultimate];
  const skills = [...new Set(ids.filter(Boolean))].map(id => data.skills.get(id)).filter(Boolean)
    .map(skill => effectiveSkill(data, probe, skill));
  const protectedSkills = skills.filter(skill => !skillWeaponBlock(data, probe, skill));
  const profile = recommendationProfile(data, member, skills);
  let best = { ...original };
  probe.equip = best;
  let score = recommendationScore(data, probe, profile);
  const consider = equip => {
    const used = new Set();
    probe.equip = equip;
    for (const slot of SLOTS) {
      const gear = equip[slot];
      if (locks[slot] && gear?.uid !== original[slot]?.uid) return;
      if (!gear) continue;
      if (used.has(gear.uid) || !canEquip(data, probe, slot, gear).ok) return;
      used.add(gear.uid);
    }
    if (protectedSkills.some(skill => skillWeaponBlock(data, probe, skill))) return;
    const next = recommendationScore(data, probe, profile);
    // 同点では変更しない。再実行でも同じ装備に落ち着く。
    if (next > score + 1e-8) { score = next; best = { ...equip }; }
  };
  const candidates = slot => locks[slot] ? [original[slot]]
    : [best[slot], null, ...pool.filter(gear => gearDef(data, gear).slot === SLOT_KIND[slot])];
  // 主副武器とアクセサリーはペア評価。他の枠は改善がなくなるまで反復。
  let previous;
  do {
    previous = score;
    for (const [a, b] of [['weapon', 'offhand'], ['accessory1', 'accessory2']]) {
      for (const first of candidates(a)) for (const second of candidates(b)) {
        consider({ ...best, [a]: first, [b]: second });
      }
    }
    for (const slot of ['head', 'body', 'arm', 'cloak']) {
      for (const gear of candidates(slot)) consider({ ...best, [slot]: gear });
    }
  } while (score > previous + 1e-8);
  const changed = SLOTS.filter(slot => best[slot]?.uid !== original[slot]?.uid).length;
  if (changed) {
    const equipped = new Set(Object.values(best).filter(Boolean).map(gear => gear.uid));
    game.storage.gear = pool.filter(gear => !equipped.has(gear.uid));
    member.equip = best;
    clampHpMp(data, member);
  }
  return changed;
}

function clampHpMp(data, member) {
  member.hp = Math.min(member.hp, maxHp(data, member));
  member.mp = Math.min(member.mp, maxMp(data, member));
}

// ---------------- キャラを作る ----------------

/** そのジョブの最初の装備（start_weapon / start_armor_weight のうち、いちばん低い段階のもの） */
export function starterGearIds(data, jobId) {
  const job = data.jobsById.get(jobId);
  const lowest = (pred) => [...data.equipment.values()].filter(pred).sort((a, b) => a.star - b.star)[0]?.id ?? null;
  const out = {};
  if (job.startWeapon) out.weapon = lowest((e) => e.slot === 'weapon' && e.kind === job.startWeapon);
  if (job.startArmorWeight) {
    for (const s of ARMOR_SLOTS) out[s] = lowest((e) => e.slot === s && e.armorWeight === job.startArmorWeight);
  }
  return out;
}

/**
 * キャラを1人作る（Lv1・HP/MP満タン・無装備・技能未修得）。
 * @param spec { name, job, icon }
 */
export function createMember(data, game, spec, index) {
  if (!data.jobsById.has(spec.job)) throw new Error(`ジョブ ${spec.job} がない`);
  const member = {
    id: `m${index + 1}`, name: spec.name, icon: spec.icon, job: spec.job,
    lv: 1, xp: 0, hp: 0, mp: 0, ap: data.basicJobRules?.starting_ap ?? 30, apVersion: 1, skillAcquisitionVersion: 1, visitedJobs: [spec.job], persist: [], learned: [], common: [], mastery: {}, loadout: null,
    equip: Object.fromEntries(SLOTS.map((s) => [s, null])),
  };
  if (data.skills) ensureLoadout(data, member);
  member.hp = maxHp(data, member);
  member.mp = maxMp(data, member);
  return member;
}



