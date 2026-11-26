import { GameSession } from '../save.js?v=skill-growth-2';
import { loadGameData } from '../gamedata.js?v=skill-growth-2';
import { LearningStore, loadSettings, saveSettings, now } from '../storage.js?v=skill-growth-2';
import { loadLearningCatalog } from '../learning-catalog.js?v=skill-growth-2';
import { learningStatistics } from '../learning-stats.js?v=skill-growth-2';
import { loadJson } from '../data.js?v=skill-growth-2';
import { Scheduler } from '../srs.js?v=skill-growth-2';
import { dayToString } from '../srs.js?v=skill-growth-2';
import { DIRECTION } from '../quiz.js?v=skill-growth-2';
import { el, render } from '../dom.js?v=skill-growth-2';
import { monsterKnowledge } from '../monster-knowledge.js?v=monster-catalog-1';
import { setSceneMusic } from '../battle-music.js?v=skill-growth-2';

import { installGameShell } from '../ui/game-shell.js?v=skill-growth-2';
import { equipmentIcon } from '../ui/equipment-icons.js?v=skill-growth-2';

const view = document.getElementById('view');
const session = new GameSession();
installGameShell('records', session);
const store = new LearningStore();

function section(title, ...body) {
  return el('details', { class: 'panel small' }, el('summary', {}, title), body);
}

async function show() {
  const [data, learningCatalog, srs] = await Promise.all([loadGameData(), loadLearningCatalog(), loadJson('srs.json')]);
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
        ? gear.map((d) => {
          const icon = equipmentIcon(d);
          return icon ? el('div', { class: 'gear-with-icon' }, icon, el('span', {}, d.name)) : el('div', {}, d.name);
        }) : el('p', { class: 'muted' }, '手に入れた装備がここに記録されます。')),
      section('称号', game?.titles?.length ? game.titles.map((title) => el('div', {}, title)) : el('p', {}, 'まだ称号を獲得していません。'))];
  }
  function log() {
    const scheduler = new Scheduler(srs.data);
    const stats = learningStatistics(learningCatalog, store, game, scheduler, scheduler.dayOf(now()));
    const wordsAnswered = stats.days.reduce((sum, row) => sum + row.words, 0);
    const phrasesAnswered = stats.days.reduce((sum, row) => sum + row.phrases, 0);
    const recent = stats.days.slice(0, 14);
    const fact = (label, value) => el('div', {},
      el('small', {}, label), el('strong', {}, String(value)));
    const meter = (label, learned, total) => el('div', { class: 'learning-meter' },
      el('div', { class: 'learning-meter-caption' },
        el('strong', {}, label), el('span', {}, learned + ' / ' + total)),
      el('progress', { max: total || 1, value: learned, 'aria-label': label + 'の習得率' }));
    return [
      el('h2', { class: 'chapter-title' }, '英語学習の統計'),
      el('p', { class: 'muted small' }, '教材v1.0の全項目を共通IDで集計しています。00コレクションと他のカテゴリーの重複は二重カウントしません。'),
      el('div', { class: 'route-facts' }, [
        ['覚えた単語・熟語', stats.words.masteredEver + ' / ' + stats.words.total],
        ['言えるようになった英文', stats.phrases.masteredEver + ' / ' + stats.phrases.total],
        ['チャンクの定着', stats.chunks.mastered + ' / ' + stats.chunks.total],
        ['復習待ち', stats.words.due + stats.phrases.due],
        ['学習した日数', stats.days.length + '日'],
        ['累積回答', (wordsAnswered + phrasesAnswered) + '問'],
      ].map(([label, value]) => fact(label, value))),
      el('h3', {}, '現在の記憶と累積達成'),
      el('div', { class: 'route-facts' }, [
        ['単語：現在習得', stats.words.masteredNow],
        ['単語：一度でも習得', stats.words.masteredEver],
        ['英作文：現在習得', stats.phrases.masteredNow],
        ['英作文：一度でも習得', stats.phrases.masteredEver],
      ].map(([label, value]) => fact(label, value))),
      el('h3', {}, 'カテゴリー別進捗'),
      el('div', { class: 'learning-category-grid' }, stats.main.map((category) =>
        el('div', { class: 'panel small' },
          el('strong', {}, category.name),
          meter('単語・熟語', category.wordLearned, category.words),
          meter('瞬間英作文', category.phraseLearned, category.phrases)))),
      el('h3', {}, '回答履歴'),
      el('div', { class: 'route-facts' }, [
        ['単語4択', wordsAnswered + '問'], ['英作文（自己評価）', phrasesAnswered + '問'],
      ].map(([label, value]) => fact(label, value))),
      recent.length ? el('ul', { class: 'journal-days' }, recent.map((row) => el('li', {},
        el('span', {}, dayToString(row.day)),
        el('strong', {}, '単語 ' + row.words + '問 / 英作文 ' + row.phrases + '問'))))
        : el('p', { class: 'muted' }, '単語・英作文の学習を始めると日々の記録がここに残ります。'),
      el('p', { class: 'muted small' }, 'チャンクは2文以上の反復を伴い、関連フレーズの7割以上が累積習得した場合に定着と判定します。英作文の成績は自己評価に基づきます。'),
    ];
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

