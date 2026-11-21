import csv, json, sys
P="../data/skills.csv"
def apply(ch):
    rows=list(csv.DictReader(open(P,encoding="utf-8-sig")))
    for r in rows:
        if r["name"] in ch:
            e=json.loads(r["effect_json"]) if r["effect_json"].strip() not in ("","{}") else {}
            for path,v in ch[r["name"]].items():
                d=e; ks=path.split(".")
                for k in ks[:-1]: d=d.setdefault(k,{})
                d[ks[-1]]=v
            r["effect_json"]=json.dumps(e,ensure_ascii=False)
    with open(P,"w",newline="",encoding="utf-8-sig") as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
if __name__=="__main__": apply(json.loads(sys.argv[1]))
