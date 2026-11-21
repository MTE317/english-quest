import sys, statistics as st
from checks import *
import core
base=dict(core.T)
for name,kv in [("今（半分残る＋救済）",{}),("全部ロスト＋救済",{"wipe_xp_keep":0}),("全部ロスト・救済なし",{"wipe_xp_keep":0,"mercy":0})]:
    for acc in (0.5,0.65,0.8):
        core.T.clear(); core.T.update(base); core.T.update(kv)
        gs=full_games(acc,n=24); s=summarize(gs)
        print(name,acc,"★5",s["clear5_day"],"p90",s["clear5_p90"],"問",s["realq"],"全滅",round(s["wipes"],1),"連続p90",s["streak_p90"],"最大",max(g.G["max_streak"] for g in gs),{r:f"{float(p):.0%}" for r,p in s["wipe_rate"].items()},flush=True)
