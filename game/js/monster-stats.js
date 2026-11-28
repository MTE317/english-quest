export const MONSTER_STAT_KEYS = ['hp', 'mp', 'str', 'mag', 'def', 'res', 'spd'];

/** モンスターIDごとの固定値。ダンジョンのLv・★・補正には依存しない。 */
export function installMonsterStats(data, rows, elites) {
  if (!rows) return data; // 旧データだけを使う互換テスト・ツール向け。
  const ids = new Set();
  for (const row of rows) {
    const monster = data.monsters.get(row.monster_id);
    const values = Object.fromEntries(['level', ...MONSTER_STAT_KEYS].map(key => [key, Number(row[key])]));
    if (!monster || ids.has(row.monster_id) || !Number.isInteger(values.level) || values.level < 1
      || MONSTER_STAT_KEYS.some(key => !String(row[key] ?? '').trim() || !Number.isFinite(values[key]) || values[key] <= 0)) {
      throw new Error('固定モンスター能力が不正: ' + row.monster_id);
    }
    monster.fixedStats = values;
    monster.statsReview = row.review;
    ids.add(monster.id);
  }
  if (ids.size !== data.monsters.size) throw new Error('固定モンスター能力に未登録のIDがあります');
  if (!elites || !Array.isArray(elites.eligible)
    || elites.eligible.some(id => !data.monsters.has(id) || data.monsters.get(id).role !== 'normal' || data.monsters.get(id).isBoss)
    || !(elites.chance >= 0 && elites.chance <= 1)
    || ['maxPerBattle','maxPerExpedition'].some(key => !Number.isInteger(elites[key]) || elites[key] < 0)
    || MONSTER_STAT_KEYS.some(key => !Number.isFinite(elites.statMultipliers?.[key]) || elites.statMultipliers[key] <= 1)
    || ['rareMaterialMultiplier','rareGearWeightMultiplier'].some(key => !Number.isFinite(elites[key]) || elites[key] < 1)) {
    throw new Error('エリート設定が不正です');
  }
  data.monsterElites = elites;
  for (const monster of data.monsters.values()) monster.eliteEligible = elites.eligible.includes(monster.id);
  return data;
}

export function rollMonsterElite(data, monsterId, rng) {
  return data.monsters.get(monsterId)?.eliteEligible && rng() < data.monsterElites.chance ? 'elite' : null;
}
