// 戦況を表示したまま、下段をコマンド・対象の案内・問題・結果に切り替える。
import { cancelBattleQuestion } from '../battle-question.js?v=battle-cancel-1';
import { now } from '../storage.js?v=skill-growth-2';
import { QuestionPicker, REASON_LABEL } from '../picker.js?v=skill-growth-2';
import { makePracticeQuestion, questionDirection, questionSpeech, DIRECTION } from '../quiz.js?v=skill-growth-2';
import { speak, canSpeak, stopSpeech } from '../speech.js?v=skill-growth-2';
import { nextTurn, actionOptions, setPending, prepareQuizAction, resolvePending, targetKind, skillMp, collectBattleHits, enemyIntent, enemyCanAct } from '../battle.js?v=fixed-monsters-1';
import { skillMaxLevel, learnedSkillLevel, effectiveSkill } from '../growth.js?v=advanced-jobs-1';
import { maxHp, maxMp } from '../character.js?v=advanced-jobs-1';
import { el, render } from '../dom.js?v=skill-growth-2';
import { expeditionScene } from './scenery.js?v=skill-growth-2';
import { monsterKnowledge } from '../monster-knowledge.js?v=fixed-monsters-1';
import { startBattleMusic, finishBattleMusic } from '../battle-music.js?v=skill-growth-2';
import { unlockBattleSound, playBattleHitSound } from '../battle-sound.js?v=skill-growth-2';
import { portraitIcon } from './portrait.js?v=skill-growth-2';
import { ultimateGauge } from './skill-presentation.js?v=skill-growth-2';
import { skillIcon } from './skill-icons.js?v=skill-icons-1';
import { describeSkillEffect, describeSkillForUI } from '../skill-effects.js?v=tactical-jobs-1';
import { ownedBlessing, passiveRules, activeDuel, prayerRule, prayerStage } from '../job-combat.js?v=jobs-19-21-1';
import { statusIconId, buffIconId, effectIcon, JOB_EFFECT_ICON } from './effect-icons.js?v=battle-effect-icons-1';

const TARGET_PROMPT = {
  enemy: '攻撃する敵を選ぶ',
  ally: '対象の味方を選ぶ',
  ko_ally: '倒れた味方を選ぶ',
};

/** 状態異常に加え、残っている障壁と次の行動に有効な準備を表示する。 */
export function battleConditionLabels(data, unit) {
  const names = Object.keys(unit.statuses ?? {}).map((id) => data.statusEffects.get(id)?.name ?? id);
  for(const mark of Object.values(unit.curseMarks??{}))if(mark.remaining>0&&mark.uses>0)
    names.push(`${data.skills.get(mark.skillId)?.name??'呪印'} ${mark.uses}回・残り${mark.remaining}行動`);
  if (unit.hp != null && unit.hp <= 0) return names;
  const [barrier, turns] = unit.buffs?.barrier ?? [];
  if (Number.isFinite(barrier) && barrier > 0 && turns > 0) names.push(`障壁 ${barrier} HP`);
  if (unit.normalSkillReady) names.push('次の攻撃技能を強化');
  if (unit.anger > 0) names.push(`怒気 ${unit.anger}/3`);
  const blessing=unit.masterEffects?.blessing;
  if (blessing?.shield>0) names.push(`加護 ${blessing.shield}・残り${blessing.remaining}行動`);
  const shield=Object.values(unit.masterEffects??{}).reduce((sum,effect)=>sum+(!effect.blessing?(effect.shield??0):0),0);
  if (shield>0) names.push(`防護 ${shield}`);
  return names;
}

const BUFF_NAMES = {
  str: 'STR', mag: 'MAG', def: 'DEF', res: 'RES', spd: 'SPD', luk: 'LUK',
  atk: '攻撃力', dmg: '与ダメージ', cut: '被ダメージ軽減', pcut: '物理ダメージ軽減',
  mcut: '魔法ダメージ軽減', eva: '回避率', crt: '会心率', crit: '会心率',
  regen: 'HP継続回復', mp_regen: 'MP継続回復', immune: '状態異常無効',
  barrier: '障壁', heal: '回復効果', healp: '回復効果',
};

export const JOB_EFFECT_SECTIONS = Object.freeze({
  party: '全体の強化・弱化',
  ongoing: 'ジョブの固有継続効果',
  special: 'その他の特殊効果',
});

// 付与元の職名ではなく、実際に保持している効果の性質で分類する。
function jobEffectSection(skill, effect) {
  if (effect.statusResist?.uses > 0) return JOB_EFFECT_SECTIONS.special;
  const continuous = Object.values(effect.values ?? {}).some(value => value !== 0)
    || effect.shield > 0 || effect.regen || effect.statusResist || effect.lifesteal || effect.weaponDamage || effect.mpSave?.length
    || effect.qigongDamage || effect.magicDamage || effect.cloneEvasion;
  if (!continuous && (effect.nextDamage || effect.nextMpSave || effect.nextHpCost || effect.nextAccuracy || effect.targetCrit || effect.nextMagicEcho
    || effect.nextTargetDamage || effect.nextMarkedIgnore || effect.nextJumpDamage)) return JOB_EFFECT_SECTIONS.special;
  if (effect.shield > 0 || effect.blessing) return JOB_EFFECT_SECTIONS.ongoing;
  if (effect.party || effect.song || skill?.kind === 'party_buff'
    || skill?.kind === 'ally_buff' && skill.effect?.tgt === 'all') return JOB_EFFECT_SECTIONS.party;
  return JOB_EFFECT_SECTIONS.ongoing;
}
function buffText(data, key, value) {
  const down = key.startsWith('down:');
  const name = down ? key.slice(5) : key;
  const label = name.startsWith('eres:') ? `${data.elements.get(name.slice(5))?.name ?? name.slice(5)}耐性`
    : name.startsWith('sres:') ? `${name.slice(5)}の状態異常耐性`
    : BUFF_NAMES[name] ?? name;
  if (name === 'barrier') return `${label} ${Math.round(value)} HP`;
  const number = Math.round((down ? -value : value) * 1000) / 10;
  return `${label} ${number > 0 ? '+' : ''}${number}%`;
}

export function allyEffectEntries(data, game, battle, index) {
  const member = game.party[index], ally = battle.allies[index];
  const entry = (label, icon = JOB_EFFECT_ICON) => ({ label, icon });
  const duration = value => Number.isFinite(value) ? `（残り${value}）` : '';
  const timedBuffs = (buffs, commonIcon = false) => Object.entries(buffs ?? {}).flatMap(([key, state]) => {
    if (!Array.isArray(state) || !(state[1] > 0) || !state[0]) return [];
    return [entry(buffText(data, key, state[0]) + duration(state[1]), commonIcon ? JOB_EFFECT_ICON : buffIconId(key, state[0]))];
  });
  const statuses = Object.entries(ally.statuses ?? {}).map(([id, state]) =>
    entry(`${data.statusEffects.get(id)?.name ?? id}${state.n > 1 ? ' ×' + state.n : ''}${duration(state.turns)}`, statusIconId(id)));
  if (member.hp <= 0) statuses.unshift(entry('戦闘不能', null));

  const party = timedBuffs(battle.partyBuffs, true), ongoing = [], special = [];
  if(member.hp>0 && battle.field?.remaining>0 && game.party[battle.field.source]?.hp>0)
    party.push(entry(`${data.elements.get(battle.field.element)?.name??battle.field.element}の場：直接ダメージ +${Math.round(battle.field.rate*100)}%（${game.party[battle.field.source].name}・残り${battle.field.remaining}行動）`));
  const groups = { [JOB_EFFECT_SECTIONS.party]: party, [JOB_EFFECT_SECTIONS.ongoing]: ongoing, [JOB_EFFECT_SECTIONS.special]: special };
  const passives = passiveRules(data, member);
  for (const [key, effect] of Object.entries(ally.masterEffects ?? {})) {
    if (effect.remaining <= 0) continue;
    const id = effect.skillId ?? key.replace(/:(mp|damage)$/, '');
    const skill = data.skills.get(id);
    const name = skill?.name ?? (effect.blessing ? '加護' : key);
    const values = Object.entries(effect.values ?? {}).filter(([, value]) => value !== 0).map(([stat, value]) => buffText(data, stat, value));
    if (effect.shield > 0) values.push(`防護 ${effect.shield} HP`);
    if (effect.blessing) values.push('加護');
    if (effect.regen) values.push(`HP継続回復 ${Math.round(effect.regen.amount ?? 0)}`);
    if (effect.statusResist) values.push(`状態異常耐性：${(effect.statusResist.statuses ?? []).map(id => data.statusEffects.get(id)?.name ?? id).join('・') || '対象状態異常'} ${Math.round(effect.statusResist.rate * 100)}%`);
    if (effect.statusResist?.uses > 0) values.push(`残り${effect.statusResist.uses}判定`);
    if (effect.preventCharges) values.push(`次の新規状態異常を${effect.preventCharges}回防ぐ`);
    if (effect.nextDamage) values.push(`次の攻撃ダメージ +${Math.round(effect.nextDamage.rate * 100)}%`);
    if (effect.nextMpSave) values.push(`次のスキル消費MP -${Math.round(effect.nextMpSave.rate * 100)}%・残り${effect.nextMpSave.uses ?? 1}回`);
    for (const save of effect.mpSave ?? []) values.push(`スキル消費MP -${Math.round(save.rate * 100)}%`);
    if (effect.nextHpCost) values.push(`次のスキルのHP消費 -${Math.round((1 - effect.nextHpCost.rate) * 100)}%・残り1回`);
    if (effect.lifesteal) values.push(`HP吸収 ${Math.round(effect.lifesteal * 100)}%`);
    if (effect.weaponDamage) values.push(`武器ダメージ +${Math.round(effect.weaponDamage * 100)}%`);
    if (effect.nextAccuracy) values.push(`次の通常武器技の命中 +${Math.round(effect.nextAccuracy.rate*100)}ポイント`);
    if (effect.nextTargetDamage && battle.enemies[effect.nextTargetDamage.target]?.hp>0) values.push(`対象 ${battle.enemies[effect.nextTargetDamage.target].name}・暗闇／恐怖／束縛なら次の通常武器技を強化`);
    if (effect.nextMarkedIgnore && ally.mark?.remaining>0 && battle.enemies[ally.mark.target]?.hp>0) values.push(`標的 ${battle.enemies[ally.mark.target].name}・次の通常武器技が防御を貫く`);
    if (effect.nextJumpDamage) values.push('次の跳躍の着地攻撃を強化');
    if (effect.markedPartyDamage && battle.enemies[effect.markedPartyDamage.target]?.hp>0) values.push(`対象 ${battle.enemies[effect.markedPartyDamage.target].name}への通常攻撃・技能を強化`);
    if (effect.targetCrit && battle.enemies[effect.targetCrit.target]?.hp>0) values.push(`対象 ${battle.enemies[effect.targetCrit.target].name}・HP${Math.round(effect.targetCrit.threshold*100)}%以下で次の通常武器技の会心 +${Math.round(effect.targetCrit.rate*100)}ポイント`);
    if (effect.nextMagicEcho) values.push('次の通常攻撃魔法で主対象に追撃1回');
    if (effect.qigongDamage) values.push(`気功ダメージ +${Math.round(effect.qigongDamage*100)}%`);
    if (effect.cloneEvasion) values.push(`分身の回避補助 +${Math.round(effect.cloneEvasion*100)}ポイント`);
    if (effect.magicDamage) values.push(`${effect.magicDamage.elements.map(id=>data.elements.get(id)?.name??id).join('・')}の通常攻撃魔法 +${Math.round(effect.magicDamage.rate*100)}%`);
    if (effect.momentum) values.push(`次の武器技ダメージ +${Math.round(effect.momentum.rate*100)}%`);
    if (effect.gunAccuracy) values.push(`次の銃技命中 +${Math.round(effect.gunAccuracy*100)}ポイント`);
    if (effect.gunCrit) values.push(`次の銃技会心 +${Math.round(effect.gunCrit*100)}ポイント`);
    if (effect.enchantGuard) values.push(`${data.elements.get(effect.enchantGuard.element)?.name??effect.enchantGuard.element}攻撃軽減 ${Math.round(effect.enchantGuard.rate*100)}%`);
    if (effect.switchMp) values.push(`次の付与対応技MP -${Math.round(effect.switchMp.rate*100)}%`);
    if (effect.enchantWeaponDamage) values.push(`付与対応技ダメージ +${Math.round(effect.enchantWeaponDamage*100)}%`);
    if (effect.fieldGuard) values.push(`${data.elements.get(effect.fieldGuard.element)?.name??effect.fieldGuard.element}の被害 -${Math.round(effect.fieldGuard.rate*100)}%`);
    if (effect.conditionalMagic) values.push(`次の${effect.conditionalMagic.elements.map(id=>data.elements.get(id)?.name??id).join('・')}魔法 +${Math.round(effect.conditionalMagic.rate*100)}%`);
    const coverRule = passives.find(rule => rule.skill.id === id)?.on_cover;
    if (coverRule && ally.coverStages > 0) values.push(`守勢 ${Math.min(coverRule.max, ally.coverStages)}/${coverRule.max}段階`);
    groups[jobEffectSection(skill, effect)].push(entry(`${name}${duration(effect.remaining)}${values.length ? '：' + values.join('・') : ''}`));
  }

  const anger = passives.find(rule => rule.anger)?.anger;
  if (member.hp > 0 && (anger || ally.anger > 0)) ongoing.push(entry(`怒気 ${Math.min(anger?.max ?? 3, Math.max(0, ally.anger ?? 0))}/${anger?.max ?? 3}`));
  const combo = passives.find(rule => rule.combo)?.combo;
  if (member.hp > 0 && combo) ongoing.push(entry(`連携 ${Math.min(combo.max, Math.max(0, ally.comboStage ?? 0))}/${combo.max}段階`));
  if (member.hp > 0 && ally.stance) {
    const values = {...ally.stance.values};
    if (ally.stance.mode === 'guard') values.res = (values.res ?? 0) + passives.reduce((sum,p)=>sum+(p.guard_stance_res??0),0);
    ongoing.push(entry(`${data.skills.get(ally.stance.skillId)?.name ?? '構え'}：${Object.entries(values).filter(([,value])=>value!==0).map(([key,value])=>buffText(data,key,value)).join('・')}`));
  }
  const duel = activeDuel(game, battle, index);
  if (duel) ongoing.push(entry(`決闘の指名${duration(duel.remaining)}：相手 ${battle.enemies[duel.target].name}・武器ダメージ +${Math.round(duel.damage*100)}%・被ダメージ +${Math.round(duel.received*100)}%${passives.some(p=>p.duel_focus_bonus)?'・集中'+(duel.focus?'継続':'解除'):''}`));
  if (member.hp > 0 && ally.distance?.remaining > 0 && battle.enemies[ally.distance.target]?.hp > 0) {
    ongoing.push(entry(`間合いの支配${duration(ally.distance.remaining)}：${battle.enemies[ally.distance.target].name}からの攻撃に回避率 +${Math.round(ally.distance.evasion*100)}%`));
  }
  const prayer = prayerRule(data, member);
  if (member.hp > 0 && prayer) ongoing.push(entry(`祈念 ${prayerStage(data,game,battle,index)}/${prayer.max}`));
  const clones=(ally.clones??[]).filter(clone=>clone.remaining>0);
  if (member.hp>0 && ally.mark?.remaining>0 && battle.enemies[ally.mark.target]?.hp>0) {
    const pursuit=passives.find(rule=>rule.pursuit)?.pursuit;
    ongoing.push(entry(`追跡札${duration(ally.mark.remaining)}：標的 ${battle.enemies[ally.mark.target].name}${pursuit?`・追跡 ${Math.min(pursuit.max,ally.pursuit??0)}/${pursuit.max}段階`:''}`));
  }
  const jump=ally.jump??ally.landingReady;
  if (member.hp>0 && jump) special.push(entry(`${ally.jump?'跳躍中：次の行動開始まで空中':'着地攻撃の予約'}・対象 ${battle.enemies[jump.target]?.name??'生存敵へ変更'}${jump.boost>0?'・踏み切り強化を予約済み':''}`));
  if (member.hp>0 && clones.length) ongoing.push(entry(`分身 ${clones.length}/3体：${clones.map(clone=>'残り'+clone.remaining+'行動').join('・')}`));
  if (member.hp>0 && ally.breathReady) special.push(entry('整息：次の通常の気功を強化・別の行動やスキップで解除'));
  if (member.hp>0 && ally.substitute) special.push(entry('影替わり：単体攻撃1行動を身代わりで防ぐ・次の行動開始まで'));
  const traps = new Map();
  for (const trap of battle.masterTraps ?? []) {
    if (trap.actor !== index || member.hp <= 0 || !(battle.enemies?.[trap.target]?.hp > 0)) continue;
    const id = trap.skill.id;
    if (!traps.has(id)) traps.set(id, []);
    traps.get(id).push(battle.enemies[trap.target].name);
  }
  for (const [id, targets] of traps) {
    const skill = data.skills.get(id);
    const limit = skill && effectiveSkill(data, member, skill).effect.rules?.trap?.limit_total;
    ongoing.push(entry(`${skill?.name ?? '罠'}：設置${targets.length}${limit ? '/' + limit : ''}個・対象 ${targets.join('・')}`));
  }

  if (ally.imbue) special.push(entry(`武器属性：${data.elements.get(ally.imbue)?.name ?? ally.imbue}`));
  if (member.hp>0 && (member.job==='gunner' || (ally.loaded??0)>0)) ongoing.push(entry(`装填 ${ally.loaded??0}/3`));
  if (member.hp>0 && ally.weaponEnchant?.remaining>0) ongoing.push(entry(`武器付与：${data.elements.get(ally.weaponEnchant.element)?.name??ally.weaponEnchant.element}${duration(ally.weaponEnchant.remaining)}`));
  if(member.hp>0 && ally.familiar?.uses>0)ongoing.push(entry(`使い魔：${ally.familiar.mode==='pursuit'?'追撃型':'悪戯型'}・残り${ally.familiar.uses}回${duration(ally.familiar.remaining)}`));
  if(member.hp>0 && (member.job==='necromancer'||(ally.soul??0)>0))ongoing.push(entry(`魂 ${ally.soul??0}/3`));
  if(member.hp>0 && ally.ghost?.remaining>0)ongoing.push(entry(`亡霊：指示残り${ally.ghost.charges}回${duration(ally.ghost.remaining)}`));
  if(member.hp>0 && (member.job==='onmyoji'||(ally.seals??0)>0))ongoing.push(entry(`調和符 ${ally.seals??0}/2${ally.lastPolarity?'・直前'+(ally.lastPolarity==='light'?'光':'闇'):''}`));
  if(member.hp>0 && ally.mysticNext)ongoing.push(entry(`符の転回：次の光・闇魔法 +${Math.round(ally.mysticNext.bonus*100)}%${duration(ally.mysticNext.remaining)}`));
  if(member.hp>0 && ally.mysticDark)ongoing.push(entry(`魂の余韻：次の闇魔法 +${Math.round(ally.mysticDark.bonus*100)}%${duration(ally.mysticDark.remaining)}`));
  if(member.hp>0 && ally.mysticGuard)ongoing.push(entry(`両儀の守り：光・闇の被害 -${Math.round(ally.mysticGuard.cut*100)}%${duration(ally.mysticGuard.remaining)}`));
  if(member.hp>0 && ally.companion?.hp>0)ongoing.push(entry(`相棒：耐久${ally.companion.hp}/${ally.companion.maxHp}${duration(ally.companion.remaining)}`));
  if(member.hp>0 && ally.puppet?.hp>0)ongoing.push(entry(`人形：${ally.puppet.stance==='guard'?'防御型':'攻撃型'}・耐久${ally.puppet.hp}/${ally.puppet.maxHp}${duration(ally.puppet.remaining)}`));
  if(member.hp>0 && ally.decoy?.hp>0)ongoing.push(entry(`囮：${game.party[ally.decoy.target]?.name??'味方'}を保護・耐久${ally.decoy.hp}/${ally.decoy.maxHp}・残り${ally.decoy.uses}回`));
  if(member.hp>0 && ally.strategistOrder)ongoing.push(entry(`号令：${ally.strategistOrder.type==='guard'?'次の被害を軽減':ally.strategistOrder.type==='flank'?'指定敵への通常攻撃を強化':'次の直接攻撃を強化'}${duration(ally.strategistOrder.remaining)}`));
  if(member.hp>0 && ally.strategistUltimate)ongoing.push(entry(`天下布陣：攻撃${ally.strategistUltimate.damage!=null?'待機中':'使用済み'}・防護${ally.strategistUltimate.guard!=null?'待機中':'使用済み'}${duration(ally.strategistUltimate.remaining)}`));
  if(member.hp>0 && ally.comebackTickets>0)ongoing.push(entry(`再起札 ${ally.comebackTickets}/2`));
  if(member.hp>0 && ally.insurance)ongoing.push(entry(`保険札：失敗倍率 +${ally.insurance.rate.toFixed(2)}${duration(ally.insurance.remaining)}`));
  if(member.hp>0 && ally.winCrit)ongoing.push(entry(`勝ちの勢い：次の堅実な攻撃 会心 +${Math.round(ally.winCrit.rate*100)}ポイント${duration(ally.winCrit.remaining)}`));
  if(member.hp>0 && (member.job==='merchant'||ally.supply>0))ongoing.push(entry(`補給札 ${ally.supply??0}/3`));
  if(member.hp>0 && ally.dish)ongoing.push(entry(`料理：${{meat:'肉',vegetable:'野菜',soup:'スープ'}[ally.dish.taste]}・${ally.dish.preparing?'仕込み中':'完成'}・残り${ally.dish.portions}取り分${duration(ally.dish.remaining)}`));
  if(member.hp>0 && ally.relic)ongoing.push(entry(`遺物：${ally.relic.mode==='attack'?'攻撃型':'防護型'}・エネルギー${ally.relic.energy}/2${duration(ally.relic.remaining)}`));
  if(member.hp>0 && ally.contract)ongoing.push(entry(`契約：${{fire:'炎',earth:'土',water:'水'}[ally.contract.element]}・残り${ally.contract.charges}回${duration(ally.contract.remaining)}`));
  if(member.hp>0 && ally.seeds?.length)ongoing.push(entry(`種：${ally.seeds.map(s=>`成長${s.growth}/3・残り${s.remaining}行動`).join('／')}`));
  if(member.hp>0 && ally.beast)ongoing.push(entry(`獣化${duration(ally.beast.remaining)}`));
  if(member.hp>0 && ally.forecasts?.length)ongoing.push(entry(`予兆：${ally.forecasts.map(f=>`${f.name} 残り${f.remaining}行動`).join('／')}`));
  if(member.hp>0 && member.job==='sage')ongoing.push(entry(`術式記憶：${ally.sageMemory?`${data.elements.get(ally.sageMemory.element)?.name??ally.sageMemory.element}・Lv${ally.sageMemory.level}`:'なし'}`));
  if(member.hp>0 && member.job==='saint')ongoing.push(entry(`奇跡 ${ally.saintMiracles??0}/3`));
  if(member.hp>0 && member.job==='overlord')ongoing.push(entry(`覇気 ${ally.overlordHaki??0}/3`));
  if(member.hp>0 && ally.sageWard)ongoing.push(entry(`術式の防護：${data.elements.get(ally.sageWard.element)?.name??ally.sageWard.element}${duration(ally.sageWard.remaining)}`));
  if(member.hp>0 && ally.saintWard)ongoing.push(entry(`命の護符${duration(ally.saintWard.remaining)}`));
  if(member.hp>0 && ally.overlordMarch)ongoing.push(entry(`進軍の支援：残り${ally.overlordMarch.uses}回${duration(ally.overlordMarch.remaining)}`));
  if(member.hp>0 && ally.civicTransfer)ongoing.push(entry(`弱点の転写：${battle.enemies[ally.civicTransfer.enemy]?.name??'対象'}へ+${Math.round(ally.civicTransfer.rate*100)}%${duration(ally.civicTransfer.remaining)}`));
  if(member.hp>0){const inspected=(battle.enemies??[]).flatMap(enemy=>enemy.civicMarks?.[index]&&enemy.hp>0?[`${enemy.name}：${data.elements.get(enemy.civicMarks[index].element)?.name??enemy.civicMarks[index].element}`]:[]);if(inspected.length)ongoing.push(entry(`鑑定印 ${inspected.join('・')}`));}
  if(member.hp>0 && (member.job==='dancer'||(ally.rhythm??0)>0))ongoing.push(entry(`律動 ${ally.rhythm??0}/2`));
  if (ally.normalSkillReady) special.push(entry('次の攻撃技能を強化'));
  const barrier = ally.buffs?.barrier;
  if (barrier?.[0] > 0 && barrier[1] > 0) special.push(entry(buffText(data, 'barrier', barrier[0]) + duration(barrier[1])));
  if (ally.masterCounter?.remaining > 0 && (ally.masterCounter.target == null || battle.enemies[ally.masterCounter.target]?.hp > 0)) {
    const counter = ally.masterCounter;
    special.push(entry((data.skills.get(counter.skillId)?.name ?? '反撃の構え') + duration(counter.remaining)
      + (counter.target != null ? `：対象 ${battle.enemies[counter.target].name}` : '')));
  }
  if (member.hp > 0 && ally.readGuard) special.push(entry(`見切りの間：${data.elements.get(ally.readGuard.element)?.name ?? ally.readGuard.element}の物理攻撃1回を${Math.round(ally.readGuard.rate*100)}%軽減・次の行動開始まで`));
  for (const cover of [ally.masterCover, ally.masterUltimateCover]) if (cover?.remaining > 0) {
    const target = cover.target === 'selected' ? game.party[cover.targetIndex]?.name ?? '味方' : '味方全員';
    special.push(entry(`${target}をかばう${duration(cover.remaining)}`));
  }
  battle.allies.forEach((other, source) => {
    if (source === index) return;
    for (const cover of [other.masterCover, other.masterUltimateCover]) if (cover?.remaining > 0
      && game.party[source].hp > 0 && (cover.target === 'all' || cover.targetIndex === index)) {
      special.push(entry(`${game.party[source].name}がかばう${duration(cover.remaining)}`));
    }
  });
  return [
    ['状態異常', statuses], ['自身の強化・弱化', timedBuffs(Object.fromEntries(Object.entries(ally.buffs ?? {}).filter(([key]) => key !== 'barrier')))],
    [JOB_EFFECT_SECTIONS.party, party], [JOB_EFFECT_SECTIONS.ongoing, ongoing], [JOB_EFFECT_SECTIONS.special, special],
  ];
}

// 文字列を使う既存の呼び出しにも同じ詳細を提供する。
export function allyEffectSections(data, game, battle, index) {
  return allyEffectEntries(data, game, battle, index)
    .map(([title, entries]) => [title, entries.map(entry => entry.label)]);
}

export function createBattleView({ view, data, lex, scheduler, store, session, onDefeat, onEnd: finishBattle, settings = {} }) {
  const run = session.run;
  const b = run.battle;
  const g = session.game;
  const picker = new QuestionPicker({
    lex, store, scheduler, stoneId: run.quiz?.stoneId ?? run.stoneId ?? lex.stones[0].id,
    nowMs: now(), state: run.quiz ?? null,
  });
  const enemies = el('div', { class: 'battle-enemies', 'data-count': b.enemies.length, 'aria-label': '敵', role: 'group' });
  const party = el('div', { id: 'battle-party', class: 'battle-party', 'data-count': g.party.length, 'aria-label': `味方${g.party.length}人`, role: 'group' });
  const partyToggleLabel = `仲間${g.party.length}人の状態を見る`;
  const partyToggle = el('button', { class: 'battle-party-toggle', 'aria-controls': party.id, 'aria-expanded': 'false',
    onclick: () => {
      const open = partyToggle.getAttribute('aria-expanded') !== 'true';
      partyToggle.setAttribute('aria-expanded', String(open));
      partyToggle.textContent = open ? '仲間の状態を閉じる' : partyToggleLabel;
    } }, partyToggleLabel);
  const latest = el('span', { class: 'battle-log-latest' });
  const history = el('ul', { class: 'battle-history' });
  const logDialog = el('dialog', { class: 'battle-encyclopedia battle-log-dialog', 'aria-labelledby': 'battle-log-title' },
    el('div', { class: 'battle-encyclopedia-body' },
      el('h3', { id: 'battle-log-title' }, '戦闘ログ'),
      history,
      el('button', { onclick: () => logDialog.close(), autofocus: true }, '閉じる')));
  logDialog.addEventListener('click', (event) => { if (event.target === logDialog) logDialog.close(); });
  const log = el('button', { class: 'battle-log', 'aria-label': '戦闘ログの履歴を開く',
    'aria-haspopup': 'dialog', onclick: () => logDialog.showModal() }, latest);
  const panel = el('section', { class: 'battle-controls', 'aria-labelledby': 'battle-controls-title' });
  const encyclopedia = el('dialog', { class: 'battle-encyclopedia', 'aria-labelledby': 'battle-monster-name' });
  encyclopedia.addEventListener('click', (event) => { if (event.target === encyclopedia) encyclopedia.close(); });
  const allyDialog = el('dialog', { class: 'battle-encyclopedia battle-ally-dialog', 'aria-labelledby': 'battle-ally-state-title' });
  allyDialog.addEventListener('click', event => { if (event.target === allyDialog) allyDialog.close(); });
  const screen = el('div', { class: `battle-screen scene-${expeditionScene(run.dungeonId, run.challenge)}` },
    el('section', { class: 'battle-stage', 'aria-label': '戦場' },
      el('div', { class: 'battle-location' },
        el('h2', {}, run.label ?? data.dungeons.get(run.dungeonId).name),
        el('span', { class: 'battle-floor' }, run.challenge ? `${(run.battlesDone ?? 0) + 1}戦目` : `${run.floor}階`)),
      enemies),
    log,
    panel,
    partyToggle, party,
    encyclopedia, logDialog, allyDialog);
  screen.addEventListener('click', unlockBattleSound, { capture: true });

  function onEnd(result) {
    finishBattleMusic(result);
    finishBattle(result);
  }

  let defeatSaved = false;
  function saveProgress() {
    if (b.result === 'lose' && onDefeat) {
      if (!defeatSaved) {
        onDefeat();
        defeatSaved = true;
      }
    } else session.save();
  }

  async function loop(previousHits = []) {
    stopSpeech();
    const nextHits = !b.pending && !b.turn && !b.result
      ? collectBattleHits(b, () => nextTurn(data, g, b))
      : [];
    const hits = Array.isArray(previousHits) ? [...previousHits, ...nextHits] : nextHits;
    saveProgress();
    if (b.result) {
      if (hits.length) {
        drawField(null);
        panel.inert = true;
        const popups = playHits(hits);
        await Promise.allSettled(popups.flatMap((popup) =>
          popup.getAnimations().map((animation) => animation.finished)));
      }
      if (screen.isConnected) return onEnd(b.result);
      return;
    }
    if (b.pending) return showQuestion();
    showCommand();
    playHits(hits);
  }

  function playHits(hits) {
    const cardFor = ({ side, i }) => (side === 'ally' ? party : enemies).children[i];
    const impacts = new Map();
    for (const { target, source, damage, effectiveness } of hits) {
      const card = cardFor(target);
      // 二刀流や連続した敵の攻撃は、受けたカードごとに合計して表示する。
      const impact = impacts.get(card) ?? { damage: 0, effects: new Set() };
      impact.damage += damage;
      if (source) {
        cardFor(source).classList.add('battle-striking');
        impact.effects.add(effectiveness);
      }
      impacts.set(card, impact);
    }
    const played = new Set();
    return Array.from(impacts, ([card, { damage, effects }]) => {
      const fromAttack = effects.size > 0;
      const effect = effects.has('weak') ? 'weak' : effects.has('resist') ? 'resist' : 'normal';
      const label = effect === 'weak' ? '弱点' : effect === 'resist' ? '耐性' : null;
      card.classList.add('battle-hit');
      if (fromAttack) card.classList.add('battle-attack-hit');
      if (fromAttack) card.dataset.impact = effect;
      const popup = el('span', {
        class: 'battle-hit-number',
        'aria-hidden': 'true',
        onanimationstart: fromAttack ? () => {
          for (const category of effects) {
            if (played.has(category)) continue;
            playBattleHitSound(category, played.size * 0.06);
            played.add(category);
          }
        } : null,
        onanimationend: () => {
          popup.remove();
          card.classList.remove('battle-hit', 'battle-attack-hit');
          delete card.dataset.impact;
        },
      }, fromAttack && label ? el('small', {}, label) : null, `−${damage}`);
      card.append(popup);
      return popup;
    });
  }

  function resource(label, value, max, cls) {
    const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    return el('span', { class: `battle-resource ${cls}` },
      el('span', { class: 'battle-resource-name' }, label),
      el('span', { class: 'battle-resource-value' }, `${value}/${max}`),
      el('span', { class: 'battle-meter', 'aria-hidden': 'true' },
        el('span', { style: `width:${percent}%` })));
  }

  function conditions(names) {
    return names.length ? el('span', { class: 'battle-conditions' }, names.join('・')) : null;
  }

  function unitCard(className, chosen, label, select, inspect, ...children) {
    const cls = `${className}${select ? ' targetable' : ''}${chosen ? ' chosen' : ''}`;
    return el('button', { type: 'button', class: cls, 'aria-label': label,
      'aria-haspopup': select ? null : 'dialog', onclick: select ?? inspect }, children);
  }

  function inspectAlly(index) {
    const member = g.party[index];
    render(allyDialog, el('div', { class: 'battle-encyclopedia-body' },
      el('h3', { id: 'battle-ally-state-title', tabindex: '-1' }, `${member.name}の状態`),
      allyEffectEntries(data, g, b, index).map(([title, lines]) => el('section', { class: 'battle-effect-section' },
        el('h4', {}, title),
        lines.length ? el('ul', { class: 'battle-effect-list' }, lines.map(line => el('li', { class: 'battle-effect-row' },
          effectIcon(line.icon), el('span', { class: 'battle-effect-copy' }, line.label)))) : el('p', { class: 'muted small' }, 'なし'))),
      el('button', { onclick: () => allyDialog.close() }, '閉じる')));
    allyDialog.showModal();
    allyDialog.querySelector('h3').focus({ preventScroll: true });
    allyDialog.scrollTop = 0;
  }

  function inspectEnemy(enemy) {
    const { weak, resist, normal, scanned } = monsterKnowledge(data, g, enemy);
    render(encyclopedia, el('div', { class: 'battle-encyclopedia-body' },
      el('span', { class: 'battle-enemy-icon', 'aria-hidden': 'true' }, enemy.icon),
      el('h3', { id: 'battle-monster-name' }, enemy.name),
      resource('HP', enemy.hp, enemy.maxHp, 'hp'),
      enemy.maxMp == null ? null : resource('MP', enemy.mp, enemy.maxMp, 'mp'),
      el('p', {}, enemy.types.map((id) => data.monsterTypes.get(id)?.name ?? id).join('・')),
      el('dl', {},
        el('dt', {}, '判明した弱点'), el('dd', {}, weak.join('・') || (scanned ? 'なし' : '未判明')),
        el('dt', {}, '判明した耐性'), el('dd', {}, resist.join('・') || '未判明'),
        el('dt', {}, '通常の相性'), el('dd', {}, normal.join('・') || '未判明')),
      el('p', { class: 'battle-notice' }, '攻撃が命中すると、使った属性の相性が分かります。'),
      el('button', { onclick: () => encyclopedia.close(), autofocus: true }, '閉じる')));
    encyclopedia.showModal();
  }

  function drawField(actor, { kind, indices = [], select } = {}, action = null) {
    if (encyclopedia.open) encyclopedia.close();
    const selectedKind = action ? targetKind(data, action, g.party[actor]) : null;
    render(enemies, b.enemies.map((enemy, index) => {
      const targetable = kind === 'enemy' && indices.includes(index);
      const chosen = selectedKind === 'enemy' && action.target === index;
      const label = enemy.name + (enemy.boss ? '、ボス' : '') + (enemy.eliteId ? '、エリート' : '') + '、HP ' + enemy.hp + '/' + enemy.maxHp +
        (enemy.maxMp == null ? '' : '、MP ' + enemy.mp + '/' + enemy.maxMp);
      const known = monsterKnowledge(data, g, enemy);
      const intent = enemyIntent(data, enemy, b.round);
      const pendingEnemyTurn = b.queue?.some(turn => turn.side === 'enemy' && turn.i === index)
        || (b.turn?.side === 'enemy' && b.turn.i === index);
      const imminent = intent.sweep && pendingEnemyTurn;
      const intentLabel = enemy.hp > 0 && (intent.warning || imminent) ? intent.label : '';
      return el('button', {
        class: `battle-enemy${enemy.hp <= 0 ? ' down' : ''}${targetable ? ' targetable' : ''}${chosen ? ' chosen' : ''}`,
        'aria-label': `${label}${intentLabel ? `、${intentLabel}` : ''}、${targetable ? '対象に選ぶ' : '図鑑を開く'}`,
        'aria-haspopup': targetable ? null : 'dialog',
        onclick: targetable ? () => select(index) : () => inspectEnemy(enemy),
      },
        el('span', { class: 'battle-enemy-icon', 'aria-hidden': 'true' }, enemy.icon),
        targetable ? null : el('span', { class: 'battle-inspect', 'aria-hidden': 'true' }, '図鑑'),
        el('span', { class: 'battle-unit-name' }, enemy.name),
        enemy.boss || enemy.eliteId ? el('span', { class: 'battle-enemy-marks', 'aria-hidden': 'true', title: enemy.eliteId ? 'エリート：能力が高く、レアドロップ率が上昇' : 'ボス' }, [enemy.boss ? '👑' : '', enemy.eliteId ? '◆' : ''].filter(Boolean).join(' ')) : null,
        resource('HP', enemy.hp, enemy.maxHp, 'hp'),
        enemy.maxMp == null ? null : resource('MP', enemy.mp, enemy.maxMp, 'mp'),
        enemy.tactics ? el('span', { class: 'battle-intent' }, { heal: '回復術', ward: '自己強化', disrupt: '弱体化' }[enemy.tactics]) : null,
        intentLabel ? el('span', { class: `battle-intent${imminent ? ' imminent' : ''}` }, intentLabel) : null,
        conditions(battleConditionLabels(data, enemy)),
        known.weak.length ? el('span', { class: 'battle-known-weak' }, '弱点 ' + known.weak.join('・')) : null);
    }));
    render(party, g.party.map((member, index) => {
      const hp = maxHp(data, member);
      const mp = maxMp(data, member);
      const targetable = (kind === 'ally' || kind === 'ko_ally') && indices.includes(index);
      const chosen = (selectedKind === 'ally' || selectedKind === 'ko_ally') && action.target === index;
      const classes = `battle-ally${index === actor ? ' active' : ''}${member.hp <= 0 ? ' down' : ''}`;
      const status = member.hp <= 0 ? '戦闘不能' : `HP ${member.hp}/${hp}、MP ${member.mp}/${mp}`;
      const conditionNames = battleConditionLabels(data, { ...b.allies[index], hp: member.hp });
      const gauge = ultimateGauge(data, member);
      const label = [member.name, index === actor ? '行動中' : '', status, ...conditionNames, targetable ? '対象に選ぶ' : '状態を見る'].filter(Boolean).join('、');
      return unitCard(classes, chosen, label, targetable ? () => select(index) : null, () => inspectAlly(index),
        el('span', { class: 'battle-ally-heading' },
          el('span', { class: 'battle-ally-icon', 'aria-hidden': 'true' }, portraitIcon(member.icon, { small: true })),
          el('span', { class: 'battle-unit-name', title: member.name }, member.name)),
        el('span', { class: 'battle-ally-info' },
          resource('HP', member.hp, hp, 'hp'),
          resource('MP', member.mp, mp, 'mp'),
          resource('EX', gauge.value, gauge.max, `ultimate${gauge.ready ? ' ready' : ''}`),
          conditions(conditionNames)));
    }));
    render(latest, b.log.slice(-3).map((line) => el('span', { class: 'battle-log-line' }, line)));
    render(history, b.log.map((line) => el('li', {}, line)));
  }

  function showPanel(title, content, { back, backLabel = '← 戻る', detail, question = false, focus = true } = {}) {
    screen.classList.toggle('answering', question);
    partyToggle.setAttribute('aria-expanded', 'false');
    partyToggle.textContent = partyToggleLabel;
    const heading = el('h3', { id: 'battle-controls-title', tabindex: '-1' }, title);
    render(panel,
      el('div', { class: 'battle-controls-head' }, heading, detail,
        back ? el('button', { class: 'battle-back', onclick: back }, backLabel) : null),
      content);
    if (focus) heading.focus({ preventScroll: true });
    if (question && panel.getBoundingClientRect().bottom > window.innerHeight) {
      panel.scrollIntoView({ block: 'nearest' });
    }
  }

  function command(icon, label, onclick, detail = null, disabled = false) {
    return el('button', { class: 'battle-command', onclick, disabled },
      el('span', { class: 'battle-command-icon', 'aria-hidden': 'true' }, icon),
      el('span', { class: 'battle-command-copy' }, label, detail ? el('small', {}, detail) : null));
  }

  const battleMp = skill => skillMp(data, g.party[b.turn.i], skill, { battle: b, actor: b.turn.i });

  function showCommand(sub = null, message = null) {
    const actor = b.turn.i;
    const member = g.party[actor];
    const opts = actionOptions(data, g, b, actor);
    drawField(actor);
    const choose = (action) => chooseTarget(action, sub);
    const back = () => showCommand();
    const notice = message ? el('p', { class: 'battle-notice', role: 'status' }, message) : null;
    if (opts.landing) {
      showPanel(`${member.name}の番`,[notice,el('p',{class:'battle-notice'},'跳躍から着地して攻撃する。追加のMP消費なし。'),
        el('div',{class:'battle-commands'},command('✦','着地攻撃',()=>ask(opts.landing),b.enemies[opts.landing.target].name))]);
      return;
    }

    if (sub === 'skill' || sub === 'item') {
      const isSkill = sub === 'skill';
      const skillEntries = [...new Map([...opts.skills, ...(opts.ultimate?.skill ? [opts.ultimate] : [])].map(entry => [entry.skill.id, entry])).values()];
      const choices = isSkill
        ? skillEntries.map(entry => listChoice(`${entry.skill.isFinal ? '★ ' : ''}${entry.skill.name}${skillMaxLevel(entry.skill) > 1 ? ` Lv${learnedSkillLevel(member, entry.skill)}` : ''}`, `${entry.skill.isFinal ? `EX ${opts.ultimate?.gauge ?? member.ultimateGauge ?? 0}/${opts.ultimate?.max ?? 100}・` : ''}消費MP ${battleMp(entry.skill)}${entry.hpCost ? `・HP ${entry.hpCost}` : ''}`,
          [describeSkillForUI(data, effectiveSkill(data, member, entry.skill)), entry.reason].filter(Boolean).join(' ／ '),
          () => chooseSkill(entry), entry.reason, skillIcon(data, effectiveSkill(data, member, entry.skill), member)))
        : opts.items.map(({ item, count, reason }) => listChoice(item.name, `×${count}`, reason || item.description,
          () => choose({ type: 'item', itemId: item.id }), reason));
      showPanel(isSkill ? 'スキル' : 'アイテム', [
        notice,
        choices.length
          ? el('div', { class: 'battle-action-list' }, choices)
          : el('p', { class: 'battle-notice' }, isSkill ? '使えるスキルがありません。' : 'アイテムを持っていません。'),
      ], { back, detail: isSkill ? el('span', { class: 'battle-panel-detail' }, `MP ${member.mp}`) : null });
      return;
    }

    showPanel(`${member.name}の番`, [notice, el('div', { class: 'battle-commands' },
      command('⚔', '通常攻撃', () => choose({ type: 'attack' })),
      command('✦', 'スキル', () => showCommand('skill')),
      command('✚', 'アイテム', () => showCommand('item')),
      command('↪', '逃げる', () => choose({ type: 'flee' }),
        opts.flee.reason || `成功率 ${Math.round(opts.flee.rate * 100)}%`, !!opts.flee.reason))]);
  }

  function listChoice(name, amount, detail, onclick, reason, icon = null) {
    return el('button', { class: `battle-list-choice${icon ? ' battle-skill-choice' : ''}`, onclick, disabled: !!reason },
      el('strong', {}, name), el('span', { class: 'battle-list-amount' }, amount),
      detail ? el('small', {}, detail) : null,
      icon ? el('span', { class: 'battle-list-icon', 'aria-hidden': 'true' }, icon) : null);
  }

  function chooseSkill(entry) {
    if (!entry?.skill || entry.reason) return;
    const skill = entry.skill;
    const action = { type: 'skill', skillId: skill.id };
    const elements = entry.elements ?? skill.effect.rules?.choose_element ?? skill.effect.rules?.choose_mode ?? [];
    const back = () => showCommand('skill');
    const chooseBoost = selected => {
      if ((skill.effect.rules?.trio_items||skill.effect.rules?.civic_items) && !selected.itemId) return showPanel(`${skill.name}の品物`,[
        el('div',{class:'battle-action-list'},[...entry.itemChoices,...entry.civicItems].map(item=>listChoice(item.name,`×${item.count}`,null,
          ()=>chooseBoost({...selected,itemId:item.id})))),
      ],{back});
      if (entry.optionalClone && selected.consumeClone==null) return showPanel(`${skill.name}の分身`,[
        el('p',{class:'battle-notice'},'分身1体を使うと、今回の一撃が強まります。'),
        el('div',{class:'battle-action-list'},
          listChoice('分身を残す',`MP ${battleMp(skill)}`,null,()=>chooseBoost({...selected,consumeClone:false})),
          listChoice('分身を使う',`MP ${battleMp(skill)}`,null,()=>chooseBoost({...selected,consumeClone:true}))),
      ],{back});
      if (entry.optionalBlessing && selected.consumeBlessing == null) return showPanel(`${skill.name}の加護`,[
        el('p',{class:'battle-notice'},'自分の加護を消費すると、今回の直接ダメージが増えます。'),
        el('div',{class:'battle-action-list'},
          listChoice('加護を残す',`MP ${battleMp(skill)}`,null,()=>chooseBoost({...selected,consumeBlessing:false})),
          listChoice('加護を消費する',`MP ${battleMp(skill)}`,`直接ダメージ +${Math.round(skill.effect.rules.optional_blessing*100)}%`,()=>chooseBoost({...selected,consumeBlessing:true}))),
      ],{back});
      if (entry.optionalCourage && selected.spendCourage == null) return showPanel(`${skill.name}の勇気`,[
        el('div',{class:'battle-action-list'},
          listChoice('勇気を残す',`MP ${battleMp(skill)}`,null,()=>chooseBoost({...selected,spendCourage:false})),
          listChoice('勇気を1消費',`MP ${battleMp(skill)}`,'防護量 +20%',()=>chooseBoost({...selected,spendCourage:true}))),
      ],{back});
      if (entry.optionalHaki && selected.spendHaki == null) return showPanel(`${skill.name}の覇気`,[
        el('div',{class:'battle-action-list'},
          listChoice('覇気を残す',`MP ${battleMp(skill)}`,null,()=>chooseBoost({...selected,spendHaki:false})),
          listChoice('覇気を1消費',`MP ${battleMp(skill)}`,'防護量 +20%',()=>chooseBoost({...selected,spendHaki:true}))),
      ],{back});
      if (!entry.boost) return chooseTarget(selected, 'skill', entry.targetReasons);
      const baseMp = battleMp(skill);
      const extraMp = entry.boost.mp;
      showPanel(`${skill.name}のMP投入`, [
        el('p', { class: 'battle-notice' }, describeSkillEffect(data, skill)),
        el('div', { class: 'battle-action-list' },
          listChoice('通常の威力', `MP ${baseMp}`, null, () => chooseTarget(selected, 'skill', entry.targetReasons)),
          listChoice('追加MPを投入', `MP ${baseMp + extraMp}`, `直接ダメージ +${Math.round(entry.boost.bonus * 100)}%`,
            () => chooseTarget({ ...selected, boost: true }, 'skill', entry.targetReasons), g.party[b.turn.i].mp < baseMp + extraMp ? 'MPが足りない' : '')),
      ], { back });
    };
    const chooseResource = selected => {
      if (!entry.natureChoices?.length) return chooseBoost(selected);
      return showPanel(`${skill.name}の対象`,[el('div',{class:'battle-action-list'},entry.natureChoices.map(resource=>
        listChoice(resource.label,'',null,()=>chooseBoost({...selected,resourceIndex:resource.index}))))],{back});
    };
    if (!elements.length) return chooseResource(action);
    showPanel(`${skill.name}の${skill.effect.rules?.gamble?'勝負':skill.effect.rules?.puppet_quick_stance?'構え':'属性'}`, [
      el('p', { class: 'battle-notice' }, describeSkillEffect(data, skill)),
      el('div', { class: 'battle-action-list' }, elements.map(element => listChoice(
         ({pursuit:'追撃型',mischief:'悪戯型',attack:'攻撃型',guard:'防御型',safe:'堅実',risk:'大勝負',meat:'肉料理',vegetable:'野菜料理',soup:'スープ'}[element] ?? data.elements.get(element)?.name ?? element), `MP ${battleMp(skill)}`, null,
        () => chooseResource({ ...action, element })))),
    ], { back });
  }

  function chooseTarget(action, sub, targetReasons = {}) {
    const member = g.party[b.turn.i];
    const skill = action.type === 'skill' ? effectiveSkill(data, member, data.skills.get(action.skillId)) : null;
    const magicPrimary=skill && !skill.isFinal && skill.kind==='attack' && skill.effect.base==='mag'
      && Object.values(b.allies[b.turn.i].masterEffects??{}).some(effect=>effect.nextMagicEcho)
      && targetKind(data,action,member)==='enemies' && !skill.effect.select_targets;
    const kind = magicPrimary?'enemy':targetKind(data, action, member);
    const rule=skill?.effect.rules??{};
    if(rule.civic_transfer && action.sourceTarget==null){
      const indices=g.party.flatMap((m,index)=>m.hp>0&&!b.allies[index].statuses.petrify?[index]:[]);
      const select=sourceTarget=>chooseTarget({...action,sourceTarget},sub,targetReasons);
      drawField(b.turn.i,{kind:'ally',indices,select});
      showPanel(skill.name,[el('p',{class:'battle-target-prompt'},'次の攻撃を強化する味方を選ぶ')],{back:()=>showCommand(sub)});
      return;
    }
    if(rule.proxy_attack && action.sourceTarget==null){
      const indices=g.party.flatMap((m,index)=>m.hp>0&&!['petrify','sleep','freeze','stun','paralysis','confusion','charm'].some(id=>b.allies[index].statuses[id])?[index]:[]);
      const select=sourceTarget=>chooseTarget({...action,sourceTarget},sub,targetReasons);
      drawField(b.turn.i,{kind:'ally',indices,select});
      showPanel(skill.name,[el('p',{class:'battle-target-prompt'},'連携する味方を選ぶ')],{back:()=>showCommand(sub)});
      return;
    }
    if(rule.orders_party){
      const indices=g.party.flatMap((m,index)=>m.hp>0&&!b.allies[index].statuses.petrify?[index]:[]);
      const count=Math.min(rule.orders_party.count,indices.length),selected=new Set();
      const select=index=>{if(selected.has(index))selected.delete(index);else if(selected.size<count)selected.add(index);drawSelection();};
      const drawSelection=()=>{drawField(b.turn.i,{kind:'ally',indices,select});
        showPanel(skill.name,[el('p',{class:'battle-target-prompt'},`味方を${count}人選ぶ（${selected.size}/${count}）`),
          el('div',{class:'battle-targets'},indices.map(index=>el('button',{'aria-pressed':String(selected.has(index)),onclick:()=>select(index)},`${selected.has(index)?'✓ ':''}${g.party[index].name}`))),
          el('button',{disabled:selected.size!==count,onclick:()=>ask({...action,targets:[...selected]})},'この対象に号令する')],{back:()=>showCommand(sub)});};
      return drawSelection();
    }
    if(rule.decoy_ultimate && action.secondaryTarget==null){
      const indices=g.party.flatMap((m,index)=>m.hp>0&&!b.allies[index].statuses.petrify?[index]:[]);
      const select=secondaryTarget=>chooseTarget({...action,secondaryTarget},sub,targetReasons);
      drawField(b.turn.i,{kind:'ally',indices,select});
      showPanel(skill.name,[el('p',{class:'battle-target-prompt'},'強化囮の保護先を選ぶ')],{back:()=>showCommand(sub)});
      return;
    }
    if (skill?.effect.rules?.move_blessing && action.sourceTarget == null) {
      const indices=g.party.flatMap((m,index)=>m.hp>0&&!b.allies[index].statuses.petrify&&ownedBlessing(b,b.turn.i,index)?[index]:[]);
      if (!indices.length) return showCommand(sub,'移せる自分の加護がありません。');
      const select=sourceTarget=>chooseTarget({...action,sourceTarget},sub,targetReasons);
      if (indices.length===1) return select(indices[0]);
      drawField(b.turn.i,{kind:'ally',indices,select});
      showPanel(skill.name,[el('p',{class:'battle-target-prompt'},'移動する加護が付いた味方を選ぶ')],{back:()=>showCommand(sub)});
      return;
    }
    if (skill?.effect.select_targets) {
      const indices=b.enemies.flatMap((enemy,index)=>enemy.hp>0?[index]:[]);
      const limit=Math.min(skill.effect.target_limit,indices.length);
      if (!limit) return showCommand(sub,'選べる敵がいません。');
      if (limit===indices.length) return ask({...action,targets:indices});
      const selected=new Set();
      const select=index=>{if(selected.has(index))selected.delete(index);else if(selected.size<limit)selected.add(index);drawSelection();};
      const drawSelection=()=>{
        drawField(b.turn.i,{kind:'enemy',indices,select});
        showPanel(skill.name,[el('p',{class:'battle-target-prompt'},`敵を最大${limit}体選ぶ（${selected.size}/${limit}）`),
          el('div',{class:'battle-targets'},indices.map(index=>el('button',{'aria-pressed':String(selected.has(index)),
            disabled:!selected.has(index)&&selected.size>=limit,onclick:()=>select(index)},`${selected.has(index)?'✓ ':''}${b.enemies[index].name}`))),
          el('button',{disabled:!selected.size,onclick:()=>ask({...action,targets:[...selected]})},'この対象で攻撃する'),
        ],{back:()=>showCommand(sub)});
      };
      return drawSelection();
    }
    if(kind==='ko_allies'){
      const indices=g.party.flatMap((target,index)=>target.hp<=0&&!b.allies[index].statuses?.petrify?[index]:[]);
      const selected=new Set();const select=index=>{if(selected.has(index))selected.delete(index);else if(selected.size<2)selected.add(index);drawSelection();};
      const drawSelection=()=>{drawField(b.turn.i,{kind:'ko_ally',indices,select});
        showPanel(skill.name,[el('p',{class:'battle-target-prompt'},`蘇生する味方を最大2人選ぶ（${selected.size}/2）`),
          el('div',{class:'battle-targets'},indices.map(index=>el('button',{'aria-pressed':String(selected.has(index)),onclick:()=>select(index)},`${selected.has(index)?'✓ ':''}${g.party[index].name}`))),
          el('button',{disabled:!selected.size,onclick:()=>ask({...action,targets:[...selected]})},'この味方を蘇生する')],{back:()=>showCommand(sub)});};
      return drawSelection();
    }
    if (!TARGET_PROMPT[kind]) return ask({ ...action, target: null });

    let indices;
    if (kind === 'enemy') {
      indices = b.enemies.flatMap((enemy, index) => enemyCanAct(enemy) && !targetReasons[index] ? [index] : []);
    } else if (kind === 'ko_ally') {
      indices = g.party.flatMap((target, index) => target.hp <= 0 && !b.allies[index].statuses?.petrify ? [index] : []);
    } else {
      indices = g.party.flatMap((target, index) => target.hp > 0
        && !(skill?.effect.master && b.allies[index].statuses?.petrify)
        && (!(skill?.effect.rules?.order_front||skill?.effect.rules?.order_speed)||b.queue.some(u=>u.side==='ally'&&u.i===index))
        && !(skill?.effect.rules?.decoy_move && b.allies[b.turn.i].decoy?.target===index)
        && !(skill?.effect.rules?.move_blessing && index===action.sourceTarget)
        && !(skill?.effect.rules?.cover?.target === 'selected' && index === b.turn.i) ? [index] : []);
    }

    const select = target => {
      if(rule.proxy_attack)return ask({...action,target,secondaryTarget:target});
      if(rule.order?.enemy){
        const enemies=b.enemies.flatMap((enemy,index)=>enemy.hp>0?[index]:[]);
        const pickEnemy=secondaryTarget=>ask({...action,target,secondaryTarget});
        drawField(b.turn.i,{kind:'enemy',indices:enemies,select:pickEnemy});
        showPanel(skill.name,[el('p',{class:'battle-target-prompt'},'対象の敵を選ぶ')],{back:()=>chooseTarget(action,sub,targetReasons)});
        return;
      }
      if (!skill?.effect.rules?.kill_followup) return ask({...action,target});
      const others=b.enemies.flatMap((enemy,index)=>enemy.hp>0&&index!==target?[index]:[]);
      const pickSecondary=secondaryTarget=>ask({...action,target,secondaryTarget});
      if (others.length<=1) return pickSecondary(others[0]??null);
      drawField(b.turn.i,{kind:'enemy',indices:others,select:pickSecondary});
      showPanel(skill.name,[
        el('p',{class:'battle-target-prompt'},'とどめを刺した後の追撃先を選ぶ'),
        el('div',{class:'battle-targets'},others.map(index=>el('button',{onclick:()=>pickSecondary(index)},b.enemies[index].name))),
      ],{back:()=>chooseTarget(action,sub,targetReasons)});
    };
    if (!indices.length && kind === 'ko_ally' && action.type === 'skill'
      && data.skills.get(action.skillId)?.effect.rules?.revive && data.skills.get(action.skillId)?.kind === 'heal_all') return ask({ ...action, target: null });
    if (indices.length === 0) return showCommand(sub, '選べる対象がいません。');
    if (indices.length === 1) return select(indices[0]);

    drawField(b.turn.i, { kind, indices, select });
    const enemyTargets = kind === 'enemy' ? el('div', { class: 'battle-targets' }, b.enemies.flatMap((enemy, index) => enemyCanAct(enemy) ? [index] : []).map((index) => {
      const enemy = b.enemies[index];
      const reason = targetReasons[index];
      return el('button', { disabled: !!reason, onclick: () => select(index) }, `${enemy.icon} ${enemy.name}${reason ? `・${reason}` : ''}`);
    })) : null;
    showPanel(actionLabel(action), [
      el('p', { class: 'battle-target-prompt' }, skill?.effect.rules?.move_blessing ? '加護の移動先を選ぶ' : magicPrimary ? '魔法追撃の主対象を選ぶ' : TARGET_PROMPT[kind]),
      enemyTargets,
    ], { back: () => showCommand(sub), focus: !!enemyTargets });
    if (!enemyTargets) screen.querySelector('button.targetable').focus({ preventScroll: true });
  }

  function ask(action) {
    let ready;
    const hits = collectBattleHits(b, () => { ready = prepareQuizAction(data, g, b); });
    if (!ready) return loop(hits);
    let question = b.reservedQuestion;
    if (!question) {
      const review = run.questionPool?.length ? run.questionPool : null;
      const next = review?.length
        ? { word: lex.wordsById.get(review[(run.challengeQuestions ?? 0) % review.length]), reason: 'practice' }
        : picker.next();
      if (review?.length) run.challengeQuestions = (run.challengeQuestions ?? 0) + 1;
      const dir = questionDirection(run.direction ?? settings.direction ?? DIRECTION.EN_JA);
      const q = makePracticeQuestion(next.word, lex, { direction: dir, format: run.challenge ? 'meaning' : settings.format ?? 'meaning', familiar: scheduler.isFamiliar(store.get(next.word.id)) });
      question = {
        wordId: next.word.id, reason: next.reason, format: q.format, deadline: run.timeLimit ? Date.now() + 1000 * run.timeLimit : null, direction: q.direction, prompt: q.prompt, choices: q.choices, answerIndex: q.answerIndex,
      };
    }
    setPending(b, action, question);
    delete b.reservedQuestion;
    run.quiz = picker.toState();
    session.save();
    showQuestion();
    playHits(hits);
  }

  function actionLabel(action) {
    if (action.type === 'attack') return '通常攻撃';
    if (action.type === 'landing') return '跳躍槍・着地攻撃';
    if (action.type === 'flee') return '逃げる';
    if (action.type === 'skill') return [data.skills.get(action.skillId).name,
      action.element ? `（${data.elements.get(action.element)?.name ?? action.element}）` : '', action.boost ? '・MP投入' : ''].join('');
    return data.items.get(action.itemId).name;
  }

  function showQuestion() {
    const { actor, action, question: q } = b.pending;
    const word = lex.wordsById.get(q.wordId);
    const isEn = q.direction === DIRECTION.EN_JA;
    const voice = questionSpeech(q);
    const instruction = q.format === 'cloze' ? '空欄に入る英語を選ぶ' : q.format === 'situation' ? '場面に合う英語を選ぶ'
      : isEn ? '日本語の意味を選ぶ' : '英語を選ぶ';
    const title = `${g.party[actor].name}の${actionLabel(action)}`;
    drawField(actor, {}, action);

    let timeout;
    let active = true;
    function cancel() {
      if (!active || b.pending?.question !== q || !panel.isConnected) return;
      if (q.deadline && Date.now() >= q.deadline) return answer(-1);
      if (!cancelBattleQuestion(b)) return;
      active = false;
      clearTimeout(timeout);
      stopSpeech();
      session.save();
      showCommand();
    }
    function answer(index) {
      if (!active || b.pending?.question !== q || !panel.isConnected) return;
      active = false;
      clearTimeout(timeout);
      const timedOut = index < 0 || (q.deadline && Date.now() >= q.deadline);
      if (timedOut) run.timedOut = true;
      const correct = !timedOut && index === q.answerIndex;
      const time = now();
      const rec = scheduler.review(store.get(word.id), correct, time);
      store.recordAnswer(word.id, rec, scheduler.dayOf(time), correct);
      picker.report(word.id, correct);
      run.quiz = picker.toState();
      const rewards = (b.learningRewards ??= { answers: 0, total: 0 });
      const weights = data.balance.rewards?.learning_weights ?? { due: 1.2, new: 1.2, retry: 1, practice: 0.8 };
      rewards.answers += 1;
      rewards.total += correct ? weights[q.reason] ?? 1 : 1;
      const hits = collectBattleHits(b, () => resolvePending(data, g, b, correct));
      saveProgress();

      drawField(actor, {}, action);
      showPanel(title, [
        el('div', { class: `battle-result ${correct ? 'good' : 'bad'}`, role: 'status' },
          el('strong', {}, correct ? '正解！' : `正解は「${q.choices[q.answerIndex].text}」`),
          el('span', {}, `${word.en} ＝ ${word.ja}`),
          timedOut ? el('span', {}, '時間切れ') : correct ? null : el('span', { class: 'battle-result-choice' }, `選んだ答え　${q.choices[index].text}`)),
        el('div', { class: 'battle-result-actions' },
          pronounce(voice.answer), el('button', { class: 'battle-next', onclick: loop }, '次へ')),
      ], { focus: false });
      panel.querySelector('.battle-next').focus();
      playHits(hits);
      if (!isEn) speak(voice.answer);
    }

    showPanel(title, [
      el('div', { class: 'battle-question' },
        el('div', { class: 'battle-prompt-wrap' }, el('small', {}, instruction),
          el('div', { class: 'battle-prompt', style: 'white-space: pre-line', lang: isEn ? 'en' : 'ja' }, q.prompt)),
        pronounce(voice.prompt)),
      el('div', { class: 'battle-answers' }, q.choices.map((choice, index) =>
        el('button', { onclick: () => answer(index), lang: isEn ? 'ja' : 'en' }, el('span', { class: 'choice-letter', 'aria-hidden': 'true' }, String.fromCharCode(65 + index)), el('span', {}, choice.text)))),
    ], { back: cancel, backLabel: '← 取り消し', detail: el('span', { class: `tag ${q.reason}` }, run.timeLimit ? `${run.timeLimit}秒` : REASON_LABEL[q.reason]), question: true });
    if (q.deadline) timeout = setTimeout(() => answer(-1), Math.max(0, q.deadline - Date.now()));
    if (!q.deadline || Date.now() < q.deadline) speak(voice.prompt);
  }

  function pronounce(text) {
    return text && canSpeak()
      ? el('button', { class: 'battle-speak', 'aria-label': '英語の発音を聞く', onclick: () => speak(text) }, '🔊')
      : null;
  }

  return {
    start() {
      if (window.navigator?.userActivation?.isActive) unlockBattleSound();
      render(view, screen);
      if (!b.result) startBattleMusic();
      window.scrollTo(0, 0);
      loop();
    },
  };
}



