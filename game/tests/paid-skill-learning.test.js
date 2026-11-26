import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewGame, normalizeGame } from '../js/game-state.js';
import { createMember, starterGearIds, equipFromStorage } from '../js/character.js';
import { isLearned, learnBlock, learnSkill, equipSkill, changeJob, actionSkills } from '../js/growth.js';
import { GameSession } from '../js/save.js';
import { startRun, startNextBattle, afterBattle } from '../js/dungeon.js';
import { nextTurn, setPending, resolvePending } from '../js/battle.js';
import { realGameData, MemoryStorage } from './helpers.js';

const data = realGameData();
const specs = ['warrior', 'knight', 'black_mage', 'white_mage', 'thief', 'bard'].map((job) => ({ job, name: job, icon: 'x' }));
const fresh = () => createNewGame(data, specs);

test('全職の新キャラに無料技能はなく、APを持っているだけでも修得扱いにしない', () => {
  const game = fresh();
  for (const job of data.jobs) {
    const member = createMember(data, game, { job: job.id, name: job.id, icon: 'x' }, 99);
    assert.deepEqual(member.learned, []);
    assert.deepEqual(member.loadout, { actions: [], passives: [], ultimate: null });
    assert.equal(member.ap, data.basicJobRules.starting_ap);
    assert.ok([...data.skills.values()].every((skill) => !isLearned(member, skill)));
    assert.equal(isLearned(member, { id: 'test-zero', job: job.id, apToLearn: 0 }), false);
  }
  assert.ok([...data.skills.values()].every((skill) => skill.apToLearn > 0));
  normalizeGame(data, game);
  normalizeGame(data, game);
  assert.ok(game.party.every((member) => member.learned.length === 0));
});

test('入口技能もAPで明示修得し、転職では自動修得・装着・支払いを発生させない', () => {
  const game = fresh();
  const member = game.party[0];
  const skill = data.skills.get('warrior_A01');
  member.ap = 0;
  assert.match(learnBlock(data, member, skill), /AP/);
  member.ap = skill.apToLearn;
  learnSkill(data, member, skill.id);
  assert.equal(member.ap, 0);
  assert.deepEqual(actionSkills(data, member), []);
  equipSkill(data, member, skill.id);
  const learned = [...member.learned];
  changeJob(data, game, 0, 'black_mage');
  assert.deepEqual(member.learned, learned);
  assert.equal(member.ap, 0);
  assert.ok(member.loadout.actions.includes(skill.id));
  assert.ok(!isLearned(member, data.skills.get('black_mage_A01')));
  changeJob(data, game, 0, 'warrior');
  assert.deepEqual(member.learned, learned);
});

test('旧職業技能は費用相当APを返し、保存再開・全滅復元でも二重返還しない', () => {
  const game = fresh();
  const member = game.party[0];
  delete member.jobMasterVersion;
  delete member.apVersion;
  delete member.visitedJobs;
  delete member.skillAcquisitionVersion;
  const old = data.skillMigration.retired_skills.find((skill) => skill.id === 'warrior_p1_s1');
  member.ap = { warrior: 17, black_mage: 0 };
  member.learned = [old.id, 'common_mana_afterglow'];
  member.skillLevels = { [old.id]: 2 };
  member.skillUseLevels = { [old.id]: 1 };
  member.loadout = { actions: [old.id], passives: ['common_mana_afterglow'] };
  const expected = 17 + old.ap + old.levels[0].ap;
  const run = { snapshot: structuredClone(game) };
  normalizeGame(data, game, run);
  assert.equal(member.ap, expected);
  assert.deepEqual(member.learned, ['common_mana_afterglow']);
  assert.equal(member.skillUseLevels, undefined);
  assert.ok(!isLearned(member, data.skills.get('warrior_A01')));
  assert.equal(run.snapshot.party[0].ap, expected);
  const before = structuredClone({ game, run });
  normalizeGame(data, game, run);
  assert.deepEqual({ game, run }, before);
  const storage = new MemoryStorage();
  const session = new GameSession({ storage });
  session.startNew(game);
  session.enterDungeon({ dungeonId: 'windward_plain' });
  const resumed = new GameSession({ storage });
  normalizeGame(data, resumed.game, resumed.run);
  resumed.wipe();
  assert.equal(resumed.game.party[0].ap, expected);
  assert.deepEqual(resumed.game.party[0].learned, ['common_mana_afterglow']);
});

test('新規セーブは保存再読込でも初期APと未修得状態を維持する', () => {
  const storage = new MemoryStorage();
  const session = new GameSession({ storage });
  session.startNew(fresh());
  const resumed = new GameSession({ storage });
  normalizeGame(data, resumed.game);
  assert.ok(resumed.game.party.every((member) => member.learned.length === 0 && member.ap === data.basicJobRules.starting_ap));
});

test('配給装備を手動で装備すれば、技能なしでも最初の戦闘に勝ちAPを獲得できる', () => {
  for (const seed of [1, 3, 7]) {
    const game = fresh();
    for (const member of game.party) {
      for (const [slot, id] of Object.entries(starterGearIds(data, member.job))) {
        const gear = game.storage.gear.find((item) => item.id === id);
        if (gear) equipFromStorage(data, game, member, slot, gear.uid);
      }
    }
    const session = new GameSession({ storage: new MemoryStorage() });
    session.startNew(game);
    startRun(data, session, { dungeonId: 'windward_plain', stoneId: 'rs_1_001', seed });
    startNextBattle(data, session);
    const state = session.run.battle;
    let count = 0;
    while (nextTurn(data, session.game, state)) {
      assert.ok(count++ < 300);
      const target = state.enemies.findIndex((enemy) => enemy.hp > 0);
      setPending(state, { type: 'attack', target }, {});
      resolvePending(data, session.game, state, true);
    }
    assert.equal(afterBattle(data, session).result, 'win');
    assert.ok(session.game.party.some((member) => member.ap > data.basicJobRules.starting_ap));
    assert.ok(session.game.party.every((member) => member.learned.length === 0));
  }
});
