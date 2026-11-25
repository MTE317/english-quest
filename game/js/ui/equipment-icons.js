import { el } from '../dom.js?v=skill-growth-2';
import { weaponIcon } from './weapon-icons.js?v=skill-growth-2';

// 防具は装備の部位ごとに1枚を共用する。軽さ・レアリティ・個別IDでは分けない。
const armorSlots = new Set(['head', 'arm', 'body', 'cloak']);
const armorBase = new URL('../../art/armor/', import.meta.url);

/** 名前を併記する場所の装飾画像。対象外の部位には画像を追加しない。 */
export function armorIcon(slot) {
  if (!armorSlots.has(slot)) return null;
  return el('img', {
    class: 'equipment-icon armor-icon', src: new URL(`${slot}.png`, armorBase).href,
    width: 32, height: 32, alt: '', 'aria-hidden': 'true', draggable: 'false',
  });
}

export function equipmentIcon(def) {
  if (!def) return null;
  return def.slot === 'weapon' ? weaponIcon(def.kind) : armorIcon(def.slot);
}

