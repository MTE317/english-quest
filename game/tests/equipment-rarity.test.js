import test from 'node:test';
import assert from 'node:assert/strict';
import { realGameData } from './helpers.js';
import { createNewGame, defaultPartySpecs } from '../js/game-state.js';
import { makeGear, weaponPower, gearEffects } from '../js/character.js';
import { rollAffixes, rollGearDrop } from '../js/loot.js';
import { craft, enchant, enchantValue } from '../js/workshop.js';

const data = realGameData();
const fresh = () => createNewGame(data, defaultPartySpecs(data));

test('同じ★・武器種の店売りとドロップは同じ基礎威力で、レアリティと強化を一度ずつ適用する', () => {
  const game = fresh();
  const member = game.party.find((m) => m.job === 'warrior');
  const shop = makeGear(game, 'sword_t1');
  const dropped = makeGear(game, 'sword_t2');
  const base = weaponPower(data, member, shop);
  assert.equal(base, weaponPower(data, member, dropped));
  dropped.rarity = 'rare';
  assert.ok(Math.abs(weaponPower(data, member, dropped) / base - 1.04) < 1e-10);
  dropped.enh = 2;
  assert.ok(Math.abs(weaponPower(data, member, dropped) / base - 1.04 * 1.10) < 1e-10);
  assert.equal(data.equipment.get('sword_t1').itemLv, undefined);
});

test('通常ドロップの★は地域の★で選び、天然効果の数値にレアリティ補正を一度かける', () => {
  const game = fresh();
  for (const dungeon of ['windward_plain', 'ruined_fort', 'howling_canyon']) {
    const def = data.dungeons.get(dungeon);
    const gear = rollGearDrop(data, game, dungeon, 3, () => 0.4);
    assert.equal(data.equipment.get(gear.id).star, def.rank);
  }
  const rare = rollAffixes(data, 'weapon', 1, 1, 2, () => 0.5);
  const origin = rollAffixes(data, 'weapon', 1, 1, 6, () => 0.5);
  const key = Object.keys(rare)[0];
  assert.equal(Object.keys(origin)[0], key);
  assert.ok(Math.abs(origin[key] / rare[key] - 1.12 / 1.04) < 0.02);
});

test('通常ドロップにも後付け2枠を使え、天然効果の振り直しとは別に保たれる', () => {
  const game = fresh();
  game.gold = 10000;
  const material = [...data.materials.values()].find((m) => m.kind === 'common' && !m.element);
  game.storage.materials.enchant_powder = 20;
  game.storage.materials[material.id] = 2;
  const gear = makeGear(game, 'sword_t2', { rarity: 'rare', affixes: { STR: 3 } });
  const def = data.equipment.get(gear.id);
  assert.equal(enchantValue(data, def, 'ELEM_DMG:slash', 1, 'rare'), 8.7);
  enchant(data, game, gear, 0, material.id, 1, () => 0.99);
  enchant(data, game, gear, 1, material.id, 1, () => 0.99);
  assert.equal(gear.enchants.length, 2);
  assert.deepEqual(gear.affixes, { STR: 3 });
  assert.equal(gearEffects(gear).STR, 3);
  assert.throws(() => enchant(data, game, gear, 2, material.id, 1));
});

test('製作品は隠れた15%補正を持たず、レシピ固有効果はコモンのまま保持する', () => {
  const game = fresh();
  game.gold = 100000;
  const recipe = data.recipes.find((r) => r.id === 'iron_sword');
  for (const part of recipe.materials.split('|')) {
    const [id, count] = part.split(':');
    game.storage.materials[id] = Number(count);
  }
  const crafted = craft(data, game, data.equipment.get(recipe.id));
  assert.match(crafted, /制作/);
  const gear = game.storage.gear.at(-1);
  assert.equal(gear.quality, undefined);
  assert.equal(gear.rarity, 'common');
  assert.equal(gearEffects(gear).STR, 2);
  assert.equal(weaponPower(data, game.party.find((m) => m.job === 'warrior'), gear),
    weaponPower(data, game.party.find((m) => m.job === 'warrior'), makeGear(game, 'sword_t1')));
});
