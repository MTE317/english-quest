import { equipmentTier, rarityBonus } from './equipment-scaling.js?v=equipment-rarity-1';

const round = value => Math.round(value * 10) / 10;
const between = (rng, min, max) => Math.min(max, Math.floor(rng() * (max - min + 1)) + min);
const category = slot => ['head', 'body', 'arm'].includes(slot) ? 'armor' : slot;
const family = key => key.split(':')[0];
const SPECIAL = new Set(['ELEMENT', 'ENDURE']);

export const uniqueGear = (def, gear) => Boolean(def?.unique || def?.recipeId || gear?.crafted);
export const numericEffect = key => !SPECIAL.has(family(key));
export const rarityRange = (data, rarity) => {
  const base = data.rarityTable.find(row => row.id === rarity)?.effects ?? 0;
  return [base, base + 2];
};
export const enchantCost = (data, def) => Number(data.economy.get(def.star)?.craft_gold ?? 0) * 2;
export const facilityValueMul = (data, game) => Number(data.enchantGrades.find(row =>
  Number(row.workshop_rank) === Number(game.facilities?.workshop ?? 1))?.value_mul ?? 0.7);

function rulesFor(data, slot) {
  const kind = category(slot);
  const rules = data.affixes.filter(row => row.slot === kind && row.stat !== 'VS_DEBUFFED').map(row => ({ ...row }));
  for (const override of data.enchantOverrides ?? []) {
    if (override.slot !== kind) continue;
    const old = rules.find(row => row.stat === override.stat);
    if (old) old.max = Number(override.max);
    else rules.push({ slot: kind, stat: override.stat, min: Number(override.max) / 2,
      max: Number(override.max), scales: false, weight: 3 });
  }
  return rules;
}

export function candidates(data, slot) {
  const kinds = rulesFor(data, slot);
  return kinds.flatMap(row => {
    const options = row.stat === 'TYPE_BONUS' ? [...data.monsterTypes.keys()].map(id => `TYPE_BONUS:${id}`)
      : ['ELEMENT', 'ELEM_DMG', 'ELEM_RES'].includes(row.stat)
        ? [...data.elements.values()].filter(e => e.id !== 'none').map(e => `${row.stat}:${e.id}`)
      : ['STATUS_RATE', 'STATUS_RES', 'VS_STATUS'].includes(row.stat)
        ? [...data.statusEffects.keys(), ...(row.stat === 'VS_STATUS' ? ['statdown'] : [])]
          .map(id => `${row.stat}:${id}`)
      : row.stat === 'DOT_POWER' ? ['poison', 'toxic', 'burn', 'bleed'].map(id => `DOT_POWER:${id}`)
      : [row.stat];
    return options.map(id => ({ ...row, id }));
  });
}

function pickWeighted(pool, rng, preferred) {
  const weights = pool.map(row => Number(row.weight ?? 1) * (preferred?.has(row.id) ? 4 : 1));
  let roll = rng() * weights.reduce((sum, value) => sum + value, 0);
  return pool.find((_, index) => (roll -= weights[index]) < 0) ?? pool.at(-1);
}

function pickTargeted(pool, rng, preferred) {
  const boosted = pool.filter(row => preferred.has(row.id));
  // 65% narrows to the material's matches; 35% still draws from every eligible effect.
  return pickWeighted(boosted.length && rng() < 0.65 ? boosted : pool, rng, preferred);
}

function baseValue(data, def, row, rarity, mul, rng) {
  if (!numericEffect(row.id)) return 1;
  const scale = row.scales ? equipmentTier(data, def.star).affixScale : 1;
  const lower = Number(row.min) === Number(row.max) ? Number(row.min) * 0.8 : Number(row.min);
  return round((lower + (Number(row.max) - lower) * rng())
    * scale * rarityBonus(data, rarity).effect * mul);
}

export function rollCommon(data, def, rarity, count, rng, { exclude = [], preferred = [], mul = 1 } = {}) {
  const out = {}, chosen = new Set(exclude);
  let pool = candidates(data, def.slot).filter(row => !chosen.has(row.id));
  const favored = new Set(preferred);
  for (let index = 0; index < count && pool.length; index++) {
    // A targeting material raises the chance for a corresponding effect, without guaranteeing it.
    const row = pickTargeted(pool, rng, favored);
    out[row.id] = baseValue(data, def, row, rarity, mul, rng);
    chosen.add(row.id);
    pool = pool.filter(entry => entry.id !== row.id);
  }
  return out;
}

const extraEffects = def => {
  const effects = Object.keys(def.fixedEffects ?? {});
  const kind = category(def.slot);
  if (def.addedElement) effects.push(`ELEM_DMG:${def.addedElement}`);
  const statuses = effects.filter(key => key.startsWith('STATUS_ON_HIT:')).map(key => key.split(':')[1]);
  for (const status of statuses) effects.push(`STATUS_RATE:${status}`, `VS_STATUS:${status}`, `DOT_POWER:${status}`);
  if (effects.some(key => /HEAL_POWER|PARTY_BUFF_POWER/.test(key))) effects.push('MAG', 'MP_SAVE', 'HEAL_POWER', 'PARTY_BUFF_POWER');
  if (effects.some(key => /CRT|CRIT_DMG|EXTRA_HIT/.test(key))) effects.push('CRT', 'CRIT_DMG', 'FIRST_HIT', 'EXTRA_HIT');
  if (kind === 'armor') effects.push('HP', 'DEF', 'RES', 'PHYS_CUT', 'MAGIC_CUT', 'ELEM_RES:fire');
  if (kind === 'cloak') effects.push('EVA', 'FIRST_SPD', 'RES', 'MAGIC_CUT');
  if (kind === 'accessory') effects.push('HP', 'SPD', 'LUK', 'CRT', 'EXP');
  if (kind === 'weapon') effects.push('STR', 'MAG', 'CRT', 'WEAK_DMG', 'DEF_PIERCE', 'MP_SAVE');
  return [...new Set(effects)];
};

export function uniqueCandidates(data, def) {
  const original = { ...(def.fixedEffects ?? {}) };
  const pool = new Map(candidates(data, def.slot).map(row => [row.id, row]));
  for (const key of extraEffects(def)) {
    if (Object.keys(original).length >= 4) break;
    if (Object.hasOwn(original, key) || !pool.has(key)) continue;
    const rule = pool.get(key);
    const scale = rule.scales ? Math.min(4, equipmentTier(data, def.star).affixScale / 2) : 1;
    original[key] = numericEffect(key) ? round((Number(rule.min) + Number(rule.max)) / 2 * scale) : 1;
  }
  if (Object.keys(original).length < 4) throw new Error(`${def.id} の固有効果候補が4種類に足りません。`);
  return original;
}

export function rollUnique(data, def, rng, { preferred = [], mul = 1 } = {}) {
  const source = uniqueCandidates(data, def);
  let pool = Object.keys(source).map(id => ({ id, weight: 1 }));
  const favored = new Set(preferred);
  const affixes = {}, origins = {};
  for (let index = 0, n = between(rng, 2, 4); index < n; index++) {
    const row = pickTargeted(pool, rng, favored);
    const value = Number(source[row.id]);
    affixes[row.id] = numericEffect(row.id) ? round(value * (0.8 + rng() * 0.4) * mul) : 1;
    origins[row.id] = 'unique';
    pool = pool.filter(entry => entry.id !== row.id);
  }
  return { affixes, origins };
}

export function rollSet(data, def, rarity, rng, options = {}) {
  if (!options.forceUnique && !uniqueGear(def)) {
    const [min, max] = rarityRange(data, rarity);
    const affixes = rollCommon(data, def, rarity, between(rng, min, max), rng, options);
    return { affixes, origins: Object.fromEntries(Object.keys(affixes).map(key => [key, 'common'])) };
  }
  const selected = rollUnique(data, def, rng, options);
  const extra = rollCommon(data, def, 'unique', between(rng, 0, 2), rng,
    { ...options, exclude: Object.keys(selected.affixes) });
  Object.assign(selected.affixes, extra);
  Object.assign(selected.origins, Object.fromEntries(Object.keys(extra).map(key => [key, 'common'])));
  return selected;
}

export function rerollValue(data, def, gear, key, rng, mul) {
  if (!numericEffect(key)) throw new Error('この効果には数値がありません。');
  if (!(key in (gear.affixes ?? {}))) throw new Error('この効果は付いていません。');
  if (gear.affixOrigins?.[key] === 'unique') {
    const value = Number(uniqueCandidates(data, def)[key]);
    if (!Number.isFinite(value)) throw new Error('固有効果の数値が不正です。');
    return round(value * (0.8 + rng() * 0.4) * mul);
  }
  const row = candidates(data, def.slot).find(entry => entry.id === key);
  if (!row) throw new Error('この効果は再抽選できません。');
  return baseValue(data, def, row, gear.rarity, mul, rng);
}
