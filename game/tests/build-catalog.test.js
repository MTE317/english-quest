// 旧36/100ビルドの前提を復活させず、新マスターに沿う比較用編成を検証する。
import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_FILES } from '../js/gamedata.js';
import { data, formations, inspectMaster } from '../verification/jobs-master/measure.mjs';
import { BUILD_CATALOG, prepareParty, assertBuildCore } from '../../sim/party-fixtures.mjs';

test('現行マスターは50職・基本8職120技能・全Lvを持つ', () => {
  const result = inspectMaster();
  assert.equal(result.jobs, 50);
  assert.equal(result.skills, 120);
  assert.equal(result.skillLevelDefinitions, 396);
  assert.equal(result.additionalJobs, 36);
  assert.equal(result.legendaryJobs, 6);
});

test('比較用編成は6人で基本8職を網羅し、未実装の追加職を使わない', () => {
  const jobs = new Set();
  assert.equal(formations.length, 3);
  for (const formation of formations) {
    assert.equal(formation.jobs.length, 6);
    assert.ok(formation.jobs.includes('white_mage'));
    for (const id of formation.jobs) {
      jobs.add(id);
      assert.equal(data.jobsById.get(id)?.tier, 'base');
      assert.notEqual(data.jobsById.get(id)?.skillsReady, false);
    }
  }
  assert.equal(jobs.size, 8);
});

test('旧カタログは廃止扱いで、現行ゲームのデータに読み込まれない', () => {
  assert.equal(BUILD_CATALOG.status, 'retired');
  assert.equal(BUILD_CATALOG.supersededBy, 'game/verification/jobs-master/measure.mjs');
  assert.ok(!Object.values(GAME_FILES).includes('build-catalog.json'));
  const dungeon = [...data.dungeons.values()][0];
  assert.throws(() => prepareParty(data, dungeon), /廃止済み.*jobs-master/);
  assert.throws(() => assertBuildCore(data, {}), /廃止済み.*jobs-master/);
});

test('奥義までの最小APは技能10種類と必要なLv前提を含む', () => {
  for (const result of inspectMaster().costs) {
    const minimum = result.minimumUltimate;
    assert.ok(minimum.nonUltimateSkills >= 10);
    let expected = [...data.skills.values()].find(skill => skill.job === result.job && skill.isFinal).apToLearn;
    for (const [id, level] of Object.entries(minimum.requiredLevels)) {
      const skill = data.skills.get(id);
      expected += skill.apToLearn + skill.effect.levels.slice(0, level - 1).reduce((sum, upgrade) => sum + upgrade.ap, 0);
      for (const prerequisite of skill.effect.prerequisites) {
        assert.ok((minimum.requiredLevels[prerequisite.id] ?? 0) >= prerequisite.level);
      }
    }
    assert.equal(minimum.ap, expected);
    assert.ok(result.maxAllAp >= result.learnAllAp && result.learnAllAp >= minimum.ap);
  }
});
