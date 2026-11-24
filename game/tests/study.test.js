import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewGame } from '../js/game-state.js';
import { LearningStore } from '../js/storage.js';
import { Scheduler } from '../js/srs.js';
import { recordChant } from '../js/chant.js';
import { makeTrainingPicker, applyTrainingAnswer } from '../js/training.js';
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
  let rec = null;
  for (let d = 0; d < 3; d++) rec = sch.review(rec, true, T0 + d * DAY);
  return rec;
}

test('共通教材IDで単語・瞬間英作文・チャンクが選べ、00の重複を数えない', () => {
  const store = new LearningStore(new MemoryStorage());
  const game = fresh();
  const picker = makeTrainingPicker(catalog, store, game, sch, d0, { mode: 'mixed', setId: '00:S' });
  assert.equal(picker.size, 420);
  const first = picker.next();
  assert.ok(first && ['word', 'phrase'].includes(first.kind));
  const chunk = makeTrainingPicker(catalog, store, game, sch, d0, { mode: 'chunks', chunkId: 'C001' });
  assert.equal(chunk.size, 54);
  for (let n = 0; n < 8; n++) assert.equal(chunk.next().kind, 'phrase');
  const all = makeTrainingPicker(catalog, store, game, sch, d0, { mode: 'mixed', setId: 'all' });
  assert.equal(all.size, 2783);
});

test('訓練場は苦手問題と期限到来問題を出せる', () => {
  const store = new LearningStore(new MemoryStorage());
  const g = fresh();
  const word = catalog.wordsByStone.get('00:S')[0];
  store.recordAnswer(word.id, sch.review(null, false, T0), d0, false);
  const picker = makeTrainingPicker(catalog, store, g, sch, d0 + 1, { mode: 'review', setId: '00:S' });
  assert.equal(picker.next().item.id, word.id);
  const noReview = makeTrainingPicker(catalog, store, g, sch, d0 - 1, { mode: 'review', setId: '00:S' });
  assert.equal(noReview.next().item.id, word.id); // 過去の誤答は任意の苦手復習に残る
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
  recordChant(g, config, sch, T0 + DAY, phrase.id, 'o');
  recordChant(g, config, sch, T0 + 2 * DAY, phrase.id, 'o');
  assert.ok(g.chants.masteredIds.includes(phrase.id));
  recordChant(g, config, sch, T0 + 3 * DAY, phrase.id, 'x');
  assert.ok(g.chants.masteredIds.includes(phrase.id));
  const stats = learningStatistics(catalog, store, g, sch, d0 + 3);
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
