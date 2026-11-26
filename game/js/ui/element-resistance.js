import { el } from '../dom.js?v=skill-growth-2';
import { allyElementResistances, ELEMENT_RESISTANCE } from '../element-resistance.js?v=specialist-jobs-1';

export function elementResistancePanel(data, game, index) {
  const rows = allyElementResistances(data, game, index);
  const categories = [...new Set(rows.map(row => row.category))];
  return el('section', { class: 'panel element-resistance', 'aria-label': '属性耐性' },
    el('h3', {}, '属性耐性'),
    el('p', { class: 'small muted' }, ELEMENT_RESISTANCE.map(row => row.symbol + ' ' + row.label).join(' ／ ')),
    categories.map(category => el('div', {},
      el('h4', {}, category),
      el('dl', { class: 'status-susceptibility-grid' }, rows.filter(row => row.category === category).map(row => {
        const multiplier = Number(row.multiplier.toFixed(3));
        return el('div', { class: 'status-susceptibility-item' },
          el('dt', {}, row.name),
          el('dd', { class: 'status-grade-' + row.kind,
            title: `${row.label}・属性ダメージ ×${multiplier}`,
            'aria-label': `${row.label}、属性ダメージ${multiplier}倍` },
            row.symbol, el('small', { class: 'element-resistance-multiplier' }, `×${multiplier}`)));
      })))),
    el('p', { class: 'small muted' }, '装備と、行動可能な仲間の常時支援を反映。倍率は属性による補正です。'),
    el('p', { class: 'small muted' }, '防御力や物理・魔法ダメージ軽減、戦闘中の一時的な強化・弱体は含みません。'));
}
