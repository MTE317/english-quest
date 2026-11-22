import sys, core
core.T["xs"] = 0.1
import arena_sim, json
from multiprocessing import Pool
if __name__ == "__main__":
    grid = [1.0, 1.15, 1.3, 1.5, 1.7]
    with Pool(2) as p: S = p.map(arena_sim.states, [4, 11])
    jobs = [(t, sn[t], f, 8, 900 + si * 50, "front") for t in range(1, 14) for si, sn in enumerate(S) if t in sn for f in grid]
    with Pool(2) as p: res = p.map(arena_sim.fight, jobs)
    best = {}
    for t in range(1, 14):
        agg = {}
        for tt, f, w, r, tag in res:
            if tt == t: a = agg.setdefault(f, [0, 0]); a[0] += w; a[1] += 1
        row = sorted((f, a[0] / a[1]) for f, a in agg.items())
        print(t, [(f, round(w, 2)) for f, w in row], flush=True)
        v = None
        for (f1, w1), (f2, w2) in zip(row, row[1:]):
            if w1 >= 0.3 >= w2 and w1 > w2: v = f1 + (w1 - 0.3) / (w1 - w2) * (f2 - f1); break
        best[t] = round(v if v else min(row, key=lambda x: abs(x[1] - 0.3))[0], 2)
    print("best", best); json.dump(best, open("arena_xs.json", "w"))
