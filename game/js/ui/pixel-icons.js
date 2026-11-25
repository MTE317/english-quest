import { el } from '../dom.js?v=jobs-master-1';

// 町で使う12種類の印。名前は隣のテキストで読み上げ、絵は装飾として扱う。
const icons = ['guild', 'inn', 'temple', 'party', 'items', 'gear',
  'workshop', 'storage', 'arena', 'bank', 'catalog', 'achievements'];

export function uiIcon(name) {
  const index = icons.indexOf(name);
  if (index < 0) return null;
  return el('span', {
    class: `pixel-icon pixel-icon--${name}`,
    style: `--icon-x:${index % 4};--icon-y:${Math.floor(index / 4)}`,
    'aria-hidden': 'true',
  });
}

