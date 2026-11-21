import json, sys, time
from checks import *
r=int(sys.argv[1]); tag=sys.argv[2] if len(sys.argv)>2 else "1"
pool={2:db.BASE_JOBS,3:db.BASE_JOBS+db.MID_JOBS,5:db.BASE_JOBS+db.MID_JOBS+db.UPPER_JOBS}[r]
t=time.time(); avg,out=job_sweep(r,pool,combos={2:60,3:180,5:220}[r],n=20)
json.dump(dict(avg=avg,jobs=out),open(f"sweep{tag}_{r}.json","w"),ensure_ascii=False)
alias={j:"上級"+"ABC"[i] for i,j in enumerate(db.UPPER_JOBS)}
print(f"★{r} 平均{avg:.0%}", " ".join(f"{alias.get(j,j)}{d['diff']*100:+.0f}" for j,d in sorted(out.items(), key=lambda x:-x[1]['diff'])), f"({time.time()-t:.0f}s)")
