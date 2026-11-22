import { el } from '../dom.js';
import { uiIcon } from './pixel-icons.js';

const destinations = [
  ['town', '町', 'temple', 'index.html'],
  ['party', '仲間', 'party', 'party.html'],
  ['study', '学び舎', 'catalog', 'study.html'],
  ['records', '手帳', 'catalog', 'records.html'],
];

export function installGameShell(page, session) {
  const nav = el('nav', { class: 'travel-nav', 'aria-label': '冒険メニュー' },
    destinations.map(([id, label, mark, href]) => el('a', {
      href, 'aria-current': id === page ? 'page' : null,
    }, uiIcon(mark), label)));
  const journal = el('a', { class: 'journal-link', href: 'records.html?tab=settings' },
    uiIcon('catalog'), ' 記録と設定');
  document.body.classList.add('quest-ui');
  document.body.dataset.page = page;
  const mast = el('header', { class: 'game-mast' }, el('div', { class: 'mast-inner' },
    el('a', { class: 'game-brand', href: 'index.html', 'aria-label': 'English Quest・町へ' },
      el('span', { class: 'compass', 'aria-hidden': 'true' }, '✦'), 'English Quest'),
    nav, journal));
  document.body.prepend(mast);
  function syncNavigation() {
    const canTravel = !!session.game?.party && !session.readOnly && !session.inDungeon &&
      page !== 'dungeon' && page !== 'challenge';
    nav.hidden = !canTravel;
    journal.hidden = canTravel;
    document.body.classList.toggle('has-travel', canTravel);
  }
  syncNavigation();
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    session.load();
    if (page === 'town') syncNavigation();
    else window.location.reload();
  });
}

export function sceneHeader(title, scene, { detail, action, returnToTown = false, status } = {}) {
  return el('header', { class: `scene-header scene-${scene}` },
    returnToTown ? el('a', { class: 'scene-back', href: 'index.html' }, '町に戻る') : null,
    el('div', { class: 'scene-copy' },
      el('h1', {}, title), detail ? el('p', {}, detail) : null, action),
    status);
}
