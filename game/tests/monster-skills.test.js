import test from 'node:test';
import assert from 'node:assert/strict';
import {realGameData,readJson} from './helpers.js';
import {makeEnemy,createBattle,nextTurn,enemyIntent,collectBattleHits} from '../js/battle.js';
import {createNewGame,defaultPartySpecs} from '../js/game-state.js';
import {installMonsterSkills,enemySkillChoices,enemySkillAllowed} from '../js/monster-skills.js';

const data=realGameData({world:true});
function setup(id,others=[]){
 const game=createNewGame(data,defaultPartySpecs(data));
 for(const member of game.party){member.hp=99999;member.persist=[];}
 const enemies=[id,...others].map(id=>makeEnemy(data,id));
 const b=createBattle(data,game,{enemies,seed:123});
 return {game,b,enemy:enemies[0]};
}
function act(c,round=1){
 c.b.turn=null;c.b.pending=null;c.b.round=round;c.b.queue=[{side:'enemy',i:0},{side:'ally',i:0}];
 return collectBattleHits(c.b,()=>nextTurn(data,c.game,c.b));
}
function onlySpecial(c,kind='attack'){
 const skill=c.enemy.skillProfile.skills.find(s=>!s.basic&&s.kind===kind&&!s.sweep);
 c.enemy.skillProfile.skills=[skill];return skill;
}

test('39種の種族・固定Lv・技を登録し、各Lv1〜12に2種ずつ追加',()=>{
 const original=['slime','nut_squirrel','cave_rat','wolf_pup','goblin','marsh_frog','skeleton','mud_slime','fort_bandit','stone_statue','wandering_armor','canyon_wolf','wind_spirit','stone_giant','storm_eagle'];
 const profiles=Object.entries(data.monsterSkills.monsters);
 assert.equal(profiles.length,39);
 for(let lv=1;lv<=12;lv++)assert.equal(profiles.filter(([id,p])=>p.level===lv&&!original.includes(id)).length,2);
 for(const [id,p] of profiles){
  const m=data.monsters.get(id);assert.ok(m.types.length);assert.equal(m.fixedStats.level,p.level);
  assert.equal(m.statsReview,'region1');assert.ok(p.skills.length>=2);
  const normal=makeEnemy(data,id),elite=makeEnemy(data,id,{eliteId:'elite'});
  assert.deepEqual(normal.skillProfile,elite.skillProfile);
  assert.notEqual(normal.skillProfile,m.skillProfile);
 }
 for(const node of data.worldRoutes.nodes)for(const id of [...node.pool,node.bossId].filter(Boolean))assert.ok(data.monsters.get(id).skillProfile,id);
 assert.throws(()=>installMonsterSkills(structuredClone(data),{monsters:{slime:{level:99,skills:[]}}}));
 const invalid=readJson('monster_skills.json');invalid.monsters.slime.skills[1].kind='unknown';
 assert.throws(()=>installMonsterSkills(structuredClone(data),invalid));
});

test('沈黙は魔法、封印は物理特技、恐怖は全特技を止め、MP不足なら通常攻撃',()=>{
 for(const id of ['goblin','rogue_mage']){
  const c=setup(id),p=c.enemy.skillProfile;
  const special=p.skills.find(s=>!s.basic&&s.kind==='attack');
  for(const state of ['silence','seal','fear']){
   c.enemy.statuses={[state]:{turns:5}};
   assert.equal(enemySkillAllowed(c.enemy,special,1),!(state==='fear'||(special.magic?state==='silence':state==='seal')));
   assert.ok(enemySkillAllowed(c.enemy,p.skills[0],1));
  }
  c.enemy.statuses={};c.enemy.mp=0;
  assert.deepEqual(enemySkillChoices(data,c.enemy,c.b.enemies,1),[p.skills[0]]);
  const hits=act(c);assert.ok(hits.some(h=>h.target.side==='ally'));assert.equal(c.enemy.mp,0);
  assert.equal(c.enemy.lastSkillId,p.skills[0].id);
 }
});

test('特技が実際に命中し、消費MP・技名ログ・待機期間が反映される',()=>{
 const c=setup('rogue_mage'),s=onlySpecial(c),mp=c.enemy.mp;
 const hits=act(c);assert.ok(hits.some(h=>h.target.side==='ally'&&h.damage>0));
 assert.equal(c.enemy.mp,mp-s.mp);assert.ok(c.b.log.some(line=>line.includes(s.name)));
 assert.equal(enemySkillAllowed(c.enemy,s,2),false);assert.equal(enemySkillAllowed(c.enemy,s,3),true);
});

test('回復は最もHP割合が低い仲間を優先し、死亡・呪い・石化には使わない',()=>{
 const c=setup('owl_sage',['slime','goblin']);
 const [healer,slime,goblin]=c.b.enemies;slime.hp=slime.maxHp*.2;goblin.hp=goblin.maxHp*.4;
 const before=slime.hp,mp=healer.mp;act(c);
 assert.ok(slime.hp>before);assert.equal(healer.mp,mp-3);assert.ok(c.b.log.some(s=>s.includes('癒やしの羽')));
 slime.statuses.curse={turns:99};goblin.statuses.petrify={turns:99};
 assert.ok(enemySkillChoices(data,healer,c.b.enemies,4).every(s=>s.kind!=='heal'));
 slime.statuses={};slime.hp=0;
 assert.ok(enemySkillChoices(data,healer,c.b.enemies,4).every(s=>s.kind!=='heal'));
});

test('防御強化は実際のbuffになり、有効な間は重ねがけしない',()=>{
 const c=setup('stone_statue');onlySpecial(c,'buff');act(c);
 assert.equal(c.enemy.buffs.def[0],.25);
 assert.equal(enemySkillChoices(data,c.enemy,c.b.enemies,5).length,0);
});

test('技の追加状態異常を通常攻撃へ漏らさず、戦闘の保存再開でも抽選が同じ',()=>{
 const c=setup('poison_cap');const s=onlySpecial(c);s.statusRate=1;c.enemy.sureHit=true;
 act(c);assert.ok(c.b.allies.some(a=>a.statuses.poison));
 const d=setup('goblin'),copy=JSON.parse(JSON.stringify(d));
 act(d);act(copy);
 assert.deepEqual(d.b,copy.b);assert.deepEqual(d.game,copy.game);
 const normal=setup('poison_cap');normal.enemy.mp=0;act(normal);
 assert.ok(normal.b.allies.every(a=>!a.statuses.poison));
});

test('ボスの専用全体攻撃は前巡に予告し、MPを一度だけ消費、封印や沈黙で阻止できる',()=>{
 for(const [id,status] of [['stone_giant','seal'],['storm_eagle','silence']]){
  const c=setup(id),s=c.enemy.skillProfile.skills.find(s=>s.sweep),mp=c.enemy.mp;
  assert.ok(enemyIntent(data,c.enemy,2).label.includes(s.name));
  assert.equal(enemyIntent(data,c.enemy,2).warning,true);
  const hits=act(c,3);assert.ok(new Set(hits.filter(h=>h.target.side==='ally').map(h=>h.target.i)).size>=2);
  assert.equal(c.enemy.mp,mp-s.mp);assert.ok(c.b.log.some(line=>line.includes(s.name)));
  c.enemy.statuses[status]={turns:5};assert.equal(enemyIntent(data,c.enemy,6).sweep,false);
 }
});

test('旧セーブの敵は技定義を自動で書き換えず、従来の通常攻撃を使う',()=>{
 const c=setup('slime');delete c.enemy.skillProfile;c.enemy.magicRate=0;
 act(c);assert.equal(c.enemy.lastSkillId,undefined);assert.ok(c.b.log.some(s=>s.includes('スライムの攻撃')));
});
