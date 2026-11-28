import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGameData, GAME_FILES } from '../js/gamedata.js';
import { createNewGame } from '../js/game-state.js';
import { allowedDungeons } from '../js/dungeon.js';
import { materialsForEnemy } from '../js/loot.js';
import { D_PROMOTION_MATERIALS, promotionMaterialStatus, offerPromotionMaterials,
  nextRankStatus, checkRankUp } from '../js/town.js';
import { makePromotionExam, promotionProgress, recordPromotionPart, promotionExamState,
  scorePhraseGrades } from '../js/promotion.js';
import { LearningStore } from '../js/storage.js';
import { readCsv, readJson, MemoryStorage, seededRng } from './helpers.js';

const data = buildGameData(Object.fromEntries(Object.entries(GAME_FILES).map(([key, name]) =>
  [key, name.endsWith('.json') ? readJson(name) : readCsv(name).rows])));
const fresh = () => createNewGame(data, ['warrior','knight','black_mage','white_mage','thief','bard']
  .map(job => ({ job, name: job, icon: 'x' })));

test('Dの素材は★2「崩れた砦」の通常敵から取得でき、受験時の納品は一度だけ', () => {
  const game = fresh();
  const [need] = D_PROMOTION_MATERIALS;
  assert.equal(need.id, 'fort_bandit_mat');
  assert.equal(need.count, 2);
  assert.equal(data.monsters.get('fort_bandit').role, 'normal');
  assert.equal(data.materials.get(need.id).rank, 2);
  assert.equal(data.materials.get(need.id).kind, 'common');
  assert.equal(data.dungeons.get(need.dungeonId).rank, 2);
  assert.ok(materialsForEnemy(data, need.dungeonId, { monsterId: 'fort_bandit', boss: false }, () => 0)
    .some(row => row.id === need.id));
  assert.equal(allowedDungeons(data, game).some(dungeon => dungeon.id === need.dungeonId), false);
  game.rank = 'E+'; game.rankPoints = 1200;
  game.storage.materials[need.id] = 2;
  assert.throws(() => offerPromotionMaterials(data, game, 'D'), /素材/);
  game.worldJourney.seen.push('C');
  assert.equal(promotionMaterialStatus(data, game, data.ranks.find(rank => rank.id === 'D')).ready, true);
  offerPromotionMaterials(data, game, 'D');
  assert.equal(game.storage.materials[need.id], undefined);
  assert.equal(game.promotionOfferings.D, true);
  assert.equal(checkRankUp(data, game).length, 0);
  assert.equal(nextRankStatus(data, game).needs.some(text => text.includes('素材')), false);
  offerPromotionMaterials(data, game, 'D');
  game.examsPassed.push('D');
  assert.equal(checkRankUp(data, game).length, 1);
  assert.equal(game.rank, 'D');
});

test('30＋15件の学習履歴が受験条件。D/Cは最近、B/A/Sは全履歴から同数抽選', () => {
  const store = new LearningStore(new MemoryStorage());
  const catalog = {
    words: Array.from({ length: 100 }, (_, i) => ({ id: `w${i}` })),
    phrases: Array.from({ length: 45 }, (_, i) => ({ id: `p${i}` })),
  };
  const game = { chants: { records: {} } };
  for (let i = 0; i < 100; i++) store.set(`w${i}`, { last: i < 40 ? 1 : 2 });
  for (let i = 0; i < 45; i++) game.chants.records[`p${i}`] = { last: i < 15 ? 1 : 2 };
  for (const rankId of ['D','C']) {
    const plan = makePromotionExam(catalog, store, game, rankId, seededRng(7));
    assert.equal(plan.words.length, 30);
    assert.equal(plan.phrases.length, 15);
    assert.ok(plan.words.every(row => Number(row.id.slice(1)) >= 40));
    assert.ok(plan.phrases.every(row => Number(row.id.slice(1)) >= 15));
  }
  for (const [rankId, rate] of [['B',0.8],['A',0.9],['S',1]]) {
    const plan = makePromotionExam(catalog, store, game, rankId, seededRng(7));
    assert.equal(plan.passRate, rate);
    assert.equal(plan.words.length, 30);
    assert.equal(plan.phrases.length, 15);
    assert.ok(plan.words.some(row => Number(row.id.slice(1)) < 40));
    assert.ok(plan.phrases.some(row => Number(row.id.slice(1)) < 15));
  }
  assert.equal(promotionProgress(catalog, store, game, 'D').wordMet, true);
  const scarce = { ...catalog, words: catalog.words.slice(0, 29) };
  assert.equal(promotionProgress(scarce, store, game, 'D').wordMet, false);
  assert.throws(() => makePromotionExam(scarce, store, game, 'D'), /30件/);
  const shortPhrases = { ...catalog, phrases: catalog.phrases.slice(0, 14) };
  assert.equal(promotionProgress(shortPhrases, store, game, 'D').phraseMet, false);
  assert.throws(() => makePromotionExam(shortPhrases, store, game, 'D'), /15件/);
});

test('Aは27/30と13.5/15、Sは両部門満点。合格した部門は再受験で維持', () => {
  const store = new LearningStore(new MemoryStorage());
  assert.equal(recordPromotionPart(store, 'A', 'word', 26, 30, 1, 0.9).passed, false);
  assert.equal(recordPromotionPart(store, 'A', 'word', 27, 30, 2, 0.9).passed, true);
  assert.equal(recordPromotionPart(store, 'A', 'phrase', 13, 15, 2, 0.9).passed, false);
  assert.equal(recordPromotionPart(store, 'A', 'phrase', 13.5, 15, 3, 0.9).complete, true);
  assert.equal(recordPromotionPart(store, 'S', 'word', 29, 30, 4, 1).passed, false);
  assert.equal(recordPromotionPart(store, 'S', 'word', 30, 30, 5, 1).passed, true);
  assert.equal(recordPromotionPart(store, 'S', 'phrase', 14.5, 15, 5, 1).passed, false);
  assert.equal(recordPromotionPart(store, 'S', 'phrase', 15, 15, 6, 1).complete, true);
  assert.equal(promotionExamState(new LearningStore(store.storage), 'S').wordPassed, true);
  assert.equal(scorePhraseGrades(['o','t','x']), 1.5);
});
