// 4択を続けて出す部品（確認テスト・昇格試験・鍛錬で使う）。答えは学習記録にも入る。
import { now } from '../storage.js?v=paid-skills-1';
import { makePracticeQuestion, questionDirection, questionSpeech, DIRECTION } from '../quiz.js?v=paid-skills-1';
import { speak, canSpeak, stopSpeech } from '../speech.js?v=paid-skills-1';
import { REASON_LABEL } from '../picker.js?v=paid-skills-1';
import { el, render } from '../dom.js?v=paid-skills-1';

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
    stopSpeech();
    if (n >= total) return onDone(correct, total, results);
    const nx = next();
    if (!nx) return onDone(correct, n, results);
    n += 1;
    const word = nx.word;
    const dir = questionDirection(direction);
    const q = makePracticeQuestion(word, lex, { direction: dir, format, familiar: scheduler.isFamiliar(store.get(word.id)) });
    const isEn = q.direction === DIRECTION.EN_JA;
    const voice = questionSpeech(q);
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
          el('div', { class: `feedback ${ok ? 'good' : 'bad'}`, role: 'status' }, ok ? '正解！' : `正解は「${q.choices[q.answerIndex].text}」`),
          el('div', { class: 'small center' }, `${word.en} ＝ ${word.ja}`),
          voice.answer && canSpeak() ? el('button', { class: 'ghost', onclick: () => speak(voice.answer) }, '🔊 正解の英語を聞く') : null,
          el('button', { class: 'primary', onclick: ask }, n >= total ? '結果を見る' : '次へ'));
        after.querySelector('.primary').focus();
        if (!isEn) speak(voice.answer);
      },
    }, el('span', { class: 'choice-letter', 'aria-hidden': 'true' }, String.fromCharCode(65 + k)), el('span', { lang: isEn ? 'ja' : 'en' }, c.text)));
    render(view,
      el('div', { class: 'progress quiz-progress' }, el('span', {}, title), el('span', {}, `${n} / ${total}問・正解 ${correct}`)),
      nx.reason ? el('div', { class: 'center' }, el('span', { class: `tag ${nx.reason}` }, REASON_LABEL[nx.reason])) : null,
      el('div', { class: `prompt ${isEn ? '' : 'ja'}`, style: 'white-space: pre-line', lang: isEn ? 'en' : 'ja' }, q.prompt),
      voice.prompt && canSpeak() ? el('div', { class: 'center' },
        el('button', { class: 'speak', 'aria-label': '英語の発音を聞く', onclick: () => speak(voice.prompt) }, '🔊')) : null,
      el('div', { class: 'options' }, buttons),
      after);
    window.scrollTo(0, 0);
    speak(voice.prompt);
  };
  ask();
}

