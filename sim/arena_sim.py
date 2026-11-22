# 闘技場：5戦の勝ち抜き。前線のスナップショット（その★に届いたころ）で勝率30%前後に合わせる
import copy, csv, json, os, sys, statistics as st
import world12, world, core, db, battle as B
from multiprocessing import Pool
T = core.T
ROWS = list(csv.DictReader(open(os.path.join(db.SEC, "arena_battles.csv"), encoding="utf-8-sig")))
def fight(a):
    t, g0, f, n, seed0, tag = a
    W = 0; R = []
    for i in range(n):
        g = copy.deepcopy(g0); g.rng.seed(seed0 + i); rng = g.rng
        g.in_run = True; g.q_at_run = g.S["q"]; g.L.begin_run()
        for c in g.party: c.hp = c.maxhp(); c.mp = c.maxmp(); c.refresh()
        acc = g.acc_now(min(t, 12)); ok = True; first = True
        T["elite_rate"] = 1.0
        for row in [r for r in ROWS if int(r["tier"]) == t]:
            T["_bmul"] = float(row["boss_mul"])
            es = [world.Enemy(db.MON_BY_ID[m] if hasattr(db, "MON_BY_ID") else world.MON_BY_ID[m], int(row["enemy_lv"]), rng, min(t, 12), float(row["enemy_mul"]) * f) for m in row["enemies"].split("|")]
            if not first: g.use_items()
            n0 = len(g.S["rounds"])
            res = B.battle(g.party, es, acc, rng, g.S, first=first, items=g.items if T["items_in_battle"] else None)
            R += g.S["rounds"][n0:]; first = False
            if res != "win": ok = False; break
            for c in g.party:
                if c.hp > 0: c.mp = min(c.maxmp(), c.mp + T["mp_regen"] * c.maxmp())
        W += ok
    T["elite_rate"] = 0.08; T["_bmul"] = 0
    return t, f, W / n, st.mean(R) if R else 0, tag
def states(seed):
    world12.SNAP = {}
    g = world12.Game12(["戦士", "ナイト", "黒魔道士", "白魔道士"], minutes=60, seed=seed, max_years=6).play()
    d = {k: v[0] for k, v in world12.SNAP.items()}; d[13] = g
    return d
if __name__ == "__main__":
    grid = [float(x) for x in sys.argv[1].split(",")] if len(sys.argv) > 1 else [0.5, 0.7, 0.85, 1.0, 1.2]
    with Pool(2) as p: S = p.map(states, [4, 11])
    jobs = [(t, sn[t], f, 10, 900 + si * 50, 'front') for t in range(1, 14) for si, sn in enumerate(S) if t in sn for f in grid]
    # 1つ上の★のスナップショットでも試す（育ってから挑んだとき）
    jobs += [(t, sn[t + 1], f, 10, 700, 'next') for t in range(1, 12) for sn in S[:1] if t + 1 in sn for f in grid]
    with Pool(2) as p: res = p.map(fight, jobs)
    json.dump(res, open("arena_raw.json", "w"))
    print("res n", len(res))
