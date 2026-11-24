import { gainXp } from './character.js?v=build36-1';
// 短時間で学べる訓練場。教材選択とRPG報酬は学習記録から分離する。
export const TRAINING_COUNTS = Object.freeze([5, 10, 15]);
export const TRAINING_XP_RATIO = 0.10;
export const TRAINING_AP_RATIO = 0.10;
export const DUE_BONUS = 1.20;
export const TRAINING_AP_QUESTIONS_PER_BATTLE = 5;

const recFor = (entry, store, game) => entry.kind === 'word'
  ? store.get(entry.item.id) : game.chants?.records?.[entry.item.id] ?? null;
const keyOf = (entry) => `${entry.kind}:${entry.item.id}`;
const unique = (values) => [...new Map(values.map((item) => [item.id, item])).values()];

/**
 * 選択セットの新規・期限到来・誤答履歴から出題。
 * 複数カテゴリーに所属しても同じIDは一度だけ候補にする。
 * mode: mixed | words | phrases | chunks | review
 */
export function makeTrainingPicker(catalog, store, game, scheduler, today,
  { mode = 'mixed', setId = '00:S', chunkId = '' } = {}) {
  const words = ['mixed', 'words', 'review'].includes(mode)
    ? unique(setId === 'all' ? catalog.words : catalog.wordsByStone.get(setId) ?? []) : [];
  const phrases = mode === 'chunks'
    ? unique(catalog.phrasesByChunk.get(chunkId) ?? [])
    : ['mixed', 'phrases', 'review'].includes(mode)
      ? unique(setId === 'all' ? catalog.phrases : catalog.phrasesByStone.get(setId) ?? []) : [];
  const entries = [...words.map((item) => ({ kind: 'word', item })),
    ...phrases.map((item) => ({ kind: 'phrase', item }))];
  const candidates = entries.map((entry) => {
    const record = recFor(entry, store, game);
    return { ...entry, record, due: scheduler.isDue(record, today),
      wrong: (record?.wrong ?? 0) > 0, fresh: !record };
  });
  const seen = new Set();
  const retries = [];
  let asked = 0;
  const taken = new Set();
  const pick = (pool, reason) => {
    const entry = pool.find((candidate) => !seen.has(keyOf(candidate)));
    if (!entry) return null;
    const key = keyOf(entry);
    seen.add(key);
    asked += 1;
    return { kind: entry.kind, item: entry.item, reason, wasDue: entry.due, key };
  };
  return {
    size: candidates.length,
    next() {
      const ri = retries.findIndex((retry) => retry.after <= asked);
      if (ri >= 0) { const entry = retries.splice(ri, 1)[0].entry;
        asked++; return { ...entry, reason: 'retry' }; }
      const sortedDue = candidates.filter((e) => e.due)
        .sort((a, b) => a.record.due - b.record.due);
      let result = pick(sortedDue, 'due');
      if (!result) result = pick(candidates.filter((e) => e.wrong), 'retry');
      if (!result && mode !== 'review') result = pick(candidates.filter((e) => e.fresh), 'new');
      if (!result && mode !== 'review') result = pick(candidates, 'practice');
      if (!result && retries.length) {
        asked++;
        return { ...retries.shift().entry, reason: 'retry' };
      }
      return result;
    },
    report(entry, passed) {
      if (passed || taken.has(entry.key)) return;
      taken.add(entry.key);
      retries.push({ entry, after: asked + 3 });
    },
  };
}

/**
 * 6人全員へ少量のXP・APを加算する。単語/英作文の自己評価とは独立して基礎報酬を付け、
 * 期限到来の初回正答のみ1.2倍。1項目1日1回のため連打しても稼げない。
 * XP/APは小数繰越を記録して、実際に使えるAPは整数だけにする。
 */
export function rewardTrainingAnswer(data, game,
  { kind, id, day, due = false, passed = false }) {
  if (!['word', 'phrase'].includes(kind) || !id || !Number.isInteger(day)) throw new Error('訓練の報酬記録が不正です');
  if (game.trainingRewardDay !== day) {
    game.trainingRewardDay = day;
    game.trainingRewardIds = [];
  }
  const key = `${kind}:${id}`;
  if (game.trainingRewardIds.includes(key)) return { awarded: false, members: [] };
  game.trainingRewardIds.push(key);
  const multiplier = due && passed ? DUE_BONUS : 1;
  const baseXp = (Number(game.xpPerQuestion) || 5) * TRAINING_XP_RATIO * multiplier;
  const baseAp = (Number(data.balance.rewards?.ap_per_battle) || 2)
    / TRAINING_AP_QUESTIONS_PER_BATTLE * TRAINING_AP_RATIO * multiplier;
  const members = (game.party ?? []).map((member) => {
    member.trainingCredit ??= { xp: 0, ap: {} };
    member.trainingCredit.ap ??= {};
    const storedXp = member.trainingCredit.xp ?? 0;
    const totalXp = storedXp + baseXp;
    const xp = Math.floor(totalXp + 1e-9);
    member.trainingCredit.xp = Math.round((totalXp - xp) * 1e6) / 1e6;
    const job = member.job;
    const storedAp = member.trainingCredit.ap[job] ?? 0;
    const totalAp = storedAp + baseAp;
    const ap = Math.floor(totalAp + 1e-9);
    member.trainingCredit.ap[job] = Math.round((totalAp - ap) * 1e6) / 1e6;
    // gainXp と同じ関数を共有し、訓練場だけ別のレベル計算にしない。
    return { member, xp, ap };
  });
  return { awarded: true, members };
}

export function applyTrainingAnswer(data, game, input) {
  const result = rewardTrainingAnswer(data, game, input);
  if (!result.awarded) return { awarded: false, xp: 0, ap: 0 };
  let xp = 0; let ap = 0;
  for (const reward of result.members) {
    if (reward.xp) {
      gainXp(data, reward.member, reward.xp);
      xp += reward.xp;
    }
    if (reward.ap) {
      reward.member.ap[reward.member.job] = (reward.member.ap[reward.member.job] ?? 0) + reward.ap;
      ap += reward.ap;
    }
  }
  return { awarded: true, xp, ap };
}
