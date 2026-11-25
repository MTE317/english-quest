import { availableAp, spendAp, normalizeAp, hasVisitedJob } from './ap.js?v=unified-ap-1';
// 成長：スキルツリーと AP・スキルの枠・共通ツリー・ジョブを極めたボーナス・武器の熟練度・ジョブチェンジ。
// data に数として書かれていないものは GROWTH_FORMULAS に置く（docs/requests.md で依頼済み）。
import { gearDef, aptitudeMul, unequip, maxHp, maxMp } from './character.js?v=unified-ap-1';

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
/** 覚えているか（ap_to_learn が0のものは最初から） */
export function isLearned(member, skill) {
  if ((member.learned ?? []).includes(skill.id)) return true;
  // 共通の魔力の余韻だけは職経験を必要としない初期パッシブ。
  if (skill.id === 'common_mana_afterglow' && skill.job === 'common' && skill.apToLearn === 0) return true;
  // AP 0 は「そのジョブに初めて就いた時点で覚える初期スキル」。
  // 未経験ジョブの初期スキルまで全員共通で使える状態にはしない。
  return skill.apToLearn === 0 && hasVisitedJob(member, skill.job);
}
/** 同じ枝の一つ前の段階。習得判定と詳細表示で共有する。 */
export function skillPrerequisite(data, skill) {
  if (data.jobsById.get(skill.job)?.tier === 'base') return undefined;
  return jobSkills(data, skill.job).find((candidate) => candidate.path === skill.path && candidate.stage === skill.stage - 1);
}
/** 覚えられるか → 理由（覚えられるなら ''） */
export function learnBlock(data, member, skill) {
  if (isLearned(member, skill)) return '覚えている';
  if (!hasVisitedJob(member, skill.job)) return '先にこのジョブへ転職してください';
  const prev = skillPrerequisite(data, skill);
  if (prev && !isLearned(member, prev)) return `「${prev.name}」を覚える`;
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

// ---------------- 基本職の技能レベル（習得と使用は別に保存） ----------------
export function skillMaxLevel(skill) { return 1 + (skill.effect?.levels?.length ?? 0); }
export function learnedSkillLevel(member, skill) {
  if (!isLearned(member, skill)) return 0;
  const level = member.skillLevels?.[skill.id];
  return Number.isInteger(level) ? Math.max(1, Math.min(skillMaxLevel(skill), level)) : 1;
}
export function usedSkillLevel(member, skill) {
  const max = learnedSkillLevel(member, skill);
  if (!max) return 1;
  const level = member.skillUseLevels?.[skill.id];
  return Number.isInteger(level) ? Math.max(1, Math.min(max, level)) : 1;
}
/** 元データを変更せず、指定キャラの使用Lvから毎回組み立てる。二重適用しない。 */
export function effectiveSkill(data, member, skill) {
  const base = data.skills.get(skill.id) ?? skill;
  if (!base.effect?.levels) return skill;
  const level = usedSkillLevel(member, base);
  const upgrade = base.effect.levels?.[level - 2];
  if (!upgrade) return base;
  return { ...base, mp: upgrade.mp, effect: { ...base.effect, ...upgrade.effect } };
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
  // 使用Lvは操作しない。装着中・持出し中でも勝手にMPや効果を変えない。
}
export function setSkillUseLevel(data, member, skillId, level) {
  const skill = data.skills.get(skillId);
  if (!skill || !Number.isInteger(level) || level < 1 || level > learnedSkillLevel(member, skill)) {
    throw new Error('習得済みのLvを選んでください');
  }
  member.skillUseLevels ??= {};
  member.skillUseLevels[skillId] = level;
}
/** 不明ID/不正なLvを除外。旧セーブは未指定=Lv1、既得のAPや装着は触らない。 */
export function normalizeSkillLevels(data, member) {
  for (const key of ['skillLevels', 'skillUseLevels']) {
    if (!member[key]) continue;
    const clean = {};
    for (const [id, value] of Object.entries(member[key])) {
      const skill = data.skills.get(id);
      if (!skill || !isLearned(member, skill) || skillMaxLevel(skill) === 1 || !Number.isInteger(value) || value < 1) continue;
      clean[id] = Math.min(value, key === 'skillLevels' ? skillMaxLevel(skill) : learnedSkillLevel(member, skill));
    }
    member[key] = clean;
  }
}

// ---------------- スキルの枠（ほかのジョブのスキルも持ち出せる） ----------------
const isPassive = (s) => s.kind === 'passive';

/** 既存セーブを含め、アクティブとパッシブをスキル種別どおりに必ず分離する。 */
function normalizeLoadout(data, member) {
  const current = member.loadout ?? { actions: [], passives: [] };
  const ids = [...(current.actions ?? []), ...(current.passives ?? [])];
  const actions = [];
  const passives = [];
  for (const id of ids) {
    const skill = data.skills.get(id);
    if (!skill || !isLearned(member, skill)) continue;
    const list = isPassive(skill) ? passives : actions;
    if (!list.includes(id)) list.push(id);
  }
  member.loadout = { actions, passives };
  return member.loadout;
}

export function ensureLoadout(data, member) {
  if (member.loadout) return normalizeLoadout(data, member);
  // はじめて：今のジョブの覚えているスキルを入るだけつける
  member.loadout = { actions: [], passives: [] };
  for (const s of jobSkills(data, member.job)) if (isLearned(member, s) && !equipBlock(data, member, s)) equipSkill(data, member, s.id);
  return member.loadout;
}
export function capacity(data, member) {
  const m = commonMods(data, member);
  return {
    actions: GROWTH_FORMULAS.action_capacity + (m.cap_action ?? 0),
    passives: GROWTH_FORMULAS.passive_capacity + (m.cap_passive ?? 0),
  };
}
export function usedCapacity(data, member) {
  const lo = normalizeLoadout(data, member);
  const sum = (ids) => ids.reduce((a, id) => a + (data.skills.get(id)?.cost ?? 0), 0);
  return { actions: sum(lo.actions), passives: sum(lo.passives) };
}
/** 枠につけられるか → 理由 */
export function equipBlock(data, member, skill) {
  const lo = normalizeLoadout(data, member);
  const list = isPassive(skill) ? lo.passives : lo.actions;
  if (list.includes(skill.id)) return 'つけている';
  if (!isLearned(member, skill)) return '覚えていない';
  if (skill.isFinal && skill.job !== member.job) return 'ほかのジョブの奥義は持ち出せない';
  const cap = capacity(data, member);
  const used = usedCapacity(data, member);
  const key = isPassive(skill) ? 'passives' : 'actions';
  if (used[key] + skill.cost > cap[key]) return `枠が足りない（${used[key]} + ${skill.cost} > ${cap[key]}）`;
  return '';
}
export function equipSkill(data, member, skillId) {
  const s = data.skills.get(skillId);
  member.loadout = member.loadout ?? { actions: [], passives: [] };
  const block = equipBlock(data, member, s);
  if (block) throw new Error(block);
  (isPassive(s) ? member.loadout.passives : member.loadout.actions).push(s.id);
}
export function unequipSkill(member, skillId) {
  if (!member.loadout) return;
  member.loadout.actions = member.loadout.actions.filter((x) => x !== skillId);
  member.loadout.passives = member.loadout.passives.filter((x) => x !== skillId);
}
/** 戦闘で使えるスキル（つけている通常スキル） */
export function actionSkills(data, member) {
  const lo = member.loadout ?? ensureLoadout(data, member);
  return lo.actions.map((id) => data.skills.get(id)).filter(Boolean).map((skill) => effectiveSkill(data, member, skill));
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

const SET_EFFECTS = {
  '通常攻撃のダメージ': 'normal_damage', '魔法のダメージ': 'magic_damage',
  '受けるダメージ': 'damage_cut', '戦闘のあとHP': 'hp_regen',
  '素材が出やすい': 'drop', '状態異常にかかる確率': 'sres', '会心のダメージ': 'crit_damage',
};

function equipmentSetMods(data, member) {
  const counts = new Map();
  for (const id of new Set(Object.values(member.equip ?? {}).filter(Boolean).map((g) => g.id))) {
    const set = data.equipment.get(id)?.setId;
    if (set) counts.set(set, (counts.get(set) ?? 0) + 1);
  }
  const mods = {};
  for (const [id, count] of counts) {
    if (count < 2) continue;
    const set = data.sets.get(id);
    if (!set) continue;
    const [stat, text] = set.bonus_2.split(':');
    const key = stat.toLowerCase();
    mods[key] = (mods[key] ?? 0) + parseFloat(text) / 100;
    if (count < 4) continue;
    const effect = set.bonus_4;
    if (effect === '最初のターンに先に動く') { mods.first = 1; continue; }
    const kind = Object.keys(SET_EFFECTS).find((label) => effect.startsWith(label));
    if (kind) {
      const stat = SET_EFFECTS[kind];
      const bonus = Math.abs(parseFloat(effect.match(/[+-]?\d+(?=%)/)[0])) / 100;
      mods[stat] = (mods[stat] ?? 0) + bonus;
    }
  }
  return mods;
}

export function memberMods(data, member) {
  const out = {};
  if (!data.skills) return out;
  for (const id of member.loadout?.passives ?? []) {
    const mod = data.skills.get(id)?.effect.mod ?? {};
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
  add(out, equipmentSetMods(data, member));
  for (const j of data.jobMastery ?? []) if (isJobMastered(data, member, j.job)) add(out, parseBonusText(j.bonus));
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
/** 選べるジョブ：基本ジョブと、解放したジョブ */
export function availableJobs(data, game) {
  const unlocked = new Set(game.unlockedJobs ?? []);
  return data.jobs.filter((j) => j.tier === 'base' || unlocked.has(j.id));
}

/**
 * ジョブを変える。新しいジョブで装備できない（適正×）物は倉庫へ。
 * ほかのジョブの奥義はスキルの枠から外す。
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
  if (m.loadout) {
    for (const id of [...m.loadout.actions, ...m.loadout.passives]) {
      const s = data.skills.get(id);
      if (s?.isFinal && s.job !== jobId) unequipSkill(m, id);
    }
  }
  // 新しいジョブの最初のスキル（ap_to_learn 0）を、枠に空きがあればつける
  for (const s of jobSkills(data, jobId)) if (isLearned(m, s) && !equipBlock(data, m, s)) equipSkill(data, m, s.id);
  m.hp = Math.min(m.hp, maxHp(data, m));
  m.mp = Math.min(m.mp, maxMp(data, m));
}

