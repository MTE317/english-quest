# ★12版：学習モデル（教材セット・復習・昇格試験）つきの通しプレイ。確認テストは任意。
import csv, os, random, statistics
from collections import Counter
import db, world
from world import Game, DUNGEONS, ADV, ECON, T
from learn import Learner, QSource

D = db.D
def R(n): return list(csv.DictReader(open(os.path.join(D, n), encoding="utf-8-sig")))
CONFIRMATION = next(r for r in R("exams.csv") if r["id"] == "confirmation")

LEARNERS = {   # 学び方のタイプ
    "標準": dict(),
    "苦手": dict(prior0=0.45, prior_drop=0.06, p_new=0.30, grow=1.9),
    "得意": dict(prior0=0.80, prior_drop=0.06, p_new=0.45, grow=2.7),
}

# ---------------------------------------------------------------- 強い個体（冠）
import core as _core
ELITES = [dict(id=r["id"], pre=r["prefix"], mods=r["mods"], min=int(r["min_star"]), p=float(r["appear_rate"]), rm=float(r["reward_mul"])) for r in R("elite_prefixes.csv")]
_BaseEnemy = _core.Enemy
def apply_elite(e, el):
    for part in el["mods"].split("|"):
        k, *v = part.split(":")
        if k == "hp_mul": e.maxhp *= float(v[0]); e.hp = e.maxhp
        elif k == "atk_mul": e.STR *= float(v[0]); e.MAG *= float(v[0])
        elif k == "def_mul" and hasattr(e, "DEF"): e.DEF *= float(v[0])
        elif k == "res_mul" and hasattr(e, "RES"): e.RES *= float(v[0])
        elif k == "spd_mul" and hasattr(e, "SPD"): e.SPD *= float(v[0])
        elif k == "status": e.m = dict(e.m, st=(db.STATUS[v[0]]["name"], float(v[1])))
        elif k == "element": e.m = dict(e.m, elem=db.ELEM.get(v[0]))
    e.rmul = el["rm"]; e.name = el["pre"] + e.name; e.elite = el["id"]
def EnemyF(m, L, rng, rank=1, dm=1.0):
    e = _BaseEnemy(m, L, rng, rank, dm)
    if e.boss and T.get("_bmul"):
        e.maxhp *= T["_bmul"]; e.hp = e.maxhp; e.STR *= T["_bmul"] ** 0.5; e.MAG *= T["_bmul"] ** 0.5
    if T.get("elites", 1) and not e.boss and rng.random() < T.get("elite_rate", 0.08):
        ok = [el for el in ELITES if el["min"] <= rank]
        el = rng.choices(ok, weights=[x["p"] for x in ok])[0]
        apply_elite(e, el)
    return e
world.Enemy = EnemyF

# ---------------------------------------------------------------- ボスダンジョン（ネタバレ：secret/）
BOSSD = {}
_bp = os.path.join(db.SEC, "boss_dungeons.csv")
if os.path.exists(_bp):
    for r in csv.DictReader(open(_bp, encoding="utf-8-sig")):
        k = int(r["star"]); L = int(r["enemy_lv"]); bid = r["id"]
        fr = [dict(floor=f, lv=L + f - 1, battles=2 if f < 3 else 1, n=3, boss=1 if f == 3 else 0, rp=0) for f in range(1, 4)]
        base = DUNGEONS[next(d for d in db.BY_RANK[k] if DUNGEONS[d]["kind"] == "標準")]
        DUNGEONS[bid] = dict(base, id=bid, name=r["name"], floors=3, el=L, rp=None, boss=r["boss_id"], emul=float(r["enemy_mul"]),
                             floor_rows=fr, kind="ボス", bmul=float(r["boss_mul"]), income=2.0, pool_from=base["id"])
        BOSSD[k] = bid
_pool0 = db.pool
def _pool(did, season):
    return _pool0(DUNGEONS[did].get("pool_from", did), season)
db.pool = _pool

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
        s.s_day = None; s.exam_tried = {}
        s.G.update(exam_log=[], confirmations=0, confirmation_fail=0, train_sessions=0, rank_real=[], star_real={}, due_log=[])
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
    # ---------------------------------------------------------------- 任意の確認テスト
    def confirmation_test(s, stone):
        # メインループから自動受験しない。教材の理解を確かめるときだけ呼ぶ。
        # 能力やお金は変えず、解答と所要学習量を記録する。
        s.L.set_day(s.real_day())
        n = int(CONFIRMATION["questions"])
        passed = s.L.confirmation(stone, n=n, need=float(CONFIRMATION["pass_rate"]))
        s.G["confirmations"] += 1
        s.G["confirmation_fail"] += not passed
        s.G["real_q"] += n; s.S["q"] += n
        return passed
    # ---------------------------------------------------------------- メインループ
    def play(s):
        cur = 0
        while s.real_day() < s.max_real and s.s_day is None:
            did = s.choose_dungeon(); r = DUNGEONS[did]["rank"]
            qs = s.quests(did); s.buy_stock(r)
            snap = world.copy.deepcopy((s.party, s.gold, s.bank, s.overdue, s.day, s.fac, s.mats, s.items, s.pts, s.adv, s.cleared, s.cleared_d, s.unlocked))
            q0 = s.S["q"]; s.q_at_run = q0; s.in_run = True; s.L.begin_run(); nr0 = len(s.S["rounds"])
            res, loot, floor = s.run(did)
            s.G.setdefault("rr", {}).setdefault(r, []).extend(s.S["rounds"][nr0:])
            fe = s.G.setdefault("front", Counter()); fw = s.G.setdefault("front_w", Counter())
            if r == s.tier() and fe[r] < 40:
                fe[r] += 1; fw[r] += res == "wipe"
                if fe[r] == 35 and SNAP is not None and r not in SNAP: SNAP[r] = (world.copy.deepcopy(s), did)
            s.in_run = False
            s.G["attempts"] += 1; s.G["attempts_by_rank"][r] += 1; s.G["real_q"] += s.S["q"] - q0; s.G["run_q"].append((r, s.S["q"] - q0, res))
            s.G["first_enter"].setdefault(r, (s.real_day(), s.G["attempts"], s.G["real_q"])); s.G["dungeon_use"][did] += 1
            if res == "wipe":
                (s.party, s.gold, s.bank, s.overdue, s.day, s.fac, s.mats, s.items, s.pts, s.adv, s.cleared, s.cleared_d, s.unlocked) = snap
                s.G["wipes"] += 1; s.G["wipes_by_rank"][r] += 1; s.streak[did] += 1; cur += 1; s.G["max_streak"] = max(s.G["max_streak"], cur)
                if r > 1: s.farm = T["farm_after_wipe"]
                else:
                    for _ in range(4): s.train()
                continue
            cur = 0; s.streak[did] = 0
            s.advance(DUNGEONS[did]["days"])
            s.gold += loot["gold"]
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
            s.invest(); s.craft(); s.shop_gear(); s.inn(); s.enhance()
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
    out["confirmation_fail"] = round(sum(g.G["confirmation_fail"] for g in gs) / max(1, sum(g.G["confirmations"] for g in gs)), 2)
    out["train_share"] = round(st.mean(g.G["train_sessions"] * 15 / max(1, g.G["real_q"]) for g in gs), 3)
    out["new_share"] = round(st.mean(g.L.stats["new"] / max(1, g.L.stats["q"]) for g in gs), 3)
    out["review_share"] = round(st.mean(g.L.stats["review"] / max(1, g.L.stats["q"]) for g in gs), 3)
    out["overdue_months"] = round(sum(g.G["overdue_months"] for g in gs) / max(1, sum(g.G["months"] for g in gs)), 3)
    out["fixed_share"] = round(st.mean(g.G["spend"]["会費・倉庫"] / max(1, sum(g.G["earn"].values())) for g in gs), 3)
    out["runq_p95"] = sorted(q for g in gs for _, q, _ in g.G["run_q"])[int(0.95 * sum(len(g.G["run_q"]) for g in gs))]
    out["gold_end"] = round(st.mean(g.gold for g in gs))
    out["rounds_by_star"] = {k: round(st.mean(x for g in gs for x in g.G.get("rr", {}).get(k, [0])), 2) for k in range(1, 13)}
    out["front_wipe"] = {k: round(sum(g.G.get("front_w", {}).get(k, 0) for g in gs) / max(1, sum(g.G.get("front", {}).get(k, 0) for g in gs)), 2) for k in range(1, 13)}
    return out
