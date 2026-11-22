# 詠唱（瞬間英作文）の出題数と JP の見積もり
import random, statistics as st
def run(inflow, days, cap, seed=1):
    r=random.Random(seed); items=[]  # [due_day, S, reps]
    out=[]
    for d in range(days):
        for _ in range(inflow): items.append([d+1,1.0,0])
        due=[it for it in items if it[0]<=d]; due.sort(key=lambda x:x[0])
        done=due[:cap]; jp=0
        for it in done:
            # 回数を重ねるほど○が増える
            po=min(0.8,0.45+0.08*it[2]); pt=0.25
            x=r.random()
            if x<po: it[1]*=2.5; jp+=10
            elif x<po+pt: it[1]*=1.3; jp+=6
            else: it[1]=1.0; jp+=3
            it[2]+=1; it[0]=d+max(1,round(it[1]))
        out.append((len(due),len(done),jp))
    return out
for name,inflow,cap in [("15分",8,15),("30分",13,30),("60分",22,60)]:
    o=run(inflow,400,cap)
    for d in (2,6,13,29,89,179,364):
        print(name,"day",d+1,"期限",o[d][0],"詠唱",o[d][1],"JP",o[d][2])
print("---- 新しく詠唱に入る数を絞る ----")
def run2(newcap, days, cap, seed=1):
    r=random.Random(seed); items=[]; out=[]
    for d in range(days):
        due=[it for it in items if it[0]<=d]
        room=max(0,cap-len(due)); n=min(newcap,room)
        for _ in range(n): items.append([d,1.0,0])
        due=[it for it in items if it[0]<=d][:cap]; jp=0
        for it in due:
            po=min(0.8,0.45+0.08*it[2]); x=r.random()
            if x<po: it[1]*=2.5; jp+=10
            elif x<po+0.25: it[1]*=1.3; jp+=6
            else: it[1]=1.0; jp+=3
            it[2]+=1; it[0]=d+max(1,round(it[1]))
        out.append((len(items),len(due),jp))
    return out
for cap,nc in [(15,3),(30,5),(60,10)]:
    o=run2(nc,1500,cap); 
    for d in (6,29,179,364,729,1459): print("1日",cap,"問・新",nc,"day",d+1,"累計語",o[d][0],"JP",o[d][2])
