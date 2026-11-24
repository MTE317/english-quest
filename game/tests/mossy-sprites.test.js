import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mossySprite } from '../js/ui/mossy-sprites.js';

test('洞窟でだけ5種の透過ドット絵を選び、他の戦闘と未知の敵はアイコンに戻す', async () => {
  const cave = { dungeonId: 'mossy_cave' };
  for (const [id, size] of [['slime', 32], ['cave_rat', 32], ['pollen_bug', 32], ['exp_mossy_cave_7', 32], ['goblin_boss', 48]]) {
    const sprite = mossySprite(cave, id);
    const png = await readFile(new URL(sprite.url));
    assert.equal(sprite.size, size);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    assert.equal(png[25], 6); // RGBA
    assert.equal(mossySprite({ dungeonId: 'blooming_hill' }, id), null);
    assert.equal(mossySprite({ ...cave, challenge: { kind: 'arena' } }, id), null);
  }
  for (const id of ['goblin', 'cave_bat', 'constructor', undefined]) assert.equal(mossySprite(cave, id), null);
});
