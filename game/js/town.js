import { roundGold, goldScale, goldLimit } from './gold.js?v=skill-growth-2';
// ���̊�{�F��Ƌ�s�Z���E�M���h�̃N�G�X�g�Ɩ`���҃����N�E�e�{�݁B
// data �ɐ��⎮�Ƃ��ď�����Ă��Ȃ����̂́A�V�~�����[�^�[�isim/world.py�j�Ɠ����l�� TOWN_FORMULAS �ɒu���idocs/requests.md �ň˗��ς݁j�B
import { evaluate } from './expr.js?v=skill-growth-2';
import { makeGear, maxHp, maxMp, gearDef } from './character.js?v=advanced-jobs-1';
import { addItem } from './loot.js?v=advanced-jobs-1';
import { currentRank, allowedDungeons } from './dungeon.js?v=advanced-jobs-1';
import { monsterPool } from './encounter.js?v=advanced-jobs-1';
import { unlockReportedHuntJobs } from './temple.js?v=skill-growth-2';

export const TOWN_FORMULAS = Object.freeze({
  days_per_month: 30, // balance.json �� calendar.days_per_month ������΂�������g��
  board_size: 3, // �����N�� perk �Ɂu�N�G�X�g�f���� N���v���Ȃ����
  revive: '30 * Lv', // balance.json �� temple.revive �����Ȃ̂�
  shop_item_lv: 'item_lv_min + 3', // balance.json �� shop_gear_price.shop_item_lv �����Ȃ̂�
  sell_price: 'run_income * 0.04 * (1 + 0.8 * rarity_index)',
  sell_rank: 'floor((itemLv + 4) / 11) + 1', // ����Lv���灚�����߂�
});

// ---------------- ��ƌ��� ----------------
export function daysPerMonth(data) {
  return data.balance.calendar?.days_per_month ?? TOWN_FORMULAS.days_per_month;
}
/** ���̋G�߁iseasons.csv�j�ƁA�������ڂ� */
export function calendarOf(data, day) {
  const dpm = daysPerMonth(data);
  const monthIndex = Math.floor((day - 1) / dpm);
  const seasons = data.seasons ?? [];
  return {
    month: monthIndex + 1, dayOfMonth: ((day - 1) % dpm) + 1, daysLeft: dpm - ((day - 1) % dpm),
    season: seasons.length ? seasons[monthIndex % seasons.length] : null,
  };
}

/** ���̒i�K�F���j�����_���W�����̂����΂񍂂����isim �Ɠ����j */
export function feeTier(data, game) {
  const ranks = Object.keys(game.cleared ?? {}).map((id) => data.dungeons.get(id)?.rank ?? 1);
  return Math.max(1, ...ranks);
}
/**
 * ������i�߁A�����ɋ�s�Z���̗�����������B
 * @returns �����̒m�点�i���̔z��j
 */
export function advanceDays(data, game, n) {
  const notes = [];
  const dpm = daysPerMonth(data);
  for (let k = 0; k < n; k++) {
    game.day += 1;
    if ((game.day - 1) % dpm === 0) notes.push(...monthEnd(data, game));
  }
  game.notices = [...(game.notices ?? []), ...notes].slice(-10);
  return notes;
}

function monthEnd(data, game) {
  const bank = data.balance.bank ?? {};
  const interest = game.loan > 0 ? roundGold(data, game.loan * (bank.loan_interest_monthly ?? 0), 'ceil') : 0;
  if (!interest) return [];
  game.loan += interest;
  return [`�����F��s�Z���̗��� ${interest} G`];
}

// ---------------- �M���h�F�N�G�X�g ----------------
const questRules = (data) => data.balance.quest_board ?? {};
const finiteMoney = (n) => Number.isFinite(Number(n)) ? Math.max(0, Math.floor(Number(n))) : 0;

/** �f�����関�󒍂̌����B�󒍘g�Ƃ͓Ɨ����Ă���B */
export function boardSize(data, game) {
  const configured = Number(questRules(data).size);
  if (Number.isSafeInteger(configured) && configured > 0) return configured;
  const idx = data.ranks.findIndex((r) => r.id === game.rank);
  for (let i = idx; i >= 0; i--) {
    const m = /�N�G�X�g�f����\s*(\d+)\s*��/.exec(data.ranks[i].perk ?? '');
    if (m) return Number(m[1]);
  }
  return TOWN_FORMULAS.board_size;
}

export function questAcceptLimit(data, game) {
  const rules = questRules(data);
  let limit = Number(rules.max_accepted);
  if (!Number.isSafeInteger(limit) || limit < 1) limit = boardSize(data, game);
  const star = currentRank(data, game).maxDungeonRank;
  for (const step of rules.accepted_rank_steps ?? []) {
    if (star >= step.star && Number.isSafeInteger(step.limit)) limit = Math.max(limit, step.limit);
  }
  return limit;
}

/** ���ʈႢ�ł������˗��Ƃ��Ĉ����A���������̏d����V�������B */
export function questKey(q) {
  if (q.special) return `special:${q.rank}:${q.dungeonId}`;
  if (q.type === 'gather' && q.materialIds?.length) return `gather:${q.rank}:${[...q.materialIds].sort().join('|')}`;
  return `${q.type}:${q.rank}:${q.targetMode === 'dungeon' ? `place:${q.dungeonId}` : q.target ?? '*'}`;
}

export function questRewardGold(data, game, q) {
  if (Number.isFinite(q.rewardGold)) return finiteMoney(q.rewardGold);
  const def = data.quests.find((x) => x.id === q.questId);
  const amount = (data.economy.get(q.rank)?.run_income ?? 0) * (def?.rewardGoldPct ?? 0) / 100 * (1 + currentRank(data, game).questBonus);
  return q.goldLegacyContract ? Math.round(amount / goldScale(data)) * goldScale(data) : roundGold(data, amount);
}

export function questDepositTotal(game) {
  return (game.quests ?? []).reduce((sum, q) => sum + finiteMoney(q.depositPaid), 0);
}

export function questAbandonRefund(data, q, day) {
  if (q.special && day > q.deadlineDay && !onTime(q)) return 0;
  const rate = Math.min(1, Math.max(0, Number(questRules(data).abandon_refund_rate ?? 0.8)));
  return Math.floor(finiteMoney(q.depositPaid) / goldScale(data) * rate) * goldScale(data);
}

export function questDestination(data, q) {
  const ids = q.destinationIds?.length ? q.destinationIds : q.dungeonId ? [q.dungeonId] : (data.monsters.get(q.target)?.dungeons ?? []);
  return [...new Set(ids)].map((id) => data.dungeons.get(id)?.name).filter(Boolean).join('�E');
}

/** ���̋G�߁E�s����ꏊ�Ŏ��g�߂�˗������ɂ���B */
function questCandidates(data, game) {
  const season = calendarOf(data, game.day).season?.id;
  const dungeons = allowedDungeons(data, game);
  const ranks = new Set(dungeons.map(({ rank }) => rank));
  const definitions = data.quests.filter((q) => ranks.has(q.rank) && data.questTypes.some((t) => t.id === q.type));
  const places = dungeons.map((dungeon) => {
    const available = monsterPool(data, dungeon.id, season);
    const residents = [...data.monsters.values()].filter((m) => ['normal', 'season'].includes(m.role) && m.dungeons.includes(dungeon.id));
    const materialIds = [...new Set(residents.map((m) => m.materialCommon))]
      .filter((id) => data.materials.get(id)?.kind === 'common' && data.materials.get(id)?.rank === dungeon.rank).sort();
    return { dungeon, available, residents, materialIds };
  });
  const candidates = [];
  for (const def of definitions) {
    if (def.type === 'bounty') {
      const monster = data.monsters.get(def.target);
      const destinations = dungeons.filter((d) => d.rank === def.rank && monster?.role === 'bounty' && monster.dungeons.includes(d.id));
      if (destinations.length) candidates.push({ def, target: monster.id, dungeonId: destinations[0].id, destinationIds: destinations.map((d) => d.id) });
      continue;
    }
    for (const { dungeon, available, residents, materialIds } of places) {
      if (dungeon.rank !== def.rank || !available.length) continue;
      const base = { def, dungeonId: dungeon.id, destinationIds: [dungeon.id] };
      if (def.type === 'hunt') {
        candidates.push({ ...base, target: dungeon.id, targetMode: 'dungeon', targetIds: residents.map((m) => m.id) });
      } else if (def.type === 'gather' && materialIds.length && available.some((m) => materialIds.includes(m.materialCommon))) {
        candidates.push({ ...base, target: dungeon.id, materialIds });
      } else if (def.type === 'boss' && data.monsters.has(dungeon.bossId)) {
        candidates.push({ ...base, target: dungeon.bossId });
      }
    }
  }
  return candidates;
}

// ���n��ʌf�����ꎞ��~�B�����ς݂̖`�������̌f���ɏW�񂷂�B
export function questBoardAreas(data, game) {
  return [{ id: 'available', dungeons: allowedDungeons(data, game) }];
}

export function selectQuestBoardArea(data, game, areaId, rng = Math.random) {
  if (areaId && areaId !== 'available') throw new Error('�n��ʌf���͌��ݎg�p���Ă��܂���B');
  return fillBoard(data, game, rng);
}

function candidateKey(candidate) {
  return questKey({ ...candidate, type: candidate.def.type, rank: candidate.def.rank });
}

function createQuestOffer(data, game, candidate, rng) {
  const { def, ...target } = candidate;
  const q = {
    ...target, uid: (game.nextUid = (game.nextUid ?? 1) + 1), questId: def.id, type: def.type, rank: def.rank,
    count: def.countMin + Math.floor(rng() * (def.countMax - def.countMin + 1)), progress: 0, contractVersion: 1,
  };
  q.rewardGold = questRewardGold(data, game, q);
  q.depositGold = q.type === 'bounty' ? roundGold(data, q.rewardGold * Number(questRules(data).deposit_rate ?? 0.1), 'ceil') : 0;
  return q;
}

// �V�����f���𖳐����Ɉ��������Ȃ��悤�A���̉����ԂɈ����󂯂��˗��͍Čf���Ȃ��B
// �󒍒��̌_��E�a������� game �ɕۑ�����A�S�Ŏ��͉����J�n�O�̏�Ԃ֖߂�B
export function fillBoard(data, game, rng = Math.random) {
  game.quests ??= [];
  if (game.questBoardVersion !== 3) {
    game.board = []; // ���n��̖��󒍕������X�V�B�󒍍ς݌_��Ɨa������͈ێ�����B
    game.questBoardUsed = [];
    game.questBoardByArea = {};
    delete game.questBoardArea;
    delete game.specialQuest;
    game.questBoardVersion = 3;
  }
  game.board ??= [];
  game.questBoardUsed ??= [];
  game.questBoardPolicy = { acceptedLimit: questAcceptLimit(data, game) };
  const candidates = questCandidates(data, game);
  const validKeys = new Set(candidates.map(candidateKey));
  const taken = new Set([...game.quests.map(questKey), ...game.questBoardUsed]);
  const kept = [];
  for (const q of game.board) {
    const key = questKey(q);
    if (!validKeys.has(key) || taken.has(key)) continue;
    kept.push(q); taken.add(key);
    if (kept.length >= boardSize(data, game)) break;
  }
  game.board = kept;
  const types = questRules(data).type_slots ?? ['hunt', 'hunt', 'gather', 'gather', 'boss', 'bounty'];
  while (game.board.length < boardSize(data, game)) {
    const available = candidates.filter((candidate) => !taken.has(candidateKey(candidate)));
    if (!available.length) break;
    const counts = game.board.reduce((out, q) => ({ ...out, [q.type]: (out[q.type] ?? 0) + 1 }), {});
    const desired = types.find((type) => (counts[type] ?? 0) < types.filter((x) => x === type).length && available.some((c) => c.def.type === type));
    const choices = desired ? available.filter((c) => c.def.type === desired) : available;
    const candidate = choices[Math.min(choices.length - 1, Math.floor(rng() * choices.length))];
    const q = createQuestOffer(data, game, candidate, rng);
    game.board.push(q); taken.add(questKey(q));
  }
  const special = candidates.find(candidate => candidate.def.type === 'boss' && !taken.has(questKey({ ...candidate, rank: candidate.def.rank, special: true })));
  if (!special) delete game.specialQuest;
  else if (game.specialQuest?.dungeonId !== special.dungeonId) {
    const offer = createQuestOffer(data, game, special, () => 0);
    const days = data.dungeons.get(offer.dungeonId).days;
    Object.assign(offer, { special: true, daysToComplete: days >= 3 ? 12 : days === 2 ? 10 : 8,
      depositGold: roundGold(data, offer.rewardGold * .10, 'ceil') });
    game.specialQuest = offer;
  }
  return game.board;
}

/** ��������߂�Ɩ��󒍂̌f�����X�V����A�����˗��ɂ��Ē���ł���B */
export function refreshBoard(data, game, rng = Math.random) {
  game.board = [];
  game.questBoardByArea = {};
  delete game.specialQuest;
  game.questBoardUsed = [];
  return fillBoard(data, game, rng);
}

export function makeBoard(data, game, rng = Math.random) {
  return refreshBoard(data, game, rng);
}

export function questText(data, q) {
  const name = (id) => data.monsters.get(id)?.name ?? id;
  if (q.type === 'hunt' && q.targetMode === 'dungeon') return `${data.dungeons.get(q.dungeonId)?.name ?? q.dungeonId}�̖�����${q.count}�̂�����`;
  if (q.type === 'hunt') return `${name(q.target)}��${q.count}�̂�����`;
  if (q.type === 'bounty') return `�܋���u${name(q.target)}�v��|��`;
  if (q.type === 'boss') return `${q.special ? '���ʈ˗��F' : ''}${name(q.target)}��������`;
  if (q.type === 'gather' && q.materialIds?.length) return `${data.dungeons.get(q.dungeonId)?.name ?? q.dungeonId}�̒ʏ�f�ނ�${q.count}�[�i����`;
  if (q.type === 'gather') return `��${q.rank}�̒ʏ�f�ނ�${q.count}�[�i����`;
  return q.questId;
}

export function canAcceptQuest(data, game, q) {
  const limit = questAcceptLimit(data, game);
  if ((game.quests ?? []).length >= limit) return { ok: false, reason: `�����󒍂�${limit}���܂łł��B` };
  if ((game.quests ?? []).some((active) => questKey(active) === questKey(q))) return { ok: false, reason: '�����˗����󒍒��ł��B' };
  if (finiteMoney(q.depositGold) > game.gold) return { ok: false, reason: `�ۏ؋� ${q.depositGold} G ���K�v�ł��B` };
  return { ok: true, reason: '' };
}

/** data ���������ȌĂяo���B�� (game, uid) �͕ۑ��ς݂̌f�����Ŏ󒍂���B */
export function acceptQuest(dataOrGame, gameOrUid, uid, rng = Math.random) {
  const withData = uid !== undefined;
  const data = withData ? dataOrGame : null;
  const game = withData ? gameOrUid : dataOrGame;
  const offerUid = withData ? uid : gameOrUid;
  const i = (game.board ?? []).findIndex((q) => q.uid === offerUid);
  const special = game.specialQuest?.uid === offerUid;
  if (i < 0 && !special) throw new Error('���̃N�G�X�g�͂Ȃ�');
  const q = special ? game.specialQuest : game.board[i];
  game.quests ??= [];
  const limit = data ? questAcceptLimit(data, game) : game.questBoardPolicy?.acceptedLimit ?? TOWN_FORMULAS.board_size;
  if (game.quests.length >= limit) throw new Error(`�����󒍂�${limit}���܂łł��B`);
  if (game.quests.some((active) => questKey(active) === questKey(q))) throw new Error('�����˗����󒍒��ł��B');
  const deposit = finiteMoney(q.depositGold);
  if (game.gold < deposit) throw new Error(`�ۏ؋� ${deposit} G ���K�v�ł��B`);
  game.gold -= deposit;
  q.depositPaid = deposit;
  if (special) {
    q.deadlineDay = game.day + q.daysToComplete;
    delete game.specialQuest;
  } else game.board.splice(i, 1);
  game.quests.push(q);
  game.questBoardUsed ??= [];
  if (!game.questBoardUsed.includes(questKey(q))) game.questBoardUsed.push(questKey(q));
  if (data) fillBoard(data, game, rng);
  return q;
}

/** �퓬�����������ĂԁB�n�擢���͏ꏊ����v����K�v������B */
export function countKills(game, enemies, dungeonId = null) {
  for (const q of game.quests ?? []) {
    if (!['hunt', 'boss', 'bounty'].includes(q.type)) continue;
    const defeated = q.targetMode === 'dungeon'
      ? (q.dungeonId === dungeonId ? enemies.filter(e => q.targetIds?.includes(e.monsterId)) : [])
      : enemies.filter(e => e.monsterId === q.target);
    if ((q.type === 'hunt' || q.type === 'bounty') && (q.progress ?? 0) < q.count) {
      const statuses = defeated.map(e => e.status).filter(Boolean);
      if (statuses.length) q.defeatedStatusIds = [...new Set([...(q.defeatedStatusIds ?? []), ...statuses])];
    }
    q.progress = Math.min(q.count, (q.progress ?? 0) + defeated.length);
    if (q.special && defeated.length && q.progress >= q.count) q.completedDay ??= game.day;
  }
}

function gatherable(data, game, q) {
  return Object.entries(game.storage.materials).filter(([id, n]) => n > 0 && data.materials.get(id)?.kind === 'common'
    && data.materials.get(id)?.rank === q.rank && (!q.materialIds?.length || q.materialIds.includes(id)));
}

export function questProgress(data, game, q) {
  return Math.min(q.count, q.type === 'gather' ? gatherable(data, game, q).reduce((sum, [, n]) => sum + n, 0) : q.progress ?? 0);
}

export function canReport(data, game, q) {
  return questProgress(data, game, q) >= q.count;
}

const onTime = q => q.completedDay != null && q.completedDay <= q.deadlineDay;

export function questRankPoints(data, game, q) {
  const points = data.quests.find(def => def.id === q.questId)?.rankPoints ?? 0;
  const gap = currentRank(data, game).maxDungeonRank - q.rank;
  const rules = data.balance.guild_points ?? {};
  return points * (gap <= 0 ? rules.same_rank ?? 1 : gap === 1 ? rules.one_rank_lower ?? 0.5 : 0);
}

/** ��������B���_��͗a�����0�Ƃ��Ĉ����B */
export function abandonQuest(data, game, uid, rng = Math.random) {
  const i = (game.quests ?? []).findIndex((q) => q.uid === uid);
  if (i < 0) throw new Error('���̈˗��͎󒍂��Ă��܂���B');
  const q = game.quests[i];
  const refund = questAbandonRefund(data, q, game.day);
  const fee = finiteMoney(q.depositPaid) - refund;
  game.gold += refund;
  game.quests.splice(i, 1);
  game.questBoardUsed ??= [];
  if (!game.questBoardUsed.includes(questKey(q))) game.questBoardUsed.push(questKey(q));
  fillBoard(data, game, rng);
  return `�˗�����艺�����B${refund ? ` �ۏ؋� ${refund} G ��Ԋҁi�萔�� ${fee} G�j�B` : ' ��p�͂�����܂���B'}`;
}

/** �B���񍐁F�󒍎��̋��K��V�ƕۏ؋��̕Ԋ҂𕪂��A��x�����󂯎��B */
export function reportQuest(data, game, uid, rng = Math.random) {
  const i = game.quests.findIndex((q) => q.uid === uid);
  const q = game.quests[i];
  if (!q || !canReport(data, game, q)) throw new Error('�܂��񍐂ł��Ȃ�');
  const def = data.quests.find((x) => x.id === q.questId);
  if (!def) throw new Error('�˗��̕�V�f�[�^��������܂���B');
  const baseGold = questRewardGold(data, game, q);
  const gold = q.special && onTime(q) ? (q.goldLegacyContract ? Math.round(baseGold / goldScale(data) * 1.3) * goldScale(data) : roundGold(data, baseGold * 1.3)) : baseGold;
  const lines = [];
  if (q.type === 'gather') {
    let need = q.count;
    for (const [id, n] of gatherable(data, game, q).sort((a, b) => b[1] - a[1])) {
      const take = Math.min(n, need);
      game.storage.materials[id] -= take;
      if (game.storage.materials[id] <= 0) delete game.storage.materials[id];
      need -= take;
      if (!need) break;
    }
  }
  if (gold) { game.gold += gold; lines.push(`��V +${gold} G`); }
  const refund = !q.special || onTime(q) ? finiteMoney(q.depositPaid) : 0;
  if (q.special && !onTime(q) && q.depositPaid > 0) lines.push('�������߂̂��ߕۏ؋���v��');
  if (refund) { game.gold += refund; lines.push(`�ۏ؋� ${refund} G ��Ԋ�`); }
  if (def.rewardItem.startsWith('�܂�ȑf��')) {
    const n = Number(/(\d+)/.exec(def.rewardItem)?.[1] ?? 1);
    // �˗���ɐ��ޒʏ�E�G�߃����X�^�[�̑f�ނɌ��肷��B
    // �s�����ۑ����Ă��Ȃ����˗����A���ݍs���铯�����N�̒n�悾��������B
    const destinations = q.dungeonId ? [q.dungeonId]
      : allowedDungeons(data, game).filter((d) => d.rank === q.rank).map((d) => d.id);
    const rareIds = new Set([...data.monsters.values()]
      .filter((monster) => ['normal', 'season'].includes(monster.role)
        && monster.dungeons.some((id) => destinations.includes(id)))
      .map((monster) => monster.materialRare));
    const rares = [...rareIds].map((id) => data.materials.get(id))
      .filter((m) => m?.kind === 'rare' && m.rank === q.rank);
    const m = rares[Math.min(rares.length - 1, Math.floor(rng() * rares.length))];
    if (m) { game.storage.materials[m.id] = (game.storage.materials[m.id] ?? 0) + n; lines.push(`${m.name} �~${n}`); }
  }
  const pts = questRankPoints(data, game, q);
  game.rankPoints = (game.rankPoints ?? 0) + pts;
  lines.push(`�����N�̃|�C���g +${pts}`);
  lines.push(...unlockReportedHuntJobs(data, game, q));
  game.quests.splice(i, 1);
  game.questBoardUsed ??= [];
  if (!game.questBoardUsed.includes(questKey(q))) game.questBoardUsed.push(questKey(q));
  lines.push(...checkRankUp(data, game));
  fillBoard(data, game, rng);
  return lines;
}

/** �����N�̎��̒i�K�i�オ��邩�E��������Ȃ����j */
export function nextRankStatus(data, game) {
  const idx = data.ranks.findIndex((r) => r.id === game.rank);
  const next = data.ranks[idx + 1];
  if (!next) return null;
  const needs = [];
  if ((game.rankPoints ?? 0) < next.pointsRequired) needs.push(`�|�C���g ${game.rankPoints ?? 0} / ${next.pointsRequired}`);
  // ���s5�_���W�����ł́�3�ȏ�����J���Ă��Ȃ��B�����N�����͔C�ӂ̖`�����тŔ��肷��B
  if (next.needsBossClear && !Object.keys(game.cleared ?? {}).some((id) => (game.cleared[id] ?? 0) > 0 && data.dungeons.has(id))) {
    needs.push('�����ꂩ�̃_���W�����𓥔j����');
  }
  if (next.needsExam && !(game.examsPassed ?? []).includes(next.id)) needs.push('���i�����ŒP��E�p�앶�̗����ɍ��i����');
  return { next, needs, examOnly: needs.length === 1 && next.needsExam && !(game.examsPassed ?? []).includes(next.id) };
}

/** �|�C���g�����܂��Ă��Ď����̂���Ȃ������N�Ȃ�グ�� */
export function checkRankUp(data, game) {
  const lines = [];
  for (let st = nextRankStatus(data, game); st && st.needs.length === 0; st = nextRankStatus(data, game)) {
    game.rank = st.next.id;
    game.board = []; // �󂯂Ă��Ȃ��g�͐V���������N�̃N�G�X�g�ɓ��ꂩ����i���̉�ʂ��񍐂̂Ƃ��ɕ�[�j
    lines.push(`�`���҃����N���u${st.next.title}�v�ɏオ�����I`);
  }
  return lines;
}

// ---------------- �h�� ----------------
/** ���܂�F�|��Ă��Ȃ��l�� HP�EMP ���S�񕜁B�ǂ������͎��̉����̂��������ʂ�����iinn_rooms.csv�j */
export function stayInn(data, game, good) {
  const econ = data.economy.get(feeTier(data, game));
  const cost = good ? econ.inn_good : econ.inn_cheap;
  if (game.gold < cost) throw new Error('����������Ȃ�');
  game.gold -= cost;
  const fx = good ? data.innRooms.find((r) => r.innRank === (game.facilities?.inn ?? 1)) : null;
  for (const m of game.party) {
    m.room = fx ? { hp: fx.maxHpPct / 100, mp: fx.maxMpPct / 100, spd1: fx.firstBattleSpdPct / 100, sres: fx.statusResistPct / 100 } : null;
    if (m.hp > 0) { m.hp = maxHp(data, m); m.mp = maxMp(data, m); }
  }
  return cost;
}

// ---------------- �_�a�i���������B�ق��̓`�F�b�N���X�g12�ԁj ----------------
export function reviveCost(data, member) {
  return roundGold(data, goldScale(data) * evaluate(TOWN_FORMULAS.revive, { Lv: member.lv }));
}
export function revive(data, game, index) {
  const m = game.party[index];
  if (m.hp > 0) throw new Error('�|��Ă��Ȃ�');
  const cost = reviveCost(data, m);
  if (game.gold < cost) throw new Error('����������Ȃ�');
  game.gold -= cost;
  m.hp = maxHp(data, m);
  m.mp = maxMp(data, m);
  return cost;
}

// ---------------- �X ----------------
export const discount = (data, game) => currentRank(data, game).shopDiscount;
const priceWith = (data, game, p) => roundGold(data, p * (1 - discount(data, game)));

/** ����̕i���낦�iitems.csv �� shop_rank ������̃����N�ȉ��ŁA�X�Ŕ�����́j */
export function itemShopStock(data, game) {
  const rank = game.facilities?.item_shop ?? 1;
  return [...data.items.values()].filter((it) => it.source === '�X' && it.price > 0 && it.shopRank <= rank)
    .map((it) => ({ item: it, price: priceWith(data, game, it.price) }));
}
export function buyItem(data, game, itemId, count = 1) {
  const e = itemShopStock(data, game).find((x) => x.item.id === itemId);
  if (!e) throw new Error('�����Ă��Ȃ�');
  const room = Math.min(count, Math.floor(game.gold / e.price));
  if (room <= 0) throw new Error('����������Ȃ�');
  const left = addItem(game, itemId, room);
  const bought = room - left;
  if (bought <= 0) throw new Error('����ȏ㎝�ĂȂ�');
  game.gold -= bought * e.price;
  return bought;
}

/** ����E�h��̕i���낦�F�����N�ōs���遚���ƂɁu���́��̑���Lv����+3�v�́A���ʂȂ��̕���E�h��i���E�́E�r�j */
export function gearShopStock(data, game) {
  const maxStar = currentRank(data, game).maxDungeonRank;
  const out = [];
  for (let star = 1; star <= maxStar; star++) {
    const ds = [...data.dungeons.values()].filter((d) => d.rank === star);
    if (!ds.length) continue;
    const target = evaluate(TOWN_FORMULAS.shop_item_lv, { item_lv_min: Math.min(...ds.map((d) => d.itemLvMin)) });
    const cands = [...data.equipment.values()].filter((e) => !e.unique && e.source.includes('�X') && ['weapon', 'head', 'body', 'arm'].includes(e.slot));
    const lv = cands.map((e) => e.itemLv).filter((x) => x <= target).sort((a, b) => b - a)[0] ?? Math.min(...cands.map((e) => e.itemLv));
    for (const e of cands.filter((x) => x.itemLv === lv)) out.push({ def: e, star, price: priceWith(data, game, gearPrice(data, e)) });
  }
  return out;
}
export function gearPrice(data, def) {
  const P = data.balance.shop_gear_price;
  return roundGold(data, goldScale(data) * evaluate(def.slot === 'weapon' ? P.weapon : P.armor, { itemLv: def.itemLv }));
}
export function buyGear(data, game, equipId) {
  const e = gearShopStock(data, game).find((x) => x.def.id === equipId);
  if (!e) throw new Error('�����Ă��Ȃ�');
  if (game.gold < e.price) throw new Error('����������Ȃ�');
  game.gold -= e.price;
  const g = makeGear(game, equipId);
  game.storage.gear.push(g);
  return g;
}

/** �q�ɂ̑����𔄂�l�i */
export function sellPrice(data, gear) {
  const def = gearDef(data, gear);
  const star = Math.min(data.economy.size, Math.max(1, evaluate(TOWN_FORMULAS.sell_rank, { itemLv: def.itemLv })));
  const ri = Math.max(0, data.rarityTable.findIndex((r) => r.id === gear.rarity));
  return roundGold(data, evaluate(TOWN_FORMULAS.sell_price, { run_income: data.economy.get(star).run_income, rarity_index: ri }));
}
export function sellGear(data, game, uid) {
  const i = game.storage.gear.findIndex((g) => g.uid === uid);
  if (i < 0) throw new Error('�q�ɂɂȂ�');
  const p = sellPrice(data, game.storage.gear[i]);
  game.storage.gear.splice(i, 1);
  game.gold += p;
  return p;
}

// ---------------- �o�b�N�p�b�N���L����i����j ----------------
/** backpack.csv �̑f�ނ̏����u��1�ȏ�̒ʏ�f�ށi�b�E�l�^�j:5�v��ǂ� */
export function parseMaterialNeed(data, text) {
  const kinds = { �ʏ�: 'common', �܂��: 'rare', �{�X: 'boss' };
  return String(text ?? '').split('|').filter(Boolean).map((part) => {
    const m = /^��(\d+)�ȏ��(�ʏ�|�܂��|�{�X)�f��(?:�i(.+?)�j)?:(\d+)$/.exec(part);
    const element = /^��(\d+)�ȏ��(.+?)�����̑f��:(\d+)$/.exec(part);
    const status = /^��(\d+)�ȏ�́A�u(.+?)�v�n�̏�Ԉُ���g�������X�^�[�̑f��:(\d+)$/.exec(part);
    if (!m && !element && !status) throw new Error(`�f�ނ̏������ǂ߂Ȃ��F${part}`);
    if (element) {
      const id = [...data.elements.values()].find((entry) => entry.name === element[2])?.id;
      if (!id) throw new Error(`������������Ȃ��F${part}`);
      return { text: part.split(':')[0], minRank: Number(element[1]), element: id, count: Number(element[3]) };
    }
    if (status) {
      if (![...data.statusEffects.values()].some((entry) => entry.group === status[2])) throw new Error(`��Ԉُ�̌n����������Ȃ��F${part}`);
      return { text: part.split(':')[0], minRank: Number(status[1]), statusGroup: status[2], count: Number(status[3]) };
    }
    const typeNames = m[3] ? m[3].split('�E') : null;
    const types = typeNames ? [...data.monsterTypes.values()].filter((t) => typeNames.includes(t.name)).map((t) => t.id) : null;
    return { text: part.split(':')[0], minRank: Number(m[1]), kind: kinds[m[2]], types, count: Number(m[4]) };
  });
}
export function matchesNeed(data, matId, need) {
  const mat = data.materials.get(matId);
  if (!mat || mat.rank < need.minRank || (need.kind && mat.kind !== need.kind)) return false;
  if (need.element) return mat.element?.split('|').includes(need.element) ?? false;
  if (need.statusGroup) {
    const monster = data.monsters.get(mat.sourceMonster);
    return Boolean(monster?.status?.split('|').some((id) => data.statusEffects.get(id)?.group === need.statusGroup));
  }
  if (!need.types) return true;
  return need.types.some((t) => data.monsters.get(mat.sourceMonster)?.types.includes(t));
}
export function nextBackpackTier(data, game) {
  return data.backpackTiers.find((t) => t.tier === game.backpackTier + 1) ?? null;
}
/** �L�����邩 �� { ok, reasons } */
export function canExpandBackpack(data, game) {
  const t = nextBackpackTier(data, game);
  if (!t) return { ok: false, reasons: ['����ȏ�͍L�����Ȃ�'] };
  const reasons = [];
  if ((game.facilities?.item_shop ?? 1) < t.shopRank) reasons.push(`����̃����N${t.shopRank}���K�v`);
  if (game.gold < t.gold) reasons.push(`���� ${t.gold} ���K�v`);
  for (const need of parseMaterialNeed(data, t.materials)) {
    const have = Object.entries(game.storage.materials).filter(([id]) => matchesNeed(data, id, need)).reduce((a, [, n]) => a + n, 0);
    if (have < need.count) reasons.push(`${need.text}�� ${have} / ${need.count}`);
  }
  return { ok: reasons.length === 0, reasons, tier: t };
}
export function expandBackpack(data, game) {
  const c = canExpandBackpack(data, game);
  if (!c.ok) throw new Error(c.reasons.join('�E'));
  game.gold -= c.tier.gold;
  for (const need of parseMaterialNeed(data, c.tier.materials)) {
    let left = need.count;
    for (const [id, n] of Object.entries(game.storage.materials).filter(([x]) => matchesNeed(data, x, need)).sort((a, b) => b[1] - a[1])) {
      const take = Math.min(n, left);
      game.storage.materials[id] -= take;
      if (!game.storage.materials[id]) delete game.storage.materials[id];
      left -= take;
      if (!left) break;
    }
  }
  game.backpackTier = c.tier.tier;
  return c.tier.slots;
}

export function loanLimit(data, game) {
  const rank = currentRank(data, game).maxDungeonRank;
  const index = Math.max(0, data.ranks.findIndex((r) => r.id === game.rank));
  return goldLimit(data, 3 * data.economy.get(rank).guild_fee * (1 + 0.25 * index / 2));
}

export function borrow(data, game, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('�؂����z��1 G�ȏ�œ��͂��Ă��������B');
  if ((game.loan ?? 0) + amount > loanLimit(data, game)) throw new Error('�Z���̏���𒴂��Ă��܂��B');
  game.loan = (game.loan ?? 0) + amount;
  game.gold += amount;
  return `${amount} G �؂肽�B`;
}

export function repayLoan(game, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('�Ԃ����z��1 G�ȏ�œ��͂��Ă��������B');
  const paid = Math.min(amount, game.gold, game.loan ?? 0);
  if (paid <= 0) throw new Error('�ԍςł�����z������܂���B');
  game.gold -= paid;
  game.loan -= paid;
  return `${paid} G �ԍς����B`;
}

