import { el } from '../dom.js?v=skill-growth-2';
import { gearDef, gearEffects } from '../character.js?v=advanced-jobs-1';

export const PHYSICAL_SKILL_ELEMENTS = Object.freeze(['slash', 'blunt', 'pierce']);
export const MAGIC_SKILL_ELEMENTS = Object.freeze(['fire', 'ice', 'wind', 'earth', 'thunder', 'water', 'light', 'dark', 'none']);
export const SKILL_ICON_IDS = Object.freeze([
  ...[...PHYSICAL_SKILL_ELEMENTS, ...MAGIC_SKILL_ELEMENTS].map(id => `physical-${id}`),
  ...MAGIC_SKILL_ELEMENTS.map(id => `magic-${id}`),
  'healing', 'support', 'hindrance', 'passive', 'ultimate',
]);
const labels = { slash: '斬', blunt: '打', pierce: '突', fire: '火', ice: '氷', wind: '風',
  earth: '地', thunder: '雷', water: '水', light: '光', dark: '闇', none: '無' };
const healing = new Set(['heal', 'heal_all', 'revive', 'cure', 'cure_all', 'mp_give']);
const support = new Set(['self_buff', 'party_buff', 'ally_buff', 'imbue']);
const attacks = new Set(['attack', 'fixed_damage', 'delayed']);

/** 武器依存技能は装備武器を参照。使用条件を満たさない場合は対応武器で予告する。 */
function weaponAppearance(data, skill, member) {
  const gear = member?.equip?.weapon;
  const def = gear ? gearDef(data, gear) : null;
  const allowed = skill.effect?.weapons?.length ? skill.effect.weapons
    : skill.effect?.require_weapon ? [skill.effect.require_weapon] : [];
  const current = def?.kind ?? 'unarmed';
  const compatible = !allowed.length || allowed.includes(current) || (current === 'unarmed' && allowed.includes('none'));
  const kind = compatible ? current : allowed[0];
  const weapon = data?.weaponTypes?.get(kind);
  const elements = [...(weapon?.elements ?? ['blunt'])];
  if (compatible && def?.addedElement) elements.push(def.addedElement);
  if (compatible && gear) for (const key of Object.keys(gearEffects(gear))) {
    if (key.startsWith('ELEMENT:')) elements.push(key.slice(8));
  }
  return { magical: weapon?.attackStat === 'mag', elements };
}

/** 奥義・パッシブを優先し、ダメージ付き妨害は主効果の攻撃アイコンで示す。 */
export function skillIconInfo(data, skill = {}, member) {
  if (skill.isFinal) return { id: 'ultimate', label: '奥義' };
  if (skill.kind === 'passive' || skill.kind === 'common') return { id: 'passive', label: 'パッシブ' };
  if (healing.has(skill.kind)) return { id: 'healing', label: '回復' };
  if (support.has(skill.kind)) return { id: 'support', label: '補助' };
  if (!attacks.has(skill.kind)) return { id: 'hindrance', label: '妨害' };

  const effect = skill.effect ?? {};
  const weaponDependent = effect.base === 'weapon';
  const weapon = weaponDependent ? weaponAppearance(data, skill, member) : null;
  const magical = weaponDependent ? weapon.magical : effect.base !== 'phys';
  let elements = weaponDependent ? weapon.elements : skill.elements ?? [];
  if (effect.element === 'best') elements = skill.elements?.length ? skill.elements : ['wind', 'earth', 'water'];
  else if (effect.element) elements = [effect.element];
  elements = [...new Set(elements.filter(id => labels[id]))];
  if (!elements.length) elements = [magical ? 'none' : 'blunt'];
  const primary = elements[0];
  const family = magical ? 'magic' : 'physical';
  const iconElement = magical && PHYSICAL_SKILL_ELEMENTS.includes(primary) ? 'none' : primary;
  const type = magical ? '魔法攻撃' : '物理攻撃';
  const hint = effect.element === 'best' ? '・有利な属性を選択' : weaponDependent && !effect.element ? '・武器依存' : '';
  return { id: `${family}-${iconElement}`, label: `${type}・${elements.map(id => labels[id]).join('／')}${hint}` };
}

export function skillIcon(data, skill, member) {
  const info = skillIconInfo(data, skill, member);
  return el('span', { class: 'shop-item-icon skill-shop-icon', title: info.label, 'aria-hidden': 'true' },
    el('img', { class: 'skill-pixel-icon',
      src: new URL(`../../art/skills/${info.id}.png`, import.meta.url).href,
      width: 32, height: 32, alt: '', draggable: 'false', 'data-skill-icon': info.id }));
}
