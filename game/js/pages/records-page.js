import { GameSession } from '../save.js?v=features-2';
import { loadGameData } from '../gamedata.js?v=features-2';
import { LearningStore, loadSettings, saveSettings } from '../storage.js?v=features-2';
import { dayToString } from '../srs.js?v=features-2';
import { DIRECTION } from '../quiz.js?v=features-2';
import { el, render } from '../dom.js';
import { monsterKnowledge } from '../monster-knowledge.js';
import { setSceneMusic } from '../battle-music.js?v=jrpg-1';

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
    if (key === 'music') setSceneMusic('facility');
  };
  const control = (label, key, options) => el('label', { class: 'small' }, label,
    el('select', { class: 'select', onchange: (event) => change(key, event.target.value) },
      options.map(([id, name]) => el('option', { value: id, selected: settings[key] === id }, name))));
  render(view,
    el('h2', {}, 'ダンジョンの出題設定'),
    control('翻訳の方向', 'direction', [[DIRECTION.EN_JA, '英→日'], [DIRECTION.JA_EN, '日→英'], ['mixed', '混ぜる']]),
    control('出題形式', 'format', [['meaning', '意味の4択'], ['mixed', '意味・空欄・場面を混ぜる'], ['cloze', '空欄を優先'], ['situation', '場面を優先']]),
    el('h2', {}, '音の設定'),
    control('BGM・勝利ファンファーレ', 'music', [['on', 'オン'], ['off', 'オフ']]),
    control('ボタン・戦闘の効果音', 'effects', [['on', 'オン'], ['off', 'オフ']]),
    section(`学習履歴（${store.size}ルーン）`, [...store.daily.entries()].sort((a, b) => b[0] - a[0]).map(([day, row]) =>
      el('div', {}, `${dayToString(day)}　${row.correct} / ${row.answered}問正解`))),
    section(`モンスター図鑑（${monsters.size} / ${data.monsters.size}）`, [...data.monsters.values()].map((m) => {
      if (!monsters.has(m.id)) return el('div', { class: 'muted' }, '？？？');
      const { weak, resist, normal, scanned } = monsterKnowledge(data, game, m);
      return section(`${m.icon} ${m.name}`,
        el('div', {}, '弱点 ', weak.join('・') || (scanned ? 'なし' : '未判明')),
        el('div', {}, '耐性 ', resist.join('・') || '未判明'),
        normal.length ? el('div', {}, '通常 ', normal.join('・')) : null);
    })),
    section(`装備図鑑（${owned.size} / ${data.equipment.size}）`, [...data.equipment.values()].map((d) => el('div', {}, owned.has(d.id) ? d.name : '？？？'))),
    section('称号', game?.titles?.length ? game.titles.map((title) => el('div', {}, title)) : el('p', {}, 'まだ称号を獲得していません。')));
}

setSceneMusic('facility');
show().catch((error) => render(view, el('p', { class: 'error' }, error.message)));
