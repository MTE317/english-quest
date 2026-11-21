import json, statistics as st, db
from checks import *
from multiprocessing import Pool
U={j:"上級"+"ABC"[i] for i,j in enumerate(db.UPPER_JOBS)}
ROLES={
 "物理アタッカー":(["ナイト","白魔道士","黒魔道士"],["戦士","狩人","盗賊","武闘家","銃士","魔法剣士",db.UPPER_JOBS[0]]),
 "魔法アタッカー":(["ナイト","白魔道士","戦士"],["黒魔道士","精霊術士","呪術師"]),
 "回復":(["ナイト","戦士","黒魔道士"],["白魔道士","薬師",db.UPPER_JOBS[1]]),
 "支援":(["ナイト","白魔道士","戦士"],["吟遊詩人","踊り子"]),
 "盾":(["白魔道士","戦士","黒魔道士"],["ナイト",db.UPPER_JOBS[2]]),
}
def run(a):
    role,x=a; core,_=ROLES[role]; out={}
    for r in (3,4,5):
        if x in db.UPPER_JOBS and r<4: continue
        if x in db.MID_JOBS and r<3: continue
        out[r]=st.mean(dungeon_trials(core+[x],did,0.65,n=40,lvoff=-1,seed=21)["clear"] for did in BY_RANK[r])
    return role,U.get(x,x),out
if __name__=="__main__":
    tasks=[(ro,x) for ro,(c,xs) in ROLES.items() for x in xs]
    with Pool(2) as p: res=p.map(run,tasks)
    json.dump(res,open("roles.json","w"),ensure_ascii=False)
    for ro in ROLES:
        rr=[x for x in res if x[0]==ro]
        for r in (3,4,5):
            v={j:o[r] for _,j,o in rr if r in o}
            if len(v)>1: print(ro,f"★{r}","差",f"{(max(v.values())-min(v.values()))*100:.0f}"," ".join(f"{j}{p:.0%}" for j,p in sorted(v.items(),key=lambda t:-t[1])))
