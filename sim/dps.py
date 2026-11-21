import sys, statistics as st, random, db
from checks import *
import battle as B
r=int(sys.argv[1]); did=BY_RANK[r][0]
mons=[m for m in db.MONSTERS if m["rank"]==r and not m["boss"]]
jobs=[j for j in db.BASE_JOBS+db.MID_JOBS+(db.UPPER_JOBS if r>=4 else []) if j not in ("白魔道士","薬師","ナイト")]
U={j:"上級"+"ABC"[i] for i,j in enumerate(db.UPPER_JOBS)}
rows=[]
for x in jobs:
    g=make_party(["ナイト","白魔道士","黒魔道士",x] if x!="黒魔道士" else ["ナイト","白魔道士","戦士",x],did,0); c=g.party[3]; c.refresh()
    def avg(sk):
        v=[]
        for m in mons:
            e=Enemy(m,DUNGEONS[did]["el"],random.Random(1),r); ctx=B.Ctx(g.party,[e]); v.append(B.attack_value(c,ctx,e,sk,g.party,expected=True))
        return st.mean(v)
    n=avg(None); atk=[s for s in c.A if s["k"]=="atk"]
    cheap=max([avg(s) for s in atk if s["mp"]<=8] or [n]); big=max([avg(s) for s in atk] or [n])
    # 10手の期待：MPで大技を撃てるだけ撃ち、残りは安い技／通常
    mp=c.maxmp(); tot=0; bigs=[s for s in atk if s["mp"]>8]
    bmp=bigs[0]["mp"] if bigs else 99
    for i in range(10):
        if mp>=bmp: tot+=big; mp-=bmp
        elif mp>=5: tot+=cheap; mp-=6
        else: tot+=n
        mp+=0
    rows.append((U.get(x,x),round(n),round(cheap),round(big),round(tot/10),c.maxhp(),round(c.eva(),2)))
avgv=st.mean(t[4] for t in rows)
for t in sorted(rows,key=lambda t:-t[4]): print(f"★{r}",t[0],"通常",t[1],"安技",t[2],"大技",t[3],"10手平均",t[4],f"({t[4]/avgv*100:.0f}%)","HP",t[5],"回避",t[6])
