"""町・酒場・施設の3分編曲。音符と和声はこの作品用に記述したもの。

旋律の問答、楽器の交代、薄い中間部と再現部で展開を作る。
音声ファイルの引き伸ばしや、短い録音の連結は使用しない。
"""

import re


def pitch(name):
    match = re.fullmatch(r"([A-G])([#b]?)(\d)", name)
    if not match:
        raise ValueError(name)
    letter, accidental, octave = match.groups()
    return (int(octave) + 1) * 12 + {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}[letter] + {"": 0, "#": 1, "b": -1}[accidental]


# 低音と中声部を別に指定し、転回形の滑らかな動きを保つ。
CHORDS = {
    "C": ("C3", "E4 G4 C5"), "C/E": ("E3", "E4 G4 C5"),
    "Cmaj7": ("C3", "E4 G4 B4"), "C7": ("C3", "E4 G4 Bb4"),
    "G": ("G2", "D4 G4 B4"), "G/B": ("B2", "D4 G4 B4"),
    "G7": ("G2", "D4 F4 B4"), "Gm7": ("G2", "D4 F4 Bb4"),
    "Am": ("A2", "E4 A4 C5"), "Am7": ("A2", "E4 G4 C5"),
    "Em": ("E3", "E4 G4 B4"), "Em7": ("E3", "D4 G4 B4"),
    "F": ("F3", "F4 A4 C5"), "F/A": ("A2", "F4 A4 C5"),
    "Fmaj7": ("F3", "E4 A4 C5"), "Dm": ("D3", "F4 A4 D5"),
    "Dm7": ("D3", "F4 A4 C5"), "D": ("D3", "D4 F#4 A4"),
    "D/F#": ("F#2", "D4 F#4 A4"), "D7": ("D3", "C4 F#4 A4"),
    "Bm": ("B2", "D4 F#4 B4"), "A7": ("A2", "C#4 G4 A4"),
    "Bb": ("Bb2", "D4 F4 Bb4"), "Bbmaj7": ("Bb2", "D4 F4 A4"),
}


def _score(track_id, title, bpm, beats_per_bar, bars):
    return dict(id=track_id, title=title, bpm=bpm, beats_per_bar=beats_per_bar,
                bars=bars, sections=[], events=[])


def _event(score, beat, duration, note, instrument, velocity, pan=0):
    if isinstance(note, str):
        note = pitch(note)
    if duration <= 0 or not 0 <= beat < score["bars"] * score["beats_per_bar"]:
        raise ValueError((beat, duration))
    score["events"].append(dict(beat=round(beat, 5), duration=round(duration, 5),
                                note=note, instrument=instrument,
                                velocity=round(velocity, 4), pan=pan))


def _melody(score, bar, phrase, instrument, velocity, pan=0, transpose=0):
    beat = bar * score["beats_per_bar"]
    length = 0
    notes = phrase.split()
    for index, token in enumerate(notes):
        name, value = token.split(":")
        duration = float(value)
        if name != "_":
            # 長い音は保ち、短い音には息継ぎを作る。機械的な同音量を避ける。
            gate = .94 if duration >= 1.5 else .83
            phrase_gain = 1 - .045 * (index % 3)
            _event(score, beat + length, duration * gate, pitch(name) + transpose,
                   instrument, velocity * phrase_gain, pan)
        length += duration
    if abs(length - score["beats_per_bar"]) > .00001:
        raise ValueError((score["id"], bar, phrase, length))


def _chord(name):
    root, voices = CHORDS[name]
    return pitch(root), [pitch(n) for n in voices.split()]


def _town_accompaniment(score, bar, chord, mood, variation):
    start = bar * 4
    root, voices = _chord(chord)
    quiet = mood in ("intro", "bridge", "coda")
    weight = .68 if quiet else 1
    _event(score, start, 1.75, root, "bass", .43 * weight, -.02)
    _event(score, start + 2, 1.65, root + (7 if bar % 2 == 0 else 12), "bass", .34 * weight, -.02)
    if mood in ("bridge", "return"):
        for i, note in enumerate(voices):
            _event(score, start, 3.85, note, "strings", .12 if mood == "return" else .10, -.32 + .29 * i)
    # 一小節ごとに単純な上昇音型を回さず、二小節の問いと答えにする。
    pattern = [(0, 0), (1.5, 1), (2.5, 2), (3.5, 1)] if bar % 2 == 0 else [(0.5, 1), (1.5, 2), (2.5, 0), (3.25, 1)]
    if quiet:
        pattern = pattern[:2] + ([(3, 2)] if bar % 2 == 0 else [])
    for offset, index in pattern:
        _event(score, start + offset, .38 if not quiet else .65, voices[index], "pluck", .25 * weight, -.35)
    if not quiet:
        for offset in (0, 1, 2, 3):
            _event(score, start + offset, .08, 0, "shaker", .12 if offset % 2 else .16, .38)
        for offset in (1, 3):
            _event(score, start + offset, .08, 0, "rim", .16, .16)
    # 再現部だけに低めの応答旋律。主旋律をオクターブで重ねない。
    if mood == "return" and bar % 4 in (1, 3):
        for offset, index in ((2.5, 1), (3, 0), (3.5, 2)):
            _event(score, start + offset, .38, voices[index] - 12, "clarinet", .24, .30)
    if variation and mood == "B" and bar % 4 == 3:
        _event(score, start + 3, .55, voices[-1] + 12, "bell", .18, .4)


TOWN_A = [
    "E5:1 G5:.5 A5:.5 G5:1 E5:1",
    "D5:1 G5:1 F5:.5 E5:.5 D5:1",
    "C5:.5 E5:.5 A5:1 G5:.5 E5:.5 C5:1",
    "B4:1 E5:1 G5:1 _:1",
    "A4:.5 C5:.5 F5:1 E5:.5 F5:.5 A5:1",
    "G5:1 E5:1 C5:1 D5:1",
    "F5:1 E5:.5 D5:.5 A4:1 C5:.5 D5:.5",
    "D5:1 B4:1 G4:1 _:1",
    "E5:.5 G5:.5 A5:1 G5:.5 E5:.5 D5:1",
    "G5:1 D5:.5 E5:.5 D5:1 B4:1",
    "C5:1 E5:.5 G5:.5 A5:1 G5:1",
    "E5:1 B4:.5 D5:.5 E5:1 _:1",
    "F5:.5 A5:.5 G5:1 F5:.5 E5:.5 C5:1",
    "D5:.5 E5:.5 F5:1 G5:1 D5:1",
    "E5:1 D5:.5 C5:.5 C5:1.5 _:.5",
    "B4:.5 D5:.5 F5:1 D5:1 _:1",
]
TOWN_B = [
    "C5:1 F5:1 A5:1 G5:1", "E5:1 G5:1 C5:1 _:1",
    "F5:1 A5:.5 G5:.5 F5:1 D5:1", "E5:1 G5:.5 A5:.5 G5:1 E5:1",
    "D5:.5 F5:.5 A5:1 G5:1 F5:1", "E5:.5 G5:.5 B4:1 D5:1 E5:1",
    "F5:1 E5:1 D5:1 A4:1", "B4:1 D5:1 G5:1 _:1",
    "A5:1 G5:.5 F5:.5 E5:1 F5:1", "G5:1 E5:1 C5:1 _:1",
    "A5:.5 G5:.5 F5:1 D5:1 F5:1", "E5:1 C5:.5 D5:.5 E5:1 G5:1",
    "F5:1 A5:1 G5:.5 F5:.5 E5:1", "D5:1 G5:1 F5:1 D5:1",
    "E5:1 G5:.5 E5:.5 C5:1.5 _:.5", "D5:1 B4:1 D5:1 _:1",
]
TOWN_BRIDGE = [
    "E5:2 C5:1 _:1", "B4:1 E5:2 _:1", "C5:2 A4:1 C5:1", "D5:2 B4:1 _:1",
    "A4:1 C5:1 F5:1 E5:1", "E5:2 C5:1 _:1", "D5:1 F5:1 A5:1 F5:1", "D5:2 G4:1 _:1",
    "A4:1 C5:1 D5:1 F5:1", "E5:1 C5:1 E5:1 G5:1", "F5:1 D5:1 C5:1 A4:1", "B4:1 D5:1 G5:1 _:1",
]


def town_score():
    score = _score("town-square", "旅立ちの広場", 96, 4, 72)
    a_chords = "C G/B Am Em F C/E Dm G C G/B Am Em F G C G7".split()
    b_chords = "F C/E Dm Am Dm Em F G F C/E Dm Am F G C G7".split()
    bridge_chords = "Am Em F G F C/E Dm G F C/E Dm G7".split()
    intro = ["_:2 E5:.5 G5:.5 E5:1", "D5:1 B4:1 _:2", "A4:1 C5:1 F5:1 _:1", "D5:1 G4:1 B4:1 _:1"]
    coda = ["E5:1 G5:1 E5:1 _:1", "D5:1 B4:1 G4:1 _:1", "C5:1 E5:1 A5:1 G5:1", "E5:2 B4:1 _:1",
            "F5:1 E5:1 C5:1 _:1", "E5:1 D5:1 C5:1 _:1", "F5:1 D5:1 A4:1 C5:1", "B4:1 D5:1 G4:1 _:1"]
    form = [
        ("朝の広場", "intro", "C G/B F G7".split(), intro),
        ("旅立ちの主題", "A", a_chords, TOWN_A),
        ("石畳の向こう", "B", b_chords, TOWN_B),
        ("木陰の休息", "bridge", bridge_chords, TOWN_BRIDGE),
        ("仲間と歩く", "return", a_chords, TOWN_A),
        ("広場への帰路", "coda", "C G/B Am Em F C/E Dm G7".split(), coda),
    ]
    bar = 0
    for name, mood, chords, melody in form:
        score["sections"].append(dict(name=name, start_bar=bar, bars=len(chords)))
        for local, (chord, phrase) in enumerate(zip(chords, melody, strict=True)):
            _town_accompaniment(score, bar, chord, mood, local >= 8)
            instrument = "clarinet" if mood == "bridge" else "flute"
            _melody(score, bar, phrase, instrument, .52 if mood in ("A", "B", "return") else .40, .05)
            bar += 1
    return _finish(score, bar)


TAVERN_A = [
    "B4:.5 D5:.5 G5:1 D5:1", "F#5:.5 E5:.5 D5:1 A4:1", "B4:1 E5:.5 F#5:.5 G5:1", "F#5:1 D5:1 _:1",
    "E5:.5 D5:.5 C5:1 G4:1", "B4:.5 A4:.5 G4:1 B4:1", "C5:1 E5:1 D5:.5 C5:.5", "A4:1 F#4:1 _:1",
    "G4:.5 B4:.5 D5:1 G5:1", "F#5:1 E5:.5 D5:.5 A4:1", "G5:.5 F#5:.5 E5:1 B4:1", "D5:1 F#5:1 _:1",
    "E5:1 G5:.5 E5:.5 C5:1", "D5:1 B4:.5 A4:.5 G4:1", "A4:.5 C5:.5 D5:1 F#5:1", "G5:1.5 D5:.5 _:1",
]
TAVERN_A2 = [
    "D5:.5 G5:.5 B4:1 D5:1", "A4:.5 D5:.5 F#5:1 E5:.5 D5:.5", "E5:1 B4:.5 D5:.5 E5:1", "F#5:.5 E5:.5 D5:1 B4:1",
    "C5:.5 E5:.5 G5:1 E5:1", "D5:.5 B4:.5 G4:1 B4:1", "A4:1 C5:.5 E5:.5 D5:1", "C5:.5 A4:.5 F#4:1 _:1",
    "B4:1 G5:.5 F#5:.5 D5:1", "F#5:1 D5:.5 A4:.5 D5:1", "B4:.5 E5:.5 G5:1 F#5:.5 E5:.5", "D5:1 B4:1 _:1",
    "E5:.5 G5:.5 E5:1 C5:1", "B4:1 D5:1 G5:1", "F#5:1 E5:.5 D5:.5 C5:1", "B4:1 G4:1 _:1",
]
TAVERN_B = [
    "B4:1 E5:1 G5:1", "F#5:1 D5:.5 B4:.5 D5:1", "E5:1 G5:1 E5:1", "D5:1 B4:1 _:1",
    "C5:.5 E5:.5 A5:1 G5:1", "F#5:1 E5:1 C5:1", "B4:.5 D5:.5 G5:1 F#5:.5 E5:.5", "D5:2 _:1",
    "G5:1 E5:.5 D5:.5 B4:1", "D5:1 F#5:1 D5:1", "E5:.5 G5:.5 E5:1 C5:1", "D5:1 B4:1 G4:1",
    "A4:1 C5:1 E5:1", "F#5:.5 E5:.5 D5:1 C5:1", "B4:1 A4:.5 G4:.5 B4:1", "A4:1 F#4:1 _:1",
]


def _tavern_accompaniment(score, bar, chord, mood):
    start = bar * 3
    root, voices = _chord(chord)
    hush = mood in ("hush", "intro", "coda")
    _event(score, start, .87, root, "bass", .40 if not hush else .29, -.12)
    for beat in (1, 2):
        for i, note in enumerate(voices):
            _event(score, start + beat + i * .018, .48, note, "pluck", (.15 if not hush else .11) * (1 if beat == 1 else .88), -.40 + i * .32)
    if not hush:
        _event(score, start + 1, .08, 0, "rim", .15, .25)
        for beat in (.5, 1.5, 2.5):
            _event(score, start + beat, .08, 0, "shaker", .12, .35)
    if mood == "B":
        for i, note in enumerate(voices[:2]):
            _event(score, start, 2.8, note - 12, "strings", .09, -.3 + i * .6)
    if mood == "return" and bar % 4 == 2:
        _event(score, start + 2, .72, voices[0] + 12, "bell", .20, .37)


def tavern_score():
    score = _score("guild-tavern", "灯火亭のワルツ", 96, 3, 96)
    a_chords = "G D/F# Em Bm C G/B Am D7 G D/F# Em Bm C G D7 G".split()
    b_chords = "Em Bm C G Am D7 G D Em Bm C G Am D7 G D7".split()
    intro = ["_:1 B4:1 D5:1", "A4:1 F#4:1 _:1", "G4:1 B4:1 E5:1", "D5:2 _:1",
             "E5:1 C5:1 G4:1", "B4:1 G4:1 _:1", "C5:.5 A4:.5 D5:1 C5:1", "A4:1 F#4:1 _:1"]
    hush = ["E5:2 _:1", "D5:1 B4:1 _:1", "C5:1 E5:1 G5:1", "D5:2 _:1",
            "C5:1 A4:1 _:1", "A4:1 C#5:1 E5:1", "F#5:1 E5:1 D5:1", "C5:1 A4:1 _:1"]
    bridge = ["E5:1 G5:.5 E5:.5 C5:1", "D5:1 F#5:1 A4:1", "B4:.5 D5:.5 G5:1 D5:1", "B4:1 G4:1 _:1",
              "A4:.5 C5:.5 E5:1 D5:1", "C5:1 A4:1 C#5:1", "D5:1 F#5:.5 E5:.5 D5:1", "C5:1 A4:1 _:1"]
    coda = ["B4:1 D5:1 G5:1", "F#5:1 D5:1 _:1", "E5:1 B4:1 G4:1", "D5:2 _:1",
            "E5:1 C5:1 G4:1", "D5:1 B4:1 G4:1", "C5:1 E5:1 C5:1", "A4:1 F#4:1 _:1"]
    form = [
        ("扉を開けて", "intro", "G D Em Bm C G Am D7".split(), intro),
        ("冒険者のワルツ", "A", a_chords, TAVERN_A),
        ("隣の卓の返事", "A2", a_chords, TAVERN_A2),
        ("旅の語り部", "B", b_chords, TAVERN_B),
        ("暖炉のそば", "hush", "C G/B Am G Am A7 D D7".split(), hush),
        ("笑い声が戻る", "bridge", "C D7 G G/B Am A7 D D7".split(), bridge),
        ("仲間の乾杯", "return", a_chords, TAVERN_A2),
        ("灯火の輪", "coda", "G D/F# Em Bm C G/B Am D7".split(), coda),
    ]
    bar = 0
    for name, mood, chords, melody in form:
        score["sections"].append(dict(name=name, start_bar=bar, bars=len(chords)))
        for local, (chord, phrase) in enumerate(zip(chords, melody, strict=True)):
            _tavern_accompaniment(score, bar, chord, mood)
            instrument = "flute" if mood in ("A2", "hush") else "clarinet"
            _melody(score, bar, phrase, instrument, .49 if mood not in ("hush", "intro", "coda") else .36, -.02)
            if mood == "return" and local % 8 >= 4:
                root, voices = _chord(chord)
                _event(score, bar * 3 + 2, .7, voices[1] - 12, "flute", .25, .32)
            bar += 1
    return _finish(score, bar)


FACILITY_A = [
    "A4:1 C5:1 F5:1 _:1", "E5:2 C5:1 _:1", "F5:1 E5:1 D5:1 A4:1", "C5:2 E5:1 _:1",
    "D5:1 F5:1 A5:1 F5:1", "C5:2 A4:1 _:1", "Bb4:1 D5:1 F5:1 D5:1", "E5:2 C5:1 _:1",
    "F5:1 C5:.5 A4:.5 C5:1 _:1", "E5:1 G5:1 E5:1 C5:1", "D5:2 A4:1 C5:1", "E5:1 C5:1 A4:1 _:1",
    "F5:1 D5:1 Bb4:1 D5:1", "C5:1 A4:1 F4:1 _:1", "D5:1 E5:1 G5:1 E5:1", "F5:2 C5:1 _:1",
]
FACILITY_B = [
    "A4:1 D5:1 F5:1 E5:1", "D5:2 Bb4:1 _:1", "A4:1 C5:1 F5:1 A5:1", "G5:1 E5:1 C5:1 _:1",
    "E5:1 C5:1 B4:1 C5:1", "D5:1 F5:1 A5:1 F5:1", "D5:1 F5:1 Bb4:1 _:1", "C5:1 E5:1 G5:1 E5:1",
    "F5:1 D5:1 Bb4:1 A4:1", "G4:1 C5:1 E5:1 _:1", "F5:1 C5:1 A4:1 F4:1", "E4:1 G4:1 C5:1 _:1",
]
FACILITY_BRIDGE = [
    "D5:2 A4:1 _:1", "Bb4:1 D5:2 _:1", "C5:1 E5:1 G5:1 E5:1", "E5:1 C5:2 _:1",
    "D5:1 A4:1 F4:1 A4:1", "Bb4:1 D5:1 F5:1 D5:1", "E5:2 D5:1 C5:1", "G4:1 C5:1 E5:1 _:1",
]


def _facility_accompaniment(score, bar, chord, mood):
    start = bar * 4
    root, voices = _chord(chord)
    quiet = mood in ("intro", "bridge", "coda")
    _event(score, start, 3.7, root, "bass", .27 if quiet else .32, 0)
    for i, note in enumerate(voices):
        _event(score, start + .035 * i, 3.75, note, "strings", .09 if quiet else .11, -.45 + i * .40)
    pattern = [(0.5, 0), (2.5, 1)] if quiet else [(0.5, 0), (1.5, 2), (2.5, 1), (3.5, 2)]
    for offset, index in pattern:
        _event(score, start + offset, .4, voices[index], "pluck", .18 if quiet else .20, -.35)
    if mood == "return" and bar % 4 in (1, 3):
        _event(score, start + 2, 1.5, voices[0] - 12, "clarinet", .19, .30)
    if mood == "B" and bar % 2:
        _event(score, start + 3, .7, voices[1] + 12, "bell", .16, .40)


def facility_score():
    score = _score("town-facility", "小さな工房の午後", 80, 4, 60)
    a_chords = "Fmaj7 C/E Dm7 Am7 Bb F/A Gm7 C7 Fmaj7 C/E Dm7 Am7 Bb F/A C7 F".split()
    intro = ["_:2 A4:1 C5:1", "G4:1 C5:1 E5:1 _:1", "F5:2 D5:1 A4:1", "G4:1 C5:2 _:1"]
    coda = ["A4:1 C5:1 F5:1 _:1", "F5:1 D5:1 Bb4:1 _:1", "A4:1 C5:1 F4:1 _:1", "G4:1 C5:1 E5:1 _:1"]
    # 再現部は一部を装飾し、最初のベルの主題を笛へ受け渡す。
    reprise = list(FACILITY_A)
    reprise[0] = "A4:.5 C5:.5 F5:1 G5:.5 F5:.5 C5:1"
    reprise[4] = "D5:1 F5:.5 G5:.5 A5:1 F5:1"
    reprise[8] = "F5:1 E5:.5 D5:.5 C5:1 A4:1"
    reprise[14] = "D5:.5 E5:.5 G5:1 E5:1 C5:1"
    form = [
        ("窓から差す光", "intro", "Fmaj7 C/E Dm7 C7".split(), intro),
        ("穏やかな手仕事", "A", a_chords, FACILITY_A),
        ("棚に眠る物語", "B", "Dm7 Bb F C Am7 Dm7 Bb C Gm7 C7 F C7".split(), FACILITY_B),
        ("ひと息のお茶", "bridge", "Bbmaj7 Gm7 C7 Am7 Dm7 Gm7 C7 C7".split(), FACILITY_BRIDGE),
        ("仕上げのひと針", "return", a_chords, reprise),
        ("また明日へ", "coda", "Fmaj7 Bb F/A C7".split(), coda),
    ]
    bar = 0
    for name, mood, chords, melody in form:
        score["sections"].append(dict(name=name, start_bar=bar, bars=len(chords)))
        for chord, phrase in zip(chords, melody, strict=True):
            _facility_accompaniment(score, bar, chord, mood)
            instrument = "flute" if mood in ("bridge", "return") else "bell"
            _melody(score, bar, phrase, instrument, .39 if instrument == "flute" else .36, .05)
            bar += 1
    return _finish(score, bar)


def _finish(score, bars):
    assert bars == score["bars"], (score["id"], bars)
    end = bars * score["beats_per_bar"]
    for event in score["events"]:
        assert event["beat"] + event["duration"] <= end + 1e-6, event
        assert 0 < event["velocity"] <= 1, event
    score["events"].sort(key=lambda event: (event["beat"], event["instrument"], event["note"]))
    return score


def build_scores():
    return [town_score(), tavern_score(), facility_score()]
