import test from 'node:test';
import assert from 'node:assert/strict';
import { realGameData } from './helpers.js';
import { createNewGame } from '../js/game-state.js';
import { createStatusDebugSession, applyPartyDebugStatus } from '../js/debug-status.js';
import { nextTurn } from '../js/battle.js';
import { maxHp, maxMp } from '../js/character.js';
import { LearningStore } from '../js/storage.js';

const data = realGameData();
const party = ['warrior', 'knight', 'black_mage', 'white_mage', 'thief', 'bard']
  .map((job, i) => ({ name: `テスト${i + 1}`, job, icon: 'x' }));
const create = () => createNewGame(data, party);
const options = statusId => ({ dungeonId: 'mossy_cave', stoneId: '00', statusId });

for (const status of data.statusEffects.values()) test(`${status.name}を6人全員に正規の残りターンで付与する`, () => {
  const source = create();
  const session = createStatusDebugSession(data, source, options(status.id));
  assert.equal(session.run.battle.allies.length, 6);
  for (const [i, member] of session.game.party.entries()) {
    assert.equal(member.hp, maxHp(data, member));
    assert.equal(member.mp, maxMp(data, member));
    assert.deepEqual(session.run.battle.allies[i].statuses, { [status.id]: { turns: status.turns, n: 1 } });
  }
});

test('テストの戦闘進行・学習記録・再保存は元データやブラウザー保存に書き込まない', t => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => old ? Object.defineProperty(globalThis, 'localStorage', old) : delete globalThis.localStorage);
  let writes = 0;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => null, setItem() { writes++; }, removeItem() { writes++; },
  } });
  const source = create();
  source.party[0].hp = 0;
  source.party[1].persist = ['curse'];
  source.party[1].persistState = { curse: { turns: 99, n: 1 } };
  const before = structuredClone(source);
  const session = createStatusDebugSession(data, source, options('poison'));
  nextTurn(data, session.game, session.run.battle);
  session.save();
  new LearningStore(session.store.storage).recordAnswer('debug-word', { stability: 1 }, 0, true);
  session.save();
  assert.deepEqual(source, before);
  assert.equal(writes, 0);
  const next = createStatusDebugSession(data, source, options('blind'));
  assert.deepEqual(Object.keys(next.run.battle.allies[1].statuses), ['blind']);
  assert.notEqual(next.game.party[0].hp, 0);
});

test('毒は本物の戦闘処理でHPを減らす', () => {
  const session = createStatusDebugSession(data, create(), options('poison'));
  const battle = session.run.battle;
  battle.round = 1;
  battle.queue = [{ side: 'ally', i: 0 }];
  const before = session.game.party[0].hp;
  nextTurn(data, session.game, battle);
  assert.ok(session.game.party[0].hp < before);
});

test('魔力漏出は本物の戦闘処理でMPを減らす', () => {
  const session = createStatusDebugSession(data, create(), options('weaken'));
  const battle = session.run.battle;
  battle.round = 1;
  battle.queue = [{ side: 'ally', i: 2 }];
  const before = session.game.party[2].mp;
  nextTurn(data, session.game, battle);
  assert.ok(session.game.party[2].mp < before);
});

test('全員石化は本物の戦闘処理で即全滅になる', () => {
  const session = createStatusDebugSession(data, create(), options('petrify'));
  nextTurn(data, session.game, session.run.battle);
  assert.equal(session.run.battle.result, 'lose');
});

test('解除状態で試せ、不明な状態は変更前に拒否する', () => {
  const source = create();
  source.party[0].persist = ['curse'];
  const session = createStatusDebugSession(data, source, options(''));
  assert.deepEqual(session.run.battle.allies[0].statuses, {});
  const before = structuredClone(session.state);
  assert.throws(() => applyPartyDebugStatus(data, session.game, session.run.battle, 'unknown'), /状態異常/);
  assert.deepEqual(session.state, before);
});
