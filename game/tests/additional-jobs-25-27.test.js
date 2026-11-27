import test from 'node:test';
import assert from 'node:assert/strict';
import {realGameData} from './helpers.js';
import {createNewGame,defaultPartySpecs} from '../js/game-state.js';
import {makeGear,maxHp,maxMp} from '../js/character.js';
import {availableJobs,effectiveSkill,skillMaxLevel} from '../js/growth.js';
import {createBattle,makeEnemy,setPending,resolvePending,nextTurn,actionOptions} from '../js/battle.js';
import {companionSpecs} from '../../scripts/additional-jobs-25-27-plans.mjs';

const data=realGameData();
function fixture(job='beastmaster',seed=173){
  const specs=defaultPartySpecs(data);specs[0].job=job;
  const game=createNewGame(data,specs);game.facilities.temple=7;
  for(const member of game.party){member.lv=20;member.hp=maxHp(data,member);member.mp=maxMp(data,member);}
  const member=game.party[0],kind={beastmaster:'whip',puppeteer:'instrument',dancer:'fan'}[job];
  const gear=[...data.equipment.values()].find(item=>item.slot==='weapon'&&item.kind===kind&&!item.unique);
  member.equip.weapon=makeGear(game,gear.id);
  const enemies=Array.from({length:3},(_,i)=>Object.assign(makeEnemy(data,'goblin',{lv:1}),{
    name:'target'+i,hp:1e7,maxHp:1e7,def:30,res:30,spd:0,weak:[],strongWeak:[],resist:[],immune:[],
    statusAffinity:{},evasion:0,buffs:{},statuses:{},tactics:null,status:null,magicRate:0}));
  const b=createBattle(data,game,{enemies,seed});b.round=1;return {game,member,b,ally:b.allies[0],enemies};
}
function teach(c,id,level=1){
  const skill=data.skills.get(id);assert.ok(skill,id);
  c.member.learned=[...new Set([...c.member.learned,id])];c.member.skillLevels??={};c.member.skillLevels[id]=level;
  if(skill.isFinal)c.member.loadout.ultimate=id;
  else {const key=skill.kind==='passive'?'passives':'actions';c.member.loadout[key]=[...new Set([...c.member.loadout[key],id])];}
}
function act(c,id,target=0,extra={}){
  c.member.mp=999;c.b.turn={side:'ally',i:0,bleedProcessed:true};
  setPending(c.b,{type:'skill',skillId:id,target,...extra},{});resolvePending(data,c.game,c.b,true);
}
function enemyAction(c,target=1){
  const enemy=c.enemies[0];Object.assign(enemy,{str:2,mag:2,mp:0,sureHit:true,magicRate:0,attackElement:'blunt',tactics:null,status:null});
  enemy.statuses.taunt={actor:target,turns:20};
  c.b.turn=null;c.b.queue=[{side:'enemy',i:0},{side:'ally',i:4}];nextTurn(data,c.game,c.b);
}

test('3職45技能を全段階で取得・説明・発動できる',()=>{
  for(const job of companionSpecs.jobs){
    assert.equal(job.skills.length,15);const c=fixture(job.id);
    assert.equal(data.jobs.find(x=>x.id===job.id).skillsReady,true);
    assert.ok(availableJobs(data,c.game).some(x=>x.id===job.id));
    for(const source of job.skills){
      const skill=data.skills.get(source.id);assert.equal(skillMaxLevel(skill),source.maxLevel,source.id);
      assert.deepEqual(skill.effect.prerequisites,source.prerequisites);
      assert.equal(skill.cost,source.cost);assert.equal(skill.mp,source.type==='active'?{軽:3,中:6,重:12}[source.mpBand]:0);
      for(let lv=1;lv<=source.maxLevel;lv++){
        teach(c,source.id,lv);const used=effectiveSkill(data,c.member,skill);
        assert.equal(used.effect.description,source.effects[lv-1]);
        if(source.type==='passive')continue;
        c.b=createBattle(data,c.game,{enemies:structuredClone(c.enemies),seed:173});c.b.round=1;c.ally=c.b.allies[0];
        c.ally.companion={hp:30,maxHp:30,remaining:5,grantedClock:0};
        c.ally.puppet={hp:30,maxHp:30,remaining:5,grantedClock:0,stance:['puppeteer_A04','puppeteer_A08'].includes(source.id)?'guard':'attack'};
        c.ally.rhythm=2;c.ally.lastDance='spin';
        if(skill.isFinal)c.member.ultimateGauge=100;
        const action=used.effect.rules?.choose_mode?{element:'attack'}:{};
        const target=['beastmaster_A05','puppeteer_A04','dancer_A07'].includes(source.id)?1:0;
        act(c,source.id,target,action);
        assert.ok(c.b.log.some(x=>x.includes(skill.name+'！')),source.id+' Lv'+lv+' '+c.b.log.at(-1));
      }
    }
  }
});

test('相棒の指示・二段連携・身代わり・修復上限',()=>{
  const c=fixture();for(const id of ['beastmaster_A01','beastmaster_A03','beastmaster_A05','beastmaster_A06','beastmaster_A07'])teach(c,id);
  act(c,'beastmaster_A01');assert.ok(c.ally.companion?.hp>0);
  const hp=c.enemies[0].hp;act(c,'beastmaster_A03');assert.ok(c.enemies[0].hp<hp);
  const before=c.enemies[0].hp;act(c,'beastmaster_A07');assert.ok(c.enemies[0].hp<before);
  assert.ok(c.b.log.some(x=>x.includes('相棒の連携')));
  act(c,'beastmaster_A05',1);const guarded=c.game.party[1].hp;enemyAction(c,1);
  assert.ok(c.ally.companion.hp<c.ally.companion.maxHp);assert.equal(c.game.party[1].hp,guarded);
  act(c,'beastmaster_A06');act(c,'beastmaster_A06');const mp=c.member.mp;
  act(c,'beastmaster_A06');assert.ok(c.b.log.some(x=>x.includes('使えなかった')));
  assert.ok(c.member.mp>=mp-1);
});

test('人形は構えで技能を制限し、防御・修復・奥義で再展開する',()=>{
  const c=fixture('puppeteer');for(const id of ['puppeteer_A01','puppeteer_A02','puppeteer_A03','puppeteer_A04','puppeteer_A05','puppeteer_A08','puppeteer_U01'])teach(c,id);
  act(c,'puppeteer_A01');assert.equal(c.ally.puppet.stance,'attack');
  act(c,'puppeteer_A03');assert.equal(c.ally.puppet.stance,'guard');
  const mp=c.member.mp;act(c,'puppeteer_A02');assert.equal(c.member.mp,999);
  act(c,'puppeteer_A04',1);const hp=c.game.party[1].hp;enemyAction(c,1);
  assert.ok(c.game.party[1].hp>=hp-1);assert.ok(c.b.log.some(x=>x.includes('人形が')));
  act(c,'puppeteer_A01');act(c,'puppeteer_A03');c.ally.puppet.hp=Math.max(1,c.ally.puppet.maxHp-5);
  act(c,'puppeteer_A05');assert.ok(c.ally.puppet.hp>0);
  act(c,'puppeteer_A08');assert.ok(c.b.allies[1].masterEffects.puppeteer_A08.shield>0);
  delete c.ally.puppet;c.member.ultimateGauge=100;act(c,'puppeteer_U01');assert.equal(c.ally.puppet.stance,'attack');
});

test('舞は交互に使うと2まで蓄積し、締めで消費する',()=>{
  const c=fixture('dancer');for(const id of ['dancer_A01','dancer_A02','dancer_A05','dancer_A06'])teach(c,id);
  act(c,'dancer_A01');assert.equal(c.ally.rhythm,0);
  act(c,'dancer_A02');assert.equal(c.ally.rhythm,1);
  act(c,'dancer_A01');assert.equal(c.ally.rhythm,2);
  act(c,'dancer_A05');assert.equal(c.ally.rhythm,0);
  assert.equal(c.ally.lastDance,null);
  act(c,'dancer_A02');act(c,'dancer_A01');act(c,'dancer_A06');
  assert.ok(c.b.allies[1].masterEffects['dancer_A06:damage']?.nextDamage.rate>.08);
});
