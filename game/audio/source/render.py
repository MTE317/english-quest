#!/usr/bin/env python3
"""English Quest のオリジナルBGMを譜面から再生成する。

必要なもの: Python 3、NumPy、SciPy、FFmpeg（libmp3lame）。
実行例: python game/audio/source/render.py --all
素材音源は使わず、倍音を制限した波形から音色を合成する。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
from functools import lru_cache
from pathlib import Path

import numpy as np
from scipy.signal import butter, sosfilt


SAMPLE_RATE = 44100
OUTPUT = Path(__file__).resolve().parent.parent
PERCUSSION = {"kick", "snare", "hat", "shaker", "rim", "tom", "cymbal"}
GAINS = {
    "flute": 0.205, "clarinet": 0.168, "pulse": 0.148,
    "pluck": 0.180, "bell": 0.140, "strings": 0.095, "bass": 0.235,
    "kick": 0.255, "snare": 0.160, "hat": 0.065, "shaker": 0.060,
    "rim": 0.115, "tom": 0.185, "cymbal": 0.080,
}
RELEASE = {
    "flute": 0.075, "clarinet": 0.065, "pulse": 0.050,
    "pluck": 0.160, "bell": 0.340, "strings": 0.300, "bass": 0.055,
}
SEND = {
    "flute": 0.19, "clarinet": 0.15, "pulse": 0.11,
    "pluck": 0.22, "bell": 0.26, "strings": 0.23, "bass": 0.018,
    "kick": 0.018, "snare": 0.11, "hat": 0.055, "shaker": 0.05,
    "rim": 0.12, "tom": 0.12, "cymbal": 0.15,
}


def envelope(t: np.ndarray, hold: float, attack: float, release: float,
             sustain: float = 0.85, decay: float = 0.12) -> np.ndarray:
    attack = min(attack, max(hold * 0.3, 0.002))
    env = np.minimum(t / attack, 1.0)
    env *= sustain + (1.0 - sustain) * np.exp(-np.maximum(0, t - attack) / decay)
    # 余韻の末尾までゼロに収束させ、次のループに自然に接続する。
    release_phase = np.clip((t - hold) / release, 0, 1)
    env *= 0.5 + 0.5 * np.cos(np.pi * release_phase)
    return env


def partials(phase: np.ndarray, hz: float, harmonics: list[tuple[float, float]]) -> np.ndarray:
    result = np.zeros_like(phase)
    total = 0.0
    for ratio, level in harmonics:
        if hz * ratio >= SAMPLE_RATE * 0.44:
            continue
        result += level * np.sin(phase * ratio)
        total += abs(level)
    return result / max(total, 1.0)


def percussion(instrument: str, duration: float, note: int) -> np.ndarray:
    lengths = {"kick": 0.26, "snare": 0.19, "hat": 0.075,
               "shaker": 0.10, "rim": 0.075, "tom": 0.30, "cymbal": 0.85}
    length = lengths[instrument]
    t = np.arange(math.ceil(length * SAMPLE_RATE), dtype=np.float32) / SAMPLE_RATE
    rng = np.random.default_rng(3517 + note * 17 + sum(map(ord, instrument)))
    noise = rng.uniform(-1, 1, t.size).astype(np.float32)
    if instrument == "kick":
        # クリックを抑えた短い低音。読み上げの子音帯域を空ける。
        phase = 2 * np.pi * (48 * t + 85 * 0.022 * (1 - np.exp(-t / 0.022)))
        wave = np.sin(phase) * np.exp(-t / 0.074)
        wave += 0.09 * noise * np.exp(-t / 0.006)
    elif instrument == "snare":
        band = sosfilt(butter(2, [650, 6100], btype="bandpass", fs=SAMPLE_RATE, output="sos"), noise)
        wave = 0.82 * band * np.exp(-t / 0.046)
        wave += 0.24 * np.sin(2 * np.pi * 178 * t) * np.exp(-t / 0.038)
    elif instrument in {"hat", "shaker", "cymbal"}:
        band = sosfilt(butter(2, [4300, 10500], btype="bandpass", fs=SAMPLE_RATE, output="sos"), noise)
        decay = {"hat": 0.019, "shaker": 0.029, "cymbal": 0.23}[instrument]
        wave = band * np.exp(-t / decay)
        if instrument == "cymbal":
            wave += 0.055 * (np.sin(2 * np.pi * 3749 * t) + np.sin(2 * np.pi * 5311 * t)) * np.exp(-t / 0.16)
    elif instrument == "rim":
        wave = (0.58 * np.sin(2 * np.pi * 720 * t) + 0.32 * np.sin(2 * np.pi * 1160 * t)) * np.exp(-t / 0.012)
        wave += noise * 0.12 * np.exp(-t / 0.008)
    else:
        hz = 120 if note <= 0 else 440 * 2 ** ((note - 69) / 12)
        phase = 2 * np.pi * (hz * t + hz * 0.33 * 0.03 * (1 - np.exp(-t / 0.03)))
        wave = np.sin(phase) * np.exp(-t / 0.085)
    wave *= np.minimum(1, t / 0.0015) * np.minimum(1, (length - t) / 0.012)
    return wave.astype(np.float32)


@lru_cache(maxsize=768)
def voice(instrument: str, note: int, duration: float) -> np.ndarray:
    if instrument in PERCUSSION:
        return percussion(instrument, duration, note)
    release = RELEASE[instrument]
    t = np.arange(math.ceil((duration + release) * SAMPLE_RATE), dtype=np.float32) / SAMPLE_RATE
    hz = 440 * 2 ** ((note - 69) / 12)
    base = 2 * np.pi * hz * t
    # 遅れて入るごく浅いビブラート。大きな揺れ・強い矩形波は避ける。
    vibrato = 0.10 * np.sin(2 * np.pi * 5.1 * t) * np.clip((t - 0.13) / 0.18, 0, 1)
    phase = base + vibrato
    if instrument == "flute":
        wave = partials(phase, hz, [(1, 1), (2, 0.18), (3, 0.07)])
        env = envelope(t, duration, 0.022, release, 0.87)
    elif instrument == "clarinet":
        wave = partials(phase, hz, [(1, 1), (3, 0.32), (5, 0.11), (7, 0.035)])
        env = envelope(t, duration, 0.016, release, 0.78)
    elif instrument == "pulse":
        hs = [(n, float(np.sin(np.pi * n * 0.28) / n) * np.exp(-n / 5.5)) for n in range(1, 11)]
        wave = partials(phase, hz, hs)
        env = envelope(t, duration, 0.009, release, 0.73, 0.07)
    elif instrument == "pluck":
        wave = partials(base, hz, [(1, 1), (2, 0.45), (3, 0.19), (4, 0.065)])
        env = envelope(t, duration, 0.003, release) * np.exp(-t / 0.34)
    elif instrument == "bell":
        wave = np.sin(base) * np.exp(-t / 0.64)
        wave += 0.29 * np.sin(base * 2) * np.exp(-t / 0.31)
        wave += 0.10 * np.sin(base * 3) * np.exp(-t / 0.17)
        wave += 0.026 * np.sin(base * 4.06) * np.exp(-t / 0.10)
        wave /= 1.42
        env = envelope(t, duration, 0.003, release)
    elif instrument == "strings":
        wave = partials(base * 0.9988, hz, [(1, 1), (2, 0.28), (3, 0.12), (4, 0.04)])
        wave += partials(base * 1.0012 + 0.35, hz, [(1, 1), (2, 0.28), (3, 0.12), (4, 0.04)])
        wave *= 0.5
        env = envelope(t, duration, 0.13, release, 0.86, 0.22)
    else:  # bass
        wave = partials(base, hz, [(1, 1), (2, 0.15), (3, 0.08)])
        env = envelope(t, duration, 0.008, release, 0.72, 0.09)
    return (wave * env).astype(np.float32)


def add_wrapped(buffer: np.ndarray, start: int, wave: np.ndarray, left: float, right: float) -> None:
    """最終小節のリリースも先頭へ折り返し、ループ境界の余韻を保つ。"""
    offset = 0
    while offset < wave.size:
        at = (start + offset) % buffer.shape[0]
        count = min(wave.size - offset, buffer.shape[0] - at)
        buffer[at:at + count, 0] += wave[offset:offset + count] * left
        buffer[at:at + count, 1] += wave[offset:offset + count] * right
        offset += count


def validate_score(score: dict) -> None:
    length = score["bars"] * score["beats_per_bar"]
    duration = length * 60 / score["bpm"]
    assert 170 <= duration <= 190, (score["id"], duration)
    assert score["sections"] and score["events"]
    section_end = 0
    for section in score["sections"]:
        assert section["start_bar"] == section_end, (score["id"], section)
        section_end += section["bars"]
    assert section_end == score["bars"]
    for event in score["events"]:
        assert event["instrument"] in GAINS, event
        assert 0 <= event["beat"] < length, event
        assert event["duration"] > 0 and event["beat"] + event["duration"] <= length + 1e-6, event
        assert -1 <= event.get("pan", 0) <= 1 and 0 < event["velocity"] <= 1, event
        assert event["instrument"] in PERCUSSION or 21 <= event["note"] <= 108, event


def render(score: dict) -> np.ndarray:
    validate_score(score)
    seconds_per_beat = 60 / score["bpm"]
    duration = score["bars"] * score["beats_per_bar"] * seconds_per_beat
    count = round(duration * SAMPLE_RATE)
    dry = np.zeros((count, 2), dtype=np.float32)
    wet = np.zeros_like(dry)
    for event in sorted(score["events"], key=lambda event: event["beat"]):
        instrument = event["instrument"]
        wave = voice(instrument, event["note"], round(event["duration"] * seconds_per_beat, 6))
        level = event["velocity"] * GAINS[instrument]
        angle = (event.get("pan", 0) + 1) * np.pi / 4
        left, right = level * math.cos(angle), level * math.sin(angle)
        start = round(event["beat"] * seconds_per_beat * SAMPLE_RATE)
        add_wrapped(dry, start, wave, left, right)
        add_wrapped(wet, start, wave, left * SEND[instrument], right * SEND[instrument])
    voice.cache_clear()
    # 小さな部屋の反射＋テンポ同期の薄いエコー。循環処理なので終端で切れない。
    tone = butter(2, 5200, btype="lowpass", fs=SAMPLE_RATE, output="sos")
    warmup = round(0.1 * SAMPLE_RATE)
    wet = sosfilt(tone, np.concatenate([wet[-warmup:], wet]), axis=0)[warmup:].astype(np.float32)
    reflections = [(0.037, 0.25), (0.061, 0.20), (0.097, 0.15), (0.149, 0.12),
                   (seconds_per_beat * 0.75, 0.17), (seconds_per_beat * 1.5, 0.075)]
    for index, (delay, level) in enumerate(reflections):
        reflection = np.roll(wet, round(delay * SAMPLE_RATE), axis=0)
        dry += reflection[:, ::-1] * level if index % 2 else reflection * level
    # DCを落とし、過度な高域を抑える。先頭に直前の音を渡し、フィルターも連続化。
    for sos in (butter(2, 28, btype="highpass", fs=SAMPLE_RATE, output="sos"),
                butter(2, 11800, btype="lowpass", fs=SAMPLE_RATE, output="sos")):
        dry = sosfilt(sos, np.concatenate([dry[-warmup:], dry]), axis=0)[warmup:].astype(np.float32)
    return dry


def ffmpeg_analyze(pcm: np.ndarray) -> dict:
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-f", "f32le", "-ar", str(SAMPLE_RATE), "-ac", "2", "-i", "pipe:0",
         "-af", "loudnorm=I=-18:TP=-1.5:LRA=9:print_format=json", "-f", "null", "-"],
        input=pcm.tobytes(), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True,
    )
    log = result.stderr.decode()
    return json.loads(log[log.rfind("{"):log.rfind("}") + 1])


def master(pcm: np.ndarray) -> tuple[np.ndarray, dict]:
    stats = ffmpeg_analyze(pcm)
    gain_db = min(-18 - float(stats["input_i"]), -1.6 - float(stats["input_tp"]))
    pcm *= 10 ** (gain_db / 20)
    # 全体の音量だけを揃え、A/B/間奏の強弱はそのまま残す。
    peak = float(np.max(np.abs(pcm)))
    assert 0 < peak < 0.95 and np.all(np.isfinite(pcm))
    stats["applied_gain_db"] = round(gain_db, 3)
    stats["master_peak_dbfs"] = round(20 * math.log10(peak), 3)
    stats["master_lufs"] = round(float(stats["input_i"]) + gain_db, 2)
    return pcm, stats


def encode(pcm: np.ndarray, score: dict, output: Path) -> None:
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SAMPLE_RATE), "-ac", "2", "-i", "pipe:0",
         "-c:a", "libmp3lame", "-b:a", "128k", "-ar", str(SAMPLE_RATE), "-write_xing", "1",
         "-metadata", f"title={score['title']}", "-metadata", "album=English Quest — 3 minute music suite",
         "-metadata", "artist=English Quest", "-metadata", "comment=Original score; synthesized without samples",
         str(output)], input=pcm.tobytes(), check=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tracks", nargs="*", help="再生成するファイル名（拡張子なし）")
    parser.add_argument("--all", action="store_true", help="5曲すべてを再生成")
    parser.add_argument("--check", action="store_true", help="譜面の長さ・イベント範囲だけを検証")
    args = parser.parse_args()
    from peaceful_scores import build_scores as peaceful
    from adventure_scores import build_scores as adventure
    scores = peaceful() + adventure()
    if not args.all and not args.tracks and not args.check:
        parser.error("--all または曲名を指定してください")
    unknown = set(args.tracks) - {score["id"] for score in scores}
    if unknown:
        parser.error(f"不明な曲名: {', '.join(sorted(unknown))}")
    manifest_path = OUTPUT / "music-manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {
        "version": "music-suite-1", "sample_rate": SAMPLE_RATE, "bit_rate_kbps": 128, "tracks": {},
    }
    for score in scores:
        if not (args.all or args.check) and score["id"] not in args.tracks:
            continue
        validate_score(score)
        duration = score["bars"] * score["beats_per_bar"] * 60 / score["bpm"]
        print(f"{score['id']}: {duration:.3f}s / {len(score['events'])} notes / {len(score['sections'])} sections", flush=True)
        if args.check:
            continue
        pcm, stats = master(render(score))
        path = OUTPUT / f"{score['id']}.mp3"
        encode(pcm, score, path)
        manifest["tracks"][score["id"]] = {
            "file": path.name, "title": score["title"], "duration_seconds": duration,
            "bpm": score["bpm"], "beats_per_bar": score["beats_per_bar"], "bars": score["bars"],
            "sections": score["sections"], "loop": True, "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "master_lufs": stats["master_lufs"], "master_peak_dbfs": stats["master_peak_dbfs"],
        }
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        print(f"  {path.name}: {path.stat().st_size:,} bytes, {stats['master_lufs']} LUFS, peak {stats['master_peak_dbfs']} dBFS", flush=True)


if __name__ == "__main__":
    main()
