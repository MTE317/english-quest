import { el } from '../dom.js?v=skill-growth-2';

// セーブに保存する appearance ID は従来のまま、表示だけをドット絵へ切り替える。
const groups = [
  ['human', '人間', 5, [
    '短髪の青年', '茶髪の女性', 'ひげの男性', '金髪の女性', '巻き毛の青年',
    '赤髪の女性', '銀髪の青年', '少女', '少年', '老婦人',
  ]],
  ['fantasy', 'ファンタジー', 4, [
    'エルフの青年', 'エルフの女性', '老魔術師', '魔女',
    '忍者', '仮面の英雄', '妖精', '吸血鬼',
  ]],
  ['animal', 'どうぶつ', 4, ['ネコ', 'イヌ', 'キツネ', 'クマ', 'パンダ', 'カエル', 'ウサギ', 'ライオン']],
];

export const PORTRAIT_GROUPS = groups.map(([id, label, columns, names]) => ({
  id, label, columns, rows: 2,
  portraits: names.map((name, index) => ({ id: `${id}_${String(index + 1).padStart(2, '0')}`, label: name, index })),
}));

const portraits = new Map(PORTRAIT_GROUPS.flatMap((group) => group.portraits.map((portrait) => [
  portrait.id, { ...portrait, group: group.id, columns: group.columns, rows: group.rows },
])));
const portraitBase = new URL('../../art/portraits/', import.meta.url);
const appearanceOf = (id) => portraits.get(id) ?? portraits.get('human_01');

export function portraitLabel(id) {
  return appearanceOf(id).label;
}

/** 名前や選択肢ラベルと一緒に表示する装飾画像。未知IDにも有効な絵を返す。 */
export function portraitIcon(id, { small = false, className = '' } = {}) {
  const appearance = appearanceOf(id);
  const { columns, rows, index, group } = appearance;
  const x = (index % columns) * 100 / (columns - 1);
  const y = Math.floor(index / columns) * 100 / (rows - 1);
  return el('span', {
    class: ['pixel-portrait', small ? 'pixel-portrait-small' : '', className].filter(Boolean).join(' '),
    'data-portrait': appearance.id,
    'aria-hidden': 'true',
    style: `background-image:url("${new URL(`${group}.png`, portraitBase).href}");background-size:${columns * 100}% ${rows * 100}%;background-position:${x}% ${y}%;`,
  });
}

