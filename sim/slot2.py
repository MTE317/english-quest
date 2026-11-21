import sys, statistics as st
from checks import *
import battle as B
r=int(sys.argv[1]); jobs=sys.argv[2].split(","); core=sys.argv[3].split(",") if len(sys.argv)>3 else ["ナイト","白魔道士","黒魔道士"]
KO=Counter(); orig=B.enemy_turn
def et(e,party,ctx,rng,S):
    b={id(c):c.hp>0 for c in party}; orig(e,party,ctx,rng,S)
    for c in party:
        if b[id(c)] and c.hp<=0: KO[c.job]+=1
B.enemy_turn=et
for x in jobs:
    KO.clear(); res=[]
    for did in BY_RANK[r]:
        d=dungeon_trials(core+[x],did,0.65,n=60,lvoff=3,seed=5); res.append(d)
    S=res[0]["S"]; tot=sum(S["dmg_by_job"].values())
    print(x, "踏破",[f"{d['clear']:.0%}" for d in res], f"与ダメ{S['dmg_by_job'].get(x,0)/tot:.0%}", "KO",dict(KO), sorted(S["skill_use"].items(),key=lambda t:-t[1])[:5], "状態",dict(sorted(S["status"].items(),key=lambda t:-t[1])[:4]))
