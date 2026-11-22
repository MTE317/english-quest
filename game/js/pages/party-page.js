// パーティの画面：キャラメイク（仮）・4人の一覧・能力値・装備8枠
import { loadGameData } from '../gamedata.js';
import { GameSession } from '../save.js';
import { createNewGame, PARTY_SIZE } from '../game-state.js';
import {
  computeStats, SLOTS, SLOT_LABEL, STAT_LABEL, canEquip, equipFromStorage, unequip, gearDef,
  aptitudeGrade, xpToNext, levelCap, gainXp, makeGear,
} from '../character.js';
import { el, render, stars } from '../dom.js';

const view = document.getElementById('view');
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
    el('h2', {}, 'パーティを作る（仮）'),
    el('p', { class: 'muted small' }, '4人の名前・ジョブ・見た目を選びます。中級ジョブはあとで神殿で解放します。'),
    specs.map(card),
    el('button', {
      class: 'primary',
      onclick: () => {
        if (session.hasSave && !confirm('いまのセーブを上書きして、はじめから始めます。よろしいですか？（学習記録は消えません）')) return;
        session.startNew(createNewGame(data, specs));
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
    el('div', { class: 'panel' },
      el('div', { class: 'choice-title', style: 'font-size:1.2rem' }, `${iconOf(m.icon)} ${m.name}`),
      el('div', { class: 'muted small' }, `${jobName(m.job)}（${data.jobsById.get(m.job).role}）`),
      el('div', {}, `Lv ${m.lv}`, m.lv < cap ? el('span', { class: 'muted small' }, `　次のレベルまで ${xpToNext(data, m.lv) - m.xp}`) : el('span', { class: 'muted small' }, '　最大レベル')),
    ),
    el('h2', {}, '能力値'),
    el('table', { class: 'stat-table' }, el('tbody', {}, statRows.map(([k, v]) => el('tr', {}, el('th', {}, k), el('td', {}, String(v)))))),
    el('h2', {}, '装備（8枠）'),
    el('ul', { class: 'choice-list' },
      SLOTS.map((slot) => {
        const gear = m.equip[slot];
        return el('li', {},
          el('button', { disabled: session.inDungeon, onclick: () => showSlot(index, slot) },
            el('div', { class: 'muted small' }, SLOT_LABEL[slot]),
            el('div', {}, gear ? gearLabel(gear, m.job) : '―　なし')));
      })),
  );
  window.scrollTo(0, 0);
}

// ---------------- 枠を選んで付けかえる ----------------
function diffText(before, after) {
  const keys = [['attack', '攻撃'], ['offhandAttack', 'サブ攻撃'], ['def', 'DEF'], ['res', 'RES'], ['spd', 'SPD'], ['hp', 'HP']];
  const parts = keys.filter(([k]) => after[k] !== before[k]).map(([k, label]) => {
    const d = after[k] - before[k];
    return `${label}${d > 0 ? '+' : ''}${d}`;
  });
  return parts.join('　') || '変化なし';
}

function previewWith(m, slot, gear) {
  const clone = structuredClone(m);
  clone.equip[slot] = gear;
  if (slot === 'weapon' && clone.equip.offhand && !data.weaponTypes.get(gearDef(data, gear).kind).dualWield) clone.equip.offhand = null;
  return computeStats(data, clone);
}

function showSlot(index, slot) {
  const g = session.game;
  const m = g.party[index];
  const before = computeStats(data, m);
  const kind = { offhand: 'weapon', accessory1: 'accessory', accessory2: 'accessory' }[slot] ?? slot;
  const cands = g.storage.gear.filter((x) => gearDef(data, x).slot === kind)
    .sort((a, b) => gearDef(data, b).itemLv - gearDef(data, a).itemLv);
  render(view,
    el('button', { class: 'ghost', onclick: () => showMember(index) }, `← ${m.name}へ`),
    el('h2', {}, `${m.name}の${SLOT_LABEL[slot]}`),
    el('div', { class: 'panel small' }, '今：', m.equip[slot] ? gearLabel(m.equip[slot], m.job) : 'なし'),
    m.equip[slot] ? el('button', {
      onclick: () => { session.update((game) => unequip(data, game, game.party[index], slot)); showMember(index); },
    }, '外して倉庫へ') : null,
    el('h2', {}, '倉庫から選ぶ'),
    cands.length === 0 ? el('p', { class: 'muted' }, 'この枠につけられる装備は倉庫にありません。') : null,
    el('ul', { class: 'choice-list' },
      cands.map((gear) => {
        const check = canEquip(data, m, slot, gear);
        return el('li', {},
          el('button', {
            disabled: !check.ok,
            onclick: () => { session.update((game) => equipFromStorage(data, game, game.party[index], slot, gear.uid)); showMember(index); },
          },
          el('div', {}, gearLabel(gear, m.job)),
          el('div', { class: 'stats' }, check.ok ? diffText(before, previewWith(m, slot, gear)) : el('span', { class: 'error' }, check.reason))));
      })),
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
    if (session.hasSave && session.game?.party) showParty();
    else showCreate();
  } catch (e) {
    render(view, el('p', { class: 'error' }, `読み込みに失敗：${e.message}`));
    console.error(e);
  }
})();
