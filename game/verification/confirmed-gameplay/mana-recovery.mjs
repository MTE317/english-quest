// 合成6人編成、同Lv・初期MP0・生存状態で戦闘後回復を3回比較。乱数は使わない。
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {loadData,sourceFingerprint} from '../../../sim/balance.mjs';
import {createNewGame} from '../../js/game-state.js';
import {learnCommon,equipSkill,memberMods} from '../../js/growth.js';
import {maxHp,maxMp} from '../../js/character.js';
import {recoverAfterBattle} from '../../js/dungeon.js';
const data=loadData(), sourceSha256=sourceFingerprint(), results=[];
for(const level of [3,30]) for(const upper of (level===30?[false,true]:[false])) {
  for(const [name,tree,passive] of [['none',false,false],['tree',true,false],['passive',false,true],['both',true,true]]) {
    const game=createNewGame(data,['warrior','knight','black_mage','white_mage','thief','bard'].map((job,i)=>({job,name:`検証${i}`,icon:'x'})));
    for(const m of game.party){m.lv=level;m.hp=maxHp(data,m);m.mp=0;}
    const m=game.party[0];
    m.ap=30;
    if(tree)learnCommon(data,m,'mana_afterglow');
    if(upper)learnCommon(data,m,'mana2');
    if(passive)equipSkill(data,m,'common_mana_afterglow');
    const mp=[];
    for(let i=0;i<3;i++){recoverAfterBattle(data,game);mp.push(m.mp);}
    const rate=(tree||passive?.1:0)+(upper?.15:0);
    assert.ok(Math.abs((memberMods(data,m).mp_regen??0)-rate)<1e-12);
    assert.equal(mp[0],Math.round(maxMp(data,m)*rate));
    results.push({level,upper,name,maxMp:maxMp(data,m),rate,mpAfterEachRecovery:mp});
  }
}
const result={sourceSha256,sourceUnchangedAtCompletion:sourceSha256===sourceFingerprint(),partySize:6,initialMp:0,recoveries:3,randomness:'none',limitations:'戦闘後回復APIのみ。勝率・実戦でのMP収支・長期バランスは評価しない。',results};
writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(results));
