import { el, render } from '../dom.js?v=jobs-master-1';
import { equipmentIcon } from './equipment-icons.js?v=jobs-master-1';
import { uiIcon } from './pixel-icons.js?v=jobs-master-1';
import { describeFixedEffects, describeEffect } from '../equipment-effects.js?v=jobs-master-1';

// 倉庫の表示順と選択状態だけを管理し、所持品の保存順は変更しない。
export function storageView(data, game, state) {
  const rarityIds = [...data.rarityTable.map(r => r.id), 'set', 'unique'];
  const rarityNames = new Map([...data.rarityTable.map(r => [r.id, r.name]), ['set', 'セット'], ['unique', 'ユニーク']]);
  const rarityOf = (gear, def) => def.unique ? 'unique' : def.setId ? 'set' : gear.rarity || 'common';
  const modes = [
    { id: 'materials', label: '素材' }, { id: 'gear', label: '装備' }, { id: 'items', label: '道具' },
  ];
  const root = el('section', { class: 'storage-view', 'aria-label': '倉庫' });
  function entriesFor(mode) {
    if (mode === 'gear') return game.storage.gear.map((gear, index) => {
      const def = data.equipment.get(gear.id);
      const rarity = rarityOf(gear, def ?? {});
      return { id: String(gear.uid ?? index), name: (def?.name ?? gear.id) + (gear.enh > 0 ? ` +${gear.enh}` : ''),
        owned: 1, rank: def?.star ?? 0, rarity, rarityOrder: rarityIds.indexOf(rarity), def, gear,
        icon: () => equipmentIcon(def) ?? uiIcon('gear'),
        description: [rarityNames.get(rarity) ?? rarity, def ? `★${def.star} ／ 装備Lv ${def.itemLv}` : ''].filter(Boolean).join(' ／ ') };
    });
    const stock = mode === 'materials' ? game.storage.materials : game.items;
    const catalog = mode === 'materials' ? data.materials : data.items;
    return Object.entries(stock).filter(([, n]) => n > 0).map(([id, owned]) => {
      const def = catalog.get(id);
      return { id, name: def?.name ?? id, owned, rank: mode === 'materials' ? def?.rank ?? 0 : 0,
        def, icon: () => uiIcon(mode === 'materials' ? 'storage' : 'items'),
        description: mode === 'materials' ? `★${def?.rank ?? 1}` : def?.description ?? '' };
    });
  }
  function draw(focus) {
    const mode = modes.some(m => m.id === state.mode) ? state.mode : 'materials';
    state.mode = mode;
    const options = [
      ...(mode === 'gear' ? [['rarity_desc', 'レアリティ：高い順'], ['rarity_asc', 'レアリティ：低い順']] : []),
      ...(mode === 'materials' ? [['rank_desc', '★ランク：高い順'], ['rank_asc', '★ランク：低い順']] : []),
      ['name', '名前順'], ['count', '所持数：多い順'],
    ];
    state.sorts ??= {};
    const sort = options.some(([id]) => id === state.sorts[mode]) ? state.sorts[mode] : options[0][0];
    state.sorts[mode] = sort;
    const entries = entriesFor(mode).sort((a, b) => {
      const primary = sort === 'rarity_desc' ? b.rarityOrder - a.rarityOrder
        : sort === 'rarity_asc' ? a.rarityOrder - b.rarityOrder
        : sort === 'rank_desc' ? b.rank - a.rank : sort === 'rank_asc' ? a.rank - b.rank
        : sort === 'count' ? b.owned - a.owned : 0;
      return primary || (sort.startsWith('rarity') ? b.rank - a.rank : 0)
        || a.name.localeCompare(b.name, 'ja', { numeric: true }) || a.id.localeCompare(b.id, 'ja', { numeric: true });
    });
    state.selected ??= {};
    const selected = entries.find(e => e.id === state.selected[mode]) ?? entries[0];
    state.selected[mode] = selected?.id;
    const grid = el('div', { class: 'shop-grid storage-grid', role: 'group', 'aria-label': '所持品一覧', tabindex: '0' });
    const detail = el('section', { class: 'shop-detail', 'aria-label': '所持品の詳細' });
    const buttons = new Map();
    const icon = entry => el('span', { class: 'shop-item-icon', 'aria-hidden': 'true' }, entry.icon());
    function select(entry) {
      state.selected[mode] = entry.id;
      for (const [id, button] of buttons) button.setAttribute('aria-pressed', String(id === entry.id));
      const fixed = entry.gear && entry.def ? describeFixedEffects(data, entry.def) : '';
      render(detail,
        el('header', {}, icon(entry), el('h2', {}, entry.name)),
        el('p', { class: 'shop-description' }, entry.description),
        el('p', {}, `所持数：${entry.owned}個`),
        fixed ? el('p', { class: 'small' }, `固定効果：${fixed}`) : null,
        entry.gear ? [
          ...Object.entries(entry.gear.affixes ?? {}).map(([key, value]) =>
            el('p', { class: 'small' }, describeEffect(data, key, value))),
          ...(entry.gear.enchants ?? []).map(effect =>
            el('p', { class: 'small' }, describeEffect(data, effect.stat, effect.value))),
        ] : null);
    }
    render(grid, entries.map(entry => {
      const button = el('button', { type: 'button', class: 'shop-slot', 'data-rarity': entry.rarity ?? 'common',
        'aria-pressed': String(entry.id === selected?.id),
        'aria-label': `${entry.name}、${entry.description}、所持${entry.owned}個`,
        onclick: () => select(entry),
      }, icon(entry), el('span', { class: 'shop-slot-name' }, entry.name),
      el('span', { class: 'shop-slot-count' }, entry.rarity ? rarityNames.get(entry.rarity) ?? entry.rarity : mode === 'materials' ? `★${entry.rank}` : ''),
      el('span', { class: 'shop-slot-count' }, `×${entry.owned}`));
      buttons.set(entry.id, button);
      return button;
    }));
    if (selected) select(selected);
    render(root,
      el('div', { class: 'district-switch storage-tabs', role: 'group', 'aria-label': '倉庫の種類' },
        modes.map(m => el('button', { type: 'button', 'data-storage-tab': m.id,
          'aria-pressed': String(mode === m.id), onclick: () => { state.mode = m.id; draw('tab'); },
        }, m.label))),
      el('label', { class: 'storage-sort' }, '並べ替え',
        el('select', { class: 'select', 'aria-label': '倉庫の並べ替え', onchange: event => {
          state.sorts[mode] = event.target.value; draw('sort');
        } }, options.map(([id, title]) => el('option', { value: id, selected: sort === id }, title)))),
      el('p', { class: 'small muted' }, `${modes.find(m => m.id === mode).label}：${entries.length}${mode === 'gear' ? '個' : '種類'}`),
      selected ? el('div', { class: 'shop-layout' }, grid, detail)
        : el('p', { class: 'shop-detail muted' }, 'この種類の所持品はありません。'));
    if (focus === 'sort') root.querySelector('select')?.focus({ preventScroll: true });
    if (focus === 'tab') root.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
  }
  draw();
  return root;
}

