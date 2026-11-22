import { el, render } from '../dom.js';
import { describeFixedEffects, effectLabel } from '../equipment-effects.js?v=balance-builds-1';
import { enchantFamilies } from '../workshop.js?v=rune-study-1';
import { weaponIcon } from './weapon-icons.js';

const publicJob = (data, id) => ['base', 'mid'].includes(data.jobsById.get(id)?.tier);
const jobName = (data, id) => data.jobsById.get(id)?.name ?? id;

/** 技能の持ち出し元も含め、公開されている基本・中級職だけを案内する。 */
export function visibleBuildGuides(data, catalog) {
  return (catalog?.guides ?? []).filter((guide) => {
    const jobs = [...(guide.jobs ?? []), ...(guide.party ?? []).map((p) => p.job),
      ...(guide.skills ?? []).map((s) => data.skills.get(s.id)?.job)];
    return jobs.length > 0 && jobs.every((id) => publicJob(data, id));
  });
}

/** 工房と同じ判定から、実際に指定効果を付けられる素材の例を選ぶ。 */
export function enchantExamples(data, entry, limit = 2) {
  const def = data.equipment.get(entry.recipe);
  if (!def) return [];
  return [...data.materials.values()]
    .filter((material) => enchantFamilies(data, def, material).includes(entry.family))
    .sort((a, b) => a.rank - b.rank || Number(a.kind !== 'common') - Number(b.kind !== 'common') || a.id.localeCompare(b.id))
    .slice(0, limit);
}

function jobAvailability(data, game, id) {
  const job = data.jobsById.get(id);
  if (job?.tier === 'base') return '基本ジョブ';
  if ((game?.unlockedJobs ?? []).includes(id)) return '中級ジョブ・解放済み';
  const unlock = data.jobUnlocks?.get(id);
  if (unlock?.discover_dungeon) {
    const dungeon = data.dungeons?.get(unlock.discover_dungeon);
    return `${dungeon?.name ?? 'ダンジョン'}で発見後、神殿で転職`;
  }
  if (unlock?.materials) {
    const materials = unlock.materials.split('|').map((token) => {
      const [materialId, quantity] = token.split(':');
      return `${data.materials.get(materialId)?.name ?? materialId}×${quantity}`;
    });
    return `神殿で解放：${materials.join('・')}`;
  }
  return '中級ジョブ・解放後に転職';
}

const list = (items, ordered = false) => el(ordered ? 'ol' : 'ul', { class: 'build-guide-points' }, items.map((text) => el('li', {}, text)));
const section = (title, ...children) => el('section', { class: 'build-guide-section' }, el('h3', {}, title), ...children);

/** 手引きを開くだけではセーブ・装備・技能を変更しない。 */
export function buildGuideView(data, catalog, { game = null, member = null, onBack, backLabel = '← パーティの一覧へ', onNavigate = () => {} } = {}) {
  const guides = visibleBuildGuides(data, catalog);
  const root = el('section', { class: 'build-guide-screen' });
  const heroJobs = new Set(guides.flatMap((guide) => guide.jobs));
  let selectedJob = heroJobs.has(member?.job) ? member.job : '';

  function showIndex() {
    const choices = el('div', { class: 'build-guide-cards' });
    const count = el('p', { class: 'small muted', 'aria-live': 'polite' });
    function fill() {
      const selected = guides.filter((guide) => !selectedJob || guide.jobs.includes(selectedJob));
      count.textContent = `${selected.length}件の組み合わせ`;
      render(choices, selected.map((guide) => el('button', {
        class: 'build-guide-card', 'data-guide-id': guide.id, onclick: () => showDetail(guide),
        'aria-label': `${guide.name}の組み合わせを見る`,
      },
      el('span', { class: 'build-guide-stage' }, guide.stage),
      el('strong', { class: 'build-guide-card-title' }, guide.name),
      el('span', { class: 'build-guide-card-role' }, guide.role),
      el('span', { class: 'build-guide-card-jobs' },
        guide.weapons.map((id) => weaponIcon(id)),
        el('span', {}, guide.jobs.map((id) => jobName(data, id)).join('・'))),
      el('span', { class: 'small build-guide-card-link' }, '組み合わせを見る →'))));
    }
    const filter = el('select', { class: 'select', onchange: (event) => { selectedJob = event.target.value; fill(); } },
      el('option', { value: '', selected: !selectedJob }, 'すべてのジョブ'),
      data.jobs.filter((job) => heroJobs.has(job.id)).map((job) => el('option', { value: job.id, selected: selectedJob === job.id }, job.name)));
    render(root,
      el('button', { class: 'ghost build-guide-back', onclick: onBack }, backLabel),
      el('h2', { class: 'chapter-title' }, catalog.title ?? 'ビルド手引き'),
      el('p', { class: 'muted' }, catalog.intro),
      member ? el('p', { class: 'small' }, `${member.name}の現在のジョブ：${jobName(data, member.job)}`) : null,
      el('label', { class: 'build-guide-filter' }, '主役のジョブで探す', filter), count, choices,
      el('details', { class: 'panel build-guide-basics' }, el('summary', {}, '組み合わせを試すときの基本'),
        (catalog.principles ?? []).map((principle) => section(principle.title, el('p', {}, principle.text)))));
    fill();
    onNavigate();
  }

  function showDetail(guide) {
    const recipeRows = new Map((data.recipes ?? []).map((recipe) => [recipe.id, recipe]));
    render(root,
      el('div', { class: 'row build-guide-nav' },
        el('button', { class: 'ghost', onclick: showIndex }, '← ビルド一覧へ'),
        el('button', { class: 'ghost', onclick: onBack }, backLabel)),
      el('span', { class: 'build-guide-stage' }, guide.stage),
      el('h2', { class: 'chapter-title' }, guide.name),
      el('p', { class: 'build-guide-lead' }, guide.goal),
      section('主役のジョブと武器',
        el('div', { class: 'build-guide-jobs' }, guide.jobs.map((id) => el('div', {},
          el('strong', {}, jobName(data, id)), el('p', { class: 'small muted' }, jobAvailability(data, game, id))))),
        el('div', { class: 'build-guide-weapons' }, guide.weapons.map((id) => el('span', { class: 'equipment-gear-name' },
          weaponIcon(id), el('span', {}, data.weaponTypes.get(id)?.name ?? id))))),
      section('まずそろえる効果', list(guide.focus)),
      section('スキルの候補',
        el('p', { class: 'small muted' }, '習得した技能を、通常・パッシブそれぞれの枠へ装備します。持ち出し候補は元のジョブで習得してから使えます。'),
        el('ul', { class: 'build-guide-reference-list' }, guide.skills.map((entry) => {
          const skill = data.skills.get(entry.id);
          return el('li', {},
            el('div', { class: 'build-guide-reference-title' }, el('strong', {}, skill.name), el('span', { class: 'small muted' }, entry.use)),
            el('div', { class: 'small build-guide-meta' }, `${jobName(data, skill.job)}・${skill.path} ${skill.stage}段目・${skill.kind === 'passive' ? 'パッシブ' : `基礎MP ${skill.mp}`}・枠 ${skill.cost}${skill.isFinal ? '・奥義（元のジョブ専用）' : ''}`),
            el('p', {}, entry.note));
        }))),
      section('段階ごとの制作目標',
        el('p', { class: 'small muted' }, '入手順を決めるための候補です。制作には対応する工房・素材・お金が必要で、派生装備は元の装備も使います。'),
        el('ul', { class: 'build-guide-reference-list' }, guide.recipes.map((entry) => {
          const def = data.equipment.get(entry.id);
          const recipe = recipeRows.get(entry.id);
          const source = recipe?.derive_from ? data.equipment.get(recipe.derive_from)?.name : '';
          return el('li', {},
            el('div', { class: 'build-guide-reference-title' },
              el('strong', { class: 'equipment-gear-name' }, def.slot === 'weapon' ? weaponIcon(def.kind) : null, el('span', {}, def.name)),
              el('span', { class: 'small muted' }, entry.stage)),
            el('div', { class: 'small build-guide-meta' }, `★${def.star}・工房ランク ${recipe.workshop_rank}${source ? `・派生元 ${source}` : ''}`),
            el('p', { class: 'small' }, describeFixedEffects(data, def)),
            el('p', {}, entry.note));
        }))),
      section('エンチャントの選び方',
        el('p', { class: 'small muted' }, '制作した装備に付与します。素材例は工房で実際に選べる組み合わせです。効果は付与枠ごとに選びます。'),
        el('ul', { class: 'build-guide-reference-list' }, guide.enchants.map((entry) => {
          const materials = enchantExamples(data, entry);
          const target = data.equipment.get(entry.recipe);
          return el('li', {},
            el('strong', {}, entry.label ?? effectLabel(data, entry.family)),
            el('p', {}, entry.note),
            el('div', { class: 'small build-guide-meta' }, `付与先の例：${target.name}`),
            el('div', { class: 'small muted' }, `素材例：${materials.map((material) => `${material.name}（★${material.rank}）`).join('・') || '工房で対応素材を確認'}`));
        }))),
      section('編成の一例',
        el('ul', { class: 'build-guide-party' }, guide.party.map((entry) => el('li', {},
          el('strong', {}, jobName(data, entry.job)), el('span', { class: 'small' }, entry.note))))),
      section('使う順序', list(guide.steps, true)),
      section('苦手な場面と注意点', list(guide.weaknesses)),
      section('そろう前の始め方', el('p', {}, guide.starter)),
      el('button', { class: 'ghost', onclick: showIndex }, '← ほかの組み合わせを見る'));
    onNavigate();
  }

  showIndex();
  return root;
}
