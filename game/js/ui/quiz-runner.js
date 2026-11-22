// 4択を続けて出す部品（覚醒の試練・昇格試験・鍛錬で使う）。答えは学習記録にも入る。
import { now } from '../storage.js?v=features-2';
import { makePracticeQuestion, questionDirection, DIRECTION } from '../quiz.js?v=features-2';
import { speak, canSpeak } from '../speech.js';
import { REASON_LABEL } from '../picker.js';
import { el, render } from '../dom.js';

/**
 * @param opts.next () => { word, reason? } | null 次の単語
 * @param opts.total 問題数
 * @param opts.title 見出し
 * @param opts.onDone (correct, total, results) 終わったとき
 */
export function runQuiz({ view, lex, scheduler, store, next, total, title, onDone, onAnswer = null, direction, format }) {
  let n = 0;
  let correct = 0;
  const results = [];
  const ask = () => {
    if (n >= total) return onDone(correct, total, results);
    const nx = next();
    if (!nx) return onDone(correct, n, results);
    n += 1;
    const word = nx.word;
    const dir = questionDirection(direction);
    const q = makePracticeQuestion(word, lex, { direction: dir, format, familiar: scheduler.isFamiliar(store.get(word.id)) });
    const isEn = q.direction === DIRECTION.EN_JA;
    let done = false;
    const after = el('div');
    const buttons = q.choices.map((c, k) => el('button', {
      onclick: () => {
        if (done) return;
        done = true;
        const ok = k === q.answerIndex;
        if (ok) correct += 1;
        buttons.forEach((b, j) => { b.disabled = true; if (j === q.answerIndex) b.classList.add('correct'); else if (j === k) b.classList.add('wrong'); });
        const rec = scheduler.review(store.get(word.id), ok, now());
        store.recordAnswer(word.id, rec, scheduler.dayOf(now()), ok);
        results.push({ word, correct: ok });
        onAnswer?.(word, ok);
        render(after,
          el('div', { class: `feedback ${ok ? 'good' : 'bad'}` }, ok ? '正解！' : `正解は「${q.choices[q.answerIndex].text}」`),
          el('div', { class: 'small center' }, `${word.en} ＝ ${word.ja}`),
          canSpeak() ? el('button', { class: 'ghost', onclick: () => speak(word.en) }, `🔊 ${word.en}`) : null,
          el('button', { class: 'primary', onclick: ask }, n >= total ? '結果を見る' : '次へ'));
      },
    }, c.text));
    render(view,
      el('div', { class: 'progress' }, el('span', {}, title), el('span', {}, `${n} / ${total}問・正解 ${correct}`)),
      nx.reason ? el('div', { class: 'center' }, el('span', { class: `tag ${nx.reason}` }, REASON_LABEL[nx.reason])) : null,
      el('div', { class: `prompt ${isEn ? '' : 'ja'}`, style: 'white-space: pre-line', lang: isEn ? 'en' : 'ja' }, q.prompt),
      canSpeak() && isEn ? el('div', { class: 'center' }, el('button', { class: 'speak', onclick: () => speak(word.en) }, '🔊')) : null,
      el('div', { class: 'options' }, buttons),
      after);
    window.scrollTo(0, 0);
  };
  ask();
}
