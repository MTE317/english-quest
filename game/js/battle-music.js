import { loadSettings } from './storage.js?v=features-2';
import './battle-sound.js?v=jrpg-1';

const tracks = {
  town: 'town-square', tavern: 'guild-tavern', facility: 'town-facility', dungeon: 'dungeon-depths',
  battle: 'english-quest-battle', victory: 'english-quest-victory',
};
let player;
let current;
let destination;
let fanfare = false;

function play() {
  if (player?.paused && loadSettings().music !== 'off') player.play().catch(() => {});
}

function select(scene) {
  if (loadSettings().music === 'off') {
    player?.pause();
    return;
  }
  if (!player) {
    player = new Audio();
    player.addEventListener('ended', () => {
      if (!fanfare) return;
      fanfare = false;
      select(destination);
    });
    // 自動再生が制限される場合は、ページでの操作時に再試行する。
    document.addEventListener('click', play, { capture: true });
    window.addEventListener('pagehide', () => player.pause());
    window.addEventListener('pageshow', (event) => { if (event.persisted) play(); });
  }
  if (current !== scene) {
    current = scene;
    player.src = new URL(`../audio/${tracks[scene]}.mp3`, import.meta.url).href;
    player.volume = scene === 'battle' || scene === 'victory' ? 0.3 : 0.23;
    player.loop = scene !== 'victory';
    player.muted = false;
  }
  play();
}

export function setSceneMusic(scene) {
  destination = scene;
  if (!fanfare) select(scene);
}

export function startBattleMusic() {
  fanfare = false;
  setSceneMusic('battle');
}

export function finishBattleMusic(result) {
  destination = result === 'lose' ? 'town' : 'dungeon';
  fanfare = result === 'win' && loadSettings().music !== 'off';
  select(fanfare ? 'victory' : destination);
}

export function setSpeechPlaying(playing) {
  if (player && current !== 'victory') player.muted = playing;
}
