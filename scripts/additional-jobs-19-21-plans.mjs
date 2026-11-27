// The detailed design JSON remains the source for every level's numerical rules.
import fs from 'node:fs';

export const mysticJobs = ['necromancer', 'onmyoji', 'shrine_maiden'];
export const mysticSpecs = JSON.parse(fs.readFileSync(
  new URL('../docs/specs/additional-jobs-19-24-skills-v1.json', import.meta.url), 'utf8'
)).jobs.filter(job => mysticJobs.includes(job.id));

export const mysticPlans = new Map(mysticSpecs.flatMap(job => job.skills.map(skill => [
  skill.id,
  {
    kind: skill.type === 'passive' ? 'passive' : skill.reference === 'M' || skill.reference === 'MS'
      ? 'attack' : skill.id === 'shrine_maiden_A06' || skill.id === 'shrine_maiden_U01'
        ? 'heal_all' : skill.id === 'shrine_maiden_A02' || skill.id === 'onmyoji_A08'
          ? 'cure' : skill.target.includes('敵') ? 'debuff'
            : skill.target.includes('全員') || skill.target.includes('生存味方') ? 'party_buff'
              : skill.target === '自分' ? 'self_buff' : 'ally_buff',
    weapons: skill.weapons ?? [],
    build: index => {
      const rule = skill.levelRules[index];
      const attack = rule.kind === 'attack';
      const passive = rule.kind === 'passive';
      const element = rule.element === 'light|dark' ? 'light' :
        rule.element === 'chosen_light_dark' ? undefined : rule.element;
      return {
        ...(attack ? {
          base: 'mag', m: rule.power ?? rule.basePower,
          ...(element ? { element } : {}),
          ...(rule.status ? { st: [rule.status.id,rule.status.rate], status_turns:rule.turns } : {}),
          ...(rule.target?.includes('全体') || rule.target?.includes('全員') ? { tgt: 'all' } : {}),
        } : {}),
        ...(!attack && !passive ? {
          tgt: skill.target.includes('全員') || skill.target.includes('生存味方') ? 'all'
            : skill.target === '自分' ? 'self' : undefined,
          ...(skill.id === 'shrine_maiden_A06' ? { m: rule.power } : {}),
          ...(skill.id === 'shrine_maiden_U01' ? { m: rule.healPower } : {}),
        } : {}),
        ...(passive && rule.stat ? { mod: { [rule.stat]: rule.rate } } : {}),
        ...(skill.id === 'shrine_maiden_A09' ? { once: true } : {}),
        rules: {
          mystic: rule,
          ...(rule.base === 'MS' ? { scythe_spell: true } : {}),
          ...(rule.element === 'light|dark' ? { secondary_element: 'dark' } : {}),
          ...(rule.chooseElement ? { choose_element: rule.chooseElement } : {}),
        },
      };
    },
  },
])));
