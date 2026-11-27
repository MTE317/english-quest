// 入門の原から踏破に応じて公開ルートを広げる。
// データ本体は保持し、ここでは公開対象と解放条件だけを管理する。
const TRIAL_DUNGEONS = Object.freeze([
  { id: 'windward_plain', clears: [] },
  { id: 'mossy_cave', clears: ['windward_plain'] },
  { id: 'sunlit_forest', clears: ['windward_plain'] },
  { id: 'goblin_quarry', clears: ['sunlit_forest'] },
  { id: 'ruined_fort', clears: ['mossy_cave'] },
  { id: 'misty_marsh', clears: ['sunlit_forest'] },
  { id: 'howling_canyon', anyClears: ['ruined_fort', 'misty_marsh'] },
]);

export const TRIAL_DUNGEON_IDS = Object.freeze(TRIAL_DUNGEONS.map(({ id }) => id));

export const INITIAL_DUNGEON_IDS = Object.freeze(
  TRIAL_DUNGEONS.filter(({ clears = [], anyClears = [] }) => !clears.length && !anyClears.length).map(({ id }) => id),
);

export function meetsDiscoveryRule(game, rule) {
  return Boolean(rule)
    && (rule.clears ?? []).every((id) => (game?.cleared?.[id] ?? 0) > 0)
    && (!rule.anyClears?.length || rule.anyClears.some(id => (game?.cleared?.[id] ?? 0) > 0))
    && (rule.flags ?? []).every((id) => game?.worldFlags?.[id] === true);
}

export function isTrialDungeonUnlocked(game, dungeonId) {
  const rule = TRIAL_DUNGEONS.find(({ id }) => id === dungeonId);
  return Boolean(rule) && (meetsDiscoveryRule(game, rule)
    || (game?.cleared?.[dungeonId] ?? 0) > 0 || game?.legacyRouteAccess?.includes(dungeonId));
}

export function buildWorldMap(dungeons, availableDungeons, game) {
  const allowed = new Set(availableDungeons.map(({ id }) => id));
  return {
    hints: TRIAL_DUNGEONS.filter(rule => rule.anyClears?.length && !allowed.has(rule.id)
      && rule.anyClears.some(id => allowed.has(id)))
      .map(rule => `${rule.anyClears.map(id => dungeons.get(id)?.name ?? id).join(' または ')}を踏破すると${dungeons.get(rule.id)?.name}を発見できます。`),
    dungeons: TRIAL_DUNGEONS.filter(({ id }) => allowed.has(id) && dungeons.has(id))
      .map(({ id }) => ({
        ...dungeons.get(id),
        state: (game?.cleared?.[id] ?? 0) > 0 ? 'cleared' : 'accessible',
      })),
  };
}

export function newDiscoveries(dungeons, seen = []) {
  return dungeons.filter(({ id }) => !INITIAL_DUNGEON_IDS.includes(id) && !seen.includes(id));
}
