import { writeFileSync } from 'node:fs';
import { loadData, rngFor, chooseAction, prepareNextBattle, sourceFingerprint } from '../../../sim/balance.mjs';
import { preparedNewGame } from './fixture.mjs';
import { GameSession } from '../../js/save.js';
import { startRun, startNextBattle, afterBattle, returnToTown, resolveLoot } from '../../js/dungeon.js';
import { nextTurn, setPending, resolvePending } from '../../js/battle.js';
import { stayInn } from '../../js/town.js';
import { maxHp, maxMp } from '../../js/character.js';
import { MemoryStorage } from '../../tests/helpers.js';

const data=loadData(), fingerprint=sourceFingerprint();
const seasons=['spring','summer','autumn','winter'];
const rows=[];
for(const season of seasons) for(const accuracy of [.65,.8]) for(let n=0;n<32;n++) {
  const {game,purchases}=preparedNewGame(data);
  // 季節だけを比較するため日付を設定。資金・能力には補正を加えない。
  game.day=1+seasons.indexOf(season)*30;
  const session=new GameSession({storage:new MemoryStorage()});session.startNew(game);
  for(const [index,dungeonId] of ['windward_plain','sunlit_forest','mossy_cave'].entries()) {
    const seed=172903+n*7919+index*101;
    const answer=rngFor(seed^0x5f3759df);
    const row={season,accuracy,n,seed,dungeonId,startGold:session.game.gold,startLv:session.game.party.map(m=>m.lv),purchases:index?undefined:purchases,battles:[],questions:0};
    startRun(data,session,{dungeonId,stoneId:'00',quizState:{asked:0},seed});
    while(session.run) {
      while(session.run?.state==='loot') resolveLoot(data,session,null);
      if(session.run?.state==='cleared'){returnToTown(data,session);row.clear=true;break;}
      prepareNextBattle(data,session.game);
      startNextBattle(data,session);
      const b=session.run.battle;
      const entry={ids:b.enemies.map(e=>e.monsterId),hp:b.enemies.map(e=>e.maxHp),questions:0};
      while(nextTurn(data,session.game,b)) {
        if(entry.questions>600)throw Error('question cap');
        setPending(b,chooseAction(data,session.game,b),{wordId:'synthetic',reason:'neutral'});
        resolvePending(data,session.game,b,answer()<accuracy);
        entry.questions++;session.run.quiz.asked++;
      }
      row.questions+=entry.questions;entry.result=b.result;
      entry.hpLeft=session.game.party.map(m=>m.hp);entry.mpLeft=session.game.party.map(m=>m.mp);
      afterBattle(data,session);row.battles.push(entry);
    }
    row.clear=Boolean(row.clear);row.endGold=session.game.gold;row.items={...session.game.items};
    row.endLv=session.game.party.map(m=>m.lv);row.cleared={...session.game.cleared};
    row.healthRatio=session.game.party.reduce((v,m)=>v+m.hp/maxHp(data,m),0)/6;
    row.manaRatio=session.game.party.reduce((v,m)=>v+m.mp/maxMp(data,m),0)/6;
    rows.push(row);
    if(!row.clear)break;
    if(index<2){const before=session.game.gold;stayInn(data,session.game,false);row.innCost=before-session.game.gold;}
  }
}
const median=a=>a.sort((x,y)=>x-y)[Math.floor(a.length/2)];
const summary=[];
for(const season of seasons)for(const accuracy of [.65,.8])for(const dungeonId of ['windward_plain','sunlit_forest','mossy_cave']){
 const r=rows.filter(r=>r.season===season&&r.accuracy===accuracy&&r.dungeonId===dungeonId);
 summary.push({season,accuracy,dungeonId,runs:r.length,clears:r.filter(x=>x.clear).length,medianQuestions:median(r.map(x=>x.questions)),maxQuestions:Math.max(...r.map(x=>x.questions)),minGold:Math.min(...r.map(x=>x.endGold)),minSurvivors:Math.min(...r.flatMap(x=>x.battles.map(b=>b.hpLeft.filter(h=>h>0).length)))});
}
const fixture=preparedNewGame(data);
const result={fixture:{gold:fixture.game.gold,purchases:fixture.purchases,party:fixture.game.party.map(m=>({job:m.job,ap:m.ap,learned:m.learned,equip:m.equip}))},fingerprint,sourceUnchanged:JSON.stringify(fingerprint)===JSON.stringify(sourceFingerprint()),seed:172903,summary,rows};
const {rows: samples,...metadata}=result;
writeFileSync(new URL('./results.json',import.meta.url),JSON.stringify(metadata,null,2).slice(0,-2)+',\n  "rows": [\n'+samples.map(row=>'    '+JSON.stringify(row)).join(',\n')+'\n  ]\n}\n');console.table(summary);
