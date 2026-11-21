# ★12版：学習モデル（ルーンストーン・復習・昇格試験・刻印）つきの通しプレイ
import csv, os, random, statistics
from collections import Counter
import db, world
from world import Game, DUNGEONS, ADV, ECON, T
from learn import Learner, QSource

D = db.D
def R(n): return list(csv.DictReader(open(os.path.join(D, n), encoding="utf-8-sig")))
KOKUIN = {int(r["slot"]): float(r["gold"]) for r in R("kokuin_slots.csv")}
RUNE = {r["id"]: dict(stat=r["stat"], per=float(r["per_star"]), rc=int(r["resonance_count"]), rb=float(r["resonance_bonus"]),
                      glow=float(r["glow_bonus"])) for r in R("rune_effects.csv")}
MAIN_STAT = {"黒魔道士": "mag", "白魔道士": "mag", "精霊術士": "mag", "呪術師": "mag", "吟遊詩人": "mag", "薬師": "hp", "ナイト": "def"}

LEARNERS = {   # 学び方のタイプ
    "標準": dict(),
    "苦手": dict(prior0=0.45, prior_drop=0.06, p_new=0.30, grow=1.9),
    "得意": dict(prior0=0.80, prior_drop=0.06, p_new=0.45, grow=2.7),
}

SNAP = None   # 調整用：★ごとに前線15回目の状態を取っておく

class Q(QSource):
    def __init__(s, g, cap, mode): super().__init__(g.L, cap, mode); s.g = g
    def __gt__(s, x):
        s.g.L.set_day(s.g.real_day())
        return s.L.ask(s.cap, s.mode)

class Game12(Game):
    def __init__(s, jobs, minutes=15, learner="標準", seed=0, max_years=10, P=None, **kw):
        super().__init__(jobs, 0.8, seed=seed, max_days=10 ** 9, **kw)
        lp = dict(LEARNERS[learner]); lp.update(P or {})
        s.L = Learner(random.Random(seed * 7 + 1), lp)
        s.qpd = minutes * 6; s.max_real = int(max_years * 365)
        s.s_day = None; s.exam_tried = {}; s.slots = [0] * 4; s.trial_day = {}
        s.G.update(exam_log=[], trials=0, trial_fail=0, train_sessions=0, rank_real=[], kokuin_spend=0, star_real={}, due_log=[])
    def real_day(s): return (s.G["real_q"] + s.S["q"] - s.q_at_run) // s.qpd if s.in_run else s.G["real_q"] // s.qpd
    q_at_run = 0; in_run = False
    def acc_now(s, r): return Q(s, s.tier(), "dungeon")
    # ---------------------------------------------------------------- 鍛錬：日数は進まない。復習を優先
    def train(s):
        c = min(s.party, key=lambda c: (c.lv, c.xp))
        s.L.set_day(s.real_day())
        ok = sum(s.L.ask(s.tier(), "train") for _ in range(15))
        ref = max(DUNGEONS[d]["el"] + DUNGEONS[d]["floors"] - 1 for d in db.BY_RANK[s.tier()])
        mult = max(T.get("xp_pen_min", 0.1), 1 - T["xp_pen"] * max(0, c.lv - ref - T.get("xp_free", 0)))
        if c.lv < (ADV[s.adv]["cap"] if T.get("rank_cap", 1) else 99): c.gain_xp(s.xpq * 0.8 * (ok + 0.3 * (15 - ok)) * mult)
        c.ap[c.job] += 3
        s.S["q"] += 15; s.G["train_days"] += 1; s.G["real_q"] += 15; s.G["train_sessions"] += 1
    # ---------------------------------------------------------------- 昇格（昇格試験つき）
    def promote(s):
        while s.adv + 1 < len(ADV) and s.pts >= ADV[s.adv + 1]["pts"]:
            nxt = s.adv + 1; cur = ADV[s.adv]["maxr"]
            if ADV[nxt]["boss"] and cur not in s.cleared: break
            if ADV[nxt]["exam"]:
                if s.L.frac(cur) < 0.8: break
                day = s.real_day()
                if s.exam_tried.get(nxt) == day: break
                s.exam_tried[nxt] = day
                ok = s.L.exam(cur, n=50 if ADV[nxt]["id"] == "S" else 25)
                s.G["exam_log"].append((day, ADV[nxt]["id"], ok))
                if not ok: break
            s.adv = nxt; s.G["adv_log"].append((s.day, ADV[nxt]["id"])); s.G["rank_real"].append((s.real_day(), ADV[nxt]["id"]))
            s.G["star_real"].setdefault(ADV[nxt]["maxr"], s.real_day())
            if ADV[nxt]["id"] == "S": s.s_day = s.real_day()
    def settle(s, qs, loot, did):
        n0 = s.adv; super().settle(qs, loot, did)
        # 親クラスは試験なしで上げてしまうので、上がった分を戻して試験つきでやり直す
        if s.adv != n0: s.adv = n0; s.G["adv_log"] = [x for x in s.G["adv_log"] if x[0] != s.day]
        s.promote()
    # ---------------------------------------------------------------- 覚醒の試練と刻印
    def runes(s):
        day = s.real_day()
        for kj in s.L.stones_ready():
            if s.trial_day.get(kj) == day: continue
            s.trial_day[kj] = day; s.G["trials"] += 1
            if not s.L.trial(kj): s.G["trial_fail"] += 1
        if not s.L.awake: return
        for i in sorted(range(4), key=lambda i: s.slots[i]):
            n = s.slots[i] + 1
            if n in KOKUIN and n <= len(s.L.awake) and s.gold - KOKUIN[n] > s.reserve() * 1.5:
                s.gold -= KOKUIN[n]; s.slots[i] = n; s.G["spend"]["刻印"] += KOKUIN[n]; s.G["kokuin_spend"] += KOKUIN[n]
        stones = sorted((k for k, j in s.L.awake), reverse=True)
        glow = s.L.due_count() <= s.L.due_cap
        it = iter(stones)
        for i, c in enumerate(s.party):
            key = MAIN_STAT.get(c.job, "str"); e = RUNE[key]
            got = [next(it, None) for _ in range(s.slots[i])]; got = [k for k in got if k]
            v = (sum(e["per"] * k for k in got) * (1 + (e["glow"] if glow else 0)) + e["rb"] * (len(got) // e["rc"])) * T.get("rune_mul", 1.0)
            c.rune = {e["stat"]: v}
    # ---------------------------------------------------------------- メインループ
    def play(s):
        cur = 0
        while s.real_day() < s.max_real and s.s_day is None:
            did = s.choose_dungeon(); r = DUNGEONS[did]["rank"]
            qs = s.quests(did); s.buy_stock(r)
            snap = world.copy.deepcopy((s.party, s.gold, s.bank, s.overdue, s.day, s.fac, s.mats, s.items, s.pts, s.adv, s.cleared, s.cleared_d, s.unlocked, s.slots))
            q0 = s.S["q"]; s.q_at_run = q0; s.in_run = True; s.L.begin_run(); nr0 = len(s.S["rounds"])
            res, loot, floor = s.run(did)
            s.G.setdefault("rr", {}).setdefault(r, []).extend(s.S["rounds"][nr0:])
            fe = s.G.setdefault("front", Counter()); fw = s.G.setdefault("front_w", Counter())
            if r == s.tier() and fe[r] < 40:
                fe[r] += 1; fw[r] += res == "wipe"
                if fe[r] == 15 and SNAP is not None and r not in SNAP: SNAP[r] = (world.copy.deepcopy(s), did)
            s.in_run = False
            s.G["attempts"] += 1; s.G["attempts_by_rank"][r] += 1; s.G["real_q"] += s.S["q"] - q0; s.G["run_q"].append((r, s.S["q"] - q0, res))
            s.G["first_enter"].setdefault(r, (s.real_day(), s.G["attempts"], s.G["real_q"])); s.G["dungeon_use"][did] += 1
            if res == "wipe":
                (s.party, s.gold, s.bank, s.overdue, s.day, s.fac, s.mats, s.items, s.pts, s.adv, s.cleared, s.cleared_d, s.unlocked, s.slots) = snap
                s.G["wipes"] += 1; s.G["wipes_by_rank"][r] += 1; s.streak[did] += 1; cur += 1; s.G["max_streak"] = max(s.G["max_streak"], cur)
                if r > 1: s.farm = T["farm_after_wipe"]
                else:
                    for _ in range(4): s.train()
                continue
            cur = 0; s.streak[did] = 0
            s.advance(DUNGEONS[did]["days"])
            s.gold += loot["gold"] * (1 + s.party[0].rune.get("GOLD", 0) if getattr(s.party[0], "rune", None) else 1)
            s.G["earn"]["敵のお金"] += loot["gold"]; s.mats += loot["mats"]
            for d in loot["drops"]:
                if not s.try_equip(d): s.sell_or_salvage(d)
            for k, n in list(s.mats.items()):
                keep = max(15, s.rsv(k))
                if n > keep and not k.startswith("_"):
                    p = (n - keep) * (3 + 3 * int(world.MAT[k]["rank"]) if k in world.MAT else 3); s.gold += p; s.G["earn"]["素材売却"] += p; s.mats[k] = keep
            qn = s.S["q"] - q0; s.xpq = loot["xp"] / max(1, qn / 4)
            s.settle(qs, loot, did)
            if res == "clear":
                s.G["clears"][r] += 1; s.cleared.add(r); s.cleared_d.add(did)
                s.G["first_clear"].setdefault(r, (s.real_day(), s.G["attempts"], s.G["real_q"]))
                s.promote()
            else: s.G["returns"] += 1
            s.check_unlocks(loot); s.job_change(); s.temple()
            for k in ("overdue", "bank"):
                pay = min(getattr(s, k), max(0, s.gold - s.fixed_cost())); setattr(s, k, getattr(s, k) - pay); s.gold -= pay
            s.invest(); s.craft(); s.shop_gear(); s.inn(); s.enhance(); s.runes()
            cap = ADV[s.adv]["cap"] if T.get("rank_cap", 1) else 99   # ランクごとのレベル上限（999方式ではなし）
            for c in s.party:
                if c.lv > cap: c.lv = cap; c.xp = 0
                elif c.lv == cap: c.xp = 0
            # 復習がたまっていたら鍛錬（日数は進まない）
            for _ in range(4):
                if s.L.due_count() <= s.L.due_cap: break
                s.train()
            if s.G["attempts"] % 20 == 0: s.G["due_log"].append((s.real_day(), s.L.due_count()))
            s.advance(1)
        return s

def summary(gs):
    import statistics as st
    def med(x): x = sorted(x); return x[len(x) // 2] if x else None
    out = {}
    out["S_years"] = med([g.s_day / 365 if g.s_day else None for g in gs if g.s_day])
    out["S_rate"] = sum(g.s_day is not None for g in gs) / len(gs)
    out["star_years"] = {k: round(med([g.G["star_real"].get(k, 9e9) for g in gs]) / 365, 2) for k in range(2, 13)}
    out["acc"] = round(st.mean(g.L.stats["ok"] / max(1, g.L.stats["q"]) for g in gs), 3)
    out["learned"] = round(st.mean(sum(g.L.learned_by_star) for g in gs))
    out["wipe_rate"] = {k: round(sum(g.G["wipes_by_rank"][k] for g in gs) / max(1, sum(g.G["attempts_by_rank"][k] for g in gs)), 3) for k in range(1, 13)}
    out["rounds"] = round(st.mean(st.mean(g.S["rounds"]) for g in gs if g.S["rounds"]), 2)
    out["qb"] = round(st.mean(st.mean(g.S["bq"]) for g in gs if g.S["bq"]), 1)
    out["lv"] = round(st.mean(st.mean(c.lv for c in g.party) for g in gs), 1)
    out["max_due"] = max(max([d for _, d in g.G["due_log"]] or [0]) for g in gs)
    out["due_p90"] = sorted(d for g in gs for _, d in g.G["due_log"])[int(0.9 * sum(len(g.G["due_log"]) for g in gs))] if any(g.G["due_log"] for g in gs) else 0
    out["exam_fail"] = round(sum(1 for g in gs for e in g.G["exam_log"] if not e[2]) / max(1, sum(len(g.G["exam_log"]) for g in gs)), 2)
    out["trials_fail"] = round(sum(g.G["trial_fail"] for g in gs) / max(1, sum(g.G["trials"] for g in gs)), 2)
    out["train_share"] = round(st.mean(g.G["train_sessions"] * 15 / max(1, g.G["real_q"]) for g in gs), 3)
    out["new_share"] = round(st.mean(g.L.stats["new"] / max(1, g.L.stats["q"]) for g in gs), 3)
    out["review_share"] = round(st.mean(g.L.stats["review"] / max(1, g.L.stats["q"]) for g in gs), 3)
    out["overdue_months"] = round(sum(g.G["overdue_months"] for g in gs) / max(1, sum(g.G["months"] for g in gs)), 3)
    out["fixed_share"] = round(st.mean(g.G["spend"]["会費・倉庫"] / max(1, sum(g.G["earn"].values())) for g in gs), 3)
    out["kokuin_slots"] = round(st.mean(sum(g.slots) for g in gs), 1)
    out["runq_p95"] = sorted(q for g in gs for _, q, _ in g.G["run_q"])[int(0.95 * sum(len(g.G["run_q"]) for g in gs))]
    out["gold_end"] = round(st.mean(g.gold for g in gs))
    out["rounds_by_star"] = {k: round(st.mean(x for g in gs for x in g.G.get("rr", {}).get(k, [0])), 2) for k in range(1, 13)}
    out["front_wipe"] = {k: round(sum(g.G.get("front_w", {}).get(k, 0) for g in gs) / max(1, sum(g.G.get("front", {}).get(k, 0) for g in gs)), 2) for k in range(1, 13)}
    return out
