import sys, statistics as st, db
from checks import *
base={r:(db.ECON[r]["guild_fee"],db.ECON[r]["storage_fee"]) for r in db.ECON}
for f in [float(x) for x in sys.argv[1:]]:
    for r in db.ECON: db.ECON[r]["guild_fee"],db.ECON[r]["storage_fee"]=base[r][0]*f,base[r][1]*f
    for acc in (0.5,0.8):
        s=summarize(full_games(acc,n=20))
        print(f"x{f} {acc} ★5 {s['clear5_day']} 固定費 {s['fixed_share']:.0%} 滞納 {s['overdue']:.1%} 全滅 {s['wipes']:.1f}",flush=True)
