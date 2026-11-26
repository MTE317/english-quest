import { normalizeAp } from './ap.js?v=skill-growth-2';
import { migrateGold, goldVersion } from './gold.js?v=skill-growth-2';
// 新しいゲームの進み具合（セーブの game の中身）
import { createMember, maxHp, maxMp, levelCap, partyCanAct } from './character.js?v=party-wipe-1';
import { ensureLoadout, jobSkills, isLearned, normalizeSkillLevels, migrateInitialSkills } from './growth.js?v=advanced-jobs-1';
import { parseAmounts } from './csv.js?v=skill-growth-2';
import { recordStoredMaterials } from './temple.js?v=skill-growth-2';
import { retireLegacyQuestChains } from './retired-quests.js?v=skill-growth-2';
import { migrateJobMaster, JOB_MASTER_VERSION } from './jobs-migration.js?v=skill-growth-2';
import { migrateRankFacilities } from './rank-migration.js';

export const PARTY_SIZE = 6;

/** 新規作成と旧セーブへの加入で使う、データに沿った初期メンバー。 */
export function defaultPartySpecs(data) {
  const names = ['アレン', 'リゼ', 'ノア', 'ミラ', 'カイ', 'エマ'];
  const jobs = data.jobs.filter((job) => job.tier === 'base');
  return Array.from({ length: PARTY_SIZE }, (_, i) => ({
    name: names[i],
    job: jobs.find((job) => job.id === data.balance.new_game?.party_jobs?.[i])?.id ?? jobs[i % jobs.length].id,
    icon: data.icons[i % data.icons.length]?.id ?? '',
  }));
}

/**
 * はじめから始めるときの進み具合
 * @param partySpecs 6人ぶんの { name, job, icon }
 * @param options partySize は過去の比較用編成を読み込む場合だけ明示する。画面は常に PARTY_SIZE を使う。
 * 最初のお金と日付は data にまだないので、balance.json の new_game があればそれを使う（docs/requests.md で依頼中）
 */
export function createNewGame(data, partySpecs, { partySize = PARTY_SIZE } = {}) {
  if (!Array.isArray(partySpecs) || partySpecs.length !== partySize) throw new Error(`パーティーは${partySize}人`);
  const start = data.balance.new_game ?? {};
  const game = {
    day: start.day ?? 1,
    gold: start.gold ?? 0,
    goldVersion: goldVersion(data),
    nextUid: 1,
    party: [],
    storage: { gear: [], materials: {} },
    items: {},
    contentUpdates: { build36: true },
    rank: data.ranks?.[0]?.id ?? null, // 冒険者ランク（adventurer_ranks.csv の最初）
    backpackTier: data.backpackTiers?.[0]?.tier ?? 1,
  };
  game.party = partySpecs.map((spec, i) => createMember(data, game, spec, i));
  if (data.basicJobRules) {
    // 新規開始時は初期装備を配布せず、全員が無装備で始める。
    for (const member of game.party) {
      member.jobMasterVersion = JOB_MASTER_VERSION;
      member.skillGrowthVersion=2;
      member.ultimateGauge = 0;
    }
    game.jobMasterVersion = JOB_MASTER_VERSION;
    game.notices = ['技能画面でAPを使って技能を修得し、支度金で装備を整えましょう。'];
  }
  return normalizeGame(data, game, null, { expandParty: partySize === PARTY_SIZE });
}

/**
 * 古いセーブにない項目を足す（あとから増えた項目。セーブを読んだら呼ぶ）
 * 専用制作の固定効果は現行マスタへそろえる。廃止したルーン能力と枠を移行する。
 * 遠征中は全滅時の復元元にも適用する。
 */
export function normalizeGame(data, game, run = null, { expandParty = true } = {}) {
  if (!game) return game;
  migrateGold(data, game, run);
  game.storage = game.storage ?? { gear: [], materials: {} };
  game.storage.materials ??= {};
  recordStoredMaterials(game);
  game.items = game.items ?? {};
  migrateRankFacilities(data, game);
  game.rank = game.rank ?? data.ranks?.[0]?.id ?? null;
  game.rankPoints = game.rankPoints ?? 0;
  game.backpackTier = game.backpackTier ?? data.backpackTiers?.[0]?.tier ?? 1;
  game.facilities = game.facilities ?? {};
  for (const f of data.facilities ?? []) game.facilities[f.id] = game.facilities[f.id] ?? 1;
  game.quests = game.quests ?? [];
  game.board = game.board ?? null;
  game.cleared = game.cleared ?? {};
  // 旧会費の滞納だけを清算する。銀行からの融資残高は保持する。
  delete game.overdue;
  game.notices = game.notices ?? [];
  retireLegacyQuestChains(data, game);
  // 転職でのJP消費は廃止済み。旧セーブにある残高は保持する。
  game.titles ??= [];
  game.unlockedJobs = game.unlockedJobs ?? [];
  for (const job of data.jobs ?? []) if (job.skillsReady && data.jobUnlocks?.get(job.id)?.method === '初期'
    && !game.unlockedJobs.includes(job.id)) game.unlockedJobs.push(job.id);
  game.examsPassed = game.examsPassed ?? [];
  const masterChangedMembers = new Set((game.party ?? []).filter((member) => member.jobMasterVersion !== JOB_MASTER_VERSION));
  const masterChanged = migrateJobMaster(data, game, run);
  for (const member of game.party ?? []) migrateInitialSkills(data, member);
  preserveMasteredJobs(data, game);
  const retiredMembers = retireRuneBonuses(data, game);
  for (const m of game.party ?? []) {
    m.persist = m.persist ?? []; m.room = m.room ?? null; normalizeAp(data, m);
    m.learned = m.learned ?? []; m.common = m.common ?? []; m.mastery = m.mastery ?? {};
    m.masteredJobs ??= [];
    if (data.skills) { normalizeSkillLevels(data, m); ensureLoadout(data, m); }
    for (const gear of Object.values(m.equip ?? {})) alignCraftedEffects(data, gear);
    m.ultimateGauge = Math.max(0, Math.min(data.basicJobRules?.ultimate?.gauge_max ?? 100, Number(m.ultimateGauge) || 0));
    if (retiredMembers.has(m) || (masterChanged && masterChangedMembers.has(m))) {
      // 現在値は回復させず、新上限だけを適用する。戦闘不能の HP 0 も維持する。
      if (Number.isFinite(m.hp)) m.hp = Math.min(m.hp, maxHp(data, m));
      if (Number.isFinite(m.mp)) m.mp = Math.min(m.mp, maxMp(data, m));
    }
  }
  for (const gear of game.storage.gear ?? []) alignCraftedEffects(data, gear);
  // 旧4人の遠征は最後まで同じ人数で続ける。戦闘の配列や行動順、全滅前の写しを変えない。
  if (expandParty && !run) expandLegacyParty(data, game);
  // 入場時の写しも返還済みにし、全滅で旧能力が復活したり二重返還されたりしないようにする。
  // 戦闘中の能力値は毎回 game.party から算出されるため、行動順や進行の記録は変えない。
  if (run?.snapshot && run.snapshot !== game) normalizeGame(data, run.snapshot, null, { expandParty: false });
  return game;
}

/** 町にいる旧4〜5人のセーブだけに仲間を補い、既存キャラと所持品を維持する。 */
function expandLegacyParty(data, game) {
  if (!Array.isArray(game.party) || game.party.length < 4 || game.party.length >= PARTY_SIZE) return;
  const levels = game.party.map((member) => member.lv).filter((lv) => Number.isInteger(lv) && lv > 0);
  const level = Math.min(levelCap(data), levels.length ? Math.min(...levels) : 1);
  const gear = [...(game.storage.gear ?? []), ...game.party.flatMap((member) => Object.values(member.equip ?? {}))];
  game.nextUid = Math.max(1, Number(game.nextUid) || 1,
    ...gear.map((item) => Number.isSafeInteger(item?.uid) ? item.uid + 1 : 1));
  const specs = defaultPartySpecs(data);
  const ids = new Set(game.party.map((member) => member.id));
  const canAct = partyCanAct(game);
  const added = [];
  while (game.party.length < PARTY_SIZE) {
    const index = game.party.length;
    const member = createMember(data, game, specs[index], index);
    let idIndex = index + 1;
    while (ids.has(`m${idIndex}`)) idIndex += 1;
    member.id = `m${idIndex}`;
    ids.add(member.id);
    member.lv = level;
    member.room = null;
    if (data.basicJobRules) {
      member.jobMasterVersion = JOB_MASTER_VERSION;
      member.skillGrowthVersion=2;
      member.ultimateGauge = 0;
    }
    member.hp = canAct ? maxHp(data, member) : 0;
    member.mp = maxMp(data, member);
    member.masteredJobs = [];
    game.party.push(member);
    added.push(member.name);
  }
  game.notices.push(`${added.join('・')}が加入し、パーティーが${PARTY_SIZE}人になりました。加入時のレベルは仲間の最低レベル（Lv${level}）です。`);
}

/** 新技能の追加前に極めていたジョブのボーナスを、一度だけ既得として記録する。 */
function preserveMasteredJobs(data, game) {
  if (game.contentUpdates?.build36) return;
  const addedIds = data.balance?.content_updates?.build36_skills;
  if (!data.skills || !addedIds?.length) return;
  const added = new Set(addedIds);
  const oldJobs = new Map((data.jobs ?? []).map((job) => job.id)
    .map((jobId) => [jobId, jobSkills(data, jobId).filter((skill) => !added.has(skill.id))]));
  for (const member of game.party ?? []) {
    const mastered = new Set(member.masteredJobs ?? []);
    for (const [jobId, skills] of oldJobs) {
      if (skills.length && skills.every((skill) => isLearned(member, skill))) mastered.add(jobId);
    }
    member.masteredJobs = [...mastered];
  }
  game.contentUpdates ??= {};
  game.contentUpdates.build36 = true;
}

/**
 * 旧ルーンの装備データを廃止し、記録から確定できる枠の解放費用だけを一度返す。
 * 刻み直しの回数・支払額は旧セーブにないため推測しない。
 * kokuinSlots は新規購入に使わず、旧セーブの返還にだけ残している。
 */
function retireRuneBonuses(data, game) {
  const members = (game.party ?? []).filter((m) => ['runes', 'runeSlots', 'runeMods'].some((key) => Object.hasOwn(m, key)));
  const changed = new Set(members);
  if (!members.length && !Object.hasOwn(game, 'runeEffects')) return changed;

  if (game.runeRetirement?.version !== 1) {
    let gold = 0;
    const materials = {};
    for (const m of members) {
      const slots = Number(m.runeSlots);
      if (!Number.isSafeInteger(slots) || slots < 1) continue;
      for (const entry of data.kokuinSlots ?? []) {
        const slot = Number(entry.slot);
        if (!Number.isSafeInteger(slot) || slot < 1 || slot > slots) continue;
        const cost = Number(entry.gold);
        if (Number.isFinite(cost) && cost > 0) gold += cost;
        for (const { id, count } of parseAmounts(entry.materials)) {
          if (Number.isFinite(count) && count > 0) materials[id] = (materials[id] ?? 0) + count;
        }
      }
    }
    game.gold = (game.gold ?? 0) + gold;
    for (const [id, count] of Object.entries(materials)) {
      game.storage.materials[id] = (game.storage.materials[id] ?? 0) + count;
    }
    // 返還の記録も保存し、読み込みや全滅による再実行で重複させない。
    game.runeRetirement = { version: 1, gold, materials };
    if (gold || Object.keys(materials).length) {
      const parts = [gold ? `${gold} G` : '', Object.keys(materials).length ? '解放に使った素材' : ''].filter(Boolean);
      game.notices.push(`ルーンストーンの能力補正を廃止し、刻印枠の費用 ${parts.join('・')} を返還しました。`);
    }
  }
  delete game.runeEffects;
  for (const m of members) {
    delete m.runes;
    delete m.runeSlots;
    delete m.runeMods;
  }
  return changed;
}

function alignCraftedEffects(data, gear) {
  if (!gear?.crafted) return;
  const def = data.equipment?.get(gear.id);
  if (!def?.recipeId || def.unique || def.setId) return;
  // 制作品は振り直せないため、affixes はレシピの固定効果だけ。
  // 効果の辞書をコピーし、マスタや別の装備・入場時の写しと共有しない。
  gear.affixes = { ...(def.fixedEffects ?? {}) };
}


