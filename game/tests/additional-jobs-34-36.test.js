import test from 'node:test';
import assert from 'node:assert/strict';
import { realGameData } from './helpers.js';
import { createNewGame, defaultPartySpecs } from '../js/game-state.js';
import { maxHp, maxMp } from '../js/character.js';
import { availableJobs, effectiveSkill, skillMaxLevel } from '../js/growth.js';
import { createBattle, makeEnemy, setPending, resolvePending } from '../js/battle.js';
import { civicItems } from '../js/civic-combat.js';
import { civicSpecs } from '../../scripts/additional-jobs-34-36-plans.mjs';

const data=realGameData();
function fixture(job='merchant'){
  const specs=defaultPartySpecs(data);specs[0].job=job;
  const game=createNewGame(data,specs);game.facilities.temple=9;
  for(const member of game.party){member.lv=20;member.hp=maxHp(data,member);member.mp=maxMp(data,member);}
  const member=game.party[0];
  const enemy=Object.assign(makeEnemy(data,'goblin',{lv:1}),{hp:1e7,maxHp:1e7,def:20,res:20,spd:0,
    weak:['earth'],strongWeak:[],resist:[],immune:[],statusAffinity:{},evasion:0,buffs:{},statuses:{},
    tactics:null,status:null,magicRate:0,types:['humanoid']});
  const b=createBattle(data,game,{enemies:[enemy],seed:173});b.round=1;
  return {game,member,b,ally:b.allies[0]};
}
function teach(c,id,level=1){
  const skill=data.skills.get(id);assert.ok(skill,id);
  c.member.learned=[...new Set([...c.member.learned,id])];
  c.member.skillLevels??={};c.member.skillLevels[id]=level;
  if(skill.isFinal)c.member.loadout.ultimate=id;
  else {const k=skill.kind==='passive'?'passives':'actions';c.member.loadout[k]=[...new Set([...c.member.loadout[k],id])];}
}
function act(c,id,target=0,extra={}){
  c.member.mp=999;c.b.turn={side:'ally',i:0,bleedProcessed:true};
  setPending(c.b,{type:'skill',skillId:id,target,...extra},{});
  resolvePending(data,c.game,c.b,true);
}
function prepare(c,id){
  c.ally.civicInitialized=true;c.ally.supply=3;c.ally.supplyGained=0;c.ally.dishPrepared=0;
  c.ally.relicMpGains=0;c.ally.relicHitEnemies=[];
  c.ally.dish={taste:['cook_A04','cook_A07'].includes(id)?'vegetable':id==='cook_A05'?'soup':'meat',portions:3,preparing:false,remaining:5,grantedClock:0,mpPaid:3};
  c.ally.relic={mode:id==='archaeologist_A04'?'guard':'attack',energy:2,remaining:4,grantedClock:0};
  c.b.enemies[0].civicMarks={0:{remaining:5,grantedClock:0,element:'earth',types:['humanoid']}};
  c.game.items.potion=3;c.game.items.revive_salts=3;
  for(const member of c.game.party)member.hp=Math.max(1,maxHp(data,member)-60);
  c.member.ultimateGauge=100;
}
test('34〜36の45技能は全成長段階で取得・発動でき、神殿Lv9で解放される',()=>{
  for(const job of civicSpecs.jobs){
    assert.equal(job.skills.length,15);const c=fixture(job.id);
    assert.equal(data.jobs.find(x=>x.id===job.id).skillsReady,true);
    assert.ok(availableJobs(data,c.game).some(x=>x.id===job.id));
    c.game.facilities.temple=8;assert.ok(!availableJobs(data,c.game).some(x=>x.id===job.id));
    for(const source of job.skills){
      const skill=data.skills.get(source.id);assert.equal(skillMaxLevel(skill),source.maxLevel,source.id);
      assert.equal(skill.cost,source.cost);assert.deepEqual(skill.effect.prerequisites,source.prerequisites);
      for(let level=1;level<=source.maxLevel;level++){
        teach(c,source.id,level);
        const used=effectiveSkill(data,c.member,skill);
        assert.equal(used.effect.description,source.effects[level-1]);
        if(source.type==='passive')continue;
        const one=fixture(job.id);teach(one,source.id,level);prepare(one,source.id);
        const rule=used.effect.rules,targetKind=rule.civic.targetKind;
        if(source.id==='cook_A01')delete one.ally.dish;
        if(source.id==='cook_A06')one.ally.dish.taste='meat';
        if(source.id==='archaeologist_A02')delete one.ally.relic;
        if(targetKind==='ko_ally')one.game.party[1].hp=0;
        if(source.id==='merchant_A03')one.game.party[1].mp=0;
        const choice=rule.choose_mode?.find(x=>x!=='meat')??rule.choose_mode?.[0];
        const itemId=rule.civic_items?civicItems(data,one.game,used)[0]?.id:undefined;
        const target=['ally','ko_ally'].includes(targetKind)?1:0;
        act(one,source.id,target,{element:choice,itemId,sourceTarget:source.id==='archaeologist_A08'?1:undefined});
        assert.ok(one.b.log.some(x=>x.includes(skill.name+'！')),source.id+' Lv'+level+' '+one.b.log.at(-1));
      }
    }
  }
});

test('商人の道具は明示選択で1個だけ消費し、補給札不足なら支払わない',()=>{
  const c=fixture();for(const id of ['merchant_A02','merchant_A05','merchant_A08'])teach(c,id);
  prepare(c,'merchant_A05');c.ally.supply=0;
  act(c,'merchant_A02',1);assert.equal(c.ally.supply,0);assert.equal(c.member.mp,999);
  act(c,'merchant_A05',1,{itemId:'potion'});assert.equal(c.game.items.potion,2);
  c.game.party[1].hp=0;
  c.b=JSON.parse(JSON.stringify(c.b));c.ally=c.b.allies[0];
  act(c,'merchant_A08',1,{itemId:'revive_salts'});
  assert.equal(c.game.items.revive_salts,2);assert.ok(c.game.party[1].hp>0);
});

test('料理は完成まで1行動を要し、取り分・味の変更・一戦2回上限を保持する',()=>{
  const c=fixture('cook');for(const id of ['cook_A01','cook_A03','cook_A06'])teach(c,id);
  prepare(c,'cook_A01');delete c.ally.dish;
  act(c,'cook_A01',0,{element:'meat'});assert.equal(c.ally.dish.preparing,true);
  act(c,'cook_A03',1);assert.equal(c.member.mp,999);
  act(c,'cook_A06',0,{element:'vegetable'});assert.equal(c.ally.dish.preparing,false);
  assert.equal(c.ally.dish.portions,2);assert.equal(c.ally.dish.taste,'vegetable');
  c.b=JSON.parse(JSON.stringify(c.b));c.ally=c.b.allies[0];
  act(c,'cook_A01',0,{element:'soup'});assert.equal(c.ally.dishPrepared,2);
  act(c,'cook_A01',0,{element:'meat'});assert.equal(c.member.mp,999);
});

test('鑑定は恒久図鑑を変えず、印・遺物・転写を保存して消費する',()=>{
  const c=fixture('archaeologist');for(const id of ['archaeologist_A01','archaeologist_A02','archaeologist_A03','archaeologist_A08'])teach(c,id);
  prepare(c,'archaeologist_A01');delete c.ally.relic;delete c.b.enemies[0].civicMarks;
  const before=JSON.stringify(c.game.catalog);
  act(c,'archaeologist_A01');assert.equal(JSON.stringify(c.game.catalog),before);
  assert.equal(c.b.enemies[0].civicMarks[0].element,'earth');
  act(c,'archaeologist_A08',0,{sourceTarget:1});
  act(c,'archaeologist_A02',0,{element:'attack'});
  act(c,'archaeologist_A03');assert.equal(c.ally.relic.energy,1);
  c.b=JSON.parse(JSON.stringify(c.b));c.ally=c.b.allies[0];
  assert.equal(c.b.allies[1].civicTransfer.enemy,0);
});
