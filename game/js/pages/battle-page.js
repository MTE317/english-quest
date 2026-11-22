// 戦闘の画面（動作確認用）。ダンジョンと階を選んで1回戦う。
// 行動を選ぶ → 4択の問題 → 正解なら全力・不正解なら弱い行動。1行動ごとに保存する。
import { loadGameData } from '../gamedata.js';
import { loadCsv, loadJson } from '../data.js';
import { buildLexicon } from '../lexicon.js';
import { Scheduler } from '../srs.js';
import { LearningStore, now } from '../storage.js';
import { QuestionPicker, REASON_LABEL } from '../picker.js';
import { makeQuestion, DIRECTION } from '../quiz.js';
import { speak, canSpeak } from '../speech.js';
import { GameSession } from '../save.js';
import {
  createBattle, nextTurn, actionOptions, setPending, resolvePending, finishBattle, battleRewards, targetKind, battleStats, canAct,
} from '../battle.js';
import { makeEncounter, floorRow } from '../encounter.js';
import { gainXp, maxHp, maxMp } from '../character.js';
import { el, render, stars } from '../dom.js';

const view = document.getElementById('view');
const session = new GameSession();
session.installAutoSave(window);
let data; let lex; let scheduler; let store; let picker;

const iconOf = (id) => data.icons.find((i) => i.id === id)?.icon ?? '❔';
const statusNames = (statuses) => Object.keys(statuses).map((id) => data.statusEffects.get(id)?.name ?? id);

// ---------------- 準備 ----------------
function showSetup() {
  if (!session.hasSave || !session.game?.party) {
    render(view, el('p', {}, 'まだパーティがいません。'), el('a', { class: 'btn primary', href: 'party.html' }, 'パーティを作る'));
    return;
  }
  const run = session.run;
  const dungeons = [...data.dungeons.values()].filter((d) => d.rank <= 2);
  const st = {
    dungeonId: run && data.dungeons.has(run.dungeonId) ? run.dungeonId : dungeons[0].id,
    floor: run?.floor ?? 1,
    stoneId: run?.stoneId ?? lex.stones[0].id,
    boss: false,
  };
  const floorSel = el('select', { class: 'select', onchange: (e) => { st.floor = Number(e.target.value); } });
  const fillFloors = () => {
    const dg = data.dungeons.get(st.dungeonId);
    st.floor = Math.min(st.floor, dg.floors);
    render(floorSel, Array.from({ length: dg.floors }, (_, k) => {
      const r = floorRow(data, st.dungeonId, k + 1);
      return el('option', { value: k + 1, selected: k + 1 === st.floor }, `${k + 1}階（敵Lv${r.enemyLevel}・${r.enemiesPerBattle}体${r.lastBattleIsBoss ? '・ボスがいる階' : ''}）`);
    }));
  };
  fillFloors();
  const inRun = !!run;
  const g = session.game;
  render(view,
    el('div', { class: 'panel small' },
      g.party.map((m) => el('div', {}, `${iconOf(m.icon)} ${m.name} Lv${m.lv}　HP ${m.hp}/${maxHp(data, m)}　MP ${m.mp}/${maxMp(data, m)}${m.persist?.length ? `　${statusNames(Object.fromEntries(m.persist.map((x) => [x, 1]))).join('・')}` : ''}`))),
    inRun ? el('div', { class: 'panel small' }, `ダンジョンの中（${data.dungeons.get(run.dungeonId)?.name ?? run.dungeonId}・戦闘 ${run.battlesDone}回）`) : null,
    el('label', { class: 'small' }, 'ダンジョン（★1〜★2）',
      el('select', { class: 'select', disabled: inRun, onchange: (e) => { st.dungeonId = e.target.value; fillFloors(); } },
        dungeons.map((d) => el('option', { value: d.id, selected: d.id === st.dungeonId }, `${stars(d.rank)} ${d.name}（${d.kind}）`)))),
    el('label', { class: 'small' }, '階', floorSel),
    el('label', { class: 'small', style: 'display:flex;gap:8px;align-items:center;min-height:44px' },
      el('input', { type: 'checkbox', onchange: (e) => { st.boss = e.target.checked; } }), 'ボスと戦う'),
    el('label', { class: 'small' }, '持っていくルーンストーン',
      el('select', { class: 'select', disabled: inRun, onchange: (e) => { st.stoneId = e.target.value; } },
        lex.stones.map((s) => el('option', { value: s.id, selected: s.id === st.stoneId }, `${stars(s.star)} ${s.name}`)))),
    el('button', { class: 'primary', onclick: () => startBattle(st) }, '戦闘をはじめる'),
    inRun ? el('button', { onclick: () => { session.leaveDungeon(); showSetup(); } }, '町に帰る') : null,
    el('details', { class: 'panel' },
      el('summary', {}, '動作確認用'),
      el('p', { class: 'muted small' }, '本番のゲームにはないボタンです。'),
      el('button', {
        onclick: () => {
          session.update((game) => {
            for (const id of ['potion', 'ether', 'revive_salts', 'antidote', 'panacea', 'buff_str_1', 'sres_all_1']) if (data.items.has(id)) game.items[id] = 3;
          });
          showSetup();
        },
      }, '道具を3つずつ持つ'),
      el('button', {
        onclick: () => {
          session.update((game) => { for (const m of game.party) { m.hp = maxHp(data, m); m.mp = maxMp(data, m); } });
          showSetup();
        },
      }, '全員を全回復（宿屋のかわり）'),
    ),
  );
}

function startBattle(st) {
  if (!session.inDungeon) {
    session.enterDungeon({ dungeonId: st.dungeonId, stoneId: st.stoneId });
    const p = new QuestionPicker({ lex, store, scheduler, stoneId: st.stoneId, nowMs: now() });
    session.updateRun((run) => { run.quiz = p.toState(); });
  }
  session.updateRun((run) => { run.floor = st.floor; });
  const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  let r = seed;
  const rng = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296; };
  const enemies = makeEncounter(data, session.run.dungeonId, st.floor, rng, { boss: st.boss });
  session.setBattle(createBattle(data, session.game, { enemies, seed }));
  loop();
}

// ---------------- 戦闘 ----------------
const battle = () => session.run?.battle;

function loadPicker() {
  const run = session.run;
  picker = new QuestionPicker({ lex, store, scheduler, stoneId: run.quiz?.stoneId ?? run.stoneId ?? lex.stones[0].id, nowMs: now(), state: run.quiz ?? null });
}

/** 次の味方の番まで進めて保存し、画面を出す */
function loop() {
  const b = battle();
  if (!picker) loadPicker();
  if (!b.pending && !b.turn && !b.result) nextTurn(data, session.game, b);
  session.save();
  if (b.result) return showEnd();
  if (b.pending) return showQuestion();
  return showCommand();
}

function meter(cur, max, cls) {
  return el('div', { class: `meter ${cls}` }, el('span', { style: `width:${Math.max(0, Math.min(100, (cur / max) * 100))}%` }));
}

function header(activeIndex = null) {
  const b = battle();
  const g = session.game;
  return [
    el('div', { class: 'muted small' }, `${b.round}ターン目`),
    el('div', { class: 'enemy-row' },
      b.enemies.map((e) => el('div', { class: `enemy ${e.hp <= 0 ? 'down' : ''}` },
        el('div', { class: 'enemy-icon' }, e.icon),
        el('div', { class: 'small' }, e.name, e.boss ? ' 👑' : '', e.eliteId ? ' ⚠' : ''),
        meter(e.hp, e.maxHp, 'hp'),
        el('div', { class: 'tiny' }, statusNames(e.statuses).join('・'))))),
    el('div', { class: 'party-row' },
      g.party.map((m, i) => el('div', { class: `ally ${i === activeIndex ? 'active' : ''} ${m.hp <= 0 ? 'down' : ''}` },
        el('div', { class: 'small' }, `${iconOf(m.icon)} ${m.name}`),
        el('div', { class: 'tiny' }, `HP ${m.hp}/${maxHp(data, m)}`), meter(m.hp, maxHp(data, m), 'hp'),
        el('div', { class: 'tiny' }, `MP ${m.mp}/${maxMp(data, m)}`), meter(m.mp, maxMp(data, m), 'mp'),
        el('div', { class: 'tiny error' }, statusNames(b.allies[i].statuses).join('・'))))),
  ];
}

/** 問題のときの小さな見出し（答えのボタンが画面に収まるように） */
function compactHeader(activeIndex) {
  const b = battle();
  const g = session.game;
  const m = g.party[activeIndex];
  return el('div', { class: 'compact-head small' },
    el('div', {}, b.enemies.filter((e) => e.hp > 0).map((e) => `${e.icon}${Math.ceil((e.hp / e.maxHp) * 100)}%`).join('　')),
    el('div', { class: 'muted' }, `${iconOf(m.icon)} ${m.name}　HP ${m.hp}/${maxHp(data, m)}　MP ${m.mp}`));
}

function logBox(lines = 4) {
  const b = battle();
  return el('div', { class: 'battle-log' }, b.log.slice(-lines).map((l) => el('div', {}, l)));
}

function showCommand(sub = null) {
  const b = battle();
  const g = session.game;
  const i = b.turn.i;
  const m = g.party[i];
  const opts = actionOptions(data, g, b, i);
  const choose = (action) => chooseTarget(action);
  let panel;
  if (sub === 'skill') {
    panel = [
      el('div', { class: 'muted small' }, `スキル（MP ${m.mp}）`),
      opts.skills.length ? null : el('p', { class: 'muted' }, '使えるスキルがない'),
      opts.skills.map(({ skill, reason }) => el('button', { disabled: !!reason, onclick: () => choose({ type: 'skill', skillId: skill.id }) },
        el('div', {}, `${skill.name}（MP${skill.mp}）`), reason ? el('div', { class: 'tiny error' }, reason) : null)),
      el('button', { class: 'ghost', onclick: () => showCommand() }, 'もどる'),
    ];
  } else if (sub === 'item') {
    panel = [
      opts.items.length ? null : el('p', { class: 'muted' }, '道具を持っていない'),
      opts.items.map(({ item, count, reason }) => el('button', { disabled: !!reason, onclick: () => choose({ type: 'item', itemId: item.id }) },
        el('div', {}, `${item.name} ×${count}`), el('div', { class: 'tiny muted' }, reason || item.description))),
      el('button', { class: 'ghost', onclick: () => showCommand() }, 'もどる'),
    ];
  } else {
    panel = [
      el('div', { class: 'row' },
        el('button', { class: 'primary', onclick: () => choose({ type: 'attack' }) }, '攻撃'),
        el('button', { onclick: () => showCommand('skill') }, 'スキル')),
      el('div', { class: 'row' },
        el('button', { onclick: () => showCommand('item') }, '道具'),
        el('button', { disabled: !!opts.flee.reason, onclick: () => choose({ type: 'flee' }) },
          '逃げる', el('div', { class: 'tiny' }, opts.flee.reason || `${Math.round(opts.flee.rate * 100)}%`))),
    ];
  }
  render(view, header(i), logBox(), el('div', { class: 'panel' }, el('div', { class: 'choice-title' }, `${m.name}の番`), panel));
}

function chooseTarget(action) {
  const b = battle();
  const g = session.game;
  const kind = targetKind(data, action);
  const list = {
    enemy: b.enemies.map((e, k) => [k, e]).filter(([, e]) => e.hp > 0).map(([k, e]) => [k, `${e.icon} ${e.name}`]),
    ally: g.party.map((m, k) => [k, m]).filter(([k, m]) => m.hp > 0 && canAct(g, b, k)).map(([k, m]) => [k, `${iconOf(m.icon)} ${m.name}（HP ${m.hp}/${maxHp(data, m)}）`]),
    ko_ally: g.party.map((m, k) => [k, m]).filter(([, m]) => m.hp <= 0).map(([k, m]) => [k, `${iconOf(m.icon)} ${m.name}（倒れている）`]),
  }[kind];
  if (!list) return ask({ ...action, target: null });
  if (list.length === 0) { render(view, header(b.turn.i), el('p', { class: 'muted' }, '対象がいない'), el('button', { onclick: () => showCommand() }, 'もどる')); return; }
  if (list.length === 1 && kind === 'enemy') return ask({ ...action, target: list[0][0] });
  render(view, header(b.turn.i), logBox(2),
    el('div', { class: 'panel' }, el('div', { class: 'muted small' }, 'だれに？'),
      list.map(([k, label]) => el('button', { onclick: () => ask({ ...action, target: k }) }, label)),
      el('button', { class: 'ghost', onclick: () => showCommand() }, 'もどる')));
}

/** 問題を作って行動と一緒に保存する */
function ask(action) {
  const b = battle();
  const next = picker.next();
  const dir = Math.random() < 0.5 ? DIRECTION.EN_JA : DIRECTION.JA_EN;
  const q = makeQuestion(next.word, lex, { direction: dir, familiar: scheduler.isFamiliar(store.get(next.word.id)) });
  setPending(b, action, {
    wordId: next.word.id, reason: next.reason, direction: q.direction, prompt: q.prompt, choices: q.choices, answerIndex: q.answerIndex,
  });
  session.run.quiz = picker.toState();
  session.save();
  showQuestion();
}

function actionLabel(action) {
  if (action.type === 'attack') return '攻撃';
  if (action.type === 'flee') return '逃げる';
  if (action.type === 'skill') return data.skills.get(action.skillId).name;
  return data.items.get(action.itemId).name;
}

function showQuestion() {
  const b = battle();
  const p = b.pending;
  const q = p.question;
  const word = lex.wordsById.get(q.wordId);
  const isEn = q.direction === DIRECTION.EN_JA;
  const m = session.game.party[p.actor];
  let answered = false;
  const after = el('div');
  const buttons = q.choices.map((c, k) => el('button', {
    onclick: () => {
      if (answered) return;
      answered = true;
      const correct = k === q.answerIndex;
      buttons.forEach((btn, j) => { btn.disabled = true; if (j === q.answerIndex) btn.classList.add('correct'); else if (j === k) btn.classList.add('wrong'); });
      // 学習記録（ゲームの進み具合とは別に保存）
      const rec = scheduler.review(store.get(word.id), correct, now());
      store.recordAnswer(word.id, rec, scheduler.dayOf(now()), correct);
      picker.report(word.id, correct);
      session.run.quiz = picker.toState();
      resolvePending(data, session.game, b, correct);
      session.save();
      render(after,
        el('div', { class: `feedback ${correct ? 'good' : 'bad'}` }, correct ? '正解！' : `正解は「${q.choices[q.answerIndex].text}」`),
        el('div', { class: 'small center' }, `${word.en} ＝ ${word.ja}`),
        canSpeak() ? el('button', { class: 'ghost', onclick: () => speak(word.en) }, `🔊 ${word.en}`) : null,
        el('div', { class: 'battle-log' }, b.log.slice(-6).map((l) => el('div', {}, l))),
        el('button', { class: 'primary', onclick: loop }, '次へ'));
    },
  }, c.text));
  render(view,
    compactHeader(p.actor),
    el('div', { class: 'muted small center' }, `${m.name}の${actionLabel(p.action)}　`, el('span', { class: `tag ${q.reason}` }, REASON_LABEL[q.reason])),
    el('div', { class: `prompt ${isEn ? '' : 'ja'}`, lang: isEn ? 'en' : 'ja' }, q.prompt),
    canSpeak() && isEn ? el('div', { class: 'center' }, el('button', { class: 'speak', onclick: () => speak(word.en) }, '🔊')) : null,
    el('div', { class: 'options' }, buttons),
    after,
  );
}

// ---------------- 終わり ----------------
function showEnd() {
  const b = battle();
  const g = session.game;
  finishBattle(data, g, b);
  if (b.result === 'lose') {
    const dg = data.dungeons.get(session.run.dungeonId);
    session.wipe();
    render(view,
      el('h2', {}, '全滅…'),
      el('p', {}, 'ダンジョンに入る前の状態に戻った。'),
      el('p', { class: 'muted small' }, '学習記録（ルーンの状態）は残っています。'),
      el('div', { class: 'panel small' }, `ヒント：${dg?.rank > 1 ? '★を1つ下げて' : '浅い階で'}鍛え直してから挑もう。`),
      el('button', { class: 'primary', onclick: showSetup }, 'もどる'));
    return;
  }
  const lines = [];
  if (b.result === 'win') {
    const r = battleRewards(data, g, b);
    session.endBattle((game) => {
      game.party.forEach((m, i) => {
        const ups = gainXp(data, m, r.xp[i]);
        m.ap[m.job] = (m.ap[m.job] ?? 0) + r.ap[i];
        lines.push(`${m.name}：経験値 +${r.xp[i]}・AP +${r.ap[i]}${ups ? `　レベルが${m.lv}に上がった！` : ''}`);
      });
    });
  } else {
    session.endBattle();
  }
  render(view,
    el('h2', {}, b.result === 'win' ? '勝利！' : '逃げ切った'),
    el('div', { class: 'battle-log' }, b.log.slice(-4).map((l) => el('div', {}, l))),
    lines.length ? el('div', { class: 'panel small' }, lines.map((l) => el('div', {}, l))) : null,
    el('button', { class: 'primary', onclick: showSetup }, '次の戦闘へ'),
  );
}

(async () => {
  try {
    const [gd, srs, stones, lexicon] = await Promise.all([
      loadGameData(), loadJson('srs.json'), loadCsv('rune_stones.csv'), loadCsv('lexicon.csv'),
    ]);
    data = gd;
    scheduler = new Scheduler(srs.data);
    lex = buildLexicon(stones.rows, lexicon.rows);
    store = new LearningStore();
    if (session.inBattle) loop();
    else showSetup();
  } catch (e) {
    render(view, el('p', { class: 'error' }, `読み込みに失敗：${e.message}`));
    console.error(e);
  }
})();
