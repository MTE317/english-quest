import test from 'node:test';
import assert from 'node:assert/strict';
import { realGameData } from './helpers.js';
import { createNewGame, defaultPartySpecs, normalizeGame } from '../js/game-state.js';
import { makeGear } from '../js/character.js';
import { enhance, enchant, enchantCandidates, enchantFamilies, dismantle, dismantlePowder } from '../js/workshop.js';
import { STONE_STAGES, stoneRequirement, availableStoneStages, awardCompositionSet } from '../js/workshop-materials.js';

const data = realGameData();
const fresh = () => createNewGame(data, defaultPartySpecs(data));

test('分解は全装備の効果数に応じて粉0～3個を返し、欠片と強化石Iも維持する', () => {
  const slots = ['weapon', 'head', 'accessory'];
  for (const slot of slots) {
    const def = [...data.equipment.values()].find(e => e.slot === slot && e.star === 1);
    assert.ok(def);
    for (let count = 0; count <= 7; count++) {
      const game = fresh();
      const gear = makeGear(game, def.id, {
        affixes: Object.fromEntries(Array.from({ length: count }, (_, i) => [`effect_${i}`, 1])),
      });
      game.storage.gear.push(gear);
      game.storage.materials.enchant_powder = 4;
      const expected = Math.min(3, Math.ceil(count / 2));
      assert.equal(dismantlePowder(gear), expected);
      const message = dismantle(data, game, gear);
      assert.equal(game.storage.gear.includes(gear), false);
      assert.equal(game.storage.materials.fragment_common, 1);
      assert.equal(game.storage.materials.enhancement_stone_1, 1);
      assert.equal(game.storage.materials.enchant_powder, 4 + expected);
      assert.match(message, expected ? new RegExp(`粉${expected}個`) : /欠片と強化石Iを得た/);
      assert.throws(() => dismantle(data, game, gear), /所持品/);
    }
  }
  const legacy = { affixes: { STR: 2 }, enchants: [{ stat: 'MAG', value: 3 }] };
  assert.equal(dismantlePowder(legacy), 1);
});

test('強化石の種類・必要数は装備★ではなく強化先+1～+10で決まる', () => {
  const ids = [1,1,1,2,2,3,3,4,4,5];
  const counts = [3,3,3,5,5,5,5,10,10,10];
  for (let from = 0; from < 10; from++) {
    const req = stoneRequirement(data, from);
    assert.equal(req.id, `enhancement_stone_${ids[from]}`);
    assert.equal(req.count, counts[from]);
    assert.equal(req.target, from + 1);
  }
  assert.equal(stoneRequirement(data, 10), null);
  assert.equal(STONE_STAGES.length, 5);
  const game = fresh();
  game.gold = 1e9;
  game.facilities.workshop = 4;
  const starOne = makeGear(game, 'sword_t1');
  const starTwelve = makeGear(game, [...data.equipment.values()].find((e) => e.star === 12 && e.slot === 'weapon').id);
  for (const gear of [starOne, starTwelve]) {
    gear.enh = 8;
    game.storage.materials.enhancement_stone_4 = 10;
    enhance(data, game, gear, () => 0);
    assert.equal(gear.enh, 9);
    assert.equal(game.storage.materials.enhancement_stone_4, undefined);
  }
});

test('失敗でも当該段階の石10個を消費し、強化値を維持する', () => {
  const game = fresh(); game.gold = 1e9; game.facilities.workshop = 5;
  const gear = makeGear(game, 'sword_t1'); gear.enh = 9;
  game.storage.materials.enhancement_stone_5 = 10;
  const message = enhance(data, game, gear, () => 0.99);
  assert.match(message, /失敗/);
  assert.equal(gear.enh, 9);
  assert.equal(gear.enhanceFailures, 1);
  assert.equal(game.storage.materials.enhancement_stone_5, undefined);
});

test('英作文5・10・15問の完了で、石は1・2・3個、共通粉は毎回1個得る', () => {
  const game = fresh();
  assert.deepEqual(availableStoneStages(data, game).map((s) => s.id), ['enhancement_stone_1']);
  for (const [count, amount] of [[5,1],[10,2],[15,3]]) {
    const result = awardCompositionSet(data, game, { mode:'phrases', count, answered:count, phrases:count,
      stoneId:'enhancement_stone_1' });
    assert.equal(result.stones, amount);
    assert.equal(result.powder, 1);
  }
  assert.equal(game.storage.materials.enhancement_stone_1, 6);
  assert.equal(game.storage.materials.enchant_powder, 3);
  assert.equal(awardCompositionSet(data, game, { mode:'phrases', count:10, answered:9, phrases:9,
    stoneId:'enhancement_stone_1' }), null);
  assert.equal(awardCompositionSet(data, game, { mode:'words', count:5, answered:5, phrases:0,
    stoneId:'enhancement_stone_1' }), null);
  assert.throws(() => awardCompositionSet(data, game, { mode:'chunks', count:5, answered:5, phrases:5,
    stoneId:'enhancement_stone_2' }));
  game.rank = 'D';
  const result = awardCompositionSet(data, game, { mode:'chunks', count:5, answered:5, phrases:5,
    stoneId:'enhancement_stone_2' });
  assert.equal(result.stones, 1);
  assert.equal(result.powder, 1);
  assert.equal(game.storage.materials.enchant_powder, 4);
});

test('共通の旧強化石は最初の石へ一度だけ移行する', () => {
  const game = fresh(); game.storage.materials.enhancement_stone = 7;
  normalizeGame(data, game);
  normalizeGame(data, game);
  assert.equal(game.storage.materials.enhancement_stone_1, 7);
  assert.equal(game.storage.materials.enhancement_stone, undefined);
});

test('全再付与は★別ゴールドと粉10個を消費し、追加素材は種類を保証しない', () => {
  const weapon = [...data.equipment.values()].find(e => e.slot === 'weapon' && e.star === 1 && e.source.includes('制作'));
  const material = [...data.materials.values()].find(m => data.monsters.get(m.sourceMonster)?.types?.includes('dragon')
    && enchantFamilies(data, weapon, m).includes('TYPE_BONUS:dragon'));
  assert.ok(material);
  const game = fresh();
  game.gold = 1e6;
  game.storage.materials.enchant_powder = 10;
  game.storage.materials[material.id] = 1;
  const gear = makeGear(game, weapon.id);
  const before = game.gold;
  enchant(data, game, gear, material.id, () => 0.9);
  assert.equal(game.gold, before - 2 * data.economy.get(weapon.star).craft_gold);
  assert.equal(game.storage.materials.enchant_powder ?? 0, 0);
  assert.equal(game.storage.materials[material.id] ?? 0, 0);
  assert.ok(Object.keys(gear.affixes).length <= 2);
  assert.throws(() => enchant(data, game, gear, '', () => 0), /素材が足りません/);
});

