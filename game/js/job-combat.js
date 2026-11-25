// 基本8職の技能効果。数値は技能マスタ、蓄積は戦闘オブジェクトへ保存する。
import { effectiveSkill } from './growth.js?v=jobs-master-1';
import { gearDef, maxHp, maxMp } from './character.js?v=jobs-master-1';

export const masterTags = (skill) => skill?.effect?.tags ?? [];
export const weaponSkill = (skill) => Boolean(skill && !skill.isFinal
  && (skill.effect?.master ? masterTags(skill).includes('active') && masterTags(skill).includes('weapon')
    && !masterTags(skill).some(tag => ['reaction', 'trap'].includes(tag)) : skill.effect?.base === 'weapon'));
export const songSkill = (skill) => masterTags(skill).includes('song');
export const healingSkill = (skill) => masterTags(skill).includes('healing') || ['heal', 'heal_all', 'revive', 'cure', 'cure_all'].includes(skill?.kind);
export function weaponAllowed(data, member, skill) {
  const allowed = skill?.effect?.weapons;
  if (!allowed?.length) return true;
  const kind = member.equip?.weapon ? gearDef(data, member.equip.weapon).kind : 'none';
  return allowed.includes(kind) || (!member.equip?.weapon && allowed.includes('unarmed'));
}
export function passiveRules(data, member) {
  return (member.loadout?.passives ?? []).map(id => data.skills.get(id)).filter(Boolean)
    .map(skill => effectiveSkill(data, member, skill)).filter(skill => weaponAllowed(data, member, skill) && skill.effect?.rules)
    .map(skill => ({ skill, ...skill.effect.rules }));
}
export const ruleNumber = (data, member, key) => passiveRules(data, member).reduce((sum, rule) => sum + (Number(rule[key]) || 0), 0);
export function matchesTag(skill, tag) {
  if (!skill || skill.isFinal) return false;
  if (tag === 'active' || !tag) return skill.kind !== 'passive';
  if (tag === 'weapon') return weaponSkill(skill);
  if (tag === 'healing') return healingSkill(skill);
  return masterTags(skill).includes(tag);
}
export function masterCondition(data, game, b, actor, target, condition = {}, skill = null) {
  const a = b.allies[actor], member = game.party[actor], enemy = b.enemies[target];
  const testStatus = unit => Boolean(unit && (condition.statuses?.length
    ? condition.statuses.some(id => unit.statuses?.[id]) : Object.keys(unit.statuses ?? {}).some(id => id !== 'taunt')));
  switch (condition.when) {
    case 'target_def_down': return Boolean(enemy && (enemy.debuffs?.def?.[0] > 0 || Object.values(enemy.masterDebuffs ?? {}).some(e => e.stat === 'def' && e.value > 0)));
    case 'target_def_buff': return Boolean(enemy?.buffs?.def?.[0] > 0 || enemy?.buffs?.pcut?.[0] > 0 || enemy?.buffs?.cut?.[0] > 0);
    case 'self_status': return testStatus(a);
    case 'target_status': return testStatus(enemy);
    case 'any_enemy_status': return a.conditionSnapshot
      ? a.conditionSnapshot.enemy.some(ids => condition.statuses?.length ? condition.statuses.some(id => ids.includes(id)) : ids.length > 0)
      : b.enemies.some(unit => unit.hp > 0 && testStatus(unit));
    case 'any_ally_status': return a.conditionSnapshot
      ? a.conditionSnapshot.ally.some(ids => condition.statuses?.length ? condition.statuses.some(id => ids.includes(id)) : ids.length > 0)
      : b.allies.some((unit, i) => game.party[i].hp > 0 && testStatus(unit));
    case 'other_ally_status': return b.allies.some((unit, i) => i !== actor && game.party[i].hp > 0 && testStatus(unit));
    case 'target_type': return Boolean(enemy?.types?.some(id => condition.types?.includes(id)));
    case 'previous_weapon_skill': case 'previous_other_weapon_skill': return Boolean(a.previousWeaponSkill && a.previousWeaponSkill !== skill?.id);
    case 'weapon_type': return condition.weapons?.includes(member.equip?.weapon ? gearDef(data, member.equip.weapon).kind : 'none');
    case 'element': return skill?.elements?.some(id => condition.elements?.includes(id));
    case 'own_song': return b.allies.some(unit => Object.values(unit.masterEffects ?? {}).some(e => e.song && e.source === actor));
    case 'mp_half': return member.mp >= maxMp(data, member) * .5;
    default: return !condition.when;
  }
}
export function scopeMatches(skill, scope) {
  if (!scope || scope === 'all') return true;
  if (scope === 'weapon') return !skill || masterTags(skill).includes('weapon') || skill.effect?.base === 'weapon';
  if (scope === 'weapon_or_qigong') return scopeMatches(skill, 'weapon') || masterTags(skill).includes('qigong');
  if (scope === 'active_weapon_or_qigong') return !skill?.isFinal && Boolean(skill) && (weaponSkill(skill) || masterTags(skill).includes('active') && masterTags(skill).includes('qigong'));
  if (scope === 'weapon_or_phys') return scopeMatches(skill, 'weapon') || skill?.effect?.base === 'phys';
  if (scope === 'magic') return skill?.effect?.base === 'mag' && skill.kind === 'attack';
  return masterTags(skill).includes(scope);
}
export function masterDamageBonus(data, game, b, actor, target, skill) {
  const member = game.party[actor], a = b.allies[actor];
  let rate = 0;
  for (const rule of [...passiveRules(data, member), skill?.effect?.rules ?? {}]) {
    for (const condition of rule.condition_damage ?? []) if (scopeMatches(skill, condition.scope) && masterCondition(data, game, b, actor, target, condition, skill)) rate += condition.rate ?? 0;
    if (rule.combo && weaponSkill(skill)) rate += (a.comboStage ?? 0) * rule.combo.step;
    if (rule.instrument && member.equip?.weapon && gearDef(data, member.equip.weapon).kind === 'instrument'
      && skill?.elements?.some(el => rule.instrument.elements?.includes(el))) rate += rule.instrument.damage ?? 0;
  }
  if (a.currentBoost && !skill?.isFinal && skill?.effect?.base === 'mag') rate += a.currentBoost.damage ?? 0;
  if (skill?.effect?.rules?.covered_attack_bonus && a.lastCoverClock != null && a.lastCoverClock >= (a.previousActionClock ?? -1)) rate += skill.effect.rules.covered_attack_bonus / (skill.effect.m || 1);
  for (const effect of Object.values(a.masterEffects ?? {})) {
    if (effect.nextDamage && matchesTag(skill, effect.nextDamage.tag)) rate += effect.nextDamage.rate;
  }
  rate += masterBuff(data, game, b, actor, 'dmg');
  for (const effect of Object.values(b.enemies[target]?.masterMarks ?? {})) rate += effect.rate ?? 0;
  return rate;
}
export function masterCritBonus(data, game, b, actor, skill) {
  let rate = 0;
  for (const rule of passiveRules(data, game.party[actor])) for (const cond of rule.condition_crit ?? []) {
    if (masterCondition(data, game, b, actor, null, cond, skill)) rate += cond.rate ?? 0;
  }
  return rate;
}
export function masterEvasionBonus(data, game, b, actor) {
  let rate = 0;
  for (const rule of passiveRules(data, game.party[actor])) for (const condition of rule.condition_evasion ?? []) {
    if (masterCondition(data, game, b, actor, null, condition)) rate += condition.rate ?? 0;
  }
  return rate;
}
export function masterCutBonus(data, game, b, actor, magic) {
  let rate = 0;
  for (const rule of passiveRules(data, game.party[actor])) for (const cond of rule.condition_cut ?? []) {
    if ((cond.scope !== 'magic' || magic) && (cond.scope !== 'physical' || !magic)
      && masterCondition(data, game, b, actor, null, cond)) rate += cond.rate ?? 0;
  }
  return rate;
}

export function grantMasterEffect(b, target, key, effect) {
  const effects = (b.allies[target].masterEffects ??= {});
  const old = effects[key];
  const next = { grantedClock: b.actionClock ?? 0, ...effect, remaining: Number.isFinite(effect.remaining) ? Math.max(1, effect.remaining) : 1 };
  if (old) {
    // 同名の弱い効果で強い値や長い期間を延長しない。
    const strength = e => Object.values(e.values ?? {}).reduce((sum, value) => sum + Math.abs(value), 0) + (e.regen?.amount ?? 0) + (e.shield ?? 0)
      + (e.nextMpSave?.rate ?? 0) + (e.nextDamage?.rate ?? 0) + (e.statusResist?.rate ?? 0);
    if (strength(old) > strength(next)) return old;
    if (strength(old) === strength(next)) next.remaining = Math.max(old.remaining, next.remaining);
  }
  effects[key] = next;
  return next;
}
function sourceSongBonus(data, game, b, effect) {
  const member = game.party[effect.source], actor = b.allies[effect.source];
  if (!effect.song || !member || !actor) return 0;
  let rate = 0;
  for (const rule of passiveRules(data, member)) if (rule.song_status?.statuses?.some(id => actor.statuses[id])) rate += rule.song_status.rate;
  return rate;
}
export function masterBuff(data, game, b, target, key) {
  return Object.values(b.allies[target]?.masterEffects ?? {}).reduce((sum, effect) => sum + (effect.values?.[key] ?? 0) * (1 + sourceSongBonus(data, game, b, effect)), 0);
}
export function masterMpSave(data, member, skill, b = null, actor = null) {
  if (skill.isFinal) return 0;
  let rate = 0;
  for (const rule of passiveRules(data, member)) {
    for (const entry of rule.mp_save ?? []) if (matchesTag(skill, entry.tag)) rate += entry.rate;
    if (b && actor != null && !b.allies[actor].firstActiveUsed) rate += rule.first_mp_save ?? 0;
  }
  if (b && actor != null) {
    for (const effect of Object.values(b.allies[actor].masterEffects ?? {})) {
      if (effect.nextMpSave && matchesTag(skill, effect.nextMpSave.tag)) rate += effect.nextMpSave.rate;
      for (const entry of effect.mpSave ?? []) if (matchesTag(skill, entry.tag)) rate += entry.rate;
    }
  }
  return rate;
}
export function masterHealingBonus(data, game, b, actor, skill) {
  let rate = 0;
  for (const rule of passiveRules(data, game.party[actor])) for (const condition of rule.condition_heal ?? []) {
    if (masterCondition(data, game, b, actor, null, condition, skill)) rate += condition.rate ?? 0;
  }
  return rate;
}
export function masterStatusResist(data, game, b, actor, status) {
  let rate = 0;
  for (const rule of passiveRules(data, game.party[actor])) if (rule.status_resist?.statuses?.includes(status) && !rule.status_resist.multiplicative) rate += rule.status_resist.rate;
  for (const effect of Object.values(b.allies[actor].masterEffects ?? {})) if (effect.statusResist?.statuses?.includes(status) && !effect.statusResist.multiplicative) rate += effect.statusResist.rate;
  return rate;
}
export function masterStatusMultiplier(data, game, b, actor, status) {
  const definitions = [...passiveRules(data, game.party[actor]).map(rule => rule.status_resist), ...Object.values(b.allies[actor].masterEffects ?? {}).map(effect => effect.statusResist)];
  return definitions.filter(rule => rule?.multiplicative && rule.statuses.includes(status)).reduce((mul, rule) => mul * (1 - rule.rate), 1);
}
export function beginMasterAction(data, game, b, actor, skill) {
  b.actionClock = (b.actionClock ?? 0) + 1;
  const a = b.allies[actor];
  a.currentActionClock = b.actionClock;
  a.conditionSnapshot = { enemy: b.enemies.filter(unit => unit.hp > 0).map(unit => Object.keys(unit.statuses ?? {}).filter(id => id !== 'taunt')),
    ally: b.allies.filter((_, i) => game.party[i].hp > 0).map(unit => Object.keys(unit.statuses ?? {}).filter(id => id !== 'taunt')) };
  const combo = passiveRules(data, game.party[actor]).find(rule => rule.combo)?.combo;
  if (weaponSkill(skill)) a.comboStage = combo && a.previousWeaponSkill && a.previousWeaponSkill !== skill.id ? Math.min(combo.max, (a.comboStage ?? 0) + 1) : 0;
  else a.comboStage = 0;
}
export function startMasterOpportunity(data, game, b, actor, ctx) {
  const a = b.allies[actor];
  for (const [key, effect] of Object.entries(a.masterEffects ?? {})) if (effect.expire === 'start') delete a.masterEffects[key];
  if (a.masterCounter?.expire === 'start') delete a.masterCounter;
  for (const effect of Object.values(a.masterEffects ?? {})) if (effect.regen?.trigger === 'start' && game.party[actor].hp > 0 && !a.statuses.petrify) {
    ctx.heal(actor, masterRegenAmount(data, game, b, actor, effect));
  }
  delete a.masterCounterUsed;
}
function masterRegenAmount(data, game, b, target, effect) {
  let amount = (effect.regen.amount ?? 0) * (1 + sourceSongBonus(data, game, b, effect));
  const caster = game.party[effect.source];
  if (caster) for (const rule of passiveRules(data, caster)) if (rule.regen_status?.statuses?.some(id => b.allies[target].statuses[id])) amount *= 1 + rule.regen_status.rate;
  return amount;
}
export function finishMasterOpportunity(data, game, b, actor, ctx, skill = null, voluntary = true) {
  const a = b.allies[actor], member = game.party[actor];
  for (const [key, effect] of Object.entries(a.masterEffects ?? {})) {
    if (effect.grantedClock === b.actionClock && voluntary) continue;
    if (effect.regen?.trigger === 'end' && member.hp > 0 && !a.statuses.petrify) ctx.heal(actor, masterRegenAmount(data, game, b, actor, effect));
    if (--effect.remaining <= 0) delete a.masterEffects[key];
  }
  for (const [index, covering] of b.allies.entries()) {
    const cover = covering.masterCover;
    if (!cover || (cover.target === 'selected' ? cover.targetIndex !== actor : index !== actor)) continue;
    if ((cover.grantedClock !== b.actionClock || !voluntary) && --cover.remaining <= 0) delete covering.masterCover;
  }
  if (a.masterCounter && (a.masterCounter.grantedClock !== b.actionClock || !voluntary) && --a.masterCounter.remaining <= 0) delete a.masterCounter;
  a.lastOpportunityRound = b.round;
  if (!voluntary) { a.previousWeaponSkill = null; a.comboStage = 0; delete a.conditionSnapshot; return; }
  for (const rule of passiveRules(data, member)) {
    if ((!skill || weaponSkill(skill)) && rule.on_attack) grantMasterEffect(b, actor, rule.skill.id, { values: rule.on_attack.buff, remaining: rule.on_attack.turns, expire: rule.on_attack.expire });
    if (healingSkill(skill) && rule.on_healing) grantMasterEffect(b, actor, rule.skill.id, { values: { cut: rule.on_healing.cut }, remaining: rule.on_healing.turns });
  }
  for (const [key, effect] of Object.entries(a.masterEffects ?? {})) {
    if (effect.grantedClock === b.actionClock) continue;
    if (effect.nextMpSave && matchesTag(skill, effect.nextMpSave.tag)) delete a.masterEffects[key];
    if (effect.nextDamage && matchesTag(skill, effect.nextDamage.tag)) delete a.masterEffects[key];
  }
  a.previousWeaponSkill = weaponSkill(skill) ? skill.id : null;
  if (skill && !skill.isFinal && skill.kind !== 'passive') a.firstActiveUsed = true;
  a.previousActionClock = a.currentActionClock ?? b.actionClock;
  delete a.currentBoost;
  delete a.conditionSnapshot;
}

export function masterCoverTarget(data, game, b, original, magic) {
  for (let actor = 0; actor < game.party.length; actor++) {
    if (actor === original || game.party[actor].hp <= 0) continue;
    const a = b.allies[actor];
    if (['petrify', 'sleep', 'freeze', 'stun', 'paralysis', 'confusion', 'charm'].some(id => a.statuses[id])) continue;
    const definitions = [a.masterCover, ...passiveRules(data, game.party[actor]).map(rule => rule.cover && ({ ...rule.cover, sourceSkill: rule.skill.id }))].filter(Boolean);
    for (const cover of definitions) {
      if (magic && cover.physical_only !== false) continue;
      if (cover.target === 'selected' && cover.targetIndex !== original) continue;
      if (cover.target === 'all_low_hp' && game.party[original].hp > maxHp(data, game.party[original]) * (cover.hp_threshold ?? .3)) continue;
      if (a.coverRound !== b.round) { a.coverRound = b.round; a.coverCount = 0; }
      const limit = a.masterCover?.target === 'all' ? a.masterCover.limit : cover.limit ?? 1;
      if (a.coverCount >= limit) continue;
      return { actor, cover, rate: cover.rate ?? 1 };
    }
  }
  return null;
}

export function onMasterCover(data, game, b, actor, received = false) {
  const a = b.allies[actor];
  if (!received) { a.coverCount = (a.coverCount ?? 0) + 1; return; }
  a.lastCoverRound = b.round;
  a.lastCoverClock = b.actionClock ?? 0;
  for (const rule of passiveRules(data, game.party[actor])) if (rule.on_cover) {
    if (!a.masterEffects?.[rule.skill.id]) a.coverStages = 0;
    a.coverStages = Math.min(rule.on_cover.max, (a.coverStages ?? 0) + 1);
    grantMasterEffect(b, actor, rule.skill.id, { values: { def: rule.on_cover.def * a.coverStages }, remaining: rule.on_cover.turns });
  }
}
