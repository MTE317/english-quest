# ★12に広げるデータ生成（1回だけ実行。以後はCSVを直接直す）
import csv, json, random, os, math
D = "data"; SEC = "secret"
rng = random.Random(1212)

def R(n, d=D): return list(csv.DictReader(open(f"{d}/{n}", encoding="utf-8-sig")))
def W(n, fn, rows, d=D):
    with open(f"{d}/{n}", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fn, extrasaction="ignore"); w.writeheader()
        for r in rows: w.writerow(r)

STARS = range(1, 13)
def el_floor1(k):            # 敵Lvの1階
    return {1: 1, 2: 6, 3: 15, 4: 22, 5: 29}.get(k, 29 + 7 * (k - 5))
def days_base(k): return {1: 2, 2: 3, 3: 3, 4: 4}.get(k, 5)

# ================================================================ ダンジョン（★ごとに5つ）
KIND = {  # floors, rp, days_add, income, emul, mat_mul, rare_mul
    "標準":     (5, 3, 0, 1.00, 1.00, 1.0, 1.0),
    "深層":     (7, 4, 2, 1.50, 0.95, 1.0, 1.3),
    "近場":     (3, "", -1, 0.80, 1.00, 1.0, 1.0),
    "素材の宝庫": (5, 3, 0, 0.90, 1.08, 1.8, 1.5),
    "季節の地":  (5, 3, 0, 1.05, 1.00, 1.0, 1.0),
}
# id, ★, 名前, 種類, 主な属性（敵の攻撃）, 多い種別, 特徴の文
NEW_DUN = [
 ("twisted_tunnel", 1, "ねじれ根の地下道", "深層", "earth", "plant|insect", "長い。根と虫が多い"),
 ("goblin_quarry", 1, "小鬼の石切り場", "素材の宝庫", "blunt", "humanoid|beast", "硬めの敵が多いが、素材がたくさん出る"),
 ("blooming_hill", 1, "花咲く丘", "季節の地", "wind", "plant|fairy", "季節で出るモンスターが大きく変わる"),
 ("roadside_well", 2, "街道の古井戸", "近場", "water", "aquatic|amorphous", "短い。水の敵が多い"),
 ("old_catacomb", 2, "地下墓地", "深層", "dark", "undead|ghost", "長い。アンデッドが多く、光が効く"),
 ("migrant_cape", 2, "渡り鳥の岬", "季節の地", "wind", "bird|beast", "季節で渡ってくる鳥が変わる"),
 ("windmill_village", 3, "風車の廃村", "近場", "wind", "humanoid|ghost", "短い。風の敵が多い"),
 ("amber_dig", 3, "琥珀の採掘場", "素材の宝庫", "earth", "insect|golem", "素材がたくさん出る"),
 ("moonlit_lake", 3, "月影の湖", "季節の地", "water", "fairy|aquatic", "季節で湖の住人が変わる"),
 ("silent_corridor", 4, "沈黙の大回廊", "深層", "dark", "ghost|undead", "長い。沈黙と恐怖が多い"),
 ("miasma_jungle", 4, "毒霧の密林", "素材の宝庫", "earth", "plant|insect", "毒が多いが、素材がたくさん出る"),
 ("drifting_clouds", 4, "移ろう雲海", "季節の地", "thunder", "bird|spirit", "季節で雲の上の住人が変わる"),
 ("ash_road", 5, "灰の街道", "近場", "fire", "demon|beast", "短い。炎の敵が多い"),
 ("dragonbone_vale", 5, "竜骨の谷", "素材の宝庫", "fire", "dragon|undead", "竜の素材がたくさん出る"),
 ("aurora_field", 5, "極光の雪原", "季節の地", "ice", "spirit|beast", "季節で雪原の様子が変わる"),
 ("sand_tomb", 6, "砂の王墓", "標準", "earth", "undead|golem", "標準。石化を使う敵がいる"),
 ("millennium_root", 6, "千年樹の根", "深層", "earth", "plant|insect", "長い。植物と虫が多い"),
 ("storm_lighthouse", 6, "嵐の灯台", "近場", "thunder", "bird|machine", "短い。雷の敵が多い"),
 ("crystal_hollow", 6, "水晶の洞", "素材の宝庫", "light", "golem|spirit", "硬い敵が多いが、素材がたくさん出る"),
 ("four_season_garden", 6, "四季の庭園", "季節の地", "wind", "fairy|plant", "季節で庭の住人が変わる"),
 ("sky_isles", 7, "天空の浮島", "標準", "wind", "bird|divine_beast", "標準。素早い敵が多い"),
 ("drowned_city", 7, "沈んだ都", "深層", "water", "aquatic|undead", "長い。水の敵と亡者が多い"),
 ("rusted_armory", 7, "錆びた兵器庫", "近場", "thunder", "machine|golem", "短い。機械が多い"),
 ("beast_den", 7, "魔獣の巣窟", "素材の宝庫", "blunt", "beast|aberration", "強い獣が多いが、素材がたくさん出る"),
 ("mirage_sands", 7, "幻の蜃気楼", "季節の地", "light", "spirit|aberration", "季節で幻が変わる"),
 ("black_forest", 8, "黒き森", "標準", "dark", "beast|fairy", "標準。暗闇と魅了が多い"),
 ("giants_stair", 8, "巨人の階段", "深層", "blunt", "giant|golem", "長い。体力の多い敵が多い"),
 ("mirror_maze", 8, "鏡の迷宮", "近場", "light", "aberration|spirit", "短い。混乱が多い"),
 ("bog_kingdom", 8, "毒沼の王国", "素材の宝庫", "water", "amorphous|aquatic", "猛毒が多いが、素材がたくさん出る"),
 ("thunder_plateau", 8, "雷鳴の高原", "季節の地", "thunder", "bird|beast", "季節で高原の天気と住人が変わる"),
 ("demon_gate", 9, "魔界の門", "標準", "dark", "demon|undead", "標準。呪いと衰弱が多い"),
 ("starfall_tower", 9, "星降る塔", "深層", "light", "spirit|divine_beast", "長い。魔法の敵が多い"),
 ("bone_bridge", 9, "骨の橋", "近場", "dark", "undead|ghost", "短い。アンデッドが多い"),
 ("ruby_vein", 9, "紅玉の鉱脈", "素材の宝庫", "fire", "golem|machine", "硬い敵が多いが、素材がたくさん出る"),
 ("frozen_time_village", 9, "時の止まった村", "季節の地", "none", "ghost|humanoid", "季節で村に現れるものが変わる"),
 ("dragon_spine", 10, "竜の背骨山脈", "標準", "fire", "dragon|beast", "標準。竜が多い"),
 ("abyss_pit", 10, "深淵の大穴", "深層", "dark", "aberration|demon", "長い。死の宣告を使う敵がいる"),
 ("flame_gate", 10, "炎の門", "近場", "fire", "demon|spirit", "短い。炎の敵が多い"),
 ("sacred_beast_wood", 10, "神獣の森", "素材の宝庫", "light", "divine_beast|beast", "神獣が多いが、素材がたくさん出る"),
 ("frozen_sea", 10, "凍れる海", "季節の地", "ice", "aquatic|dragon", "季節で海の住人が変わる"),
 ("heaven_temple", 11, "天上の神殿", "標準", "light", "divine_beast|spirit", "標準。光の敵が多い"),
 ("void_corridor", 11, "虚空の回廊", "深層", "dark", "aberration|ghost", "長い。封印と石化が多い"),
 ("ancient_engine", 11, "古代機械の心臓", "近場", "thunder", "machine|golem", "短い。機械が多い"),
 ("dragon_king_vault", 11, "竜王の宝物庫", "素材の宝庫", "fire", "dragon|golem", "竜が多いが、素材がたくさん出る"),
 ("dream_garden", 11, "夢見の花園", "季節の地", "wind", "fairy|plant", "季節で夢の中身が変わる"),
 ("world_tree_top", 12, "世界樹の頂", "標準", "wind", "divine_beast|plant", "標準。すべての属性の敵が出る"),
 ("labyrinth_end", 12, "終わりの迷宮", "深層", "none", "aberration|demon", "長い。いちばん奥の迷宮"),
 ("star_shore", 12, "星の海辺", "近場", "water", "spirit|aquatic", "短い。魔法の敵が多い"),
 ("gods_forge", 12, "神々の鍛冶場", "素材の宝庫", "fire", "golem|machine", "硬い敵が多いが、素材がたくさん出る"),
 ("twilight_border", 12, "黄昏の境界", "季節の地", "dark", "ghost|divine_beast", "季節で光と闇の強さが変わる"),
]
OLD_KIND = {"mossy_cave": "標準", "sunlit_forest": "近場", "ruined_fort": "標準", "misty_marsh": "素材の宝庫",
            "howling_canyon": "標準", "ancient_library": "深層", "sunken_temple": "標準", "clockwork_mine": "近場",
            "obsidian_volcano": "標準", "frozen_peak": "深層"}
old_d = R("dungeons.csv")
dungeons = []
for r in old_d:
    r["kind"] = OLD_KIND[r["id"]]; dungeons.append(r)
DUN_META = {}   # id -> (elem, types)
OLD_META = {"mossy_cave": ("blunt", "humanoid|beast"), "sunlit_forest": ("wind", "plant|insect"), "ruined_fort": ("blunt", "golem|humanoid"),
            "misty_marsh": ("water", "amorphous|aquatic"), "howling_canyon": ("wind", "beast|bird"), "ancient_library": ("none", "spirit|ghost"),
            "sunken_temple": ("water", "aquatic|ghost"), "clockwork_mine": ("thunder", "machine|golem"), "obsidian_volcano": ("fire", "dragon|demon"),
            "frozen_peak": ("ice", "spirit|beast")}
DUN_META.update(OLD_META)
for did, k, name, kind, el, ty, ch in NEW_DUN:
    fl, rp, dadd, inc, em, _, _ = KIND[kind]
    e1 = el_floor1(k) + (1 if kind in ("近場",) else 0)
    dungeons.append(dict(id=did, rank=k, name=name, days=max(1, days_base(k) + dadd), floors=fl, enemy_lv_floor1=e1,
                         item_lv_min=1 + 10 * (k - 1), item_lv_max=15 + 10 * (k - 1), return_point_floor=rp, boss_id=did + "_boss",
                         enemy_mul=f"{em:.2f}", income_mul=f"{inc:.2f}", kind=kind, character=f"{kind}。{ch}"))
    DUN_META[did] = (el, ty)
BY_STAR = {k: [d for d in dungeons if int(d["rank"]) == k] for k in STARS}
assert all(len(v) == 5 for v in BY_STAR.values()), {k: len(v) for k, v in BY_STAR.items()}

# ================================================================ モンスター
TYPES = [r["id"] for r in R("monster_types.csv")]
NOUN = {  # 種別ごとの名前の部品
 "amorphous": ["スライム", "粘体", "泥人形", "ゼリー"], "beast": ["狼", "大熊", "猪", "山猫", "獅子", "大角鹿", "牙虎"],
 "humanoid": ["山賊", "魔術師", "剣士", "斥候", "呪い師", "槍兵"], "bird": ["大鷲", "怪鳥", "夜鴉", "梟", "火喰い雀", "雷鷹"],
 "insect": ["大蟻", "毒蜂", "大蠍", "鎌蟷螂", "甲虫", "大蜘蛛"], "spirit": ["精霊", "鬼火", "風の子", "光の精"],
 "plant": ["人食い花", "樹人", "茨の蔓", "胞子茸", "マンドラ"], "undead": ["骸骨兵", "屍鬼", "骨の騎士", "腐れ人"],
 "golem": ["石像兵", "岩の巨人", "結晶像", "鉄塊兵"], "ghost": ["亡霊", "怨霊", "影法師", "さまよう魂"],
 "giant": ["一つ目巨人", "丘巨人", "霜巨人", "岩巨人"], "aquatic": ["魚人", "大海蛇", "大蛸", "鎧蟹", "大クラゲ"],
 "demon": ["小鬼", "魔人", "夢魔", "炎の悪魔", "影の悪魔"], "machine": ["機械兵", "歯車蜘蛛", "砲台", "自動人形"],
 "fairy": ["いたずら妖精", "花の妖精", "森の小人", "月の妖精"], "dragon": ["飛竜", "地竜", "火竜", "氷竜", "竜の仔"],
 "aberration": ["目玉の怪", "触手の怪", "歪んだ獣", "影の塊"], "divine_beast": ["聖なる鹿", "天馬", "白虎", "霊亀", "光の獅子"],
}
ICON = {"amorphous": "🟢", "beast": "🐺", "humanoid": "🧑", "bird": "🦅", "insect": "🐜", "spirit": "✨", "plant": "🌿", "undead": "💀",
        "golem": "🗿", "ghost": "👻", "giant": "🗻", "aquatic": "🐙", "demon": "😈", "machine": "⚙️", "fairy": "🧚", "dragon": "🐉",
        "aberration": "👁️", "divine_beast": "🦌"}
ELEM_WORD = {"fire": "炎", "ice": "氷", "wind": "風", "earth": "岩", "thunder": "雷", "water": "水", "light": "光", "dark": "闇",
             "none": "", "blunt": "", "slash": "", "pierce": ""}
WEAK_OF = {"fire": "water|ice", "ice": "fire", "wind": "earth", "earth": "wind", "thunder": "earth", "water": "thunder",
           "light": "dark", "dark": "light", "none": "", "blunt": "slash", "slash": "blunt", "pierce": "blunt"}
STAT_BY_STAR = {1: ["poison", "sleep", "blind", "paralysis"], 2: ["poison", "fear", "bleed", "sleep"], 3: ["bleed", "confusion", "silence", "paralysis"],
                4: ["curse", "toxic", "fear", "silence"], 5: ["burn", "freeze", "curse", "bleed"], 6: ["petrify", "stun", "toxic", "statdown"],
                7: ["seal", "paralysis", "charm", "bind"], 8: ["blind", "charm", "confusion", "weaken"], 9: ["curse", "weaken", "statdown", "seal"],
                10: ["doom", "burn", "petrify", "stun"], 11: ["seal", "petrify", "doom", "silence"], 12: ["doom", "weaken", "charm", "freeze"]}
SEASONS = ["spring", "summer", "autumn", "winter"]
SEASON_WORD = {"spring": "春", "summer": "夏", "autumn": "秋", "winter": "冬"}
old_m = R("monsters.csv")
FN = list(old_m[0].keys()) + ["role"]
for m in old_m:
    m["role"] = "boss" if m["is_boss"] == "1" else ("season" if m["season"] not in ("", "all") else "normal")
used_names = {m["name"] for m in old_m}

def mk_name(el, ty, extra=""):
    for _ in range(200):
        w = ELEM_WORD.get(el, "")
        noun = rng.choice(NOUN[ty]); x = rng.random()
        if extra: n = extra + noun
        elif w and x < 0.45: n = w + "の" + noun
        elif x < 0.75: n = rng.choice(["大", "古の", "黒い", "白い", "赤い", "青い", "金色の", "銀の", "荒ぶる", "眠れる", "群れの", "迷いの", "小さな", "まだらの"]) + noun
        else: n = noun
        if n not in used_names:
            used_names.add(n); return n
    n = f"{ty}{len(used_names)}"; used_names.add(n); return n

def stats(ty, k, boss=False):
    base = dict(hp=1.0, atk=1.0, df=1.0, rs=1.0, sp=1.0, mg=0.0)
    if ty in ("golem", "giant", "machine"): base.update(hp=1.2, df=1.3, rs=0.8, sp=0.7)
    if ty in ("beast", "bird", "insect"): base.update(sp=1.3, hp=0.9)
    if ty in ("spirit", "ghost", "fairy"): base.update(mg=0.6, rs=1.3, df=0.8, hp=0.85)
    if ty in ("demon", "aberration", "divine_beast"): base.update(mg=0.4, atk=1.1)
    if ty in ("dragon",): base.update(hp=1.25, atk=1.15, mg=0.3)
    if ty == "humanoid": base.update(mg=0.3)
    j = lambda v, s=0.12: round(v * (1 + rng.uniform(-s, s)), 2)
    return dict(hp_mul=j(base["hp"]), atk_mul=j(base["atk"]), def_mul=j(base["df"]), res_mul=j(base["rs"]), spd_mul=j(base["sp"]),
                magic_rate=round(min(0.9, max(0, base["mg"] + rng.uniform(-0.1, 0.1))), 2))

def new_mon(k, dids, el, ty, role, season="all", replaces="", name=None, boss=False):
    t2 = rng.choice([t for t in TYPES if t != ty]) if rng.random() < 0.3 else ""
    st = rng.choice(STAT_BY_STAR[k]) if rng.random() < (0.9 if boss else 0.6) else ""
    mid = f"m{k:02d}_{len([1 for x in new_m if x['dungeon_rank'] == k]) + 1:03d}" if role != "boss" else dids[0] + "_boss"
    if role == "bounty": mid = f"bounty_{k:02d}_{len([1 for x in new_m if x['role']=='bounty' and x['dungeon_rank']==k])+1}"
    r = dict(id=mid, name=name or mk_name(el, ty), icon=ICON[ty], dungeon_rank=k, dungeons="|".join(dids), types=ty + ("|" + t2 if t2 else ""),
             weak=WEAK_OF.get(el, ""), resist=el if el in ELEM_WORD and el not in ("none",) and rng.random() < 0.6 else "",
             status=st, status_rate=(0.25 if boss else round(rng.uniform(0.12, 0.25), 2)) if st else "", attack_element=el if el not in ("blunt", "slash", "pierce") else "",
             season=season, replaces=replaces, is_boss=1 if boss else 0, material_common=f"{mid}_mat", material_rare=f"{mid}_rare", role=role)
    r.update(stats(ty, k, boss))
    if r["weak"] and r["resist"] and set(r["weak"].split("|")) & {r["resist"]}: r["resist"] = ""
    new_m.append(r); return r

new_m = []
for k in STARS:
    ds = BY_STAR[k]
    old_normals = [m for m in old_m if int(m["dungeon_rank"]) == k and m["role"] == "normal"]
    old_season = [m for m in old_m if int(m["dungeon_rank"]) == k and m["role"] == "season"]
    pools = {d["id"]: [m["id"] for m in old_normals if d["id"] in m["dungeons"].split("|")] for d in ds}
    newd = [d for d in ds if d["id"] not in OLD_KIND]
    n_new = 7 if k <= 5 else 15
    species = []
    for i in range(n_new):
        d = newd[i % len(newd)]; el, tys = DUN_META[d["id"]]
        species.append((new_mon(k, [d["id"]], el, rng.choice(tys.split("|")), "normal"), d["id"]))
    # 新ダンジョンの通常枠を6体にそろえる（新種＋同じ★の既存種で埋める）
    allspec = [s for s, _ in species] + old_normals
    for d in newd:
        p = [s["id"] for s, home in species if home == d["id"]]
        cand = [s for s in allspec if s["id"] not in p]
        rng.shuffle(cand)
        for s in cand:
            if len(p) >= 6: break
            p.append(s["id"])
        pools[d["id"]] = p
    for d in ds:
        if d["id"] in OLD_KIND:   # 既存のダンジョンにも新種を2体足して6体にする
            add = [sp for sp, _ in species if sp["id"] not in pools[d["id"]]]
            rng.shuffle(add); pools[d["id"]] += [x["id"] for x in add[: max(0, 6 - len(pools[d["id"]]))]]
        for mid in pools[d["id"]]:
            m = next(x for x in allspec if x["id"] == mid)
            ds_ = m["dungeons"].split("|")
            if d["id"] not in ds_: m["dungeons"] = "|".join(ds_ + [d["id"]])
    # 季節：★ごとに4体（春夏秋冬）がすべてのダンジョンに出る。★1〜5は既存の4体を使う
    if k <= 5:
        seas = old_season
    else:
        seas = []
        for s in SEASONS:
            d0 = ds[0]; el, tys = DUN_META[d0["id"]]
            seas.append(new_mon(k, [d0["id"]], el, rng.choice(tys.split("|")), "season", season=s))
    for sm in seas:
        dl = []; rl = []
        old_pairs = dict(zip(sm["dungeons"].split("|"), sm["replaces"].split("|"))) if sm["replaces"] else {}
        for d in ds:
            dl.append(d["id"])
            if d["id"] in old_pairs: rl.append(old_pairs[d["id"]]); continue
            taken = {dict(zip(x["dungeons"].split("|"), x["replaces"].split("|"))).get(d["id"]) for x in seas if x is not sm and x["replaces"]}
            opts = [p for p in pools[d["id"]] if p not in taken]
            rl.append(opts[SEASONS.index(sm["season"]) % len(opts)])
        sm["dungeons"] = "|".join(dl); sm["replaces"] = "|".join(rl)
    # 季節の地：さらに季節ごとに1体ずつ（そのダンジョンだけ）
    sd = next(d for d in ds if d["kind"] == "季節の地")
    taken = {dict(zip(x["dungeons"].split("|"), x["replaces"].split("|"))).get(sd["id"]) for x in seas}
    opts = [p for p in pools[sd["id"]] if p not in taken]
    for i, s in enumerate(SEASONS):
        el, tys = DUN_META[sd["id"]]
        new_mon(k, [sd["id"]], el, rng.choice(tys.split("|")), "season", season=s, replaces=opts[i % len(opts)],
                name=mk_name(el, rng.choice(tys.split("|")), extra=SEASON_WORD[s] + "の"))
    # ボス：新しいダンジョンに1体ずつ
    for d in newd:
        el, tys = DUN_META[d["id"]]
        ty = rng.choice(tys.split("|"))
        new_mon(k, [d["id"]], el, ty, "boss", name=mk_name(el, ty, extra=rng.choice(["古き", "王たる", "千年の", "狂える", "大いなる", "眠れる", "嵐の", "深き", "白き", "黒き"])), boss=True)
    # 賞金首：★ごとに4体（どこかのダンジョンにまれに出る）
    for i in range(4):
        d = ds[i % 5]; el, tys = DUN_META[d["id"]]
        ty = rng.choice(tys.split("|"))
        ep = rng.choice(["隻眼の", "血塗れの", "嘆きの", "黄金の", "千の傷の", "笑う", "眠らずの", "影喰いの", "鉄牙の", "月下の", "灰燼の", "百足の"])
        new_mon(k, [d["id"]], el, ty, "bounty", name=mk_name(el, ty, extra=ep), boss=True)

monsters = old_m + new_m
for m in monsters:
    for kf in ("hp_mul", "atk_mul", "def_mul", "res_mul", "spd_mul", "magic_rate"): m[kf] = m.get(kf, 1)
W("monsters.csv", FN, monsters)

# ================================================================ 素材
PART = {"amorphous": ("ゼリー", "核"), "beast": ("毛皮", "牙"), "humanoid": ("布切れ", "紋章"), "bird": ("羽根", "風切り羽"),
        "insect": ("殻", "毒腺"), "spirit": ("光の粒", "精霊石"), "plant": ("葉", "種"), "undead": ("骨", "呪われた骨"),
        "golem": ("石片", "魔力核"), "ghost": ("霊布", "魂の欠片"), "giant": ("大きな爪", "巨人の髪"), "aquatic": ("鱗", "真珠"),
        "demon": ("角", "魔石"), "machine": ("歯車", "動力核"), "fairy": ("鱗粉", "妖精の羽"), "dragon": ("竜鱗", "竜の牙"),
        "aberration": ("粘る肉", "異形の目"), "divine_beast": ("聖毛", "神気の結晶")}
old_mat = R("materials.csv"); mats = list(old_mat); have = {x["id"] for x in mats}
for m in new_m:
    ty = m["types"].split("|")[0]; c, r_ = PART[ty]; nm = m["name"]
    kind = "boss" if m["role"] in ("boss", "bounty") else ("season" if m["role"] == "season" else "common")
    for mid, nmx, kd in ((m["material_common"], f"{nm}の{c}", kind), (m["material_rare"], f"{nm}の{r_}", "rare")):
        if mid not in have:
            mats.append(dict(id=mid, name=nmx, rank=m["dungeon_rank"], kind=kd, source_monster=m["id"],
                             season=m["season"] if m["role"] == "season" else "", element=m["attack_element"])); have.add(mid)
W("materials.csv", list(old_mat[0].keys()), mats)

# ================================================================ 階・ドロップ
fl_rows = []; dr_rows = []
for d in dungeons:
    fl = int(d["floors"]); e1 = int(d["enemy_lv_floor1"]); rp = str(d["return_point_floor"])
    for f in range(1, fl + 1):
        fl_rows.append(dict(dungeon_id=d["id"], floor=f, enemy_level=e1 + f - 1, battles=2, enemies_per_battle=2 if f == 1 else 3,
                            last_battle_is_boss=1 if f == fl else 0, return_point_after=1 if rp == str(f) else 0))
    _, _, _, inc, _, mm, rm = KIND[d["kind"]]
    dr_rows.append(dict(dungeon_id=d["id"], gear_drop_rate_per_battle=0.30, material_rate_per_enemy=round(0.55 * mm, 3),
                        rare_material_rate=round(0.06 * rm, 3), gold_share_of_run_income=round(0.55 * float(d["income_mul"]), 4),
                        boss_gold_mul=4, boss_gear_drop=1.0, bounty_chance_per_run=0.08))
W("dungeons.csv", ["id", "rank", "name", "kind", "days", "floors", "enemy_lv_floor1", "item_lv_min", "item_lv_max", "return_point_floor",
                   "boss_id", "enemy_mul", "income_mul", "character"], dungeons)
W("dungeon_floors.csv", list(fl_rows[0].keys()), fl_rows)
W("drop_tables.csv", list(dr_rows[0].keys()), dr_rows)

# ================================================================ 強い個体の冠
ELITE = [("raging", "猛る", "atk_mul:1.25", "攻撃が強い"), ("hardened", "鋼の", "def_mul:1.5|res_mul:1.3", "とても硬い"),
         ("swift", "疾き", "spd_mul:1.5", "とても素早い"), ("giant", "巨大な", "hp_mul:1.6", "体力が多い"),
         ("frost", "凍てつく", "element:ice|status:freeze:0.2", "氷の攻撃と凍結"), ("blazing", "燃えさかる", "element:fire|status:burn:0.25", "炎の攻撃と火傷"),
         ("venom", "毒々しい", "status:toxic:0.3", "猛毒"), ("shadow", "影まとう", "eva:0.15|element:dark", "攻撃が当たりにくい"),
         ("ancient", "太古の", "hp_mul:1.3|atk_mul:1.15", "全体的に強い"), ("cursed", "呪われた", "status:curse:0.25", "呪い"),
         ("thunder", "雷を帯びた", "element:thunder|status:paralysis:0.2", "雷の攻撃と麻痺"), ("holy", "聖なる", "element:light|res_mul:1.4", "光の攻撃と魔法に強い"),
         ("mad", "狂える", "atk_mul:1.4|def_mul:0.8", "攻撃は強いが守りが弱い"), ("regen", "蘇る", "regen:0.05", "毎ターン体力が回復する"),
         ("stone", "石と化す", "status:petrify:0.12", "石化"), ("silent", "沈黙の", "status:silence:0.3", "沈黙"),
         ("king", "王たる", "hp_mul:1.5|atk_mul:1.2|def_mul:1.2", "群れの王。まれにしか出ない")]
W("elite_prefixes.csv", ["id", "prefix", "mods", "description", "min_star", "appear_rate", "reward_mul"],
  [dict(id=a, prefix=b, mods=c, description=d, min_star=(1 if i < 4 else 3 if i < 10 else 6), appear_rate=(0.02 if a == "king" else 0.06),
        reward_mul=(3.0 if a == "king" else 1.8)) for i, (a, b, c, d) in enumerate(ELITE)])

# ================================================================ 装備（24段階）
MATNAME = ["銅", "鉄", "硬鉄", "鋼", "青鋼", "銀", "白銀", "黒鉄", "魔鋼", "月鋼", "星鉄", "晶鋼", "竜鱗", "竜骨", "霊銀", "天鋼",
           "霊晶", "暁鋼", "黄昏鋼", "冥鉄", "天竜", "神鉄", "創世", "永劫"]
WT = {r["id"]: r["name"] for r in R("weapon_types.csv")}
ARM = {("heavy", "head"): "兜", ("heavy", "body"): "鎧", ("heavy", "arm"): "籠手", ("medium", "head"): "革の帽子", ("medium", "body"): "革鎧",
       ("medium", "arm"): "革の籠手", ("light", "head"): "帽子", ("light", "body"): "ローブ", ("light", "arm"): "手袋"}
ACC = {"ring": "指輪", "necklace": "首飾り", "bracelet": "腕輪", "charm": "お守り"}
eq = []
def ilvl(t): return 3 + 5 * (t - 1)
for t in range(1, 25):
    star = (t + 1) // 2; src = "店・制作" if t % 2 == 1 else "制作・ドロップ"
    for w, nm in WT.items():
        eq.append(dict(id=f"{w}_t{t}", name=f"{MATNAME[t-1]}の{nm}", slot="weapon", weapon_type_or_kind=w, armor_weight="", item_lv=ilvl(t), star=star, source=src))
    for (wt, part), nm in ARM.items():
        eq.append(dict(id=f"{wt}_{part}_t{t}", name=f"{MATNAME[t-1]}の{nm}", slot=part, weapon_type_or_kind="", armor_weight=wt, item_lv=ilvl(t), star=star, source=src))
    eq.append(dict(id=f"cloak_t{t}", name=f"{MATNAME[t-1]}のマント", slot="cloak", weapon_type_or_kind="", armor_weight="", item_lv=ilvl(t), star=star, source="制作・ドロップ"))
    for a, nm in ACC.items():
        eq.append(dict(id=f"{a}_t{t}", name=f"{MATNAME[t-1]}の{nm}", slot="accessory", weapon_type_or_kind=a, armor_weight="", item_lv=ilvl(t), star=star, source="制作・ドロップ（店では買えない）"))
W("equipment.csv", ["id", "name", "slot", "weapon_type_or_kind", "armor_weight", "item_lv", "star", "source"], eq)

# ================================================================ 固有装備（ボスと賞金首が落とす）
SPECIAL = ["特効:{type}:30", "属性付与:{el}", "HP吸収:5", "先制:20", "状態異常付与:{st}:15", "会心ダメージ:20", "MP節約:15", "反撃:10",
           "全体化:通常攻撃の20%", "瀕死で耐える:1", "毎ターンHP回復:3", "経験値:8"]
STATS_SLOT = {"weapon": ["STR", "MAG", "CRT", "SPD", "LUK"], "head": ["HP", "DEF", "RES", "STATUS_RES"], "body": ["HP", "DEF", "RES"],
              "arm": ["DEF", "CRT", "STR"], "cloak": ["RES", "EVA", "FIRST_SPD", "MAGIC_CUT"], "accessory": ["HP", "STR", "MAG", "SPD", "LUK", "ELEM_RES"]}
uniq = []
bosses = [m for m in monsters if m["role"] in ("boss", "bounty")]
for i, b in enumerate(bosses):
    k = int(b["dungeon_rank"]); ty = b["types"].split("|")[0]; el = b["attack_element"] or "none"
    slot = rng.choice(["weapon", "weapon", "weapon", "head", "body", "arm", "cloak", "accessory"])
    kind = rng.choice(list(WT)) if slot == "weapon" else (rng.choice(list(ACC)) if slot == "accessory" else "")
    wt = rng.choice(["heavy", "medium", "light"]) if slot in ("head", "body", "arm") else ""
    base = WT.get(kind) or ACC.get(kind) or ARM.get((wt, slot)) or "マント"
    nm = b["name"]
    lv = ilvl(min(24, 2 * k)) + 3
    fx = [f"{s}:{round((3 + lv * 0.12) * (6 if s == 'HP' else 1))}" for s in rng.sample(STATS_SLOT[slot], min(3, len(STATS_SLOT[slot])))]
    sp = rng.choice(SPECIAL).format(type=ty, el=el, st=(b["status"] or "poison"))
    uniq.append(dict(id=f"u_{b['id']}", name=f"{nm}の{base}", slot=slot, kind=kind, armor_weight=wt, item_lv=lv, star=k,
                     source=b["id"], drop_rate=(0.15 if b["role"] == "boss" else 0.5), fixed_effects="|".join(fx + [sp])))
W("uniques.csv", ["id", "name", "slot", "kind", "armor_weight", "item_lv", "star", "source", "drop_rate", "fixed_effects"], uniq)


# ================================================================ 経済・施設・宿
econ = R("economy_by_rank.csv"); keys = [k for k in econ[0] if k != "dungeon_rank"]
last = econ[-1]
for k in range(6, 13):
    row = {"dungeon_rank": k}
    for c in keys:
        v = float(last[c]); row[c] = v if c == "inn_cheap" else int(round(v * 1.55 ** (k - 5), -1))
    econ.append(row)
W("economy_by_rank.csv", ["dungeon_rank"] + keys, econ)
fac = R("facility_ranks.csv"); lf = fac[-1]
for k in range(6, 13):
    fac.append(dict(rank=k, invest_cost=int(round(float(lf["invest_cost"]) * 1.7 ** (k - 5), -1)), enhance_cap=10, craft_item_lv=12 + 10 * (k - 1)))
W("facility_ranks.csv", list(fac[0].keys()), fac)
inn = R("inn_rooms.csv")
for k in range(6, 13):
    hp = min(30, 15 + (k - 5) * 2); mp = hp; sr = min(50, 30 + (k - 5) * 3)
    inn.append(dict(inn_rank=k, max_hp_pct=hp, max_mp_pct=mp, first_battle_spd_pct=20, status_resist_pct=sr,
                    description=f"次の遠征のあいだ最大HP+{hp}%・最大MP+{mp}%、最初の戦闘だけSPD+20%、状態異常にかかる確率-{sr}%"))
W("inn_rooms.csv", list(inn[0].keys()), inn)

# ================================================================ 冒険者ランク（★ごとに本ランクと＋、最後にS）
TITLES = [("見習い", "Apprentice", "駆け出し", "Novice"), ("一人前", "Journeyman", "熟練", "Adept"), ("歴戦", "Veteran", "精鋭", "Elite"),
          ("達人", "Expert", "名手", "Virtuoso"), ("英傑", "Champion", "勇士", "Valiant"), ("英雄", "Hero", "名将", "Paragon"),
          ("守護者", "Guardian", "開拓者", "Pathfinder"), ("豪傑", "Titan", "不屈", "Unyielding"), ("天翔", "Skyfarer", "星読み", "Starseer"),
          ("竜殺し", "Dragonslayer", "王の盾", "Kingsguard"), ("救世", "Savior", "不滅", "Immortal"), ("神話", "Mythic", "至高", "Paramount")]
PERK = {1: (0, 0, "クエスト掲示板 2件", "クエスト掲示板 3件"), 2: (0, 0.05, "★2へ入れる", "ギルド商店 5%引き"), 3: (0.10, 0.05, "★3へ入れる", "クエスト報酬 +10%")}
ranks = []; pts = 0
for k in STARS:
    jm, em, jp, ep = TITLES[k - 1]
    qb = min(0.30, 0.05 * (k // 2)); disc = min(0.20, 0.02 * k)
    ranks.append(dict(id=f"R{k:02d}", title=jm, title_en=em, points_required=pts, max_dungeon_rank=k, needs_boss_clear=0 if k == 1 else 1,
                      needs_exam=0 if k == 1 else 1, quest_bonus=round(qb, 2), shop_discount=round(disc, 2),
                      perk=("クエスト掲示板 2件" if k == 1 else f"★{k}へ入れる（昇格試験）")))
    pts += 4 + 2 * k
    perks_plus = ["クエスト掲示板 3件", "ギルド商店 5%引き", "クエスト報酬 +10%", "クエスト報酬 +15%・商店 10%引き", "宿の良い部屋が安くなる", "クエスト報酬 +15%",
                  "工房の費用 5%引き", "賞金首の情報が早く届く", "クエスト報酬 +20%", "ギルド商店 15%引き", "神殿の費用 10%引き", "クエスト報酬 +25%"]
    ranks.append(dict(id=f"R{k:02d}+", title=jp, title_en=ep, points_required=pts, max_dungeon_rank=k, needs_boss_clear=0, needs_exam=0,
                      quest_bonus=round(qb + 0.05, 2), shop_discount=round(disc + 0.02, 2), perk=perks_plus[k - 1]))
    pts += 4 + 2 * k
ranks.append(dict(id="S", title="伝説", title_en="Legend", points_required=pts, max_dungeon_rank=12, needs_boss_clear=1, needs_exam=1,
                  quest_bonus=0.35, shop_discount=0.25, perk="称号「伝説」・最終試験に合格した証"))
W("adventurer_ranks.csv", ["id", "title", "title_en", "points_required", "max_dungeon_rank", "needs_boss_clear", "needs_exam", "quest_bonus", "shop_discount", "perk"], ranks)

# ================================================================ クエスト（★ごと）・賞金首・連続クエスト
qs = []
for k in STARS:
    qs += [dict(id=f"q{k}_hunt", type="hunt", rank=k, target="その★の通常モンスター", count_min=3, count_max=6, reward_gold_pct_of_run_income=15, reward_item="", rank_points=1),
           dict(id=f"q{k}_gather", type="gather", rank=k, target="その★の通常素材", count_min=3, count_max=5, reward_gold_pct_of_run_income=0, reward_item="まれな素材1", rank_points=1),
           dict(id=f"q{k}_boss", type="boss", rank=k, target="その★のボス", count_min=1, count_max=1, reward_gold_pct_of_run_income=35, reward_item="", rank_points=3)]
    for b in [m for m in new_m if m["role"] == "bounty" and m["dungeon_rank"] == k]:
        qs.append(dict(id=f"q_{b['id']}", type="bounty", rank=k, target=b["id"], count_min=1, count_max=1, reward_gold_pct_of_run_income=120,
                       reward_item=f"u_{b['id']}（確定ではない）", rank_points=5))
W("quests.csv", ["id", "type", "rank", "target", "count_min", "count_max", "reward_gold_pct_of_run_income", "reward_item", "rank_points"], qs)
CH = ["消えた行商人", "古い地図の謎", "村を襲う影", "竜の卵", "失われた歌", "壊れた灯台", "呪われた指輪", "星の欠片", "迷子の妖精", "鍛冶師の頼み",
      "王家の使い", "忘れられた神殿"]
chains = []
for k in STARS:
    for j in range(2):
        t = CH[(k * 2 + j) % len(CH)]; ds = BY_STAR[k]
        steps = [f"talk:町の依頼人", f"explore:{ds[j]['id']}:{ds[j]['floors']}階まで", f"hunt:{ds[(j+2)%5]['id']}:3体",
                 f"gather:★{k}の素材:3", f"boss:{ds[(j+4)%5]['boss_id']}"]
        chains.append(dict(id=f"chain_{k:02d}_{j+1}", star=k, title=f"{t}（★{k}）", steps="|".join(steps[: 3 + (k > 4) + (k > 8)]),
                           reward=f"お金（遠征{2 + k // 3}回分）|★{k}のまれな素材3|ギルドポイント{4 + k}"))
W("quest_chains.csv", ["id", "star", "title", "steps", "reward"], chains)

# ================================================================ スキルツリー5段目・ジョブを極める
sk = R("skills.csv"); SF = list(sk[0].keys())
S5 = {  # (job, path): (name, kind, mp, effect)
 ("warrior", "剣技"): ("刃の極意", "passive", 0, {"mod": {"wdmg": [["剣", "大剣", "斧"], 0.15]}}),
 ("warrior", "守り"): ("不動の構え", "passive", 0, {"mod": {"def": 0.15, "hp": 0.05}}),
 ("warrior", "狂戦士"): ("修羅の血", "passive", 0, {"mod": {"lowhp_dmg": 0.25}}),
 ("knight", "守護"): ("守護者の誓い", "passive", 0, {"mod": {"cover": 0.15}}),
 ("knight", "聖騎"): ("裁きの剣", "attack", 14, {"base": "weapon", "m": 2.4, "element": "light"}),
 ("knight", "盾術"): ("鉄の城壁", "passive", 0, {"mod": {"def": 0.12, "res": 0.12}}),
 ("black_mage", "炎"): ("灼熱の心得", "passive", 0, {"mod": {"edmg": ["炎", 0.15]}}),
 ("black_mage", "氷"): ("絶対零度", "attack", 22, {"base": "mag", "m": 1.3, "tgt": "all", "st": ["凍結", 0.25]}),
 ("black_mage", "雷"): ("雷神の心得", "passive", 0, {"mod": {"edmg": ["雷", 0.15]}}),
 ("white_mage", "回復"): ("癒しの極意", "passive", 0, {"mod": {"healp": 0.2}}),
 ("white_mage", "浄化"): ("聖なる守り", "passive", 0, {"mod": {"party_sres": 0.15}}),
 ("white_mage", "光"): ("光の審判", "attack", 18, {"base": "mag", "m": 1.2, "tgt": "all", "element": "light"}),
 ("thief", "短刀術"): ("影の刃", "passive", 0, {"mod": {"crt": 0.08}}),
 ("thief", "盗み"): ("宝探しの極意", "passive", 0, {"mod": {"drop": 0.2}}),
 ("thief", "身のこなし"): ("残像", "passive", 0, {"mod": {"eva": 0.06}}),
 ("monk", "拳法"): ("百裂の型", "attack", 16, {"base": "phys", "m": 0.5, "hits": [1, 1, 1, 1, 1, 1]}),
 ("monk", "気功"): ("封じ手", "status", 8, {"st": ["封印", 0.5]}),
 ("monk", "鉄身"): ("金剛の体", "passive", 0, {"mod": {"hp": 0.12, "def": 0.08}}),
 ("hunter", "弓術"): ("鷹の目", "passive", 0, {"mod": {"weak_all": 0.15}}),
 ("hunter", "狩猟"): ("狩人の勘", "passive", 0, {"mod": {"drop": 0.1, "crt": 0.05}}),
 ("hunter", "罠"): ("石化の罠", "status", 10, {"st": ["石化", 0.3]}),
 ("bard", "歌"): ("大合唱", "passive", 0, {"mod": {"song": 0.1}}),
 ("bard", "旋律"): ("癒しの旋律", "heal_all", 14, {"m": 0.9}),
 ("bard", "語り"): ("衰えの詩", "status", 10, {"st": ["衰弱", 0.45], "tgt": "all"}),
 ("elementalist", "精霊魔法"): ("精霊王の呼び声", "attack", 24, {"base": "mag", "m": 1.4, "tgt": "all", "element": "best"}),
 ("elementalist", "精霊の加護"): ("精霊の衣", "passive", 0, {"mod": {"party_eres": 0.15}}),
 ("gunner", "射撃"): ("一撃必中", "passive", 0, {"mod": {"crt": 0.1}}),
 ("gunner", "特殊弾"): ("石化弾", "status", 10, {"st": ["石化", 0.35]}),
 ("dancer", "舞"): ("千変の舞", "party_buff", 16, {"buff": {"spd": 0.2, "eva": 0.1}, "turns": 3}),
 ("dancer", "鞭術"): ("縛めの鞭", "attack", 8, {"base": "weapon", "m": 1.2, "st": ["束縛", 0.5]}),
 ("spellblade", "魔法剣"): ("魔剣の極意", "passive", 0, {"mod": {"imbue": 0.1}}),
 ("spellblade", "剣技"): ("魔力の刃", "passive", 0, {"mod": {"mag_to_atk": 0.2}}),
 ("hexer", "呪い"): ("死の宣告", "status", 20, {"st": ["死の宣告", 0.25]}),
 ("hexer", "闇魔法"): ("闇の極意", "passive", 0, {"mod": {"edmg": ["闇", 0.15]}}),
 ("apothecary", "調合"): ("秘薬の知識", "passive", 0, {"mod": {"itemp": 0.2}}),
 ("apothecary", "採取"): ("採取の極意", "passive", 0, {"mod": {"drop": 0.15}}),
}
for (job, path), (nm, kd, mp, ef) in S5.items():
    pi = next(r["id"] for r in sk if r["job"] == job and r["path"] == path and r["stage"] == "4").split("_p")[1].split("_")[0]
    sk.append(dict(id=f"{job}_p{pi}_s5", job=job, path=path, stage=5, name=nm, kind=kd, cost=3 if kd == "passive" else 4, mp=mp,
                   ap_to_learn=45, is_final=0, element="", effect_json=json.dumps(ef, ensure_ascii=False)))
W("skills.csv", SF, sk)
JM = {"warrior": "STR+3%", "knight": "DEF+3%", "black_mage": "MAG+3%", "white_mage": "回復量+5%", "thief": "会心率+2%", "monk": "HP+4%",
      "hunter": "弱点へのダメージ+5%", "bard": "MP+5%", "elementalist": "RES+3%", "gunner": "会心ダメージ+8%", "dancer": "SPD+3%",
      "spellblade": "STRとMAG+2%", "hexer": "状態異常にかける確率+5%", "apothecary": "道具の効果+8%"}
W("job_mastery.csv", ["job", "condition", "bonus_all_jobs"],
  [dict(job=j, condition="そのジョブのスキルをすべて覚える（5段目まで）", bonus_all_jobs=b) for j, b in JM.items()])

# ================================================================ エンチャントの素材と効果の系統
ench = []
EL_JA = {r["id"]: r["name"] for r in R("elements.csv")}
for e, nm in EL_JA.items():
    if e in ("slash", "pierce", "blunt", "none"): continue
    ench.append(dict(source_kind="element", source_value=e, families=f"ELEMENT:{e}|ELEM_RES:{e}", note=f"{nm}属性の素材 → {nm}属性の付与か{nm}耐性"))
for t, nm in [(r["id"], r["name"]) for r in R("monster_types.csv")]:
    ench.append(dict(source_kind="monster_type", source_value=t, families=f"TYPE_BONUS:{t}", note=f"{nm}の素材 → {nm}特効"))
for kd, fam, note in [("common", "STR|MAG|DEF|RES|HP", "通常の素材 → 基本の能力値"), ("rare", "CRT|SPD|LUK|EVA|STATUS_RES", "まれな素材 → 会心・素早さ・運など"),
                      ("season", "EXP|DROP|FIRST_SPD", "季節の素材 → 経験値・素材の出やすさ・先手"), ("boss", "ANY", "ボスの素材 → どの系統でも選べる")]:
    ench.append(dict(source_kind="material_kind", source_value=kd, families=fam, note=note))
W("enchant_sources.csv", ["source_kind", "source_value", "families", "note"], ench)

# ================================================================ バランス設定
b = json.load(open(f"{D}/balance.json", encoding="utf-8"))
b["player"]["level_cap"] = 99
b["stars"] = 12
b["elite"] = "elite_prefixes.csv。冠は1戦の敵のうち appear_rate で1体につく"
b["bounty"] = "賞金首は drop_tables.bounty_chance_per_run の確率でダンジョンのどこかに出る。依頼を受けていると確率が上がる（仮）"
json.dump(b, open(f"{D}/balance.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

import collections
print("dungeons", len(dungeons), "monsters", len(monsters), collections.Counter(m["role"] for m in monsters), "mats", len(mats),
      "equip", len(eq), "uniques", len(uniq), "sets", len(sets), "ranks", len(ranks), "skills", len(sk))

