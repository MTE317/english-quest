// 専用制作装備の固定効果を日本語で表示する
const LABELS = {
  HP: 'HP', STR: 'STR', MAG: 'MAG', DEF: 'DEF', RES: 'RES', SPD: 'SPD', LUK: 'LUK',
  CRT: '会心率', EVA: '回避率', STATUS_RES: '状態異常耐性', FIRST_SPD: '先制速度',
  CRIT_DMG: '会心ダメージ', WEAK_DMG: '弱点ダメージ', VS_DEBUFFED: '状態異常への特効',
  PHYS_CUT: '物理ダメージ軽減', MAGIC_CUT: '魔法ダメージ軽減',
  HEAL_POWER: '回復効果', PARTY_BUFF_POWER: '全体強化効果',
  DEF_PIERCE: '敵DEF無視', MP_SAVE: 'スキルMP節約',
  LIFESTEAL: 'HP吸収', EXTRA_HIT: '追撃率', COUNTER: '反撃率',
  MP_ON_HIT: '攻撃時MP回復', DROP: '素材入手補正', EXP: '経験値補正',
};
const PERCENTS = new Set([
  'CRT', 'EVA', 'STATUS_RES', 'FIRST_SPD', 'CRIT_DMG', 'WEAK_DMG', 'VS_DEBUFFED',
  'PHYS_CUT', 'MAGIC_CUT', 'HEAL_POWER', 'PARTY_BUFF_POWER', 'DEF_PIERCE', 'MP_SAVE',
  'LIFESTEAL', 'EXTRA_HIT', 'COUNTER', 'MP_ON_HIT', 'DROP', 'EXP',
]);
export function describeFixedEffects(data, def) {
  const effects = Object.entries(def?.fixedEffects ?? {}).map(([key, value]) => {
    if (key.startsWith('STATUS_ON_HIT:')) {
      const id = key.slice('STATUS_ON_HIT:'.length);
      const name = data.statusEffects?.get(id)?.name ?? id;
      return `通常攻撃で${name} ${value}%`;
    }
    if (key.startsWith('特効:')) {
      const id = key.slice(3);
      return `${data.monsterTypes?.get(id)?.name ?? id}特効 +${value}%`;
    }
    const label = LABELS[key] ?? key;
    return `${label} +${value}${PERCENTS.has(key) ? '%' : ''}`;
  });
  const element = def?.addedElement ? `${data.elements?.get(def.addedElement)?.name ?? def.addedElement}属性追加` : null;
  return [...(element ? [element] : []), ...effects].join(' ／ ');
}
