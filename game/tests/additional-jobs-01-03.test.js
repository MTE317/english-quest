import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { realGameData, MemoryStorage } from './helpers.js';
import { createNewGame, defaultPartySpecs, normalizeGame } from '../js/game-state.js';
import { availableJobs, changeJob, learnSkill, upgradeSkill, equipSkill, effectiveSkill, skillMaxLevel, learnBlock } from '../js/growth.js';
import { makeGear, maxHp, maxMp, computeStats } from '../js/character.js';
import { createBattle, makeEnemy, setPending, resolvePending, nextTurn, actionOptions, skillMp, allyStatusChance, finishBattle } from '../js/battle.js';
import { masterDamageBonus, masterCutBonus, ownedBlessing, hpPayment, masterShieldRoom, absorbMasterShields, resolveBrokenBlessings } from '../js/job-combat.js';
import { battleConditionLabels } from '../js/ui/battle-view.js';
import { GameSession } from '../js/save.js';

const data=realGameData(), ids=['paladin','dark_knight','berserker'];
const spec=JSON.parse(readFileSync(new URL('../../docs/specs/additional-jobs-01-09-skills-v1.json',import.meta.url),'utf8'));
function fixture(job='paladin', weapon=job==='dark_knight'?'greatsword':job==='berserker'?'axe':'hammer', count=1, seed=51) {
  const specs=defaultPartySpecs(data); specs[0].job=job;
  const game=createNewGame(data,specs);
  for (const member of game.party) { member.lv=20; member.hp=maxHp(data,member); member.mp=maxMp(data,member); }
  const member=game.party[0]; member.ap=10000;
  const item=[...data.equipment.values()].filter(item=>item.slot==='weapon'&&item.kind===weapon&&!item.unique).sort((a,b)=>a.itemLv-b.itemLv)[0];
  if (item) member.equip.weapon=makeGear(game,item.id);
  const enemies=Array.from({length:count},()=>{
    const enemy=makeEnemy(data,'goblin',{lv:1});
    Object.assign(enemy,{hp:1e7,maxHp:1e7,def:30,res:30,spd:0,weak:[],strongWeak:[],resist:[],immune:[],statusAffinity:{},evasion:0});
    return enemy;
  });
  const b=createBattle(data,game,{enemies,seed});b.round=1;
  return {data,game,member,b,enemies};
}
function learn(c,id,level=1,actor=0) {
  const member=c.game.party[actor],skill=data.skills.get(id);
  member.learned=[...new Set([...member.learned,id])];
  if(skillMaxLevel(skill)>1){member.skillLevels??={};member.skillLevels[id]=level;}
  const slot=skill.kind==='passive'?'passives':'actions';
  if(skill.isFinal)member.loadout.ultimate=id;
  else member.loadout[slot]=[...new Set([...member.loadout[slot],id])];
}
function act(c,id=null,target=0,extra={},actor=0,correct=true) {
  c.b.turn={side:'ally',i:actor,bleedProcessed:true};
  setPending(c.b,id?{type:'skill',skillId:id,target,...extra}:{type:'attack',target},{});
  resolvePending(data,c.game,c.b,correct);
}
function enemyActs(c,{power=80,target=0,sweep=false}={}) {
  const enemy=c.enemies[0];
  Object.assign(enemy,{str:power,mag:power,magicRate:0,tactics:null,status:null,boss:sweep,pattern:sweep?'sweep':undefined});
  if(sweep)c.b.round=data.balance.boss_patterns?.sweep_every??3;
  enemy.statuses.taunt={actor:target,turns:5};
  c.b.turn=null;c.b.pending=null;c.b.queue=[{side:'enemy',i:0},{side:'ally',i:4}];
  nextTurn(data,c.game,c.b);
}

test('追加1〜3職45技能は設計の全段階・前提・cost・MP/APに一致し、未実装の15職は閉じたまま',()=>{
  const added=[...data.skills.values()].filter(skill=>ids.includes(skill.job));
  assert.equal(added.length,45);
assert.equal([...data.skills.values()].filter(skill=>skill.effect.master).length,570);
  assert.equal(data.jobs.filter(job=>job.skillsReady).length,38);
  for(const job of spec.jobs.filter(job=>ids.includes(job.id))) {
    const list=added.filter(skill=>skill.job===job.id);
    assert.deepEqual([list.filter(s=>s.kind==='passive').length,list.filter(s=>s.isFinal).length],[5,1]);
    for(const source of job.skills) {
      const skill=data.skills.get(source.id);
      assert.equal(skillMaxLevel(skill),source.maxLevel);
      assert.equal(skill.cost,source.type==='ultimate'?0:source.cost);
      assert.deepEqual(skill.effect.prerequisites,source.prerequisites);
      const effects=[skill.effect,...skill.effect.levels.map(level=>level.effect)];
      assert.deepEqual(effects.map(effect=>effect.source_description),source.effects);
      assert.ok(effects.every(effect=>effect.master&&effect.additional));
      assert.ok(skill.apToLearn>0);
      for(const level of skill.effect.levels) {assert.ok(level.ap>0);assert.equal(level.mp,skill.mp);}
      for(const prerequisite of source.prerequisites) assert.ok(prerequisite.level<=skillMaxLevel(data.skills.get(prerequisite.id)));
    }
  }
  assert.equal(data.jobsById.get('summoner').skillsReady,false);
});

test('新規・既存セーブは3職を初期から選べ、転職で技能・APを配布せず負傷も回復させない',()=>{
  const c=fixture('warrior','sword');
  c.member.hp=7;c.member.mp=3;const ap=c.member.ap;
  c.game.unlockedJobs=[];
  c.game.facilities.temple=2;
  assert.deepEqual(availableJobs(data,c.game).filter(job=>ids.includes(job.id)).map(job=>job.id),ids);
  for(const id of ids) {changeJob(data,c.game,0,id);assert.equal(c.member.hp,7);assert.equal(c.member.mp,3);assert.equal(c.member.ap,ap);assert.deepEqual(c.member.learned,[]);}
  normalizeGame(data,c.game);normalizeGame(data,c.game);
  assert.ok(ids.every(id=>availableJobs(data,c.game).some(job=>job.id===id)));
  assert.equal(new Set(c.game.unlockedJobs).size,c.game.unlockedJobs.length);
  assert.throws(()=>changeJob(data,c.game,0,'necromancer'),/まだ選べない/);
});

test('実際のAP習得・成長・奥義10種類条件・他職継承を利用できる',()=>{
  for(const job of ids) {
    const c=fixture(job);
    const ultimate=data.skills.get(job+'_U01');
    assert.match(learnBlock(data,c.member,ultimate),/10種類/);
    for(const skill of [...data.skills.values()].filter(s=>s.job===job&&!s.isFinal)) {
      for(const pre of skill.effect.prerequisites) while((c.member.skillLevels?.[pre.id]??1)<pre.level)upgradeSkill(data,c.member,pre.id);
      learnSkill(data,c.member,skill.id);
    }
    assert.equal(learnBlock(data,c.member,ultimate),'');learnSkill(data,c.member,ultimate.id);equipSkill(data,c.member,ultimate.id);
    equipSkill(data,c.member,job+'_P02');
    const before=c.member.ap;changeJob(data,c.game,0,'warrior');
    assert.equal(c.member.ap,before);assert.equal(c.member.loadout.ultimate,ultimate.id);
    assert.ok(c.member.loadout.passives.includes(job+'_P02'));
  }
});

test('聖騎士の加護はRESを参照し、全防護の合計はHP50%以内で対象に1枚だけ',()=>{
  const c=fixture();learn(c,'paladin_A02',5);learn(c,'paladin_A03',3);learn(c,'white_mage_A06',3);
  act(c,'white_mage_A06',1);act(c,'paladin_A02',1);
  const first=ownedBlessing(c.b,0,1);assert.ok(first.shield>0);
  assert.ok(masterShieldRoom(data,c.game,c.b,1)>=0);
  act(c,'paladin_A03',1);
  assert.equal(Object.values(c.b.allies[1].masterEffects).filter(effect=>effect.blessing).length,1);
  const total=Object.values(c.b.allies[1].masterEffects).reduce((n,e)=>n+(e.shield??0),0);
  assert.ok(total<=Math.floor(maxHp(data,c.game.party[1])*.5));
  assert.equal(c.b.allies[1].masterEffects.blessing.remaining,4);
  const unarmed=fixture(), gun=fixture('paladin','gun');
  for(const ctx of [unarmed,gun]){learn(ctx,'paladin_A02');act(ctx,'paladin_A02',1);}
  assert.equal(ownedBlessing(unarmed.b,0,1).shield,ownedBlessing(gun.b,0,1).shield);
});

test('加護の移動は2対象を検証し、残量・反応・残り期間を保持し、無効操作でMPを払わない',()=>{
  const c=fixture();learn(c,'paladin_A02');learn(c,'paladin_A05');learn(c,'paladin_P01');
  act(c,'paladin_A02',1);const before=structuredClone(ownedBlessing(c.b,0,1));
  const mp=c.member.mp;act(c,'paladin_A05',1,{sourceTarget:1});assert.equal(c.member.mp,mp);
  act(c,'paladin_A05',2,{sourceTarget:1});
  assert.equal(ownedBlessing(c.b,0,1),null);
  assert.equal(ownedBlessing(c.b,0,2).shield,before.shield);
  assert.equal(ownedBlessing(c.b,0,2).remaining,before.remaining);
  assert.equal(ownedBlessing(c.b,0,2).breakHeal,before.breakHeal);
});

test('護光破は加護の任意消費を選べ、光壁の誓いは自分由来の加護を必要とする',()=>{
  const low=fixture(),high=fixture();
  for(const c of [low,high]){learn(c,'paladin_A02');learn(c,'paladin_A09');act(c,'paladin_A02',0);}
  act(low,'paladin_A09',0,{consumeBlessing:false});act(high,'paladin_A09',0,{consumeBlessing:true});
  assert.ok(low.enemies[0].hp>high.enemies[0].hp);assert.ok(ownedBlessing(low.b,0));assert.equal(ownedBlessing(high.b,0),null);
  learn(high,'paladin_A07');const mp=high.member.mp;act(high,'paladin_A07');assert.equal(high.member.mp,mp);
  act(low,'paladin_A02',0);learn(low,'paladin_A07',3);act(low,'paladin_A07');
  assert.equal(ownedBlessing(low.b,0),null);assert.ok(low.b.allies.every(ally=>ally.masterEffects.paladin_A07.values.cut>0));
});

test('加護破壊は生存対象だけ回復し、致命傷や呪いを救済せず、パッシブは付与時に固定する',()=>{
  for(const mode of ['normal','curse','dead','latePassive']) {
    const c=fixture();learn(c,'paladin_A02');
    if(mode!=='latePassive')learn(c,'paladin_P01');
    act(c,'paladin_A02',0);if(mode==='latePassive')learn(c,'paladin_P01');
    c.member.hp=mode==='dead'?1:Math.floor(maxHp(data,c.member)*.6);
    if(mode==='curse')c.b.allies[0].statuses.curse={turns:5};
    const shield=ownedBlessing(c.b,0);shield.shield=1;
    enemyActs(c,{power:mode==='dead'?10000:45});
    assert.equal(c.b.allies[0].masterEffects.blessing,undefined);
    const healed=c.b.log.some(line=>line.includes('加護が砕け'));
    assert.equal(healed,mode==='normal',mode);
    if(mode==='dead')assert.equal(c.member.hp,0);
  }
});

test('破壊反応は敵1行動の後にまとめ、通常回復1回・奥義回復2回と共通反撃1回を守る',()=>{
  const c=fixture();learn(c,'paladin_U01');learn(c,'paladin_P01');c.member.ultimateGauge=100;
  act(c,'paladin_U01');
  for(let i=0;i<3;i++) {const effect=c.b.allies[i].masterEffects.blessing;effect.shield=1;absorbMasterShields(c.b,i,2,{i:0},()=>{});}
  assert.equal(c.b.brokenBlessings.length,3);
  const heals=[];resolveBrokenBlessings(data,c.game,c.b,{heal:(i,n)=>heals.push([i,n]),canReact:()=>true,react:()=>{}});
  assert.equal(heals.length,2);assert.ok(heals.every(([i,n])=>n===Math.floor(maxHp(data,c.game.party[i])*.1)));
  const d=fixture();learn(d,'paladin_A03');act(d,'paladin_A03',1);act(d,'paladin_A03',2);
  for(let i=1;i<3;i++)absorbMasterShields(d.b,i,100000,{i:0},()=>{});
  let counters=0;resolveBrokenBlessings(data,d.game,d.b,{heal:()=>{},canReact:()=>true,react:()=>counters++});
  assert.equal(counters,1);
});

test('反照の加護は実際の敵行動で武器不要の反撃を行い、反撃構えと上限を共有する',()=>{
  const c=fixture();learn(c,'paladin_A03');act(c,'paladin_A03',0);ownedBlessing(c.b,0).shield=1;
  c.member.equip.weapon=null;enemyActs(c,{power:45});
  assert.ok(c.enemies[0].hp<c.enemies[0].maxHp);assert.equal(c.b.allies[0].counterCount,1);
  const d=fixture();learn(d,'paladin_A03');learn(d,'knight_A04');act(d,'paladin_A03',0);ownedBlessing(d.b,0).shield=1;act(d,'knight_A04');
  enemyActs(d,{power:45});assert.equal(d.b.allies[0].counterCount,1);
  assert.equal(d.b.log.filter(line=>line.includes('反照した')).length,0);
});

test('光の余熱は残量を残した自然失効だけで発動し、破壊や移動・上書きで発動しない',()=>{
  const c=fixture();learn(c,'paladin_A02');learn(c,'paladin_P03',3);
  act(c,'paladin_A02',0);const remaining=ownedBlessing(c.b,0).remaining;
  for(let n=0;n<remaining;n++)act(c);
  assert.equal(ownedBlessing(c.b,0),null);assert.equal(c.b.allies[0].masterEffects.paladin_P03.remaining,3);
});

test('静穏の祈りは残存付与率を乗算軽減し、100%耐性を迂回せず既存異常も治さない',()=>{
  const c=fixture();learn(c,'paladin_A06',3);c.b.allies[1].statuses.poison={turns:3};
  act(c,'paladin_A06',1);
  assert.ok(c.b.allies[1].statuses.poison);
  assert.equal(allyStatusChance(data,c.game,c.b,1,'poison',.5,{statusResist:.5}),.2);
  assert.equal(allyStatusChance(data,c.game,c.b,1,'poison',.5,{statusResist:1}),0);
  assert.equal(allyStatusChance(data,c.game,c.b,1,'bleed',.5,{statusResist:.5}),.25);
});

test('HP費用は1行動1回で、半額準備は該当技だけに使い、HP不足や不正対象では費用0',()=>{
  const c=fixture('dark_knight','greatsword',4);learn(c,'dark_knight_A08');learn(c,'dark_knight_A06');learn(c,'dark_knight_A03');
  act(c,'dark_knight_A06');const full=hpPayment(data,c.game,c.b,0,data.skills.get('dark_knight_A08'));
  act(c,'dark_knight_A03');assert.equal(hpPayment(data,c.game,c.b,0,data.skills.get('dark_knight_A08')),full);
  const hp=c.member.hp;act(c,'dark_knight_A08');assert.equal(hp-c.member.hp,full);
  assert.equal(hpPayment(data,c.game,c.b,0,data.skills.get('dark_knight_A08')),Math.ceil(maxHp(data,c.member)*.1));
  learn(c,'dark_knight_A01');c.member.hp=1;const mp=c.member.mp;
  act(c,'dark_knight_A01');assert.equal(c.member.hp,1);assert.equal(c.member.mp,mp);
  c.member.hp=maxHp(data,c.member);act(c,'dark_knight_A01',999);assert.equal(c.member.mp,mp);
});

test('血の代償は費用を払った当該武器行動だけを強化し、支援から持ち越さない',()=>{
  const low=fixture('dark_knight'),high=fixture('dark_knight');
  for(const c of [low,high]){learn(c,'dark_knight_A01');learn(c,'dark_knight_A04');learn(c,'dark_knight_A03');}
  learn(high,'dark_knight_P01');
  act(low,'dark_knight_A01');act(high,'dark_knight_A01');assert.ok(low.enemies[0].hp>high.enemies[0].hp);
  act(low,'dark_knight_A04');act(high,'dark_knight_A04');
  const before=[low.enemies[0].hp,high.enemies[0].hp];act(low,'dark_knight_A03');act(high,'dark_knight_A03');
  assert.equal(before[0]-low.enemies[0].hp,before[1]-high.enemies[0].hp);
});

test('吸収は実被害を参照し、通常・装備・継続を合算して行動上限を共有する',()=>{
  const c=fixture('dark_knight');learn(c,'dark_knight_A02',5);learn(c,'dark_knight_P03',3);
  c.member.hp=1;const cap=Math.floor(maxHp(data,c.member)*.18);
  c.member.equip.weapon.enh=10000;act(c,'dark_knight_A02');assert.equal(c.member.hp,1+cap);
  const d=fixture('dark_knight');learn(d,'dark_knight_A02');d.member.hp=1;d.enemies[0].hp=3;act(d,'dark_knight_A02');
  assert.ok(d.member.hp<=2,'過剰ダメージから吸収しない');
  const e=fixture('dark_knight');learn(e,'dark_knight_A02');e.member.hp=1;e.b.allies[0].statuses.curse={turns:5};act(e,'dark_knight_A02');assert.equal(e.member.hp,1);
});

test('暗黒騎士奥義は固有上限35%で一度だけ吸収し、次の3行動の吸収へつなぐ',()=>{
  const c=fixture('dark_knight');learn(c,'dark_knight_U01');learn(c,'dark_knight_A03');learn(c,'dark_knight_P03',3);
  c.member.equip.weapon.enh=10000;c.member.hp=1;c.member.ultimateGauge=100;
  act(c,'dark_knight_U01');assert.equal(c.member.hp,1+Math.floor(maxHp(data,c.member)*.35));
  assert.equal(c.b.allies[0].masterEffects.dark_knight_U01.remaining,3);
  const before=c.member.hp;act(c,'dark_knight_A03');assert.equal(c.member.hp-before,Math.floor(maxHp(data,c.member)*.18));
});

test('怒気はパッシブ装備時だけ、全体・4連撃も1行動で1増え、外れや奥義では増えない',()=>{
  const c=fixture('berserker','axe',4);learn(c,'berserker_A09');act(c,'berserker_A09');assert.equal(c.b.allies[0].anger,0);
  learn(c,'berserker_P01');act(c,'berserker_A09');assert.equal(c.b.allies[0].anger,1);
  learn(c,'berserker_A02',3);act(c,'berserker_A02');assert.equal(c.b.allies[0].anger,2);
  act(c);assert.equal(c.b.allies[0].anger,3);act(c);assert.equal(c.b.allies[0].anger,3);
  assert.ok(masterCutBonus(data,c.game,c.b,0,false)<0);
  c.enemies.forEach(e=>{e.evasion=1;});act(c,'berserker_A09');assert.equal(c.b.allies[0].anger,3);
  learn(c,'berserker_U01');c.member.ultimateGauge=100;act(c,'berserker_U01');assert.equal(c.b.allies[0].anger,0);
});

test('怒気放出は消費前にMP軽減し、通常8%増幅と二重にせず、準備なしでも使える',()=>{
  const c=fixture('berserker');learn(c,'berserker_P01');learn(c,'berserker_P03',3);learn(c,'berserker_A04');
  const undiscounted=skillMp(data,c.member,data.skills.get('berserker_A04'),{battle:c.b,actor:0});
  c.b.allies[0].anger=3;const discounted=skillMp(data,c.member,data.skills.get('berserker_A04'),{battle:c.b,actor:0});
  assert.ok(discounted<undiscounted);
  const mp=c.member.mp;act(c,'berserker_A04');assert.equal(mp-c.member.mp,discounted);assert.equal(c.b.allies[0].anger,0);
  assert.equal(c.b.allies[0].advancedAction,undefined);
  const d=fixture('berserker');learn(d,'berserker_A04');act(d,'berserker_A04');assert.ok(d.enemies[0].hp<d.enemies[0].maxHp);
});

test('鎮心は怒気と吼えるの両方を解除し、怒気0から回復を作らない',()=>{
  const c=fixture('berserker');learn(c,'berserker_P01');learn(c,'berserker_A03');learn(c,'berserker_A05');
  c.b.allies[0].anger=3;c.member.hp=Math.floor(maxHp(data,c.member)*.5);
  act(c,'berserker_A03');assert.equal(c.b.allies[0].anger,2);
  const before=c.member.hp;act(c,'berserker_A05');assert.equal(c.b.allies[0].anger,0);assert.equal(c.b.allies[0].masterEffects.berserker_A03,undefined);
  assert.equal(c.member.hp-before,Math.floor(maxHp(data,c.member)*.05));
  const hp=c.member.hp;act(c,'berserker_A05');assert.equal(c.member.hp,hp);
});

test('強行突破は恐怖中も選べ、封印では止まり、自分の対象異常だけを治療する',()=>{
  const c=fixture('berserker');learn(c,'berserker_A07',3);
  c.b.allies[0].statuses={fear:{turns:5},bind:{turns:5},blind:{turns:5},poison:{turns:5}};
  assert.equal(actionOptions(data,c.game,c.b,0).skills.find(e=>e.skill.id==='berserker_A07').reason,'');
  c.b.allies[0].statuses.seal={turns:5};assert.match(actionOptions(data,c.game,c.b,0).skills.find(e=>e.skill.id==='berserker_A07').reason,/封印/);
  delete c.b.allies[0].statuses.seal;act(c,'berserker_A07',null);assert.deepEqual(Object.keys(c.b.allies[0].statuses),['poison']);
});

test('怒気・加護・HP半額準備は問題待ち保存から同じ結果で再開し、戦闘終了で消える',()=>{
  const c=fixture('berserker');learn(c,'berserker_P01');learn(c,'dark_knight_A06');learn(c,'dark_knight_A01');learn(c,'paladin_A02');
  act(c,'paladin_A02',1);act(c,'dark_knight_A06');c.b.allies[0].anger=2;
  c.b.turn={side:'ally',i:0,bleedProcessed:true};setPending(c.b,{type:'skill',skillId:'dark_knight_A01',target:0},{});
  const storage=new MemoryStorage(),session=new GameSession({storage});session.startNew(c.game);session.enterDungeon({dungeonId:'moss_cave'});session.setBattle(c.b);
  const restored=new GameSession({storage});normalizeGame(data,restored.game,restored.run);
  resolvePending(data,c.game,c.b,true);resolvePending(data,restored.game,restored.run.battle,true);
  assert.deepEqual(restored.game.party,c.game.party);assert.deepEqual(restored.run.battle,c.b);
  finishBattle(data,c.game,c.b);assert.equal(c.b.allies[0].anger,0);assert.deepEqual(c.b.allies[1].masterEffects,{});
});

test('戦闘表示で怒気・加護残量が確認でき、通常状態と混同しない',()=>{
  const c=fixture();learn(c,'paladin_A02');act(c,'paladin_A02',1);
  assert.ok(battleConditionLabels(data,c.b.allies[1]).some(label=>label.startsWith('加護 ')));
  c.b.allies[0].anger=2;assert.ok(battleConditionLabels(data,c.b.allies[0]).includes('怒気 2/3'));
});

test('追加3職の全アクティブ・奥義を全成長段階で実際に発動できる',()=>{
  let cases=0;
  for(const source of spec.jobs.filter(job=>ids.includes(job.id)).flatMap(job=>job.skills).filter(skill=>skill.type!=='passive')) {
    for(let level=1;level<=source.maxLevel;level++) {
      const job=source.id.replace(/_[AU]\d+$/,''),c=fixture(job,undefined,4);
      learn(c,source.id,level);const skill=effectiveSkill(data,c.member,data.skills.get(source.id));
      const extra={};let target=['heal','ally_buff'].includes(skill.kind)?1:0;
      if(skill.effect.rules?.consume_blessing||skill.effect.rules?.move_blessing) {
        learn(c,'paladin_A02');act(c,'paladin_A02',skill.effect.rules.move_blessing?2:0);
        if(skill.effect.rules.move_blessing)extra.sourceTarget=2;
      }
      if(skill.effect.select_targets)extra.targets=[0,1].slice(0,skill.effect.target_limit);
      if(skill.isFinal)c.member.ultimateGauge=100;
      if(skill.kind==='heal')c.game.party[1].hp=1;
      if(skill.kind==='cure')c.b.allies[0].statuses.fear={turns:5};
      act(c,source.id,target,extra);
      assert.ok(c.b.log.some(line=>line.includes(`の${source.name}！`)),`${source.id} Lv${level}`);
      assert.ok(!c.b.log.some(line=>line.includes('使えなかった')||line.includes('何も起こらなかった')),`${source.id} Lv${level}`);
      if(skill.kind==='attack')assert.ok(c.enemies.some(enemy=>enemy.hp<enemy.maxHp),`${source.id} Lv${level}`);
      assert.ok(c.game.party.every(member=>Number.isFinite(member.hp)&&Number.isFinite(member.mp)));
      cases++;
    }
  }
  assert.equal(cases,spec.jobs.filter(job=>ids.includes(job.id)).flatMap(job=>job.skills).filter(skill=>skill.type!=='passive').reduce((n,s)=>n+s.maxLevel,0));
});

test('追加パッシブは現職に依存せず、武器・光属性・種族・HP・状態の条件を守る',()=>{
  const c=fixture('warrior','hammer');
  learn(c,'paladin_P04',3);c.enemies[0].types=['undead','demon'];
  assert.equal(masterDamageBonus(data,c.game,c.b,0,0,null,['light']),.12);
  assert.equal(masterDamageBonus(data,c.game,c.b,0,0,null,['dark']),0);
  learn(c,'dark_knight_P05',5);
  assert.equal(masterDamageBonus(data,c.game,c.b,0,0,null,['dark']),.13);
  learn(c,'dark_knight_P04',3);c.member.hp=maxHp(data,c.member);
  assert.equal(masterCutBonus(data,c.game,c.b,0,true),0);
  c.member.hp=Math.floor(maxHp(data,c.member)*.6);assert.equal(masterCutBonus(data,c.game,c.b,0,true),.12);
  const d=fixture('warrior','sword');learn(d,'berserker_P05',5);
  assert.equal(masterDamageBonus(data,d.game,d.b,0,0,null,['slash']),0);
  learn(d,'berserker_P04',1);d.b.allies[0].statuses.poison={turns:4};
  assert.equal(masterCutBonus(data,d.game,d.b,0,false),0);
  d.member.skillLevels.berserker_P04=2;assert.equal(masterCutBonus(data,d.game,d.b,0,false),.1);
});

test('HP費用は外れても支払うが、無効操作はMP・HP・加護・怒気・ゲージを消費しない',()=>{
  const c=fixture('dark_knight');learn(c,'dark_knight_A01');c.enemies[0].evasion=1;
  const hp=c.member.hp;act(c,'dark_knight_A01');assert.equal(hp-c.member.hp,Math.ceil(maxHp(data,c.member)*.06));
  assert.equal(c.enemies[0].hp,c.enemies[0].maxHp);
  const d=fixture('berserker');learn(d,'berserker_P01');learn(d,'berserker_A04');d.b.allies[0].anger=3;
  const before={hp:d.member.hp,mp:d.member.mp,gauge:d.member.ultimateGauge};
  act(d,'berserker_A04',999);
  assert.deepEqual({hp:d.member.hp,mp:d.member.mp,gauge:d.member.ultimateGauge},before);assert.equal(d.b.allies[0].anger,3);
});

test('全体攻撃で加護の付与者が後から倒れた場合も、途中へ破壊回復を割り込ませない',()=>{
  const c=fixture();learn(c,'paladin_A02',1,5);learn(c,'paladin_P01',1,5);
  act(c,'paladin_A02',1,{},5);c.b.allies[1].masterEffects.blessing.shield=1;
  c.game.party[1].hp=Math.floor(maxHp(data,c.game.party[1])*.5);c.game.party[5].hp=1;
  enemyActs(c,{power:45,sweep:true});
  assert.equal(c.game.party[5].hp,0);
  assert.equal(c.b.allies[1].masterEffects.blessing,undefined);
  assert.ok(!c.b.log.some(line=>line.includes('加護が砕け')));
});

test('装備の余剰回復障壁と加護は、付与順にかかわらず合計HP50%を超えない',()=>{
  const c=fixture();learn(c,'paladin_A02');learn(c,'paladin_A08');
  c.member.equip.weapon.affixes={RES:10000,MAG:10000,OVERHEAL_SHIELD:60};
  const total=()=>Object.values(c.b.allies[0].masterEffects).reduce((n,e)=>n+(e.shield??0),0)+(c.b.allies[0].buffs.barrier?.[0]??0);
  const cap=Math.floor(maxHp(data,c.member)*.5);
  act(c,'paladin_A02',0);assert.equal(total(),cap);
  act(c,'paladin_A08',0);assert.equal(total(),cap);
  delete c.b.allies[0].masterEffects.blessing;act(c,'paladin_A08',0);
  assert.ok(c.b.allies[0].buffs.barrier[0]>0);
  act(c,'paladin_A02',0);assert.equal(total(),cap);
});
