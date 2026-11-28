import test from 'node:test';
import assert from 'node:assert/strict';
import { realGameData, readCsv, readJson, MemoryStorage, seededRng } from './helpers.js';
import { makeEnemy } from '../js/battle.js';
import { makeEncounter } from '../js/encounter.js';
import { installMonsterStats } from '../js/monster-stats.js';
import { materialsForEnemy, rollGearDrop, rollBattleLoot } from '../js/loot.js';
import { createNewGame, defaultPartySpecs, normalizeGame } from '../js/game-state.js';
import { GameSession } from '../js/save.js';
import { startRun, startNextBattle, afterBattle, resolveLoot, chooseWorldExit } from '../js/dungeon.js';
import { encounterMonsters } from '../js/monster-knowledge.js';

const data = realGameData({world:true});
const fresh = () => createNewGame(data,defaultPartySpecs(data));
const stats = e => [e.lv,e.maxHp,e.maxMp,e.str,e.mag,e.def,e.res,e.spd];

test('全1024種が固定Lvと能力を持ち、指定Lv・場所・★が変わっても同じ基本能力',()=>{
  assert.equal(data.monsters.size,1024);
  for(const m of data.monsters.values()){
    assert.ok(m.fixedStats,m.id);
    const first=makeEnemy(data,m.id,{lv:1,dungeonId:'world_a'});
    const distant=makeEnemy(data,m.id,{lv:99,dungeonId:'world_k'});
    const bare=makeEnemy(data,m.id);
    assert.deepEqual(stats(first),stats(distant),m.id);
    assert.deepEqual(stats(first),stats(bare),m.id);
    assert.equal(first.lv,m.fixedStats.level);
  }
  assert.equal(makeEnemy(data,'slime',{lv:80}).lv,1);
});

test('ダンジョンの中でも種によってLvが異なり、HP補正は重ならない',()=>{
  const a=makeEncounter(data,'world_a',1,()=>0);
  const e=makeEncounter(data,'world_e',1,()=>0);
  assert.equal(a[0].monsterId,'slime');assert.equal(e[0].monsterId,'slime');
  assert.deepEqual(stats(a[0]),stats(e[0]));
  const seen=new Map(),rng=seededRng(19);
  for(let i=0;i<50;i++)for(const monster of makeEncounter(data,'world_a',1,rng))seen.set(monster.monsterId,monster.lv);
  assert.deepEqual([...seen.entries()].sort(),[['nut_squirrel',2],['slime',1]]);
});

test('固定マスターの不足・重複・不正値とエリート対象の誤指定を拒否',()=>{
  const rows=readCsv('monster_stats.csv').rows,config=readJson('monster_elites.json');
  for(const invalid of [rows.slice(1),[...rows,rows[0]],rows.map((r,i)=>i? r:{...r,hp:''}),rows.map((r,i)=>i? r:{...r,level:0})])
    assert.throws(()=>installMonsterStats(structuredClone(data),invalid,config));
  assert.throws(()=>installMonsterStats(structuredClone(data),rows,{...config,eligible:['stone_giant']}));
  assert.throws(()=>installMonsterStats(structuredClone(data),rows,{...config,chance:2}));
});

test('対象4種だけが同名・同Lvのエリートになり、すべての基本能力が上がる',()=>{
  for(const m of data.monsters.values()){
    const normal=makeEnemy(data,m.id),elite=makeEnemy(data,m.id,{eliteId:'elite'});
    assert.equal(elite.name,normal.name);assert.equal(elite.lv,normal.lv);
    if(data.monsterElites.eligible.includes(m.id)){
      assert.equal(elite.eliteId,'elite');
      for(const key of ['maxHp','maxMp','str','mag','def','res','spd'])assert.ok(elite[key]>normal[key],m.id+':'+key);
    }else{assert.equal(elite.eliteId,null);assert.deepEqual(stats(elite),stats(normal));}
  }
  const none=makeEncounter(data,'world_a',1,()=>0,{elites:true,maxElites:0});
  assert.ok(none.every(e=>!e.eliteId));
  const d=structuredClone(data);d.worldRoutes.nodes[0].counts=[2,2];
  const pair=makeEncounter(d,'world_a',1,()=>0,{elites:true});
  assert.equal(pair.filter(e=>e.eliteId).length,1);
  assert.deepEqual(pair.map(e=>e.name),['スライムA','スライムB']);
  assert.ok(makeEncounter(data,'world_g',3,()=>0,{boss:true,elites:true}).every(e=>!e.eliteId));
});

test('レア素材の確率は3倍で上限100%、通常素材は同じ確率',()=>{
  const normal=makeEnemy(data,'slime'),elite=makeEnemy(data,'slime',{eliteId:'elite'});
  const dt=data.dropTables.get('world_a'),m=data.monsters.get('slime');
  assert.ok(dt.rareRate>0 && dt.rareRate*3<1);
  const between=()=>dt.rareRate*2;
  const n=materialsForEnemy(data,'world_a',normal,between),e=materialsForEnemy(data,'world_a',elite,between);
  assert.ok(!n.some(x=>x.id===m.materialRare));assert.ok(e.some(x=>x.id===m.materialRare));
  assert.equal(n.some(x=>x.id===m.materialCommon),e.some(x=>x.id===m.materialCommon));
  const d=structuredClone(data);d.dropTables.get('world_a').rareRate=.5;
  assert.ok(materialsForEnemy(d,'world_a',elite,()=>.999).some(x=>x.id===m.materialRare));
});

test('レア以上の装備の抽選重みが2倍になり、装備ドロップ自体の確率は変えない',()=>{
  const lower=data.rarityTable.slice(0,2).reduce((n,r)=>n+r.weight,0);
  const higher=data.rarityTable.slice(2).reduce((n,r)=>n+r.weight,0);
  const draw=(lower/(lower+higher)+lower/(lower+higher*2))/2;
  const rng=()=>{let calls=0;return()=>++calls===3?draw:0;};
  const normal=rollGearDrop(data,fresh(),'world_a',1,rng());
  const elite=rollGearDrop(data,fresh(),'world_a',1,rng(),{rareWeightMultiplier:2});
  assert.ok(data.rarityTable.findIndex(r=>r.id===normal.rarity)<2);
  assert.ok(data.rarityTable.findIndex(r=>r.id===elite.rarity)>=2);
  const d=structuredClone(data);d.dropTables.get('world_a').gearRate=0;
  assert.equal(rollBattleLoot(d,fresh(),'world_a',1,[makeEnemy(d,'slime',{eliteId:'elite'})],()=>.5).gear.length,0);
  d.dropTables.get('world_a').gearRate=1;
  const nRng=seededRng(29),eRng=seededRng(29),g=fresh();let n=0,e=0;
  const high=gear=>d.rarityTable.findIndex(r=>r.id===gear.rarity)>=2;
  for(let i=0;i<500;i++){
    n+=Number(high(rollBattleLoot(d,g,'world_a',1,[makeEnemy(d,'slime')],nRng).gear[0]));
    e+=Number(high(rollBattleLoot(d,g,'world_a',1,[makeEnemy(d,'slime',{eliteId:'elite'})],eRng).gear[0]));
  }
  assert.ok(e>n*1.2,{normal:n,elite:e});
});

test('同じ遠征で次のダンジョンへ進んでもエリート上限を保持し、保存再開で再抽選しない',()=>{
  const d=structuredClone(data);d.monsterElites.chance=1;
  const a=d.worldRoutes.nodes.find(n=>n.key==='A');a.pool=['slime'];
  const b=d.worldRoutes.nodes.find(n=>n.key==='B');b.pool=['slime'];
  const storage=new MemoryStorage(),session=new GameSession({storage});session.startNew(fresh());
  startRun(d,session,{dungeonId:'world_a',stoneId:'00',quizState:{asked:0},seed:22});
  startNextBattle(d,session);assert.equal(session.run.elitesSeen,1);
  const saved=structuredClone(session.run.battle.enemies);
  const resumed=new GameSession({storage});normalizeGame(d,resumed.game,resumed.run);
  assert.deepEqual(resumed.run.battle.enemies,saved);
  for(let i=0;i<3;i++){
    if(!resumed.run.battle)startNextBattle(d,resumed);
    resumed.run.battle.enemies.forEach(e=>e.hp=0);resumed.run.battle.result='win';afterBattle(d,resumed);
    while(resumed.run.pendingLoot.length)resolveLoot(d,resumed,null);
  }
  chooseWorldExit(d,resumed,'left',resumed.run.worldVisit);
  startNextBattle(d,resumed);assert.ok(resumed.run.battle.enemies.every(e=>!e.eliteId));
  assert.equal(resumed.run.elitesSeen,1);
});

test('最初の遭遇がエリートでも図鑑の基礎記録は通常個体。旧戦闘の保存値も上書きしない',()=>{
  const game=fresh(),elite=makeEnemy(data,'slime',{eliteId:'elite'});
  encounterMonsters(game,[elite]);assert.equal(game.catalog.sightings.slime.hp,data.monsters.get('slime').fixedStats.hp);
  const session=new GameSession({storage:new MemoryStorage()});session.startNew(game);
  startRun(data,session,{dungeonId:'world_a',stoneId:'00',quizState:{asked:0},seed:4});startNextBattle(data,session);
  const old=session.run.battle.enemies[0];old.lv=23;old.maxHp=500;old.hp=100;old.name='巨大なスライム';delete old.statsVersion;delete old.baseStats;
  session.save();const reload=new GameSession({storage:session.store.storage});normalizeGame(data,reload.game,reload.run);
  assert.deepEqual(reload.run.battle.enemies[0],old);
});
