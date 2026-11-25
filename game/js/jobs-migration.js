import { normalizeAp } from './ap.js?v=skill-growth-2';

export const JOB_MASTER_VERSION = 1;

export function migrateSkillGrowth(data, game) {
  let changed=false;
  for(const member of game?.party??[]) {
    if(member.skillGrowthVersion===2)continue;
    let refund=0;
    for(const id of member.learned??[]) {
      const skill=data.skills.get(id);
      if(!skill?.effect?.master)continue;
      const maximum=1+(skill.effect.levels?.length??0);
      const old=Math.min(5,Math.max(1,Math.floor(Number(member.skillLevels?.[id])||1)));
      if(old>maximum){
        // Version 1 used this immutable upgrade schedule for every basic skill.
        refund += [12,20,30,45].slice(maximum-1,old-1).reduce((a,b)=>a+b,0);
        (member.skillLevels??={})[id]=maximum;
      }
    }
    normalizeAp(data,member);
    member.ap+=refund;
    member.skillGrowthVersion=2;
    member.skillGrowthRefund=refund;
    changed=true;
  }
  return changed;
}

// 旧技能を持たない職へ自動で移して行動不能にしない。解放履歴は別途保持する。
const BASE_FALLBACK = Object.freeze({
  stormcaster: 'black_mage', infernalist: 'black_mage', neutralist: 'black_mage',
  venomist: 'thief', bloodblade: 'warrior', seal_archer: 'hunter', petrifier: 'hunter',
  elementalist: 'black_mage', gunner: 'hunter', dancer: 'bard', spellblade: 'warrior',
  hexer: 'black_mage', apothecary: 'white_mage',
});

const validAmount = (n) => Number.isFinite(n) && n > 0 ? n : 0;

/**
 * 旧職業技能は旧マスタの費用相当APを返し、新しい技能を本人が選び直す。
 * 同名でも効果・前提が違うため、新IDの自動修得はしない。
 * メンバーごとの版を保存し、遠征前の写しにも同じ処理を適用できる。
 */
export function migrateJobMaster(data, game, run = null) {
  if(data.basicJobRules?.version>=2){migrateSkillGrowth(data,game);if(run?.snapshot)migrateSkillGrowth(data,run.snapshot);}
  if (!data.skills || ![...data.skills.values()].some((s) => s.effect?.master)) return false;
  const retired = new Map((data.skillMigration?.retired_skills ?? []).map((s) => [s.id, s]));
  const fallback = { ...BASE_FALLBACK, ...(data.skillMigration?.job_fallbacks ?? {}) };
  const baseIds = new Set(data.jobs.filter((j) => j.tier === 'base').map((j) => j.id));
  const chooseJob = (id) => {
    if (data.jobsById.get(id)?.skillsReady !== false && data.jobsById.has(id)) return id;
    const next = fallback[id];
    return baseIds.has(next) ? next : baseIds.has('warrior') ? 'warrior' : [...baseIds][0];
  };
  let changed = false;
  const refunds = [];
  for (const member of game.party ?? []) {
    if (member.jobMasterVersion === JOB_MASTER_VERSION) continue;
    normalizeAp(data, member);
    const oldJob = member.job;
    member.legacyJobHistory = [...new Set([...(member.legacyJobHistory ?? []), ...(member.visitedJobs ?? []), oldJob])];
    member.job = chooseJob(oldJob);
    member.visitedJobs = [...new Set([...(member.visitedJobs ?? []).filter((id) => data.jobsById.has(id)), member.job])];
    const keep = [];
    let refund = 0;
    const removed = [];
    for (const id of new Set(member.learned ?? [])) {
      const old = retired.get(id);
      if (!old || data.skills.get(id)?.effect?.master) {
        if (data.skills.has(id)) keep.push(id);
        else removed.push(id);
        continue;
      }
      refund += validAmount(old.ap);
      const level = Math.max(1, Math.min(1 + (old.levels?.length ?? 0), Math.floor(Number(member.skillLevels?.[id]) || 1)));
      for (const upgrade of (old.levels ?? []).slice(0, level - 1)) refund += validAmount(upgrade.ap);
      removed.push(id);
    }
    member.learned = keep;
    member.ap += refund;
    member.skillLevels = Object.fromEntries(Object.entries(member.skillLevels ?? {}).filter(([id]) => keep.includes(id)));
    delete member.skillUseLevels;
    member.masteredJobs = (member.masteredJobs ?? []).filter((id) => {
      const skills = [...data.skills.values()].filter((s) => s.job === id);
      return skills.length > 0 && skills.every((s) => keep.includes(s.id));
    });
    member.ultimateGauge = Math.max(0, Math.min(data.basicJobRules?.ultimate?.gauge_max ?? 100, Number(member.ultimateGauge) || 0));
    member.jobMasterMigration = { version: JOB_MASTER_VERSION, previousJob: oldJob, refundedAp: refund, retiredSkillIds: removed };
    member.jobMasterVersion = JOB_MASTER_VERSION;
    member.skillAcquisitionVersion = 1;
    refunds.push(`${member.name} ${refund}AP`);
    changed = true;
  }
  if (changed) {
    game.notices ??= [];
    game.notices.push(`職業と技能を新しい設計へ更新しました。旧職業技能の費用相当APを返還：${refunds.join('、')}。技能画面で修得し直せます。`);
    if (run?.battle?.pending?.action?.type === 'skill' && !data.skills.has(run.battle.pending.action.skillId)) {
      // 行動機会・敵・問題の学習記録は変えず、廃止技能の選択だけを取り消す。
      run.battle.pending = null;
    }
  }
  game.jobMasterVersion = JOB_MASTER_VERSION;
  // 存在しない解放IDは消さず記録に残す。画面・転職は現行マスタで絞る。
  game.legacyUnlockedJobs = [...new Set([...(game.legacyUnlockedJobs ?? []), ...(game.unlockedJobs ?? []).filter((id) => !data.jobsById.has(id))])];
  game.unlockedJobs = (game.unlockedJobs ?? []).filter((id) => data.jobsById.has(id));
  return changed;
}
