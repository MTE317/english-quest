const GRADES = { good: 3, hard: 2, again: 1 };

export function chantDay(game, config, today) {
  const state = game.chants;
  const choice = state?.option ?? config.daily_default;
  const limit = config.daily_options[choice] ?? config.daily_options[0];
  const daily = state?.daily?.day === today ? state.daily : { day: today, count: 0, introduced: 0 };
  return { records: state?.records ?? {}, daily, limit, choice };
}

export function nextChant(game, config, scheduler, today, all, selected, seen) {
  const { records, daily, limit } = chantDay(game, config, today);
  const due = all.filter((c) => !seen.has(c.id) && scheduler.isDue(records[c.id], today));
  if (due.length) return due.sort((a, b) => records[a.id].due - records[b.id].due)[0];
  if (daily.introduced < limit.new) {
    const next = selected.find((c) => !seen.has(c.id) && !records[c.id]);
    if (next) return next;
  }
  return selected.filter((c) => !seen.has(c.id) && records[c.id])
    .sort((a, b) => records[a.id].due - records[b.id].due)[0] ?? null;
}

export function recordChant(game, config, scheduler, ms, id, gradeId) {
  const grade = config.grades[gradeId];
  if (!grade || !GRADES[grade.fsrs]) throw new Error('評価が正しくありません。');
  const { records, daily, limit, choice } = chantDay(game, config, scheduler.dayOf(ms));
  const first = !records[id];
  if (first && daily.introduced >= limit.new) throw new Error('今日の新しい文の上限に達しました。');
  const award = !config.jp_only_within_daily || daily.count < limit.questions ? grade.jp : 0;
  game.chants = {
    option: choice,
    daily: { day: daily.day, count: daily.count + 1, introduced: daily.introduced + Number(first) },
    records: { ...records, [id]: scheduler.reviewGrade(records[id], GRADES[grade.fsrs], ms) },
  };
  game.jp = (game.jp ?? 0) + award;
  return award;
}
