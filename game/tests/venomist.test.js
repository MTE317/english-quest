import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../sim/balance.mjs';
import { createNewGame, defaultPartySpecs } from '../js/game-state.js';
import { unlockJob } from '../js/temple.js';
import { changeJob, learnSkill } from '../js/growth.js';
import { createBattle, makeEnemy, resolvePending, setPending } from '../js/battle.js';

test('毒の伝播は倒した敵の状態を引き継ぎ、無効な対象を飛ばして1巡に1回だけ試す', () => {
  const data = loadData();
  const game = createNewGame(data, defaultPartySpecs(data));
  game.storage.materials = { poison_spider_rare: 2, poison_spider_mat: 4 };
  unlockJob(data, game, 'venomist');
  game.jp = 200;
  changeJob(data, game, 0, 'venomist');
  game.party[0].ap.venomist = 18;
  learnSkill(data, game.party[0], 'venomist_spread');
  assert.ok(game.party[0].loadout.passives.includes('venomist_spread'));

  const enemies = Array.from({ length: 5 }, () => makeEnemy(data, 'slime', { lv: 1 }));
  for (const i of [0, 1]) {
    enemies[i].hp = 1;
    enemies[i].statuses.toxic = { turns: 2, n: 1 };
  }
  enemies[2].statusAffinity = { toxic: '×' };
  for (const index of [3, 4]) enemies[index].statusAffinity = { toxic: '★' };
  const battle = createBattle(data, game, { enemies, seed: 1 });
  battle.round = 1;
  const kill = target => {
    battle.turn = { side: 'ally', i: 0 };
    setPending(battle, { type: 'attack', target }, {});
    resolvePending(data, game, battle, true);
    assert.equal(enemies[target].hp, 0);
  };
  kill(0);
  assert.equal(battle.allies[0].poisonSpreadRound, 1);
  assert.equal(enemies[2].statuses.toxic, undefined);
  assert.equal(enemies[3].statuses.toxic?.actor, 0);
  kill(1);
  assert.equal(enemies[4].statuses.toxic, undefined);
});
