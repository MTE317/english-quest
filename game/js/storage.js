// ブラウザへの保存（localStorage）。
// 学習記録とゲームの進み具合は別のキーに保存する。全滅でゲームの進み具合を戻しても、学習記録はそのまま残すため。
//   学習記録   … LEARNING_KEY（単語ごとの状態・次の復習日・連続正解数・正誤の数）
//   進み具合   … PROGRESS_KEY（まだ使っていない。町・ダンジョンを作るときに使う）

export const LEARNING_KEY = 'englishQuest.learning.v1';
export const PROGRESS_KEY = 'englishQuest.progress.v1';
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

function safeStorage(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** 学習記録。get / set で1語ずつ扱い、set のたびに保存する。 */
export class LearningStore {
  constructor(storage) {
    this.storage = safeStorage(storage);
    this.words = new Map();
    this.load();
  }
  load() {
    this.words.clear();
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(LEARNING_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      for (const [id, a] of Object.entries(obj.words ?? {})) this.words.set(id, unpack(a));
    } catch (e) {
      console.warn('学習記録を読めなかった', e);
    }
  }
  save() {
    if (!this.storage) return;
    const words = {};
    for (const [id, rec] of this.words) words[id] = pack(rec);
    this.storage.setItem(LEARNING_KEY, JSON.stringify({ v: 1, words }));
  }
  get(id) { return this.words.get(id) ?? null; }
  set(id, rec) { this.words.set(id, rec); this.save(); }
  entries() { return this.words.entries(); }
  get size() { return this.words.size; }
  /** 保存している文字数（容量の目安） */
  byteSize() { return this.storage?.getItem(LEARNING_KEY)?.length ?? 0; }
  clear() { this.words.clear(); this.storage?.removeItem(LEARNING_KEY); }
}

/** ゲームの進み具合だけを消す（全滅したときなど）。学習記録には触らない。 */
export function clearProgress(storage) {
  safeStorage(storage)?.removeItem(PROGRESS_KEY);
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
