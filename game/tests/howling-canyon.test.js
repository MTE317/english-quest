import test from 'node:test';
import assert from 'node:assert/strict';
import {realGameData,MemoryStorage} from './helpers.js';
import {createNewGame,defaultPartySpecs,normalizeGame} from '../js/game-state.js';
import {GameSession} from '../js/save.js';
import {allowedDungeons,startRun,startNextBattle,afterBattle,returnToTown,resolveLoot,runRoute} from '../js/dungeon.js';
import {makeEncounter,monsterPool} from '../js/encounter.js';
import {battleRewards} from '../js/battle.js';
import {buildWorldMap,meetsDiscoveryRule} from '../js/world-map.js';
import {promotionMaterialStatus,checkRankUp,fillBoard} from '../js/town.js';
const data=realGameData(),id='howling_canyon';
const fresh=()=>createNewGame(data,defaultPartySpecs(data));
const enter=()=>{const g=fresh();g.cleared.ruined_fort=1;const s=new GameSession({storage:new MemoryStorage()});s.startNew(g);startRun(data,s,{dungeonId:id,stoneId:'00',quizState:{asked:0},seed:12});return s;};
test('峡谷は砦 OR 湿原、ランク/季節不問、既存AND・既存アクセス維持',()=>{
 for(const parent of ['ruined_fort','misty_marsh'])for(const day of [1,31,61,91]){const g=fresh();g.day=day;g.cleared[parent]=1;assert.ok(allowedDungeons(data,g).some(d=>d.id===id));}
 const g=fresh();g.rank='S';assert.ok(!allowedDungeons(data,g).some(d=>d.id===id));g.cleared.mossy_cave=1;
 assert.match(buildWorldMap(data.dungeons,allowedDungeons(data,g),g).hints.join(),/崩れた砦 または 霧の湿原/);
 assert.equal(meetsDiscoveryRule({cleared:{a:1}},{clears:['a','b']}),false);g.legacyRouteAccess=[id];assert.ok(allowedDungeons(data,g).some(d=>d.id===id));
});
test('峡谷新規3階10/12/15、2/3/単独ボス、固定帰還なし、保存と羽帰還',()=>{
 const s=enter();assert.deepEqual(s.run.route.map(r=>[r.enemyLevel,r.enemiesPerBattle,r.returnPointAfter]),[[10,2,false],[12,3,false],[15,1,false]]);
 s.save();const r=new GameSession({storage:s.store.storage});normalizeGame(data,r.game,r.run);assert.equal(r.run.canyonRouteVersion,1);
 for(const season of ['spring','summer','autumn','winter'])for(const row of r.run.route){const es=makeEncounter(data,id,row.floor,()=>.5,{season,boss:row.lastBattleIsBoss,rowOverride:row});assert.equal(es.length,row.enemiesPerBattle);if(row.floor===3)assert.equal(es[0].monsterId,'storm_eagle');}
 startNextBattle(data,r);r.run.battle.enemies.forEach(e=>e.hp=0);r.run.battle.result='win';afterBattle(data,r);while(r.run.state==='loot')resolveLoot(data,r,null);
 assert.equal(r.run.state,'ready');r.run.backpack.materials.harpy_mat=1;returnToTown(data,r,'return_feather');assert.equal(r.game.storage.materials.harpy_mat,1);assert.ok(!r.game.items.return_feather);assert.ok(!r.game.cleared[id]);
});
test('峡谷旧3階/5階・帰還ポイント・旧報酬を保持',()=>{
 const s=enter();delete s.run.canyonRouteVersion;s.run.route=structuredClone(data.balance.dungeon.pre_intro_routes[id]);assert.deepEqual(runRoute(data,s.run).map(r=>r.enemyLevel),[15,17,19]);
 assert.equal(makeEncounter(data,id,3,()=>.5,{boss:true,rowOverride:s.run.route[2]}).length,2);
 startNextBattle(data,s);const expected=battleRewards(data,s.game,s.run.battle);s.run.battle.result='win';const r=afterBattle(data,s);assert.equal(r.growth[0].xp,expected.xp[0]);assert.equal(r.growth[0].ap,expected.ap[0]);
 while(s.run.state==='loot')resolveLoot(data,s,null);s.run.state='return_point';s.game.items={};s.run.backpack.materials.harpy_mat=2;s.save();const resumed=new GameSession({storage:s.store.storage});normalizeGame(data,resumed.game,resumed.run);returnToTown(data,resumed);assert.ok(resumed.game.storage.materials.harpy_mat>=2);
 assert.equal(runRoute(data,{dungeonId:id,battleIndex:0}).length,5);assert.deepEqual(runRoute(data,{dungeonId:id,layoutVersion:2,introRouteVersion:1}).map(r=>r.enemyLevel),[15,17,19]);
});
test('峡谷24種の素材/報酬、対象外報酬維持、D+は既存判定で素材1個',()=>{
 const ids=new Set(['storm_eagle','bounty_03_1']);for(const season of ['spring','summer','autumn','winter'])for(const m of monsterPool(data,id,season))ids.add(m.id);
 assert.equal(ids.size,24);for(const mid of ids){const m=data.monsters.get(mid);assert.ok(m.baseExp>0&&m.baseAp>0);assert.equal(data.materials.get(m.materialCommon).rank,3);}
 const s=enter();startNextBattle(data,s);assert.deepEqual(battleRewards(data,s.game,s.run.battle,{dungeonId:'unpublished'}),battleRewards(data,s.game,s.run.battle));
 const g=fresh();g.cleared.ruined_fort=1;g.rank='D';g.rankPoints=3500;const rank=data.ranks.find(r=>r.id==='D+');assert.equal(rank.needsExam,false);assert.equal(promotionMaterialStatus(data,g,rank).ready,false);g.storage.materials.harpy_mat=1;assert.equal(promotionMaterialStatus(data,g,rank).ready,true);assert.equal(g.rank,'D');checkRankUp(data,g);assert.equal(g.rank,'D+');assert.ok(!g.storage.materials.harpy_mat);checkRankUp(data,g);assert.equal(g.rank,'D+');
});

test('峡谷の掲示候補は発見後だけ現れ、ボスEXPは二重5倍しない',()=>{
 let found=false;for(let seed=1;seed<=40;seed++)for(const unlocked of [false,true]){const g=fresh();g.rank='D';if(unlocked)g.cleared.ruined_fort=1;let n=seed;fillBoard(data,g,()=>((n=Math.imul(n,1664525)+1013904223)>>>0)/2**32);const has=g.board.some(q=>q.dungeonId===id);if(unlocked)found ||= has;else assert.equal(has,false);}assert.ok(found);
 const s=enter();s.run.floor=3;startNextBattle(data,s);const r=battleRewards(data,s.game,s.run.battle,{dungeonId:id});assert.equal(r.xp[0],270);assert.equal(r.ap[0],6);
});
