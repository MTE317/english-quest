import { roundGold } from './gold.js?v=skill-growth-2';

export const STACK_SELL_RULES = Object.freeze({
  itemRate: .5,
  materialRates: Object.freeze({ common: .01, rare: .03, boss: .1 }),
});

export function stackSellPrice(data, kind, id) {
  if (kind === 'item') {
    const item = data.items.get(id);
    if (!item) throw new Error('道具が見つからない');
    return Math.min(Math.floor(item.price * STACK_SELL_RULES.itemRate),
      roundGold(data, item.price * STACK_SELL_RULES.itemRate, 'floor'));
  }
  if (kind !== 'material') throw new Error('売却できない種類');
  const material = data.materials.get(id);
  if (!material) throw new Error('素材が見つからない');
  const rank = Math.min(data.economy.size, Math.max(1, material.rank));
  const income = data.economy.get(rank)?.run_income ?? 0;
  return roundGold(data, income * (STACK_SELL_RULES.materialRates[material.kind] ?? STACK_SELL_RULES.materialRates.common));
}

/** 現在の所持数を検証してから、在庫と所持金を同時に更新する。 */
export function sellStack(data, game, kind, id, count = 1) {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('売却数が正しくない');
  const price = stackSellPrice(data, kind, id);
  const stock = kind === 'item' ? game.items : game.storage.materials;
  const owned = stock?.[id] ?? 0;
  if (owned < count) throw new Error('売却する個数を持っていない');
  const total = price * count;
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('売却金額が正しくない');
  const left = owned - count;
  if (left) stock[id] = left;
  else delete stock[id];
  game.gold += total;
  return total;
}

/** 装備以外の売却対象。未所持や0個の項目は含めない。 */
export function stackSellStock(data, game) {
  return [
    ...Object.entries(game.storage.materials ?? {}).map(([id, count]) => ({ kind: 'material', id, count, def: data.materials.get(id) })),
    ...Object.entries(game.items ?? {}).map(([id, count]) => ({ kind: 'item', id, count, def: data.items.get(id) })),
  ].filter(entry => entry.count > 0 && entry.def).map(entry => ({
    ...entry, price: stackSellPrice(data, entry.kind, entry.id),
  }));
}
