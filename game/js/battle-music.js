import { loadSettings } from './storage.js?v=paid-skills-1';
import './battle-sound.js?v=rune-study-1';

const tracks = {
  town: 'town-square', tavern: 'guild-tavern', facility: 'town-facility', dungeon: 'dungeon-depths',
  battle: 'english-quest-battle', victory: 'english-quest-victory',
};
const revision = 'music-suite-1';
const positionKey = `englishQuest.musicPositions.${revision}`;
const isScene = (scene) => Object.hasOwn(tracks, scene) && scene !== 'victory';
let positions = readPositions();
let player;
let current;
let destination = 'town';
let fanfare = false;
let speechPlaying = false;
let pendingPosition = null;

function readPositions() {
  try {
    const saved = JSON.parse(globalThis.sessionStorage?.getItem(positionKey) || '{}');
    return Object.fromEntries(Object.entries(saved ?? {}).filter(([scene, value]) =>
      isScene(scene) && Number.isFinite(value) && value >= 0));
  } catch {
    // 保存が制限される環境でも、このページ内では続きから再生する。
    return {};
  }
}

function rememberPosition() {
  if (!player || !isScene(current)) return;
  const position = pendingPosition ?? player.currentTime;
  if (!Number.isFinite(position) || position < 0) return;
  positions[current] = position;
  try { globalThis.sessionStorage?.setItem(positionKey, JSON.stringify(positions)); } catch {}
}

function restorePosition() {
  if (pendingPosition == null || !Number.isFinite(player?.duration) || player.duration <= 0) return;
  try {
    player.currentTime = pendingPosition % player.duration;
    pendingPosition = null;
  } catch {
    // メタデータ受信前のシークを拒むブラウザでは、再生可能になってから再試行する。
  }
}

function play() {
  if (!player || loadSettings().music === 'off') return;
  restorePosition();
  if (!player.paused) return;
  try { player.play()?.catch(() => {}); } catch {}
}

function createPlayer() {
  if (player) return true;
  try { player = new Audio(); } catch { return false; }
  // 長い曲を全曲先読みせず、その場面の1曲だけを読み込む。
  player.preload = 'metadata';
  player.addEventListener('loadedmetadata', restorePosition);
  player.addEventListener('canplay', restorePosition);
  player.addEventListener('ended', () => {
    if (!fanfare || current !== 'victory') return;
    fanfare = false;
    select(destination);
  });
  // 自動再生が制限される場合は、ページでの操作時に再試行する。
  globalThis.document?.addEventListener('click', play, { capture: true });
  globalThis.window?.addEventListener('pagehide', () => {
    rememberPosition();
    player.pause();
  });
  globalThis.window?.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    // 戻る操作では、別ページで進んだ同じ曲の再生位置を受け取る。
    positions = { ...positions, ...readPositions() };
    if (isScene(current)) pendingPosition = positions[current] ?? 0;
    fanfare = false;
    select(destination);
  });
  return true;
}

function select(scene, restart = false) {
  if (loadSettings().music === 'off') {
    rememberPosition();
    player?.pause();
    fanfare = false;
    return;
  }
  if (!createPlayer()) return;
  if (current !== scene || restart) {
    rememberPosition();
    player.pause();
    current = scene;
    pendingPosition = scene === 'victory' ? 0 : positions[scene] ?? 0;
    player.loop = scene !== 'victory';
    player.volume = scene === 'victory' ? 0.15 : scene === 'battle' ? 0.3 : 0.23;
    player.src = new URL(`../audio/${tracks[scene]}.mp3?v=${revision}`, import.meta.url).href;
  }
  player.muted = speechPlaying && current !== 'battle';
  play();
}

export function setSceneMusic(scene) {
  if (!isScene(scene)) return;
  destination = scene;
  if (!fanfare || loadSettings().music === 'off') select(scene);
}

export function startBattleMusic() {
  fanfare = false;
  setSceneMusic('battle');
}

export function finishBattleMusic(result) {
  destination = result === 'lose' ? 'town' : 'dungeon';
  fanfare = result === 'win' && loadSettings().music !== 'off';
  // ファンファーレだけは毎回先頭から鳴らし、通常の曲は続きから再開する。
  select(fanfare ? 'victory' : destination, fanfare);
}

export function setSpeechPlaying(playing) {
  speechPlaying = Boolean(playing);
  // 英語音声と戦闘BGMは重ねて流す。その他の場面では従来のミュートを維持する。
  if (player) player.muted = speechPlaying && current !== 'battle';
}

