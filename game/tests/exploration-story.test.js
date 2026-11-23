import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../sim/balance.mjs';
import { createNewGame, defaultPartySpecs } from '../js/game-state.js';
import { commitExploration } from '../js/exploration.js';
import { explorationStories, acceptExplorationStory, reportExplorationStory } from '../js/exploration-story.js';

test('探索依頼は安全帰還後に掲示し、新規踏破を一度だけ報酬に換える', () => {
  const data = loadData();
  const game = createNewGame(data, defaultPartySpecs(data));
  game.rank = 'R02';
  const [first, second] = data.balance.exploration_stories;
  game.cleared = { [first.dungeon]: 1, [second.dungeon]: 1 };
  const source = [
    { key: 'survey', flag: first.flag },
    { key: 'entrance', discovery: second.discovery },
  ];
  assert.deepEqual(explorationStories(data, game), []);
  assert.throws(() => acceptExplorationStory(data, game, first.id));
  commitExploration(game, source);
  assert.deepEqual(explorationStories(data, game).map(x => x.id), [first.id]);

  for (const story of [first, second]) {
    acceptExplorationStory(data, game, story.id);
    assert.throws(() => reportExplorationStory(data, game, story.id));
    game.cleared[story.dungeon]++;
    if (story.objectiveFlag) {
      assert.throws(() => reportExplorationStory(data, game, story.id));
      commitExploration(game, [{ key: 'objective', flag: story.objectiveFlag }]);
    }
    const gold = game.gold, points = game.rankPoints;
    reportExplorationStory(data, game, story.id);
    assert.equal(game.gold - gold, story.reward.gold);
    assert.equal(game.rankPoints - points, story.reward.points);
    for (const [id, count] of Object.entries(story.reward.materials)) assert.equal(game.storage.materials[id], count);
    assert.throws(() => reportExplorationStory(data, game, story.id));
  }
});
