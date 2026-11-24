import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLexicon } from '../js/lexicon.js';
import { Scheduler } from '../js/srs.js';
import { LearningStore } from '../js/storage.js';
import { QuestionPicker, REASON } from '../js/picker.js';
import { makeQuestion, questionSpeech, DIRECTION, editDistance } from '../js/quiz.js';
import { readJson, realLexicon, MemoryStorage, seededRng, DAY, T0 } from './helpers.js';

const lex = realLexicon();
const srs = readJson('srs.json');
const sch = new Scheduler(srs);

test('読み上げは表示した英語を使い、日本語の問題では回答まで正解を伏せる', () => {
  const prompt = 'I left my current job.';
  assert.deepEqual(questionSpeech({ direction: DIRECTION.EN_JA, prompt }), { prompt, answer: prompt });
  for (const format of ['meaning', 'situation']) {
    assert.deepEqual(questionSpeech({
      direction: DIRECTION.JA_EN, format, prompt: '今の仕事を辞めました。',
      choices: [{ text: 'I am looking for a job.' }, { text: prompt }], answerIndex: 1,
    }), { prompt: null, answer: prompt });
  }
});

test('穴埋めは空欄のまま出題を読み、回答後に完成した英文を読む', () => {
  const q = {
    direction: DIRECTION.JA_EN, format: 'cloze', prompt: '私はサポートを担当しています。\nI am ＿＿＿ support.',
    choices: [{ text: 'responsible for' }], answerIndex: 0,
  };
  assert.deepEqual(questionSpeech(q), { prompt: 'I am blank support.', answer: 'I am responsible for support.' });
});

test('4択：選択肢は4つ、正解は1つ、同じ表示はない', () => {
  const rng = seededRng(7);
  for (const w of lex.words) {
    for (const direction of [DIRECTION.EN_JA, DIRECTION.JA_EN]) {
      for (const familiar of [false, true]) {
        const q = makeQuestion(w, lex, { direction, familiar, rng });
        assert.equal(q.choices.length, 4);
        assert.equal(new Set(q.choices.map((c) => c.text)).size, 4);
        assert.equal(q.choices[q.answerIndex].id, w.id);
        assert.equal(q.prompt, direction === DIRECTION.EN_JA ? w.en : w.ja);
      }
    }
  }
});

test('慣れないうちは別の石から、慣れたら同じ石から', () => {
  const w = lex.wordsByStone.get('00-02')[0];
  const rng = seededRng(3);
  const early = makeQuestion(w, lex, { direction: DIRECTION.EN_JA, familiar: false, rng });
  const late = makeQuestion(w, lex, { direction: DIRECTION.EN_JA, familiar: true, rng });
  const stoneOf = (id) => lex.wordsById.get(id).stoneId;
  assert.ok(early.choices.filter((c) => c.id !== w.id).every((c) => stoneOf(c.id) !== w.stoneId));
  assert.ok(late.choices.every((c) => stoneOf(c.id) === w.stoneId));
});

test('慣れたら、つづりの似た単語が選ばれやすい', () => {
  const fixture = buildLexicon([{ id: 'spelling', star: '1' }], ['resign', 'design', 'resigned', 'resigning', 'elephant', 'mountain', 'galaxy'].map((en, i) =>
    ({ id: String(i), stone_id: 'spelling', kind: 'word', en, ja: String(i), star: '1' })));
  const w = fixture.words[0];
  const q = makeQuestion(w, fixture, { direction: DIRECTION.JA_EN, familiar: true, rng: seededRng(1) });
  // 同じ石の word の中でつづりの近いもの（design / resigned など）が入る
  const avg = q.choices.filter((c) => c.id !== w.id)
    .reduce((a, c) => a + editDistance(w.en, c.text), 0) / 3;
  const all = fixture.wordsByStone.get(w.stoneId).filter((x) => x.id !== w.id);
  const avgAll = all.reduce((a, x) => a + editDistance(w.en, x.en), 0) / all.length;
  assert.ok(avg < avgAll, `${avg} < ${avgAll}`);
});

test('初回：新しい単語は上限まで、そのあとは練習', () => {
  const store = new LearningStore(new MemoryStorage());
  const p = new QuestionPicker({ lex, store, scheduler: sch, stoneId: '00', nowMs: T0 });
  const reasons = [];
  for (let i = 0; i < 20; i++) {
    const { word, reason } = p.next();
    reasons.push(reason);
    store.set(word.id, sch.review(store.get(word.id), true, T0));
    p.report(word.id, true);
  }
  const limit = srs.new_per_run[1];
  assert.equal(reasons.filter((r) => r === REASON.NEW).length, limit);
  assert.ok(reasons.slice(0, limit).every((r) => r === REASON.NEW));
  assert.ok(reasons.slice(limit).every((r) => r === REASON.PRACTICE));
});

test('復習優先：かすれたルーン（ほかの石も）を先に出す', () => {
  const store = new LearningStore(new MemoryStorage());
  const dueIds = ['EQ00-S-W151', 'EQ00-S-W260', 'EQ00-S-W005'];
  for (const id of dueIds) store.set(id, sch.review(null, true, T0));
  store.set('EQ00-S-W006', sch.review(null, true, T0 + 30 * DAY)); // まだ時期ではない
  const p = new QuestionPicker({ lex, store, scheduler: sch, stoneId: '00', nowMs: T0 + 30 * DAY });
  const first = [p.next(), p.next(), p.next()];
  assert.deepEqual(new Set(first.map((x) => x.word.id)), new Set(dueIds));
  assert.ok(first.every((x) => x.reason === REASON.DUE));
  const fourth = p.next();
  assert.equal(fourth.reason, REASON.NEW);
  assert.ok(lex.wordsByStone.get('00').includes(fourth.word));
});

test('かすれたルーンが多いときは新出を減らす', () => {
  const store = new LearningStore(new MemoryStorage());
  const n = srs.reduce_new_when_due_over + 1;
  for (const w of lex.words.filter((x) => !lex.wordsByStone.get('00').includes(x)).slice(0, n)) {
    store.words.set(w.id, sch.review(null, true, T0));
  }
  const p = new QuestionPicker({ lex, store, scheduler: sch, stoneId: '00', nowMs: T0 + 60 * DAY });
  assert.equal(p.newLimit, srs.reduced_new_per_run);
});

test('間違えた単語はあとでもう一度出る', () => {
  const store = new LearningStore(new MemoryStorage());
  const p = new QuestionPicker({ lex, store, scheduler: sch, stoneId: '00', nowMs: T0 });
  const first = p.next();
  store.set(first.word.id, sch.review(null, false, T0));
  p.report(first.word.id, false);
  const seq = [];
  for (let i = 0; i < sch.retryGap + 1; i++) {
    const x = p.next();
    seq.push(x);
    store.set(x.word.id, sch.review(store.get(x.word.id), true, T0));
    p.report(x.word.id, true);
  }
  const last = seq[seq.length - 1];
  assert.equal(last.word.id, first.word.id);
  assert.equal(last.reason, REASON.RETRY);
});

test('出題の状態を保存して戻すと、続きから同じ順で出る', () => {
  const store = new LearningStore(new MemoryStorage());
  const p = new QuestionPicker({ lex, store, scheduler: sch, stoneId: '00', nowMs: T0 });
  for (let i = 0; i < 4; i++) { const x = p.next(); store.set(x.word.id, sch.review(null, i % 2 === 0, T0)); p.report(x.word.id, i % 2 === 0); }
  const saved = JSON.parse(JSON.stringify(p.toState()));
  const q = new QuestionPicker({ lex, store, scheduler: sch, stoneId: '00', nowMs: T0, state: saved });
  for (let i = 0; i < 6; i++) {
    const a = p.next(); const b = q.next();
    assert.equal(a.word.id, b.word.id); assert.equal(a.reason, b.reason);
    p.report(a.word.id, true); q.report(b.word.id, true);
  }
});
