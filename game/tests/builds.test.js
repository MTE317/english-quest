// ビルドの相互作用と、複数ヒット・割合軽減・MP循環の回帰テスト。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGameData, GAME_FILES } from '../js/gamedata.js';
import { withEngineSkillFixtures, equippedGame } from './combat-fixtures.js';
import { makeGear, maxHp, maxMp, computeStats } from '../js/character.js';
import { createBattle, makeEnemy, setPending, resolvePending, nextTurn, enemyIntent, skillMp, fleeRate, actionOptions, rand } from '../js/battle.js';
import { enchantFamilies, enchantCandidates, enchant } from '../js/workshop.js';
import { describeEffect } from '../js/equipment-effects.js';
import { readCsv, readJson } from './helpers.js';

const master = withEngineSkillFixtures(buildGameData(Object.fromEntries(Object.entries(GAME_FILES).map(([key, name]) =>
  [key, name.endsWith('.json') ? readJson(name) : readCsv(name).rows]))));
// 会心・ダメージ幅は比較だけを安定させる。確率・ターン・効果の本体は実エンジンを通す。
const data = { ...master, balance: { ...master.balance, battle_formulas: {
  ...master.balance.battle_formulas, crit_cap: 0, ally_rand: [1, 1], enemy_rand: [1, 1],
} } };

function prepare({ job = 'warrior', weapon, seed = 1, count = 1, boss = false, rules = data } = {}) {
  const game = equippedGame(rules, [job, 'warrior', 'black_mage', 'white_mage', 'thief', 'bard'].map((j) => ({ name: j, job: j, icon: 'x' })));
  const member = game.party[0];
  for (const m of game.party) {
    m.learned = [...rules.skills.keys()]; // 商品の修得導線と切り離した、汎用効果の制御条件。
    m.lv = 20; m.hp = maxHp(rules, m); m.mp = maxMp(rules, m);
  }
  if (weapon) {
    const def = rules.equipment.get(weapon);
    member.equip.weapon = makeGear(game, weapon, { affixes: { ...(def.fixedEffects ?? {}) } });
  }
  member.equip.offhand = null;
  const enemies = Array.from({ length: count }, () => Object.assign(makeEnemy(rules, 'goblin', { lv: 20, boss }), {
    maxHp: 100000, hp: 100000, def: 50, res: 50, str: 40, mag: 40, spd: 0,
    weak: [], resist: [], magicRate: 0, attackElement: null, status: null, evasion: 0,
  }));
  const battle = createBattle(rules, game, { enemies, seed, canFlee: false });
  battle.round = 1;
  return { data: rules, game, member, enemies, enemy: enemies[0], battle };
}
function act(ctx, skillId, correct = true, target = 0) {
  ctx.member.mp = Math.min(ctx.member.mp, maxMp(ctx.data, ctx.member));
  ctx.battle.turn = { side: 'ally', i: 0 };
  setPending(ctx.battle, skillId ? { type: 'skill', skillId, target } : { type: 'attack', target }, {});
  return resolvePending(ctx.data, ctx.game, ctx.battle, correct);
}
function enemyAct(ctx) {
  ctx.battle.turn = null;
  ctx.battle.queue = [{ side: 'enemy', i: 0 }, { side: 'ally', i: 0 }];
  nextTurn(ctx.data, ctx.game, ctx.battle);
}
function solo(ctx) {
  for (const m of ctx.game.party.slice(1)) m.hp = 0;
  ctx.battle.allies[0].statuses.bind = { turns: 99, n: 1 }; // この比較では回避なし
}
function damage(skillId, opts = {}, mutate = () => {}) {
  const ctx = prepare(opts);
  mutate(ctx);
  act(ctx, skillId);
  return { ...ctx, damage: ctx.enemy.maxHp - ctx.enemy.hp };
}

test('固定属性・最適属性・絶対零度が表記どおりの弱点を突く', () => {
  for (const [job, weapon, skill, element] of [
    ['knight', 'hammer_t1', 'knight_p2_s5', 'light'],
    ['white_mage', 'staff_t1', 'white_mage_p3_s5', 'light'],
    ['black_mage', 'tome_t1', 'black_mage_p2_s5', 'ice'],
    ['elementalist', 'staff_t1', 'elementalist_p1_s5', 'water'],
  ]) {
    const plain = damage(skill, { job, weapon });
    const weak = damage(skill, { job, weapon }, ({ enemy }) => { enemy.weak = [element]; enemy.resist = ['slash', 'blunt']; });
    assert.ok(weak.damage > plain.damage * 1.4, `${skill}: ${weak.damage} / ${plain.damage}`);
    assert.ok(weak.battle.log.some((line) => line.includes('弱点！')), skill);
  }
});

test('狙い撃ちの弱点特化・耐性無視・魔法剣の属性置換が実際の威力を変える', () => {
  const normal = damage('hunter_p1_s1', { job: 'hunter', weapon: 'bow_t1' });
  const weak = damage('hunter_p1_s1', { job: 'hunter', weapon: 'bow_t1' }, ({ enemy }) => { enemy.weak = ['pierce']; });
  assert.ok(weak.damage > normal.damage * 2.2, `${weak.damage} / ${normal.damage}`);
  const plainFinal = damage('hunter_p1_s4', { job: 'hunter', weapon: 'bow_t1' });
  const resistedFinal = damage('hunter_p1_s4', { job: 'hunter', weapon: 'bow_t1' }, ({ enemy }) => { enemy.resist = ['pierce']; });
  assert.equal(resistedFinal.damage, plainFinal.damage);
  const ctx = prepare({ job: 'spellblade', weapon: 'sword_t1' });
  ctx.enemy.weak = ['fire']; ctx.enemy.resist = ['slash'];
  act(ctx, 'spellblade_p1_s1');
  act(ctx);
  assert.deepEqual(ctx.game.catalog.affinities.goblin.elements, ['fire']);
  assert.ok(ctx.battle.log.some((line) => line.includes('弱点！')));
});

test('STR強化は能力値に一度だけ掛かり、MAG強化は回復にも有効', () => {
  const plain = damage(undefined);
  const buffed = damage(undefined, {}, ({ battle }) => { battle.allies[0].buffs.str = [.3, 3]; });
  assert.ok(buffed.damage > plain.damage);
  assert.ok(buffed.damage <= Math.ceil(plain.damage * 1.3), `${buffed.damage} / ${plain.damage}`);
  const heal = (buff) => {
    const ctx = prepare({ job: 'white_mage', weapon: 'staff_t1' });
    ctx.member.hp = 1;
    if (buff) ctx.battle.allies[0].buffs.mag = [.3, 3];
    act(ctx, 'white_mage_p1_s1');
    return ctx.member.hp;
  };
  assert.ok(heal(true) > heal(false));
});

test('剣は武器スキルの消費を抑え、大剣は武器スキルの威力を伸ばす', () => {
  const sword = prepare({ weapon: 'sword_t1' });
  const great = prepare({ weapon: 'greatsword_t1' });
  const skill = data.skills.get('warrior_p1_s4');
  assert.ok(skillMp(data, sword.member, skill) < skillMp(data, great.member, skill));
  const bareTraits = { ...data, weaponTypes: new Map(data.weaponTypes) };
  bareTraits.weaponTypes.set('greatsword', { ...data.weaponTypes.get('greatsword'), traits: {} });
  const withTrait = damage('warrior_p1_s4', { weapon: 'greatsword_t1' });
  const withoutTrait = damage('warrior_p1_s4', { weapon: 'greatsword_t1', rules: bareTraits });
  assert.ok(withTrait.damage >= withoutTrait.damage * 1.09);
});

test('毒特化は付与者の強化を継続ダメージに反映し、ボスへの再付与で確率が半減しない', () => {
  const ctx = prepare({ job: 'apothecary', weapon: 'craft_dagger_s2', boss: true });
  ctx.member.loadout.passives = ['apothecary_p2_s2', 'hexer_p2_s4'];
  ctx.member.equip.weapon.affixes.STATUS_RATE = 100;
  ctx.member.equip.weapon.affixes.DOT_POWER = 30;
  ctx.battle.round = 2;
  for (let seed = 1; seed <= 20 && !ctx.enemy.statuses.poison; seed++) {
    ctx.battle.rng = seed;
    act(ctx, 'apothecary_p2_s1');
  }
  assert.ok(ctx.enemy.statuses.poison);
  assert.equal(ctx.enemy.statuses.poison.potency, 1.75);
  ctx.enemy.statusHits.poison = 30;
  delete ctx.enemy.statuses.poison;
  let reapplied = 0;
  for (let seed = 1; seed <= 20; seed++) {
    ctx.battle.rng = seed; ctx.member.mp = maxMp(data, ctx.member);
    act(ctx, 'apothecary_p2_s1');
    if (ctx.enemy.statuses.poison) reapplied++;
    delete ctx.enemy.statuses.poison;
  }
  assert.ok(reapplied >= 14, `ボス毒再付与 ${reapplied}/20`);
  ctx.enemy.statuses.poison = { turns: 3, n: 1, potency: 1.75, actor: 0 };
  const before = ctx.enemy.hp;
  enemyAct(ctx);
  assert.equal(before - ctx.enemy.hp, Math.round(100000 * .05 * (data.balance.battle_formulas?.boss_dot_mul ?? .65) * 1.75));
});

test('個別の毒付与率と継続ダメージは毒だけに働く', () => {
  const ctx = prepare({ job: 'apothecary', weapon: 'craft_dagger_s2' });
  ctx.member.equip.weapon.affixes = {};
  ctx.member.equip.weapon.enchants = [
    { stat: 'STATUS_RATE:poison', value: 100 }, { stat: 'DOT_POWER:poison', value: 30 },
  ];
  for (let seed = 1; seed <= 20 && !ctx.enemy.statuses.poison; seed++) {
    ctx.battle.rng = seed;
    act(ctx, 'apothecary_p2_s1');
  }
  assert.ok(ctx.enemy.statuses.poison);
  assert.equal(ctx.enemy.statuses.poison.potency, 1.3);
  assert.equal(ctx.member.equip.weapon.enchants[0].stat, 'STATUS_RATE:poison');
});

test('指定した氷属性の攻撃強化は氷魔法だけに働く', () => {
  const base = damage('black_mage_p2_s5', { job: 'black_mage', weapon: 'tome_t1' }).damage;
  const boosted = damage('black_mage_p2_s5', { job: 'black_mage', weapon: 'tome_t1' }, (ctx) => {
    ctx.member.equip.accessory1 = makeGear(ctx.game, 'ring_t1', { affixes: { 'ELEM_DMG:ice': 20 } });
  }).damage;
  const unrelated = damage('black_mage_p2_s5', { job: 'black_mage', weapon: 'tome_t1' }, (ctx) => {
    ctx.member.equip.accessory1 = makeGear(ctx.game, 'ring_t1', { affixes: { 'ELEM_DMG:fire': 20 } });
  }).damage;
  assert.ok(boosted > base);
  assert.equal(unrelated, base);
});

test('毒・猛毒・出血の重ね掛けは割合上限内で、継続ダメージの撃破にも熟練が付く', () => {
  const ctx = prepare({ job: 'warrior', weapon: 'scythe_t1', boss: true });
  ctx.enemy.statuses = Object.fromEntries(['poison', 'toxic', 'bleed', 'burn'].map((id) => [id, { turns: 3, n: 3, potency: 2, actor: 0 }]));
  enemyAct(ctx);
  assert.equal(100000 - ctx.enemy.hp, Math.round(100000 * (data.balance.battle_formulas?.dot_tick_cap ?? .12)));
  ctx.enemy.hp = 1;
  const before = ctx.member.mastery?.scythe ?? 0;
  enemyAct(ctx);
  assert.equal(ctx.enemy.hp, 0);
  assert.ok((ctx.member.mastery?.scythe ?? 0) > before, '継続ダメージの撃破が熟練になる');
});

test('ボスの行動封じには再拘束の猶予があり、毒・出血はその影響を受けない', () => {
  const ctx = prepare({ job: 'knight', weapon: 'hammer_t1', boss: true });
  ctx.enemy.controlGuardUntil = 4;
  ctx.battle.round = 3;
  ctx.member.equip.weapon.affixes.STATUS_RATE = 1000;
  for (let seed = 1; seed <= 10; seed++) {
    ctx.battle.rng = seed; ctx.member.mp = maxMp(data, ctx.member);
    act(ctx, 'knight_p3_s1');
    assert.equal(ctx.enemy.statuses.stun, undefined);
  }
  for (let seed = 1; seed <= 10 && !ctx.enemy.statuses.poison; seed++) {
    ctx.battle.rng = seed; ctx.member.mp = maxMp(data, ctx.member);
    act(ctx, 'apothecary_p2_s1');
  }
  assert.ok(ctx.enemy.statuses.poison);
});

test('全体・二刀攻撃の吸血とMP回復には1行動上限があり、不正解ではMPを作れない', () => {
  for (const [job, weapon, offhand] of [['dancer', 'whip_t1', null], ['thief', 'dagger_t1', 'katana_t1']]) {
    const ctx = prepare({ job, weapon, count: 4 });
    ctx.member.hp = 1; ctx.member.mp = 0;
    ctx.member.equip.weapon.affixes = { STR: 10000, LIFESTEAL: 1000, MP_ON_HIT: 1000 };
    if (offhand) ctx.member.equip.offhand = makeGear(ctx.game, offhand);
    act(ctx);
    const formula = data.balance.battle_formulas ?? {};
    assert.equal(ctx.member.hp - 1, Math.floor(maxHp(data, ctx.member) * (formula.lifesteal_action_cap ?? .15)));
    const mp = maxMp(data, ctx.member);
    assert.equal(ctx.member.mp, Math.ceil(mp * (formula.on_hit_mp_cap ?? .05)) + Math.ceil(mp * (data.balance.mp_rules.normal_attack_regen_rate ?? 0)));
    ctx.member.mp = 0;
    act(ctx, undefined, false);
    assert.equal(ctx.member.mp, 0);
  }
});

test('サブ武器の状態異常はサブ通常攻撃の命中で発動し、武器スキルには追加されない', () => {
  let triggered = false;
  for (let seed = 1; seed <= 20; seed++) {
    const ctx = prepare({ job: 'thief', weapon: 'katana_t1', seed });
    ctx.member.equip.offhand = makeGear(ctx.game, 'craft_dagger_s2', { affixes: { 'STATUS_ON_HIT:poison': 50 } });
    act(ctx, 'thief_p1_s1');
    assert.equal(ctx.enemy.statuses.poison, undefined);
    act(ctx);
    triggered ||= Boolean(ctx.enemy.statuses.poison);
  }
  assert.ok(triggered);
});

test('状態・弱体特効は魔法にも乗り、外したときには元の威力へ戻る', () => {
  const plain = damage('hexer_p2_s1', { job: 'hexer', weapon: 'tome_t1' });
  const bonus = damage('hexer_p2_s1', { job: 'hexer', weapon: 'tome_t1' }, ({ member, enemy }) => {
    member.equip.weapon.affixes.VS_DEBUFFED = 25;
    enemy.debuffs.def = [.2, 3];
  });
  const noStatus = damage('hexer_p2_s1', { job: 'hexer', weapon: 'tome_t1' }, ({ member }) => {
    member.equip.weapon.affixes.VS_DEBUFFED = 25;
  });
  assert.ok(bonus.damage > plain.damage * 1.2);
  assert.equal(noStatus.damage, plain.damage);
});

test('励ましは他の味方へのMP移譲、吸魔は使用MPまでの回収となり、MPが純増しない', () => {
  for (const target of [1]) {
    const ctx = prepare({ job: 'bard' });
    ctx.member.mp = maxMp(data, ctx.member) - 5;
    if (target) ctx.game.party[target].mp = 0;
    const total = () => ctx.game.party.reduce((sum, m) => sum + m.mp, 0);
    const before = total();
    const cost = skillMp(data, ctx.member, data.skills.get('bard_p3_s1'));
    act(ctx, 'bard_p3_s1', true, target);
    assert.equal(total(), before - cost);
  }
  const self = prepare({ job: 'bard' });
  const beforeSelf = self.member.mp;
  act(self, 'bard_p3_s1', true, 0);
  assert.equal(self.member.mp, beforeSelf, '自分へのMP移譲は実行せず、消費も回復もしない');
  const ctx = prepare({ job: 'hexer', weapon: 'tome_t1' });
  ctx.member.equip.weapon.affixes.MAG = 10000;
  const before = ctx.member.mp;
  act(ctx, 'hexer_p2_s3');
  assert.ok(ctx.member.mp <= before);
});

test('回避・状態耐性・会心と複合軽減に上限があり、耐性対策でも被害が0にならない', () => {
  const ctx = prepare({ rules: master });
  ctx.member.equip.weapon.affixes = { CRT: 10000, EVA: 10000, STATUS_RES: 10000 };
  const st = computeStats(master, ctx.member);
  const caps = master.balance.battle_formulas ?? {};
  assert.equal(st.crit, caps.crit_cap ?? .85);
  assert.equal(st.evasion, caps.evasion_cap ?? .6);
  assert.equal(st.statusResist, caps.status_resist_cap ?? .9);
  const hit = (resistant) => {
    const c = prepare(); solo(c);
    c.enemy.magicRate = 1; c.enemy.mag = 150; c.enemy.attackElement = 'fire';
    if (resistant) c.member.equip.weapon.affixes = { 'ELEM_RES:fire': 1000, MAGIC_CUT: 1000 };
    const before = c.member.hp;
    enemyAct(c);
    return before - c.member.hp;
  };
  const plain = hit(false); const defended = hit(true);
  assert.ok(defended > 0 && defended < plain / 2);
  assert.ok(defended >= Math.floor(plain * (caps.minimum_damage_share ?? .08)));
});

test('反撃は物理被弾のみで追加効果を発生せず、不正解の構えは確定反撃にならない', () => {
  let wrongCounters = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const ctx = prepare({ job: 'knight', weapon: 'hammer_t1', seed }); solo(ctx);
    ctx.member.equip.weapon.affixes = { LIFESTEAL: 1000, MP_ON_HIT: 1000, EXTRA_HIT: 1000, 'STATUS_ON_HIT:poison': 100 };
    act(ctx, 'knight_p3_s3', false);
    const mp = ctx.member.mp;
    enemyAct(ctx);
    wrongCounters += Number(ctx.enemy.hp < ctx.enemy.maxHp);
    assert.equal(ctx.member.mp, mp);
    assert.equal(ctx.enemy.statuses.poison, undefined);
    assert.equal(ctx.enemy.statuses.stun, undefined);
    assert.ok(!ctx.battle.log.some((line) => line.includes('吸収した') || line.includes('追加攻撃')));
  }
  assert.ok(wrongCounters > 0 && wrongCounters < 25, `不正解時 ${wrongCounters}/30`);
  const magical = prepare({ job: 'knight', weapon: 'hammer_t1' }); solo(magical);
  magical.enemy.magicRate = 1;
  act(magical, 'knight_p3_s3'); enemyAct(magical);
  assert.equal(magical.enemy.hp, magical.enemy.maxHp);
});

test('扇・全体支援付与・舞の余韻が重なり、弱い強化では強い強化を上書きしない', () => {
  const ctx = prepare({ job: 'dancer', weapon: 'craft_fan_s6' });
  ctx.member.loadout.passives = ['dancer_p1_s2'];
  act(ctx, 'dancer_p1_s5');
  const speed = ctx.battle.partyBuffs.spd[0];
  assert.ok(speed > .2);
  assert.equal(ctx.battle.partyBuffs.spd[1], 5);
  ctx.member.mp = maxMp(data, ctx.member);
  act(ctx, 'dancer_p1_s5', false);
  assert.equal(ctx.battle.partyBuffs.spd[0], speed);
  assert.equal(ctx.battle.partyBuffs.spd[1], 5);
});

test('ボスの3巡ごとの予告と全体攻撃はデータで決まり、封印・恐怖で大技を抑えられる', () => {
  const ctx = prepare({ boss: true });
  const every = data.balance.boss_patterns?.sweep_every ?? 3;
  assert.equal(enemyIntent(data, ctx.enemy, every - 1).warning, true);
  assert.equal(enemyIntent(data, ctx.enemy, every).sweep, true);
  for (const ally of ctx.battle.allies) ally.statuses.bind = { turns: 99, n: 1 };
  const before = ctx.game.party.map((m) => m.hp);
  ctx.battle.round = every;
  enemyAct(ctx);
  assert.ok(ctx.game.party.every((m, i) => m.hp < before[i]), '全員が全体攻撃の対象になる');
  ctx.enemy.statuses.seal = { turns: 2, n: 1 };
  assert.equal(enemyIntent(data, ctx.enemy, every).sweep, false);
  delete ctx.enemy.statuses.seal;
  ctx.enemy.statuses.fear = { turns: 2, n: 1 };
  assert.equal(enemyIntent(data, ctx.enemy, every).sweep, false);
});

test('ビルド向けエンチャントが実在素材で選べ、付与結果も日本語で読める', () => {
  const materials = [...master.materials.values()];
  for (const [id, family] of [
    ['craft_dagger_s2', 'DOT_POWER:poison'], ['craft_dagger_s2', 'STATUS_RATE:poison'],
    ['craft_katana_s2', 'CRIT_DMG'], ['craft_bow_s2', 'WEAK_DMG'],
    ['craft_heavy_body_s3', 'COUNTER'], ['craft_heavy_body_s3', 'ELEM_RES:fire'],
    ['iron_fan', 'PARTY_BUFF_POWER'], ['craft_staff_s2', 'HEAL_POWER'],
    ['craft_staff_s2', 'MP_SAVE'], ['craft_staff_s2', 'MP_ON_HIT'],
  ]) {
    const ctx = prepare({ rules: master });
    const def = master.equipment.get(id);
    const material = materials.find((m) => enchantFamilies(master, def, m).includes(family));
    assert.ok(material, `${id} / ${family} の素材`);
    const gear = makeGear(ctx.game, id); gear.crafted = true;
    ctx.game.storage.materials.enchant_powder = 10;
    const candidates = enchantCandidates(master, def);
    const index = candidates.indexOf(family);
    assert.ok(index >= 0);
    const msg = enchant(master, ctx.game, gear, 0, '', 1, () => (index + 0.01) / candidates.length);
    assert.equal(gear.enchants[0].stat, family);
    assert.ok(!msg.includes(family), msg);
    assert.ok(describeEffect(master, family, gear.enchants[0].value).length > 0);
  }
});

test('逃走率付与は行動者だけに反映し、表示と実際の逃走判定・10〜95%上限を一致させる', () => {
  const rules = { ...data, balance: { ...data.balance, battle_formulas: { ...data.balance.battle_formulas, flee: '0.3' } } };
  const ctx = prepare({ rules }); ctx.battle.canFlee = true;
  ctx.member.equip.cloak = makeGear(ctx.game, 'cloak_t1', { affixes: { FLEE: 20 } });
  assert.equal(actionOptions(rules, ctx.game, ctx.battle, 0).flee.rate, .5);
  assert.equal(actionOptions(rules, ctx.game, ctx.battle, 1).flee.rate, .3);
  ctx.battle.turn = { side: 'ally', i: 0 };
  assert.equal(fleeRate(rules, ctx.game, ctx.battle), .5);
  let seed = 1;
  while (seed < 1000) {
    const value = rand({ rng: seed });
    if (value > .3 && value < .5) break;
    seed++;
  }
  assert.ok(seed < 1000);
  for (const actor of [0, 1]) {
    ctx.battle.rng = seed; ctx.battle.result = null;
    ctx.battle.turn = { side: 'ally', i: actor };
    setPending(ctx.battle, { type: 'flee' }, {});
    resolvePending(rules, ctx.game, ctx.battle, true);
    assert.equal(ctx.battle.result, actor === 0 ? 'fled' : null);
  }
  ctx.member.equip.cloak.affixes.FLEE = 999;
  assert.equal(fleeRate(rules, ctx.game, ctx.battle, 0), .95);
  const difficult = { ...rules, balance: { ...rules.balance, battle_formulas: { ...rules.balance.battle_formulas, flee: '-1' } } };
  assert.equal(fleeRate(difficult, ctx.game, ctx.battle, 1), .1);
  ctx.enemy.boss = true;
  assert.equal(fleeRate(rules, ctx.game, ctx.battle, 0), .95, 'ボスも通常戦と同じ逃走上限を使う');
  ctx.enemy.boss = false; ctx.battle.allies[0].statuses.bind = { turns: 2 };
  assert.equal(fleeRate(rules, ctx.game, ctx.battle, 0), 0);
});

