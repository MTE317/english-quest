import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDebugMossyBattle } from '../js/debug-mossy.js';
import { loadData } from '../../sim/balance.mjs';

test('開発表示だけで敵5体または8体に固定し、実セーブの保存領域へ接続しない', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true, get() { throw new Error('実セーブ領域に接続した'); },
  });
  try {
    const data = loadData();
    const normal = [...data.monsters].map(([id, monster]) => [id, structuredClone(monster)]);
    for (const count of [5, 8]) {
      const { session, store } = makeDebugMossyBattle(data, 'demo', count);
      const { run } = session;
      const ids = run.battle.enemies.map(enemy => enemy.monsterId);
      assert.equal(run.dungeonId, 'mossy_cave');
      assert.equal(ids.length, count);
      assert.ok(ids.includes('cave_rat') && ids.includes('pollen_bug'));
      const parallel = makeDebugMossyBattle(data, 'demo', count);
      assert.deepEqual(parallel.session.run.battle.enemies.map(enemy => enemy.monsterId), ids);
      session.game.party[0].hp = 0;
      session.save();
      assert.notEqual(parallel.session.game.party[0].hp, 0);
      assert.notEqual(store.storage, parallel.store.storage);
    }
    assert.throws(() => makeDebugMossyBattle(data, 'demo', 6), RangeError);
    assert.deepEqual([...data.monsters], normal);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});
