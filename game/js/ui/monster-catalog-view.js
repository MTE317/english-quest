import { publicMonsterReward } from '../monster-rewards.js?v=fixed-monsters-1';
import { el, render } from '../dom.js?v=skill-growth-2';
import { catalogMonsters, monsterUnlocks } from '../monster-catalog.js?v=inspect-hp-1';
import { monsterKnowledge } from '../monster-knowledge.js?v=fixed-monsters-1';

const waiting = (count, threshold) => `未解放（討伐 ${count}/${threshold}）`;
const row = (label, value) => el('div', { class: 'monster-catalog-row' }, el('dt', {}, label), el('dd', {}, value));

function detail(data, game, monster) {
  const count = game.catalog?.defeats?.[monster.id] ?? 0;
  const known = monsterUnlocks(monster, count, game.catalog?.affinities?.[monster.id]);
  const threshold = monster.isBoss ? { elements: 2, hp: 1, types: 1, statuses: 3, stats: 4, drops: 5 }
    : { elements: 3, hp: 1, types: 2, statuses: 10, stats: 20, drops: 30 };
  const unlock = (key, value) => known[key] ? value : waiting(count, threshold[key]);
  const sample = monster.fixedStats ? { ...monster.fixedStats, lv: monster.fixedStats.level } : game.catalog?.sightings?.[monster.id];
  const affinity = monsterKnowledge(data, game, { ...monster, monsterId: monster.id });
  const seenElements = [...affinity.weak, ...affinity.resist, ...affinity.normal];
  const elementText = [...data.elements.values()].filter(e => e.id !== 'none').map(e => {
    const symbol = monster.immune.includes(e.id) ? '×' : monster.strongWeak.includes(e.id) ? '★'
      : monster.weak.includes(e.id) ? '◎' : monster.resist.includes(e.id) ? '△' : '〇';
    return `${e.name} ${symbol}`;
  }).join('・');
  const statusText = [...data.statusEffects.values()].map(s =>
    `${s.name} ${monster.isBoss && (data.balance.battle_formulas?.boss_status_immune ?? []).includes(s.id)
      ? '×' : monster.statusAffinity?.[s.id] ?? '〇'}`).join('・');
  const drops = [monster.materialCommon, monster.materialRare]
    .filter(Boolean).map(id => data.materials.get(id)?.name ?? id);
  const unique = [...data.equipment.values()].filter(gear => gear.unique && gear.source === monster.id);
  drops.push(...unique.map(gear => gear.name));
  const stolen = monster.materialCommon ? data.materials.get(monster.materialCommon)?.name ?? monster.materialCommon : 'なし';
  const stats = sample ? `${monster.fixedStats ? '通常個体・固定Lv' : '記録Lv'} ${sample.lv}：MP ${sample.mp}・攻撃 ${Math.round(sample.str)}・魔力 ${Math.round(sample.mag)}・防御 ${Math.round(sample.def)}・魔防 ${Math.round(sample.res)}・素早さ ${Math.round(sample.spd)}`
    : '戦闘での記録なし';
  const reward = publicMonsterReward(data, monster);
  const xp = reward ? `公開ダンジョンの基礎経験値 ${reward.exp}（冠・仲間のレベルなどで変動）` : sample ? `基礎経験値の目安 ${Math.round((6 + 3.2 * sample.lv) * (monster.isBoss ? 5 : 1))}（仲間のレベルなどで変動）` : '';
  return [
    el('header', {}, el('span', { class: 'shop-item-icon', 'aria-hidden': 'true' }, monster.icon), el('h2', {}, monster.name)),
    el('p', { class: 'shop-description' }, `討伐 ${count}体${monster.isBoss ? '・ボス' : ''}`),
    el('dl', { class: 'monster-catalog-facts' },
      row('最大HP', unlock('hp', sample ? `${sample.hp}（${monster.fixedStats ? '通常個体・固定Lv' : '記録したLv'} ${sample.lv}）` : '戦闘での記録なし')),
      row('種族', unlock('types', monster.types.map(id => data.monsterTypes.get(id)?.name ?? id).join('・'))),
      row('攻撃属性相性', known.elements ? elementText : seenElements.length ? `判明済み：${seenElements.join('・')} ／ ${waiting(count, threshold.elements)}` : waiting(count, threshold.elements)),
      row('状態異常相性', unlock('statuses', statusText)),
      row('HP以外の能力・取得経験値', unlock('stats', `${stats}${xp ? ` ／ ${xp}` : ''}`)),
      row('ドロップ・盗品候補', unlock('drops', `ドロップ：${drops.join('・') || 'なし'} ／ 盗品候補：${stolen}`)),
    ),
  ];
}

export function monsterCatalogView(data, game, state) {
  const monsters = catalogMonsters(data);
  const encountered = new Set(game.catalog?.monsters ?? []);
  const selected = monsters.find(m => m.id === state.selected && encountered.has(m.id))
    ?? monsters.find(m => encountered.has(m.id));
  state.selected = selected?.id ?? null;
  const grid = el('div', { class: 'shop-grid monster-catalog-grid', role: 'group', 'aria-label': 'モンスター一覧' });
  const panel = el('section', { class: 'shop-detail', 'aria-label': 'モンスターの詳細' });
  const buttons = new Map();
  function select(monster) {
    state.selected = monster.id;
    for (const [id, button] of buttons) button.setAttribute('aria-pressed', String(id === monster.id));
    render(panel, detail(data, game, monster));
  }
  render(grid, monsters.map(monster => {
    const seen = encountered.has(monster.id);
    const button = el('button', {
      type: 'button', class: 'shop-slot', disabled: !seen,
      'aria-pressed': String(selected?.id === monster.id),
      'aria-label': seen ? `${monster.name}・討伐${game.catalog?.defeats?.[monster.id] ?? 0}体` : '未発見のモンスター',
      onclick: () => select(monster),
    }, el('span', { class: 'shop-item-icon', 'aria-hidden': 'true' }, seen ? monster.icon : '？'),
    el('span', { class: 'shop-slot-name' }, seen ? monster.name : '未発見'));
    buttons.set(monster.id, button);
    return button;
  }));
  if (selected) select(selected);
  else render(panel, el('p', { class: 'muted' }, 'ダンジョンで出会ったモンスターの情報がここに記録されます。'));
  return el('section', { class: 'monster-catalog' },
    el('p', { class: 'small muted' }, `発見 ${monsters.filter(m => encountered.has(m.id)).length} / ${monsters.length}種`),
    el('div', { class: 'shop-layout' }, grid, panel));
}
