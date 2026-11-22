import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGameData, GAME_FILES } from '../js/gamedata.js';
import { createNewGame, normalizeGame } from '../js/game-state.js';
import { isJobMastered, jobSkills, learnSkill, memberMods } from '../js/growth.js';
import { computeStats } from '../js/character.js';
import { readCsv, readJson } from './helpers.js';

const data = buildGameData(Object.fromEntries(Object.entries(GAME_FILES).map(([key, name]) =>
  [key, name.endsWith('.json') ? readJson(name) : readCsv(name).rows])));
const added = new Set(data.balance.content_updates.build36_skills);
const oldData = { ...data, skills: new Map([...data.skills].filter(([id]) => !added.has(id))) };
const affected = [...new Set([...added].map((id) => data.skills.get(id).job))];
const fresh = (job = 'monk') => createNewGame(data, [job, 'knight', 'black_mage', 'white_mage']
  .map((id) => ({ job: id, name: id, icon: 'x' })));

function legacy() {
  const game = fresh();
  delete game.contentUpdates;
  for (const member of game.party) delete member.masteredJobs;
  const member = game.party[0];
  member.learned = affected.flatMap((job) => jobSkills(oldData, job).map((skill) => skill.id));
  member.loadout = { actions: [], passives: [] };
  member.hp = 7;
  member.mp = 0;
  game.party[1].hp = 0;
  return game;
}

test('追加前に極めた5職のボーナスを保ち、新技能・AP・回復は配布しない', () => {
  const game = legacy();
  const member = game.party[0];
  const before = { mods: memberMods(oldData, member), stats: computeStats(oldData, member),
    learned: [...member.learned], ap: { ...member.ap }, loadout: structuredClone(member.loadout),
    resources: game.party.map(({ hp, mp }) => ({ hp, mp })) };
  normalizeGame(data, game);
  assert.equal(game.contentUpdates.build36, true);
  assert.deepEqual(new Set(member.masteredJobs), new Set(affected));
  for (const job of affected) assert.equal(isJobMastered(data, member, job), true, job);
  assert.deepEqual(memberMods(data, member), before.mods);
  assert.deepEqual(computeStats(data, member), before.stats);
  assert.deepEqual(member.learned, before.learned);
  assert.deepEqual(member.ap, before.ap);
  assert.deepEqual(member.loadout, before.loadout);
  assert.deepEqual(game.party.map(({ hp, mp }) => ({ hp, mp })), before.resources);
  assert.ok([...added].every((id) => !member.learned.includes(id)));
});

test('旧技能に未習得があったジョブは既得マスタリーに含めない', () => {
  const game = legacy();
  const member = game.party[0];
  const missing = jobSkills(oldData, 'thief').find((skill) => skill.apToLearn > 0);
  member.learned = member.learned.filter((id) => id !== missing.id);
  normalizeGame(data, game);
  assert.equal(isJobMastered(data, member, 'thief'), false);
  assert.ok(!member.masteredJobs.includes('thief'));
  assert.ok(!member.learned.includes(missing.id));
  assert.equal(isJobMastered(data, member, 'monk'), true);
});

test('新規ゲームは追加技能も習得して初めて極め、完成を永続記録する', () => {
  const game = fresh('thief');
  const member = game.party[0];
  assert.equal(game.contentUpdates.build36, true);
  assert.deepEqual(member.masteredJobs, []);
  member.learned = jobSkills(oldData, 'thief').map((skill) => skill.id);
  normalizeGame(data, game);
  assert.equal(isJobMastered(data, member, 'thief'), false);
  const newSkills = jobSkills(data, 'thief').filter((skill) => added.has(skill.id));
  member.ap.thief = newSkills.reduce((total, skill) => total + skill.apToLearn, 0);
  learnSkill(data, member, newSkills[0].id);
  assert.equal(isJobMastered(data, member, 'thief'), false);
  learnSkill(data, member, newSkills[1].id);
  assert.equal(member.ap.thief, 0);
  assert.equal(isJobMastered(data, member, 'thief'), true);
  assert.deepEqual(member.masteredJobs, ['thief']);
  const futureData = { ...data, skills: new Map(data.skills) };
  futureData.skills.set('future_thief_skill', { ...newSkills[1], id: 'future_thief_skill', apToLearn: 99 });
  assert.equal(isJobMastered(futureData, member, 'thief'), true);
});

test('遠征の復元元も移行し、再読込・全滅相当の復元で記録や資源を重複させない', () => {
  const game = legacy();
  const run = { snapshot: structuredClone(game), battle: { round: 2, pending: { actor: 0 } } };
  const battle = structuredClone(run.battle);
  normalizeGame(data, game, run);
  assert.equal(run.snapshot.contentUpdates.build36, true);
  assert.deepEqual(run.snapshot.party[0].masteredJobs, game.party[0].masteredJobs);
  assert.deepEqual(run.battle, battle);
  const once = structuredClone({ game, run });
  normalizeGame(data, game, run);
  normalizeGame(data, game, run);
  assert.deepEqual({ game, run }, once);
  const restored = structuredClone(run.snapshot);
  normalizeGame(data, restored);
  assert.deepEqual(restored, once.run.snapshot);
});
