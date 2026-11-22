# バックパック（拾える量の上限）と JP で転職を入れた ★12 シミュレーション
import sys, json, csv, os, statistics as st
import world12, world, core, db
from world import JOB_SWITCH, UPPER_ALIAS, JOBS, TIER, MAT, ADV
from multiprocessing import Pool
T = core.T
BP = [dict(t=int(r["tier"]), slots=int(r["slots"]), gold=int(r["gold"]), shop=int(r["shop_rank"])) for r in csv.DictReader(open(os.path.join(db.D, "backpack.csv"), encoding="utf-8-sig"))]
JP_DAY = {15: 110, 30: 240, 60: 500}
JP_COST = {"基本": 80, "中級": 200, "上級": 500}
class G(world12.Game12):
    def __init__(s, *a, bp=1, jp=1, **k):
        super().__init__(*a, **k); s.bp_on = bp; s.jp_on = jp; s.bp = 0; s.jp = 0.0; s.jp_last = 0
        s.G.update(bp_lost=0, bp_units=0, bp_runs_full=0, bp_spend=0, bp_tier_log=[], jp_spent=0, jp_block=0, jp_wait=[])
    def run(s, did):
        res, loot, fl = super().run(did)
        if s.bp_on and res != "wipe":
            cap = BP[s.bp]["slots"]; drops = loot["drops"]; mats = loot["mats"]
            items = [("gear", i, 60 * DUNGEONS_rank(did)) for i in range(len(drops))]
            for k, n in mats.items():
                if n <= 0: continue
                rare = k in MAT and MAT[k]["kind"] != "common"
                v = n * (3 + 3 * int(MAT[k]["rank"]) if k in MAT else 3) * (5 if rare else 1)
                items.append(("mat", k, v))
            s.G["bp_units"] += sum(mats.values()) + len(drops)
            if len(items) > cap:
                s.G["bp_runs_full"] += 1
                items.sort(key=lambda x: x[2])
                for kind, key, v in items[:len(items) - cap]:
                    if kind == "mat": s.G["bp_lost"] += mats[key]; mats[key] = 0
                    else: s.G["bp_lost"] += 1; drops[key] = None
                loot["drops"] = [d for d in drops if d is not None]
        return res, loot, fl
    def invest(s):
        super().invest()
        if s.bp_on and s.bp + 1 < len(BP):
            n = BP[s.bp + 1]
            if s.fac["item"] >= n["shop"] and s.gold - n["gold"] > s.reserve() * 1.5:
                s.gold -= n["gold"]; s.bp += 1; s.G["bp_spend"] += n["gold"]; s.G["spend"]["バックパック"] += n["gold"]
                s.G["bp_tier_log"].append((s.real_day(), n["slots"]))
    def job_change(s):
        if not s.jp_on: return super().job_change()
        d = s.real_day(); s.jp += JP_DAY[s.minutes_] * (d - s.jp_last); s.jp_last = d
        if not s.allow_switch: return
        for c in s.party:
            if TIER[c.job] == "上級": continue
            cands = []
            for alias in JOB_SWITCH.get(c.job, []) + JOB_SWITCH.get(c.ap and next(iter(c.ap)), []):
                j = UPPER_ALIAS.get(alias, alias)
                if j in s.unlocked and j not in [x.job for x in s.party] and j != c.job: cands.append(j)
            if not cands: continue
            j = cands[-1]
            if TIER[j] == TIER[c.job] or (TIER[c.job] == "基本" and c.ap.get(c.job, 0) < 120 and TIER[j] == "中級"): continue
            if TIER[c.job] == "中級" and TIER[j] == "中級": continue
            cost = JP_COST[TIER[j]]
            if s.jp < cost:
                s.G["jp_block"] += 1; s.G["jp_wait"].append(round((cost - s.jp) / JP_DAY[s.minutes_], 2)); continue
            s.jp -= cost; s.G["jp_spent"] += cost
            old = c.job; c.change_job(j); s.G["switch_log"].append((s.day, old, j))
            if c.weapon["t"] not in JOBS[j]["w"]:
                t = JOBS[j]["start_weapon"]; il = max(3, c.weapon["ilvl"] - 10) if not T["mastery_gate"] else 3
                c.weapon = dict(t=t, ilvl=il, q=1.0, enh=0, aff={}, el=None, src="ジョブチェンジ", rar=0)
def DUNGEONS_rank(did): return world.DUNGEONS[did]["rank"]
def one(a):
    seed, minutes, bp, jp = a
    g = G(["戦士", "ナイト", "黒魔道士", "白魔道士"], minutes=minutes, seed=seed, max_years=9, bp=bp, jp=jp)
    g.minutes_ = minutes
    return g.play()
if __name__ == "__main__":
    minutes = int(sys.argv[1]); n = int(sys.argv[2]); bp = int(sys.argv[3]); jp = int(sys.argv[4]); tag = sys.argv[5]
    with Pool(2) as p: gs = p.map(one, [(s, minutes, bp, jp) for s in range(n)])
    out = world12.summary(gs)
    out["bp_lost_share"] = round(sum(g.G["bp_lost"] for g in gs) / max(1, sum(g.G["bp_units"] for g in gs)), 3)
    out["bp_full_runs"] = round(sum(g.G["bp_runs_full"] for g in gs) / max(1, sum(g.G["attempts"] for g in gs)), 3)
    out["bp_spend"] = round(st.mean(g.G["bp_spend"] for g in gs))
    out["bp_tiers"] = [g.G["bp_tier_log"] for g in gs[:2]]
    out["earn_total"] = round(st.mean(sum(g.G["earn"].values()) for g in gs))
    out["switches"] = round(st.mean(len(g.G["switch_log"]) for g in gs), 1)
    out["jp_block"] = round(st.mean(g.G["jp_block"] for g in gs), 1)
    w = [x for g in gs for x in g.G["jp_wait"]]; out["jp_wait_max_days"] = max(w) if w else 0
    out["jp_end"] = round(st.mean(g.jp for g in gs))
    json.dump(out, open(f"bpjp_{tag}.json", "w"), ensure_ascii=False)
    keys = ["S_years", "wipe_rate", "rounds", "fixed_share", "gold_end", "earn_total", "bp_lost_share", "bp_full_runs", "bp_spend", "switches", "jp_block", "jp_wait_max_days", "jp_end"]
    print(tag, json.dumps({k: out.get(k) for k in keys}, ensure_ascii=False))
