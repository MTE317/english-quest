import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {realGameData,MemoryStorage} from './helpers.js';
import {createNewGame,defaultPartySpecs,normalizeGame} from '../js/game-state.js';
import {makeGear,maxHp,maxMp,computeStats} from '../js/character.js';
import {availableJobs,changeJob,learnSkill,upgradeSkill,equipSkill,effectiveSkill,skillMaxLevel,learnBlock} from '../js/growth.js';
import {createBattle,makeEnemy,setPending,resolvePending,nextTurn,actionOptions,battleStats,targetKind,allyStatusChance,finishBattle,skillMp} from '../js/battle.js';
import {masterDamageBonus,masterCutBonus,prayerStage,startMasterOpportunity,finishMasterOpportunity,prepareDuelAttack,duelVictory} from '../js/job-combat.js';
import {allyEffectEntries,JOB_EFFECT_SECTIONS} from '../js/ui/battle-view.js';
import {JOB_EFFECT_ICON} from '../js/ui/effect-icons.js';
import {describeSkillForUI,describeSkillEffect} from '../js/skill-effects.js';
import {GameSession} from '../js/save.js';

const data=realGameData(),ids=['samurai','gladiator','warrior_monk','ascetic','executioner','ninja'];
const spec=JSON.parse(readFileSync(new URL('../../docs/specs/additional-jobs-04-06-skills-v1.json',import.meta.url),'utf8'));
function fixture(job='samurai',count=2,seed=51) {
  const specs=defaultPartySpecs(data);specs[0].job=job;
  const game=createNewGame(data,specs);
  game.facilities.temple=12;
  for(const m of game.party){m.lv=20;m.hp=maxHp(data,m);m.mp=maxMp(data,m);}
  const member=game.party[0];member.ap=10000;
  const kind=job==='samurai'?'katana':job==='gladiator'?'greatsword':'spear';
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
  setPending(c.b,id?{type:'skill',skillId:id,target,...extra}:{type:'attack',target},{});
  resolvePending(data,c.game,c.b,correct);
}
function enemyActs(c,index=0,{magic=false,power=80,target=0,element='slash',status=null,statusRate=0}={}){
  const e=c.enemies[index];
  Object.assign(e,{str:power,mag:power,mp:1000,magicRate:magic?1:0,tactics:null,status,statusRate,boss:false,pattern:undefined,attackElement:element});
  e.statuses.taunt={actor:target,turns:10};
  c.b.allies[target].statuses.bind={turns:100};
  c.b.turn=null;c.b.pending=null;c.b.queue=[{side:'enemy',i:index},{side:'ally',i:4}];
  nextTurn(data,c.game,c.b);
}
const section=(c,key,actor=0)=>allyEffectEntries(data,c.game,c.b,actor).find(([title])=>title===key)?.[1]??[];

test('追加4〜6職は45技能・137段階で設計と一致し、通常9・パッシブ5・奥義1を保つ',()=>{
assert.equal(data.jobs.filter(j=>j.skillsReady).length,32);
  assert.equal([...data.skills.values()].filter(s=>s.effect.master).length,480);
  let stages=0;
  for(const job of spec.jobs){
    const list=[...data.skills.values()].filter(s=>s.job===job.id);assert.equal(list.length,15);
    assert.deepEqual([list.filter(s=>s.kind==='passive').length,list.filter(s=>s.isFinal).length],[5,1]);
    for(const source of job.skills){
      const s=data.skills.get(source.id),effects=[s.effect,...s.effect.levels.map(l=>l.effect)];
      assert.equal(skillMaxLevel(s),source.maxLevel);assert.equal(s.cost,source.type==='ultimate'?0:source.cost);
      assert.deepEqual(effects.map(e=>e.source_description),source.effects);
      assert.deepEqual(s.effect.prerequisites,source.prerequisites);
      assert.deepEqual(effects.map(e=>e.short_description),source.simpleDescriptions);
      for(const [i,effect] of effects.entries()){
        const member={learned:[s.id],skillLevels:{[s.id]:i+1}};
        const used=effectiveSkill(data,member,s);
        assert.equal(describeSkillForUI(data,used),source.simpleDescriptions[i]);
        assert.equal(describeSkillEffect(data,used),source.effects[i]);
        assert.doesNotMatch(effect.short_description,/\d+(?:\.\d+)?倍|STR|MAG|DEF|RES/);
        stages++;
      }
    }
  }
  assert.equal(stages,137);assert.equal(data.jobsById.get('necromancer').skillsReady,false);
});
test('新規・既存セーブで3職を初期から選べ、転職で技能や装備を自動配布しない',()=>{
  for(const id of ids){
    const c=fixture('warrior');const available=availableJobs(data,c.game,c.member);
    assert.ok(available.some(j=>j.id===id));c.member.hp=7;c.member.mp=2;
    const learned=[...c.member.learned],gear=structuredClone(c.game.storage.gear);
    changeJob(data,c.game,0,id);
    assert.deepEqual(c.member.learned,learned);assert.deepEqual(c.game.storage.gear,gear);assert.equal(c.member.hp,7);assert.equal(c.member.mp,2);
    assert.ok(availableJobs(data,normalizeGame(data,JSON.parse(JSON.stringify(c.game))),c.member).some(j=>j.id===id));
  }
});
test('APで修得・強化・奥義10種類条件を扱い、覚えた技能を他職へ継承できる',()=>{
  const c=fixture();const a=data.skills.get('samurai_A03');
  assert.equal(learnBlock(data,c.member,a),'');learnSkill(data,c.member,a.id);upgradeSkill(data,c.member,a.id);
  assert.equal(c.member.skillLevels[a.id],2);equipSkill(data,c.member,a.id);
  changeJob(data,c.game,0,'warrior');assert.ok(actionOptions(data,c.game,c.b,0).skills.some(x=>x.skill.id===a.id));
  const ultimate=data.skills.get('samurai_U01');assert.match(learnBlock(data,c.member,ultimate),/10/);
  for(const s of [...data.skills.values()].filter(s=>s.job==='samurai'&&!s.isFinal))if(!c.member.learned.includes(s.id))c.member.learned.push(s.id);
  assert.equal(learnBlock(data,c.member,ultimate),'');
});
test('攻めと受けは相互排他で、STR・RESの低下を含めて戦闘能力へ反映する',()=>{
  const c=fixture();teach(c,'samurai_A01');teach(c,'samurai_A02');const base=battleStats(data,c.game,c.b,0);
  act(c,'samurai_A01');let st=battleStats(data,c.game,c.b,0);
  assert.ok(st.str>base.str);assert.ok(st.res<base.res);assert.equal(c.ally.stance.mode,'attack');
  act(c,'samurai_A02');st=battleStats(data,c.game,c.b,0);
  assert.ok(st.str<base.str);assert.equal(st.res,base.res);assert.equal(c.ally.stance.mode,'guard');
});
test('構えの転機は初回・即切替・同じ構えで発生せず、1行動後の切替で次の武器技だけを強める',()=>{
  const c=fixture();for(const id of ['samurai_A01','samurai_A02','samurai_A03','samurai_P01'])teach(c,id);
  act(c,'samurai_A01');assert.ok(!c.ally.masterEffects.samurai_P01);
  act(c,'samurai_A02');assert.ok(!c.ally.masterEffects.samurai_P01);
  act(c);act(c,'samurai_A01');assert.ok(c.ally.masterEffects.samurai_P01?.nextDamage);
  act(c,'samurai_A03');assert.ok(!c.ally.masterEffects.samurai_P01);
  act(c,'samurai_A01');assert.ok(!c.ally.masterEffects.samurai_P01);
});
test('受けの構えは物理だけを軽減し、受けの呼吸で魔法防御を補える',()=>{
  const a=fixture(),c=fixture();teach(a,'samurai_A02');teach(a,'samurai_P04',3);act(a,'samurai_A02');
  assert.ok(battleStats(data,a.game,a.b,0).res>battleStats(data,c.game,c.b,0).res);
  a.b.rng=c.b.rng=91827;const ah=a.member.hp,ch=c.member.hp;enemyActs(a);enemyActs(c);
  assert.ok(ah-a.member.hp<ch-c.member.hp);
});
test('雷気の間は次の通常武器技を軽減し、発生させた技や奥義には使わない',()=>{
  const c=fixture();teach(c,'samurai_A04');teach(c,'samurai_A03');teach(c,'samurai_P03',3);
  const cost=skillMp(data,c.member,data.skills.get('samurai_A04'),{battle:c.b,actor:0});
  const normal=skillMp(data,c.member,data.skills.get('samurai_A03'),{battle:c.b,actor:0});
  const before=c.member.mp;act(c,'samurai_A04');
  assert.equal(before-c.member.mp,cost);
  assert.ok(c.ally.masterEffects.samurai_P03?.nextMpSave);
  assert.ok(skillMp(data,c.member,data.skills.get('samurai_A03'),{battle:c.b,actor:0})<normal);
  act(c,'samurai_A03');assert.ok(!c.ally.masterEffects.samurai_P03);
});
test('見切りの属性選択を検証し、違う属性では消費せず、該当する物理攻撃1回に使う',()=>{
  const c=fixture();teach(c,'samurai_A08');const before=c.member.mp;
  act(c,'samurai_A08',0,{element:'fire'});assert.equal(c.member.mp,before);assert.ok(!c.ally.readGuard);
  act(c,'samurai_A08',0,{element:'slash'});assert.equal(c.ally.readGuard.element,'slash');
  enemyActs(c,0,{element:'blunt',power:30});assert.ok(c.ally.readGuard);
  enemyActs(c,0,{element:'slash',power:30});assert.ok(!c.ally.readGuard);
});
test('見切りと受け流しは次の自分の行動開始で失効する',()=>{
  const c=fixture();teach(c,'samurai_A08');act(c,'samurai_A08',0,{element:'slash'});
  startMasterOpportunity(data,c.game,c.b,0,{heal(){}});assert.ok(!c.ally.readGuard);
});
test('静断は構えなしでも使え、攻めでは強化し、受けでは防御を一部無視する',()=>{
  const base=fixture(),attack=fixture(),guard=fixture();
  for(const c of [base,attack,guard])teach(c,'samurai_A09');
  teach(attack,'samurai_A01');act(attack,'samurai_A01');teach(guard,'samurai_A02');act(guard,'samurai_A02');
  const skill=data.skills.get('samurai_A09');
  assert.equal(masterDamageBonus(data,attack.game,attack.b,0,0,skill,['slash']),.15);
  for(const c of [base,attack,guard]){c.b.rng=91827;act(c,'samurai_A09');assert.ok(c.enemies[0].hp<1e7);}
});
test('侍奥義は受けの構えだけで味方全員に物理軽減を付け、全体の欄に表示する',()=>{
  const c=fixture();teach(c,'samurai_A02');teach(c,'samurai_U01');act(c,'samurai_A02');c.member.ultimateGauge=100;act(c,'samurai_U01');
  assert.ok(c.b.allies.every(a=>a.masterEffects.samurai_U01?.values.pcut===.2));
  assert.ok(section(c,JOB_EFFECT_SECTIONS.party).some(e=>e.label.includes('一閃双相')));
  assert.ok(!section(c,JOB_EFFECT_SECTIONS.ongoing).some(e=>e.label.includes('一閃双相')));
});
test('決闘は挑発無効でも成立し、攻防の増加は本人の指名した相手にだけ適用する',()=>{
  const c=fixture('gladiator');teach(c,'gladiator_A01');c.enemies[0].statusAffinity.taunt='×';act(c,'gladiator_A01',0);
  assert.equal(c.ally.duel.target,0);assert.ok(!c.enemies[0].statuses.taunt);
  assert.equal(masterDamageBonus(data,c.game,c.b,0,0,null),.15);assert.equal(masterDamageBonus(data,c.game,c.b,0,1,null),0);
  assert.equal(masterCutBonus(data,c.game,c.b,0,false,0),-.1);assert.equal(masterCutBonus(data,c.game,c.b,0,false,1),0);
  assert.equal(masterDamageBonus(data,c.game,c.b,1,0,null),0);
});
test('一対の心得は別の敵・複数対象・ランダム対象を選ぶと最初の打撃前に集中を失う',()=>{
  const c=fixture('gladiator');teach(c,'gladiator_A01');teach(c,'gladiator_P01');act(c,'gladiator_A01');
  assert.equal(masterDamageBonus(data,c.game,c.b,0,0,null),.3);
  prepareDuelAttack(c.game,c.b,0,[0,1]);assert.equal(c.ally.duel.focus,false);assert.equal(masterDamageBonus(data,c.game,c.b,0,0,null),.15);
  act(c,'gladiator_A01');teach(c,'berserker_A09');act(c,'berserker_A09');assert.equal(c.ally.duel.focus,false);
});
test('受け流しの剣は指定した敵の物理攻撃だけを軽減・反撃し、他の敵では消費しない',()=>{
  const c=fixture('gladiator');teach(c,'gladiator_A03');assert.equal(targetKind(data,{type:'skill',skillId:'gladiator_A03'},c.member),'enemy');
  act(c,'gladiator_A03',1);assert.equal(c.ally.masterCounter.target,1);
  const enemy0=c.enemies[0].hp;enemyActs(c,0,{power:30});assert.equal(c.enemies[0].hp,enemy0);assert.ok(c.ally.masterCounter);
  const enemy1=c.enemies[1].hp;enemyActs(c,1,{power:30});assert.ok(c.enemies[1].hp<enemy1);assert.ok(!c.ally.masterCounter);
});
test('崩盾斬は命中後に防御系の解除可能効果だけを期間の短い順で消す',()=>{
  const c=fixture('gladiator');teach(c,'gladiator_A04',2);c.enemies[0].buffs={str:[.4,1],def:[.2,3],pcut:[.1,1],res:[.2,1],'guard:fire':[1,2]};
  act(c,'gladiator_A04');
  assert.ok(!c.enemies[0].buffs.pcut);assert.ok(!c.enemies[0].buffs.def);
  assert.ok(c.enemies[0].buffs.str&&c.enemies[0].buffs.res&&c.enemies[0].buffs['guard:fire']);
});
test('逆手の一撃は指名相手からの実際のHP被害だけを次の自発行動へ記録する',()=>{
  const c=fixture('gladiator');teach(c,'gladiator_A01');teach(c,'gladiator_A06');act(c,'gladiator_A01');
  enemyActs(c,1,{power:30});assert.equal(c.ally.duel.wasHit,false);
  enemyActs(c,0,{power:30});assert.equal(c.ally.duel.wasHit,true);
  const skill=data.skills.get('gladiator_A06');assert.ok(Math.abs(masterDamageBonus(data,c.game,c.b,0,0,skill,['slash'])-.45)<1e-10);
  act(c,'gladiator_A06');assert.equal(c.ally.duel.wasHit,false);
});
test('間合いの支配は対象を1体だけ持ち、決闘とは別の敵も指定できる',()=>{
  const c=fixture('gladiator');teach(c,'gladiator_A01');teach(c,'gladiator_A08',3);act(c,'gladiator_A01',0);act(c,'gladiator_A08',1);
  assert.equal(c.ally.duel.target,0);assert.equal(c.ally.distance.target,1);assert.equal(c.ally.distance.evasion,.2);
});
test('勝負の一太刀は外れても決闘を終え、標的撃破の回復は解除前に一戦一度だけ判定する',()=>{
  const c=fixture('gladiator');for(const id of ['gladiator_A01','gladiator_A09','gladiator_P05'])teach(c,id);
  act(c,'gladiator_A01');c.enemies[0].evasion=1;act(c,'gladiator_A09');assert.ok(!c.ally.duel);
  c.enemies[0].evasion=0;act(c,'gladiator_A01');c.member.hp-=100;const before=c.member.hp;c.enemies[0].hp=1;
  act(c,'gladiator_A09');assert.ok(c.member.hp>before);assert.equal(c.ally.duelRewardUsed,true);assert.ok(!c.ally.duel);
  c.enemies[0].hp=1e7;act(c,'gladiator_A01');c.member.hp-=40;const later=c.member.hp;c.enemies[0].hp=1;act(c);assert.equal(c.member.hp,later);
});
test('反撃や別の使用者の撃破では決着の余裕を発動させない',()=>{
  const c=fixture('gladiator');teach(c,'gladiator_A01');teach(c,'gladiator_P05');act(c,'gladiator_A01');c.enemies[0].hp=0;
  assert.equal(duelVictory(data,c.game,c.b,0,0,false),0);assert.ok(!c.ally.duelRewardUsed);
  assert.equal(duelVictory(data,c.game,c.b,1,0,true),0);
});
test('剣闘士奥義は標的限定の反撃準備を持ち、通常の反撃と同じ枠を使う',()=>{
  const c=fixture('gladiator');teach(c,'gladiator_U01');c.member.ultimateGauge=100;act(c,'gladiator_U01',1);
  assert.equal(c.ally.masterCounter.target,1);assert.equal(c.ally.masterCounter.cut,.4);assert.equal(c.ally.masterCounter.remaining,2);
});
test('祈念は有効な支援で最大2までたまり、同値更新・空回復・空治療で増えない',()=>{
  const c=fixture('warrior_monk');for(const id of ['warrior_monk_P01','warrior_monk_A01','warrior_monk_A05','white_mage_A01','white_mage_A03'])teach(c,id);
  act(c,'white_mage_A01',1);act(c,'white_mage_A03',1);assert.equal(prayerStage(data,c.game,c.b,0),0);
  act(c,'warrior_monk_A01',1);assert.equal(c.ally.prayer,1);
  act(c,'warrior_monk_A01',1);assert.equal(c.ally.prayer,1);
  act(c,'warrior_monk_A05',1);assert.equal(c.ally.prayer,2);
  act(c,'warrior_monk_A05',1);assert.equal(c.ally.prayer,2);
});
test('祈念の通常消費は武器技1行動で1段階、気功・通常攻撃・準備では消費しない',()=>{
  const c=fixture('warrior_monk');for(const id of ['warrior_monk_P01','warrior_monk_A02','warrior_monk_A04'])teach(c,id);c.ally.prayer=2;
  act(c);assert.equal(c.ally.prayer,2);act(c,'warrior_monk_A04');assert.equal(c.ally.prayer,2);
  act(c,'warrior_monk_A02');assert.equal(c.ally.prayer,1);
});
test('祈念解放は1以上の祈念とパッシブを必要とし、全消費後に全員へ防護を与えて再獲得しない',()=>{
  const c=fixture('warrior_monk');teach(c,'warrior_monk_A08');const before=c.member.mp;act(c,'warrior_monk_A08');assert.equal(c.member.mp,before);
  teach(c,'warrior_monk_P01');c.ally.prayer=2;act(c,'warrior_monk_A08');assert.equal(c.ally.prayer,0);
  assert.ok(c.b.allies.every(a=>a.masterEffects.warrior_monk_A08?.shield>0));
  assert.ok(section(c,JOB_EFFECT_SECTIONS.ongoing).some(e=>e.label.includes('祈念解放')));
});
test('奉納の槍は全消費の20%だけを使い、通常消費の15%を二重適用しない',()=>{
  const a=fixture('warrior_monk'),c=fixture('warrior_monk');for(const f of [a,c])teach(f,'warrior_monk_A09');
  teach(a,'warrior_monk_P01');a.ally.prayer=2;act(a,'warrior_monk_A09');act(c,'warrior_monk_A09');
  assert.equal(a.ally.prayer,0);assert.ok(Math.abs((1e7-a.enemies[0].hp)-(1e7-c.enemies[0].hp)*1.2)<=2);
});
test('合掌の備えは判定を眺めても消費せず、対象異常の実判定1回で成功失敗にかかわらず消える',()=>{
  const c=fixture('warrior_monk');teach(c,'warrior_monk_A07');const before=allyStatusChance(data,c.game,c.b,0,'fear',1);
  act(c,'warrior_monk_A07');assert.ok(Math.abs(allyStatusChance(data,c.game,c.b,0,'fear',1)-before*.7)<1e-8);
  allyStatusChance(data,c.game,c.b,0,'fear',1);assert.equal(c.ally.masterEffects.warrior_monk_A07.statusResist.uses,1);
  enemyActs(c,0,{power:20,status:'poison',statusRate:0});assert.ok(c.ally.masterEffects.warrior_monk_A07);
  enemyActs(c,0,{power:20,status:'fear',statusRate:0});assert.ok(!c.ally.masterEffects.warrior_monk_A07);
  assert.equal(data.skills.get('warrior_monk_A07').effect.rules.status_resist.uses,1);
});
test('結びの守りは有効な支援後に魔法軽減を付け、祈念の余光は消費後にだけRESを上げる',()=>{
  const c=fixture('warrior_monk');for(const id of ['warrior_monk_A01','warrior_monk_A02','warrior_monk_P01','warrior_monk_P03','warrior_monk_P05'])teach(c,id);
  act(c,'warrior_monk_A01',1);assert.equal(c.ally.masterEffects.warrior_monk_P03.values.mcut,.1);assert.ok(!c.ally.masterEffects.warrior_monk_P05);
  act(c,'warrior_monk_A02');assert.equal(c.ally.masterEffects.warrior_monk_P05.values.res,.1);
});
test('僧兵奥義は祈念なしでも攻撃と全体軽減が成立し、祈念がある場合だけ全消費する',()=>{
  const c=fixture('warrior_monk');teach(c,'warrior_monk_U01');c.member.ultimateGauge=100;act(c,'warrior_monk_U01');
  assert.ok(c.enemies[0].hp<1e7);assert.ok(c.b.allies.every(a=>a.masterEffects.warrior_monk_U01?.values.cut===.3));
  assert.ok(section(c,JOB_EFFECT_SECTIONS.party).some(e=>e.label.includes('護法の大槍')));
});
test('新状態は3分類の同じアイコンで表示し、閲覧で戦闘データを変更しない',()=>{
  const c=fixture();for(const id of ['samurai_A01','samurai_A08','gladiator_A01','gladiator_A08','warrior_monk_P01'])teach(c,id);
  act(c,'samurai_A01');act(c,'gladiator_A01');act(c,'gladiator_A08',1);act(c,'samurai_A08',0,{element:'slash'});
  const before=structuredClone(c);const groups=allyEffectEntries(data,c.game,c.b,0);
  for(const [name,entries] of groups.filter(([name])=>Object.values(JOB_EFFECT_SECTIONS).includes(name)))for(const e of entries)assert.equal(e.icon,JOB_EFFECT_ICON);
  assert.ok(section(c,JOB_EFFECT_SECTIONS.ongoing).some(e=>e.label.includes('攻めの構え')));
  assert.ok(section(c,JOB_EFFECT_SECTIONS.ongoing).some(e=>e.label.includes('祈念')));
  assert.ok(section(c,JOB_EFFECT_SECTIONS.special).some(e=>e.label.includes('見切りの間')));
  assert.deepEqual(c,before);
});
test('反撃は一巡1回の上限を守り、反撃の手並みは武器反撃だけを強める',()=>{
  const c=fixture('gladiator');teach(c,'gladiator_U01');teach(c,'gladiator_P03',3);c.member.ultimateGauge=100;act(c,'gladiator_U01');
  enemyActs(c,0,{power:20});const hp=c.enemies[0].hp;enemyActs(c,0,{power:20});assert.equal(c.enemies[0].hp,hp);
  const weapon={kind:'attack',effect:{master:true,base:'weapon',tags:['reaction'],rules:{}},elements:['slash']};
  const qigong={...weapon,effect:{...weapon.effect,base:'phys'}};
  assert.equal(masterDamageBonus(data,c.game,c.b,0,0,weapon,['slash']),.3);assert.equal(masterDamageBonus(data,c.game,c.b,0,0,qigong,['light']),0);
});
test('追加45技能の全アクティブ・奥義92段階を実エンジンで使用できる',()=>{
  let count=0;
  for(const job of spec.jobs)for(const source of job.skills.filter(s=>s.type!=='passive'))for(let level=1;level<=source.maxLevel;level++){
    const c=fixture(job.id);teach(c,source.id,level);
    if(source.id==='warrior_monk_A08'){teach(c,'warrior_monk_P01');c.ally.prayer=2;}
    if(source.type==='ultimate')c.member.ultimateGauge=100;
    const before=c.member.mp;act(c,source.id,0,source.id==='samurai_A08'?{element:'slash'}:{});
    assert.ok(c.b.log.some(line=>line.includes(source.name+'！')),source.id+' Lv'+level);
    if(source.type==='ultimate')assert.equal(c.member.ultimateGauge,0);else assert.ok(c.member.mp<before,source.id);
    count++;
  }
  assert.equal(count,92);
});

test('状態は問題待ちの保存から同じ結果で再開し、戦闘終了で解除する',()=>{
  const c=fixture('warrior_monk');for(const id of ['samurai_A01','gladiator_A01','gladiator_A08','warrior_monk_P01','warrior_monk_A09'])teach(c,id);
  act(c,'samurai_A01');act(c,'gladiator_A01');act(c,'gladiator_A08',1);c.ally.prayer=2;
  c.b.turn={side:'ally',i:0,bleedProcessed:true};setPending(c.b,{type:'skill',skillId:'warrior_monk_A09',target:0},{});
  const storage=new MemoryStorage(),session=new GameSession({storage});session.startNew(c.game);session.enterDungeon({dungeonId:'moss_cave'});session.setBattle(c.b);
  const restored=new GameSession({storage});normalizeGame(data,restored.game,restored.run);
  resolvePending(data,c.game,c.b,true);resolvePending(data,restored.game,restored.run.battle,true);
  assert.deepEqual(restored.game.party,c.game.party);assert.deepEqual(restored.run.battle,c.b);
  finishBattle(data,c.game,c.b);assert.ok(!c.ally.stance&&!c.ally.duel&&!c.ally.distance&&!c.ally.readGuard);assert.equal(c.ally.prayer,0);
});
test('戦闘不能で構え・決闘・間合い・祈念を失い、蘇生しても一戦1回の使用済み状態は戻さない',()=>{
  const c=fixture('warrior_monk');for(const id of ['samurai_A01','gladiator_A01','gladiator_A08','warrior_monk_P01'])teach(c,id);
  act(c,'samurai_A01');act(c,'gladiator_A01');act(c,'gladiator_A08',1);c.ally.prayer=2;c.ally.duelRewardUsed=true;
  enemyActs(c,0,{power:1e6});assert.equal(c.member.hp,0);assert.ok(!c.ally.stance&&!c.ally.duel&&!c.ally.distance);assert.equal(c.ally.prayer,0);
  teach(c,'white_mage_A04',1,1);act(c,'white_mage_A04',0,{},1);assert.ok(c.member.hp>0);assert.equal(c.ally.duelRewardUsed,true);
});
test('行動不能で手番を失っても、決闘の期間と構えで過ごした機会を数える',()=>{
  const c=fixture();teach(c,'samurai_A01');teach(c,'gladiator_A01');act(c,'gladiator_A01');act(c,'samurai_A01');
  const remaining=c.ally.duel.remaining,held=c.ally.stance.held;
  finishMasterOpportunity(data,c.game,c.b,0,{heal(){}},null,false);
  assert.equal(c.ally.duel.remaining,remaining-1);assert.equal(c.ally.stance.held,held+1);
});
test('不正な対象ではMP・HP・祈念・EXを消費しない',()=>{
  const c=fixture('warrior_monk');teach(c,'warrior_monk_P01');teach(c,'warrior_monk_A09');c.ally.prayer=2;c.member.ultimateGauge=100;
  const before=[c.member.hp,c.member.mp,c.ally.prayer,c.member.ultimateGauge];act(c,'warrior_monk_A09',99);
  assert.deepEqual([c.member.hp,c.member.mp,c.ally.prayer,c.member.ultimateGauge],before);
  teach(c,'gladiator_A03');act(c,'gladiator_A03',99);assert.deepEqual([c.member.hp,c.member.mp,c.ally.prayer,c.member.ultimateGauge],before);
});
test('僧兵の防護はRES、剣闘士の防護はDEFを使い、合計防護上限を超えない',()=>{
  const g=fixture('gladiator');teach(g,'gladiator_A07');const st=battleStats(data,g.game,g.b,0),f=data.basicJobRules.protection;
  act(g,'gladiator_A07');const expected=Math.floor(Math.min(maxHp(data,g.member)*.5,Math.floor(f.base+f.per_level*g.member.lv+f.stat_scale*st.def)*.7));
  assert.equal(g.ally.masterEffects.gladiator_A07.shield,expected);
  const c=fixture('warrior_monk');teach(c,'warrior_monk_A05',5);const res=battleStats(data,c.game,c.b,0).res;act(c,'warrior_monk_A05',1);
  assert.equal(c.b.allies[1].masterEffects.warrior_monk_A05.shield,Math.floor(Math.min(maxHp(data,c.game.party[1])*.5,Math.floor(f.base+f.per_level*c.member.lv+f.stat_scale*res))));
});
test('支援による祈念は現職を問わず得られ、味方への実際の回復と治療でも増える',()=>{
  const c=fixture('warrior');for(const id of ['warrior_monk_P01','white_mage_A01','white_mage_A03'])teach(c,id);
  c.game.party[1].hp-=20;act(c,'white_mage_A01',1);assert.equal(c.ally.prayer,1);
  c.b.allies[1].statuses.poison={turns:3,n:1};act(c,'white_mage_A03',1);assert.equal(c.ally.prayer,2);
});
test('決闘の回復は実際の反撃撃破や自発行動のない強制攻撃から発動しない',()=>{
  const c=fixture('gladiator');for(const id of ['gladiator_A01','gladiator_A03','gladiator_P05'])teach(c,id);
  act(c,'gladiator_A01');act(c,'gladiator_A03');c.member.hp-=40;const hp=c.member.hp;c.enemies[0].hp=1;
  enemyActs(c,0,{power:20});assert.equal(c.enemies[0].hp,0);assert.ok(!c.ally.duelRewardUsed);assert.ok(c.member.hp<hp);
  c.enemies[0].hp=1e7;act(c,'gladiator_A01');c.enemies[0].hp=0;
  assert.equal(duelVictory(data,c.game,c.b,0,0,true),0);
});

test('不正解時は奥義の攻撃だけでなく、同時に付く全体軽減も弱まる',()=>{
  const monk=fixture('warrior_monk');teach(monk,'warrior_monk_U01');monk.member.ultimateGauge=100;
  act(monk,'warrior_monk_U01',0,{},0,false);
  const cut=monk.ally.masterEffects.warrior_monk_U01.values.cut;assert.ok(cut>0&&cut<.3);
  assert.ok(monk.b.allies.every(a=>a.masterEffects.warrior_monk_U01.values.cut===cut));
  const c=fixture();teach(c,'samurai_A02');teach(c,'samurai_U01');act(c,'samurai_A02');c.member.ultimateGauge=100;
  act(c,'samurai_U01',0,{},0,false);assert.ok(c.ally.masterEffects.samurai_U01.values.pcut>0&&c.ally.masterEffects.samurai_U01.values.pcut<.2);
});
