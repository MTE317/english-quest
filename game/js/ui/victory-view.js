import { maxHp, maxMp } from '../character.js?v=features-2';
import { el } from '../dom.js';

function resource(label, value, max) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return el('div', { class: `victory-resource ${label.toLowerCase()}` },
    el('span', {}, label),
    el('span', {}, `${value}/${max}`),
    el('span', { class: 'victory-meter', 'aria-hidden': 'true' },
      el('span', { style: `width:${percent}%` })));
}

function memberCard(data, member, growth, icon) {
  const levelUp = growth.levels > 0;
  const conditions = (member.persist ?? []).map((id) => data.statusEffects.get(id)?.name ?? id);
  if (member.hp <= 0) conditions.unshift('戦闘不能');

  return el('li', { class: levelUp ? 'victory-member leveled' : 'victory-member' },
    el('div', { class: 'victory-member-head' },
      el('span', { class: 'victory-avatar', 'aria-hidden': 'true' }, icon),
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

export function createVictoryView({ data, dungeon, party, result, backpack, totalGold, iconOf, gearName, actions }) {
  const { loot, growth, floor, battleNumber, battleCount } = result;
  const drops = [
    ...loot.materials.map(({ id, count }) => ({ name: data.materials.get(id).name, count })),
    ...loot.gear.map((gear) => ({ name: gearName(gear), count: 1 })),
  ];

  return el('div', { class: 'victory-screen' },
    el('header', { class: 'victory-header' },
      el('p', {}, `${dungeon.name} ・ ${floor} / ${dungeon.floors}階 ・ ${battleNumber} / ${battleCount}戦目`),
      el('h2', { tabindex: '-1' }, '勝利！')),
    el('section', { class: 'victory-rewards', 'aria-labelledby': 'victory-rewards-title' },
      el('div', { class: 'victory-rewards-head' },
        el('h3', { id: 'victory-rewards-title' }, '戦闘報酬'),
        el('div', { class: 'victory-gold' }, el('span', {}, 'ゴールド'), el('strong', {}, `+${loot.gold}`))),
      el('div', { class: 'victory-drops-title' }, 'ドロップ品'),
      drops.length ? el('ul', { class: 'victory-drops' }, drops.map(({ name, count }) =>
        el('li', {}, el('span', {}, name), el('span', {}, `×${count}`))))
        : el('p', { class: 'victory-empty' }, 'なし')),
    el('section', { 'aria-labelledby': 'victory-party-title' },
      el('h3', { id: 'victory-party-title' }, 'パーティの成長'),
      el('ul', { class: 'victory-party' }, party.map((member, index) =>
        memberCard(data, member, growth[index], iconOf(member.icon))))),
    el('div', { class: 'victory-expedition' },
      el('span', {}, `バックパック ${backpack}`),
      el('span', {}, `遠征合計 ${totalGold} G`)),
    el('div', { class: 'victory-actions' }, actions));
}
