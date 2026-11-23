// Region membership and geography are separate from the rules that discover them.
const STARTING_REGIONS = [
  { id: '01', x: 35, y: 54, dungeonIds: ['mossy_cave', 'twisted_tunnel'] },
  { id: '02', x: 51, y: 43, dungeonIds: ['sunlit_forest', 'blooming_hill'] },
  { id: '03', x: 56, y: 64 },
];

const LATER_POSITIONS = [
  [73, 35], [41, 33], [29, 68], [66, 50], [44, 73], [64, 23],
  [24, 40], [77, 58], [51, 24], [37, 81], [69, 75],
];

const REGIONS = [
  ...STARTING_REGIONS,
  ...LATER_POSITIONS.map(([x, y], index) => ({
    id: String(index + 4).padStart(2, '0'), rank: index + 2, x, y,
  })),
];

const ROUTES = [
  ['01', '02'], ['01', '03'], ['02', '05'], ['03', '07'], ['05', '06'],
  ['04', '07'], ['06', '08'], ['04', '09'], ['01', '10'], ['07', '11'],
  ['05', '12'], ['08', '13'], ['11', '14'],
];

const DISCOVERY_RULES = {
  '04': { clears: ['mossy_cave'] },
};

export function meetsDiscoveryRule(game, rule) {
  return Boolean(rule)
    && (rule.clears ?? []).every((id) => game.cleared?.[id] > 0)
    && (rule.flags ?? []).every((id) => game.worldFlags?.[id] === true);
}

export function buildWorldMap(dungeons, availableDungeons, game) {
  const available = new Set(availableDungeons.map(({ id }) => id));
  const assigned = new Set(STARTING_REGIONS.flatMap(({ dungeonIds }) => dungeonIds ?? []));
  const regions = REGIONS.map(({ id, x, y, rank, dungeonIds }) => {
    const members = dungeonIds
      ? dungeonIds.map((dungeonId) => dungeons.get(dungeonId)).filter(Boolean)
      : [...dungeons.values()].filter((dungeon) => dungeon.rank === (rank ?? 1) && !assigned.has(dungeon.id));
    const playable = members.filter((dungeon) => available.has(dungeon.id));
    const cleared = members.length > 0 && members.every((dungeon) => game.cleared?.[dungeon.id] > 0);
    const discovered = !rank || meetsDiscoveryRule(game, DISCOVERY_RULES[id])
      || members.some((dungeon) => game.cleared?.[dungeon.id] > 0);
    const state = cleared ? 'cleared' : playable.length ? 'accessible' : discovered ? 'discovered' : 'undiscovered';
    return { id, x, y, state, dungeons: playable };
  }).filter(({ state }) => state !== 'undiscovered');

  const visible = new Set(regions.map(({ id }) => id));
  return { regions, routes: ROUTES.filter(([a, b]) => visible.has(a) && visible.has(b)) };
}

export function newDiscoveries(regions, seen) {
  return regions.filter(({ id }) => !seen.includes(id) && !STARTING_REGIONS.some((region) => region.id === id));
}
