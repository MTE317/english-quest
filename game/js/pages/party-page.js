import { availableAp } from '../ap.js?v=skill-growth-2';
// パーティーの画面：キャラメイク・6人の一覧・能力値・装備8枠
import { loadGameData } from '../gamedata.js?v=enemy-skills-1';
import { GameSession } from '../save.js?v=world-journey-1';
import { createNewGame, defaultPartySpecs, normalizeGame } from '../game-state.js?v=world-journey-1';
import {
  computeStats, SLOTS, SLOT_LABEL, STAT_LABEL, canEquip, equipFromStorage, equipRecommended, unequip, gearDef,
  aptitudeGrade, xpToNext, levelCap, gainXp, makeGear,
} from '../character.js?v=facilities-11-1';
import {
  availableJobs, jobPaths, isLearned, learnBlock, learnAndEquipSkill, equipBlock, equipSkill, unequipSkill, capacity, usedCapacity,
  commonApCost, commonBlock, learnCommon, masteryLevel, isJobMastered, GROWTH_FORMULAS,
  skillMaxLevel, learnedSkillLevel, effectiveSkill, upgradeSkillBlock, upgradeSkill, skillWeaponBlock,
} from '../growth.js?v=auto-equip-skills-1';
import { skillMp } from '../battle.js?v=enemy-skills-1';
import { elementResistancePanel } from '../ui/element-resistance.js?v=enemy-skills-1';
import { statusSusceptibilityPanel } from '../ui/status-susceptibility.js?v=enemy-skills-1';
import { el, render, stars } from '../dom.js?v=skill-growth-2';
import { describeFixedEffects } from '../equipment-effects.js?v=unique-reroll-1';
import { describeSkillForUI } from '../skill-effects.js?v=tactical-jobs-1';
import { SKILL_CATEGORIES, skillCategory, skillLoadoutKind, equippedSkillIds, isSkillEquipped, skillCostLabel, skillWeaponText, prerequisiteText } from '../ui/skill-presentation.js?v=skill-growth-2';

import { setSceneMusic } from '../battle-music.js?v=skill-growth-2';

import { installGameShell } from '../ui/game-shell.js?v=skill-growth-2';
import { weaponIcon } from '../ui/weapon-icons.js?v=skill-growth-2';
import { uiIcon } from '../ui/pixel-icons.js?v=skill-growth-2';
import { armorIcon, equipmentIcon } from '../ui/equipment-icons.js?v=skill-growth-2';
import { portraitIcon, portraitLabel, PORTRAIT_GROUPS } from '../ui/portrait.js?v=skill-growth-2';
import { skillIcon as renderSkillIcon } from '../ui/skill-icons.js?v=skill-icons-1';

const view = document.getElementById('view');
setSceneMusic('facility');
const session = new GameSession();
installGameShell('party', session);
session.installAutoSave(window);
let data;
const skillCategoryOpen = new Map();

const pct = (x) => `${Math.round(x * 1000) / 10}%`;
const jobName = (id) => data.jobsById.get(id)?.name ?? id;

// ---------------- キャラメイク（仮） ----------------
function showCreate() {
  const baseJobs = availableJobs(data, {});
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
      el('h2', { class: 'chapter-title' }, `${specs.length}人のパーティーを作る`),
      el('p', { class: 'muted' }, '仲間を選ぶと、名前・ジョブ・見た目を変更できます。この編成のまま出発もできます。'),
      el('p', { class: 'small muted' }, `仲間は無装備・技能未修得で出発します。各自のAP ${data.basicJobRules?.starting_ap ?? 30}で技能を覚え、支度金 ${data.balance.new_game?.gold ?? 0} G で装備を整えましょう。`),
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
    el('div', { class: 'muted small' }, `${g.day}日目・お金 ${g.gold}・所持品の装備 ${g.storage.gear.length}個`),
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
    !session.inDungeon ? el('details', { class: 'panel small' }, el('summary', {}, 'パーティーを作り直す'),
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
  return `${def.name}${enh}（★${def.star}${apt ? `・適正${apt}` : ''}）`;
}

function gearNameWithIcon(gear, jobId, tag = 'span') {
  const def = gearDef(data, gear);
  return el(tag, { class: 'equipment-gear-name' },
    equipmentIcon(def) ?? uiIcon('gear'),
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

function switchMemberTab(index, tab) {
  const { scrollX, scrollY } = window;
  showMember(index, tab, null, { scroll: false });
  window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' });
  view.querySelector('.member-main-tabs [aria-pressed="true"]')?.focus({ preventScroll: true });
}

function switchSkillTab(show, selector = '.member-skill-tabs [aria-pressed="true"]') {
  const { scrollX, scrollY } = window;
  show();
  window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' });
  view.querySelector(selector)?.focus({ preventScroll: true });
}

function memberNavigation(index, active, switchMember, {
  skillMode = 'learn', onSkillLearn = () => showSkills(index), onSkillSet = () => showLoadout(index),
} = {}) {
  return [
    el('button', { class: 'ghost', onclick: showParty }, '← パーティーの一覧へ'),
    memberSwitcher(index, switchMember ?? (next => showMember(next, active))),
    memberBanner(session.game.party[index]),
    el('div', { class: 'member-main-tabs', role: 'group', 'aria-label': 'キャラクターのメニュー' },
      [['skills', 'スキル'], ['equipment', '装備'], ['abilities', '能力']].map(([id, title]) =>
        el('button', { type: 'button', 'aria-pressed': String(active === id),
          onclick: () => { if (active !== id) switchMemberTab(index, id); } }, title))),
    active === 'skills' ? el('div', { class: 'member-skill-tabs', role: 'group', 'aria-label': 'スキルのメニュー' },
      el('button', { type: 'button', 'aria-pressed': String(skillMode === 'learn'),
        onclick: () => { if (skillMode !== 'learn') switchSkillTab(onSkillLearn); } }, '習得'),
      el('button', { type: 'button', 'aria-pressed': String(skillMode === 'set'),
        onclick: () => { if (skillMode !== 'set') switchSkillTab(onSkillSet); } }, 'セット')) : null,
  ];
}

function jobAptitudeChart(job) {
  const stats = ['hp', 'mp', 'str', 'mag', 'def', 'res', 'spd', 'luk'];
  const grades = data.balance.player.grade_points;
  const max = Math.max(1, ...Object.values(grades).filter(Number.isFinite));
  const svgNode = (tag, attrs = {}, ...children) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    node.append(...children);
    return node;
  };
  const point = (index, radius) => {
    const angle = -Math.PI / 2 + index * Math.PI / 4;
    return [180 + Math.cos(angle) * radius, 180 + Math.sin(angle) * radius];
  };
  const polygon = radius => stats.map((_, i) => point(i, radius).join(',')).join(' ');
  const labels = stats.map(key => `${STAT_LABEL[key]} ${job?.grades?.[key] ?? '―'}`);
  const chart = svgNode('svg', {
    viewBox: '0 0 360 360', class: 'job-aptitude-chart', role: 'img',
    'aria-label': `${job?.name ?? ''}の能力適性：${labels.join('、')}`,
  }, svgNode('title', {}, `${job?.name ?? ''}の能力適性`));
  for (let ring = 1; ring <= 5; ring++) chart.append(svgNode('polygon', {
    points: polygon(110 * ring / 5), class: 'aptitude-radar-grid',
  }));
  const values = stats.map((key, i) => {
    const value = grades[job?.grades?.[key]];
    return point(i, 110 * (Number.isFinite(value) ? Math.max(0, Math.min(1, value / max)) : 0));
  });
  stats.forEach((_, i) => {
    const [x, y] = point(i, 110);
    chart.append(svgNode('line', { x1: 180, y1: 180, x2: x, y2: y, class: 'aptitude-radar-axis' }));
  });
  chart.append(svgNode('polygon', { points: values.map(p => p.join(',')).join(' '), class: 'aptitude-radar-value' }));
  stats.forEach((_, i) => {
    const [x, y] = values[i];
    const [lx, ly] = point(i, 146);
    chart.append(svgNode('circle', { cx: x, cy: y, r: 3, class: 'aptitude-radar-dot' }),
      svgNode('text', { x: lx, y: ly, 'text-anchor': 'middle', 'dominant-baseline': 'middle', class: 'aptitude-radar-label' }, labels[i]));
  });
  return el('figure', { class: 'job-aptitude-figure' }, chart);
}

function weaponMasteryPanel(member) {
  const perLevel = GROWTH_FORMULAS.mastery_kills_per_level;
  const cap = Math.round(data.balance.battle.mastery_max / data.balance.battle.mastery_per_level);
  const target = Math.max(1, cap * perLevel);
  return el('details', { class: 'panel mastery-toggle' },
    el('summary', {}, '武器の熟練度'),
    el('ul', { class: 'weapon-mastery-list' }, [...data.weaponTypes.values()].map(type => {
      const kills = Math.max(0, Number(member.mastery?.[type.id]) || 0);
      const level = masteryLevel(data, member, type.id);
      return el('li', { class: 'weapon-mastery-card' },
        weaponIcon(type.id),
        el('div', { class: 'weapon-mastery-body' },
          el('div', { class: 'weapon-mastery-heading' },
            el('strong', {}, type.name), el('span', {}, `熟練度 ${level}/${cap}`)),
          el('progress', {
            class: 'weapon-mastery-bar', max: target, value: Math.min(target, kills),
            'aria-label': `${type.name}の熟練度 ${level}/${cap}`,
            'aria-valuetext': level >= cap ? '最大熟練度' : `熟練度 ${level}/${cap}、次の熟練度まで ${perLevel - kills % perLevel}体`,
          }),
          el('small', { class: 'muted' }, level >= cap ? 'MAX' : `次の熟練度まで ${perLevel - kills % perLevel}体`)));
    })));
}

function showMember(index, tab = 'skills', selectedSlot = null, { scroll = true } = {}) {
  if (tab === 'skills') return showSkills(index);
  const scrollY = window.scrollY;
  const m = session.game.party[index];
  const equipmentPanel = el('section', { class: 'equipment-picker', id: 'equipment-picker', hidden: true });
  const slotButtons = new Map();
  function selectSlot(slot) {
    if (session.inDungeon) return;
    selectedSlot = slot;
    for (const [id, button] of slotButtons) button.setAttribute('aria-pressed', String(id === slot));
    equipmentPanel.hidden = false;
    showSlot(index, slot, equipmentPanel, () => showMember(index, 'equipment', slot, { scroll: false }));
  }
  const st = computeStats(data, m);
  const cap = levelCap(data);
  const statRows = [
    ['HP', `${m.hp} / ${st.hp}`], ['MP', `${m.mp} / ${st.mp}`],
    ...['str', 'mag', 'def', 'res', 'spd', 'luk'].map(k => [STAT_LABEL[k], st[k]]),
    ['攻撃力（武器）', st.offhandAttack ? `${st.attack} ＋ ${st.offhandAttack}` : st.attack],
    ['クリティカル率', pct(st.crit)], ['回避率', pct(st.evasion)], ['状態異常の耐性', pct(st.statusResist)],
  ];
  render(view,
    memberNavigation(index, tab),
    tab === 'equipment' ? [
    el('h2', {}, '装備'),
    el('ul', { class: 'equipment-slots' },
      SLOTS.map((slot) => {
        const gear = m.equip[slot];
        const def = gear ? gearDef(data, gear) : null;
        const icon = equipmentIcon(def) ?? armorIcon(slot);
        const button = el('button', { type: 'button', disabled: session.inDungeon,
          'aria-pressed': 'false', 'aria-controls': equipmentPanel.id, onclick: () => selectSlot(slot) },
          el('span', { class: 'equipment-slot-label' },
            icon ?? el('span', { 'aria-hidden': 'true' }, slotIcons[slot]),
            SLOT_LABEL[slot]),
          el('span', { class: 'equipment-slot-name' }, gear ? gearLabel(gear, m.job) : '未装備'));
        slotButtons.set(slot, button);
        return el('li', {}, button);
      })),
    equipmentPanel,
    el('button', { type: 'button', class: 'primary', disabled: session.inDungeon,
      onclick: () => {
        session.update(game => equipRecommended(data, game, game.party[index]));
        showMember(index, 'equipment', null, { scroll: false });
      },
    }, 'おまかせ装備'),
    ] : [
      el('h2', {}, '能力'),
      el('p', { class: 'muted small' }, m.lv < cap ? `次のレベルまで ${xpToNext(data, m.lv) - m.xp}` : '最大レベル'),
      el('table', { class: 'stat-table' }, el('tbody', {}, statRows.map(([key, value]) =>
        el('tr', {}, el('th', {}, key), el('td', {}, String(value)))))),
      el('details', { class: 'panel aptitude-toggle' },
        el('summary', {}, '能力適性'),
        jobAptitudeChart(data.jobsById.get(m.job))),
      statusSusceptibilityPanel(data, session.game, index),
      elementResistancePanel(data, session.game, index),
      weaponMasteryPanel(m),
    ]);
  if (tab === 'equipment' && selectedSlot) selectSlot(selectedSlot);
  window.scrollTo(0, scroll ? 0 : scrollY);
}

function skillIcon(skill, member) {
  return renderSkillIcon(data, skill, member);
}

// ---------------- スキル装備・取り外し ----------------
// ショップと同じ「一覧グリッド + 選択したスキルの詳細」構成で管理する。
function showLoadout(index, kind = 'actions', message = '', skillId = '') {
  const member = session.game.party[index];
  const cap = capacity(data, member);
  const used = usedCapacity(data, member);
  const isPassiveKind = kind === 'passives';
  const isUltimateKind = kind === 'ultimate';
  const equippedIds = equippedSkillIds(member, kind);
  const skills = [...data.skills.values()]
    .filter(skill => skillLoadoutKind(skill) === kind && isLearned(member, skill))
    .sort((a, b) => Number(equippedIds.includes(b.id)) - Number(equippedIds.includes(a.id))
      || Number(a.job !== member.job) - Number(b.job !== member.job)
      || a.job.localeCompare(b.job) || a.path.localeCompare(b.path) || a.stage - b.stage);
  let selected = skills.find(skill => skill.id === skillId) ?? skills[0];

  function changeSkill(skill, equipped) {
    try {
      session.update(game => {
        const target = game.party[index];
        if (equipped) unequipSkill(target, skill.id);
        else {
          if (skill.isFinal && target.loadout?.ultimate) unequipSkill(target, target.loadout.ultimate);
          equipSkill(data, target, skill.id);
        }
      });
      showLoadout(index, kind, '', skill.id);
    } catch (error) {
      showLoadout(index, kind, error.message, skill.id);
    }
  }

  const detail = el('section', { class: 'shop-detail skill-shop-detail', 'aria-label': 'スキル詳細' });
  const grid = el('div', { class: 'shop-grid skill-shop-grid', role: 'group', 'aria-label': '習得済みスキル一覧', tabindex: '0' });
  const nodes = new Map();

  function selectSkill(base) {
    const skill = effectiveSkill(data, member, base);
    selected = base;
    for (const [id, node] of nodes) node.setAttribute('aria-pressed', String(id === skill.id));
    const equipped = equippedIds.includes(skill.id);
    const replacingUltimate = skill.isFinal && member.loadout?.ultimate && !equipped;
    const target = replacingUltimate ? { ...member, loadout: { ...member.loadout, ultimate: null } } : member;
    const blocked = !equipped ? equipBlock(data, target, skill) : '';
    const weaponReason = skillWeaponBlock(data, member, skill);
    const level = learnedSkillLevel(member, base);
    render(detail,
      el('header', {}, skillIcon(skill, member),
        el('div', {}, el('h2', {}, `${skill.name}${skillMaxLevel(skill)>1?` Lv${level}`:""}`),
          equipped ? el('span', { class: 'skill-shop-equipped' }, '装着中') : null)),
      el('p', { class: 'skill-shop-effect' }, describeSkillForUI(data, skill, level)),
      el('p', { class: 'shop-description' }, [jobName(skill.job), skillCategory(skill), skillCostLabel(skill)].join(' ／ ')),
      el('dl', { class: 'shop-facts' },
        el('div', {}, el('dt', {}, '装備枠'), el('dd', {}, skill.isFinal ? '奥義 1枠' : String(skill.cost))),
        el('div', {}, el('dt', {}, '武器条件'), el('dd', {}, skillWeaponText(data, skill))),
        !isPassiveKind ? el('div', {}, el('dt', {}, '消費MP'), el('dd', {}, String(skillMp(data, member, skill)))) : null,
        el('div', {}, el('dt', {}, '発動Lv'), el('dd', {}, skillMaxLevel(skill)>1?`Lv${level}（習得済みの最高Lv）`:"修得済み"))),
      skill.isFinal ? el('p', { class: 'small muted' }, 'ゲージ満タンで使用できます。転職後も装備でき、奥義は1つだけ装備します。') : null,
      weaponReason ? el('p', { class: 'small muted' }, `現在の武器は条件を満たしていません：${weaponReason}`) : null,
      blocked ? el('p', { class: 'small muted' }, blocked) : null,
      el('div', { class: 'shop-actions' },
        el('button', { type: 'button', class: equipped ? 'ghost' : 'primary', disabled: session.inDungeon || !!blocked,
          onclick: () => changeSkill(base, equipped) }, equipped ? '取り外す' : replacingUltimate ? 'この奥義に替える' : '装着する')));
  }

  render(grid, skills.map(skill => {
    const equipped = equippedIds.includes(skill.id);
    const level = learnedSkillLevel(member, skill);
    const button = el('button', {
      type: 'button', class: 'shop-slot skill-shop-slot', 'data-item': skill.id, 'aria-pressed': 'false',
      'aria-label': `${skill.name}${skillMaxLevel(skill)>1?` Lv${level}`:""}、${skillCostLabel(skill)}${equipped ? '、装着中' : ''}`,
      onclick: () => selectSkill(skill),
    }, skillIcon(skill, member), el('span', { class: 'shop-slot-name' }, skill.name),
    el('span', { class: 'shop-slot-count', 'aria-hidden': 'true' }, `${skillMaxLevel(skill)>1?`Lv${level}・`:""}${skillCostLabel(skill)}${equipped ? ' ・ 装着中' : ''}`));
    nodes.set(skill.id, button);
    return button;
  }));

  const tabs = [
    ['actions', `アクティブ（${used.actions}/${cap.actions}）`],
    ['passives', `パッシブ（${used.passives}/${cap.passives}）`],
    ['ultimate', `奥義（${member.loadout?.ultimate ? 1 : 0}/1）`],
  ];
  render(view,
    memberNavigation(index, 'skills', next => showLoadout(next, kind), {
      skillMode: 'set', onSkillLearn: () => showSkills(index, selected?.job, selected?.id),
    }),
    el('h2', {}, 'スキルセット'),
    el('p', { class: 'muted small' }, '習得済みスキルを選び、詳細を確認して装着・取り外しできます。転職前に覚えた技能と奥義も持ち出せます。'),
    message ? el('p', { class: 'error', role: 'status' }, message) : null,
    el('div', { class: 'skill-loadout-tabs', role: 'tablist', 'aria-label': 'スキルの種類' }, tabs.map(([key, label]) =>
      el('button', { class: `skill-loadout-tab${kind === key ? ' active' : ''}`, role: 'tab', 'aria-selected': String(kind === key),
        onclick: () => {
          if (kind !== key) switchSkillTab(() => showLoadout(index, key), '.skill-loadout-tabs [aria-selected="true"]');
        } }, label))),
    skills.length ? el('div', { class: 'shop-layout skill-shop-layout skill-loadout-layout' }, detail, grid)
      : el('section', { class: 'shop-detail skill-shop-empty' },
        el('p', { class: 'muted' }, isUltimateKind ? '習得済みの奥義はありません。同じ職の非奥義10種類を覚えると解禁されます。' : '習得済みのスキルはありません。'),
        el('p', { class: 'small muted' }, '上の「習得」からスキルを覚えられます。')));
  if (selected) selectSkill(selected);
  window.scrollTo(0, 0);
}

// ---------------- スキルツリー ----------------
function showSkills(index, jobId, skillId, message = '') {
  const member = session.game.party[index];
  const jobs = [member.job, ...(member.visitedJobs ?? []).filter((id) => id !== member.job && data.jobsById.has(id))];
  const job = jobs.includes(jobId) ? jobId : member.job;
  const basic = [...jobPaths(data,job).values()].flat().every(skill=>skill.effect.master);
  let paths = basic ? SKILL_CATEGORIES.map(name => [name, []]) : [...jobPaths(data, job).entries()];
  if (basic) for (const skill of [...jobPaths(data, job).values()].flat()) {
    paths.find(([name]) => name === skillCategory(skill))[1].push(skill);
  }
  if (basic) paths = paths.filter(([, skills]) => skills.length);

  const skills = paths.flatMap(([, branch]) => branch);
  let selected = skills.find((skill) => skill.id === skillId) ?? skills[0];
  const detail = el('section', { class: 'shop-detail skill-shop-detail', 'aria-label': '選んだスキル' });
  const nodes = new Map();

  function updateSkill(fn) {
    try {
      let result;
      session.update((game) => { result = fn(game.party[index]); });
      showSkills(index, job, selected.id, typeof result === 'string' ? result : '');
    } catch (error) {
      showSkills(index, job, selected.id, error.message);
    }
  }

  function selectSkill(skill) {
    selected = skill;
    for (const [id, node] of nodes) node.setAttribute('aria-pressed', String(id === skill.id));
    const learned = isLearned(member, skill);
    const learnReason = learnBlock(data, member, skill);
    const upgradeReason = upgradeSkillBlock(data, member, skill);
    const level = learnedSkillLevel(member, skill);
    const next = skill.effect.levels?.[level - 1];
    const effective = effectiveSkill(data, member, skill);
    render(detail, el('header', {}, skillIcon(skill, member), el('h2', {}, `${skill.name}${learned && skillMaxLevel(skill)>1 ? ` Lv${level}` : ''}`)),
      el('p', { class: 'skill-shop-effect' }, describeSkillForUI(data, effective, level)),
      el('p', { class: 'muted small' }, [skill.path, skill.kind === 'passive' ? 'パッシブ' : `MP ${skillMp(data, member, skill)}`,
        skillCostLabel(skill), skill.isFinal && 'ゲージ満タンで使用'].filter(Boolean).join('・')),
      el('p', { class: 'small muted' }, `習得AP ${skill.apToLearn}・前提：${prerequisiteText(data, member, skill)}`),
      el('p', { class: 'small muted' }, `武器条件：${skillWeaponText(data, skill)}`),
      learned && skillMaxLevel(skill) > 1 ? el('section', {},
        el('p', {}, `習得Lv ${level}/${skillMaxLevel(skill)}（習得済みの最高Lvで発動）`),
        next ? el('p', {}, `次のLv: MP ${next.mp}・${describeSkillForUI(data, { ...skill, effect: { ...skill.effect, ...next.effect } }, level + 1)}`) : null,
        next ? el('button', { disabled: session.inDungeon || !!upgradeReason, onclick: () => updateSkill((m) => upgradeSkill(data, m, skill.id)) },
          upgradeReason || `Lv${level + 1}へ強化（AP ${next.ap}）`) : el('p', { class: 'small muted' }, '最大Lvです。')) : null,
      !learned
        ? el('button', { class: 'primary', disabled: session.inDungeon || !!learnReason,
          onclick: () => updateSkill((m) => learnAndEquipSkill(data, m, skill.id)) }, learnReason || `覚える（AP ${skill.apToLearn}）`)
        : el('p', { class: 'small muted' }, '習得済み。装着・取り外しはスキル装備画面で行えます。'));
  }

  function selectCommon(node) {
    selected = { id: `common:${node.id}`, kind: 'common' };
    for (const [id, button] of nodes) button.setAttribute('aria-pressed', String(id === selected.id));
    const learned = (member.common ?? []).includes(node.id);
    const reason = commonBlock(data, member, node);
    render(detail,
      el('header', {}, skillIcon({ kind: 'passive' }, member), el('h2', {}, node.name)),
      el('p', { class: 'shop-description' }, '共通パッシブ'),
      el('p', {}, node.effect),
      el('p', { class: 'small muted' }, `必要Lv ${node.level}・習得AP ${commonApCost(node)}・残りAP ${availableAp(data, member)}`),
      el('p', { class: 'small muted' }, '習得後はどのジョブでも常時有効です。装着は不要です。'),
      learned ? el('p', { class: 'skill-shop-equipped' }, '習得済み') : el('button', {
        class: 'primary', disabled: session.inDungeon || !!reason,
        onclick: () => updateSkill(target => learnCommon(data, target, node.id)),
      }, reason || `覚える（AP ${commonApCost(node)}）`));
  }

  const commonKey = `${index}:common`;
  const commonPassives = el('details', {
    class: 'skill-category common-passives',
    open: skillCategoryOpen.get(commonKey) ?? false,
    ontoggle: event => skillCategoryOpen.set(commonKey, event.currentTarget.open),
  },
    el('summary', {}, `共通パッシブ`),
    el('ol', { class: 'shop-grid skill-learning-grid' }, data.commonTree.map(node => {
      const learned = (member.common ?? []).includes(node.id);
      const available = !learned && !commonBlock(data, member, node);
      const id = `common:${node.id}`;
      const button = el('button', {
        type: 'button', class: 'shop-slot skill-shop-slot', 'aria-pressed': 'false',
        'aria-label': `${node.name}、共通パッシブ、${learned ? '習得済' : available ? '習得可' : '未習得'}`,
        onclick: () => selectCommon(node),
      }, skillIcon({ kind: 'passive' }, member),
      el('span', { class: 'shop-slot-name' }, node.name),
      el('span', { class: 'shop-slot-count' }, `Lv${node.level}・AP ${commonApCost(node)}`),
      el('span', { class: 'skill-node-state' }, learned ? '習得済' : available ? '習得可' : '未習得'));
      nodes.set(id, button);
      return el('li', {}, button);
    })));

  render(view,
    memberNavigation(index, 'skills', next => showSkills(next), {
      onSkillSet: () => showLoadout(index, selected?.kind === 'common' ? 'passives' : skillLoadoutKind(selected ?? {}),
        '', selected?.kind === 'common' ? '' : selected?.id),
    }),
    el('h2', {}, 'スキル習得・強化'),
    detail,
    message ? el('p', { class: 'panel small', role: 'status' }, message) : null,
    jobs.length > 1 ? el('label', { class: 'small' }, 'ジョブ',
      el('select', { class: 'select', onchange: (event) => showSkills(index, event.target.value) },
        jobs.map((id) => el('option', { value: id, selected: id === job }, jobName(id))))) : null,
    (paths.length || data.commonTree.length) ? el('div', { class: 'skill-learning-layout' },
      el('div', { class: basic ? 'skill-tree skill-independent skill-learning-catalog' : 'skill-tree skill-learning-catalog' },
      el('div', { class: 'skill-tree-root' }, jobName(job), isJobMastered(data, member, job) ? '・極めた！' : ''),
      el('div', { class: 'skill-branches', style: `--branches:${paths.length}` },
        paths.map(([path, branch]) => el('details', {
          class: 'skill-category',
          open: skillCategoryOpen.get(`${index}:${job}:${path}`) ?? false,
          ontoggle: event => skillCategoryOpen.set(`${index}:${job}:${path}`, event.currentTarget.open),
        },
          el('summary', {}, path),
          el('ol', { class: 'shop-grid skill-learning-grid' }, branch.map((skill, i) => {
            const learned = isLearned(member, skill);
            const equipped = isSkillEquipped(member, skill);
            const available = !learned && !learnBlock(data, member, skill);
            const node = el('button', { type: 'button', class: 'shop-slot skill-shop-slot', 'aria-pressed': 'false',
              'aria-label': `${skill.name}、${equipped ? '装着中' : learned ? '習得済' : available ? '習得可' : '未習得'}、${skillCostLabel(skill)}`,
              onclick: () => selectSkill(skill) },
              skillIcon(skill, member),
              el('span', { class: 'shop-slot-name' }, skill.name),
              el('span', { class: 'shop-slot-count' }, `${learned && skillMaxLevel(skill)>1 ? `Lv${learnedSkillLevel(member, skill)}・` : ''}${skillCostLabel(skill)}`),
              el('span', { class: `skill-node-state${equipped ? ' equipped' : ''}` },
                equipped ? '装着中' : learned ? '習得済' : available ? '習得可' : '未習得'));
            nodes.set(skill.id, node);
            const linked = !basic && i > 0 && branch[i - 1].stage === skill.stage - 1;
            return el('li', { class: linked ? 'linked' : '' }, node);
          }))))),
      commonPassives)) : el('p', { class: 'muted' }, 'このジョブのスキルはありません。'),
  );
  const commonSelection = data.commonTree.find(node => `common:${node.id}` === skillId);
  if (commonSelection) selectCommon(commonSelection);
  else if (selected) selectSkill(selected);
  else if (data.commonTree[0]) selectCommon(data.commonTree[0]);
  if (!jobId) window.scrollTo(0, 0);
}

// ---------------- 枠を選んで付けかえる ----------------
function equipmentChanges(before, after) {
  const stats = [['attack', '攻撃力'], ['offhandAttack', 'サブ攻撃'], ['hp', '最大HP'], ['mp', '最大MP'],
    ...['str', 'mag', 'def', 'res', 'spd', 'luk'].map((key) => [key, STAT_LABEL[key]])];
  const changes = stats.filter(([key]) => before[key] !== after[key]).map(([key, label]) => {
    const delta = Number((after[key] - before[key]).toFixed(2));
    return el('span', { class: delta > 0 ? 'gain' : 'loss' },
      `${label} ${before[key]} → ${after[key]}（${delta > 0 ? '+' : ''}${delta}）`);
  });
  return changes.length ? changes : el('span', { class: 'muted' }, '能力値の変化なし');
}

function previewWith(member, slot, gear) {
  const preview = structuredClone(member);
  equipFromStorage(data, { storage: { gear: [gear] } }, preview, slot, gear.uid);
  return { stats: computeStats(data, preview), offhandRemoved: member.equip.offhand && !preview.equip.offhand };
}

function showSlot(index, slot, container, refresh) {
  const g = session.game;
  const m = g.party[index];
  const before = computeStats(data, m);
  const kind = { offhand: 'weapon', accessory1: 'accessory', accessory2: 'accessory' }[slot] ?? slot;
  const cands = g.storage.gear.filter((x) => gearDef(data, x).slot === kind)
    .map((gear) => ({ gear, check: canEquip(data, m, slot, gear) }))
    .sort((a, b) => Number(b.check.ok) - Number(a.check.ok) || gearDef(data, b.gear).star - gearDef(data, a.gear).star);
  const confirmation = el('section', { class: 'equipment-confirm equipment-comparison', hidden: true, 'aria-label': '装備の比較' });
  const selectedButtons = [];
  function select(gear, source) {
    for (const button of selectedButtons) button.setAttribute('aria-pressed', String(button === source));
    const { stats, offhandRemoved } = previewWith(m, slot, gear);
    confirmation.hidden = false;
    render(confirmation,
      el('div', { role: 'status' },
        el('h3', {}, '装備の比較'),
        el('p', { class: 'small' }, `現在：${m.equip[slot] ? gearLabel(m.equip[slot], m.job) : '未装備'}`),
        gearNameWithIcon(gear, m.job, 'strong'),
        gearDef(data, gear).slot === 'weapon' ? el('p', { class: 'muted small' },
          `武器特性：${data.weaponTypes.get(gearDef(data, gear).kind)?.feature ?? 'なし'}`) : null,
        describeFixedEffects(data, gearDef(data, gear)) ? el('p', { class: 'small' },
          `専用効果：${describeFixedEffects(data, gearDef(data, gear))}`) : null,
        el('div', { class: 'equipment-changes' }, equipmentChanges(before, stats)),
        offhandRemoved && slot === 'weapon' ? el('p', { class: 'small' }, 'サブ武器も所持品へ戻ります。') : null),
      el('button', { class: 'primary', onclick: () => {
        session.update((game) => equipFromStorage(data, game, game.party[index], slot, gear.uid));
        refresh();
      } }, 'この装備に替える'));
  }
  render(container,
    el('h2', {}, `${SLOT_LABEL[slot]}の装備`),
    el('section', { class: 'panel equipment-current', 'aria-label': '装備中の装備' },
      el('h3', {}, '装備中'),
      m.equip[slot] ? gearNameWithIcon(m.equip[slot], m.job) : el('p', { class: 'muted' }, '未装備'),
      m.equip[slot] ? el('button', { type: 'button', onclick: () => {
        session.update((game) => unequip(data, game, game.party[index], slot));
        refresh();
      } }, '外して所持品へ') : null),
    el('h3', {}, '所持品の装備'),
    el('p', { class: 'small muted' }, 'アイコンを選ぶと、装備中のものと比較できます。'),
    cands.length === 0 ? el('p', { class: 'muted' }, 'この枠につけられる装備は所持品にありません。') : null,
    el('div', { class: 'shop-grid storage-grid equipment-items', role: 'group', 'aria-label': '所持品の装備一覧' },
      cands.map(({ gear, check }) => {
        const def = gearDef(data, gear);
        const rarity = def.unique || gear.crafted ? 'unique' : gear.rarity || 'common';
        const rarityName = data.rarityTable.find(entry => entry.id === rarity)?.name
          ?? ({ unique: 'ユニーク' }[rarity]) ?? rarity;
        const button = el('button', { type: 'button', class: 'shop-slot', 'data-rarity': rarity,
          disabled: !check.ok, 'aria-pressed': 'false',
          'aria-label': `${gearLabel(gear, m.job)}、${rarityName}、${check.ok ? '比較する' : check.reason}`,
          onclick: () => select(gear, button) },
          el('span', { class: 'shop-item-icon', 'aria-hidden': 'true' }, equipmentIcon(def) ?? uiIcon('gear')),
          el('span', { class: 'shop-slot-name' }, gearLabel(gear, m.job)),
          el('span', { class: 'shop-slot-count' }, rarityName),
          el('span', { class: 'shop-slot-count' }, check.ok ? `★${def.star}` : check.reason));
        selectedButtons.push(button);
        return button;
      })),
    confirmation,
  );
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
          // ★1・★2 の装備を1つずつ所持品へ
          for (const def of data.equipment.values()) if (def.star <= 2) game.storage.gear.push(makeGear(game, def.id));
        });
        showParty();
      },
    }, '所持品に★1〜★2の装備を1つずつ入れる'),
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



