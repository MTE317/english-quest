import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { realGameData } from './helpers.js';
import { createMember, canEquip, makeGear, computeStats, maxMp, spellPower, weaponPower, SLOTS } from '../js/character.js';

const data = realGameData();
const make = (job = 'warrior') => createMember(data, { nextUid: 1 }, { name: '検証', job, icon: 'human_01' }, 0);
const baseline = readFileSync(new URL('../../docs/jobs-baseline-v1.md', import.meta.url), 'utf8').split('\n')
  .filter(line => /^\| \d+ \|/.test(line)).map(line => line.split('|').slice(1, -1).map(cell => cell.trim()));
const weaponNames = new Map([...data.weaponTypes.values()].map(type => [type.id, type.name]));

test('職業マスターは設計基準表の50職・基本8/追加36/伝説6に一致する', () => {
  assert.equal(data.jobs.length, 50);
  assert.equal(new Set(data.jobs.map(job => job.id)).size, 50);
  assert.deepEqual(data.jobs.map(job => job.name), baseline.map(row => row[2]));
  assert.deepEqual(['base', 'additional', 'legendary'].map(tier => data.jobs.filter(job => job.tier === tier).length), [8,36,6]);
  for (const job of data.jobs) {
    assert.equal(job.skillsReady, job.tier === 'base' || ['paladin','dark_knight','berserker','samurai','gladiator','warrior_monk','ascetic','executioner','ninja'].includes(job.id), job.name);
    assert.equal(Object.keys(job.grades).length, 8, job.name);
    assert.ok(job.statReference && job.style && job.ultimateConcept, job.name);
    for (const element of [...job.elements, ...job.supportElements]) assert.ok(data.elements.has(element), `${job.name}: ${element}`);
  }
});

test('全職のS/A武器を設計表に合わせ、他武器もB〜Dで装備できる', () => {
  for (const [index, job] of data.jobs.entries()) {
    const row = baseline[index];
    assert.equal(job.sWeapons.map(id => weaponNames.get(id)).join('・'), row[4]);
    assert.equal(job.aWeapons.map(id => weaponNames.get(id)).join('・'), row[5]);
    const member = make(job.id);
    const apt = data.jobWeaponApt.get(job.id);
    for (const weapon of data.weaponTypes.values()) {
      const expected = job.sWeapons.includes(weapon.id) ? 'S' : job.aWeapons.includes(weapon.id) ? 'A' : null;
      if (expected) assert.equal(apt[weapon.id], expected, `${job.name}/${weapon.name}`);
      else assert.ok(['B','C','D'].includes(apt[weapon.id]), `${job.name}/${weapon.name}`);
      const def = [...data.equipment.values()].find(gear => gear.slot === 'weapon' && gear.kind === weapon.id);
      assert.ok(def, weapon.name);
      assert.equal(canEquip(data, member, 'weapon', makeGear({ nextUid: 1 }, def.id)).ok, true, `${job.name}/${weapon.name}`);
    }
  }
});

test('新規キャラは無装備・技能未修得・共通APを持ち、全職の能力を計算できる', () => {
  for (const job of data.jobs) {
    const member = make(job.id);
    assert.deepEqual(Object.keys(member.equip), SLOTS);
    assert.ok(Object.values(member.equip).every(gear => gear === null));
    assert.deepEqual(member.learned, []);
    assert.equal(member.ap, data.basicJobRules.starting_ap);
    const stats = computeStats(data, member);
    for (const value of Object.values(stats)) assert.ok(Number.isFinite(value), job.name);
    assert.equal(member.hp, stats.hp);
    assert.equal(member.mp, stats.mp);
  }
});

test('MP適性はMAGと独立し、レベルと現職から再計算する', () => {
  const isolated = structuredClone(data);
  const member = make('black_mage');
  member.lv = 12;
  const job = isolated.jobsById.get(member.job);
  const beforeMp = maxMp(isolated, member);
  const beforeMag = computeStats(isolated, member).mag;
  job.grades.mp = 'D';
  assert.ok(maxMp(isolated, member) < beforeMp);
  assert.equal(computeStats(isolated, member).mag, beforeMag);
  job.grades.mp = 'A';
  job.grades.mag = 'D';
  assert.equal(maxMp(isolated, member), beforeMp);
  assert.ok(computeStats(isolated, member).mag < beforeMag);
});

test('魔法装備補助は装備Lv・適性を反映し、銃の物理威力を転用しない', () => {
  const member = make('black_mage');
  const equipment = kind => [...data.equipment.values()].filter(def => def.slot === 'weapon' && def.kind === kind && !def.unique && !def.recipeId).sort((a,b) => a.itemLv-b.itemLv);
  const guns = equipment('gun');
  const tomes = equipment('tome');
  member.equip.weapon = makeGear({ nextUid: 1 }, guns.at(-1).id);
  assert.ok(weaponPower(data, member, member.equip.weapon) > 0);
  assert.equal(spellPower(data, member), 0);
  member.equip.weapon = makeGear({ nextUid: 1 }, tomes[0].id);
  const low = spellPower(data, member);
  assert.ok(low > 0);
  member.equip.weapon = makeGear({ nextUid: 1 }, tomes.at(-1).id);
  assert.ok(spellPower(data, member) > low);
});

test('楽器の共通性能に吟遊詩人専用の常時ボーナスを持たせない', () => {
  const instrument = data.weaponTypes.get('instrument');
  assert.deepEqual(instrument.elements, ['none']);
  assert.equal(instrument.traits.song_bonus, undefined);
  assert.ok(data.jobMastery.every(row => !row.bonus));
});
