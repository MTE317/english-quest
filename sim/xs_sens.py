# 固有装備・セット・振り直し・強化薬などの「上乗せ」が、ボスダンジョンと闘技場の難しさをどれだけ下げるか
import json, world12, core, db, csv, os
from multiprocessing import Pool
import calib_bd, arena_sim
from calib_bd2 import snaps
def job(a):
    kind, k, g0, xs = a
    core.T["xs"] = xs
    if kind == "boss":
        bid = world12.BOSSD[k]; em = float(next(r for r in csv.DictReader(open(os.path.join(db.SEC, "boss_dungeons.csv"), encoding="utf-8-sig")) if int(r["star"]) == k)["enemy_mul"])
        r = calib_bd.trial((k, g0, em, 15)); out = r[2]
    else:
        r = arena_sim.fight((k, g0, 1.0, 10, 900, "front")); out = r[2]
    core.T["xs"] = 0
    return kind, k, xs, out
if __name__ == "__main__":
    with Pool(2) as p: S = p.map(snaps, [4])
    sn = S[0]
    jobs = [(kind, k, sn[k], xs) for k in range(1, 13) if k in sn for kind in ("boss", "arena") for xs in (0.0, 0.1, 0.25)]
    with Pool(2) as p: res = p.map(job, jobs)
    json.dump(res, open("xs_sens.json", "w"))
    for kind in ("boss", "arena"):
        print(kind)
        for k in range(1, 13):
            print(" ", k, [(xs, round(v, 2)) for kd, kk, xs, v in res if kd == kind and kk == k])
