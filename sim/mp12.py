import sys, json, time, world12, core, battle
from multiprocessing import Pool
def one(a):
    seed, minutes, Tov = a
    core.T.update(Tov); battle.MPSTAT.clear()
    g = world12.Game12(["戦士", "ナイト", "黒魔道士", "白魔道士"], minutes=minutes, learner="標準", seed=seed, max_years=9).play()
    g.MP = {k: list(v) for k, v in battle.MPSTAT.items()}
    return g
if __name__ == "__main__":
    minutes = int(sys.argv[1]); n = int(sys.argv[2]); Tov = json.loads(sys.argv[3]); tag = sys.argv[4]
    with Pool(2) as p: gs = p.map(one, [(s, minutes, Tov) for s in range(n)])
    out = world12.summary(gs)
    mp = {}
    for g in gs:
        for k, v in g.MP.items():
            m = mp.setdefault(k, [0, 0, 0.0, 0, 0.0])
            for i in range(5): m[i] += v[i]
    out["mp"] = {f"Lv{k*20+1}-": dict(skill_share=round(v[1]/max(1,v[0]),3), mp_avg=round(v[2]/max(1,v[0]),2), mp_items_per_1k=round(v[3]*1000/max(1,v[0]),1), regen_per_act=round(v[4]/max(1,v[0]),3)) for k, v in sorted(mp.items())}
    json.dump(out, open(f"mp_{tag}.json", "w"), ensure_ascii=False)
    print(tag, "S", out["S_years"], "wipe", out.get("wipe_rate"), "rounds", out.get("rounds"))
    for k, v in out["mp"].items(): print(" ", k, v)
