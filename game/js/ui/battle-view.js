// 戦況を表示したまま、下段をコマンド・対象の案内・問題・結果に切り替える。
import { now } from '../storage.js?v=rune-study-1';
import { QuestionPicker, REASON_LABEL } from '../picker.js';
import { makePracticeQuestion, questionDirection, questionSpeech, DIRECTION } from '../quiz.js?v=question-speech-1';
import { speak, canSpeak, stopSpeech } from '../speech.js?v=music-suite-1';
import { nextTurn, actionOptions, setPending, prepareQuizAction, resolvePending, targetKind, canAct, skillMp, collectBattleHits, enemyIntent, enemyCanAct } from '../battle.js?v=basic-skill-levels-1';
import { skillMaxLevel, usedSkillLevel } from '../growth.js?v=basic-skill-levels-1';
import { maxHp, maxMp } from '../character.js?v=basic-skill-levels-1';
import { el, render } from '../dom.js';
import { expeditionScene } from './scenery.js';
import { monsterKnowledge } from '../monster-knowledge.js';
import { startBattleMusic, finishBattleMusic } from '../battle-music.js?v=music-suite-1';
import { unlockBattleSound, playBattleHitSound } from '../battle-sound.js?v=rune-study-1';
import { portraitIcon } from './portrait.js';

const TARGET_PROMPT = {
  enemy: '攻撃する敵を選ぶ',
  ally: '対象の味方を選ぶ',
  ko_ally: '倒れた味方を選ぶ',
};

/** 状態異常に加え、残っている障壁と次の行動に有効な準備を表示する。 */
export function battleConditionLabels(data, unit) {
  const names = Object.keys(unit.statuses ?? {}).map((id) => data.statusEffects.get(id)?.name ?? id);
  if (unit.hp != null && unit.hp <= 0) return names;
  const [barrier, turns] = unit.buffs?.barrier ?? [];
  if (Number.isFinite(barrier) && barrier > 0 && turns > 0) names.push(`障壁 ${barrier} HP`);
  if (unit.normalSkillReady) names.push('次の攻撃技能を強化');
  return names;
}

export function createBattleView({ view, data, lex, scheduler, store, session, onEnd: finishBattle, settings = {} }) {
  const run = session.run;
  const b = run.battle;
  const g = session.game;
  const picker = new QuestionPicker({
    lex, store, scheduler, stoneId: run.quiz?.stoneId ?? run.stoneId ?? lex.stones[0].id,
    nowMs: now(), state: run.quiz ?? null,
  });
  const turn = el('span', { class: 'battle-turn' });
  const enemies = el('div', { class: 'battle-enemies', 'data-count': b.enemies.length, 'aria-label': '敵', role: 'group' });
  const party = el('div', { id: 'battle-party', class: 'battle-party', 'data-count': g.party.length, 'aria-label': `味方${g.party.length}人`, role: 'group' });
  const partyToggleLabel = `仲間${g.party.length}人の状態を見る`;
  const partyToggle = el('button', { class: 'battle-party-toggle', 'aria-controls': party.id, 'aria-expanded': 'false',
    onclick: () => {
      const open = partyToggle.getAttribute('aria-expanded') !== 'true';
      partyToggle.setAttribute('aria-expanded', String(open));
      partyToggle.textContent = open ? '仲間の状態を閉じる' : partyToggleLabel;
    } }, partyToggleLabel);
  const latest = el('span', { class: 'battle-log-latest' });
  const history = el('ul', { class: 'battle-history' });
  const logDialog = el('dialog', { class: 'battle-encyclopedia battle-log-dialog', 'aria-labelledby': 'battle-log-title' },
    el('div', { class: 'battle-encyclopedia-body' },
      el('h3', { id: 'battle-log-title' }, '戦闘ログ'),
      history,
      el('button', { onclick: () => logDialog.close(), autofocus: true }, '閉じる')));
  logDialog.addEventListener('click', (event) => { if (event.target === logDialog) logDialog.close(); });
  const log = el('button', { class: 'battle-log', 'aria-label': '戦闘ログの履歴を開く',
    'aria-haspopup': 'dialog', onclick: () => logDialog.showModal() }, latest);
  const panel = el('section', { class: 'battle-controls', 'aria-labelledby': 'battle-controls-title' });
  const encyclopedia = el('dialog', { class: 'battle-encyclopedia', 'aria-labelledby': 'battle-monster-name' });
  encyclopedia.addEventListener('click', (event) => { if (event.target === encyclopedia) encyclopedia.close(); });
  const screen = el('div', { class: `battle-screen scene-${expeditionScene(run.dungeonId, run.challenge)}` },
    el('div', { class: 'battle-location' },
      el('h2', {}, run.label ?? data.dungeons.get(run.dungeonId).name),
      el('span', { class: 'battle-floor' }, `${run.floor}階`), turn),
    enemies,
    partyToggle, party,
    log,
    panel, encyclopedia, logDialog);
  screen.addEventListener('click', unlockBattleSound, { capture: true });

  function onEnd(result) {
    finishBattleMusic(result);
    finishBattle(result);
  }

  async function loop(previousHits = []) {
    stopSpeech();
    const nextHits = !b.pending && !b.turn && !b.result
      ? collectBattleHits(b, () => nextTurn(data, g, b))
      : [];
    const hits = Array.isArray(previousHits) ? [...previousHits, ...nextHits] : nextHits;
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
    for (const { target, source, damage, effectiveness } of hits) {
      const card = cardFor(target);
      // 二刀流や連続した敵の攻撃は、受けたカードごとに合計して表示する。
      const impact = impacts.get(card) ?? { damage: 0, effects: new Set() };
      impact.damage += damage;
      if (source) {
        cardFor(source).classList.add('battle-striking');
        impact.effects.add(effectiveness);
      }
      impacts.set(card, impact);
    }
    const played = new Set();
    return Array.from(impacts, ([card, { damage, effects }]) => {
      const fromAttack = effects.size > 0;
      const effect = effects.has('weak') ? 'weak' : effects.has('resist') ? 'resist' : 'normal';
      const label = effect === 'weak' ? '弱点' : effect === 'resist' ? '耐性' : null;
      card.classList.add('battle-hit');
      if (fromAttack) card.classList.add('battle-attack-hit');
      if (fromAttack) card.dataset.impact = effect;
      const popup = el('span', {
        class: 'battle-hit-number',
        'aria-hidden': 'true',
        onanimationstart: fromAttack ? () => {
          for (const category of effects) {
            if (played.has(category)) continue;
            playBattleHitSound(category, played.size * 0.06);
            played.add(category);
          }
        } : null,
        onanimationend: () => {
          popup.remove();
          card.classList.remove('battle-hit', 'battle-attack-hit');
          delete card.dataset.impact;
        },
      }, fromAttack && label ? el('small', {}, label) : null, `−${damage}`);
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

  function conditions(names) {
    return names.length ? el('span', { class: 'battle-conditions' }, names.join('・')) : null;
  }

  function unitCard(className, chosen, label, select, ...children) {
    const cls = `${className}${select ? ' targetable' : ''}${chosen ? ' chosen' : ''}`;
    return select
      ? el('button', { class: cls, 'aria-label': label, onclick: select }, children)
      : el('div', { class: cls, role: 'group', 'aria-label': label }, children);
  }

  function inspectEnemy(enemy) {
    const { weak, resist, normal, scanned } = monsterKnowledge(data, g, enemy);
    render(encyclopedia, el('div', { class: 'battle-encyclopedia-body' },
      el('span', { class: 'battle-enemy-icon', 'aria-hidden': 'true' }, enemy.icon),
      el('h3', { id: 'battle-monster-name' }, enemy.name),
      resource('HP', enemy.hp, enemy.maxHp, 'hp'),
      enemy.maxMp == null ? null : resource('MP', enemy.mp, enemy.maxMp, 'mp'),
      el('p', {}, enemy.types.map((id) => data.monsterTypes.get(id)?.name ?? id).join('・')),
      el('dl', {},
        el('dt', {}, '判明した弱点'), el('dd', {}, weak.join('・') || (scanned ? 'なし' : '未判明')),
        el('dt', {}, '判明した耐性'), el('dd', {}, resist.join('・') || '未判明'),
        el('dt', {}, '通常の相性'), el('dd', {}, normal.join('・') || '未判明')),
      el('p', { class: 'battle-notice' }, '攻撃が命中すると、使った属性の相性が分かります。'),
      el('button', { onclick: () => encyclopedia.close(), autofocus: true }, '閉じる')));
    encyclopedia.showModal();
  }

  function drawField(actor, { kind, indices = [], select } = {}, action = null) {
    if (encyclopedia.open) encyclopedia.close();
    turn.textContent = `${b.round}ターン目`;
    const selectedKind = action ? targetKind(data, action) : null;
    render(enemies, b.enemies.map((enemy, index) => {
      const targetable = kind === 'enemy' && indices.includes(index);
      const chosen = selectedKind === 'enemy' && action.target === index;
      const label = enemy.name + (enemy.boss ? '、ボス' : '') + (enemy.eliteId ? '、エリート' : '') + '、HP ' + enemy.hp + '/' + enemy.maxHp +
        (enemy.maxMp == null ? '' : '、MP ' + enemy.mp + '/' + enemy.maxMp);
      const known = monsterKnowledge(data, g, enemy);
      const intent = enemyIntent(data, enemy, b.round);
      const pendingEnemyTurn = b.queue?.some(turn => turn.side === 'enemy' && turn.i === index)
        || (b.turn?.side === 'enemy' && b.turn.i === index);
      const imminent = intent.sweep && pendingEnemyTurn;
      const intentLabel = enemy.hp > 0 && (intent.warning || imminent) ? intent.label : '';
      return el('button', {
        class: `battle-enemy${enemy.hp <= 0 ? ' down' : ''}${targetable ? ' targetable' : ''}${chosen ? ' chosen' : ''}`,
        'aria-label': `${label}${intentLabel ? `、${intentLabel}` : ''}、${targetable ? '対象に選ぶ' : '図鑑を開く'}`,
        'aria-haspopup': targetable ? null : 'dialog',
        onclick: targetable ? () => select(index) : () => inspectEnemy(enemy),
      },
        el('span', { class: 'battle-enemy-icon', 'aria-hidden': 'true' }, enemy.icon),
        targetable ? null : el('span', { class: 'battle-inspect', 'aria-hidden': 'true' }, '図鑑'),
        el('span', { class: 'battle-unit-name' }, enemy.name),
        enemy.boss || enemy.eliteId ? el('span', { class: 'battle-enemy-marks', 'aria-hidden': 'true' }, [enemy.boss ? '👑' : '', enemy.eliteId ? '⚠' : ''].filter(Boolean).join(' ')) : null,
        resource('HP', enemy.hp, enemy.maxHp, 'hp'),
        enemy.maxMp == null ? null : resource('MP', enemy.mp, enemy.maxMp, 'mp'),
        enemy.tactics ? el('span', { class: 'battle-intent' }, { heal: '回復術', ward: '自己強化', disrupt: '弱体化' }[enemy.tactics]) : null,
        intentLabel ? el('span', { class: `battle-intent${imminent ? ' imminent' : ''}` }, intentLabel) : null,
        conditions(battleConditionLabels(data, enemy)),
        known.weak.length ? el('span', { class: 'battle-known-weak' }, '弱点 ' + known.weak.join('・')) : null);
    }));
    render(party, g.party.map((member, index) => {
      const hp = maxHp(data, member);
      const mp = maxMp(data, member);
      const targetable = (kind === 'ally' || kind === 'ko_ally') && indices.includes(index);
      const chosen = (selectedKind === 'ally' || selectedKind === 'ko_ally') && action.target === index;
      const classes = `battle-ally${index === actor ? ' active' : ''}${member.hp <= 0 ? ' down' : ''}`;
      const status = member.hp <= 0 ? '戦闘不能' : `HP ${member.hp}/${hp}、MP ${member.mp}/${mp}`;
      const conditionNames = battleConditionLabels(data, { ...b.allies[index], hp: member.hp });
      const label = [member.name, index === actor ? '行動中' : '', status, ...conditionNames, targetable ? '対象に選ぶ' : ''].filter(Boolean).join('、');
      return unitCard(classes, chosen, label, targetable ? () => select(index) : null,
        el('span', { class: 'battle-ally-heading' },
          el('span', { class: 'battle-ally-icon', 'aria-hidden': 'true' }, portraitIcon(member.icon, { small: true })),
          el('span', { class: 'battle-unit-name', title: member.name }, member.name)),
        el('span', { class: 'battle-ally-info' },
          resource('HP', member.hp, hp, 'hp'),
          resource('MP', member.mp, mp, 'mp'),
          conditions(conditionNames)));
    }));
    render(latest, b.log.slice(-3).map((line) => el('span', { class: 'battle-log-line' }, line)));
    render(history, b.log.map((line) => el('li', {}, line)));
  }

  function showPanel(title, content, { back, detail, question = false, focus = true } = {}) {
    screen.classList.toggle('answering', question);
    partyToggle.setAttribute('aria-expanded', 'false');
    partyToggle.textContent = partyToggleLabel;
    const heading = el('h3', { id: 'battle-controls-title', tabindex: '-1' }, title);
    render(panel,
      el('div', { class: 'battle-controls-head' }, heading, detail,
        back ? el('button', { class: 'battle-back', onclick: back }, '← 戻る') : null),
      content);
    if (focus) heading.focus({ preventScroll: true });
    if (question && panel.getBoundingClientRect().bottom > window.innerHeight) {
      panel.scrollIntoView({ block: 'nearest' });
    }
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
        ? opts.skills.map(({ skill, reason }) => listChoice(skillMaxLevel(skill) > 1 ? `${skill.name} Lv${usedSkillLevel(member, skill)}` : skill.name, `MP ${skillMp(data, member, skill)}`, reason,
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
      indices = b.enemies.flatMap((enemy, index) => enemyCanAct(enemy) ? [index] : []);
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
    let ready;
    const hits = collectBattleHits(b, () => { ready = prepareQuizAction(data, g, b); });
    if (!ready) return loop(hits);
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
    playHits(hits);
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
    const voice = questionSpeech(q);
    const instruction = q.format === 'cloze' ? '空欄に入る英語を選ぶ' : q.format === 'situation' ? '場面に合う英語を選ぶ'
      : isEn ? '日本語の意味を選ぶ' : '英語を選ぶ';
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
          pronounce(voice.answer), el('button', { class: 'battle-next', onclick: loop }, '次へ')),
      ], { focus: false });
      panel.querySelector('.battle-next').focus();
      playHits(hits);
      if (!isEn) speak(voice.answer);
    }

    showPanel(title, [
      el('div', { class: 'battle-question' },
        el('div', { class: 'battle-prompt-wrap' }, el('small', {}, instruction),
          el('div', { class: 'battle-prompt', style: 'white-space: pre-line', lang: isEn ? 'en' : 'ja' }, q.prompt)),
        pronounce(voice.prompt)),
      el('div', { class: 'battle-answers' }, q.choices.map((choice, index) =>
        el('button', { onclick: () => answer(index), lang: isEn ? 'ja' : 'en' }, el('span', { class: 'choice-letter', 'aria-hidden': 'true' }, String.fromCharCode(65 + index)), el('span', {}, choice.text)))),
    ], { detail: el('span', { class: `tag ${q.reason}` }, run.timeLimit ? `${run.timeLimit}秒` : REASON_LABEL[q.reason]), question: true });
    if (q.deadline) timeout = setTimeout(() => answer(-1), Math.max(0, q.deadline - Date.now()));
    if (!q.deadline || Date.now() < q.deadline) speak(voice.prompt);
  }

  function pronounce(text) {
    return text && canSpeak()
      ? el('button', { class: 'battle-speak', 'aria-label': '英語の発音を聞く', onclick: () => speak(text) }, '🔊')
      : null;
  }

  return {
    start() {
      if (window.navigator?.userActivation?.isActive) unlockBattleSound();
      render(view, screen);
      if (!b.result) startBattleMusic();
      window.scrollTo(0, 0);
      loop();
    },
  };
}
