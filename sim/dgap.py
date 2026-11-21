import json
from checks import *
from multiprocessing import Pool
def f(did):
    out=[]
    for jobs in (["戦士","ナイト","黒魔道士","白魔道士"],["盗賊","ナイト","白魔道士","吟遊詩人"],["武闘家","狩人","白魔道士","黒魔道士"]):
        r=dungeon_trials(jobs,did,0.65,n=50,lvoff=1,seed=3); out.append(r["clear"])
    return did,out
if __name__=="__main__":
    with Pool(5) as p: res=p.map(f,[d for r in range(1,6) for d in BY_RANK[r]])
    for d,o in res: print(DUNGEONS[d]["rank"],d," ".join(f"{x:.0%}" for x in o), f"avg {sum(o)/3:.0%}")
    json.dump(dict(res),open("dgap.json","w"))
