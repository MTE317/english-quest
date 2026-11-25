import { allowedDungeons } from './dungeon.js?v=jobs-master-1';

function availableStories(data, game) {
  const reachable = new Set(allowedDungeons(data, game).map(d => d.id));
  return (data.balance.exploration_stories ?? []).filter(story =>
    (reachable.has(story.dungeon) || Boolean(game.explorationStories?.[story.id])) &&
    (!story.flag || game.worldFlags?.[story.flag] === true) &&
    (!story.discovery || game.exploration?.discoveries?.[story.discovery] === true) &&
    (!story.after || game.explorationStories?.[story.after]?.claimed === true));
}

export function explorationStories(data, game, area) {
  return availableStories(data, game).filter(story =>
    !game.explorationStories?.[story.id]?.claimed &&
    (!area || area.dungeons.some(d => d.id === story.dungeon))).map(story => {
    const record = game.explorationStories?.[story.id];
    return { ...story, accepted: Boolean(record),
      ready: Boolean(record && (game.cleared?.[story.dungeon] ?? 0) > record.clearsAtAcceptance &&
        (!story.objectiveFlag || game.worldFlags?.[story.objectiveFlag] === true)) };
  });
}

export function acceptExplorationStory(data, game, id) {
  const story = explorationStories(data, game).find(row => row.id === id && !row.accepted);
  if (!story) throw new Error('この探索依頼は受けられません。');
  game.explorationStories ??= {};
  game.explorationStories[id] = { clearsAtAcceptance: game.cleared?.[story.dungeon] ?? 0 };
  return '探索依頼を受けた。';
}

export function reportExplorationStory(data, game, id) {
  const story = explorationStories(data, game).find(row => row.id === id && row.ready);
  if (!story) throw new Error('まだ報告できません。');
  for (const id of Object.keys(story.reward.materials)) {
    if (!data.materials.has(id)) throw new Error('報酬の素材が見つかりません。');
  }
  const { gold, points, materials } = story.reward;
  game.gold += gold;
  game.rankPoints = (game.rankPoints ?? 0) + points;
  for (const [id, quantity] of Object.entries(materials)) {
    game.storage.materials[id] = (game.storage.materials[id] ?? 0) + quantity;
  }
  game.explorationStories[id].claimed = true;
  const grants = [`+${gold} G`, `ポイント +${points}`,
    ...Object.entries(materials).map(([id, n]) => `${data.materials.get(id).name} ×${n}`)];
  return `${story.conclusion}　${grants.join('・')}`;
}

