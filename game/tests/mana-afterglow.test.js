import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../sim/balance.mjs';
import { createNewGame, normalizeGame } from '../js/game-state.js';
import { equipSkill, learnCommon, isLearned, memberMods, ensureLoadout } from '../js/growth.js';
import { maxHp, maxMp } from '../js/character.js';
import { recoverAfterBattle } from '../js/dungeon.js';
import { GameSession } from '../js/save.js';
import { MemoryStorage, T0 } from './helpers.js';
const data = loadData();
function setup(tree, passive, upper = false) {
  const game = createNewGame(data, ['warrior','knight','black_mage','white_mage','thief','bard'].map((job,i)=>({job,name:`検証${i}`,icon:'x'})));
  const m = game.party[0]; m.lv=30; m.hp=maxHp(data,m); m.mp=0;
  if(tree) learnCommon(data,m,'mana_afterglow');
  if(upper) learnCommon(data,m,'mana2');
  if(passive) equipSkill(data,m,'common_mana_afterglow');
  return {game,m};
}
for(const upper of [false,true]) for(const [label,tree,passive] of [['なし',false,false],['ツリーのみ',true,false],['装着のみ',false,true],['両方',true,true]]) {
  test(`基本版${label}・上位${upper}の回復と通常保存・再読込`,()=>{
    const {game,m}=setup(tree,passive,upper);
    const rate=(tree||passive ? .1:0)+(upper?.15:0);
    assert.ok(Math.abs((memberMods(data,m).mp_regen??0)-rate)<1e-12);
    const storage=new MemoryStorage();
    const session=new GameSession({storage,now:()=>T0}); session.startNew(game);
    const loaded=new GameSession({storage,now:()=>T0}); normalizeGame(data,loaded.game);
    const restored=loaded.game.party[0];
    assert.equal(restored.loadout.passives.includes('common_mana_afterglow'),passive);
    assert.deepEqual(restored.common,m.common);
    recoverAfterBattle(data,loaded.game);
    assert.equal(restored.mp,Math.round(maxMp(data,restored)*rate));
    recoverAfterBattle(data,game); assert.equal(m.mp,restored.mp);
  });
}
test('共通パッシブだけを例外とし未経験職のAP0技能は使えない',()=>{
  const {m}=setup(false,false);
  assert.equal(isLearned(m,data.skills.get('common_mana_afterglow')),true);
  assert.equal(isLearned(m,data.skills.get('black_mage_p1_s1')),false);
  assert.throws(()=>equipSkill(data,m,'black_mage_p1_s1'),/覚えていない/);
  m.loadout.passives.push('common_mana_afterglow');
  m.loadout.actions.push('black_mage_p1_s1');
  ensureLoadout(data,m);
  assert.ok(m.loadout.passives.includes('common_mana_afterglow'));
  assert.ok(!m.loadout.actions.includes('black_mage_p1_s1'));
});
test('他のMP回復要因には基本版の上限を課さない',()=>{
  const {game,m}=setup(true,true,true);
  // 追加発生源の合成を検証するテスト専用データ。正式データは変更しない。
  const extra={...data,skills:new Map(data.skills)};
  extra.skills.set('test_mp_source',{id:'test_mp_source',effect:{mod:{mp_regen:.07}}});
  m.loadout.passives.push('test_mp_source');
  assert.ok(Math.abs(memberMods(extra,m).mp_regen-.32)<1e-12);
  recoverAfterBattle(extra,game); assert.equal(m.mp,Math.round(maxMp(extra,m)*.32));
});
