// 専用の風景を持たない遠征には、出発地点のフィールドを表示する。
const scenery = {
  mossy_cave: 'cavern', twisted_tunnel: 'cavern', goblin_quarry: 'cavern', roadside_well: 'cavern',
  old_catacomb: 'cavern', amber_dig: 'cavern', crystal_hollow: 'cavern',
  ruined_fort: 'arena', ancient_library: 'library', sunken_temple: 'temple', silent_corridor: 'temple',
  clockwork_mine: 'forge', obsidian_volcano: 'cavern', windmill_village: 'town',
};

export function expeditionScene(dungeonId, challenge) {
  if (challenge) return 'arena';
  return scenery[dungeonId] ?? 'wilds';
}
