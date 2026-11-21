import json, time, statistics as st
from checks import *
t=time.time()
res={}
for acc in (0.5,0.65,0.8,0.95):
    s=summarize(full_games(acc,n=24)); res[acc]=s
    print(acc, "★5", s["clear5_day"], f"{s['clear5_done']:.0%}", "p90",s["clear5_p90"], "問題",s["realq"], "全滅",round(s["wipes"],1),
          {r:f"{v:.0%}" for r,v in s["wipe_rate"].items()}, "巡",round(s["rounds"],2),"問",round(s["qb"],1),"連続p90",s["streak_p90"],"最大",s["streak_max"],
          "遠征p95",s["runq_p95"],"最大",s["runq_max"], "滞納",f"{s['overdue']:.1%}","固定費",f"{s['fixed_share']:.0%}", "gate",round(s["gate_block"],1), flush=True)
print("unlock80",res[0.8]["unlock"]); print("adv80",res[0.8]["adv"]); print("dun80",res[0.8]["dungeon_use"]); print("switch80",res[0.8]["switches"])
print("items",res[0.8]["item_battle"], "goodroom",round(res[0.8]["good_room"],2))
json.dump({str(k):{kk:(vv if not isinstance(vv,Counter) else dict(vv)) for kk,vv in v.items()} for k,v in res.items()},open("base1.json","w"),ensure_ascii=False,default=str)
print("time",round(time.time()-t))
