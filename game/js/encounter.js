// 出てくる敵を決める（ダンジョンと階から）。季節・強い個体・賞金首はチェックリスト7・13番で足す。
import { makeEnemy } from './battle.js';

/** そのダンジョンにふだん出るモンスター */
export function monsterPool(data, dungeonId) {
  return [...data.monsters.values()].filter((m) => m.role === 'normal' && m.dungeons.includes(dungeonId));
}

export function floorRow(data, dungeonId, floor) {
  const row = data.dungeonFloors.find((r) => r.dungeonId === dungeonId && r.floor === floor);
  if (!row) throw new Error(`dungeon_floors.csv に ${dungeonId} の ${floor}階がない`);
  return row;
}

/** ボス戦でボスと一緒に出る敵の数（balance.json の dungeon.boss_battle「boss + 1」） */
export function bossEscorts(data) {
  const m = /boss\s*\+\s*(\d+)/.exec(String(data.balance.dungeon?.boss_battle ?? ''));
  return m ? Number(m[1]) : 0;
}

/**
 * 1回の戦闘の敵
 * @param rng () => 0〜1 の乱数
 * @param boss true ならボス戦（ボス＋ふだんの敵）
 */
export function makeEncounter(data, dungeonId, floor, rng, { boss = false } = {}) {
  const row = floorRow(data, dungeonId, floor);
  const pool = monsterPool(data, dungeonId);
  if (!pool.length) throw new Error(`${dungeonId} に出るモンスターがいない`);
  const enemies = [];
  if (boss) {
    const dg = data.dungeons.get(dungeonId);
    enemies.push(makeEnemy(data, dg.bossId, { lv: row.enemyLevel, dungeonId, boss: true }));
  }
  const count = boss ? bossEscorts(data) : row.enemiesPerBattle;
  for (let k = 0; k < count; k++) {
    const m = pool[Math.floor(rng() * pool.length)];
    enemies.push(makeEnemy(data, m.id, { lv: row.enemyLevel, dungeonId }));
  }
  // 同じ名前が並ぶときは A・B… をつける
  const seen = {};
  for (const e of enemies) seen[e.name] = (seen[e.name] ?? 0) + 1;
  const idx = {};
  for (const e of enemies) {
    if (seen[e.name] > 1) { idx[e.name] = (idx[e.name] ?? 0) + 1; e.name = `${e.name}${'ABCDEFGH'[idx[e.name] - 1]}`; }
  }
  return enemies;
}
