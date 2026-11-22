// 戦況を表示したまま、下段をコマンド・対象の案内・問題・結果に切り替える。
import { now } from '../storage.js?v=features-1';
import { QuestionPicker, REASON_LABEL } from '../picker.js';
import { makePracticeQuestion, questionDirection, DIRECTION } from '../quiz.js?v=features-1';
import { speak, canSpeak } from '../speech.js';
import { nextTurn, actionOptions, setPending, resolvePending, targetKind, canAct, skillMp, collectBattleHits } from '../battle.js?v=hit-effects-1';
import { maxHp, maxMp } from '../character.js?v=features-1';
import { el, render } from '../dom.js';

const TARGET_PROMPT = {
  enemy: '攻撃する敵を選ぶ',
  ally: '対象の味方を選ぶ',
  ko_ally: '倒れた味方を選ぶ',
};

export function createBattleView({ view, data, lex, scheduler, store, session, onEnd, settings = {} }) {
  const run = session.run;
  const b = run.battle;
  const g = session.game;
  const picker = new QuestionPicker({
    lex, store, scheduler, stoneId: run.quiz?.stoneId ?? run.stoneId ?? lex.stones[0].id,
    nowMs: now(), state: run.quiz ?? null,
  });
  const iconOf = (id) => data.icons.find((i) => i.id === id)?.icon ?? '❔';
  const turn = el('span', { class: 'battle-turn' });
  const enemies = el('div', { class: 'battle-enemies', 'data-count': b.enemies.length, 'aria-label': '敵', role: 'group' });
  const party = el('div', { class: 'battle-party', 'data-count': g.party.length, 'aria-label': '味方', role: 'group' });
  const latest = el('span', { class: 'battle-log-latest' });
  const history = el('ul', { class: 'battle-history' });
  const log = el('details', { class: 'battle-log' },
    el('summary', { 'aria-label': '戦闘ログ' }, latest), history);
  const panel = el('section', { class: 'battle-controls', 'aria-labelledby': 'battle-controls-title' });
  const screen = el('div', { class: 'battle-screen' },
    el('div', { class: 'battle-location' },
      el('h2', {}, run.label ?? data.dungeons.get(run.dungeonId).name),
      el('span', { class: 'battle-floor' }, `${run.floor}階`), turn),
    enemies,
    party,
    log,
    panel);

  async function loop() {
    const hits = !b.pending && !b.turn && !b.result
      ? collectBattleHits(b, () => nextTurn(data, g, b))
      : [];
    session.save();
    if (b.result) {
      if (hits.length) {
        drawField(null);
        panel.inert = true;
        const popups = playHits(hits);
        await Promise.allSettled(popups.flatMap((popup) =>
          popup.getAnimations().map((animation) => animation.finished)));
      }
      if (screen.isConnected) return onEnd(b.result);
      return;
    }
    if (b.pending) return showQuestion();
    showCommand();
    playHits(hits);
  }

  function playHits(hits) {
    const cardFor = ({ side, i }) => (side === 'ally' ? party : enemies).children[i];
    const impacts = new Map();
    for (const { target, source, damage } of hits) {
      const card = cardFor(target);
      // 二刀流や連続した敵の攻撃は、受けたカードごとに合計して表示する。
      const impact = impacts.get(card) ?? { damage: 0, fromAttack: false };
      impact.damage += damage;
      if (source) {
        cardFor(source).classList.add('battle-striking');
        impact.fromAttack = true;
      }
      impacts.set(card, impact);
    }
    return Array.from(impacts, ([card, { damage, fromAttack }]) => {
      card.classList.add('battle-hit');
      if (fromAttack) card.classList.add('battle-attack-hit');
      const popup = el('span', {
        class: 'battle-hit-number',
        'aria-hidden': 'true',
        onanimationend: () => {
          popup.remove();
          card.classList.remove('battle-hit', 'battle-attack-hit');
        },
      }, `−${damage}`);
      card.append(popup);
      return popup;
    });
  }

  function resource(label, value, max, cls) {
    const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
    return el('span', { class: `battle-resource ${cls}` },
      el('span', { class: 'battle-resource-name' }, label),
      el('span', { class: 'battle-resource-value' }, `${value}/${max}`),
      el('span', { class: 'battle-meter', 'aria-hidden': 'true' },
        el('span', { style: `width:${percent}%` })));
  }

  function conditions(statuses) {
    const names = Object.keys(statuses).map((id) => data.statusEffects.get(id)?.name ?? id);
    return names.length ? el('span', { class: 'battle-conditions' }, names.join('・')) : null;
  }

  function unitCard(className, chosen, label, select, ...children) {
    const cls = `${className}${select ? ' targetable' : ''}${chosen ? ' chosen' : ''}`;
    return select
      ? el('button', { class: cls, 'aria-label': label, onclick: select }, children)
      : el('div', { class: cls }, children);
  }

  function drawField(actor, { kind, indices = [], select } = {}, action = null) {
    turn.textContent = `${b.round}ターン目`;
    const selectedKind = action ? targetKind(data, action) : null;
    render(enemies, b.enemies.map((enemy, index) => {
      const targetable = kind === 'enemy' && indices.includes(index);
      const chosen = selectedKind === 'enemy' && action.target === index;
      return unitCard(`battle-enemy${enemy.hp <= 0 ? ' down' : ''}`, chosen,
        `${enemy.name}、HP ${enemy.hp}/${enemy.maxHp}`, targetable ? () => select(index) : null,
        el('span', { class: 'battle-enemy-icon', 'aria-hidden': 'true' }, enemy.icon),
        el('span', { class: 'battle-unit-name' }, enemy.name, enemy.boss ? ' 👑' : '', enemy.eliteId ? ' ⚠' : ''),
        resource('HP', enemy.hp, enemy.maxHp, 'hp'),
        conditions(enemy.statuses),
        enemy.revealed ? el('span', { class: 'battle-conditions' }, '弱点 ' + enemy.weak.map((id) => data.elements.get(id)?.name ?? id).join('・')) : null);
    }));
    render(party, g.party.map((member, index) => {
      const hp = maxHp(data, member);
      const mp = maxMp(data, member);
      const targetable = (kind === 'ally' || kind === 'ko_ally') && indices.includes(index);
      const chosen = (selectedKind === 'ally' || selectedKind === 'ko_ally') && action.target === index;
      const classes = `battle-ally${index === actor ? ' active' : ''}${member.hp <= 0 ? ' down' : ''}`;
      const status = member.hp <= 0 ? '戦闘不能' : `HP ${member.hp}/${hp}、MP ${member.mp}/${mp}`;
      return unitCard(classes, chosen, `${member.name}、${status}`, targetable ? () => select(index) : null,
        el('span', { class: 'battle-ally-icon', 'aria-hidden': 'true' }, iconOf(member.icon)),
        el('span', { class: 'battle-ally-info' },
          el('span', { class: 'battle-unit-name' }, member.name),
          resource('HP', member.hp, hp, 'hp'),
          resource('MP', member.mp, mp, 'mp'),
          conditions(b.allies[index].statuses)));
    }));
    latest.textContent = b.log.at(-1) ?? '';
    render(history, b.log.slice(-6).map((line) => el('li', {}, line)));
  }

  function showPanel(title, content, { back, detail, question = false, focus = true } = {}) {
    log.hidden = question;
    const heading = el('h3', { id: 'battle-controls-title', tabindex: '-1' }, title);
    render(panel,
      el('div', { class: 'battle-controls-head' }, heading, detail,
        back ? el('button', { class: 'battle-back', onclick: back }, '← 戻る') : null),
      content);
    if (focus) heading.focus({ preventScroll: true });
  }

  function command(icon, label, onclick, detail = null, disabled = false) {
    return el('button', { class: 'battle-command', onclick, disabled },
      el('span', { class: 'battle-command-icon', 'aria-hidden': 'true' }, icon),
      el('span', { class: 'battle-command-copy' }, label, detail ? el('small', {}, detail) : null));
  }

  function showCommand(sub = null, message = null) {
    const actor = b.turn.i;
    const member = g.party[actor];
    const opts = actionOptions(data, g, b, actor);
    drawField(actor);
    const choose = (action) => chooseTarget(action, sub);
    const back = () => showCommand();
    const notice = message ? el('p', { class: 'battle-notice', role: 'status' }, message) : null;

    if (sub === 'skill' || sub === 'item') {
      const isSkill = sub === 'skill';
      const choices = isSkill
        ? opts.skills.map(({ skill, reason }) => listChoice(skill.name, `MP ${skillMp(data, member, skill)}`, reason,
          () => choose({ type: 'skill', skillId: skill.id }), reason))
        : opts.items.map(({ item, count, reason }) => listChoice(item.name, `×${count}`, reason || item.description,
          () => choose({ type: 'item', itemId: item.id }), reason));
      showPanel(isSkill ? 'スキル' : 'アイテム', [
        notice,
        choices.length
          ? el('div', { class: 'battle-action-list' }, choices)
          : el('p', { class: 'battle-notice' }, isSkill ? '使えるスキルがありません。' : 'アイテムを持っていません。'),
      ], { back, detail: isSkill ? el('span', { class: 'battle-panel-detail' }, `MP ${member.mp}`) : null });
      return;
    }

    showPanel(`${member.name}の番`, [notice, el('div', { class: 'battle-commands' },
      command('⚔', '通常攻撃', () => choose({ type: 'attack' })),
      command('✦', 'スキル', () => showCommand('skill')),
      command('✚', 'アイテム', () => showCommand('item')),
      command('↪', '逃げる', () => choose({ type: 'flee' }),
        opts.flee.reason || `成功率 ${Math.round(opts.flee.rate * 100)}%`, !!opts.flee.reason))]);
  }

  function listChoice(name, amount, detail, onclick, reason) {
    return el('button', { class: 'battle-list-choice', onclick, disabled: !!reason },
      el('strong', {}, name), el('span', { class: 'battle-list-amount' }, amount),
      detail ? el('small', {}, detail) : null);
  }

  function chooseTarget(action, sub) {
    const kind = targetKind(data, action);
    if (!TARGET_PROMPT[kind]) return ask({ ...action, target: null });

    let indices;
    if (kind === 'enemy') {
      indices = b.enemies.flatMap((enemy, index) => enemy.hp > 0 ? [index] : []);
    } else if (kind === 'ko_ally') {
      indices = g.party.flatMap((member, index) => member.hp <= 0 ? [index] : []);
    } else {
      indices = g.party.flatMap((_, index) => canAct(g, b, index) ? [index] : []);
    }

    const select = (target) => ask({ ...action, target });
    if (indices.length === 0) return showCommand(sub, '選べる対象がいません。');
    if (indices.length === 1) return select(indices[0]);

    drawField(b.turn.i, { kind, indices, select });
    const enemyTargets = kind === 'enemy' ? el('div', { class: 'battle-targets' }, indices.map((index) => {
      const enemy = b.enemies[index];
      return el('button', { onclick: () => select(index) }, `${enemy.icon} ${enemy.name}`);
    })) : null;
    showPanel(actionLabel(action), [
      el('p', { class: 'battle-target-prompt' }, TARGET_PROMPT[kind]),
      enemyTargets,
    ], { back: () => showCommand(sub), focus: !!enemyTargets });
    if (!enemyTargets) screen.querySelector('button.targetable').focus({ preventScroll: true });
  }

  function ask(action) {
    const review = run.questionPool?.length ? run.questionPool : null;
    const next = review?.length
      ? { word: lex.wordsById.get(review[(run.challengeQuestions ?? 0) % review.length]), reason: 'practice' }
      : picker.next();
    if (review?.length) run.challengeQuestions = (run.challengeQuestions ?? 0) + 1;
    const dir = questionDirection(run.direction ?? settings.direction ?? DIRECTION.EN_JA);
    const q = makePracticeQuestion(next.word, lex, { direction: dir, format: run.challenge ? 'meaning' : settings.format ?? 'meaning', familiar: scheduler.isFamiliar(store.get(next.word.id)) });
    setPending(b, action, {
      wordId: next.word.id, reason: next.reason, format: q.format, deadline: run.timeLimit ? Date.now() + 1000 * run.timeLimit : null, direction: q.direction, prompt: q.prompt, choices: q.choices, answerIndex: q.answerIndex,
    });
    run.quiz = picker.toState();
    session.save();
    showQuestion();
  }

  function actionLabel(action) {
    if (action.type === 'attack') return '通常攻撃';
    if (action.type === 'flee') return '逃げる';
    if (action.type === 'skill') return data.skills.get(action.skillId).name;
    return data.items.get(action.itemId).name;
  }

  function showQuestion() {
    const { actor, action, question: q } = b.pending;
    const word = lex.wordsById.get(q.wordId);
    const isEn = q.direction === DIRECTION.EN_JA;
    const title = `${g.party[actor].name}の${actionLabel(action)}`;
    drawField(actor, {}, action);

    let timeout;
    function answer(index) {
      if (!b.pending || !panel.isConnected) return;
      clearTimeout(timeout);
      const timedOut = index < 0 || (q.deadline && Date.now() >= q.deadline);
      if (timedOut) run.timedOut = true;
      const correct = !timedOut && index === q.answerIndex;
      const time = now();
      const rec = scheduler.review(store.get(word.id), correct, time);
      store.recordAnswer(word.id, rec, scheduler.dayOf(time), correct);
      picker.report(word.id, correct);
      run.quiz = picker.toState();
      const rewards = (b.learningRewards ??= { answers: 0, total: 0 });
      const weights = data.balance.rewards?.learning_weights ?? { due: 1.2, new: 1.2, retry: 1, practice: 0.8 };
      rewards.answers += 1;
      rewards.total += correct ? weights[q.reason] ?? 1 : 1;
      const hits = collectBattleHits(b, () => resolvePending(data, g, b, correct));
      session.save();

      drawField(actor, {}, action);
      showPanel(title, [
        el('div', { class: `battle-result ${correct ? 'good' : 'bad'}`, role: 'status' },
          el('strong', {}, correct ? '正解！' : `正解は「${q.choices[q.answerIndex].text}」`),
          el('span', {}, `${word.en} ＝ ${word.ja}`),
          timedOut ? el('span', {}, '時間切れ') : correct ? null : el('span', { class: 'battle-result-choice' }, `選んだ答え　${q.choices[index].text}`)),
        el('div', { class: 'battle-result-actions' },
          pronounce(word), el('button', { class: 'battle-next', onclick: loop }, '次へ →')),
      ], { focus: false });
      panel.querySelector('.battle-next').focus();
      playHits(hits);
    }

    showPanel(title, [
      el('div', { class: 'battle-question' },
        el('div', { class: 'battle-prompt', style: 'white-space: pre-line', lang: isEn ? 'en' : 'ja' }, q.prompt),
        isEn ? pronounce(word) : null),
      el('div', { class: 'battle-answers' }, q.choices.map((choice, index) =>
        el('button', { onclick: () => answer(index), lang: isEn ? 'ja' : 'en' }, choice.text))),
    ], { detail: el('span', { class: `tag ${q.reason}` }, run.timeLimit ? `${run.timeLimit}秒` : REASON_LABEL[q.reason]), question: true });
    if (q.deadline) timeout = setTimeout(() => answer(-1), Math.max(0, q.deadline - Date.now()));
  }

  function pronounce(word) {
    return canSpeak()
      ? el('button', { class: 'battle-speak', 'aria-label': '英語の発音を聞く', onclick: () => speak(word.en) }, '🔊')
      : null;
  }

  return {
    start() {
      render(view, screen);
      window.scrollTo(0, 0);
      loop();
    },
  };
}
