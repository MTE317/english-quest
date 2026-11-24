import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../sim/balance.mjs';
import { createNewGame, defaultPartySpecs, normalizeGame } from '../js/game-state.js';
import { GameSession } from '../js/save.js';
import { MemoryStorage } from './helpers.js';
import { returnToTown } from '../js/dungeon.js';
import { unlockJob, offeringRevealed } from '../js/temple.js';
import { availableJobs, changeJob, equipSkill, memberMods } from '../js/growth.js';
import { makeGear, maxMp } from '../js/character.js';
import { createBattle, makeEnemy, actionOptions, nextTurn, prepareQuizAction, setPending, resolvePending, skillMp, collectBattleHits } from '../js/battle.js';
import { unlockAndTrain, OFFERING, PETRIFIER_SKILLS } from '../verification/petrifier/fixtures.mjs';

const data = loadData();
const fresh = () => createNewGame(data, defaultPartySpecs(data));
function context({ seed = 1217071, count = 1, boss = false, affinity = '〇', weapon = 'gun_t1', passive = false } = {}) {
  const game = fresh();
  const m = unlockAndTrain(data, game, 0);
  if (!passive) m.loadout.passives = [];
  m.equip.weapon = weapon ? makeGear(game, weapon) : null;
  const enemies = Array.from({ length: count }, () => {
    const e = makeEnemy(data, 'goblin', { lv: 45, boss });
    e.hp = e.maxHp = 100000;
    e.statusAffinity = { petrify: affinity };
    e.evasion = 0;
    return e;
  });
  const b = createBattle(data, game, { enemies, seed });
  b.round = 1;
  return { game, m, enemies, b };
}
function use(c, id = 'petrifier_shot', correct = true) {
  c.b.turn = { side: 'ally', i: 0 };
  c.b.queue = [{ side: 'ally', i: 1 }];
  setPending(c.b, { type: 'skill', skillId: id, target: 0 }, { wordId: 'test' });
  return collectBattleHits(c.b, () => resolvePending(data, c.game, c.b, correct));
}

test('Dは銃士の成長・適性、独立4技能。既存ID・6人・1024体を維持', () => {
  assert.deepEqual(data.jobsById.get('petrifier').grades, data.jobsById.get('gunner').grades);
  assert.equal(data.jobs.length, 21);
  assert.equal(data.monsters.size, 1024);
  assert.equal(fresh().party.length, 6);
  assert.deepEqual([...data.skills.values()].filter(s => s.job === 'petrifier').map(s => [s.apToLearn, s.cost]), [[0,2],[15,2],[18,2],[45,4]]);
});

test('ボス素材の安全帰還で儀式を発見。全滅では未発見、奉納は必要数だけを消費', () => {
  const s = new GameSession({ storage: new MemoryStorage() });
  s.startNew(fresh());
  const rule = data.jobUnlocks.get('petrifier');
  assert.ok(!availableJobs(data, s.game).some(j => j.id === 'petrifier'));
  s.game.storage.materials.m06_008_mat = 3;
  assert.equal(offeringRevealed(data, s.game, rule), false);
  const enter = () => s.enterDungeon({ dungeonId: 'sand_tomb', state: 'return_point', backpack: { gear: [], materials: { sand_tomb_boss_mat: 1 } }, earned: { xp: 0 } });
  enter(); assert.equal(offeringRevealed(data, s.game, rule), false); s.wipe();
  assert.equal(offeringRevealed(data, s.game, rule), false);
  enter(); returnToTown(data, s);
  assert.equal(offeringRevealed(data, s.game, rule), true);
  assert.throws(() => unlockJob(data, s.game, 'petrifier'), /素材が足りません/);
  assert.equal(s.game.storage.materials.sand_tomb_boss_mat, 1);
  s.game.storage.materials.sand_tomb_boss_mat++;
  unlockJob(data, s.game, 'petrifier');
  assert.deepEqual(s.game.storage.materials, {});
  assert.ok(s.game.unlockedJobs.includes('petrifier'));
});

test('無料転職・AP78、保存再読込・持出し・重複装着禁止・現職限定奥義', () => {
  const game = fresh();
  const m = unlockAndTrain(data, game, 0);
  assert.equal(game.jp, undefined);
  assert.equal(m.ap.petrifier, 0);
  assert.throws(() => equipSkill(data, m, 'petrifier_aim'), /つけている/);
  m.loadout.passives.push('petrifier_aim');
  const storage = new MemoryStorage(), s = new GameSession({ storage }); s.startNew(game);
  const loaded = new GameSession({ storage }); normalizeGame(data, loaded.game);
  const copy = loaded.game.party[0];
  assert.deepEqual(copy.loadout.passives, ['petrifier_aim']);
  assert.equal(memberMods(data, copy).gun_petrify_rate, .2);
  loaded.game.unlockedJobs.push('gunner'); changeJob(data, loaded.game, 0, 'gunner');
  assert.ok(copy.loadout.actions.includes('petrifier_shot'));
  assert.ok(copy.loadout.actions.includes('petrifier_pierce'));
  assert.ok(!copy.loadout.actions.includes('petrifier_volley'));
  assert.throws(() => equipSkill(data, copy, 'petrifier_volley'));
  assert.throws(() => equipSkill(data, fresh().party[0], 'petrifier_shot'), /覚えていない/);
});

test('対象3攻撃だけ主武器の銃が必要。副手銃でも不可、保存済み行動も再確認', () => {
  for (const weapon of ['dagger_t1', 'bow_t1', null]) for (const id of PETRIFIER_SKILLS.filter(id => id !== 'petrifier_aim')) {
    const c = context({ weapon }); c.m.equip.offhand = makeGear(c.game, 'gun_t1');
    assert.match(actionOptions(data, c.game, c.b, 0).skills.find(x => x.skill.id === id).reason, /銃/);
    const mp = c.m.mp; use(c, id); assert.equal(c.m.mp, mp); assert.equal(c.enemies[0].hp, 100000);
  }
  const c = context(); use(c); assert.ok(c.enemies[0].hp < 100000);
});

test('奥義は全体に各1命中と石化判定1回、二刀・追撃付与で増えず、一戦一回', () => {
  const c = context({ count: 3 }); c.m.equip.offhand = makeGear(c.game, 'gun_t1'); c.m.equip.weapon.affixes.EXTRA_HIT = 100;
  const hits = use(c, 'petrifier_volley');
  assert.equal(hits.filter(h => h.target.side === 'enemy').length, 3);
  assert.equal(c.b.log.filter(line => /石化になった|効かなかった/.test(line)).length, 3);
  assert.match(actionOptions(data, c.game, c.b, 0).skills.find(x => x.skill.id === 'petrifier_volley').reason, /もう使った/);
  const hp = c.enemies.map(e => e.hp), mp = c.m.mp;
  use(c, 'petrifier_volley'); assert.deepEqual(c.enemies.map(e => e.hp), hp); assert.equal(c.m.mp, mp);
});

test('ミスで石化判定なし。免疫とボスは石化せず、別技能は土属性・防御無視で攻撃', () => {
  const miss = context(); miss.enemies[0].evasion = 1; use(miss);
  assert.equal(miss.enemies[0].hp, 100000); assert.ok(!miss.b.log.some(s => /石化になった|効かなかった/.test(s)));
  for (const opts of [{ boss: true }, { affinity: '×' }]) {
    const c = context(opts); c.m.equip.weapon.affixes.STATUS_RATE = 10000;
    use(c); assert.equal(c.enemies[0].statuses.petrify, undefined);
    const pierce = context(opts); const hits = use(pierce, 'petrifier_pierce');
    assert.ok(pierce.enemies[0].hp < 100000); assert.equal(pierce.enemies[0].statuses.petrify, undefined);
    assert.ok(!pierce.b.log.some(s => /石化になった|効かなかった/.test(s)));
    assert.ok(hits.length > 0);
  }
});

test('正解/不正解のMP支払いと弱化、石化による勝利・全滅・追加出題停止を維持', () => {
  const good = context(), bad = context(); const mp = good.m.mp;
  use(good, 'petrifier_pierce', true); use(bad, 'petrifier_pierce', false);
  assert.ok(good.enemies[0].hp < bad.enemies[0].hp);
  assert.equal(good.m.mp, mp - skillMp(data, good.m, data.skills.get('petrifier_pierce')));
  assert.equal(bad.m.mp, good.m.mp);
  const win = context(); win.enemies[0].statuses.petrify = { turns: 99 };
  assert.equal(nextTurn(data, win.game, win.b), null); assert.equal(win.b.result, 'win');
  const lose = context(); lose.b.allies.forEach(a => { a.statuses.petrify = { turns: 99 }; });
  assert.equal(nextTurn(data, lose.game, lose.b), null); assert.equal(lose.b.result, 'lose');
  const skip = context(); skip.b.queue = [{ side: 'ally', i: 0 }, { side: 'ally', i: 1 }];
  skip.b.allies[0].statuses.petrify = { turns: 99 };
  assert.equal(nextTurn(data, skip.game, skip.b).i, 1);
  assert.equal(skip.b.pending, null);
});

test('パッシブ・耐性・正答の率と、通常正規化した重複装着が本体JSで成立', async () => {
  const { probes } = await import('../verification/petrifier/probes.mjs');
  assert.ok(probes(256).sourceUnchangedAtCompletion);
});


test('確定した境界: 命中付き銃技だけ石化率が増え、既存の状態専用石化弾は対象外', () => {
  const oldSkill = data.skills.get('gunner_p2_s5');
  assert.equal(oldSkill.kind, 'status');
  assert.deepEqual(oldSkill.effect.st, ['石化', .35]);
  let boosted = 0, oldSuccess = 0;
  for (let i = 0; i < 256; i++) {
    const seed = 1217071 + i * 7919;
    const plain = context({ seed }), passive = context({ seed, passive: true });
    use(plain); use(passive);
    assert.ok(plain.enemies[0].hp < 100000);
    assert.equal(passive.enemies[0].hp, plain.enemies[0].hp);
    const p = !!plain.enemies[0].statuses.petrify, q = !!passive.enemies[0].statuses.petrify;
    assert.ok(!p || q);
    if (!p && q) boosted++;
    const outcomes = [];
    for (const enabled of [false, true]) {
      const c = context({ seed, passive: enabled });
      // 習得済みの持出し技能を使う検証用セーブ。実ユーザーの保存には触れない。
      c.m.learned.push(oldSkill.id);
      c.m.loadout.actions = [oldSkill.id];
      c.enemies[0].evasion = 1;
      assert.equal(actionOptions(data, c.game, c.b, 0).skills.find(x => x.skill.id === oldSkill.id).reason, '');
      use(c, oldSkill.id);
      assert.equal(c.enemies[0].hp, 100000);
      outcomes.push(!!c.enemies[0].statuses.petrify);
    }
    assert.equal(outcomes[0], outcomes[1], `状態専用技能はseed ${seed}でも補正しない`);
    if (outcomes[0]) oldSuccess++;
  }
  assert.ok(boosted > 0, '命中付き銃技には補正が働く');
  assert.ok(oldSuccess > 0 && oldSuccess < 256, '状態専用技は従来の確率判定を行う');
});
