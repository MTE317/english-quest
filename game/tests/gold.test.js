import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../sim/balance.mjs';
import { createNewGame, normalizeGame, defaultPartySpecs } from '../js/game-state.js';
import { roundGold } from '../js/gold.js';
import { GameSession, SAVE_VERSION } from '../js/save.js';
import { MemoryStorage, readCsv } from './helpers.js';
import { fillBoard, acceptQuest, reportQuest, questAbandonRefund, itemShopStock, gearShopStock, buyItem, buyGear, sellPrice, loanLimit, repayLoan } from '../js/town.js';
const data=loadData(),fresh=()=>createNewGame(data,defaultPartySpecs(data));

test('Gの丸めは小額10・5桁100・6桁1000単位、正の見積は0にならない',()=>{
 for(const [n,want]of [[0,0],[1,10],[530,530],[12345,12300],[123456,123000],[999999,1000000]])assert.equal(roundGold(data,n),want);
 const a=loadData(),b=loadData();assert.equal(a.balance.new_game.gold,10000);assert.equal(b.balance.new_game.gold,10000);
 assert.equal(a.items.get('potion').price,200);assert.equal(data.monsters.size,1024);
});

test('旧所持金・借入・全契約・返還マーカーを正確に10倍、再正規化で不変',()=>{
 const g=fresh();delete g.goldVersion;g.gold=12345;g.loan=111;
 const q={uid:77,rewardGold:12345,depositGold:53,depositPaid:53};
 g.board=[{...q}];g.quests=[{...q}];g.specialQuest={...q};g.questBoardByArea={old:[{...q}]};
 g.runeRetirement={version:1,gold:7000};g.retiredQuestChains={old:{settlement:{gold:17,points:3}}};
 const party=structuredClone(g.party);normalizeGame(data,g);
 assert.equal(g.gold,123450);assert.equal(g.loan,1110);
 for(const q of [g.board[0],g.quests[0],g.specialQuest,g.questBoardByArea.old[0]]){
  assert.equal(q.rewardGold,123450);assert.equal(q.depositPaid,530);assert.equal(q.goldLegacyContract,true);
 }
 assert.equal(g.runeRetirement.gold,70000);assert.equal(g.retiredQuestChains.old.settlement.gold,170);
 assert.deepEqual(g.party,party);const once=structuredClone(g);normalizeGame(data,g);assert.deepEqual(g,once);
});

test('遠征中の現在・復元元・獲得額を独立換算し、保存・全滅後にも二重換算しない',()=>{
 const mem=new MemoryStorage(),g=fresh();let session=new GameSession({storage:mem});delete g.goldVersion;g.gold=1000;g.loan=111;
 session.startNew(g);session.state.version=1;session.enterDungeon({dungeonId:'mossy_cave'},(run,g)=>{g.gold=1037;run.earned={gold:37,xp:80};run.expeditionFee=12;run.explorationNotices=[{gold:23}];});
 session=new GameSession({storage:mem});assert.equal(session.state.version,SAVE_VERSION);
 normalizeGame(data,session.game,session.run);session.save();
 const s=new GameSession({storage:mem});normalizeGame(data,s.game,s.run);
 assert.equal(s.game.gold,10370);assert.equal(s.game.loan,1110);assert.equal(s.run.snapshot.loan,1110);assert.equal(s.run.snapshot.gold,10000);assert.deepEqual(s.run.earned,{gold:370,xp:80});assert.equal(s.run.expeditionFee,120);assert.equal(s.run.explorationNotices[0].gold,230);
 s.wipe();normalizeGame(data,s.game);assert.equal(s.game.gold,10000);assert.equal(s.game.loan,1110);
 repayLoan(s.game,80);assert.equal(s.game.gold,9920);assert.equal(s.game.loan,1030);
 normalizeGame(data,s.game);assert.equal(s.game.gold,9920);assert.equal(s.game.loan,1030);
 const modern=new GameSession({storage:new MemoryStorage()});modern.startNew(fresh());modern.enterDungeon({dungeonId:'mossy_cave'},r=>r.earned={gold:370,xp:8});normalizeGame(data,modern.game,modern.run);assert.equal(modern.run.earned.gold,370);
});

test('旧特別依頼の約定報酬・保証金・期限内加算は丸めで失われない',()=>{
 const g=fresh();delete g.goldVersion;g.gold=1000;
 g.quests=[{uid:99,type:'hunt',rank:1,questId:data.quests.find(q=>q.type==='hunt').id,count:1,progress:1,rewardGold:12345,depositPaid:53,special:true,completedDay:1,deadlineDay:2}];
 normalizeGame(data,g);const before=g.gold;reportQuest(data,g,99,()=>.5);
 assert.equal(g.gold-before,Math.round(12345*1.3)*10+530);assert.equal(g.quests.length,0);
 assert.throws(()=>reportQuest(data,g,99),/受注|ない/);
 assert.equal(questAbandonRefund(data,{depositPaid:530}),420);
});

test('表示用単価と購入控除は一致、まとめ買い合計や残高は再丸めしない',()=>{
 const g=fresh(),p=itemShopStock(data,g).find(x=>x.item.id==='potion').price;
 const before=g.gold;assert.equal(buyItem(data,g,'potion',3),3);assert.equal(before-g.gold,p*3);
 const sword=gearShopStock(data,g).find(x=>x.def.id==='sword_t1');const cash=g.gold;
 const gear=buyGear(data,g,sword.def.id);assert.equal(cash-g.gold,sword.price);assert.ok(sellPrice(data,gear)<sword.price);
});

test('既存未受注53Gは530G、新規掲示も同じ単位。換算済みの微小残高は保持',()=>{
 const g=fresh();delete g.goldVersion;g.gold=37;g.board=[{uid:1,rewardGold:53}];normalizeGame(data,g);
 assert.equal(g.board[0].rewardGold,530);assert.equal(g.gold,370);
 g.gold=3;normalizeGame(data,g);assert.equal(g.gold,3);
 const n=fresh();fillBoard(data,n,()=>.3);assert.ok(n.board.every(q=>q.rewardGold>=0&&q.rewardGold%10===0));
 const q=n.board.find(q=>q.type==='bounty');const start=n.gold;acceptQuest(data,n,q.uid,()=>.3);assert.equal(start-n.gold,q.depositPaid);
});


test('全ランクの旧最大合法借入を換算しても新融資上限を超えない',()=>{
 const rows=readCsv('economy_by_rank.csv').rows;
 for(const [index,rank]of data.ranks.entries()){
  const oldFee=Number(rows.find(r=>Number(r.dungeon_rank)===rank.maxDungeonRank).guild_fee);
  const oldLimit=Math.floor(3*oldFee*(1+.25*index/2));
  const g=fresh();delete g.goldVersion;g.gold=17;g.loan=oldLimit;g.rank=rank.id;
  normalizeGame(data,g);assert.equal(g.loan,oldLimit*10);assert.ok(g.loan<=loanLimit(data,g),rank.id);
  const once=g.loan;normalizeGame(data,g);assert.equal(g.loan,once);
 }
});

