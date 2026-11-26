import { el } from '../dom.js?v=skill-growth-2';

// 状態異常20種、能力7種の上下、職業の特殊効果1種。素材も表示も32px。
export const STATUS_ICON_IDS = Object.freeze([
  'poison', 'toxic', 'burn', 'bleed', 'sleep', 'paralysis', 'freeze',
  'stun', 'petrify', 'bind', 'fear', 'silence', 'seal', 'blind',
  'confusion', 'charm', 'taunt', 'curse', 'weaken', 'doom',
]);
export const JOB_EFFECT_ICON = 'job-special';
const statIcons = { str: 'str', atk: 'str', mag: 'mag', def: 'def', res: 'res', spd: 'spd',
  crt: 'crt', crit: 'crt', eva: 'eva' };

export function statusIconId(id) {
  return STATUS_ICON_IDS.includes(id) ? id : null;
}

export function buffIconId(key, value) {
  const prefixedDown = key.startsWith('down:');
  const stat = statIcons[prefixedDown ? key.slice(5) : key];
  if (!stat) return JOB_EFFECT_ICON;
  const down = (prefixedDown ? -value : value) < 0;
  return `${stat}-${down ? 'down' : 'up'}`;
}

export function effectIcon(id) {
  return id ? el('img', { class: 'battle-effect-icon',
    src: new URL(`../../art/effects/${id}.png`, import.meta.url).href,
    width: 32, height: 32, alt: '', 'aria-hidden': 'true', draggable: 'false' }) : null;
}
