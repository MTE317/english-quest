import { loadGameData } from '../gamedata.js?v=features-2';
import { loadCsv, loadJson, loadOptional } from '../data.js?v=features-2';
import { splitList } from '../csv.js';
import { buildLexicon } from '../lexicon.js';
import { Scheduler } from '../srs.js?v=features-2';
import { LearningStore, now } from '../storage.js?v=features-2';
import { GameSession } from '../save.js?v=features-2';
import { normalizeGame } from '../game-state.js?v=features-2';
import { createBattle, makeEnemy, finishBattle } from '../battle.js?v=features-2';
import { currentRank, useItemOutsideBattle, FIELD_ITEM_EFFECTS } from '../dungeon.js?v=features-2';
import { nextRankStatus, checkRankUp } from '../town.js?v=features-2';
import { updateRuneModifiers } from '../temple.js?v=features-2';
import { makeGear } from '../character.js?v=features-2';
import { examWords, starLearnedRatio } from '../study.js?v=features-2';
import { createBattleView } from '../ui/battle-view.js?v=question-speech-1';
import { runQuiz } from '../ui/quiz-runner.js?v=question-speech-1';
import { el, render } from '../dom.js';

const view = document.getElementById('view');
const session = new GameSession();
const store = new LearningStore();
let data; let lex; let scheduler; let config; let tiers; let matches; let shop;
let message;
const button = (label, fn, disabled) => el('button', { disabled, onclick: () => {
  try { fn(); } catch (error) { message = error.message; draw(); }
} }, label);

function shuffled(values) {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i--) {
    const index = Math.floor(Math.random() * (i + 1));
    [out[i], out[index]] = [out[index], out[i]];
  }
  return out;
}

function start(kind, label, battles, pool, extra = {}) {
  if (!pool.length) throw new Error('まずルーンストーンを読み解いてください。');
  if (!battles.length || battles.some((row) => !row.length || row.some((e) => !data.monsters.has(e.id) || !Number.isFinite(e.lv)))) throw new Error('対戦相手のデータを確認してください。');
  if (session.game.party.every((member) => member.hp <= 0)) throw new Error('先にパーティを回復してください。');
  const stoneId = lex.wordsById.get(pool[0]).stoneId;
  session.enterDungeon({ challenge: kind, label, battles, questionPool: shuffled(pool), stoneId, ...extra });
  draw();
}

function rankCanAttemptFinal() {
  const st = nextRankStatus(data, session.game);
  return st?.next.id === 'S' && st.examOnly && starLearnedRatio(lex, store, scheduler, 12).ratio >= 0.8;
}

function finalExam() {
  if (!rankCanAttemptFinal()) throw new Error('Sランクの昇格条件を確認してください。');
  const dungeon = [...data.dungeons.values()].filter((d) => d.rank === 12).sort((a, b) => b.enemyMul - a.enemyMul)[0];
  if (!dungeon) throw new Error('ボスのデータがありません。');
  const floor = data.dungeonFloors.find((r) => r.dungeonId === dungeon.id && r.lastBattleIsBoss);
  if (!floor) throw new Error('ボスの階層データがありません。');
  start('final', 'Sランク最終試験', [[{ id: dungeon.bossId, lv: floor.enemyLevel, boss: true }]], lex.words.map((w) => w.id));
}

function arena(tier, direction, timed) {
  const rows = matches.filter((r) => r.tier_id === tier.id).sort((a, b) => Number(a.battle) - Number(b.battle));
  if (rows.length !== config.battles_per_tier) throw new Error('5戦分の対戦相手が設定されていません。');
  const battles = rows.map((r) => splitList(r.enemies).map((token) => {
    const [id, lvl] = token.split(':');
    return { id, lv: Number(lvl), boss: data.monsters.get(id)?.isBoss ?? false };
  }));
  const awakened = lex.stones.filter((s) => store.awakened[s.id]);
  const books = awakened.length ? awakened : lex.stones.filter((s) => lex.wordsByStone.get(s.id)?.some((w) => store.isRead(w.id)));
  const ids = new Set(books.map((s) => s.id));
  start('arena', tier.name, battles, lex.words.filter((w) => ids.has(w.stoneId)).map((w) => w.id),
    { arenaTier: tier.id, direction, timeLimit: timed ? 10 : 0, arenaReward: {
      medalsFirst: Math.max(0, Number(tier.first_medals) || 0), medalsRepeat: Math.max(0, Number(tier.repeat_medals) || 0),
      title: tier.title, gear: tier.gear_id, timedTitle: tier.timed_title, directionTitle: tier.direction_title,
    } });
}

function startBattle() {
  const run = session.run;
  const enemies = run.battles[run.battlesDone].map((e) => makeEnemy(data, e.id, { lv: e.lv, boss: e.boss }));
  session.setBattle(createBattle(data, session.game, { enemies, canFlee: false }));
  draw();
}

function addTitle(game, title) {
  if (title && !game.titles.includes(title)) game.titles.push(title);
}

function completeArena() {
  const { arenaTier, arenaReward, timeLimit, direction, timedOut } = session.run;
  session.leaveDungeon((game) => {
    game.arenaClears ??= {};
    const first = !game.arenaClears[arenaTier];
    game.arenaClears[arenaTier] = (game.arenaClears[arenaTier] ?? 0) + 1;
    game.medals = (game.medals ?? 0) + (first ? arenaReward.medalsFirst : arenaReward.medalsRepeat);
    if (first && data.equipment.has(arenaReward.gear)) {
      const def = data.equipment.get(arenaReward.gear);
      game.storage.gear.push(makeGear(game, def.id, { rarity: 'unique', affixes: { ...def.fixedEffects } }));
    }
    addTitle(game, arenaReward.title);
    if (timeLimit && !timedOut) addTitle(game, arenaReward.timedTitle);
    if (direction === 'ja2en') addTitle(game, arenaReward.directionTitle);
  });
  message = '闘技場の勝ち抜き達成！';
  draw();
}

function endBattle(result) {
  if (result !== 'win') {
    const final = session.run.challenge === 'final';
    session.wipe();
    if (final) {
      const spec = data.exams.find((e) => e.id === 'final');
      session.update((game) => { game.finalRetryDay = scheduler.dayOf(now()) + spec.retryAfterDays; });
    }
    message = '敗退。挑戦前の状態に戻りました。';
    draw();
    return;
  }
  session.endBattle((game, run) => { finishBattle(data, game, run.battle); });
  if (session.run.challenge === 'arena' && session.run.battlesDone >= session.run.battles.length) {
    completeArena();
    return;
  }
  draw();
}

function finalReview() {
  const spec = data.exams.find((e) => e.id === 'final');
  const words = examWords(lex.words, spec.questions, Math.random);
  let index = 0;
  runQuiz({ view, lex, store, scheduler, total: words.length, title: '全範囲の総復習',
    next: () => ({ word: words[index++] }),
    onDone: (correct, total) => {
      const passed = total > 0 && correct >= Math.ceil(spec.passRate * total - 1e-9);
      session.wipe();
      session.update((game) => {
        if (passed) {
          game.examsPassed.push('S');
          checkRankUp(data, game);
          addTitle(game, '伝説');
        } else game.finalRetryDay = scheduler.dayOf(now()) + spec.retryAfterDays;
      });
      message = `${passed ? '最終試験合格！ Sランクに到達しました。' : '最終試験は不合格でした。'}（${correct} / ${total}問正解）`;
      draw();
    } });
}

function showItems() {
  const game = session.game;
  const items = Object.entries(game.items).filter(([id, count]) => count > 0 && FIELD_ITEM_EFFECTS.includes(data.items.get(id)?.effect));
  render(view, el('h2', {}, '道具を使う'),
    items.map(([id, count]) => el('div', { class: 'panel small' }, `${data.items.get(id).name} ×${count}`,
      game.party.map((member, index) => button(`${member.name}に使う（HP ${member.hp} / MP ${member.mp}）`, () => {
        session.update((g) => useItemOutsideBattle(data, g, id, index));
        showItems();
      })))),
    items.length ? null : el('p', {}, '使える道具を持っていません。'),
    button('戻る', draw));
}

function draw() {
  const game = session.game;
  const run = session.run;
  if (!game?.party || (run && !run.challenge)) {
    render(view, el('p', {}, game?.party ? '町に戻ってから挑戦できます。' : '先にパーティを作ってください。'),
      el('a', { href: game?.party ? 'dungeon.html' : 'party.html', class: 'btn' }, game?.party ? 'ダンジョンへ' : 'パーティを作る'));
    return;
  }
  if (run?.battle) { createBattleView({ view, data, lex, store, scheduler, session, onEnd: endBattle }).start(); return; }
  const banner = message ? el('p', { role: 'status' }, message) : null;
  if (run) {
    if (run.challenge === 'arena' && run.battlesDone >= run.battles.length) { completeArena(); return; }
    const action = run.challenge === 'final' && run.battlesDone ? button('総復習をはじめる', finalReview)
      : button(`第${run.battlesDone + 1}戦へ`, startBattle);
    render(view, banner, el('h2', {}, run.label), action,
      run.battlesDone ? button('道具を使う', showItems) : null,
      button('挑戦を中止', () => { session.wipe(); message = '挑戦を中止しました。'; draw(); }));
    return;
  }
  const mode = el('select', { class: 'select', 'aria-label': '挑戦条件' },
    el('option', { value: '' }, '通常'), el('option', { value: 'ja2en' }, '日→英だけ'), el('option', { value: 'timed' }, '1問10秒'));
  const retry = (game.finalRetryDay ?? 0) > scheduler.dayOf(now());
  render(view, banner,
    el('h2', {}, 'Sランク最終試験'),
    button(retry ? '次の日に再挑戦' : '最終試験に挑む', finalExam, retry || !rankCanAttemptFinal()),
    !rankCanAttemptFinal() && game.rank !== 'S' ? el('p', { class: 'muted small' }, '★12のルーンを80%習得し、Sランクに必要なギルドポイントと踏破条件を満たすと挑めます。') : null,
    el('h2', {}, '闘技場'),
    tiers.length ? [mode, tiers.map((tier) => {
      const required = Number(tier.rank);
      const locked = required > config.tiers - 1 ? game.rank !== 'S' : currentRank(data, game).maxDungeonRank < required;
      return button(tier.name, () => arena(tier, mode.value === 'ja2en' ? 'ja2en' : null, mode.value === 'timed'), locked);
    })] : el('p', { class: 'muted' }, '対戦データが登録された階級から遊べます。'),
    el('h2', {}, `メダル交換（所持 ${game.medals ?? 0}枚）`),
    shop.filter((row) => data.equipment.has(row.gear_id)).map((row) => button(`${data.equipment.get(row.gear_id).name}（${row.medals}枚）`, () => {
      session.update((g) => {
        const cost = Number(row.medals);
        if (!Number.isSafeInteger(cost) || cost <= 0 || (g.medals ?? 0) < cost) throw new Error('交換に必要なメダルが足りません。');
        const def = data.equipment.get(row.gear_id);
        g.medals -= cost;
        g.storage.gear.push(makeGear(g, def.id, { rarity: 'unique', affixes: { ...def.fixedEffects } }));
      });
      message = 'メダルを交換しました。';
      draw();
    })));
}

(async () => {
  const [gd, stones, words, srs, arenaFile, t, m, s] = await Promise.all([
    loadGameData(), loadCsv('rune_stones.csv'), loadCsv('lexicon.csv'), loadJson('srs.json'), loadJson('arena.json'),
    loadOptional('arena_tiers.csv'), loadOptional('arena_battles.csv'), loadOptional('arena_shop.csv'),
  ]);
  data = gd; lex = buildLexicon(stones.rows, words.rows); scheduler = new Scheduler(srs.data); config = arenaFile.data;
  tiers = t?.rows ?? []; matches = m?.rows ?? []; shop = s?.rows ?? [];
  if (session.game && !session.readOnly) {
    normalizeGame(data, session.game);
    updateRuneModifiers(data, session.game, lex, store, scheduler, scheduler.dayOf(now()));
  }
  draw();
})().catch((error) => render(view, el('p', { class: 'error' }, error.message)));
