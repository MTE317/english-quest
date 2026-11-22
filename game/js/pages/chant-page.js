import { loadCsv, loadJson } from '../data.js?v=features-1';
import { splitList } from '../csv.js';
import { GameSession } from '../save.js?v=features-1';
import { Scheduler } from '../srs.js?v=features-1';
import { now } from '../storage.js?v=features-1';
import { speak, canSpeak } from '../speech.js';
import { chantDay, nextChant, recordChant } from '../chant.js?v=features-1';
import { el, render } from '../dom.js';

const view = document.getElementById('view');
const session = new GameSession();

async function start() {
  if (!session.game?.party || session.inDungeon) {
    render(view, el('p', {}, session.inDungeon ? '町に戻ってから詠唱できます。' : '先にパーティを作ってください。'),
      el('a', { class: 'btn', href: session.inDungeon ? 'dungeon.html' : 'party.html' }, session.inDungeon ? 'ダンジョンへ戻る' : 'パーティを作る'));
    return;
  }
  const [configFile, srsFile, bookFile, chantFile] = await Promise.all([
    loadJson('chant.json'), loadJson('srs.json'), loadCsv('grimoires.csv'), loadCsv('chants.csv'),
  ]);
  const config = configFile.data;
  const scheduler = new Scheduler({ ...srsFile.data, desired_retention: config.desired_retention, day_boundary_hour: config.day_boundary_hour });
  const books = bookFile.rows;
  const all = chantFile.rows.filter((c) => c.en && c.ja);
  let bookId = books[0]?.id;
  let chapter = '';
  if (!books.length || !all.length) {
    render(view, el('p', {}, '魔導書の教材が登録されていません。'));
    return;
  }

  function showMenu(message) {
    const { daily, limit, choice } = chantDay(session.game, config, scheduler.dayOf(now()));
    const chapters = [...new Set(all.filter((c) => c.book === bookId).map((c) => c.chapter))];
    const bookName = (b) => b.name_ja || b.name || b.title || b.id;
    render(view, message ? el('p', { role: 'status' }, message) : null,
      el('div', { class: 'panel' }, `共有JP ${session.game.jp ?? 0} ・ 今日 ${daily.count} / ${limit.questions}問 ・ 新しい文 ${daily.introduced} / ${limit.new}`),
      el('label', {}, '魔導書', el('select', { class: 'select', onchange: (e) => { bookId = e.target.value; chapter = ''; showMenu(); } },
        books.map((b) => el('option', { value: b.id, selected: b.id === bookId }, bookName(b))))),
      el('label', {}, '章', el('select', { class: 'select', onchange: (e) => { chapter = e.target.value; } },
        el('option', { value: '' }, 'すべて'), chapters.map((c) => el('option', { value: c, selected: c === chapter }, `第${c}章`)))),
      el('label', {}, '1日の目安', el('select', { class: 'select', onchange: (e) => {
        const option = Number(e.target.value);
        session.update((g) => { g.chants = { ...g.chants, option }; });
        showMenu();
      } }, config.daily_options.map((o, i) => el('option', { value: i, selected: i === choice }, `${o.questions}問（新しい文 ${o.new}）`)))),
      el('button', { class: 'primary', onclick: () => practice(new Set(), 0) }, '詠唱をはじめる'));
  }

  function practice(seen, totalJp) {
    const selected = all.filter((c) => c.book === bookId && (!chapter || c.chapter === chapter));
    const c = nextChant(session.game, config, scheduler, scheduler.dayOf(now()), all, selected, seen);
    if (!c) return showMenu(`今回の詠唱は終了。獲得JP ${totalJp}`);
    const answer = el('div');
    const reveal = el('button', { class: 'primary', onclick: () => {
      reveal.remove();
      if (canSpeak()) speak(c.en);
      const grades = el('div', { class: 'row' });
      for (const [key, grade] of Object.entries(config.grades)) {
        grades.append(el('button', { onclick: () => {
          try {
            let earned;
            session.update((g) => { earned = recordChant(g, config, scheduler, now(), c.id, key); });
            seen.add(c.id);
            practice(seen, totalJp + earned);
          } catch (error) { showMenu(error.message); }
        } }, grade.label));
      }
      render(answer, el('p', { lang: 'en' }, c.en),
        splitList(c.alt_en).map((alt) => el('div', { class: 'small', lang: 'en' }, alt)),
        c.note ? el('p', { class: 'muted small' }, c.note) : null,
        canSpeak() ? el('button', { class: 'ghost', onclick: () => speak(c.en) }, 'もう一度聞く') : null,
        grades);
    } }, '答えを見る');
    render(view, el('p', { class: 'muted small' }, `今回の獲得JP ${totalJp}`),
      el('div', { class: 'panel' }, el('p', {}, c.ja), reveal, answer),
      el('button', { class: 'ghost', onclick: () => showMenu(`獲得JP ${totalJp}`) }, '終了する'));
  }

  showMenu();
}

start().catch((error) => render(view, el('p', { class: 'error' }, error.message)));
