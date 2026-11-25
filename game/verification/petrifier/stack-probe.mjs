import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { loadData, sourceFingerprint } from '../../../sim/balance.mjs';
import { partyFixture } from './fixtures.mjs';
import { normalizeGame } from '../../js/game-state.js';
import { changeJob, learnSkill, isLearned, equipSkill } from '../../js/growth.js';
import { unlockJob } from '../../js/temple.js';
import { parseAmounts } from '../../js/csv.js';
import { maxHp, maxMp } from '../../js/character.js';
import { createBattle, makeEnemy, setPending, resolvePending } from '../../js/battle.js';
const data = loadData(), fingerprint = sourceFingerprint(), runs = 2000;
const single = partyFixture(data, 'petrifier'), mixed = partyFixture(data, 'mixed'), synergy = structuredClone(single);
const m = synergy.party[5], loadout = structuredClone(m.loadout), equip = structuredClone(m.equip);
const costs = { ap: {}, jp: 0, materials: {} };
for (const [job, targetId] of [['hexer', 'hexer_p2_s4'], ['apothecary', 'apothecary_p2_s2']]) {
  const rule = data.jobUnlocks.get(job);
  const mats = Object.fromEntries(parseAmounts(rule.materials).map(({ id, count }) => [id, count]));
  Object.assign(synergy.storage.materials, mats); costs.materials[job] = mats;
  unlockJob(data, synergy, job);
  const jp = data.jobsById.get(job).changeJp; synergy.jp = jp; changeJob(data, synergy, 5, job); costs.jp += jp;
  const target = data.skills.get(targetId);
  m.ap = 1000; costs.ap[job] = 0;
  for (const s of [...data.skills.values()].filter(s => s.job === job && s.path === target.path && s.stage <= target.stage).sort((a,b) => a.stage-b.stage)) {
    if (!isLearned(m, s)) { learnSkill(data, m, s.id); costs.ap[job] += s.apToLearn; }
  }
}
synergy.jp = 240; changeJob(data, synergy, 5, 'petrifier'); costs.jp += 240;
m.loadout = loadout; m.equip = equip;
equipSkill(data, m, 'hexer_p2_s4'); equipSkill(data, m, 'apothecary_p2_s2');
m.hp = maxHp(data, m); m.mp = maxMp(data, m);
const duplicate = structuredClone(synergy); duplicate.party[5].loadout.passives.push('petrifier_aim'); normalizeGame(data, duplicate);
const templates = { single, mixed, synergy, duplicate };
const rows = [], results = {};
for (const [name, template] of Object.entries(templates)) {
  const outcomes = [];
  for (let i=0; i<runs; i++) {
    const game = structuredClone(template), enemy = makeEnemy(data, 'goblin', {lv:45});
    enemy.hp = enemy.maxHp = 100000;
    const b = createBattle(data, game, { enemies:[enemy], seed:1217071+i*7919 });
    b.round=1; b.turn={side:'ally',i:5};
    setPending(b,{type:'skill',skillId:'petrifier_shot',target:0},{});resolvePending(data,game,b,true);
    outcomes.push(Boolean(enemy.statuses.petrify));
  }
  results[name]=outcomes;
  rows.push({name,runs,successes:outcomes.filter(Boolean).length,rate:outcomes.filter(Boolean).length/runs,passives:template.party[5].loadout.passives});
}
assert.deepEqual(results.single,results.mixed);
assert.deepEqual(results.synergy,results.duplicate);
assert.ok(rows[2].successes > rows[0].successes);
const output={fingerprint,sourceUnchangedAtCompletion:fingerprint===sourceFingerprint(),seed:1217071,step:7919,rows,costs,
  limits:'合法な他職経由で既存パッシブ2個を装着。HP100000の単発制御プローブ。味方のDパッシブは重ならず、既存状態付与+25%は既存計算通り加算。装備付与の最大化・全員D・状態専用の石化弾は含めない。'};
writeFileSync(process.argv[2]??'/tmp/petrifier-stack.json',JSON.stringify(output,null,2)+'\n');console.table(rows);
