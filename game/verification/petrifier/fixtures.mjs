import assert from 'node:assert/strict';
import { createNewGame } from '../../js/game-state.js';
import { changeJob, equipSkill, equipBlock, learnSkill, isLearned } from '../../js/growth.js';
import { unlockJob } from '../../js/temple.js';
import { maxHp, maxMp, makeGear, canEquip, equipFromStorage, SLOTS } from '../../js/character.js';

export const PETRIFIER_SKILLS = ['petrifier_shot', 'petrifier_pierce', 'petrifier_aim', 'petrifier_volley'];
export const OFFERING = { sand_tomb_boss_mat: 2, m06_008_mat: 3 };

export function unlockAndTrain(data, game, index, { level = 45 } = {}) {
  if (!game.unlockedJobs.includes('petrifier')) {
    game.storage.materials = { ...game.storage.materials, ...OFFERING };
    unlockJob(data, game, 'petrifier');
  }
  changeJob(data, game, index, 'petrifier');
  const member = game.party[index];
  member.lv = level;
  member.loadout = { actions: ['petrifier_shot'], passives: [] };
  member.ap = 78;
  for (const id of PETRIFIER_SKILLS) if (!isLearned(member, data.skills.get(id))) learnSkill(data, member, id);
  for (const id of PETRIFIER_SKILLS) if (!equipBlock(data, member, data.skills.get(id))) equipSkill(data, member, id);
  assert.equal(member.ap, 0);
  member.equip.weapon = makeGear(game, 'gun_t1');
  member.hp = maxHp(data, member);
  member.mp = maxMp(data, member);
  return member;
}

// 素材・AP・装備を供給する検証用fixture。実セーブや長期経済は扱わない。
export function partyFixture(data, variant, { level = 45, itemCap = 54 } = {}) {
  const double = variant === 'mixed' || variant === 'gunner_pair';
  const jobs = ['warrior', 'knight', double ? 'gunner' : 'black_mage', 'white_mage', 'thief', 'gunner'];
  const game = createNewGame(data, jobs.map((job, i) => ({ job, name: `検証${i}`, icon: 'x' })));
  game.unlockedJobs.push('gunner');
  const slots = double ? [2, 5] : [5];
  const isD = !['gunner', 'gunner_pair'].includes(variant);
  for (const [i, member] of game.party.entries()) {
    member.lv = level;
    member.loadout = { actions: [], passives: [] };
    if (isD && slots.includes(i)) {
      unlockAndTrain(data, game, i, { level });
      if (variant === 'pierce_only') member.loadout = { actions: ['petrifier_pierce'], passives: [] };
      if (variant === 'no_passive') member.loadout.passives = [];
    } else {
      member.ap = 1000;
      const skills = [...data.skills.values()].filter(s => s.job === member.job && s.stage <= 3);
      for (const s of skills) if (!isLearned(member, s)) learnSkill(data, member, s.id);
      member.loadout = { actions: [], passives: [] };
      skills.sort((a, b) => (b.kind === 'heal_all') - (a.kind === 'heal_all') || a.stage - b.stage);
      for (const s of skills) if (!equipBlock(data, member, s)) equipSkill(data, member, s.id);
    }
    const job = data.jobsById.get(member.job);
    const weapon = member.job === 'gunner' ? 'gun' : job.startWeapon;
    const armor = member.job === 'gunner' ? 'medium' : job.startArmorWeight;
    for (const slot of SLOTS) {
      const defs = [...data.equipment.values()].filter(e => e.slot === slot && !e.unique && e.itemLv <= itemCap
        && (slot !== 'weapon' || e.kind === weapon) && (slot === 'weapon' || !e.armorWeight || e.armorWeight === armor))
        .sort((a, b) => b.itemLv - a.itemLv);
      const def = defs.find(e => canEquip(data, member, slot, { id: e.id }).ok);
      if (!def) continue;
      const gear = makeGear(game, def.id, { quality: 1.15, enh: 1 });
      game.storage.gear.push(gear);
      equipFromStorage(data, game, member, slot, gear.uid);
    }
    member.hp = maxHp(data, member);
    member.mp = maxMp(data, member);
  }
  game.items = {};
  return game;
}
