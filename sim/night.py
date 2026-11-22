import sys, json, time, copy, statistics as st
from checks import *
import core
def base_metrics(gs):
    s=summarize(gs); fq=[q for g in gs for q in g.G.get("floor_q",[])]
    s["floorq_p95"]=pct(fq,0.95); s["gold_end"]=st.mean(g.gold+g.bank for g in gs)
    return s
def keep(s): return {k:(dict(v) if isinstance(v,Counter) else v) for k,v in s.items()}
exp=sys.argv[1]; out={}; t=time.time()
if exp=="profiles":
    for acc in (0.65,0.8):
        for p in ["標準","慎重","無理をする","制作しない","投資しない","のんびり"]:
            out[f"{acc}_{p}"]=keep(base_metrics(full_games(acc,n=20,profile=p)))
elif exp=="growth":
    for a0,gr in ((0.5,0.0),(0.5,0.0015),(0.65,0.001)):
        out[f"{a0}+{gr}"]=keep(base_metrics(full_games(a0,n=20,acc_growth=gr)))
elif exp=="endgame":
    for acc in (0.65,0.8):
        gs=full_games(acc,n=16,endgame_days=120); s=base_metrics(gs)
        s["gold_end"]=st.mean(g.gold+g.bank for g in gs); s["gold_end_med"]=med([g.gold+g.bank for g in gs])
        s["lv_end"]=st.mean(st.mean(c.lv for c in g.party) for g in gs)
        out[str(acc)]=keep(s)
elif exp=="gold":
    import db
    for f in (1.1,0.9):
        for r in db.ECON: db.ECON[r]["_ri"]=db.ECON[r].get("_ri",db.ECON[r]["run_income"]); db.ECON[r]["run_income"]=db.ECON[r]["_ri"]*f
        for acc in (0.5,0.8): out[f"goldx{f}_{acc}"]=keep(base_metrics(full_games(acc,n=16)))
    for r in db.ECON: db.ECON[r]["run_income"]=db.ECON[r]["_ri"]
elif exp=="sens":
    base=dict(core.T)
    for k,f in [("base",1),("e_atk",1.1),("e_atk",0.9),("e_hp",1.1),("e_hp",0.9),("xp_k",1.1),("xp_k",0.9),("gold",1.1),("gold",0.9)]:
        core.T.clear(); core.T.update(base)
        if k=="gold":
            for d in DUNGEONS.values(): d["income"]=d.get("_inc",d["income"]); d["_inc"]=d["income"]; d["income"]*=f
        elif k!="base": core.T[k]=base[k]*f
        for acc in (0.5,0.8):
            out[f"{k}x{f}_{acc}"]=keep(base_metrics(full_games(acc,n=16)))
        if k=="gold":
            for d in DUNGEONS.values(): d["income"]=d["_inc"]
elif exp=="toggles":
    base=dict(core.T)
    for k,v in [("borrow",False),("items_in_battle",False)]:
        core.T.clear(); core.T.update(base); core.T[k]=v
        out[f"{k}={v}"]=keep(base_metrics(full_games(0.65,n=20)))
    core.T.clear(); core.T.update(base)
    out["noswitch"]=keep(base_metrics(full_games(0.65,n=20,allow_switch=False)))
elif exp=="season":
    PARTIES=(["戦士","ナイト","黒魔道士","白魔道士"],["盗賊","ナイト","白魔道士","吟遊詩人"])
    for r in range(1,6):
        for did in BY_RANK[r]:
            out[did]={se:st.mean(dungeon_trials(j,did,0.65,n=50,lvoff=1,seed=4,season=se)["clear"] for j in PARTIES) for se in ["春","夏","秋","冬"]}
            print(did,{k:f"{v:.0%}" for k,v in out[did].items()},flush=True)
json.dump(out,open(f"night_{exp}.json","w"),ensure_ascii=False,default=str)
print(exp,"done",round(time.time()-t),"s")
