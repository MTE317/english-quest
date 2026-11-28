import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../sim/balance.mjs';
import { createNewGame, defaultPartySpecs } from '../js/game-state.js';
import { commitExploration } from '../js/exploration.js';
import { explorationStories, acceptExplorationStory, reportExplorationStory } from '../js/exploration-story.js';

test('現在遊べる探索依頼は安全帰還後に掲示し、新規踏破で一度だけ報酬を受け取る', () => {
  const data = loadData();
  delete data.worldRoutes; // 進行中の旧遠征・旧イベントの互換性を検証する。
  const game = createNewGame(data, defaultPartySpecs(data));
  const [first, second] = data.balance.exploration_stories;
  game.cleared = { [first.dungeon]: 1, [second.dungeon]: 1 };
  assert.deepEqual(explorationStories(data, game), []);
  assert.throws(() => acceptExplorationStory(data, game, first.id));
  commitExploration(game, [
    { key: 'survey', flag: first.flag },
    { key: 'entrance', discovery: second.discovery },
  ]);
  assert.deepEqual(explorationStories(data, game).map((x) => x.id), [first.id]);
  acceptExplorationStory(data, game, first.id);
  assert.throws(() => reportExplorationStory(data, game, first.id));
  game.cleared[first.dungeon]++;
  const gold = game.gold, points = game.rankPoints;
  reportExplorationStory(data, game, first.id);
  assert.equal(game.gold - gold, first.reward.gold);
  assert.equal(game.rankPoints - points, first.reward.points);
  assert.throws(() => reportExplorationStory(data, game, first.id));
  assert.ok(!explorationStories(data, game).some(({ id }) => id === second.id));
  assert.throws(() => acceptExplorationStory(data, game, second.id));
});

test('すでに受注済みの旧探索依頼は非公開地点でも報告できる', () => {
  const data = loadData();
  const game = createNewGame(data, defaultPartySpecs(data));
  const [first, second] = data.balance.exploration_stories;
  game.explorationStories = { [first.id]: { claimed: true }, [second.id]: { clearsAtAcceptance: 1 } };
  game.cleared = { [second.dungeon]: 2 };
  commitExploration(game, [
    { key: 'entrance', discovery: second.discovery },
    { key: 'tablet', flag: second.objectiveFlag },
  ]);
  assert.equal(explorationStories(data, game).find(({ id }) => id === second.id)?.ready, true);
  const gold = game.gold;
  reportExplorationStory(data, game, second.id);
  assert.equal(game.gold - gold, second.reward.gold);
  assert.equal(game.explorationStories[second.id].claimed, true);
});
