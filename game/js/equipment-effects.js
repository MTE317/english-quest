// 専用制作装備の固定効果を日本語で表示する
const LABELS = {
  HP: 'HP', STR: 'STR', MAG: 'MAG', DEF: 'DEF', RES: 'RES', SPD: 'SPD', LUK: 'LUK',
  CRT: '会心率', EVA: '回避率', STATUS_RES: '状態異常耐性', FIRST_SPD: '先制速度',
  CRIT_DMG: '会心ダメージ', WEAK_DMG: '弱点ダメージ', VS_DEBUFFED: '弱体・状態異常への特効',
  DOT_POWER: '継続ダメージ強化', STATUS_RATE: '状態異常付与率',
  PHYS_CUT: '物理ダメージ軽減', MAGIC_CUT: '魔法ダメージ軽減',
  HEAL_POWER: '回復効果', PARTY_BUFF_POWER: '全体強化効果',
  DEF_PIERCE: '敵DEF無視', MP_SAVE: 'スキルMP節約',
  LIFESTEAL: 'HP吸収', EXTRA_HIT: '追撃率', COUNTER: '反撃率',
  MP_ON_HIT: '正解通常攻撃時MP回復', DROP: '素材入手補正', EXP: '経験値補正', FLEE: '逃走率',
};
const PERCENTS = new Set([
  'CRT', 'EVA', 'STATUS_RES', 'FIRST_SPD', 'CRIT_DMG', 'WEAK_DMG', 'VS_DEBUFFED',
  'PHYS_CUT', 'MAGIC_CUT', 'HEAL_POWER', 'PARTY_BUFF_POWER', 'DEF_PIERCE', 'MP_SAVE',
  'LIFESTEAL', 'EXTRA_HIT', 'COUNTER', 'MP_ON_HIT', 'DROP', 'EXP', 'FLEE', 'DOT_POWER', 'STATUS_RATE',
]);
/** 固定効果・ランダム効果・エンチャントで共通の日本語表記。 */
export function effectLabel(data, key) {
  if (key.startsWith('STATUS_ON_HIT:')) return `通常攻撃で${data.statusEffects?.get(key.slice(14))?.name ?? key.slice(14)}`;
  if (key.startsWith('特効:') || key.startsWith('TYPE_BONUS:')) {
    const id = key.slice(key.indexOf(':') + 1);
    return `${data.monsterTypes?.get(id)?.name ?? id}特効`;
  }
  if (key.startsWith('ELEM_RES:') || key.startsWith('ELEMENT:')) {
    const id = key.slice(key.indexOf(':') + 1);
    return `${data.elements?.get(id)?.name ?? id}${key.startsWith('ELEM_RES:') ? '耐性' : '属性追加'}`;
  }
  return LABELS[key] ?? key;
}
export function describeEffect(data, key, value) {
  if (key.startsWith('ELEMENT:')) return effectLabel(data, key);
  const percentage = PERCENTS.has(key) || key.startsWith('STATUS_ON_HIT:') || key.startsWith('特効:')
    || key.startsWith('TYPE_BONUS:') || key.startsWith('ELEM_RES:');
  return `${effectLabel(data, key)} +${Math.round(value * 10) / 10}${percentage ? '%' : ''}`;
}
export function describeFixedEffects(data, def) {
  const effects = Object.entries(def?.fixedEffects ?? {}).map(([key, value]) => describeEffect(data, key, value));
  const element = def?.addedElement ? `${data.elements?.get(def.addedElement)?.name ?? def.addedElement}属性追加` : null;
  return [...(element ? [element] : []), ...effects].join(' ／ ');
}
