// 戦闘の画面（ダンジョンの画面から使う）。行動を選ぶ → 4択 → 結果。1行動ごとに保存する。
// 戦闘が終わったら onEnd(result) を呼ぶ（報酬や全滅の扱いは呼んだ側が決める）。
import { now } from '../storage.js';
import { QuestionPicker, REASON_LABEL } from '../picker.js';
import { makeQuestion, DIRECTION } from '../quiz.js';
import { speak, canSpeak } from '../speech.js';
import { nextTurn, actionOptions, setPending, resolvePending, targetKind, canAct } from '../battle.js';
import { maxHp, maxMp } from '../character.js';
import { el, render } from '../dom.js';

/**
 * @param ctx { view, data, lex, scheduler, store, session, onEnd(result) }
 * @returns { start() } 戦闘を描き始める（途中からの再開も同じ）
 */
export function createBattleView({ view, data, lex, scheduler, store, session, onEnd }) {
  let picker = null;
  const iconOf = (id) => data.icons.find((i) => i.id === id)?.icon ?? '❔';
  const statusNames = (statuses) => Object.keys(statuses).map((id) => data.statusEffects.get(id)?.name ?? id);

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
    if (b.result) return onEnd(b.result);
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


  return { start: loop };
}
