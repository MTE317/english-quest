/** 地域1で採用する敵だけの行動定義。未設定の敵・保存済みの戦闘は従来のAIを使う。 */
export function installMonsterSkills(data, config) {
  if (!config) return data;
  for (const [id, profile] of Object.entries(config.monsters)) {
    const monster = data.monsters.get(id);
    if (!monster || monster.fixedStats?.level !== profile.level || !profile.role || !profile.skills?.length)
      throw new Error('モンスター行動定義が不正: ' + id);
    const ids = new Set();
    for (const skill of profile.skills) {
      if (!skill.id || ids.has(skill.id) || !skill.name || !['attack','heal','buff'].includes(skill.kind)
        || typeof skill.magic !== 'boolean' || !(skill.weight > 0) || !(skill.mp >= 0)
        || !Number.isInteger(skill.cooldown) || skill.cooldown < 0
        || (skill.kind === 'attack' && !(skill.power > 0 && skill.power <= 2))
        || (skill.element && !data.elements.has(skill.element))
        || (skill.status && (!data.statusEffects.has(skill.status) || !(skill.statusRate > 0 && skill.statusRate <= 1)))
        || (skill.kind === 'heal' && !(skill.rate > 0 && skill.rate <= .5))
        || (skill.kind === 'buff' && (!['str','mag','def','res'].includes(skill.stat) || !(skill.rate > 0 && skill.rate <= .5)))
        || (skill.sweep && (!monster.isBoss || skill.kind !== 'attack')))
        throw new Error('モンスターの技が不正: ' + id + '/' + skill.id);
      ids.add(skill.id);
    }
    const basic = profile.skills.filter(s => s.basic);
    if (basic.length !== 1 || basic[0].kind !== 'attack' || basic[0].magic || basic[0].mp || basic[0].cooldown || basic[0].sweep)
      throw new Error('通常攻撃が不正: ' + id);
    monster.skillProfile = profile;
  }
  data.monsterSkills = config;
  return data;
}

export function enemySkillAllowed(enemy, skill, round) {
  return skill.basic || ((enemy.mp ?? 0) >= skill.mp
    && !enemy.statuses?.fear && !(skill.magic ? enemy.statuses?.silence : enemy.statuses?.seal)
    && (enemy.skillReadyRound?.[skill.id] ?? 0) <= round);
}

export function enemyHealTarget(data, enemies) {
  return enemies.filter(e => e.hp > 0 && e.hp <= e.maxHp * .55 && !e.statuses?.petrify
    && !Object.keys(e.statuses ?? {}).some(id => data.statusEffects.get(id)?.kind === 'noheal'))
    .sort((a,b) => a.hp/a.maxHp - b.hp/b.maxHp)[0];
}

/** 抽選自体は battle.rng を使用。クールダウンは enemy に保存する。 */
export function enemySkillChoices(data, enemy, enemies, round) {
  const allowed = (enemy.skillProfile?.skills ?? []).filter(s => !s.sweep && enemySkillAllowed(enemy,s,round)
    && (s.kind !== 'heal' || enemyHealTarget(data,enemies))
    && (s.kind !== 'buff' || !enemy.buffs?.[s.stat]));
  const heal = allowed.filter(s => s.kind === 'heal');
  return heal.length ? heal : allowed;
}

export function spendEnemySkill(enemy, skill, round) {
  enemy.mp -= skill.mp;
  if (skill.cooldown) (enemy.skillReadyRound ??= {})[skill.id] = round + skill.cooldown + 1;
}
