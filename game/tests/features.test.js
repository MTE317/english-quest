import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGameData, GAME_FILES } from '../js/gamedata.js';
import { createNewGame, normalizeGame } from '../js/game-state.js';
import { GameSession } from '../js/save.js';
import { makeEnemy, createBattle, setPending, resolvePending, skillMp } from '../js/battle.js';
import { makeGear } from '../js/character.js';
import { Scheduler } from '../js/srs.js';
import { recordChant, nextChant } from '../js/chant.js';
import { changeJob } from '../js/growth.js';
import { craft, enhance, brew, dismantle, facilityUpgrade } from '../js/workshop.js';
import { borrow, repayLoan } from '../js/town.js';
import { unlockJob } from '../js/temple.js';
import { makeEncounter, monsterPool } from '../js/encounter.js';
import { makePracticeQuestion, DIRECTION } from '../js/quiz.js';
import { MemoryStorage, T0, readCsv, readJson, realLexicon } from './helpers.js';

const data = buildGameData(Object.fromEntries(Object.entries(GAME_FILES).map(([key, name]) =>
  [key, name.endsWith('.json') ? readJson(name) : readCsv(name).rows])));
const specs = ['warrior', 'knight', 'black_mage', 'white_mage', 'thief', 'bard'].map((job) => ({ name: job, job, icon: 'x' }));
const game = () => createNewGame(data, specs);

test('通常攻撃のMP回復は正解のみ。スキルの消費はレベルで変わる', () => {
  const g = game();
  const m = g.party[0];
  const b = createBattle(data, g, { enemies: [makeEnemy(data, 'slime', { lv: 3 })], seed: 12 });
  m.mp = 0;
  for (const correct of [false, true]) {
    b.turn = { side: 'ally', i: 0 };
    setPending(b, { type: 'attack', target: 0 }, {});
    resolvePending(data, g, b, correct);
    assert.equal(m.mp > 0, correct);
  }
  const skill = [...data.skills.values()].find((s) => s.job === m.job && s.mp > 0);
  assert.equal(skillMp(data, m, skill), skill.mp);
  assert.ok(skillMp(data, { ...m, lv: 99 }, skill) > skill.mp);
});

test('英作文の○△×はSRSを更新し、転職JPは発生せず、全滅後も学習履歴が残る', () => {
  const config = readJson('chant.json');
  const sch = new Scheduler(config);
  const mem = new MemoryStorage();
  const session = new GameSession({ storage: mem });
  session.startNew(game());
  const sentences = [{ id: 'a' }, { id: 'b' }];
  assert.equal(nextChant(session.game, config, sch, sch.dayOf(T0), sentences, sentences, new Set()).id, 'a');
  assert.ok(recordChant(session.game, config, sch, T0, 'a', 't').s > 0);
  assert.ok(recordChant(session.game, config, sch, T0, 'b', 'x').s > 0);
  assert.notEqual(session.game.chants.records.a.s, session.game.chants.records.b.s);
  assert.equal(session.game.jp, undefined);
  session.save();
  session.enterDungeon();
  session.wipe();
  const loaded = new GameSession({ storage: mem }).game;
  assert.ok(loaded.chants.records.a);
  assert.equal(loaded.jp, undefined);
  session.deleteSave();
  const newSession = new GameSession({ storage: mem });
  newSession.startNew(game());
  assert.ok(newSession.game.chants.records.a);
  newSession.deleteSave({ includeLearning: true });
  newSession.startNew(game());
  assert.equal(newSession.game.chants, undefined);
  const gold = loaded.gold;
  changeJob(data, loaded, 0, 'black_mage');
  assert.equal(loaded.gold, gold);
});

test('制作、分解、強化、調合と施設投資が在庫や資金に反映される', () => {
  const g = game();
  g.gold = 10000;
  g.rank = 'D';
  g.storage.materials = { goblin_mat: 3, cave_rat_mat: 8 };
  facilityUpgrade(data, g, 'workshop');
  assert.equal(g.facilities.workshop, 2);
  craft(data, g, data.equipment.get('iron_sword'));
  const gear = g.storage.gear.find((entry) => entry.id === 'iron_sword' && entry.crafted);
  assert.equal(gear.crafted, true);
  const dummy = makeGear(g, 'sword_t1');
  g.storage.gear.push(dummy);
  dismantle(data, g, dummy);
  assert.equal(g.storage.materials.enhancement_stone, 1);
  enhance(data, g, gear, () => 0);
  assert.equal(gear.enh, 1);
  assert.equal(g.storage.materials.enhancement_stone, undefined);
  const recipe = data.alchemyRecipes.find((r) => r.result === 'buff_str_1');
  brew(data, g, recipe);
  assert.equal(g.items[recipe.result], Number(recipe.qty));
  const money = g.gold;
  borrow(data, g, 30);
  repayLoan(g, 20);
  assert.equal(g.loan, 10);
  assert.equal(g.gold, money + 10);
});

test('技能準備中の追加職には素材を消費しない', () => {
  const g = game();
  g.storage.materials = { poison_spider_mat: 4, skeleton_mat: 3 };
  const before = structuredClone(g.storage.materials);
  assert.throws(() => unlockJob(data, g, 'apothecary'), /まだ解放できません/);
  assert.deepEqual(g.storage.materials, before);
  assert.ok(!g.unlockedJobs.includes('apothecary'));
});

test('季節の敵と賞金首は連続クエスト廃止後も出現する', () => {
  assert.ok(monsterPool(data, 'blooming_hill', 'spring').some(m => m.season === 'spring'));
  const enemies = makeEncounter(data, 'mossy_cave', 1, () => 0, { bountyId: 'bounty_01_1', elites: true });
  assert.equal(enemies[0].bounty, true);
  assert.ok(enemies.every(e => !e.eliteId));
  const eligible = [...data.dungeons.values()].find(d => d.rank === data.balance.dungeon.elite_min_star);
  const eliteEnemies = makeEncounter(data, eligible.id, 1, () => 0, { elites: true });
  assert.equal(eliteEnemies.filter(e => e.eliteId).length, 1);
  assert.equal(data.questChains, undefined);
});

test('旧連続クエストの達成履歴と未受領の進行分は一度だけ精算する', () => {
  const g = game(), gold = g.gold, points = g.rankPoints;
  g.chains = {
    chain_01_1: { step: 3, progress: 0 },
    chain_02_1: { step: 2, progress: 0, awaitingAcceptance: true },
    chain_03_1: { step: 3, claimed: true },
    chain_04_1: { step: 1 },
  };
  normalizeGame(data, g);
  assert.equal(g.chains, undefined);
  assert.equal(Object.keys(g.retiredQuestChains).length, 4);
  assert.equal(g.retiredQuestChains.chain_03_1.settlement.gold, 0);
  assert.equal(g.retiredQuestChains.chain_04_1.settlement.gold, 0);
  assert.equal(g.gold, gold + data.economy.get(1).run_income * 2 + data.economy.get(2).run_income);
  assert.equal(g.rankPoints, points + 5 + 3);
  const materialCount = Object.values(g.storage.materials).reduce((sum, amount) => sum + amount, 0);
  assert.ok(materialCount >= 4);
  const snapshot = structuredClone({ gold: g.gold, rankPoints: g.rankPoints, materials: g.storage.materials, retired: g.retiredQuestChains });
  normalizeGame(data, g);
  assert.deepEqual({ gold: g.gold, rankPoints: g.rankPoints, materials: g.storage.materials, retired: g.retiredQuestChains }, snapshot);
});

test('場面の4択と空欄の4択は正解を一つだけ含む', () => {
  const lex = realLexicon();
  for (const format of ['cloze', 'situation']) {
    const q = lex.words.map((w) => makePracticeQuestion(w, lex, { direction: DIRECTION.JA_EN, format, rng: () => 0 }))
      .find((x) => x.format === format);
    assert.ok(q, format);
    assert.equal(q.choices.length, 4);
    assert.equal(new Set(q.choices.map((choice) => choice.text)).size, 4);
    assert.equal(q.choices[q.answerIndex].id, q.word.id);
    if (format === 'cloze') assert.match(q.prompt, /＿＿＿/);
  }
});

