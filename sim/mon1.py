import json, statistics as st
from checks import *
rows=monster_strength(n=80)
json.dump(rows,open("mon1.json","w"),ensure_ascii=False)
for r in range(1,6):
    rr=[x for x in rows if x["rank"]==r and not x["boss"]]; avg=st.mean(x["power"] for x in rr)
    out=[f"{x['name']}{x['power']/avg:.2f}" for x in rr if abs(x["power"]/avg-1)>0.3]
    bs=[f"{x['name']}:被ダメ{x['dmg']:.0%}/{x['rounds']:.1f}巡" for x in rows if x["rank"]==r and x["boss"]]
    print(f"★{r} 通常{len(rr)}体 外れ値:{out} ボス:{bs}")
cs=content_stats()
for r,v in cs.items(): print(r, "弱点",v["weak"], "\n   耐性",v["resist"], "\n   種別",v["types"], "状態",v["status"], "基本で突けない",v["unreach_basic"])
