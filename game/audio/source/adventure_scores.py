"""探索・戦闘の3分編曲。旋律は小節ごとに記述し、再現部の楽器も変える。"""


def _note(events, beat, duration, note, instrument, velocity, pan=0):
    events.append({"beat": round(beat, 6), "duration": round(duration, 6),
                   "note": note, "instrument": instrument,
                   "velocity": round(velocity, 4), "pan": pan})


def _line(events, bar, melody, instrument, velocity, pan=0, transpose=0, gate=.87):
    """(音高,拍数) の列。None は休符。1小節に詰め込みすぎない。"""
    beat = bar * 4
    assert abs(sum(length for _, length in melody) - 4) < .000001
    for number, (pitch, length) in enumerate(melody):
        if pitch is not None:
            accent = 1 if number == 0 else (.94 if number % 2 else .98)
            _note(events, beat, length * gate, pitch + transpose,
                  instrument, velocity * accent, pan)
        beat += length


def _chord(events, bar, pitches, instrument="strings", velocity=.16,
           duration=3.65, start=0, spread=.025):
    for index, pitch in enumerate(pitches):
        _note(events, bar * 4 + start + index * spread,
              min(duration, 4 - start - index * spread), pitch,
              instrument, velocity, (-.32, .28, -.12, .18)[index % 4])


def _bass(events, bar, root, mode, velocity=.4):
    if root < 36:
        root += 12
    if mode == "pedal":
        sequence = [(0, 3.65, root, 1)]
    elif mode == "walk":
        sequence = [(0, .72, root, 1), (1, .55, root + 7, .8),
                    (2, .72, root + 12, .92), (3, .52, root + 7, .75)]
    elif mode == "drive":
        sequence = [(0, .68, root, 1), (.75, .19, root, .66),
                    (1, .7, root, .82), (2, .65, root + 7, .92),
                    (2.75, .19, root + 7, .66), (3, .7, root + 12, .82)]
    elif mode == "sparse":
        sequence = [(0, 1.72, root, 1), (2.5, 1.25, root + 7, .7)]
    else:
        sequence = [(0, 1.65, root, 1), (2, 1.65, root + 7, .82)]
    for offset, length, pitch, scale in sequence:
        _note(events, bar * 4 + offset, length, pitch, "bass", velocity * scale)


def _arpeggio(events, bar, pitches, mode, velocity=.2):
    if mode == "glisten":
        sequence = [(0.5, 0), (1.5, 2), (2.75, 1)]
        length = .85
    elif mode == "answer":
        sequence = [(2, 0), (2.5, 1), (3, 2), (3.5, 1)]
        length = .42
    elif mode == "motor":
        sequence = [(0.5, 0), (1, 1), (1.5, 2), (2.5, 1), (3, 2), (3.5, 1)]
        length = .36
    else:
        sequence = [(0, 0), (1.5, 1), (2.5, 2)]
        length = .62
    for index, (offset, tone) in enumerate(sequence):
        _note(events, bar * 4 + offset, length, pitches[tone % len(pitches)],
              "pluck", velocity * (1 if index % 2 == 0 else .85),
              -.27 if index % 2 else .27)


def _drums(events, bar, mode, intensity=1, fill=False):
    start = bar * 4
    if mode == "cave":
        if bar % 2 == 0:
            _note(events, start + 1.5, .12, 0, "shaker", .12 * intensity, -.35)
            _note(events, start + 3, .12, 0, "shaker", .09 * intensity, .35)
        if bar % 4 == 3:
            _note(events, start + 3.5, .35, 0, "tom", .14 * intensity)
        return
    if mode == "hushed":
        _note(events, start, .3, 0, "kick", .28 * intensity)
        _note(events, start + 2, .12, 0, "rim", .18 * intensity, .12)
        for offset in (.5, 1.5, 2.5, 3.5):
            _note(events, start + offset, .12, 0, "shaker", .13 * intensity,
                  -.25 if offset < 2 else .25)
        return
    _note(events, start, .3, 0, "kick", .58 * intensity)
    _note(events, start + 2, .3, 0, "kick", .45 * intensity)
    if mode == "drive" and bar % 2 == 0:
        _note(events, start + 2.75, .22, 0, "kick", .32 * intensity)
    for offset in (1, 3):
        _note(events, start + offset, .21, 0, "snare", .37 * intensity, .05)
    for eighth in range(8 if mode == "drive" else 4):
        offset = eighth * (.5 if mode == "drive" else 1)
        _note(events, start + offset, .105, 0, "hat",
              (.15 if eighth % 2 else .2) * intensity, -.2)
    if fill:
        for index, offset in enumerate((2.5, 3, 3.5, 3.75)):
            _note(events, start + offset, min(.22, 4 - offset), 0,
                  "tom" if index < 2 else "snare", (.24 + index * .025) * intensity,
                  -.3 + index * .2)


# 根音（ベース用）と、旋律の下に置く和音。短3度と導音の位置を明示する。
_D = {
    "dm": (38, [50, 57, 62, 65]),
    "dmc": (36, [50, 57, 62, 65]),
    "bb": (46, [53, 58, 62, 65]),
    "as": (45, [52, 57, 62, 67]),
    "a": (45, [52, 57, 61, 67]),
    "gm": (43, [50, 55, 58, 62]),
    "dmf": (41, [50, 57, 62, 65]),
    "edim": (40, [50, 55, 58, 64]),
    "f": (41, [53, 57, 60, 64]),
    "c": (36, [52, 55, 60, 62]),
    "ce": (40, [52, 55, 60, 64]),
    "am": (45, [52, 57, 60, 64]),
}

# Dmの探索主題。4小節目と8小節目の休符で、残響と英語の思考を邪魔しない。
_D_A = [
    [(69, 1.5), (72, .5), (74, 1), (None, 1)],
    [(77, 1), (76, .5), (74, .5), (72, 1.5), (None, .5)],
    [(70, 1), (74, 1), (77, 1.5), (76, .5)],
    [(73, 1.5), (69, 1), (None, 1.5)],
    [(70, 1.5), (69, .5), (67, 1), (74, 1)],
    [(69, 1), (65, .5), (69, .5), (72, 1), (74, 1)],
    [(76, 1), (74, 1), (70, 1.5), (None, .5)],
    [(73, .5), (76, .5), (73, 1), (69, 1), (None, 1)],
    [(74, 2), (72, .5), (69, .5), (65, 1)],
    [(69, 1.5), (72, .5), (76, 1), (77, 1)],
    [(77, 1), (74, 1), (70, 1), (None, 1)],
    [(72, .5), (74, .5), (76, 1.5), (79, .5), (76, 1)],
    [(74, 1.5), (70, .5), (67, 2)],
    [(65, 1), (70, 1), (74, 1), (77, 1)],
    [(76, 1), (74, 1.5), (69, .5), (67, 1)],
    [(73, 1.5), (76, .5), (69, 1), (None, 1)],
]
_D_A_CH = ["dm", "dmc", "bb", "a", "gm", "dmf", "edim", "a",
           "dm", "f", "bb", "c", "gm", "bb", "as", "a"]
_D_B = [
    [(72, 1), (77, 1.5), (76, .5), (72, 1)],
    [(74, 1), (76, 1), (79, 1.5), (None, .5)],
    [(77, 1.5), (74, .5), (72, 1), (69, 1)],
    [(72, 2), (76, 1), (None, 1)],
    [(74, 1), (77, 1), (81, 1), (77, 1)],
    [(79, 1.5), (76, .5), (74, 1), (72, 1)],
    [(74, .5), (77, .5), (76, 1), (74, 1.5), (None, .5)],
    [(72, 1), (69, 1.5), (None, 1.5)],
    [(70, 1), (74, 1.5), (77, .5), (74, 1)],
    [(76, 1.5), (74, .5), (70, 1), (67, 1)],
    [(69, 1), (74, 1), (76, 1), (74, 1)],
    [(73, 2), (69, 1), (None, 1)],
]
_D_B_CH = ["f", "ce", "dm", "am", "bb", "c", "dm", "am",
           "gm", "edim", "as", "a"]


def dungeon_score():
    events = []
    sections = [
        {"name": "石の回廊・序奏", "start_bar": 0, "bars": 4},
        {"name": "探索の主題", "start_bar": 4, "bars": 16},
        {"name": "地下の光・副主題", "start_bar": 20, "bars": 12},
        {"name": "遠い足音・間奏", "start_bar": 32, "bars": 8},
        {"name": "探索の主題・再現", "start_bar": 40, "bars": 16},
        {"name": "回廊へ戻る", "start_bar": 56, "bars": 4},
    ]
    for bar, chord in enumerate(["dm", "bb", "gm", "a"]):
        root, pitches = _D[chord]
        _chord(events, bar, pitches, velocity=.115)
        _bass(events, bar, root, "pedal", .29)
        if bar in (0, 2):
            _note(events, bar * 4 + .5, 1.2, (74 if bar == 0 else 70), "bell", .2, .32)
        if bar == 3:
            _line(events, bar, [(None, 2), (69, 1), (73, 1)], "clarinet", .25, -.12)
    for i, chord in enumerate(_D_A_CH):
        bar = 4 + i
        root, pitches = _D[chord]
        _chord(events, bar, pitches, velocity=.115 if i < 8 else .145)
        _bass(events, bar, root, "sparse", .31)
        _line(events, bar, _D_A[i], "clarinet", .41 if i < 8 else .44, -.12)
        if i % 4 in (1, 3):
            _arpeggio(events, bar, [p + 12 for p in pitches[:3]], "glisten", .16)
        _drums(events, bar, "cave", .75)
    for i, chord in enumerate(_D_B_CH):
        bar = 20 + i
        root, pitches = _D[chord]
        _chord(events, bar, pitches, velocity=.155)
        _bass(events, bar, root, "sparse", .32)
        _line(events, bar, _D_B[i], "flute", .46, .13, gate=.91)
        if i % 2 == 0:
            _arpeggio(events, bar, [p + 12 for p in pitches[:3]], "glisten", .18)
        else:
            _line(events, bar, [(pitches[1], 1.5), (pitches[2], 1), (None, 1.5)],
                  "clarinet", .17, -.23)
        if i < 8:
            _drums(events, bar, "hushed", .48)
        else:
            _drums(events, bar, "cave", .65)
    bridge_chords = ["dm", "dmc", "bb", "a", "gm", "bb", "edim", "a"]
    bridge = [
        [(62, 2), (None, 2)], [(65, 1.5), (64, .5), (62, 1), (None, 1)],
        [(65, 2), (70, 1), (None, 1)], [(64, 1.5), (61, .5), (57, 1), (None, 1)],
        [(62, 1), (65, 1), (67, 1), (None, 1)], [(65, 1.5), (70, 1.5), (None, 1)],
        [(64, 1), (67, 1), (70, 1), (None, 1)], [(69, 2), (73, 1), (None, 1)],
    ]
    for i, chord in enumerate(bridge_chords):
        bar = 32 + i
        root, pitches = _D[chord]
        _chord(events, bar, pitches[:3], velocity=.095)
        _bass(events, bar, root, "pedal", .23)
        _line(events, bar, bridge[i], "pluck", .31, -.2, gate=.95)
        if i % 2 == 1:
            _note(events, bar * 4 + 2.5, 1.15, pitches[-1] + 12, "bell", .15, .3)
    for i, chord in enumerate(_D_A_CH):
        bar = 40 + i
        root, pitches = _D[chord]
        _chord(events, bar, pitches, velocity=.15)
        _bass(events, bar, root, "sparse", .34)
        _line(events, bar, _D_A[i], "flute", .43, -.1, gate=.9)
        # 旋律は主題を保ち、低い応答句で再現部を識別できるようにする。
        if i % 4 in (0, 2):
            _line(events, bar, [(None, 1.5), (pitches[1], .5),
                                (pitches[2], 1), (pitches[1], 1)],
                  "clarinet", .22, .22)
        else:
            _arpeggio(events, bar, [p + 12 for p in pitches[:3]], "glisten", .17)
        _drums(events, bar, "hushed" if 8 <= i < 12 else "cave", .5)
    for i, chord in enumerate(["gm", "bb", "as", "a"]):
        bar = 56 + i
        root, pitches = _D[chord]
        _chord(events, bar, pitches, velocity=.12)
        _bass(events, bar, root, "pedal", .26)
        melody = [
            [(70, 1.5), (69, .5), (67, 1), (None, 1)],
            [(65, 1), (70, 1), (74, 1), (None, 1)],
            [(74, 1.5), (69, .5), (67, 1), (None, 1)],
            [(73, 1.5), (69, 1), (None, 1.5)],
        ][i]
        _line(events, bar, melody, "clarinet", .32, -.12)
        if i == 1:
            _note(events, bar * 4 + 2, 1.2, 77, "bell", .13, .25)
    return {"id": "dungeon-depths", "title": "石の回廊と地下の光", "bpm": 80,
            "beats_per_bar": 4, "bars": 60, "sections": sections, "events": events}


_E = {
    "em": (40, [52, 59, 64, 67]),
    "c": (48, [52, 55, 60, 64]),
    "d": (38, [54, 57, 62, 66]),
    "b": (47, [54, 59, 63, 69]),
    "bs": (47, [54, 59, 64, 69]),
    "am": (45, [52, 57, 60, 64]),
    "g": (43, [50, 55, 59, 62]),
    "gd": (38, [50, 55, 59, 62]),
    "bm": (47, [54, 59, 62, 66]),
    "fsharpdim": (42, [54, 57, 60, 64]),
}
_E_A_CH = ["em", "c", "d", "b", "em", "c", "am", "b",
           "em", "g", "d", "c", "am", "c", "bs", "b"]
# 休符・付点・応答句を置いた戦闘のフック。コード追従の上下運動だけにしない。
_E_A = [
    [(71, .5), (71, .5), (76, 1), (74, .5), (71, .5), (67, 1)],
    [(67, .5), (69, .5), (72, 1.5), (71, .5), (67, 1)],
    [(69, .5), (69, .5), (74, 1), (78, .5), (76, .5), (74, 1)],
    [(75, 1), (71, .5), (66, .5), (63, 1), (None, 1)],
    [(67, .5), (71, .5), (76, 1), (79, 1), (78, .5), (76, .5)],
    [(76, 1.5), (72, .5), (71, .5), (67, .5), (64, 1)],
    [(69, .5), (72, .5), (76, 1), (74, .5), (72, .5), (69, 1)],
    [(71, .5), (75, .5), (78, 1), (75, 1), (None, 1)],
    [(76, .5), (74, .5), (71, 1), (67, .5), (71, .5), (76, 1)],
    [(74, 1), (71, .5), (67, .5), (74, 1.5), (76, .5)],
    [(78, .5), (76, .5), (74, 1), (69, .5), (74, .5), (78, 1)],
    [(79, 1), (76, .5), (72, .5), (67, 1), (None, 1)],
    [(69, 1), (72, .5), (76, .5), (74, 1), (72, 1)],
    [(76, .5), (74, .5), (72, 1), (71, .5), (67, .5), (64, 1)],
    [(66, .5), (69, .5), (71, 1), (76, 1), (74, .5), (71, .5)],
    [(75, 1.5), (71, .5), (66, 1), (None, 1)],
]
_E_B_CH = ["g", "d", "em", "bm", "c", "g", "am", "d",
           "g", "d", "em", "c", "am", "c", "bs", "b"]
_E_B = [
    [(74, 1.5), (71, .5), (67, 1), (71, 1)],
    [(69, .5), (74, .5), (78, 2), (76, .5), (74, .5)],
    [(76, 1), (79, 1), (78, .5), (76, .5), (71, 1)],
    [(74, 2), (71, 1), (None, 1)],
    [(72, 1), (76, 1.5), (79, .5), (76, 1)],
    [(74, 1), (71, .5), (67, .5), (71, 1), (74, 1)],
    [(76, 1.5), (72, .5), (69, 1), (72, 1)],
    [(74, 1), (78, 1.5), (76, .5), (74, 1)],
    [(79, 2), (78, .5), (74, .5), (71, 1)],
    [(78, 1), (76, .5), (74, .5), (69, 1), (74, 1)],
    [(76, 1.5), (74, .5), (71, 1), (67, 1)],
    [(72, 1), (76, 1), (79, 1), (None, 1)],
    [(76, .5), (72, .5), (69, 1), (72, 1), (76, 1)],
    [(79, 1), (76, .5), (72, .5), (67, 1), (72, 1)],
    [(74, 1), (76, 1.5), (74, .5), (71, 1)],
    [(75, 2), (71, 1), (None, 1)],
]


def _battle_section(events, start_bar, chords, melodies, version):
    for i, chord in enumerate(chords):
        bar = start_bar + i
        root, pitches = _E[chord]
        lush = version in ("b", "b_return")
        returned = version in ("a_return", "b_return")
        _chord(events, bar, pitches, velocity=.13 if lush else .105,
               duration=3.65 if lush else 1.55)
        if not lush:
            _chord(events, bar, pitches[:3], "pluck", .14, duration=.55, start=2)
        _bass(events, bar, root, "walk" if lush else "drive", .47 if returned else .43)
        _line(events, bar, melodies[i], "clarinet" if lush else "pulse",
              .54 if returned else .5, -.1, gate=.88 if lush else .79)
        if lush:
            # 副主題では細かい刻みを減らし、弦と長い旋律で景色を開く。
            if i % 4 in (0, 2):
                _arpeggio(events, bar, [p + 12 for p in pitches[:3]], "glisten", .2)
            if returned and i % 4 in (1, 3):
                _line(events, bar, [(None, 1), (pitches[1] + 12, 1),
                                    (pitches[2] + 12, 1.5), (None, .5)],
                      "flute", .19, .25)
        else:
            if i % 4 != 3:
                _arpeggio(events, bar, [p + 12 for p in pitches[:3]],
                          "motor" if i % 4 < 2 else "answer", .18 if returned else .16)
            if returned and i % 4 == 3:
                _line(events, bar, [(None, 1), (pitches[2], .5), (pitches[1], .5),
                                    (pitches[0], 1), (None, 1)], "clarinet", .22, .24)
        _drums(events, bar, "beat" if lush else "drive", 1 if returned else .87,
               fill=i in (7, 15))
        if i == 0 or (returned and i == 8):
            _note(events, bar * 4, .75, 0, "cymbal", .25 if returned else .21, .25)


def battle_score():
    events = []
    sections = [
        {"name": "刃を構える・序奏", "start_bar": 0, "bars": 4},
        {"name": "戦いの主題", "start_bar": 4, "bars": 16},
        {"name": "突破の副主題", "start_bar": 20, "bars": 16},
        {"name": "駆け引き・間奏", "start_bar": 36, "bars": 8},
        {"name": "戦いの主題・再現", "start_bar": 44, "bars": 16},
        {"name": "静かな決意・展開部", "start_bar": 60, "bars": 12},
        {"name": "突破の副主題・再現", "start_bar": 72, "bars": 16},
        {"name": "次の一手へ", "start_bar": 88, "bars": 8},
    ]
    intro = [
        [(64, .5), (None, .5), (67, .5), (71, .5), (76, 1), (None, 1)],
        [(64, .5), (None, .5), (67, .5), (72, .5), (76, 1), (None, 1)],
        [(66, .5), (None, .5), (69, .5), (74, .5), (78, 1), (None, 1)],
        [(66, .5), (69, .5), (71, .5), (75, .5), (78, .5), (75, .5), (71, 1)],
    ]
    for bar, chord in enumerate(["em", "c", "d", "b"]):
        root, pitches = _E[chord]
        _bass(events, bar, root, "drive", .41)
        _chord(events, bar, pitches, velocity=.1)
        _line(events, bar, intro[bar], "pulse", .4, -.1, gate=.78)
        _drums(events, bar, "beat", .65 + .08 * bar, fill=bar == 3)
    _battle_section(events, 4, _E_A_CH, _E_A, "a")
    _battle_section(events, 20, _E_B_CH, _E_B, "b")
    interlude_chords = ["em", "d", "c", "b", "am", "c", "bs", "b"]
    interlude = [
        [(64, .5), (67, .5), (71, 1), (None, 1), (67, .5), (64, .5)],
        [(66, .5), (69, .5), (74, 1), (None, 1), (69, .5), (66, .5)],
        [(64, .5), (67, .5), (72, 1), (None, 1), (67, .5), (64, .5)],
        [(63, .5), (66, .5), (71, 1), (None, 1), (66, .5), (63, .5)],
        [(64, 1), (69, 1), (72, 1), (None, 1)],
        [(67, 1), (72, 1), (76, 1), (None, 1)],
        [(66, .5), (69, .5), (71, 1), (74, .5), (76, .5), (74, 1)],
        [(75, 1), (71, .5), (66, .5), (63, 1), (None, 1)],
    ]
    for i, chord in enumerate(interlude_chords):
        bar = 36 + i
        root, pitches = _E[chord]
        _bass(events, bar, root, "walk", .38)
        _line(events, bar, interlude[i], "pluck", .43, -.15)
        _chord(events, bar, pitches[:3], velocity=.08)
        _drums(events, bar, "hushed" if i < 4 else "beat", .62, fill=i == 7)
    _battle_section(events, 44, _E_A_CH, _E_A, "a_return")
    bridge_chords = ["am", "em", "c", "g", "am", "c", "fsharpdim", "b",
                     "am", "c", "bs", "b"]
    bridge = [
        [(69, 2), (72, 1), (76, 1)], [(71, 1.5), (67, .5), (64, 1), (None, 1)],
        [(67, 1), (72, 2), (76, 1)], [(74, 2), (71, 1), (None, 1)],
        [(72, 1), (69, 1.5), (67, .5), (64, 1)], [(67, 1), (72, 1), (76, 2)],
        [(78, 1.5), (76, .5), (72, 1), (69, 1)], [(75, 2), (71, 1), (None, 1)],
        [(69, .5), (72, .5), (76, 1), (79, 1), (76, 1)],
        [(76, .5), (74, .5), (72, 1), (67, 1), (72, 1)],
        [(74, .5), (71, .5), (69, 1), (71, 1), (76, 1)],
        [(75, .5), (78, .5), (75, 1), (71, 1), (None, 1)],
    ]
    for i, chord in enumerate(bridge_chords):
        bar = 60 + i
        root, pitches = _E[chord]
        _chord(events, bar, pitches, velocity=.13 if i < 8 else .15)
        _bass(events, bar, root, "pedal" if i < 4 else "sparse", .34)
        _line(events, bar, bridge[i], "flute" if i < 8 else "clarinet", .39, .1,
              gate=.94)
        if i % 2 == 0:
            _arpeggio(events, bar, [p + 12 for p in pitches[:3]], "glisten", .15)
        if i >= 4:
            _drums(events, bar, "hushed" if i < 8 else "beat", .48 + .025 * i,
                   fill=i == 11)
    _battle_section(events, 72, _E_B_CH, _E_B, "b_return")
    coda_chords = ["em", "c", "d", "b", "am", "c", "bs", "b"]
    for i, chord in enumerate(coda_chords):
        bar = 88 + i
        root, pitches = _E[chord]
        _bass(events, bar, root, "drive" if i < 4 else "walk", .43 - .01 * i)
        _chord(events, bar, pitches, velocity=.11)
        _line(events, bar, _E_A[i] if i < 4 else _E_A[i + 8],
              "pulse" if i < 4 else "clarinet", .45 - .012 * i, -.1)
        _drums(events, bar, "drive" if i < 4 else "beat", .79 - .025 * i,
               fill=i == 3)
        if i < 4:
            _arpeggio(events, bar, [p + 12 for p in pitches[:3]], "answer", .16)
        if i == 7:
            # ループ頭のEmへ戻る短い属和音の呼び込み。最後に無音を長く置かない。
            _note(events, bar * 4 + 3.5, .38, 63, "pluck", .25, .15)
    return {"id": "english-quest-battle", "title": "遺跡を駆ける刃", "bpm": 128,
            "beats_per_bar": 4, "bars": 96, "sections": sections, "events": events}


def build_scores():
    return [dungeon_score(), battle_score()]
