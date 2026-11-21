import sys, json, statistics as st
from checks import *
r=int(sys.argv[1]); core=["ナイト","白魔道士","黒魔道士"]
pool=[j for j in db.BASE_JOBS+db.MID_JOBS+(db.UPPER_JOBS if r==5 else []) if j not in core]
alias={j:"上級"+"ABC"[i] for i,j in enumerate(db.UPPER_JOBS)}
out={}
for x in pool:
    cl=[dungeon_trials(core+[x],did,0.65,n=60,lvoff=1,seed=11)["clear"] for did in BY_RANK[r]]
    out[alias.get(x,x)]=st.mean(cl)
json.dump(out,open(f"slot3_{r}.json","w"),ensure_ascii=False)
print(f"★{r}", " ".join(f"{k}{v:.0%}" for k,v in sorted(out.items(), key=lambda t:-t[1])))
