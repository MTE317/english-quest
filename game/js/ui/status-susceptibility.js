import { el } from '../dom.js?v=skill-growth-2';
import { allyStatusSusceptibilities, STATUS_SUSCEPTIBILITY } from '../status-susceptibility.js?v=jobs-intro-1';

export function statusSusceptibilityPanel(data, game, index) {
  const rows = allyStatusSusceptibilities(data, game, index);
  return el('section', { class: 'panel status-susceptibility', 'aria-label': '状態異常のかかりやすさ' },
    el('h3', {}, '状態異常のかかりやすさ'),
    el('p', { class: 'small muted' }, STATUS_SUSCEPTIBILITY.map(row => row.symbol + ' ' + row.label).join(' ／ ')),
    el('dl', { class: 'status-susceptibility-grid' }, rows.map(row =>
      el('div', { class: 'status-susceptibility-item' },
        el('dt', {}, row.name),
        el('dd', { class: 'status-grade-' + row.kind, title: row.label, 'aria-label': row.label }, row.symbol)))),
    el('p', { class: 'small muted' }, '装備・パッシブ・宿の効果と、行動可能な仲間の常時支援を反映。戦闘中の一時効果は含みません。'),
    el('p', { class: 'small muted' }, '◎は付与率を25%以上軽減、★は完全無効。実際の付与率は敵の技によって変わります。'));
}
