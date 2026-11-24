import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { loadData, prepareParty } from './balance.mjs';
import { BUILD_CATALOG } from './party-fixtures.mjs';
import { maxHp } from '../game/js/character.js';
import { createBattle, makeEnemy, setPending, resolvePending, collectBattleHits, nextTurn, prepareQuizAction } from '../game/js/battle.js';
import { makeQuestion } from '../game/js/quiz.js';

const data=loadData();
const dungeon=[...data.dungeons.values()].find(x=>x.rank===12&&x.kind==='標準');
const seed=613301, runs=120;
const skillIds={poison:'hexer_p1_s3',toxic:'apothecary_p3_s1',burn:'spellblade_p3_s2',bleed:'warrior_p3_s3',
  sleep:'bard_p2_s3',freeze:'spellblade_p3_s1',paralysis:'monk_p4_s1',seal:'monk_p2_s5',
  silence:'hexer_p3_s1',weaken:'bard_p3_s5',petrify:'hunter_p3_s5',doom:'hexer_p1_s5',confusion:'bard_p2_s4'};
const setup = new Map();
function fixture(job) {
  if (!setup.has(job)) {
    const id=BUILD_CATALOG.builds.find(b=>b.job===job).id;
    const donor=prepareParty(data,dungeon,id,'standard');
    const game=prepareParty(data,dungeon,'balanced6','standard');
    if (job !== 'warrior') game.party[0]={...donor.party[0],id:game.party[0].id};
    setup.set(job,game);
  }
  return structuredClone(setup.get(job));
}
const exemplar=[...data.monsters.values()].find(x=>x.rank===6&&!x.isBoss&&!x.status&&x.role==='normal');
function scene(job,i,boss=false){
  const game=fixture(job);
  for (const actor of game.party) actor.priorityStaticLoadout=true;
  const enemy=makeEnemy(data,exemplar.id,{lv:game.simulationFixture.level,dungeonId:dungeon.id,boss});
  enemy.hp=enemy.maxHp*=10;
  enemy.statusAffinity={};
  enemy.tactics=null;
  const battle=createBattle(data,game,{enemies:[enemy],seed:seed+i*7919,canFlee:false});
  battle.round=1;
  return {game,enemy,battle};
}
function manual({game,battle},action) {
  battle.turn={side:'ally',i:0};
  if (!prepareQuizAction(data,game,battle)) return {questions:0,hits:[]};
  setPending(battle,action,{wordId:'simulation'});
  const hits=collectBattleHits(battle,()=>resolvePending(data,game,battle,true));
  return {questions:1,hits};
}
const proc = Object.entries(skillIds).map(([status,id])=>{
  const skill=data.skills.get(id);
  const cases=['normal','boss','immune'].map(kind=>{
    let attempts=0, applied=0, mpSpent=0;
    for(let i=0;i<runs;i++){
      const c=scene(skill.job,i,kind==='boss');
      if(kind==='immune') c.enemy.statusAffinity[status]='×';
      const mp=c.game.party[0].mp;
      // Direct dispatch isolates RNG and immunity. Most skills are in the legal
      // fixture; dispatch here does not test loadout or cross-training fees.
      const step=manual(c,{type:'skill',skillId:id,target:0});
      const spent=mp-c.game.party[0].mp;
      attempts+=Number(step.questions&&spent>0);
      applied+=c.enemy.statusHits?.[status]??0;
      mpSpent+=spent;
    }
    return {kind,attempts,applied,meanMp:mpSpent/runs};
  });
  return {status,id,nominal:skill.effect.st[1],cases};
});
const forced=[];
for (const status of ['confusion','charm','sleep','freeze','bleed']) {
  let firstActorQuestions=0,automaticHits=0,mpSpent=0;
  for(let i=0;i<runs;i++){
    const c=scene('warrior',i);
    c.battle.allies[0].statuses[status]={turns:2,n:1};
    if(status==='bleed') c.game.party[0].hp=Math.ceil(maxHp(data,c.game.party[0])*.01);
    c.battle.queue=[{side:'ally',i:0},{side:'ally',i:1}];
    let turn,quiz;
    const before=c.game.party[0].mp;
    automaticHits+=collectBattleHits(c.battle,()=>{
      turn=nextTurn(data,c.game,c.battle);
      if(turn?.i===0)quiz=prepareQuizAction(data,c.game,c.battle);
    }).length;
    firstActorQuestions+=Number(Boolean(quiz));
    mpSpent+=Math.max(0,before-c.game.party[0].mp);
  }
  forced.push({status,questionsForFirstActor:firstActorQuestions,automaticHits,mpSpent});
}
const composite = [];
for (const aff of [
  {id:'immune+weak',immune:['slash'],weak:['fire'],resist:[],strongWeak:[]},
  {id:'immune+resist',immune:['slash'],resist:['fire'],weak:[],strongWeak:[]},
  {id:'both_immune',immune:['slash','fire'],weak:[],resist:[],strongWeak:[]},
  {id:'normal+strongWeak',immune:[],weak:[],resist:[],strongWeak:['fire']},
]) {
  let hits=0,damage=0,questions=0;
  for(let i=0;i<runs;i++){
    const c=scene('warrior',i);
    const m=c.game.party[0];
    m.equip.weapon={...m.equip.weapon,enchants:[...(m.equip.weapon.enchants??[]),{stat:'ELEMENT:fire',value:1}]};
    delete m.priorityStaticLoadout;
    Object.assign(c.enemy,aff);
    const r=manual(c,{type:'attack',target:0});
    hits+=r.hits.length;
    damage+=r.hits.reduce((s,h)=>s+h.damage,0);
    questions+=r.questions;
  }
  composite.push({id:aff.id,hits,damage:damage/runs,questions});
}
const enemyAct=(c,round)=>{
  c.battle.round=round;
  c.battle.turn=null;
  c.battle.queue=[{side:'enemy',i:0},{side:'ally',i:1}];
  return collectBattleHits(c.battle,()=>nextTurn(data,c.game,c.battle));
};
const ai=[];
for (const tactic of ['ward','disrupt','heal','sweep','regen','magic']) for(const counter of [false,true]){
  let acted=0,mp=0,deltaHp=0,hitCount=0,damage=0,round=1;
  for (let i=0;i<runs;i++){
    const c=scene('warrior',i,tactic==='sweep');
    const e=c.enemy;
    e.hp=Math.round(e.maxHp*.48);
    if(tactic==='ward'){e.tactics='ward';e.weak=['fire'];e.lastWeakElement='fire';}
    if(tactic==='disrupt'){e.tactics='disrupt';round=2;}
    if(tactic==='heal')e.tactics='heal';
    if(tactic==='sweep')round=data.balance.boss_patterns.sweep_every;
    if(tactic==='regen')e.regen=.08;
    if(tactic==='magic'){e.magicRate=1;e.mp=counter?0:e.maxMp;e.mpRegen=0;}
    if(counter&&tactic!=='magic')e.statuses[tactic==='regen'||tactic==='heal'?'curse':tactic==='sweep'?'fear':'silence']={turns:3,n:1};
    const before=e.hp,beforeMp=e.mp,hits=enemyAct(c,round);
    deltaHp+=e.hp-before;
    mp+=beforeMp-e.mp;
    hitCount+=hits.length;
    damage+=hits.filter(h=>h.target.side==='ally').reduce((s,h)=>s+h.damage,0);
    acted+=Number(tactic==='ward'?Boolean(e.buffs?.['guard:fire']):tactic==='disrupt'?c.battle.allies.some(a=>a.buffs['down:str']):
      tactic==='heal'||tactic==='regen'?e.hp>before:tactic==='sweep'?beforeMp-e.mp>=4:beforeMp-e.mp>=2);
  }
  ai.push({tactic,counter,acted,enemyMpNet:mp/runs,enemyHpDelta:deltaHp/runs,hits:hitCount/runs,damage:damage/runs});
}
const word={id:'a',en:'apple',ja:'りんご'};
const words=[word,{id:'b',en:'orange',ja:'みかん'},{id:'c',en:'pear',ja:'梨'},{id:'d',en:'melon',ja:'メロン'}];
const probeQuestion=makeQuestion(word,{words,wordsByStone:new Map()},{direction:'en_ja',familiar:false,rng:()=>.5});
assert.equal(probeQuestion.choices.length,4);
assert.equal(proc.find(x=>x.status==='petrify').cases[1].applied,0);
assert.equal(proc.find(x=>x.status==='doom').cases[1].applied,0);
assert.equal(composite.find(x=>x.id==='both_immune').hits,0);
assert.equal(forced.find(x=>x.status==='charm').questionsForFirstActor,0);
writeFileSync(process.argv[2]??'sim/results/four-priority-protocol.json',JSON.stringify({
  seed,runs,stride:7919,exemplar:exemplar.id,componentTests:'Controlled runtime probes with synthetic inputs; offensive skills are dispatched directly. Not a loadout legality or encounter frequency test.',
  quizChoices:probeQuestion.choices.length,comboSource:'sword slash + fire enchant (best affinity)',proc,forced,composite,ai,
  options:{bossControlMultiplier:data.balance.battle_formulas.boss_control_mul,bossStatusMultiplier:data.balance.battle_formulas.boss_status_mul,
    bossDotMultiplier:data.balance.battle_formulas.boss_dot_mul,dotCap:data.balance.battle_formulas.dot_tick_cap,
    affinities:[0,data.balance.battle.resist,1,data.balance.battle.weak,2],
    fearHasStandaloneSkill:[...data.skills.values()].some(s=>s.effect.st?.[0]===data.statusEffects.get('fear').name)},
})+'\n');
console.log('Controlled probes:',proc.length,forced.length,composite.length,ai.length);
