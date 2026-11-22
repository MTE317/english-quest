# ボスダンジョンの細かい合わせ込み：2つの種の前線スナップショットで、全滅率35%に近い値を探す
import copy, json, statistics as st, world12
from multiprocessing import Pool
from calib_bd import trial
EST = {1: 1.66, 2: 1.18, 3: 1.22, 4: 1.39, 5: 1.58, 6: 1.59, 7: 1.30, 8: 1.51, 9: 1.42, 10: 0.75, 11: 1.58, 12: 1.55}
def snaps(seed):
    world12.SNAP = {}
    world12.Game12(["戦士", "ナイト", "黒魔道士", "白魔道士"], minutes=60, seed=seed, max_years=6).play()
    return {k: v[0] for k, v in world12.SNAP.items()}
if __name__ == "__main__":
    with Pool(2) as p: S = p.map(snaps, [4, 11])
    jobs = []
    for k, e in EST.items():
        grid = [round(e * f, 3) for f in ((0.67, 0.8, 0.9, 1.0, 1.1) if k == 10 else (0.9, 0.95, 1.0, 1.05, 1.1))]
        for si, sn in enumerate(S):
            if k in sn:
                for em in grid: jobs.append((k, sn[k], em, 20))
    with Pool(2) as p: res = p.map(trial, jobs)
    best = {}
    for k in EST:
        agg = {}
        for kk, em, w, rr in res:
            if kk == k: a = agg.setdefault(em, [0, 0, 0]); a[0] += w; a[1] += rr; a[2] += 1
        rows = sorted((em, a[0] / a[2], a[1] / a[2]) for em, a in agg.items())
        print(k, [(m, round(w, 2), round(r, 1)) for m, w, r in rows], flush=True)
        best[k] = min(rows, key=lambda r: abs(r[1] - 0.35))
    print("best", {k: v[0] for k, v in best.items()})
    json.dump({k: v for k, v in best.items()}, open("calib_bd2.json", "w"))
