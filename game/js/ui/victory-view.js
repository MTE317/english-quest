import { maxHp, maxMp } from '../character.js?v=paid-skills-1';
import { expeditionScene } from './scenery.js?v=paid-skills-1';
import { el } from '../dom.js?v=paid-skills-1';
import { portraitIcon } from './portrait.js?v=paid-skills-1';
import { equipmentIcon } from './equipment-icons.js?v=paid-skills-1';
import { uiIcon } from './pixel-icons.js?v=paid-skills-1';

function resource(label, value, max) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return el('div', { class: `victory-resource ${label.toLowerCase()}` },
    el('span', {}, label),
    el('span', {}, `${value}/${max}`),
    el('span', { class: 'victory-meter', 'aria-hidden': 'true' },
      el('span', { style: `width:${percent}%` })));
}

function memberCard(data, member, growth) {
  const levelUp = growth.levels > 0;
  const conditions = (member.persist ?? []).map((id) => data.statusEffects.get(id)?.name ?? id);
  if (member.hp <= 0) conditions.unshift('戦闘不能');

  return el('li', { class: levelUp ? 'victory-member leveled' : 'victory-member' },
    el('div', { class: 'victory-member-head' },
      el('span', { class: 'victory-avatar', 'aria-hidden': 'true' }, portraitIcon(member.icon, { small: true })),
      el('div', {},
        el('h4', {}, member.name),
        el('span', { class: 'victory-level' }, levelUp ? `Lv. ${member.lv - growth.levels} → ${member.lv}` : `Lv. ${member.lv}`)),
      levelUp ? el('span', { class: 'victory-level-up' }, 'レベルアップ') : null),
    el('div', { class: 'victory-gains' },
      el('span', {}, '経験値 ', el('b', {}, `+${growth.xp}`)),
      el('span', {}, 'AP ', el('b', {}, `+${growth.ap}`))),
    resource('HP', member.hp, maxHp(data, member)),
    resource('MP', member.mp, maxMp(data, member)),
    conditions.length ? el('div', { class: 'victory-conditions' }, conditions.join('・')) : null);
}

export function createLootIcons(data, loot, gearName) {
  const entries = [
    ...(loot.materials ?? []).map(({ id, count }) => ({
      name: data.materials.get(id)?.name ?? id, count, icon: () => uiIcon('storage'),
    })),
    ...(loot.gear ?? []).map(gear => ({
      name: gearName(gear), count: 1, rarity: gear.rarity,
      icon: () => equipmentIcon(data.equipment.get(gear.id)) ?? uiIcon('gear'),
    })),
  ];
  return entries.length ? el('ul', { class: 'result-icon-grid', 'aria-label': '獲得品一覧' },
    entries.map(entry => el('li', { class: 'result-icon-tile', 'data-rarity': entry.rarity ?? 'common' },
      el('span', { class: 'result-item-icon', 'aria-hidden': 'true' }, entry.icon()),
      el('span', { class: 'result-item-name' }, entry.name),
      el('span', { class: 'result-item-count' }, `×${entry.count}`))))
    : el('p', { class: 'victory-empty' }, 'なし');
}

export function createVictoryView({ data, dungeon, party, result, backpack, totalGold, gearName, actions }) {
  const { loot, growth, floor, battleNumber, battleCount } = result;


  return el('div', { class: `victory-screen scene-${expeditionScene(dungeon.id)}` },
    el('header', { class: 'victory-header' },
      el('p', {}, `${dungeon.name} ・ ${floor} / ${dungeon.floors}階 ・ ${battleNumber} / ${battleCount}戦目`),
      el('h2', { tabindex: '-1' }, '勝利！')),
    el('section', { class: 'victory-rewards', 'aria-labelledby': 'victory-rewards-title' },
      el('div', { class: 'victory-rewards-head' },
        el('h3', { id: 'victory-rewards-title' }, '戦闘報酬'),
        el('div', { class: 'victory-gold' }, el('span', {}, 'ゴールド'), el('strong', {}, `+${loot.gold}`))),
      el('div', { class: 'victory-drops-title' }, 'ドロップ品'),
      createLootIcons(data, loot, gearName)),
    el('section', { 'aria-labelledby': 'victory-party-title' },
      el('h3', { id: 'victory-party-title' }, 'パーティーの成長'),
      el('ul', { class: 'victory-party' }, party.map((member, index) =>
        memberCard(data, member, growth[index])))),
    el('div', { class: 'victory-expedition' },
      el('span', {}, `バックパック ${backpack}`),
      el('span', {}, `遠征合計 ${totalGold} G`)),
    el('div', { class: 'victory-actions' }, actions));
}

