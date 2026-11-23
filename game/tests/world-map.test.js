import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedDungeons } from '../js/dungeon.js';
import { buildWorldMap, isTrialDungeonUnlocked, meetsDiscoveryRule, newDiscoveries } from '../js/world-map.js';
import { realGameData } from './helpers.js';

const data = realGameData();
const atlas = (game) => buildWorldMap(data.dungeons, allowedDungeons(data, game), game);
const ids = (game) => allowedDungeons(data, game).map(({ id }) => id).sort();

test('新規開始は接続ノードを使わず3ダンジョンだけ選べる', () => {
  const game = { rank: 'R01' };
  const world = atlas(game);
  assert.deepEqual(world.dungeons.map(({ id }) => id),
    ['mossy_cave', 'sunlit_forest', 'goblin_quarry']);
  assert.equal(Object.hasOwn(world, 'regions'), false);
  assert.equal(Object.hasOwn(world, 'routes'), false);
  assert.ok(world.dungeons.every(({ state }) => state === 'accessible'));
  assert.deepEqual(newDiscoveries(world.dungeons, []), []);
});

test('苔むした洞窟から崩れた砦、木漏れ日の森から霧の湿原を別々に発見する', () => {
  const game = { rank: 'R01', cleared: { mossy_cave: 1 } };
  assert.ok(isTrialDungeonUnlocked(game, 'ruined_fort'));
  assert.ok(!isTrialDungeonUnlocked(game, 'misty_marsh'));
  const world = atlas(game);
  assert.deepEqual(world.dungeons.map(({ id }) => id),
    ['mossy_cave', 'sunlit_forest', 'goblin_quarry', 'ruined_fort']);
  assert.equal(world.dungeons[0].state, 'cleared');
  assert.deepEqual(newDiscoveries(world.dungeons, []).map(({ id }) => id), ['ruined_fort']);
  assert.deepEqual(newDiscoveries(world.dungeons, ['ruined_fort']), []);
  game.cleared.sunlit_forest = 1;
  assert.deepEqual(atlas(game).dungeons.map(({ id }) => id),
    ['mossy_cave', 'sunlit_forest', 'goblin_quarry', 'ruined_fort', 'misty_marsh']);
});

test('冒険者ランクを上げても他の55か所は公開されず、旧セーブの踏破履歴は利用する', () => {
  assert.deepEqual(ids({ rank: 'S' }), ids({ rank: 'R01' }));
  assert.ok(!isTrialDungeonUnlocked({ rank: 'S' }, 'old_catacomb'));
  const legacy = { rank: 'S', cleared: { sunlit_forest: 2, mossy_cave: 7, old_catacomb: 3 } };
  assert.deepEqual(ids(legacy),
    ['mossy_cave', 'sunlit_forest', 'goblin_quarry', 'ruined_fort', 'misty_marsh'].sort());
  const rule = { clears: ['any-site'], flags: ['quest-reward'] };
  assert.equal(meetsDiscoveryRule({ cleared: { 'any-site': 1 } }, rule), false);
  assert.equal(meetsDiscoveryRule({ cleared: { 'any-site': 1 }, worldFlags: { 'quest-reward': true } }, rule), true);
});
