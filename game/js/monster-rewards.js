/** 空欄は旧報酬を使う。片方だけ・不正値はマスターの入力ミス。 */
export function parseMonsterRewards(row) {
  const exp = String(row.base_exp ?? '').trim();
  const ap = String(row.base_ap ?? '').trim();
  if (!exp && !ap) return {};
  if (!/^\d+$/.test(exp) || !/^\d+$/.test(ap)
      || !Number.isSafeInteger(Number(exp)) || !Number.isSafeInteger(Number(ap))) {
    throw new Error(`Invalid monster rewards: ${row.id}`);
  }
  return { baseExp: Number(exp), baseAp: Number(ap) };
}

function configured(monster) {
  return monster && Number.isSafeInteger(monster.baseExp) && monster.baseExp >= 0
    && Number.isSafeInteger(monster.baseAp) && monster.baseAp >= 0;
}

/** 地域は敵IDと独立。未対応の旧遠征は戦闘全体を従来計算へ戻す。 */
export function fixedBattleRewards(data, enemies, dungeonId) {
  if ((!data.balance.rewards.fixed_monster_dungeons?.includes(dungeonId) && !data.worldRoutes?.nodes.some(n => n.id === dungeonId)) || !enemies.length) return null;
  const monsters = enemies.map(e => data.monsters.get(e.monsterId));
  if (!monsters.every(configured)) return null;
  return monsters.map((monster, i) => ({ exp: monster.baseExp, ap: monster.baseAp + (enemies[i].eliteId && enemies[i].eliteId !== 'elite' ? 1 : 0) }));
}

/** 図鑑の値は公開地域での基礎値と明記し、遭遇Lvから再計算しない。 */
export function publicMonsterReward(data, monster) {
  return configured(monster) ? { exp: monster.baseExp, ap: monster.baseAp } : null;
}
