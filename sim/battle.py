"""戦闘：スキル・状態異常21種・戦闘中のアイテム・逃げる・特効"""
import db
from core import T, rnd, Char, Enemy
from db import WEAPONS, STATUS_BY_NAME as SB

BUFF_CAP = 0.6
SKIP_UNTIL_HIT = ("睡眠", "凍結")
ACT_BLOCK = ("睡眠", "凍結", "スタン", "石化")
DISABLE = ("麻痺", "睡眠", "混乱", "魅了", "凍結", "石化", "恐怖", "沈黙", "封印", "死の宣告", "猛毒")
MAGIC_KINDS = ("heal", "healall", "revive", "cure", "cureall")

def tick(d):
    for k in list(d):
        d[k][1] -= 1
        if d[k][1] <= 0: del d[k]
def bval(d, k): return d[k][0] if k in d else 0.0
def party_has(party, key): return max([c.mods.get(key, 0) for c in party if c.hp > 0] or [0])

class Ctx:
    def __init__(s, party, enemies):
        s.pb = {}; s.sb = {id(c): {} for c in party}
        s.pst = {id(c): {} for c in party}          # 味方の状態異常: name -> dict(t=残り, n=重ね/段階)
        s.est = {id(e): {} for e in enemies}        # 敵の状態異常・弱体: name -> [値, 残り]
        s.delayed = []; s.imbue = {}; s.endured = set(); s.once = set()
        for c in party:
            for p in c.persist: s.pst[id(c)][p] = dict(t=99, n=1)

def can_act(c, ctx): return c.hp > 0 and "石化" not in ctx.pst[id(c)]

# ---------------------------------------------------------------- ダメージ
def attack_value(u, ctx, t, sk, party, cm=1.0, expected=False, rng=None, S=None, neutral=False):
    wd = WEAPONS[u.weapon["t"]]
    base = sk.get("base", "weapon") if sk else "weapon"; imb = 1.0
    if base == "weapon":
        kind = wd["kind"]; els = list(wd["el"])
        if u.weapon.get("el"): els = [els[0], u.weapon["el"]]
        im = ctx.imbue.get(id(u))
        if im and kind == "phys":
            els = [im[0]] if (sk and sk.get("imbue_only")) else [els[0], im[0]]; imb = 1.10
        hits = list(wd.get("hits") or [1.0])
        if u.weapon["t"] == "拳" and "fist" in u.mods: hits = [u.mods["fist"]] * 2
        if u.job == "盗賊" and u.weapon["t"] in ("短剣", "剣", "刀"): hits = [1.0, 0.65]
    else:
        kind = "phys" if base == "phys" else "mag"; els = sk["el"]; hits = [1.0]
    if sk and sk.get("hits"): hits = list(sk["hits"])
    mult = sk["m"] if sk else (0.8 if (u.job == "黒魔道士" and kind == "mag") else 1.0)
    sb = ctx.sb[id(u)]; pst = ctx.pst[id(u)]
    if kind == "phys":
        stv = u.stat("STR") * (0.5 if wd.get("gun") and base == "weapon" else 1.0) * (1 + bval(sb, "str"))
        if "火傷" in pst or "能力ダウン" in pst: stv *= 0.8
        stv += u.stat("MAG") * u.mods.get("mag2phys", 0)
        if sk and sk.get("beststat"): stv = max(stv, u.stat("MAG"))
    else:
        stv = u.stat("MAG") * wd.get("mm", 1) * (1 + bval(sb, "magb"))
    w = u.wpow() if (base == "weapon" or kind == "mag") else u.wpow() * 0.8
    dm = 1 + min(BUFF_CAP, (T["song"] if any(c.job == "吟遊詩人" and c.hp > 0 for c in party) else 0) + bval(ctx.pb, "dmg"))
    pm = 1.0
    for ws, v in u.mods.get("wdmg", []):
        if u.weapon["t"] in ws and base == "weapon": pm += v
    for e_, v in u.mods.get("edmg", {}).items():
        if e_ in els: pm += v
    for ts, v in u.mods.get("tdmg", []):
        if any(x in t.types for x in ts): pm += v
    tb = max([v for k, v in u.weapon["aff"].items() if k.startswith("特効:") and k[3:] in t.types] or [0])
    pm += tb / 100
    if u.mods.get("lowhp_dmg") and u.hp < 0.5 * u.maxhp(): pm += u.mods["lowhp_dmg"]
    if u.mods.get("bullet") and sk and base == "phys" and u.weapon["t"] == "銃": pm += u.mods["bullet"]
    if u.mods.get("weak_wew") and any(x in t.weak for x in ("風", "土", "水")) and any(x in els for x in ("風", "土", "水")): pm += u.mods["weak_wew"]
    es = ctx.est[id(t)]
    if u.mods.get("vs_debuffed") and any(k in es for k in ("str", "def", "res", "毒")): pm += u.mods["vs_debuffed"]
    atk = (stv + w) * mult * cm * dm * pm * imb
    if kind == "phys":
        df = t.DEF * (1 - wd.get("pierce", 0) - (sk.get("defign", 0) if sk else 0)) * (1 - bval(es, "def"))
    else:
        df = t.RES * (1 - bval(es, "res"))
    em = 1.0 if neutral else sum(t.em(x) for x in els) / len(els)
    if sk and sk.get("noresist"): em = max(1.0, em)
    if sk and sk.get("wb") and em > 1: atk *= sk["wb"]
    if u.mods.get("weak_all"):
        if em > 1: atk *= 1 + u.mods["weak_all"]
        elif em < 1: em = max(em, 0.85)
    pc = u.crt() + (sk.get("crt", 0) if sk else 0)
    hitp = 0.5 if (kind == "phys" and "暗闇" in pst) else 1.0
    tot = 0.0
    for h in hits:
        if expected: cr = 1 + 0.5 * min(1, pc); hm = hitp
        else:
            cr = 1.5 if rng.random() < pc else 1.0; hm = 1.0 if rng.random() < hitp else 0.0
        r = 1.0 if expected else rnd(rng, 0.95, 1.05)
        tot += atk * h * em * 100 / (100 + max(0, df)) * cr * r * hm
    if S is not None and not expected:
        if em > 1: S["weak_hits"] += 1
        elif em < 1: S["resist_hits"] += 1
        else: S["neutral_hits"] += 1
    return tot

def deal(u, t, dmg, ctx, S):
    if dmg <= 0: return
    t.hp -= dmg
    es = ctx.est[id(t)]
    for k in SKIP_UNTIL_HIT: es.pop(k, None)
    S["dmg_by_job"][u.job] = S["dmg_by_job"].get(u.job, 0) + dmg
    if t.hp <= 0:
        t.hp = 0
        u.mastery[u.weapon["t"]] = u.mastery.get(u.weapon["t"], 0) + 1
        if u.mods.get("kill_mp"): u.mp = min(u.maxmp(), u.mp + u.mods["kill_mp"])

def inflict(u, t, st, ctx, rng, S):
    name, p = st
    p *= 1 + u.mods.get("stat_rate", 0)
    if t.boss:
        n = t.st_hits.get(name, 0); p *= 0.3 * (0.5 ** n)
        if name in ("石化", "死の宣告"): p = 0
    if "アンデッド" in t.types or "機械" in t.types: p *= 0.6
    if rng.random() < p:
        es = ctx.est[id(t)]; t.st_hits[name] = t.st_hits.get(name, 0) + 1
        if name == "DEFダウン": es["def"] = [0.25, 3]
        elif name == "スタン": es["スタン"] = [1, 1]
        else: es[name] = [1, SB[name]["turns"] + 1 if name in SB else 3]
        S["e_status"][name] = S["e_status"].get(name, 0) + 1

def player_status_hit(t, name, ctx, S):
    sd = ctx.pst[id(t)]
    if name in ("呪い", "石化", "衰弱"):
        t.persist.add(name); sd[name] = dict(t=99, n=1)
        if name == "衰弱": t.hp = min(t.hp, t.maxhp())
    elif name == "毒" and "毒" in sd: sd["毒"]["n"] = min(3, sd["毒"]["n"] + 1); sd["毒"]["t"] = 3
    else: sd[name] = dict(t=(SB[name]["turns"] if name in SB else 2), n=1)
    S["status"][name] = S["status"].get(name, 0) + 1

# ---------------------------------------------------------------- 味方の行動
def heal_amount(u, m):
    wd = WEAPONS[u.weapon["t"]]
    return (u.stat("MAG") + u.wpow()) * m * wd.get("heal", 1) * (1 + u.mods.get("healp", 0))
def heal_to(c, amt, ctx):
    if "呪い" in ctx.pst[id(c)]: return
    c.hp = min(c.maxhp(), c.hp + amt)

def allowed(u, s, ctx):
    sd = ctx.pst[id(u)]
    if s["k"] == "atk" or s["k"] in ("fixed", "status", "delayed", "debuff"):
        if "恐怖" in sd: return False
    magicish = s.get("base") == "mag" or s["k"] in MAGIC_KINDS or s["k"] in ("debuff", "delayed")
    if magicish and "沈黙" in sd: return False
    if not magicish and s["k"] in ("atk", "fixed", "sbuff", "imbue") and "封印" in sd: return False
    return True

def use_item(u, party, ctx, cm, S, items):
    """戦闘中のアイテム。使ったらTrue"""
    if not T["items_in_battle"] or items is None: return False
    alive = [c for c in party if can_act(c, ctx)]; ko = [c for c in party if c.hp <= 0]
    healers = [c for c in alive if c is not u and any(s["k"] in ("heal", "healall") and c.mp >= s["mp"] and allowed(c, s, ctx) for s in c.A)]
    reviver = [c for c in alive if any(s["k"] == "revive" and c.mp >= s["mp"] for s in c.A)]
    factor = 1.0 if cm == 1 else cm
    know = 1 + party_has(party, "itemp")
    def take(k):
        items[k] -= 1; S["item_battle"][k] = S["item_battle"].get(k, 0) + 1
        if party_has(party, "save") and __import__("random").random() < party_has(party, "save"): items[k] += 1
    if ko and not reviver:
        for k, fr in (("気付け薬", 0.3), ("命の雫", 1.0)):
            if items.get(k, 0) > 0:
                take(k); c = ko[0]; c.hp = max(1, c.maxhp() * fr * factor); ctx.pst[id(c)] = {p: dict(t=99, n=1) for p in c.persist}; return True
    low = [c for c in alive if c.hp < 0.35 * c.maxhp() and "呪い" not in ctx.pst[id(c)]]
    if low and not healers:
        c = min(low, key=lambda c: c.hp / c.maxhp())
        for k, fr in (("上回復薬", 0.7), ("回復薬", 0.4)):
            if items.get(k, 0) > 0:
                take(k); heal_to(c, c.maxhp() * fr * factor * know, ctx); return True
    bad = [c for c in alive if any(k in ("石化", "呪い", "猛毒", "死の宣告") for k in ctx.pst[id(c)])]
    if bad and items.get("万能薬", 0) > 0 and cm == 1:
        take("万能薬"); c = bad[0]
        for k in list(ctx.pst[id(c)]): ctx.pst[id(c)].pop(k)
        c.persist.clear(); return True
    return False

def choose_and_act(u, party, enemies, ctx, cm, rng, S, items):
    alive_p = [c for c in party if can_act(c, ctx)]; alive_e = [e for e in enemies if e.hp > 0]
    ko = [c for c in party if c.hp <= 0]
    boss = any(e.boss for e in alive_e)
    generous = boss or u.mp > u.maxmp() * 0.35
    acts = [s for s in u.A if u.mp >= s["mp"] and allowed(u, s, ctx) and not (s.get("once") and (id(u), s["name"]) in ctx.once)]
    def spend(s):
        u.mp -= s["mp"]
        if s.get("once"): ctx.once.add((id(u), s["name"]))
        S["skill_use"][s["name"]] = S["skill_use"].get(s["name"], 0) + 1
    hurt = [c for c in alive_p if c.hp / c.maxhp() < 0.6 and "呪い" not in ctx.pst[id(c)]]
    low = sorted([c for c in alive_p if "呪い" not in ctx.pst[id(c)]], key=lambda c: c.hp / c.maxhp())
    for s in acts:
        if ko and (s["k"] == "revive" or (s["k"] == "healall" and s.get("revive_all"))):
            spend(s)
            if s["k"] == "revive":
                c = ko[0]; c.hp = c.maxhp() * s["frac"] * (1 if cm == 1 else 0.5); ctx.pst[id(c)] = {p: dict(t=99, n=1) for p in c.persist}
            else:
                for c in party:
                    if c.hp <= 0: c.hp = c.maxhp() * 0.3 * (1 if cm == 1 else 0.5)
                    else: heal_to(c, heal_amount(u, s["m"]) * cm, ctx)
            S["revive_skill"] += 1; return
    ha = [s for s in acts if s["k"] == "healall"]
    if len(hurt) >= 2 and ha:
        s = max(ha, key=lambda s: s["m"]) if boss or len(hurt) >= 3 else min(ha, key=lambda s: s["mp"])
        spend(s)
        for c in alive_p:
            heal_to(c, c.maxhp() if s["m"] >= 99 else heal_amount(u, s["m"]) * cm, ctx)
            if s.get("cure") and cm == 1: ctx.pst[id(c)] = {p: dict(t=99, n=1) for p in c.persist if p != "呪い" and p != "石化"}
        S["heal"] += 1; return
    hs = [s for s in acts if s["k"] == "heal"]
    if low and low[0].hp / low[0].maxhp() < 0.5 and hs:
        s = hs[0]; spend(s); heal_to(low[0], heal_amount(u, s["m"]) * cm * rnd(rng, 0.95, 1.05), ctx); S["heal"] += 1; return
    bad = [c for c in alive_p if any(k in DISABLE for k in ctx.pst[id(c)] if k not in ("石化",))]
    if bad:
        for s in acts:
            if s["k"] in ("cure", "cureall"):
                spend(s)
                if cm == 1:
                    for c in (bad if s["k"] == "cureall" else bad[:1]):
                        for k in list(ctx.pst[id(c)]):
                            if k not in ("石化", "呪い", "衰弱"): ctx.pst[id(c)].pop(k)
                S["cure"] += 1; return
    if use_item(u, party, ctx, cm, S, items): return
    for s in acts:
        if s["k"] == "mpgive":
            tgt = [c for c in alive_p if c is not u and c.mp < c.maxmp() * 0.3 and c.maxmp() > 30]
            if tgt and u.mp > u.maxmp() * 0.5:
                spend(s); tgt[0].mp = min(tgt[0].maxmp(), tgt[0].mp + tgt[0].maxmp() * s["frac"] * cm); return
    danger = sum(c.hp / c.maxhp() for c in alive_p) / len(party) < 0.5
    for s in acts:
        w = s.get("when", "fight")
        ok = (w == "boss" and boss) or (w == "danger" and danger) or (w == "fight" and (boss or len(alive_e) >= 3) and generous) \
             or (w == "lowhp" and u.hp < 0.4 * u.maxhp())
        if not ok: continue
        if s["k"] == "pbuff" and not any(k in ctx.pb for k in s["buff"]):
            spend(s); turns = s["turns"] + (u.mods.get("song_turns", 0) if u.job == "吟遊詩人" else 0)
            for k, v in s["buff"].items(): ctx.pb[k] = [v * cm if cm < 1 else v, turns + 1]
            return
        if s["k"] == "sbuff" and not any(k in ctx.sb[id(u)] for k in s["buff"]):
            spend(s)
            for k, v in s["buff"].items(): ctx.sb[id(u)][k] = [v * cm if cm < 1 else v, s["turns"] + 1]
            return
    for s in acts:
        if s["k"] == "abuff" and (boss or len(alive_e) >= 3) and generous:
            tg = [c for c in alive_p if c is not u and "str" not in ctx.sb[id(c)] and c.job not in ("白魔道士",)]
            if tg:
                spend(s); c = max(tg, key=lambda c: max(c.stat("STR"), c.stat("MAG")))
                for k, v in s["buff"].items(): ctx.sb[id(c)][k] = [v * cm, s["turns"] + 1]
                return
    for s in acts:
        if s["k"] == "debuff" and (boss or (len(alive_e) >= 3 and generous)):
            tg = [e for e in alive_e if not any(k in ctx.est[id(e)] for k in s["deb"])]
            if len(tg) >= (1 if boss else 2):
                spend(s)
                for t in (tg if s.get("tgt") == "all" else [max(tg, key=lambda e: (e.boss, e.hp))]):
                    if cm == 1 or rng.random() < 0.5:
                        for k, v in s["deb"].items(): ctx.est[id(t)][k] = [v, s["turns"] + 1]
                return
        if s["k"] == "delayed" and (boss or len(alive_e) >= 3) and not ctx.delayed:
            spend(s)
            for t in alive_e:
                ctx.delayed.append([s["delay"], t, attack_value(u, ctx, t, dict(base="mag", el=s["el"], m=s["m"]), party, cm, rng=rng), u])
            return
        if s["k"] == "status" and generous:
            if s.get("tgt") == "all" and len(alive_e) >= 3 and not any(s["st"][0] in ctx.est[id(e)] for e in alive_e) and (id(u), s["name"], "used") not in ctx.once:
                ctx.once.add((id(u), s["name"], "used"))
                spend(s)
                for e in alive_e: inflict(u, e, s["st"], ctx, rng, S)
                return
            if s.get("tgt") != "all":
                if s["st"][0] == "毒" and not boss: continue
                tg = [e for e in alive_e if s["st"][0] not in ctx.est[id(e)] and (e.boss or e.hp > 0.6 * e.maxhp)]
                if tg: spend(s); inflict(u, max(tg, key=lambda e: e.hp), s["st"], ctx, rng, S); return
    known = S["bestiary"]
    def est_one(sk, t): return min(attack_value(u, ctx, t, sk, party, expected=True, neutral=(t.name not in known)), t.hp)
    best = (None, None, 0.0)
    cands = [None] + ([s for s in acts if s["k"] in ("atk", "fixed")] if generous else [])
    for sk in cands:
        if sk and sk.get("imbue_only") and id(u) not in ctx.imbue: continue
        if sk and sk.get("selfcost") and u.hp < 0.6 * u.maxhp(): continue
        if sk and sk["k"] == "fixed":
            v = sum(min(e.hp, fixed_dmg(u, e)) for e in alive_e); tgt = None
        elif (sk is None and WEAPONS[u.weapon["t"]].get("whip")) or (sk and sk.get("tgt") == "all"):
            ma = u.mods.get("whip", T["whip"]) if sk is None else 1.0
            v = sum(est_one(sk, e) * ma for e in alive_e); tgt = None
        elif sk and sk.get("tgt") == "random":
            v = sum(min(e.hp, est_one(sk, e) * sk["n"] / len(alive_e)) for e in alive_e); tgt = None
        else:
            tgt = max(alive_e, key=lambda e: (est_one(sk, e), -e.hp)); v = est_one(sk, tgt)
        if sk and sk["mp"] > 0 and not boss: v *= 1 - min(0.5, sk["mp"] / max(1, u.mp) * 0.5)
        if v > best[2]: best = (sk, tgt, v)
    sk, tgt, _ = best
    if sk: spend(sk)
    conf = "混乱" in ctx.pst[id(u)]
    if sk and sk["k"] == "fixed":
        for e in alive_e: deal(u, e, fixed_dmg(u, e) * cm * rnd(rng, 0.9, 1.1), ctx, S)
        return
    if (sk is None and WEAPONS[u.weapon["t"]].get("whip")) or (sk and sk.get("tgt") == "all"):
        ma = u.mods.get("whip", T["whip"]) if sk is None else 1.0
        for e in alive_e:
            deal(u, e, attack_value(u, ctx, e, sk, party, cm, rng=rng, S=S) * ma, ctx, S)
            if sk and sk.get("st") and e.hp > 0: inflict(u, e, sk["st"], ctx, rng, S)
        return
    if sk and sk.get("tgt") == "random":
        for _ in range(sk["n"]):
            al = [e for e in enemies if e.hp > 0]
            if not al: break
            e = rng.choice(al); deal(u, e, attack_value(u, ctx, e, sk, party, cm, rng=rng, S=S), ctx, S)
        return
    t = tgt or alive_e[0]
    if conf: t = rng.choice(alive_e)
    d = attack_value(u, ctx, t, sk, party, cm, rng=rng, S=S)
    deal(u, t, d, ctx, S)
    if sk and sk.get("selfcost"): u.hp = max(1, u.hp - u.maxhp() * sk["selfcost"])
    if sk and sk.get("drain"): u.mp = min(u.maxmp(), u.mp + min(10, d * sk["drain"] / 10))
    if t.hp > 0:
        if sk and sk.get("st"): inflict(u, t, sk["st"], ctx, rng, S)
        elif sk is None and u.mods.get("auto_poison"): inflict(u, t, ("毒", u.mods["auto_poison"]), ctx, rng, S)

def fixed_dmg(u, e): return (20 + 6 * u.weapon["ilvl"]) * e.em("炎") * 100 / (100 + e.RES * 0.3)

# ---------------------------------------------------------------- 敵の行動
def enemy_turn(e, party, ctx, rng, S):
    es = ctx.est[id(e)]
    for k in ("毒", "火傷", "出血", "猛毒"):
        if k in es: e.hp -= e.maxhp * (0.02 if e.boss else 0.05)
    if "死の宣告" in es and es["死の宣告"][1] <= 1 and not e.boss: e.hp = 0
    if e.hp <= 0: e.hp = 0; return
    skip = any(k in es for k in ("睡眠", "凍結", "スタン", "石化")) or ("麻痺" in es and rng.random() < 0.3) \
        or ("混乱" in es and rng.random() < 0.5) or ("魅了" in es and rng.random() < 0.5)
    tick(es)
    if skip: return
    alive_p = [c for c in party if c.hp > 0]
    if not alive_p: return
    w = [1 + bval(ctx.sb[id(c)], "taunt") * 4 for c in alive_p]
    t = rng.choices(alive_p, weights=w)[0]; cover = 1.0
    kn = [c for c in alive_p if c.mods.get("cover") and c is not t and can_act(c, ctx) and not any(k in DISABLE for k in ctx.pst[id(c)])]
    if not kn: kn = [c for c in alive_p if c.job == "ナイト" and c is not t and can_act(c, ctx)]
    if kn and rng.random() < max(kn[0].mods.get("cover", 0), 0.5 if kn[0].job == "ナイト" else 0): t = kn[0]; cover = 0.5; S["cover"] += 1
    if "束縛" not in ctx.pst[id(t)]:
        eva = t.eva() + bval(ctx.pb, "eva") + t.aff("EVA") / 100 * 0
        if rng.random() < eva: S["evade"] += 1; return
    magic = rng.random() < e.m["magic"] and "沈黙" not in es
    if not magic and "暗闇" in es and rng.random() < 0.5: return
    pdef = 1 + bval(ctx.pb, "def") + bval(ctx.sb[id(t)], "def")
    pres = 1 + bval(ctx.pb, "res") + (party_has(party, "start_res") if S["round"] <= 3 else 0)
    sdn = 0.8 if "能力ダウン" in ctx.pst[id(t)] else 1.0
    a, d = (e.MAG, t.stat("RES") * pres * sdn) if magic else (e.STR, t.stat("DEF") * pdef * sdn)
    a *= (1 - bval(es, "str")) * (0.8 if "恐怖" in es else 1.0)
    cut = 1 - min(0.8, bval(ctx.pb, "cut") + bval(ctx.sb[id(t)], "cut") + (bval(ctx.sb[id(t)], "pcut") if not magic else 0))
    ecut = 1 - (party_has(party, "party_ecut") if (magic or e.m.get("elem")) else 0)
    mcut = 1 - (t.cloak["aff"].get("MAGIC_CUT", 0) / 100 if magic else 0)
    dmg = a * T["e_atk"] * 100 / (100 + d) * cover * cut * ecut * mcut * rnd(rng, 0.9, 1.1)
    t.hp -= dmg
    for k in SKIP_UNTIL_HIT: ctx.pst[id(t)].pop(k, None)
    if t.hp <= 0 and t.mods.get("endure") and id(t) not in ctx.endured: t.hp = 1; ctx.endured.add(id(t))
    if t.hp > 0 and not magic and "counter" in ctx.sb[id(t)]: deal(t, e, attack_value(t, ctx, e, None, party, 1.0, rng=rng), ctx, S)
    if e.m["st"] and t.hp > 0 and "immune" not in ctx.pb:
        name, p = e.m["st"]
        if name in ("毒", "猛毒") and t.mods.get("nopoison"): p = 0
        p *= max(0, 1 - t.sres() - party_has(party, "party_sres"))
        if rng.random() < p: player_status_hit(t, name, ctx, S)
    if t.hp <= 0: t.hp = 0; S["ko"] += 1; ctx.pst[id(t)] = {}; S.setdefault("ko_by", {}); S["ko_by"][t.job] = S["ko_by"].get(t.job, 0) + 1

# ---------------------------------------------------------------- 逃げる
def flee_rate(party, enemies, ctx):
    al = [c for c in party if c.hp > 0]; ae = [e for e in enemies if e.hp > 0]
    if any(e.boss for e in ae) or any("束縛" in ctx.pst[id(c)] for c in al): return 0
    sp = sum(c.stat("SPD") for c in al) / len(al) - sum(e.SPD for e in ae) / len(ae)
    luk = sum(c.stat("LUK") for c in al) / len(al)
    lv = sum(c.lv for c in al) / len(al) - sum(e.L for e in ae) / len(ae)
    cl = max([c.cloak["aff"].get("FLEE", 0) for c in al] or [0]) / 100
    return max(0.10, min(0.95, 0.5 + sp * 0.01 + luk * 0.002 + lv * 0.02 + cl))

# ---------------------------------------------------------------- 1戦
def battle(party, enemies, acc, rng, S, first=False, items=None, flee_policy=False):
    for c in party: c.refresh()
    for k in ("dmg_by_job", "skill_use", "e_status", "item_battle"): S.setdefault(k, {})
    S.setdefault("revive_skill", 0); S.setdefault("fled", 0)
    ctx = Ctx(party, enemies); q = 0; rounds = 0
    oc = B_open = max([c.mods.get("open_curse", 0) for c in party if can_act(c, ctx)] or [0])
    if oc:
        for e in enemies: ctx.est[id(e)]["def"] = [oc, 99]; ctx.est[id(e)]["res"] = [oc, 99]
    for c in party:
        if not can_act(c, ctx): continue
        ims = [s for s in c.A if s["k"] == "imbue" and c.mp >= s["mp"]]
        if ims:
            best = max(ims, key=lambda s: sum(e.em(s["el"]) for e in enemies if e.name in S["bestiary"]))
            if all(e.em(best["el"]) >= 1 for e in enemies if e.name in S["bestiary"]):
                c.mp -= best["mp"]; ctx.imbue[id(c)] = [best["el"], 99]
    def end(res):
        S["rounds"].append(rounds); S["bq"].append(q)
        for c in party:
            for k in ("呪い", "石化", "衰弱"):
                if k in ctx.pst[id(c)] and c.hp > 0: c.persist.add(k)
        if res == "win":
            for e in enemies: S["bestiary"].add(e.name)
        return res
    for rnd_i in range(30):
        rounds += 1; S["round"] = rnd_i + 1
        # 逃げる（慎重な人の遊び方）
        if flee_policy and rnd_i >= 1:
            al = [c for c in party if can_act(c, ctx)]
            if al and (sum(c.hp / c.maxhp() for c in al) / len(party) < 0.35 or len(al) <= 2):
                p = flee_rate(party, enemies, ctx)
                if p > 0:
                    q += 1; S["q"] += 1; ok = rng.random() < acc; S["ok"] += ok
                    if rng.random() < (p if ok else p / 2): S["fled"] += 1; return end("fled")
        units = [(c, False) for c in party if can_act(c, ctx)] + [(e, True) for e in enemies if e.hp > 0]
        def spd(x):
            u, ise = x
            if ise:
                v = u.SPD * (0.8 if "能力ダウン" in ctx.est[id(u)] else 1); return v * rnd(rng, 0.9, 1.1)
            v = u.stat("SPD") * (1 + bval(ctx.pb, "spd")) * (1 + (u.room.get("spd1", 0) + u.cloak["aff"].get("FIRST_SPD", 0) / 100 if first and rnd_i == 0 else 0))
            if rnd_i == 0 and u.mods.get("first"): v += 1e6
            return v * rnd(rng, 0.9, 1.1)
        units.sort(key=lambda x: -spd(x))
        for u, ise in units:
            if not any(can_act(c, ctx) for c in party) or not any(e.hp > 0 for e in enemies): break
            if u.hp <= 0: continue
            if ise: enemy_turn(u, party, ctx, rng, S); continue
            if not can_act(u, ctx): continue
            sd = ctx.pst[id(u)]
            # 継続ダメージ
            if "毒" in sd: u.hp -= u.maxhp() * 0.05 * sd["毒"]["n"]
            if "猛毒" in sd: sd["猛毒"]["n"] = min(3, sd["猛毒"].get("n", 1)); u.hp -= u.maxhp() * 0.05 * sd["猛毒"]["n"]; sd["猛毒"]["n"] += 1
            if "火傷" in sd: u.hp -= u.maxhp() * 0.05
            if "死の宣告" in sd and sd["死の宣告"]["t"] <= 1: u.hp = 0
            if u.mods.get("regen"): heal_to(u, u.maxhp() * u.mods["regen"], ctx)
            if "regen" in ctx.pb: heal_to(u, u.maxhp() * ctx.pb["regen"][0], ctx)
            if u.hp <= 0: u.hp = 0; S["ko"] += 1; ctx.pst[id(u)] = {}; continue
            skip = any(k in sd for k in ("睡眠", "凍結", "スタン")) or ("麻痺" in sd and rng.random() < 0.3)
            for k in list(sd):
                if k in ("呪い", "石化", "衰弱"): continue
                sd[k]["t"] -= 1
                if sd[k]["t"] <= 0: del sd[k]
            if skip: continue
            if "出血" in sd: u.hp -= u.maxhp() * 0.07
            if u.hp <= 0: u.hp = 0; S["ko"] += 1; continue
            q += 1; ok = rng.random() < acc; cm = 1.0 if ok else rnd(rng, 0.1, 0.5)
            S["q"] += 1; S["ok"] += ok
            charmed = "魅了" in sd
            if charmed and ok: sd.pop("魅了", None); charmed = False
            alive_p = [c for c in party if c.hp > 0]
            if charmed or ("混乱" in sd and rng.random() < 0.5 and len(alive_p) > 1):
                t = rng.choice(alive_p); t.hp = max(0, t.hp - (u.stat("STR") + u.wpow()) * 0.5 * 100 / (100 + t.stat("DEF"))); S["self_hit"] += 1
                continue
            choose_and_act(u, party, enemies, ctx, cm, rng, S, items)
        for d in ctx.delayed:
            d[0] -= 1
            if d[0] == 0 and d[1].hp > 0: deal(d[3], d[1], d[2], ctx, S)
        tick(ctx.pb)
        for c in party: tick(ctx.sb[id(c)])
        if not any(can_act(c, ctx) for c in party): return end("lose")
        if not any(e.hp > 0 for e in enemies): return end("win")
    return end("win" if any(can_act(c, ctx) for c in party) else "lose")
