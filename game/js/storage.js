// ブラウザへの保存（localStorage）。
// 学習記録とゲームの進み具合は別のキーに保存する。全滅でゲームの進み具合を戻しても、学習記録はそのまま残すため。
//   学習記録   … LEARNING_KEY（単語ごとの状態・次の復習日・連続正解数・正誤の数、日ごとの合計）
//   進み具合   … SAVE_KEY（save.js が扱う。自動保存は1つだけ）

export const LEARNING_KEY = 'englishQuest.learning.v2';
export const SAVE_KEY = 'englishQuest.save.v2';
/** @deprecated SAVE_KEY と同じ */
export const PROGRESS_KEY = SAVE_KEY;
const DEBUG_DAY_OFFSET_KEY = 'englishQuest.debug.dayOffset';

// 1語ぶんの記録は配列で保存して小さくする（15,000語で1MB未満にするため）
// [s, d, last, due, correct, wrong, streak, streakDay, stage]
const STAGE_CODE = { learning: 1, learned: 2 };
const CODE_STAGE = { 1: 'learning', 2: 'learned' };

function pack(rec) {
  return [rec.s, rec.d, rec.last, rec.due, rec.correct, rec.wrong, rec.streak, rec.streakDay ?? -1, STAGE_CODE[rec.stage] ?? 1];
}
function unpack(a) {
  return {
    s: a[0], d: a[1], last: a[2], due: a[3], correct: a[4], wrong: a[5], streak: a[6],
    streakDay: a[7] < 0 ? null : a[7], stage: CODE_STAGE[a[8]] ?? 'learning',
  };
}

export function safeStorage(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** 旧覚醒の達成日は確認テストの履歴として残す。点数や受験回数は推測しない。 */
function migrateConfirmationHistory(exams, awakened) {
  let changed = false;
  const ids = new Set([
    ...Object.keys(awakened),
    ...Object.keys(exams).filter((key) => key.startsWith('awakening:')).map((key) => key.slice('awakening:'.length)),
  ]);
  for (const id of ids) {
    const key = `confirmation:${id}`;
    if (exams[key]) continue;
    const legacy = exams[`awakening:${id}`] ?? {};
    const passedDays = [legacy.passedDay, awakened[id]?.day].filter(Number.isFinite);
    const passedDay = passedDays.length ? Math.min(...passedDays) : null;
    const lastFailDay = Number.isFinite(legacy.lastFailDay) ? legacy.lastFailDay : null;
    const days = [passedDay, lastFailDay].filter(Number.isFinite);
    exams[key] = {
      ...legacy, firstPassedDay: passedDay, passedDay,
      lastDay: days.length ? Math.max(...days) : null,
      lastPassed: passedDay != null && (lastFailDay == null || passedDay >= lastFailDay),
      legacyImported: true,
    };
    changed = true;
  }
  return changed;
}

/** 学習記録。get / set で1語ずつ扱い、set のたびに保存する。 */
export class LearningStore {
  constructor(storage) {
    this.storage = safeStorage(storage);
    this.words = new Map();
    this.daily = new Map(); // 学習の日付 → { answered, correct }
    this.read = new Set(); // 資料室で読み解いたルーン
    this.awakened = {}; // 旧版の覚醒履歴。能力・出題条件には使わず、互換のため保存する。
    this.exams = {}; // 試験 → { lastFailDay, passedDay }
    this.load();
  }
  load() {
    this.words.clear();
    this.daily.clear();
    this.read = new Set();
    this.awakened = {};
    this.exams = {};
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(LEARNING_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      for (const [id, a] of Object.entries(obj.words ?? {})) this.words.set(id, unpack(a));
      for (const [day, a] of Object.entries(obj.daily ?? {})) this.daily.set(Number(day), { answered: a[0], correct: a[1] });
      this.read = new Set(obj.read ?? []);
      this.awakened = obj.awakened ?? {};
      this.exams = obj.exams ?? {};
      if (migrateConfirmationHistory(this.exams, this.awakened)) this.save();
    } catch (e) {
      console.warn('学習記録を読めなかった', e);
    }
  }
  save() {
    if (!this.storage) return;
    const words = {};
    for (const [id, rec] of this.words) words[id] = pack(rec);
    const daily = {};
    for (const [day, t] of this.daily) daily[day] = [t.answered, t.correct];
    this.storage.setItem(LEARNING_KEY, JSON.stringify({
      v: 1, words, daily, read: [...this.read], awakened: this.awakened, exams: this.exams,
    }));
  }
  get(id) { return this.words.get(id) ?? null; }
  set(id, rec) { this.words.set(id, rec); this.save(); }
  /** 1問答えたことを記録する：単語の記録を置きかえ、その日の合計（解いた数・正解数）を足して保存 */
  recordAnswer(id, rec, day, correct) {
    this.words.set(id, rec);
    const t = this.daily.get(day) ?? { answered: 0, correct: 0 };
    this.daily.set(day, { answered: t.answered + 1, correct: t.correct + (correct ? 1 : 0) });
    this.save();
  }
  /** その日の合計 */
  dailyTotal(day) { return this.daily.get(day) ?? { answered: 0, correct: 0 }; }
  entries() { return this.words.entries(); }
  get size() { return this.words.size; }
  /** 保存している文字数（容量の目安） */
  byteSize() { return this.storage?.getItem(LEARNING_KEY)?.length ?? 0; }
  /** 資料室で読み解いた（予習カードを見た） */
  markRead(ids) { for (const id of ids) this.read.add(id); this.save(); }
  isRead(id) { return this.read.has(id) || this.words.has(id); }
  /** @deprecated 旧データを扱う場合だけ使用。新しい確認テストは recordConfirmation で記録する。 */
  setAwakened(stoneId, day) {
    this.awakened[stoneId] = { day };
    migrateConfirmationHistory(this.exams, this.awakened);
    this.save();
  }
  confirmationResult(stoneId) { return this.exams[`confirmation:${stoneId}`] ?? null; }
  /** 任意テストは何度でも受けられる。結果だけを記録し、ゲームの進み具合は変えない。 */
  recordConfirmation(stoneId, { correct, total, day, passed }) {
    if (!Number.isInteger(total) || total <= 0 || !Number.isInteger(correct) || correct < 0 || correct > total) {
      throw new Error('確認テストの回答数が正しくありません。');
    }
    const previous = this.confirmationResult(stoneId) ?? {};
    const rate = correct / total;
    const best = previous.bestRate == null || rate > previous.bestRate;
    this.setExam(`confirmation:${stoneId}`, {
      attempts: (previous.attempts ?? 0) + 1,
      lastDay: day, lastCorrect: correct, lastTotal: total, lastPassed: passed,
      firstPassedDay: previous.firstPassedDay ?? previous.passedDay ?? (passed ? day : null),
      passedDay: passed ? day : previous.passedDay ?? null,
      lastFailDay: passed ? previous.lastFailDay ?? null : day,
      ...(best ? { bestRate: rate, bestCorrect: correct, bestTotal: total } : {}),
    });
  }
  setExam(key, value) { this.exams[key] = { ...(this.exams[key] ?? {}), ...value }; this.save(); }
  clear() {
    this.words.clear(); this.daily.clear(); this.read = new Set(); this.awakened = {}; this.exams = {};
    this.storage?.removeItem(LEARNING_KEY);
  }
}

/** ゲームの進み具合（自動保存）だけを消す。学習記録には触らない。 */
export function clearProgress(storage) {
  safeStorage(storage)?.removeItem(SAVE_KEY);
}

// ---- 動作確認用：日付をずらす ----
export function getDebugDayOffset(storage) {
  return Number(safeStorage(storage)?.getItem(DEBUG_DAY_OFFSET_KEY) ?? 0) || 0;
}
export function setDebugDayOffset(days, storage) {
  const s = safeStorage(storage);
  if (!s) return;
  if (days) s.setItem(DEBUG_DAY_OFFSET_KEY, String(days));
  else s.removeItem(DEBUG_DAY_OFFSET_KEY);
}
/** いまの時刻（動作確認用のずらしを含む） */
export function now(storage) {
  return Date.now() + getDebugDayOffset(storage) * 86400000;
}

const SETTINGS_KEY = 'englishQuest.settings.v1';

export function loadSettings(storage) {
  try { return JSON.parse(safeStorage(storage)?.getItem(SETTINGS_KEY) || '{}') ?? {}; }
  catch { return {}; }
}

export function saveSettings(settings, storage) {
  safeStorage(storage)?.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
