// 正式データの回避率を使い、1入力だけの発動率を戦闘APIで比較する。
import { writeFileSync } from 'node:fs';
import { loadData, sourceFingerprint } from '../../../sim/balance.mjs';
import { createNewGame } from '../../js/game-state.js';
import { makeEnemy, createBattle, setPending, resolvePending } from '../../js/battle.js';
import { maxHp, maxMp } from '../../js/character.js';
const data = loadData();
const sourceSha256 = sourceFingerprint();
const runs = 1000, seed = 1217071, step = 7919;
const results = [];
for (const bound of [false, true]) for (const eliteId of [null, 'shadow']) {
  let evaded = 0, damage = 0;
  for (let i = 0; i < runs; i++) {
    const game = createNewGame(data, ['black_mage', 'warrior', 'hunter', 'white_mage', 'thief', 'bard']
      .map((job, i) => ({ job, name: `検証${i}`, icon: 'x' })));
    for (const m of game.party) { m.lv = 20; m.hp = maxHp(data, m); m.mp = maxMp(data, m); }
    const enemy = makeEnemy(data, 'goblin', { lv: 20, eliteId });
    if (bound) enemy.statuses.bind = { turns: 2, n: 1 };
    const before = enemy.hp;
    const battle = createBattle(data, game, { enemies: [enemy], seed: seed + i * step });
    battle.turn = { side: 'ally', i: 0 };
    setPending(battle, { type: 'skill', skillId: 'black_mage_p1_s1', target: 0 }, {});
    resolvePending(data, game, battle, true);
    if (enemy.hp === before) evaded++;
    damage += before - enemy.hp;
  }
  results.push({ bound, eliteId, runs, evaded, meanDamage: damage / runs });
}
const result = { sourceSha256, sourceUnchangedAtCompletion: sourceSha256 === sourceFingerprint(), seed, step,
  accuracy: 1, partySize: 6, level: 20, skill: 'black_mage_p1_s1', monster: 'goblin',
  limitations: '単一入力の制御プローブ。出現頻度・周回・勝率の計測ではない。束縛のみ開始状態として付与。', results };
writeFileSync(process.argv[2], JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(results));
