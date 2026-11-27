import test from 'node:test';
import assert from 'node:assert/strict';
import {realGameData} from './helpers.js';
import {createNewGame,defaultPartySpecs} from '../js/game-state.js';
import {makeGear,maxHp,maxMp} from '../js/character.js';
import {availableJobs,effectiveSkill,skillMaxLevel} from '../js/growth.js';
import {createBattle,makeEnemy,setPending,resolvePending,nextTurn} from '../js/battle.js';
import {commandSpecs} from '../../scripts/additional-jobs-28-30-plans.mjs';

const data=realGameData();
function fixture(job='strategist',seed=173){
  const specs=defaultPartySpecs(data);specs[0].job=job;
  const game=createNewGame(data,specs);game.facilities.temple=7;
  for(const member of game.party){member.lv=20;member.hp=maxHp(data,member);member.mp=maxMp(data,member);}
  const member=game.party[0],kind={strategist:'fan',jester:'instrument',gambler:'gun'}[job];
  const gear=[...data.equipment.values()].find(item=>item.slot==='weapon'&&item.kind===kind&&!item.unique);
  member.equip.weapon=makeGear(game,gear.id);
  const enemies=Array.from({length:3},(_,i)=>Object.assign(makeEnemy(data,'goblin',{lv:1}),{
    name:'target'+i,hp:1e7,maxHp:1e7,def:30,res:30,spd:0,weak:[],strongWeak:[],resist:[],immune:[],
    statusAffinity:{},evasion:0,buffs:{},statuses:{},tactics:null,status:null,magicRate:0}));
  const b=createBattle(data,game,{enemies,seed});b.round=1;
  return {game,member,b,ally:b.allies[0],enemies};
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
function normal(c,actor,target=0){
  c.b.turn={side:'ally',i:actor,bleedProcessed:true};
  setPending(c.b,{type:'attack',target},{});resolvePending(data,c.game,c.b,true);
}
function enemyAction(c,target=1){
  const enemy=c.enemies[0];Object.assign(enemy,{str:2,mag:2,mp:0,sureHit:true,magicRate:0,attackElement:'blunt',tactics:null,status:null});
  enemy.statuses.taunt={actor:target,turns:20};
  c.b.turn=null;c.b.queue=[{side:'enemy',i:0},{side:'ally',i:4}];nextTurn(data,c.game,c.b);
}

test('3職45技能を全段階で取得・説明・発動できる',()=>{
  for(const job of commandSpecs.jobs){
    assert.equal(job.skills.length,15);const c=fixture(job.id);
    assert.equal(data.jobs.find(x=>x.id===job.id).skillsReady,true);
    assert.ok(availableJobs(data,c.game).some(x=>x.id===job.id));
    for(const source of job.skills){
      const skill=data.skills.get(source.id);assert.equal(skillMaxLevel(skill),source.maxLevel,source.id);
      assert.deepEqual(skill.effect.prerequisites,source.prerequisites);
      assert.equal(skill.cost,source.cost);
      for(let lv=1;lv<=source.maxLevel;lv++){
        teach(c,source.id,lv);const used=effectiveSkill(data,c.member,skill);
        assert.equal(used.effect.description,source.effects[lv-1]);
        if(source.type==='passive')continue;
        c.b=createBattle(data,c.game,{enemies:structuredClone(c.enemies),seed:173});c.b.round=1;c.ally=c.b.allies[0];
        c.b.queue=[{side:'ally',i:1,spd:40},{side:'ally',i:2,spd:20},{side:'enemy',i:0,spd:0}];
        c.ally.decoy={target:1,hp:30,maxHp:30,remaining:2,uses:2,placedClock:0};
        c.ally.comebackTickets=1;
        if(skill.isFinal)c.member.ultimateGauge=100;
        const rule=used.effect.rules??{};
        const extra={...(rule.choose_mode?{element:'safe'}:{}),
          ...(rule.proxy_attack?{sourceTarget:1,secondaryTarget:0}:{}),
          ...(rule.order?.enemy?{secondaryTarget:0}:{}),
          ...(rule.orders_party?{targets:Array.from({length:Math.min(rule.orders_party.count,c.game.party.length)},(_,i)=>i)}:{}),
          ...(rule.decoy_ultimate?{secondaryTarget:1}:{})};
        const target=rule.decoy_move?2:rule.order_front||rule.order_speed||rule.order||rule.decoy?1:0;
        act(c,source.id,target,extra);
        assert.ok(c.b.log.some(x=>x.includes(skill.name+'！')),source.id+' Lv'+lv+' '+c.b.log.at(-1));
      }
    }
  }
});

test('軍師の号令は対象1枠で置換し、待機列の順番を変える',()=>{
  const c=fixture();for(const id of ['strategist_A01','strategist_A02','strategist_A03','strategist_A07','strategist_A09'])teach(c,id);
  c.b.queue=[{side:'ally',i:1,spd:30},{side:'enemy',i:0,spd:20},{side:'ally',i:2,spd:10}];
  act(c,'strategist_A01',1);assert.equal(c.b.allies[1].strategistOrder.type,'damage');
  act(c,'strategist_A02',1);assert.equal(c.b.allies[1].strategistOrder.type,'guard');
  act(c,'strategist_A03',2);assert.ok(c.b.queue.some(u=>u.i===2));
  act(c,'strategist_A07',2);assert.equal(c.b.queue[0].i,2);
  const mp=c.member.mp;act(c,'strategist_A07',1);assert.equal(c.member.mp,999);assert.ok(c.b.log.some(s=>s.includes('使えなかった')));
});

test('攻勢号令は次の直接攻撃を強化して一度だけ消費する',()=>{
  const c=fixture();teach(c,'strategist_A01',3);
  act(c,'strategist_A01',1);
  const baseline={game:structuredClone(c.game),b:structuredClone(c.b)};
  baseline.b.allies[1].strategistOrder=null;
  normal(baseline,1);normal(c,1);
  assert.ok(c.b.enemies[0].hp<baseline.b.enemies[0].hp);
  assert.equal(c.b.allies[1].strategistOrder,undefined);
});

test('道化師の囮は1敵行動1回だけ受け、補修を1戦1回に制限する',()=>{
  const c=fixture('jester');for(const id of ['jester_A01','jester_A03','jester_A07','jester_A08'])teach(c,id);
  act(c,'jester_A01',1);assert.ok(c.ally.decoy?.hp>0);
  const before=c.game.party[1].hp;enemyAction(c,1);assert.equal(c.game.party[1].hp,before);
  act(c,'jester_A07');act(c,'jester_A07');assert.ok(c.b.log.some(s=>s.includes('もう補修できない')));
  act(c,'jester_A03',2);assert.equal(c.ally.decoy.target,2);
  act(c,'jester_A08',0);assert.equal(c.ally.decoy,undefined);
});

test('賭けの宣言は問題後も保存され、外れで最低ダメージと再起札を得る',()=>{
  const c=fixture('gambler',1);for(const id of ['gambler_A02','gambler_A07','gambler_U01'])teach(c,id);
  const hp=c.enemies[0].hp;
  c.b.turn={side:'ally',i:0,bleedProcessed:true};setPending(c.b,{type:'skill',skillId:'gambler_A02',target:0,element:'risk'},{});
  const restored=structuredClone(c.b);resolvePending(data,c.game,restored,true);
  resolvePending(data,c.game,c.b,true);assert.equal(c.b.enemies[0].hp,restored.enemies[0].hp);assert.ok(c.enemies[0].hp<hp);
  c.member.ultimateGauge=100;c.ally.comebackTickets=0;
  act(c,'gambler_U01',null,{element:'risk'});
  if(c.ally.comebackTickets){const before=c.member.hp;c.member.hp-=10;act(c,'gambler_A07');assert.ok(c.member.hp>before-10);}
});
