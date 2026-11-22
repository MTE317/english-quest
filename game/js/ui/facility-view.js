import { el, render } from '../dom.js';
import { craft, brew, enhance, dismantle, reroll, enchant, enchantFamilies, facilityUpgrade } from '../workshop.js?v=features-1';
import { borrow, repayLoan, loanLimit, payOverdue } from '../town.js?v=features-1';
import { chooseRuneEffect, runeChangeCost, equipRune, openRuneSlot, unlockJob } from '../temple.js?v=features-1';

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
  const deck = el('div');
  function redraw() {
    const selectedBrew = alchemy.find((recipe) => recipe.id === selection.brew) ?? alchemy[0];
    const gear = g.storage.gear.find((item) => item.uid === selection.gear) ?? g.storage.gear[0];
    const selectedDef = usableDefs.find((def) => def.id === selection.recipe) ?? usableDefs[0];
    const recipe = data.recipes.find((r) => r.id === selectedDef?.id);
    render(deck,
      heading('制作'),
      selectedDef ? [
        select('装備', usableDefs.map((def) => [def.id, def.name]), (id) => { selection.recipe = id; redraw(); }, selectedDef.id),
        el('p', { class: 'small muted' }, recipe
          ? `${recipe.gold} G・${recipe.materials}${recipe.derive_from ? '・派生元 ' + data.equipment.get(recipe.derive_from)?.name : ''}`
          : `${data.economy.get(selectedDef.star).craft_gold} G・★${selectedDef.star}以上の通常素材4個`),
        btn('制作する', () => act((game) => craft(data, game, selectedDef))),
      ] : el('p', {}, '作れる装備がありません。'),
      heading('倉庫の装備'),
      gear ? [
        select('加工する装備', g.storage.gear.map((item) => [String(item.uid), `${data.equipment.get(item.id)?.name ?? item.id} +${item.enh}`]),
          (id) => { selection.gear = g.storage.gear.find((x) => String(x.uid) === id).uid; redraw(); }, String(gear.uid)),
        gearOptions(gear),
      ] : el('p', {}, '倉庫に装備がありません。'),
      heading('調合台'),
      selectedBrew ? [
        select('レシピ', alchemy.map((r) => [r.id, data.items.get(r.result)?.name ?? r.result]),
          (id) => { selection.brew = id; redraw(); }, selectedBrew.id),
        el('p', { class: 'small muted' }, `${selectedBrew.gold} G・${selectedBrew.materials}・完成 ${selectedBrew.qty}個`),
        btn('調合する', () => act((game) => brew(data, game, selectedBrew))),
      ] : el('p', {}, '作れるレシピがありません。'));
  }

  function gearOptions(item) {
    const definition = data.equipment.get(item.id);
    const stats = Object.entries(item.affixes ?? {});
    const enchantments = (item.enchants ?? []).map((effect, index) => el('div', { class: 'small' }, `枠${index + 1} ${effect.stat} +${effect.value}`));
    return [
      el('p', { class: 'small muted' }, `強化石 ${g.storage.materials.enhancement_stone ?? 0}個`),
      btn('強化する', () => act((game) => enhance(data, game, item, rng()))),
      btn('分解する', () => {
        if (confirm(`${definition.name}を分解しますか？`)) act((game) => dismantle(data, game, item));
      }),
      item.crafted ? [enchantments, enchantForm(item, definition)] : null,
      !item.crafted && !definition.unique && !definition.setId && stats.length ? panel('効果の振り直し',
        stats.map(([key, value]) => btn(`${key} +${value} を振り直す`, () => act((game) => reroll(data, game, item, key, rng()))))) : null,
    ];
  }

  function enchantForm(item, def) {
    const mats = [...data.materials.values()].filter((m) => g.storage.materials[m.id] > 0 && enchantFamilies(data, def, m).length);
    if (!mats.length) return el('p', { class: 'small muted' }, '付与に使える素材がありません。');
    const familySelect = el('select', { class: 'select' });
    const materialSelect = el('select', { class: 'select', onchange: () => fill() }, mats.map((m) => option(m.name, m.id)));
    const fill = () => render(familySelect, enchantFamilies(data, def, data.materials.get(materialSelect.value) ?? mats[0]).map((id) => option(id, id)));
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
    el('div', { class: 'panel small' }, `融資残高 ${g.loan ?? 0} G ・ 上限 ${limit} G ・ 滞納 ${g.overdue} G`,
      amount,
      el('div', { class: 'row' },
        btn('借りる', () => act((game) => borrow(data, game, Number(amount.value)))),
        btn('返済する', () => act((game) => repayLoan(game, Number(amount.value))))),
      g.overdue ? btn('滞納を払う', () => act((game) => `滞納を ${payOverdue(game, game.gold)} G 払った。`)) : null),
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

export function templeExtras(data, g, act, lex, store) {
  const stones = lex.stones.filter((stone) => store.awakened[stone.id]);
  return [
    panel('中級ジョブの解放', [...data.jobUnlocks.values()].map((rule) => {
      const name = data.jobsById.get(rule.job_id).name;
      const opened = g.unlockedJobs.includes(rule.job_id);
      if (opened || rule.method !== '素材') return el('p', {}, `${name} ・ ${opened ? '解放済み' : 'ダンジョンで発見'}`);
      return el('div', {}, el('p', {}, `${name} ・ ${rule.materials}`),
        btn('素材を捧げて解放', () => act((game) => unlockJob(data, game, rule.job_id))));
    })),
    panel('刻印', stones.length ? [
      stones.map((stone) => {
        const current = g.runeEffects?.[stone.id];
        return select(`${stone.name}${current ? `（刻み直し ${runeChangeCost(data, stone)} G）` : ''}`,
          [['', '効果を選ぶ'], ...[...data.runeEffects.values()].map((effect) => [effect.id, effect.label_ja])],
          (id) => { if (id) act((game) => chooseRuneEffect(data, game, stone, id, store.awakened)); }, current);
      }),
      g.party.map((member) => {
        const slots = member.runeSlots ?? 0;
        const next = data.kokuinSlots.find((row) => Number(row.slot) === slots + 1);
        return el('div', { class: 'panel small' }, `${member.name} ・ ${member.runes?.length ?? 0} / ${slots}枠`,
          next ? btn(`刻印枠を増やす（${next.gold} G）`, () => act((game) => openRuneSlot(data, game, member, store.awakened))) : null,
          stones.filter((stone) => g.runeEffects?.[stone.id]).map((stone) => btn(
            `${stone.name}を${member.runes?.includes(stone.id) ? '外す' : '装着'}`,
            () => act((game) => equipRune(game, member, stone.id)))));
      }),
    ] : el('p', {}, '石碑の間で石を覚醒させると使えます。')),
  ];
}
