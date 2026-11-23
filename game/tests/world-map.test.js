import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedDungeons } from '../js/dungeon.js';
import { buildWorldMap, meetsDiscoveryRule, newDiscoveries } from '../js/world-map.js';
import { realGameData } from './helpers.js';

const data = realGameData();
const atlas = (game) => buildWorldMap(data.dungeons, allowedDungeons(data, game), game);

test('an older starting save shows three regions and no locked destinations or lines', () => {
  const game = { rank: 'R01' };
  const { regions, routes } = atlas(game);
  assert.deepEqual(regions.map(({ id }) => id), ['01', '02', '03']);
  assert.equal(regions.flatMap(({ dungeons }) => dungeons).length, 5);
  assert.ok(regions.every(({ state }) => state === 'accessible'));
  assert.ok(routes.flat().every((id) => regions.some((region) => region.id === id)));
  assert.deepEqual(newDiscoveries(regions, []), []);
});

test('a clear discovers a remote region without exposing its destinations or adding a route', () => {
  const game = { rank: 'R01', cleared: { mossy_cave: 1, twisted_tunnel: 1 } };
  const { regions, routes } = atlas(game);
  assert.equal(regions[0].state, 'cleared');
  const remote = regions.find(({ id }) => id === '04');
  assert.equal(remote.state, 'discovered');
  assert.deepEqual(remote.dungeons, []);
  assert.ok(!routes.flat().includes(remote.id));
  assert.deepEqual(newDiscoveries(regions, []), [remote]);
  assert.deepEqual(newDiscoveries(regions, [remote.id]), []);
  assert.equal(atlas({ ...game, rank: 'R02' }).regions.find(({ id }) => id === '04').state, 'accessible');
});

test('all existing ranks, route exceptions and seasonal destinations keep their existing entry rules', () => {
  for (const { id } of data.ranks) {
    const game = { rank: id, quests: [{ dungeonId: 'silent_corridor' }] };
    const { regions } = atlas(game);
    const mapIds = regions.flatMap(({ dungeons }) => dungeons.map((dungeon) => dungeon.id)).sort();
    assert.deepEqual(mapIds, allowedDungeons(data, game).map((dungeon) => dungeon.id).sort());
  }
  const rule = { clears: ['any-site'], flags: ['quest-reward'] };
  assert.equal(meetsDiscoveryRule({ cleared: { 'any-site': 1 } }, rule), false);
  assert.equal(meetsDiscoveryRule({ cleared: { 'any-site': 1 }, worldFlags: { 'quest-reward': true } }, rule), true);
});
