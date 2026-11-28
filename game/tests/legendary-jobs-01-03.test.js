import test from 'node:test';
import assert from 'node:assert/strict';
import {realGameData} from './helpers.js';
import {createNewGame,defaultPartySpecs} from '../js/game-state.js';
import {maxHp,maxMp,makeGear} from '../js/character.js';
import {availableJobs,skillMaxLevel,effectiveSkill} from '../js/growth.js';
import {createBattle,makeEnemy,setPending,resolvePending,actionOptions,finishBattle} from '../js/battle.js';
import {legendarySpecs} from '../../scripts/legendary-jobs-01-03-plans.mjs';

const data=realGameData();
function setup(job){
 const party=defaultPartySpecs(data);party[0].job=job;
 const game=createNewGame(data,party);game.facilities.temple=10;
 const weapon=job==='sword_saint'?'katana':'sword';const item=[...data.equipment.values()].find(x=>x.slot==='weapon'&&x.kind===weapon&&!x.unique);
 game.party[0].equip.weapon=makeGear(game,item.id);
 for(const m of game.party){m.lv=25;m.hp=maxHp(data,m);m.mp=maxMp(data,m);}
 const enemy=Object.assign(makeEnemy(data,'goblin',{lv:1}),{hp:1e8,maxHp:1e8,def:10,res:10,spd:0,weak:[],resist:[],immune:[],statuses:{},buffs:{},debuffs:{},evasion:0,magicRate:0});
 const b=createBattle(data,game,{enemies:[enemy],seed:119});b.round=1;
 return {game,b,m:game.party[0],a:b.allies[0]};
}
function teach(c,id,level=1){
 const s=data.skills.get(id);assert.ok(s,id);c.m.learned=[...new Set([...c.m.learned,id])];c.m.skillLevels??={};c.m.skillLevels[id]=level;
 if(s.isFinal)c.m.loadout.ultimate=id;else{const k=s.kind==='passive'?'passives':'actions';c.m.loadout[k]=[...new Set([...c.m.loadout[k],id])];}
}
function act(c,id,target=0,more={}){
 c.m.mp=999;c.b.turn={side:'ally',i:0,bleedProcessed:true};
 setPending(c.b,{type:'skill',skillId:id,target,...more},{});resolvePending(data,c.game,c.b,true);
 assert.ok(c.b.log.some(x=>x.includes(data.skills.get(id).name+'！')),`${id}: ${c.b.log.at(-1)}`);
}
test('三つの伝説職は神殿Lv10から選べ、各15技能の全段階を保持する',()=>{
 for(const job of legendarySpecs){const c=setup(job.id);assert.equal(job.skills.length,15);
  assert.ok(availableJobs(data,c.game).some(x=>x.id===job.id));c.game.facilities.temple=9;
  assert.ok(!availableJobs(data,c.game).some(x=>x.id===job.id));
  for(const source of job.skills){const s=data.skills.get(source.id);assert.equal(skillMaxLevel(s),source.maxLevel);assert.equal(s.cost,source.cost);
   for(let level=1;level<=source.maxLevel;level++){teach(c,s.id,level);const effect=effectiveSkill(data,c.m,s).effect;
    assert.equal(effect.rules.legendary.level,level);assert.equal(effect.description,source.description);}
  }
 }
});
test('勇者の勇気は消費・上限を守り、戦闘終了時に消える',()=>{
 const c=setup('hero');teach(c,'hero_A01');teach(c,'hero_A04');
 c.b.enemies[0].weak=['slash'];act(c,'hero_A01');assert.equal(c.a.heroCourage,1);
 act(c,'hero_A04');assert.equal(c.a.heroCourage,0);
 assert.ok(actionOptions(data,c.game,c.b,0).skills.find(x=>x.skill.id==='hero_A04').reason);
 finishBattle(data,c.game,c.b);assert.equal(c.a.heroCourage,undefined);
});
test('魔王の変身は一度だけ発動し、奥義は新しい変身へ置き換える',()=>{
 const c=setup('demon_lord');teach(c,'demon_lord_A07');teach(c,'demon_lord_A08');teach(c,'demon_lord_U01');
 assert.ok(actionOptions(data,c.game,c.b,0).skills.find(x=>x.skill.id==='demon_lord_A08').reason);
 act(c,'demon_lord_A07');assert.equal(c.a.demonForm.remaining,2);
 assert.ok(actionOptions(data,c.game,c.b,0).skills.find(x=>x.skill.id==='demon_lord_A07').reason);
 c.m.ultimateGauge=100;act(c,'demon_lord_U01');assert.equal(c.a.demonForm.bonus,.2);
});
test('剣聖は同じ技の連続使用で極意を積み、別の技で切れる',()=>{
 const c=setup('sword_saint');teach(c,'sword_saint_A01');teach(c,'sword_saint_A02');
 act(c,'sword_saint_A01');assert.equal(c.a.swordChainStage,0);
 act(c,'sword_saint_A01');assert.equal(c.a.swordChainStage,1);
 act(c,'sword_saint_A02');assert.equal(c.a.swordChainStage,0);
});
test('45技能のうち全アクティブと奥義を各レベルで実行できる',()=>{
 for(const job of legendarySpecs)for(const source of job.skills.filter(x=>x.type!=='passive'))for(let level=1;level<=source.maxLevel;level++){
  const c=setup(job.id);teach(c,source.id,level);c.m.ultimateGauge=100;
  c.a.heroCourage=3;c.a.heroEarnedTotal=0;
  c.a.demonForm={remaining:9,bonus:.1,grantedClock:-1};
  const target=['ally','allies'].includes(data.skills.get(source.id).effect.rules.legendary.target)?1:0;
  act(c,source.id,target);
 }
});
