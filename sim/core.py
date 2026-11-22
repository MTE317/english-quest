"""キャラ・敵・調整つまみ"""
import random
import db
from db import JOBS, WEAPONS, ARMOR_W, BY_JOB, STAGE_AP, TIER

T = dict(
    mercy=0.0, wipe_xp_keep=0.0, farm_after_wipe=2, e_hp=1.478, hp0=150, hp1=6.5, s0=15, s1=4.5, s2=0.22, e_atk=1.62, boss_hp=4.5, boss_atk=1.25,
    hp_rank_mul={1: 1.6, 2: 2.34, 3: 2.14, 4: 2.16, 5: 2.18, 6: 2.87, 7: 2.86, 8: 3.05, 9: 3.01, 10: 2.78, 11: 2.84, 12: 3.07},   # ★ごとの敵HP補正（★12版で前線から調整）
    atk_rank_mul={1: 1.491, 2: 2.06, 3: 1.909, 4: 1.924, 5: 1.939, 6: 2.45, 7: 2.443, 8: 2.58, 9: 2.551, 10: 2.385, 11: 2.428, 12: 2.595},
    enh_base=1.8, elite_rate=0.08, xp_k=1.0, xp_pen=0.25, xp_pen_min=0.0, xp_free=1, rank_cap=0, lv_margin=0, mp_regen=0.10, mp_atk=0.05, mp_lv=0.015,
    acc_drop=db.BAL.get("accuracy_drop_per_rank", 0.03),
    borrow=1,            # ほかのジョブのスキルを持ち出す
    mastery_gate=1,      # 熟練度による装備条件
    gate_div=6, gate_base=15,
    items_in_battle=1,
    flee=0,              # 逃げる（遊び方で切り替え）
    song=0.30, whip=0.5,
)
G = {"A": 4, "B": 3, "C": 2, "D": 1}
STATS = ["HP", "STR", "MAG", "DEF", "RES", "SPD", "LUK"]
APT = {"S": 1.2, "A": 1.0, "B": 0.85, "C": 0.7}
def rnd(rng, a, b): return a + rng.random() * (b - a)
def xp_need(lv): return round(25 * lv ** 1.5)

def learned(job, ap):
    costs = STAGE_AP[TIER[job]]; left = ap
    out = [s for s in BY_JOB[job] if s["stage"] == 1]
    for st in range(2, 6):
        for s in BY_JOB[job]:
            if s["stage"] == st and left >= costs[st - 1]: left -= costs[st - 1]; out.append(s)
    return out

def loadout(cur_job, ap_by_job, borrow=True, cap_a=10, cap_p=10):
    L = []
    for j, ap in ap_by_job.items():
        if j == cur_job or borrow:
            for s in learned(j, ap):
                if s["final"] and j != cur_job: continue
                L.append(s)
    acts0 = [s for s in L if s["k"] not in ("passive", "util")]
    fin = [s for s in acts0 if s["final"]]
    heals = sorted([s for s in acts0 if s["k"] in ("heal", "healall", "revive") and not s["final"]], key=lambda s: -s["stage"])
    cheap = sorted([s for s in acts0 if s["k"] == "atk" and s["cost"] == 1 and not s["final"] and s not in heals], key=lambda s: -s.get("m", 0))[:1]
    rest = sorted([s for s in acts0 if s not in fin and s not in cheap and s not in heals],
                  key=lambda s: (s["job"] != cur_job, -s["stage"], s["k"] != "atk", s["cost"]))
    pas = sorted([s for s in L if s["k"] == "passive"], key=lambda s: (s["job"] != cur_job, -s["stage"]))
    A, P, ca, cp = [], [], 0, 0
    seen = set()
    for s in fin + heals[:2] + cheap + rest:
        if s["name"] in seen: continue
        if ca + s["cost"] <= cap_a: A.append(s); ca += s["cost"]; seen.add(s["name"])
    for s in pas:
        if s["name"] in seen: continue
        if cp + s["cost"] <= cap_p: P.append(s); cp += s["cost"]; seen.add(s["name"])
    return A, P

PART_W = 0.53   # 頭・体・腕それぞれ（3つで以前の1.6相当）

class Char:
    def __init__(s, job, name):
        s.job, s.name, s.lv, s.xp = job, name, 1, 0
        s.ap = {job: 0}; s.mastery = {}; s.persist = set(); s.room = {}
        s.A, s.P, s.mods, s._key = [], [], {}, None
        J = JOBS[job]; w0 = J["start_weapon"]; a0 = J["arm"]
        s.weapon = dict(t=w0, ilvl=3, q=1.0, enh=0, aff={}, el=None, src="初期", rar=0)
        s.parts = {p: dict(w=a0, ilvl=3, q=1.0, enh=0, aff={}, src="初期", rar=0) for p in ("head", "body", "arm")}
        s.cloak = dict(ilvl=0, aff={}, src="なし", rar=0)
        s.acc = [dict(aff={}, ilvl=0, src="なし", rar=0), dict(aff={}, ilvl=0, src="なし", rar=0)]
        s.hp = s.maxhp(); s.mp = s.maxmp()
    # ---- スキル
    def refresh(s):
        key = (s.job, tuple(sorted((j, a // 10) for j, a in s.ap.items())), T["borrow"])
        if key == s._key: return
        s._key = key; s.A, s.P = loadout(s.job, s.ap, borrow=bool(T["borrow"])); m = {}
        for p in s.P:
            for k, v in p["mod"].items():
                if k in ("wdmg", "tdmg"): m.setdefault(k, []).append(v)
                elif k == "edmg": m.setdefault("edmg", {}); m["edmg"][v[0]] = m["edmg"].get(v[0], 0) + v[1]
                elif k in ("cover", "fist", "whip"): m[k] = max(m.get(k, 0), v)
                else: m[k] = m.get(k, 0) + v
        s.mods = m
    def change_job(s, job):
        s.job = job; s.ap.setdefault(job, 0); s._key = None
    # ---- 能力値
    def grade(s, k): return G[JOBS[s.job]["g"].split()[STATS.index(k)]]
    def items(s): return [s.weapon] + list(s.parts.values()) + [s.cloak] + s.acc
    def aff(s, k): return sum(i["aff"].get(k, 0) for i in s.items())
    def base(s, k):
        g = s.grade(k)
        v = (70 + g * 30 + (s.lv - 1) * g * 9) if k == "HP" else (8 + g * 6 + (s.lv - 1) * g * 1.6)
        return v + s.aff(k)
    def maxhp(s):
        return max(1, round(s.base("HP") * (1 + T.get("xs", 0)) * (1 + s.room.get("hp", 0) + s.mods.get("hp", 0) + (s.rune.get("HP", 0) if getattr(s, "rune", None) else 0) - (0.2 if "衰弱" in s.persist else 0))))
    def maxmp(s): return round((12 + s.grade("MAG") * 6 + (s.lv - 1) * 2) * (1 + s.room.get("mp", 0)))
    def mastery_lv(s, t=None): return min(10, s.mastery.get(t or s.weapon["t"], 0) // 30)
    def wapt(s, t): return APT.get(JOBS[s.job]["w"].get(t, ""), 0)
    def wpow(s, w=None):
        w = w or s.weapon; wd = WEAPONS[w["t"]]
        apt = s.wapt(w["t"]) or 0.5
        return (8 + 1.6 * w["ilvl"]) * w["q"] * (1 + 0.05 * w["enh"]) * wd.get("pm", 1) * apt * (1 + 0.02 * s.mastery_lv(w["t"]))
    def armor_val(s):
        v = 0
        for p in s.parts.values():
            apt = APT.get(JOBS[s.job]["armor"].get(p["w"], "C"), 0.6)
            v += (6 + 1.3 * p["ilvl"]) * ARMOR_W[p["w"]]["v"] * p["q"] * (1 + 0.05 * p["enh"]) * PART_W * apt
        return v
    def stat(s, k):
        v = s.base(k)
        if k in ("DEF", "RES"): v += s.armor_val()
        if k == "RES" and s.cloak["ilvl"]: v += (6 + 1.3 * s.cloak["ilvl"]) * 0.3
        if k == "SPD": v += sum(ARMOR_W[p["w"]]["spd"] for p in s.parts.values()) / 3 + WEAPONS[s.weapon["t"]].get("spd", 0)
        if k == "DEF": v *= 1 + s.mods.get("def", 0)
        if k == "RES": v *= 1 + s.mods.get("res", 0)
        if k == "MAG": v *= 1 + s.mods.get("mag", 0)
        v *= 1 + T.get("xs", 0)   # 固有・セット・振り直しなどの上乗せ（感度を見るため）
        return v * (1 + s.rune.get(k, 0)) if getattr(s, "rune", None) else v
    def scale(s): return 20 + 6 * s.lv
    def crt(s): return 0.03 + 0.15 * s.stat("LUK") / s.scale() + WEAPONS[s.weapon["t"]].get("crt", 0) + s.aff("CRT") / 100 + s.mods.get("crt", 0)
    def eva(s):
        pe = sum(ARMOR_W[p["w"]]["eva"] for p in s.parts.values()) / 3
        return min(0.45, 0.02 + 0.08 * s.stat("SPD") / s.scale() + pe + s.aff("EVA") / 100 + s.mods.get("eva", 0))
    def sres(s): return min(0.8, 0.25 * s.stat("LUK") / s.scale() + s.room.get("sres", 0) + s.mods.get("sres", 0) + s.aff("STATUS_RES") / 100)
    def gate_ok(s, w):
        if not T["mastery_gate"]: return True
        need = max(0, (w["ilvl"] - T["gate_base"]) // T["gate_div"])
        return s.mastery_lv(w["t"]) >= need
    def gain_xp(s, x):
        x *= 1 + s.mods.get("xp", 0) + s.aff("EXP") / 100 + (s.rune.get("EXP", 0) if getattr(s, "rune", None) else 0)
        if s.lv >= 99: return
        s.xp += x
        while s.xp >= xp_need(s.lv):
            if s.lv >= 99: s.xp = 0; return
            s.xp -= xp_need(s.lv); oh, om = s.maxhp(), s.maxmp(); s.lv += 1
            if s.hp > 0: s.hp += s.maxhp() - oh
            s.mp += s.maxmp() - om

class Enemy:
    def __init__(s, m, L, rng, rank=1, dm=1.0):
        s.m, s.name, s.L, s.boss = m, m["name"], L, m["boss"]
        bh = T["boss_hp"] if s.boss else 1.0; ba = T["boss_atk"] if s.boss else 1.0
        s.maxhp = s.hp = (T["hp0"] + T["hp1"] * L) * m["hp"] * T["e_hp"] * bh * T["hp_rank_mul"].get(rank, 1.0) * dm
        s.STR = (T["s0"] + T["s1"] * L + T["s2"] * L * L) * m["atk"] * ba * dm * T.get("atk_rank_mul", {}).get(rank, 1.0); s.MAG = s.STR
        s.DEF = (6 + 3.2 * L) * m["df"]; s.RES = (6 + 3.2 * L) * m["rs"]
        s.SPD = (10 + 3.6 * L) * m["sp"]
        s.weak, s.resist = m["weak"], m["resist"]; s.types = m["types"]
        s.st_hits = {}
    def em(s, el):
        if el == "無": return 1.0
        if el in s.weak: return 1.5
        if el in s.resist: return 0.5
        return 1.0
