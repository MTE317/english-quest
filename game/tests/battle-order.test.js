import test from 'node:test';
import assert from 'node:assert/strict';
import { battleStats, createBattle, finishBattle, makeEnemy, nextTurn, prepareQuizAction, resolvePending, setPending } from '../js/battle.js';
import { maxHp, maxMp } from '../js/character.js';
import { equippedGame } from './combat-fixtures.js';
import { GameSession } from '../js/save.js';
import { MemoryStorage, realGameData } from './helpers.js';

function encounter() {
  const data = realGameData();
  const game = equippedGame(data, ['warrior', 'knight', 'black_mage', 'white_mage', 'thief', 'bard']
    .map((job) => ({ name: job, job, icon: 'x' })));
  const enemy = { ...makeEnemy(data, 'goblin', { lv: 1 }), hp: 10000, spd: 0, status: null };
  const battle = createBattle(data, game, { enemies: [enemy], seed: 7 });
  battle.round = 1;
  battle.queue = game.party.map((_, i) => ({ side: 'ally', i }));
  return { data, game, battle, enemy };
}

const status = (turns, n = 1) => ({ turns, n });

function attack(data, game, battle) {
  assert.ok(prepareQuizAction(data, game, battle));
  setPending(battle, { type: 'attack', target: 0 }, { wordId: 'test' });
  resolvePending(data, game, battle, true);
}

test('B1 同じラウンドの順序を固定し、行動終了まで最後の1ターンを適用する', () => {
  const { data, game, battle, enemy } = encounter();
  const before = enemy.hp;
  battle.allies[0].statuses.blind = status(1);
  data.statusEffects.get('blind').value = 1;
  assert.equal(nextTurn(data, game, battle).i, 0);
  assert.equal(battle.allies[0].statuses.blind.turns, 1);
  attack(data, game, battle);
  assert.equal(enemy.hp, before);
  assert.equal(battle.allies[0].statuses.blind, undefined);
  battle.partyBuffs.spd = [10, 2];
  const acted = [0];
  for (let i = 1; i < 6; i++) {
    acted.push(nextTurn(data, game, battle).i);
    attack(data, game, battle);
  }
  assert.deepEqual(acted, [0, 1, 2, 3, 4, 5]);
});

test('B1 ラウンド開始時のSPD順を、途中でSPDが変わっても保持する', () => {
  const { data, game, battle } = encounter();
  data.balance.battle_formulas.turn_rand = [1, 1];
  battle.round = 0;
  battle.queue = [];
  const order = game.party.map((_, i) => ({ i, spd: battleStats(data, game, battle, i).spd }))
    .sort((a, b) => b.spd - a.spd).map(({ i }) => i);
  assert.equal(nextTurn(data, game, battle).i, order[0]);
  battle.allies[order.at(-1)].buffs.spd = [1, 2];
  for (const i of order) {
    assert.equal(nextTurn(data, game, battle).i, i);
    attack(data, game, battle);
  }
});

test('B1 毒、MP減少、自動再生を行動不能より先に処理し、HP0は回復しない', () => {
  const { data, game, battle } = encounter();
  const [first, second] = game.party;
  first.hp = 1;
  second.hp = 50;
  const hp = maxHp(data, second);
  const mp = maxMp(data, second);
  second.mp = Math.floor(mp * 0.10);
  data.statusEffects.set('mana_leak', { kind: 'mp_drain', name: '魔力漏出', value: 0.25 });
  battle.partyBuffs.regen = [0.10, 2];
  battle.partyBuffs.mp_regen = [0.25, 2];
  battle.allies[0].statuses.poison = status(2);
  battle.allies[1].statuses = { poison: status(2), sleep: status(1), mana_leak: status(2), bleed: status(2) };
  assert.equal(nextTurn(data, game, battle).i, 2);
  assert.equal(first.hp, 0);
  assert.equal(second.hp, Math.min(hp, Math.round(50 - Math.max(1, Math.round(hp * 0.05)) + hp * 0.10)));
  assert.equal(second.mp, Math.round(mp * 0.25));
  assert.equal(battle.allies[1].statuses.bleed.turns, 1);
  assert.equal(battle.allies[1].statuses.sleep, undefined);
});

test('B1 混乱・魅了・スタンと致死出血は出題せず、混乱不発ならコマンドへ進む', () => {
  const { data, game, battle } = encounter();
  data.statusEffects.get('confusion').value = 1;
  battle.allies[0].statuses = { confusion: status(1), bleed: status(2) };
  battle.allies[1].statuses.charm = status(1);
  battle.allies[2].statuses.stun = status(4);
  battle.allies[3].statuses.bleed = status(1);
  game.party[3].hp = 1;
  assert.equal(nextTurn(data, game, battle).i, 3);
  assert.equal(battle.allies[0].statuses.bleed.turns, 1);
  assert.equal(battle.allies[1].statuses.charm, undefined);
  assert.equal(battle.allies[2].statuses.stun, undefined);
  assert.equal(prepareQuizAction(data, game, battle), false);
  assert.equal(game.party[3].hp, 0);
  assert.equal(battle.pending, null);
  assert.equal(battle.learningRewards, undefined);
  assert.ok(battle.log.some((line) => line.includes('混乱で攻撃')));
  assert.ok(battle.log.some((line) => line.includes('魅了で攻撃')));
  data.statusEffects.get('confusion').value = 0;
  battle.allies[4].statuses.confusion = status(1);
  assert.equal(nextTurn(data, game, battle).i, 4);
  attack(data, game, battle);
});

test('B1 死の宣告はラウンド末、石化はターンを消費しない', () => {
  const { data, game, battle, enemy } = encounter();
  enemy.statuses.doom = status(1);
  battle.allies[0].statuses.petrify = status(1);
  battle.allies[1].statuses.doom = status(1);
  assert.equal(nextTurn(data, game, battle).i, 1);
  attack(data, game, battle);
  assert.equal(battle.allies[1].statuses.doom.turns, 1);
  assert.equal(battle.allies[0].statuses.petrify.turns, 1);
  for (let i = 2; i < 6; i++) {
    assert.equal(nextTurn(data, game, battle).i, i);
    attack(data, game, battle);
  }
  assert.equal(nextTurn(data, game, battle), null);
  assert.equal(game.party[1].hp, 0);
  assert.equal(enemy.hp, 0);
  assert.equal(battle.result, 'win');
});

test('B1 属性無効の命中はHPを減らさず、武器の追加状態異常を判定する', () => {
  const { data, game, battle, enemy } = encounter();
  enemy.immune = ['slash'];
  enemy.statusAffinity.poison = '★'; // 属性無効と状態異常の相性は独立。付与率を100%に固定する。
  data.weaponTypes.get('sword').traits.normal_status = { id: 'poison', chance: 1 };
  data.balance.battle_formulas.status_rate_cap = 1;
  const before = enemy.hp;
  nextTurn(data, game, battle);
  attack(data, game, battle);
  assert.equal(enemy.hp, before);
  assert.equal(enemy.statuses.poison.turns, 3);
});

test('B1 旧セーブ混在の6人編成を保存・再開し、全滅で入場時の状態へ戻す', () => {
  const { data, game, battle } = encounter();
  const member = game.party[0];
  member.persist = ['curse'];
  battle.allies[0].statuses = { toxic: status(2, 3), stun: status(1), taunt: status(2) };
  battle.allies[0].buffs.regen = [0.1, 2];
  const mem = new MemoryStorage();
  const session = new GameSession({ storage: mem });
  session.startNew(game);
  session.enterDungeon({ dungeonId: 'mossy_cave' });
  const before = structuredClone(session.run.snapshot.party);
  assert.deepEqual(createBattle(data, session.game, { enemies: [] }).allies[0].statuses.curse, status(99));
  finishBattle(data, session.game, battle);
  session.save();
  const resumed = new GameSession({ storage: mem });
  const next = createBattle(data, resumed.game, { enemies: [] });
  assert.equal(resumed.game.party.length, 6);
  assert.deepEqual(next.allies[0].statuses, { toxic: status(2, 3) });
  assert.deepEqual(next.allies[0].buffs, {});
  assert.equal(resumed.game.party[0].hp, before[0].hp);
  assert.equal(resumed.game.party[0].mp, before[0].mp);
  resumed.wipe();
  assert.deepEqual(new GameSession({ storage: mem }).game.party, before);
});

test('B1 出血処理済みの問題を再開してもHPを二重に減らさない', () => {
  const { data, game, battle } = encounter();
  const member = game.party[0];
  const before = member.hp;
  battle.allies[0].statuses.bleed = status(1);
  assert.equal(nextTurn(data, game, battle).i, 0);
  assert.equal(prepareQuizAction(data, game, battle), true);
  assert.equal(member.hp, before - Math.round(maxHp(data, member) * 0.07));
  setPending(battle, { type: 'attack', target: 0 }, { wordId: 'test' });
  const mem = new MemoryStorage();
  const session = new GameSession({ storage: mem });
  session.startNew(game);
  session.enterDungeon({ dungeonId: 'mossy_cave' });
  session.setBattle(battle);
  const resumed = new GameSession({ storage: mem });
  const restored = resumed.run.battle;
  resolvePending(data, resumed.game, restored, true);
  assert.equal(resumed.game.party[0].hp, member.hp);
  assert.equal(restored.allies[0].statuses.bleed, undefined);
});

test('B1 敵の行動不能中は出血せず、次の行動機会に出血で倒れれば攻撃しない', () => {
  const { data, game, battle, enemy } = encounter();
  const before = game.party.map((m) => m.hp);
  enemy.hp = 1;
  enemy.statuses = { sleep: status(1), bleed: status(2) };
  battle.queue.unshift({ side: 'enemy', i: 0 });
  assert.equal(nextTurn(data, game, battle).i, 0);
  assert.equal(enemy.hp, 1);
  assert.equal(enemy.statuses.bleed.turns, 1);
  battle.turn = null;
  battle.queue.unshift({ side: 'enemy', i: 0 });
  assert.equal(nextTurn(data, game, battle), null);
  assert.equal(battle.result, 'win');
  assert.deepEqual(game.party.map((m) => m.hp), before);
});

