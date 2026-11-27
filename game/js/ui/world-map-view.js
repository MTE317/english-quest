import { TRIAL_DUNGEON_IDS } from '../world-map.js?v=canyon-public-1';
import { el } from '../dom.js?v=skill-growth-2';
import { expeditionScene } from './scenery.js?v=skill-growth-2';

// ノードの接続を廃止し、公開されている冒険先をカード一覧から選ぶ。
export function createWorldMapView({ world, discoveries, selectedDungeon, onDungeon }) {
  const dungeons = world.dungeons ?? [];
  const selected = { id: selectedDungeon };
  const newIds = new Set(discoveries.map(({ id }) => id));
  const buttons = new Map();

  function choose(id) {
    selected.id = id;
    for (const [dungeonId, button] of buttons) {
      button.setAttribute('aria-pressed', String(dungeonId === id));
    }
    onDungeon(id);
  }

  const cards = dungeons.map((dungeon) => {
    const button = el('button', {
      class: 'atlas-destination' + (newIds.has(dungeon.id) ? ' atlas-new-destination' : ''),
      type: 'button',
      'aria-pressed': String(dungeon.id === selected.id),
      'aria-label': `${dungeon.name}、★${dungeon.rank}、${dungeon.state === 'cleared' ? '踏破済み' : '遠征可能'}`,
      onclick: () => choose(dungeon.id),
    },
    el('span', { class: `atlas-destination-icon scene-${expeditionScene(dungeon.id)}`, 'aria-hidden': 'true' }),
    el('strong', { class: 'atlas-destination-name' }, dungeon.name),
    el('span', { class: 'atlas-destination-meta' },
      el('span', {}, `★${dungeon.rank}`),
      el('span', { class: 'atlas-destination-status' }, dungeon.state === 'cleared' ? '踏破済み' : newIds.has(dungeon.id) ? '新発見' : '遠征可能')),
    );
    buttons.set(dungeon.id, button);
    return button;
  });

  return el('section', { class: 'atlas', 'aria-labelledby': 'world-map-heading' },
    el('div', { class: 'atlas-header' },
      el('h2', { class: 'chapter-title', id: 'world-map-heading' }, '冒険先'),
      el('span', { class: 'atlas-count' }, `発見済み ${dungeons.length} / ${TRIAL_DUNGEON_IDS.length}`)),
    discoveries.length
      ? el('p', { class: 'atlas-status', role: 'status' }, `新しい冒険先を発見：${discoveries.map((d) => d.name).join('、')}`)
      : null,
    (world.hints ?? []).map(text => el('p', { class: 'atlas-status' }, text)),
    el('div', { class: 'atlas-destinations', role: 'group', 'aria-label': '発見済みの冒険先一覧' }, cards));
}

