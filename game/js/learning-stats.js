import { masteredWordIds, masteredPhraseIds } from './promotion.js';

export function learningStatistics(catalog, store, game, scheduler, today) {
  const wordMasteredIds = masteredWordIds(store);
  const phraseMasteredIds = masteredPhraseIds(game);
  const phraseRecords = game?.chants?.records ?? {};
  const words = catalog.words;
  const phrases = catalog.phrases;
  const uniqueKnownWords = words.filter((w) => store.get(w.id) != null);
  const uniqueKnownPhrases = phrases.filter((p) => phraseRecords[p.id] != null);
  const dueWords = uniqueKnownWords.filter((w) => scheduler.isDue(store.get(w.id), today)).length;
  const duePhrases = uniqueKnownPhrases.filter((p) => scheduler.isDue(phraseRecords[p.id], today)).length;
  const currentWords = uniqueKnownWords.filter((w) => store.get(w.id).stage === 'learned').length;
  const currentPhrases = uniqueKnownPhrases.filter((p) => phraseRecords[p.id].stage === 'learned').length;

  const chunks = catalog.chunks.map((chunk) => {
    const examples = catalog.phrasesByChunk.get(chunk.id) ?? [];
    const trained = examples.filter((p) => phraseRecords[p.id]).length;
    const learned = examples.filter((p) => phraseMasteredIds.has(p.id)).length;
    const mastered = examples.length >= 2 && learned >= 2 && learned / examples.length >= 0.7;
    return { ...chunk, examples: examples.length, trained, learned, mastered };
  });
  const days = new Map();
  for (const [day, row] of store.daily) days.set(Number(day), {
    day: Number(day), words: row.answered, phrases: 0, wordCorrect: row.correct,
  });
  for (const [day, row] of Object.entries(game?.chants?.dailyHistory ?? {})) {
    const current = days.get(Number(day)) ?? { day: Number(day), words: 0, phrases: 0, wordCorrect: 0 };
    current.phrases += row.answered ?? 0;
    days.set(Number(day), current);
  }
  const main = catalog.mainCategories.map((category) => {
    const wordSet = catalog.wordsByStone.get(category.id) ?? [];
    const phraseSet = catalog.phrasesByStone.get(category.id) ?? [];
    return {
      ...category, words: wordSet.length,
      wordLearned: wordSet.filter((w) => wordMasteredIds.has(w.id)).length,
      phrases: phraseSet.length,
      phraseLearned: phraseSet.filter((p) => phraseMasteredIds.has(p.id)).length,
    };
  });
  return {
    words: { total: words.length, started: uniqueKnownWords.length, masteredEver: words.filter((w) => wordMasteredIds.has(w.id)).length,
      masteredNow: currentWords, due: dueWords },
    phrases: { total: phrases.length, started: uniqueKnownPhrases.length,
      masteredEver: phrases.filter((p) => phraseMasteredIds.has(p.id)).length,
      masteredNow: currentPhrases, due: duePhrases },
    chunks: { total: chunks.length, started: chunks.filter((c) => c.trained > 0).length,
      mastered: chunks.filter((c) => c.mastered).length, detail: chunks },
    days: [...days.values()].sort((a, b) => b.day - a.day),
    main,
  };
}
