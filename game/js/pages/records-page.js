import { GameSession } from '../save.js?v=features-2';
import { loadGameData } from '../gamedata.js?v=features-2';
import { LearningStore, loadSettings, saveSettings } from '../storage.js?v=features-2';
import { dayToString } from '../srs.js?v=features-2';
import { DIRECTION } from '../quiz.js?v=features-2';
import { el, render } from '../dom.js';
import { monsterKnowledge } from '../monster-knowledge.js';
import { setSceneMusic } from '../battle-music.js?v=jrpg-1';

import { installGameShell } from '../ui/game-shell.js';

const view = document.getElementById('view');
const session = new GameSession();
installGameShell('records', session);
const store = new LearningStore();

function section(title, ...body) {
  return el('details', { class: 'panel small' }, el('summary', {}, title), body);
}

async function show() {
  const data = await loadGameData();
  const game = session.game;
  const equipped = (game?.party ?? []).flatMap((member) => Object.values(member.equip).filter(Boolean));
  const owned = new Set([...(game?.catalog?.gear ?? []), ...(game?.storage?.gear ?? []).map((x) => x.id), ...equipped.map((x) => x.id)]);
  const monsters = new Set(game?.catalog?.monsters ?? []);
  const settings = loadSettings();
  const change = (key, value) => {
    settings[key] = value;
    saveSettings(settings);
    if (key === 'music') setSceneMusic('facility');
  };
  const control = (label, key, options) => el('label', { class: 'small' }, label,
    el('select', { class: 'select', onchange: (event) => change(key, event.target.value) },
      options.map(([id, name]) => el('option', { value: id, selected: settings[key] === id }, name))));
  const pages = [['log', '学習記録'], ['catalog', '図鑑・称号'], ['settings', '設定']];
  const tabQuery = new URLSearchParams(location.search).get('tab');
  const initialPage = pages.find(([id]) => id === tabQuery)?.[0] ?? 'log';
  const settingsPanel = () => el('section', { class: 'panel journal-panel' },
    el('h2', {}, 'ダンジョンの出題設定'),
    control('翻訳の方向', 'direction', [[DIRECTION.EN_JA, '英→日'], [DIRECTION.JA_EN, '日→英'], ['mixed', '混ぜる']]),
    control('出題形式', 'format', [['meaning', '意味の4択'], ['mixed', '意味・空欄・場面を混ぜる'], ['cloze', '空欄を優先'], ['situation', '場面を優先']]),
    el('h2', {}, '音の設定'),
    control('BGM・勝利ファンファーレ', 'music', [['on', 'オン'], ['off', 'オフ']]),
    control('ボタン・戦闘の効果音', 'effects', [['on', 'オン'], ['off', 'オフ']]));
  function catalog() {
    const encountered = [...data.monsters.values()].filter((m) => monsters.has(m.id));
    const gear = [...data.equipment.values()].filter((d) => owned.has(d.id));
    return [
      section(`モンスター図鑑（${encountered.length} / ${data.monsters.size}）`, encountered.length
        ? encountered.map((m) => {
          const { weak, resist, normal, scanned } = monsterKnowledge(data, game, m);
          return section(`${m.icon} ${m.name}`, el('div', {}, '弱点　', weak.join('・') || (scanned ? 'なし' : '未判明')),
            el('div', {}, '耐性　', resist.join('・') || '未判明'),
            normal.length ? el('div', {}, '通常　', normal.join('・')) : null);
        }) : el('p', { class: 'muted' }, 'ダンジョンで出会った敵がここに記録されます。')),
      section(`装備図鑑（${gear.length} / ${data.equipment.size}）`, gear.length
        ? gear.map((d) => el('div', {}, d.name)) : el('p', { class: 'muted' }, '手に入れた装備がここに記録されます。')),
      section('称号', game?.titles?.length ? game.titles.map((title) => el('div', {}, title)) : el('p', {}, 'まだ称号を獲得していません。'))];
  }
  function log() {
    const days = [...store.daily.entries()].sort(([a], [b]) => b - a);
    const answered = days.reduce((sum, [, row]) => sum + row.answered, 0);
    const correct = days.reduce((sum, [, row]) => sum + row.correct, 0);
    return [el('h2', { class: 'chapter-title' }, '単語の学習記録'),
      el('div', { class: 'route-facts' }, [['学んだルーン', `${store.size}語`], ['回答数', `${answered}問`],
        ['正答率', answered ? `${Math.round(correct / answered * 100)}%` : '―']].map(([label, value]) =>
        el('div', {}, el('small', {}, label), el('strong', {}, value)))),
      el('h2', { class: 'chapter-title' }, '日ごとの記録'),
      days.length ? el('ul', { class: 'journal-days' }, days.map(([day, row]) =>
        el('li', {}, el('span', {}, dayToString(day)), el('strong', {}, `${row.answered}問中 ${row.correct}問正解`))))
        : el('p', { class: 'muted' }, '戦闘や訓練で答えた問題が、日ごとに記録されます。')];
  }
  const nav = el('div', { class: 'district-switch', role: 'group', 'aria-label': '手帳のページ' });
  const body = el('div');
  function open(id) {
    Array.from(nav.children).forEach((button, i) => button.setAttribute('aria-pressed', String(pages[i][0] === id)));
    render(body, { log, catalog, settings: settingsPanel }[id]());
  }
  pages.forEach(([id, name]) => nav.append(el('button', { onclick: () => {
    const url = new URL(location.href); url.searchParams.set('tab', id); history.replaceState(null, '', url);
    open(id);
  } }, name)));
  open(initialPage);
  render(view, nav, body);
}

setSceneMusic('facility');
show().catch((error) => render(view, el('p', { class: 'error' }, error.message)));
