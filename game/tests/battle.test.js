import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeEnemy, createBattle, nextTurn, actionOptions, setPending, resolvePending, finishBattle, battleRewards,
  fleeRate, knownSkills, targetKind, curedBy,
} from '../js/battle.js';
import { createNewGame } from '../js/game-state.js';
import { maxHp } from '../js/character.js';
import { realGameData, readJson } from './helpers.js';

const data = realGameData();
const party = [
  { name: 'A', job: 'warrior', icon: 'x' }, { name: 'B', job: 'knight', icon: 'x' },
  { name: 'C', job: 'black_mage', icon: 'x' }, { name: 'D', job: 'white_mage', icon: 'x' },
];
const Q = { wordId: 'lx_r1_001' }; // 問題の中身は戦闘には関係しない

/** 決まった答え方で最後まで戦う：answer(turnCount) → 正解か */
function fight(game, b, answer = () => true, choose = () => ({ type: 'attack', target: 0 })) {
  let n = 0;
  while (nextTurn(data, game, b)) {
    const i = b.turn.i;
    const act = choose(i, b);
    setPending(b, act, Q);
    resolvePending(data, game, b, answer(n++));
  }
  return { result: b.result, actions: n };
}

const mossyEnemies = (lv = 1) => ['slime', 'goblin'].map((id) => makeEnemy(data, id, { lv, dungeonId: 'mossy_cave' }));

test('敵の能力値は balance.json の式（★の補正・ボスの倍率を含む）', () => {
  const E = readJson('balance.json').enemy;
  const m = data.monsters.get('slime');
  const e = makeEnemy(data, 'slime', { lv: 3, dungeonId: 'mossy_cave' });
  const dg = data.dungeons.get('mossy_cave');
  const raw = (150 + 6.5 * 3) * m.hpMul * 1.68 * dg.enemyMul * E.hp_rank_mul['1'];
  assert.equal(e.maxHp, Math.round(raw));
  const boss = makeEnemy(data, 'slime', { lv: 3, dungeonId: 'mossy_cave', boss: true });
  assert.equal(boss.maxHp, Math.round(raw * E.boss_hp_mul));
  const elite = makeEnemy(data, 'slime', { lv: 3, dungeonId: 'mossy_cave', eliteId: 'giant' });
  assert.ok(elite.maxHp > e.maxHp && elite.name.startsWith('巨大な'));
});

test('★1の敵に全問正解で勝てる。経験値と AP がもらえる', () => {
  const game = createNewGame(data, party);
  const b = createBattle(data, game, { enemies: mossyEnemies(), seed: 1 });
  const { result } = fight(game, b);
  assert.equal(result, 'win');
  finishBattle(data, game, b);
  const r = battleRewards(data, game, b);
  assert.ok(r.xp.every((x, i) => (game.party[i].hp > 0 ? x > 0 : x === 0)));
  assert.equal(r.ap[0], readJson('balance.json').rewards.ap_per_battle);
});

test('同じ種と同じ答えなら同じ結果（乱数は battle に入っている）', () => {
  const run = () => {
    const game = createNewGame(data, party);
    const b = createBattle(data, game, { enemies: mossyEnemies(3), seed: 42 });
    fight(game, b, (n) => n % 3 !== 0);
    return JSON.stringify([b.log, game.party.map((m) => m.hp)]);
  };
  assert.equal(run(), run());
});

test('途中で保存して読み直しても、同じ結果になる（読み込み直しで変えられない）', () => {
  const g1 = createNewGame(data, party);
  const b1 = createBattle(data, g1, { enemies: mossyEnemies(3), seed: 7 });
  // 3行動したところで保存（JSON にして戻す）
  let n = 0;
  while (n < 3 && nextTurn(data, g1, b1)) { setPending(b1, { type: 'attack', target: 0 }, Q); resolvePending(data, g1, b1, true); n++; }
  nextTurn(data, g1, b1);
  setPending(b1, { type: 'attack', target: 1 }, { wordId: 'saved' });
  const saved = JSON.parse(JSON.stringify({ g: g1, b: b1 }));
  assert.deepEqual(saved.b.pending.question, { wordId: 'saved' }); // 答える前の問題も残る
  resolvePending(data, g1, b1, true); fight(g1, b1);
  const g2 = saved.g; const b2 = saved.b;
  resolvePending(data, g2, b2, true); fight(g2, b2);
  assert.deepEqual(b2.log, b1.log);
  assert.equal(b2.result, b1.result);
});

test('不正解だと弱い行動になる（与えるダメージが減る）', () => {
  const dmgWith = (correct) => {
    const game = createNewGame(data, party);
    const e = makeEnemy(data, 'goblin', { lv: 5, dungeonId: 'mossy_cave' });
    e.spd = 0; // 味方が先に動く
    const b = createBattle(data, game, { enemies: [e], seed: 3 });
    nextTurn(data, game, b);
    setPending(b, { type: 'attack', target: 0 }, Q);
    resolvePending(data, game, b, correct);
    return e.maxHp - e.hp;
  };
  const [lo, hi] = readJson('balance.json').battle.wrong_answer_mult;
  const ok = dmgWith(true); const ng = dmgWith(false);
  assert.ok(ng < ok * hi * 1.2 && ng > 0, `${ng} vs ${ok}`);
  assert.ok(ng >= Math.floor(ok * lo * 0.8), `${ng} vs ${ok}`);
});

test('弱点の属性は大きく、効きにくい属性は小さく', () => {
  const game = createNewGame(data, party);
  // スライムは炎が弱点・打撃が効きにくい。黒魔道士の炎弾（炎）
  const fire = knownSkills(data, game.party[2]).find((s) => s.elements.includes('fire'));
  assert.ok(fire, '黒魔道士の炎のスキル');
  const e = makeEnemy(data, 'slime', { lv: 1, dungeonId: 'mossy_cave' });
  e.hp = e.maxHp = 99999; e.spd = 0;
  const b = createBattle(data, game, { enemies: [e], seed: 5 });
  while (nextTurn(data, game, b) && b.turn.i !== 2) { setPending(b, { type: 'skill', skillId: 'knight_p1_s1' }, Q); b.pending.action = { type: 'flee' }; b.canFlee = false; resolvePending(data, game, b, true); }
  setPending(b, { type: 'skill', skillId: fire.id, target: 0 }, Q);
  resolvePending(data, game, b, true);
  assert.ok(b.log.some((l) => l.includes('弱点！')), b.log.join('\n'));
});

test('ボスからは逃げられない。逃げられる戦闘は確率がある', () => {
  const game = createNewGame(data, party);
  const b = createBattle(data, game, { enemies: [makeEnemy(data, 'goblin', { lv: 1, boss: true })], seed: 1 });
  assert.equal(fleeRate(data, game, b), 0);
  const b2 = createBattle(data, game, { enemies: mossyEnemies(), seed: 1 });
  const p = fleeRate(data, game, b2);
  assert.ok(p > 0 && p <= 0.95);
  nextTurn(data, game, b2);
  assert.ok(actionOptions(data, game, b2, b2.turn.i).flee.rate > 0);
});

test('道具：使うと減り、HP が回復する。戦闘不能の味方は気付け薬で起きる', () => {
  const game = createNewGame(data, party);
  game.items = { potion: 2, revive_salts: 1 };
  game.party[1].hp = 10;
  game.party[2].hp = 0;
  const e = makeEnemy(data, 'slime', { lv: 1 }); e.spd = 0; e.hp = e.maxHp = 99999;
  const b = createBattle(data, game, { enemies: [e], seed: 9 });
  nextTurn(data, game, b);
  setPending(b, { type: 'item', itemId: 'potion', target: 1 }, Q);
  resolvePending(data, game, b, true);
  assert.equal(game.items.potion, 1);
  assert.ok(game.party[1].hp >= 10 + data.items.get('potion').value - 1 || game.party[1].hp === maxHp(data, game.party[1]));
  nextTurn(data, game, b);
  setPending(b, { type: 'item', itemId: 'revive_salts', target: 2 }, Q);
  resolvePending(data, game, b, true);
  assert.ok(game.party[2].hp > 0);
  assert.equal(game.items.revive_salts, undefined);
  assert.equal(targetKind(data, { type: 'item', itemId: 'revive_salts' }), 'ko_ally');
});

test('状態異常：敵からかかり、戦闘のあとも残るもの（呪いなど）は persist に残る', () => {
  const game = createNewGame(data, party);
  const cursed = makeEnemy(data, 'goblin', { lv: 1, eliteId: 'cursed' });
  cursed.statusRate = 1; cursed.magicRate = 0; cursed.str = 1;
  const b = createBattle(data, game, { enemies: [cursed], seed: 11 });
  for (const m of game.party) m.hp = maxHp(data, m);
  // 回避されないよう何度か敵に攻撃させる
  let rounds = 0;
  while (rounds++ < 20 && !game.party.some((m) => m.persist.includes('curse'))) {
    if (!nextTurn(data, game, b)) break;
    setPending(b, { type: 'flee' }, Q); b.canFlee = false; resolvePending(data, game, b, true);
    if (b.allies.some((a) => a.statuses.curse)) break;
  }
  assert.ok(b.allies.some((a) => a.statuses.curse), '呪いにかかる');
  b.enemies[0].hp = 0; b.result = 'win';
  finishBattle(data, game, b);
  assert.ok(game.party.some((m) => m.persist.includes('curse')));
  assert.ok(curedBy(data.statusEffects.get('curse'), '万能薬'));
  assert.ok(!curedBy(data.statusEffects.get('curse'), '清めの光'));
});

test('全問不正解で強い敵と戦うと全滅する（負けがある）', () => {
  const game = createNewGame(data, party);
  const b = createBattle(data, game, { enemies: ['goblin', 'goblin', 'goblin'].map((id) => makeEnemy(data, id, { lv: 12, dungeonId: 'mossy_cave' })), seed: 2 });
  assert.equal(fight(game, b, () => false).result, 'lose');
});

test('すべてのジョブの1段目のスキルが使える（エラーにならない）', () => {
  for (const job of data.jobs) {
    const game = createNewGame(data, [{ name: 'X', job: job.id, icon: 'x' }, party[1], party[2], party[3]]);
    for (const s of knownSkills(data, game.party[0])) {
      const e = makeEnemy(data, 'slime', { lv: 1 }); e.spd = 0; e.hp = e.maxHp = 99999;
      const b = createBattle(data, game, { enemies: [e], seed: 1 });
      game.party[0].mp = 999;
      while (nextTurn(data, game, b).i !== 0) { b.pending = { actor: b.turn.i, action: { type: 'flee' } }; b.canFlee = false; resolvePending(data, game, b, true); }
      setPending(b, { type: 'skill', skillId: s.id, target: s.kind === 'revive' ? 1 : 0 }, Q);
      resolvePending(data, game, b, true);
    }
  }
});
