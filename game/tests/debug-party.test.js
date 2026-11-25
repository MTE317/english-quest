import test from 'node:test';
import assert from 'node:assert/strict';
import { canDebugParty, confirmDebugParty } from '../js/debug-party.js';
import { createNewGame } from '../js/game-state.js';
import { maxHp, maxMp } from '../js/character.js';
import { GameSession } from '../js/save.js';
import { SAVE_KEY } from '../js/storage.js';
import { realGameData, MemoryStorage } from './helpers.js';
const data = realGameData();
function fixture() {
 const storage=new MemoryStorage(), session=new GameSession({storage});
 const game=createNewGame(data,['warrior','knight','black_mage','white_mage','thief','bard'].map(job=>({job,name:job,icon:'x'})));
 game.party.forEach((m,i)=>{m.lv=i===5?99:i+1;m.xp=17;m.hp=i===1?0:maxHp(data,m)-7;m.mp=maxMp(data,m)-3;m.ap=i===2?1500:i*10;m.visitedJobs.push('unrelated_job');});
 session.startNew(game);return {storage,session};
}
test('開発設定は6人の共通APを999にし通常のHP/MP増加とXP規則で保存',()=>{
 const {storage,session}=fixture(),before=structuredClone(session.game);assert(canDebugParty(data,session));
 assert.match(confirmDebugParty(data,session,()=>true),/保存しました/);
 const expected=structuredClone(before);
 expected.party.forEach((m,i)=>{const old=before.party[i],oh=maxHp(data,old),om=maxMp(data,old);m.lv=99;m.xp=0;m.ap=999;m.hp=old.hp>0?old.hp+maxHp(data,m)-oh:0;m.mp=old.mp+maxMp(data,m)-om;});
 assert.deepEqual(session.game,expected);assert.deepEqual(new GameSession({storage}).game,expected);
 confirmDebugParty(data,session,()=>true);assert.deepEqual(session.game,expected);
});
test('キャンセルで保存内容も無変更、確認は現在のセーブへの反映を明示',()=>{
 const {storage,session}=fixture(),raw=storage.getItem(SAVE_KEY);
 confirmDebugParty(data,session,message=>{assert.match(message,/現在のセーブに保存/);assert.match(message,/加算ではありません/);return false;});
 assert.equal(storage.getItem(SAVE_KEY),raw);
});
test('遠征中・戦闘中・新しい版・セーブなしを拒否し確認中の遠征開始も上書きしない',()=>{
 for(const mode of ['run','battle','readonly','none']){
  const {storage,session}=fixture();
  if(mode==='none')storage.removeItem(SAVE_KEY);
  else {const s=JSON.parse(storage.getItem(SAVE_KEY));if(mode==='readonly')s.version=999;else s.run={dungeonId:'mossy_cave',battle:mode==='battle'?{}:null};storage.setItem(SAVE_KEY,JSON.stringify(s));}
  const raw=storage.getItem(SAVE_KEY);let called=false;
  confirmDebugParty(data,session,()=>{called=true;return true;});assert.equal(called,false);assert.equal(storage.getItem(SAVE_KEY),raw);
 }
 const {storage,session}=fixture();let raw;
 confirmDebugParty(data,session,()=>{const other=new GameSession({storage});other.enterDungeon({dungeonId:'mossy_cave'});raw=storage.getItem(SAVE_KEY);return true;});
 assert.equal(storage.getItem(SAVE_KEY),raw);
});

