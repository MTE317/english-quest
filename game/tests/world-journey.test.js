import test from 'node:test';
import assert from 'node:assert/strict';
import { realGameData, MemoryStorage } from './helpers.js';
import { createNewGame, normalizeGame } from '../js/game-state.js';
import { GameSession } from '../js/save.js';
import { startRun, startNextBattle, afterBattle, chooseWorldExit, returnToTown, resolveLoot, runFloorCount, allowedDungeons } from '../js/dungeon.js';
import { worldNode, worldEntries, exitChoices, worldGraph } from '../js/world-journey.js';
import { makeEncounter } from '../js/encounter.js';
import { promotionMaterialStatus } from '../js/town.js';
import { actionOptions, setPending, resolvePending, targetKind } from '../js/battle.js';

const data = realGameData({ world: true });
const specs = ['warrior','knight','white_mage','black_mage','thief','bard'].map(job => ({ name: job, job, icon: 'human_01' }));
function fixture() {
  const storage = new MemoryStorage();
  const session = new GameSession({ storage });
  const game = createNewGame(data, specs);
  game.gold = 1000; game.items.return_feather = 4;
  session.startNew(game);
  return { session, storage };
}
function start(session, key = 'A', options = {}) {
  startRun(data, session, { dungeonId: worldNode(data,key).id, stoneId: '00', quizState: { asked:0 }, seed:37, ...options });
}
function win(session) {
  startNextBattle(data, session);
  for (const enemy of session.run.battle.enemies) enemy.hp = 0;
  session.run.battle.result = 'win';
  afterBattle(data, session);
  while (session.run.pendingLoot.length) resolveLoot(data,session,null);
}
function clear(session) { for(let i=0;i<3;i++) win(session); assert.equal(session.run.state,'cleared'); }
function exit(session, dir) { return chooseWorldExit(data,session,dir,session.run.worldVisit); }

test('新地図は4入口だけ。全13ダンジョンは3戦、表の39出口を保持する', () => {
  const { session }=fixture();
  assert.deepEqual(worldEntries(data,session.game).map(n=>n.key),['A','E','H','M']);
  const expected = { A:['B','origin','origin'],B:['A','D','C'],C:['B','D','F'],D:['C','G','B'],E:['F','origin','L'],F:['C','K','E'],G:['D','stone_2','F'],H:['I','origin','origin'],I:['H','origin','J'],J:['I','stone_4','origin'],K:['F','stone_3','G'],L:['E','origin','origin'],M:['C','origin','L'] };
  for(const node of data.worldRoutes.nodes) {
    assert.deepEqual(node.exits.map(e=>e.to),expected[node.key]);
    assert.equal(data.dungeonFloors.filter(r=>r.dungeonId===node.id).reduce((n,r)=>n+r.battles,0),3);
    assert.equal(node.battles,3);
  }
  assert.throws(()=>start(session,'C'),/入口/);
  session.game.worldJourney.seen.push('C');
  session.game.cleared.world_c=20;
  assert.throws(()=>start(session,'C'),/入口/);
});

test('A→B→D→Gの12戦で石2を解放して必ず帰還し、全踏破と戦利品を確定', () => {
  const {session,storage}=fixture();
  start(session); const snapshot=structuredClone(session.run.snapshot), day=session.game.day;
  clear(session); const pack=structuredClone(session.run.backpack), money=session.run.earned.gold;
  session.game.party[0].hp=5;session.game.party[0].mp=2;
  exit(session,'left');
  assert.equal(session.game.party[0].hp,5);assert.equal(session.game.party[0].mp,2);
  assert.deepEqual(session.run.backpack,pack); assert.equal(session.run.earned.gold,money);
  assert.deepEqual(session.run.snapshot,snapshot);assert.equal(session.game.day,day);
  clear(session);exit(session,'forward');clear(session);exit(session,'forward');clear(session);
  const earned=session.run.earned.gold;
  assert.equal(session.run.battlesDone,12);
  assert.equal(session.game.cleared?.world_a,undefined);
  const arrival=exit(session,'forward');
  assert.equal(arrival.stoneId,'stone_2'); assert.equal(session.run,null);
  assert.ok(session.game.worldJourney.stones.includes('stone_2'));
  assert.equal(session.game.gold,1000+earned);
  for(const k of ['a','b','d','g'])assert.equal(session.game.cleared['world_'+k],1);
  const loaded=new GameSession({storage});
  assert.equal(loaded.run,null); assert.ok(loaded.game.worldJourney.stones.includes('stone_2'));
});

test('E→F→Kの9戦で石3、春のH→I→Jの9戦で石4へ到着', () => {
  for(const [entry,dirs,stone] of [['E',['left','forward','forward'],'stone_3'],['H',['left','right','forward'],'stone_4']]) {
    const {session}=fixture();start(session,entry);session.run.worldSeason='spring';
    for(const dir of dirs){clear(session);exit(session,dir);}
    assert.equal(session.run,null);assert.ok(session.game.worldJourney.stones.includes(stone));
    session.game.day=200;
    normalizeGame(data,session.game);
    assert.ok(session.game.worldJourney.stones.includes(stone));
  }
});

test('Iの右は春以外に閉鎖。到達前の石はワープ解放しない', () => {
  const {session}=fixture();start(session,'H');clear(session);exit(session,'left');clear(session);
  session.run.worldSeason='winter';
  assert.equal(exitChoices(data,session.game,session.run,'winter')[2].open,false);
  assert.throws(()=>exit(session,'right'),/閉鎖/);
  assert.equal(session.run.dungeonId,'world_i');
  assert.deepEqual(session.game.worldJourney.stones,['origin']);
  session.run.worldSeason='spring';exit(session,'right');clear(session);
  assert.ok(worldGraph(data,session.game,'spring').stones.some(s=>s.id==='stone_4'));
  assert.deepEqual(session.game.worldJourney.stones,['origin']);
});

test('戻り道も再び3戦。古い画面の出口選択と未クリア時の出口選択を拒否', () => {
  const {session}=fixture();start(session);assert.throws(()=>exit(session,'left'));
  clear(session);const visit=session.run.worldVisit;exit(session,'left');
  assert.equal(session.run.state,'ready');assert.equal(session.run.floor,1);
  assert.throws(()=>chooseWorldExit(data,session,'left',visit));
  clear(session);exit(session,'left');assert.equal(session.run.dungeonId,'world_a');
  assert.equal(runFloorCount(data,session.run),3);clear(session);
  exit(session,'right');assert.equal(session.game.cleared.world_a,2);
});

test('町への出口はアイテム不要、クリア後の無条件な無料帰還は不可', () => {
  const {session}=fixture();start(session);clear(session);
  assert.throws(()=>returnToTown(data,session),/出口/);
  const before=session.game.items.return_feather;
  const arrival=exit(session,'forward');
  assert.match(arrival.message,/町に到着/);
  assert.equal(session.game.items.return_feather,before);
});

test('帰還の羽で途中帰還し、途中までの戦利品と完了済みダンジョンを確定', () => {
  const {session}=fixture();start(session);clear(session);exit(session,'left');win(session);
  const gold=session.game.gold;returnToTown(data,session,'return_feather');
  assert.equal(session.game.items.return_feather,3);assert.equal(session.game.gold,gold);
  assert.equal(session.game.cleared.world_a,1);assert.equal(session.game.cleared.world_b,undefined);
});

test('全滅時は遠征全体の戦利品を失い、育成・地図・消費済み道具を維持', () => {
  const {session,storage}=fixture();start(session);clear(session);exit(session,'left');win(session);
  const map=structuredClone(session.game.worldJourney), xp=session.game.party[0].xp;
  session.game.items.return_feather--;
  startNextBattle(data,session);session.game.party.forEach(m=>{m.hp=0;});session.run.battle.result='lose';
  afterBattle(data,session);
  assert.equal(session.run,null);assert.equal(session.game.gold,1000);
  assert.deepEqual(session.game.storage.gear,[]);assert.deepEqual(session.game.storage.materials,{});
  assert.deepEqual(session.game.worldJourney,map);assert.equal(session.game.items.return_feather,3);
  assert.equal(session.game.party[0].xp,xp);assert.ok(session.game.party.every(m=>m.hp===0));
  assert.equal(session.game.cleared.world_a,undefined);
  assert.deepEqual(new GameSession({storage}).game.worldJourney,map);
});

test('3択中に再読込しても続行でき、連続移動で学習・戦利品記録を初期化しない', () => {
  const {session,storage}=fixture();start(session);clear(session);
  session.run.quiz.asked=17;session.save();
  const loaded=new GameSession({storage});assert.equal(loaded.run.state,'cleared');
  exit(loaded,'left');assert.equal(loaded.run.quiz.asked,17);assert.equal(loaded.run.battlesDone,3);
  assert.equal(loaded.run.worldVisit,2);assert.equal(loaded.run.worldClears.world_a,1);
});

test('新ルートに探索イベント・途中無料帰還地点はない。敵数と種類は抽選される', () => {
  const {session}=fixture();start(session);win(session);win(session);
  assert.deepEqual(session.run.explorationPlan,[]);assert.deepEqual(session.run.explorationNotices,[]);
  assert.equal(session.run.state,'ready');assert.ok(session.run.route.every(r=>!r.returnPointAfter));
  const a=makeEncounter(data,'world_a',1,()=>0),b=makeEncounter(data,'world_a',1,()=>.99);
  assert.equal(a.length,1);assert.equal(b.length,2);assert.notEqual(a[0].monsterId,b[0].monsterId);
});

test('最終戦から逃げても踏破できず、ボス逃走による無料帰還地点も生まれない', () => {
  const {session}=fixture();start(session);win(session);win(session);startNextBattle(data,session);
  session.run.battle.result='fled';afterBattle(data,session);
  assert.equal(session.run.state,'ready');assert.equal(session.run.floor,3);assert.deepEqual(session.run.worldClears,{});
  win(session);assert.equal(session.run.state,'cleared');
});

test('D昇格素材は新ルートの野盗から入手でき、発見状態を認識する', () => {
  const {session}=fixture();session.game.worldJourney.seen.push('C');session.game.storage.materials.fort_bandit_mat=2;
  const rank=data.ranks.find(r=>r.id==='D');
  assert.equal(promotionMaterialStatus(data,session.game,rank).ready,true);
  assert.ok(allowedDungeons(data,session.game).some(d=>d.id==='world_c'));
});

test('複合条件は達成順を問わず、季節条件と同時に満たす必要がある', () => {
  const d=realGameData({world:true}),{session}=fixture();
  const e=worldNode(d,'I').exits[2];e.clears=['world_a'];e.flags=['bridge'];e.quests=['route-quest'];
  const run={dungeonId:'world_i',worldClears:{world_a:1}};
  session.game.worldFlags={bridge:true};
  assert.equal(exitChoices(d,session.game,run,'spring')[2].open,false);
  session.game.worldJourney.completedQuests=['route-quest'];
  assert.equal(exitChoices(d,session.game,run,'spring')[2].open,true);
  assert.equal(exitChoices(d,session.game,run,'winter')[2].open,false);
});

test('旧遠征は途中で変換せず、帰還後に新地図を初期化する', () => {
  const old=realGameData(), storage=new MemoryStorage(),session=new GameSession({storage});
  session.startNew(createNewGame(old,specs));
  startRun(old,session,{dungeonId:'windward_plain',stoneId:'00',quizState:{},seed:1});
  const route=structuredClone(session.run.route);
  normalizeGame(data,session.game,session.run);
  assert.equal(session.game.worldJourney,undefined);assert.deepEqual(session.run.route,route);
  assert.equal(session.run.snapshot.worldJourney,undefined);
  session.game.items.return_feather=1;returnToTown(data,session,'return_feather');normalizeGame(data,session.game);
  assert.deepEqual(session.game.worldJourney.stones,['origin']);
});

test('煙玉で通常戦から逃走でき、逃走不可では消費せず、最終戦を飛ばして踏破しない', () => {
  const {session}=fixture();session.game.items.smoke_ball=2;start(session);startNextBattle(data,session);
  const battle=session.run.battle;
  battle.turn={side:'ally',i:0};
  const action={type:'item',itemId:'smoke_ball'};
  assert.equal(targetKind(data,action),'none');
  battle.canFlee=false;
  assert.equal(actionOptions(data,session.game,battle,0).items.find(x=>x.item.id==='smoke_ball').reason,'逃げられない');
  setPending(battle,action,{});resolvePending(data,session.game,battle,true);
  assert.equal(session.game.items.smoke_ball,2);assert.notEqual(battle.result,'fled');
  battle.canFlee=true;battle.turn={side:'ally',i:0};
  setPending(battle,action,{});resolvePending(data,session.game,battle,true);
  assert.equal(battle.result,'fled');assert.equal(session.game.items.smoke_ball,1);
  afterBattle(data,session);assert.equal(session.run.floor,2);assert.equal(session.run.earned.gold,0);
});

test('移行できない旧依頼は保証金を一度だけ返し、記録を保存。達成済み契約は残す', () => {
  const old=realGameData(),game=createNewGame(old,specs);
  game.gold=1000;
  game.quests=[{uid:1,type:'bounty',dungeonId:'mossy_cave',target:'missing_bounty',progress:0,count:1,depositPaid:80},
    {uid:2,type:'bounty',dungeonId:'mossy_cave',target:'missing_bounty',progress:1,count:1,depositPaid:80},
    {uid:3,type:'hunt',dungeonId:'mossy_cave',targetMode:'dungeon',target:'mossy_cave',targetIds:['cave_rat'],progress:1,count:3,depositPaid:0}];
  normalizeGame(data,game);
  assert.equal(game.gold,1080);assert.equal(game.worldJourney.archivedQuests[0].uid,1);
  assert.equal(game.quests.length,2);assert.equal(game.quests.find(q=>q.uid===3).dungeonId,'world_b');
  normalizeGame(data,game);assert.equal(game.gold,1080);
});
