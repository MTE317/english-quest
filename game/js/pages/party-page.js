// パーティの画面：キャラメイク（仮）・4人の一覧・能力値・装備8枠
import { loadGameData } from '../gamedata.js?v=features-2';
import { GameSession } from '../save.js?v=features-2';
import { createNewGame, PARTY_SIZE, normalizeGame } from '../game-state.js?v=features-2';
import {
  computeStats, SLOTS, SLOT_LABEL, STAT_LABEL, canEquip, equipFromStorage, unequip, gearDef,
  aptitudeGrade, xpToNext, levelCap, gainXp, makeGear,
} from '../character.js?v=jrpg-1';
import {
  jobPaths, isLearned, learnBlock, learnSkill, equipBlock, equipSkill, unequipSkill, capacity, usedCapacity,
  commonPoints, commonBlock, learnCommon, masteryLevel, isJobMastered,
} from '../growth.js?v=features-2';
import { skillMp } from '../battle.js?v=jrpg-1';
import { el, render, stars } from '../dom.js';

import { setSceneMusic } from '../battle-music.js?v=jrpg-1';

const view = document.getElementById('view');
setSceneMusic('facility');
const session = new GameSession();
session.installAutoSave(window);
let data;

const pct = (x) => `${Math.round(x * 1000) / 10}%`;
const iconOf = (id) => data.icons.find((i) => i.id === id)?.icon ?? '❔';
const jobName = (id) => data.jobsById.get(id)?.name ?? id;

// ---------------- キャラメイク（仮） ----------------
function showCreate() {
  const baseJobs = data.jobs.filter((j) => j.tier === 'base');
  const specs = Array.from({ length: PARTY_SIZE }, (_, i) => ({
    name: `${i + 1}人目`,
    job: baseJobs[i % baseJobs.length].id,
    icon: data.icons[i % data.icons.length].id,
  }));
  const card = (spec, i) => {
    const iconSpan = el('span', { style: 'font-size:2rem' }, iconOf(spec.icon));
    return el('div', { class: 'panel' },
      el('div', { class: 'row', style: 'align-items:center' },
        iconSpan,
        el('input', {
          type: 'text', value: spec.name, maxlength: '8', 'aria-label': `${i + 1}人目の名前`,
          style: 'flex:4;min-height:44px;font:inherit;color:var(--text);background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:6px 10px',
          oninput: (e) => { spec.name = e.target.value.trim() || `${i + 1}人目`; },
        })),
      el('label', { class: 'small' }, 'ジョブ',
        el('select', { class: 'select', onchange: (e) => { spec.job = e.target.value; } },
          baseJobs.map((j) => el('option', { value: j.id, selected: j.id === spec.job }, `${j.name}（${j.role}）`)))),
      el('label', { class: 'small' }, '見た目',
        el('select', { class: 'select', onchange: (e) => { spec.icon = e.target.value; iconSpan.textContent = iconOf(spec.icon); } },
          data.icons.map((ic) => el('option', { value: ic.id, selected: ic.id === spec.icon }, ic.icon)))),
    );
  };
  render(view,
    el('h2', {}, 'パーティを作る'),
    el('p', { class: 'muted small' }, '4人の名前・ジョブ・見た目を選びます。中級ジョブはあとで神殿で解放します。'),
    specs.map(card),
    el('button', {
      class: 'primary',
      onclick: () => {
        if (session.hasSave && !confirm('いまのセーブを上書きして、はじめから始めます。よろしいですか？（学習記録は消えません）')) return;
        const firstParty = !session.game?.party;
        session.startNew(createNewGame(data, specs));
        if (firstParty) return window.location.replace('index.html');
        showParty();
      },
    }, 'この4人で冒険をはじめる'),
    session.hasSave && session.game?.party ? el('button', { onclick: showParty }, 'やめる') : null,
  );
}

// ---------------- 4人の一覧 ----------------
function bar(cur, max, cls) {
  return el('div', { class: `meter ${cls}` }, el('span', { style: `width:${Math.max(0, Math.min(100, (cur / max) * 100))}%` }));
}

function showParty() {
  const g = session.game;
  render(view,
    session.inDungeon ? el('div', { class: 'panel small error' }, 'ダンジョンの中では装備を変えられません。') : null,
    el('div', { class: 'muted small' }, `${g.day}日目・お金 ${g.gold}・倉庫の装備 ${g.storage.gear.length}個`),
    el('ul', { class: 'choice-list' },
      g.party.map((m, i) => {
        const st = computeStats(data, m);
        return el('li', {},
          el('button', { onclick: () => showMember(i) },
            el('div', { class: 'choice-title' }, `${iconOf(m.icon)} ${m.name}`, el('span', { class: 'muted small' }, `　${jobName(m.job)}　Lv${m.lv}`)),
            el('div', { class: 'stats' }, el('span', {}, `HP ${m.hp}/${st.hp}`), el('span', {}, `MP ${m.mp}/${st.mp}`)),
            bar(m.hp, st.hp, 'hp'),
            bar(m.mp, st.mp, 'mp'),
          ));
      })),
    debugTools(),
    el('button', { class: 'ghost', onclick: showCreate }, 'はじめから（パーティを作り直す）'),
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

const slotIcons = { weapon: '⚔', offhand: '†', head: '♜', body: '🛡', arm: '◇', cloak: '▱', accessory1: '✦', accessory2: '✧' };

function memberBanner(member) {
  return el('div', { class: 'equipment-banner' },
    el('span', { class: 'equipment-portrait', 'aria-hidden': 'true' }, iconOf(member.icon)),
    el('div', {}, el('strong', {}, member.name),
      el('span', { class: 'muted small' }, `${jobName(member.job)}　Lv ${member.lv}`)));
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
    memberBanner(m),
    el('div', { class: 'row' },
      el('button', { onclick: () => showSkills(index) }, 'スキルツリー'),
      el('button', { onclick: () => showCommon(index) }, '共通ツリー')),
    el('h2', {}, '装備'),
    el('ul', { class: 'equipment-slots' },
      SLOTS.map((slot) => {
        const gear = m.equip[slot];
        return el('li', {},
          el('button', { disabled: session.inDungeon, onclick: () => showSlot(index, slot) },
            el('span', { class: 'equipment-slot-label' },
              el('span', { 'aria-hidden': 'true' }, slotIcons[slot]), SLOT_LABEL[slot]),
            el('span', { class: 'equipment-slot-name' }, gear ? gearLabel(gear, m.job) : '未装備')));
      })),
    el('details', { class: 'panel' }, el('summary', {}, '能力値'),
      el('p', { class: 'muted small' }, m.lv < cap ? `次のレベルまで ${xpToNext(data, m.lv) - m.xp}` : '最大レベル'),
      el('table', { class: 'stat-table' }, el('tbody', {}, statRows.map(([k, v]) => el('tr', {}, el('th', {}, k), el('td', {}, String(v))))))),
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
    render(detail, el('h2', {}, skill.name),
      el('p', { class: 'muted small' }, [skill.path, skill.kind === 'passive' ? 'パッシブ' : `MP ${skillMp(data, member, skill)}`,
        `必要枠 ${skill.cost}`, skill.isFinal && '奥義'].filter(Boolean).join('・')),
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
    weaponTypes.length ? el('div', { class: 'panel small' }, weaponTypes.map((t) => el('div', {}, `${data.weaponTypes.get(t)?.name ?? t}：熟練度 ${masteryLevel(data, m, t)}（倒した数 ${m.mastery[t]}）`)))
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
        el('strong', {}, gearLabel(gear, m.job)),
        el('div', { class: 'equipment-changes' }, equipmentChanges(before, stats)),
        offhandRemoved && slot === 'weapon' ? el('p', { class: 'small' }, 'サブ武器も倉庫へ戻ります。') : null),
      el('button', { class: 'primary', onclick: () => {
        session.update((game) => equipFromStorage(data, game, game.party[index], slot, gear.uid));
        showMember(index);
      } }, 'この装備に替える'));
  }
  render(view,
    el('button', { class: 'ghost', onclick: () => showMember(index) }, `← ${m.name}へ`),
    memberBanner(m),
    el('h2', {}, SLOT_LABEL[slot]),
    el('div', { class: 'panel small' }, el('span', { class: 'equipment-slot-label' }, '装備中'),
      m.equip[slot] ? gearLabel(m.equip[slot], m.job) : '未装備'),
    m.equip[slot] ? el('button', {
      onclick: () => { session.update((game) => unequip(data, game, game.party[index], slot)); showMember(index); },
    }, '外して倉庫へ') : null,
    el('h2', {}, '倉庫から選ぶ'),
    cands.length === 0 ? el('p', { class: 'muted' }, 'この枠につけられる装備は倉庫にありません。') : null,
    el('ul', { class: 'choice-list equipment-items' },
      cands.map(({ gear, check }) => {
        const button = el('button', { disabled: !check.ok, 'aria-pressed': 'false',
          onclick: () => select(gear, button) },
          el('strong', {}, gearLabel(gear, m.job)),
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
    if (session.game?.party && !session.readOnly) { normalizeGame(data, session.game); session.save(); }
    if (session.hasSave && session.game?.party) showParty();
    else showCreate();
  } catch (e) {
    render(view, el('p', { class: 'error' }, `読み込みに失敗：${e.message}`));
    console.error(e);
  }
})();
