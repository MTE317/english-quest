import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { cancelBattleQuestion } from '../js/battle-question.js';

const source = readFileSync(new URL('../js/ui/battle-view.js', import.meta.url), 'utf8');
const cut = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const uiCode = cut('  function ask(action)', '  function actionLabel(action)')
  + cut('  function showQuestion()', '  function pronounce(text)');
function harness({ timed = false, review = false } = {}) {
  let clock = 1000, nextTimer = 1, currentPanel;
  const timers = new Map();
  const calls = { draws: 0, questions: 0, reviews: 0, answers: 0, resolves: 0, saves: 0, commands: 0, bleed: 0, stops: 0 };
  const word = { id: 'word1', en: 'test', ja: 'テスト' };
  const el = (tag, attrs = {}, ...children) => ({ tag, attrs, children: children.flat(Infinity).filter(x => x != null && x !== false) });
  const ctx = vm.createContext({
    cancelBattleQuestion, el, settings: {}, REASON_LABEL: { new: '新規', practice: '練習' },
    Date: { now: () => clock }, now: () => clock,
    b: { turn: { side: 'ally', i: 0 }, pending: null },
    g: { party: [{ name: 'A', hp: 100, mp: 10, ultimateGauge: 100 }] },
    run: { timeLimit: timed ? 10 : 0, ...(review ? { questionPool: ['word1'], challenge: 'arena' } : {}) },
    data: { balance: {} }, lex: { wordsById: new Map([[word.id, word]]) },
    picker: { next() { calls.draws++; return { word, reason: 'new' }; }, toState() { return { draws: calls.draws }; }, report() {} },
    scheduler: { isFamiliar: () => false, review() { calls.reviews++; return {}; }, dayOf: () => 1 },
    store: { get: () => ({}), recordAnswer() { calls.answers++; } },
    session: { save() { calls.saves++; } }, saveProgress() { calls.saves++; },
    questionDirection: direction => direction, DIRECTION: { EN_JA: 'en-ja' },
    questionSpeech: () => ({ prompt: 'test', answer: 'test' }),
    makePracticeQuestion() {
      calls.questions++;
      return { format: 'meaning', direction: 'en-ja', prompt: 'test',
        choices: [{ text: '正解' }, { text: 'B' }, { text: 'C' }, { text: 'D' }], answerIndex: 0 };
    },
    collectBattleHits: (_battle, fn) => { fn(); return []; },
    prepareQuizAction(_data, _game, battle) {
      if (!battle.turn.bleedProcessed) { calls.bleed++; battle.turn.bleedProcessed = true; }
      return true;
    },
    setPending: (battle, action, question) => { battle.pending = { actor: battle.turn.i, action, question }; },
    resolvePending(_data, _game, battle) { calls.resolves++; battle.pending = null; battle.turn = null; },
    loop() {}, playHits() {}, drawField() {}, actionLabel: action => action.type,
    stopSpeech() { calls.stops++; }, speak() {}, pronounce: () => null,
    panel: { isConnected: true, querySelector: () => ({ focus() {} }) },
    showPanel: (title, content, options = {}) => { currentPanel = { title, content, options }; },
    showCommand() { calls.commands++; currentPanel = { title: 'command', content: [], options: {} }; },
    setTimeout(fn, delay) { const id = nextTimer++; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(uiCode, ctx);
  return { ctx, calls, timers, time: value => { clock = value; }, panel: () => currentPanel,
    answers: () => currentPanel.content.find(node => node?.attrs.class === 'battle-answers').children };
}

test('攻撃・スキル・奥義・逃走・道具の未回答選択を取り消しても行動順と戦闘状態は変わらない', () => {
  for (const action of [{ type: 'attack' }, { type: 'skill', skillId: 'ordinary' }, { type: 'skill', skillId: 'ultimate' }, { type: 'flee' }, { type: 'item' }]) {
    const question = { wordId: 'one', deadline: 123, choices: [1, 2, 3, 4] };
    const battle = { turn: { side: 'ally', i: 0, bleedProcessed: true }, queue: [{ side: 'enemy', i: 0 }],
      allies: [{ buffs: { barrier: [12, 3] } }], pending: { actor: 0, action, question } };
    const before = structuredClone(battle);
    assert.equal(cancelBattleQuestion(battle), true);
    assert.equal(battle.pending, null);
    assert.deepEqual(battle.reservedQuestion, question);
    assert.deepEqual(battle.turn, before.turn);
    assert.deepEqual(battle.queue, before.queue);
    assert.deepEqual(battle.allies, before.allies);
  }
});
test('未回答の問題がないときや他のターン・戦闘終了後は取り消せない', () => {
  for (const battle of [{}, { turn: { side: 'enemy', i: 0 }, pending: { actor: 0 } },
    { turn: { side: 'ally', i: 1 }, pending: { actor: 0 } },
    { result: 'won', turn: { side: 'ally', i: 0 }, pending: { actor: 0 } }]) {
    const before = structuredClone(battle);
    assert.equal(cancelBattleQuestion(battle), false);
    assert.deepEqual(battle, before);
  }
});
test('取り消しはコマンドへ戻り、問題・資源・学習成績を維持し、古い回答操作を無効にする', () => {
  const h = harness();
  h.ctx.ask({ type: 'skill' });
  const first = h.ctx.b.pending.question, oldAnswer = h.answers()[0].attrs.onclick;
  assert.equal(h.panel().options.backLabel, '← 取り消し');
  h.panel().options.back();
  assert.equal(h.calls.commands, 1);
  assert.equal(h.ctx.b.pending, null);
  assert.equal(h.ctx.g.party[0].mp, 10);
  assert.equal(h.ctx.g.party[0].ultimateGauge, 100);
  assert.equal(h.calls.answers, 0);
  assert.equal(h.calls.reviews, 0);
  assert.equal(h.calls.resolves, 0);
  assert.equal(h.calls.stops, 1);
  h.ctx.ask({ type: 'attack' });
  assert.equal(h.ctx.b.pending.question, first);
  assert.equal(h.calls.draws, 1);
  assert.equal(h.calls.questions, 1);
  assert.equal(h.calls.bleed, 1);
  oldAnswer();
  assert.equal(h.calls.resolves, 0);
  h.answers()[0].attrs.onclick();
  assert.equal(h.calls.answers, 1);
  assert.equal(h.calls.resolves, 1);
  assert.equal(h.panel().options.back, undefined, '回答後には取り消しを表示しない');
});
test('時間制限は取り消しや選び直しで延長せず、締切後の取り消しは時間切れとして処理する', () => {
  const h = harness({ timed: true });
  h.ctx.ask({ type: 'flee' });
  const deadline = h.ctx.b.pending.question.deadline;
  h.time(1500);
  h.panel().options.back();
  assert.equal(h.timers.size, 0, '離れた問題画面のタイマーを解除する');
  h.time(2000);
  h.ctx.ask({ type: 'attack' });
  assert.equal(h.ctx.b.pending.question.deadline, deadline);
  assert.equal(h.timers.size, 1);
  h.time(deadline);
  h.panel().options.back();
  assert.equal(h.ctx.run.timedOut, true);
  assert.equal(h.calls.answers, 1);
  assert.equal(h.calls.resolves, 1);
  assert.equal(h.calls.commands, 1);
});
test('保存・再読み込み後も保持した問題を使用し、試験の問題数を取り消しで進めない', () => {
  const h = harness({ timed: true, review: true });
  h.ctx.ask({ type: 'skill' });
  const before = JSON.stringify(h.ctx.b.pending.question);
  h.panel().options.back();
  h.ctx.b = JSON.parse(JSON.stringify(h.ctx.b));
  h.ctx.ask({ type: 'attack' });
  assert.equal(JSON.stringify(h.ctx.b.pending.question), before);
  assert.equal(h.ctx.run.challengeQuestions, 1);
  assert.equal(h.calls.questions, 1);
});
