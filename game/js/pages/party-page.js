// パーティの画面：キャラメイク・6人の一覧・能力値・装備8枠
import { loadGameData } from '../gamedata.js?v=rune-study-1';
import { GameSession } from '../save.js?v=rune-study-1';
import { createNewGame, defaultPartySpecs, normalizeGame } from '../game-state.js?v=party6-1';
import {
  computeStats, SLOTS, SLOT_LABEL, STAT_LABEL, canEquip, equipFromStorage, unequip, gearDef,
  aptitudeGrade, xpToNext, levelCap, gainXp, makeGear,
} from '../character.js?v=build36-1';
import {
  jobPaths, isLearned, skillPrerequisite, learnBlock, learnSkill, equipBlock, equipSkill, unequipSkill, capacity, usedCapacity,
  commonPoints, commonBlock, learnCommon, masteryLevel, isJobMastered,
} from '../growth.js?v=build36-1';
import { skillMp } from '../battle.js?v=build36-1';
import { el, render, stars } from '../dom.js';
import { describeFixedEffects } from '../equipment-effects.js?v=build36-1';
import { describeSkillEffect } from '../skill-effects.js?v=build36-1';

import { setSceneMusic } from '../battle-music.js?v=music-suite-1';

import { installGameShell } from '../ui/game-shell.js?v=pixel-town-1';
import { weaponIcon } from '../ui/weapon-icons.js';
import { armorIcon, equipmentIcon } from '../ui/equipment-icons.js';
import { portraitIcon, portraitLabel, PORTRAIT_GROUPS } from '../ui/portrait.js';

const view = document.getElementById('view');
setSceneMusic('facility');
const session = new GameSession();
installGameShell('party', session);
session.installAutoSave(window);
let data;

const pct = (x) => `${Math.round(x * 1000) / 10}%`;
const jobName = (id) => data.jobsById.get(id)?.name ?? id;

// ---------------- キャラメイク（仮） ----------------
function showCreate() {
  const baseJobs = data.jobs.filter((j) => j.tier === 'base');
  const specs = defaultPartySpecs(data);
  const roster = el('div', { class: 'recruit-roster', role: 'group', 'aria-label': '編集する仲間' });
  const editor = el('div', { class: 'recruit-editor panel', id: 'recruit-editor' });
  const members = specs.map((spec, i) => {
    const face = el('span', { class: 'recruit-icon', 'aria-hidden': 'true' });
    const name = el('strong');
    const job = el('small');
    const button = el('button', { type: 'button', 'aria-controls': editor.id, onclick: () => edit(i) }, face, name, job);
    roster.append(button);
    return { button, face, name, job };
  });
  function refresh(i) {
    const spec = specs[i];
    render(members[i].face, portraitIcon(spec.icon, { small: true }));
    members[i].name.textContent = spec.name.trim() || `${i + 1}人目`;
    members[i].job.textContent = jobName(spec.job);
  }
  function edit(i) {
    const spec = specs[i];
    const currentJob = () => baseJobs.find((j) => j.id === spec.job);
    members.forEach(({ button }, n) => button.setAttribute('aria-pressed', String(n === i)));
    const jobNote = el('p', { class: 'job-note' });
    const describe = () => { const j = currentJob(); jobNote.textContent = [j.role, j.weakness].filter(Boolean).join(' ／ '); };
    const selectedLabel = el('p', { class: 'portrait-selected-label', 'aria-live': 'polite' }, `見た目：${portraitLabel(spec.icon)}`);
    const appearanceIds = new Set(data.icons.map(({ id }) => id));
    const choices = [];
    const picker = el('div', { class: 'portrait-picker', role: 'group', 'aria-label': '仲間の見た目' },
      PORTRAIT_GROUPS.map((group) => el('fieldset', { class: 'portrait-group' },
        el('legend', {}, group.label),
        el('div', { class: 'portrait-grid' }, group.portraits.filter(({ id }) => appearanceIds.has(id)).map(({ id, label }) => {
          const button = el('button', {
            type: 'button', class: 'portrait-option', 'aria-label': `${group.label}：${label}`,
            'aria-pressed': String(spec.icon === id),
            onclick: () => {
              spec.icon = id;
              refresh(i);
              choices.forEach((choice) => choice.button.setAttribute('aria-pressed', String(choice.id === id)));
              selectedLabel.textContent = `見た目：${label}`;
            },
          }, portraitIcon(id, { small: true }), el('span', { class: 'portrait-option-label' }, label));
          choices.push({ id, button });
          return button;
        })))));
    render(editor,
      el('h3', {}, `${i + 1}人目の冒険者`),
      el('div', { class: 'recruit-fields' },
        el('label', {}, '名前', el('input', { class: 'select', type: 'text', maxlength: '8', value: spec.name,
          oninput: (e) => { spec.name = e.target.value; refresh(i); } })),
        el('label', {}, 'ジョブ', el('select', { class: 'select',
          onchange: (e) => { spec.job = e.target.value; refresh(i); describe(); } },
          baseJobs.map((j) => el('option', { value: j.id, selected: j.id === spec.job }, j.name))))),
      jobNote, selectedLabel, picker);
    describe();
  }
  specs.forEach((_, i) => refresh(i));
  edit(0);
  render(view,
    el('section', { class: 'recruit-screen' },
      el('h2', { class: 'chapter-title' }, `${specs.length}人のパーティを作る`),
      el('p', { class: 'muted' }, '仲間を選ぶと、名前・ジョブ・見た目を変更できます。この編成のまま出発もできます。'),
      el('p', { class: 'small muted' }, `初期装備と支度金 ${data.balance.new_game?.gold ?? 0} G を持って出発します。回復役を1人入れると、長く戦いやすくなります。`),
      roster, editor,
      el('button', { class: 'primary', onclick: () => {
        if (session.hasSave && !confirm('いまのセーブを上書きして、はじめから始めます。よろしいですか？（学習記録は消えません）')) return;
        const firstParty = !session.game?.party;
        const party = specs.map((m, i) => ({ ...m, name: m.name.trim() || `${i + 1}人目` }));
        session.startNew(createNewGame(data, party));
        if (firstParty) return window.location.replace('index.html');
        showParty();
      } }, `この${specs.length}人で冒険をはじめる`),
      session.game?.party ? el('button', { class: 'ghost', onclick: showParty }, 'やめる') : null));
  window.scrollTo(0, 0);
}

// ---------------- 仲間の一覧 ----------------
function bar(cur, max, cls) {
  return el('div', { class: `meter ${cls}` }, el('span', { style: `width:${Math.max(0, Math.min(100, (cur / max) * 100))}%` }));
}

function showParty() {
  const g = session.game;
  render(view,
    session.inDungeon ? el('div', { class: 'panel small error' }, 'ダンジョンの中では装備を変えられません。') : null,
    el('div', { class: 'muted small' }, `${g.day}日目・お金 ${g.gold}・倉庫の装備 ${g.storage.gear.length}個`),
    el('h2', { class: 'chapter-title' }, `冒険中の仲間（${g.party.length}人）`),
    el('p', { class: 'muted small' }, '仲間を選ぶと、装備・能力・スキルを確認できます。'),
    el('ul', { class: 'choice-list party-roster' },
      g.party.map((m, i) => {
        const st = computeStats(data, m);
        return el('li', {},
          el('button', { class: 'roster-card', onclick: () => showMember(i) },
            memberBanner(m, { compact: true }),
            el('div', { class: 'roster-resources' },
              el('div', {}, el('span', {}, `HP　${m.hp} / ${st.hp}`), bar(m.hp, st.hp, 'hp')),
              el('div', {}, el('span', {}, `MP　${m.mp} / ${st.mp}`), bar(m.mp, st.mp, 'mp')))));
      })),
    new URLSearchParams(location.search).has('debug') ? debugTools() : null,
    !session.inDungeon ? el('details', { class: 'panel small' }, el('summary', {}, 'パーティを作り直す'),
      el('p', { class: 'muted' }, '新しい編成で確定すると冒険を最初から始めます。学習記録は引き継ぎます。'),
      el('button', { class: 'ghost', onclick: showCreate }, '新しい編成を決める')) : null,
  );
  window.scrollTo(0, 0);
}

// ---------------- 1人の詳しい画面 ----------------
function gearLabel(gear, jobId) {
  const def = gearDef(data, gear);
  const apt = aptitudeGrade(data, jobId, def);
  const enh = gear.enh ? `+${gear.enh}` : '';
  return `${def.name}${enh}（Lv${def.itemLv}${apt ? `・適正${apt}` : ''}）`;
}

function gearNameWithIcon(gear, jobId, tag = 'span') {
  const def = gearDef(data, gear);
  return el(tag, { class: 'equipment-gear-name' },
    equipmentIcon(def),
    el('span', {}, gearLabel(gear, jobId)));
}

const slotIcons = { weapon: '⚔', offhand: '†', accessory1: '✦', accessory2: '✧' };

function memberBanner(member, { compact = false } = {}) {
  return el('div', { class: `equipment-banner${compact ? ' equipment-banner-compact' : ''}` },
    el('span', { class: 'equipment-portrait', 'aria-hidden': 'true' }, portraitIcon(member.icon, { small: compact })),
    el('div', {}, el('strong', {}, member.name),
      el('span', { class: 'muted small' }, jobName(member.job)),
      el('span', { class: 'member-level small' }, `Lv ${member.lv}`)));
}

/** 詳細画面からも、一覧と同じ並びのまま全員を選べる。 */
function memberSwitcher(index, select = showMember) {
  return el('div', { class: 'party-member-switch', role: 'group', 'aria-label': '確認する仲間' },
    session.game.party.map((member, i) => el('button', {
      type: 'button', 'aria-pressed': String(i === index),
      'aria-label': `${i + 1}人目・${member.name}・${jobName(member.job)}`,
      onclick: () => {
        select(i);
        view.querySelector('.party-member-switch [aria-pressed="true"]')?.focus({ preventScroll: true });
      },
    }, portraitIcon(member.icon, { small: true }), el('span', {}, member.name))));
}

function showMember(index) {
  const g = session.game;
  const m = g.party[index];
  const st = computeStats(data, m);
  const cap = levelCap(data);
  const statRows = [
    ['HP', `${m.hp} / ${st.hp}`], ['MP', `${m.mp} / ${st.mp}`],
    ...['str', 'mag', 'def', 'res', 'spd', 'luk'].map((k) => [STAT_LABEL[k], st[k]]),
    ['攻撃力（武器）', st.offhandAttack ? `${st.attack} ＋ ${st.offhandAttack}` : st.attack],
    ['クリティカル率', pct(st.crit)], ['回避率', pct(st.evasion)], ['状態異常の耐性', pct(st.statusResist)],
  ];
  render(view,
    el('button', { class: 'ghost', onclick: showParty }, '← パーティの一覧へ'),
    memberSwitcher(index),
    memberBanner(m),
    el('div', { class: 'row' },
      el('button', { onclick: () => showSkills(index) }, 'スキルツリー'),
      el('button', { onclick: () => showLoadout(index) }, 'スキル装備'),
      el('button', { onclick: () => showCommon(index) }, '共通ツリー')),
    el('h2', {}, '装備'),
    el('ul', { class: 'equipment-slots' },
      SLOTS.map((slot) => {
        const gear = m.equip[slot];
        const def = gear ? gearDef(data, gear) : null;
        const icon = equipmentIcon(def) ?? armorIcon(slot);
        return el('li', {},
          el('button', { disabled: session.inDungeon, onclick: () => showSlot(index, slot) },
            el('span', { class: 'equipment-slot-label' },
              icon ?? el('span', { 'aria-hidden': 'true' }, slotIcons[slot]),
              SLOT_LABEL[slot]),
            el('span', { class: 'equipment-slot-name' }, gear ? gearLabel(gear, m.job) : '未装備')));
      })),
    el('details', { class: 'panel' }, el('summary', {}, '能力値'),
      el('p', { class: 'muted small' }, m.lv < cap ? `次のレベルまで ${xpToNext(data, m.lv) - m.xp}` : '最大レベル'),
      el('table', { class: 'stat-table' }, el('tbody', {}, statRows.map(([k, v]) => el('tr', {}, el('th', {}, k), el('td', {}, String(v))))))),
  );
  window.scrollTo(0, 0);
}

// ---------------- スキル装備・取り外し ----------------
// 転職前のジョブで習得したスキルもまとめて管理する。
function showLoadout(index, kind = 'actions', message = '') {
  const member = session.game.party[index];
  const cap = capacity(data, member);
  const used = usedCapacity(data, member);
  const isPassiveKind = kind === 'passives';
  const equippedIds = member.loadout?.[kind] ?? [];
  const skills = [...data.skills.values()]
    .filter((skill) => (skill.kind === 'passive') === isPassiveKind && isLearned(member, skill))
    .sort((a, b) => Number(equippedIds.includes(b.id)) - Number(equippedIds.includes(a.id))
      || Number(a.job !== member.job) - Number(b.job !== member.job)
      || a.job.localeCompare(b.job) || a.path.localeCompare(b.path) || a.stage - b.stage);

  function changeSkill(skill, equipped) {
    try {
      session.update((game) => {
        const target = game.party[index];
        if (equipped) unequipSkill(target, skill.id);
        else equipSkill(data, target, skill.id);
      });
      showLoadout(index, kind);
    } catch (error) {
      showLoadout(index, kind, error.message);
    }
  }

  function skillCard(skill) {
    const equipped = equippedIds.includes(skill.id);
    const blocked = !equipped ? equipBlock(data, member, skill) : '';
    return el('li', { class: 'panel skill-loadout-card' },
      el('div', { class: 'skill-loadout-info' },
        el('strong', {}, skill.name, equipped ? ' ・装着中' : ''),
        el('p', { class: 'muted small' }, `${jobName(skill.job)}・${skill.path}・必要枠 ${skill.cost}${isPassiveKind ? '' : `・MP ${skillMp(data, member, skill)}`}`),
        el('p', { class: 'small' }, describeSkillEffect(data, skill))),
      el('button', {
        class: equipped ? 'ghost' : 'primary',
        disabled: !!blocked,
        title: blocked || '',
        onclick: () => changeSkill(skill, equipped),
      }, equipped ? '取り外す' : blocked || '装着する'));
  }

  render(view,
    el('button', { class: 'ghost', onclick: () => showMember(index) }, `← ${member.name}へ`),
    memberSwitcher(index, (next) => showLoadout(next, kind)),
    memberBanner(member),
    el('h2', {}, 'スキル装備'),
    el('p', { class: 'muted small' }, '習得済みのスキルは、転職前のジョブのものもここで装着・取り外しできます。ほかのジョブの奥義は装着できません。'),
    el('p', { class: 'panel small' }, `通常枠 ${used.actions}/${cap.actions}・パッシブ枠 ${used.passives}/${cap.passives}`),
    message ? el('p', { class: 'error', role: 'status' }, message) : null,
    el('div', { class: 'row', role: 'group', 'aria-label': 'スキルの種類' },
      el('button', { class: isPassiveKind ? 'ghost' : 'primary', 'aria-pressed': String(!isPassiveKind),
        onclick: () => showLoadout(index, 'actions') }, `アクティブ（${used.actions}/${cap.actions}）`),
      el('button', { class: isPassiveKind ? 'primary' : 'ghost', 'aria-pressed': String(isPassiveKind),
        onclick: () => showLoadout(index, 'passives') }, `パッシブ（${used.passives}/${cap.passives}）`)),
    skills.length
      ? el('ul', { class: 'choice-list skill-loadout-list' }, skills.map(skillCard))
      : el('p', { class: 'panel muted' }, '習得済みのスキルはありません。スキルツリーで習得できます。'),
    el('button', { class: 'ghost', onclick: () => showSkills(index) }, 'スキルツリーを見る'),
  );
  window.scrollTo(0, 0);
}

// ---------------- スキルツリー ----------------
function showSkills(index, jobId, skillId, message = '') {
  const member = session.game.party[index];
  const cap = capacity(data, member);
  const used = usedCapacity(data, member);
  const jobs = [member.job, ...Object.keys(member.ap).filter((id) => id !== member.job && data.jobsById.has(id))];
  const job = jobs.includes(jobId) ? jobId : member.job;
  const paths = [...jobPaths(data, job).entries()];
  const skills = paths.flatMap(([, branch]) => branch);
  let selected = skills.find((skill) => skill.id === skillId) ?? skills[0];
  const detail = el('section', { class: 'skill-detail', 'aria-label': '選んだスキル' });
  const nodes = new Map();

  function updateSkill(fn) {
    try {
      session.update((game) => fn(game.party[index]));
      showSkills(index, job, selected.id);
    } catch (error) {
      showSkills(index, job, selected.id, error.message);
    }
  }

  function selectSkill(skill) {
    selected = skill;
    for (const [id, node] of nodes) node.setAttribute('aria-pressed', String(id === skill.id));
    const learned = isLearned(member, skill);
    const equipped = member.loadout.actions.includes(skill.id) || member.loadout.passives.includes(skill.id);
    const learnReason = learnBlock(data, member, skill);
    const equipReason = equipBlock(data, member, skill);
    const prerequisite = skillPrerequisite(data, skill);
    const prerequisiteText = prerequisite ? `${prerequisite.name}（${isLearned(member, prerequisite) ? '習得済' : '未習得'}）` : 'なし';
    render(detail, el('h2', {}, skill.name),
      el('p', { class: 'muted small' }, [skill.path, `${skill.stage}段目`, skill.kind === 'passive' ? 'パッシブ' : `MP ${skillMp(data, member, skill)}`,
        `必要枠 ${skill.cost}`, skill.isFinal && '奥義'].filter(Boolean).join('・')),
      el('p', { class: 'small' }, describeSkillEffect(data, skill)),
      el('p', { class: 'small muted' }, `習得AP ${skill.apToLearn}${skill.apToLearn === 0 ? '（最初から習得）' : ''}・前提：${prerequisiteText}`),
      !learned
        ? el('button', { class: 'primary', disabled: !!learnReason,
          onclick: () => updateSkill((m) => learnSkill(data, m, skill.id)) }, learnReason || `覚える（AP ${skill.apToLearn}）`)
        : equipped
          ? el('button', { onclick: () => updateSkill((m) => unequipSkill(m, skill.id)) }, 'スキル枠から外す')
          : el('button', { class: 'primary', disabled: !!equipReason,
            onclick: () => updateSkill((m) => equipSkill(data, m, skill.id)) }, equipReason || 'スキル枠につける'));
  }

  render(view,
    el('button', { class: 'ghost', onclick: () => showMember(index) }, `← ${member.name}へ`),
    memberSwitcher(index, (next) => showSkills(next)),
    memberBanner(member),
    el('h2', {}, 'スキルツリー'),
    el('p', { class: 'panel small' }, `残りAP ${member.ap[job] ?? 0}・通常枠 ${used.actions}/${cap.actions}・パッシブ枠 ${used.passives}/${cap.passives}`),
    message ? el('p', { class: 'error', role: 'status' }, message) : null,
    jobs.length > 1 ? el('label', { class: 'small' }, 'ジョブ',
      el('select', { class: 'select', onchange: (event) => showSkills(index, event.target.value) },
        jobs.map((id) => el('option', { value: id, selected: id === job }, jobName(id))))) : null,
    paths.length ? el('div', { class: 'skill-tree' },
      el('div', { class: 'skill-tree-root' }, jobName(job), isJobMastered(data, member, job) ? '・極めた！' : ''),
      el('div', { class: 'skill-branches', style: `--branches:${paths.length}` },
        paths.map(([path, branch]) => el('section', { class: 'skill-branch' },
          el('h3', {}, path),
          el('ol', {}, branch.map((skill, i) => {
            const learned = isLearned(member, skill);
            const equipped = member.loadout.actions.includes(skill.id) || member.loadout.passives.includes(skill.id);
            const available = !learned && !learnBlock(data, member, skill);
            const node = el('button', { class: 'skill-node', 'aria-pressed': 'false',
              onclick: () => selectSkill(skill) },
              el('strong', {}, skill.name),
              el('span', { class: `skill-node-state${equipped ? ' equipped' : ''}` },
                equipped ? '装着中' : learned ? '習得済' : available ? '習得可' : '未習得'));
            nodes.set(skill.id, node);
            const linked = i > 0 && branch[i - 1].stage === skill.stage - 1;
            return el('li', { class: linked ? 'linked' : '' }, node);
          }))))),
      detail) : el('p', { class: 'muted' }, 'このジョブのスキルはありません。'),
  );
  if (selected) selectSkill(selected);
  if (!jobId) window.scrollTo(0, 0);
}

function showCommon(index, msg = null) {
  const g = session.game;
  const m = g.party[index];
  const pts = commonPoints(data, m);
  const weaponTypes = Object.keys(m.mastery ?? {});
  render(view,
    el('button', { class: 'ghost', onclick: () => showMember(index) }, `← ${m.name}へ`),
    memberSwitcher(index, (next) => showCommon(next)),
    memberBanner(m),
    msg ? el('div', { class: 'panel small error' }, msg) : null,
    el('h2', {}, `共通ツリー（ポイント ${pts.left}）`),
    el('p', { class: 'muted small' }, 'レベルが上がるとポイントが入る。どのジョブでも効く。'),
    data.commonTree.map((n) => {
      const has = (m.common ?? []).includes(n.id);
      const block = commonBlock(data, m, n);
      return el('div', { class: `skill ${has ? 'learned' : ''}` },
        el('div', {}, n.name, el('span', { class: 'tiny muted' }, `　Lv${n.level}・${n.points}pt　${n.effect}`)),
        has ? el('span', { class: 'tiny' }, '覚えている') : el('button', {
          disabled: !!block,
          onclick: () => { try { session.update((game) => learnCommon(data, game.party[index], n.id)); showCommon(index); } catch (e) { showCommon(index, e.message); } },
        }, block || '覚える'));
    }),
    el('h2', {}, '武器の熟練度'),
    weaponTypes.length ? el('div', { class: 'panel small' }, weaponTypes.map((t) => el('div', { class: 'weapon-mastery-entry' },
      weaponIcon(t), el('span', {}, `${data.weaponTypes.get(t)?.name ?? t}：熟練度 ${masteryLevel(data, m, t)}（倒した数 ${m.mastery[t]}）`))))
      : el('p', { class: 'muted small' }, 'まだない（敵を倒すとその武器の熟練度が上がる）'),
  );
  window.scrollTo(0, 0);
}

// ---------------- 枠を選んで付けかえる ----------------
function equipmentChanges(before, after) {
  const stats = [['attack', '攻撃力'], ['offhandAttack', 'サブ攻撃'], ['hp', '最大HP'], ['mp', '最大MP'],
    ...['str', 'mag', 'def', 'res', 'spd', 'luk'].map((key) => [key, STAT_LABEL[key]])];
  const changes = stats.filter(([key]) => before[key] !== after[key]).map(([key, label]) => {
    const delta = Number((after[key] - before[key]).toFixed(2));
    return el('span', { class: delta > 0 ? 'gain' : 'loss' }, `${label} ${delta > 0 ? '+' : ''}${delta}`);
  });
  return changes.length ? changes : el('span', { class: 'muted' }, '能力値の変化なし');
}

function previewWith(member, slot, gear) {
  const preview = structuredClone(member);
  equipFromStorage(data, { storage: { gear: [gear] } }, preview, slot, gear.uid);
  return { stats: computeStats(data, preview), offhandRemoved: member.equip.offhand && !preview.equip.offhand };
}

function showSlot(index, slot) {
  const g = session.game;
  const m = g.party[index];
  const before = computeStats(data, m);
  const kind = { offhand: 'weapon', accessory1: 'accessory', accessory2: 'accessory' }[slot] ?? slot;
  const cands = g.storage.gear.filter((x) => gearDef(data, x).slot === kind)
    .map((gear) => ({ gear, check: canEquip(data, m, slot, gear) }))
    .sort((a, b) => Number(b.check.ok) - Number(a.check.ok) || gearDef(data, b.gear).itemLv - gearDef(data, a.gear).itemLv);
  const confirmation = el('section', { class: 'equipment-confirm', hidden: true, 'aria-label': '装備の比較' });
  const selectedButtons = [];
  function select(gear, source) {
    for (const button of selectedButtons) button.setAttribute('aria-pressed', String(button === source));
    const { stats, offhandRemoved } = previewWith(m, slot, gear);
    confirmation.hidden = false;
    render(confirmation,
      el('div', { role: 'status' },
        gearNameWithIcon(gear, m.job, 'strong'),
        gearDef(data, gear).slot === 'weapon' ? el('p', { class: 'muted small' },
          `武器特性：${data.weaponTypes.get(gearDef(data, gear).kind)?.feature ?? 'なし'}`) : null,
        describeFixedEffects(data, gearDef(data, gear)) ? el('p', { class: 'small' },
          `専用効果：${describeFixedEffects(data, gearDef(data, gear))}`) : null,
        el('div', { class: 'equipment-changes' }, equipmentChanges(before, stats)),
        offhandRemoved && slot === 'weapon' ? el('p', { class: 'small' }, 'サブ武器も倉庫へ戻ります。') : null),
      el('button', { class: 'primary', onclick: () => {
        session.update((game) => equipFromStorage(data, game, game.party[index], slot, gear.uid));
        showMember(index);
      } }, 'この装備に替える'));
  }
  render(view,
    el('button', { class: 'ghost', onclick: () => showMember(index) }, `← ${m.name}へ`),
    memberSwitcher(index, (next) => showSlot(next, slot)),
    memberBanner(m),
    el('h2', {}, SLOT_LABEL[slot]),
    el('div', { class: 'panel small' }, el('span', { class: 'equipment-slot-label' }, '装備中'),
      m.equip[slot] ? gearNameWithIcon(m.equip[slot], m.job) : '未装備'),
    m.equip[slot] ? el('button', {
      onclick: () => { session.update((game) => unequip(data, game, game.party[index], slot)); showMember(index); },
    }, '外して倉庫へ') : null,
    el('h2', {}, '倉庫から選ぶ'),
    cands.length === 0 ? el('p', { class: 'muted' }, 'この枠につけられる装備は倉庫にありません。') : null,
    el('ul', { class: 'choice-list equipment-items' },
      cands.map(({ gear, check }) => {
        const button = el('button', { disabled: !check.ok, 'aria-pressed': 'false',
          onclick: () => select(gear, button) },
          gearNameWithIcon(gear, m.job, 'strong'),
          el('span', { class: 'stats' }, check.ok ? '比較する' : check.reason));
        selectedButtons.push(button);
        return el('li', {}, button);
      })),
    confirmation,
  );
  window.scrollTo(0, 0);
}

// ---------------- 動作確認用 ----------------
function debugTools() {
  if (session.inDungeon) return null;
  return el('details', { class: 'panel' },
    el('summary', {}, '動作確認用'),
    el('p', { class: 'muted small' }, 'ここのボタンは動作確認のためだけのものです（本番のゲームにはありません）。'),
    el('button', {
      onclick: () => {
        session.update((game) => {
          // ★1・★2 の装備を1つずつ倉庫へ
          for (const def of data.equipment.values()) if (def.star <= 2) game.storage.gear.push(makeGear(game, def.id));
        });
        showParty();
      },
    }, '倉庫に★1〜★2の装備を1つずつ入れる'),
    el('button', {
      onclick: () => { session.update((game) => { for (const m of game.party) gainXp(data, m, 100); }); showParty(); },
    }, '全員に経験値+100'),
  );
}

(async () => {
  try {
    data = await loadGameData();
    if (session.game?.party && !session.readOnly) { normalizeGame(data, session.game, session.run); session.save(); }
    if (session.hasSave && session.game?.party) showParty();
    else showCreate();
  } catch (e) {
    render(view, el('p', { class: 'error' }, `読み込みに失敗：${e.message}`));
    console.error(e);
  }
})();
