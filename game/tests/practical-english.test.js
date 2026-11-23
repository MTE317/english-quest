import test from 'node:test';
import assert from 'node:assert/strict';
import { nextChant, recordChant } from '../js/chant.js';
import { buildLexicon } from '../js/lexicon.js';
import { QuestionPicker } from '../js/picker.js';
import { DIRECTION, makePracticeQuestion } from '../js/quiz.js';
import { Scheduler } from '../js/srs.js';
import { LearningStore } from '../js/storage.js';
import { starLearnedRatio, stoneAllowed, stoneProgress } from '../js/study.js';
import { DAY, MemoryStorage, readCsv, readJson, seededRng, T0 } from './helpers.js';

function loadRows(name) {
  const { rows, errors } = readCsv(name);
  assert.deepEqual(errors, [], name);
  return rows;
}

const stones = loadRows('rune_stones.csv');
const words = loadRows('lexicon.csv');
const chants = loadRows('chants.csv');
const books = loadRows('grimoires.csv');
const lex = buildLexicon(stones, words);
const scheduler = new Scheduler(readJson('srs.json'));
const sets = lex.stones.filter((s) => s.category === '00');
const phrases = chants.filter((c) => c.book === 'b_p00');
const vocabularyCounts = [65, 42, 45, 55, 40, 8, 5, 9, 14, 17];
const phraseCounts = [4, 4, 4, 4, 6, 20, 15, 23, 19, 21];

test('優先度Sの10サブカテゴリ・300語・120文を実データから読み込む', () => {
  assert.deepEqual(lex.problems, []);
  assert.equal(sets.length, 10);
  assert.equal(books.find((b) => b.id === 'b_p00').category, '00');
  assert.equal(phrases.length, 120);
  for (const rows of [stones, words, chants, books]) {
    assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  }
  const newWords = sets.flatMap((s) => lex.wordsByStone.get(s.id));
  assert.equal(new Set(newWords.map((w) => w.id)).size, 300);
  assert.equal(new Set(chants.map((c) => c.en.trim().toLowerCase())).size,
    new Set(chants.filter((c) => c.book !== 'b_p00').map((c) => c.en.trim().toLowerCase())).size + 120);
  for (const [i, set] of sets.entries()) {
    const chapter = phrases.filter((c) => Number(c.chapter) === set.order);
    assert.equal(chapter.length, phraseCounts[i], set.name);
    assert.ok(chapter.every((c) => c.priority === 'S' && /^[1-3]$/.test(c.level) && c.ja && c.en));
    assert.equal(set.size, vocabularyCounts[i]);
    assert.equal(lex.wordsByStone.get(set.id).length, set.size);
  }
  const rng = seededRng(19);
  for (const word of newWords) {
    assert.equal(word.priority, 'S');
    assert.ok([1, 2, 3].includes(word.star));
    const question = makePracticeQuestion(word, lex, { direction: DIRECTION.JA_EN, format: 'mixed', familiar: true, rng });
    assert.equal(question.direction, DIRECTION.EN_JA);
    assert.equal(question.prompt, [word.en, word.contextEn].filter(Boolean).join('\n'));
    assert.equal(question.choices.length, 4);
    assert.equal(new Set(question.choices.map((c) => c.text)).size, 4);
    assert.deepEqual(question.choices[question.answerIndex], { id: word.id, text: word.ja });
  }
});

test('既存の語義は旧IDで復習でき、昇格試験の分母は変わらない', () => {
  const store = new LearningStore(new MemoryStorage());
  const shared = [['rs_p00_03', 'lx_r3_022'], ['rs_p00_05', 'lx_r1_011'], ['rs_p00_10', 'lx_r2_023']];
  for (const [stoneId, id] of shared) {
    store.markRead([id]);
    store.set(id, scheduler.review(null, true, T0));
    const picker = new QuestionPicker({ lex, store, scheduler, stoneId, nowMs: T0 + 30 * DAY });
    const word = [picker.next(), picker.next(), picker.next()].find((item) => item.word.id === id).word;
    assert.equal(word.stoneId, stoneId);
    assert.equal(word.priority, 'S');
    assert.equal(stoneProgress(lex, store, scheduler, stoneId, scheduler.dayOf(T0)).read, 1);
    assert.equal(stoneAllowed(lex, store, scheduler, lex.stonesById.get(stoneId), 12, 12, 0), true);
  }
  assert.deepEqual([1, 2, 3].map((star) => starLearnedRatio(lex, store, scheduler, star).total), [33, 30, 27]);
});

test('既存の詠唱履歴を保持して00のフレーズを練習できる', () => {
  const config = readJson('chant.json');
  const game = {};
  const oldId = chants.find((c) => c.book === 'b01').id;
  recordChant(game, config, scheduler, T0, oldId, 'o');
  const oldRecord = game.chants.records[oldId];
  const selected = phrases.filter((c) => c.chapter === '06');
  const card = nextChant(game, config, scheduler, scheduler.dayOf(T0), chants, selected, new Set([oldId]));
  assert.equal(card, selected[0]);
  recordChant(game, config, scheduler, T0, card.id, 'o');
  assert.equal(game.chants.records[oldId], oldRecord);
  assert.ok(game.chants.records[card.id]);
});
