import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewGame, normalizeGame } from '../js/game-state.js';
import { createMember } from '../js/character.js';
import { isLearned, learnBlock, learnSkill, equipSkill, changeJob, actionSkills } from '../js/growth.js';
import { GameSession } from '../js/save.js';
import { startRun, startNextBattle, afterBattle } from '../js/dungeon.js';
import { nextTurn, setPending, resolvePending } from '../js/battle.js';
import { realGameData, MemoryStorage } from './helpers.js';

const data=realGameData();
const specs=['warrior','knight','black_mage','white_mage','thief','bard'].map(job=>({job,name:job,icon:'x'}));
const fresh=()=>createNewGame(data,specs);

test('全ジョブの新キャラは無料技能なし。AP0という値だけでも習得にならない',()=>{
  const game=fresh();
  for(const job of data.jobs) {
    const member=createMember(data,game,{job:job.id,name:job.id,icon:'x'},99);
    assert.deepEqual(member.learned,[]);
    assert.deepEqual(member.loadout,{actions:[],passives:[]});
    assert.equal(member.ap,0);
    assert.ok([...data.skills.values()].every(skill=>!isLearned(member,skill)));
    const oldZero={id:'test-zero',job:job.id,apToLearn:0};
    assert.equal(isLearned(member,oldZero),false);
  }
  assert.ok([...data.skills.values()].every(skill=>skill.apToLearn>0));
  normalizeGame(data,game); normalizeGame(data,game);
  assert.ok(game.party.every(m=>m.learned.length===0));
});

test('旧初期技能も10APで明示習得し、転職だけでは習得・装着・支払いが発生しない',()=>{
  const game=fresh(),member=game.party[0],skill=data.skills.get('warrior_p1_s1');
  assert.equal(skill.apToLearn,10);
  assert.match(learnBlock(data,member,skill),/AP/);
  member.ap=10; learnSkill(data,member,skill.id);
  assert.equal(member.ap,0);
  assert.deepEqual(actionSkills(data,member),[]);
  equipSkill(data,member,skill.id);
  const learned=[...member.learned];
  changeJob(data,game,0,'black_mage');
  assert.deepEqual(member.learned,learned);
  assert.equal(member.ap,0);
  assert.ok(member.loadout.actions.includes(skill.id));
  assert.equal(isLearned(member,data.skills.get('black_mage_p1_s1')),false);
  changeJob(data,game,0,'warrior');
  assert.deepEqual(member.learned,learned);
});

test('廃止前のジョブ別APセーブは既得技能だけ一度記録し、保存再開・全滅復元でも維持',()=>{
  const game=fresh(),member=game.party[0];
  delete member.skillAcquisitionVersion; delete member.apVersion; delete member.visitedJobs;
  member.ap={warrior:17,black_mage:0};
  member.learned=['warrior_p1_s2'];
  member.loadout={actions:['warrior_p1_s1','black_mage_p1_s1'],passives:['common_mana_afterglow']};
  member.skillLevels={warrior_p1_s1:2};
  member.skillUseLevels={warrior_p1_s1:2};
  const beforeLoadout=structuredClone(member.loadout);
  const run={snapshot:structuredClone(game)};
  normalizeGame(data,game,run);
  assert.equal(member.ap,17);
  assert.deepEqual(member.loadout,beforeLoadout);
  assert.deepEqual(member.skillLevels,{warrior_p1_s1:2});
  assert.ok(isLearned(member,data.skills.get('warrior_p1_s1')));
  assert.ok(isLearned(member,data.skills.get('black_mage_p1_s1')));
  assert.ok(isLearned(member,data.skills.get('common_mana_afterglow')));
  assert.equal(isLearned(member,data.skills.get('white_mage_p1_s1')),false);
  assert.equal(isLearned(member,data.skills.get('warrior_p1_s3')),false);
  assert.ok(run.snapshot.party[0].learned.includes('black_mage_p1_s1'));
  const state=structuredClone({game,run});
  normalizeGame(data,game,run);
  assert.deepEqual({game,run},state);
  changeJob(data,game,0,'white_mage');normalizeGame(data,game);
  assert.equal(isLearned(member,data.skills.get('white_mage_p1_s1')),false);
  const storage=new MemoryStorage(),session=new GameSession({storage});
  session.startNew(game);session.enterDungeon({dungeonId:'mossy_cave'});
  const resumed=new GameSession({storage});normalizeGame(data,resumed.game,resumed.run);resumed.wipe();
  assert.deepEqual(resumed.game.party[0].learned,member.learned);
  assert.equal(resumed.game.party[0].ap,17);
});

test('AP統合済みの旧セーブも無料技能を引き継ぎ、新規セーブは再読込で増えない',()=>{
  const old=fresh(),member=old.party[0];
  delete member.skillAcquisitionVersion;
  member.visitedJobs.push('black_mage');member.ap=24;
  normalizeGame(data,old);
  assert.equal(member.ap,24);
  assert.ok(member.learned.includes('black_mage_p1_s1'));
  const storage=new MemoryStorage(),session=new GameSession({storage});
  session.startNew(fresh());
  const resumed=new GameSession({storage});normalizeGame(data,resumed.game);
  assert.ok(resumed.game.party.every(m=>m.learned.length===0 && m.ap===0));
});

test('無料技能なしの新規パーティも通常攻撃で最初の戦闘に勝ちAPを獲得できる',()=>{
  for(const seed of [1,3,7]) {
    const session=new GameSession({storage:new MemoryStorage()});session.startNew(fresh());
    startRun(data,session,{dungeonId:'mossy_cave',stoneId:'rs_1_001',seed});
    startNextBattle(data,session);
    const battle=session.run.battle;
    let actions=0;
    while(nextTurn(data,session.game,battle)) {
      assert.ok(actions++<300);
      setPending(battle,{type:'attack',target:0},{});
      resolvePending(data,session.game,battle,true);
    }
    assert.equal(afterBattle(data,session).result,'win');
    assert.ok(session.game.party.some(m=>m.ap>0));
    assert.ok(session.game.party.every(m=>m.learned.length===0));
  }
});
