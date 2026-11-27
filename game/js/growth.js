import { availableAp, spendAp, normalizeAp, hasVisitedJob } from './ap.js?v=skill-growth-2';
// 成長：共通AP・技能の修得と強化・装備枠・武器熟練度・ジョブチェンジ。
// data に数として書かれていないものは GROWTH_FORMULAS に置く（docs/requests.md で依頼済み）。
import { gearDef, aptitudeMul, unequip, maxHp, maxMp, affixSum } from './character.js?v=unique-reroll-1';

export const GROWTH_FORMULAS = Object.freeze({
  action_capacity: 10, // 通常スキルの枠（スキルの cost の合計。sim の cap_a）
  passive_capacity: 10, // パッシブの枠（sim の cap_p）
  mastery_kills_per_level: 30, // 武器の熟練度：その種類の武器で30体倒すごとに1つ上がる（sim と同じ）
});

// ---------------- 文で書かれた効果を読む（common_tree.csv の effect、job_mastery.csv の bonus_all_jobs） ----------------
const BONUS_PATTERNS = [
  [/最大HP\+(\d+(?:\.\d+)?)%|^HP\+(\d+(?:\.\d+)?)%/, (v) => ({ hp: v })],
  [/^MP\+(\d+(?:\.\d+)?)%/, (v) => ({ mp: v })],
  [/STRとMAG\+(\d+(?:\.\d+)?)%/, (v) => ({ str: v, mag: v })],
  [/^(STR|MAG|DEF|RES|SPD|LUK)\+(\d+(?:\.\d+)?)%/, (v, m) => ({ [m[1].toLowerCase()]: Number(m[2]) / 100 })],
  [/MP(?:最大の)?(\d+(?:\.\d+)?)%回復|MP回復(\d+(?:\.\d+)?)%/, (v) => ({ mp_regen: v })],
  [/鍛錬の経験値・AP\+(\d+(?:\.\d+)?)%/, (v) => ({ training: v })],
  [/状態異常にかける確率\+(\d+(?:\.\d+)?)%/, (v) => ({ stat_rate: v })],
  [/状態異常-(\d+(?:\.\d+)?)%/, (v) => ({ sres: v })],
  [/素材\+(\d+(?:\.\d+)?)%/, (v) => ({ drop: v })],
  [/通常枠\+(\d+)/, (v, m) => ({ cap_action: Number(m[1]) })],
  [/パッシブ枠\+(\d+)/, (v, m) => ({ cap_passive: Number(m[1]) })],
  [/回復量\+(\d+(?:\.\d+)?)%/, (v) => ({ healp: v })],
  [/会心率\+(\d+(?:\.\d+)?)%/, (v) => ({ crt: v })],
  [/会心ダメージ\+(\d+(?:\.\d+)?)%/, (v) => ({ crit_dmg: v })],
  [/弱点へのダメージ\+(\d+(?:\.\d+)?)%/, (v) => ({ weak_all: v })],
  [/道具の効果\+(\d+(?:\.\d+)?)%/, (v) => ({ itemp: v })],
];
/** 「最大HP+5%」→ { hp: 0.05 }。読めない文は {} */
export function parseBonusText(text) {
  for (const [re, fn] of BONUS_PATTERNS) {
    const m = re.exec(String(text ?? '').trim());
    if (m) {
      const num = Number(m.slice(1).find((x) => x != null && /^\d/.test(x)));
      return fn(num / 100, m);
    }
  }
  return {};
}

// ---------------- スキルツリー ----------------
export function jobSkills(data, jobId) {
  return [...data.skills.values()].filter((s) => s.job === jobId).sort((a, b) => a.path.localeCompare(b.path) || a.stage - b.stage);
}
export function jobPaths(data, jobId) {
  const out = new Map();
  for (const s of jobSkills(data, jobId)) { if (!out.has(s.path)) out.set(s.path, []); out.get(s.path).push(s); }
  return out;
}
/** 習得は明示的な記録だけで判定する。ジョブ経験やAP0では自動習得しない。 */
export function isLearned(member, skill) {
  return Boolean(skill && (member.learned ?? []).includes(skill.id));
}
/** 無料習得廃止前のセーブに限り、既得の初期スキルを明示的な習得記録へ移す。 */
export function migrateInitialSkills(data, member) {
  if (member.skillAcquisitionVersion === 1) return;
  const retired = new Set(data.balance?.content_updates?.retired_initial_skills ?? []);
  const learned = new Set(member.learned ?? []);
  for (const skill of data.skills?.values() ?? []) {
    if (retired.has(skill.id) && (skill.job === 'common' || hasVisitedJob(member, skill.job))) learned.add(skill.id);
  }
  member.learned = [...learned];
  member.skillAcquisitionVersion = 1;
}
/** 同じ枝の一つ前の段階。習得判定と詳細表示で共有する。 */
export function skillPrerequisite(data, skill) {
  const explicit = skill?.effect?.prerequisites;
  if (explicit) return explicit.length ? data.skills.get(explicit[0].id) : undefined;
  if (data.jobsById.get(skill.job)?.tier === 'base') return undefined;
  return jobSkills(data, skill.job).find((candidate) => candidate.path === skill.path && candidate.stage === skill.stage - 1);
}
/** 覚えられるか → 理由（覚えられるなら ''） */
export function learnBlock(data, member, skill) {
  if (!skill) return 'そのスキルはない';
  if (isLearned(member, skill)) return '覚えている';
  if (skill.job !== 'common' && !hasVisitedJob(member, skill.job)) return '先にこのジョブへ転職してください';
  if (skill.isFinal) {
    const required = data.basicJobRules?.ultimate?.required_skills ?? 10;
    const count = jobSkills(data, skill.job).filter((s) => !s.isFinal && isLearned(member, s)).length;
    if (count < required) return `この職の奥義以外を${required}種類修得（${count}/${required}）`;
  }
  if (Array.isArray(skill.effect?.prerequisites)) {
    for (const prerequisite of skill.effect.prerequisites) {
      const prev = data.skills.get(prerequisite.id);
      if (!prev || learnedSkillLevel(member, prev) < prerequisite.level) {
        return `「${prev?.name ?? prerequisite.id}」${prev && skillMaxLevel(prev)>1?`Lv${prerequisite.level}`:""}を修得`;
      }
    }
  } else {
    const prev = skillPrerequisite(data, skill);
    if (prev && !isLearned(member, prev)) return `「${prev.name}」を覚える`;
  }
  const ap = availableAp(data, member);
  if (ap < skill.apToLearn) return `AP が ${ap} / ${skill.apToLearn}`;
  return '';
}
/** AP を使って覚える。装着はスキル装備画面で行う。 */
export function learnSkill(data, member, skillId) {
  const s = data.skills.get(skillId);
  const block = learnBlock(data, member, s);
  if (block) throw new Error(block);
  spendAp(data, member, s.apToLearn);
  member.learned = [...(member.learned ?? []), s.id];
  if (isJobMastered(data, member, s.job)) {
    member.masteredJobs ??= [];
    if (!member.masteredJobs.includes(s.job)) member.masteredJobs.push(s.job);
  }
}

/** 習得後、空いている枠へ自動セットする。セットできなくても習得は維持する。 */
export function learnAndEquipSkill(data, member, skillId) {
  learnSkill(data, member, skillId);
  const skill = data.skills.get(skillId);
  const reason = equipBlock(data, member, skill);
  if (reason) return `${skill.name}を習得しました。自動セットできませんでした：${reason}。スキル装備画面でセットを変更してください。`;
  equipSkill(data, member, skillId);
  return `${skill.name}を習得し、自動でセットしました。`;
}

// ---------------- 技能レベル（修得した最高Lvで常に発動） ----------------
export function skillMaxLevel(skill) { return 1 + (skill.effect?.levels?.length ?? 0); }
export function learnedSkillLevel(member, skill) {
  if (!isLearned(member, skill)) return 0;
  const level = member.skillLevels?.[skill.id];
  return Number.isInteger(level) ? Math.max(1, Math.min(skillMaxLevel(skill), level)) : 1;
}
export function usedSkillLevel(member, skill) {
  return Math.max(1, learnedSkillLevel(member, skill));
}
/** 元データを変更せず、指定キャラの使用Lvから毎回組み立てる。二重適用しない。 */
export function effectiveSkill(data, member, skill) {
  const base = data.skills.get(skill.id) ?? skill;
  if (!base.effect?.levels) return skill;
  const level = usedSkillLevel(member, base);
  const upgrade = base.effect.levels?.[level - 2];
  if (!upgrade) return base;
  return { ...base, mp: upgrade.mp ?? base.mp, effect: { ...base.effect, ...upgrade.effect }, level };
}
export function upgradeSkillBlock(data, member, skill) {
  const level = learnedSkillLevel(member, skill);
  if (!level) return 'まだ覚えていない';
  const next = skill.effect.levels?.[level - 1];
  if (!next) return 'これ以上強化できない';
  const ap = availableAp(data, member);
  return ap < next.ap ? `AP が ${ap} / ${next.ap}` : '';
}
export function upgradeSkill(data, member, skillId) {
  const skill = data.skills.get(skillId);
  if (!skill) throw new Error('そのスキルはない');
  const reason = upgradeSkillBlock(data, member, skill);
  if (reason) throw new Error(reason);
  const level = learnedSkillLevel(member, skill);
  spendAp(data, member, skill.effect.levels[level - 1].ap);
  member.skillLevels ??= {};
  member.skillLevels[skillId] = level + 1;
  // 装着し直さず、次の行動から強化したLvを使う。
}
/** 旧呼出元用の互換関数。発動Lvは選択できず、最高Lvだけを受け付ける。 */
export function setSkillUseLevel(data, member, skillId, level) {
  const skill = data.skills.get(skillId);
  if (!skill || level !== learnedSkillLevel(member, skill)) {
    throw new Error('技能は修得済みの最高Lvで発動します');
  }
  delete member.skillUseLevels;
}
/** 不明ID/不正なLvを除外。旧セーブは未指定=Lv1、既得のAPや装着は触らない。 */
export function normalizeSkillLevels(data, member) {
  delete member.skillUseLevels;
  for (const key of ['skillLevels']) {
    if (!member[key]) continue;
    const clean = {};
    for (const [id, value] of Object.entries(member[key])) {
      const skill = data.skills.get(id);
      if (!skill || !isLearned(member, skill) || skillMaxLevel(skill) === 1 || !Number.isInteger(value) || value < 1) continue;
      clean[id] = Math.min(value, skillMaxLevel(skill));
    }
    member[key] = clean;
  }
}

// ---------------- スキルの枠（ほかのジョブのスキルも持ち出せる） ----------------
const isPassive = (s) => s.kind === 'passive';

/** 修得・装着は武器に縛らず、発動時だけ装備条件を確かめる。 */
export function skillWeaponBlock(data, member, skill) {
  const weapons = skill?.effect?.weapons;
  const required = skill?.effect?.require_weapon;
  if ((!Array.isArray(weapons) || !weapons.length) && !required) return '';
  const kind = member.equip?.weapon ? gearDef(data, member.equip.weapon).kind : 'unarmed';
  const allowed = Array.isArray(weapons) && weapons.length ? weapons : [required];
  if (allowed.includes(kind) || (kind === 'unarmed' && allowed.includes('none'))) return '';
  return `${allowed.map((id) => ['unarmed', 'none'].includes(id) ? '素手' : data.weaponTypes?.get(id)?.name ?? id).join('・')}が必要`;
}

/** 既存セーブを含め、アクティブとパッシブをスキル種別どおりに必ず分離する。 */
function normalizeLoadout(data, member) {
  const current = member.loadout ?? { actions: [], passives: [] };
  // 新しい専用枠の選択を、旧形式の通常枠に混ざった奥義より優先する。
  const ids = [current.ultimate, ...(current.actions ?? []), ...(current.passives ?? [])].filter(Boolean);
  const actions = [];
  const passives = [];
  let ultimate = null;
  const cap = capacity(data, member);
  const used = { actions: 0, passives: 0 };
  for (const id of ids) {
    const skill = data.skills.get(id);
    if (!skill || !isLearned(member, skill)) continue;
    if (skill.isFinal) { ultimate ??= id; continue; }
    const key = isPassive(skill) ? 'passives' : 'actions';
    const list = key === 'passives' ? passives : actions;
    if (!list.includes(id) && used[key] + skill.cost <= cap[key]) {
      list.push(id);
      used[key] += skill.cost;
    }
  }
  member.loadout = { actions, passives, ultimate };
  return member.loadout;
}

export function ensureLoadout(data, member) {
  if (member.loadout) return normalizeLoadout(data, member);
  // はじめて：今のジョブの覚えているスキルを入るだけつける
  member.loadout = { actions: [], passives: [], ultimate: null };
  for (const s of jobSkills(data, member.job)) if (isLearned(member, s) && !equipBlock(data, member, s)) equipSkill(data, member, s.id);
  return member.loadout;
}
export function capacity(data, member) {
  const m = commonMods(data, member);
  return {
    actions: (data.basicJobRules?.capacity?.actions ?? GROWTH_FORMULAS.action_capacity) + (m.cap_action ?? 0),
    passives: (data.basicJobRules?.capacity?.passives ?? GROWTH_FORMULAS.passive_capacity) + (m.cap_passive ?? 0),
  };
}
export function usedCapacity(data, member) {
  const lo = normalizeLoadout(data, member);
  const sum = (ids) => ids.reduce((a, id) => a + (data.skills.get(id)?.cost ?? 0), 0);
  return { actions: sum(lo.actions), passives: sum(lo.passives) };
}
/** 枠につけられるか → 理由 */
export function equipBlock(data, member, skill) {
  if (!skill) return 'そのスキルはない';
  const lo = normalizeLoadout(data, member);
  if (skill.isFinal) {
    if (lo.ultimate === skill.id) return 'つけている';
    if (!isLearned(member, skill)) return '覚えていない';
    return lo.ultimate ? '奥義は1つまで装備できます' : '';
  }
  const list = isPassive(skill) ? lo.passives : lo.actions;
  if (list.includes(skill.id)) return 'つけている';
  if (!isLearned(member, skill)) return '覚えていない';
  const cap = capacity(data, member);
  const used = usedCapacity(data, member);
  const key = isPassive(skill) ? 'passives' : 'actions';
  if (used[key] + skill.cost > cap[key]) return `枠が足りない（${used[key]} + ${skill.cost} > ${cap[key]}）`;
  return '';
}
export function equipSkill(data, member, skillId) {
  const s = data.skills.get(skillId);
  member.loadout = member.loadout ?? { actions: [], passives: [], ultimate: null };
  const block = equipBlock(data, member, s);
  if (block) throw new Error(block);
  if (s.isFinal) member.loadout.ultimate = s.id;
  else (isPassive(s) ? member.loadout.passives : member.loadout.actions).push(s.id);
}
export function unequipSkill(member, skillId) {
  if (!member.loadout) return;
  member.loadout.actions = (member.loadout.actions ?? []).filter((x) => x !== skillId);
  member.loadout.passives = (member.loadout.passives ?? []).filter((x) => x !== skillId);
  if (member.loadout.ultimate === skillId) member.loadout.ultimate = null;
}
/** 戦闘で使えるスキル（つけている通常スキル） */
export function actionSkills(data, member) {
  const lo = ensureLoadout(data, member);
  return lo.actions.map((id) => data.skills.get(id)).filter(Boolean).map((skill) => effectiveSkill(data, member, skill));
}

/** 奥義は通常アクティブ容量とは別の1枠。継承後も同じLvで使える。 */
export function ultimateSkill(data, member) {
  const lo = ensureLoadout(data, member);
  const skill = data.skills.get(lo.ultimate);
  return skill ? effectiveSkill(data, member, skill) : null;
}

// ---------------- 共通ツリー ----------------
export function commonApCost(node) { return node.apToLearn; }
export function commonBlock(data, member, node) {
  if (!node) return 'その共通パッシブはない';
  if ((member.common ?? []).includes(node.id)) return '覚えている';
  if (member.lv < node.level) return `Lv${node.level}から`;
  if (availableAp(data, member) < commonApCost(node)) return 'APが足りない';
  return '';
}
export function learnCommon(data, member, nodeId) {
  const node = data.commonTree.find((n) => n.id === nodeId);
  const block = commonBlock(data, member, node);
  if (block) throw new Error(block);
  spendAp(data, member, commonApCost(node));
  member.common = [...(member.common ?? []), node.id];
}
function commonMods(data, member) {
  const out = {};
  for (const id of member.common ?? []) add(out, parseBonusText(data.commonTree.find((n) => n.id === id)?.effect));
  return out;
}

// ---------------- ジョブを極める ----------------
export function isJobMastered(data, member, jobId) {
  if ((member.masteredJobs ?? []).includes(jobId)) return true;
  const skills = jobSkills(data, jobId);
  return skills.length > 0 && skills.every((s) => isLearned(member, s));
}

// ---------------- まとめた補正（パッシブ・共通ツリー・ジョブを極めたボーナス） ----------------
function add(out, mods) {
  for (const [k, v] of Object.entries(mods)) {
    if (typeof v === 'number') out[k] = (out[k] ?? 0) + v;
    else if (Array.isArray(v)) out[k] = [...(out[k] ?? []), v];
    else out[k] = v;
  }
}
/**
 * キャラの補正の合計。数の補正は足し、wdmg / edmg / tdmg は [[対象, 値], ...] にまとめる
 */


export function memberMods(data, member) {
  const out = {};
  if (!data.skills) return out;
  for (const id of member.loadout?.passives ?? []) {
    const skill = data.skills.get(id);
    if (!skill || !isLearned(member, skill) || skillWeaponBlock(data, member, skill)) continue;
    const mod = effectiveSkill(data, member, skill).effect.mod ?? {};
    for (const [k, v] of Object.entries(mod)) {
      if (['wdmg', 'edmg', 'tdmg', 'status_count_damage'].includes(k)) out[k] = [...(out[k] ?? []), v];
      else if (typeof v === 'number') out[k] = (out[k] ?? 0) + v;
    }
  }
  const common = commonMods(data, member);
  if ((member.common ?? []).includes('mana_afterglow')
    && (member.loadout?.passives ?? []).includes('common_mana_afterglow')) {
    // 基本版2経路の重複だけを除く。上位ノード・他の回復効果は加算のまま。
    const treeRate = parseBonusText(data.commonTree.find(n => n.id === 'mana_afterglow')?.effect).mp_regen ?? 0;
    const passiveRate = data.skills.get('common_mana_afterglow')?.effect.mod?.mp_regen ?? 0;
    common.mp_regen -= Math.min(treeRate, passiveRate);
  }
  add(out, common);
  out.regen = (out.regen ?? 0) + affixSum(member, 'REGEN') / 100;
  if (affixSum(member, 'ENDURE') > 0) out.endure = 1;
  // マスター状態は実績用。装着枠の外から常時能力を加算しない。
  return out;
}

// ---------------- 武器の熟練度 ----------------
export function masteryLevel(data, member, weaponType) {
  const max = Math.round(data.balance.battle.mastery_max / data.balance.battle.mastery_per_level);
  return Math.min(max, Math.floor((member.mastery?.[weaponType] ?? 0) / GROWTH_FORMULAS.mastery_kills_per_level));
}
/** 熟練度による攻撃力の倍率 */
export function masteryMul(data, member, weaponType) {
  return 1 + data.balance.battle.mastery_per_level * masteryLevel(data, member, weaponType);
}
/** 倒したときに熟練度を数える（今の武器の種類） */
export function addMasteryKill(data, member) {
  if (!member.equip.weapon) return;
  const t = gearDef(data, member.equip.weapon).kind;
  member.mastery = member.mastery ?? {};
  member.mastery[t] = (member.mastery[t] ?? 0) + 1;
}

// ---------------- ジョブチェンジ（神殿） ----------------
/** 基本職・初期解放に指定した実装済み職・解放済みの職を選べる。 */
export function availableJobs(data, game) {
  const unlocked = new Set(game.unlockedJobs ?? []);
  return data.jobs.filter((j) => j.skillsReady !== false && (j.tier === 'base'
    || data.jobUnlocks?.get(j.id)?.method === '初期' || unlocked.has(j.id)));
}

/**
 * ジョブを変える。新しいジョブで装備できない（適正×）物は倉庫へ。
 * 修得済みの技能と奥義の装着は転職後も保持する。
 */
export function changeJob(data, game, index, jobId) {
  const m = game.party[index];
  if (!availableJobs(data, game).some((j) => j.id === jobId)) throw new Error('そのジョブはまだ選べない');
  if (m.job === jobId) throw new Error('今のジョブと同じ');
  normalizeAp(data, m);
  m.job = jobId;
  if (!m.visitedJobs.includes(jobId)) m.visitedJobs.push(jobId);
  for (const slot of ['offhand', 'weapon', 'head', 'body', 'arm']) {
    const g = m.equip[slot];
    if (g && aptitudeMul(data, jobId, gearDef(data, g)) == null) unequip(data, game, m, slot);
  }
  m.hp = Math.min(m.hp, maxHp(data, m));
  m.mp = Math.min(m.mp, maxMp(data, m));
}



