import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SKILL_ICON_IDS, PHYSICAL_SKILL_ELEMENTS, MAGIC_SKILL_ELEMENTS, skillIconInfo } from '../js/ui/skill-icons.js';
import { realGameData } from './helpers.js';
import { effectiveSkill } from '../js/growth.js';

const data = realGameData();
const memberWith = (kind, extra = {}) => {
  const def = [...data.equipment.values()].find(item => item.slot === 'weapon' && item.kind === kind);
  assert.ok(def, kind);
  return { equip: { weapon: { id: def.id, ...extra } }, learned: [], skillLevels: {} };
};

test('26種類の素材を共用し、すべて実体が32×32pxのPNGである', () => {
  assert.equal(SKILL_ICON_IDS.length, 26);
  assert.equal(new Set(SKILL_ICON_IDS).size, 26);
  for (const id of SKILL_ICON_IDS) {
    const png = readFileSync(new URL(`../art/skills/${id}.png`, import.meta.url));
    assert.equal(png.subarray(1, 4).toString(), 'PNG', id);
    assert.equal(png.readUInt32BE(16), 32, id);
    assert.equal(png.readUInt32BE(20), 32, id);
  }
});

test('パッシブと奥義は主効果や属性を問わずそれぞれ専用の共通アイコンになる', () => {
  for (const kind of ['attack', 'heal_all', 'party_buff', 'passive']) {
    assert.equal(skillIconInfo(data, { kind, isFinal: true, elements: ['fire'] }).id, 'ultimate');
  }
  assert.equal(skillIconInfo(data, { kind: 'passive', effect: { base: 'mag' } }).id, 'passive');
  assert.equal(skillIconInfo(data, { kind: 'common' }).id, 'passive');
  for (const kind of ['heal', 'heal_all', 'revive', 'cure', 'cure_all', 'mp_give']) assert.equal(skillIconInfo(data, { kind }).id, 'healing');
  for (const kind of ['self_buff', 'party_buff', 'ally_buff', 'imbue']) assert.equal(skillIconInfo(data, { kind }).id, 'support');
  for (const kind of ['status', 'debuff', 'utility']) assert.equal(skillIconInfo(data, { kind }).id, 'hindrance');
});

test('物理と魔法を分け、固定属性・無属性・複合属性を表示できる', () => {
  for (const id of [...PHYSICAL_SKILL_ELEMENTS, ...MAGIC_SKILL_ELEMENTS]) {
    assert.equal(skillIconInfo(data, { kind: 'attack', effect: { base: 'phys', element: id } }).id, `physical-${id}`);
  }
  for (const id of MAGIC_SKILL_ELEMENTS) {
    assert.equal(skillIconInfo(data, { kind: 'attack', effect: { base: 'mag' }, elements: [id] }).id, `magic-${id}`);
  }
  assert.equal(skillIconInfo(data, { kind: 'attack', effect: { base: 'mag' } }).id, 'magic-none');
  const composite = skillIconInfo(data, { kind: 'attack', effect: { base: 'mag' }, elements: ['ice', 'water'] });
  assert.equal(composite.id, 'magic-ice');
  assert.ok(composite.label.includes('氷／水'));
});

test('武器依存は装備武器と攻撃計算に従い、固定属性物理を魔法と取り違えない', () => {
  const weaponSkill = { kind: 'attack', elements: ['fire'], effect: { base: 'weapon' } };
  for (const [weapon, expected] of [['sword','physical-slash'], ['hammer','physical-blunt'], ['spear','physical-pierce'], ['staff','magic-none'], ['fan','magic-wind']]) {
    assert.equal(skillIconInfo(data, weaponSkill, memberWith(weapon)).id, expected);
  }
  assert.equal(skillIconInfo(data, weaponSkill, { equip: {} }).id, 'physical-blunt');
  const fixed = { ...weaponSkill, effect: { base: 'weapon', element: 'light' } };
  assert.equal(skillIconInfo(data, fixed, memberWith('sword')).id, 'physical-light');
  const skill = data.skills.get('hunter_A01');
  assert.equal(skillIconInfo(data, skill, { equip: {} }).id, 'physical-pierce', '武器未装備でも対応武器で予告する');
  assert.equal(skillIconInfo(data, data.skills.get('paladin_A01'), memberWith('sword')).id, 'physical-light');
  assert.equal(skillIconInfo(data, data.skills.get('dark_knight_A03'), memberWith('sword')).id, 'physical-dark');
  assert.equal(skillIconInfo(data, data.skills.get('black_mage_A01'), memberWith('sword')).id, 'magic-fire');
  assert.equal(skillIconInfo(data, data.skills.get('black_mage_U01'), memberWith('sword')).id, 'ultimate');
});

test('全技能・全習得Lvが有効な画像へ対応し、キャラの技能や装備を変更しない', () => {
  const member = memberWith('sword');
  const before = structuredClone(member);
  for (const skill of data.skills.values()) {
    for (let level = 1; level <= (skill.effect?.levels?.length ?? 0) + 1; level++) {
      const preview = { ...member, learned: [skill.id], skillLevels: { [skill.id]: level } };
      assert.ok(SKILL_ICON_IDS.includes(skillIconInfo(data, effectiveSkill(data, preview, skill), preview).id), `${skill.id} Lv${level}`);
    }
  }
  assert.deepEqual(member, before);
});
