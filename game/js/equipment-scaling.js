// ★ごとの基準値は equipment_tiers.csv。旧データの二系列の中間値を基準にする。
export function equipmentTier(data, star) {
  const s = Math.max(1, Math.min(12, Number(star) || 1));
  const row = data.equipmentTiers?.get(s);
  if (row) return row;
  // テストの小さなデータセットにも同じ計算を適用する。
  const midpoint = 10 * s - 4.5;
  return { weaponBase: 8 + 1.6 * midpoint, armorBase: 6 + 1.3 * midpoint,
    spellLevelBase: midpoint, fixedDamageBase: 20 + 6 * midpoint,
    affixScale: 1 + midpoint / 12, enhanceBase: 20 + 4 * midpoint };
}

export function rarityBonus(data, rarity) {
  const row = data.rarityTable?.find((entry) => entry.id === rarity);
  return { base: row?.baseMul ?? 1, effect: row?.effectMul ?? 1 };
}
