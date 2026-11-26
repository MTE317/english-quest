// 英語学習の昇格資格・二分野試験をRPGの戦闘ランクから分離する。
// しきい値は v1.0 基本教材だけでは上位ランクへ届かない長期目標（仮値）。
export const PROMOTION_REQUIREMENTS = Object.freeze({
  D: { words: 0, phrases: 0 }, C: { words: 0, phrases: 0 },
  B: { words: 0, phrases: 0 }, A: { words: 0, phrases: 0 }, S: { words: 0, phrases: 0 },
});
export const EXAM_DEFAULTS = Object.freeze({ words: 20, phrases: 10, passRate: 0.8 });
export const FINAL_DEFAULTS = Object.freeze({ words: 30, phrases: 20, passRate: 0.8 });
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
  const wordIds = masteredWordIds(store);
  const phraseIds = masteredPhraseIds(game);
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

export function makePromotionExam(catalog, store, game, rankId, rng = Math.random) {
  const config = rankId === 'S' ? FINAL_DEFAULTS : EXAM_DEFAULTS;
  const wordRecords = [...store.entries()].map(([id]) => id);
  const phraseRecords = Object.keys(game.chants?.records ?? {});
  // 未学習の高難度教材をむやみに選ばず、実際に取り組んだ範囲から均等に出題する。
  const wordPool = catalog.words.filter((word) => wordRecords.includes(word.id));
  const phrasePool = catalog.phrases.filter((phrase) => phraseRecords.includes(phrase.id));
  if (!wordPool.length || !phrasePool.length) throw new Error('単語と英作文の両方を学習してください。');
  return {
    rankId,
    words: sample(wordPool, config.words, rng),
    phrases: sample(phrasePool, config.phrases, rng),
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
  const passed = score >= Math.ceil(total * passRate - 1e-9);
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
