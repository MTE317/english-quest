import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewGame } from '../js/game-state.js';
import { LearningStore } from '../js/storage.js';
import { Scheduler } from '../js/srs.js';
import { recordChant } from '../js/chant.js';
import { makeTrainingPicker, trainingChunksForSet, applyTrainingAnswer } from '../js/training.js';
import { learningStatistics } from '../js/learning-stats.js';
import { promotionProgress, promotionExamState, makePromotionExam,
  recordPromotionPart, scorePhraseGrades } from '../js/promotion.js';
import { arenaReviewWords } from '../js/study.js';
import { realGameData, realLearningCatalog, realLexicon, MemoryStorage, readJson, seededRng, T0, DAY } from './helpers.js';

const data = realGameData();
const catalog = realLearningCatalog();
const lex = realLexicon();
const sch = new Scheduler(readJson('srs.json'));
const config = readJson('chant.json');
const party = ['warrior', 'knight', 'black_mage', 'white_mage', 'thief', 'bard']
  .map((job) => ({ name: job, job, icon: 'x' }));
const fresh = () => createNewGame(data, party);
const d0 = sch.dayOf(T0);

function learnedRec() {
  return sch.reviewGrade(sch.reviewGrade(null, 4, T0), 4, T0 + 16 * DAY);
}

test('訓練場の通常モードは単語と瞬間英作文を明確に分け、共通IDの重複を出題しない', () => {
  const store = new LearningStore(new MemoryStorage());
  const g = fresh();
  const words = makeTrainingPicker(catalog, store, g, sch, d0, { mode: 'words', setId: '00' });
  const phrases = makeTrainingPicker(catalog, store, g, sch, d0, { mode: 'phrases', setId: '00' });
  assert.equal(words.size, 807);
  assert.equal(phrases.size, 328);
  assert.equal(makeTrainingPicker(catalog, store, g, sch, d0).size, 807, '訓練場は初期状態で00全体を使う');
  assert.equal(words.next().kind, 'word');
  assert.equal(phrases.next().kind, 'phrase');
  assert.equal(makeTrainingPicker(catalog, store, g, sch, d0,
    { mode: 'words', setId: 'all' }).size, 1600);
  assert.equal(makeTrainingPicker(catalog, store, g, sch, d0,
    { mode: 'phrases', setId: 'all' }).size, 1183);
  assert.equal(makeTrainingPicker(catalog, store, g, sch, d0,
    { mode: 'words', setId: '00' }).size, 807);
});

test('チャンクは教材に含まれる例文を持つものだけ表示し、出題もカテゴリーとチャンクの積集合になる', () => {
  const store = new LearningStore(new MemoryStorage());
  const g = fresh();
  const shown = trainingChunksForSet(catalog, '00');
  const allowed = new Set(catalog.phrasesByStone.get('00').map((p) => p.id));
  assert.ok(shown.length > 0 && shown.length < catalog.chunks.length);
  for (const chunk of shown) {
    const expected = catalog.phrasesByChunk.get(chunk.id).filter((p) => allowed.has(p.id));
    assert.equal(chunk.exampleCount, expected.length, chunk.id);
    assert.ok(chunk.exampleCount > 0);
  }
  const sub = catalog.subcategories.find((s) =>
    trainingChunksForSet(catalog, s.id).length > 0
    && (catalog.phrasesByStone.get(s.id) ?? []).length < 100);
  assert.ok(sub, '少数の例文を持つサブカテゴリーがあること');
  const chunk = trainingChunksForSet(catalog, sub.id)[0];
  const subIds = new Set(catalog.phrasesByStone.get(sub.id).map((p) => p.id));
  const expected = catalog.phrasesByChunk.get(chunk.id).filter((p) => subIds.has(p.id));
  const picker = makeTrainingPicker(catalog, store, g, sch, d0,
    { mode: 'chunks', setId: sub.id, chunkId: chunk.id });
  assert.equal(picker.size, expected.length);
  const expectedIds = new Set(expected.map((p) => p.id));
  for (let i = 0; i < expected.length; i++) {
    const answer = picker.next();
    assert.equal(answer.kind, 'phrase');
    assert.ok(expectedIds.has(answer.item.id), '別カテゴリーの例文が混ざってはいけない');
    expectedIds.delete(answer.item.id);
  }
  assert.equal(picker.next(), null);
  assert.equal(expectedIds.size, 0);
  const outside = catalog.chunks.find((entry) =>
    !catalog.phrasesByChunk.get(entry.id).some((p) => subIds.has(p.id)));
  assert.ok(outside, '対象カテゴリーに属さないチャンクがあること');
  assert.equal(makeTrainingPicker(catalog, store, g, sch, d0,
    { mode: 'chunks', setId: sub.id, chunkId: outside.id }).size, 0);
  assert.ok(!trainingChunksForSet(catalog, sub.id).some((entry) => entry.id === outside.id));
});

test('通常訓練は既習項目とセッション中の再出題を除き、チャンクは既習例文を含む', () => {
  const store = new LearningStore(new MemoryStorage());
  const game = fresh();
  const [dueWord, futureWord] = catalog.wordsByStone.get('00');
  const chunk = trainingChunksForSet(catalog, '00')[0];
  const inSet = new Set(catalog.phrasesByStone.get('00').map((p) => p.id));
  const phrase = catalog.phrasesByChunk.get(chunk.id).find((p) => inSet.has(p.id));
  store.recordAnswer(dueWord.id, sch.review(null, false, T0 - DAY), d0 - 1, false);
  store.recordAnswer(futureWord.id, sch.review(null, true, T0), d0, true);
  recordChant(game, config, sch, T0 - DAY, phrase.id, 'x');

  for (const [mode, excluded, size] of [
    ['words', [dueWord.id, futureWord.id], 805], ['phrases', [phrase.id], 327],
  ]) {
    const picker = makeTrainingPicker(catalog, store, game, sch, d0, { mode });
    assert.equal(picker.size, size);
    const seen = new Set();
    for (let entry = picker.next(); entry; entry = picker.next()) {
      assert.equal(entry.reason, 'new');
      assert.ok(!seen.has(entry.item.id) && !excluded.includes(entry.item.id));
      seen.add(entry.item.id);
      picker.report(entry, false);
    }
    assert.equal(seen.size, size);
  }
  const chunks = makeTrainingPicker(catalog, store, game, sch, d0, { mode: 'chunks', chunkId: chunk.id });
  assert.equal(chunks.next().item.id, phrase.id);
});

test('復習はカテゴリーに関係なく全教材から期限到来・誤答と単語/英作文を選べる', () => {
  const store = new LearningStore(new MemoryStorage());
  const g = fresh();
  const word = catalog.wordsByStone.get('00')[0];
  const zeroCollection = new Set(catalog.phrasesByStone.get('00').map((p) => p.id));
  const phrase = catalog.phrases.find((p) => !zeroCollection.has(p.id));
  store.recordAnswer(word.id, sch.review(null, false, T0), d0, false);
  recordChant(g, config, sch, T0, phrase.id, 'x');

  const params = { mode: 'review', setId: '00', reviewType: 'both', reviewScope: 'due' };
  assert.equal(makeTrainingPicker(catalog, store, g, sch, d0, params).size, 0);
  const due = makeTrainingPicker(catalog, store, g, sch, d0 + 1, params);
  assert.equal(due.size, 2, 'セット外の英作文も期限到来なら含む');
  const answered = [due.next(), due.next()];
  assert.deepEqual(new Set(answered.map((entry) => entry.item.id)),
    new Set([word.id, phrase.id]));
  assert.ok(answered.every((entry) => entry.reason === 'due'));
  assert.equal(makeTrainingPicker(catalog, store, g, sch, d0 + 1,
    { ...params, reviewType: 'words' }).size, 1);
  assert.equal(makeTrainingPicker(catalog, store, g, sch, d0 + 1,
    { ...params, reviewType: 'phrases' }).size, 1);
  assert.equal(makeTrainingPicker(catalog, store, g, sch, d0,
    { ...params, reviewScope: 'wrong' }).size, 2);
  assert.equal(makeTrainingPicker(catalog, new LearningStore(new MemoryStorage()), fresh(),
    sch, d0, { mode: 'review', reviewScope: 'wrong' }).next(), null);
});

test('訓練報酬は6人全員、1項目1日1回、小数繰越で低額XP/APに変わる', () => {
  const g = fresh();
  const before = g.party.map((m) => ({ xp: m.xp, ap: m.ap[m.job], lv: m.lv }));
  const first = applyTrainingAnswer(data, g, { kind: 'word', id: catalog.words[0].id, day: d0 });
  assert.equal(first.awarded, true);
  assert.equal(applyTrainingAnswer(data, g, { kind: 'word', id: catalog.words[0].id, day: d0 }).awarded, false);
  for (let k = 1; k < 30; k++) applyTrainingAnswer(data, g, {
    kind: 'word', id: catalog.words[k].id, day: d0, due: k === 1, passed: true,
  });
  assert.equal(g.trainingRewardIds.length, 30);
  for (let i = 0; i < 6; i++) {
    const member = g.party[i];
    assert.ok(member.xp > before[i].xp);
    assert.ok(member.ap[member.job] > before[i].ap);
    assert.ok(member.xp - before[i].xp < 30); // 戦闘より圧倒的に少ない
  }
  assert.equal(g.day, 1);
  assert.equal(g.gold, 1000);
  assert.deepEqual(g.storage.materials, {});
  assert.equal(applyTrainingAnswer(data, g, { kind: 'word', id: catalog.words[0].id, day: d0 + 1 }).awarded, true);
});

test('単語と英作文の習得履歴は、忘れても累積達成として維持する', () => {
  const memory = new MemoryStorage();
  const store = new LearningStore(memory);
  const g = fresh();
  const word = catalog.words[0];
  store.set(word.id, learnedRec());
  store.set(word.id, sch.review(store.get(word.id), false, T0 + 10 * DAY));
  assert.equal(store.get(word.id).stage, 'learning');
  assert.ok(store.everLearned.has(word.id));
  assert.ok(new LearningStore(memory).everLearned.has(word.id));
  const phrase = catalog.phrases[0];
  recordChant(g, config, sch, T0, phrase.id, 'o');
  recordChant(g, config, sch, T0 + 4 * DAY, phrase.id, 'o');
  recordChant(g, config, sch, T0 + 20 * DAY, phrase.id, 'o');
  assert.ok(g.chants.masteredIds.includes(phrase.id));
  recordChant(g, config, sch, T0 + 21 * DAY, phrase.id, 'x');
  assert.ok(g.chants.masteredIds.includes(phrase.id));
  const stats = learningStatistics(catalog, store, g, sch, d0 + 21);
  assert.equal(stats.words.masteredEver, 1);
  assert.equal(stats.words.masteredNow, 0);
  assert.equal(stats.phrases.masteredEver, 1);
  assert.equal(stats.days.length >= 3, true);
});

test('昇格には単語・英作文両方の習得実績が必要。二分野合格を別々に保存する', () => {
  const store = new LearningStore(new MemoryStorage());
  const game = fresh();
  const record = learnedRec();
  for (const word of catalog.words.slice(0, 18)) store.set(word.id, record);
  game.chants = {
    records: Object.fromEntries(catalog.phrases.slice(0, 12).map((p) => [p.id, record])),
    masteredIds: catalog.phrases.slice(0, 12).map((p) => p.id),
  };
  const progress = promotionProgress(catalog, store, game, 'R02');
  assert.equal(progress.wordMet, true);
  assert.equal(progress.phraseMet, true);
  const plan = makePromotionExam(catalog, store, game, 'R02', seededRng(7));
  assert.equal(plan.words.length, 18);
  assert.equal(plan.phrases.length, 10);
  assert.equal(new Set(plan.words.map((x) => x.id)).size, plan.words.length);
  assert.equal(recordPromotionPart(store, 'R02', 'word', 15, 18, d0).complete, false);
  assert.equal(promotionExamState(store, 'R02').wordPassed, true);
  assert.equal(recordPromotionPart(store, 'R02', 'phrase', 7.5, 10, d0).complete, false);
  assert.equal(recordPromotionPart(store, 'R02', 'phrase', 8.5, 10, d0 + 1).complete, true);
  assert.equal(promotionExamState(new LearningStore(store.storage), 'R02').phrasePassed, true);
  assert.equal(scorePhraseGrades(['o', 't', 'x']), 1.5);
});

test('英語学習統計は重複を除いたカテゴリー別の習得を表示できる', () => {
  const store = new LearningStore(new MemoryStorage());
  const g = fresh();
  const w = catalog.words.find((word) => word.categoryIds.some((id) => id !== word.mainId));
  store.set(w.id, learnedRec());
  const stats = learningStatistics(catalog, store, g, sch, d0);
  assert.equal(stats.words.masteredEver, 1);
  assert.ok(stats.main.some((category) => category.wordLearned > 0));
  assert.equal(stats.chunks.total, 215);
  assert.ok(stats.main.length === 7);
  assert.deepEqual(arenaReviewWords(lex, store).map((w) => w.id), [w.id]);
});
