// 工房で使う学習報酬素材。石の種類は装備★ではなく強化先の値で決める。
export const STONE_STAGES = Object.freeze([
  { id: 'enhancement_stone_1', name: '強化石I', minFacility: 1 },
  { id: 'enhancement_stone_2', name: '強化石II', minFacility: 2 },
  { id: 'enhancement_stone_3', name: '強化石III', minFacility: 3 },
  { id: 'enhancement_stone_4', name: '強化石IV', minFacility: 4 },
  { id: 'enhancement_stone_5', name: '強化石V', minFacility: 5 },
]);
export const ENCHANT_POWDER_ID = 'enchant_powder';
export const ENCHANT_POWDER_COST = 10;

export function stoneRequirement(data, enhancement) {
  const row = data.enhanceRates?.find((entry) => Number(entry.from_level) === Number(enhancement));
  const stage = STONE_STAGES.find((entry) => entry.id === row?.stone_id);
  return stage ? { ...stage, target: Number(row.to_level), count: Number(row.stone_count) } : null;
}

export function availableStoneStages(data, game) {
  const cap = Number(data.ranks?.find((rank) => rank.id === game.rank)?.facilityCap ?? 1);
  return STONE_STAGES.filter((stage) => stage.minFacility <= cap);
}

// セットを最後まで英作文で完了した場合だけ、自己評価によらず固定数を両方付与。
export function awardCompositionSet(data, game, { mode, count, answered, phrases, stoneId }) {
  if (!['phrases', 'chunks'].includes(mode) || ![5, 10, 15].includes(count)
    || answered !== count || phrases !== count) return null;
  const stage = availableStoneStages(data, game).find((entry) => entry.id === stoneId);
  if (!stage) throw new Error('この強化石はまだ受け取れません。');
  const amount = count / 5;
  const stock = game.storage.materials;
  stock[stage.id] = (stock[stage.id] ?? 0) + amount;
  stock[ENCHANT_POWDER_ID] = (stock[ENCHANT_POWDER_ID] ?? 0) + amount;
  return { stoneId: stage.id, stoneName: stage.name, stones: amount, powder: amount };
}
