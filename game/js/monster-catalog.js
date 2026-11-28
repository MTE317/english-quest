import { TRIAL_DUNGEON_IDS } from './world-map.js?v=canyon-public-1';

export function catalogMonsters(data) {
  if (data.worldRoutes) {
    const ids = new Set(data.worldRoutes.nodes.flatMap(node => [...node.pool,node.bossId]).filter(Boolean));
    return [...data.monsters.values()].filter(monster => ids.has(monster.id));
  }
  const current = new Set(TRIAL_DUNGEON_IDS);
  return [...data.monsters.values()].filter(monster => monster.dungeons.some(id => current.has(id)));
}

/** 戦闘画面と詳細ダイアログも図鑑と同じ討伐記録を参照する。 */
export function monsterBattleVisibility(data, game, enemy) {
  const id = enemy.monsterId ?? enemy.id;
  const monster = data.monsters.get(id);
  if (!monster) return {hp:false,mp:false,types:false};
  const known = monsterUnlocks(monster,game.catalog?.defeats?.[id] ?? 0);
  return {hp:known.hp,mp:known.stats,types:known.types};
}

export function monsterUnlocks(monster, defeats = 0) {
  const boss = monster.isBoss;
  return {
    elements: defeats >= (boss ? 2 : 3),
    hp: defeats >= 1,
    types: defeats >= (boss ? 1 : 2),
    statuses: defeats >= (boss ? 3 : 10),
    stats: defeats >= (boss ? 4 : 20),
    drops: defeats >= (boss ? 5 : 30),
  };
}
