import test from 'node:test';
import assert from 'node:assert/strict';
import { realGameData, MemoryStorage } from './helpers.js';
import { createNewGame, defaultPartySpecs, normalizeGame } from '../js/game-state.js?v=intro-route-1';
import { GameSession } from '../js/save.js';
import { allowedDungeons, startRun, startNextBattle, afterBattle, returnToTown, resolveLoot, runRoute } from '../js/dungeon.js?v=intro-route-1';
import { makeEncounter, monsterPool } from '../js/encounter.js?v=intro-route-1';
import { fillBoard, calendarOf } from '../js/town.js?v=intro-route-1';
import { maxHp } from '../js/character.js';

const data=realGameData();
const fresh=()=>createNewGame(data,defaultPartySpecs(data));
const session=game=>{const s=new GameSession({storage:new MemoryStorage()});s.startNew(game??fresh());return s;};
const enter=(s,id)=>startRun(data,s,{dungeonId:id,stoneId:'00',quizState:{asked:0},seed:12});
function win(s){startNextBattle(data,s);s.run.battle.enemies.forEach(e=>{e.hp=0;});s.run.battle.result='win';afterBattle(data,s);while(s.run.state==='loot')resolveLoot(data,s,null);}

test('新規だけ20AP・10000G・羽1枚。再読込や旧セーブへ配り直さない',()=>{
 const g=fresh();assert.equal(g.gold,10000);assert.deepEqual(g.party.map(m=>m.ap),[20,20,20,20,20,20]);assert.deepEqual(g.items,{return_feather:1});
 g.items={};g.gold=177;g.party[0].ap=7;normalizeGame(data,g);assert.deepEqual(g.items,{});assert.equal(g.gold,177);assert.equal(g.party[0].ap,7);
 delete g.introRouteVersion;normalizeGame(data,g);normalizeGame(data,g);assert.equal(g.party[0].ap,7);assert.deepEqual(g.items,{});
 assert.ok(allowedDungeons(data,g).some(d=>d.id==='goblin_quarry'));
});
test('原の最終戦まで無料で進み、帰還で森と洞窟を同時に発見。森から素材先、洞窟から砦',()=>{
 const s=session();assert.deepEqual(allowedDungeons(data,s.game).map(d=>d.id),['windward_plain']);enter(s,'windward_plain');assert.equal(s.run.expeditionFee,0);
 for(let n=1;n<=3;n++){win(s);assert.equal(s.run.battlesDone,n);assert.notEqual(s.run.state,'return_point');}
 assert.equal(s.run.state,'cleared');assert.equal(s.run.bossDefeated,undefined);returnToTown(data,s);
 assert.equal(s.game.items.return_feather,1);assert.equal(s.game.cleared.windward_plain,1);
 assert.deepEqual(allowedDungeons(data,s.game).map(d=>d.id),['windward_plain','mossy_cave','sunlit_forest']);
 enter(s,'sunlit_forest');for(let i=0;i<3;i++)win(s);returnToTown(data,s);
 assert.ok(allowedDungeons(data,s.game).some(d=>d.id==='goblin_quarry'));assert.ok(allowedDungeons(data,s.game).some(d=>d.id==='misty_marsh'));
 enter(s,'mossy_cave');for(let i=0;i<4;i++)win(s);assert.equal(s.run.bossDefeated,true);returnToTown(data,s);
 assert.ok(allowedDungeons(data,s.game).some(d=>d.id==='ruined_fort'));
});
test('4季節の原は各戦1〜3体のスライム、森は毒最大1体、洞窟ボスは単独。HP補正は地域限定',()=>{
 for(const season of ['spring','summer','autumn','winter'])for(const id of ['windward_plain','sunlit_forest','mossy_cave']){
  const rows=data.dungeonFloors.filter(r=>r.dungeonId===id);
  for(const row of rows){const enemies=makeEncounter(data,id,row.floor,()=>0,{season,boss:row.lastBattleIsBoss,elites:true,bountyId:'bounty_goblin'});
   if(id==='windward_plain')assert.ok(enemies.length>=1&&enemies.length<=3);
   else assert.equal(enemies.length,row.enemiesPerBattle);
   assert.ok(enemies.every(e=>!e.eliteId&&!e.bounty));
   if(id==='windward_plain')assert.ok(enemies.every(e=>e.monsterId==='slime'));
   if(id==='sunlit_forest')assert.ok(enemies.filter(e=>e.monsterId==='poison_cap').length<=1);
   if(row.lastBattleIsBoss)assert.deepEqual(enemies.map(e=>e.monsterId),['goblin_boss']);
  }
 }
 assert.equal(data.monsters.size,1024);
 const oldRow=data.balance.dungeon.pre_intro_routes.mossy_cave[0];
 const old=makeEncounter(data,'mossy_cave',1,()=>0,{season:'winter',rowOverride:oldRow});
 assert.ok(old.every(e=>e.maxHp>0));
});
test('平原の各戦で敵数を抽選し、再挑戦でも固定順にならない',()=>{
 for(const floor of [1,2,3]){
  assert.deepEqual([0,.5,.999].map(draw=>makeEncounter(data,'windward_plain',floor,()=>draw).length),[1,2,3]);
 }
 const a=session();enter(a,'windward_plain');startNextBattle(data,a);
 const b=session();enter(b,'windward_plain');startNextBattle(data,b);
 assert.equal(a.run.battle.enemies.length,b.run.battle.enemies.length);
});
test('途中の羽帰還は戦利品だけ保持し未踏破。全滅は経路解放を巻き戻し、現行の図鑑保持規則を維持する',()=>{
 const s=session();enter(s,'windward_plain');win(s);const gold=s.game.gold;
 assert.throws(()=>returnToTown(data,s),/帰れない/);returnToTown(data,s,'return_feather');assert.equal(s.game.gold,gold);assert.equal(s.game.cleared.windward_plain,undefined);assert.equal(s.game.items.return_feather,undefined);
 const t=session();const before=structuredClone(t.game);enter(t,'windward_plain');win(t);startNextBattle(data,t);t.game.party.forEach(m=>m.hp=0);t.run.battle.result='lose';afterBattle(data,t);
 assert.deepEqual(t.game.cleared,before.cleared);assert.ok(t.game.catalog.monsters.includes('slime'));assert.equal(t.game.gold,before.gold);
});
test('遠征の経路・編成・帰還規則は保存再開しても固定。旧遠征は帰還地点と旧ボスを保持',()=>{
 const g=fresh();g.cleared.windward_plain=1;const s=session(g);enter(s,'sunlit_forest');win(s);s.save();
 const r=new GameSession({storage:s.store.storage});normalizeGame(data,r.game,r.run);assert.deepEqual(r.run.route,s.run.route);assert.equal(r.run.state,'ready');
 for(let i=0;i<2;i++)win(r);returnToTown(data,r);assert.equal(r.game.cleared.sunlit_forest,1);
 const old=session(g);enter(old,'sunlit_forest');old.run.route=structuredClone(data.balance.dungeon.pre_intro_routes.sunlit_forest);delete old.run.introRouteVersion;old.run.floor=1;
 win(old);assert.equal(old.run.state,'return_point');old.run.state='ready';startNextBattle(data,old);assert.ok(old.run.battle.enemies.some(e=>e.monsterId==='grove_guardian'));
 const noRoute={dungeonId:'sunlit_forest',layoutVersion:2,snapshot:g};assert.deepEqual(runRoute(data,noRoute),data.balance.dungeon.pre_intro_routes.sunlit_forest);
});
test('新規の原・森に通常/特別ボス依頼は出ない。既存契約・報酬・図鑑を消さない',()=>{
 const g=fresh();g.cleared.windward_plain=1;
 for(let i=0;i<8;i++){g.board=[];g.day=1+i*30;fillBoard(data,g,()=>.5);assert.ok(g.board.every(q=>q.type!=='boss'||q.dungeonId==='mossy_cave'));assert.ok(!g.specialQuest||g.specialQuest.dungeonId==='mossy_cave');}
 const q={uid:1,type:'boss',target:'grove_guardian',dungeonId:'sunlit_forest',count:1,progress:0,depositPaid:100,rewardGold:700};g.quests=[q];delete g.introRouteVersion;normalizeGame(data,g);assert.deepEqual(g.quests,[q]);
});

test('ボスなし最終戦で逃走しても無料帰還・踏破にならず同じ階から再挑戦',()=>{
 const s=session();enter(s,'windward_plain');win(s);win(s);startNextBattle(data,s);
 s.run.battle.result='fled';afterBattle(data,s);assert.equal(s.run.state,'ready');assert.equal(s.run.floor,3);assert.equal(s.run.cleared,false);
 assert.throws(()=>returnToTown(data,s),/帰れない/);win(s);returnToTown(data,s);assert.equal(s.game.cleared.windward_plain,1);
});

test('旧帰還ポイント保存は羽0枚でも無料帰還でき、戦利品を失わず再読込できる',()=>{
 const g=fresh();delete g.introRouteVersion;g.items={};normalizeGame(data,g);
 const old=session(g);enter(old,'mossy_cave');old.run.route=structuredClone(data.balance.dungeon.pre_intro_routes.mossy_cave);
 delete old.run.introRouteVersion;old.run.floor=3;old.run.state='return_point';old.run.backpack.materials.cave_rat_mat=3;
 old.run.earned.gold=100;old.game.gold+=100;old.save();
 const resumed=new GameSession({storage:old.store.storage});normalizeGame(data,resumed.game,resumed.run);
 const gold=resumed.game.gold;assert.equal(resumed.run.state,'return_point');assert.deepEqual(resumed.game.items,{});
 returnToTown(data,resumed);assert.equal(resumed.game.gold,gold);assert.equal(resumed.game.storage.materials.cave_rat_mat,3);
 assert.deepEqual(resumed.game.items,{});assert.equal(resumed.game.cleared.mossy_cave,undefined);
 const again=new GameSession({storage:old.store.storage});assert.equal(again.run,null);assert.equal(again.game.storage.materials.cave_rat_mat,3);
});
