// 戦闘の表示だけを変える試験導入。敵IDやセーブには画像の情報を追加しない。
const sprites = new Map([
  ['slime', { file: 'slime.png', size: 32 }],
  ['exp_mossy_cave_7', { file: 'stone-golem.png', size: 32 }],
  ['goblin_boss', { file: 'gram.png', size: 48 }],
]);
const art = new URL('../../art/monsters/', import.meta.url);

export function hasMossySprites(run) {
  return run.dungeonId === 'mossy_cave' && !run.challenge;
}

export function mossySprite(run, monsterId) {
  const asset = hasMossySprites(run) ? sprites.get(monsterId) : null;
  return asset ? { url: new URL(asset.file, art).href, size: asset.size } : null;
}
