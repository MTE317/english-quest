import { writeFileSync } from 'node:fs';
import { fight, loadData, prepareParty, sourceFingerprint } from './balance.mjs';
import { makeEnemy } from '../game/js/battle.js';

const data = loadData();
const dungeon = data.dungeons.get('ancient_library');
const seed = 1217071;
const runs = 24;
const profiles = ['balanced6', 'critical6', 'weakness6'];
const cases = [
  { id: 'short', monsters: ['goblin'] },
  { id: 'multi', monsters: ['goblin', 'goblin', 'goblin'] },
  { id: 'boss', monsters: ['forbidden_keeper'], boss: true },
  { id: 'high_resistance', monsters: ['forbidden_keeper'], boss: true, syntheticAffinity: true },
];

const scenarios = cases.flatMap(scenario => profiles.map(profile => {
  const template = prepareParty(data, dungeon, profile, 'prepared');
  if (template.party.length !== 6) throw new Error(profile);
  const samples = Array.from({ length: runs }, (_, index) => {
    const enemies = scenario.monsters.map(monster => makeEnemy(data, monster, {
      lv: template.simulationFixture.level, dungeonId: dungeon.id, boss: Boolean(scenario.boss),
    }));
    if (scenario.syntheticAffinity) {
      const enemy = enemies[0];
      enemy.weak = [];
      enemy.strongWeak = [];
      enemy.immune = ['fire', 'ice'];
      enemy.resist = [...data.elements.keys()].filter(id => !enemy.immune.includes(id));
      enemy.statusAffinity = Object.fromEntries([...data.statusEffects.keys()].map(id => [id, '×']));
    }
    const outcome = fight(data, structuredClone(template), enemies, seed + index * 7919);
    return { win: outcome.win, questions: outcome.questions, rounds: outcome.rounds };
  });
  const average = field => samples.reduce((sum, value) => sum + value[field], 0) / runs;
  return { scenario: scenario.id, profile, level: template.simulationFixture.level,
    wins: samples.filter(s => s.win).length, questions: average('questions'), rounds: average('rounds'), samples };
}));

// Independent upper-bound model. Six allies present distinct E07 subscriptions.
// Each eligible manual action targets 3 enemies with 4 hits and can notify 5 allies.
const latency = [];
for (const [targets, hits] of [[1, 1], [3, 4]]) {
  const candidateDeliveries = 6 * 5 * targets * hits;
  const actionSummaries = 6 * 5;
  let roundBudget = 6;
  const used = new Set();
  let derived = 0;
  for (let actor = 0; actor < 6; actor++) {
    let rootBudget = 2;
    for (let offset = 1; offset < 6; offset++) {
      const owner = (actor + offset) % 6;
      if (used.has(owner) || rootBudget === 0 || roundBudget === 0) continue;
      rootBudget--;
      roundBudget--;
      used.add(owner);
      derived++;
    }
  }
  latency.push({ targets, hits, candidateDeliveries, actionSummaries, derived });
}

const out = {
  sourceSha256: sourceFingerprint(),
  engineScenarios: { seed, runs, accuracy: 0.8, preparation: 'prepared', dungeonId: dungeon.id, cases, scenarios },
  independentModel: { purpose: 'E07 evaluation counts, no runtime or balance claim', latency },
};
writeFileSync(new URL('./results/build-design-controlled.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
