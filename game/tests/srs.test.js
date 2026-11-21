import test from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler, STAGE, dayIndex } from '../js/srs.js';
import { LearningStore, LEARNING_KEY, PROGRESS_KEY, clearProgress } from '../js/storage.js';
import { readJson, MemoryStorage, DAY, T0 } from './helpers.js';

const sch = new Scheduler(readJson('srs.json'));

test('srs.json の desired_retention を使う', () => {
  assert.equal(sch.retention, readJson('srs.json').desired_retention);
  assert.ok(!sch.usedFallbacks.includes('desired_retention'));
  assert.ok(!sch.usedFallbacks.includes('new_per_run'));
});

test('次の復習日は、思い出せる確率が約9割に下がるころ', () => {
  const rec = sch.review(null, true, T0);
  const t = rec.due - rec.last;
  const r = sch.retrievability(t, rec.s);
  assert.ok(Math.abs(r - 0.9) < 0.03, `R=${r}`);
});

test('正解が続くと間隔が伸び、間違えると縮む', () => {
  let rec = null;
  let t = T0;
  const intervals = [];
  for (let i = 0; i < 4; i++) {
    rec = sch.review(rec, true, t);
    intervals.push(rec.due - rec.last);
    t += (rec.due - rec.last) * DAY;
  }
  for (let i = 1; i < intervals.length; i++) assert.ok(intervals[i] > intervals[i - 1], intervals.join(','));
  const before = rec.s;
  rec = sch.review(rec, false, t);
  assert.ok(rec.s < before);
  assert.equal(rec.due - rec.last, 1);
});

test('日を空けて3回続けて正解で習得。同じ日の正解は1回分', () => {
  let rec = sch.review(null, true, T0);
  rec = sch.review(rec, true, T0 + 1000);
  assert.equal(rec.streak, 1);
  rec = sch.review(rec, true, T0 + DAY);
  assert.equal(rec.stage, STAGE.LEARNING);
  rec = sch.review(rec, true, T0 + 3 * DAY);
  assert.equal(rec.streak, 3);
  assert.equal(rec.stage, STAGE.LEARNED);
  rec = sch.review(rec, false, T0 + 10 * DAY);
  assert.equal(rec.streak, 0);
  assert.equal(rec.stage, STAGE.LEARNING);
  assert.equal(rec.wrong, 1);
  assert.equal(rec.correct, 4);
});

test('かすれたルーンが多いと新出を減らす', () => {
  const srs = readJson('srs.json');
  assert.equal(sch.newLimitFor(0), srs.new_per_run[1]);
  assert.equal(sch.newLimitFor(srs.reduce_new_when_due_over + 1), srs.reduced_new_per_run);
});

test('学習記録とゲームの進み具合は別のキー。進み具合を消しても学習記録は残る', () => {
  const mem = new MemoryStorage();
  const store = new LearningStore(mem);
  const rec = sch.review(null, true, T0);
  store.set('lx_r1_001', rec);
  mem.setItem(PROGRESS_KEY, '{"gold":100}');
  clearProgress(mem);
  assert.equal(mem.getItem(PROGRESS_KEY), null);
  const again = new LearningStore(mem);
  assert.deepEqual(again.get('lx_r1_001'), rec);
  assert.ok(mem.getItem(LEARNING_KEY));
});

test('15,000語の学習記録が1MB未満', () => {
  const mem = new MemoryStorage();
  const store = new LearningStore(mem);
  let rec = sch.review(null, true, T0);
  rec = sch.review(rec, true, T0 + 5 * DAY);
  for (let i = 0; i < 15000; i++) store.words.set(`lx_r12_${String(i).padStart(5, '0')}`, rec);
  store.save();
  assert.ok(store.byteSize() < 1024 * 1024, `${store.byteSize()} bytes`);
});

test('dayIndex はローカルの日付で切り替わる', () => {
  const a = new Date(2026, 10, 21, 0, 1).getTime();
  const b = new Date(2026, 10, 21, 23, 59).getTime();
  assert.equal(dayIndex(a), dayIndex(b));
  assert.equal(dayIndex(b + 2 * 60000), dayIndex(a) + 1);
});
