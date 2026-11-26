import { el, render } from '../dom.js?v=skill-growth-2';
import { parseAmounts } from '../csv.js?v=skill-growth-2';
import { craft, brew, canCraft, canBrew, enhance, dismantle, reroll, enchant, enchantFamilies, facilityUpgrade } from '../workshop.js?v=specialist-jobs-1';
import { borrow, repayLoan, loanLimit } from '../town.js?v=specialist-jobs-1';
import { unlockJob, jobDiscoveryProgress, offeringRevealed } from '../temple.js?v=skill-growth-2';
import { describeFixedEffects, effectLabel, describeEffect } from '../equipment-effects.js?v=skill-growth-2';
import { equipmentIcon } from './equipment-icons.js?v=skill-growth-2';
import { uiIcon } from './pixel-icons.js?v=skill-growth-2';

const heading = (text) => el('h2', {}, text);
const btn = (text, onclick, disabled = false) => el('button', { onclick, disabled }, text);
const panel = (title, ...body) => el('details', { class: 'panel small' }, el('summary', {}, title), body);
const option = (label, value) => el('option', { value }, label);

function select(label, choices, onChange, state) {
  return el('label', { class: 'small' }, label,
    el('select', { class: 'select', onchange: (e) => onChange(e.target.value) },
      choices.map(([id, name]) => el('option', { value: id, selected: state === id }, name))));
}

export function workshopView(data, g, act, rng, selection) {
  const usableDefs = [...data.equipment.values()].filter((def) => {
    const facility = def.slot === 'weapon' ? 'weapon_workshop' : ['accessory', 'cloak'].includes(def.slot) ? 'accessory_workshop' : 'armor_workshop';
    return def.source?.includes('制作') && !def.unique && !def.setId
      && Number(data.recipes.find((r) => r.id === def.id)?.workshop_rank ?? def.star) <= (g.facilities[facility] ?? 1);
  });
  const alchemy = data.alchemyRecipes.filter((recipe) => Number(recipe.workshop_rank) <= g.facilities.item_shop);
  const deck = el('section', { class: 'workshop-view' });
  const categoryOf = (def) => ['head', 'body', 'arm'].includes(def.slot) ? 'armor' : def.slot;
  const craftCategories = [['weapon', '武器'], ['armor', '防具'], ['cloak', 'マント'], ['accessory', 'アクセサリー']];
  function iconCatalog(entries, selectedId, choose, details, empty) {
    if (!entries.length) return el('p', { class: 'shop-detail muted' }, empty);
    return el('div', { class: 'shop-layout workshop-layout' },
      el('div', { class: 'shop-grid workshop-grid', role: 'group', 'aria-label': '選択する一覧' },
        entries.map(entry => el('button', {
          type: 'button', class: 'shop-slot', 'data-workshop-item': entry.id,
          'data-rarity': entry.rarity ?? 'common',
          'aria-pressed': String(entry.id === selectedId),
          'aria-label': [entry.name, entry.caption].filter(Boolean).join('、'),
          onclick: () => { choose(entry.id); redraw(); deck.querySelector('.workshop-grid [aria-pressed="true"]')?.focus({ preventScroll: true }); },
        }, el('span', { class: 'shop-item-icon', 'aria-hidden': 'true' }, entry.icon()),
        el('span', { class: 'shop-slot-name' }, entry.name),
        el('span', { class: 'shop-slot-count' }, entry.caption)))),
      el('section', { class: 'shop-detail workshop-detail', 'aria-label': '選択した内容の詳細' }, details));
  }

  function redraw() {
    const tabs = [['craft', '制作'], ['gear', '倉庫の装備（強化）'], ['alchemy', '調合台']];
    if (!tabs.some(([id]) => id === selection.tab)) selection.tab = 'craft';
    const switcher = el('div', { class: 'district-switch workshop-tabs', role: 'group', 'aria-label': '工房の窓口' },
      tabs.map(([id, title]) => el('button', { type: 'button', 'data-workshop-tab': id,
        'aria-pressed': String(selection.tab === id), onclick: () => {
          selection.tab = id; redraw();
          deck.querySelector('.workshop-tabs [aria-pressed="true"]')?.focus({ preventScroll: true });
        },
      }, title)));
    if (selection.tab === 'gear') {
      const gear = g.storage.gear.find(item => item.uid === selection.gear) ?? g.storage.gear[0];
      selection.gear = gear?.uid;
      render(deck, switcher, iconCatalog(g.storage.gear.map(item => {
        const def = data.equipment.get(item.id);
        const rarity = data.rarityTable.find(r => r.id === item.rarity)?.name ?? item.rarity ?? 'コモン';
        return { id: String(item.uid), name: `${def?.name ?? item.id}${item.enh > 0 ? ' +' + item.enh : ''}`,
          rarity: item.rarity, caption: rarity, icon: () => equipmentIcon(def) ?? uiIcon('gear') };
      }), gear ? String(gear.uid) : '', id => { selection.gear = g.storage.gear.find(item => String(item.uid) === id)?.uid; },
      gear ? gearOptions(gear) : [], '倉庫に装備がありません。'));
      return;
    }
    if (selection.tab === 'alchemy') {
      const recipe = alchemy.find(r => r.id === selection.brew) ?? alchemy[0];
      selection.brew = recipe?.id;
      const item = recipe ? data.items.get(recipe.result) : null;
      render(deck, switcher, iconCatalog(alchemy.map(r => ({
        id: r.id, name: data.items.get(r.result)?.name ?? r.result,
        caption: `完成 ${r.qty}個`, icon: () => uiIcon('items'),
      })), recipe?.id, id => { selection.brew = id; }, recipe ? [
        el('header', {}, uiIcon('items'), heading(item?.name ?? recipe.result)),
        item?.description ? el('p', { class: 'shop-description' }, item.description) : null,
        el('p', { class: 'small' }, `調合費：${recipe.gold} G（所持：${g.gold} G）`),
        el('p', { class: 'small muted' }, `必要素材：${recipe.materials}`),
        el('p', { class: 'small' }, `完成 ${recipe.qty}個 ／ 所持 ${g.items[recipe.result] ?? 0}個`),
        btn('調合する', () => act(game => brew(data, game, recipe)), !canBrew(data, g, recipe)),
      ] : [], '作れるレシピがありません。'));
      return;
    }
    const mode = selection.craftMode ?? 'special';
    const category = selection.craftCategory ?? 'weapon';
    const star = selection.craftStar ?? 'all';
    const filtered = usableDefs.filter(def =>
      Boolean(def.recipeId) === (mode === 'special')
      && categoryOf(def) === category && (star === 'all' || def.star === Number(star)))
      .sort((a, b) => a.itemLv - b.itemLv || a.name.localeCompare(b.name, 'ja'));
    const selectedDef = filtered.find(def => def.id === selection.recipe) ?? filtered[0];
    selection.recipe = selectedDef?.id;
    const recipe = data.recipes.find(r => r.id === selectedDef?.id);
    const needs = recipe ? parseAmounts(recipe.materials).map(({ id, count }) => ({
      id, count, name: data.materials.get(id)?.name ?? id, have: g.storage.materials[id] ?? 0,
    })) : [];
    const canMake = canCraft(data, g, selectedDef);
    render(deck, switcher,
      el('div', { class: 'workshop-filters' },
        select('制作方法', [['special', '専用レシピ'], ['standard', '通常制作']],
          value => { selection.craftMode = value; selection.recipe = null; redraw(); }, mode),
        select('装備種別', craftCategories,
          value => { selection.craftCategory = value; selection.recipe = null; redraw(); }, category),
        select('★', [['all', 'すべて'], ...Array.from({ length: 12 }, (_, i) => [String(i + 1), `★${i + 1}`])],
          value => { selection.craftStar = value; selection.recipe = null; redraw(); }, star)),
      el('p', { class: 'muted small' }, `条件に合う制作候補：${filtered.length}件（施設ランクで解放）`),
      iconCatalog(filtered.map(def => ({ id: def.id, name: def.name, caption: `★${def.star} ／ Lv${def.itemLv}`,
        icon: () => equipmentIcon(def) ?? uiIcon('gear') })),
      selectedDef?.id, id => { selection.recipe = id; }, selectedDef ? [
        el('header', {}, equipmentIcon(selectedDef) ?? uiIcon('gear'), heading(selectedDef.name)),
        selectedDef.recipeDescription ? el('p', { class: 'shop-description' }, selectedDef.recipeDescription) : null,
        selectedDef.slot === 'weapon' ? el('p', { class: 'small muted' },
          `武器特性：${data.weaponTypes.get(selectedDef.kind)?.feature ?? 'なし'}`) : null,
        describeFixedEffects(data, selectedDef) ? el('p', { class: 'small' },
          `固定効果：${describeFixedEffects(data, selectedDef)}`) : null,
        recipe ? [
          el('p', { class: 'small' }, `制作費：${recipe.gold} G（所持：${g.gold} G）`),
          needs.map(m => el('p', { class: 'small muted' }, `${m.name} ×${m.count}（所持：${m.have}）`)),
          recipe.derive_from ? el('p', { class: 'small muted' },
            `派生元：${data.equipment.get(recipe.derive_from)?.name ?? recipe.derive_from}（制作済みの現物を消費）`) : null,
        ] : el('p', { class: 'small muted' },
          `${data.economy.get(selectedDef.star).craft_gold} G・★${selectedDef.star}以上の通常素材4個`),
        btn('制作する', () => act(game => craft(data, game, selectedDef)), !canMake),
      ] : [], 'この条件で作れる装備はありません。施設ランクか絞り込みを確認してください。'));
  }

  function gearOptions(item) {
    const definition = data.equipment.get(item.id);
    const icon = equipmentIcon(definition);
    const stats = Object.entries(item.affixes ?? {});
    const effectText = item.crafted ? describeFixedEffects(data, definition) : '';
    const enchantments = (item.enchants ?? []).map((effect, index) => el('div', { class: 'small' }, `枠${index + 1} ${describeEffect(data, effect.stat, effect.value)}`));
    return [
      icon ? el('p', { class: 'gear-with-icon' },
        icon, el('span', {}, `${definition.name}${item.enh > 0 ? ` +${item.enh}` : ''}`)) : null,
      effectText ? el('p', { class: 'small' }, `固定効果：${effectText}`) : null,
      el('p', { class: 'small muted' }, `強化石 ${g.storage.materials.enhancement_stone ?? 0}個`),
      btn('強化する', () => act((game) => enhance(data, game, item, rng()))),
      btn('分解する', () => {
        if (confirm(`${definition.name}を分解しますか？`)) act((game) => dismantle(data, game, item));
      }),
      item.crafted ? [enchantments, enchantForm(item, definition)] : null,
      !item.crafted && !definition.unique && !definition.setId && stats.length ? panel('効果の振り直し',
        stats.map(([key, value]) => btn(`${describeEffect(data, key, value)} を振り直す`, () => act((game) => reroll(data, game, item, key, rng()))))) : null,
    ];
  }

  function enchantForm(item, def) {
    const mats = [...data.materials.values()].filter((m) => g.storage.materials[m.id] > 0 && enchantFamilies(data, def, m).length);
    if (!mats.length) return el('p', { class: 'small muted' }, '付与に使える素材がありません。');
    const familySelect = el('select', { class: 'select' });
    const materialSelect = el('select', { class: 'select', onchange: () => fill() }, mats.map((m) => option(m.name, m.id)));
    const fill = () => render(familySelect, enchantFamilies(data, def, data.materials.get(materialSelect.value) ?? mats[0]).map((id) => option(effectLabel(data, id), id)));
    fill();
    const facility = def.slot === 'weapon' ? 'weapon_workshop' : ['accessory', 'cloak'].includes(def.slot) ? 'accessory_workshop' : 'armor_workshop';
    const grades = el('select', { class: 'select' }, data.enchantGrades.filter((r) => Number(r.workshop_rank) <= g.facilities[facility]).map((row) => option(`グレード${row.grade}・${row.gold} G`, row.grade)));
    const slots = el('select', { class: 'select' }, option('枠1', '0'), item.enchants?.length ? option('枠2', '1') : null);
    return panel('エンチャント',
      el('label', {}, '素材', materialSelect), el('label', {}, '効果', familySelect),
      el('label', {}, 'グレード', grades), el('label', {}, '枠', slots),
      btn('効果を付ける', () => act((game) => enchant(data, game, item, Number(slots.value), materialSelect.value, familySelect.value, Number(grades.value)))));
  }

  redraw();
  return deck;
}

export function managementView(data, g, act) {
  const amount = el('input', { type: 'number', min: '1', step: '1', class: 'select', 'aria-label': '金額（G）' });
  const limit = loanLimit(data, g);
  return [
    heading('銀行'),
    el('div', { class: 'panel small' }, `融資残高 ${g.loan ?? 0} G ・ 上限 ${limit} G`,
      amount,
      el('div', { class: 'row' },
        btn('借りる', () => act((game) => borrow(data, game, Number(amount.value)))),
        btn('返済する', () => act((game) => repayLoan(game, Number(amount.value)))))),
    heading('町への投資'),
    data.facilities.map((f) => {
      const current = g.facilities[f.id] ?? 1;
      const next = data.facilityRanks.find((r) => Number(r.rank) === current + 1);
      const fx = data.facilityEffects.find((r) => r.facility === f.id && Number(r.rank) === current);
      return el('div', { class: 'panel small' }, `${f.name} Lv. ${current}`,
        fx ? el('p', { class: 'muted' }, fx.effect) : null,
        next ? btn(`投資する（${next.invest_cost} G）`, () => act((game) => facilityUpgrade(data, game, f.id))) : null);
    }),
  ];
}

export function templeExtras(data, g, act, selection = {}, jobIcon = () => uiIcon('temple')) {
  const rules = [...data.jobUnlocks.values()].filter(rule => {
    const job = data.jobsById.get(rule.job_id);
    return job && job.skillsReady !== false;
  });
  const advanced = rules.filter(rule => data.jobsById.get(rule.job_id)?.tier === 'legendary');
  const renderUnlock = (rule) => {
    const job = data.jobsById.get(rule.job_id);
    const name = job.name;
    const opened = (g.unlockedJobs ?? []).includes(rule.job_id);
    if (opened) return el('p', {}, `${name} ・ 解放済み`);
    if (rule.method === '討伐報告') return null;
    if (rule.method === '発見') {
      const progress = jobDiscoveryProgress(data, g, rule.job_id);
      const dungeon = data.dungeons.get(progress.dungeonId);
      return el('div', { class: 'panel small' }, el('strong', {}, name),
        el('p', {}, `発見先：${dungeon?.name ?? progress.dungeonId}${dungeon ? `（★${dungeon.rank}）` : ''}`),
        el('p', {}, progress.guarantee == null
          ? `ボス撃破時に確率で発見・現在${progress.clears}回踏破`
          : `${progress.guarantee}回踏破までに発見・現在${progress.clears}回踏破`),
        progress.guarantee != null && progress.clears + 1 >= progress.guarantee
          ? el('p', { class: 'muted' }, '次の踏破で確定して発見します。') : null);
    }
    if (rule.method !== '素材') return el('p', {}, `${name} ・ ダンジョンで発見`);
    const concealed = job.tier === 'legendary';
    if (concealed && !offeringRevealed(data, g, rule)) return null;
    const requirements = parseAmounts(rule.materials);
    const materials = requirements.map(({ id, count }) => {
      const known = !concealed || g.discoveredMaterials?.[id] || g.storage.materials[id] > 0;
      return known ? `${data.materials.get(id)?.name ?? id} ×${count}` : '？？？';
    }).join('、');
    const ready = requirements.every(({ id, count }) => (g.storage.materials[id] ?? 0) >= count);
    return el('div', {}, el('p', {}, `${concealed ? '未知の儀式' : name} ・ ${materials}`),
      el('button', { disabled: !ready, onclick: () => act(game => unlockJob(data, game, rule.job_id)) }, '素材を捧げて解放'));
  };
  const offerings = advanced.map(renderUnlock).filter(Boolean);
  const midRules = rules.filter(rule => data.jobsById.get(rule.job_id)?.tier === 'additional');
  const selected = midRules.find(rule => rule.job_id === selection.job) ?? midRules[0];
  const detail = el('section', { class: 'shop-detail', 'aria-label': '追加ジョブの解放条件' });
  const nodes = new Map();
  function choose(rule) {
    selection.job = rule.job_id;
    const job = data.jobsById.get(rule.job_id);
    for (const [id, node] of nodes) node.setAttribute('aria-pressed', String(id === rule.job_id));
    render(detail,
      el('header', {}, jobIcon(job), heading(job.name)),
      el('p', { class: 'shop-description' }, job.role),
      renderUnlock(rule));
  }
  const grid = el('div', { class: 'shop-grid temple-job-grid', role: 'group', 'aria-label': '解放する追加ジョブ' },
    midRules.map(rule => {
      const job = data.jobsById.get(rule.job_id);
      const opened = (g.unlockedJobs ?? []).includes(job.id);
      const status = opened ? '解放済み' : rule.method === '素材' ? '素材で解放' : '冒険で発見';
      const node = el('button', {
        type: 'button', class: 'shop-slot', 'aria-pressed': 'false',
        'aria-label': `${job.name}、${status}`,
        onclick: () => choose(rule),
      }, el('span', { class: 'shop-item-icon', 'aria-hidden': 'true' }, jobIcon(job)),
      el('span', { class: 'shop-slot-name' }, job.name),
      el('span', { class: 'shop-slot-count' }, status));
      nodes.set(job.id, node);
      return node;
    }));
  if (selected) choose(selected);
  return [
    heading('追加ジョブの解放'),
    selected ? el('div', { class: 'shop-layout' }, grid, detail)
      : el('p', { class: 'muted small' }, '現在、解放できる追加ジョブはありません。'),
    offerings.length ? panel('神殿の儀式', offerings) : null,
  ];
}


