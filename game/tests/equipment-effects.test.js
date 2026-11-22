import test from 'node:test';
import assert from 'node:assert/strict';
import { effectLabel, describeEffect, describeFixedEffects } from '../js/equipment-effects.js';
import { readCsv } from './helpers.js';

const data = {
  statusEffects: new Map(readCsv('status_effects.csv').rows.map((row) => [row.id, row])),
  elements: new Map(readCsv('elements.csv').rows.map((row) => [row.id, row])),
};

test('新しい装備効果は日本語名と百分率で表示される', () => {
  for (const key of ['VS_STATUS:poison', 'FIRST_HIT', 'NORMAL_SKILL', 'EVA_COUNTER', 'CRIT_MP', 'ATTACK_HEAL', 'OVERHEAL_SHIELD']) {
    const label = effectLabel(data, key);
    assert.notEqual(label, key, key);
    assert.match(label, /[一-龠ぁ-んァ-ヶ]/u, key);
    assert.match(describeEffect(data, key, 12.54), /12\.5%/, key);
    assert.ok(!describeEffect(data, key, 12.54).includes(key), key);
  }
});

test('睡眠・凍結特効は解除前の直接ダメージ判定であることを表示する', () => {
  for (const id of ['sleep', 'freeze']) {
    const text = describeEffect(data, `VS_STATUS:${id}`, 20);
    assert.ok(text.includes(data.statusEffects.get(id).name));
    assert.match(text, /直接ダメージ/);
    assert.match(text, /状態解除前/);
  }
  assert.match(describeEffect(data, 'VS_STATUS:poison', 20), /毒状態への特効 \+20%（直接ダメージ）/);
});

test('行動条件と回復量の基準を装備効果の説明から判別できる', () => {
  assert.match(describeEffect(data, 'FIRST_HIT', 20), /戦闘で最初の攻撃行動/);
  const followup = describeEffect(data, 'NORMAL_SKILL', 20);
  assert.match(followup, /正解して通常攻撃が命中/);
  assert.match(followup, /次の行動が攻撃技能/);
  assert.match(followup, /他の行動で解除/);
  const counter = describeEffect(data, 'EVA_COUNTER', 20);
  assert.match(counter, /物理攻撃を回避/);
  assert.match(counter, /一巡に一回/);
  const mp = describeEffect(data, 'CRIT_MP', 5);
  assert.match(mp, /最大MPの5%/);
  assert.match(mp, /会心が命中/);
  assert.match(mp, /一行動に一回/);
  assert.match(mp, /技能は支払MPまで/);
  const heal = describeEffect(data, 'ATTACK_HEAL', 8);
  assert.match(heal, /実ダメージの8%/);
  assert.match(heal, /正解時、最も傷ついた生存中の味方一人/);
  assert.match(heal, /一行動に一回/);
  const barrier = describeEffect(data, 'OVERHEAL_SHIELD', 30);
  assert.match(barrier, /余剰回復量の30%/);
  assert.match(barrier, /正解した回復魔法/);
  assert.match(barrier, /付与巡と続く2巡/);
  assert.match(barrier, /最大HP20%/);
  assert.match(barrier, /重ねても加算しない/);
});

test('既存の固定値・百分率・属性追加の表示を維持し、新効果も固定効果に含める', () => {
  assert.equal(describeEffect(data, 'STR', 12.54), 'STR +12.5');
  assert.equal(describeEffect(data, 'CRT', 12.54), '会心率 +12.5%');
  const fire = data.elements.get('fire').name;
  assert.equal(describeEffect(data, 'ELEMENT:fire', 1), `${fire}属性追加`);
  assert.equal(describeEffect(data, 'ELEM_RES:fire', 15), `${fire}耐性 +15%`);
  const fixed = describeFixedEffects(data, { fixedEffects: { FIRST_HIT: 20, 'VS_STATUS:freeze': 15 } });
  assert.match(fixed, /初撃ダメージ \+20%/);
  assert.match(fixed, /凍結状態への特効 \+15%/);
});
