import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewGame } from '../js/game-state.js';
import { LearningStore, LEARNING_KEY } from '../js/storage.js';
import { buildLexicon } from '../js/lexicon.js';
import { Scheduler } from '../js/srs.js';
import {
  stoneProgress, nextUnread, stoneAllowed, trialBlock, trialPlan, finishExam, promotionBlock, promotionPlan, starLearnedRatio,
  trainingReward, applyTraining, examWords, arenaReviewWords,
} from '../js/study.js';
import { nextRankStatus, checkRankUp } from '../js/town.js';
import { seededRng } from '../js/dungeon.js';
import { realGameData, realLexicon, readJson, readCsv, MemoryStorage, T0, DAY } from './helpers.js';

const data = realGameData();
const lex = realLexicon();
const sch = new Scheduler(readJson('srs.json'));
const party = ['warrior', 'knight', 'black_mage', 'white_mage', 'thief', 'bard'].map((job) => ({ name: job, job, icon: 'x' }));
const today = sch.dayOf(T0);

test('資料室：読み解くと進み具合に入る。報酬はない（お金・経験値は変わらない）', () => {
  const store = new LearningStore(new MemoryStorage());
  const g = createNewGame(data, party);
  const before = JSON.stringify(g);
  const cards = nextUnread(lex, store, 'rs_1_001', 5);
  assert.equal(cards.length, 5);
  store.markRead(cards.map((w) => w.id));
  assert.equal(stoneProgress(lex, store, sch, 'rs_1_001', today).read, 5);
  assert.equal(nextUnread(lex, store, 'rs_1_001', 5)[0].id, lex.wordsByStone.get('rs_1_001')[5].id);
  assert.equal(JSON.stringify(g), before);
  // 記録が残る
  assert.equal(new LearningStore(store.storage).read.size, 5);
});

test('1つ上の★の石：今の★の石をすべて読み解くと持ち込める', () => {
  const store = new LearningStore(new MemoryStorage());
  const s2 = lex.stones.find((s) => s.star === 2);
  assert.equal(stoneAllowed(lex, store, sch, s2, 1, 1, today), false);
  store.markRead(lex.wordsByStone.get('rs_1_001').map((w) => w.id));
  assert.equal(stoneAllowed(lex, store, sch, s2, 1, 1, today), true);
  const s3 = lex.stones.find((s) => s.star === 3);
  assert.equal(stoneAllowed(lex, store, sch, s3, 1, 1, today), false);
  assert.equal(stoneAllowed(lex, store, sch, lex.stones[0], 2, 2, today), false); // ★がダンジョンより低い
});

test('確認テストは予習前・合格後・当日の不合格後でも任意で受け直せ、成長や称号を付けない', () => {
  const store = new LearningStore(new MemoryStorage());
  const game = createNewGame(data, party);
  const before = structuredClone(game);
  const e = readCsv('exams.csv').rows.find((r) => r.id === 'confirmation');
  assert.equal(trialBlock(data, lex, store, sch, 'rs_1_001', today), '');
  const plan = trialPlan(data, lex, 'rs_1_001', seededRng({ rng: 1 }));
  assert.equal(plan.words.length, Number(e.questions));
  assert.equal(new Set(plan.words).size, plan.words.length);
  assert.ok(plan.words.every((id) => lex.wordsById.get(id).stoneId === 'rs_1_001'));
  const need = Math.ceil(Number(e.questions) * Number(e.pass_rate));
  assert.equal(finishExam(data, store, plan, need - 1, today), false);
  assert.equal(trialBlock(data, lex, store, sch, 'rs_1_001', today), '');
  assert.equal(finishExam(data, store, plan, need, today, () => { game.gold += 100; game.titles.push('余分な報酬'); }), true);
  assert.equal(trialBlock(data, lex, store, sch, 'rs_1_001', today), '');
  assert.equal(finishExam(data, store, plan, 1, today + 1), false);
  const result = new LearningStore(store.storage).confirmationResult('rs_1_001');
  assert.equal(result.attempts, 3);
  assert.equal(result.firstPassedDay, today);
  assert.equal(result.passedDay, today);
  assert.equal(result.lastDay, today + 1);
  assert.equal(result.lastCorrect, 1);
  assert.equal(result.lastTotal, plan.words.length);
  assert.equal(result.lastPassed, false);
  assert.equal(result.bestCorrect, need);
  assert.equal(result.bestRate, need / plan.words.length);
  assert.deepEqual(game, before);
  assert.deepEqual(store.awakened, {});
});

test('教材がない石の確認テストを開始できず、空問題で合格扱いにならない', () => {
  const store = new LearningStore(new MemoryStorage());
  const noWords = { ...lex, wordsByStone: new Map([['empty', []]]) };
  assert.match(trialBlock(data, noWords, store, sch, 'empty', today), /教材がありません/);
  assert.throws(() => trialPlan(data, noWords, 'empty', Math.random), /教材がありません/);
  assert.throws(() => finishExam(data, store, { examId: 'confirmation', stoneId: 'empty', words: [], passRate: 0.8 }, 0, today), /回答数/);
  assert.equal(store.confirmationResult('empty'), null);
});

test('旧覚醒・試験の達成日を引き継ぎ、学習履歴と復習予定を保存したまま再受験できる', () => {
  const memory = new MemoryStorage();
  const original = new LearningStore(memory);
  const word = lex.wordsByStone.get('rs_1_001')[0];
  original.markRead([word.id]);
  original.recordAnswer(word.id, sch.review(null, true, T0), today, true);
  const raw = JSON.parse(memory.getItem(LEARNING_KEY));
  raw.awakened = { rs_1_001: { day: today - 2 } };
  raw.exams = {
    'awakening:rs_1_001': { passedDay: today - 2, lastFailDay: null },
    'awakening:rs_2_001': { lastFailDay: today - 1 },
    'promotion:R02': { passedDay: today - 3, lastFailDay: null },
  };
  memory.setItem(LEARNING_KEY, JSON.stringify(raw));
  const loaded = new LearningStore(memory);
  assert.deepEqual(loaded.get(word.id), original.get(word.id));
  assert.deepEqual(loaded.dailyTotal(today), original.dailyTotal(today));
  assert.equal(loaded.isRead(word.id), true);
  assert.equal(loaded.confirmationResult('rs_1_001').firstPassedDay, today - 2);
  assert.equal(loaded.confirmationResult('rs_1_001').lastCorrect, undefined); // 未記録の点数を推測しない
  assert.equal(loaded.confirmationResult('rs_2_001').lastPassed, false);
  assert.deepEqual(loaded.exams['promotion:R02'], raw.exams['promotion:R02']);
  assert.deepEqual(loaded.exams['awakening:rs_1_001'], raw.exams['awakening:rs_1_001']);
  assert.deepEqual(loaded.awakened, raw.awakened);
  assert.equal(trialBlock(data, lex, loaded, sch, 'rs_1_001', today), '');
  const plan = trialPlan(data, lex, 'rs_1_001', seededRng({ rng: 1 }));
  finishExam(data, loaded, plan, 1, today);
  const reloaded = new LearningStore(memory);
  assert.equal(reloaded.confirmationResult('rs_1_001').firstPassedDay, today - 2);
  assert.equal(reloaded.confirmationResult('rs_1_001').lastPassed, false);
  assert.deepEqual(new LearningStore(memory).exams, reloaded.exams); // 再読込で古い合格に上書きしない
});

test('学習項目を別の石へ移し、一時的に教材から外しても、同じIDの習得・復習履歴を引き継ぐ', () => {
  const store = new LearningStore(new MemoryStorage());
  const word = lex.wordsByStone.get('rs_1_001')[0];
  let rec = null;
  for (let d = 0; d < 3; d++) rec = sch.review(rec, true, T0 + d * DAY);
  store.set(word.id, rec);
  const rows = readCsv('lexicon.csv').rows.map((row) => row.id === word.id ? { ...row, stone_id: 'rs_2_001' } : row);
  const moved = buildLexicon(readCsv('rune_stones.csv').rows, rows);
  assert.equal(stoneProgress(moved, store, sch, 'rs_1_001', today).learned, 0);
  assert.equal(stoneProgress(moved, store, sch, 'rs_2_001', today).learned, 1);
  const removed = buildLexicon(readCsv('rune_stones.csv').rows, rows.filter((row) => row.id !== word.id));
  assert.equal(stoneProgress(removed, store, sch, 'rs_2_001', today).learned, 0);
  store.save();
  const reloaded = new LearningStore(store.storage);
  assert.deepEqual(reloaded.get(word.id), rec);
  assert.equal(stoneProgress(moved, reloaded, sch, 'rs_2_001', today).learned, 1);
});

test('闘技場は確認テストの合否や石の所属に関わらず、読み解いた個々のルーンを総復習する', () => {
  const store = new LearningStore(new MemoryStorage());
  const ids = [lex.wordsByStone.get('rs_1_001')[0].id, lex.wordsByStone.get('rs_2_001')[0].id];
  store.markRead(ids);
  store.setAwakened('rs_1_001', today - 1);
  store.recordConfirmation('rs_2_001', { correct: 1, total: 20, day: today, passed: false });
  assert.deepEqual(arenaReviewWords(lex, store).map((w) => w.id), ids);
  store.recordConfirmation('rs_2_001', { correct: 20, total: 20, day: today, passed: true });
  assert.deepEqual(arenaReviewWords(lex, store).map((w) => w.id), ids);
});

test('昇格試験：★のルーンを8割習得すると受けられ、合格するとランクが上がる', () => {
  const store = new LearningStore(new MemoryStorage());
  const g = createNewGame(data, party);
  g.rank = 'R01+'; g.rankPoints = 12; g.cleared = { mossy_cave: 1 };
  assert.match(promotionBlock(data, lex, store, sch, g, today), /習得/);
  // ★1の単語を日を空けて3回正解して習得にする
  const words = lex.words.filter((w) => w.star === 1);
  for (const w of words.slice(0, Math.ceil(words.length * 0.8))) {
    let rec = null;
    for (let d = 0; d < 3; d++) rec = sch.review(rec, true, T0 + d * DAY);
    store.set(w.id, rec);
  }
  assert.ok(starLearnedRatio(lex, store, sch, 1).ratio >= 0.8);
  assert.equal(promotionBlock(data, lex, store, sch, g, today), '');
  assert.deepEqual(nextRankStatus(data, g).needs, ['昇格試験に合格する（ギルドの資料室のとなり）']);
  const plan = promotionPlan(data, lex, g, seededRng({ rng: 2 }));
  assert.equal(plan.rankId, 'R02');
  assert.ok(plan.words.every((id) => lex.wordsById.get(id).star === 1));
  finishExam(data, store, plan, plan.words.length, today, () => { g.examsPassed.push(plan.rankId); checkRankUp(data, g); });
  assert.equal(g.rank, 'R02');
});

test('鍛錬：正解で経験値か AP。日数は進まず、お金も素材も入らない', () => {
  const g = createNewGame(data, party);
  const before = { day: g.day, gold: g.gold, mats: JSON.stringify(g.storage.materials) };
  const m = g.party[0];
  const r = trainingReward(data, g, m, 'xp', 15, 15);
  const r0 = trainingReward(data, g, m, 'xp', 0, 15);
  assert.ok(r.xp > r0.xp && r0.xp > 0);
  applyTraining(data, g, 0, r);
  assert.ok(m.lv > 1 || m.xp > 0);
  const ap = trainingReward(data, g, m, 'ap', 15, 15);
  assert.equal(ap.ap, 3);
  assert.deepEqual({ day: g.day, gold: g.gold, mats: JSON.stringify(g.storage.materials) }, before);
  // 強くなりすぎると減る（今の★のいちばん強い敵より5レベル上で0）
  m.lv = 40;
  assert.equal(trainingReward(data, g, m, 'xp', 15, 15).xp, 0);
});

test('問題にする単語：足りなければくり返す', () => {
  const ws = [{ id: 'a' }, { id: 'b' }];
  assert.equal(examWords(ws, 5, seededRng({ rng: 3 })).length, 5);
});
