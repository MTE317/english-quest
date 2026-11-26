// 単語30問と瞬間英作文15問の昇級試験。習得数ではなく実際の学習履歴から出題する。
export const PROMOTION_REQUIREMENTS = Object.freeze({
  D: { words: 30, phrases: 15 }, C: { words: 30, phrases: 15 },
  B: { words: 30, phrases: 15 }, A: { words: 30, phrases: 15 }, S: { words: 30, phrases: 15 },
});
export const EXAM_RULES = Object.freeze({
  D: { words: 30, phrases: 15, wordPool: 60, phrasePool: 30, passRate: 0.8 },
  C: { words: 30, phrases: 15, wordPool: 60, phrasePool: 30, passRate: 0.8 },
  B: { words: 30, phrases: 15, passRate: 0.8 },
  A: { words: 30, phrases: 15, passRate: 0.9 },
  S: { words: 30, phrases: 15, passRate: 1 },
});
export const PHRASE_GRADE_SCORES = Object.freeze({ o: 1, t: 0.5, x: 0 });

export function masteredWordIds(store) {
  return new Set([...(store.everLearned ?? []),
    ...[...store.entries()].filter(([, record]) => record?.stage === 'learned').map(([id]) => id)]);
}
export function masteredPhraseIds(game) {
  return new Set([...(game?.chants?.masteredIds ?? []),
    ...Object.entries(game?.chants?.records ?? {})
      .filter(([, record]) => record?.stage === 'learned').map(([id]) => id)]);
}

export function promotionProgress(catalog, store, game, rankId) {
  const required = PROMOTION_REQUIREMENTS[rankId] ?? { words: 0, phrases: 0 };
  const wordIds = new Set([...store.entries()].map(([id]) => id));
  const phraseIds = new Set(Object.keys(game?.chants?.records ?? {}));
  const words = catalog.words.filter((item) => wordIds.has(item.id)).length;
  const phrases = catalog.phrases.filter((item) => phraseIds.has(item.id)).length;
  return { required, words, phrases, wordMet: words >= required.words,
    phraseMet: phrases >= required.phrases };
}

export function promotionExamState(store, rankId) {
  const record = store.exams?.[`promotion:${rankId}`] ?? {};
  return { wordPassed: Boolean(record.wordPassed), phrasePassed: Boolean(record.phrasePassed),
    wordScore: record.wordScore, phraseScore: record.phraseScore,
    lastFailDay: record.lastFailDay };
}

function sample(items, count, rng) {
  const pool = items.slice();
  const selected = [];
  for (let i = 0; i < count && pool.length; i++) {
    selected.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return selected;
}

function recentPool(items, records, limit, rng) {
  if (!limit) return items;
  // 同日の学習項目が教材の並び順へ偏らないよう、抽出前に順序を混ぜる。
  return sample(items, items.length, rng)
    .sort((a, b) => (Number(records[b.id]?.last) || 0) - (Number(records[a.id]?.last) || 0))
    .slice(0, limit);
}

export function makePromotionExam(catalog, store, game, rankId, rng = Math.random) {
  const config = EXAM_RULES[rankId];
  if (!config) throw new Error('このランクに昇級試験はありません。');
  // 未学習の高難度教材をむやみに選ばず、実際に取り組んだ範囲から均等に出題する。
  const wordRecords = Object.fromEntries(store.entries());
  const phraseRecords = game?.chants?.records ?? {};
  const wordPool = catalog.words.filter(word => wordRecords[word.id]);
  const phrasePool = catalog.phrases.filter(phrase => phraseRecords[phrase.id]);
  if (wordPool.length < config.words || phrasePool.length < config.phrases) {
    throw new Error(`受験には異なる単語${config.words}件と英作文${config.phrases}件の学習履歴が必要です。`);
  }
  return {
    rankId,
    words: sample(recentPool(wordPool, wordRecords, config.wordPool, rng), config.words, rng),
    phrases: sample(recentPool(phrasePool, phraseRecords, config.phrasePool, rng), config.phrases, rng),
    passRate: config.passRate,
  };
}

export function scorePhraseGrades(grades) {
  return grades.reduce((acc, grade) => acc + (PHRASE_GRADE_SCORES[grade] ?? 0), 0);
}

export function recordPromotionPart(store, rankId, kind, score, total, day, passRate = 0.8) {
  if (!['word', 'phrase'].includes(kind) || !Number.isFinite(score) || !Number.isInteger(total) || total <= 0 || score < 0 || score > total) {
    throw new Error('昇格試験の採点値が不正です。');
  }
  const passed = score >= total * passRate - 1e-9;
  const key = `promotion:${rankId}`;
  const prior = store.exams[key] ?? {};
  store.setExam(key, {
    [kind + 'Passed']: Boolean(prior[kind + 'Passed']) || passed,
    [kind + 'Score']: score, [kind + 'Total']: total, [kind + 'Day']: day,
    lastFailDay: passed ? prior.lastFailDay ?? null : day,
  });
  const now = promotionExamState(store, rankId);
  return { passed, complete: now.wordPassed && now.phrasePassed, ...now };
}
