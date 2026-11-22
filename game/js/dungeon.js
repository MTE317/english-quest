// ダンジョンの遠征：行き先とルーンストーンを選ぶ・階層・帰還ポイント・ドロップ・バックパック・全滅で入る前に戻る。
// 進み具合は session.run に入れる（1戦ごとに保存。全滅したら session.wipe() で入る前に戻る）。
//
// run.state
//   'ready'        … 次の戦闘の前
//   'loot'         … 拾ったものがバックパックに入りきらない（入れ替えるかあきらめるかを選ぶ）
//   'return_point' … 帰還ポイント（帰るか先へ進むかを選ぶ）
//   'cleared'      … いちばん奥のボスを倒した（町に帰るだけ）
import { createBattle, finishBattle, battleRewards } from './battle.js';
import { makeEncounter, floorRow } from './encounter.js';
import { rollBattleLoot, addToBackpack, swapIntoBackpack, unloadBackpack } from './loot.js';
import { gainXp, maxHp, maxMp } from './character.js';
import { curedBy } from './battle.js';
import { advanceDays, countKills } from './town.js';
import { memberMods } from './growth.js';

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
    run.battleIndex = 0;
    run.state = 'ready';
    run.backpack = { gear: [], materials: {} };
    run.earned = { gold: 0, xp: 0 };
    run.pendingLoot = [];
    run.quiz = quizState;
    run.rng = seed >>> 0;
    run.notices = advanceDays(data, game, dg.days);
  });
}

export function runFloorRow(data, run) {
  return floorRow(data, run.dungeonId, run.floor);
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
  const enemies = makeEncounter(data, run.dungeonId, run.floor, rng, { boss: isBossBattle(data, run) });
  session.setBattle(createBattle(data, session.game, { enemies, seed: Math.floor(rng() * 4294967296), firstBattle: run.battlesDone === 0 }));
}

/**
 * 戦闘が終わったあと（勝った・逃げた）。全滅なら入る前に戻す。
 * @returns { result, lines: 画面に出す文, loot }
 */
export function afterBattle(data, session) {
  const b = session.run.battle;
  const game = session.game;
  finishBattle(data, game, b);
  if (b.result === 'lose') {
    session.wipe();
    return { result: 'lose', lines: [] };
  }
  const lines = [];
  let loot = null;
  session.endBattle((g, run) => {
    if (b.result === 'win') {
      countKills(g, b.enemies);
      const r = battleRewards(data, g, b);
      g.party.forEach((m, i) => {
        const ups = gainXp(data, m, r.xp[i]);
        m.ap[m.job] = (m.ap[m.job] ?? 0) + r.ap[i];
        run.earned.xp += r.xp[i];
        lines.push(`${m.name}：経験値 +${r.xp[i]}・AP +${r.ap[i]}${ups ? `　レベルが${m.lv}に上がった！` : ''}`);
      });
      // 共通ツリー「魔力の余韻」：戦闘が終わったら MP が回復
      for (const m of g.party) {
        const regen = memberMods(data, m).mp_regen ?? 0;
        if (regen && m.hp > 0) m.mp = Math.min(maxMp(data, m), Math.round(m.mp + maxMp(data, m) * regen));
      }
      const dropBonus = Math.max(0, ...g.party.filter((m) => m.hp > 0).map((m) => memberMods(data, m).drop ?? 0));
      loot = rollBattleLoot(data, g, run.dungeonId, run.floor, b.enemies, seededRng(run), { dropBonus });
      g.gold += loot.gold;
      run.earned.gold += loot.gold;
      lines.push(`お金 +${loot.gold}`);
      for (const m of loot.materials) lines.push(`${data.materials.get(m.id).name} ×${m.count}`);
      for (const x of loot.gear) lines.push(`${data.equipment.get(x.id).name}を拾った`);
      const left = addToBackpack(data, g, run.backpack, [
        ...loot.gear.map((gear) => ({ type: 'gear', gear })),
        ...loot.materials.map((m) => ({ type: 'material', id: m.id, count: m.count })),
      ]);
      run.pendingLoot = left;
      if (left.length) lines.push('バックパックがいっぱい！');
    }
    advance(data, run);
  });
  return { result: b.result, lines, loot };
}

/** 次の戦闘へ進める（階の終わり・帰還ポイント・いちばん奥） */
function advance(data, run) {
  const row = runFloorRow(data, run);
  run.battleIndex += 1;
  if (run.battleIndex >= row.battles) {
    const dg = data.dungeons.get(run.dungeonId);
    if (run.floor >= dg.floors) { run.state = 'cleared'; run.cleared = true; } else {
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
