import { el, stars } from '../dom.js';
import { aptitudeGrade, canEquip, computeStats, equipFromStorage, gearDef, makeGear, SLOT_LABEL } from '../character.js?v=build36-1';
import { LOOT_FORMULAS } from '../loot.js?v=build36-1';
import { buyGear, buyItem, gearShopStock, itemShopStock, sellGear, sellPrice } from '../town.js?v=build36-1';
import { goldText, shopView } from './shop-view.js?v=weapon-icons-1';
import { equipmentIcon } from './equipment-icons.js';

const itemCategories = [
  { id: 'hp', label: 'HP回復' }, { id: 'mp', label: 'MP回復' },
  { id: 'cure', label: '蘇生・治療' }, { id: 'other', label: 'その他' },
];
const itemIcons = { hp: '🧪', mp: '💧', cure: '🌿', other: '🌀' };
const gearCategories = [
  { id: 'weapon', label: '武器' }, { id: 'armor', label: '防具' }, { id: 'accessory', label: '装飾品' },
];
const gearIcons = { accessory: '💍' };
const statLabels = {
  attack: '武器攻撃力', offhandAttack: 'サブ武器攻撃力', def: '防御力', res: '魔法防御力',
  hp: 'HP', mp: 'MP', str: 'STR', mag: 'MAG', spd: 'SPD', luk: 'LUK',
  crit: '会心率', evasion: '回避率', statusResist: '状態異常耐性',
};
const percentStats = ['crit', 'evasion', 'statusResist'];
const round = (value) => Math.round(value * 100) / 100;

function itemCategory(effect) {
  if (effect.startsWith('heal_hp')) return 'hp';
  if (effect.startsWith('heal_mp')) return 'mp';
  if (effect.startsWith('revive') || effect.startsWith('cure')) return 'cure';
  return 'other';
}

export function itemShopView(data, game, state, act) {
  const entries = itemShopStock(data, game).map(({ item, price }) => {
    const owned = game.items[item.id] ?? 0;
    const category = itemCategory(item.effect);
    const room = Math.max(0, LOOT_FORMULAS.item_max - owned);
    const affordable = Math.floor(game.gold / price);
    return {
      id: item.id, name: item.name, description: item.description, owned, price, category, icon: itemIcons[category],
      notice: !room ? '所持上限' : !affordable ? '所持金不足' : null,
      actions: [1, 5].map((requested) => {
        const count = Math.min(requested, room, affordable);
        return {
          title: '購入を確認', count, total: count * price,
          label: count && count < requested ? `${count}個買う（最大5個）` : `${requested}個買う`,
          run: () => act((g) => `${item.name}を${buyItem(data, g, item.id, requested)}個買った`),
        };
      }),
    };
  });
  return shopView(state, [{ id: 'buy', entries, categories: itemCategories, priceLabel: '単価', empty: '販売中の道具はありません。' }]);
}

function statChanges(before, after, slot) {
  return Object.entries(statLabels).flatMap(([key, label]) => {
    const scale = percentStats.includes(key) ? 100 : 1;
    const suffix = scale === 100 ? '%' : '';
    const from = round(before[key] * scale);
    const to = round(after[key] * scale);
    const delta = round(to - from);
    const mainStat = slot === 'weapon' ? key === 'attack' : slot === 'offhand' ? key === 'offhandAttack'
      : ['head', 'body', 'arm', 'cloak'].includes(slot) && ['def', 'res'].includes(key);
    if (!delta && !mainStat) return [];
    return [el('li', {}, `${label} ${from}${suffix} → ${to}${suffix} `,
      el('strong', { class: delta > 0 ? 'shop-gain' : delta < 0 ? 'error' : 'muted' },
        `(${delta > 0 ? '+' : ''}${delta}${suffix})`))];
  });
}

function equipmentDetails(data, game, def, gear) {
  const slots = { weapon: ['weapon', 'offhand'], accessory: ['accessory1', 'accessory2'] }[def.slot] ?? [def.slot];
  return el('section', { class: 'shop-comparison' }, el('h3', {}, '装備条件・性能比較'),
    def.slot === 'weapon' ? el('p', { class: 'muted small' },
      `武器特性：${data.weaponTypes.get(def.kind)?.feature ?? 'なし'}`) : null,
    game.party.map((member) => {
      const checks = slots.map((slot) => ({ slot, ...canEquip(data, member, slot, gear) }));
      const allowed = checks.filter(({ ok }) => ok);
      const icon = data.icons.find(({ id }) => id === member.icon)?.icon ?? '👤';
      const grade = aptitudeGrade(data, member.job, def);
      const heading = el('span', {}, el('span', { 'aria-hidden': 'true' }, icon),
        ` ${member.name}${grade ? `（適正 ${grade}）` : ''}`);
      if (!allowed.length) return el('p', { class: 'shop-member muted' }, heading, ` — ${checks[0].reason}`);
      return el('details', { class: 'shop-member' },
        el('summary', {}, heading, '　装備可'),
        allowed.map(({ slot }) => {
          const projected = { ...member, equip: { ...member.equip } };
          equipFromStorage(data, { storage: { gear: [gear] } }, projected, slot, gear.uid);
          const current = member.equip[slot];
          const changes = statChanges(computeStats(data, member), computeStats(data, projected), slot);
          return el('div', { class: 'shop-stat-block' },
            el('strong', {}, `${SLOT_LABEL[slot]} ／ 現在 ${current ? gearName(gearDef(data, current), current) : 'なし'}`),
            changes.length ? el('ul', {}, changes) : el('div', {}, '能力値の変化なし'),
            member.equip.offhand && !projected.equip.offhand ? el('div', {}, 'サブ武器が外れます') : null);
        }));
    }));
}

function gearName(def, gear) {
  return gear.enh > 0 ? `${def.name} +${gear.enh}` : def.name;
}

export function gearShopView(data, game, state, act) {
  const equipped = game.party.flatMap((member) => Object.values(member.equip).filter(Boolean));
  const owned = new Map();
  for (const { id } of [...game.storage.gear, ...equipped]) owned.set(id, (owned.get(id) ?? 0) + 1);

  function entry(def, gear, id, price, star) {
    const kind = data.weaponTypes.get(def.kind)?.name ?? data.armorWeights.get(def.armorWeight)?.name
      ?? SLOT_LABEL[def.slot] ?? '装飾品';
    const rarity = data.rarityTable.find((r) => r.id === gear.rarity)?.name ?? gear.rarity;
    return {
      id, price, rarity: gear.rarity, name: gearName(def, gear), owned: owned.get(def.id) ?? 0,
      icon: () => equipmentIcon(def) ?? gearIcons[def.slot],
      category: def.slot === 'weapon' || def.slot === 'accessory' ? def.slot : 'armor',
      description: [stars(star), kind, `装備Lv ${def.itemLv}`, rarity].filter(Boolean).join(' ／ '),
      details: () => equipmentDetails(data, game, def, gear),
      equipped: equipped.some((item) => item.id === def.id),
    };
  }

  const seen = new Set();
  const buying = gearShopStock(data, game).filter(({ def }) => {
    if (seen.has(def.id)) return false;
    seen.add(def.id);
    return true;
  }).map(({ def, price, star }) => ({
    ...entry(def, makeGear({}, def.id), def.id, price, star),
    notice: game.gold < price ? '所持金不足' : null,
    actions: [{
      title: '購入を確認', count: game.gold >= price ? 1 : 0, total: price, label: '購入する',
      run: () => act((g) => {
        buyGear(data, g, def.id);
        return `${def.name}を買った（−${goldText(price)}）`;
      }),
    }],
  }));
  const selling = game.storage.gear.map((gear) => {
    const def = gearDef(data, gear);
    const price = sellPrice(data, gear);
    return {
      ...entry(def, gear, String(gear.uid), price, def.star), equipped: false,
      actions: [{
        title: '売却を確認', count: 1, total: price, label: '売却する',
        run: () => act((g) => `${gearName(def, gear)}を売った（+${goldText(sellGear(data, g, gear.uid))}）`),
      }],
    };
  });
  return shopView(state, [
    { id: 'buy', label: '買う', entries: buying, categories: gearCategories, priceLabel: '購入価格', empty: '販売中の装備はありません。' },
    { id: 'sell', label: '倉庫の装備を売る', entries: selling, categories: gearCategories, priceLabel: '売却価格', empty: '倉庫に売却できる装備がありません。' },
  ]);
}
