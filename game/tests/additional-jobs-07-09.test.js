import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {realGameData,MemoryStorage} from './helpers.js';
import {createNewGame,defaultPartySpecs,normalizeGame} from '../js/game-state.js';
import {makeGear,maxHp,maxMp} from '../js/character.js';
import {availableJobs,changeJob,learnSkill,upgradeSkill,equipSkill,effectiveSkill,skillMaxLevel,learnBlock} from '../js/growth.js';
import {createBattle,makeEnemy,setPending,resolvePending,nextTurn,actionOptions,battleStats,targetKind,allyStatusChance,finishBattle,skillMp} from '../js/battle.js';
import {masterDamageBonus,masterCutBonus,cloneCount,cloneDefense,snapshotCloneDefense,specialistAccuracy,specialistCrit,startMasterOpportunity,finishMasterOpportunity} from '../js/job-combat.js';
import {allyEffectEntries,JOB_EFFECT_SECTIONS} from '../js/ui/battle-view.js';
import {JOB_EFFECT_ICON} from '../js/ui/effect-icons.js';
import {describeSkillForUI,describeSkillEffect} from '../js/skill-effects.js';
import {GameSession} from '../js/save.js';

const data=realGameData(),ids=['ascetic','executioner','ninja'];
const spec=JSON.parse(readFileSync(new URL('../../docs/specs/additional-jobs-07-09-skills-v1.json',import.meta.url),'utf8'));
function fixture(job='ascetic',count=3,seed=51) {
  const specs=defaultPartySpecs(data);specs[0].job=job;
  const game=createNewGame(data,specs);
  game.facilities.temple=12;
  for(const m of game.party){m.lv=20;m.hp=maxHp(data,m);m.mp=maxMp(data,m);}
  const member=game.party[0];member.ap=10000;
  const kind=job==='executioner'?'axe':job==='ninja'?'katana':'fist';
  const item=[...data.equipment.values()].filter(x=>x.slot==='weapon'&&x.kind===kind&&!x.unique).sort((a,c)=>a.itemLv-c.itemLv)[0];
  member.equip.weapon=makeGear(game,item.id);
  const enemies=Array.from({length:count},()=>{const e=makeEnemy(data,'goblin',{lv:1});Object.assign(e,{hp:1e7,maxHp:1e7,def:30,res:30,spd:0,weak:[],strongWeak:[],resist:[],immune:[],statusAffinity:{},evasion:0});return e;});
  const b=createBattle(data,game,{enemies,seed});b.round=1;
  return {game,member,b,enemies,ally:b.allies[0]};
}
function teach(c,id,level=1,actor=0){
  const m=c.game.party[actor],s=data.skills.get(id);m.learned=[...new Set([...m.learned,id])];
  if(skillMaxLevel(s)>1){m.skillLevels??={};m.skillLevels[id]=level;}
  if(s.isFinal)m.loadout.ultimate=id;
  else {const key=s.kind==='passive'?'passives':'actions';m.loadout[key]=[...new Set([...m.loadout[key],id])];}
}
function act(c,id=null,target=0,extra={},actor=0,correct=true){
  c.b.turn={side:'ally',i:actor,bleedProcessed:true};
  setPending(c.b,id?{type:'skill',skillId:id,target,...extra}:{type:'attack',target},{});resolvePending(data,c.game,c.b,correct);
}
function enemyActs(c,index=0,{magic=false,power=80,target=0,sweep=false,sureHit=false,status=null,statusRate=0}={}){
  const e=c.enemies[index];Object.assign(e,{str:power,mag:power,mp:1000,magicRate:magic?1:0,tactics:null,status,statusRate,boss:sweep,sureHit,attackElement:'slash'});
  e.statuses.taunt={actor:target,turns:10};
  c.b.round=sweep?3:c.b.round;c.b.turn=null;c.b.pending=null;c.b.queue=[{side:'enemy',i:index},{side:'ally',i:4}];nextTurn(data,c.game,c.b);
}
function skip(c){c.ally.statuses.sleep={turns:3,n:1};c.b.turn=null;c.b.pending=null;c.b.queue=[{side:'ally',i:0},{side:'ally',i:4}];nextTurn(data,c.game,c.b);}
const section=(c,key)=>allyEffectEntries(data,c.game,c.b,0).find(([title])=>title===key)?.[1]??[];
const near=(actual,expected,margin=1e-8)=>assert.ok(Math.abs(actual-expected)<=margin,actual+' != '+expected);
const dealt=c=>1e7-c.enemies[0].hp;

test('追加7〜9職は45技能・147段階で、全段階の成長・詳細文・簡素説明・前提が一致する',()=>{
assert.equal(data.jobs.filter(j=>j.skillsReady).length,38);assert.equal([...data.skills.values()].filter(s=>s.effect.master).length,570);
  let count=0;const modes={};
  for(const job of spec.jobs){
    const list=[...data.skills.values()].filter(s=>s.job===job.id);assert.equal(list.length,15);
    assert.deepEqual([list.filter(s=>!s.isFinal&&s.kind!=='passive').length,list.filter(s=>s.kind==='passive').length,list.filter(s=>s.isFinal).length],[9,5,1]);
    for(const source of job.skills){
      modes[source.growthMode]=(modes[source.growthMode]??0)+1;
      const skill=data.skills.get(source.id),effects=[skill.effect,...skill.effect.levels.map(l=>l.effect)];
      assert.equal(skillMaxLevel(skill),source.maxLevel);assert.equal(skill.cost,source.cost);assert.deepEqual(skill.effect.prerequisites,source.prerequisites);
      assert.deepEqual(effects.map(e=>e.source_description),source.effects);assert.deepEqual(effects.map(e=>e.short_description),source.simpleDescriptions);
      for(let i=0;i<effects.length;i++){const used=effectiveSkill(data,{learned:[skill.id],skillLevels:{[skill.id]:i+1}},skill);
        assert.equal(describeSkillEffect(data,used),source.effects[i]);assert.equal(describeSkillForUI(data,used),source.simpleDescriptions[i]);
        assert.doesNotMatch(describeSkillForUI(data,used),/\d+(?:\.\d+)?倍|STR|MAG|DEF|RES/);count++;}
    }
  }
  assert.equal(count,147);assert.deepEqual(modes,{lv5:18,lv3:15,none:12});
});

test('3職は初期選択と既存セーブの転職で使え、自動技能・装備を配らず準備中30職を閉じる',()=>{
  for(const id of ids){const c=fixture('warrior');c.member.hp=7;c.member.mp=2;
    const learned=[...c.member.learned],gear=structuredClone(c.game.storage.gear);
    assert.ok(availableJobs(data,c.game,c.member).some(j=>j.id===id));changeJob(data,c.game,0,id);
    assert.equal(c.member.hp,7);assert.equal(c.member.mp,2);assert.deepEqual(c.member.learned,learned);assert.deepEqual(c.game.storage.gear,gear);
    const saved=normalizeGame(data,JSON.parse(JSON.stringify(c.game)));assert.ok(availableJobs(data,saved,saved.party[0]).some(j=>j.id===id));}
  assert.equal(data.jobs.filter(j=>!j.skillsReady).length,12);
});

test('APで手動修得・強化し、固定技能のLv表記を増やさず、奥義10種類と他職継承を扱う',()=>{
  for(const job of spec.jobs){const c=fixture(job.id),first=data.skills.get(job.skills.find(s=>s.maxLevel===5&&!s.prerequisites.length).id);
    learnSkill(data,c.member,first.id);upgradeSkill(data,c.member,first.id);equipSkill(data,c.member,first.id);assert.equal(c.member.skillLevels[first.id],2);
    const ultimate=data.skills.get(job.id+'_U01');assert.match(learnBlock(data,c.member,ultimate),/10/);
    for(const s of job.skills.filter(s=>s.type!=='ultimate'))if(!c.member.learned.includes(s.id))c.member.learned.push(s.id);
    assert.equal(learnBlock(data,c.member,ultimate),'');learnSkill(data,c.member,ultimate.id);equipSkill(data,c.member,ultimate.id);
    changeJob(data,c.game,0,'warrior');assert.equal(c.member.loadout.ultimate,ultimate.id);
    assert.ok(actionOptions(data,c.game,c.b,0).skills.some(x=>x.skill.id===first.id));}
});

test('調息は最大HP割合で自分だけ回復し、MAGや物理武器の威力を使わない',()=>{
  const a=fixture(),c=fixture();for(const x of [a,c]){teach(x,'ascetic_A01',5);x.member.hp=1;}
  c.member.equip.weapon=null;const ah=a.member.hp,ch=c.member.hp;
  act(a,'ascetic_A01',1);act(c,'ascetic_A01',1);
  assert.equal(a.member.hp-ah,Math.round(maxHp(data,a.member)*.14));assert.equal(c.member.hp-ch,Math.round(maxHp(data,c.member)*.14));
  assert.equal(a.game.party[1].hp,maxHp(data,a.game.party[1]));
});

test('整息は自分への実回復・治療・防護だけで成立し、空回復・空治療・強化・継続回復では得ない',()=>{
  const c=fixture();for(const id of ['ascetic_A01','ascetic_A04','ascetic_A05','ascetic_A08','ascetic_P01','warrior_monk_A05','white_mage_A01'])teach(c,id);
  act(c,'ascetic_A01');assert.ok(!c.ally.breathReady);
  c.ally.statuses.curse={turns:9};c.member.hp-=50;act(c,'ascetic_A01');assert.ok(!c.ally.breathReady);delete c.ally.statuses.curse;
  act(c,'ascetic_A05');assert.ok(!c.ally.breathReady);
  act(c,'ascetic_A04');assert.ok(!c.ally.breathReady);act(c,'ascetic_A08');assert.ok(!c.ally.breathReady);
  c.game.party[1].hp-=30;act(c,'white_mage_A01',1);assert.ok(!c.ally.breathReady);
  act(c,'ascetic_A01');assert.ok(c.ally.breathReady);
  c.ally.statuses.poison={turns:3,n:1};act(c,'ascetic_A05');assert.ok(c.ally.breathReady);
  c.member.mp=maxMp(data,c.member);act(c,'warrior_monk_A05');assert.ok(c.ally.breathReady);assert.ok(!c.ally.previousSelfRecovery);
});

test('整息と循環の一撃は別条件で加算し、整息なしでも気功を使用できる',()=>{
  const a=fixture(),c=fixture();for(const x of [a,c]){teach(x,'ascetic_A01');teach(x,'ascetic_A09');x.member.hp-=30;act(x,'ascetic_A01');}
  teach(a,'ascetic_P01');a.ally.breathReady={rate:.15,skillId:'ascetic_P01'};
  a.b.rng=c.b.rng=81;act(a,'ascetic_A09');act(c,'ascetic_A09');near(dealt(a),dealt(c)*1.4/1.25,2);assert.ok(!a.ally.breathReady);
  const plain=fixture();teach(plain,'ascetic_A09');plain.b.rng=81;act(plain,'ascetic_A09');near(dealt(c),dealt(plain)*1.25,2);
});

test('整息と直前回復は別種の行動・スキップで失い、外部回復や自動回復から再生成しない',()=>{
  const c=fixture();for(const id of ['ascetic_A01','ascetic_A02','ascetic_P01'])teach(c,id);
  c.member.hp-=30;act(c,'ascetic_A01');act(c);assert.ok(!c.ally.breathReady&&!c.ally.previousSelfRecovery);
  c.member.hp-=20;act(c,'ascetic_A01');skip(c);assert.ok(!c.ally.breathReady&&!c.ally.previousSelfRecovery);
  delete c.ally.statuses.sleep;teach(c,'white_mage_A01',1,1);c.member.hp-=30;act(c,'white_mage_A01',0,{},1);assert.ok(!c.ally.breathReady);
});

test('呼吸の残響は通常技能の実自己回復だけでRESを上げ、空回復では発動しない',()=>{
  const c=fixture();teach(c,'ascetic_P04',3);teach(c,'ascetic_A01');act(c,'ascetic_A01');assert.ok(!c.ally.masterEffects.ascetic_P04);
  c.member.hp-=30;act(c,'ascetic_A01');assert.equal(c.ally.masterEffects.ascetic_P04.remaining,3);assert.equal(c.ally.masterEffects.ascetic_P04.values.res,.12);
});

test('不動の呼吸は対象3異常を30%乗算軽減し、100%加算耐性と既存異常を保つ',()=>{
  const c=fixture();teach(c,'ascetic_A07');const before=allyStatusChance(data,c.game,c.b,0,'fear',1),poison=allyStatusChance(data,c.game,c.b,0,'poison',1);c.ally.statuses.fear={turns:10};act(c,'ascetic_A07');
  near(allyStatusChance(data,c.game,c.b,0,'fear',1),before*.7);assert.ok(c.ally.statuses.fear);
  c.member.affix={...(c.member.affix??{}),'SRES:fear':100};
  c.ally.masterEffects.test={remaining:2,statusResist:{statuses:['fear'],rate:1,multiplicative:false}};
  assert.equal(allyStatusChance(data,c.game,c.b,0,'fear',1),0);
  assert.equal(allyStatusChance(data,c.game,c.b,0,'poison',1),poison);
});

test('山籠りは付与直後に回復せず、スキップでも回復・期間を消費し、再付与で回数を足さない',()=>{
  const c=fixture();teach(c,'ascetic_A08',3);c.member.hp-=80;const hp=c.member.hp;act(c,'ascetic_A08');
  assert.equal(c.member.hp,hp);assert.equal(c.ally.masterEffects.ascetic_A08.remaining,4);skip(c);
  assert.ok(c.member.hp>hp);assert.equal(c.ally.masterEffects.ascetic_A08.remaining,3);delete c.ally.statuses.sleep;
  act(c,'ascetic_A08');assert.equal(c.ally.masterEffects.ascetic_A08.remaining,4);
});

test('修験者奥義は対象異常だけ治し、呪いの回復阻害を越えず、RESと気功を強化して整息を得ない',()=>{
  const c=fixture();teach(c,'ascetic_U01');teach(c,'ascetic_P01');teach(c,'ascetic_A02');c.member.ultimateGauge=100;c.member.hp=1;
  for(const id of ['poison','toxic','burn','bleed','weaken','blind','fear','bind','curse'])c.ally.statuses[id]={turns:9,n:1};
  const mp=c.member.mp;act(c,'ascetic_U01');assert.equal(c.member.hp,1);assert.equal(c.member.mp,mp);assert.deepEqual(Object.keys(c.ally.statuses),['curse']);assert.ok(!c.ally.breathReady);
  assert.equal(c.ally.masterEffects.ascetic_U01.values.res,.4);near(masterDamageBonus(data,c.game,c.b,0,0,data.skills.get('ascetic_A02')),.3);
});

test('気功は物理武器の威力・武器技特効と分け、耐苦は対象異常中の直接被害だけを軽減する',()=>{
  const c=fixture();teach(c,'ascetic_P03',3);teach(c,'executioner_P02',5);const qi=data.skills.get('ascetic_A02');
  near(masterDamageBonus(data,c.game,c.b,0,0,qi),0);near(masterCutBonus(data,c.game,c.b,0,false,0),0);
  c.ally.statuses.weaken={turns:3};near(masterCutBonus(data,c.game,c.b,0,false,0),.12);
  c.ally.statuses.poison={turns:3};near(masterCutBonus(data,c.game,c.b,0,true,0),.12);
});

test('処刑人の低HP・異常特効は対象別で、今与える被害や今付ける出血を遡及参照しない',()=>{
  const c=fixture('executioner');teach(c,'executioner_P01');teach(c,'executioner_P03',3);const attack=data.skills.get('executioner_A08');
  c.enemies[0].hp=4e6;c.enemies[1].hp=2e6;c.enemies[1].statuses.bleed={turns:3};
  near(masterDamageBonus(data,c.game,c.b,0,0,attack),0);near(masterDamageBonus(data,c.game,c.b,0,1,attack),.68);
  c.enemies[0].hp=3e6;near(masterDamageBonus(data,c.game,c.b,0,0,attack),.58);
  assert.equal(masterDamageBonus(data,c.game,c.b,0,0,data.skills.get('executioner_A02')),.18);
});

test('連撃は打撃ごとに減少前HPを判定し、2打目から低HP特効を使える',()=>{
  const plain=fixture('executioner'),boost=fixture('executioner');
  for(const c of [plain,boost]){teach(c,'warrior_A06');c.enemies[0].maxHp=1000;c.enemies[0].hp=351;}
  teach(boost,'executioner_P01');plain.b.rng=boost.b.rng=10245;act(plain,'warrior_A06');act(boost,'warrior_A06');
  assert.ok(boost.enemies[0].hp<plain.enemies[0].hp);assert.equal(plain.enemies[1].hp,1e7);
});

test('死角の準備は指定対象とHP閾値を守り、対象外・通常攻撃・奥義には使わない',()=>{
  const c=fixture('executioner');for(const id of ['executioner_A03','executioner_A01','executioner_U01'])teach(c,id);teach(c,'executioner_A03',3);
  act(c,'executioner_A03',1);c.enemies[1].hp=7e6;const skill=data.skills.get('executioner_A01');
  near(specialistCrit(c.b,0,1,skill),.2);near(specialistCrit(c.b,0,0,skill),0);near(specialistCrit(c.b,0,1,data.skills.get('executioner_U01')),0);
  c.enemies[1].hp=8e6;near(specialistCrit(c.b,0,1,skill),0);act(c,'executioner_A01',1);assert.ok(!c.ally.masterEffects.executioner_A03);
});

test('命中準備は通常武器技1行動だけで使い切り、暗闇と回避を含む命中を補い上限を越えない',()=>{
  const c=fixture('executioner');teach(c,'executioner_A07');teach(c,'executioner_A01');act(c,'executioner_A07');
  near(specialistAccuracy(c.b,0,data.skills.get('executioner_A01')),.3);near(specialistAccuracy(c.b,0,data.skills.get('ascetic_A02')),0);
  c.enemies[0].evasion=1;c.ally.statuses.blind={turns:10};act(c,'executioner_A01');assert.ok(!c.ally.masterEffects['executioner_A07:accuracy']);
  const n=fixture('ninja');teach(n,'ninja_A07',3);teach(n,'ninja_A03');act(n,'ninja_A07');act(n,'ninja_A03');
  assert.ok(n.ally.masterEffects.ninja_A07);assert.ok(!n.ally.masterEffects['ninja_A07:accuracy']);
});

test('恐怖技はHP半分以下で成功しやすく、免疫・ボス補正を迂回しない',()=>{
  const c=fixture('executioner');teach(c,'executioner_A06');c.enemies[0].statusAffinity.fear='×';act(c,'executioner_A06');assert.ok(!c.enemies[0].statuses.fear);
  let high=0,low=0;
  for(let seed=50;seed<110;seed++){for(const [ratio,key] of [[.8,'high'],[.4,'low']]){
    const x=fixture('executioner',1,seed*9731);teach(x,'executioner_A06');x.enemies[0].hp=1e7*ratio;act(x,'executioner_A06');
    if(x.enemies[0].statuses.fear){if(key==='high')high++;else low++;}}}
  assert.ok(low>high);assert.ok(low<60);
});

test('断ち継ぎは主撃撃破時だけ選んだ別の敵へ1回追撃し、無効な予備対象は表示順先頭に替える',()=>{
  const c=fixture('executioner');teach(c,'executioner_A09');c.enemies[0].hp=1;act(c,'executioner_A09',0,{secondaryTarget:2});
  assert.ok(c.enemies[2].hp<1e7);assert.equal(c.enemies[1].hp,1e7);assert.equal(c.b.log.filter(s=>s.includes('断ち継ぐ追撃')).length,1);
  const x=fixture('executioner');teach(x,'executioner_A09');x.enemies[0].hp=1;act(x,'executioner_A09',0,{secondaryTarget:99});assert.ok(x.enemies[1].hp<1e7);assert.equal(x.enemies[2].hp,1e7);
  const no=fixture('executioner');teach(no,'executioner_A09');act(no,'executioner_A09',0,{secondaryTarget:1});assert.equal(no.enemies[1].hp,1e7);
});

test('追撃撃破から新たな追撃・状態付与・撃破MP・資源獲得を起こさない',()=>{
  const c=fixture('executioner');for(const id of ['executioner_A09','executioner_P04','berserker_P01'])teach(c,id);
  // 他の継承効果に撃破MPがあっても、追撃側には撃破反応を渡さない。
  const id='test_kill_mp_once';data.skills.set(id,{id,job:'executioner',kind:'passive',effect:{mod:{kill_mp:7}}});
  try {
    teach(c,id);c.member.mp=maxMp(data,c.member)-7;
    const mp=c.member.mp,cost=skillMp(data,c.member,data.skills.get('executioner_A09'),{battle:c.b,actor:0}),kills=c.member.mastery?.axe??0;
    c.enemies[0].hp=1;c.enemies[1].hp=1;
    act(c,'executioner_A09',0,{secondaryTarget:1});assert.equal(c.enemies[1].hp,0);assert.equal(c.enemies[2].hp,1e7);
    assert.equal(c.member.mp,mp-cost+7);assert.equal(c.member.mastery.axe,kills+1);
    assert.equal(c.ally.anger,1);assert.equal(c.b.log.filter(s=>s.includes('断ち継ぐ追撃')).length,1);
    assert.deepEqual(c.enemies[1].statuses,{});assert.ok(c.ally.masterEffects.executioner_P04);
  } finally {data.skills.delete(id);}
});

test('仕留めの余熱は通常の直接撃破後に1巡1回だけ次回MPを軽減し、奥義からは得ない',()=>{
  const c=fixture('executioner');teach(c,'executioner_P04');teach(c,'executioner_A01');c.enemies[0].hp=1;act(c,'executioner_A01');
  assert.equal(c.ally.masterEffects.executioner_P04.nextMpSave.rate,.2);const clock=c.ally.primaryKillRound;
  c.enemies[1].hp=1;act(c,'executioner_A01',1);assert.equal(c.ally.primaryKillRound,clock);assert.ok(!c.ally.masterEffects.executioner_P04);
  const x=fixture('executioner');teach(x,'executioner_P04');teach(x,'executioner_U01');x.member.ultimateGauge=100;x.enemies[0].hp=1;act(x,'executioner_U01');
  assert.ok(!x.ally.masterEffects.executioner_P04);assert.ok(x.enemies[1].hp<1e7);
});

test('死線への備えは攻撃元の現在HPだけを判定する',()=>{
  const c=fixture('executioner');teach(c,'executioner_P05',3);c.enemies[0].hp=3e6;
  near(masterCutBonus(data,c.game,c.b,0,false,0),.16);near(masterCutBonus(data,c.game,c.b,0,true,1),0);
  c.member.hp=1;c.enemies[0].hp=9e6;near(masterCutBonus(data,c.game,c.b,0,false,0),0);
});

test('分身は上限3体で、古い個体だけ置換し、残した個体の期限を更新しない',()=>{
  const c=fixture('ninja');teach(c,'ninja_A01',2);act(c,'ninja_A01');assert.deepEqual(c.ally.clones.map(x=>x.remaining),[3,3]);
  teach(c,'ninja_A01',1);act(c,'ninja_A01');assert.deepEqual(c.ally.clones.map(x=>x.remaining),[2,2,3]);
  act(c,'ninja_A01');assert.deepEqual(c.ally.clones.map(x=>x.remaining),[1,2,3]);assert.equal(cloneCount(c.ally),3);
  assert.ok(c.ally.clones.every(x=>x.skillId==='ninja_A01'&&x.level>=1));
});

test('分身の自動防御は命中前に敵1行動1体だけ使い、全体攻撃にも対応し、必中では使わない',()=>{
  const c=fixture('ninja');teach(c,'ninja_A01',3);act(c,'ninja_A01');enemyActs(c);
  assert.equal(cloneCount(c.ally),2);const first=cloneDefense(c.b,0);assert.equal(first.evasion,.2);assert.equal(cloneCount(c.ally),2);
  enemyActs(c,0,{sweep:true});assert.equal(cloneCount(c.ally),1);
  enemyActs(c,0,{sureHit:true});assert.equal(cloneCount(c.ally),1);
});

test('影替わりは単体1行動だけ無効化し、分身の自動消費を重ねず、全体・必中では発動しない',()=>{
  const c=fixture('ninja');for(const id of ['ninja_A01','ninja_A02'])teach(c,id);teach(c,'ninja_A01',3);act(c,'ninja_A01');act(c,'ninja_A02');
  const hp=c.member.hp;assert.equal(cloneCount(c.ally),2);enemyActs(c);assert.equal(c.member.hp,hp);assert.equal(cloneCount(c.ally),2);assert.ok(!c.ally.substitute);
  const x=fixture('ninja');teach(x,'ninja_A01',3);teach(x,'ninja_A02');act(x,'ninja_A01');act(x,'ninja_A02');
  enemyActs(x,0,{sweep:true});assert.ok(x.ally.substitute);assert.equal(cloneCount(x.ally),1);
  enemyActs(x,0,{sureHit:true});assert.ok(x.ally.substitute);assert.equal(cloneCount(x.ally),1);
  startMasterOpportunity(data,x.game,x.b,0,{heal(){}});assert.ok(!x.ally.substitute);
});

test('分身の自発消費後だけ回避補助を得て、自動防御・期限切れからは得ない',()=>{
  const c=fixture('ninja');for(const id of ['ninja_A01','ninja_A02','ninja_P01'])teach(c,id);teach(c,'ninja_A01',3);
  act(c,'ninja_A01');enemyActs(c);assert.ok(!c.ally.masterEffects.ninja_P01);act(c,'ninja_A02');assert.equal(c.ally.masterEffects.ninja_P01.values.eva,.1);
});

test('影刃の分身消費は任意で、空振りでも返さず、分身なしでは基礎攻撃を使える',()=>{
  const a=fixture('ninja'),c=fixture('ninja');
  for(const x of [a,c]){teach(x,'ninja_A01');teach(x,'ninja_A08');act(x,'ninja_A01');x.b.rng=8182;}
  act(a,'ninja_A08',0,{consumeClone:true});act(c,'ninja_A08',0,{consumeClone:false});near(dealt(a),dealt(c)*1.2,2);assert.equal(cloneCount(a.ally),0);assert.equal(cloneCount(c.ally),1);
  a.enemies[0].evasion=1;act(a,'ninja_A08');assert.ok(!a.b.log.at(-1)?.includes('使えなかった'));
});

test('分身・攻撃魔法・MP・対象の不足時は、MP・HP・分身・EXを一切支払わない',()=>{
  const c=fixture('ninja');teach(c,'ninja_A02');teach(c,'ninja_A09');teach(c,'ninja_A08');
  const before=[c.member.hp,c.member.mp,c.member.ultimateGauge??0];act(c,'ninja_A02');assert.deepEqual([c.member.hp,c.member.mp,c.member.ultimateGauge??0],before);
  teach(c,'ninja_A01');act(c,'ninja_A01');const mp=c.member.mp;act(c,'ninja_A09');assert.equal(c.member.mp,mp);assert.equal(cloneCount(c.ally),1);
  teach(c,'ninja_A04');act(c,'ninja_A08',99,{consumeClone:true});assert.equal(c.member.mp,mp);assert.equal(cloneCount(c.ally),1);
  act(c,'ninja_A01');c.member.mp=0;const count=cloneCount(c.ally);act(c,'ninja_A09');assert.equal(cloneCount(c.ally),count);
});

test('影写しは通常MAG攻撃の主対象だけへ同属性で1回追撃し、全体魔法の別対象へ広げない',()=>{
  const c=fixture('ninja');for(const id of ['ninja_A01','ninja_A04','ninja_A09','black_mage_A08'])teach(c,id);
  act(c,'ninja_A01');act(c,'ninja_A09');const before=c.enemies.map(e=>e.hp);act(c,'black_mage_A08',2);
  assert.equal(c.b.log.filter(s=>s.includes('影写しの追撃')).length,1);assert.ok(!c.ally.masterEffects.ninja_A09);
  assert.ok(before[2]-c.enemies[2].hp>before[0]-c.enemies[0].hp);
});

test('影写しは主対象の撃破・無効・不命中でも使い切り、奥義と回復には使わない',()=>{
  for(const mode of ['kill','immune','miss']){const c=fixture('ninja');for(const id of ['ninja_A01','ninja_A04','ninja_A09'])teach(c,id);
    act(c,'ninja_A01');act(c,'ninja_A09');if(mode==='kill')c.enemies[0].hp=1;if(mode==='immune')c.enemies[0].immune=['wind'];if(mode==='miss')c.enemies[0].evasion=1;
    act(c,'ninja_A04');assert.ok(!c.ally.masterEffects.ninja_A09);assert.ok(!c.b.log.some(s=>s.includes('影写しの追撃')));}
  const c=fixture('ninja');for(const id of ['ninja_A01','ninja_A04','ninja_A09','ninja_U01'])teach(c,id);
  act(c,'ninja_A01');act(c,'ninja_A09');c.member.ultimateGauge=100;act(c,'ninja_U01');assert.ok(c.ally.masterEffects.ninja_A09);assert.ok(!c.b.log.some(s=>s.includes('影写しの追撃')));
});

test('影の守りは敵行動開始時の最後の分身を使っても効き、次の敵行動では再判定する',()=>{
  const a=fixture('ninja'),c=fixture('ninja');for(const x of [a,c]){teach(x,'ninja_A01');act(x,'ninja_A01');x.ally.statuses.bind={turns:20};x.b.rng=81722;}
  teach(a,'ninja_P04',3);const ah=a.member.hp,ch=c.member.hp;enemyActs(a,0,{magic:true});enemyActs(c,0,{magic:true});
  assert.equal(cloneCount(a.ally),0);assert.ok(ah-a.member.hp<ch-c.member.hp);near(masterCutBonus(data,a.game,a.b,0,true,0),.12);
  a.b.enemyActionClock++;snapshotCloneDefense(a.b);near(masterCutBonus(data,a.game,a.b,0,true,0),0);
});

test('影の集中は行動開始の分身数を使い、同じ奥義で作る分身を遡及参照しない',()=>{
  const a=fixture('ninja'),c=fixture('ninja');for(const x of [a,c]){teach(x,'ninja_U01');x.member.ultimateGauge=100;}
  teach(a,'ninja_P05',3);act(a,'ninja_U01');act(c,'ninja_U01');assert.equal(dealt(a),dealt(c));
  const x=fixture('ninja'),y=fixture('ninja');for(const z of [x,y]){teach(z,'ninja_A01');teach(z,'ninja_A04');act(z,'ninja_A01');z.b.rng=9993;}
  teach(x,'ninja_P05',3);act(x,'ninja_A04');act(y,'ninja_A04');near(dealt(x),dealt(y)*1.1,2);
});

test('忍者奥義は分身3体へ置き換え、以後の防御と風闇魔法だけ強化し、追加手番を作らない',()=>{
  const c=fixture('ninja');teach(c,'ninja_U01');c.member.ultimateGauge=100;const mp=c.member.mp;act(c,'ninja_U01');
  assert.equal(c.member.mp,mp);assert.equal(cloneCount(c.ally),3);assert.deepEqual(c.ally.clones.map(x=>x.remaining),[3,3,3]);
  c.b.enemyActionClock=1;snapshotCloneDefense(c.b);assert.equal(cloneDefense(c.b,0).evasion,.3);
  near(masterDamageBonus(data,c.game,c.b,0,0,data.skills.get('ninja_A04')),.25);
  near(masterDamageBonus(data,c.game,c.b,0,0,data.skills.get('ninja_U01')),0);
});

test('新状態は3分類の共通アイコンで表示し、残数・期限・指定対象の閲覧で状態を変えない',()=>{
  const c=fixture('ninja');for(const id of ['ninja_A01','ninja_A02','ascetic_P01','ascetic_A01','executioner_A03'])teach(c,id);teach(c,'ninja_A01',3);
  act(c,'executioner_A03',1);c.member.hp-=40;act(c,'ascetic_A01');act(c,'ninja_A01');act(c,'ninja_A02');
  c.ally.breathReady={skillId:'ascetic_P01',rate:.15};
  const before=JSON.stringify(c.b);const entries=allyEffectEntries(data,c.game,c.b,0);assert.equal(JSON.stringify(c.b),before);
  assert.ok(section(c,JOB_EFFECT_SECTIONS.ongoing).some(e=>e.label.includes('分身')));
  assert.ok(section(c,JOB_EFFECT_SECTIONS.special).some(e=>e.label.includes('影替わり')));
  assert.ok(section(c,JOB_EFFECT_SECTIONS.special).some(e=>e.label.includes('整息')));
  for(const [title,list] of entries)if(Object.values(JOB_EFFECT_SECTIONS).includes(title))assert.ok(list.every(e=>e.icon===JOB_EFFECT_ICON));
});

test('問題待ちから保存・再開しても分身・準備・乱数の結果が一致し、戦闘終了で解除する',()=>{
  const c=fixture('ninja');for(const id of ['ninja_A01','ninja_A04','ninja_A08','ninja_A09'])teach(c,id);teach(c,'ninja_A01',3);
  act(c,'ninja_A01');act(c,'ninja_A09');c.b.turn={side:'ally',i:0,bleedProcessed:true};
  setPending(c.b,{type:'skill',skillId:'ninja_A08',target:0,consumeClone:true},{});
  const storage=new MemoryStorage(),session=new GameSession({storage});session.startNew(c.game);session.enterDungeon({dungeonId:'moss_cave'});session.setBattle(c.b);
  const restored=new GameSession({storage});normalizeGame(data,restored.game,restored.run);resolvePending(data,c.game,c.b,true);resolvePending(data,restored.game,restored.run.battle,true);
  assert.deepEqual(restored.game.party,c.game.party);assert.deepEqual(restored.run.battle,c.b);
  finishBattle(data,c.game,c.b);assert.equal(cloneCount(c.ally),0);assert.ok(!c.ally.breathReady&&!c.ally.substitute);assert.deepEqual(c.ally.masterEffects,{});
});

test('戦闘不能・スキップで戦闘内資源を延命せず、蘇生で分身を復元しない',()=>{
  const c=fixture('ninja');teach(c,'ninja_A01',3);act(c,'ninja_A01');skip(c);assert.deepEqual(c.ally.clones.map(x=>x.remaining),[2,2,2]);
  delete c.ally.statuses.sleep;c.ally.breathReady={rate:.15};c.ally.substitute={skillId:'ninja_A02'};enemyActs(c,0,{power:1e7,sureHit:true});
  assert.equal(c.member.hp,0);assert.equal(cloneCount(c.ally),0);assert.ok(!c.ally.breathReady&&!c.ally.substitute);
  teach(c,'white_mage_A04',1,1);act(c,'white_mage_A04',0,{},1);assert.ok(c.member.hp>0);assert.equal(cloneCount(c.ally),0);
});

test('追加45技能の全アクティブ・奥義100段階が実エンジンで発動し、費用・武器・対象条件を保つ',()=>{
  let count=0;
  for(const job of spec.jobs)for(const source of job.skills.filter(s=>s.type!=='passive'))for(let level=1;level<=source.maxLevel;level++){
    const c=fixture(job.id);teach(c,source.id,level);c.member.hp=Math.max(1,c.member.hp-20);
    if(source.id==='ninja_A02'||source.id==='ninja_A09'){teach(c,'ninja_A01',3);teach(c,'ninja_A04');act(c,'ninja_A01');}
    if(source.type==='ultimate')c.member.ultimateGauge=100;
    const before=c.member.mp;act(c,source.id,0,source.id==='executioner_A09'?{secondaryTarget:1}:{});
    assert.ok(c.b.log.some(line=>line.includes(source.name+'！')),source.id+' Lv'+level);
    if(source.type==='ultimate')assert.equal(c.member.ultimateGauge,0);else assert.ok(c.member.mp<before,source.id);
    count++;
  }
  assert.equal(count,100);
});

test('継承先で鎚を使っても、処刑人奥義の追撃は斬撃のまま扱う',()=>{
  const c=fixture('executioner');teach(c,'executioner_U01');c.member.ultimateGauge=100;
  const hammer=[...data.equipment.values()].find(item=>item.kind==='hammer'&&!item.unique);
  c.member.equip.weapon=makeGear(c.game,hammer.id);c.enemies[0].hp=1;c.enemies[1].immune=['slash'];
  act(c,'executioner_U01',0,{secondaryTarget:1});assert.equal(c.enemies[0].hp,0);assert.equal(c.enemies[1].hp,1e7);
});

test('気功の実ダメージに装備武器威力を加えず、武器なしでも同じ強さで使う',()=>{
  const a=fixture(),c=fixture();for(const x of [a,c])teach(x,'ascetic_A02');
  c.member.equip.weapon=null;act(a,'ascetic_A02');act(c,'ascetic_A02');assert.equal(dealt(a),dealt(c));
});

test('魔力集中を主撃に使っても、影写しの追撃へ同じ自発行動の増幅を二重に掛けない',()=>{
  const a=fixture('ninja'),c=fixture('ninja');
  for(const x of [a,c]){for(const id of ['ninja_A01','ninja_A04','ninja_A09'])teach(x,id);act(x,'ninja_A01');act(x,'ninja_A09');x.b.rng=971863;}
  teach(a,'black_mage_P01');act(a,'ninja_A04',0,{boost:true});act(c,'ninja_A04');
  const echo=x=>Number(x.b.log.find(s=>s.includes('影写しの追撃'))?.match(/ (\d+)のダメージ/)?.[1]);
  assert.ok(echo(a)>0);assert.equal(echo(a),echo(c));assert.ok(dealt(a)>dealt(c));
});
