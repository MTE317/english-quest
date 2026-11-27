import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {realGameData} from './helpers.js';
import {createNewGame,defaultPartySpecs,normalizeGame} from '../js/game-state.js';
import {makeGear,maxHp,maxMp} from '../js/character.js';
import {availableJobs,changeJob,learnSkill,effectiveSkill,skillMaxLevel} from '../js/growth.js';
import {createBattle,makeEnemy,setPending,resolvePending,actionOptions,skillMp} from '../js/battle.js';
import {masterDamageBonus,masterCutBonus,beginMasterAction} from '../js/job-combat.js';
import {allyEffectEntries} from '../js/ui/battle-view.js';
import {describeSkillForUI,describeSkillEffect} from '../js/skill-effects.js';

const data=realGameData(),jobs=['gunner','pirate','spellblade'];
const spec=JSON.parse(readFileSync(new URL('../../docs/specs/additional-jobs-10-18-skills-v1.json',import.meta.url),'utf8'));
function fixture(job='gunner',count=3,seed=61){
  const specs=defaultPartySpecs(data);specs[0].job=job;
  const game=createNewGame(data,specs);
  game.facilities.temple=12;
  for(const m of game.party){m.lv=20;m.hp=maxHp(data,m);m.mp=maxMp(data,m);}
  const member=game.party[0];member.ap=10000;
  const kind=job==='gunner'?'gun':job==='pirate'?'sword':'katana';
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
function act(c,id=null,target=0,extra={}){
  c.b.turn={side:'ally',i:0,bleedProcessed:true};
  setPending(c.b,id?{type:'skill',skillId:id,target,...extra}:{type:'attack',target}, {});
  return resolvePending(data,c.game,c.b,true);
}
const reset=c=>{c.member.mp=maxMp(data,c.member);};
const near=(x,y)=>assert.ok(Math.abs(x-y)<1e-8,`${x} != ${y}`);

test('13〜15職は45技能・147段階を設計に沿って読み込み、転職と継承ができる',()=>{
assert.equal(data.jobs.filter(j=>j.skillsReady).length,38);
  assert.equal([...data.skills.values()].filter(s=>s.effect.master).length,570);
  let stages=0;
  for(const j of spec.jobs.filter(j=>jobs.includes(j.id))){
    const c=fixture(j.id);
    assert.ok(availableJobs(data,c.game,c.member).some(x=>x.id===j.id));
    changeJob(data,c.game,0,'warrior');changeJob(data,c.game,0,j.id);
    for(const source of j.skills){
      const skill=data.skills.get(source.id);assert.ok(skill);
      assert.equal(skillMaxLevel(skill),source.maxLevel);
      assert.deepEqual(skill.effect.prerequisites,source.prerequisites);
      for(let lv=1;lv<=source.maxLevel;lv++){
        const used=effectiveSkill(data,{learned:[skill.id],skillLevels:{[skill.id]:lv}},skill);
        assert.equal(describeSkillEffect(data,used),source.effects[lv-1]);
        assert.equal(describeSkillForUI(data,used),source.simpleDescriptions[lv-1]);
        stages++;
      }
    }
    const skill=j.skills.find(s=>s.maxLevel>1&&!s.prerequisites.length);
    const before=c.member.ap;learnSkill(data,c.member,skill.id);
    assert.ok(c.member.ap<before);
    assert.equal(normalizeGame(data,structuredClone(c.game)).party[0].learned.includes(skill.id),true);
  }
  assert.equal(stages,147);
});

test('3職の全アクティブ技・奥義を全成長段階で発動できる',()=>{
  for(const j of spec.jobs.filter(j=>jobs.includes(j.id))) for(const source of j.skills.filter(s=>s.type!=='passive'))
    for(let lv=1;lv<=source.maxLevel;lv++){
      const c=fixture(j.id),id=source.id,skill=data.skills.get(id);
      teach(c,id,lv);
      if(j.id==='gunner')c.ally.loaded=id==='gunner_A02'?0:3;
      if(id==='pirate_A07')c.ally.masterEffects.pirate_P01={momentum:{rate:.15},remaining:2};
      if(id==='pirate_A04'){
        const gun=[...data.equipment.values()].find(e=>e.slot==='weapon'&&e.kind==='gun'&&!e.unique);
        c.member.equip.weapon=makeGear(c.game,gun.id);
      }
      if(id==='spellblade_A06'||id==='spellblade_A07')
        c.ally.weaponEnchant={element:'fire',remaining:3,grantedClock:0};
      if(skill.isFinal)c.member.ultimateGauge=100;
      c.member.mp=Math.max(c.member.mp,999);
      const action=skill.effect.rules?.choose_element?{element:'fire'}:
        skill.effect.select_targets?{targets:[0,1].slice(0,effectiveSkill(data,c.member,skill).effect.target_limit)}:{};
      act(c,id,0,action);
      assert.ok(c.b.log.some(line=>line.includes(skill.name+'！')),id+' Lv'+lv+' '+c.b.log.at(-1));
      if(skill.isFinal)assert.equal(c.member.ultimateGauge,0,id);
    }
});

test('装弾は最大3、特別弾はMPより先に弾数を検証し、奥義の補充は装弾パッシブを発動しない',()=>{
  const c=fixture();for(const id of ['gunner_A02','gunner_A03','gunner_A06','gunner_P01','gunner_U01'])teach(c,id,id==='gunner_A02'?3:1);
  const before=c.member.mp;
  assert.match(actionOptions(data,c.game,c.b,0).skills.find(x=>x.skill.id==='gunner_A03').reason,/装填/);
  act(c,'gunner_A03');assert.equal(c.member.mp,before);assert.equal(c.ally.loaded,0);
  act(c,'gunner_A02');assert.equal(c.ally.loaded,3);assert.ok(c.ally.masterEffects.gunner_P01);
  reset(c);act(c,'gunner_A06');assert.equal(c.ally.loaded,1);assert.ok(!c.ally.masterEffects.gunner_P01);
  reset(c);act(c,'gunner_A02');assert.equal(c.ally.loaded,3);
  const mp=c.member.mp;act(c,'gunner_A02');assert.equal(c.member.mp,mp);
  c.member.ultimateGauge=100;act(c,'gunner_U01');assert.equal(c.ally.loaded,3);
  assert.ok(!c.ally.masterEffects.gunner_P01);
});

test('銃技の命中・会心準備と束縛特効は一度の武器技にだけ働く',()=>{
  const c=fixture();for(const id of ['gunner_A01','gunner_A02','gunner_A07','gunner_P01','gunner_P04','gunner_P05'])teach(c,id,3);
  act(c,'gunner_A02');reset(c);act(c,'gunner_A07');
  assert.ok(c.ally.masterEffects.gunner_A07);
  c.enemies[0].statuses.bind={turns:3};
  near(masterDamageBonus(data,c.game,c.b,0,0,data.skills.get('gunner_A01')), .2);
  reset(c);act(c,'gunner_A01');assert.ok(!c.ally.masterEffects.gunner_A07);assert.ok(!c.ally.masterEffects.gunner_P01);
  assert.equal(c.ally.loaded,3);
});

test('海賊の余勢は自発武器技の主撃破で巡ごと一度だけ発生し、MP軽減と鼓舞で消費する',()=>{
  const c=fixture('pirate');for(const id of ['pirate_A01','pirate_A07','pirate_P01','pirate_P05'])teach(c,id,3);
  c.enemies[0].hp=1;act(c);assert.ok(!c.ally.masterEffects.pirate_P01);
  c.enemies[1].hp=1;reset(c);act(c,'pirate_A01',1);
  assert.ok(c.ally.masterEffects.pirate_P01);
  const skill=data.skills.get('pirate_A01'),saved=skillMp(data,c.member,skill,{battle:c.b,actor:0});
  delete c.ally.masterEffects.pirate_P01;
  const ordinary=skillMp(data,c.member,skill,{battle:c.b,actor:0});
  assert.ok(saved<ordinary);
  c.ally.masterEffects.pirate_P01={momentum:{rate:.15},remaining:2};
  reset(c);act(c,'pirate_A07');assert.ok(!c.ally.masterEffects.pirate_P01);
  assert.ok(c.b.allies[1].masterEffects.pirate_A07);
});

test('海賊は開幕機会と水攻撃防御を参照し、旗砕きは攻撃強化だけを短い順に解除する',()=>{
  const c=fixture('pirate');for(const id of ['pirate_A01','pirate_A08','pirate_P03','pirate_P04'])teach(c,id,3);
  near(masterDamageBonus(data,c.game,c.b,0,0,data.skills.get('pirate_A01')),.15);
  c.enemies[0].attackElement='water';near(masterCutBonus(data,c.game,c.b,0,false,0),.12);
  c.enemies[0].buffs={def:[.2,1],str:[.2,3],spd:[.2,1],crt:[.2,2]};
  act(c,'pirate_A08');assert.ok(c.enemies[0].buffs.def);assert.ok(!c.enemies[0].buffs.spd);
  assert.equal(c.ally.jobOpportunities,1);
});

test('魔法剣士の付与は対応技と通常攻撃へ作用し、固定属性技は保持する',()=>{
  const c=fixture('spellblade');for(const id of ['spellblade_A01','spellblade_A02','spellblade_A04','spellblade_A05','spellblade_A06','spellblade_A07','spellblade_P01'])teach(c,id,3);
  act(c,'spellblade_A01');assert.equal(c.ally.weaponEnchant.element,'fire');
  reset(c);act(c,'spellblade_A02');assert.equal(c.ally.weaponEnchant.element,'ice');
  assert.ok(c.ally.masterEffects.spellblade_P01);
  reset(c);act(c,'spellblade_A06');assert.equal(c.ally.masterEffects.spellblade_A06.enchantGuard.element,'ice');
  reset(c);act(c,'spellblade_A04');assert.deepEqual(c.ally.advancedAction?.elements??[],[]);
  assert.ok(!c.ally.masterEffects.spellblade_P01);
  reset(c);act(c,'spellblade_A07');assert.equal(c.ally.weaponEnchant,undefined);
  assert.ok(c.ally.masterEffects.spellblade_A07?.nextDamage);
});

test('付与対応技は敵の属性相性を参照し、固定斬撃・付与解除・奥義の追加強化を区別する',()=>{
  const strike=(id,enchant)=>{
    const c=fixture('spellblade',1,77);
    teach(c,id);
    c.enemies[0].weak=['fire'];
    if(enchant)c.ally.weaponEnchant={element:'fire',remaining:3,grantedClock:0};
    act(c,id);return 1e7-c.enemies[0].hp;
  };
  assert.ok(strike('spellblade_A04',true)>strike('spellblade_A04',false));
  assert.equal(strike('spellblade_A05',true),strike('spellblade_A05',false));
  const c=fixture('spellblade');for(const id of ['spellblade_A07','spellblade_A04','spellblade_U01'])teach(c,id);
  c.ally.weaponEnchant={element:'fire',remaining:3,grantedClock:0};
  act(c,'spellblade_A07');
  assert.equal(c.ally.weaponEnchant,undefined);
  near(masterDamageBonus(data,c.game,c.b,0,0,data.skills.get('spellblade_A04')),.25);
  c.member.ultimateGauge=100;act(c,'spellblade_U01',0,{element:'ice'});
  beginMasterAction(data,c.game,c.b,0,data.skills.get('spellblade_A04'));
  near(masterDamageBonus(data,c.game,c.b,0,0,data.skills.get('spellblade_A04')),.5);
});

test('魔法剣士の奥義は属性選択を検証し、攻撃後に付与と追加威力を与える',()=>{
  const c=fixture('spellblade');teach(c,'spellblade_U01');c.member.ultimateGauge=100;
  const before=c.member.mp;
  act(c,'spellblade_U01',0,{element:'water'});
  assert.equal(c.member.mp,before);assert.equal(c.member.ultimateGauge,100);
  act(c,'spellblade_U01',0,{element:'thunder'});
  assert.equal(c.ally.weaponEnchant.element,'thunder');
  assert.equal(c.ally.masterEffects.spellblade_U01.enchantWeaponDamage,.25);
  assert.equal(c.member.ultimateGauge,0);
  assert.ok(allyEffectEntries(data,c.game,c.b,0).flatMap(([,entries])=>entries.map(e=>e.label)).some(x=>x.includes('武器付与')));
});

test('装填・余勢・付与は戦闘のJSON保存後も同じ行動結果になる',()=>{
  for(const [job,skills] of [['gunner',['gunner_A02','gunner_A03']],['pirate',['pirate_A01','pirate_P01']],['spellblade',['spellblade_A01','spellblade_A04']]]){
    const c=fixture(job);
    for(const id of skills)teach(c,id);
    if(job==='pirate')c.enemies[0].hp=1;
    act(c,skills[0]);
    const copy={game:structuredClone(c.game),b:JSON.parse(JSON.stringify(c.b))};
    copy.member=copy.game.party[0];copy.ally=copy.b.allies[0];copy.enemies=copy.b.enemies;
    reset(c);reset(copy);
    const target=job==='pirate'?2:0;
    const nextId=job==='pirate'?'pirate_A01':skills.at(-1);
    act(c,nextId,target);act(copy,nextId,target);
    assert.deepEqual(copy.b.enemies.map(e=>e.hp),c.b.enemies.map(e=>e.hp),job);
    assert.deepEqual(copy.b.allies[0].masterEffects,c.b.allies[0].masterEffects,job);
    assert.equal(copy.b.allies[0].loaded,c.b.allies[0].loaded,job);
    assert.deepEqual(copy.b.allies[0].weaponEnchant,c.b.allies[0].weaponEnchant,job);
  }
});
