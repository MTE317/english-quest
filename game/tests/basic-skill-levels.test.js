import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../sim/balance.mjs';
import { createNewGame, normalizeGame } from '../js/game-state.js';
import { learnSkill, learnBlock, isLearned, skillPrerequisite, upgradeSkill, setSkillUseLevel, learnedSkillLevel, usedSkillLevel, effectiveSkill, skillMaxLevel, isJobMastered, changeJob, equipSkill, usedCapacity } from '../js/growth.js';
import { maxHp, maxMp } from '../js/character.js';
import { createBattle, makeEnemy, actionOptions, setPending, resolvePending, skillMp, nextTurn } from '../js/battle.js';
import { describeSkillEffect } from '../js/skill-effects.js';
import { GameSession, SAVE_VERSION } from '../js/save.js';
import { MemoryStorage } from './helpers.js';
const data = loadData();
const basic = data.jobs.filter(j => j.tier === 'base');
const leveled = [...data.skills.values()].filter(s => s.effect.levels);
function fresh(job = 'warrior') {
  return createNewGame(data, [job, 'knight', 'black_mage', 'white_mage', 'thief', job].map(job => ({ job, name: job, icon: 'x' })));
}
function trained(skill, level = 1) {
  const game = fresh(skill.job), m = game.party[0];
  m.ap = 1000;
  if (!isLearned(m, skill)) learnSkill(data, m, skill.id);
  m.loadout = { actions: [skill.id], passives: [] };
  for (let i = 1; i < level; i++) upgradeSkill(data, m, skill.id);
  setSkillUseLevel(data, m, skill.id, level);
  m.lv = 30; m.hp = maxHp(data, m); m.mp = maxMp(data, m);
  return game;
}
function battle(game, skill, correct = true) {
  const enemy = makeEnemy(data, 'goblin', { lv: 30 }); enemy.hp = enemy.maxHp = 100000; enemy.evasion = 0;
  const b = createBattle(data, game, { enemies: [enemy], seed: 1217071 });
  b.round = 1; b.turn = { side: 'ally', i: 0 }; b.queue = [{ side: 'ally', i: 1 }];
  if (skill.kind === 'heal') { game.party[1].lv = 99; game.party[1].hp = 1; }
  setPending(b, { type: 'skill', skillId: skill.id, target: skill.kind === 'attack' ? 0 : 1 }, { wordId: 'fixture' });
  return b;
}
function resolve(game, b, correct = true) { resolvePending(data, game, b, correct); return b; }

test('基本8職123技能は独立習得。上位職の前提・奥義・共通技能はそのまま', () => {
  assert.equal(basic.length, 8);
  const skills = [...data.skills.values()].filter(s => basic.some(j => j.id === s.job));
  assert.equal(skills.length, 123); assert.equal(leveled.length, 17);
  for (const s of skills) {
    const m = fresh(s.job).party[0]; m.ap = s.apToLearn;
    assert.equal(skillPrerequisite(data, s), undefined);
    if (s.apToLearn) { assert.equal(learnBlock(data, m, s), ''); learnSkill(data, m, s.id); assert.equal(m.ap, 0); }
  }
  const mid = [...data.skills.values()].find(s => !basic.some(j => j.id === s.job) && skillPrerequisite(data, s)?.apToLearn > 0);
  assert.ok(mid); assert.match(learnBlock(data, fresh(mid.job).party[0], mid), /覚える/);
  assert.ok(leveled.every(s => !s.isFinal && s.kind !== 'passive' && basic.some(j => j.id === s.job)));
});

test('共通AP10/20を消費。習得と使用Lvを分離し、他キャラ・未経験・不正値を拒否', () => {
  const s = data.skills.get('black_mage_p1_s1'), game = fresh('black_mage'), m = game.party[0];
  m.ap = 139;
  learnSkill(data,m,s.id);
  const other = structuredClone(game.party[5]); const cap = usedCapacity(data, m);
  upgradeSkill(data, m, s.id);
  assert.equal(learnedSkillLevel(m,s),2); assert.equal(usedSkillLevel(m,s),1); assert.equal(m.ap,119);
  setSkillUseLevel(data,m,s.id,2); upgradeSkill(data,m,s.id);
  assert.equal(usedSkillLevel(m,s),2); assert.equal(m.ap,99);
  assert.deepEqual(game.party[5],other); assert.deepEqual(usedCapacity(data,m),cap);
  assert.throws(()=>upgradeSkill(data,m,s.id),/強化できない/);
  for (const lv of [0,4,-1,1.5,NaN,'2']) assert.throws(()=>setSkillUseLevel(data,m,s.id,lv));
  const poor=fresh('black_mage').party[0]; poor.ap=19; learnSkill(data,poor,s.id);
  assert.throws(()=>upgradeSkill(data,poor,s.id),/AP/); assert.equal(poor.ap,9);
  assert.throws(()=>upgradeSkill(data,fresh().party[0],s.id),/覚えていない/);
});

test('17技能全Lvの実行: 表示・MP・威力/回復/支援が同じ使用Lv、元データ不変、誤答も既存処理', () => {
  const pristine = JSON.stringify([...data.skills]);
  for (const skill of leveled) {
    const values = [];
    for (const level of [1,2,3]) for (const correct of [true,false]) {
      const game=trained(skill,level),m=game.party[0],b=battle(game,skill);
      const effective=effectiveSkill(data,m,skill);
      const option=actionOptions(data,game,b,0).skills.find(x=>x.skill.id===skill.id);
      assert.deepEqual(option.skill,effective); assert.equal(option.reason,'');
      assert.equal(skillMp(data,m,skill),skillMp(data,m,effective));
      assert.equal(describeSkillEffect(data,option.skill),describeSkillEffect(data,effective));
      if(level>1) assert.notEqual(describeSkillEffect(data,effective),describeSkillEffect(data,skill));
      assert.deepEqual(effective.effect.st,skill.effect.st);
      assert.equal(effective.effect.once,skill.effect.once); assert.equal(effective.cost,skill.cost);
      const mp=m.mp; resolve(game,b,correct); assert.equal(mp-m.mp,skillMp(data,m,skill));
      const value=skill.kind==='attack'?100000-b.enemies[0].hp:skill.kind==='heal'?game.party[1].hp-1:b.allies[1].buffs.str[0];
      assert.ok(value>0,skill.id); if(correct) values.push(value);
    }
    assert.ok(values[1]>values[0] && values[2]>values[1],`${skill.id} は実行効果が段階的に増える`);
  }
  assert.equal(JSON.stringify([...data.skills]),pristine);
});

test('複数メンバーが同じ技能を別Lvで持ち出し、保存再読込しても混ざらない', () => {
  const s=data.skills.get('black_mage_p1_s1'),game=trained(s,3),m=game.party[0];
  const peer=game.party[5]; peer.ap=20; learnSkill(data,peer,s.id); upgradeSkill(data,peer,s.id); setSkillUseLevel(data,peer,s.id,2);
  changeJob(data,game,0,'warrior'); changeJob(data,game,5,'knight');
  const storage=new MemoryStorage(),session=new GameSession({storage});session.startNew(game);
  const loaded=new GameSession({storage});normalizeGame(data,loaded.game);
  assert.equal(effectiveSkill(data,loaded.game.party[0],s).effect.m,2.2);
  assert.equal(effectiveSkill(data,loaded.game.party[5],s).effect.m,1.95);
  assert.ok(loaded.game.party[0].loadout.actions.includes(s.id));
  assert.equal(loaded.game.party[0].ap,m.ap);
});

test('旧セーブのAP・装着・マスターは維持し、Lv未指定はLv1。全強化はマスターに不要', () => {
  const game=fresh(),m=game.party[0]; m.ap=1000;
  for(const s of data.skills.values()) if(s.job==='warrior'&&!isLearned(m,s)) learnSkill(data,m,s.id);
  assert.ok(isJobMastered(data,m,'warrior'));const saved=structuredClone(m);
  normalizeGame(data,game);assert.deepEqual(m.ap,saved.ap);assert.deepEqual(m.loadout,saved.loadout);assert.deepEqual(m.masteredJobs,saved.masteredJobs);
  for(const s of leveled.filter(s=>s.job==='warrior')) assert.equal(usedSkillLevel(m,s),1);
  assert.equal(SAVE_VERSION,2); // Gの単位移行後も技能の保存内容は維持
  m.skillLevels={warrior_p1_s1:99,missing:3};m.skillUseLevels={warrior_p1_s1:99,missing:3};normalizeGame(data,game);
  assert.deepEqual(m.skillLevels,{warrior_p1_s1:3});assert.deepEqual(m.skillUseLevels,{warrior_p1_s1:3});
});

test('遠征途中・問題待ちの保存再開は同じ使用Lv/乱数で解決し、全滅は入場時の状態に戻る', () => {
  const skill=data.skills.get('black_mage_p1_s1');
  for(const level of [1,3]) {
    const game=trained(skill,level); if(level===1){delete game.party[0].skillLevels;delete game.party[0].skillUseLevels;}
    const storage=new MemoryStorage(),session=new GameSession({storage});session.startNew(game);
    session.enterDungeon({dungeonId:'field',floor:1}); const b=battle(session.game,skill);session.setBattle(b);
    const controlGame=structuredClone(session.game),controlBattle=structuredClone(b);resolve(controlGame,controlBattle);
    const loaded=new GameSession({storage});normalizeGame(data,loaded.game,loaded.run);resolve(loaded.game,loaded.run.battle);
    assert.deepEqual(loaded.run.battle,controlBattle);assert.equal(loaded.game.party[0].mp,controlGame.party[0].mp);
    loaded.wipe(); assert.equal(usedSkillLevel(loaded.game.party[0],skill),level);
    assert.equal(loaded.game.party[0].ap,game.party[0].ap);
  }
});

test('同じ持出し技を別キャラが実行しても使用Lvは独立。高LvのMP不足時は行動しない', () => {
  const skill=data.skills.get('black_mage_p1_s1'),game=trained(skill,3);
  game.party[5]=structuredClone(game.party[0]);game.party[5].id='m6';
  setSkillUseLevel(data,game.party[5],skill.id,2);
  changeJob(data,game,0,'warrior');changeJob(data,game,5,'warrior');
  const values=[];
  for(const i of [0,5]) {
    const copy=structuredClone(game),b=battle(copy,skill);b.turn={side:'ally',i};b.pending.actor=i;
    const before=copy.party[i].mp;
    resolve(copy,b);
    values.push(100000-b.enemies[0].hp);
    assert.equal(before-copy.party[i].mp,skillMp(data,copy.party[i],skill));
    assert.equal(copy.party[i===0?5:0].mp,game.party[i===0?5:0].mp);
  }
  assert.ok(values[0]>values[1]);
  const copy=structuredClone(game),m=copy.party[0];m.mp=skillMp(data,m,skill)-1;
  const b=battle(copy,skill),hp=b.enemies[0].hp,mp=m.mp;
  assert.match(actionOptions(data,copy,b,0).skills.find(x=>x.skill.id===skill.id).reason,/MP/);
  resolve(copy,b);assert.equal(m.mp,mp);assert.equal(b.enemies[0].hp,hp);
});

test('習得Lv3から使用Lv1へ下げた時、Lv1分だけのMPで候補・実行・精算が一致', () => {
  const skill=data.skills.get('black_mage_p1_s1'),game=trained(skill,3),m=game.party[0];
  const highCost=skillMp(data,m,skill);setSkillUseLevel(data,m,skill.id,1);
  const lowCost=skillMp(data,m,skill);assert.ok(highCost>lowCost+1);
  m.mp=lowCost+1;assert.ok(m.mp<highCost);
  const before=m.mp,b=battle(game,skill),option=actionOptions(data,game,b,0).skills.find(x=>x.skill.id===skill.id);
  assert.equal(option.reason,'');assert.equal(option.skill.effect.m,1.7);
  const control=trained(skill,1),controlBattle=battle(control,skill);
  resolve(control,controlBattle);resolve(game,b);
  assert.equal(m.mp,before-lowCost);assert.equal(b.enemies[0].hp,controlBattle.enemies[0].hp);
  assert.equal(learnedSkillLevel(m,skill),3);assert.equal(usedSkillLevel(m,skill),1);
});

