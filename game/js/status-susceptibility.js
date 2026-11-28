// 戦闘と同じ付与率を基準にした、通常時の状態異常のかかりやすさ。
import { allyStatusChance } from './battle.js?v=enemy-skills-1';
import { computeStats } from './character.js?v=advanced-jobs-1';

export const STATUS_SUSCEPTIBILITY = Object.freeze([
  { symbol: '▲', label: 'かかりやすい', kind: 'weak' },
  { symbol: '○', label: '普通', kind: 'normal' },
  { symbol: '◎', label: 'かかりにくい', kind: 'resist' },
  { symbol: '★', label: '完全ガード', kind: 'immune' },
]);

export function susceptibilityGrade(multiplier) {
  const index = multiplier <= 0 ? 3 : multiplier > 1 ? 0 : multiplier <= .75 ? 2 : 1;
  return STATUS_SUSCEPTIBILITY[index];
}

export function allyStatusSusceptibilities(data, game, index) {
  // 通常時の一覧。戦闘中の一時的な強化・弱体は含めない。
  const battle = {
    round: 1, partyBuffs: {},
    allies: game.party.map(member => ({ statuses: Object.fromEntries((member.persist ?? []).map(id => [id, {}])), buffs: {}, masterEffects: {} })),
  };
  const stats = computeStats(data, game.party[index]);
  return [...data.statusEffects.values()].map(status => {
    // 基礎付与率50%で倍率を求め、100%の上限で弱点が隠れるのを避ける。
    const multiplier = allyStatusChance(data, game, battle, index, status.id, .5, stats) * 2;
    return { id: status.id, name: status.name, multiplier, ...susceptibilityGrade(multiplier) };
  });
}
