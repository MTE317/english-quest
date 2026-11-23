import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadData, sourceFingerprint } from '../../../sim/balance.mjs';
import { createNewGame, defaultPartySpecs, normalizeGame } from '../../js/game-state.js';
import { createBattle, makeEnemy, setPending, resolvePending, nextTurn } from '../../js/battle.js';
import { unlockAndTrain } from './fixtures.mjs';

export function probes(runs = 2000) {
  const data = loadData(), fingerprint = sourceFingerprint();
  const game = createNewGame(data, defaultPartySpecs(data));
  unlockAndTrain(data, game, 0);
  const rows = [];
  const cases = [
    { id: 'shot', skill: 'petrifier_shot', passive: false },
    { id: 'shot_aim', skill: 'petrifier_shot', passive: true },
    { id: 'shot_duplicate', skill: 'petrifier_shot', passive: true, duplicate: true },
    { id: 'shot_wrong', skill: 'petrifier_shot', passive: true, wrong: true },
    { id: 'shot_resistant', skill: 'petrifier_shot', passive: true, affinity: '△' },
    { id: 'shot_immune', skill: 'petrifier_shot', passive: true, affinity: '×' },
    { id: 'shot_boss', skill: 'petrifier_shot', passive: true, boss: true },
    { id: 'volley_aim', skill: 'petrifier_volley', passive: true },
  ];
  for (const spec of cases) {
    let successes = 0, finishedByStone = 0;
    const outcomes = [];
    for (let i = 0; i < runs; i++) {
      const current = structuredClone(game);
      if (!spec.passive) current.party[0].loadout.passives = [];
      if (spec.duplicate) { current.party[0].loadout.passives.push('petrifier_aim'); normalizeGame(data, current); }
      const enemy = makeEnemy(data, 'goblin', { lv: 45, boss: spec.boss });
      enemy.hp = enemy.maxHp = 100000;
      enemy.statusAffinity = { petrify: spec.affinity ?? '〇' };
      const b = createBattle(data, current, { enemies: [enemy], seed: 1217071 + i * 7919 });
      b.round = 1; b.turn = { side: 'ally', i: 0 }; b.queue = [{ side: 'ally', i: 1 }];
      setPending(b, { type: 'skill', skillId: spec.skill, target: 0 }, { wordId: 'probe' });
      resolvePending(data, current, b, !spec.wrong);
      const success = Boolean(enemy.statuses.petrify);
      successes += Number(success); outcomes.push(success);
      if (success && b.result === 'win' && nextTurn(data, current, b) === null) finishedByStone++;
    }
    rows.push({ ...spec, runs, successes, rate: successes / runs, finishedByStone, outcomes });
  }
  const get = id => rows.find(r => r.id === id);
  assert.deepEqual(get('shot_aim').outcomes, get('shot_duplicate').outcomes);
  assert.ok(get('shot_aim').successes > get('shot').successes);
  assert.ok(get('shot_wrong').successes < get('shot_aim').successes);
  assert.equal(get('shot_immune').successes, 0);
  assert.equal(get('shot_boss').successes, 0);
  assert.ok(get('shot_resistant').successes < get('shot_aim').successes);
  for (const r of rows) assert.equal(r.finishedByStone, r.successes);
  return { fingerprint, sourceUnchangedAtCompletion: fingerprint === sourceFingerprint(), runs, seed: 1217071, step: 7919,
    target: 'goblin Lv45、HP100000の制御標的。通常耐性/指定耐性、自然遭遇率ではない',
    rows: rows.map(({ outcomes, ...rest }) => rest) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = probes(Number(process.env.RUNS ?? 2000));
  writeFileSync(process.argv[2] ?? '/tmp/petrifier-probes.json', JSON.stringify(result, null, 2)+'\n');
  console.table(result.rows.map(({ id, successes, rate, runs }) => ({ id, successes, rate, runs })));
}
