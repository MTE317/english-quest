import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLearningCatalog, LEARNING_V1_COUNTS } from '../js/learning-catalog.js';
import { readCsv } from './helpers.js';

const raw = {
  words: readCsv('learning/v1/words.csv').rows,
  phrases: readCsv('learning/v1/phrases.csv').rows,
  chunks: readCsv('learning/v1/chunks.csv').rows,
  categories: readCsv('learning/v1/categories.csv').rows,
  wordCategories: readCsv('learning/v1/word_categories.csv').rows,
  phraseCategories: readCsv('learning/v1/phrase_categories.csv').rows,
};
const catalog = buildLearningCatalog(raw);

test('基本教材v1.0は収録範囲・主キー・外部参照を検証して読み込める', () => {
  assert.equal(catalog.words.length, LEARNING_V1_COUNTS.words);
  assert.equal(catalog.phrases.length, LEARNING_V1_COUNTS.phrases);
  assert.equal(catalog.chunks.length, LEARNING_V1_COUNTS.chunks);
  assert.equal(catalog.subcategories.length, LEARNING_V1_COUNTS.categories);
  assert.equal(catalog.mainCategories.length, 7);
  assert.equal(catalog.wordsById.size, 1600);
  assert.equal(catalog.phrasesById.size, 1183);
  assert.equal(catalog.chunksById.size, 215);
  assert.equal(catalog.stones.length, 7);
  assert.equal(catalog.allStones.length, 67);
  assert.equal(catalog.stones[0].id, '00');
  assert.equal(catalog.lexicon.stones[0].id, '00');
  assert.equal(catalog.stonesById.has('00:S'), false);
  assert.equal(catalog.wordsByStone.has('00:S'), false);
  assert.equal(catalog.phrasesByStone.has('00:S'), false);
  assert.deepEqual(catalog.lexicon.problems, []);
});

test('00を単一コレクションとして扱い、優先度情報は教材属性のまま保存する', () => {
  assert.equal(catalog.wordsByStone.get('00').length, 807);
  assert.equal(catalog.phrasesByStone.get('00').length, 328);
  assert.equal(catalog.words.filter((w) => w.mainId === '00' && w.priority === 'S').length, 300);
  assert.equal(catalog.phrases.filter((p) => p.mainId === '00' && p.priority === 'S').length, 120);
  const id = catalog.wordsByStone.get('00')[0].id;
  const word = catalog.wordsById.get(id);
  assert.ok(catalog.wordsByStone.get(word.subcategoryId).some((w) => w.id === id));
  assert.equal(new Set(catalog.words.map((w) => w.id)).size, 1600);
  assert.equal(new Set(catalog.phrases.map((w) => w.id)).size, 1183);
  for (const words of catalog.wordsByStone.values()) assert.equal(words.length, new Set(words.map((w) => w.id)).size);
  for (const phrases of catalog.phrasesByStone.values()) assert.equal(phrases.length, new Set(phrases.map((p) => p.id)).size);
});

test('チャンクの例文は共通フレーズIDで参照でき、未連結フレーズも残す', () => {
  assert.equal(catalog.phrasesByChunk.get('C001').length, 54);
  assert.equal(catalog.phrasesByChunk.get('C001')[0].chunkId, 'C001');
  assert.equal(catalog.phrases.filter((p) => !p.chunkId).length, 364);
  assert.ok(catalog.chunks.every((c) => catalog.subcategoryById.has(c.subcategoryId)));
  assert.ok(catalog.phrasesByChunk.get('C001').every((p) => catalog.phrasesById.get(p.id) === p));
});

test('重複ID・参照欠損・件数不一致は黙って進行せずにエラーにする', () => {
  assert.throws(() => buildLearningCatalog({ ...raw, words: raw.words.slice(1) }), /1600/);
  assert.throws(() => buildLearningCatalog({ ...raw, words: [raw.words[0], ...raw.words.slice(0, -1)] }), /重複/);
  assert.throws(() => buildLearningCatalog({ ...raw, phrases: raw.phrases.map((p, i) => i === 0 ? { ...p, chunk_id: 'C404' } : p) }), /チャンクが不明/);
});
