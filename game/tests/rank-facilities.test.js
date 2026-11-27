import test from 'node:test';
import assert from 'node:assert/strict';
import { availableJobs } from '../js/growth.js';
import { buildGameData, GAME_FILES } from '../js/gamedata.js';
import { createNewGame, normalizeGame } from '../js/game-state.js';
import { checkRankUp, nextRankStatus, questRankPoints, gearShopStock } from '../js/town.js';
import { facilityUpgrade, facilityUnlocks, canBrew } from '../js/workshop.js';
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
  facilityUpgrade(data, game, 'alchemy');
  assert.equal(game.facilities.alchemy, 3);
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

test('11段階の投資額とギルド上限、★11・★12の同時解放', () => {
  const game = fresh();
  assert.deepEqual(data.ranks.map(row => row.facilityCap), [1,2,3,4,5,6,7,8,9,10,11]);
  assert.equal(data.facilities.length, 5);
  assert.equal(data.facilityRanks[1].invest_cost, 3000);
  assert.equal(data.facilityRanks[2].invest_cost, 6000);
  assert.equal(data.facilityRanks.at(-1).invest_cost, 1000000);
  game.rank = 'E+';
  game.gold = 20000;
  facilityUpgrade(data, game, 'equipment_shop');
  assert.equal(game.gold, 17000);
  assert.ok(gearShopStock(data, game).some(row => row.star === 2));
  assert.throws(() => facilityUpgrade(data, game, 'equipment_shop'), /上限/);
  game.rank = 'S'; game.gold = 2000000;
  game.facilities.equipment_shop = 10;
  assert.ok(facilityUnlocks(data, 'equipment_shop', 11).length);
  facilityUpgrade(data, game, 'equipment_shop');
  assert.ok(gearShopStock(data, game).some(row => row.star === 11));
  assert.ok(gearShopStock(data, game).some(row => row.star === 12));
});
test('神殿Lv7で追加職を解放し、旧Lv12と所持装備は失われない', () => {
  const game = fresh();
  assert.ok(facilityUnlocks(data, 'temple', 7).length >= 6);
  game.rank = 'S'; game.gold = 2000000;
  game.facilities.temple = 6;
  facilityUpgrade(data, game, 'temple');
  assert.equal(game.facilities.temple, 7);
  game.facilities.workshop = 12;
  game.facilities.equipment_shop = 12;
  game.facilities.warehouse = 5;
  game.rankFacilityVersion = 1;
  game.storage.gear.push({ uid: 999, id: [...data.equipment.keys()][0] });
  normalizeGame(data, game);
  assert.equal(game.facilities.workshop, 11);
  assert.equal(game.facilities.equipment_shop, 11);
  assert.equal(game.facilities.warehouse, undefined);
  assert.equal(game.storage.gear.at(-1).uid, 999);
});

test('新規は基本8職、神殿投資で実装済み職が増え、既存セーブの取得職は保持', () => {
  const game = fresh();
  assert.equal(availableJobs(data, game).length, 8);
  game.rank = 'E+'; game.gold = 10000;
  facilityUpgrade(data, game, 'temple');
  assert.equal(availableJobs(data, game).length, 12);
  const legacy = fresh();
  delete legacy.templeUnlockVersion;
  legacy.facilities.temple = 1;
  normalizeGame(data, legacy);
  assert.ok(availableJobs(data, legacy).length >= 26);
  const count = availableJobs(data, legacy).length;
  normalizeGame(data, legacy);
  assert.equal(availableJobs(data, legacy).length, count);
});
test('調合の新段階には実際に作れるレシピがある', () => {
  for (const lv of [3, 5, 8, 9, 11]) assert.ok(facilityUnlocks(data, 'alchemy', lv).length, `Lv${lv}`);
  assert.equal(facilityUnlocks(data, 'temple', 11).length, 0);
});
