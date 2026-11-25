import test from 'node:test';
import assert from 'node:assert/strict';
import { realGameData } from './helpers.js';
import { createNewGame, defaultPartySpecs } from '../js/game-state.js';
import { allyStatusSusceptibilities, susceptibilityGrade } from '../js/status-susceptibility.js';
const data = realGameData();
const fresh = () => createNewGame(data, defaultPartySpecs(data));
test('記号の境界：通常・25%軽減・完全無効・弱点', () => {
  for (const [value, symbol] of [[1.5,'▲'],[1,'○'],[.751,'○'],[.75,'◎'],[.001,'◎'],[0,'★']])
    assert.equal(susceptibilityGrade(value).symbol, symbol);
});
test('全状態異常を表示し、100%耐性だけを完全ガードにする', () => {
  const game = fresh();
  assert.equal(allyStatusSusceptibilities(data, game, 0).length, data.statusEffects.size);
  game.party[0].room = {sres:.5};
  assert.ok(allyStatusSusceptibilities(data, game, 0).every(row => row.symbol === '◎'));
  game.party[0].room = {sres:1};
  assert.ok(allyStatusSusceptibilities(data, game, 0).every(row => row.symbol === '★' && row.multiplier === 0));
});
test('毒無効のパッシブは毒・猛毒だけを完全ガードにする', () => {
  const game = fresh(), member = game.party[0];
  const id = 'test_poison_guard';
  data.skills.set(id, {id,kind:'passive',effect:{mod:{nopoison:1}}});
  member.learned.push(id); member.loadout.passives.push(id);
  const rows = allyStatusSusceptibilities(data, game, 0);
  assert.equal(rows.find(row => row.id === 'poison').symbol, '★');
  assert.equal(rows.find(row => row.id === 'toxic').symbol, '★');
  assert.notEqual(rows.find(row => row.id === 'sleep').symbol, '★');
  data.skills.delete(id);
});
