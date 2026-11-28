import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewGame, defaultPartySpecs } from '../js/game-state.js';
import { makeGear, equipRecommended, canEquip, SLOTS, computeStats } from '../js/character.js';
import { realGameData } from './helpers.js';

const data = realGameData();
function setup(job = 'warrior') {
  const game = createNewGame(data, defaultPartySpecs(data));
  const member = game.party[0];
  member.job = job;
  member.equip = Object.fromEntries(SLOTS.map(slot => [slot, null]));
  member.loadout = { actions: [], passives: [], ultimate: null };
  game.storage.gear = [];
  const add = (id, opts) => { const gear = makeGear(game, id, opts); game.storage.gear.push(gear); return gear; };
  return { game, member, add };
}

test('魔法職は高い★の物理武器より術装備を選ぶ', () => {
  const { game, member, add } = setup('black_mage');
  add('gun_t3');
  const tome = add('tome_t1');
  equipRecommended(data, game, member);
  assert.equal(member.equip.weapon.uid, tome.uid);
});

test('適性込みの性能で防具を選ぶ', () => {
  const { game, member, add } = setup('black_mage');
  add('heavy_body_t1');
  const light = add('light_body_t1');
  equipRecommended(data, game, member);
  assert.equal(member.equip.body.uid, light.uid);
});

test('低い★でも強化後の実性能が勝れば選ぶ', () => {
  const { game, member, add } = setup();
  const enhanced = add('sword_t3', { enh: 10 });
  add('sword_t4');
  equipRecommended(data, game, member);
  assert.equal(member.equip.weapon.uid, enhanced.uid);
});

test('セット済み武器限定スキルを使用不能にしない', () => {
  const { game, member, add } = setup('hunter');
  const bow = makeGear(game, 'bow_t1');
  member.equip.weapon = bow;
  const skill = [...data.skills.values()].find(s => s.effect?.weapons?.length === 1 && s.effect.weapons[0] === 'bow');
  assert.ok(skill);
  member.learned = [skill.id];
  member.loadout.actions = [skill.id];
  add('gun_t3', { enh: 100 });
  equipRecommended(data, game, member);
  assert.equal(member.equip.weapon.uid, bow.uid);
});

test('固定サブ武器を外す両手武器への交換を防ぐ・空欄も固定できる', () => {
  const { game, member, add } = setup();
  member.equip.weapon = makeGear(game, 'sword_t1');
  member.equip.offhand = makeGear(game, 'sword_t1');
  const off = member.equip.offhand;
  member.equipmentLocks = { offhand: true, body: true };
  add('greatsword_t3', { enh: 100 });
  add('heavy_body_t3');
  equipRecommended(data, game, member);
  assert.equal(member.equip.offhand.uid, off.uid);
  assert.equal(member.equip.body, null);
  assert.equal(canEquip(data, member, 'offhand', off).ok, true);
});

test('役割に合ったエンチャントを比較する', () => {
  const { game, member, add } = setup('white_mage');
  add('staff_t1');
  const healer = add('staff_t1');
  healer.enchants = [{ stat: 'HEAL_POWER', value: 20 }];
  equipRecommended(data, game, member);
  assert.equal(member.equip.weapon.uid, healer.uid);
});

test('アクセサリーの入れ替えはHPを途中で減らさず所有数も維持する', () => {
  const { game, member, add } = setup();
  const id = [...data.equipment.values()].find(e => e.slot === 'accessory').id;
  member.equip.accessory1 = makeGear(game, id, { affixes: { HP: 100 } });
  const better = add(id, { affixes: { HP: 120 } });
  member.hp = computeStats(data, member).hp;
  const hp = member.hp;
  const otherBefore = JSON.stringify(game.party.slice(1));
  equipRecommended(data, game, member);
  assert.equal(member.hp, hp);
  assert.ok(Object.values(member.equip).some(g => g?.uid === better.uid));
  const all = [...game.storage.gear, ...Object.values(member.equip).filter(Boolean)];
  assert.equal(all.length, 2);
  assert.equal(new Set(all.map(g => g.uid)).size, 2);
  assert.equal(JSON.stringify(game.party.slice(1)), otherBefore);
  assert.equal(equipRecommended(data, game, member), 0);
});

test('同点なら現在装備を維持し、固定枠はJSON保存後も有効', () => {
  const { game, member, add } = setup();
  member.equip.weapon = makeGear(game, 'greatsword_t1');
  const current = member.equip.weapon.uid;
  add('greatsword_t1');
  assert.equal(equipRecommended(data, game, member), 0);
  assert.equal(member.equip.weapon.uid, current);
  member.equipmentLocks = { weapon: true };
  add('greatsword_t3');
  const restored = JSON.parse(JSON.stringify(game));
  equipRecommended(data, restored, restored.party[0]);
  assert.equal(restored.party[0].equip.weapon.uid, current);
});
