import test from 'node:test';
import assert from 'node:assert/strict';
import { realGameData } from './helpers.js';
import { createNewGame, normalizeGame } from '../js/game-state.js';
import { memberMods, isJobMastered, jobSkills } from '../js/growth.js';
import { computeStats } from '../js/character.js';

const data = realGameData();
const fresh = () => createNewGame(data, ['warrior', 'knight', 'black_mage', 'white_mage', 'thief', 'bard']
  .map((job) => ({ job, name: job, icon: 'x' })));

test('旧マスター達成の記録は装備枠の外から常時能力を加算しない', () => {
  const game = fresh();
  const member = game.party[0];
  const before = { mods: memberMods(data, member), stats: computeStats(data, member) };
  const controlled = { ...data, jobMastery: [{ job: 'warrior', bonus: 'STR+99%' }] };
  member.masteredJobs = ['warrior'];
  assert.deepEqual(memberMods(controlled, member), before.mods);
  assert.deepEqual(computeStats(controlled, member), before.stats);
});

test('技能を追加した旧達成フラグだけでは未修得の新職をマスター扱いしない', () => {
  const game = fresh();
  const member = game.party[0];
  member.masteredJobs = ['warrior'];
  delete member.jobMasterVersion;
  normalizeGame(data, game);
  assert.equal(isJobMastered(data, member, 'warrior'), false);
  member.learned = jobSkills(data, 'warrior').map((skill) => skill.id);
  assert.equal(isJobMastered(data, member, 'warrior'), true);
});

test('新マスターの習得・強化・所持品・現在HPMPは再読込と二重正規化で変化しない', () => {
  const game = fresh();
  const member = game.party[0];
  member.learned = ['warrior_A01', 'warrior_P02'];
  member.skillLevels = { warrior_A01: 3, warrior_P02: 2 };
  member.loadout = { actions: ['warrior_A01'], passives: ['warrior_P02'], ultimate: null };
  member.hp = 7; member.mp = 1; game.party[1].hp = 0;
  normalizeGame(data, game);
  const once = structuredClone(game);
  normalizeGame(data, game);
  assert.deepEqual(game, once);
  assert.equal(member.hp, 7);
  assert.equal(member.mp, 1);
  assert.equal(game.party[1].hp, 0);
  assert.deepEqual(member.skillLevels, { warrior_A01: 3, warrior_P02: 2 });
});
