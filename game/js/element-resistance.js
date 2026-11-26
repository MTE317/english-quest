// 通常時の属性耐性。戦闘と同じ属性ダメージ補正を表示する。
import { allyElementMultiplier } from './battle.js?v=element-resistance-1';

export const ELEMENT_RESISTANCE = Object.freeze([
  { symbol: '▲', label: '弱点', kind: 'weak' },
  { symbol: '○', label: '標準', kind: 'normal' },
  { symbol: '◎', label: '耐性', kind: 'resist' },
  { symbol: '★', label: '無効', kind: 'immune' },
]);

export function elementResistanceGrade(multiplier) {
  return ELEMENT_RESISTANCE[multiplier <= 0 ? 3 : multiplier > 1 ? 0 : multiplier < 1 ? 2 : 1];
}

export function allyElementResistances(data, game, index) {
  const battle = {
    round: 1, partyBuffs: {},
    allies: game.party.map(member => ({
      statuses: Object.fromEntries((member.persist ?? []).map(id => [id, {}])),
      buffs: {}, masterEffects: {},
    })),
  };
  return [...data.elements.values()].map(element => {
    const multiplier = allyElementMultiplier(data, game, battle, index, element.id, element.kind === '魔法');
    return { id: element.id, name: element.name, category: element.kind, multiplier, ...elementResistanceGrade(multiplier) };
  });
}
