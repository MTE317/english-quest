# ボスダンジョン：★ごとの敵の補正を見直したあとの合わせ込み（2つの種・細かい刻み）
import json, world12
from multiprocessing import Pool
from calib_bd import trial
from calib_bd2 import snaps
if __name__ == "__main__":
    with Pool(2) as p: S = p.map(snaps, [4, 11])
    grid = [0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.95, 2.1]
    jobs = [(k, sn[k], em, 15) for k in range(1, 13) for sn in S if k in sn for em in grid]
    with Pool(2) as p: res = p.map(trial, jobs)
    best = {}
    for k in range(1, 13):
        agg = {}
        for kk, em, w, rr in res:
            if kk == k: a = agg.setdefault(em, [0, 0, 0]); a[0] += w; a[1] += rr; a[2] += 1
        rows = sorted((em, a[0] / a[2], a[1] / a[2]) for em, a in agg.items())
        print(k, [(m, round(w, 2), round(r, 1)) for m, w, r in rows], flush=True)
        # 35% をはさむ2点の間を直線で補う
        v = None
        for (m1, w1, _), (m2, w2, _) in zip(rows, rows[1:]):
            if w1 <= 0.35 <= w2 and w2 > w1: v = m1 + (0.35 - w1) / (w2 - w1) * (m2 - m1); break
        best[k] = round(v if v else min(rows, key=lambda r: abs(r[1] - 0.35))[0], 2)
    print("best", best, flush=True); json.dump(best, open("calib_bd3.json", "w"))
