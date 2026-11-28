// 世界の接続と永続の地図記録。教材のstoneIdとは別に扱う。
export const DIRECTIONS = Object.freeze({ left: '左', forward: '直進', right: '右' });

export function worldNode(data, id) {
  return data.worldRoutes?.nodes.find(node => node.id === id || node.key === id);
}

export function installWorldData(data, config) {
  if (!config) return data;
  data.worldRoutes = config;
  const keys = new Set(config.nodes.map(node => node.key));
  const stones = new Set(config.stones.map(stone => stone.id));
  if (config.maxHealersPerBattle != null && (!Number.isInteger(config.maxHealersPerBattle) || config.maxHealersPerBattle < 1)) throw new Error('回復役の上限が不正です');
  if (keys.size !== config.nodes.length || stones.size !== config.stones.length || !stones.has(config.startStone)) throw new Error('世界地図のIDが不正です');
  for (const stone of config.stones) if (stone.entries.some(key => !keys.has(key))) throw new Error('地域の入口が不正です');
  for (const node of config.nodes) {
    const source = data.dungeons.get(node.source);
    if (!source || data.dungeons.has(node.id) || !Number.isInteger(node.battles) || node.battles < 1
      || !node.pool.length || node.pool.some(id => !data.monsters.has(id)) || (node.bossId && !data.monsters.has(node.bossId))
      || node.exits.length !== 3 || new Set(node.exits.map(e => e.direction)).size !== 3
      || node.exits.some(e => !DIRECTIONS[e.direction] || (!keys.has(e.to) && !stones.has(e.to)))) throw new Error(`世界地図の設定が不正です：${node.key}`);
    if (new Set(node.pool).size !== node.pool.length || node.pool.some(id=>data.monsters.get(id).isBoss)
      || !Array.isArray(node.counts) || node.counts.length !== 2 || node.counts.some(n=>!Number.isInteger(n)||n<1||n>8) || node.counts[0]>node.counts[1]
      || (node.weights && (Object.keys(node.weights).length !== node.pool.length || node.pool.some(id=>!Number.isFinite(node.weights[id])||node.weights[id]<=0)))
      || (node.soloMonsters ?? []).some(id=>!node.pool.includes(id))
      || ['spring','summer','autumn','winter'].some(season=>!node.pool.some(id=>['all',season].includes(data.monsters.get(id).season))))
      throw new Error(`世界地図の出現設定が不正です：${node.key}`);
    data.dungeons.set(node.id, { ...source, id: node.id, name: node.name, rank: node.rank, days: config.expeditionDays,
      floors: node.battles, returnPointFloor: 0, bossId: node.bossId, worldKey: node.key, character: '',
      enemyMul: source.enemyMul, incomeMul: source.incomeMul });
    data.dropTables.set(node.id, { ...data.dropTables.get(node.source), dungeonId: node.id });
    for (const id of [...node.pool, node.bossId].filter(Boolean)) {
      const monster = data.monsters.get(id);
      monster.dungeons = [...new Set([...monster.dungeons, node.id])];
    }
    for (let floor = 1; floor <= node.battles; floor++) data.dungeonFloors.push({
      dungeonId: node.id, floor, enemyLevel: node.level, battles: 1,
      enemiesPerBattle: (node.counts[0] + node.counts[1]) / 2,
      lastBattleIsBoss: Boolean(node.bossId) && floor === node.battles, returnPointAfter: false, bossEscorts: 0,
    });
  }
  return data;
}

export function ensureWorldJourney(data, game) {
  if (!data.worldRoutes) return null;
  if (!game.worldJourney) {
    game.worldJourney = { version: 1, stones: [data.worldRoutes.startStone], seen: [], visited: [], exits: [], paths: [] };
    // 旧地域の依頼は行き先ごとに新しい候補へ対応付け、受注料と進捗を維持する。
    const archived = [];
    for (const quest of game.quests ?? []) {
      const old = quest.dungeonId;
      if (worldNode(data, old) || (!old && quest.type === 'gather')) continue;
      // 達成済みの契約は旧行き先のまま報告できる。
      if (quest.type !== 'gather' && quest.progress >= quest.count) continue;
      const matches = n => quest.targetMode === 'dungeon' ? n.source === old
        : quest.type === 'boss' ? n.bossId === quest.target
        : quest.type === 'bounty' ? false
        : quest.type === 'gather' ? n.pool.some(id => quest.materialIds?.includes(data.monsters.get(id)?.materialCommon))
        : n.pool.includes(quest.target);
      const node = data.worldRoutes.nodes.find(n => n.source === old && matches(n)) ?? data.worldRoutes.nodes.find(matches);
      if (node) {
        quest.dungeonId = node.id;
        quest.destinationIds = [node.id];
        if (quest.targetMode === 'dungeon') { quest.target = node.id; quest.targetIds = [...node.pool]; }
      } else {
        archived.push(quest);
        game.gold += Math.max(0, Number(quest.depositPaid) || 0);
      }
    }
    if (archived.length) {
      game.worldJourney.archivedQuests = structuredClone(archived);
      game.quests = game.quests.filter(q => !archived.includes(q));
      game.notices ??= [];
      game.notices.push(`地図の更新に伴い、行き先を移せない依頼${archived.length}件を終了しました。預かり済みの保証金は全額返還し、契約記録は保存しました。`);
    }
    // 未受注の旧掲示を更新する。
    game.board = null;
    delete game.specialQuest;
  }
  const map = game.worldJourney;
  for (const key of ['stones', 'seen', 'visited', 'exits', 'paths']) map[key] = [...new Set(map[key] ?? [])];
  if (!map.stones.includes(data.worldRoutes.startStone)) map.stones.push(data.worldRoutes.startStone);
  for (const stone of data.worldRoutes.stones.filter(s => map.stones.includes(s.id))) {
    for (const key of stone.entries) if (!map.seen.includes(key)) map.seen.push(key);
  }
  return map;
}

export function worldEntries(data, game, stoneId = data.worldRoutes?.startStone) {
  if (!game.worldJourney?.stones.includes(stoneId)) return [];
  return (data.worldRoutes.stones.find(s => s.id === stoneId)?.entries ?? []).map(key => worldNode(data, key)).filter(Boolean);
}

export function knownWorldDungeons(data, game) {
  return (game.worldJourney?.seen ?? []).map(key => worldNode(data, key)).filter(Boolean).map(n => data.dungeons.get(n.id));
}

export function exitChoices(data, game, run, season) {
  const node = worldNode(data, run.dungeonId);
  if (!node) return [];
  return node.exits.map(exit => {
    const target = worldNode(data, exit.to) ?? data.worldRoutes.stones.find(s => s.id === exit.to);
    const clears = id => (game.cleared?.[worldNode(data, id)?.id ?? id] ?? 0) + (run.worldClears?.[worldNode(data, id)?.id ?? id] ?? 0) > 0;
    const seasonal = !exit.seasons?.length || exit.seasons.includes(season);
    const seasonLabel = exit.seasons?.map(id => data.seasons.find(s => s.id === id)?.name ?? id).join('・');
    const conditions = (exit.clears ?? []).every(clears) && (exit.flags ?? []).every(flag => game.worldFlags?.[flag] === true)
      && (exit.quests ?? []).every(id => game.worldJourney?.completedQuests?.includes(id));
    return { ...exit, target, label: DIRECTIONS[exit.direction], seasonLabel, open: seasonal && conditions,
      reason: !seasonal ? `${seasonLabel}のみ・閉鎖中` : !conditions ? '条件未達成' : '' };
  });
}

export function revealWorldExits(data, game, run) {
  const node = worldNode(data, run.dungeonId);
  const map = ensureWorldJourney(data, game);
  for (const exit of node.exits) {
    const id = `${node.key}:${exit.direction}`;
    if (!map.exits.includes(id)) map.exits.push(id);
    if (worldNode(data, exit.to) && !map.seen.includes(exit.to)) map.seen.push(exit.to);
  }
}

export function worldGraph(data, game, season) {
  const map = ensureWorldJourney(data, game);
  const visibleStones = new Set(map.stones);
  const edges = [];
  for (const stone of data.worldRoutes.stones.filter(s => map.stones.includes(s.id))) {
    for (const key of stone.entries) edges.push({ id: `${stone.id}:${key}`, from: stone.id, to: key, open: true, passed: map.paths.includes(`${stone.id}:${key}`), label: '入口' });
  }
  for (const node of data.worldRoutes.nodes) {
    for (const exit of exitChoices(data, game, { dungeonId: node.id }, season)) {
      const id = `${node.key}:${exit.direction}`;
      if (!map.exits.includes(id)) continue;
      if (!worldNode(data, exit.to)) visibleStones.add(exit.to);
      edges.push({ id, from: node.key, to: exit.to, label: exit.label, open: exit.open, passed: map.paths.includes(id), reason: exit.reason });
    }
  }
  return { nodes: data.worldRoutes.nodes.filter(n => map.seen.includes(n.key)),
    stones: data.worldRoutes.stones.filter(s => visibleStones.has(s.id)), edges, map };
}
