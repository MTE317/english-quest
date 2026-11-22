# 上乗せ（固有・セット・振り直し・強化薬）を +10% と見込んだときの、ボスダンジョンの強さ（全滅率35%）
import json, sys, core
core.T["xs"] = float(sys.argv[1]) if len(sys.argv) > 1 else 0.1
import world12
from multiprocessing import Pool
from calib_bd import trial
from calib_bd2 import snaps
if __name__ == "__main__":
    with Pool(2) as p: S = p.map(snaps, [4, 11])
    grid = [1.2, 1.35, 1.5, 1.65, 1.8, 1.95, 2.1, 2.3, 2.5]
    jobs = [(k, sn[k], em, 12) for k in range(1, 13) for sn in S if k in sn for em in grid]
    with Pool(2) as p: res = p.map(trial, jobs)
    best = {}
    for k in range(1, 13):
        agg = {}
        for kk, em, w, rr in res:
            if kk == k: a = agg.setdefault(em, [0, 0]); a[0] += w; a[1] += 1
        rows = sorted((em, a[0] / a[1]) for em, a in agg.items())
        print(k, [(m, round(w, 2)) for m, w in rows], flush=True)
        v = None
        for (m1, w1), (m2, w2) in zip(rows, rows[1:]):
            if w1 <= 0.35 <= w2 and w2 > w1: v = m1 + (0.35 - w1) / (w2 - w1) * (m2 - m1); break
        best[k] = round(v if v else min(rows, key=lambda r: abs(r[1] - 0.35))[0], 2)
    print("best", best, flush=True); json.dump(best, open("calib_xs.json", "w"))
