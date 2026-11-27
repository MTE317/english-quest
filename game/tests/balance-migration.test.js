import test from 'node:test';
import assert from 'node:assert/strict';
import { realGameData, MemoryStorage, T0 } from './helpers.js';
import { createNewGame, normalizeGame } from '../js/game-state.js';
import { GameSession } from '../js/save.js';
import { makeGear } from '../js/character.js';

const data = realGameData();
const fresh = () => createNewGame(data, ['thief', 'warrior', 'knight', 'white_mage', 'thief', 'bard']
  .map(job => ({ job, name: job, icon: 'x' })));

test('制作したユニークの再抽選結果は読み込み時に固定値へ戻らない', () => {
  const game = fresh();
  const gear = makeGear(game, 'craft_dagger_s2', {
    rarity: 'unique', affixes: { STR: 4.3, CRT: 2.7 },
    affixOrigins: { STR: 'unique', CRT: 'common' },
  });
  gear.crafted = true;
  game.storage.gear.push(gear);
  game.party[0].equip.weapon = structuredClone(gear);
  normalizeGame(data, game);
  assert.deepEqual(game.storage.gear[0].affixes, { STR: 4.3, CRT: 2.7 });
  assert.deepEqual(game.party[0].equip.weapon.affixOrigins, { STR: 'unique', CRT: 'common' });
});

test('ユニークの再抽選結果を保存・再読込しても効果と由来を維持する', () => {
  const memory = new MemoryStorage();
  const session = new GameSession({ storage: memory, now: () => T0 });
  const game = fresh();
  const gear = makeGear(game, 'craft_dagger_s2', {
    rarity: 'unique', affixes: { STR: 4.3, CRT: 2.7 },
    affixOrigins: { STR: 'unique', CRT: 'common' },
  });
  gear.crafted = true;
  game.storage.gear.push(gear);
  session.startNew(game);
  const loaded = new GameSession({ storage: memory, now: () => T0 });
  assert.deepEqual(loaded.game.storage.gear.at(-1).affixes, gear.affixes);
  assert.deepEqual(loaded.game.storage.gear.at(-1).affixOrigins, gear.affixOrigins);
});
