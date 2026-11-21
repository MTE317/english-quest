import sys, json, time, world12, core
from multiprocessing import Pool
def one(a):
    seed, minutes, learner, Tov = a
    core.T.update(Tov)
    g = world12.Game12(["戦士", "ナイト", "黒魔道士", "白魔道士"], minutes=minutes, learner=learner, seed=seed, max_years=9).play()
    return g
if __name__ == "__main__":
    minutes = int(sys.argv[1]); learner = sys.argv[2]; n = int(sys.argv[3]); Tov = json.loads(sys.argv[4]) if len(sys.argv) > 4 else {}
    t = time.time()
    with Pool(2) as p: gs = p.map(one, [(s, minutes, learner, Tov) for s in range(n)])
    out = world12.summary(gs); out["time"] = round(time.time() - t)
    tag = sys.argv[5] if len(sys.argv) > 5 else f"{minutes}_{learner}"
    json.dump(out, open(f"r12_{tag}.json", "w"), ensure_ascii=False)
    print(tag, json.dumps(out, ensure_ascii=False))
