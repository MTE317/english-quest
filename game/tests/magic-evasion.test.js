import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../sim/balance.mjs';
import { withEngineSkillFixtures, equippedGame } from './combat-fixtures.js';
import { createBattle, makeEnemy, setPending, resolvePending } from '../js/battle.js';
import { maxHp, maxMp } from '../js/character.js';

const data = withEngineSkillFixtures(loadData());
function setup(seed = 42) {
  const game = equippedGame(data, ['black_mage', 'warrior', 'hunter', 'white_mage', 'thief', 'bard']
    .map((job, i) => ({ job, name: `テスト${i}`, icon: 'x' })));
  for (const m of game.party) { m.lv = 20; m.hp = maxHp(data, m); m.mp = maxMp(data, m); }
  const enemies = [0, 1].map(() => makeEnemy(data, 'goblin', { lv: 20, eliteId: 'shadow' }));
  // 確率の境界を検証する制御標的。正式な15%での計測は別プローブ。
  enemies[0].evasion = 1;
  enemies[1].evasion = 0;
  const battle = createBattle(data, game, { enemies, seed });
  return { game, battle };
}
function act({ game, battle }, skillId, actor = 0) {
  battle.turn = { side: 'ally', i: actor };
  setPending(battle, skillId ? { type: 'skill', skillId, target: 0 } : { type: 'attack', target: 0 }, {});
  resolvePending(data, game, battle, true);
}

test('魔法の単体・全体攻撃は対象ごとに回避され、回避時は付随異常も付かない', () => {
  for (const id of [null, 'black_mage_p1_s1', 'black_mage_p1_s3', 'black_mage_p2_s4']) {
    const ctx = setup(); const hp = ctx.battle.enemies.map(e => e.hp);
    act(ctx, id);
    assert.equal(ctx.battle.enemies[0].hp, hp[0]);
    assert.deepEqual(ctx.battle.enemies[0].statuses, {});
    if (id === 'black_mage_p1_s3') assert.ok(ctx.battle.enemies[1].hp < hp[1]);
    assert.equal(ctx.battle.pending, null, "回避の再出題を予約しない");
  }
});

test('束縛中は物理と魔法とも回避できず、魔法は暗闇では外れない', () => {
  for (const actor of [0, 1]) {
    const ctx = setup(); const hp = ctx.battle.enemies[0].hp;
    ctx.battle.enemies[0].statuses.bind = { turns: 2, n: 1 };
    if (actor === 0) ctx.battle.allies[0].statuses.blind = { turns: 3, n: 1 };
    act(ctx, actor === 0 ? 'black_mage_p1_s1' : null, actor);
    assert.ok(ctx.battle.enemies[0].hp < hp);
  }
});

test('物理回避の既存挙動を保ち、状態専用技能は回避判定を通さない', () => {
  const ctx = setup(); const hp = ctx.battle.enemies[0].hp;
  act(ctx, null, 1);
  assert.equal(ctx.battle.enemies[0].hp, hp);
  const skill = data.skills.get('hunter_p3_s4'); // 回避を通さない汎用status効果の制御データ。
  assert.ok(skill);
  const high = setup(7); const low = structuredClone(high);
  low.battle.enemies[0].evasion = 0;
  act(high, skill.id); act(low, skill.id);
  assert.ok(high.battle.enemies[0].statuses.blind, "回避100%でも状態専用の暗闇が付く");
  assert.deepEqual(high.battle.enemies[0].statuses, low.battle.enemies[0].statuses);
  assert.equal(high.battle.rng, low.battle.rng);
});

test('回答待ちをJSON保存した後も魔法回避と出題数が同じになる', () => {
  const original = setup();
  original.battle.turn = { side: 'ally', i: 0 };
  setPending(original.battle, { type: 'skill', skillId: 'black_mage_p1_s3', target: 0 }, { wordId: 'synthetic' });
  const restored = JSON.parse(JSON.stringify(original));
  for (const ctx of [original, restored]) resolvePending(data, ctx.game, ctx.battle, true);
  assert.deepEqual(restored, original);
});

