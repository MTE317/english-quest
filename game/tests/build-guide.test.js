import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGameData, GAME_FILES } from '../js/gamedata.js';
import { visibleBuildGuides, enchantExamples } from '../js/ui/build-guide.js';
import { enchantFamilies } from '../js/workshop.js';
import { GROWTH_FORMULAS } from '../js/growth.js';
import { readCsv, readJson } from './helpers.js';

const data = buildGameData(Object.fromEntries(Object.entries(GAME_FILES).map(([key, name]) =>
  [key, name.endsWith('.json') ? readJson(name) : readCsv(name).rows])));
const catalog = readJson('build_guides.json');

test('8系統の手引きが、所有装備や解放状態を問わず公開ジョブの実在データを参照する', () => {
  assert.equal(catalog.guides.length, 8);
  assert.equal(visibleBuildGuides(data, catalog).length, 8);
  assert.equal(new Set(catalog.guides.map((guide) => guide.id)).size, 8);
  for (const guide of catalog.guides) {
    for (const key of ['name', 'role', 'stage', 'goal', 'starter']) assert.ok(guide[key]?.trim(), `${guide.id}.${key}`);
    for (const key of ['focus', 'steps', 'weaknesses']) assert.ok(guide[key].length >= 2, `${guide.id}.${key}`);
    for (const id of [...guide.jobs, ...guide.party.map((entry) => entry.job)]) {
      assert.ok(['base', 'mid'].includes(data.jobsById.get(id)?.tier), `${guide.id}: ${id}`);
    }
    assert.equal(guide.party.length, 4, guide.id);
    for (const id of guide.weapons) {
      assert.ok(data.weaponTypes.has(id), `${guide.id}: ${id}`);
      assert.ok(guide.jobs.some((job) => ['S', 'A', 'B', 'C', 'D'].includes(data.jobWeaponApt.get(job)?.[id])), `${guide.id}: 装備可能な主役が必要 ${id}`);
    }
    for (const entry of guide.recipes) {
      const def = data.equipment.get(entry.id);
      assert.equal(def?.source, '専用制作', `${guide.id}: ${entry.id}`);
      assert.ok(data.recipes.some((recipe) => recipe.id === entry.id));
      if (def.slot === 'weapon') assert.ok(guide.weapons.includes(def.kind), `${guide.id}: ${def.kind}`);
    }
  }
});

test('手引きの技能候補は実在し、基本の装備枠内に収まり、奥義の持ち出しを要求しない', () => {
  for (const guide of catalog.guides) {
    let action = 0; let passive = 0;
    for (const entry of guide.skills) {
      const skill = data.skills.get(entry.id);
      assert.ok(skill, `${guide.id}: ${entry.id}`);
      assert.ok(['base', 'mid'].includes(data.jobsById.get(skill.job)?.tier));
      if (skill.isFinal) assert.ok(guide.jobs.includes(skill.job), `${guide.id}: 奥義 ${skill.id}`);
      if (skill.kind === 'passive') passive += skill.cost;
      else action += skill.cost;
    }
    assert.ok(action <= GROWTH_FORMULAS.action_capacity, `${guide.id}: 通常枠 ${action}`);
    assert.ok(passive <= GROWTH_FORMULAS.passive_capacity, `${guide.id}: パッシブ枠 ${passive}`);
  }
});

test('各エンチャント例は、紹介する制作装備へ実際の素材を使って付与できる', () => {
  for (const guide of catalog.guides) for (const entry of guide.enchants) {
    const def = data.equipment.get(entry.recipe);
    assert.ok(data.recipes.some((recipe) => recipe.id === entry.recipe), entry.recipe);
    const materials = enchantExamples(data, entry);
    assert.ok(materials.length > 0, `${guide.id}: ${entry.family}`);
    for (const material of materials) {
      assert.ok(data.materials.has(material.id));
      assert.ok(enchantFamilies(data, def, material).includes(entry.family), `${entry.recipe}: ${material.id} → ${entry.family}`);
    }
  }
});

test('別管理の上級ジョブは、技能だけに含まれる案でも手引きに出さない', () => {
  const hidden = { ...data, jobsById: new Map(data.jobsById), skills: new Map(data.skills) };
  hidden.jobsById.set('secret_test', { id: 'secret_test', tier: 'advanced', name: '非公開' });
  hidden.skills.set('secret_skill_test', { id: 'secret_skill_test', job: 'secret_test' });
  const base = catalog.guides[0];
  const withHidden = { guides: [base,
    { ...base, id: 'hidden_job', jobs: ['secret_test'] },
    { ...base, id: 'hidden_skill', skills: [{ id: 'secret_skill_test' }] },
    { ...base, id: 'hidden_party', party: [{ job: 'secret_test' }] },
    { ...base, id: 'missing_job', jobs: ['not_loaded'] },
  ] };
  assert.deepEqual(visibleBuildGuides(hidden, withHidden).map((guide) => guide.id), [base.id]);
  assert.deepEqual(enchantExamples(data, { recipe: 'not_loaded', family: 'DOT_POWER' }), []);
});
