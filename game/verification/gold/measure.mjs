// 実ゲームの入出金API。経済経路は成功した周回を条件とする（戦闘勝率のモデルではない）。
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root=path.resolve(process.env.GAME_ROOT??'.'),imp=p=>import(pathToFileURL(path.join(root,p)));
const {buildGameData,GAME_FILES}=await imp('game/js/gamedata.js'),{parseCsv}=await imp('game/js/csv.js');
const raw=Object.fromEntries(Object.entries(GAME_FILES).map(([k,n])=>{const s=readFileSync(path.join(root,'data',n),'utf8').replace(/^\uFEFF/,'');return[k,n.endsWith('.json')?JSON.parse(s):parseCsv(s).rows];}));
if(process.env.SCALE)raw.balance.gold_economy={version:1,scale:Number(process.env.SCALE),minimum_step:10,significant_digits:Number(process.env.DIGITS??3)};
const engineFiles=['gamedata','game-state','gold','town','loot','dungeon','exploration','exploration-story','workshop','temple','retired-quests','save'].map(n=>path.join(root,'game/js',n+'.js')).filter(existsSync);
const engineHash=()=>{const h=createHash('sha256');for(const f of engineFiles)h.update(path.basename(f)).update(readFileSync(f));return h.digest('hex');};
const fingerprint=engineHash();
const data=buildGameData(raw),scale=data.balance.gold_economy?.scale??1;
const {createNewGame,defaultPartySpecs}=await imp('game/js/game-state.js');
const town=await imp('game/js/town.js'),{makeEncounter}=await imp('game/js/encounter.js'),{rollBattleLoot}=await imp('game/js/loot.js'),{expeditionFee}=await imp('game/js/dungeon.js');
const {rngFor}=await imp('sim/balance.mjs');
const fresh=()=>createNewGame(data,defaultPartySpecs(data));
const quotes=[];for(const rank of data.ranks){const g=fresh();g.rank=rank.id;g.facilities.item_shop=12;
 for(const s of town.gearShopStock(data,g)){const sell=town.sellPrice(data,{id:s.def.id,rarity:'common'});quotes.push({rank:rank.id,id:s.def.id,buy:s.price,sell,profit:sell-s.price});}
 for(const s of town.itemShopStock(data,g))quotes.push({rank:rank.id,id:s.item.id,buy:s.price});
}
const runs=64,seed=112501,progression=[];
for(let n=0;n<runs;n++){
 const g=fresh(),rng=rngFor(seed+n*7919),ledger=[];
 // 初攻略→周回。R02店は昇格済みとする進度スナップショットで、試験/学習は模擬しない。
 for(const [stage,ids]of [['early',['sunlit_forest','mossy_cave','goblin_quarry']],['later',['ruined_fort','misty_marsh']]]){
  if(stage==='later')g.rank='R02';
  let upgradeCost=0;if(stage==='later'){const offer=town.gearShopStock(data,g).filter(x=>x.def.kind==='sword').sort((a,b)=>b.def.itemLv-a.def.itemLv)[0];assert.ok(offer);town.buyGear(data,g,offer.def.id);upgradeCost=offer.price;}
  for(let lap=0;lap<3;lap++)for(const id of ids){
   const before=g.gold;g.items={};const p=town.itemShopStock(data,g).find(x=>x.item.id==='potion').price;
   const supplies=town.buyItem(data,g,'potion',2)*p,fee=expeditionFee(data,data.dungeons.get(id));assert.ok(g.gold>=fee);g.gold-=fee;
   town.fillBoard(data,g,rng);const q=g.board.find(q=>q.type==='hunt'&&q.dungeonId===id);if(q&&g.quests.length<6)town.acceptQuest(data,g,q.uid,rng);
   let lootGold=0,saleGold=0;const rows=data.dungeonFloors.filter(f=>f.dungeonId===id);
   for(const f of rows)for(let i=0;i<f.battles;i++){
    const enemies=makeEncounter(data,id,f.floor,rng,{boss:f.lastBattleIsBoss&&i===f.battles-1,season:'spring',elites:false});
    const loot=rollBattleLoot(data,g,id,f.floor,enemies,rng);g.gold+=loot.gold;lootGold+=loot.gold;
    town.countKills(g,enemies,id);
    for(const gear of loot.gear){const sale=town.sellPrice(data,gear);saleGold+=sale;g.gold+=sale;}
   }
   let questGold=0;for(const q of [...g.quests])if(town.canReport(data,g,q)){const old=g.gold;town.reportQuest(data,g,q.uid,rng);questGold+=g.gold-old;}
   g.cleared[id]=(g.cleared[id]??0)+1;town.refreshBoard(data,g,rng);const inn=town.stayInn(data,g,false);
   const shop=town.gearShopStock(data,g),sword=shop.filter(x=>x.def.kind==='sword').sort((a,b)=>b.def.itemLv-a.def.itemLv)[0];
   ledger.push({stage,lap,id,upgradeCost:lap===0&&id===ids[0]?upgradeCost:0,before,after:g.gold,supplies,fee,lootGold,saleGold,questGold,inn,weaponPrice:sword.price,affordableWeapons:Math.floor(g.gold/sword.price)});
  }
 }
 progression.push({seed:seed+n*7919,ledger});
}
const otherQuotes=[...data.recipes.map(r=>({type:'recipe',id:r.id,gold:Number(r.gold)})),...data.alchemyRecipes.map(r=>({type:'alchemy',id:r.id,gold:Number(r.gold)})),...data.enchantGrades.map(r=>({type:'enchant',id:r.grade,gold:Number(r.gold)})),...data.facilityRanks.map(r=>({type:'facility',id:r.rank,gold:Number(r.invest_cost)})),...data.backpackTiers.map(r=>({type:'backpack',id:r.tier,gold:r.gold})),...data.ranks.map(r=>({type:'loanLimit',id:r.id,gold:town.loanLimit(data,{rank:r.id})}))];
const examples={initial:fresh().gold,board:town.makeBoard(data,fresh(),rngFor(seed)).map(q=>({id:q.questId,gold:q.rewardGold,deposit:q.depositGold})),economy:[...data.economy.values()],backpack:data.backpackTiers.map(x=>({tier:x.tier,gold:x.gold})),facility:data.facilityRanks.map(x=>({rank:x.rank,gold:x.invest_cost})),revive:[1,10,50,99].map(lv=>({lv,gold:town.reviveCost(data,{lv})}))};
assert.equal(engineHash(),fingerprint);
writeFileSync(process.argv[2],JSON.stringify({engineHash:fingerprint,sourceUnchangedAtCompletion:true,harnessHash:createHash('sha256').update(readFileSync(import.meta.filename)).digest('hex'),sourceHash:createHash('sha256').update(JSON.stringify(raw)).digest('hex'),root,scale,otherQuotes,digits:data.balance.gold_economy?.significant_digits??null,seed,runs,quotes,examples,progression},null,2)+'\n');console.log({scale,runs,quotes:quotes.length,loops:progression.length*15});
