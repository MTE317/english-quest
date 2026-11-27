import test from 'node:test';
import assert from 'node:assert/strict';
import { realGameData } from './helpers.js';
import { createNewGame, defaultPartySpecs } from '../js/game-state.js';
import { makeGear, weaponPower, gearEffects } from '../js/character.js';
import { rollAffixes, rollGearDrop } from '../js/loot.js';
import { craft, enchant, reroll } from '../js/workshop.js';

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

test('店売りは効果0で、通常ドロップと全再付与はレアリティの範囲を守る', () => {
  const game = fresh();
  assert.deepEqual(makeGear(game, 'sword_t1').affixes, {});
  const dungeon = data.dungeons.get('windward_plain');
  const drop = rollGearDrop(data, game, dungeon.id, 1, () => 0.4);
  assert.ok(Object.keys(drop.affixes).length >= 0 && Object.keys(drop.affixes).length <= 7);
  const gear = makeGear(game, 'sword_t2', { rarity: 'rare', affixes: { STR: 3 } });
  const price = data.economy.get(data.equipment.get(gear.id).star).craft_gold * 2;
  game.gold = price * 2;
  game.storage.materials.enchant_powder = 20;
  enchant(data, game, gear, null, () => 0.6);
  assert.ok(Object.keys(gear.affixes).length >= 2 && Object.keys(gear.affixes).length <= 4);
  assert.equal(game.gold, price);
  assert.equal(game.storage.materials.enchant_powder, 10);
  const key = Object.keys(gear.affixes).find(name => !name.startsWith('ELEMENT:'));
  if (key) {
    const names = Object.keys(gear.affixes);
    reroll(data, game, gear, key, () => 0);
    assert.deepEqual(Object.keys(gear.affixes), names);
    assert.equal(game.gold, 0);
  }
});

test('制作装備はユニークで、固有2〜4個と共通0〜2個を抽選する', () => {
  const game = fresh();
  game.gold = 100000;
  const recipe = data.recipes.find(r => r.id === 'iron_sword');
  for (const part of recipe.materials.split('|')) {
    const [id, count] = part.split(':');
    game.storage.materials[id] = Number(count);
  }
  craft(data, game, data.equipment.get(recipe.id), () => 0.5);
  const gear = game.storage.gear.at(-1);
  assert.equal(gear.quality, undefined);
  assert.equal(gear.rarity, 'unique');
  const kinds = Object.values(gear.affixOrigins);
  assert.ok(kinds.filter(kind => kind === 'unique').length >= 2);
  assert.ok(kinds.filter(kind => kind === 'common').length <= 2);
  assert.equal(weaponPower(data, game.party.find(m => m.job === 'warrior'), gear),
    weaponPower(data, game.party.find(m => m.job === 'warrior'), makeGear(game, 'sword_t1')));
});

