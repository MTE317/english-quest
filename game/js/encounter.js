// 出てくる敵を決める（ダンジョンと階から）。
import { makeEnemy } from './battle.js?v=features-2';

/** そのダンジョンにふだん出るモンスター */
export function monsterPool(data, dungeonId, season) {
  const pool = [...data.monsters.values()].filter((m) => m.dungeons.includes(dungeonId));
  const seasonal = pool.filter((m) => m.role === 'season' && m.season === season);
  const removed = new Set(seasonal.flatMap((m) => (m.replaces ?? '').split('|')));
  return [...pool.filter((m) => m.role === 'normal' && !removed.has(m.id)), ...seasonal];
}

function eliteFor(data, rank, rng) {
  if (rng() >= (data.balance.dungeon?.elite_rate ?? 0.08)) return null;
  const allowed = data.elitePrefixes.filter((p) => p.minStar <= rank && p.appearRate > 0);
  let draw = rng() * allowed.reduce((sum, p) => sum + p.appearRate, 0);
  return allowed.find((p) => (draw -= p.appearRate) < 0)?.id ?? null;
}

export function planBounty(data, game, dungeonId, rng) {
  const pool = [...data.monsters.values()].filter((m) => m.role === 'bounty' && m.dungeons.includes(dungeonId));
  if (!pool.length) return null;
  const active = pool.filter((m) => game.quests.some((q) => q.type === 'bounty' && q.target === m.id && q.progress < q.count));
  const options = active.length ? active : pool;
  const chance = data.dropTables.get(dungeonId)?.bountyChance ?? 0;
  if (rng() >= chance * (active.length ? 2 : 1)) return null;
  const floors = data.dungeonFloors.filter((row) => row.dungeonId === dungeonId && row.battles > Number(row.lastBattleIsBoss));
  if (!floors.length) return null;
  const row = floors[Math.floor(rng() * floors.length)];
  return { monsterId: options[Math.floor(rng() * options.length)].id, floor: row.floor,
    battle: Math.floor(rng() * (row.battles - Number(row.lastBattleIsBoss))) };
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
export function makeEncounter(data, dungeonId, floor, rng, { boss = false, season, bountyId, elites = false } = {}) {
  const row = floorRow(data, dungeonId, floor);
  const pool = monsterPool(data, dungeonId, season);
  if (!pool.length) throw new Error(`${dungeonId} に出るモンスターがいない`);
  const enemies = [];
  if (boss) {
    const dg = data.dungeons.get(dungeonId);
    enemies.push(makeEnemy(data, dg.bossId, { lv: row.enemyLevel, dungeonId, boss: true }));
  }
  const count = boss ? bossEscorts(data) : row.enemiesPerBattle;
  for (let k = 0; k < count; k++) {
    const m = pool[Math.floor(rng() * pool.length)];
    const eliteId = elites ? eliteFor(data, data.dungeons.get(dungeonId).rank, rng) : null;
    enemies.push(makeEnemy(data, m.id, { lv: row.enemyLevel, dungeonId, eliteId }));
  }
  if (bountyId) {
    const enemy = makeEnemy(data, bountyId, { lv: row.enemyLevel, dungeonId, boss: true });
    if (boss) enemies.push({ ...enemy, bounty: true });
    else enemies[0] = { ...enemy, bounty: true };
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
