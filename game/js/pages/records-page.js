import { GameSession } from '../save.js?v=features-2';
import { loadGameData } from '../gamedata.js?v=features-2';
import { LearningStore, loadSettings, saveSettings } from '../storage.js?v=features-2';
import { dayToString } from '../srs.js?v=features-2';
import { DIRECTION } from '../quiz.js?v=features-2';
import { el, render } from '../dom.js';

const view = document.getElementById('view');
const session = new GameSession();
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
  };
  const control = (label, key, options) => el('label', { class: 'small' }, label,
    el('select', { class: 'select', onchange: (event) => change(key, event.target.value) },
      options.map(([id, name]) => el('option', { value: id, selected: settings[key] === id }, name))));
  render(view,
    el('h2', {}, 'ダンジョンの出題設定'),
    control('翻訳の方向', 'direction', [[DIRECTION.EN_JA, '英→日'], [DIRECTION.JA_EN, '日→英'], ['mixed', '混ぜる']]),
    control('出題形式', 'format', [['meaning', '意味の4択'], ['mixed', '意味・空欄・場面を混ぜる'], ['cloze', '空欄を優先'], ['situation', '場面を優先']]),
    section(`学習履歴（${store.size}ルーン）`, [...store.daily.entries()].sort((a, b) => b[0] - a[0]).map(([day, row]) =>
      el('div', {}, `${dayToString(day)}　${row.correct} / ${row.answered}問正解`))),
    section(`モンスター図鑑（${monsters.size} / ${data.monsters.size}）`, [...data.monsters.values()].map((m) => el('div', {}, monsters.has(m.id) ? `${m.icon} ${m.name}` : '？？？'))),
    section(`装備図鑑（${owned.size} / ${data.equipment.size}）`, [...data.equipment.values()].map((d) => el('div', {}, owned.has(d.id) ? d.name : '？？？'))),
    section('称号', game?.titles?.length ? game.titles.map((title) => el('div', {}, title)) : el('p', {}, 'まだ称号を獲得していません。')));
}

show().catch((error) => render(view, el('p', { class: 'error' }, error.message)));
