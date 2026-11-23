// 5ダンジョン先行版。地域ノード・接続線は再設計まで使わない。
// データ本体は保持し、ここでは公開対象と解放条件だけを管理する。
const TRIAL_DUNGEONS = Object.freeze([
  { id: 'mossy_cave', clears: [] },
  { id: 'sunlit_forest', clears: [] },
  { id: 'goblin_quarry', clears: [] },
  { id: 'ruined_fort', clears: ['mossy_cave'] },
  { id: 'misty_marsh', clears: ['sunlit_forest'] },
]);

export const INITIAL_DUNGEON_IDS = Object.freeze(
  TRIAL_DUNGEONS.filter(({ clears }) => !clears.length).map(({ id }) => id),
);

export function meetsDiscoveryRule(game, rule) {
  return Boolean(rule)
    && (rule.clears ?? []).every((id) => (game?.cleared?.[id] ?? 0) > 0)
    && (rule.flags ?? []).every((id) => game?.worldFlags?.[id] === true);
}

export function isTrialDungeonUnlocked(game, dungeonId) {
  const rule = TRIAL_DUNGEONS.find(({ id }) => id === dungeonId);
  return Boolean(rule) && meetsDiscoveryRule(game, rule);
}

export function buildWorldMap(dungeons, availableDungeons, game) {
  const allowed = new Set(availableDungeons.map(({ id }) => id));
  return {
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
