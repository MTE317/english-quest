import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {realGameData,MemoryStorage} from './helpers.js';
import {createNewGame,defaultPartySpecs,normalizeGame} from '../js/game-state.js';
import {makeGear,maxHp,maxMp} from '../js/character.js';
import {availableJobs,changeJob,learnSkill,upgradeSkill,equipSkill,effectiveSkill,skillMaxLevel,learnBlock} from '../js/growth.js';
import {createBattle,makeEnemy,setPending,resolvePending,nextTurn,actionOptions,finishBattle,skillMp,enemyStatusChance,rand} from '../js/battle.js';
import {masterDamageBonus,masterCutBonus,conditionalTargetCrit,pursuitAccuracy,pursuitDefIgnore,pursuitStatusBonus,
  activeMark,pursuitStage,startMasterOpportunity,finishMasterOpportunity,masterCoverTarget} from '../js/job-combat.js';
import {allyEffectEntries,JOB_EFFECT_SECTIONS} from '../js/ui/battle-view.js';
import {JOB_EFFECT_ICON} from '../js/ui/effect-icons.js';
import {describeSkillForUI,describeSkillEffect} from '../js/skill-effects.js';
import {GameSession} from '../js/save.js';

const data=realGameData(),ids=['assassin','bounty_hunter','dragoon'];
const spec=JSON.parse(readFileSync(new URL('../../docs/specs/additional-jobs-10-12-skills-v1.json',import.meta.url),'utf8'));
function fixture(job='assassin',count=3,seed=51) {
  const specs=defaultPartySpecs(data);specs[0].job=job;
  const game=createNewGame(data,specs);
  game.facilities.temple=12;
  for(const member of game.party){member.lv=20;member.hp=maxHp(data,member);member.mp=maxMp(data,member);}
  const member=game.party[0];member.ap=10000;
  const kind=job==='dragoon'?'spear':job==='bounty_hunter'?'bow':'dagger';
  const gear=[...data.equipment.values()].filter(item=>item.slot==='weapon'&&item.kind===kind&&!item.unique).sort((a,b)=>a.itemLv-b.itemLv)[0];
  member.equip.weapon=makeGear(game,gear.id);
  const enemies=Array.from({length:count},(_,index)=>Object.assign(makeEnemy(data,'goblin',{lv:1}),{
    name:'標的'+(index+1),hp:1e7,maxHp:1e7,def:30,res:30,spd:0,weak:[],strongWeak:[],resist:[],immune:[],statusAffinity:{},evasion:0}));
  const b=createBattle(data,game,{enemies,seed});b.round=1;
  return {game,member,b,enemies,ally:b.allies[0]};
}
function teach(c,id,level=1,actor=0){
  const member=c.game.party[actor],skill=data.skills.get(id);
  member.learned=[...new Set([...member.learned,id])];
  if(skillMaxLevel(skill)>1){member.skillLevels??={};member.skillLevels[id]=level;}
  if(skill.isFinal)member.loadout.ultimate=id;
  else {const key=skill.kind==='passive'?'passives':'actions';member.loadout[key]=[...new Set([...member.loadout[key],id])];}
}
function act(c,id=null,target=0,extra={},actor=0,correct=true){
  c.b.turn={side:'ally',i:actor,bleedProcessed:true};
  setPending(c.b,id?{type:'skill',skillId:id,target,...extra}:{type:'attack',target,...extra},{});
  return resolvePending(data,c.game,c.b,correct);
}
function opportunity(c){c.b.turn=null;c.b.pending=null;c.b.queue=[{side:'ally',i:0},{side:'ally',i:4}];return nextTurn(data,c.game,c.b);}
function land(c,correct=true){opportunity(c);assert.ok(actionOptions(data,c.game,c.b,0).landing);setPending(c.b,{type:'landing'},{});return resolvePending(data,c.game,c.b,correct);}
function enemyActs(c,{sweep=false,sureHit=false,target=0,tactics=null,round=null}={}){
  const enemy=c.enemies[0];Object.assign(enemy,{str:80,mag:80,mp:1000,magicRate:0,tactics,boss:sweep,sureHit,attackElement:'slash',status:null});
  enemy.statuses.taunt={actor:target,turns:10};c.b.round=round??(sweep?3:c.b.round);
  c.b.turn=null;c.b.pending=null;c.b.queue=[{side:'enemy',i:0},{side:'ally',i:4}];nextTurn(data,c.game,c.b);
}
const near=(a,b,margin=1e-8)=>assert.ok(Math.abs(a-b)<=margin,a+' != '+b);
const damage=c=>1e7-c.enemies[0].hp;
const mpReset=c=>{c.member.mp=maxMp(data,c.member);};

test('追加10〜12職の45技能・149段階・簡素説明・前提と成長方式がマスターへ反映される',()=>{
assert.equal(data.jobs.filter(job=>job.skillsReady).length,41);
  assert.equal([...data.skills.values()].filter(skill=>skill.effect.master).length,615);
  let stages=0;const modes={};
  for(const job of spec.jobs){const list=[...data.skills.values()].filter(skill=>skill.job===job.id);
    assert.deepEqual([list.filter(s=>!s.isFinal&&s.kind!=='passive').length,list.filter(s=>s.kind==='passive').length,list.filter(s=>s.isFinal).length],[9,5,1]);
    for(const source of job.skills){const skill=data.skills.get(source.id);modes[source.growthMode]=(modes[source.growthMode]??0)+1;
      assert.equal(skillMaxLevel(skill),source.maxLevel);assert.deepEqual(skill.effect.prerequisites,source.prerequisites);
      for(let level=1;level<=source.maxLevel;level++){
        const used=effectiveSkill(data,{learned:[skill.id],skillLevels:{[skill.id]:level}},skill);
        assert.equal(describeSkillForUI(data,used),source.simpleDescriptions[level-1]);
        assert.equal(describeSkillEffect(data,used),source.effects[level-1]);
        assert.doesNotMatch(describeSkillForUI(data,used),/\d+(?:\.\d+)?倍|STR|MAG|DEF|RES/);stages++;
      }
    }
  }
  assert.equal(stages,149);assert.deepEqual(modes,{lv5:17,lv3:18,none:10});
});

test('3職は最初から選べ、既存セーブでもAPで手動修得し、他職へ継承できる',()=>{
  for(const job of spec.jobs){const c=fixture(job.id),learned=[...c.member.learned],gear=structuredClone(c.member.equip);
    const saved=normalizeGame(data,structuredClone(c.game));assert.ok(availableJobs(data,saved,saved.party[0]).some(j=>j.id===job.id));
    changeJob(data,c.game,0,'warrior');changeJob(data,c.game,0,job.id);
    assert.deepEqual(c.member.learned,learned);assert.deepEqual(c.member.equip,gear);
    const intro=job.skills.find(s=>s.maxLevel===5&&!s.prerequisites.length),s=data.skills.get(intro.id),ap=c.member.ap;
    learnSkill(data,c.member,s.id);upgradeSkill(data,c.member,s.id);equipSkill(data,c.member,s.id);
    assert.ok(c.member.ap<ap);assert.equal(c.member.skillLevels[s.id],2);
    const ultimate=data.skills.get(job.id+'_U01');assert.match(learnBlock(data,c.member,ultimate),/10/);
    for(const skill of job.skills.filter(s=>s.type!=='ultimate'))if(!c.member.learned.includes(skill.id))c.member.learned.push(skill.id);
    assert.equal(learnBlock(data,c.member,ultimate),'');learnSkill(data,c.member,ultimate.id);equipSkill(data,c.member,ultimate.id);
    changeJob(data,c.game,0,'warrior');assert.equal(c.member.loadout.ultimate,ultimate.id);
  }
  assert.equal(data.jobs.filter(job=>!job.skillsReady).length,9);
});

test('暗殺者の異常・能力低下条件は対象ごとで、標的・属性耐性・別の敵の状態では成立しない',()=>{
  const c=fixture();for(const id of ['assassin_P01','assassin_P03','assassin_P04'])teach(c,id,3);
  const skill=data.skills.get('assassin_A08');c.enemies[1].statuses.poison={turns:3};
  near(masterDamageBonus(data,c.game,c.b,0,0,skill),0);near(conditionalTargetCrit(data,c.game,c.b,0,0,skill),0);
  c.enemies[0].statuses.bind={turns:3};near(masterDamageBonus(data,c.game,c.b,0,0,skill),.15);
  c.enemies[0].statuses.poison={turns:3};c.enemies[0].statuses.bleed={turns:3};c.enemies[0].statuses.burn={turns:3};
  near(masterDamageBonus(data,c.game,c.b,0,0,skill),.25);
  c.enemies[0].masterDebuffs={test:{stat:'res',value:.1,turns:2}};
  near(masterDamageBonus(data,c.game,c.b,0,0,skill),.5);near(conditionalTargetCrit(data,c.game,c.b,0,0,skill),.16);
  near(conditionalTargetCrit(data,c.game,c.b,0,1,skill),0);
});

test('隙の照準は選択敵だけを強化し、次の通常武器技で対象を含めば不成立・外れでも使い切る',()=>{
  const c=fixture();teach(c,'assassin_A03');teach(c,'assassin_A04',3);
  act(c,'assassin_A03',1);c.enemies[0].statuses.blind={turns:9};c.enemies[1].statuses.fear={turns:9};
  near(masterDamageBonus(data,c.game,c.b,0,0,data.skills.get('assassin_A01')),0);
  near(masterDamageBonus(data,c.game,c.b,0,1,data.skills.get('assassin_A01')),.2);
  c.member.ultimateGauge=100;teach(c,'assassin_U01');act(c,'assassin_U01',0);
  assert.ok(c.ally.masterEffects.assassin_A03);mpReset(c);
  c.enemies[1].statuses={};c.enemies[1].evasion=1;
  act(c,'assassin_A04',1,{targets:[1]});assert.ok(!c.ally.masterEffects.assassin_A03);
});

test('仕込み返しは新しく有効な自分の準備で強化し、期限更新・能力強化・道具・スキップでは成立しない',()=>{
  const c=fixture();for(const id of ['assassin_A03','assassin_A07','assassin_A09','executioner_A07'])teach(c,id);
  act(c,'assassin_A03');assert.equal(c.ally.previousPreparation,true);
  act(c,'assassin_A03');assert.equal(c.ally.previousPreparation,false);
  act(c,'assassin_A07');assert.equal(c.ally.previousPreparation,false);
  mpReset(c);act(c,'executioner_A07');assert.equal(c.ally.previousPreparation,true);
  c.ally.statuses.sleep={turns:2};opportunity(c);assert.ok(!c.ally.previousPreparation);delete c.ally.statuses.sleep;
  const a=fixture(),b=fixture();for(const x of [a,b]){teach(x,'assassin_A09');x.ally.previousPreparation=x===a;x.b.rng=88;act(x,'assassin_A09');}
  near(damage(a),damage(b)*1.2,2);
});

test('退路の読みは行動開始時の実異常と実ダメージが必要で、その攻撃で付けた毒や奥義から発動しない',()=>{
  const c=fixture();teach(c,'assassin_A02');teach(c,'assassin_P05',3);
  act(c,'assassin_A02');assert.ok(!c.ally.masterEffects.assassin_P05);
  c.enemies[0].statuses.bind={turns:10};mpReset(c);act(c,'assassin_A02');assert.equal(c.ally.masterEffects.assassin_P05.remaining,3);
  delete c.ally.masterEffects.assassin_P05;c.enemies[0].evasion=1;delete c.enemies[0].statuses.bind;act(c,'assassin_A02');assert.ok(!c.ally.masterEffects.assassin_P05);
});

test('暗殺者奥義は異常と能力低下をそれぞれ1回だけ加算し、低HPだけでは強化しない',()=>{
  const c=fixture();const skill=data.skills.get('assassin_U01');c.enemies[0].hp=1;
  near(masterDamageBonus(data,c.game,c.b,0,0,skill),0);
  c.enemies[0].statuses.blind={turns:3};c.enemies[0].statuses.poison={turns:3};c.enemies[0].debuffs.str=[.1,3];
  near(masterDamageBonus(data,c.game,c.b,0,0,skill),.3);
});

test('追跡札は挑発せず、追い手の勘を装備した通常武器技の実ダメージ後に一度だけ追跡を得る',()=>{
  const c=fixture('bounty_hunter');for(const id of ['bounty_hunter_A01','bounty_hunter_A02','bounty_hunter_P01'])teach(c,id);
  act(c,'bounty_hunter_A01');assert.equal(c.ally.mark.remaining,4);assert.ok(!c.enemies[0].statuses.taunt);
  near(masterDamageBonus(data,c.game,c.b,0,0,data.skills.get('bounty_hunter_A02')),.1);
  act(c,'bounty_hunter_A02');assert.equal(c.ally.pursuit,1);
  near(masterDamageBonus(data,c.game,c.b,0,0,data.skills.get('bounty_hunter_A02')),.15);
  act(c);assert.equal(c.ally.pursuit,1);
  c.member.loadout.passives=[];mpReset(c);act(c,'bounty_hunter_A02');assert.equal(c.ally.pursuit,0);assert.ok(c.ally.mark);
});

test('追跡は別の敵を含む武器攻撃の最初にリセットし、標的に命中した行動の最後に最大1段階だけ得る',()=>{
  const c=fixture('bounty_hunter');for(const id of ['bounty_hunter_A01','bounty_hunter_P01','assassin_A04'])teach(c,id,3);
  const dagger=[...data.equipment.values()].find(e=>e.slot==='weapon'&&e.kind==='dagger'&&!e.unique);c.member.equip.weapon=makeGear(c.game,dagger.id);
  act(c,'bounty_hunter_A01');c.ally.pursuit=3;
  act(c,'assassin_A04',0,{targets:[0,1,2]});assert.equal(c.ally.pursuit,1);
  c.ally.pursuit=3;mpReset(c);act(c,'assassin_A04',1,{targets:[1]});assert.equal(c.ally.pursuit,0);
});

test('追跡終射は追跡強化を置き換えて消費し、外れや別対象でも行動後に札を終了する',()=>{
  const a=fixture('bounty_hunter'),b=fixture('bounty_hunter');
  for(const c of [a,b]){for(const id of ['bounty_hunter_A01','bounty_hunter_A09','bounty_hunter_P01'])teach(c,id);act(c,'bounty_hunter_A01');c.ally.pursuit=c===a?3:0;c.b.rng=81;act(c,'bounty_hunter_A09');assert.ok(!c.ally.mark);assert.equal(c.ally.pursuit,0);}
  near(damage(a),damage(b)*1.24,2);
  const c=fixture('bounty_hunter');teach(c,'bounty_hunter_A09');c.ally.mark={target:0,remaining:4};c.ally.pursuit=3;
  act(c,'bounty_hunter_A09',1);assert.ok(!c.ally.mark);
});

test('標的移動は別の生存敵にだけ可能で、Lvごとの追跡持越しと札の再付与を扱う',()=>{
  const c=fixture('bounty_hunter');for(const id of ['bounty_hunter_A01','bounty_hunter_A06','bounty_hunter_P01'])teach(c,id,3);
  assert.match(actionOptions(data,c.game,c.b,0).skills.find(x=>x.skill.id==='bounty_hunter_A06').reason,/追跡札/);
  act(c,'bounty_hunter_A01');c.ally.pursuit=3;const mp=c.member.mp;act(c,'bounty_hunter_A06',0);assert.equal(c.member.mp,mp);
  mpReset(c);act(c,'bounty_hunter_A06',1);assert.equal(c.ally.mark.target,1);assert.equal(c.ally.mark.remaining,4);assert.equal(c.ally.pursuit,2);
  act(c,'bounty_hunter_A01',1);assert.equal(c.ally.pursuit,0);
});

test('命中・束縛率・被害軽減は自分の標的と行動開始時の追跡を使い、状態率は共通式の前に加える',()=>{
  const c=fixture('bounty_hunter');for(const id of ['bounty_hunter_P01','bounty_hunter_P03','bounty_hunter_P04','bounty_hunter_P05'])teach(c,id,3);
  c.ally.mark={target:0,remaining:4};c.ally.pursuit=1;const skill=data.skills.get('bounty_hunter_A03');
  near(pursuitAccuracy(data,c.game,c.b,0,0,skill),.15);near(pursuitAccuracy(data,c.game,c.b,0,1,skill),0);
  near(masterCutBonus(data,c.game,c.b,0,false,0),.12);near(masterCutBonus(data,c.game,c.b,0,false,1),0);
  c.ally.advancedAction={executed:true,normalActive:true,startPursuit:1};
  near(pursuitStatusBonus(data,c.game,c.b,0,0,'bind'),.15);near(pursuitStatusBonus(data,c.game,c.b,0,1,'bind'),0);
  c.enemies[0].statusAffinity.bind='×';assert.equal(enemyStatusChance(data,c.enemies[0],1,'bind',.5),0);
  c.enemies[0].statusAffinity.bind='★';assert.ok(enemyStatusChance(data,c.enemies[0],1,'bind',1)<=.95);
});

test('射線固定は通常武器技だけ、包囲の合図は付与時の標的だけに働き、表示で消費しない',()=>{
  const c=fixture('bounty_hunter');for(const id of ['bounty_hunter_A01','bounty_hunter_A05','bounty_hunter_A06','bounty_hunter_A08'])teach(c,id,3);
  act(c,'bounty_hunter_A01');act(c,'bounty_hunter_A05');act(c,'bounty_hunter_A08');
  assert.equal(pursuitDefIgnore(c.b,0,0,data.skills.get('bounty_hunter_A02')),.2);
  assert.equal(pursuitDefIgnore(c.b,0,1,data.skills.get('bounty_hunter_A02')),0);
  assert.equal(pursuitDefIgnore(c.b,0,0,data.skills.get('bounty_hunter_U01')),0);
  const snapshot=JSON.stringify(c.b);actionOptions(data,c.game,c.b,0);allyEffectEntries(data,c.game,c.b,0);assert.equal(JSON.stringify(c.b),snapshot);
  mpReset(c);act(c,'bounty_hunter_A06',1);assert.equal(c.b.allies[1].masterEffects.bounty_hunter_A08.markedPartyDamage.target,0);
});

test('賞金稼ぎ奥義は追跡を消費して束縛を試み、生成技能なしでも生存対象へ新しい札を付ける',()=>{
  const c=fixture('bounty_hunter');teach(c,'bounty_hunter_U01');c.member.ultimateGauge=100;
  act(c,'bounty_hunter_U01',1);assert.equal(c.ally.mark.target,1);assert.equal(c.ally.mark.remaining,4);assert.equal(c.ally.pursuit,0);
  assert.equal(c.member.ultimateGauge,0);
});

test('跳躍は準備でMPだけを一度支払い、次の通常機会の着地にだけ武器技の消費・獲得を適用する',()=>{
  const c=fixture('dragoon');for(const id of ['dragoon_A02','warrior_monk_P01','berserker_P01'])teach(c,id);
  c.ally.prayer=2;const mp=c.member.mp,cost=skillMp(data,c.member,data.skills.get('dragoon_A02'));
  act(c,'dragoon_A02');assert.equal(damage(c),0);assert.equal(c.member.mp,mp-cost);assert.equal(c.ally.prayer,2);assert.equal(c.ally.anger,0);assert.ok(c.ally.jump);
  c.member.mp=0;land(c);assert.ok(damage(c)>0);assert.equal(c.member.mp,0);assert.equal(c.ally.prayer,1);assert.equal(c.ally.anger,1);assert.ok(!c.ally.jump&&!c.ally.landingReady);
});

test('跳躍は準備時の技能Lvと正誤倍率を保存し、着地の正誤を掛けて攻撃する',()=>{
  const a=fixture('dragoon'),b=fixture('dragoon');
  for(const c of [a,b])teach(c,'dragoon_A02');
  const launch=act(a,'dragoon_A02',0,{},0,false);act(b,'dragoon_A02');
  a.member.skillLevels.dragoon_A02=5;
  a.b.rng=b.b.rng=71;land(a);land(b);near(damage(a),damage(b)*launch.cm,2);
  const c=fixture('dragoon');teach(c,'dragoon_A02');act(c,'dragoon_A02');const res=land(c,false);assert.ok(res.cm<1);assert.ok(damage(c)>0);
});

test('踏み切りの呼吸は跳躍準備へ移し、着地前に期限切れせず中断でも返さない',()=>{
  const c=fixture('dragoon');teach(c,'dragoon_A02');teach(c,'dragoon_A06');act(c,'dragoon_A06');act(c,'dragoon_A02');
  assert.ok(!c.ally.masterEffects.dragoon_A06);near(c.ally.jump.boost,.2);
  c.ally.statuses.sleep={turns:2};opportunity(c);assert.ok(!c.ally.jump&&!c.ally.landingReady);assert.ok(!c.ally.masterEffects.dragoon_A06);
});

test('跳躍は恐怖・封印・武器不足で始められず、着地時に同条件なら予約を取り消し通常コマンドへ戻る',()=>{
  for(const status of ['fear','seal']){const c=fixture('dragoon');teach(c,'dragoon_A02');c.ally.statuses[status]={turns:5};
    assert.match(actionOptions(data,c.game,c.b,0).skills[0].reason,/恐怖|封印/);const mp=c.member.mp;act(c,'dragoon_A02');assert.equal(c.member.mp,mp);assert.ok(!c.ally.jump);
    delete c.ally.statuses[status];act(c,'dragoon_A02');c.ally.statuses[status]={turns:5};opportunity(c);
    assert.equal(c.b.turn.i,0);assert.ok(!c.ally.jump&&!c.ally.landingReady);assert.equal(actionOptions(data,c.game,c.b,0).landing,null);
  }
  const c=fixture('dragoon');teach(c,'dragoon_A02');act(c,'dragoon_A02');c.member.equip.weapon=null;opportunity(c);assert.ok(!c.ally.landingReady);
});

test('睡眠・凍結・スタン・石化・強制行動で跳躍を中断し、次の機会へ空中を延長しない',()=>{
  for(const status of ['sleep','freeze','stun','petrify','confusion','charm']){
    const c=fixture('dragoon');teach(c,'dragoon_A02');act(c,'dragoon_A02');c.ally.statuses[status]={turns:3};opportunity(c);
    assert.ok(!c.ally.jump&&!c.ally.landingReady,status);
  }
});

test('空中は単体攻撃の候補から外れ、全体攻撃は本人分だけ回避し、必中には当たる',()=>{
  for(const options of [{},{sweep:true},{sureHit:true}]){const c=fixture('dragoon');teach(c,'dragoon_A02');act(c,'dragoon_A02');
    const hp=c.member.hp;enemyActs(c,options);assert.equal(c.member.hp<hp,Boolean(options.sureHit));
    if(options.sweep)assert.ok(c.game.party.slice(1).some(member=>member.hp<maxHp(data,member)));
  }
  const c=fixture('dragoon');teach(c,'dragoon_A02');act(c,'dragoon_A02');for(const ally of c.b.allies)ally.jump=structuredClone(c.ally.jump);
  const hp=c.game.party.map(member=>member.hp);enemyActs(c);assert.deepEqual(c.game.party.map(member=>member.hp),hp);
});

test('空中でも妨害・継続ダメージ・味方支援を受け、かばうと反撃はしない',()=>{
  const c=fixture('dragoon');teach(c,'dragoon_A02');act(c,'dragoon_A02');
  c.ally.masterCover={target:'all',rate:1,remaining:4};assert.equal(masterCoverTarget(data,c.game,c.b,1,false),null);
  c.ally.masterCounter={m:3,limit:1,remaining:4};enemyActs(c,{sureHit:true});assert.equal(damage(c),0);
  const d=fixture('dragoon');teach(d,'dragoon_A02');act(d,'dragoon_A02');enemyActs(d,{tactics:'disrupt',round:2});
  const e=fixture('dragoon');teach(e,'dragoon_A02');act(e,'dragoon_A02');e.ally.statuses.poison={turns:3,n:1};const hp=e.member.hp;opportunity(e);assert.ok(e.member.hp<hp);
});

test('跳躍対象が倒れたら別の生存敵へ着地し、着地予約中の別コマンドで回避できない',()=>{
  const c=fixture('dragoon');teach(c,'dragoon_A02');act(c,'dragoon_A02');c.enemies[0].hp=0;opportunity(c);
  assert.equal(actionOptions(data,c.game,c.b,0).landing.target,1);
  setPending(c.b,{type:'attack',target:2},{});resolvePending(data,c.game,c.b,true);
  assert.ok(c.enemies[1].hp<1e7);assert.equal(c.enemies[2].hp,1e7);assert.ok(c.ally.previousLanding);
});

test('着地の息と直前着地の落雷突きは通常跳躍で成立し、別行動・スキップ・即時奥義では成立しない',()=>{
  const c=fixture('dragoon');for(const id of ['dragoon_A02','dragoon_P01','dragoon_A09','dragoon_U01'])teach(c,id);
  act(c,'dragoon_A02');land(c);assert.equal(c.ally.masterEffects.dragoon_P01.values.def,.15);assert.ok(c.ally.previousLanding);
  mpReset(c);act(c,'dragoon_A09');assert.ok(!c.ally.previousLanding);
  delete c.ally.masterEffects.dragoon_P01;c.member.ultimateGauge=100;act(c,'dragoon_U01');assert.ok(!c.ally.previousLanding&&!c.ally.masterEffects.dragoon_P01&&!c.ally.jump);
  assert.equal(c.ally.masterEffects.dragoon_U01.shield,Math.floor(maxHp(data,c.member)*.15));
});

test('竜への防御貫通・被害軽減・封印は対象種族だけを判定し、跳躍MP軽減は準備時だけ働く',()=>{
  const c=fixture('dragoon');teach(c,'dragoon_P03',3);teach(c,'dragoon_P04',3);c.enemies[0].types=['dragon'];
  const s=effectiveSkill(data,{learned:['dragoon_A05'],skillLevels:{dragoon_A05:3}},data.skills.get('dragoon_A05'));
  near(pursuitDefIgnore(c.b,0,0,s),.35);near(pursuitDefIgnore(c.b,0,1,s),0);near(masterCutBonus(data,c.game,c.b,0,false,0),.16);
  const plain=fixture('dragoon');assert.ok(skillMp(data,c.member,data.skills.get('dragoon_A02'))<skillMp(data,plain.member,data.skills.get('dragoon_A02')));
});

test('戦闘途中の跳躍予約・標的・準備と乱数を保存し、同じ着地結果で再開する',()=>{
  const c=fixture('dragoon');teach(c,'dragoon_A02',3);teach(c,'dragoon_A06');act(c,'dragoon_A06');act(c,'dragoon_A02',1,{},0,false);opportunity(c);setPending(c.b,{type:'landing'},{});
  const storage=new MemoryStorage(),session=new GameSession({storage});session.startNew(c.game);session.enterDungeon({dungeonId:[...data.dungeons.keys()][0]});session.setBattle(c.b);
  const restored=new GameSession({storage});normalizeGame(data,restored.game,restored.run);
  assert.deepEqual(restored.run.battle,c.b);
  resolvePending(data,c.game,c.b,true);resolvePending(data,restored.game,restored.run.battle,true);
  assert.deepEqual(restored.run.battle.enemies,c.b.enemies);assert.equal(restored.run.battle.rng,c.b.rng);
});

test('共通アイコンの3区分に効果を表示し、参照しても追跡・予約・残期間を消費しない',()=>{
  const c=fixture('dragoon');teach(c,'dragoon_A02');act(c,'dragoon_A02');const saved=JSON.stringify(c.b);
  const entries=allyEffectEntries(data,c.game,c.b,0);assert.equal(JSON.stringify(c.b),saved);
  const special=entries.find(([name])=>name===JOB_EFFECT_SECTIONS.special)[1];assert.ok(special.some(e=>/跳躍中/.test(e.label)&&e.icon===JOB_EFFECT_ICON));
  const d=fixture('bounty_hunter');teach(d,'bounty_hunter_A01');teach(d,'bounty_hunter_P01');act(d,'bounty_hunter_A01');
  const ongoing=allyEffectEntries(data,d.game,d.b,0).find(([name])=>name===JOB_EFFECT_SECTIONS.ongoing)[1];assert.ok(ongoing.some(e=>/追跡 0\/3/.test(e.label)&&e.icon===JOB_EFFECT_ICON));
});

test('戦闘終了で追跡・跳躍・履歴を消し、別の戦闘に持ち越さない',()=>{
  const c=fixture('dragoon');teach(c,'dragoon_A02');act(c,'dragoon_A02');c.ally.mark={target:0,remaining:4};c.ally.pursuit=3;c.ally.previousPreparation=true;
  c.b.result='win';finishBattle(data,c.game,c.b);assert.ok(!c.ally.jump&&!c.ally.mark&&!c.ally.previousPreparation);assert.equal(c.ally.pursuit,undefined);
});

test('3職の全アクティブ・奥義を全段階で実際の戦闘処理へ通す',()=>{
  for(const job of spec.jobs)for(const source of job.skills.filter(skill=>skill.type!=='passive'))for(let level=1;level<=source.maxLevel;level++){
    const c=fixture(job.id);teach(c,source.id,level);
    const s=effectiveSkill(data,c.member,data.skills.get(source.id));
    if(s.effect.weapons?.length&&!s.effect.weapons.includes(c.member.equip.weapon.kind)){
      const gear=[...data.equipment.values()].find(item=>item.slot==='weapon'&&item.kind===s.effect.weapons[0]&&!item.unique);c.member.equip.weapon=makeGear(c.game,gear.id);
    }
    c.ally.mark={target:0,remaining:4};c.member.ultimateGauge=100;
    act(c,source.id,s.effect.rules?.move_mark?1:0,s.effect.select_targets?{targets:[0]}:{});
    if(s.kind==='jump')land(c);
    assert.ok(c.game.party.every(member=>Number.isFinite(member.hp)&&Number.isFinite(member.mp)),source.id+' Lv'+level);
    assert.ok(c.b.log.every(line=>!String(line).includes('何も起こらなかった')),source.id+' Lv'+level);
  }
});

test('捕縛の手並みは既存の束縛付与経路を強化し、その行動で得る追跡を遡及しない',()=>{
  let seed=1;while(seed<100000){const sample={rng:seed};const roll=rand(sample);if(roll>.4&&roll<.55)break;seed++;}
  assert.ok(seed<100000);
  const a=fixture('bounty_hunter',3,seed),b=fixture('bounty_hunter',3,seed);
  for(const c of [a,b]){for(const id of ['bounty_hunter_A07','bounty_hunter_P01','bounty_hunter_P05'])teach(c,id,3);c.ally.mark={target:0,remaining:4};c.ally.pursuit=c===a?1:0;act(c,'bounty_hunter_A07',0,{targets:[0]});}
  assert.ok(a.enemies[0].statuses.bind);assert.ok(!b.enemies[0].statuses.bind);assert.equal(a.ally.pursuit,1);assert.equal(b.ally.pursuit,0);
});

test('札の期限は行動スキップでも進み、標的撃破・戦闘不能で札と追跡を解除する',()=>{
  const c=fixture('bounty_hunter');teach(c,'bounty_hunter_A01');teach(c,'bounty_hunter_P01');act(c,'bounty_hunter_A01');c.ally.pursuit=3;
  for(let i=0;i<4;i++){c.ally.statuses.sleep={turns:3};opportunity(c);}
  assert.ok(!c.ally.mark);assert.equal(c.ally.pursuit,0);
  delete c.ally.statuses.sleep;mpReset(c);act(c,'bounty_hunter_A01');c.ally.pursuit=2;c.member.hp=1;enemyActs(c,{sureHit:true});assert.equal(c.member.hp,0);assert.ok(!c.ally.mark);
});

test('別の職に継承した追跡技能も働き、同じ敵の他人の札は共有しない',()=>{
  const c=fixture('bounty_hunter');for(const id of ['bounty_hunter_A01','bounty_hunter_A02','bounty_hunter_P01'])teach(c,id);
  changeJob(data,c.game,0,'warrior');act(c,'bounty_hunter_A01');act(c,'bounty_hunter_A02');assert.equal(c.ally.pursuit,1);
  assert.equal(activeMark(c.game,c.b,1),null);near(masterDamageBonus(data,c.game,c.b,1,0,data.skills.get('bounty_hunter_A02')),0);
});

test('跳躍準備は既存の武器準備を消費せず、ためた怒気と祈念を着地へ持ち越す',()=>{
  const c=fixture('dragoon');for(const id of ['dragoon_A02','berserker_P01','warrior_monk_P01'])teach(c,id);
  c.ally.anger=2;c.ally.prayer=2;c.ally.masterEffects.test={grantedClock:-1,nextDamage:{tag:'weapon',rate:.2},remaining:3};
  act(c,'dragoon_A02');assert.equal(c.ally.anger,2);assert.equal(c.ally.prayer,2);assert.ok(c.ally.masterEffects.test);
  land(c);assert.equal(c.ally.anger,3);assert.equal(c.ally.prayer,1);assert.ok(!c.ally.masterEffects.test);
});

test('跳躍中も単独生存者への状態妨害を防がず、継続被害による戦闘不能で予約を解除する',()=>{
  const c=fixture('dragoon');teach(c,'dragoon_A02');act(c,'dragoon_A02');for(let i=1;i<c.game.party.length;i++)c.game.party[i].hp=0;
  Object.assign(c.enemies[0],{tactics:'disrupt',mp:1000});c.b.round=2;c.b.queue=[{side:'enemy',i:0},{side:'ally',i:0}];nextTurn(data,c.game,c.b);
  assert.ok(c.ally.buffs['down:str']);assert.ok(c.ally.landingReady);
  const d=fixture('dragoon');teach(d,'dragoon_A02');act(d,'dragoon_A02');d.member.hp=1;d.ally.statuses.poison={turns:5,n:1};opportunity(d);
  assert.equal(d.member.hp,0);assert.ok(!d.ally.jump&&!d.ally.landingReady);
});

test('落雷突きは通常着地の直後だけ強化し、即時奥義の防護は既存防護との共通上限に収まる',()=>{
  const a=fixture('dragoon'),b=fixture('dragoon');for(const c of [a,b]){teach(c,'dragoon_A09');c.ally.previousLanding=c===a;c.b.rng=51;act(c,'dragoon_A09');}
  near(damage(a),damage(b)*1.25,2);
  const c=fixture('dragoon');teach(c,'dragoon_U01');c.member.ultimateGauge=100;const max=maxHp(data,c.member);
  c.ally.masterEffects.test={remaining:4,shield:Math.floor(max*.49)};act(c,'dragoon_U01');
  const total=Object.values(c.ally.masterEffects).reduce((sum,effect)=>sum+(effect.shield??0),0);assert.ok(total<=Math.floor(max*.5));
});

test('射線固定は使用時の自分の標的を参照し、札なし・別対象・奥義では防御無視を得ない',()=>{
  const c=fixture('bounty_hunter');for(const id of ['bounty_hunter_A01','bounty_hunter_A02','bounty_hunter_A05','bounty_hunter_A06'])teach(c,id,3);
  act(c,'bounty_hunter_A01');act(c,'bounty_hunter_A05');act(c,'bounty_hunter_A06',1);
  const skill=data.skills.get('bounty_hunter_A02');near(pursuitDefIgnore(c.b,0,1,skill),.2);near(pursuitDefIgnore(c.b,0,0,skill),0);
  const mark=c.ally.mark;delete c.ally.mark;near(pursuitDefIgnore(c.b,0,1,skill),0);c.ally.mark=mark;
  c.enemies[1].evasion=1;mpReset(c);act(c,'bounty_hunter_A02',1);assert.ok(!c.ally.masterEffects.bounty_hunter_A05);
});

test('ランダム連撃は実際に抽選した対象がすべて標的なら追跡を保ち、別対象を含むなら初撃から0にする',()=>{
  for(const mixed of [false,true]){
    let seed=1;
    for(;seed<100000;seed++){
      const state={rng:seed},targets=Array.from({length:4},()=>Math.floor(rand(state)*3));
      if(targets[0]===0 && targets.some(target=>target!==0)===mixed)break;
    }
    assert.ok(seed<100000);const a=fixture('bounty_hunter',3,seed),b=fixture('bounty_hunter',3,seed);
    for(const c of [a,b]){
      for(const id of ['bounty_hunter_P01','berserker_A09'])teach(c,id);
      const axe=[...data.equipment.values()].find(item=>item.slot==='weapon'&&item.kind==='axe'&&!item.unique);c.member.equip.weapon=makeGear(c.game,axe.id);
      c.ally.mark={target:0,remaining:4};c.ally.pursuit=c===a?3:0;act(c,'berserker_A09');
    }
    near(damage(a),damage(b)*(mixed?1:1.15),3);assert.equal(a.ally.pursuit,mixed?1:3);
  }
});
