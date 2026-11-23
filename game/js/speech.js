// 英語の読み上げ（Web Speech API）。使えないブラウザでは何もしない。
import { setSpeechPlaying } from './battle-music.js?v=music-suite-1';

let activeSpeech;

export function canSpeak() {
  return typeof window !== 'undefined' && Boolean(window.speechSynthesis) &&
    typeof window.SpeechSynthesisUtterance === 'function';
}

function pickVoice(synthesis) {
  const voices = synthesis.getVoices();
  return voices.find((v) => v.lang === 'en-US') ?? voices.find((v) => v.lang?.startsWith('en')) ?? null;
}

export function stopSpeech() {
  if (!activeSpeech) return;
  activeSpeech.finish();
  window.speechSynthesis.cancel();
}

export function speak(text) {
  if (!canSpeak() || !text) return;
  stopSpeech();
  const synthesis = window.speechSynthesis;
  const u = new window.SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  const v = pickVoice(synthesis);
  if (v) u.voice = v;

  function finish() {
    if (activeSpeech?.utterance !== u) return;
    activeSpeech = null;
    setSpeechPlaying(false);
  }
  activeSpeech = { utterance: u, finish };
  u.addEventListener('start', () => {
    if (activeSpeech?.utterance === u) setSpeechPlaying(true);
  }, { once: true });
  u.addEventListener('end', finish, { once: true });
  u.addEventListener('error', finish, { once: true });
  try { synthesis.speak(u); } catch { finish(); }
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', stopSpeech);
