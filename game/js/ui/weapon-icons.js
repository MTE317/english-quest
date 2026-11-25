import { el } from '../dom.js?v=skill-growth-2';

// data/weapon_types.csv の武器種IDに対応する32×32pxの画像。
const weaponTypes = new Set([
  'sword', 'greatsword', 'katana', 'dagger', 'axe', 'spear', 'bow', 'hammer',
  'fist', 'staff', 'tome', 'instrument', 'gun', 'whip', 'scythe', 'fan',
]);
const iconBase = new URL('../../art/weapons/', import.meta.url);

/** 名前を併記する場所の装飾画像。呼ぶたびに新しい要素を返す。 */
export function weaponIcon(kind) {
  if (!weaponTypes.has(kind)) {
    return el('span', { class: 'weapon-icon weapon-icon-fallback', 'aria-hidden': 'true' }, '◇');
  }
  return el('img', {
    class: 'weapon-icon', src: new URL(`${kind}.png`, iconBase).href,
    width: 32, height: 32, alt: '', 'aria-hidden': 'true', draggable: 'false',
  });
}

