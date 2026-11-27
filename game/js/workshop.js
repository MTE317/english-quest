import { roundGold, goldScale } from './gold.js?v=skill-growth-2';
import { parseAmounts, splitList } from './csv.js?v=skill-growth-2';
import { makeGear } from './character.js?v=unique-reroll-1';
import { rollSet, rerollValue, enchantCost, facilityValueMul, numericEffect } from './enchantment-roll.js?v=unique-reroll-1';
import { matchesNeed, parseMaterialNeed } from './town.js?v=public-rewards-1';
import { currentRank } from './dungeon.js?v=public-rewards-1';
import { consumeMaterials } from './temple.js?v=skill-growth-2';
import { describeEffect } from './equipment-effects.js?v=unique-reroll-1';
import { equipmentTier } from './equipment-scaling.js?v=equipment-rarity-1';
import { STONE_STAGES, stoneRequirement, ENCHANT_POWDER_ID, ENCHANT_POWDER_COST } from './workshop-materials.js?v=workshop-materials-1';

const facilityFor = () => 'workshop';
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

/** 画面のボタン判定。実行処理と同じ素材の選び方を使う。 */
export function canBrew(data, game, recipe) {
  const item = data.items.get(recipe?.result);
  const qty = Number(recipe?.qty);
  if (!item || !Number.isInteger(qty) || qty <= 0 ||
      (game.facilities.alchemy ?? 1) < Number(recipe.workshop_rank) ||
      (game.items[item.id] ?? 0) + qty > 10 || game.gold < Number(recipe.gold)) return false;
  try {
    typeMaterials(data, game, parseMaterialNeed(data, recipe.materials));
    return true;
  } catch { return false; }
}

export function canCraft(data, game, def) {
  if (!def) return false;
  const recipe = data.recipes.find((r) => r.id === def.id);
  if ((game.facilities[facilityFor(def)] ?? 1) < Number(recipe?.workshop_rank ?? def.star) ||
      (!recipe && (!def.source?.includes('制作') || def.unique)) ||
      (recipe?.derive_from && !game.storage.gear.some((g) => g.id === recipe.derive_from && g.crafted))) return false;
  const price = Number(recipe?.gold ?? data.economy.get(def.star)?.craft_gold);
  if (!Number.isFinite(price) || game.gold < price) return false;
  if (recipe) return parseAmounts(recipe.materials).every(({ id, count }) => (game.storage.materials[id] ?? 0) >= count);
  try {
    typeMaterials(data, game, [{ count: 4, minRank: def.star, kind: 'common', text: `★${def.star}以上の通常素材` }]);
    return true;
  } catch { return false; }
}

export function facilityUpgrade(data, game, id) {
  const rank = (game.facilities[id] ?? 1) + 1;
  const row = data.facilityRanks.find((r) => Number(r.rank) === rank);
  if (!row || !data.facilities.some((f) => f.id === id)) throw new Error('施設をこれ以上強化できません。');
  if (rank > currentRank(data, game).facilityCap) throw new Error('ギルドランクによる施設投資の上限です。');
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
  if ((game.facilities.alchemy ?? 1) < Number(recipe.workshop_rank)) throw new Error('調合所Lvが足りません。');
  if ((game.items[item.id] ?? 0) + qty > 10) throw new Error('持てる道具は1種類10個までです。');
  pay(game, Number(recipe.gold), typeMaterials(data, game, parseMaterialNeed(data, recipe.materials)));
  game.items[item.id] = (game.items[item.id] ?? 0) + qty;
  return `${item.name}を ${qty} 個作った。`;
}

export function craft(data, game, def, rng = Math.random) {
  const recipe = data.recipes.find((r) => r.id === def.id);
  const level = game.facilities[facilityFor(def)] ?? 1;
  const rank = Number(recipe?.workshop_rank ?? def.star);
  if (level < rank) throw new Error('工房ランクが足りません。');
  if (!recipe && (!def.source?.includes('制作') || def.unique)) throw new Error('制作できない装備です。');
  const prerequisite = recipe?.derive_from ? game.storage.gear.find((g) => g.id === recipe.derive_from && g.crafted) : null;
  if (recipe?.derive_from && !prerequisite) throw new Error('派生元の制作装備を倉庫に入れてください。');
  const materials = recipe
    ? Object.fromEntries(parseAmounts(recipe.materials).map(({ id, count }) => [id, count]))
    : typeMaterials(data, game, [{ count: 4, minRank: def.star, kind: 'common', text: `★${def.star}以上の通常素材` }]);
  const rolled = rollSet(data, def, 'unique', rng,
    { forceUnique: true, mul: facilityValueMul(data, game) });
  pay(game, Number(recipe?.gold ?? data.economy.get(def.star).craft_gold), materials);
  if (prerequisite) game.storage.gear.splice(game.storage.gear.indexOf(prerequisite), 1);
  const gear = makeGear(game, def.id, {
    rarity: 'unique', affixes: rolled.affixes, affixOrigins: rolled.origins,
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
  const base = equipmentTier(data, def.star).enhanceBase * 1.8 ** gear.enh;
  const stone = stoneRequirement(data, gear.enh);
  if (!stone) throw new Error('これ以上強化できません。');
  pay(game, roundGold(data, goldScale(data) * base * (def.slot === 'weapon' ? 1 : 0.5), 'ceil'), { [stone.id]: stone.count });
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
  // 分解で返す石の段階・個数は別途調整。従来どおり最低段階を1個返す。
  stock[STONE_STAGES[0].id] = (stock[STONE_STAGES[0].id] ?? 0) + 1;
  return '装備を分解し、欠片と強化石Iを得た。';
}

export function reroll(data, game, gear, stat, rng) {
  const def = data.equipment.get(gear.id);
  if (!def || !numericEffect(stat)) throw new Error('この効果の数値は再抽選できません。');
  const value = rerollValue(data, def, gear, stat, rng, facilityValueMul(data, game));
  pay(game, enchantCost(data, def), { [ENCHANT_POWDER_ID]: ENCHANT_POWDER_COST });
  gear.affixes[stat] = value;
  return `${describeEffect(data, stat, value)} に変わった。`;
}

// ドロップ品のランダム効果は維持し、工房の候補と数値だけを個別化する。
function enchantAffixes(data, slot) {
  const key = ['head', 'body', 'arm'].includes(slot) ? 'armor' : slot;
  const rules = data.affixes.filter((a) => a.slot === key && a.stat !== 'VS_DEBUFFED').map((a) => ({ ...a }));
  for (const override of data.enchantOverrides) {
    if (override.slot !== key) continue;
    const existing = rules.find((a) => a.stat === override.stat);
    if (existing) existing.max = Number(override.max);
    else rules.push({ slot: key, stat: override.stat, max: Number(override.max), scales: false });
  }
  return rules;
}

function enchantVariants(data, family) {
  if (family === 'TYPE_BONUS') return [...data.monsterTypes.keys()].map((id) => `${family}:${id}`);
  if (family === 'STATUS_RATE' || family === 'STATUS_RES' || family === 'VS_STATUS') {
    const ids = [...data.statusEffects.keys()];
    if (family === 'VS_STATUS') ids.push('statdown');
    return ids.map((id) => `${family}:${id}`);
  }
  if (family === 'DOT_POWER') return ['poison', 'toxic', 'burn', 'bleed'].map((id) => `${family}:${id}`);
  if (family === 'ELEM_DMG' || family === 'ELEM_RES') {
    return [...data.elements.values()].filter((e) => e.id !== 'none').map((e) => `${family}:${e.id}`);
  }
  if (family === 'ELEMENT') return [...data.elements.values()]
    .filter((e) => e.kind === '魔法' && e.id !== 'none').map((e) => `${family}:${e.id}`);
  return [family];
}

// 部位で付与できるすべての個別効果。素材なしでもここから抽選する。
export function enchantCandidates(data, def) {
  const excluded = new Set(['STATUS_RATE', 'STATUS_RES', 'DOT_POWER', 'VS_DEBUFFED']);
  return [...new Set(enchantAffixes(data, def.slot)
    .flatMap((affix) => enchantVariants(data, affix.stat))
    .filter((family) => !excluded.has(family)))];
}

// 旧対応表は付与の許可条件ではなく、追加素材が確率を高める効果の表として使う。
export function enchantFamilies(data, def, material) {
  if (!material || material.kind === 'workshop') return [];
  const monster = data.monsters.get(material.sourceMonster);
  const matches = { element: [material.element], monster_type: monster?.types ?? [],
    monster_status: monster?.status ? [monster.status, 'ANY'] : [],
    material_kind: [material.season ? 'season' : material.kind,
      ...(!material.element || material.element === 'none' ? ['neutral'] : []),
      ...(monster?.role === 'boss' ? ['boss'] : [])] };
  const allowed = data.enchantSources.filter((r) => matches[r.source_kind]?.includes(r.source_value))
    .flatMap((r) => splitList(r.families)).filter((family) => family !== 'ANY');
  const candidates = new Set(enchantCandidates(data, def));
  const expand = (family) => {
    if (family === 'TYPE_BONUS' && monster?.types?.length)
      return monster.types.map((id) => `TYPE_BONUS:${id}`);
    if (['STATUS_RATE', 'STATUS_RES', 'VS_STATUS', 'DOT_POWER'].includes(family)
      && monster?.status && enchantVariants(data, family).includes(`${family}:${monster.status}`))
      return [`${family}:${monster.status}`];
    return enchantVariants(data, family);
  };
  return [...new Set(allowed.flatMap(expand))].filter((family) => candidates.has(family));
}


export function enchant(data, game, gear, materialId, rng = Math.random) {
  const def = data.equipment.get(gear.id);
  const material = materialId ? data.materials.get(materialId) : null;
  if (!def) throw new Error('装備がありません。');
  if (materialId && (!material || !enchantFamilies(data, def, material).length)) throw new Error('この素材では候補を絞れません。');
  const rolled = rollSet(data, def, gear.rarity, rng, {
    forceUnique: Boolean(gear.crafted),
    preferred: material ? enchantFamilies(data, def, material) : [],
    mul: facilityValueMul(data, game),
  });
  pay(game, enchantCost(data, def), {
    [ENCHANT_POWDER_ID]: ENCHANT_POWDER_COST,
    ...(materialId ? { [materialId]: 1 } : {}),
  });
  gear.affixes = rolled.affixes;
  gear.affixOrigins = rolled.origins;
  delete gear.enchants;
  return `効果を${Object.keys(rolled.affixes).length}個に再抽選した。`;
}


