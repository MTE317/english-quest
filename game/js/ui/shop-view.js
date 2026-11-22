import { el, render } from '../dom.js';

export const goldText = (price) => `${price.toLocaleString('ja-JP')} G`;

function switcher(label, options, selected, choose) {
  return el('div', { class: 'district-switch shop-tabs', role: 'group', 'aria-label': label },
    options.map(({ id, label: title }) => el('button', {
      type: 'button', 'data-shop-option': id, 'aria-pressed': String(id === selected),
      onclick: () => choose(id),
    }, title)));
}

function confirmTrade(dialog, entry, action) {
  render(dialog,
    el('h2', { id: 'shop-confirm-title' }, action.title),
    el('p', { id: 'shop-confirm-summary' }, `${entry.name} ×${action.count} ／ 合計 ${goldText(action.total)}`),
    el('div', { class: 'shop-actions' },
      el('button', { type: 'button', autofocus: true, onclick: () => dialog.close() }, 'キャンセル'),
      el('button', { type: 'button', class: 'primary', onclick: () => {
        dialog.close();
        action.run();
        const next = document.querySelector('.shop-detail button:not([disabled])')
          ?? document.querySelector('.shop-slot[aria-pressed="true"]')
          ?? document.querySelector('.shop-tabs button[aria-pressed="true"]');
        next?.focus({ preventScroll: true });
      } }, '確定する')));
  dialog.showModal();
}

/** A catalog supplies the inventory and trade actions. The view owns navigation and confirmation. */
export function shopView(state, catalogs) {
  const content = el('div');
  const dialog = el('dialog', {
    class: 'shop-confirm', 'aria-labelledby': 'shop-confirm-title', 'aria-describedby': 'shop-confirm-summary',
  });

  function draw(focusOption) {
    const catalog = catalogs.find(({ id }) => id === state.mode) ?? catalogs[0];
    const categories = [
      { id: 'all', label: 'すべて' },
      ...catalog.categories.filter(({ id }) => catalog.entries.some((entry) => entry.category === id)),
    ];
    const category = categories.find(({ id }) => id === state.category)?.id ?? 'all';
    const entries = catalog.entries.filter((entry) => category === 'all' || entry.category === category);
    const selected = entries.find(({ id }) => id === state.item) ?? entries[0];
    state.item = selected?.id;

    const detail = el('section', { class: 'shop-detail', 'aria-label': '商品詳細' });
    const grid = el('div', { class: 'shop-grid', role: 'group', 'aria-label': '商品一覧', tabindex: '0' });

    function select(entry) {
      state.item = entry.id;
      for (const button of grid.children) button.setAttribute('aria-pressed', String(button.dataset.item === entry.id));
      render(detail,
        el('header', {}, el('span', { class: 'shop-item-icon', 'aria-hidden': 'true' }, entry.icon),
          el('h2', {}, entry.name)),
        el('p', { class: 'shop-description' }, entry.description),
        el('dl', { class: 'shop-facts' },
          el('div', {}, el('dt', {}, catalog.priceLabel), el('dd', {}, goldText(entry.price))),
          el('div', {}, el('dt', {}, '所持数'), el('dd', {}, `${entry.owned}個`))),
        entry.details?.(),
        entry.notice ? el('p', { class: 'small muted' }, entry.notice) : null,
        el('div', { class: 'shop-actions' }, entry.actions.map((action) => el('button', {
          type: 'button', class: 'primary', disabled: !action.count,
          onclick: () => confirmTrade(dialog, entry, action),
        }, action.label))));
    }

    render(grid, entries.map((entry) => el('button', {
      type: 'button', class: 'shop-slot', 'data-item': entry.id, 'data-rarity': entry.rarity,
      'aria-label': `${entry.name}、所持${entry.owned}個${entry.equipped ? '、装備中あり' : ''}${entry.notice ? `、${entry.notice}` : ''}`,
      onclick: () => select(entry),
    }, el('span', { class: 'shop-item-icon', 'aria-hidden': 'true' }, entry.icon),
    el('span', { class: 'shop-slot-name' }, entry.name),
    el('span', { class: 'shop-slot-count', 'aria-hidden': 'true' },
      `×${entry.owned}${entry.equipped ? ' ・ 装備中' : ''}${entry.notice ? ' ・ !' : ''}`))));

    if (selected) select(selected);
    render(content,
      catalogs.length > 1 ? switcher('取引', catalogs, catalog.id, (id) => {
        Object.assign(state, { mode: id, category: 'all', item: undefined });
        draw(id);
      }) : null,
      categories.length > 1 ? switcher('商品カテゴリ', categories, category, (id) => {
        state.category = id;
        draw(id);
      }) : null,
      selected ? el('div', { class: 'shop-layout' }, grid, detail)
        : el('p', { class: 'shop-detail' }, catalog.empty));
    if (focusOption) content.querySelector(`[data-shop-option="${focusOption}"]`)?.focus({ preventScroll: true });
  }

  draw();
  return el('section', { class: 'shop-view', 'aria-label': 'ショップ' }, content, dialog);
}
