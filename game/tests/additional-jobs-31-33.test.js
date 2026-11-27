import test from 'node:test';
import assert from 'node:assert/strict';
import {realGameData} from './helpers.js';
import {createNewGame,defaultPartySpecs} from '../js/game-state.js';
import {maxHp,maxMp,makeGear} from '../js/character.js';
import {availableJobs,effectiveSkill,skillMaxLevel} from '../js/growth.js';
import {createBattle,makeEnemy,setPending,resolvePending,actionOptions,nextTurn} from '../js/battle.js';
import {trioItems} from '../js/trio-combat.js';
import {craftSpecs} from '../../scripts/additional-jobs-31-33-plans.mjs';

const data=realGameData();
function fixture(job='apothecary') {
  const specs=defaultPartySpecs(data);specs[0].job=job;
  const game=createNewGame(data,specs);game.facilities.temple=8;
  for(const member of game.party){member.lv=20;member.hp=maxHp(data,member);member.mp=maxMp(data,member);}
  const member=game.party[0];
  if(job==='apothecary'){
    const dagger=[...data.equipment.values()].find(x=>x.slot==='weapon'&&x.kind==='dagger'&&!x.unique);
    member.equip.weapon=makeGear(game,dagger.id);
  }
  const enemy=Object.assign(makeEnemy(data,'goblin',{lv:1}),{hp:1e7,maxHp:1e7,def:30,res:30,spd:0,weak:[],strongWeak:[],resist:[],immune:[],statusAffinity:{},evasion:0,buffs:{},statuses:{},tactics:null,status:null,magicRate:0});
  const b=createBattle(data,game,{enemies:[enemy],seed:173});b.round=1;
  return {game,member,b,ally:b.allies[0]};
}
function teach(c,id,level=1){
  const skill=data.skills.get(id);assert.ok(skill,id);c.member.learned=[...new Set([...c.member.learned,id])];
  c.member.skillLevels??={};c.member.skillLevels[id]=level;
  if(skill.isFinal)c.member.loadout.ultimate=id;
  else c.member.loadout[skill.kind==='passive'?'passives':'actions']=[...new Set([...c.member.loadout[skill.kind==='passive'?'passives':'actions'],id])];
}
function act(c,id,target=0,extra={}){
  c.member.mp=999;c.b.turn={side:'ally',i:0,bleedProcessed:true};
  setPending(c.b,{type:'skill',skillId:id,target,...extra},{});resolvePending(data,c.game,c.b,true);
}
function prepare(c){
  c.ally.trioInitialized=true;c.ally.medicine=3;
  c.ally.reagents=[{element:'fire',remaining:4,grantedClock:0},{element:'ice',remaining:4,grantedClock:0}];
  c.ally.machine={hp:500,maxHp:1000,fuel:3,remaining:5,grantedClock:0,mode:'attack'};
  c.game.items.potion=3;
  const mat=[...data.materials.values()].find(x=>x.kind==='common'&&x.element==='fire');
  c.game.storage.materials[mat.id]=3;
  for(const m of c.game.party)m.hp=Math.max(1,maxHp(data,m)-80);
  c.member.ultimateGauge=100;
}
test('31〜33の45技能は全成長段階で取得・発動できる',()=>{
  for(const job of craftSpecs.jobs){
    assert.equal(job.skills.length,15);const c=fixture(job.id);
    assert.equal(data.jobs.find(x=>x.id===job.id).skillsReady,true);
    assert.ok(availableJobs(data,c.game).some(x=>x.id===job.id));
    for(const source of job.skills){
      const skill=data.skills.get(source.id);assert.equal(skillMaxLevel(skill),source.maxLevel,source.id);
      assert.deepEqual(skill.effect.prerequisites,source.prerequisites);
      for(let level=1;level<=source.maxLevel;level++){
        teach(c,source.id,level);
        const used=effectiveSkill(data,c.member,skill);assert.equal(used.effect.description,source.effects[level-1]);
        if(source.type==='passive')continue;
        const one=fixture(job.id);teach(one,source.id,level);prepare(one);
        const rule=used.effect.rules;
        let choice=rule.choose_mode?.find(x=>x!=='fire')??rule.choose_mode?.[0];
        const itemId=rule.trio_items?trioItems(data,one.game,used)[0]?.id:undefined;
        const target=rule.trio.targetKind==='ko_ally'?1:rule.trio.targetKind==='ally'?1:0;
        if(rule.trio.targetKind==='ko_ally')one.game.party[1].hp=0;
        if(source.id==='machinist_A01'||source.id==='machinist_U01')delete one.ally.machine;
        if(source.id==='alchemist_A01'||source.id==='alchemist_A06')one.ally.reagents=[];
        if(source.id==='alchemist_A07')choice='fire';
        act(one,source.id,target,{element:choice,itemId});
        assert.ok(one.b.log.some(x=>x.includes(skill.name+'！')),source.id+' Lv'+level+' '+one.b.log.at(-1));
      }
    }
  }
});

test('薬効・調合素材・装置の不足時はMPと品物を消費しない',()=>{
  const p=fixture();for(const id of ['apothecary_A01','apothecary_A02','apothecary_A06'])teach(p,id);prepare(p);
  p.ally.medicine=0;act(p,'apothecary_A02',1);assert.equal(p.ally.medicine,0);assert.equal(p.member.mp,999);assert.equal(p.game.items.potion,3);
  p.ally.medicine=3;act(p,'apothecary_A06',1,{itemId:'potion'});assert.equal(p.game.items.potion,2);
  const a=fixture('alchemist');teach(a,'alchemist_A06');prepare(a);a.ally.reagents=[];
  const material=trioItems(data,a.game,data.skills.get('alchemist_A06'))[0].id;
  act(a,'alchemist_A06',0,{itemId:material});assert.equal(a.game.storage.materials[material],2);
  const machine=fixture('machinist');teach(machine,'machinist_A02');prepare(machine);machine.ally.machine.fuel=0;
  act(machine,'machinist_A02',0);assert.equal(machine.ally.machine.fuel,0);
});

test('薬品選択を保存して再開しても一個だけ消費する',()=>{
  const c=fixture();teach(c,'apothecary_A06');prepare(c);
  c.b.turn={side:'ally',i:0,bleedProcessed:true};setPending(c.b,{type:'skill',skillId:'apothecary_A06',target:1,itemId:'potion'},{});
  c.b=JSON.parse(JSON.stringify(c.b));c.ally=c.b.allies[0];
  resolvePending(data,c.game,c.b,true);
  assert.equal(c.game.items.potion,2);
  assert.equal(c.b.pending,null);
});

test('錬成印と装置は保存で属性・燃料・耐久・残り行動を保つ',()=>{
  const a=fixture('alchemist');teach(a,'alchemist_A01');teach(a,'alchemist_A02');prepare(a);a.ally.reagents=[];
  act(a,'alchemist_A01',0,{element:'fire'});
  a.b=JSON.parse(JSON.stringify(a.b));a.ally=a.b.allies[0];
  assert.equal(a.ally.reagents[0].element,'fire');act(a,'alchemist_A02');assert.equal(a.ally.reagents.length,0);
  const m=fixture('machinist');teach(m,'machinist_A01');teach(m,'machinist_A03');prepare(m);delete m.ally.machine;
  act(m,'machinist_A01');act(m,'machinist_A03',1);
  m.b=JSON.parse(JSON.stringify(m.b));m.ally=m.b.allies[0];
  assert.equal(m.ally.machine.fuel,1);assert.equal(m.ally.machine.guard.target,1);
  assert.ok(m.ally.machine.hp>0&&m.ally.machine.remaining>0);
});

test('実素材は一戦一回だけ使え、槽が満杯なら消費しない',()=>{
  const c=fixture('alchemist');teach(c,'alchemist_A06');prepare(c);c.ally.reagents=[];
  const itemId=trioItems(data,c.game,data.skills.get('alchemist_A06'))[0].id;
  act(c,'alchemist_A06',0,{itemId});
  assert.equal(c.game.storage.materials[itemId],2);
  act(c,'alchemist_A06',0,{itemId});
  assert.equal(c.game.storage.materials[itemId],2);
  assert.equal(c.member.mp,999);
  assert.equal(c.ally.reagents.length,1);
});

test('触媒回収は消費した属性だけ戻し、実素材の強化は引き継がない',()=>{
  const c=fixture('alchemist');
  for(const id of ['alchemist_A03','alchemist_P04'])teach(c,id,3);
  prepare(c);c.ally.reagents=[
    {element:'fire',enhanced:true,level:3,remaining:4,grantedClock:0},
    {element:'ice',enhanced:true,level:3,remaining:4,grantedClock:0},
  ];
  act(c,'alchemist_A03');
  assert.deepEqual(c.ally.reagents.map(x=>[x.element,x.enhanced,x.remaining]),[['ice',false,2]]);
});

test('安定触媒は配置時だけ印の期限を延ばし、組み替えでは延長しない',()=>{
  const c=fixture('alchemist');
  for(const id of ['alchemist_A01','alchemist_A08','alchemist_P01'])teach(c,id,3);
  prepare(c);c.ally.reagents=[];
  act(c,'alchemist_A01',0,{element:'fire'});
  assert.equal(c.ally.reagents[0].remaining,5);
  act(c,'alchemist_A08',0,{element:'ice'});
  assert.equal(c.ally.reagents[0].element,'ice');
  assert.equal(c.ally.reagents[0].remaining,4);
});
