// 瞬間英作文・チャンク反復は自己判定。転職JPは廃止し、SRSと学習実績だけを記録する。
const GRADES = { good: 3, hard: 2, again: 1 };

export function chantDay(game, config, today) {
  const state = game.chants;
  const choice = state?.option ?? config.daily_default ?? 0;
  const limit = config.daily_options?.[choice] ?? { questions: 10, new: 10 };
  const daily = state?.daily?.day === today ? state.daily : { day: today, count: 0, introduced: 0 };
  return { records: state?.records ?? {}, daily, limit, choice };
}

export function nextChant(game, config, scheduler, today, all, selected, seen) {
  const { records } = chantDay(game, config, today);
  const due = all.filter((c) => !seen.has(c.id) && scheduler.isDue(records[c.id], today));
  if (due.length) return due.sort((a, b) => records[a.id].due - records[b.id].due)[0];
  return selected.find((c) => !seen.has(c.id) && !records[c.id])
    ?? selected.find((c) => !seen.has(c.id) && records[c.id]) ?? null;
}

export function recordChant(game, config, scheduler, ms, id, gradeId) {
  const grade = config.grades[gradeId];
  if (!grade || !GRADES[grade.fsrs]) throw new Error('評価が正しくありません。');
  const today = scheduler.dayOf(ms);
  const { records, daily, choice } = chantDay(game, config, today);
  const previous = records[id] ?? null;
  const updated = scheduler.reviewGrade(previous, GRADES[grade.fsrs], ms);
  const mastered = new Set(game.chants?.masteredIds ?? []);
  if (previous?.stage === 'learned') mastered.add(id);
  if (updated.stage === 'learned') mastered.add(id);
  const dayHistory = { ...(game.chants?.dailyHistory ?? {}) };
  const history = dayHistory[today] ?? { answered: 0, good: 0, hard: 0, again: 0 };
  dayHistory[today] = { ...history, answered: history.answered + 1,
    [grade.fsrs]: (history[grade.fsrs] ?? 0) + 1 };
  game.chants = {
    option: choice,
    daily: { day: today, count: daily.count + 1, introduced: daily.introduced + Number(!previous) },
    records: { ...records, [id]: updated },
    masteredIds: [...mastered],
    dailyHistory: dayHistory,
  };
  return updated;
}
