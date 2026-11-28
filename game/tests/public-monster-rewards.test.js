import test from 'node:test';
import assert from 'node:assert/strict';
import { realGameData, MemoryStorage, readCsv } from './helpers.js';
import { createNewGame, defaultPartySpecs, normalizeGame } from '../js/game-state.js';
import { GameSession } from '../js/save.js';
import { makeEnemy, createBattle, battleRewards } from '../js/battle.js';
import { startRun, startNextBattle, afterBattle, resolveLoot } from '../js/dungeon.js';
import { monsterPool } from '../js/encounter.js';
import { parseMonsterRewards, fixedBattleRewards } from '../js/monster-rewards.js';
const data=realGameData(), ids=data.balance.rewards.fixed_monster_dungeons;
const fresh=()=>createNewGame(data,defaultPartySpecs(data));
const enemy=(id,options={})=>makeEnemy(data,id,{lv:2,...options});
const battle=(g,enemies)=>createBattle(data,g,{enemies,seed:12});
const reward=(g,b,id='windward_plain')=>battleRewards(data,g,b,{dungeonId:id});
const enter=()=>{const s=new GameSession({storage:new MemoryStorage()});s.startNew(fresh());startRun(data,s,{dungeonId:'windward_plain',stoneId:'00',quizState:{asked:0},seed:12});startNextBattle(data,s);return s;};
function win(s){s.run.battle.enemies.forEach(e=>e.hp=0);s.run.battle.result='win';return afterBattle(data,s);}

test('101種の固定マスターが公開7地域の四季・全編成・賞金首を網羅し1024体を維持',()=>{
 assert.equal(data.monsters.size,1024);assert.equal(ids.length,7);
 const configured=[...data.monsters.values()].filter(m=>m.baseExp!==undefined);assert.equal(configured.length,101);
 const needed=new Set();
 for(const id of ids){
  for(const season of ['spring','summer','autumn','winter'])for(const m of monsterPool(data,id,season))needed.add(m.id);
  if(data.dungeonFloors.some(r=>r.dungeonId===id&&r.lastBattleIsBoss))needed.add(data.dungeons.get(id).bossId);
  if(!data.balance.dungeon.intro_routes[id])for(const m of data.monsters.values())if(m.role==='bounty'&&m.dungeons.includes(id))needed.add(m.id);
 }
 assert.deepEqual([...needed].sort(),configured.map(m=>m.id).sort());
 for(const id of needed){const m=data.monsters.get(id);assert.ok(m.baseExp>0&&m.baseAp>0);}
 for(const row of readCsv('monsters.csv').rows)assert.doesNotThrow(()=>parseMonsterRewards(row));
});
test('不正な片側値・負値・小数を拒否、旧空欄は許容',()=>{
 assert.deepEqual(parseMonsterRewards({id:'old'}),{});
 for(const row of [{base_exp:'2'},{base_exp:'-1',base_ap:'1'},{base_exp:'1',base_ap:'1.2'}])assert.throws(()=>parseMonsterRewards({id:'bad',...row}),/bad/);
});
test('ID固定・合算・ボス5倍の重複なし、対象外/不明地域と未対応旧敵は戦闘全体で旧式',()=>{
 const g=fresh();const b=battle(g,[enemy('slime',{lv:10}),enemy('goblin_boss',{lv:10,boss:true})]);
 assert.equal(reward(g,b).xp[0],121);assert.equal(reward(g,b).ap[0],5);
 for(const id of ['sunlit_forest','mossy_cave','goblin_quarry','ruined_fort','misty_marsh'])assert.deepEqual(reward(g,b,id),reward(g,b));
 for(const id of [undefined,'unknown','sand_tomb'])assert.deepEqual(battleRewards(data,g,b,{dungeonId:id}),battleRewards(data,g,b));
 const old=battle(g,[enemy('slime'),enemy('grove_guardian',{boss:true})]);
 assert.equal(fixedBattleRewards(data,old.enemies,'sunlit_forest'),null);
 assert.deepEqual(reward(g,old,'sunlit_forest'),battleRewards(data,g,old));
});
test('新エリートのEXP・APは通常と同じ、レベル差はEXPだけ、死亡/石化にもEXPを配布',()=>{
 const g=fresh();const elite=data.elitePrefixes[0];const b=battle(g,[enemy('slime',{eliteId:elite.id}),enemy('slime',{eliteId:elite.id})]);
 assert.equal(reward(g,b).xp[0],22);assert.equal(reward(g,b).ap[0],2);
 g.party[0].lv=20;assert.equal(reward(g,b).xp[0],0);assert.equal(reward(g,b).ap[0],2);
 g.party[1].hp=0;b.allies[2].statuses.petrify={turns:2};
 for(const i of [1,2]){assert.ok(reward(g,b).xp[i]>0);assert.equal(reward(g,b).ap[i],0);}
});
test('勝利前/勝利済み保存再開、出題補正、既存AP・XP保持、二重払いなし',()=>{
 const s=enter();s.game.party[0].ap=73;s.game.party[0].xp=3;
 s.run.battle.learningRewards={answers:2,total:1};s.run.battle.enemies[0].hp=0;s.run.battle.result='win';s.save();
 const r=new GameSession({storage:s.store.storage});normalizeGame(data,r.game,r.run);
 const result=afterBattle(data,r);assert.equal(result.growth[0].xp,6);assert.equal(result.growth[0].ap,1);assert.equal(r.game.party[0].ap,74);assert.equal(r.game.party[0].xp,9);
 const snapshot=structuredClone(r.game.party);const again=new GameSession({storage:s.store.storage});normalizeGame(data,again.game,again.run);
 assert.equal(again.run.battle,null);assert.deepEqual(again.game.party,snapshot);assert.equal(data.balance.rewards.ap_per_battle,2);
});
test('逃走は無報酬、全滅でも以前の勝利AP/XPを保持する既存方針',()=>{
 const s=enter();const before=structuredClone(s.game.party);s.run.battle.result='fled';afterBattle(data,s);
 assert.deepEqual(s.game.party.map(m=>[m.ap,m.xp]),before.map(m=>[m.ap,m.xp]));
 startNextBattle(data,s);win(s);while(s.run.state==='loot')resolveLoot(data,s,null);
 const earned=s.game.party.map(m=>[m.ap,m.xp,m.lv]);startNextBattle(data,s);s.game.party.forEach(m=>m.hp=0);s.run.battle.result='lose';afterBattle(data,s);
 assert.equal(s.run,null);assert.deepEqual(s.game.party.map(m=>[m.ap,m.xp,m.lv]),earned);
});
test('EXP装備とパッシブは既存加算式のままAPへ影響しない',()=>{
 const d=realGameData(),g=fresh(),m=g.party[0];
 d.skills.set('reward_probe',{id:'reward_probe',job:m.job,ap:0,effect:{mod:{xp:.25}}});
 m.learned.push('reward_probe');m.loadout.passives=['reward_probe'];m.equip.accessory={affixes:{EXP:20,経験値:10}};
 const b=battle(g,[enemy('slime'),enemy('slime')]);
 const r=battleRewards(d,g,b,{dungeonId:'windward_plain'});assert.equal(r.xp[0],Math.round(22*1.55));assert.equal(r.ap[0],2);
});
test('旧育成探索は従来報酬、通常訓練用の一律設定も維持',()=>{
 const s=enter();s.run.training=true;const expected=battleRewards(data,s.game,s.run.battle);const r=win(s);
 assert.equal(r.growth[0].xp,expected.xp[0]);assert.equal(r.growth[0].ap,2);
});
