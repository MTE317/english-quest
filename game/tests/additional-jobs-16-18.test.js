import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {realGameData,MemoryStorage} from './helpers.js';
import {createNewGame,defaultPartySpecs,normalizeGame} from '../js/game-state.js';
import {makeGear,maxHp,maxMp} from '../js/character.js';
import {availableJobs,changeJob,learnSkill,effectiveSkill,skillMaxLevel} from '../js/growth.js';
import {createBattle,makeEnemy,setPending,resolvePending,nextTurn,actionOptions,skillMp} from '../js/battle.js';
import {activeField,ownCurseMark,masterDamageBonus,masterCutBonus,masterStatusMultiplier} from '../js/job-combat.js';
import {allyEffectEntries,battleConditionLabels} from '../js/ui/battle-view.js';
import {describeSkillForUI,describeSkillEffect} from '../js/skill-effects.js';
import {GameSession} from '../js/save.js';

const data=realGameData(),ids=['elementalist','witch','hexer'];
const spec=JSON.parse(readFileSync(new URL('../../docs/specs/additional-jobs-10-18-skills-v1.json',import.meta.url),'utf8'));
function fixture(job='elementalist',count=3,seed=65){
  const specs=defaultPartySpecs(data);specs[0].job=job;
  const game=createNewGame(data,specs);
  game.facilities.temple=12;
  for(const m of game.party){m.lv=20;m.hp=maxHp(data,m);m.mp=maxMp(data,m);}
  const member=game.party[0];member.ap=10000;
  const kind=job==='witch'?'scythe':'staff';
  const gear=[...data.equipment.values()].filter(e=>e.slot==='weapon'&&e.kind===kind&&!e.unique).sort((a,b)=>a.itemLv-b.itemLv)[0];
  member.equip.weapon=makeGear(game,gear.id);
  const enemies=Array.from({length:count},(_,index)=>Object.assign(makeEnemy(data,'goblin',{lv:1}),{
    name:'target'+index,hp:1e7,maxHp:1e7,def:30,res:30,spd:0,weak:[],strongWeak:[],resist:[],immune:[],statusAffinity:{},evasion:0,buffs:{}}));
  const b=createBattle(data,game,{enemies,seed});b.round=1;
  return {game,member,b,enemies,ally:b.allies[0]};
}
function teach(c,id,level=1){
  const s=data.skills.get(id);
  c.member.learned=[...new Set([...c.member.learned,id])];
  c.member.skillLevels??={};c.member.skillLevels[id]=level;
  if(s.isFinal)c.member.loadout.ultimate=id;
  else {const key=s.kind==='passive'?'passives':'actions';c.member.loadout[key]=[...new Set([...c.member.loadout[key],id])];}
}
function act(c,id=null,target=0,extra={},correct=true){
  c.b.turn={side:'ally',i:0,bleedProcessed:true};
  setPending(c.b,id?{type:'skill',skillId:id,target,...extra}:{type:'attack',target},{});
  return resolvePending(data,c.game,c.b,correct);
}
function enemyActs(c,{magicRate=0,tactics=null}={}){
  const e=c.enemies[0];
  Object.assign(e,{str:1,mag:1,mp:100,magicRate,tactics,sureHit:true,attackElement:'water'});
  e.statuses.taunt={actor:0,turns:20};
  c.b.turn=null;c.b.pending=null;c.b.queue=[{side:'enemy',i:0},{side:'ally',i:4}];
  nextTurn(data,c.game,c.b);
}
const reset=c=>{c.member.mp=Math.max(999,maxMp(data,c.member));};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('追加16〜18職の45技能・143段階・転職・セーブ後の習得が設計と一致する',()=>{
assert.equal(data.jobs.filter(j=>j.skillsReady).length,50);
  assert.equal([...data.skills.values()].filter(s=>s.effect.master).length,750);
  let stages=0;
  for(const j of spec.jobs.filter(j=>ids.includes(j.id))){
    const c=fixture(j.id);
    assert.ok(availableJobs(data,c.game,c.member).some(x=>x.id===j.id));
    changeJob(data,c.game,0,'warrior');changeJob(data,c.game,0,j.id);
    for(const source of j.skills){
      const skill=data.skills.get(source.id);assert.equal(skillMaxLevel(skill),source.maxLevel);
      assert.deepEqual(skill.effect.prerequisites,source.prerequisites);
      for(let lv=1;lv<=source.maxLevel;lv++){
        const used=effectiveSkill(data,{learned:[skill.id],skillLevels:{[skill.id]:lv}},skill);
        assert.equal(describeSkillEffect(data,used),source.effects[lv-1]);
        assert.equal(describeSkillForUI(data,used),source.simpleDescriptions[lv-1]);
        stages++;
      }
    }
    const first=j.skills.find(x=>x.maxLevel>1&&!x.prerequisites.length);
    learnSkill(data,c.member,first.id);
    assert.ok(normalizeGame(data,structuredClone(c.game)).party[0].learned.includes(first.id));
  }
  assert.equal(stages,143);
});

test('3職の全アクティブ・奥義を全成長段階で実行できる',()=>{
  for(const j of spec.jobs.filter(j=>ids.includes(j.id)))for(const source of j.skills.filter(s=>s.type!=='passive'))
    for(let lv=1;lv<=source.maxLevel;lv++){
      const c=fixture(j.id),id=source.id,skill=data.skills.get(id);teach(c,id,lv);reset(c);
      if(id==='elementalist_A07'||id==='elementalist_A08')
        c.b.field={source:0,element:'wind',rate:.15,remaining:3,grantedClock:0};
      if(['witch_A05','witch_A07','witch_A09'].includes(id))
        c.ally.familiar={mode:'pursuit',uses:3,remaining:3,grantedClock:0};
      if(id==='hexer_A07')c.enemies[0].curseMarks={0:{variant:'bitter',source:0,uses:2,remaining:3}};
      if(skill.isFinal)c.member.ultimateGauge=100;
      const current=effectiveSkill(data,c.member,skill).effect,choice=current.rules?.choose_mode?.[id==='witch_A05'?1:0]
        ??current.rules?.choose_element?.[0];
      const extra={...(choice?{element:choice}:{}),...(current.select_targets?{targets:[0,1].slice(0,current.target_limit)}:{})};
      act(c,id,0,extra);
      assert.ok(c.b.log.some(line=>line.includes(skill.name+'！')),id+' Lv'+lv+' '+c.b.log.at(-1));
      if(skill.isFinal)assert.equal(c.member.ultimateGauge,0,id);
    }
});

test('精霊の場は単一枠で入替・所有者期限・属性ダメージ・防護を扱う',()=>{
  const c=fixture();for(const id of ['elementalist_A01','elementalist_A02','elementalist_A04','elementalist_A07','elementalist_A08','elementalist_P01','elementalist_P03'])teach(c,id,3);
  act(c,'elementalist_A01');assert.equal(activeField(c.game,c.b).element,'wind');
  near(masterDamageBonus(data,c.game,c.b,0,0,data.skills.get('elementalist_A04'),['wind']),.25);
  reset(c);act(c,'elementalist_A07');assert.equal(c.b.allies[1].masterEffects.elementalist_A07.fieldGuard.element,'wind');
  reset(c);act(c,'elementalist_A02');assert.equal(c.b.field.element,'earth');
  assert.equal(c.b.allies[1].masterEffects.elementalist_A07.fieldGuard.element,'wind');
  reset(c);act(c,'elementalist_A08');assert.equal(c.b.field,undefined);
  assert.ok(c.ally.masterEffects.elementalist_A08.conditionalMagic);
  assert.ok(allyEffectEntries(data,c.game,c.b,0).flatMap(([,xs])=>xs.map(x=>x.label)).some(x=>x.includes('次の')));
});

test('使い魔は選択した型・反応3回・契約能力の固定・指図と解放を管理する',()=>{
  const c=fixture('witch');
  for(const id of ['witch_A02','witch_A03','witch_A05','witch_A07','witch_A09','witch_P01'])teach(c,id);
  act(c,'witch_A02',0,{element:'pursuit'});assert.equal(c.ally.familiar.uses,3);
  near(c.ally.familiar.m,.3);
  teach(c,'witch_P05',3);
  reset(c);act(c,'witch_A05',0,{element:'mischief'});assert.equal(c.ally.familiar.mode,'mischief');
  const before=c.member.mp;act(c,'witch_A05',0,{element:'mischief'});assert.equal(c.member.mp,before);
  reset(c);act(c,'witch_A07');assert.equal(c.ally.familiar,undefined);assert.ok(c.ally.masterEffects.witch_A07.shield>0);
  reset(c);act(c,'witch_A02',0,{element:'pursuit'});
  reset(c);act(c,'witch_A03');assert.equal(c.ally.familiar.uses,2);
  reset(c);act(c,'witch_A09');assert.equal(c.ally.familiar,undefined);
  near(c.ally.masterEffects.witch_A09.conditionalMagic.rate,.2);
});

test('苦呪印は敵行動の終了後にだけ反応し、刻印時の威力と残数を保存する',()=>{
  const c=fixture('hexer');for(const id of ['hexer_A01','hexer_P01','hexer_P03','hexer_A07','hexer_A08'])teach(c,id,3);
  act(c,'hexer_A01',0,{targets:[0,1]});
  assert.equal(ownCurseMark(c.b,0,0).uses,2);
  near(ownCurseMark(c.b,0,0).m,.4);
  assert.equal(c.enemies[0].hp,1e7);
  enemyActs(c);assert.equal(ownCurseMark(c.b,0,0).uses,1);
  assert.ok(c.enemies[0].hp<1e7);
  assert.ok(c.ally.masterEffects.hexer_P01);
  assert.ok(battleConditionLabels(data,c.enemies[0]).some(x=>x.includes('苦呪印')));
  reset(c);act(c,'hexer_A07',1);assert.equal(ownCurseMark(c.b,0,1),null);
  assert.ok(c.ally.masterEffects.hexer_A07.conditionalMagic);
});

test('呪印の資源・使い魔の型・場の所有を検証し、無効行動ではMPを消費しない',()=>{
  const c=fixture('hexer');teach(c,'hexer_A07');const mp=c.member.mp;
  assert.match(actionOptions(data,c.game,c.b,0).skills.find(x=>x.skill.id==='hexer_A07').reason,/呪印/);
  act(c,'hexer_A07');assert.equal(c.member.mp,mp);
  const w=fixture('witch');teach(w,'witch_A05');const wmp=w.member.mp;
  act(w,'witch_A05',0,{element:'pursuit'});assert.equal(w.member.mp,wmp);
  const e=fixture();teach(e,'elementalist_A08');const emp=e.member.mp;
  act(e,'elementalist_A08');assert.equal(e.member.mp,emp);
});

test('場・使い魔・呪印は保存後も残回数と刻印時の能力を保持する',()=>{
  const c=fixture('witch');
  teach(c,'witch_A02');act(c,'witch_A02',0,{element:'pursuit'});
  c.b.field={source:0,element:'water',rate:.15,remaining:2,grantedClock:c.b.actionClock};
  c.enemies[0].curseMarks={0:{variant:'bitter',source:0,uses:2,remaining:3,power:99,m:.25,cm:1}};
  const storage=new MemoryStorage(),session=new GameSession({storage});
  session.startNew(c.game);session.enterDungeon({dungeonId:[...data.dungeons.keys()][0]});session.setBattle(c.b);
  const restored=new GameSession({storage});normalizeGame(data,restored.game,restored.run);
  assert.deepEqual(restored.run.battle.field,c.b.field);
  assert.deepEqual(restored.run.battle.allies[0].familiar,c.ally.familiar);
  assert.deepEqual(restored.run.battle.enemies[0].curseMarks,c.enemies[0].curseMarks);
});
