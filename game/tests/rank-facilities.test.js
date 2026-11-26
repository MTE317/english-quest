import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGameData, GAME_FILES } from '../js/gamedata.js';
import { createNewGame, normalizeGame } from '../js/game-state.js';
import { checkRankUp, nextRankStatus, questRankPoints, gearShopStock } from '../js/town.js';
import { facilityUpgrade, canBrew } from '../js/workshop.js';
import { readCsv, readJson } from './helpers.js';

const data = buildGameData(Object.fromEntries(Object.entries(GAME_FILES).map(([key, name]) =>
  [key, name.endsWith('.json') ? readJson(name) : readCsv(name).rows])));
const fresh = () => createNewGame(data, ['warrior','knight','black_mage','white_mage','thief','bard']
  .map(job => ({ job, name: job, icon: 'x' })));

test('依頼ポイントは★と種別に従い、ランクが上がっても減らない', () => {
  const game = fresh();
  const q = { rank: 2, questId: 'q2_hunt', type: 'hunt' };
  assert.equal(questRankPoints(data, game, q), 30);
  assert.equal(questRankPoints(data, game, { ...q, type: 'boss' }), 90);
  assert.equal(questRankPoints(data, game, { ...q, type: 'bounty' }), 150);
  game.rank = 'S';
  assert.equal(questRankPoints(data, game, q), 30);
});

test('昇格には累積ポイントと訪問可能な★のモンスター素材が要る', () => {
  const game = fresh();
  game.rankPoints = 200;
  assert.ok(nextRankStatus(data, game).needs.some(text => text.includes('素材')));
  game.storage.materials.slime_mat = 1;
  assert.equal(checkRankUp(data, game).length, 1);
  assert.equal(game.rank, 'E+');
  assert.equal(game.storage.materials.slime_mat, undefined);
  game.rankPoints = 1200;
  game.storage.materials.fort_bandit_mat = 2;
  assert.equal(checkRankUp(data, game).length, 0);
  game.cleared.mossy_cave = 1;
  assert.ok(nextRankStatus(data, game).needs.some(text => text.includes('試験')));
  game.examsPassed.push('D');
  assert.equal(checkRankUp(data, game).length, 1);
  assert.equal(game.rank, 'D');
});

test('施設Lv上限はランクで決まり、装備店と工房と調合は別投資', () => {
  const game = fresh();
  game.gold = 100000;
  assert.throws(() => facilityUpgrade(data, game, 'equipment_shop'), /上限/);
  game.rank = 'D';
  const initial = gearShopStock(data, game).map(row => row.def.id);
  facilityUpgrade(data, game, 'equipment_shop');
  assert.equal(game.facilities.equipment_shop, 2);
  assert.equal(game.facilities.workshop, 1);
  assert.equal(game.facilities.alchemy, 1);
  assert.notDeepEqual(gearShopStock(data, game).map(row => row.def.id), initial);
  facilityUpgrade(data, game, 'workshop');
  assert.equal(game.facilities.workshop, 2);
  const recipe = data.alchemyRecipes.find(row => Number(row.workshop_rank) === 2);
  assert.ok(recipe);
  assert.equal(canBrew(data, game, recipe), false);
  facilityUpgrade(data, game, 'alchemy');
  assert.equal(game.facilities.alchemy, 2);
  assert.throws(() => facilityUpgrade(data, game, 'alchemy'), /上限/);
});

test('旧セーブのランク・累積点・工房投資と合格済みの試験を引き継ぐ', () => {
  const game = fresh();
  game.rank = 'R04'; game.rankPoints = 51;
  game.rankFacilityVersion = undefined;
  game.facilities = { weapon_workshop: 2, armor_workshop: 4, accessory_workshop: 3, item_shop: 2, inn: 3 };
  game.examsPassed = ['R04'];
  normalizeGame(data, game);
  assert.equal(game.rank, 'C');
  assert.ok(game.rankPoints >= 8000);
  assert.equal(game.facilities.workshop, 4);
  assert.equal(game.facilities.equipment_shop, 4);
  assert.equal(game.facilities.alchemy, 2);
  assert.equal(game.facilities.inn, 3);
  assert.ok(game.examsPassed.includes('C'));
  const snapshot = structuredClone(game.facilities);
  normalizeGame(data, game);
  assert.deepEqual(game.facilities, snapshot);
});
