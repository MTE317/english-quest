// ダンジョンの遠征：行き先とルーンストーンを選ぶ・階層・帰還ポイント・ドロップ・バックパック・全滅で入る前に戻る。
// 進み具合は session.run に入れる（1戦ごとに保存。全滅したら session.wipe() で入る前に戻る）。
//
// run.state
//   'ready'        … 次の戦闘の前
//   'loot'         … 拾ったものがバックパックに入りきらない（入れ替えるかあきらめるかを選ぶ）
//   'return_point' … 帰還ポイント（帰るか先へ進むかを選ぶ）
//   'cleared'      … いちばん奥のボスを倒した（町に帰るだけ）
import { createBattle, finishBattle, battleRewards } from './battle.js?v=balance-builds-1';
import { makeEncounter, floorRow, planBounty } from './encounter.js?v=balance-builds-1';
import { rollBattleLoot, addToBackpack, swapIntoBackpack, unloadBackpack } from './loot.js?v=balance-builds-1';
import { gainXp, maxHp, maxMp, affixSum } from './character.js?v=balance-builds-1';
import { curedBy } from './battle.js?v=balance-builds-1';
import { advanceDays, calendarOf, countKills, refreshBoard } from './town.js?v=balance-builds-1';
import { updateChains } from './quest-chain.js?v=features-2';
import { discoverJobs } from './temple.js?v=balance-builds-1';
import { memberMods } from './growth.js?v=balance-builds-1';

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

/** 今の冒険者ランクで行けるダンジョン */
export function allowedDungeons(data, game) {
  const max = currentRank(data, game).maxDungeonRank;
  return [...data.dungeons.values()].filter((d) => d.rank <= max).sort((a, b) => a.rank - b.rank);
}

/**
 * 持っていけるルーンストーン：石の★がダンジョンの★以上（srs.json の stone_star_must_be_gte_dungeon_star）
 */
export function allowedStones(srs, lex, dungeon) {
  if (srs.stone_star_must_be_gte_dungeon_star === false) return lex.stones;
  return lex.stones.filter((s) => s.star >= dungeon.rank);
}

/**
 * 遠征を始める：入る前の状態を写してから、日数を使う
 * @param quizState QuestionPicker の toState()（出題の状態）
 */
export function startRun(data, session, { dungeonId, stoneId, quizState, seed }) {
  const dg = data.dungeons.get(dungeonId);
  if (!dg) throw new Error(`ダンジョン ${dungeonId} がない`);
  if (!allowedDungeons(data, session.game).includes(dg)) throw new Error('今のランクでは入れない');
  session.enterDungeon({ dungeonId, stoneId });
  session.updateRun((run, game) => {
    run.layoutVersion = data.balance.dungeon?.layout_version ?? 2;
    run.route = data.dungeonFloors.filter((row) => row.dungeonId === dungeonId)
      .sort((a, b) => a.floor - b.floor).map((row) => ({ ...row }));
    run.battleIndex = 0;
    run.elitesSeen = 0;
    run.state = 'ready';
    run.backpack = { gear: [], materials: {} };
    run.earned = { gold: 0, xp: 0 };
    run.pendingLoot = [];
    run.quiz = quizState;
    run.rng = seed >>> 0;
    run.notices = advanceDays(data, game, dg.days);
    run.bounty = planBounty(data, game, dungeonId, seededRng(run));
  });
}

/** 遠征の開始時に経路を固定する。更新前のセーブは当時の経路で最後まで進める。 */
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
  } else {
    run.route = data.dungeonFloors.filter((row) => row.dungeonId === run.dungeonId)
      .sort((a, b) => a.floor - b.floor).map((row) => ({ ...row }));
    run.layoutVersion ??= data.balance.dungeon?.layout_version ?? 2;
  }
  return run.route;
}

export function runFloorCount(data, run) { return runRoute(data, run).length; }

export function runFloorRow(data, run) {
  return runRoute(data, run).find((row) => row.floor === run.floor) ?? floorRow(data, run.dungeonId, run.floor);
}

export function isBossBattle(data, run) {
  const row = runFloorRow(data, run);
  return row.lastBattleIsBoss && run.battleIndex === row.battles - 1;
}

/** 次の戦闘を始める（敵を決めて保存） */
export function startNextBattle(data, session) {
  const run = session.run;
  if (run.state !== 'ready') throw new Error('今は戦闘を始められない');
  const rng = seededRng(run);
  const bounty = run.bounty?.floor === run.floor && run.bounty?.battle === run.battleIndex ? run.bounty.monsterId : null;
  const season = calendarOf(data, session.game.day).season?.id;
  const maxElites = Math.max(0, (data.balance.dungeon?.elite_max_per_run ?? Infinity) - (run.elitesSeen ?? 0));
  const enemies = makeEncounter(data, run.dungeonId, run.floor, rng, {
    boss: isBossBattle(data, run), season, bountyId: bounty, elites: true, maxElites,
    quests: session.game.quests ?? [], rowOverride: runFloorRow(data, run),
  });
  run.elitesSeen = (run.elitesSeen ?? 0) + enemies.filter((enemy) => enemy.eliteId).length;
  session.setBattle(createBattle(data, session.game, { enemies, seed: Math.floor(rng() * 4294967296), firstBattle: run.battlesDone === 0 }));
}

/**
 * 戦闘が終わったあと（勝った・逃げた）。全滅なら入る前に戻す。
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

export function afterBattle(data, session) {
  const b = session.run.battle;
  const game = session.game;
  finishBattle(data, game, b);
  if (b.result === 'lose') {
    session.wipe();
    return { result: 'lose', growth: [], loot: null };
  }
  const growth = [];
  let loot = null;
  session.endBattle((g, run) => {
    if (b.result === 'win') {
      countKills(g, b.enemies, run.dungeonId);
      updateChains(data, g, run.dungeonId, run.floor, b.enemies);
      const r = battleRewards(data, g, b);
      const practice = b.learningRewards;
      if (practice?.answers) {
        const scale = practice.total / practice.answers;
        r.xp = r.xp.map((value) => Math.round(value * scale));
      }
      g.party.forEach((m, i) => {
        const xp = r.xp[i];
        const ap = r.ap[i];
        const levels = gainXp(data, m, xp);
        m.ap[m.job] = (m.ap[m.job] ?? 0) + ap;
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
      loot.gold = Math.round(loot.gold * (1 + goldBonus));
      if (b.enemies.some((e) => e.boss && !e.bounty)) discoverJobs(data, g, run.dungeonId, seededRng(run));
      g.gold += loot.gold;
      run.earned.gold += loot.gold;
      const left = addToBackpack(data, g, run.backpack, [
        ...loot.gear.map((gear) => ({ type: 'gear', gear })),
        ...loot.materials.map((m) => ({ type: 'material', id: m.id, count: m.count })),
      ]);
      g.catalog ??= { gear: [], monsters: [] };
      g.catalog.gear = [...new Set([...g.catalog.gear, ...loot.gear.map((item) => item.id)])];
      run.pendingLoot = left;
    }
    if (b.result === 'fled' && b.enemies.some((enemy) => enemy.boss && !enemy.bounty)) {
      // ボスを倒さず逃げた場合は、帰還するか同じボスへ再挑戦する。踏破扱いにはしない。
      run.state = 'return_point';
      run.cleared = false;
    } else advance(data, run);
    if (run.cleared) delete run.bounty;
  });
  return { result: b.result, growth, loot };
}

/** 次の戦闘へ進める（階の終わり・帰還ポイント・いちばん奥） */
function advance(data, run) {
  const row = runFloorRow(data, run);
  run.battleIndex += 1;
  if (run.battleIndex >= row.battles) {
    if (run.floor >= runFloorCount(data, run)) { run.state = 'cleared'; run.cleared = true; } else {
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
  if (!useItem && !['return_point', 'cleared'].includes(run.state)) throw new Error('ここからは帰れない（帰還ポイントか帰還の道具が必要）');
  session.leaveDungeon((game) => {
    if (useItem) {
      game.items[useItem] -= 1;
      if (game.items[useItem] <= 0) delete game.items[useItem];
    }
    unloadBackpack(game, run.backpack);
    for (const m of game.party) m.room = null; // 宿屋の良い部屋の効果は1回の遠征だけ
    const asked = run.quiz?.asked ?? 0;
    if (asked > 0 && run.earned.xp > 0) game.xpPerQuestion = run.earned.xp / asked; // 鍛錬の経験値の目安（sim と同じ考え方）
    if (run.cleared) {
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
