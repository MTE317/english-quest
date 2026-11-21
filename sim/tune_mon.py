"""外れ値のモンスターのHPと攻撃力を、強さが平均に近づくように直してCSVに書き戻す"""
import csv, json, statistics as st, importlib
import db, checks
P="/home/claude/eq/data/monsters.csv"
def load(): return list(csv.DictReader(open(P,encoding="utf-8-sig")))
def save(rows):
    with open(P,"w",newline="",encoding="utf-8-sig") as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
log=[]
for it in range(3):
    importlib.reload(db); importlib.reload(checks)
    res=checks.monster_strength(n=60); byid={x["id"]:x for x in res}
    bosses=[x["power"] for x in res if x["boss"]]; bt=st.median(bosses)
    rows=load(); changed=0
    for r in range(1,6):
        rr=[x for x in res if x["rank"]==r and not x["boss"]]; avg=st.mean(x["power"] for x in rr)
        for row in rows:
            x=byid[row["id"]]
            if x["rank"]!=r: continue
            ratio=x["power"]/(bt if x["boss"] else avg)
            lo,hi=(0.8,1.25)
            if ratio<lo or ratio>hi:
                f=(1/ratio)**0.5; f=max(0.7,min(1.4,f))
                old=(row["hp_mul"],row["atk_mul"])
                row["hp_mul"]=str(round(float(row["hp_mul"])*f,2)); row["atk_mul"]=str(round(float(row["atk_mul"])*f**0.8,2))
                log.append((it,row["name"],round(ratio,2),old,(row["hp_mul"],row["atk_mul"]))); changed+=1
    save(rows); print("iter",it,"changed",changed)
    if not changed: break
json.dump(log,open("tune_mon_log.json","w"),ensure_ascii=False)
importlib.reload(db); importlib.reload(checks)
res=checks.monster_strength(n=80); json.dump(res,open("mon2.json","w"),ensure_ascii=False)
for r in range(1,6):
    rr=[x for x in res if x["rank"]==r and not x["boss"]]; avg=st.mean(x["power"] for x in rr)
    print(r, "範囲", round(min(x["power"]/avg for x in rr),2), "〜", round(max(x["power"]/avg for x in rr),2), "ボス", [round(x["power"],2) for x in res if x["rank"]==r and x["boss"]])
