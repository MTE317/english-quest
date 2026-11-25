import test from 'node:test';
import assert from 'node:assert/strict';
import { realGameData } from './helpers.js';
import { createNewGame, defaultPartySpecs } from '../js/game-state.js';
import { makeGear, maxHp, maxMp } from '../js/character.js';
import { createBattle, makeEnemy, setPending, resolvePending, actionOptions, skillMp, battleStats, nextTurn } from '../js/battle.js';
import { masterBuff } from '../js/job-combat.js';

function fixture(job = 'warrior', weapon = null, seed = 51) {
  const data = realGameData();
  const specs = defaultPartySpecs(data); specs[0].job = job;
  const game = createNewGame(data, specs);
  for (const member of game.party) { member.lv = 10; member.hp = maxHp(data, member); member.mp = maxMp(data, member); }
  const member = game.party[0];
  if (weapon) {
    const def = [...data.equipment.values()].filter(item => item.slot === 'weapon' && item.kind === weapon && !item.unique)
      .sort((a, b) => a.itemLv - b.itemLv)[0];
    member.equip.weapon = makeGear(game, def.id);
  }
  const enemy = makeEnemy(data, 'goblin', { lv: 1 });
  Object.assign(enemy, { hp: 1e7, maxHp: 1e7, def: 40, res: 40, spd: 0, weak: [], strongWeak: [], resist: [], immune: [], statusAffinity: {}, evasion: 0 });
  const battle = createBattle(data, game, { enemies: [enemy], seed }); battle.round = 1;
  return { data, game, battle, member, enemy };
}
function learn(ctx, id, { level = 1, passive = false } = {}) {
  const { member, data } = ctx;
  member.learned = [...new Set([...member.learned, id])];
  member.skillLevels ??= {}; member.skillLevels[id] = level;
  if (data.skills.get(id).isFinal) member.loadout.ultimate = id;
  else if (passive) member.loadout.passives.push(id);
  else member.loadout.actions.push(id);
}
function act(ctx, actor = 0, skillId = null, target = 0, extra = {}) {
  const { data, game, battle } = ctx;
  battle.turn = { side: 'ally', i: actor, bleedProcessed: true };
  setPending(battle, skillId ? { type: 'skill', skillId, target, ...extra } : { type: 'attack', target }, {});
  resolvePending(data, game, battle, true);
}

test('一般魔法とSTR無属性気功には銃の物理武器威力を加算しない', () => {
  for (const [job, id] of [['black_mage', 'black_mage_A01'], ['monk', 'monk_A03']]) {
    const low = fixture(job, 'gun'), high = fixture(job, 'gun');
    for (const ctx of [low, high]) learn(ctx, id);
    high.member.equip.weapon.enh = 100;
    act(low, 0, id); act(high, 0, id);
    assert.equal(low.enemy.hp, high.enemy.hp, id);
  }
});

test('自分への強化は付与した行動で減らず、次の2行動終了で消える', () => {
  const ctx = fixture(); learn(ctx, 'warrior_A08');
  act(ctx, 0, 'warrior_A08');
  assert.equal(ctx.battle.allies[0].masterEffects.warrior_A08.remaining, 2);
  act(ctx); assert.equal(ctx.battle.allies[0].masterEffects.warrior_A08.remaining, 1);
  act(ctx); assert.equal(ctx.battle.allies[0].masterEffects.warrior_A08, undefined);
});

test('指定護衛の期間は護衛対象の行動機会で数える', () => {
  const ctx = fixture('knight'); learn(ctx, 'knight_A01');
  act(ctx, 0, 'knight_A01', 1);
  act(ctx, 0); assert.equal(ctx.battle.allies[0].masterCover.remaining, 2);
  act(ctx, 1); assert.equal(ctx.battle.allies[0].masterCover.remaining, 1);
  act(ctx, 1); assert.equal(ctx.battle.allies[0].masterCover, undefined);
});

test('武闘家は異なる通常武器技で連携し、同じ技では連携を戻す', () => {
  const ctx = fixture('monk', 'fist');
  learn(ctx, 'monk_A01'); learn(ctx, 'monk_A02'); learn(ctx, 'monk_P01', { passive: true });
  act(ctx, 0, 'monk_A01'); assert.equal(ctx.battle.allies[0].comboStage, 0);
  act(ctx, 0, 'monk_A02'); assert.equal(ctx.battle.allies[0].comboStage, 1);
  act(ctx, 0, 'monk_A01'); assert.equal(ctx.battle.allies[0].comboStage, 2);
  act(ctx, 0, 'monk_A01'); assert.equal(ctx.battle.allies[0].comboStage, 0);
});

test('歌は職業だけでは発動せず、別曲を習得して使うと併用できる', () => {
  const ctx = fixture('bard'); learn(ctx, 'bard_A01'); learn(ctx, 'bard_A02');
  assert.equal(masterBuff(ctx.data, ctx.game, ctx.battle, 1, 'str'), 0);
  act(ctx, 0, 'bard_A01'); act(ctx, 0, 'bard_A02');
  assert.ok(masterBuff(ctx.data, ctx.game, ctx.battle, 1, 'str') > .1);
  assert.ok(masterBuff(ctx.data, ctx.game, ctx.battle, 1, 'def') > .12);
  assert.deepEqual(ctx.battle.partyBuffs, {});
  assert.equal(Object.keys(ctx.battle.allies[1].masterEffects).length, 2);
});

test('白魔道士の初級治療は対象一覧だけを解除し、恐怖を残す', () => {
  const ctx = fixture('white_mage'); learn(ctx, 'white_mage_A03');
  ctx.battle.allies[1].statuses = { poison: { turns: 3 }, fear: { turns: 3 }, blind: { turns: 3 } };
  act(ctx, 0, 'white_mage_A03', 1);
  assert.deepEqual(Object.keys(ctx.battle.allies[1].statuses), ['fear']);
});

test('沈黙は魔法と新しい歌を止め、武闘家の非魔法治療を止めない', () => {
  const ctx = fixture('bard'); learn(ctx, 'bard_A01'); learn(ctx, 'white_mage_A05'); learn(ctx, 'monk_A08');
  ctx.battle.allies[0].statuses.silence = { turns: 2 };
  const reasons = Object.fromEntries(actionOptions(ctx.data, ctx.game, ctx.battle, 0).skills.map(entry => [entry.skill.id, entry.reason]));
  assert.match(reasons.bard_A01, /沈黙/);
  assert.match(reasons.white_mage_A05, /沈黙/);
  assert.equal(reasons.monk_A08, '');
});

test('奥義はゲージ満タンを要求し、使用自体ではゲージを再獲得しない', () => {
  const ctx = fixture('warrior', 'sword'); learn(ctx, 'warrior_U01');
  assert.match(actionOptions(ctx.data, ctx.game, ctx.battle, 0).ultimate.reason, /ゲージ/);
  ctx.member.ultimateGauge = 100;
  act(ctx, 0, 'warrior_U01');
  assert.equal(ctx.member.ultimateGauge, 0);
  assert.ok(ctx.enemy.hp < ctx.enemy.maxHp);
  act(ctx); assert.equal(ctx.member.ultimateGauge, 20);
});

test('魔力集中は選択した追加MPを1回だけ消費し、同じ回答で魔法を強化する', () => {
  const normal = fixture('black_mage'), boosted = fixture('black_mage');
  for (const ctx of [normal, boosted]) { learn(ctx, 'black_mage_A01'); learn(ctx, 'black_mage_P01', { passive: true }); }
  const before = normal.member.mp;
  act(normal, 0, 'black_mage_A01'); act(boosted, 0, 'black_mage_A01', 0, { boost: true });
  assert.equal(normal.member.mp - boosted.member.mp, 6);
  assert.ok(boosted.enemy.hp < normal.enemy.hp);
  assert.equal(normal.member.ultimateGauge, boosted.member.ultimateGauge);
  assert.equal(before - normal.member.mp, skillMp(normal.data, normal.member, normal.data.skills.get('black_mage_A01')));
});

test('狩人の罠は装備なしで設置でき、対象の次の行動機会に1回だけ発動する', () => {
  const ctx = fixture('hunter'); learn(ctx, 'hunter_A07');
  act(ctx, 0, 'hunter_A07'); assert.equal(ctx.enemy.hp, ctx.enemy.maxHp);
  ctx.battle.queue = [{ side: 'enemy', i: 0 }, { side: 'ally', i: 1 }];
  nextTurn(ctx.data, ctx.game, ctx.battle);
  assert.ok(ctx.enemy.hp < ctx.enemy.maxHp);
  assert.equal(ctx.battle.masterTraps.length, 0);
});

test('白魔道士の奥義は選んだ1人だけを蘇生し、蘇生対象へ全体回復を重ねない', () => {
  const ctx = fixture('white_mage'); learn(ctx, 'white_mage_U01'); ctx.member.ultimateGauge = 100;
  ctx.game.party[1].hp = 0; ctx.game.party[2].hp = 0;
  ctx.game.party[3].hp = 1; ctx.battle.allies[3].statuses.poison = { turns: 3 };
  act(ctx, 0, 'white_mage_U01', 2);
  assert.equal(ctx.game.party[1].hp, 0);
  assert.equal(ctx.game.party[2].hp, Math.floor(maxHp(ctx.data, ctx.game.party[2]) * .7));
  assert.ok(ctx.game.party[3].hp > 1);
  assert.equal(ctx.battle.allies[3].statuses.poison, undefined);
});

test('全体魔法で新しく与えた火傷は、その同じ行動の後続対象への条件特効に使わない', () => {
  const normal = fixture('black_mage'), conditional = fixture('black_mage');
  for (const ctx of [normal, conditional]) {
    const skill = ctx.data.skills.get('black_mage_A04');
    ctx.data.skills.set(skill.id, { ...skill, effect: { ...skill.effect, st: ['burn', 1] } });
    learn(ctx, skill.id); ctx.battle.enemies.push(structuredClone(ctx.enemy));
  }
  learn(conditional, 'black_mage_P03', { passive: true });
  act(normal, 0, 'black_mage_A04'); act(conditional, 0, 'black_mage_A04');
  assert.ok(normal.battle.enemies[0].statuses.burn);
  assert.deepEqual(conditional.battle.enemies.map(e => e.hp), normal.battle.enemies.map(e => e.hp));
});

test('罠の威力は銃の強化値や武器の通常連撃から独立する', () => {
  const low = fixture('hunter', 'gun'), high = fixture('hunter', 'gun');
  high.member.equip.weapon.enh = 100;
  for (const ctx of [low, high]) {
    learn(ctx, 'hunter_A07'); act(ctx, 0, 'hunter_A07');
    ctx.battle.queue = [{ side: 'enemy', i: 0 }, { side: 'ally', i: 1 }];
    nextTurn(ctx.data, ctx.game, ctx.battle);
  }
  assert.equal(low.enemy.hp, high.enemy.hp);
});

test('反撃は現在の連携段階を利用した通常アクティブには数えない', () => {
  const zero = fixture('monk', 'fist'), staged = fixture('monk', 'fist');
  for (const ctx of [zero, staged]) {
    learn(ctx, 'monk_A05'); learn(ctx, 'monk_P01', { passive: true });
    act(ctx, 0, 'monk_A05');
    ctx.enemy.statuses.taunt = { turns: 2, actor: 0 };
    ctx.enemy.magicRate = 0; ctx.enemy.str = 5;
    ctx.battle.allies[0].statuses.bind = { turns: 99 };
    ctx.battle.queue = [{ side: 'enemy', i: 0 }, { side: 'ally', i: 1 }];
  }
  staged.battle.allies[0].comboStage = 2;
  nextTurn(zero.data, zero.game, zero.battle); nextTurn(staged.data, staged.game, staged.battle);
  assert.ok(zero.enemy.hp < zero.enemy.maxHp);
  assert.equal(staged.enemy.hp, zero.enemy.hp);
});

test('剣の節約と装備の節約を併用しても共通のMP軽減上限を超えない', () => {
  const ctx = fixture('warrior', 'sword'); learn(ctx, 'warrior_A01');
  ctx.member.equip.weapon.affixes.MP_SAVE = 50;
  const skill = ctx.data.skills.get('warrior_A01');
  const base = skill.mp * (1 + (ctx.data.balance.mp_rules?.skill_mp_per_lv ?? 0) * (ctx.member.lv - 1));
  assert.ok(skillMp(ctx.data, ctx.member, skill) >= Math.ceil(base * .5));
});

test('反撃の構えは自発行動のない睡眠中でも2回の行動機会で消える', () => {
  const ctx = fixture('knight'); learn(ctx, 'knight_A04'); act(ctx, 0, 'knight_A04');
  ctx.battle.allies[0].statuses.sleep = { turns: 10 };
  ctx.battle.queue = [{ side: 'ally', i: 0 }, { side: 'ally', i: 0 }, { side: 'ally', i: 1 }];
  nextTurn(ctx.data, ctx.game, ctx.battle);
  assert.equal(ctx.battle.allies[0].masterCounter, undefined);
});

test('技能の反撃と装備の反撃は同じ1巡1回の上限を共有する', () => {
  const ctx = fixture('monk', 'fist'); learn(ctx, 'monk_A05');
  ctx.member.equip.weapon.affixes.COUNTER = 100;
  ctx.data.balance.battle_formulas.counter_affix_cap = 1;
  act(ctx, 0, 'monk_A05');
  ctx.battle.allies[0].statuses.bind = { turns: 99 };
  ctx.enemy.statuses.taunt = { turns: 3, actor: 0 }; ctx.enemy.str = 1;
  ctx.battle.queue = [{ side: 'enemy', i: 0 }, { side: 'enemy', i: 0 }, { side: 'ally', i: 1 }];
  nextTurn(ctx.data, ctx.game, ctx.battle);
  assert.equal(ctx.battle.log.filter(line => line.includes('の反撃！')).length, 1);
});
