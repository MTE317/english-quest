import json, csv, db
from checks import *
from multiprocessing import Pool
PARTIES=(["戦士","ナイト","黒魔道士","白魔道士"],["盗賊","ナイト","白魔道士","吟遊詩人"],["武闘家","狩人","白魔道士","黒魔道士"])
TGT={"mossy_cave":None,"sunlit_forest":None,"ruined_fort":.80,"misty_marsh":.70,"howling_canyon":.85,"ancient_library":.73,
     "sunken_temple":.85,"clockwork_mine":.88,"obsidian_volcano":.85,"frozen_peak":.73}
def ev(did,m):
    DUNGEONS[did]["emul"]=m
    return sum(dungeon_trials(j,did,0.65,n=60,lvoff=1,seed=3)["clear"] for j in PARTIES)/3
def tune(did):
    t=TGT[did]
    if t is None: return did,1.0,ev(did,1.0)
    lo,hi=0.6,1.4
    for _ in range(7):
        m=(lo+hi)/2; c=ev(did,m)
        if c>t: lo=m
        else: hi=m
    m=round((lo+hi)/2,2); return did,m,ev(did,m)
if __name__=="__main__":
    with Pool(2) as p: res=p.map(tune,list(TGT))
    for r in res: print(r)
    P="../data/dungeons.csv"; rows=list(csv.DictReader(open(P,encoding="utf-8-sig")))
    mm={d:m for d,m,c in res}
    for r in rows: r["enemy_mul"]=f"{mm[r['id']]:.2f}"
    with open(P,"w",newline="",encoding="utf-8-sig") as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
    json.dump(res,open("tune_dun.json","w"))
