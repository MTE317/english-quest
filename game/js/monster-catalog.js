import { TRIAL_DUNGEON_IDS } from './world-map.js?v=intro-route-1';

export function catalogMonsters(data) {
  const current = new Set(TRIAL_DUNGEON_IDS);
  return [...data.monsters.values()].filter(monster => monster.dungeons.some(id => current.has(id)));
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
