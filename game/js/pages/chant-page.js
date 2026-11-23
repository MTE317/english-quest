import { loadCsv, loadJson } from '../data.js?v=features-2';
import { splitList } from '../csv.js';
import { GameSession } from '../save.js?v=rune-study-1';
import { Scheduler } from '../srs.js?v=features-2';
import { now } from '../storage.js?v=rune-study-1';
import { speak, canSpeak, stopSpeech } from '../speech.js?v=music-suite-1';
import { chantDay, nextChant, recordChant } from '../chant.js?v=features-2';
import { el, render, stars } from '../dom.js';

import { setSceneMusic } from '../battle-music.js?v=music-suite-1';

import { installGameShell } from '../ui/game-shell.js?v=pixel-town-1';

const view = document.getElementById('view');
setSceneMusic('facility');
const session = new GameSession();
installGameShell('chant', session);

async function start() {
  if (!session.game?.party || session.inDungeon) {
    render(view, el('p', {}, session.inDungeon ? '町に戻ってから詠唱できます。' : '先にパーティを作ってください。'),
      el('a', { class: 'btn', href: session.inDungeon ? 'dungeon.html' : 'party.html' }, session.inDungeon ? 'ダンジョンへ戻る' : 'パーティを作る'));
    return;
  }
  const [configFile, srsFile, bookFile, chantFile, stoneFile] = await Promise.all([
    loadJson('chant.json'), loadJson('srs.json'), loadCsv('grimoires.csv'), loadCsv('chants.csv'), loadCsv('rune_stones.csv'),
  ]);
  const config = configFile.data;
  const scheduler = new Scheduler({ ...srsFile.data, desired_retention: config.desired_retention, day_boundary_hour: config.day_boundary_hour });
  const books = bookFile.rows;
  const all = chantFile.rows.filter((c) => c.en && c.ja);
  const chaptersByCategory = new Map(stoneFile.rows.filter((s) => s.category)
    .map((s) => [`${s.category}:${s.order}`, s.name_ja]));
  let bookId = books[0]?.id;
  let chapter = '';
  if (!books.length || !all.length) {
    render(view, el('p', {}, '魔導書の教材が登録されていません。'));
    return;
  }

  function showMenu(message) {
    stopSpeech();
    const { daily, limit, choice } = chantDay(session.game, config, scheduler.dayOf(now()));
    const chapters = [...new Set(all.filter((c) => c.book === bookId).map((c) => c.chapter))];
    const category = books.find((b) => b.id === bookId)?.category;
    const bookName = (b) => b.name_ja || b.name || b.title || b.id;
    render(view, message ? el('p', { role: 'status' }, message) : null,
      el('h2', { class: 'chapter-title' }, '瞬間英作文'),
      el('div', { class: 'route-facts chant-facts' },
        [['今日の詠唱', `${daily.count} / ${limit.questions}問`], ['新しい文', `${daily.introduced} / ${limit.new}`], ['共有JP', session.game.jp ?? 0]]
          .map(([label, value]) => el('div', {}, el('small', {}, label), el('strong', {}, value)))),
      el('label', {}, '魔導書', el('select', { class: 'select', onchange: (e) => { bookId = e.target.value; chapter = ''; showMenu(); } },
        books.map((b) => el('option', { value: b.id, selected: b.id === bookId }, bookName(b))))),
      el('label', {}, '章', el('select', { class: 'select', onchange: (e) => { chapter = e.target.value; } },
        el('option', { value: '' }, 'すべて'), chapters.map((c) => el('option', { value: c, selected: c === chapter },
          chaptersByCategory.get(`${category}:${Number(c)}`) ?? `第${c}章`)))),
      el('label', {}, '1日の目安', el('select', { class: 'select', onchange: (e) => {
        const option = Number(e.target.value);
        session.update((g) => { g.chants = { ...g.chants, option }; });
        showMenu();
      } }, config.daily_options.map((o, i) => el('option', { value: i, selected: i === choice }, `${o.questions}問（新しい文 ${o.new}）`)))),
      el('button', { class: 'primary', onclick: () => practice(new Set(), 0) }, '詠唱をはじめる'));
  }

  function practice(seen, totalJp) {
    stopSpeech();
    const selected = all.filter((c) => c.book === bookId && (!chapter || c.chapter === chapter));
    const c = nextChant(session.game, config, scheduler, scheduler.dayOf(now()), all, selected, seen);
    if (!c) return showMenu(`今回の詠唱は終了。獲得JP ${totalJp}`);
    const answer = el('div');
    const reveal = el('button', { class: 'primary', onclick: () => {
      reveal.remove();
      if (canSpeak()) speak(c.en);
      const grades = el('div', { class: 'chant-grades' });
      for (const [key, grade] of Object.entries(config.grades)) {
        grades.append(el('button', { onclick: () => {
          try {
            let earned;
            session.update((g) => { earned = recordChant(g, config, scheduler, now(), c.id, key); });
            seen.add(c.id);
            practice(seen, totalJp + earned);
          } catch (error) { showMenu(error.message); }
        } }, ({ o: '○　言えた', x: '×　言えなかった' })[key] ?? grade.label));
      }
      render(answer, el('p', { lang: 'en', class: 'chant-english' }, c.en),
        splitList(c.alt_en).map((alt) => el('div', { class: 'small', lang: 'en' }, alt)),
        c.note ? el('p', { class: 'muted small' }, c.note) : null,
        canSpeak() ? el('button', { class: 'ghost', onclick: () => speak(c.en) }, 'もう一度聞く') : null,
        el('p', { class: 'small muted' }, 'どのくらい言えましたか？'), grades);
      grades.querySelector('button')?.focus();
    } }, '答えを見る');
    render(view, el('p', { class: 'muted small' }, `今回の獲得JP ${totalJp}`),
      el('div', { class: 'panel chant-card' }, el('h2', {}, '英語で唱える'),
        c.priority ? el('p', { class: 'muted small' }, `優先度${c.priority} · ${stars(Number(c.level))}`) : null,
        el('p', { class: 'chant-japanese' }, c.ja), reveal, answer),
      el('button', { class: 'ghost', onclick: () => showMenu(`獲得JP ${totalJp}`) }, '終了する'));
  }

  showMenu();
}

start().catch((error) => render(view, el('p', { class: 'error' }, error.message)));
