import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeEnemy, createBattle, nextTurn, actionOptions, setPending, resolvePending, finishBattle, battleRewards,
  elementMul, fleeRate, knownSkills, targetKind, curedBy, collectBattleHits,
} from '../js/battle.js';
import { learnSkill, equipSkill } from '../js/growth.js';
import { monsterKnowledge } from '../js/monster-knowledge.js';
import { equippedGame } from './combat-fixtures.js';
import { evaluate } from '../js/expr.js';
import { maxHp } from '../js/character.js';
import { realGameData, readJson } from './helpers.js';

const data = realGameData();
const party = [
  { name: 'A', job: 'warrior', icon: 'x' }, { name: 'B', job: 'knight', icon: 'x' },
  { name: 'C', job: 'black_mage', icon: 'x' }, { name: 'D', job: 'white_mage', icon: 'x' },
  { name: 'E', job: 'thief', icon: 'x' }, { name: 'F', job: 'bard', icon: 'x' },
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

test('命中した属性だけを図鑑に記録し、弱点・耐性・通常の演出を判定する', () => {
  for (const [effectiveness, weak, resist] of [
    ['weak', ['slash', 'fire'], ['ice']],
    ['resist', ['fire'], ['slash', 'ice']],
    ['normal', ['fire'], ['ice']],
  ]) {
    const game = equippedGame(data, party);
    const enemy = { ...makeEnemy(data, 'goblin', { lv: 1 }), weak, resist, hp: 9999, spd: 0 };
    const b = createBattle(data, game, { enemies: [enemy], seed: 5 });
    assert.deepEqual(game.catalog.monsters, ['goblin']);
    assert.deepEqual(monsterKnowledge(data, game, enemy), { weak: [], resist: [], normal: [], scanned: false });
    b.turn = { side: 'ally', i: 0 };
    setPending(b, { type: 'attack', target: 0 }, Q);
    const hits = collectBattleHits(b, () => resolvePending(data, game, b, true));
    assert.equal(hits.length, 1);
    assert.equal(hits[0].effectiveness, effectiveness);
    const reloaded = JSON.parse(JSON.stringify(game));
    assert.deepEqual(monsterKnowledge(data, reloaded, enemy)[effectiveness], [data.elements.get('slash').name]);
    assert.deepEqual(reloaded.catalog.affinities.goblin.elements, ['slash']);
  }
});

test('固定マスター以前のデータでは旧式と冠補正を読み取れる', () => {
  const data = realGameData();
  for (const monster of data.monsters.values()) delete monster.fixedStats;
  const E = readJson('balance.json').enemy;
  const m = data.monsters.get('slime');
  const e = makeEnemy(data, 'slime', { lv: 3, dungeonId: 'mossy_cave' });
  const dg = data.dungeons.get('mossy_cave');
  const raw = evaluate(E.hp, { Lv: 3, hp_mul: m.hpMul, 'dungeon.enemy_mul': dg.enemyMul, 'hp_rank_mul[★]': E.hp_rank_mul[dg.rank] });
  assert.equal(e.maxHp, Math.round(raw));
  const boss = makeEnemy(data, 'slime', { lv: 3, dungeonId: 'mossy_cave', boss: true });
  assert.equal(boss.maxHp, Math.round(raw * E.boss_hp_mul * (E.hp_boss_rank_mul?.[dg.rank] ?? 1)));
  const elite = makeEnemy(data, 'slime', { lv: 3, dungeonId: 'mossy_cave', eliteId: 'giant' });
  assert.ok(elite.maxHp > e.maxHp && elite.name.startsWith('巨大な'));
});

test('★1の敵に全問正解で勝てる。経験値と AP がもらえる', () => {
  const game = equippedGame(data, party);
  const b = createBattle(data, game, { enemies: mossyEnemies(), seed: 1 });
  const { result } = fight(game, b);
  assert.equal(result, 'win');
  finishBattle(data, game, b);
  const r = battleRewards(data, game, b);
  assert.ok(r.xp.every((x) => x > 0));
  assert.equal(r.ap[0], readJson('balance.json').rewards.ap_per_battle);
});


test('勝利時に戦闘不能や石化の仲間も経験値を受け取り、APは受け取らない', () => {
  const game = equippedGame(data, party);
  const b = createBattle(data, game, { enemies: mossyEnemies(), seed: 1 });
  assert.equal(fight(game, b).result, 'win');
  game.party[1].hp = 0;
  b.allies[2].statuses.petrify = { turns: 3, n: 1 };
  const rewards = battleRewards(data, game, b);
  assert.ok(rewards.xp.every((xp) => xp > 0));
  assert.equal(rewards.xp[1], rewards.xp[0]);
  assert.equal(rewards.xp[2], rewards.xp[0]);
  assert.equal(rewards.ap[1], 0);
  assert.equal(rewards.ap[2], 0);
  assert.equal(rewards.ap[0], readJson('balance.json').rewards.ap_per_battle);
});

test('同じ種と同じ答えなら同じ結果（乱数は battle に入っている）', () => {
  const run = () => {
    const game = equippedGame(data, party);
    const b = createBattle(data, game, { enemies: mossyEnemies(3), seed: 42 });
    fight(game, b, (n) => n % 3 !== 0);
    return JSON.stringify([b.log, game.party.map((m) => m.hp)]);
  };
  assert.equal(run(), run());
});

test('途中で保存して読み直しても、同じ結果になる（読み込み直しで変えられない）', () => {
  const g1 = equippedGame(data, party);
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
    const game = equippedGame(data, party);
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
  const game = equippedGame(data, party);
  learnSkill(data, game.party[2], 'black_mage_A01'); equipSkill(data, game.party[2], 'black_mage_A01');
  // スライムは炎が弱点・打撃が効きにくい。黒魔道士の炎弾（炎）
  const fire = knownSkills(data, game.party[2]).find((s) => s.elements.includes('fire'));
  assert.ok(fire, '黒魔道士の炎のスキル');
  const e = makeEnemy(data, 'slime', { lv: 1, dungeonId: 'mossy_cave' });
  e.hp = e.maxHp = 99999; e.spd = 0;
  const b = createBattle(data, game, { enemies: [e], seed: 5 });
  while (nextTurn(data, game, b) && b.turn.i !== 2) { setPending(b, { type: 'flee' }, Q); b.canFlee = false; resolvePending(data, game, b, true); }
  setPending(b, { type: 'skill', skillId: fire.id, target: 0 }, Q);
  resolvePending(data, game, b, true);
  assert.ok(b.log.some((l) => l.includes('弱点！')), b.log.join('\n'));
});

test('ボス戦でも通常戦と同じ計算で逃げられる', () => {
  const game = equippedGame(data, party);
  const enemy = makeEnemy(data, 'goblin', { lv: 1, boss: true });
  const b = createBattle(data, game, { enemies: [enemy], seed: 1 });
  const b2 = createBattle(data, game, { enemies: [{ ...enemy, boss: false }], seed: 1 });
  assert.ok(fleeRate(data, game, b) > 0);
  assert.equal(fleeRate(data, game, b), fleeRate(data, game, b2));
  nextTurn(data, game, b);
  const option = actionOptions(data, game, b, b.turn.i).flee;
  assert.ok(option.rate > 0 && option.rate <= 0.95);
  assert.equal(option.reason, '');
  setPending(b, { type: 'flee' }, Q);
  b.rng = 7; // 逃走判定が成功する乱数に固定する。
  resolvePending(data, game, b, true);
  assert.equal(b.result, 'fled');
});

test('明示的に逃走禁止の戦闘ではボスに関係なく逃げられない', () => {
  for (const boss of [false, true]) {
    const game = equippedGame(data, party);
    const b = createBattle(data, game, {
      enemies: [makeEnemy(data, 'goblin', { lv: 1, boss })], seed: 1, canFlee: false,
    });
    assert.equal(fleeRate(data, game, b), 0);
    nextTurn(data, game, b);
    assert.deepEqual(actionOptions(data, game, b, b.turn.i).flee, { rate: 0, reason: '逃げられない' });
  }
});

test('道具：使うと減り、HP が回復する。戦闘不能の味方は気付け薬で起きる', () => {
  const game = equippedGame(data, party);
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
  const game = equippedGame(data, party);
  const cursed = makeEnemy(data, 'goblin', { lv: 1, eliteId: 'cursed' });
  cursed.status = 'curse'; cursed.statusRate = 1; cursed.magicRate = 0; cursed.str = 1;
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
  const game = equippedGame(data, party);
  const b = createBattle(data, game, { enemies: ['goblin', 'goblin', 'goblin'].map((id) => makeEnemy(data, id, { lv: 12, dungeonId: 'mossy_cave' })), seed: 2 });
  assert.equal(fight(game, b, () => false).result, 'lose');
});

test('基本8職の前提なしアクティブをAPで習得・装着して実行できる', () => {
  for (const job of data.jobs.filter(job => job.tier === 'base')) {
    const entrances = [...data.skills.values()].filter(skill => skill.job === job.id && !skill.isFinal
      && skill.kind !== 'passive' && !skill.effect.prerequisites?.length);
    assert.ok(entrances.length > 0);
    for (const skill of entrances) {
      const game = equippedGame(data, [{ name: 'X', job: job.id, icon: 'x' }, ...party.slice(1)]);
      const member = game.party[0];
      member.ap = 1000;
      learnSkill(data, member, skill.id);
      equipSkill(data, member, skill.id);
      const e = makeEnemy(data, 'slime', { lv: 1 }); e.spd = 0; e.hp = e.maxHp = 99999;
      const b = createBattle(data, game, { enemies: [e], seed: 1 });
      member.mp = 999;
      b.turn = { side: 'ally', i: 0 };
      const option = actionOptions(data, game, b, 0).skills.find(entry => entry.skill.id === skill.id);
      assert.ok(option, skill.id);
      assert.equal(option.reason, '', skill.id);
      const kind = targetKind(data, { type: 'skill', skillId: skill.id }, member);
      setPending(b, { type: 'skill', skillId: skill.id, target: kind === 'ally' ? 1 : 0 }, Q);
      assert.doesNotThrow(() => resolvePending(data, game, b, true), skill.id);
      assert.equal(b.pending, null, skill.id);
    }
  }
});

test('石化した敵だけが残れば報酬を得て勝利し、味方全員も石化していれば敗北する', () => {
  for (const allAlliesPetrified of [false, true]) {
    const game = equippedGame(data, party);
    const b = createBattle(data, game, { enemies: mossyEnemies(), seed: 1 });
    b.enemies[0].hp = 0;
    b.enemies[1].statuses.petrify = { turns: 99, n: 1 };
    for (const ally of b.allies) if (allAlliesPetrified) ally.statuses.petrify = { turns: 99, n: 1 };
    assert.equal(nextTurn(data, game, b), null);
    assert.equal(b.result, allAlliesPetrified ? 'lose' : 'win');
    if (!allAlliesPetrified) assert.ok(battleRewards(data, game, b).xp.every((xp) => xp > 0));
  }
});

test('連戦で状態異常の残りターンと段階が保存され、スタンと挑発が解除される', () => {
  const game = equippedGame(data, party);
  game.party[0].persist = ['curse'];
  const battle = () => createBattle(data, game, { enemies: mossyEnemies(), seed: 1 });
  const b = battle();
  assert.equal(b.allies[0].statuses.curse.turns, data.statusEffects.get('curse').turns);
  Object.assign(b.allies[0].statuses, { poison: { turns: 2, n: 3 }, stun: { turns: 1 }, taunt: { turns: 2 } });
  finishBattle(data, game, b);
  game.party = JSON.parse(JSON.stringify(game.party));
  const next = battle().allies[0].statuses;
  assert.deepEqual(next.poison, { turns: 2, n: 3 });
  assert.ok(next.curse);
  assert.equal(next.stun, undefined);
  assert.equal(next.taunt, undefined);
});

test('無属性を含む5段階の相性と、0ダメージの命中による相性発見', () => {
  const game = equippedGame(data, party);
  const enemy = makeEnemy(data, 'lava_golem', { lv: 5 });
  assert.deepEqual(['water', 'ice', 'none', 'slash', 'fire'].map((id) => elementMul(data, enemy, id)), [2, 1.5, 1, 0.5, 0]);
  const target = { ...enemy, immune: ['slash'], strongWeak: [], weak: [], resist: [] };
  const b = createBattle(data, game, { enemies: [target], seed: 5 });
  b.turn = { side: 'ally', i: 0 };
  setPending(b, { type: 'attack', target: 0 }, Q);
  assert.deepEqual(collectBattleHits(b, () => resolvePending(data, game, b, true)), []);
  assert.equal(b.enemies[0].hp, enemy.hp);
  assert.deepEqual(game.catalog.affinities.lava_golem.elements, ['slash']);
  assert.deepEqual(monsterKnowledge(data, game, target).resist, ['×斬撃']);
});

test('魔力漏出で敵のMPが減り、MP不足時は魔法攻撃を通常攻撃に切り替える', () => {
  const game = equippedGame(data, party);
  const enemy = makeEnemy(data, 'goblin', { lv: 3 });
  enemy.magicRate = 1;
  enemy.mp = 2;
  enemy.statuses.weaken = { turns: 3, n: 1 };
  const b = createBattle(data, game, { enemies: [enemy], seed: 5 });
  b.round = 1;
  b.queue = [{ side: 'enemy', i: 0 }, { side: 'ally', i: 0 }];
  assert.equal(nextTurn(data, game, b)?.side, 'ally');
  assert.equal(enemy.mp, 1);
  assert.ok(b.log.some((line) => line.includes(enemy.name + 'の攻撃')));
});

test('複合属性は免疫と弱点のうち有利な倍率を採用する', () => {
  function damage(dual) {
    const game = equippedGame(data, party);
    const target = { ...makeEnemy(data, 'lava_golem', { lv: 5 }), immune: ['slash'], strongWeak: ['fire'] };
    const b = createBattle(data, game, { enemies: [target], seed: 5 });
    if (dual) game.party[0].equip.weapon.affixes = { 'ELEMENT:fire': 1 };
    b.turn = { side: 'ally', i: 0 };
    setPending(b, { type: 'attack', target: 0 }, Q);
    resolvePending(data, game, b, true);
    return target.maxHp - target.hp;
  }
  assert.equal(damage(false), 0);
  assert.ok(damage(true) > 0);
});


