export function encounterMonsters(game, enemies) {
  const catalog = (game.catalog ??= {});
  catalog.gear ??= [];
  catalog.monsters = [...new Set([...(catalog.monsters ?? []), ...enemies.map((enemy) => enemy.monsterId).filter(Boolean)])];
}

export function learnMonsterElements(game, enemy, elements, scanned = false) {
  if (!enemy.monsterId || (!scanned && !elements.length)) return;
  if (!game.catalog?.monsters?.includes(enemy.monsterId)) encounterMonsters(game, [enemy]);
  const discoveries = (game.catalog.affinities ??= {});
  const entry = (discoveries[enemy.monsterId] ??= { elements: [], scanned: false });
  entry.elements = [...new Set([...entry.elements, ...elements.filter((id) => id && id !== 'none')])];
  entry.scanned ||= scanned;
}

/** 敵データのうち、戦闘で確認した相性だけを図鑑に出す。 */
export function monsterKnowledge(data, game, enemy) {
  const entry = game?.catalog?.affinities?.[enemy.monsterId ?? enemy.id];
  const scanned = Boolean(entry?.scanned || enemy.revealed);
  const known = new Set(entry?.elements);
  const weak = [];
  const resist = [];
  const normal = [];
  for (const [id, element] of data.elements) {
    if (id === 'none') continue;
    if (enemy.weak.includes(id)) {
      if (known.has(id) || scanned) weak.push(element.name);
    } else if (known.has(id)) {
      (enemy.resist.includes(id) ? resist : normal).push(element.name);
    }
  }
  return { weak, resist, normal, scanned };
}

export function hitEffectiveness(multiplier) {
  if (multiplier > 1 + 1e-9) return 'weak';
  if (multiplier < 1 - 1e-9) return 'resist';
  return 'normal';
}
