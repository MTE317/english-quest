import test from 'node:test';
import assert from 'node:assert/strict';
import { realGameData } from './helpers.js';
import { createNewGame, defaultPartySpecs } from '../js/game-state.js';
import { maxHp, maxMp, makeGear } from '../js/character.js';
import { availableJobs, effectiveSkill, skillMaxLevel } from '../js/growth.js';
import { createBattle, makeEnemy, setPending, resolvePending, allyStatusChance, skillMp } from '../js/battle.js';
import { mysticSpecs } from '../../scripts/additional-jobs-19-21-plans.mjs';

const data = realGameData();
function fixture(job = 'necromancer', seed = 143) {
  const specs = defaultPartySpecs(data); specs[0].job = job;
  const game = createNewGame(data, specs);
  game.facilities.temple = 6;
  for (const member of game.party) {
    member.lv = 20; member.hp = maxHp(data, member); member.mp = maxMp(data, member);
  }
  const member = game.party[0];
  const kind = { necromancer:'scythe', onmyoji:'fan', shrine_maiden:'fan' }[job];
  const gear = [...data.equipment.values()].find(item => item.slot === 'weapon' && item.kind === kind && !item.unique);
  member.equip.weapon = makeGear(game, gear.id);
  const enemies = Array.from({length:2}, (_,i) => Object.assign(makeEnemy(data, 'goblin', {lv:1}), {
    name:'target'+i, hp:1e7, maxHp:1e7, def:20, res:20, spd:0,
    weak:[], strongWeak:[], resist:[], immune:[], statusAffinity:{}, evasion:0, buffs:{},
    statuses:{}, tactics:null, status:null, magicRate:0,
  }));
  const battle = createBattle(data, game, {enemies,seed});
  battle.round = 1;
  return {game,member,b:battle,ally:battle.allies[0],enemies};
}
function teach(c,id,level=1) {
  const skill=data.skills.get(id);assert.ok(skill,id);
  c.member.learned=[...new Set([...c.member.learned,id])];
  c.member.skillLevels??={};c.member.skillLevels[id]=level;
  if(skill.isFinal)c.member.loadout.ultimate=id;
  else {const key=skill.kind==='passive'?'passives':'actions';c.member.loadout[key]=[...new Set([...c.member.loadout[key],id])];}
}
function act(c,id,target=0,extra={}) {
  c.member.mp=999;c.b.turn={side:'ally',i:0,bleedProcessed:true};
  setPending(c.b,{type:'skill',skillId:id,target,...extra},{});
  resolvePending(data,c.game,c.b,true);
}
test('19〜21の45技能を全成長段階で取得・発動できる',()=>{
  for(const job of mysticSpecs){
    assert.equal(job.skills.length,15);const c=fixture(job.id);
    assert.equal(data.jobs.find(x=>x.id===job.id).skillsReady,true);
    assert.ok(availableJobs(data,c.game).some(x=>x.id===job.id));
    c.game.facilities.temple=5;
    assert.ok(!availableJobs(data,c.game).some(x=>x.id===job.id));
    c.game.facilities.temple=6;
    for(const source of job.skills){
      const skill=data.skills.get(source.id);assert.equal(skillMaxLevel(skill),source.maxLevel,source.id);
      assert.equal(skill.cost,source.cost);assert.deepEqual(skill.effect.prerequisites,source.prerequisites);
      for(let level=1;level<=source.maxLevel;level++){
        teach(c,source.id,level);
        const used=effectiveSkill(data,c.member,skill);
        assert.equal(used.effect.description,source.effects[level-1]);
        assert.deepEqual(used.effect.rules.mystic,source.levelRules[level-1]);
        if(source.type==='passive')continue;
        c.b=createBattle(data,c.game,{enemies:structuredClone(c.enemies),seed:143});
        c.b.round=1;c.ally=c.b.allies[0];
        c.ally.soul=3;c.ally.seals=2;
        c.ally.ghost={charges:2,remaining:3,grantedClock:0};
        if(skill.isFinal)c.member.ultimateGauge=100;
        const target=source.target==='味方1人'?1:0;
        act(c,source.id,target,source.id==='onmyoji_A06'?{element:'light'}:{});
        assert.ok(c.b.log.some(x=>x.includes(skill.name+'！')),source.id+' Lv'+level+' '+c.b.log.at(-1));
      }
    }
  }
});
test('死霊術師は実ダメージで魂を得て、魂と亡霊の残回数を支払う',()=>{
  const c=fixture();
  for(const id of ['necromancer_A01','necromancer_A02','necromancer_A05','necromancer_A06'])teach(c,id);
  act(c,'necromancer_A01');assert.equal(c.ally.soul,1);
  act(c,'necromancer_A02');assert.equal(c.ally.soul,0);assert.equal(c.ally.ghost.charges,2);
  act(c,'necromancer_A06');assert.equal(c.ally.ghost.charges,1);
  act(c,'necromancer_A06');assert.equal(c.ally.ghost,undefined);
  act(c,'necromancer_A05');assert.equal(c.member.mp,999);
  assert.ok(c.b.log.some(x=>x.includes('魂が足りない')));
});
test('陰陽師は光闇の交替で符を得て、術と結界へ使う',()=>{
  const c=fixture('onmyoji');
  for(const id of ['onmyoji_A01','onmyoji_A02','onmyoji_A03','onmyoji_A06'])teach(c,id);
  act(c,'onmyoji_A01');assert.equal(c.ally.seals??0,0);
  act(c,'onmyoji_A02');assert.equal(c.ally.seals,1);
  act(c,'onmyoji_A03',1);assert.equal(c.ally.seals,0);
  assert.ok(c.b.allies[1].masterEffects.onmyoji_A03.shield>0);
  act(c,'onmyoji_A01');assert.equal(c.ally.seals,1);
  act(c,'onmyoji_A06',0,{element:'dark'});assert.equal(c.ally.seals,0);
});
test('巫女の神楽はパーティで一枠、予防は既存の異常を治さない',()=>{
  const c=fixture('shrine_maiden');
  for(const id of ['shrine_maiden_A01','shrine_maiden_A04','shrine_maiden_A05'])teach(c,id);
  c.b.allies[1].statuses.poison={turns:2,n:1};
  const before=allyStatusChance(data,c.game,c.b,1,'poison',1);
  act(c,'shrine_maiden_A01');
  assert.ok(allyStatusChance(data,c.game,c.b,1,'poison',1)<before);
  assert.ok(c.b.allies[1].statuses.poison);
  act(c,'shrine_maiden_A04');
  assert.equal(c.b.allies[1].masterEffects.kagura.kaguraKind,'regeneration');
  act(c,'shrine_maiden_A05');
  assert.equal(c.b.allies[1].masterEffects.kagura.kaguraKind,'protection');
  assert.equal(Object.keys(c.b.allies[1].masterEffects).filter(x=>x==='kagura').length,1);
});
test('複合攻撃は調和符を増やさず、奥義は消費符に応じた防護を配る',()=>{
  const c=fixture('onmyoji');
  for(const id of ['onmyoji_A09','onmyoji_U01'])teach(c,id);
  c.ally.seals=1;c.ally.lastPolarity='dark';
  act(c,'onmyoji_A09');assert.equal(c.ally.seals,0);assert.equal(c.ally.lastPolarity,'dark');
  c.ally.seals=2;c.member.ultimateGauge=100;
  act(c,'onmyoji_U01');
  assert.equal(c.ally.seals,0);
  assert.ok(c.b.allies.every(unit=>unit.masterEffects.onmyoji_U01?.shield>0));
});
test('魂・符・神楽は保存と再読込で保持し、再抽選しない',()=>{
  const c=fixture('onmyoji');
  for(const id of ['onmyoji_A01','onmyoji_A02','onmyoji_A03'])teach(c,id);
  act(c,'onmyoji_A01');act(c,'onmyoji_A02');
  const restored=JSON.parse(JSON.stringify(c.b));
  assert.equal(restored.allies[0].seals,1);
  assert.equal(restored.rng,c.b.rng);
  c.b=restored;c.ally=restored.allies[0];
  act(c,'onmyoji_A03',1);
  assert.equal(c.ally.seals,0);
  assert.ok(c.b.allies[1].masterEffects.onmyoji_A03.shield>0);
});
test('治療は残り期限が短い異常から除き、予防札を各対象に付ける',()=>{
  const c=fixture('shrine_maiden');
  for(const id of ['shrine_maiden_A02','shrine_maiden_U01'])teach(c,id);
  c.b.allies[1].statuses={poison:{turns:3,n:1},burn:{turns:1,n:1}};
  act(c,'shrine_maiden_A02',1);
  assert.equal(c.b.allies[1].statuses.burn,undefined);
  assert.ok(c.b.allies[1].statuses.poison);
  c.member.ultimateGauge=100;
  act(c,'shrine_maiden_U01');
  assert.equal(c.b.allies[1].statuses.poison,undefined);
  assert.equal(c.b.allies[1].masterEffects.shrine_maiden_U01.preventCharges,1);
});
test('魂と符を使う技能は対応するパッシブでMPが軽くなる',()=>{
  for(const [job,attack,passive] of [
    ['necromancer','necromancer_A05','necromancer_P01'],
    ['onmyoji','onmyoji_A06','onmyoji_P04'],
  ]){
    const c=fixture(job);teach(c,attack);
    const skill=effectiveSkill(data,c.member,data.skills.get(attack));
    const baseline=skillMp(data,c.member,skill,{battle:c.b,actor:0});
    teach(c,passive);
    assert.ok(skillMp(data,c.member,skill,{battle:c.b,actor:0})<baseline,passive);
  }
});
test('巫女の奉納は自分以外へ最大MPの一割以内を一戦一回だけ返す',()=>{
  const c=fixture('shrine_maiden');teach(c,'shrine_maiden_A09');
  c.game.party[1].mp=0;c.member.mp=20;
  act(c,'shrine_maiden_A09');
  const restored=c.game.party[1].mp;
  assert.ok(restored>0 && restored<=Math.floor(maxMp(data,c.game.party[1])*.1));
  assert.ok(c.member.mp<999);
  act(c,'shrine_maiden_A09');
  assert.equal(c.game.party[1].mp,restored);
});
