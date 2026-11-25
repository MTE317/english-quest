// English Quest 学習教材 v1.0 の正本ローダー。
// 教材IDとカテゴリー/教材セットの所属を分離し、履歴・習熟度を項目IDに固定する。
import { loadCsv } from './data.js?v=skill-growth-2';

export const LEARNING_V1_FILES = Object.freeze({
  words: 'learning/v1/words.csv',
  phrases: 'learning/v1/phrases.csv',
  chunks: 'learning/v1/chunks.csv',
  categories: 'learning/v1/categories.csv',
  wordCategories: 'learning/v1/word_categories.csv',
  phraseCategories: 'learning/v1/phrase_categories.csv',
});

export const LEARNING_V1_COUNTS = Object.freeze({
  words: 1600, phrases: 1183, chunks: 215, categories: 60,
});

const mainIdOf = (id) => String(id ?? '').slice(0, 2);
const difficultyOf = (value) => Number(String(value ?? '').match(/\d+/)?.[0]) || 1;

function uniqueIds(rows, field, label) {
  const ids = new Set();
  for (const row of rows) {
    const id = row[field];
    if (!id || ids.has(id)) throw new Error(`${label}のIDが空または重複しています：${id ?? ''}`);
    ids.add(id);
  }
  return ids;
}

function requireCount(rows, target, label) {
  if (!Array.isArray(rows) || rows.length !== target) {
    throw new Error(`教材v1.0 ${label}：${target}件を想定、実際は${rows?.length ?? '不明'}件`);
  }
}

// Nodeのユニットテストとブラウザローダーで同じバリデーションを実行する。
export function buildLearningCatalog(raw) {
  const { words: wordRows, phrases: phraseRows, chunks: chunkRows,
    categories: categoryRows, wordCategories: wordLinks, phraseCategories: phraseLinks } = raw;
  for (const [key, expected] of Object.entries(LEARNING_V1_COUNTS)) {
    requireCount(raw[key], expected, key);
  }
  uniqueIds(wordRows, 'word_id', '単語');
  uniqueIds(phraseRows, 'phrase_id', '英作文');
  uniqueIds(chunkRows, 'chunk_id', 'チャンク');
  uniqueIds(categoryRows, 'subcategory_id', 'カテゴリー');

  const subcategoryById = new Map(categoryRows.map((r) => [r.subcategory_id, {
    id: r.subcategory_id, mainId: r.main_category_id, name: r.subcategory,
  }]));
  const mainById = new Map();
  for (const row of categoryRows) {
    if (!mainById.has(row.main_category_id)) mainById.set(row.main_category_id, {
      id: row.main_category_id, name: row.main_category,
    });
    if (mainIdOf(row.subcategory_id) !== row.main_category_id) {
      throw new Error(`カテゴリーの親子関係が不正：${row.subcategory_id}`);
    }
  }
  if (mainById.size !== 7 || !mainById.has('00')) throw new Error('7メインカテゴリー／00学習コレクションが必要です。');

  const chunks = chunkRows.map((row) => ({
    id: row.chunk_id, pattern: row.pattern_en, meaning: row.function_ja,
    order: Number(row.learning_order) || 0, mainId: mainIdOf(row.intent_subcategory_id),
    subcategoryId: row.intent_subcategory_id, clusterId: row.cluster_id,
    clusterName: row.cluster_name, priority: row.priority, type: row.type,
    variants: row.pattern_variants, reviewStatus: row.audit_status, note: row.review_note,
  }));
  const chunksById = new Map(chunks.map((c) => [c.id, c]));
  for (const chunk of chunks) {
    if (!subcategoryById.has(chunk.subcategoryId)) throw new Error(`チャンクのカテゴリー不明：${chunk.id}`);
  }

  const wordLinksById = new Map(wordRows.map((row) => [row.word_id, new Set([row.main_category_id])]));
  const phraseLinksById = new Map(phraseRows.map((row) => [row.phrase_id, new Set([row.subcategory_id])]));
  const uniqueWordLinks = new Set();
  for (const row of wordLinks) {
    if (!wordLinksById.has(row.word_id) || !mainById.has(row.category_id)) {
      throw new Error(`単語カテゴリ関連が不正：${row.word_id} / ${row.category_id}`);
    }
    const pair = `${row.word_id}\t${row.category_id}`;
    if (uniqueWordLinks.has(pair)) throw new Error(`単語カテゴリ関連の重複：${pair}`);
    uniqueWordLinks.add(pair);
    wordLinksById.get(row.word_id).add(row.category_id);
  }
  const uniquePhraseLinks = new Set();
  for (const row of phraseLinks) {
    if (!phraseLinksById.has(row.phrase_id) || !subcategoryById.has(row.category_id)) {
      throw new Error(`英作文カテゴリ関連が不正：${row.phrase_id} / ${row.category_id}`);
    }
    const pair = `${row.phrase_id}\t${row.category_id}`;
    if (uniquePhraseLinks.has(pair)) throw new Error(`英作文カテゴリ関連の重複：${pair}`);
    uniquePhraseLinks.add(pair);
    phraseLinksById.get(row.phrase_id).add(row.category_id);
  }

  const words = wordRows.map((row, index) => {
    if (!subcategoryById.has(row.subcategory_id)) throw new Error(`単語のカテゴリー不明：${row.word_id}`);
    if (mainIdOf(row.subcategory_id) !== row.main_category_id) throw new Error(`単語の主所属不正：${row.word_id}`);
    return {
      id: row.word_id, en: row.english, ja: row.japanese,
      // 旧QuestionPickerが参照する主所属の識別子。セット所属全体は categoryIds で管理する。
      stoneId: row.subcategory_id, mainId: row.main_category_id, subcategoryId: row.subcategory_id,
      categoryIds: [...wordLinksById.get(row.word_id), row.subcategory_id],
      priority: row.priority, star: difficultyOf(row.difficulty), difficulty: row.difficulty,
      kind: /句|熟語|定型表現|複合表現/.test(row.word_type) ? 'idiom' : 'word', wordType: row.word_type,
      pos: row.word_type, exampleEn: row.source_phrase_english || '',
      exampleJa: row.source_phrase_japanese || '',
      sourcePhraseId: row.source_phrase_id || null,
      reviewStatus: row.review_status, semanticNote: row.semantic_note,
      index,
    };
  });
  const wordsById = new Map(words.map((w) => [w.id, w]));
  const phrases = phraseRows.map((row) => {
    if (!subcategoryById.has(row.subcategory_id) || mainIdOf(row.subcategory_id) !== row.main_category_id) {
      throw new Error(`英作文の主所属不正：${row.phrase_id}`);
    }
    if (row.chunk_id && !chunksById.has(row.chunk_id)) throw new Error(`英作文のチャンクが不明：${row.phrase_id}`);
    const ids = phraseLinksById.get(row.phrase_id);
    return {
      id: row.phrase_id, en: row.english, ja: row.japanese,
      mainId: row.main_category_id, subcategoryId: row.subcategory_id,
      // 旧詠唱UI互換：book=メイン、chapter=サブ。
      book: row.main_category_id, chapter: row.subcategory_id,
      categoryIds: [...ids], chunkId: row.chunk_id || null,
      priority: row.priority, difficulty: row.difficulty,
      phraseType: row.phrase_type, note: row.quality_note || '', alt_en: '',
    };
  });
  const phrasesById = new Map(phrases.map((p) => [p.id, p]));
  for (const word of words) {
    if (word.sourcePhraseId && !phrasesById.has(word.sourcePhraseId)) {
      throw new Error(`単語の出典例文が不明：${word.id}`);
    }
  }

  // 教材の表示セットは7メイン・60サブから自動生成。
  // 00は単一の重要コレクション。priority=S はCSVの属性として保持し、教材セットを分割しない。
  const mainCategories = [...mainById.values()].sort((a, b) => a.id.localeCompare(b.id));
  const subcategories = [...subcategoryById.values()].sort((a, b) => a.id.localeCompare(b.id));
  const mainSets = mainCategories.map((c) => ({ ...c, mainId: c.id, kind: 'main', star: 0 }));
  const subSets = subcategories.map((c) => ({ ...c, kind: 'sub', star: 0 }));
  const stones = mainSets;
  const allStones = [...stones, ...subSets];
  const wordsByStone = new Map(allStones.map((s) => [s.id, []]));
  const phrasesByStone = new Map(allStones.map((s) => [s.id, []]));
  for (const word of words) {
    for (const id of word.categoryIds) wordsByStone.get(id)?.push(word);
  }
  for (const phrase of phrases) {
    const groups = new Set([phrase.subcategoryId]);
    for (const subId of phrase.categoryIds) {
      groups.add(subId);
      groups.add(mainIdOf(subId));
    }
    for (const id of groups) phrasesByStone.get(id)?.push(phrase);
  }
  const phrasesByChunk = new Map(chunks.map((c) => [c.id, []]));
  for (const phrase of phrases) if (phrase.chunkId) phrasesByChunk.get(phrase.chunkId).push(phrase);

  // v1.0の元データに含まれる優先度S（単語300件・英作文120件）は保持する。
  // ただし独立セットは生成せず、00からすべての教材を自由に学習する。
  const sWords = words.filter((word) => word.mainId === '00' && word.priority === 'S').length;
  const sPhrases = phrases.filter((phrase) => phrase.mainId === '00' && phrase.priority === 'S').length;
  if (sWords !== 300 || sPhrases !== 120) {
    throw new Error('教材v1.0の優先度Sメタデータが300語／120文と一致しません。');
  }
  return {
    version: '1.0', words, wordsById, phrases, phrasesById, chunks, chunksById,
    mainCategories, subcategories, subcategoryById, phrasesByChunk,
    wordsByStone, phrasesByStone, stones, allStones,
    stonesById: new Map(allStones.map((s) => [s.id, s])),
    // 旧の問題生成・SRS部品はこの同じID/Mapを使える。
    lexicon: {
      stones, allStones, stonesById: new Map(allStones.map((s) => [s.id, s])),
      words, wordsById, wordsByStone, problems: [],
    },
  };
}

let catalogPromise = null;
export function loadLearningCatalog() {
  if (!catalogPromise) {
    catalogPromise = Promise.all(Object.entries(LEARNING_V1_FILES).map(async ([key, name]) => {
      const f = await loadCsv(name);
      if (f.errors?.length) throw new Error(`${name} にCSVエラー：${f.errors[0]}`);
      return [key, f.rows];
    })).then((pairs) => buildLearningCatalog(Object.fromEntries(pairs)))
      .catch((error) => { catalogPromise = null; throw error; });
  }
  return catalogPromise;
}

