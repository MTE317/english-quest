import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { loadData, sourceFingerprint } from '../../../sim/balance.mjs';
import { partyFixture } from './fixtures.mjs';
import { createBattle, makeEnemy, setPending, resolvePending } from '../../js/battle.js';
const data = loadData(), fingerprint = sourceFingerprint();
const trials = 128, rows = [];
const normalDefense = { ...data, skills: new Map(data.skills) };
const pierce = data.skills.get('petrifier_pierce');
normalDefense.skills.set(pierce.id, { ...pierce, effect: { ...pierce.effect, defign: 0 } });
for (const id of ['sand_tomb_boss', 'millennium_root_boss']) {
  let damage = 0, withoutIgnore = 0, stone = 0;
  for (let i = 0; i < trials; i++) {
    for (const control of [false, true]) {
      const d = control ? normalDefense : data, game = partyFixture(data, 'petrifier');
      const enemy = makeEnemy(data, id, { lv: 45, boss: true });
      const before = enemy.hp;
      const b = createBattle(d, game, { enemies: [enemy], seed: 1217071 + i * 7919 });
      b.round = 1; b.turn = { side: 'ally', i: 5 };
      setPending(b, { type: 'skill', skillId: pierce.id, target: 0 }, {});
      resolvePending(d, game, b, true);
      if (control) withoutIgnore += before - enemy.hp;
      else { damage += before - enemy.hp; stone += Number(Boolean(enemy.statuses.petrify)); }
    }
  }
  assert.equal(stone, 0); assert.ok(damage > withoutIgnore);
  rows.push({ id, trials, damage: damage / trials, noIgnoreControlDamage: withoutIgnore / trials, stone });
}
const output = { fingerprint, sourceUnchangedAtCompletion: fingerprint === sourceFingerprint(), rows,
  limits: '正式ボスLv45への単発正解攻撃。対照のみ防御無視を0にした検証用コピーで、バランス値の変更ではない。連戦完走率ではない。' };
writeFileSync(process.argv[2] ?? '/tmp/petrifier-boss-probe.json', JSON.stringify(output, null, 2)+'\n');
console.table(rows);
