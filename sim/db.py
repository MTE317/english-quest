"""CSV（元データ）を読み込んで、シミュレーションで使う形にする"""
import csv, json, os
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(BASE, "data"); SEC = os.path.join(BASE, "secret")
def R(path): return list(csv.DictReader(open(path, encoding="utf-8-sig")))
def f(x, d=0.0):
    try: return float(x)
    except (TypeError, ValueError): return d
BAL = json.load(open(os.path.join(D, "balance.json"), encoding="utf-8"))

ELEM = {r["id"]: r["name"] for r in R(f"{D}/elements.csv")}
ELEM_ID = {v: k for k, v in ELEM.items()}
SEASON = {r["id"]: r["name"] for r in R(f"{D}/seasons.csv")}
TYPES = {r["id"]: r["name"] for r in R(f"{D}/monster_types.csv")}
STATUS = {r["id"]: dict(r, value=f(r["value"]), turns=int(r["turns"]), persists=r["persists_after_battle"] == "1") for r in R(f"{D}/status_effects.csv")}
STATUS_BY_NAME = {v["name"]: v for v in STATUS.values()}
EL = lambda s: [ELEM[x] for x in s.split("|") if x]

# ---- 武器・防具
WEAPONS = {}; WID = {}
for r in R(f"{D}/weapon_types.csv"):
    w = dict(kind="mag" if r["id"] in ("staff", "tome", "instrument") else "phys", el=EL(r["elements"]))
    if f(r["power_mul"], 1) != 1: w["pm"] = f(r["power_mul"])
    if f(r["spd_mod"]): w["spd"] = f(r["spd_mod"])
    if f(r["crit_bonus"]): w["crt"] = f(r["crit_bonus"])
    if f(r["def_pierce"]): w["pierce"] = f(r["def_pierce"])
    if r["hits"] != "1.0": w["hits"] = [f(x) for x in r["hits"].split("|")]
    if r["id"] == "staff": w["heal"] = 1.15
    if r["id"] == "tome": w["mm"] = 1.1
    if r["id"] == "gun": w["gun"] = True
    if r["id"] == "whip": w["whip"] = True
    w["hands"] = int(r["hands"]); w["id"] = r["id"]
    WEAPONS[r["name"]] = w; WID[r["id"]] = r["name"]
ARMOR_W = {"重": dict(v=1.0, spd=-3, eva=0.0), "中": dict(v=0.65, spd=0, eva=0.03), "軽": dict(v=0.35, spd=0, eva=0.08)}
AW = {"heavy": "重", "medium": "中", "light": "軽"}

# ---- ジョブ
JID = {}; JOBS = {}; TIER = {}
def _job(r, tier):
    JID[r["id"]] = r["name"]; TIER[r["name"]] = tier
    JOBS[r["name"]] = dict(id=r["id"], g=" ".join(r[k] for k in ("hp", "str", "mag", "def", "res", "spd", "luk")), w={}, armor={}, tier=tier)
for r in R(f"{D}/jobs.csv"): _job(r, "基本")
for r in R(f"{D}/jobs_mid.csv"): _job(r, "中級")
UPPER = R(f"{SEC}/upper_jobs.csv") if os.path.exists(f"{SEC}/upper_jobs.csv") else []
for r in UPPER: _job(r, "上級")
for r in R(f"{D}/job_weapon_aptitude.csv"):
    j = JID[r["job_id"]]
    for wid, g in r.items():
        if wid != "job_id" and g not in ("×", ""): JOBS[j]["w"][WID[wid]] = g
for r in R(f"{D}/job_armor_aptitude.csv"):
    j = JID[r["job_id"]]; JOBS[j]["armor"] = {AW[k]: r[k] for k in ("heavy", "medium", "light")}
for r in UPPER:
    j = r["name"]
    for p in r["weapons"].split("|"):
        wid, g = p.split(":"); JOBS[j]["w"][WID[wid]] = g
    JOBS[j]["armor"] = {"重": r["armor_heavy"], "中": r["armor_medium"], "軽": r["armor_light"]}
for j, d in JOBS.items():
    best = max(d["w"], key=lambda w: {"S": 3, "A": 2, "B": 1, "C": 0}[d["w"][w]])
    d["start_weapon"] = best
    d["arm"] = max(d["armor"], key=lambda a: {"S": 3, "A": 2, "B": 1, "C": 0, "×": -1}[d["armor"][a]])
BASE_JOBS = [j for j in JOBS if TIER[j] == "基本"]; MID_JOBS = [j for j in JOBS if TIER[j] == "中級"]; UPPER_JOBS = [j for j in JOBS if TIER[j] == "上級"]
STAGE_AP = {"基本": [0, 10, 20, 30], "中級": [0, 20, 30, 40], "上級": [0, 20, 30, 40]}

# ---- スキル
KIND = {"attack": "atk", "heal": "heal", "heal_all": "healall", "revive": "revive", "cure": "cure", "cure_all": "cureall", "party_buff": "pbuff",
        "self_buff": "sbuff", "ally_buff": "abuff", "debuff": "debuff", "status": "status", "imbue": "imbue", "delayed": "delayed", "passive": "passive",
        "utility": "util", "mp_give": "mpgive", "fixed_damage": "fixed"}
ST_JA = {"毒", "猛毒", "火傷", "出血", "呪い", "睡眠", "麻痺", "凍結", "スタン", "石化", "束縛", "恐怖", "沈黙", "封印", "暗闇", "混乱", "魅了", "DEFダウン"}
def _skill(r, jobname):
    eff = json.loads(r["effect_json"]) if r["effect_json"] else {}
    s = dict(job=jobname, path=r["path"], stage=int(r["stage"]), name=r["name"], k=KIND[r["kind"]], cost=int(r["cost"]), mp=int(r["mp"]),
             final=r["is_final"] == "1")
    s.update(eff)
    if r["element"]:
        els = EL(r["element"])
        if s["k"] == "imbue": s["el"] = els[0]
        else: s["el"] = els
    if "st" in s:
        n = s["st"][0]
        if n in STATUS: n = STATUS[n]["name"]
        s["st"] = (n, s["st"][1])
    if s["k"] == "passive" and "mod" not in s: s["mod"] = {}
    return s
SKILLS = [_skill(r, JID[r["job"]]) for r in R(f"{D}/skills.csv") if r["job"] != "common"]
if os.path.exists(f"{SEC}/upper_skills.csv"):
    SKILLS += [_skill(r, JID[r["job"]]) for r in R(f"{SEC}/upper_skills.csv")]
BY_JOB = {}
for s in SKILLS: BY_JOB.setdefault(s["job"], []).append(s)

# ---- モンスター・ダンジョン
MONSTERS = []; MON_BY_ID = {}
MAT = {r["id"]: r for r in R(f"{D}/materials.csv")}
for r in R(f"{D}/monsters.csv"):
    dun = r["dungeons"].split("|")
    rep = {}
    if r["replaces"]:
        for d_, x in zip(dun, r["replaces"].split("|")): rep[d_] = x
    m = dict(id=r["id"], name=r["name"], icon=r["icon"], rank=int(r["dungeon_rank"]), dungeons=dun, types=[TYPES[t] for t in r["types"].split("|")],
             weak=EL(r["weak"]), resist=EL(r["resist"]), hp=f(r["hp_mul"]), atk=f(r["atk_mul"]), df=f(r["def_mul"]), rs=f(r["res_mul"]),
             sp=f(r["spd_mul"]), magic=f(r["magic_rate"]), st=(STATUS[r["status"]]["name"], f(r["status_rate"])) if r["status"] else None,
             elem=ELEM.get(r["attack_element"]) if r["attack_element"] else None, season=SEASON.get(r["season"]), replaces=rep,
             boss=r["is_boss"] == "1", mat=(r["material_common"], r["material_rare"]))
    MONSTERS.append(m); MON_BY_ID[r["id"]] = m
DUNGEONS = {}
for r in R(f"{D}/dungeons.csv"):
    DUNGEONS[r["id"]] = dict(id=r["id"], rank=int(r["rank"]), name=r["name"], days=int(r["days"]), floors=int(r["floors"]), el=int(r["enemy_lv_floor1"]),
                             ilvl=(int(r["item_lv_min"]), int(r["item_lv_max"])), rp=int(r["return_point_floor"]) if r["return_point_floor"] else None,
                             boss=r["boss_id"], income=f(r["income_mul"], 1), emul=f(r.get("enemy_mul") or "", 1), floor_rows=[], drop=None)
for r in R(f"{D}/dungeon_floors.csv"):
    DUNGEONS[r["dungeon_id"]]["floor_rows"].append(dict(floor=int(r["floor"]), lv=int(r["enemy_level"]), battles=int(r["battles"]),
                                                       n=int(r["enemies_per_battle"]), boss=r["last_battle_is_boss"] == "1", rp=r["return_point_after"] == "1"))
for r in R(f"{D}/drop_tables.csv"):
    DUNGEONS[r["dungeon_id"]]["drop"] = dict(gear=f(r["gear_drop_rate_per_battle"]), mat=f(r["material_rate_per_enemy"]), rare=f(r["rare_material_rate"]),
                                             gold=f(r["gold_share_of_run_income"]), boss_gold=f(r["boss_gold_mul"]), boss_gear=f(r["boss_gear_drop"]))
BY_RANK = {}
for d in DUNGEONS.values(): BY_RANK.setdefault(d["rank"], []).append(d["id"])

def pool(did, season):
    base = [m for m in MONSTERS if did in m["dungeons"] and not m["boss"] and m["season"] is None]
    sea = [m for m in MONSTERS if did in m["dungeons"] and not m["boss"] and m["season"] == season]
    gone = {m["replaces"].get(did) for m in sea}
    return [m for m in base if m["id"] not in gone] + sea

# ---- アイテム・経済・施設・ランク・クエスト
ITEMS = {r["name"]: dict(id=r["id"], price=int(r["price"]), rank=int(r["shop_rank"]), effect=r["effect"], value=r["value"], target=r["target"]) for r in R(f"{D}/items.csv")}
ECON = {int(r["dungeon_rank"]): {k: f(v) for k, v in r.items()} for r in R(f"{D}/economy_by_rank.csv")}
FAC = {int(r["rank"]): {k: f(v) for k, v in r.items()} for r in R(f"{D}/facility_ranks.csv")}
INN = {int(r["inn_rank"]): {k: f(v) for k, v in r.items() if k != "description"} for r in R(f"{D}/inn_rooms.csv")}
ADV = [dict(id=r["id"], title=r["title"], pts=int(r["points_required"]), maxr=int(r["max_dungeon_rank"]), boss=r["needs_boss_clear"] == "1", qb=f(r.get("quest_bonus", "")), disc=f(r.get("shop_discount", ""))) for r in R(f"{D}/adventurer_ranks.csv")]
RAR = [dict(id=r["id"], name=r["name"], w=f(r["drop_weight_pct"]), n=int(r["random_effects"])) for r in R(f"{D}/rarities.csv")]
ENH = [f(r["success_rate"]) for r in R(f"{D}/enhance_rates.csv")]
AFFIX = {}
for r in R(f"{D}/affixes.csv"): AFFIX.setdefault(r["slot"], []).append(dict(stat=r["stat"], lo=f(r["min"]), hi=f(r["max"]), scale=r["scales_with_item_lv"] == "1", w=f(r["weight"])))
EQUIP = R(f"{D}/equipment.csv")
UNLOCKS = {JID[r["job_id"]]: dict(method=r["method"], mats=[(p.split(":")[0], int(p.split(":")[1])) for p in r["materials"].split("|") if p],
                                  dungeon=r["discover_dungeon"], chance=f(r["discover_chance_after_boss"])) for r in R(f"{D}/job_unlocks.csv")}
for r in UPPER:
    if r["unlock_method"] == "素材":
        UNLOCKS[r["name"]] = dict(method="素材", mats=[(p.split(":")[0], int(p.split(":")[1])) for p in r["unlock_detail"].split("|")], dungeon="", chance=0)
    else:
        d_, c = r["unlock_detail"].split(":"); UNLOCKS[r["name"]] = dict(method="発見", mats=[], dungeon=d_, chance=float(c))
TARGETS = R(f"{D}/targets.csv")
QUESTS = R(f"{D}/quests.csv")
