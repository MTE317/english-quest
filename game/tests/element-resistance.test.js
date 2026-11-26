import test from 'node:test';
import assert from 'node:assert/strict';
import { realGameData } from './helpers.js';
import { createNewGame, defaultPartySpecs } from '../js/game-state.js';
import { createBattle, allyElementMultiplier } from '../js/battle.js';
import { allyElementResistances, elementResistanceGrade } from '../js/element-resistance.js';

const data = realGameData();
const fresh = () => createNewGame(data, defaultPartySpecs(data));
const rowFor = (game, id) => allyElementResistances(data, game, 0).find(row => row.id === id);

test('属性耐性の記号は弱点・標準・小さな耐性・無効を区別する', () => {
  for (const [value, symbol] of [[1.5, '▲'], [1, '○'], [.99, '◎'], [.2, '◎'], [0, '★']])
    assert.equal(elementResistanceGrade(value).symbol, symbol);
});

test('物理3種類・魔法9属性を表示し、装備なしでは標準になる', () => {
  const rows = allyElementResistances(data, fresh(), 0);
  assert.equal(rows.length, data.elements.size);
  assert.equal(rows.filter(row => row.category === '物理').length, 3);
  assert.equal(rows.filter(row => row.category === '魔法').length, 9);
  assert.ok(rows.every(row => row.symbol === '○' && row.multiplier === 1));
});

test('装備・エンチャントの属性耐性を個別に反映し、取り外すと標準に戻る', () => {
  const game = fresh(), member = game.party[0];
  member.equip.accessory1 = { enh: 0, affixes: { 'ELEM_RES:fire': 20, 'ELEM_RES:slash': 10 },
    enchants: [{ stat: 'ELEM_RES:ice', value: 35 }] };
  assert.equal(rowFor(game, 'fire').multiplier, .8);
  assert.equal(rowFor(game, 'fire').symbol, '◎');
  assert.equal(rowFor(game, 'slash').multiplier, .9);
  assert.equal(rowFor(game, 'ice').multiplier, .65);
  assert.equal(rowFor(game, 'water').symbol, '○');
  member.equip.accessory1 = null;
  assert.equal(rowFor(game, 'fire').symbol, '○');
});

test('戦闘と同じ耐性上限を反映し、上限80%を完全無効と表示しない', () => {
  const game = fresh();
  game.party[0].equip.accessory1 = { enh: 0, affixes: { 'ELEM_RES:fire': 100 } };
  const row = rowFor(game, 'fire');
  assert.ok(Math.abs(row.multiplier - .2) < 1e-12);
  assert.equal(row.symbol, '◎');
  const battle = createBattle(data, game, { enemies: [], seed: 1 });
  assert.equal(row.multiplier, allyElementMultiplier(data, game, battle, 0, 'fire', true));
});

test('常時支援は行動可能な仲間の分だけを反映し、一時的な戦闘バフは通常表示に含めない', () => {
  const game = fresh(), supporter = game.party[1];
  const id = 'test_element_aura';
  data.skills.set(id, { id, kind: 'passive', effect: { mod: { party_eres: .1, party_ecut: .05 } } });
  try {
    supporter.learned.push(id); supporter.loadout.passives.push(id);
    assert.ok(Math.abs(rowFor(game, 'fire').multiplier - .85) < 1e-12);
    const battle = createBattle(data, game, { enemies: [], seed: 1 });
    battle.partyBuffs['eres:fire'] = [.2, 3];
    assert.ok(Math.abs(allyElementMultiplier(data, game, battle, 0, 'fire', true) - .65) < 1e-12);
    assert.ok(Math.abs(rowFor(game, 'fire').multiplier - .85) < 1e-12);
    supporter.hp = 0;
    assert.equal(rowFor(game, 'fire').symbol, '○');
    supporter.hp = 10; supporter.persist = ['petrify'];
    assert.equal(rowFor(game, 'fire').symbol, '○');
  } finally { data.skills.delete(id); }
});
