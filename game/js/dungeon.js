import { worldNode, ensureWorldJourney, worldEntries, knownWorldDungeons, exitChoices, revealWorldExits } from './world-journey.js?v=world-journey-1';
import { gainAp } from './ap.js?v=skill-growth-2';
import { roundGold } from './gold.js?v=skill-growth-2';
// ダンジョンの遠征：行き先・階層・戦利品・帰還を扱う。遠征の進み具合は session.run に保存する。
//
// run.state
//   'ready'        … 次の戦闘の前
//   'loot'         … 拾ったものがバックパックに入りきらない（入れ替えるかあきらめるかを選ぶ）
//   'return_point' … 帰還ポイント（帰るか先へ進むかを選ぶ）
//   'cleared'      … 最終戦を終えた（新経路は出口3択、旧経路は帰還）
import { createBattle, finishBattle, battleRewards, curedBy } from './battle.js?v=enemy-skills-1';
import { recordMonsterDefeats } from './monster-knowledge.js?v=fixed-monsters-1';
import { makeEncounter, floorRow, planBounty } from './encounter.js?v=enemy-skills-1';
import { rollBattleLoot, addToBackpack, swapIntoBackpack, unloadBackpack } from './loot.js?v=fixed-monsters-1';
import { gainXp, maxHp, maxMp, affixSum, partyCanAct } from './character.js?v=party-wipe-1';
import { advanceDays, calendarOf, countKills, refreshBoard } from './town.js?v=enemy-skills-1';
import { discoverJobs, recordStoredMaterials } from './temple.js?v=skill-growth-2';
import { memberMods } from './growth.js?v=advanced-jobs-1';
import { planExploration, resolveExploration, commitExploration, explorationEntryAllowed } from './exploration.js?v=enemy-skills-1';
import { isTrialDungeonUnlocked, TRIAL_DUNGEON_IDS } from './world-map.js?v=canyon-public-1';

/** 乱数の種から 0〜1 の乱数を返す関数（状態は obj[key] に入れて保存できる） */
export function seededRng(obj, key = 'rng') {
  return () => {
    obj[key] = (Math.imul(obj[key] >>> 0, 1664525) + 1013904223) >>> 0;
    return obj[key] / 4294967296;
  };
}

export function currentRank(data, game) {
  return data.ranks.find((r) => r.id === game.rank) ?? data.ranks[0];
}

/** 公開対象の地域だけを公開。ランクではなく踏破によって新しい冒険先を発見する。 */
export function allowedDungeons(data, game) {
  if (data.worldRoutes && game.worldJourney) return knownWorldDungeons(data, game);
  return [...data.dungeons.values()]
    .filter((dungeon) => isTrialDungeonUnlocked(game, dungeon.id)
      && explorationEntryAllowed(data.balance.dungeon?.exploration, game, dungeon.id))
    .sort((a, b) => a.rank - b.rank);
}

/** 地図の地域は★3段階ずつ。季節遠征は別枠に置く。 */
export function dungeonRegion(dungeon) {
  if (dungeon.kind.includes('季節')) return '季節の遠征';
  return ['周辺の街道', '外縁の領域', '遠方の領域', '最果ての領域'][Math.floor((dungeon.rank - 1) / 3)];
}

/** 同じ★で複数の育成経路を選べる。季節遠征は固有の攻略経路を持つ。 */
export function canTrainIn(dungeon) {
  return ['近場', '素材の宝庫'].includes(dungeon.kind);
}

export function expeditionFee(data, dungeon) {
  if (worldNode(data, dungeon.id)) return data.worldRoutes.expeditionFee;
  const config = data.balance.dungeon ?? {};
  if ((config.free_expeditions ?? []).includes(dungeon.id)) return 0;
  return roundGold(data, data.economy.get(dungeon.rank).run_income * dungeon.incomeMul * (config.expedition_fee_rate ?? 0));
}

/** 遠征の行き先にかかわらず、出題できる教材を選べる。 */
export function allowedStones(lex) {
  return (lex.allStones ?? lex.stones).filter((stone) => lex.wordsByStone.get(stone.id)?.length > 0);
}

/**
 * 遠征を始める：入る前の状態を写してから、日数を使う
 * @param quizState QuestionPicker の toState()（出題の状態）
 */
export function startRun(data, session, { dungeonId, stoneId, quizState, seed, bountyLure = false, worldStoneId }) {
  if (worldNode(data, dungeonId)) return startWorldRun(data, session, { dungeonId, stoneId, quizState, seed, worldStoneId });
  if (!partyCanAct(session.game)) throw new Error('全員が死亡または石化しています。神殿で治療してください。');
  const dg = data.dungeons.get(dungeonId);
  if (!dg) throw new Error(`ダンジョン ${dungeonId} がない`);
  if (!allowedDungeons(data, session.game).includes(dg)) throw new Error('この冒険先はまだ発見していません。');
  const fee = expeditionFee(data, dg);
  if (session.game.gold < fee) throw new Error(`遠征費 ${fee} G が必要です。`);
  if (bountyLure && !(session.game.items.bounty_lure > 0)) throw new Error('おびき寄せ香を持っていません。');
  session.enterDungeon({ dungeonId, stoneId }, (run, game) => {
    game.gold -= fee; // 全滅時は支払い前のスナップショットに戻る。
    run.expeditionFee = fee;
    if (bountyLure) {
      game.items.bounty_lure -= 1;
      if (!game.items.bounty_lure) delete game.items.bounty_lure;
    }
    run.layoutVersion = data.balance.dungeon?.layout_version ?? 2;
    run.route = data.dungeonFloors.filter((row) => row.dungeonId === dungeonId)
      .sort((a, b) => a.floor - b.floor).map((row) => ({ ...row }));
    run.introRouteVersion = 1;
    if (dungeonId === 'howling_canyon') run.canyonRouteVersion = 1;
    const escorts = data.balance.dungeon?.new_route_boss_escorts?.[dungeonId];
    if (Number.isInteger(escorts)) for (const row of run.route) row.bossEscorts = escorts;
    if (TRIAL_DUNGEON_IDS.includes(dungeonId)) {
      for (const row of run.route) row.returnPointAfter = false;
    }
    const intro = data.balance.dungeon?.intro_routes?.[dungeonId];
    if (intro) for (const row of run.route) row.introEncounter = structuredClone(intro);
    // Keep exploration draws independent of battle, bounty and battle-loot draws.
    const explorationRng = seededRng({ rng: Math.imul(seed ^ (seed >>> 16), 0x45d9f3b) });
    run.explorationPlan = planExploration(data.balance.dungeon?.exploration, dungeonId, run.route, explorationRng);
    run.battleIndex = 0;
    run.elitesSeen = 0;
    run.state = 'ready';
    run.backpack = { gear: [], materials: {} };
    run.earned = { gold: 0, xp: 0 };
    run.pendingLoot = [];
    run.quiz = quizState;
    run.rng = seed >>> 0;
    run.notices = advanceDays(data, game, dg.days);
    run.bounty = intro ? null : planBounty(data, game, dungeonId, seededRng(run), { lure: bountyLure });
  });
}

/** 次のダンジョンに入る。遠征全体の持ち物・戦利品・教材の進捗は引き継ぐ。 */
function enterWorldNode(data, game, run, node) {
  run.dungeonId = node.id;
  run.floor = 1;
  run.battleIndex = 0;
  run.route = data.dungeonFloors.filter(row => row.dungeonId === node.id).map(row => ({ ...row }));
  run.state = 'ready';
  run.cleared = false;
  run.bossDefeated = false;
  run.explorationPlan = [];
  run.explorationNotices = [];
  run.worldVisit = (run.worldVisit ?? 0) + 1;
  delete run.bounty;
  const map = ensureWorldJourney(data, game);
  if (!map.visited.includes(node.key)) map.visited.push(node.key);
  if (!map.seen.includes(node.key)) map.seen.push(node.key);
}

function startWorldRun(data, session, { dungeonId, stoneId, quizState, seed, worldStoneId = data.worldRoutes.startStone }) {
  if (!partyCanAct(session.game)) throw new Error('全員が死亡または石化しています。神殿で治療してください。');
  const map = ensureWorldJourney(data, session.game);
  const node = worldEntries(data, session.game, worldStoneId).find(n => n.id === dungeonId);
  if (!node) throw new Error('このワールドストーンから出発できる入口ではありません');
  const fee = data.worldRoutes.expeditionFee;
  if (session.game.gold < fee) throw new Error('遠征費が足りません');
  session.enterDungeon({ dungeonId, stoneId }, (run, game) => {
    game.gold -= fee;
    Object.assign(run, { worldVersion: 1, worldStoneId, worldClears: {}, expeditionFee: fee,
      layoutVersion: 2, introRouteVersion: 1, backpack: { gear: [], materials: {} },
      earned: { gold: 0, xp: 0 }, pendingLoot: [], quiz: quizState, rng: seed >>> 0, elitesSeen: 0 });
    run.notices = advanceDays(data, game, data.worldRoutes.expeditionDays);
    run.worldSeason = calendarOf(data, game.day).season?.id;
    const edge = `${worldStoneId}:${node.key}`;
    if (!map.paths.includes(edge)) map.paths.push(edge);
    enterWorldNode(data, game, run, node);
  });
}

/** クリア画面の世代を検証し、連打・古い画面からの移動を拒否する。 */
export function chooseWorldExit(data, session, direction, expectedVisit) {
  const run = session.run;
  if (!run?.worldVersion || run.battle || run.state !== 'cleared' || run.pendingLoot.length
    || expectedVisit !== run.worldVisit) throw new Error('現在は出口を選べません');
  const node = worldNode(data, run.dungeonId);
  const exit = exitChoices(data, session.game, run, run.worldSeason).find(e => e.direction === direction);
  if (!exit?.open) throw new Error(exit?.reason || '出口がありません');
  const next = worldNode(data, exit.to);
  let arrival = null;
  session.updateRun((current, game) => {
    const map = ensureWorldJourney(data, game);
    const edge = `${node.key}:${direction}`;
    if (!map.paths.includes(edge)) map.paths.push(edge);
    if (next) enterWorldNode(data, game, current, next);
    else {
      const stone = data.worldRoutes.stones.find(s => s.id === exit.to);
      const discovered = !map.stones.includes(stone.id);
      if (discovered) map.stones.push(stone.id);
      arrival = { stoneId: stone.id, discovered, message: stone.id === data.worldRoutes.startStone
        ? '町に到着した。' : `${stone.name}に到着した。${discovered ? 'ワープを解放した。' : ''}町に帰還した。` };
      current.worldArrival = arrival;
    }
  });
  if (arrival) returnToTown(data, session);
  return arrival;
}

export function runRoute(data, run) {
  if (Array.isArray(run.route) && run.route.length) return run.route;
  const legacy = run.layoutVersion == null && (run.snapshot || run.battleIndex != null)
    ? data.balance.dungeon?.legacy_layout?.[run.dungeonId] : null;
  if (legacy) {
    run.route = Array.from({ length: legacy.floors }, (_, i) => ({
      dungeonId: run.dungeonId, floor: i + 1, enemyLevel: legacy.first_level + i,
      battles: legacy.battles_per_floor, enemiesPerBattle: i === 0 ? legacy.first_floor_enemies : legacy.other_floor_enemies,
      lastBattleIsBoss: i + 1 === legacy.floors, returnPointAfter: i + 1 === legacy.return_point_floor,
    }));
    run.layoutVersion = 1;
  } else if ((!run.introRouteVersion || (run.dungeonId === 'howling_canyon' && !run.canyonRouteVersion)) && data.balance.dungeon?.pre_intro_routes?.[run.dungeonId]) {
    run.route = structuredClone(data.balance.dungeon.pre_intro_routes[run.dungeonId]);
  } else {
    run.route = data.dungeonFloors.filter((row) => row.dungeonId === run.dungeonId)
      .sort((a, b) => a.floor - b.floor).map((row) => ({ ...row }));
    run.layoutVersion ??= data.balance.dungeon?.layout_version ?? 2;
  }
  if (run.training) for (const row of run.route) row.lastBattleIsBoss = false;
  return run.route;
}

export function runFloorCount(data, run) { return runRoute(data, run).length; }

export function runFloorRow(data, run) {
  return runRoute(data, run).find((row) => row.floor === run.floor) ?? floorRow(data, run.dungeonId, run.floor);
}

export function isBossBattle(data, run) {
  const row = runFloorRow(data, run);
  return !run.training && row.lastBattleIsBoss && run.battleIndex === row.battles - 1;
}

/** 次の戦闘を始める（敵を決めて保存） */
export function startNextBattle(data, session) {
  const run = session.run;
  if (run.state !== 'ready') throw new Error('今は戦闘を始められない');
  const rng = seededRng(run);
  run.explorationNotices = [];
  const bounty = run.bounty?.floor === run.floor && run.bounty?.battle === run.battleIndex ? run.bounty.monsterId : null;
  const season = calendarOf(data, session.game.day).season?.id;
  const maxElites = Math.max(0, (data.monsterElites?.maxPerExpedition ?? data.balance.dungeon?.elite_max_per_run ?? Infinity) - (run.elitesSeen ?? 0));
  const enemies = makeEncounter(data, run.dungeonId, run.floor, rng, {
    boss: isBossBattle(data, run), season, bountyId: bounty, elites: true, maxElites,
    quests: session.game.quests ?? [], rowOverride: runFloorRow(data, run),
  });
  run.elitesSeen = (run.elitesSeen ?? 0) + enemies.filter((enemy) => enemy.eliteId).length;
  session.setBattle(createBattle(data, session.game, { enemies, seed: Math.floor(rng() * 4294967296), firstBattle: run.battlesDone === 0 }));
}

/**
 * 戦闘が終わったあと（勝った・逃げた・敗北した）。
 * @returns 戦闘結果と、勝利時のメンバーごとの成長・ドロップ
 */
/** 勝利後の回復。検証ツールも実ゲームと同じ処理を使う。 */
export function recoverAfterBattle(data, game) {
  for (const m of game.party.filter(member => member.hp > 0)) {
    const mods = memberMods(data, m);
    if (mods.mp_regen) m.mp = Math.min(maxMp(data, m), Math.round(m.mp + maxMp(data, m) * mods.mp_regen));
    if (mods.hp_regen) m.hp = Math.min(maxHp(data, m), Math.round(m.hp + maxHp(data, m) * mods.hp_regen));
  }
}

function receiveLoot(data, game, run, loot) {
  game.gold += loot.gold;
  run.earned.gold += loot.gold;
  run.pendingLoot.push(...addToBackpack(data, game, run.backpack, [
    ...loot.gear.map((gear) => ({ type: 'gear', gear })),
    ...loot.materials.map(({ id, count }) => ({ type: 'material', id, count })),
  ]));
  game.catalog ??= { gear: [], monsters: [] };
  game.catalog.gear = [...new Set([...game.catalog.gear, ...loot.gear.map((item) => item.id)])];
}

export function returnAfterDefeat(data, session, updateTown) {
  const game = session.game;
  const battle = session.run.battle;
  finishBattle(data, game, battle);
  if (partyCanAct(game)) {
    session.rollbackRun(updateTown); // 戦闘の規定ラウンド数を超えた場合
    return false;
  }
  session.wipe(updateTown);
  return true;
}

export function afterBattle(data, session, updateTown) {
  const b = session.run.battle;
  const game = session.game;
  if (!b || !['win', 'fled', 'lose'].includes(b.result)) throw new Error('戦闘はまだ終わっていません');
  if (b.result === 'lose') {
    recordMonsterDefeats(game, b.enemies);
    const wiped = returnAfterDefeat(data, session, updateTown);
    return { result: 'lose', wiped, growth: [], loot: null };
  }
  finishBattle(data, game, b);
  const growth = [];
  let loot = null;
  session.endBattle((g, run) => {
    if (b.result === 'win') {
      recordMonsterDefeats(g, b.enemies);
      countKills(g, b.enemies, run.dungeonId);
      const r = battleRewards(data, g, b, { dungeonId: run.training || (run.dungeonId === 'howling_canyon' && !run.canyonRouteVersion) ? undefined : run.dungeonId });
      const practice = b.learningRewards;
      if (practice?.answers) {
        const scale = practice.total / practice.answers;
        r.xp = r.xp.map((value) => Math.round(value * scale));
      }
      g.party.forEach((m, i) => {
        const xp = r.xp[i];
        const ap = r.ap[i];
        const levels = gainXp(data, m, xp);
        gainAp(data, m, ap);
        run.earned.xp += xp;
        growth.push({ xp, ap, levels });
      });
      recoverAfterBattle(data, g);
      const survivors = g.party.filter((m) => m.hp > 0);
      const dropBonus = Math.max(0, ...survivors.map((m) => (memberMods(data, m).drop ?? 0) + affixSum(m, 'DROP') / 100));
      const goldBonus = Math.max(0, ...survivors.map((m) => memberMods(data, m).gold ?? 0));
      loot = rollBattleLoot(data, g, run.dungeonId, run.floor, b.enemies, seededRng(run), { dropBonus, route: runRoute(data, run) });
      for (const id of b.stolen ?? []) {
        const existing = loot.materials.find((entry) => entry.id === id);
        if (existing) existing.count += 1;
        else loot.materials.push({ id, count: 1 });
      }
      loot.gold = roundGold(data, loot.gold * (1 + goldBonus));
      if (b.enemies.some((e) => e.boss && !e.bounty)) discoverJobs(data, g, run.dungeonId, seededRng(run));
      run.pendingLoot ??= [];
      receiveLoot(data, g, run, loot);
      if (b.enemies.some((enemy) => enemy.boss && !enemy.bounty && enemy.monsterId === data.dungeons.get(run.dungeonId).bossId)) {
        run.bossDefeated = true;
      }
    }
    if (b.result === 'fled' && run.introRouteVersion === 1 && run.floor === runFloorCount(data, run)
      && !b.enemies.some(enemy => enemy.boss && !enemy.bounty)) {
      // ボスのいない最終戦も勝利が踏破条件。逃走時は同じ階へ戻す。
      run.state = 'ready';
      run.cleared = false;
    } else if (b.result === 'fled' && b.enemies.some((enemy) => enemy.boss && !enemy.bounty)) {
      // ボスを倒さず逃げた場合は、帰還するか同じボスへ再挑戦する。踏破扱いにはしない。
      run.state = run.worldVersion ? 'ready' : 'return_point';
      run.cleared = false;
    } else advance(data, g, run);
    if (run.cleared) delete run.bounty;
  });
  return { result: b.result, growth, loot };
}

/** 次の戦闘へ進める（階の終わり・帰還ポイント・いちばん奥） */
function advance(data, game, run) {
  const row = runFloorRow(data, run);
  run.battleIndex += 1;
  if (run.battleIndex >= row.battles) {
    if (run.floor >= runFloorCount(data, run)) {
      run.state = 'cleared'; run.cleared = true;
      if (run.worldVersion) {
        run.worldClears[run.dungeonId] = (run.worldClears[run.dungeonId] ?? 0) + 1;
        revealWorldExits(data, game, run);
      }
    } else {
      if (!run.worldVersion) resolveExploration(data, game, run, row.floor, calendarOf(data, game.day).season?.id, seededRng, receiveLoot);
      run.floor += 1;
      run.battleIndex = 0;
      run.state = row.returnPointAfter ? 'return_point' : 'ready';
    }
  } else run.state = 'ready';
  if (run.pendingLoot.length) { run.afterLoot = run.state; run.state = 'loot'; }
}

/** 入りきらなかったものを1つ片付ける：drop を捨てて入れる / drop が null ならあきらめる */
export function resolveLoot(data, session, drop) {
  session.updateRun((run, game) => {
    const entry = run.pendingLoot.shift();
    if (drop) swapIntoBackpack(data, game, run.backpack, drop, entry);
    if (!run.pendingLoot.length) { run.state = run.afterLoot ?? 'ready'; delete run.afterLoot; }
  });
}

/** 帰還ポイントで先へ進む */
export function continueRun(session) {
  session.updateRun((run) => { if (run.state === 'return_point') run.state = 'ready'; });
}

/**
 * 町に帰る（帰還ポイント・帰還の羽・いちばん奥）。バックパックの中身は倉庫へ
 * @param useItem 帰還の道具の id（帰還ポイント・クリアのときは null）
 */
export function returnToTown(data, session, useItem = null) {
  const run = session.run;
  if (run.battle) throw new Error('戦闘中は帰還できません');
  if (run.worldVersion && !useItem && !run.worldArrival) throw new Error('町への出口か帰還の道具が必要です');
  if (run.state === 'loot') throw new Error('拾った物を先に整理してください');
  if (useItem && !returnItems(data, session.game).includes(useItem)) throw new Error('帰還の道具を持っていない');
  if (!useItem && !['return_point', 'cleared'].includes(run.state)) throw new Error('ここからは帰れない（帰還ポイントか帰還の道具が必要）');
  session.leaveDungeon((game) => {
    if (useItem) {
      game.items[useItem] -= 1;
      if (game.items[useItem] <= 0) delete game.items[useItem];
    }
    unloadBackpack(game, run.backpack);
    recordStoredMaterials(game);
    commitExploration(game, run.explorationRecords);
    for (const m of game.party) m.room = null; // 宿屋の良い部屋の効果は1回の遠征だけ
    const asked = run.quiz?.asked ?? 0;
    if (asked > 0 && run.earned.xp > 0) game.xpPerQuestion = run.earned.xp / asked; // 鍛錬の経験値の目安（sim と同じ考え方）
    // Completed saves from before bossDefeated was introduced already used the boss route.
    if (run.worldVersion) {
      game.cleared ??= {};
      for (const [id, count] of Object.entries(run.worldClears)) game.cleared[id] = (game.cleared[id] ?? 0) + count;
    }
    if (!run.worldVersion && run.state === 'cleared' && !run.training && (run.introRouteVersion === 1 || run.bossDefeated || (!run.explorationPlan && run.cleared))) {
      game.cleared = game.cleared ?? {};
      game.cleared[run.dungeonId] = (game.cleared[run.dungeonId] ?? 0) + 1;
    }
    // 町に戻るたびに、クエストの掲示板の受けていない枠を入れかえる（docs/checklist.md 8章）
    if (data.quests) refreshBoard(data, game, seededRng(run));
  });
}

/** 帰還の道具（items.csv の effect が return_town） */
export function returnItems(data, game) {
  return Object.keys(game.items ?? {}).filter((id) => data.items.get(id)?.effect === 'return_town' && game.items[id] > 0);
}

/** 戦闘の外で使える道具（回復・気付け・治療） */
export const FIELD_ITEM_EFFECTS = ['heal_hp', 'heal_hp_pct', 'heal_hp_all', 'heal_hp_all_pct', 'heal_mp', 'heal_mp_pct', 'revive_pct', 'cure_status'];

/**
 * 戦闘の外で道具を使う（問題は出ない。強くなる手段ではなく、減ったものを戻すだけ）
 * @returns 画面に出す文
 */
export function useItemOutsideBattle(data, game, itemId, index) {
  const it = data.items.get(itemId);
  if (!it || !FIELD_ITEM_EFFECTS.includes(it.effect)) throw new Error('ここでは使えない');
  if (!game.items[itemId]) throw new Error('持っていない');
  const m = game.party[index];
  const all = it.effect.startsWith('heal_hp_all');
  const targets = all ? game.party.filter((x) => x.hp > 0) : [m];
  if (it.effect === 'revive_pct') {
    if (m.hp > 0) throw new Error('倒れていない');
    m.hp = Math.max(1, Math.round(maxHp(data, m) * it.value / 100));
  } else if (it.effect === 'cure_status') {
    m.persist = (m.persist ?? []).filter((id) => !curedBy(data.statusEffects.get(id), it.name));
    for (const id of Object.keys(m.persistState ?? {})) if (!m.persist.includes(id)) delete m.persistState[id];
  } else {
    if (!all && m.hp <= 0) throw new Error('倒れている');
    for (const t of targets) {
      if (it.effect.startsWith('heal_mp')) {
        const mx = maxMp(data, t);
        t.mp = Math.min(mx, Math.round(t.mp + (it.effect === 'heal_mp' ? it.value : mx * it.value / 100)));
      } else {
        const mx = maxHp(data, t);
        t.hp = Math.min(mx, Math.round(t.hp + (it.effect.endsWith('_pct') ? mx * it.value / 100 : it.value)));
      }
    }
  }
  game.items[itemId] -= 1;
  if (game.items[itemId] <= 0) delete game.items[itemId];
  return `${it.name}を使った`;
}

