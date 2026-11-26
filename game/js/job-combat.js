// 職業の技能効果。数値は技能マスタ、蓄積は戦闘オブジェクトへ保存する。
import { effectiveSkill } from './growth.js?v=advanced-jobs-1';
import { gearDef, maxHp, maxMp } from './character.js?v=advanced-jobs-1';

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
  if (!skill || skill.isFinal || reactionSkill(skill)) return false;
  if (tag === 'active' || !tag) return skill.kind !== 'passive';
  if (tag === 'weapon') return weaponSkill(skill);
  if (tag === 'heal') return ['heal','heal_all'].includes(skill.kind);
  if (tag === 'healing') return healingSkill(skill);
  return masterTags(skill).includes(tag);
}
export function masterCondition(data, game, b, actor, target, condition = {}, skill = null) {
  const a = b.allies[actor], member = game.party[actor], enemy = b.enemies[target];
  const testStatus = unit => Boolean(unit && (condition.statuses?.length
    ? condition.statuses.some(id => unit.statuses?.[id]) : Object.keys(unit.statuses ?? {}).some(id => id !== 'taunt')));
  switch (condition.when) {
    case 'target_def_down': return Boolean(enemy && (enemy.debuffs?.def?.[0] > 0 || Object.values(enemy.masterDebuffs ?? {}).some(e => e.stat === 'def' && e.value > 0)));
    case 'target_hp_below': return Boolean(enemy && enemy.hp <= enemy.maxHp * condition.threshold);
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
    case 'mp_threshold': return member.mp >= maxMp(data, member) * (condition.threshold ?? .5);
    case 'mp_half': return member.mp >= maxMp(data, member) * .5;
    case 'hp_below': return member.hp <= maxHp(data, member) * condition.threshold;
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
export function masterDamageBonus(data, game, b, actor, target, skill, elements = skill?.elements ?? [], targetHp = null) {
  const member = game.party[actor], a = b.allies[actor];
  let rate = 0;
  for (const rule of [...passiveRules(data, member), skill?.effect?.rules ?? {}]) {
    for (const condition of rule.condition_damage ?? []) if (scopeMatches(skill, condition.scope)
      && (!condition.elements?.length || condition.elements.some(id => elements.includes(id)))
      && (condition.when==='target_hp_below' && targetHp!=null ? targetHp<=b.enemies[target].maxHp*condition.threshold
        : masterCondition(data, game, b, actor, target, condition, { ...skill, elements }))) rate += condition.rate ?? 0;
    if (rule.combo && weaponSkill(skill)) rate += (a.comboStage ?? 0) * rule.combo.step;
    if (rule.instrument && member.equip?.weapon && gearDef(data, member.equip.weapon).kind === 'instrument'
      && skill?.elements?.some(el => rule.instrument.elements?.includes(el))) rate += rule.instrument.damage ?? 0;
  }
  if (a.currentBoost && !skill?.isFinal && skill?.effect?.base === 'mag' && !reactionSkill(skill)) rate += a.currentBoost.damage ?? 0;
  if (normalQigong(skill) && a.advancedAction?.executed) rate += (a.advancedAction.qigongBonus ?? 0)
    + (a.advancedAction.previousSelfRecovery ? skill.effect.rules?.previous_self_recovery ?? 0 : 0);
  if (skill?.effect?.base === 'mag' && a.advancedAction?.executed && !reactionSkill(skill)) rate += a.advancedAction.cloneFocus ?? 0;
  if (skill?.effect?.rules?.covered_attack_bonus && a.lastCoverClock != null && a.lastCoverClock >= (a.previousActionClock ?? -1)) rate += skill.effect.rules.covered_attack_bonus / (skill.effect.m || 1);
  for (const effect of Object.values(a.masterEffects ?? {})) {
    if (effect.nextDamage && matchesTag(skill, effect.nextDamage.tag)) rate += effect.nextDamage.rate;
    if (masterTags(skill).includes('qigong')) rate += effect.qigongDamage ?? 0;
    if (skill?.effect?.base === 'mag' && effect.magicDamage && (!effect.magicDamage.normalOnly || directMagic(skill))
      && effect.magicDamage.elements.some(element => elements.includes(element))) rate += effect.magicDamage.rate;
  }
  rate += masterBuff(data, game, b, actor, 'dmg');
  if (!skill || skill.effect?.base === 'weapon') {
    const anger = angerRule(data, member);
    rate += angerStage(data, game, b, actor) * (anger?.damage ?? 0);
    rate += Object.values(a.masterEffects ?? {}).reduce((sum,effect)=>sum+(effect.weaponDamage??0),0);
    if (!masterTags(skill).includes('reaction') && !masterTags(skill).includes('trap')) {
      rate += a.advancedAction?.damageBonus ?? 0;
      if (a.advancedAction?.paidHp > 0) rate += ruleNumber(data, member, 'paid_weapon_damage');
    }
  }
  for (const effect of Object.values(b.enemies[target]?.masterMarks ?? {})) rate += effect.rate ?? 0;
  if (!skill || skill.effect?.base === 'weapon') {
    const duel = activeDuel(game, b, actor);
    if (duel?.target === target) rate += duel.damage + (duel.focus ? ruleNumber(data, member, 'duel_focus_bonus') : 0)
      + (skill?.effect.rules?.duel_finish_bonus ?? 0);
    if (duel?.target === target && duel.wasHit) rate += skill?.effect.rules?.duel_retaliation_bonus ?? 0;
    if (a.stance?.mode === 'attack') rate += skill?.effect.rules?.attack_stance_bonus ?? 0;
    if (masterTags(skill).includes('reaction')) rate += ruleNumber(data, member, 'weapon_counter_bonus');
  }
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
export function masterCutBonus(data, game, b, actor, magic, enemy = null) {
  let rate = 0;
  for (const rule of passiveRules(data, game.party[actor])) for (const cond of rule.condition_cut ?? []) {
    if ((cond.scope !== 'magic' || magic) && (cond.scope !== 'physical' || !magic)
      && masterCondition(data, game, b, actor, null, cond)) rate += cond.rate ?? 0;
  }
  rate -= angerStage(data, game, b, actor) * (angerRule(data, game.party[actor])?.received ?? 0);
  const duel = activeDuel(game, b, actor);
  if (duel && enemy != null) rate += duel.target === enemy ? -duel.received : ruleNumber(data, game.party[actor], 'outside_duel_cut');
  const source = b.enemies[enemy];
  for (const rule of passiveRules(data, game.party[actor])) {
    if (source && rule.low_hp_source_cut && source.hp <= source.maxHp * rule.low_hp_source_cut.threshold) rate += rule.low_hp_source_cut.rate;
    if (magic && aCloneSnapshot(b, actor)) rate += rule.clone_magic_cut ?? 0;
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
      + (e.nextMpSave?.rate ?? 0) + (e.nextDamage?.rate ?? 0) + (e.statusResist?.rate ?? 0) + (e.weaponDamage ?? 0)
      + (e.nextAccuracy?.rate ?? 0) + (e.targetCrit?.rate ?? 0) + (e.nextMagicEcho?.m ?? 0) + (e.qigongDamage ?? 0)
      + (e.magicDamage?.rate ?? 0) + (e.cloneEvasion ?? 0);
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
  const ally = b.allies[target];
  const stance = (ally?.stance?.values?.[key] ?? 0) + (key === 'res' && ally?.stance?.mode === 'guard' ? ruleNumber(data, game.party[target], 'guard_stance_res') : 0);
  return Object.values(ally?.masterEffects ?? {}).reduce((sum, effect) => sum + (effect.values?.[key] ?? 0) * (1 + sourceSongBonus(data, game, b, effect)), stance);
}
export function masterMpSave(data, member, skill, b = null, actor = null) {
  if (skill.isFinal) return 0;
  let rate = 0;
  for (const rule of passiveRules(data, member)) {
    for (const entry of rule.mp_save ?? []) if (matchesTag(skill, entry.tag)) rate += entry.rate;
    if (b && actor != null && !b.allies[actor].firstActiveUsed) rate += rule.first_mp_save ?? 0;
    if (b && actor != null && weaponSkill(skill) && rule.anger_mp_save
      && currentAnger(data, member, b.allies[actor]) >= rule.anger_mp_save.threshold) rate += rule.anger_mp_save.rate;
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
  a.advancedAction = { paidHp: 0, damageBonus: 0, actualDamage: 0, executed: false, cloneCount: cloneCount(a) };
  if (!angerRule(data, game.party[actor])) a.anger = 0;
  if (!prayerRule(data, game.party[actor])) a.prayer = 0;
  a.conditionSnapshot = { enemy: b.enemies.filter(unit => unit.hp > 0).map(unit => Object.keys(unit.statuses ?? {}).filter(id => id !== 'taunt')),
    ally: b.allies.filter((_, i) => game.party[i].hp > 0).map(unit => Object.keys(unit.statuses ?? {}).filter(id => id !== 'taunt')) };
  const combo = passiveRules(data, game.party[actor]).find(rule => rule.combo)?.combo;
  if (weaponSkill(skill)) a.comboStage = combo && a.previousWeaponSkill && a.previousWeaponSkill !== skill.id ? Math.min(combo.max, (a.comboStage ?? 0) + 1) : 0;
  else a.comboStage = 0;
}
export function startMasterOpportunity(data, game, b, actor, ctx) {
  const a = b.allies[actor];
  delete a.readGuard;
  delete a.substitute;
  clearDefeatedTacticalTargets(b);
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
  const performed = a.advancedAction?.executed ?? true;
  for (const [key, effect] of Object.entries(a.masterEffects ?? {})) {
    if (effect.grantedClock === b.actionClock && voluntary) continue;
    if (effect.regen?.trigger === 'end' && member.hp > 0 && !a.statuses.petrify) ctx.heal(actor, masterRegenAmount(data, game, b, actor, effect));
    if (--effect.remaining <= 0) {
      delete a.masterEffects[key];
      if (effect.blessing && effect.shield > 0) expireBlessing(data, game, b, actor, effect);
    }
  }
  for (const [index, covering] of b.allies.entries()) {
    const cover = covering.masterCover;
    if(index===actor && covering.masterUltimateCover && (covering.masterUltimateCover.grantedClock!==b.actionClock || !voluntary) && --covering.masterUltimateCover.remaining<=0)delete covering.masterUltimateCover;
    if (!cover || (cover.target === 'selected' ? cover.targetIndex !== actor : index !== actor)) continue;
    if ((cover.grantedClock !== b.actionClock || !voluntary) && --cover.remaining <= 0) delete covering.masterCover;
  }
  if (a.masterCounter && (a.masterCounter.grantedClock !== b.actionClock || !voluntary) && --a.masterCounter.remaining <= 0) delete a.masterCounter;
  a.lastOpportunityRound = b.round;
  finishTacticalOpportunity(data, game, b, actor, skill, voluntary && performed, voluntary);
  finishSpecialistOpportunity(data, game, b, actor, skill, voluntary && performed, voluntary);
  finishAdvancedAction(data, game, b, actor, skill, voluntary);
  if (!voluntary || !performed) { a.previousWeaponSkill = null; a.comboStage = 0; delete a.conditionSnapshot; return; }
  for (const rule of passiveRules(data, member)) {
    if ((!skill || weaponSkill(skill)) && rule.on_attack) grantMasterEffect(b, actor, rule.skill.id, { values: rule.on_attack.buff, remaining: rule.on_attack.turns, expire: rule.on_attack.expire });
    if (healingSkill(skill) && rule.on_healing) grantMasterEffect(b, actor, rule.skill.id, { values: { cut: rule.on_healing.cut }, remaining: rule.on_healing.turns });
  }
  for (const [key, effect] of Object.entries(a.masterEffects ?? {})) {
    if (effect.grantedClock === b.actionClock) continue;
    if (effect.nextMpSave && matchesTag(skill, effect.nextMpSave.tag) && ((effect.nextMpSave.uses ??= 1), --effect.nextMpSave.uses <= 0)) delete a.masterEffects[key];
    if (effect.nextDamage && matchesTag(skill, effect.nextDamage.tag)) delete a.masterEffects[key];
  }
  a.previousWeaponSkill = weaponSkill(skill) ? skill.id : null;
  if (skill && !skill.isFinal && skill.kind !== 'passive') a.firstActiveUsed = true;
  a.previousActionClock = a.currentActionClock ?? b.actionClock;
  delete a.currentBoost;
  delete a.conditionSnapshot;
}

// 追加職も現在の職名には依存させず、装着した技能と保存可能な状態で判定する。
export const angerRule = (data, member) => passiveRules(data, member).find(rule=>rule.anger)?.anger;
function currentAnger(data, member, ally) {
  const rule=angerRule(data,member);
  return rule ? Math.max(0,Math.min(rule.max,Number(ally.anger)||0)) : 0;
}
export function angerStage(data, game, b, actor) {
  return currentAnger(data,game.party[actor],b.allies[actor]);
}
export function ownedBlessing(b, actor, target = actor) {
  const effect = b.allies[target]?.masterEffects?.blessing;
  return effect?.source === actor && effect.shield > 0 ? effect : null;
}
export function hpPayment(data, game, b, actor, skill) {
  const rate = skill?.effect.rules?.hp_cost;
  if (!rate || skill.isFinal) return 0;
  const preparation = Object.values(b.allies[actor].masterEffects ?? {}).find(effect=>effect.nextHpCost);
  return Math.max(1,Math.ceil(maxHp(data,game.party[actor])*rate*(preparation?.nextHpCost.rate??1)));
}
export function spendHpPayment(data, game, b, actor, skill) {
  const cost=hpPayment(data,game,b,actor,skill);
  if (cost>0) {
    game.party[actor].hp-=cost;
    for (const [key,effect] of Object.entries(b.allies[actor].masterEffects??{})) if (effect.nextHpCost) delete b.allies[actor].masterEffects[key];
  }
  return cost;
}
export function advancedSkillBlock(data, game, b, actor, skill) {
  if (game.party[actor].hp <= hpPayment(data,game,b,actor,skill)) return 'HPの支払い後に1以上残す必要がある';
  if (skill.effect.rules?.consume_blessing && !ownedBlessing(b,actor)) return '自分に自分の加護が必要';
  if (skill.effect.rules?.move_blessing && !b.allies.some((_,target)=>ownedBlessing(b,actor,target))) return '移せる自分の加護がない';
  if (skill.effect.rules?.require_prayer && prayerStage(data, game, b, actor) <= 0) return '祈りの往還を装備して祈念をためてください';
  if (skill.effect.rules?.spend_clone && !cloneCount(b.allies[actor])) return '分身が1体必要';
  if (skill.effect.rules?.require_direct_magic && !(game.party[actor].loadout?.actions ?? []).some(id => {
    const magic = data.skills.get(id);
    return directMagic(magic) && weaponAllowed(data, game.party[actor], magic);
  })) return '通常の攻撃魔法を装備してください';
  return '';
}
export function advancedTargetBlock(data, game, b, actor, skill, target, action) {
  if (!skill.effect.additional) return '';
  const rule=skill.effect.rules??{};
  if (skill.effect.tgt === 'selected_enemy' && !(b.enemies[target]?.hp > 0)) return '生存している敵を選んでください';
  const partyTarget = ['ally_buff','heal','cure'].includes(skill.kind) && skill.effect.tgt!=='self';
  if (partyTarget && (!game.party[target] || game.party[target].hp<=0 || b.allies[target].statuses.petrify)) return '生存している対象を選んでください';
  if (rule.move_blessing && (!ownedBlessing(b,actor,action.sourceTarget) || action.sourceTarget===target
    || !game.party[action.sourceTarget]?.hp || b.allies[action.sourceTarget].statuses.petrify)) return '加護の移動元と別の移動先を選んでください';
  if (action.consumeBlessing && rule.optional_blessing && !ownedBlessing(b,actor)) return '消費できる自分の加護がない';
  if (action.consumeClone && rule.optional_clone && !cloneCount(b.allies[actor])) return '消費できる分身がない';
  if (skill.kind==='attack' && !b.enemies.some(enemy=>enemy.hp>0)) return '生存している敵を選んでください';
  if (skill.kind==='attack' && !['all','random'].includes(skill.effect.tgt) && !(b.enemies[target]?.hp>0)) return '生存している敵を選んでください';
  if (action.targets && (!Array.isArray(action.targets) || !action.targets.length || new Set(action.targets).size!==action.targets.length
    || action.targets.length>(skill.effect.target_limit??b.enemies.length) || action.targets.some(i=>!(b.enemies[i]?.hp>0)))) return '異なる生存敵を上限内で選んでください';
  return '';
}
export function payAdvancedCosts(data, game, b, actor, skill, action) {
  const ally=b.allies[actor], rule=skill.effect.rules??{}, state=ally.advancedAction;
  state.executed=true;
  state.previousSelfRecovery = Boolean(ally.previousSelfRecovery);
  if (normalQigong(skill) && ally.breathReady && passiveRules(data, game.party[actor]).some(p => p.breath_cycle)) state.qigongBonus = ally.breathReady.rate;
  delete ally.breathReady;
  delete ally.previousSelfRecovery;
  for (const p of passiveRules(data, game.party[actor])) if (p.clone_focus && state.cloneCount >= p.clone_focus.count) state.cloneFocus = (state.cloneFocus ?? 0) + p.clone_focus.rate;
  if (rule.spend_clone || rule.optional_clone && action.consumeClone) {
    ally.clones.shift();
    state.cloneSpent = true;
    if (rule.optional_clone) state.damageBonus += rule.optional_clone;
  }
  state.paidHp=spendHpPayment(data,game,b,actor,skill);
  if (rule.consume_blessing || rule.optional_blessing && action.consumeBlessing) {
    delete ally.masterEffects.blessing;
    if (rule.optional_blessing) state.damageBonus+=rule.optional_blessing;
  }
  if (rule.spend_anger) {
    state.damageBonus+=angerStage(data,game,b,actor)*rule.spend_anger;
    ally.anger=0;
  }
  const prayer = prayerStage(data, game, b, actor), devotion = prayerRule(data, game.party[actor]);
  if (prayer > 0 && (rule.spend_prayer || weaponSkill(skill))) {
    state.prayerSpent = rule.spend_prayer?.all ? prayer : 1;
    state.damageBonus += state.prayerSpent * (rule.spend_prayer?.damage ?? devotion?.damage ?? 0);
    // 支援の全消費は攻撃強化を生成しない。
    if (rule.prayer_shield) state.damageBonus = 0;
    ally.prayer = prayer - state.prayerSpent;
  }
}
function finishAdvancedAction(data, game, b, actor, skill, voluntary) {
  const ally=b.allies[actor], rule=angerRule(data,game.party[actor]);
  if (game.party[actor].hp<=0 || !rule) ally.anger=0;
  else if (voluntary && ally.advancedAction?.executed) {
    if ((!skill || weaponSkill(skill)) && !skill?.isFinal && !skill?.effect.rules?.spend_anger && ally.advancedAction.actualDamage>0)
      ally.anger=Math.min(rule.max,angerStage(data,game,b,actor)+1);
    else if (skill && skill.kind!=='attack') ally.anger=Math.max(0,angerStage(data,game,b,actor)-1);
  }
  delete ally.advancedAction;
}

export function masterShieldRoom(data, game, b, target, replaceKey = null) {
  const used=Object.entries(b.allies[target].masterEffects??{}).reduce((sum,[key,effect])=>sum+(key!==replaceKey?Math.max(0,effect.shield??0):0),0)
    + Math.max(0,b.allies[target].buffs?.barrier?.[0]??0);
  return Math.max(0,Math.floor(maxHp(data,game.party[target])*(data.basicJobRules?.caps?.shield_hp??.5))-used);
}
export function grantBlessing(data, game, b, actor, target, skill, stats, cm) {
  const rule=skill.effect.rules.blessing, formula=data.basicJobRules.protection;
  const base=Math.floor(formula.base+formula.per_level*game.party[actor].lv+formula.stat_scale*stats.res);
  const shield=Math.max(0,Math.min(masterShieldRoom(data,game,b,target,'blessing'),Math.floor(base*rule.m*cm)));
  if (!shield) return;
  const old=b.allies[target].masterEffects.blessing;
  if (old?.skillId===skill.id && old.source===actor && old.shield>shield) return;
  const passives=passiveRules(data,game.party[actor]);
  const effect={blessing:true,source:actor,skillId:skill.id,shield,remaining:rule.turns,grantedClock:b.actionClock,
    createdClock:b.actionClock,counter:rule.counter?structuredClone(rule.counter):null,
    breakHeal:Math.max(rule.break_heal??0,ruleNumber(data,game.party[actor],'blessing_break_heal')),
    healLimit:rule.heal_limit??1,expireBonus:structuredClone(passives.find(p=>p.blessing_expire)?.blessing_expire??null)};
  // 加護は使用者・技能にかかわらず対象に1枚。同名の弱い上書きで延長しない。
  if (old?.skillId===skill.id && old.source===actor && old.shield===shield) effect.remaining=Math.max(old.remaining,effect.remaining);
  b.allies[target].masterEffects.blessing=effect;
}
function expireBlessing(data, game, b, target, effect) {
  const source=b.allies[effect.source], bonus=effect.expireBonus;
  if (!bonus || !(game.party[target].hp>0) || !(game.party[effect.source]?.hp>0) || source.blessingExpireRound===b.round) return;
  source.blessingExpireRound=b.round;
  grantMasterEffect(b,target,'paladin_P03',{values:{cut:bonus.cut},remaining:bonus.turns,source:effect.source});
}
/** 敵1行動の全対象・全打撃後に反応させるため、破壊記録だけを残す。 */
export function absorbMasterShields(b, target, damage, source, notify) {
  const shields=Object.entries(b.allies[target].masterEffects??{}).filter(([,effect])=>effect.shield>0)
    .sort(([ak,a],[bk,c])=>a.remaining-c.remaining || (a.createdClock??a.grantedClock)-(c.createdClock??c.grantedClock)||ak.localeCompare(bk));
  for (const [key,effect] of shields) {
    const absorbed=Math.min(damage,effect.shield);
    effect.shield-=absorbed; damage-=absorbed;
    notify(absorbed);
    if (effect.shield<=0) {
      delete b.allies[target].masterEffects[key];
      if (effect.blessing) (b.brokenBlessings??=[]).push({target,effect,enemy:source.i});
    }
    if (damage<=0) break;
  }
  return damage;
}
export function resolveBrokenBlessings(data, game, b, ctx) {
  const records=b.brokenBlessings??[];
  b.brokenBlessings=[];
  for (const {target,effect,enemy} of records) {
    const actor=effect.source, source=b.allies[actor];
    if (!(game.party[actor]?.hp>0) || !(game.party[target]?.hp>0)) continue;
    if (effect.breakHeal>0) {
      if (source.blessingHealRound!==b.round) {source.blessingHealRound=b.round;source.blessingHealCount=0;source.blessingNormalHealCount=0;source.blessingHealLimit=1;}
      source.blessingHealLimit=Math.max(source.blessingHealLimit,effect.healLimit);
      if (source.blessingHealCount<source.blessingHealLimit && (effect.healLimit>1 || source.blessingNormalHealCount<1)) {
        source.blessingHealCount++;
        if (effect.healLimit===1) source.blessingNormalHealCount++;
        ctx.heal(target,Math.floor(maxHp(data,game.party[target])*effect.breakHeal));
      }
    }
    if (effect.counter && b.enemies[enemy]?.hp>0 && ctx.canReact(actor)) {
      if (source.counterRound!==b.round) {source.counterRound=b.round;source.counterCount=0;}
      if (source.counterCount<(data.basicJobRules?.caps?.counter_per_round??1)) {
        source.counterCount++;
        ctx.react(actor,enemy,effect.counter);
      }
    }
  }
}

export function masterCoverTarget(data, game, b, original, magic) {
  for (let actor = 0; actor < game.party.length; actor++) {
    if (actor === original || game.party[actor].hp <= 0) continue;
    const a = b.allies[actor];
    if (['petrify', 'sleep', 'freeze', 'stun', 'paralysis', 'confusion', 'charm'].some(id => a.statuses[id])) continue;
    const definitions = [a.masterCover, ...passiveRules(data, game.party[actor]).map(rule => rule.cover && ({ ...rule.cover, sourceSkill: rule.skill.id })), a.masterUltimateCover].filter(Boolean);
    for (const cover of definitions) {
      if (magic && cover.physical_only !== false) continue;
      if (cover.target === 'selected' && cover.targetIndex !== original) continue;
      if (cover.target === 'all_low_hp' && game.party[original].hp > maxHp(data, game.party[original]) * (cover.hp_threshold ?? .3)) continue;
      if (a.coverRound !== b.round) { a.coverRound = b.round; a.coverCount = 0; a.normalCoverCount=0; }
      const limit=a.masterUltimateCover?.limit??1;
      if(a.coverCount>=limit || (cover.target!=='all' && (a.normalCoverCount??0)>=1))continue;
      a.selectedCoverNormal=cover.target!=='all';
      return { actor, cover, rate: cover.rate ?? 1 };
    }
  }
  return null;
}

export function onMasterCover(data, game, b, actor, received = false) {
  const a = b.allies[actor];
  if (!received) { a.coverCount = (a.coverCount ?? 0) + 1; if(a.selectedCoverNormal)a.normalCoverCount=(a.normalCoverCount??0)+1; return; }
  a.lastCoverRound = b.round;
  a.lastCoverClock = b.actionClock ?? 0;
  for (const rule of passiveRules(data, game.party[actor])) if (rule.on_cover) {
    if (!a.masterEffects?.[rule.skill.id]) a.coverStages = 0;
    a.coverStages = Math.min(rule.on_cover.max, (a.coverStages ?? 0) + 1);
    grantMasterEffect(b, actor, rule.skill.id, { values: { def: rule.on_cover.def * a.coverStages }, remaining: rule.on_cover.turns });
  }
}


// 追加4〜6職。姿勢と反撃準備は別枠、資源・標的は戦闘内だけで保持する。
export const prayerRule = (data, member) => passiveRules(data, member).find(rule => rule.prayer)?.prayer;
export function prayerStage(data, game, b, actor) {
  const rule = prayerRule(data, game.party[actor]);
  return rule ? Math.max(0, Math.min(rule.max, Number(b.allies[actor].prayer) || 0)) : 0;
}
export function activeDuel(game, b, actor) {
  const duel = b.allies[actor]?.duel;
  return game.party[actor]?.hp > 0 && duel?.remaining > 0 && b.enemies[duel.target]?.hp > 0 ? duel : null;
}
export function tacticalDefIgnore(b, actor, skill) {
  return b.allies[actor].stance?.mode === 'guard' ? skill?.effect.rules?.guard_stance_pierce ?? 0 : 0;
}
export function prepareDuelAttack(game, b, actor, targets) {
  const duel = activeDuel(game, b, actor);
  if (duel && targets.some(target => target !== duel.target)) duel.focus = false;
}
export function targetedEvasion(b, actor, enemy) {
  const range = b.allies[actor].distance;
  return range?.remaining > 0 && range.target === enemy ? range.evasion : 0;
}
export function readGuardCut(b, actor, magic, elements) {
  const guard = b.allies[actor].readGuard;
  if (magic || !guard || !elements.includes(guard.element)) return 0;
  guard.usedAction = b.enemyActionClock;
  return guard.rate;
}
export function finishReadGuards(b) {
  for (const ally of b.allies) if (ally.readGuard?.usedAction != null && ally.readGuard.usedAction === b.enemyActionClock) delete ally.readGuard;
}
export function consumeStatusPreparation(b, actor, status) {
  for (const [key, effect] of Object.entries(b.allies[actor].masterEffects ?? {})) {
    if (effect.statusResist?.uses > 0 && effect.statusResist.statuses.includes(status)) {
      if (--effect.statusResist.uses <= 0) delete b.allies[actor].masterEffects[key];
    }
  }
}
export function clearDefeatedTacticalTargets(b) {
  for (const ally of b.allies) {
    for (const key of ['duel', 'distance']) if (ally[key] && !(b.enemies[ally[key].target]?.hp > 0)) delete ally[key];
    if (ally.masterCounter?.target != null && !(b.enemies[ally.masterCounter.target]?.hp > 0)) delete ally.masterCounter;
    for (const [key,effect] of Object.entries(ally.masterEffects??{})) if (effect.targetCrit && !(b.enemies[effect.targetCrit.target]?.hp>0)) delete ally.masterEffects[key];
  }
}
export function resetTacticalState(ally) {
  for (const key of ['stance', 'duel', 'distance', 'readGuard', 'clones', 'substitute', 'breathReady',
    'previousSelfRecovery', 'cloneDefense', 'cloneEnemySnapshot']) delete ally[key];
  ally.prayer = 0;
  // 決着の余裕の一戦1回フラグは、蘇生しても戻さない。
}
export function duelVictory(data, game, b, actor, enemy, primary) {
  const ally = b.allies[actor], duel = ally?.duel;
  if (!primary || !ally.advancedAction?.executed || !duel || duel.target !== enemy || !(game.party[actor]?.hp > 0) || ally.duelRewardUsed) return 0;
  const rate = ruleNumber(data, game.party[actor], 'duel_victory');
  if (!rate) return 0;
  ally.duelRewardUsed = true;
  return Math.floor(maxHp(data, game.party[actor]) * rate);
}
export function noteDuelHit(game, b, actor, enemy) {
  const duel = activeDuel(game, b, actor);
  if (duel?.target === enemy) duel.wasHit = true;
}
export function grantProtection(data, game, b, actor, target, skill, rule, stats, cm) {
  const formula = data.basicJobRules.protection;
  const base = Math.floor(formula.base + formula.per_level * game.party[actor].lv + formula.stat_scale * stats[rule.stat]);
  const shield = Math.max(0, Math.floor(Math.min(masterShieldRoom(data, game, b, target, skill.id), base * rule.m * cm)));
  if (!shield) return;
  grantMasterEffect(b, target, skill.id, { shield, values: {}, remaining: rule.turns, source: actor, skillId: skill.id });
}
export function applyTacticalRules(data, game, b, actor, skill, target, cm, action, stats) {
  const ally = b.allies[actor], rules = skill.effect.rules ?? {}, passives = passiveRules(data, game.party[actor]);
  if (rules.stance) {
    const previous = ally.stance;
    const switched = previous && previous.mode !== rules.stance.mode;
    ally.stance = { mode: rules.stance.mode, skillId: skill.id, held: switched || !previous ? 0 : previous.held,
      values: Object.fromEntries(Object.entries(rules.stance.values).map(([key, value]) => [key, value * cm])), grantedClock: b.actionClock };
    if (switched) for (const p of passives) if (p.stance_switch && previous.held >= p.stance_switch.minimum_actions) {
      grantMasterEffect(b, actor, p.skill.id, { nextDamage: { tag: 'weapon', rate: p.stance_switch.rate }, remaining: p.stance_switch.turns });
    }
  }
  if (rules.duel) ally.duel = { ...rules.duel, target, remaining: rules.duel.turns, focus: true, wasHit: false, skillId: skill.id, grantedClock: b.actionClock };
  if (rules.distance) ally.distance = { ...rules.distance, target, remaining: rules.distance.turns, skillId: skill.id, grantedClock: b.actionClock };
  if (rules.read_guard) ally.readGuard = { ...rules.read_guard, element: action.element, skillId: skill.id };
  if (rules.after_self_buff) grantMasterEffect(b, actor, skill.id, { values: rules.after_self_buff.values, remaining: rules.after_self_buff.turns });
  if (rules.target_counter && b.enemies[target]?.hp > 0) ally.masterCounter = { ...rules.target_counter, target,
    remaining: rules.target_counter.turns, skillId: skill.id, grantedClock: b.actionClock };
  const living = game.party.flatMap((member, index) => member.hp > 0 && !b.allies[index].statuses.petrify ? [index] : []);
  if (rules.protection) {
    const recipients = skill.kind === 'self_buff' ? [actor] : [target];
    for (const index of recipients) if (living.includes(index)) grantProtection(data, game, b, actor, index, skill, rules.protection, stats, cm);
  }
  if (rules.prayer_shield) {
    const spent = ally.advancedAction?.prayerSpent ?? 0;
    for (const index of living) grantProtection(data, game, b, actor, index, skill, { ...rules.prayer_shield, m: rules.prayer_shield.m * spent }, stats, cm);
  }
  if (rules.guard_party_buff && ally.stance?.mode === 'guard') {
    for (const index of living) grantMasterEffect(b, index, skill.id, { values: Object.fromEntries(Object.entries(rules.guard_party_buff.values).map(([key,value])=>[key,value*cm])),
      remaining: rules.guard_party_buff.turns, source: actor, skillId: skill.id, party: true });
  }
}
function finishTacticalOpportunity(data, game, b, actor, skill, performed, voluntary) {
  const ally = b.allies[actor], state = ally.advancedAction;
  if (ally.stance && (ally.stance.grantedClock !== b.actionClock || !voluntary)) ally.stance.held++;
  for (const key of ['duel', 'distance']) {
    if (ally[key] && (ally[key].grantedClock !== b.actionClock || !voluntary) && --ally[key].remaining <= 0) delete ally[key];
  }
  clearDefeatedTacticalTargets(b);
  if (!(game.party[actor].hp > 0)) { resetTacticalState(ally); return; }
  if (!performed || !state?.executed) return;
  const support = Boolean(skill && skill.kind !== 'attack' && !skill.effect.rules?.stance && state.effectiveSupport);
  const passives = passiveRules(data, game.party[actor]);
  if (support && !skill.isFinal && state.mpPaid > 0 && !skill.effect.rules?.no_prayer_gain) {
    const rule = prayerRule(data, game.party[actor]);
    if (rule) ally.prayer = Math.min(rule.max, prayerStage(data, game, b, actor) + 1);
  }
  for (const p of passives) {
    if (support && p.on_effective_support) grantMasterEffect(b, actor, p.skill.id, { values: { mcut: p.on_effective_support.cut }, remaining: p.on_effective_support.turns });
    if (state.prayerSpent > 0 && p.on_prayer_spend) grantMasterEffect(b, actor, p.skill.id, { values: { res: p.on_prayer_spend.res }, remaining: p.on_prayer_spend.turns });
    if (weaponSkill(skill) && state.elements?.includes('thunder') && p.thunder_next_mp) grantMasterEffect(b, actor, p.skill.id,
      { nextMpSave: { ...p.thunder_next_mp, uses: 1 }, remaining: p.thunder_next_mp.turns });
  }
  if (skill?.effect.rules?.end_duel) delete ally.duel;
  if (ally.duel) ally.duel.wasHit = false;
}

// 追加7〜9職。追撃は独立した自発行動にせず、実ダメージと費用の確定を分ける。
export const reactionSkill = skill => masterTags(skill).some(tag => ['reaction','trap','followup'].includes(tag));
export const directMagic = skill => Boolean(skill && !skill.isFinal && skill.kind === 'attack' && skill.effect?.base === 'mag' && !reactionSkill(skill));
const normalQigong = skill => Boolean(skill && !skill.isFinal && skill.kind === 'attack' && masterTags(skill).includes('qigong') && !reactionSkill(skill));
export const cloneCount = ally => (ally.clones ?? []).filter(clone => clone.remaining > 0).length;
function aCloneSnapshot(b, actor) {
  const snapshot = b.allies[actor].cloneEnemySnapshot;
  return Boolean(snapshot && snapshot.clock === b.enemyActionClock && snapshot.hadClone);
}
export function snapshotCloneDefense(b) {
  for (const ally of b.allies) ally.cloneEnemySnapshot = {clock:b.enemyActionClock,hadClone:cloneCount(ally)>0};
}
export function cloneDefense(b, actor, {single=true,sureHit=false}={}) {
  const ally=b.allies[actor];
  if (ally.cloneDefense && ally.cloneDefense.clock===b.enemyActionClock) return ally.cloneDefense;
  const result={clock:b.enemyActionClock,substitute:false,evasion:0};
  ally.cloneDefense=result;
  if (sureHit) return result;
  if (single && ally.substitute) {
    result.substitute=true;
    delete ally.substitute;
    return result;
  }
  if (cloneCount(ally)) {
    const clone=ally.clones.shift();
    result.evasion=Math.max(clone.evasion, ...Object.values(ally.masterEffects??{}).map(effect=>effect.cloneEvasion??0));
  }
  return result;
}
export function specialistAccuracy(b, actor, skill) {
  if (!weaponSkill(skill)) return 0;
  return Object.values(b.allies[actor].masterEffects??{}).reduce((sum,effect)=>sum+(effect.nextAccuracy?.rate??0),0);
}
export function specialistCrit(b, actor, target, skill, targetHp = null) {
  if (!weaponSkill(skill)) return 0;
  const enemy=b.enemies[target];
  return Object.values(b.allies[actor].masterEffects??{}).reduce((sum,effect)=>sum
    +(effect.targetCrit?.target===target && (targetHp??enemy.hp)<=enemy.maxHp*effect.targetCrit.threshold ? effect.targetCrit.rate : 0),0);
}
export function notePrimaryKill(b, actor, enemy, primary) {
  const state=b.allies[actor]?.advancedAction;
  if (primary && state?.executed) (state.primaryKills??=[]).push(enemy);
}
export function recordSelfSupport(b, actor, before, after, skill) {
  const state=b.allies[actor].advancedAction;
  if (!state || !before || skill.kind==='attack') return;
  const old=before[actor],next=after[actor];
  state.selfHealed=next.hp>old.hp;
  state.selfRecovery=state.selfHealed || old.statuses.some(id=>!next.statuses.includes(id));
  state.selfProtection=next.shield>old.shield;
}
export function applySpecialistRules(data, game, b, actor, skill, target, cm) {
  const ally=b.allies[actor],rules=skill.effect.rules??{};
  if (rules.qigong_damage) grantMasterEffect(b,actor,skill.id+':qigong',{
    skillId:skill.id,qigongDamage:rules.qigong_damage.rate*cm,remaining:rules.qigong_damage.turns});
  if (rules.next_target_crit) grantMasterEffect(b,actor,skill.id,{
    skillId:skill.id,targetCrit:{...rules.next_target_crit,target},remaining:rules.next_target_crit.turns});
  if (rules.next_accuracy) grantMasterEffect(b,actor,skill.id+':accuracy',{
    skillId:skill.id,nextAccuracy:{...rules.next_accuracy},remaining:rules.next_accuracy.turns});
  if (rules.clones) {
    const rule=rules.clones;
    const clones=rule.replace?[]:(ally.clones??[]);
    for(let n=0;n<rule.count;n++) {
      while(clones.length>=rule.max)clones.shift();
      clones.push({remaining:rule.turns,evasion:rule.evasion,skillId:skill.id,level:skill.level??1,grantedClock:b.actionClock});
    }
    ally.clones=clones;
  }
  if (rules.substitute) ally.substitute={skillId:skill.id,expire:rules.substitute.expire};
  if (rules.next_magic_echo) grantMasterEffect(b,actor,skill.id,{
    skillId:skill.id,nextMagicEcho:{m:rules.next_magic_echo.m},remaining:rules.next_magic_echo.turns});
  if (rules.clone_empower) grantMasterEffect(b,actor,skill.id,{
    skillId:skill.id,cloneEvasion:rules.clone_empower.evasion,magicDamage:rules.clone_empower.magic,remaining:rules.clone_empower.turns});
}
function finishSpecialistOpportunity(data, game, b, actor, skill, performed, voluntary) {
  const ally=b.allies[actor],state=ally.advancedAction,member=game.party[actor];
  ally.clones=(ally.clones??[]).filter(clone=>(clone.grantedClock===b.actionClock&&voluntary)||--clone.remaining>0);
  if (!(member.hp>0)) {resetTacticalState(ally);return;}
  if (!voluntary) {delete ally.breathReady;delete ally.previousSelfRecovery;return;}
  if (!performed || !state?.executed) return;
  // 通常攻撃・道具等も、直前の自己回復と整息の「次の行動」を使い切る。
  delete ally.breathReady;
  delete ally.previousSelfRecovery;
  const support=Boolean(skill && skill.kind!=='attack');
  const passives=passiveRules(data,member);
  if (support && state.selfRecovery) ally.previousSelfRecovery=true;
  for(const p of passives) {
    if (support && !skill.isFinal && p.breath_cycle && (state.selfRecovery||state.selfProtection))
      ally.breathReady={rate:p.breath_cycle.rate,skillId:p.skill.id,level:p.skill.level??1};
    if (support && !skill.isFinal && ['heal','heal_all'].includes(skill.kind) && state.selfHealed && p.on_self_heal)
      grantMasterEffect(b,actor,p.skill.id,{values:{res:p.on_self_heal.res},remaining:p.on_self_heal.turns});
    if (!skill?.isFinal && state.primaryKills?.length && p.on_primary_kill && ally.primaryKillRound!==b.round) {
      ally.primaryKillRound=b.round;
      grantMasterEffect(b,actor,p.skill.id,{skillId:p.skill.id,nextMpSave:{...p.on_primary_kill,uses:1},remaining:p.on_primary_kill.turns});
    }
    if (skill && !skill.isFinal && state.cloneSpent && p.on_clone_spend)
      grantMasterEffect(b,actor,p.skill.id,{values:{eva:p.on_clone_spend.evasion},remaining:p.on_clone_spend.turns});
  }
  for(const [key,effect] of Object.entries(ally.masterEffects??{})) {
    if (effect.grantedClock===b.actionClock)continue;
    if (effect.nextAccuracy && weaponSkill(skill)) delete ally.masterEffects[key];
    if (effect.targetCrit && weaponSkill(skill) && state.weaponTargets?.includes(effect.targetCrit.target)) delete ally.masterEffects[key];
  }
}
