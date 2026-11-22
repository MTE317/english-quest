import { splitList } from './csv.js';

export function chainStep(chain, game) {
  const record = game.chains?.[chain.id];
  if (!record || record.claimed) return null;
  const text = splitList(chain.steps)[record.step];
  if (!text) return { kind: 'reward' };
  const [kind, target, goal] = text.split(':');
  return { kind, target, goal: parseInt(goal, 10), progress: record.progress ?? 0 };
}

export function acceptChain(game, chain) {
  game.chains ??= {};
  if (game.chains[chain.id]) throw new Error('受注済みです。');
  game.chains[chain.id] = { step: 0, progress: 0 };
}

export function stepLabel(data, step) {
  const name = data.dungeons.get(step.target)?.name ?? step.target;
  if (step.kind === 'talk') return step.target + 'に話す';
  if (step.kind === 'explore') return `${name}の${step.goal}階まで進む`;
  if (step.kind === 'gather') return `${step.target}を ${step.goal} 個納品する`;
  if (step.kind === 'boss') return `${data.monsters.get(step.target)?.name ?? step.target}を倒す`;
  if (step.kind === 'hunt') return `${name}で敵を倒す（${step.progress} / ${step.goal}）`;
  return '報酬を受け取る';
}

export function updateChains(data, game, dungeonId, floor, enemies) {
  for (const chain of data.questChains) {
    const step = chainStep(chain, game);
    if (!step) continue;
    if (step.kind === 'boss' && enemies.some((e) => e.monsterId === step.target && e.hp <= 0)) game.chains[chain.id].step += 1;
    if (step.target !== dungeonId) continue;
    const r = game.chains[chain.id];
    if (step.kind === 'explore' && floor >= step.goal) { r.step += 1; r.progress = 0; }
    if (step.kind === 'hunt') {
      r.progress += enemies.filter((e) => e.hp <= 0).length;
      if (r.progress >= step.goal) { r.step += 1; r.progress = 0; }
    }
  }
}

export function talkChain(game, chain) {
  if (chainStep(chain, game)?.kind !== 'talk') throw new Error('今は会話できません。');
  game.chains[chain.id].step += 1;
  return '依頼の内容を聞いた。';
}

export function deliverChain(data, game, chain) {
  const step = chainStep(chain, game);
  if (step?.kind !== 'gather') throw new Error('今は納品できません。');
  const rank = Number(step.target.match(/★(\d+)/)?.[1] ?? chain.star);
  const stock = game.storage.materials;
  const supply = Object.entries(stock).filter(([id]) => data.materials.get(id)?.rank === rank);
  if (supply.reduce((sum, [, count]) => sum + count, 0) < step.goal) throw new Error('納品に必要な素材が足りません。');
  let left = step.goal;
  for (const [id, count] of supply) {
    if (!left) break;
    const take = Math.min(left, count);
    stock[id] -= take;
    if (!stock[id]) delete stock[id];
    left -= take;
  }
  game.chains[chain.id].step += 1;
  return '素材を納品した。';
}

export function claimChain(data, game, chain, rng) {
  if (chainStep(chain, game)?.kind !== 'reward') throw new Error('まだ報告できません。');
  const rank = Number(chain.star);
  const [goldText, matText, pointsText] = splitList(chain.reward);
  const gold = (Number(goldText?.match(/遠征(\d+)/)?.[1]) || 0) * data.economy.get(rank).run_income;
  const quantity = Number(matText?.match(/素材(\d+)/)?.[1]) || 0;
  const points = Number(pointsText?.match(/ポイント(\d+)/)?.[1]) || 0;
  const rares = [...data.materials.values()].filter((m) => m.kind === 'rare' && m.rank === rank && !m.season);
  const mat = rares[Math.floor(rng() * rares.length)];
  if (mat && quantity) game.storage.materials[mat.id] = (game.storage.materials[mat.id] ?? 0) + quantity;
  game.gold += gold;
  game.rankPoints += points;
  game.chains[chain.id].claimed = true;
  return `連続クエスト達成。+${gold} G、ギルドポイント +${points}${mat && quantity ? `、${mat.name} ×${quantity}` : ''}`;
}
