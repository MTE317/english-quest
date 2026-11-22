# ボスダンジョン：前線35回目の状態から、全滅率30〜40%になる敵の強さを探す
import copy, json, statistics as st, world12, core, db
from multiprocessing import Pool
world12.SNAP = {}
def trial(a):
    k, g0, em, n = a
    bid = world12.BOSSD[k]; D = world12.DUNGEONS[bid]; D["emul"] = em
    core.T["elite_rate"] = 1.0; core.T["_bmul"] = D["bmul"]
    W = 0; R = []
    for i in range(n):
        g = copy.deepcopy(g0); g.rng.seed(500 + i); g.in_run = True; g.q_at_run = g.S["q"]; g.L.begin_run()
        for c in g.party: c.hp = c.maxhp(); c.mp = c.maxmp()
        n0 = len(g.S["rounds"]); res, loot, fl = g.run(bid); W += res == "wipe"; R += g.S["rounds"][n0:]
    return k, em, W / n, st.mean(R) if R else 0
if __name__ == "__main__":
    g = world12.Game12(["戦士", "ナイト", "黒魔道士", "白魔道士"], minutes=60, seed=4, max_years=6).play()
    snaps = dict(world12.SNAP); print("snaps", sorted(snaps), flush=True)
    grid = [0.6, 0.8, 1.0, 1.2, 1.45, 1.75]
    with Pool(2) as p: res = p.map(trial, [(k, snaps[k][0], em, 20) for k in sorted(snaps) for em in grid])
    best = {}
    for k in sorted(snaps):
        rows = [r for r in res if r[0] == k]; print(k, [(m, round(w, 2), round(rr, 1)) for _, m, w, rr in rows], flush=True)
        best[k] = min(rows, key=lambda r: abs(r[2] - 0.35))[1]
    print("best", best); json.dump(best, open("calib_bd.json", "w"))
