// 新しいビルド効果の発動条件と、複数ヒット・正誤・保存をまたぐ境界の検証。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGameData, GAME_FILES } from '../js/gamedata.js';
import { createNewGame } from '../js/game-state.js';
import { makeGear, maxHp, maxMp } from '../js/character.js';
import { createBattle, makeEnemy, setPending, resolvePending, nextTurn, skillMp, collectBattleHits } from '../js/battle.js';
import { equipSkill, unequipSkill } from '../js/growth.js';
import { recoverAfterBattle } from '../js/dungeon.js';
import { readCsv, readJson } from './helpers.js';

const master = buildGameData(Object.fromEntries(Object.entries(GAME_FILES).map(([key, name]) =>
  [key, name.endsWith('.json') ? readJson(name) : readCsv(name).rows])));
const rules = { ...master, balance: { ...master.balance, battle_formulas: {
  ...master.balance.battle_formulas, crit_cap: 0, ally_rand: [1, 1], enemy_rand: [1, 1], turn_rand: [1, 1],
} } };
// 会心の分岐だけを固定する。実装上の本来の会心上限は builds.test.js で別途検証。
const criticalRules = { ...rules, balance: { ...rules.balance, battle_formulas: { ...rules.balance.battle_formulas, crit_cap: 1 } } };

function setup({ job = 'warrior', weapon = 'sword_t1', count = 1, data = rules, seed = 3 } = {}) {
  const game = createNewGame(data, [job, 'warrior', 'black_mage', 'white_mage'].map((j, i) => ({ name: `仲間${i + 1}`, job: j, icon: 'x' })));
  for (const member of game.party) {
    member.lv = 20;
    member.loadout = { actions: [], passives: [] };
    member.hp = maxHp(data, member);
    member.mp = maxMp(data, member);
  }
  const member = game.party[0];
  member.equip.weapon = makeGear(game, weapon);
  member.equip.offhand = null;
  // 同じ条件で何度も殴れる検証標的。プレイヤーの攻撃・防御・MPは現行式のまま。
  const enemies = Array.from({ length: count }, () => Object.assign(makeEnemy(data, 'goblin', { lv: 20 }), {
    maxHp: 100000, hp: 100000, def: 50, res: 50, str: 40, mag: 40, spd: 0,
    weak: [], resist: [], magicRate: 0, attackElement: null, status: null, evasion: 0,
  }));
  const battle = createBattle(data, game, { enemies, seed, canFlee: false });
  battle.round = 1;
  return { data, game, member, battle, enemies, enemy: enemies[0] };
}
function act(ctx, skillId, correct = true, target = 0, actor = 0) {
  ctx.battle.turn = { side: 'ally', i: actor };
  setPending(ctx.battle, skillId ? { type: 'skill', skillId, target } : { type: 'attack', target }, {});
  return collectBattleHits(ctx.battle, () => resolvePending(ctx.data, ctx.game, ctx.battle, correct));
}
function enemyAct(ctx) {
  ctx.battle.turn = null;
  ctx.battle.queue = [{ side: 'enemy', i: 0 }, { side: 'ally', i: 0 }];
  return collectBattleHits(ctx.battle, () => nextTurn(ctx.data, ctx.game, ctx.battle));
}
function solo(ctx, bind = true) {
  for (const member of ctx.game.party.slice(1)) member.hp = 0;
  if (bind) ctx.battle.allies[0].statuses.bind = { turns: 99, n: 1 };
}
function attackDamage(ctx, skillId, correct = true) {
  const before = ctx.enemies.map((enemy) => enemy.hp);
  act(ctx, skillId, correct);
  return ctx.enemies.map((enemy, i) => before[i] - enemy.hp);
}
function resetSeed(ctx) { ctx.battle.rng = 3; }

test('状態別特効は解除前の睡眠・凍結に乗り、複数条件を重ねても合計60%まで', () => {
  const plain = setup();
  const base = attackDamage(plain)[0];
  const boosted = setup();
  boosted.member.equip.weapon.affixes = { 'VS_STATUS:sleep': 40, 'VS_STATUS:freeze': 40 };
  boosted.enemy.statuses.sleep = { turns: 2, n: 1 };
  boosted.enemy.statuses.freeze = { turns: 2, n: 1 };
  const first = attackDamage(boosted)[0];
  assert.ok(Math.abs(first - base * 1.6) <= 1);
  assert.equal(boosted.enemy.statuses.sleep, undefined);
  assert.equal(boosted.enemy.statuses.freeze, undefined);
  resetSeed(boosted);
  assert.equal(attackDamage(boosted)[0], base);
  boosted.enemy.statuses.poison = { turns: 3, n: 1 };
  resetSeed(boosted);
  assert.equal(attackDamage(boosted)[0], base, '別の状態には特効が乗らない');
});

test('初撃は全体・二刀の一行動を強化し、二手目や外した後には持ち越さない', () => {
  for (const opts of [
    { job: 'warrior', weapon: 'greatsword_t1', count: 3, skill: 'warrior_p1_s3' },
    { job: 'thief', weapon: 'katana_t1', count: 1, offhand: 'dagger_t1' },
  ]) {
    const plain = setup(opts); const boosted = setup(opts);
    if (opts.offhand) for (const ctx of [plain, boosted]) ctx.member.equip.offhand = makeGear(ctx.game, opts.offhand);
    boosted.member.equip.weapon.affixes.FIRST_HIT = 1000; // 上限検証用の過大値
    const base = attackDamage(plain, opts.skill);
    const first = attackDamage(boosted, opts.skill);
    first.forEach((damage, i) => assert.ok(Math.abs(damage - base[i] * 1.5) <= 2));
    resetSeed(boosted); resetSeed(plain);
    assert.deepEqual(attackDamage(boosted, opts.skill), attackDamage(plain, opts.skill));
  }
  for (const miss of [true, false]) {
    const ctx = setup();
    ctx.member.equip.weapon.affixes.FIRST_HIT = 30;
    if (miss) ctx.enemy.evasion = 1;
    attackDamage(ctx, undefined, miss); // 命中失敗、または不正解
    ctx.enemy.evasion = 0; resetSeed(ctx);
    assert.equal(attackDamage(ctx)[0], attackDamage(setup())[0]);
  }
});

test('通常からの技能強化は正解命中で準備し、次の技能に一回だけ乗る', () => {
  const ctx = setup();
  ctx.member.equip.weapon.affixes.NORMAL_SKILL = 1000;
  const base = attackDamage(setup(), 'warrior_p1_s1')[0];
  act(ctx);
  assert.equal(ctx.battle.allies[0].normalSkillReady, true);
  resetSeed(ctx);
  assert.ok(Math.abs(attackDamage(ctx, 'warrior_p1_s1')[0] - base * 1.4) <= 1);
  assert.equal(ctx.battle.allies[0].normalSkillReady, false);
  resetSeed(ctx);
  assert.equal(attackDamage(ctx, 'warrior_p1_s1')[0], base);

  act(ctx);
  act(ctx, 'white_mage_p1_s1');
  assert.equal(ctx.battle.allies[0].normalSkillReady, false, '回復を挟むと準備は消える');
  act(ctx, undefined, false);
  assert.equal(ctx.battle.allies[0].normalSkillReady, false, '不正解では準備しない');
  ctx.enemy.evasion = 1;
  act(ctx);
  assert.equal(ctx.battle.allies[0].normalSkillReady, false, '全弾外れでも準備しない');
});

test('会心MPと命中MPは一行動5%の追加枠を共有し、多段・全体・二刀でも増殖しない', () => {
  for (const opts of [
    { job: 'dancer', weapon: 'whip_t1', count: 4 },
    { job: 'thief', weapon: 'katana_t1', offhand: 'dagger_t1' },
    { job: 'monk', weapon: 'fist_t1' },
  ]) {
    const ctx = setup({ ...opts, data: criticalRules });
    ctx.member.equip.weapon.affixes = { CRT: 1000, CRIT_MP: 1000, MP_ON_HIT: 1000 };
    if (opts.offhand) ctx.member.equip.offhand = makeGear(ctx.game, opts.offhand);
    ctx.member.mp = 0;
    act(ctx);
    const maximum = maxMp(ctx.data, ctx.member);
    assert.equal(ctx.member.mp, Math.ceil(maximum * .05) + Math.ceil(maximum * ctx.data.balance.mp_rules.normal_attack_regen_rate));
    ctx.member.mp = 0;
    act(ctx, undefined, false);
    assert.equal(ctx.member.mp, 0, '不正解は基礎回復も追加回復も発生しない');
  }
});

test('会心MPは当たった会心だけが対象で、吸魔と合算して技能の消費MPを超えない', () => {
  const ctx = setup({ job: 'hexer', weapon: 'tome_t1', data: criticalRules });
  ctx.member.equip.weapon.affixes = { CRT: 1000, CRIT_MP: 1000 };
  const before = ctx.member.mp;
  const cost = skillMp(ctx.data, ctx.member, ctx.data.skills.get('hexer_p2_s3'));
  act(ctx, 'hexer_p2_s3');
  assert.ok(ctx.member.mp > before - cost);
  assert.ok(ctx.member.mp <= before);

  const miss = setup({ job: 'thief', weapon: 'dagger_t1', data: criticalRules });
  miss.member.equip.weapon.affixes = { CRT: 1000, CRIT_MP: 5 };
  miss.enemy.evasion = 1; miss.member.mp = 0;
  act(miss);
  assert.equal(miss.member.mp, Math.ceil(maxMp(miss.data, miss.member) * miss.data.balance.mp_rules.normal_attack_regen_rate));
  assert.ok(!miss.battle.log.some((line) => line.includes('会心の余韻')));
});

test('攻撃回復は実ダメージに基づき最も消耗した一人だけを回復し、上限・正誤・呪いを守る', () => {
  const ctx = setup({ weapon: 'greatsword_t1', count: 4 });
  ctx.member.equip.weapon.affixes.ATTACK_HEAL = 1000; // 比率・一行動上限の検証
  ctx.game.party[1].hp = 1;
  ctx.game.party[2].hp = Math.floor(maxHp(ctx.data, ctx.game.party[2]) / 2);
  const untouched = ctx.game.party[2].hp;
  const damage = attackDamage(ctx, 'warrior_p1_s3').reduce((sum, value) => sum + value, 0);
  const expected = Math.min(Math.floor(maxHp(ctx.data, ctx.game.party[1]) * .08), Math.round(damage * .2));
  assert.equal(ctx.game.party[1].hp, 1 + expected);
  assert.equal(ctx.game.party[2].hp, untouched);

  ctx.game.party[1].hp = 1;
  act(ctx, undefined, false);
  assert.equal(ctx.game.party[1].hp, 1);
  ctx.battle.allies[1].statuses.curse = { turns: 99, n: 1 };
  act(ctx);
  assert.equal(ctx.game.party[1].hp, 1, '呪われた回復先には効かない');
  delete ctx.battle.allies[1].statuses.curse;
  for (const enemy of ctx.enemies) enemy.hp = 0;
  ctx.enemy.hp = 5;
  act(ctx);
  assert.equal(ctx.game.party[1].hp, 2, '大きな表示ダメージでも倒した相手の残HP5だけを回復へ変える');
});

test('生命障壁は正解回復の余剰だけから作り、重ねて加算せず呪い・不正解・復活では作らない', () => {
  const ctx = setup({ job: 'white_mage', weapon: 'staff_t1' });
  ctx.member.equip.weapon.affixes = { OVERHEAL_SHIELD: 1000, HEAL_POWER: 1000 };
  act(ctx, 'white_mage_p1_s1');
  const cap = Math.floor(maxHp(ctx.data, ctx.member) * .2);
  assert.deepEqual(ctx.battle.allies[0].buffs.barrier, [cap, 3]);
  act(ctx, 'white_mage_p1_s1');
  assert.deepEqual(ctx.battle.allies[0].buffs.barrier, [cap, 3]);
  ctx.battle.allies[0].buffs.barrier[1] = 1;
  ctx.member.equip.weapon.affixes = { OVERHEAL_SHIELD: 10 };
  act(ctx, 'white_mage_p1_s1');
  assert.deepEqual(ctx.battle.allies[0].buffs.barrier, [cap, 1], '弱い回復では古い強い障壁を延長しない');

  delete ctx.battle.allies[0].buffs.barrier;
  act(ctx, 'white_mage_p1_s1', false);
  assert.equal(ctx.battle.allies[0].buffs.barrier, undefined);
  ctx.battle.allies[0].statuses.curse = { turns: 99, n: 1 };
  act(ctx, 'white_mage_p1_s1');
  assert.equal(ctx.battle.allies[0].buffs.barrier, undefined);
  delete ctx.battle.allies[0].statuses.curse;
  ctx.game.party[1].hp = 0;
  act(ctx, 'white_mage_p2_s3', true, 1);
  assert.equal(ctx.battle.allies[1].buffs.barrier, undefined);
});

test('生命障壁は敵の直接打撃を減らし、継続ダメージを防がず、期限・戦闘不能で消える', () => {
  const ctx = setup(); const plain = setup();
  solo(ctx); solo(plain);
  const maximum = maxHp(ctx.data, ctx.member);
  ctx.battle.allies[0].buffs.barrier = [Math.floor(maximum * .2), 3];
  const barrier = ctx.battle.allies[0].buffs.barrier[0];
  const before = ctx.member.hp;
  enemyAct(plain);
  const unprotected = before - plain.member.hp;
  enemyAct(ctx);
  assert.equal(before - ctx.member.hp, Math.max(0, unprotected - barrier));
  assert.equal(ctx.battle.allies[0].buffs.barrier?.[0] ?? 0, Math.max(0, barrier - unprotected));

  ctx.member.hp = maximum;
  ctx.battle.allies[0].buffs.barrier = [barrier, 3];
  ctx.battle.allies[0].statuses.poison = { turns: 3, n: 1 };
  ctx.battle.turn = null; ctx.battle.queue = [{ side: 'ally', i: 0 }];
  nextTurn(ctx.data, ctx.game, ctx.battle);
  assert.ok(ctx.member.hp < maximum);
  assert.deepEqual(ctx.battle.allies[0].buffs.barrier, [barrier, 3]);
  delete ctx.battle.allies[0].statuses.poison;
  for (let remaining = 2; remaining >= 0; remaining--) {
    ctx.battle.turn = null; ctx.battle.queue = [];
    nextTurn(ctx.data, ctx.game, ctx.battle);
    assert.equal(ctx.battle.allies[0].buffs.barrier?.[1] ?? 0, remaining);
  }
  ctx.member.hp = 1;
  ctx.battle.allies[0].buffs.barrier = [barrier, 3];
  ctx.battle.allies[0].normalSkillReady = true;
  ctx.battle.allies[0].statuses.poison = { turns: 3, n: 1 };
  ctx.battle.turn = null; ctx.battle.queue = [{ side: 'ally', i: 0 }];
  nextTurn(ctx.data, ctx.game, ctx.battle);
  assert.equal(ctx.member.hp, 0);
  assert.equal(ctx.battle.allies[0].buffs.barrier, undefined);
  assert.equal(ctx.battle.allies[0].normalSkillReady, false);
});

test('全体回復の障壁は各人の余剰を使い、HP不足分を障壁へ二重に数えない', () => {
  const ctx = setup({ job: 'white_mage', weapon: 'staff_t1' });
  ctx.member.equip.weapon.affixes.OVERHEAL_SHIELD = 60;
  ctx.game.party[1].hp = 1;
  ctx.game.party[3].hp = 0;
  act(ctx, 'white_mage_p1_s3');
  assert.ok(ctx.battle.allies[0].buffs.barrier?.[0] > 0);
  assert.ok(ctx.battle.allies[2].buffs.barrier?.[0] > 0);
  assert.equal(ctx.battle.allies[1].buffs.barrier, undefined, '回復がHP不足分を埋め切らない相手には障壁なし');
  assert.equal(ctx.battle.allies[3].buffs.barrier, undefined, '戦闘不能者には障壁を張らない');
});

test('障壁で防いだ攻撃は不倒を消費せず、突破された致死打撃だけ一度耐える', () => {
  const ctx = setup();
  solo(ctx);
  ctx.member.loadout.passives = ['monk_p3_s4'];
  ctx.member.hp = 2;
  ctx.battle.allies[0].buffs.barrier = [100, 3];
  enemyAct(ctx);
  assert.equal(ctx.member.hp, 2);
  assert.equal(ctx.battle.allies[0].endured, false);
  ctx.enemy.str = 10000;
  enemyAct(ctx);
  assert.equal(ctx.member.hp, 1);
  assert.equal(ctx.battle.allies[0].endured, true);
  assert.equal(ctx.battle.allies[0].buffs.barrier, undefined);
  enemyAct(ctx);
  assert.equal(ctx.member.hp, 0);
  assert.equal(ctx.battle.allies[0].endured, true);
  const fresh = createBattle(ctx.data, ctx.game, { enemies: [], seed: 1 });
  assert.equal(fresh.allies[0].endured, false);
});

test('反撃は初撃・技能準備・攻撃回復・会心MPを再発動せず、回避反撃は物理回避の一巡一回だけ', () => {
  const ctx = setup({ job: 'thief', weapon: 'katana_t1' });
  solo(ctx);
  ctx.member.equip.weapon.affixes = { FIRST_HIT: 50, NORMAL_SKILL: 40, ATTACK_HEAL: 20, CRIT_MP: 5, 'STATUS_ON_HIT:poison': 50 };
  ctx.member.hp = Math.floor(maxHp(ctx.data, ctx.member) / 2); ctx.member.mp = 0;
  ctx.battle.allies[0].buffs.counter = [1, 3];
  ctx.battle.allies[0].normalSkillReady = true;
  const beforeHp = ctx.member.hp;
  enemyAct(ctx);
  assert.ok(ctx.enemy.hp < ctx.enemy.maxHp);
  assert.ok(ctx.member.hp < beforeHp);
  assert.equal(ctx.member.mp, 0);
  assert.equal(ctx.enemy.statuses.poison, undefined);
  assert.equal(ctx.battle.allies[0].firstAttackUsed, false);
  assert.equal(ctx.battle.allies[0].normalSkillReady, true);

  const evade = setup({ job: 'thief', weapon: 'katana_t1' });
  solo(evade, false);
  evade.member.equip.weapon.affixes = { EVA: 1000, EVA_COUNTER: 1000, FIRST_HIT: 50, NORMAL_SKILL: 40, ATTACK_HEAL: 20, CRIT_MP: 5 };
  evade.member.hp = Math.floor(maxHp(evade.data, evade.member) / 2); evade.member.mp = 0;
  let seed = null;
  for (let n = 1; n <= 60 && seed === null; n++) {
    const sample = { ...evade, game: JSON.parse(JSON.stringify(evade.game)), battle: JSON.parse(JSON.stringify(evade.battle)) };
    sample.member = sample.game.party[0]; sample.enemies = sample.battle.enemies; sample.enemy = sample.enemies[0];
    sample.battle.rng = n;
    enemyAct(sample);
    if (sample.battle.allies[0].evadeCounterRound === sample.battle.round) seed = n;
  }
  assert.notEqual(seed, null, '現行の回避率・反撃率上限でも発動する');
  evade.battle.rng = seed;
  const evaderHp = evade.member.hp;
  enemyAct(evade);
  assert.equal(evade.member.hp, evaderHp);
  assert.ok(evade.enemy.hp < evade.enemy.maxHp);
  const enemyHp = evade.enemy.hp;
  evade.battle.rng = seed;
  enemyAct(evade);
  assert.equal(evade.enemy.hp, enemyHp, '同じ巡に二回目の回避反撃は出ない');
  assert.equal(evade.member.mp, 0);
  assert.equal(evade.battle.allies[0].firstAttackUsed, false);
  assert.equal(evade.battle.allies[0].normalSkillReady, false);
  evade.battle.round++;
  evade.enemy.magicRate = 1;
  evade.battle.rng = seed;
  enemyAct(evade);
  assert.equal(evade.enemy.hp, enemyHp, '魔法を回避しても反撃しない');

  const blinded = setup();
  solo(blinded); // 束縛により回避は不可能。敵の暗闇による外れだけを検証する。
  blinded.member.equip.weapon.affixes.EVA_COUNTER = 1000;
  blinded.enemy.statuses.blind = { turns: 99, n: 1 };
  let misses = 0;
  for (let n = 1; n <= 12; n++) {
    blinded.battle.rng = n;
    blinded.member.hp = maxHp(blinded.data, blinded.member);
    const start = blinded.battle.log.length;
    enemyAct(blinded);
    if (blinded.battle.log.slice(start).some((line) => line.includes('攻撃ははずれた'))) misses++;
    assert.equal(blinded.enemy.hp, blinded.enemy.maxHp);
  }
  assert.ok(misses > 0, '暗闇で外れた場合にも回避反撃は発動しない');
});

test('初撃・技能準備・障壁・回避反撃の状態は保存後も一致し、旧戦闘の欠損値でも動く', () => {
  const ctx = setup();
  ctx.member.equip.weapon.affixes = { FIRST_HIT: 30, NORMAL_SKILL: 25, ATTACK_HEAL: 10, CRIT_MP: 3 };
  ctx.battle.allies[0].buffs.barrier = [20, 2];
  act(ctx);
  const saved = JSON.parse(JSON.stringify({ game: ctx.game, battle: ctx.battle }));
  const copy = { ...ctx, ...saved, member: saved.game.party[0], enemies: saved.battle.enemies, enemy: saved.battle.enemies[0] };
  act(ctx, 'warrior_p1_s1'); act(copy, 'warrior_p1_s1');
  enemyAct(ctx); enemyAct(copy);
  assert.deepEqual(copy.game, ctx.game);
  assert.deepEqual(copy.battle, ctx.battle);
  const old = setup();
  for (const ally of old.battle.allies) {
    delete ally.firstAttackUsed; delete ally.normalSkillReady; delete ally.evadeCounterRound;
  }
  assert.doesNotThrow(() => act(old));
  assert.doesNotThrow(() => enemyAct(old));
  const fresh = createBattle(ctx.data, ctx.game, { enemies: [makeEnemy(ctx.data, 'goblin', { lv: 20 })], seed: 3 });
  assert.equal(fresh.allies[0].firstAttackUsed, false);
  assert.equal(fresh.allies[0].normalSkillReady, false);
  assert.equal(fresh.allies[0].buffs.barrier, undefined);
});

test('清めの舞は複数味方の対象異常を治し、呪い・石化・衰弱は残り、不正解は治療率が下がる', () => {
  const curable = [...rules.statusEffects.values()].filter((status) => status.cure.split('・').includes('清めの光')).map((status) => status.id);
  assert.ok(curable.includes('poison') && curable.includes('silence') && curable.includes('doom'));
  const prepare = (seed) => {
    const ctx = setup({ job: 'dancer', weapon: 'fan_t1', seed });
    for (const index of [1, 2]) ctx.battle.allies[index].statuses = Object.fromEntries(curable.map((id) => [id, { turns: 3, n: 1 }]));
    ctx.battle.allies[3].statuses = Object.fromEntries(['curse', 'petrify', 'weaken'].map((id) => [id, { turns: 99, n: 1 }]));
    ctx.game.party[3].persist = ['curse', 'petrify', 'weaken'];
    return ctx;
  };
  const correct = prepare(1);
  act(correct, 'dancer_p1_s3');
  for (const index of [1, 2]) assert.deepEqual(correct.battle.allies[index].statuses, {});
  assert.deepEqual(Object.keys(correct.battle.allies[3].statuses), ['curse', 'petrify', 'weaken']);
  assert.deepEqual(correct.game.party[3].persist, ['curse', 'petrify', 'weaken']);
  let treated = 0;
  const attempts = 16;
  for (let seed = 1; seed <= attempts; seed++) {
    const wrong = prepare(seed);
    act(wrong, 'dancer_p1_s3', false);
    treated += curable.length * 2 - Object.keys(wrong.battle.allies[1].statuses).length - Object.keys(wrong.battle.allies[2].statuses).length;
    assert.deepEqual(Object.keys(wrong.battle.allies[3].statuses), ['curse', 'petrify', 'weaken']);
  }
  assert.ok(treated > 0 && treated < curable.length * 2 * attempts * .6,
    '不正解は全回復でも一律失敗でもなく、弱まった効果で異常ごとに治療を判定する');
});

test('魔力の余韻はパッシブ枠へ装備した生存者だけの戦闘後MPを10%回復する', () => {
  const ctx = setup({ job: 'white_mage', weapon: 'staff_t1' });
  const maximum = maxMp(ctx.data, ctx.member);
  ctx.member.mp = 0;
  recoverAfterBattle(ctx.data, ctx.game);
  assert.equal(ctx.member.mp, 0, '覚えていても未装備なら回復しない');
  equipSkill(ctx.data, ctx.member, 'common_mana_afterglow');
  recoverAfterBattle(ctx.data, ctx.game);
  assert.equal(ctx.member.mp, Math.round(maximum * .1));
  ctx.member.mp = maximum - 1;
  recoverAfterBattle(ctx.data, ctx.game);
  assert.equal(ctx.member.mp, maximum, '最大MPを超えない');
  ctx.member.hp = 0; ctx.member.mp = 0;
  recoverAfterBattle(ctx.data, ctx.game);
  assert.equal(ctx.member.mp, 0, '戦闘不能のままでは回復しない');
  ctx.member.hp = 1;
  unequipSkill(ctx.member, 'common_mana_afterglow');
  recoverAfterBattle(ctx.data, ctx.game);
  assert.equal(ctx.member.mp, 0, '枠から外すと効果がなくなる');
});
