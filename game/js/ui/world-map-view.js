import { el, render } from '../dom.js';
import { drawWorldTerrain } from './world-terrain.js?v=world-map-1';

const STATE_LABELS = { discovered: '発見済み・遠征準備中', accessible: '遠征可能', cleared: '踏破済み' };
const label = (region) => '地域 ' + region.id;

export function createWorldMapView({ world, discoveries, selectedDungeon, dungeonLabel, onDungeon }) {
  const { regions, routes } = world;
  const byId = new Map(regions.map((region) => [region.id, region]));
  const fresh = new Set(discoveries.map(({ id }) => id));
  const heading = el('h2', { class: 'chapter-title', id: 'world-map-heading' }, '世界地図');
  const status = el('p', { class: 'atlas-status', role: 'status' }, discoveries.length
    ? '新しい地域を発見　' + discoveries.map(label).join('、')
    : '地域を選ぶと遠征先が表示されます。');
  const surface = el('div', { class: 'atlas-surface' });
  const viewport = el('div', {
    class: 'atlas-viewport', tabindex: '0', role: 'region', 'aria-label': '地図をスクロール',
  }, surface);
  const detail = el('div', { class: 'atlas-detail', id: 'atlas-destinations' });
  const regionSelect = el('select', { class: 'select', onchange: () => {
    const region = byId.get(regionSelect.value);
    openRegion(region);
    centerRegion(region);
  } }, regions.map((region) => el('option', { value: region.id },
    label(region) + ' ・ ' + STATE_LABELS[region.state])));

  const terrain = el('canvas', { class: 'atlas-terrain', 'aria-hidden': 'true' });
  drawWorldTerrain(terrain, regions);
  surface.append(terrain);
  if (fresh.size && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const fog = el('canvas', { class: 'atlas-terrain atlas-fog', 'aria-hidden': 'true' });
    drawWorldTerrain(fog, regions.filter(({ id }) => !fresh.has(id)));
    fog.addEventListener('animationend', () => fog.remove(), { once: true });
    surface.append(fog);
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('atlas-routes');
  for (const [a, b] of routes) {
    const line = document.createElementNS(svg.namespaceURI, 'line');
    for (const [i, id] of [[1, a], [2, b]]) {
      line.setAttribute('x' + i, byId.get(id).x + '%');
      line.setAttribute('y' + i, byId.get(id).y + '%');
    }
    if (fresh.has(a) || fresh.has(b)) line.classList.add('atlas-new-route');
    svg.append(line);
  }
  surface.append(svg);
  const markers = new Map(regions.map((region) => {
    const marker = el('button', {
      class: 'atlas-marker' + (fresh.has(region.id) ? ' atlas-new-marker' : ''),
      type: 'button', 'aria-label': label(region) + ' ・ ' + STATE_LABELS[region.state],
      'aria-controls': 'atlas-destinations', 'data-state': region.state,
      style: '--x:' + region.x + '%;--y:' + region.y + '%',
      onclick: (event) => {
        openRegion(region);
        if (event.detail === 0) detail.querySelector('h3').focus();
      },
    }, el('span', { 'aria-hidden': 'true' }, region.id));
    surface.append(marker);
    return [region.id, marker];
  }));

  function openRegion(region) {
    regionSelect.value = region.id;
    for (const [id, marker] of markers) marker.setAttribute('aria-pressed', String(id === region.id));
    const groups = [['常設の遠征', false], ['季節の遠征', true]];
    render(detail, el('h3', { tabindex: '-1' }, label(region), el('small', {}, STATE_LABELS[region.state])),
      region.dungeons.length ? groups.map(([title, seasonal]) => {
        const entries = region.dungeons.filter(({ kind }) => Boolean(kind?.includes('季節')) === seasonal);
        return entries.length ? el('div', { class: 'atlas-dungeon-group' },
          el('h4', {}, title), entries.map((dungeon) => el('button', {
            type: 'button', onclick: () => onDungeon(dungeon.id),
          }, dungeonLabel(dungeon)))) : null;
      }) : el('p', { class: 'muted small' }, '遠征できるようになると、ここに行き先が表示されます。'));
  }

  function centerRegion(region) {
    viewport.scrollTo(surface.offsetWidth * region.x / 100 - viewport.clientWidth / 2,
      surface.offsetHeight * region.y / 100 - viewport.clientHeight / 2);
  }

  let scale = 1;
  const zoomOut = el('button', { type: 'button', 'aria-label': '地図を縮小', onclick: () => zoom(-0.5) }, '−');
  const zoomIn = el('button', { type: 'button', 'aria-label': '地図を拡大', onclick: () => zoom(0.5) }, '＋');
  const zoomReset = el('button', { type: 'button', 'aria-label': '地図を全体表示に戻す', onclick: () => zoom(1 - scale) }, '100%');
  function zoom(step) {
    scale = Math.max(1, Math.min(2.5, scale + step));
    surface.style.width = scale * 100 + '%';
    surface.style.height = scale * 100 + '%';
    zoomReset.textContent = scale * 100 + '%';
    zoomReset.setAttribute('aria-label', '地図 ' + scale * 100 + '%。全体表示に戻す');
    zoomOut.disabled = scale === 1;
    zoomIn.disabled = scale === 2.5;
    centerRegion(byId.get(regionSelect.value));
  }

  const initial = discoveries.at(-1) ?? regions.find(({ dungeons }) => dungeons.some(({ id }) => id === selectedDungeon)) ?? regions[0];
  openRegion(initial);
  zoomOut.disabled = true;
  return el('section', { class: 'atlas', 'aria-labelledby': 'world-map-heading' },
    el('div', { class: 'atlas-header' }, heading,
      el('div', { class: 'atlas-controls', role: 'group', 'aria-label': '地図の倍率' }, zoomOut, zoomReset, zoomIn)),
    status, viewport, el('label', { class: 'atlas-region-picker' }, '発見済みの地域', regionSelect), detail);
}
