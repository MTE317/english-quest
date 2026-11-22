import json, time, statistics as st
from checks import *
t=time.time()
res={}
import sys
for acc in [float(a) for a in sys.argv[1:]]:
    s=summarize(full_games(acc,n=24)); res[acc]=s
    print(acc, "★5", s["clear5_day"], f"{s['clear5_done']:.0%}", "p90",s["clear5_p90"], "問題",s["realq"], "全滅",round(s["wipes"],1),
          {r:f"{v:.0%}" for r,v in s["wipe_rate"].items()}, "巡",round(s["rounds"],2),"問",round(s["qb"],1),"連続p90",s["streak_p90"],"最大",s["streak_max"],
          "遠征p95",s["runq_p95"],"最大",s["runq_max"], "滞納",f"{s['overdue']:.1%}","固定費",f"{s['fixed_share']:.0%}", flush=True)
a=max(res); print("unlock",res[a]["unlock"]); print("adv",res[a]["adv"]); print("dun",res[a]["dungeon_use"]); print("switch",res[a]["switches"])
print("items",res[a]["item_battle"], "goodroom",round(res[a]["good_room"],2))
import os; json.dump({str(k):{kk:(vv if not isinstance(vv,Counter) else dict(vv)) for kk,vv in v.items()} for k,v in res.items()},open(f"base2_{sys.argv[1]}.json","w"),ensure_ascii=False,default=str)
print("time",round(time.time()-t))
