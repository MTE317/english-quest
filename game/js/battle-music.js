import { loadSettings } from './storage.js?v=features-2';

const battleTrack = new URL('../audio/english-quest-battle.mp3', import.meta.url);
const victoryTrack = new URL('../audio/english-quest-victory.mp3', import.meta.url);

let player;
let screen;

function play() {
  return player.play().catch(() => false);
}

function playBattle() {
  const target = screen;
  // ページを再読み込みして自動再生が拒まれたら、最初のタップで試す。
  target.addEventListener('click', play, { capture: true, once: true });
  play().then((result) => {
    if (result !== false) target.removeEventListener('click', play, true);
  });
}

function stop() {
  screen?.removeEventListener('click', play, true);
  screen = null;
  player?.pause();
}

export function startBattleMusic(target) {
  stop();
  if (loadSettings().music === 'off') return;

  if (!player) {
    player = new Audio();
    player.volume = 0.3;
    window.addEventListener('pagehide', () => player.pause());
    window.addEventListener('pageshow', (event) => {
      if (event.persisted && screen) playBattle();
    });
  }
  screen = target;
  player.src = battleTrack.href;
  player.loop = true;
  player.muted = false;
  playBattle();
}

export function finishBattleMusic(result) {
  if (!screen) return;
  stop();
  if (result !== 'win') return;

  player.src = victoryTrack.href;
  player.loop = false;
  play();
}

export function setBattleSpeechPlaying(playing) {
  if (screen) player.muted = playing;
}
