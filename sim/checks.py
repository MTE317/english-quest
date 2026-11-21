"""検証のまとめ役"""
import random, copy, statistics as st, itertools, json, sys
from collections import Counter
import db
from db import DUNGEONS, BY_RANK, MONSTERS, MON_BY_ID, JOBS
from core import T, Char, Enemy
import battle as B
from world import Game, CORE_PARTY, PROFILES

def med(xs):
    xs = [x for x in xs if x is not None]; return st.median(xs) if xs else None
def pct(xs, p):
    xs = sorted(x for x in xs if x is not None)
    return xs[min(len(xs) - 1, int(len(xs) * p))] if xs else None

# ---------------------------------------------------------------- レベルの合ったパーティ
def make_party(jobs, did, lvoff=0, ap=None):
    D = DUNGEONS[did]; r = D["rank"]; lo, hi = D["ilvl"]; il = (lo + hi) // 2
    g = Game(jobs, 0.8, seed=0)
    for c in g.party:
        c.lv = max(1, D["el"] + lvoff)
        c.ap = {c.job: ap if ap is not None else {1: 0, 2: 80, 3: 150, 4: 180, 5: 200}[r]}
        c.weapon = dict(t=JOBS[c.job]["start_weapon"], ilvl=il, q=1.0, enh=0, aff={}, el=None, src="x", rar=0)
        for p in c.parts: c.parts[p] = dict(w=JOBS[c.job]["arm"], ilvl=il, q=1.0, enh=0, aff={}, src="x", rar=0)
        c.mastery = {c.weapon["t"]: 300}
        c._key = None; c.refresh(); c.hp = c.maxhp(); c.mp = c.maxmp()
    g.fac = {k: r for k in g.fac}
    for k, n in __import__("world").STOCK[r].items(): g.items[k] = n
    return g

def dungeon_trials(jobs, did, acc, n=150, lvoff=0, seed=0, season=None, ap=None):
    rng = random.Random(seed); base = make_party(jobs, did, lvoff, ap); res = Counter(); qs = []; gold = []
    S = dict(q=0, ok=0, rounds=[], bq=[], weak_hits=0, resist_hits=0, neutral_hits=0, status={}, ko=0, cover=0, evade=0, heal=0, cure=0, self_hit=0,
             bestiary=set(m["name"] for m in MONSTERS))
    for i in range(n):
        g = copy.deepcopy(base); g.rng = random.Random(seed * 1000 + i); g.S = S; g.acc0 = acc
        g.day = (["春", "夏", "秋", "冬"].index(season) * 30 + 5) if season else rng.randrange(120)
        q0 = S["q"]; out, loot, fl = g.run(did); res[out] += 1
        if out == "clear": qs.append(S["q"] - q0); gold.append(loot["gold"])
    return dict(clear=res["clear"] / n, wipe=res["wipe"] / n, ret=res["return"] / n, q=st.mean(qs) if qs else None,
                rounds=st.mean(S["rounds"]), qb=st.mean(S["bq"]), gold=st.mean(gold) if gold else 0, S=S)

# ---------------------------------------------------------------- 通し
def full_games(acc, n=30, profile="標準", jobs=CORE_PARTY, **kw):
    out = []
    for sd in range(n):
        g = Game(jobs, acc, seed=sd, profile=profile, **kw).play(); out.append(g)
    return out

def summarize(gs):
    Gs = [g.G for g in gs]; ar = Counter(); wr = Counter()
    for G in Gs: ar += G["attempts_by_rank"]; wr += G["wipes_by_rank"]
    runq = [q for G in Gs for (r, q, res) in G["run_q"]]
    unlock = {}
    for j in db.MID_JOBS + db.UPPER_JOBS:
        days = [G["unlock_log"].get(j) for G in Gs]
        unlock[j] = (med(days), sum(1 for d in days if d is not None) / len(Gs))
    adv = {}
    for a in db.ADV[1:]:
        adv[a["id"]] = med([next((d for d, x in G["adv_log"] if x == a["id"]), None) for G in Gs])
    earn = st.mean(sum(G["earn"].values()) for G in Gs)
    return dict(
        clear5_day=med([g.clear5_day for g in gs]), clear5_done=sum(1 for g in gs if g.clear5_day) / len(gs),
        clear5_p90=pct([g.clear5_day for g in gs], 0.9),
        realq=med([G["first_clear"].get(5, (None, None, None))[2] for G in Gs]),
        attempts=med([G["first_clear"].get(5, (None, None))[1] for G in Gs]),
        wipes=st.mean(G["wipes"] for G in Gs), train=st.mean(G["train_days"] for G in Gs),
        wipe_rate={r: wr[r] / max(1, ar[r]) for r in range(1, 6)},
        rounds=st.mean(st.mean(g.S["rounds"]) for g in gs), qb=st.mean(st.mean(g.S["bq"]) for g in gs),
        streak_p90=pct([G["max_streak"] for G in Gs], 0.9), streak_max=max(G["max_streak"] for G in Gs),
        runq_p95=pct(runq, 0.95), runq_max=max(runq),
        overdue=st.mean(G["overdue_months"] / max(1, G["months"]) for G in Gs), short=st.mean(G["short_months"] / max(1, G["months"]) for G in Gs),
        fixed_share=st.mean(G["spend"]["会費・倉庫"] for G in Gs) / earn, unlock=unlock, adv=adv,
        dungeon_use=dict(sum((G["dungeon_use"] for G in Gs), Counter())),
        gate_block=st.mean(G["gate_block"] for G in Gs), item_battle=dict(sum((Counter(g.S.get("item_battle", {})) for g in gs), Counter())),
        equip_src=dict(sum((G["equip_src"] for G in Gs), Counter())), crafts=dict(sum((G["crafts"] for G in Gs), Counter())),
        spend={k: v / len(Gs) / earn for k, v in sum((G["spend"] for G in Gs), Counter()).items()},
        earn={k: v / len(Gs) / earn for k, v in sum((G["earn"] for G in Gs), Counter()).items()},
        good_room=st.mean(G["good_room"] / max(1, G["inn_stays"]) for G in Gs), fled=st.mean(G["fled"] for G in Gs),
        switches=Counter(f"{a}→{b}" for G in Gs for d, a, b in G["switch_log"]),
    )

# ---------------------------------------------------------------- モンスター1体ずつ
def monster_strength(acc=0.8, n=100):
    rows = []
    for m in MONSTERS:
        did = m["dungeons"][0]; D = DUNGEONS[did]; L = D["el"] + 2; rng = random.Random(1)
        g = make_party(CORE_PARTY, did); tot = sum(c.maxhp() for c in g.party); dmg = []; rounds = []
        for i in range(n):
            party = copy.deepcopy(g.party)
            S = dict(q=0, ok=0, rounds=[], bq=[], weak_hits=0, resist_hits=0, neutral_hits=0, status={}, ko=0, cover=0, evade=0, heal=0, cure=0,
                     self_hit=0, bestiary={m["name"]})
            es = [Enemy(m, L, rng, D["rank"]) for _ in range(1 if m["boss"] else 3)]
            if m["boss"]: es.append(Enemy(rng.choice(db.pool(did, "春")), L, rng, D["rank"]))
            B.battle(party, es, acc, rng, S, items=None)
            dmg.append((tot - sum(max(0, c.hp) for c in party)) / tot); rounds.append(S["rounds"][0])
        rows.append(dict(id=m["id"], name=m["name"], rank=m["rank"], boss=m["boss"], season=m["season"], dungeon=did, dmg=st.mean(dmg), rounds=st.mean(rounds),
                         power=st.mean(dmg) * st.mean(rounds)))
    return rows

def content_stats():
    out = {}
    for r in range(1, 6):
        ms = [m for m in MONSTERS if m["rank"] == r and not m["boss"]]
        el = Counter(x for m in ms for x in m["weak"]); rs = Counter(x for m in ms for x in m["resist"])
        ty = Counter(x for m in ms for x in m["types"]); stt = Counter(m["st"][0] for m in ms if m["st"])
        basic = set(["斬撃", "刺突", "打撃", "炎", "氷", "雷", "光", "闇"])
        unreach = [m["name"] for m in MONSTERS if m["rank"] == r and m["weak"] and not (set(m["weak"]) & basic)]
        out[r] = dict(weak=dict(el), resist=dict(rs), types=dict(ty), status=dict(stt), unreach_basic=unreach, n=len(ms) + sum(1 for m in MONSTERS if m["rank"] == r and m["boss"]))
    return out

# ---------------------------------------------------------------- ジョブの強さ
def job_sweep(r, pool, combos=200, n=25, acc=0.65, seed=0, lvoff=3, ap=None):
    rng = random.Random(seed); allc = list(itertools.combinations(pool, 4)); rng.shuffle(allc)
    rows = []
    for i, c in enumerate(allc[:combos]):
        did = BY_RANK[r][i % 2]
        d = dungeon_trials(list(c), did, acc, n=n, lvoff=lvoff, seed=seed + i, ap=ap)
        rows.append((c, d["clear"]))
    out = {}
    for j in pool:
        inc = [x[1] for x in rows if j in x[0]]; exc = [x[1] for x in rows if j not in x[0]]
        out[j] = dict(clear=st.mean(inc), diff=st.mean(inc) - st.mean(exc), n=len(inc))
    return st.mean(x[1] for x in rows), out

if __name__ == "__main__":
    pass
