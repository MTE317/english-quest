// 工房で使う学習報酬素材。石の種類は装備★ではなく強化先の値で決める。
export const STONE_STAGES = Object.freeze([
  { id: 'enhancement_stone_1', name: '強化石I', minFacility: 1 },
  { id: 'enhancement_stone_2', name: '強化石II', minFacility: 2 },
  { id: 'enhancement_stone_3', name: '強化石III', minFacility: 3 },
  { id: 'enhancement_stone_4', name: '強化石IV', minFacility: 4 },
  { id: 'enhancement_stone_5', name: '強化石V', minFacility: 5 },
]);
// 装備のレアリティに対応する分解素材。固有装備は★に見合う段階を返す。
export const STONE_FRAGMENT_BY_RARITY = Object.freeze({
  common: 1, uncommon: 2, rare: 3, epic: 4,
  legendary: 5, artifact: 5, origin: 5,
});
export const stoneFragmentId = (stage) => `enhancement_stone_fragment_${stage}`;
export function dismantleFragment(data, gear) {
  const def = data.equipment.get(gear.id);
  const star = Number(def?.star ?? 1);
  const stage = gear.rarity === 'unique'
    ? (star <= 3 ? 1 : star <= 5 ? 2 : star <= 7 ? 3 : star <= 9 ? 4 : 5)
    : (STONE_FRAGMENT_BY_RARITY[gear.rarity ?? 'common'] ?? 1);
  return STONE_STAGES[stage - 1];
}

// 石を優先し、不足分だけ同種の欠片を3個ずつ消費する。
export function stonePayment(game, stone) {
  const stage = STONE_STAGES.findIndex(row => row.id === stone.id) + 1;
  if (!stage) throw new Error('強化石の種類が不正です。');
  const whole = Math.min(game.storage.materials[stone.id] ?? 0, stone.count);
  const missing = stone.count - whole;
  const fragmentId = stoneFragmentId(stage);
  if ((game.storage.materials[fragmentId] ?? 0) < missing * 3) throw new Error('強化石・欠片が足りません。');
  return { ...(whole ? { [stone.id]: whole } : {}),
    ...(missing ? { [fragmentId]: missing * 3 } : {}) };
}
export function availableStones(game, stone) {
  const stage = STONE_STAGES.findIndex(row => row.id === stone.id) + 1;
  return (game.storage.materials[stone.id] ?? 0) +
    Math.floor((game.storage.materials[stoneFragmentId(stage)] ?? 0) / 3);
}
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

// セットを最後まで英作文で完了した場合だけ、自己評価によらず石は問題数に応じて1～3個、粉は1個付与。
export function awardCompositionSet(data, game, { mode, count, answered, phrases, stoneId }) {
  if (!['phrases', 'chunks'].includes(mode) || ![5, 10, 15].includes(count)
    || answered !== count || phrases !== count) return null;
  const stage = availableStoneStages(data, game).find((entry) => entry.id === stoneId);
  if (!stage) throw new Error('この強化石はまだ受け取れません。');
  const amount = count / 5;
  const stock = game.storage.materials;
  stock[stage.id] = (stock[stage.id] ?? 0) + amount;
  stock[ENCHANT_POWDER_ID] = (stock[ENCHANT_POWDER_ID] ?? 0) + 1;
  return { stoneId: stage.id, stoneName: stage.name, stones: amount, powder: 1 };
}
