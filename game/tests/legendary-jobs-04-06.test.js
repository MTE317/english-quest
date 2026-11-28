import test from 'node:test';
import assert from 'node:assert/strict';
import {realGameData} from './helpers.js';
import {createNewGame,defaultPartySpecs} from '../js/game-state.js';
import {maxHp,maxMp,makeGear} from '../js/character.js';
import {availableJobs,skillMaxLevel,effectiveSkill} from '../js/growth.js';
import {createBattle,makeEnemy,setPending,resolvePending,actionOptions,finishBattle,nextTurn} from '../js/battle.js';
import {finalLegendarySpecs} from '../../scripts/legendary-jobs-04-06-plans.mjs';

const data=realGameData();
function setup(job){
 const party=defaultPartySpecs(data);party[0].job=job;
 const game=createNewGame(data,party);game.facilities.temple=10;
 const weapon=job==='overlord'?'axe':job==='sage'?'tome':'staff';
 const item=[...data.equipment.values()].find(x=>x.slot==='weapon'&&x.kind===weapon&&!x.unique);
 game.party[0].equip.weapon=makeGear(game,item.id);
 for(const m of game.party){m.lv=25;m.hp=maxHp(data,m);m.mp=maxMp(data,m);}
 const enemy=Object.assign(makeEnemy(data,'goblin',{lv:1}),{hp:1e8,maxHp:1e8,def:10,res:10,spd:0,weak:[],resist:[],immune:[],statuses:{},buffs:{},debuffs:{},evasion:0,magicRate:0});
 const b=createBattle(data,game,{enemies:[enemy],seed:119});b.round=1;
 return {game,b,m:game.party[0],a:b.allies[0]};
}
function teach(c,id,level=1){const s=data.skills.get(id);assert.ok(s,id);
 c.m.learned=[...new Set([...c.m.learned,id])];c.m.skillLevels??={};c.m.skillLevels[id]=level;
 if(s.isFinal)c.m.loadout.ultimate=id;else{const k=s.kind==='passive'?'passives':'actions';c.m.loadout[k]=[...new Set([...c.m.loadout[k],id])];}
}
function act(c,id,target=0,more={}){c.m.mp=999;c.b.turn={side:'ally',i:0,bleedProcessed:true};
 setPending(c.b,{type:'skill',skillId:id,target,...more},{});resolvePending(data,c.game,c.b,true);
 assert.ok(c.b.log.some(x=>x.includes(data.skills.get(id).name+'！')),`${id}: ${c.b.log.at(-1)}`);
}
test('残る三職は神殿Lv10で解放され、技能45件の全成長段階が揃う',()=>{
 for(const job of finalLegendarySpecs){const c=setup(job.id);assert.equal(job.skills.length,15);
  assert.ok(availableJobs(data,c.game).some(x=>x.id===job.id));c.game.facilities.temple=9;
  assert.ok(!availableJobs(data,c.game).some(x=>x.id===job.id));
  for(const source of job.skills){const s=data.skills.get(source.id);assert.equal(skillMaxLevel(s),source.maxLevel);
   assert.equal(s.cost,source.cost);
   for(let level=1;level<=source.maxLevel;level++){teach(c,s.id,level);
    const e=effectiveSkill(data,c.m,s).effect;assert.equal(e.rules.legendary_final.level,level);assert.equal(e.description,source.description);}
  }
 }
});
test('全アクティブと奥義を各レベルで実行できる',()=>{
 for(const job of finalLegendarySpecs)for(const source of job.skills.filter(x=>x.type!=='passive'))for(let level=1;level<=source.maxLevel;level++){
  const c=setup(job.id);teach(c,source.id,level);c.m.ultimateGauge=100;
  c.a.sageMemory={element:'fire',level:1};c.a.saintMiracles=3;c.a.overlordHaki=3;
  c.game.party[1].hp=0;c.game.party[2].hp=0;
  const target=source.id==='saint_A06'?1:['sage_A05','saint_A01','saint_A02','saint_A04','saint_A07','overlord_A04'].includes(source.id)?3:0;
  act(c,source.id,target,{element:'ice',...(source.id==='saint_A09'?{targets:[1,2]}:{})});
 }
});
test('賢者は記憶の異元素だけで複合術を使い、消費後に記憶を失う',()=>{
 const c=setup('sage');teach(c,'sage_A01');teach(c,'sage_A04');
 assert.ok(actionOptions(data,c.game,c.b,0).skills.find(x=>x.skill.id==='sage_A04').reason);
 act(c,'sage_A01',0,{element:'fire'});assert.equal(c.a.sageMemory.element,'fire');
 c.b.turn={side:'ally',i:0,bleedProcessed:true};const before=c.m.mp;
 setPending(c.b,{type:'skill',skillId:'sage_A04',target:0,element:'fire'},{});resolvePending(data,c.game,c.b,true);
 assert.equal(c.m.mp,before);assert.equal(c.a.sageMemory.element,'fire');
 const mp=c.m.mp;act(c,'sage_A04',0,{element:'ice'});assert.equal(c.a.sageMemory,undefined);
 assert.ok(c.m.mp<mp);finishBattle(data,c.game,c.b);assert.equal(c.a.sageMemory,undefined);
});
test('聖者は瀕死の実回復で奇跡を獲得し、蘇生に消費する',()=>{
 const c=setup('saint');teach(c,'saint_A01');teach(c,'saint_A06');
 c.game.party[1].hp=1;act(c,'saint_A01',1);assert.equal(c.a.saintMiracles,1);
 c.game.party[2].hp=0;act(c,'saint_A06',2);assert.ok(c.game.party[2].hp>0);assert.equal(c.a.saintMiracles,0);
});
test('覇王は他の味方の直接攻撃で覇気を得て消費する',()=>{
 const c=setup('overlord');teach(c,'overlord_A01');teach(c,'overlord_A03');
 c.b.turn={side:'ally',i:1,bleedProcessed:true};setPending(c.b,{type:'attack',target:0},{});resolvePending(data,c.game,c.b,true);
 assert.equal(c.a.overlordHaki,1);
 c.b.turn={side:'ally',i:2,bleedProcessed:true};setPending(c.b,{type:'attack',target:0},{});resolvePending(data,c.game,c.b,true);
 assert.equal(c.a.overlordHaki,1);
 act(c,'overlord_A03');assert.equal(c.a.overlordHaki,0);
});
test('聖者の護符は直接の致命傷だけで一度発動し、防護を残す',()=>{
 const c=setup('saint');teach(c,'saint_A07');teach(c,'saint_P05',3);c.a.saintMiracles=2;
 c.game.party[1].hp=5;act(c,'saint_A07',1);
 const enemy=c.b.enemies[0];Object.assign(enemy,{str:10000,mag:10000,magicRate:0,status:null,tactics:null});
 enemy.statuses.taunt={actor:1,turns:5};c.b.turn=null;c.b.pending=null;c.b.queue=[{side:'enemy',i:0},{side:'ally',i:4}];
 nextTurn(data,c.game,c.b);
 assert.equal(c.game.party[1].hp,1);assert.equal(c.b.allies[1].saintWardUsed,true);
 assert.ok(c.b.allies[1].masterEffects.saint_A07?.shield>0);
});
test('覇王奥義の支援は2回で失効し、覇気2以上の消費はHPを回復する',()=>{
 const c=setup('overlord');teach(c,'overlord_U01');teach(c,'overlord_P04',3);
 c.a.overlordHaki=2;c.m.hp=Math.floor(maxHp(data,c.m)*.5);
 const hp=c.m.hp;c.m.ultimateGauge=100;act(c,'overlord_U01');
 assert.equal(c.a.overlordHaki,0);assert.ok(c.m.hp>hp);
 assert.equal(c.b.allies[1].overlordMarch.uses,2);
 for(let n=1;n<=2;n++){c.b.turn={side:'ally',i:1,bleedProcessed:true};setPending(c.b,{type:'attack',target:0},{});resolvePending(data,c.game,c.b,true);
  assert.equal(c.b.allies[1].overlordMarch?.uses,n===1?1:undefined);}
});
