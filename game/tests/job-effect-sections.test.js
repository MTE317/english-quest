import test from 'node:test';
import assert from 'node:assert/strict';
import { realGameData } from './helpers.js';
import { createNewGame, defaultPartySpecs } from '../js/game-state.js';
import { createBattle, makeEnemy, setPending, resolvePending } from '../js/battle.js';
import { makeGear, maxHp, maxMp } from '../js/character.js';
import { allyEffectEntries, allyEffectSections, JOB_EFFECT_SECTIONS } from '../js/ui/battle-view.js';
import { JOB_EFFECT_ICON } from '../js/ui/effect-icons.js';

const data=realGameData();
function fixture() {
  const game=createNewGame(data,defaultPartySpecs(data));
  for(const member of game.party){member.lv=20;member.hp=maxHp(data,member);member.mp=maxMp(data,member);}
  const member=game.party[0], battle=createBattle(data,game,{enemies:Array.from({length:3},()=>makeEnemy(data,'goblin',{lv:1})),seed:51});
  battle.round=1;
  return {game,member,battle,ally:battle.allies[0]};
}
function teach(c,id,level=1) {
  const skill=data.skills.get(id);
  c.member.learned.push(id);c.member.skillLevels??={};c.member.skillLevels[id]=level;
  if(skill.isFinal)c.member.loadout.ultimate=id;
  else c.member.loadout[skill.kind==='passive'?'passives':'actions'].push(id);
}
function act(c,id,target=0) {
  const skill=data.skills.get(id), weapon=skill.effect.weapons?.find(id=>id!=='none'&&id!=='unarmed');
  if(weapon){const definition=[...data.equipment.values()].find(gear=>gear.slot==='weapon'&&gear.kind===weapon);c.member.equip.weapon=makeGear(c.game,definition.id);}
  c.battle.turn={side:'ally',i:0,bleedProcessed:true};
  if(skill.isFinal)c.member.ultimateGauge=100;
  setPending(c.battle,{type:'skill',skillId:id,target},{});resolvePending(data,c.game,c.battle,true);
  assert.ok(c.battle.log.some(line=>line.includes(`の${skill.name}！`)),id);
}
const sections=(c,index=0)=>new Map(allyEffectEntries(data,c.game,c.battle,index));
const names=(c,section,index=0)=>sections(c,index).get(section).map(entry=>entry.label);

test('全体の強化弱化・固有継続・特殊効果は同じ1アイコンで示し、通常状態と個別能力の画像は保持する',()=>{
  const c=fixture();
  c.battle.partyBuffs={str:[.2,3],'down:mag':[.1,2],cut:[.15,2]};
  c.ally.statuses.poison={turns:2};c.ally.buffs={def:[.1,2],'down:eva':[.2,2],barrier:[40,2]};
  c.ally.masterEffects.test={remaining:2,values:{str:.1,mag:.1}};c.ally.normalSkillReady=true;
  const rows=sections(c);
  assert.deepEqual([...rows.keys()],['状態異常','自身の強化・弱化','全体の強化・弱化','ジョブの固有継続効果','その他の特殊効果']);
  assert.equal(rows.get('状態異常')[0].icon,'poison');
  assert.deepEqual(rows.get('自身の強化・弱化').map(e=>e.icon),['def-up','eva-down']);
  for(const title of Object.values(JOB_EFFECT_SECTIONS))assert.ok(rows.get(title).every(entry=>entry.icon===JOB_EFFECT_ICON),title);
  assert.ok(names(c,JOB_EFFECT_SECTIONS.special).some(label=>label.includes('障壁 40 HP')));
});

test('実際の全体号令・歌は全体強化、全体奥義の加護は固有継続へ振り分ける',()=>{
  const c=fixture();
  for(const id of ['knight_A02','bard_A01','paladin_U01']){teach(c,id);act(c,id);}
  const party=names(c,JOB_EFFECT_SECTIONS.party,1),ongoing=names(c,JOB_EFFECT_SECTIONS.ongoing,1);
  assert.ok(party.some(label=>label.startsWith('守りの号令')));
  assert.ok(party.some(label=>label.startsWith('守りの歌')));
  assert.ok(!ongoing.some(label=>label.startsWith('守りの歌')));
  assert.ok(ongoing.some(label=>label.startsWith('黎明の城壁')&&label.includes('加護')));
  assert.ok(!party.some(label=>label.startsWith('黎明の城壁')));
});

test('HP費用半減と次回MP軽減は特殊効果、練気のSTR強化は固有継続に分ける',()=>{
  const c=fixture();teach(c,'dark_knight_A06');teach(c,'monk_A04',3);
  act(c,'dark_knight_A06');act(c,'monk_A04');
  assert.ok(names(c,JOB_EFFECT_SECTIONS.special).some(label=>label.includes('血を鎮める')&&label.includes('HP消費 -50%')));
  assert.ok(names(c,JOB_EFFECT_SECTIONS.special).some(label=>label.includes('練気')&&label.includes('残り2回')));
  assert.ok(names(c,JOB_EFFECT_SECTIONS.ongoing).some(label=>label.includes('練気')&&label.includes('STR +18%')));
});

test('怒気・連携は現職を問わず装着技能に応じて固有継続へ表示し、未修得の能力を増やさない',()=>{
  const c=fixture();
  assert.deepEqual(names(c,JOB_EFFECT_SECTIONS.ongoing),[]);
  teach(c,'berserker_P01');teach(c,'monk_P01');
  assert.ok(names(c,JOB_EFFECT_SECTIONS.ongoing).includes('怒気 0/3'));
  assert.ok(names(c,JOB_EFFECT_SECTIONS.ongoing).includes('連携 0/3段階'));
  c.ally.anger=2;c.ally.comboStage=3;
  assert.ok(names(c,JOB_EFFECT_SECTIONS.ongoing).includes('怒気 2/3'));
  assert.ok(names(c,JOB_EFFECT_SECTIONS.ongoing).includes('連携 3/3段階'));
  assert.ok(!names(c,JOB_EFFECT_SECTIONS.special).some(label=>label.includes('怒気')));
});

test('守勢は有効な継続効果だけ表示し、他者を護衛する状態は特殊効果へ分ける',()=>{
  const c=fixture();teach(c,'knight_P03');c.ally.coverStages=2;
  assert.ok(!names(c,JOB_EFFECT_SECTIONS.ongoing).some(label=>label.includes('守勢')));
  c.ally.masterEffects.knight_P03={values:{def:.1},remaining:2};
  c.ally.masterCover={target:'selected',targetIndex:1,remaining:2};
  assert.ok(names(c,JOB_EFFECT_SECTIONS.ongoing).some(label=>label.includes('守勢 2/3段階')));
  assert.ok(names(c,JOB_EFFECT_SECTIONS.special).some(label=>label.includes(c.game.party[1].name+'をかばう')));
  c.ally.masterEffects.knight_P03.remaining=0;
  assert.ok(!names(c,JOB_EFFECT_SECTIONS.ongoing).some(label=>label.includes('守勢')));
});

test('仕掛け罠は本人の設置数と対象を固有継続へまとめ、消滅対象や他人の罠を数えない',()=>{
  const c=fixture();teach(c,'hunter_A07',3);act(c,'hunter_A07');
  assert.ok(names(c,JOB_EFFECT_SECTIONS.ongoing).some(label=>label.includes('仕掛け罠：設置3/3個')));
  c.battle.enemies[1].hp=0;c.battle.masterTraps.push({...c.battle.masterTraps[0],actor:1});
  assert.ok(names(c,JOB_EFFECT_SECTIONS.ongoing).some(label=>label.includes('設置2/3個')));
});

test('期限切れを表示せず、分類・アイコン付与・詳細閲覧で戦闘や保存データを変更しない',()=>{
  const c=fixture();teach(c,'berserker_P01');
  c.ally.masterEffects={expired:{remaining:0,shield:40},ready:{remaining:2,nextDamage:{rate:.2}}};
  c.battle.partyBuffs={str:[.2,0],mag:[0,2]};c.ally.buffs.barrier=[40,0];
  const before=structuredClone(c);
  const entries=allyEffectEntries(data,c.game,c.battle,0);
  assert.deepEqual(allyEffectSections(data,c.game,c.battle,0),entries.map(([title,lines])=>[title,lines.map(line=>line.label)]));
  assert.ok(!entries.flatMap(([,lines])=>lines).some(line=>line.label.includes('expired')||line.label.includes('障壁')));
  assert.deepEqual(c,before);
});
