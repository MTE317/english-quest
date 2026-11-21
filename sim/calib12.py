# ★ごとに、前線の状態から敵の強さの倍率を決める
import sys, json, copy, statistics as st, world12, core, db
from multiprocessing import Pool
world12.SNAP = {}
TARGET_R, TARGET_W = 3.0, 0.08
def trial(args):
    k, g0, did, mh, n = args
    core.T["hp_rank_mul"][k] = mh; core.T.setdefault("atk_rank_mul", {})[k] = mh ** 0.85
    W = 0; rounds = []
    for i in range(n):
        g = copy.deepcopy(g0); g.rng.seed(1000 + i); g.in_run = True; g.q_at_run = g.S["q"]; g.L.begin_run()
        n0 = len(g.S["rounds"]); res, loot, fl = g.run(did); rounds += g.S["rounds"][n0:]; W += res == "wipe"
    return k, mh, W / n, st.mean(rounds) if rounds else 0
if __name__ == "__main__":
    minutes = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    g = world12.Game12(["戦士", "ナイト", "黒魔道士", "白魔道士"], minutes=minutes, seed=3, max_years=6).play()
    snaps = dict(world12.SNAP); print("snaps", sorted(snaps), flush=True)
    grid = [1.0, 1.5, 2.0, 2.6, 3.3, 4.2, 5.4]
    jobs = []
    for k, (g0, did) in snaps.items():
        std = next(d for d in db.BY_RANK[k] if db.DUNGEONS[d]["kind"] == "標準")
        for mh in grid: jobs.append((k, g0, std, mh, 16))
    with Pool(2) as p: res = p.map(trial, jobs)
    best = {}
    for k in sorted(snaps):
        rows = [r for r in res if r[0] == k]
        print(k, [(m, round(w, 2), round(rr, 2)) for _, m, w, rr in rows], flush=True)
        ok = [r for r in rows if r[2] <= 0.15]
        b = min(ok or rows, key=lambda r: abs(r[3] - TARGET_R) + (0 if r[2] <= 0.15 else 5))
        best[k] = b[1]
    print("best", best)
    json.dump(best, open("calib12.json", "w"))
