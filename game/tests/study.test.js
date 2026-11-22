import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewGame } from '../js/game-state.js';
import { LearningStore } from '../js/storage.js';
import { Scheduler } from '../js/srs.js';
import {
  stoneProgress, nextUnread, stoneAllowed, trialBlock, trialPlan, finishExam, promotionBlock, promotionPlan, starLearnedRatio,
  trainingReward, applyTraining, examWords,
} from '../js/study.js';
import { nextRankStatus, checkRankUp } from '../js/town.js';
import { seededRng } from '../js/dungeon.js';
import { realGameData, realLexicon, readJson, readCsv, MemoryStorage, T0, DAY } from './helpers.js';

const data = realGameData();
const lex = realLexicon();
const sch = new Scheduler(readJson('srs.json'));
const party = ['warrior', 'knight', 'black_mage', 'white_mage'].map((job) => ({ name: job, job, icon: 'x' }));
const today = sch.dayOf(T0);

test('資料室：読み解くと進み具合に入る。報酬はない（お金・経験値は変わらない）', () => {
  const store = new LearningStore(new MemoryStorage());
  const g = createNewGame(data, party);
  const before = JSON.stringify(g);
  const cards = nextUnread(lex, store, 'rs_1_001', 5);
  assert.equal(cards.length, 5);
  store.markRead(cards.map((w) => w.id));
  assert.equal(stoneProgress(lex, store, sch, 'rs_1_001', today).read, 5);
  assert.equal(nextUnread(lex, store, 'rs_1_001', 5)[0].id, lex.wordsByStone.get('rs_1_001')[5].id);
  assert.equal(JSON.stringify(g), before);
  // 記録が残る
  assert.equal(new LearningStore(store.storage).read.size, 5);
});

test('1つ上の★の石：今の★の石をすべて読み解くと持ち込める', () => {
  const store = new LearningStore(new MemoryStorage());
  const s2 = lex.stones.find((s) => s.star === 2);
  assert.equal(stoneAllowed(lex, store, sch, s2, 1, 1, today), false);
  store.markRead(lex.wordsByStone.get('rs_1_001').map((w) => w.id));
  assert.equal(stoneAllowed(lex, store, sch, s2, 1, 1, today), true);
  const s3 = lex.stones.find((s) => s.star === 3);
  assert.equal(stoneAllowed(lex, store, sch, s3, 1, 1, today), false);
  assert.equal(stoneAllowed(lex, store, sch, lex.stones[0], 2, 2, today), false); // ★がダンジョンより低い
});

test('覚醒の試練：すべて読み解くと受けられる。20問・8割で合格。落ちたら次の日', () => {
  const store = new LearningStore(new MemoryStorage());
  const e = readCsv('exams.csv').rows.find((r) => r.id === 'awakening');
  assert.match(trialBlock(data, lex, store, sch, 'rs_1_001', today), /読み解く/);
  store.markRead(lex.wordsByStone.get('rs_1_001').map((w) => w.id));
  assert.equal(trialBlock(data, lex, store, sch, 'rs_1_001', today), '');
  const plan = trialPlan(data, lex, 'rs_1_001', seededRng({ rng: 1 }));
  assert.equal(plan.words.length, Number(e.questions));
  assert.equal(new Set(plan.words).size, plan.words.length);
  assert.ok(plan.words.every((id) => lex.wordsById.get(id).stoneId === 'rs_1_001'));
  const need = Math.ceil(Number(e.questions) * Number(e.pass_rate));
  assert.equal(finishExam(data, store, plan, need - 1, today), false);
  assert.match(trialBlock(data, lex, store, sch, 'rs_1_001', today), /日後/);
  assert.equal(trialBlock(data, lex, store, sch, 'rs_1_001', today + 1), '');
  let awakened = false;
  assert.equal(finishExam(data, store, plan, need, today + 1, () => { store.setAwakened('rs_1_001', today + 1); awakened = true; }), true);
  assert.ok(awakened && stoneProgress(lex, store, sch, 'rs_1_001', today + 1).awakened);
  assert.match(trialBlock(data, lex, store, sch, 'rs_1_001', today + 1), /覚醒/);
});

test('昇格試験：★のルーンを8割習得すると受けられ、合格するとランクが上がる', () => {
  const store = new LearningStore(new MemoryStorage());
  const g = createNewGame(data, party);
  g.rank = 'R01+'; g.rankPoints = 12; g.cleared = { mossy_cave: 1 };
  assert.match(promotionBlock(data, lex, store, sch, g, today), /習得/);
  // ★1の単語を日を空けて3回正解して習得にする
  const words = lex.words.filter((w) => w.star === 1);
  for (const w of words.slice(0, Math.ceil(words.length * 0.8))) {
    let rec = null;
    for (let d = 0; d < 3; d++) rec = sch.review(rec, true, T0 + d * DAY);
    store.set(w.id, rec);
  }
  assert.ok(starLearnedRatio(lex, store, sch, 1).ratio >= 0.8);
  assert.equal(promotionBlock(data, lex, store, sch, g, today), '');
  assert.deepEqual(nextRankStatus(data, g).needs, ['昇格試験に合格する（ギルドの資料室のとなり）']);
  const plan = promotionPlan(data, lex, g, seededRng({ rng: 2 }));
  assert.equal(plan.rankId, 'R02');
  assert.ok(plan.words.every((id) => lex.wordsById.get(id).star === 1));
  finishExam(data, store, plan, plan.words.length, today, () => { g.examsPassed.push(plan.rankId); checkRankUp(data, g); });
  assert.equal(g.rank, 'R02');
});

test('鍛錬：正解で経験値か AP。日数は進まず、お金も素材も入らない', () => {
  const g = createNewGame(data, party);
  const before = { day: g.day, gold: g.gold, mats: JSON.stringify(g.storage.materials) };
  const m = g.party[0];
  const r = trainingReward(data, g, m, 'xp', 15, 15);
  const r0 = trainingReward(data, g, m, 'xp', 0, 15);
  assert.ok(r.xp > r0.xp && r0.xp > 0);
  applyTraining(data, g, 0, r);
  assert.ok(m.lv > 1 || m.xp > 0);
  const ap = trainingReward(data, g, m, 'ap', 15, 15);
  assert.equal(ap.ap, 3);
  assert.deepEqual({ day: g.day, gold: g.gold, mats: JSON.stringify(g.storage.materials) }, before);
  // 強くなりすぎると減る（今の★のいちばん強い敵より5レベル上で0）
  m.lv = 40;
  assert.equal(trainingReward(data, g, m, 'xp', 15, 15).xp, 0);
});

test('問題にする単語：足りなければくり返す', () => {
  const ws = [{ id: 'a' }, { id: 'b' }];
  assert.equal(examWords(ws, 5, seededRng({ rng: 3 })).length, 5);
});
