import test from 'node:test';
import assert from 'node:assert/strict';
import { realGameData } from './helpers.js';
import { createNewGame, defaultPartySpecs } from '../js/game-state.js';
import { maxHp, maxMp } from '../js/character.js';
import { availableJobs, effectiveSkill, skillMaxLevel } from '../js/growth.js';
import { createBattle, makeEnemy, setPending, resolvePending, actionOptions, skillMp } from '../js/battle.js';
import { natureSpecs } from '../../scripts/additional-jobs-22-24-plans.mjs';

const data=realGameData();
function fixture(job){
  const specs=defaultPartySpecs(data);specs[0].job=job;
  const game=createNewGame(data,specs);game.facilities.temple=6;
  for(const member of game.party){member.lv=20;member.hp=maxHp(data,member);member.mp=maxMp(data,member);}
  const enemy=Object.assign(makeEnemy(data,'goblin',{lv:1}),{hp:1e7,maxHp:1e7,def:10,res:10,spd:0,weak:[],resist:[],immune:[],statuses:{},buffs:{},debuffs:{},evasion:0,magicRate:0});
  const b=createBattle(data,game,{enemies:[enemy],seed:119});b.round=1;
  return {game,b,member:game.party[0],ally:b.allies[0]};
}
function teach(c,id,level=1){
  const skill=data.skills.get(id);assert.ok(skill,id);
  c.member.learned=[...new Set([...c.member.learned,id])];c.member.skillLevels??={};c.member.skillLevels[id]=level;
  if(skill.isFinal)c.member.loadout.ultimate=id;
  else{const key=skill.kind==='passive'?'passives':'actions';c.member.loadout[key]=[...new Set([...c.member.loadout[key],id])];}
}
function act(c,id,target=0,more={}){
  c.member.mp=999;c.b.turn={side:'ally',i:0,bleedProcessed:true};
  setPending(c.b,{type:'skill',skillId:id,target,...more},{});
  resolvePending(data,c.game,c.b,true);
  assert.ok(c.b.log.some(line=>line.includes(data.skills.get(id).name+'！')),`${id}: ${c.b.log.at(-1)}`);
}
function resources(c,id){
  c.ally.contract={element:id==='summoner_A04'?'earth':id==='summoner_A05'?'water':'fire',charges:2,remaining:5,grantedClock:0};
  c.ally.seeds=[{growth:2,remaining:5,grantedClock:0},{growth:1,remaining:5,grantedClock:0}];
  if(['druid_A08','druid_A09'].includes(id))c.ally.beast={remaining:5,grantedClock:0};
  c.ally.forecasts=[{id:'astrologer_A01',name:'流星の予兆',type:'attack',power:1,element:'light',remaining:2,grantedClock:0,target:0,targets:[0],snapshot:{mag:40,spell:1}}];
  for(const member of c.game.party)member.hp=Math.max(1,maxHp(data,member)-80);
  c.member.ultimateGauge=100;
}

test('22〜24職の45技能は設計の全段階で習得・発動し、神殿Lv6で解放する',()=>{
  for(const job of natureSpecs.jobs){
    assert.equal(job.skills.length,15);const c=fixture(job.id);
    assert.ok(availableJobs(data,c.game).some(x=>x.id===job.id));
    c.game.facilities.temple=5;assert.ok(!availableJobs(data,c.game).some(x=>x.id===job.id));
    for(const source of job.skills){
      const skill=data.skills.get(source.id);assert.equal(skillMaxLevel(skill),source.maxLevel);
      assert.equal(skill.cost,source.cost);assert.deepEqual(skill.effect.prerequisites,source.prerequisites);
      for(let level=1;level<=source.maxLevel;level++){
        teach(c,source.id,level);
        const used=effectiveSkill(data,c.member,skill);assert.equal(used.effect.description,source.effects[level-1]);
        if(source.type==='passive')continue;
        const one=fixture(job.id);teach(one,source.id,level);resources(one,source.id);
        const r=used.effect.rules.nature;
        const choice=r.chooseContract?.find(x=>x!==one.ally.contract.element)??r.chooseContract?.[0]??r.chooseElement?.[0];
        act(one,source.id,source.target.includes('味方1人')?1:0,{element:choice,resourceIndex:0});
      }
    }
  }
});

test('契約は残回数と属性を保存し、変更は期限を伸ばさず回数を消費する',()=>{
  const c=fixture('summoner');for(const id of ['summoner_A01','summoner_A03','summoner_A07','summoner_A04'])teach(c,id);
  act(c,'summoner_A01',0,{element:'fire'});assert.equal(c.ally.contract.charges,2);
  act(c,'summoner_A03');assert.equal(c.ally.contract.charges,1);
  const remaining=c.ally.contract.remaining;act(c,'summoner_A07',0,{element:'earth'});
  assert.equal(c.ally.contract.charges,0);assert.ok(c.ally.contract.remaining<=remaining);
  assert.ok(actionOptions(data,c.game,c.b,0).skills.find(x=>x.skill.id==='summoner_A04').reason);
  c.b=structuredClone(c.b);c.ally=c.b.allies[0];assert.equal(c.ally.contract.element,'earth');
});

test('種は次の本人行動で育ち、獣化は術を禁じて再使用で無料解除できる',()=>{
  const c=fixture('druid');for(const id of ['druid_A01','druid_A02','druid_A06','druid_A07','druid_A08'])teach(c,id);
  act(c,'druid_A01');assert.equal(c.ally.seeds[0].growth,0);
  act(c,'druid_A02');assert.equal(c.ally.seeds[0].growth,1);
  act(c,'druid_A06',1,{resourceIndex:0});assert.equal(c.ally.seeds[0].growth,1);
  act(c,'druid_A07');assert.ok(c.ally.beast);
  assert.ok(actionOptions(data,c.game,c.b,0).skills.find(x=>x.skill.id==='druid_A02').reason);
  assert.equal(skillMp(data,c.member,data.skills.get('druid_A07'),{battle:c.b,actor:0}),0);
  act(c,'druid_A07');assert.equal(c.ally.beast,undefined);
});

test('予兆は後の行動終了時に発動し、加速と奥義は重複発動させない',()=>{
  const c=fixture('astrologer');for(const id of ['astrologer_A01','astrologer_A03','astrologer_A06','astrologer_U01'])teach(c,id);
  act(c,'astrologer_A01');assert.equal(c.ally.forecasts.length,1);
  const before=c.b.enemies[0].hp;
  act(c,'astrologer_A03');assert.ok(c.b.enemies[0].hp<before);assert.equal(c.ally.forecasts.length,0);
  act(c,'astrologer_A01');act(c,'astrologer_A06',0,{resourceIndex:0});assert.equal(c.ally.forecasts.length,0);
  c.member.ultimateGauge=100;act(c,'astrologer_U01');assert.equal(c.ally.forecasts.length,2);
  c.b=structuredClone(c.b);c.ally=c.b.allies[0];assert.equal(c.ally.forecasts.length,2);
});
