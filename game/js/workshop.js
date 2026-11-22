import { parseAmounts, splitList } from './csv.js';
import { makeGear } from './character.js?v=rune-study-1';
import { rollAffixes } from './loot.js?v=rune-study-1';
import { matchesNeed, parseMaterialNeed } from './town.js?v=rune-study-1';
import { currentRank } from './dungeon.js?v=rune-study-1';
import { consumeMaterials } from './temple.js?v=rune-study-1';
import { describeEffect } from './equipment-effects.js?v=balance-builds-1';

const facilityFor = (def) => def.slot === 'weapon' ? 'weapon_workshop'
  : ['cloak', 'accessory'].includes(def.slot) ? 'accessory_workshop' : 'armor_workshop';
const capFor = (data, game, facility) => data.facilityRanks.find((r) => Number(r.rank) === (game.facilities[facility] ?? 1));

function pay(game, gold, materials = {}) {
  if (game.gold < gold) throw new Error(`お金が足りません（${gold} G必要）。`);
  consumeMaterials(game, materials);
  game.gold -= gold;
}

function typeMaterials(data, game, needs) {
  const pool = { ...game.storage.materials };
  const picked = {};
  for (const need of needs) {
    let left = need.count;
    for (const [id, n] of Object.entries(pool)) {
      if (!left) break;
      if (n <= 0 || !matchesNeed(data, id, need)) continue;
      const amount = Math.min(n, left);
      pool[id] -= amount;
      picked[id] = (picked[id] ?? 0) + amount;
      left -= amount;
    }
    if (left) throw new Error(`素材が足りません（${need.text}）。`);
  }
  return picked;
}

export function facilityUpgrade(data, game, id) {
  const rank = (game.facilities[id] ?? 1) + 1;
  const row = data.facilityRanks.find((r) => Number(r.rank) === rank);
  if (!row || !data.facilities.some((f) => f.id === id)) throw new Error('施設をこれ以上強化できません。');
  if (game.overdue) throw new Error('ギルド会費の滞納を払ってください。');
  if (rank > currentRank(data, game).maxDungeonRank) throw new Error('冒険者ランクが足りません。');
  const cost = Number(row.invest_cost);
  const materialRule = row.materials ? parseMaterialNeed(data, row.materials) : [];
  pay(game, cost, typeMaterials(data, game, materialRule));
  game.facilities[id] = rank;
  return `施設ランクが ${rank} に上がった。`;
}

export function brew(data, game, recipe) {
  const item = data.items.get(recipe.result);
  const qty = Number(recipe.qty);
  if (!item || !Number.isInteger(qty) || qty <= 0) throw new Error('調合レシピを使用できません。');
  if ((game.facilities.item_shop ?? 1) < Number(recipe.workshop_rank)) throw new Error('道具屋ランクが足りません。');
  if ((game.items[item.id] ?? 0) + qty > 10) throw new Error('持てる道具は1種類10個までです。');
  pay(game, Number(recipe.gold), typeMaterials(data, game, parseMaterialNeed(data, recipe.materials)));
  game.items[item.id] = (game.items[item.id] ?? 0) + qty;
  return `${item.name}を ${qty} 個作った。`;
}

export function craft(data, game, def) {
  const recipe = data.recipes.find((r) => r.id === def.id);
  const level = game.facilities[facilityFor(def)] ?? 1;
  const rank = Number(recipe?.workshop_rank ?? def.star);
  if (level < rank) throw new Error('工房ランクが足りません。');
  if (!recipe && (!def.source?.includes('制作') || def.unique || def.setId)) throw new Error('制作できない装備です。');
  const prerequisite = recipe?.derive_from ? game.storage.gear.find((g) => g.id === recipe.derive_from && g.crafted) : null;
  if (recipe?.derive_from && !prerequisite) throw new Error('派生元の制作装備を倉庫に入れてください。');
  const materials = recipe
    ? Object.fromEntries(parseAmounts(recipe.materials).map(({ id, count }) => [id, count]))
    : typeMaterials(data, game, [{ count: 4, minRank: def.star, kind: 'common', text: `★${def.star}以上の通常素材` }]);
  pay(game, Number(recipe?.gold ?? data.economy.get(def.star).craft_gold), materials);
  if (prerequisite) game.storage.gear.splice(game.storage.gear.indexOf(prerequisite), 1);
  // 専用レシピの固定効果は装備の永続効果として保存する。
  // 鍛冶・付与と併用できるが、固定効果は振り直し対象にしない（craftedで制御）。
  const gear = makeGear(game, def.id, {
    quality: 1 + Number(recipe?.base_stat_bonus_pct ?? 15) / 100,
    affixes: { ...(def.fixedEffects ?? {}) },
  });
  gear.crafted = true;
  game.storage.gear.push(gear);
  return `${def.name}を制作した。`;
}

export function enhance(data, game, gear, rng) {
  const def = data.equipment.get(gear.id);
  const row = data.enhanceRates.find((r) => Number(r.from_level) === gear.enh);
  const cap = Number(capFor(data, game, facilityFor(def))?.enhance_cap ?? 0);
  if (!row || Number(row.to_level) > cap) throw new Error('この工房での強化上限に達しています。');
  const base = (20 + def.itemLv * 4) * 1.8 ** gear.enh;
  pay(game, Math.ceil(base * (def.slot === 'weapon' ? 1 : 0.5)), { enhancement_stone: 1 });
  const odds = Math.min(1, Number(row.success_rate) + 0.05 * (gear.enhanceFailures ?? 0));
  if (rng() >= odds) {
    gear.enhanceFailures = (gear.enhanceFailures ?? 0) + 1;
    return '強化に失敗した。次の成功率が上がります。';
  }
  gear.enh = Number(row.to_level);
  gear.enhanceFailures = 0;
  return `${def.name}を +${gear.enh} に強化した。`;
}

export const fragmentId = (gear) => `fragment_${gear.rarity ?? 'common'}`;

export function dismantle(data, game, gear) {
  const index = game.storage.gear.indexOf(gear);
  if (index < 0) throw new Error('装備を倉庫に入れてください。');
  game.storage.gear.splice(index, 1);
  const stock = game.storage.materials;
  const fragment = fragmentId(gear);
  stock[fragment] = (stock[fragment] ?? 0) + 1;
  stock.enhancement_stone = (stock.enhancement_stone ?? 0) + 1;
  return '装備を分解し、欠片と強化石を得た。';
}

export function reroll(data, game, gear, stat, rng) {
  const def = data.equipment.get(gear.id);
  if (gear.crafted || def.unique || def.setId || !(stat in (gear.affixes ?? {}))) throw new Error('この効果は振り直せません。');
  const rarity = data.rarityTable.findIndex((r) => r.id === gear.rarity);
  const cands = Object.entries(rollAffixes(data, def.slot, data.affixes.length, def.itemLv, rarity, rng))
    .filter(([key]) => key === stat || !(key in gear.affixes));
  if (!cands.length) throw new Error('選べる効果がありません。');
  const [key, value] = cands[Math.floor(rng() * cands.length)];
  pay(game, 0, { [fragmentId(gear)]: 1 + (gear.rerolls ?? 0) });
  delete gear.affixes[stat];
  gear.affixes[key] = value;
  gear.rerolls = (gear.rerolls ?? 0) + 1;
  return `${describeEffect(data, key, value)} が付いた。`;
}

export function enchantFamilies(data, def, material) {
  const monster = data.monsters.get(material.sourceMonster);
  const key = ['head', 'body', 'arm'].includes(def.slot) ? 'armor' : def.slot;
  const matches = { element: [material.element], monster_type: monster?.types ?? [],
    material_kind: [material.season ? 'season' : material.kind, ...(monster?.role === 'boss' ? ['boss'] : [])] };
  const allowed = data.enchantSources.filter((r) => matches[r.source_kind]?.includes(r.source_value)).flatMap((r) => splitList(r.families));
  const affixes = data.affixes.filter((a) => a.slot === key);
  const expand = allowed.includes('ANY')
    ? affixes.flatMap((a) => a.stat === 'TYPE_BONUS' ? [...data.monsterTypes.keys()].map((id) => `TYPE_BONUS:${id}`)
      : ['ELEMENT', 'ELEM_RES'].includes(a.stat) ? [...data.elements.values()].filter((e) => e.kind === '魔法' && e.id !== 'none').map((e) => `${a.stat}:${e.id}`) : [a.stat])
    : allowed;
  return [...new Set(expand)].filter((stat) => affixes.some((a) => a.stat === stat.split(':')[0]));
}

export function enchant(data, game, gear, slot, materialId, family, grade) {
  const def = data.equipment.get(gear.id);
  const material = data.materials.get(materialId);
  const row = data.enchantGrades.find((r) => Number(r.grade) === grade);
  const key = ['head', 'body', 'arm'].includes(def.slot) ? 'armor' : def.slot;
  const base = data.affixes.find((a) => a.slot === key && a.stat === family.split(':')[0]);
  if (!gear.crafted || def.unique || def.setId || ![0, 1].includes(slot) || (slot === 1 && !gear.enchants?.[0])) throw new Error('この枠には付与できません。');
  if (!row || (game.facilities[facilityFor(def)] ?? 1) < Number(row.workshop_rank)) throw new Error('工房ランクが足りません。');
  if (!base || !material || !enchantFamilies(data, def, material).includes(family)) throw new Error('その素材では付けられない効果です。');
  const value = base.stat === 'ELEMENT' ? 1 : Math.round(base.max * Number(row.value_mul) * (base.scales ? 1 + def.itemLv / 12 : 1) * 10) / 10;
  pay(game, Number(row.gold), { [materialId]: 1 });
  gear.enchants ??= [];
  gear.enchants[slot] = { stat: family, value };
  return `${describeEffect(data, family, value)} を付けた。`;
}
