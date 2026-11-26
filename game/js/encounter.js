// 出てくる敵を決める（ダンジョンと階から）。
import { makeEnemy } from './battle.js?v=tactical-jobs-1';
import { affixSum } from './character.js?v=advanced-jobs-1';
import { memberMods } from './growth.js?v=advanced-jobs-1';

/** そのダンジョンにふだん出るモンスター */
export function monsterPool(data, dungeonId, season) {
  const pool = [...data.monsters.values()].filter((m) => m.dungeons.includes(dungeonId));
  const seasonal = pool.filter((m) => m.role === 'season' && m.season === season);
  const removed = new Set(seasonal.flatMap((m) => (m.replaces ?? '').split('|')));
  return [...pool.filter((m) => m.role === 'normal' && !removed.has(m.id)), ...seasonal];
}

/** 地域の常連と珍しい敵を分ける。候補を消さず、すべての種に遭遇できる重みを残す。 */
export function encounterWeights(data, dungeonId, season, { quests = [] } = {}) {
  const pool = monsterPool(data, dungeonId, season);
  const config = data.balance.encounters ?? {};
  const count = Math.min(pool.length, Math.max(1, Math.floor(config.common_count ?? pool.length)));
  const seasonal = pool.filter((m) => m.role === 'season');
  const seasonalCount = Math.min(count, seasonal.length, Math.max(0, Math.floor(
    data.dungeons.get(dungeonId)?.kind === '季節の地'
      ? (config.seasonal_dungeon_common_count ?? seasonal.length)
      : (config.seasonal_common_count ?? seasonal.length),
  )));
  // CSV の地域内での順を保つことで、訪れるたびに常連が入れ替わらない。
  const common = [...pool.filter((m) => m.role === 'normal').slice(0, count - seasonalCount), ...seasonal.slice(0, seasonalCount)];
  const commonIds = new Set(common.map((m) => m.id));
  for (const m of pool) if (commonIds.size < count) commonIds.add(m.id);
  const rareCount = pool.length - commonIds.size;
  const share = rareCount ? Math.min(1, Math.max(0, config.common_share ?? commonIds.size / Math.max(1, pool.length))) : 1;
  return pool.map((monster) => {
    const principal = commonIds.has(monster.id);
    let weight = principal ? share / commonIds.size : (1 - share) / rareCount;
    const wanted = quests.some((q) => q.type === 'hunt' && q.targetMode !== 'dungeon'
      && q.progress < q.count && q.target === monster.id);
    if (wanted) weight *= Math.max(1, config.quest_target_weight ?? 1);
    return { monster, weight, common: principal };
  });
}

function weightedMonster(choices, rng, seen, repeatWeight) {
  const weights = choices.map((entry) => entry.weight * (seen.has(entry.monster.id) ? repeatWeight : 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0)) return choices[Math.min(choices.length - 1, Math.floor(rng() * choices.length))].monster;
  let draw = rng() * total;
  for (let i = 0; i < choices.length; i++) if ((draw -= weights[i]) < 0) return choices[i].monster;
  return choices.at(-1).monster;
}

function eliteFor(data, rank, rng) {
  if (rng() >= (data.balance.dungeon?.elite_rate ?? 0.08)) return null;
  const allowed = data.elitePrefixes.filter((p) => p.minStar <= rank && p.appearRate > 0);
  let draw = rng() * allowed.reduce((sum, p) => sum + p.appearRate, 0);
  return allowed.find((p) => (draw -= p.appearRate) < 0)?.id ?? null;
}

export function bountyProbability(data, game, dungeonId, accepted, lure = false) {
  const rules = data.balance.dungeon ?? {};
  const base = data.dropTables.get(dungeonId)?.bountyChance ?? 0;
  const passive = Math.min(.10, Math.max(0, ...(game.party ?? []).map(member => memberMods(data, member).bounty_chance ?? 0)));
  const gear = (game.party ?? []).some(member => affixSum(member, 'BOUNTY_CHANCE') > 0) ? .05 : 0;
  const item = lure ? (data.items.get('bounty_lure')?.value ?? 0) / 100 : 0;
  return Math.min(rules.bounty_chance_cap ?? .8,
    Math.max(0, (accepted ? rules.bounty_quest_chance ?? .4 : base) + passive + gear + item));
}

export function planBounty(data, game, dungeonId, rng, { lure = false } = {}) {
  const pool = [...data.monsters.values()].filter((m) => m.role === 'bounty' && m.dungeons.includes(dungeonId));
  if (!pool.length) return null;
  const active = pool.filter((m) => game.quests.some((q) => q.type === 'bounty' && q.target === m.id && q.progress < q.count));
  const options = active.length ? active : pool;
  if (rng() >= bountyProbability(data, game, dungeonId, active.length > 0, lure)) return null;
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
export function makeEncounter(data, dungeonId, floor, rng, {
  boss = false, season, bountyId, elites = false, quests = [], maxElites = Infinity, rowOverride = null,
} = {}) {
  const row = rowOverride ?? floorRow(data, dungeonId, floor);
  const choices = encounterWeights(data, dungeonId, season, { quests });
  if (!choices.length) throw new Error(`${dungeonId} に出るモンスターがいない`);
  const enemies = [];
  if (boss) {
    const dg = data.dungeons.get(dungeonId);
    enemies.push(makeEnemy(data, dg.bossId, { lv: row.enemyLevel, dungeonId, boss: true }));
  }
  const count = boss ? bossEscorts(data) : row.enemiesPerBattle;
  const rank = data.dungeons.get(dungeonId).rank;
  const config = data.balance.dungeon ?? {};
  const eliteLimit = Math.max(0, Math.min(maxElites, config.elite_max_per_battle ?? count));
  const seen = new Set();
  let eliteCount = 0;
  for (let k = 0; k < count; k++) {
    const m = weightedMonster(choices, rng, seen, Math.max(0, data.balance.encounters?.repeat_weight ?? 1));
    seen.add(m.id);
    // ボス・賞金首と冠付きが重なって難度が跳ねることを避ける。
    const canElite = elites && !boss && !bountyId && rank >= (config.elite_min_star ?? 1) && eliteCount < eliteLimit;
    const eliteId = canElite ? eliteFor(data, rank, rng) : null;
    if (eliteId) eliteCount += 1;
    enemies.push(makeEnemy(data, m.id, { lv: row.enemyLevel, dungeonId, eliteId }));
  }
  if (bountyId) {
    const enemy = makeEnemy(data, bountyId, { lv: row.enemyLevel, dungeonId, boss: true });
    if (boss) enemies.push({ ...enemy, bounty: true });
    else enemies[0] = { ...enemy, bounty: true };
  }
  // 同じ名前が並ぶときは A・B… をつける
  const names = {};
  for (const e of enemies) names[e.name] = (names[e.name] ?? 0) + 1;
  const idx = {};
  for (const e of enemies) {
    if (names[e.name] > 1) { idx[e.name] = (idx[e.name] ?? 0) + 1; e.name = `${e.name}${'ABCDEFGH'[idx[e.name] - 1]}`; }
  }
  return enemies;
}


/** 深層地域の開放条件。現行の依頼・踏破済みデータも経路を開く。 */
export function dungeonRouteUnlocked(data, game, dungeon) {
  const cleared = game.cleared ?? {};
  if (dungeon.kind !== '深層' || dungeon.rank <= 3 || cleared[dungeon.id]) return true;
  if (game.quests?.some((quest) => quest.dungeonId === dungeon.id || quest.destinationIds?.includes(dungeon.id)
    || data.monsters.get(quest.target)?.dungeons.includes(dungeon.id))) return true;
  const previousRegionEnd = Math.floor((dungeon.rank - 1) / 3) * 3;
  return [...data.dungeons.values()].some((entry) => entry.kind === '標準' && entry.rank >= previousRegionEnd && cleared[entry.id] > 0);
}

