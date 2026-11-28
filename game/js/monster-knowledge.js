export function encounterMonsters(game, enemies) {
  const catalog = (game.catalog ??= {});
  catalog.gear ??= [];
  catalog.monsters = [...new Set([...(catalog.monsters ?? []), ...enemies.map((enemy) => enemy.monsterId).filter(Boolean)])];
  const sightings = (catalog.sightings ??= {});
  for (const enemy of enemies) if (enemy.monsterId && Number.isFinite(enemy.maxHp) && !sightings[enemy.monsterId]) {
    sightings[enemy.monsterId] = {
      lv: enemy.baseStats?.level ?? enemy.lv, hp: enemy.baseStats?.hp ?? enemy.maxHp, mp: enemy.baseStats?.mp ?? enemy.maxMp,
      ...Object.fromEntries(['str','mag','def','res','spd'].map(key => [key, enemy.baseStats?.[key] ?? enemy[key]])),
    };
  }
}

/** 戦闘を終えた時点で倒れていた個体だけを、種別ごとに数える。 */
export function recordMonsterDefeats(game, enemies) {
  const defeats = ((game.catalog ??= {}).defeats ??= {});
  for (const enemy of enemies) if (enemy.monsterId && enemy.hp <= 0) {
    defeats[enemy.monsterId] = (defeats[enemy.monsterId] ?? 0) + 1;
  }
}

export function learnMonsterElements(game, enemy, elements, scanned = false) {
  if (!enemy.monsterId || (!scanned && !elements.length)) return;
  if (!game.catalog?.monsters?.includes(enemy.monsterId)) encounterMonsters(game, [enemy]);
  const discoveries = (game.catalog.affinities ??= {});
  const entry = (discoveries[enemy.monsterId] ??= { elements: [], scanned: false });
  entry.elements = [...new Set([...entry.elements, ...elements.filter((id) => id)])];
  entry.scanned ||= scanned;
}

/** 調査でHPを図鑑に記録する。通常攻撃での属性判明とは分ける。 */
export function learnMonsterHp(game, enemy) {
  if (!enemy.monsterId) return;
  encounterMonsters(game, [enemy]);
  const discoveries = (game.catalog.affinities ??= {});
  const entry = (discoveries[enemy.monsterId] ??= { elements: [], scanned: false });
  entry.hp = true;
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
    if (enemy.strongWeak?.includes(id)) {
      if (known.has(id) || scanned) weak.push('★' + element.name);
    } else if (enemy.weak.includes(id)) {
      if (known.has(id) || scanned) weak.push(element.name);
    } else if (known.has(id)) {
      if (enemy.immune?.includes(id)) resist.push('×' + element.name);
      else (enemy.resist.includes(id) ? resist : normal).push(element.name);
    }
  }
  return { weak, resist, normal, scanned };
}

export function hitEffectiveness(multiplier) {
  if (multiplier > 1 + 1e-9) return 'weak';
  if (multiplier < 1 - 1e-9) return 'resist';
  return 'normal';
}
