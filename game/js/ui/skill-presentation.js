// 習得・装備・戦闘の画面で共通に使う、技能の分類と表示。
export const SKILL_CATEGORIES = ['攻撃', '回復・治療', '防御・支援', '妨害・調査', 'パッシブ', '奥義'];

export function skillCategory(skill) {
  if (skill.isFinal) return '奥義';
  if (skill.kind === 'passive') return 'パッシブ';
  if (['attack', 'fixed_damage', 'delayed'].includes(skill.kind)) return '攻撃';
  if (['heal', 'heal_all', 'revive', 'cure', 'cure_all', 'mp_give'].includes(skill.kind)) return '回復・治療';
  if (['self_buff', 'party_buff', 'ally_buff', 'imbue'].includes(skill.kind)) return '防御・支援';
  return '妨害・調査';
}

export function skillLoadoutKind(skill) {
  return skill.isFinal ? 'ultimate' : skill.kind === 'passive' ? 'passives' : 'actions';
}

export function equippedSkillIds(member, kind) {
  return kind === 'ultimate' ? [member.loadout?.ultimate].filter(Boolean) : member.loadout?.[kind] ?? [];
}

export function isSkillEquipped(member, skill) {
  return equippedSkillIds(member, skillLoadoutKind(skill)).includes(skill.id);
}

export function skillCostLabel(skill) {
  return skill.isFinal ? '奥義専用枠' : `枠${skill.cost}`;
}

export function skillWeaponText(data, skill) {
  const weapons = skill.effect?.weapons?.length ? skill.effect.weapons : skill.effect?.require_weapon ? [skill.effect.require_weapon] : [];
  return weapons.length ? weapons.map(id => ['none', 'unarmed'].includes(id) ? '素手' : data.weaponTypes.get(id)?.name ?? id).join('・') : '条件なし';
}

export function prerequisiteText(data, member, skill) {
  const prerequisites = skill.effect?.prerequisites ?? [];
  const entries = prerequisites.map(({ id, level = 1 }) => {
    const known = (member.learned ?? []).includes(id);
    const current = known ? Math.max(1, Number(member.skillLevels?.[id]) || 1) : 0;
    if(data.skills.get(id)?.effect?.growth_mode==='none')return `${data.skills.get(id).name} 修得（${known?"達成":"未修得"}）`;
    return `${data.skills.get(id)?.name ?? id} Lv${level}（${current >= level ? '達成' : `現在Lv${current}`}）`;
  });
  if (skill.isFinal) {
    const required = data.basicJobRules?.ultimate?.required_skills ?? 10;
    const learned = [...data.skills.values()].filter(candidate => candidate.job === skill.job && !candidate.isFinal && (member.learned ?? []).includes(candidate.id)).length;
    entries.unshift(`同職の非奥義${required}種類（${learned}/${required}）`);
  }
  return entries.join('・') || 'なし';
}

export function jobProfileRows(data, job) {
  if (!job) return [];
  const weaponNames = ids => (ids ?? []).map(id => data.weaponTypes.get(id)?.name ?? id).join('・');
  const elementNames = ids => (ids ?? []).map(id => data.elements.get(id)?.name ?? id).join('・');
  return [
    ['役割', job.role], ['得意武器S', weaponNames(job.sWeapons)], ['得意武器A', weaponNames(job.aWeapons)],
    ['主力属性', elementNames(job.elements) || '―'], ['補助属性', elementNames(job.supportElements) || '―'],
    ['戦い方', job.style],
  ].filter(([, value]) => value);
}

export function ultimateGauge(data, member) {
  const max = Math.max(1, Number(data.basicJobRules?.ultimate?.gauge_max) || 100);
  const value = Math.max(0, Math.min(max, Number(member.ultimateGauge) || 0));
  return { value, max, percent: value / max * 100, ready: value >= max };
}
