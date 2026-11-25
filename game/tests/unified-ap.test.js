import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewGame, normalizeGame } from '../js/game-state.js';
import { availableAp, gainAp, normalizeAp } from '../js/ap.js';
import { changeJob, learnSkill, learnCommon, commonBlock, upgradeSkill, isLearned } from '../js/growth.js';
import { gainXp, xpToNext } from '../js/character.js';
import { applyTrainingAnswer } from '../js/training.js';
import { GameSession } from '../js/save.js';
import { realGameData, MemoryStorage } from './helpers.js';
const data = realGameData();
const fresh = () => createNewGame(data, ['warrior','knight','black_mage','white_mage','thief','bard'].map(job=>({job,name:job,icon:'x'})));

test('APを転職後の習得・強化・共通パッシブで使い、仲間とは共有しない', () => {
  const game=fresh(), m=game.party[0];
  m.ap=70; m.lv=5;
  assert.equal(isLearned(m,data.skills.get('black_mage_p1_s1')),false);
  assert.throws(()=>learnSkill(data,m,'black_mage_p1_s2'),/転職/);
  changeJob(data,game,0,'black_mage');
  assert.equal(m.ap,70);
  learnSkill(data,m,'black_mage_p1_s2');
  learnSkill(data,m,'black_mage_p1_s1');
  upgradeSkill(data,m,'black_mage_p1_s1');
  learnCommon(data,m,'vit1');
  assert.equal(m.ap,30);
  assert.equal(game.party[1].ap,0);
  changeJob(data,game,0,'warrior');
  assert.equal(m.ap,30);
  assert.equal(isLearned(m,data.skills.get('black_mage_p1_s1')),true);
  assert.ok(m.common.includes('vit1'));
});

test('AP不足・レベル不足・二重習得では残高を変えず、レベルだけではAPを得ない', () => {
  const m=fresh().party[0], node=data.commonTree.find(n=>n.id==='vit1');
  m.ap=9; m.lv=2;
  assert.match(commonBlock(data,m,node),/AP/);
  assert.throws(()=>learnCommon(data,m,node.id),/AP/);
  assert.equal(m.ap,9); assert.deepEqual(m.common,[]);
  m.ap=10; m.lv=1;
  assert.throws(()=>learnCommon(data,m,node.id),/Lv/);
  gainXp(data,m,xpToNext(data,1));
  assert.equal(m.ap,10);
  learnCommon(data,m,node.id); assert.equal(m.ap,0);
  assert.throws(()=>learnCommon(data,m,node.id),/覚えている/);
  assert.equal(m.ap,0);
});

test('旧残高・未使用共通ポイント・訓練の小数を一度だけ合算し、習得と転職経験を保持', () => {
  const game=fresh(), m=game.party[0];
  delete m.apVersion; delete m.visitedJobs; delete m.skillAcquisitionVersion;
  m.lv=5; m.ap={warrior:17,black_mage:0,thief:23};
  m.common=['vit1']; m.learned=['warrior_p1_s2'];
  m.trainingCredit={xp:.9,ap:{warrior:.8,thief:.7}};
  const run={snapshot:structuredClone(game)};
  normalizeGame(data,game,run);
  assert.equal(m.ap,71); // 40AP + 未使用3pt×10 + 小数合算1AP
  assert.equal(m.trainingCredit.ap,.5);
  assert.equal(m.trainingCredit.xp,.9);
  assert.deepEqual(m.common,['vit1']); assert.ok(m.learned.includes('warrior_p1_s2'));
  assert.equal(isLearned(m,data.skills.get('black_mage_p1_s1')),true);
  assert.equal(isLearned(m,data.skills.get('white_mage_p1_s1')),false);
  assert.equal(run.snapshot.party[0].ap,71);
  const snapshot=structuredClone({game,run});
  normalizeGame(data,game,run);
  assert.deepEqual({game,run},snapshot);
  m.lv=6; normalizeAp(data,m); assert.equal(m.ap,71);
});

test('旧セーブ移行後の戦闘AP相当・訓練AP・保存再開を同じ残高で扱う', () => {
  const game=fresh(),m=game.party[0];
  gainAp(data,m,7);
  for(let i=0;i<25;i++)applyTrainingAnswer(data,game,{kind:'word',id:String(i),day:1,passed:true});
  assert.equal(m.ap,8);
  const storage=new MemoryStorage(),session=new GameSession({storage});
  session.startNew(game);
  const loaded=new GameSession({storage});
  normalizeGame(data,loaded.game);
  assert.equal(availableAp(data,loaded.game.party[0]),8);
  assert.deepEqual(loaded.game.party[0].visitedJobs,['warrior']);
});
