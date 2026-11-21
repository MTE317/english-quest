"""町・ダンジョン・暦をつないだ通しシミュレーション（CSV版）"""
import random, copy, statistics
from collections import Counter
import db
from db import DUNGEONS, BY_RANK, MONSTERS, MON_BY_ID, MAT, ITEMS, ECON, FAC, INN, ADV, RAR, ENH, AFFIX, UNLOCKS, JOBS, WEAPONS, TIER
from core import T, Char, Enemy, rnd, APT
import battle as B

SEASONS = ["春", "夏", "秋", "冬"]
STOCK = {
    1: {"回復薬": 3, "魔力の水": 2, "帰還の羽": 1},
    2: {"上回復薬": 2, "回復薬": 2, "魔力の水": 3, "気付け薬": 1, "万能薬": 1, "帰還の羽": 1},
    3: {"上回復薬": 4, "魔力の霊水": 3, "気付け薬": 2, "万能薬": 2, "帰還の羽": 1},
    4: {"上回復薬": 5, "魔力の霊水": 4, "気付け薬": 3, "万能薬": 2, "帰還の羽": 1},
    5: {"上回復薬": 6, "魔力の霊水": 5, "気付け薬": 3, "命の雫": 1, "万能薬": 2, "帰還の羽": 1},
}
ALT = {"上回復薬": "回復薬", "魔力の霊水": "魔力の水", "命の雫": "気付け薬", "万能薬": None}
PROFILES = {
    "標準": dict(),
    "慎重": dict(flee=1, lv_margin=-2, return_hp=0.5),
    "無理をする": dict(lv_margin=2, no_train=1),
    "制作しない": dict(no_craft=1),
    "投資しない": dict(no_invest=1),
    "のんびり": dict(no_good_room=1, stock_k=0.5, no_enhance=1),
}
CORE_PARTY = ["戦士", "ナイト", "黒魔道士", "白魔道士"]
JOB_SWITCH = {"戦士": ["魔法剣士", "上級A"], "黒魔道士": ["精霊術士", "上級B", "上級F"], "白魔道士": ["上級B"], "ナイト": ["上級C", "上級D"],
              "盗賊": ["銃士"], "狩人": ["銃士", "上級E"], "吟遊詩人": ["踊り子"], "武闘家": ["上級C", "上級G"]}
UPPER_ALIAS = {}
for j in db.UPPER_JOBS:
    UPPER_ALIAS["上級" + "ABCDEFG"[db.UPPER_JOBS.index(j)]] = j

def season_of(day): return SEASONS[(day // 30) % 4]

class Game:
    def __init__(s, jobs, acc, seed=0, profile="標準", acc_growth=0.0, allow_switch=True, endgame_days=0, max_days=480):
        s.rng = random.Random(seed); s.acc0 = acc; s.acc_growth = acc_growth; s.P = PROFILES[profile]; s.profile = profile
        s.party = [Char(j, f"P{i}") for i, j in enumerate(jobs)]
        s.gold = 200.0; s.bank = 0.0; s.overdue = 0.0; s.day = 0
        s.fac = dict(weapon=1, armor=1, acc=1, item=1, inn=1)
        s.mats = Counter(); s.items = Counter(); s.pts = 0; s.adv = 0; s.cleared = set(); s.cleared_d = set()
        s.unlocked = set(); s.discover_open = set(); s.streak = Counter(); s.farm = 0; s.xpq = 5.0
        s.S = dict(q=0, ok=0, rounds=[], bq=[], weak_hits=0, resist_hits=0, neutral_hits=0, status={}, ko=0, cover=0, evade=0, heal=0, cure=0,
                   self_hit=0, bestiary=set())
        s.G = dict(spend=Counter(), earn=Counter(), months=0, short_months=0, overdue_months=0, crafts=Counter(), equip_src=Counter(),
                   attempts=0, wipes=0, returns=0, clears=Counter(), first_enter={}, first_clear={}, runs=[], wipes_by_rank=Counter(),
                   attempts_by_rank=Counter(), train_days=0, real_q=0, adv_log=[], unlock_log={}, switch_log=[], gold_log=[], max_streak=0,
                   run_q=[], invest_log=[], enh_ok=0, enh_ng=0, salvage=0, reroll=0, gate_block=0, temple=Counter(), dungeon_use=Counter(),
                   item_battle=Counter(), fled=0, good_room=0, inn_stays=0)
        s.allow_switch = allow_switch; s.endgame_days = endgame_days; s.max_days = max_days; s.clear5_day = None
    # ---------------------------------------------------------------- 便利
    def tier(s): return ADV[s.adv]["maxr"]
    def fee_tier(s): return max(s.cleared | {1})
    def fixed_cost(s): t = s.fee_tier(); return ECON[t]["guild_fee"] + ECON[t]["storage_fee"]
    def stock_cost(s, r):
        k = s.P.get("stock_k", 1.0)
        return sum(ITEMS[i]["price"] * n * k for i, n in STOCK[min(r, 5)].items() if ITEMS[i]["rank"] <= s.fac["item"])
    def reserve(s): return s.fixed_cost() + 0.5 * s.stock_cost(s.tier())
    def acc_now(s, r):
        a = s.acc0 + s.acc_growth * s.G["attempts"]
        return max(0.05, min(0.98, a) - T["acc_drop"] * (r - 1))
    def advance(s, days):
        for _ in range(days):
            s.day += 1
            if s.day % 30 == 0: s.month_end()
    def month_end(s):
        fee = s.fixed_cost(); s.G["spend"]["会費・倉庫"] += fee
        it = s.overdue * 0.10 + s.bank * 0.03
        s.overdue *= 1.10; s.bank *= 1.03; s.G["spend"]["利息"] += it
        s.gold -= fee
        if s.gold < 0:
            short = -s.gold; s.gold = 0; t = s.fee_tier()
            limit = 3 * ECON[t]["guild_fee"] * (1 + 0.25 * s.adv / 2)
            b = min(short, max(0, limit - s.bank)); s.bank += b; s.overdue += short - b
            s.G["short_months"] += 1
            if short - b > 0: s.G["overdue_months"] += 1
        s.G["months"] += 1; s.G["gold_log"].append((s.day, round(s.gold), round(s.bank + s.overdue)))
    # ---------------------------------------------------------------- 行き先
    def choose_dungeon(s):
        t = s.tier(); lv = statistics.mean(c.lv for c in s.party); margin = s.P.get("lv_margin", T["lv_margin"])
        r = 1
        for rr in range(1, t + 1):
            if lv >= min(DUNGEONS[d]["el"] for d in BY_RANK[rr]) - margin: r = rr
        if s.farm > 0 and r > 1: s.farm -= 1; r -= 1
        cands = BY_RANK[r]
        def score(d):
            D = DUNGEONS[d]; ok = 1.0 if lv >= D["el"] + 2 else (0.6 if lv >= D["el"] - margin else 0.3)
            need = 1.3 if (d in [u["dungeon"] for j, u in UNLOCKS.items() if u["method"] == "発見" and j not in s.unlocked]) else 1.0
            return D["income"] / D["days"] * ok * need * 0.93 ** (D["floors"] - 5) * (1 + 0.5 * s.rng.random())
        return max(cands, key=score)
    # ---------------------------------------------------------------- アイテム（戦闘の合間）
    def use_items(s):
        it = s.items; used = Counter(); know = 1 + B.party_has(s.party, "itemp")
        for c in s.party:
            if c.hp <= 0:
                for k, fr in (("気付け薬", 0.3), ("命の雫", 1.0)):
                    if it[k] > 0: it[k] -= 1; used[k] += 1; c.hp = c.maxhp() * fr; break
        for c in s.party:
            if c.hp <= 0 or "呪い" in c.persist: continue
            r = c.hp / c.maxhp()
            if r < 0.35 and it["上回復薬"] > 0: it["上回復薬"] -= 1; used["上回復薬"] += 1; c.hp = min(c.maxhp(), c.hp + 0.7 * know * c.maxhp())
            elif r < 0.5 and it["回復薬"] > 0: it["回復薬"] -= 1; used["回復薬"] += 1; c.hp = min(c.maxhp(), c.hp + 0.4 * know * c.maxhp())
            elif r < 0.5 and it["上回復薬"] > 0: it["上回復薬"] -= 1; used["上回復薬"] += 1; c.hp = min(c.maxhp(), c.hp + 0.7 * know * c.maxhp())
            if c.maxmp() > 40 and c.mp < c.maxmp() * 0.15:
                for k, f_ in (("魔力の霊水", 0.6), ("魔力の水", 0.3)):
                    if it[k] > 0: it[k] -= 1; used[k] += 1; c.mp = min(c.maxmp(), c.mp + f_ * c.maxmp()); break
        for c in s.party:
            if c.persist & {"石化", "呪い"} and it["万能薬"] > 0: it["万能薬"] -= 1; used["万能薬"] += 1; c.persist.clear()
        return used
    def danger(s):
        alive = [c for c in s.party if c.hp > 0 and "石化" not in c.persist]
        ko = len(s.party) - len(alive); revives = s.items["気付け薬"] + s.items["命の雫"]
        heals = s.items["回復薬"] + s.items["上回復薬"]
        avg = sum(c.hp / c.maxhp() for c in alive) / max(1, len(alive))
        healer = any(any(sk["k"] in ("heal", "healall") for sk in c.A) and c.mp >= 4 for c in alive)
        return ko - revives >= 2 or (avg < s.P.get("return_hp", 0.4) and heals == 0 and not healer) or len(alive) <= 1
    def danger_boss(s):
        alive = [c for c in s.party if c.hp > 0]
        avg = sum(c.hp / c.maxhp() for c in alive) / 4
        return avg < 0.45 and s.items["回復薬"] + s.items["上回復薬"] <= 1
    # ---------------------------------------------------------------- ダンジョン
    def run(s, did):
        D = DUNGEONS[did]; r = D["rank"]; season = season_of(s.day); pool = db.pool(did, season); rng = s.rng
        acc = s.acc_now(r); dr = D["drop"]
        loot = dict(gold=0.0, mats=Counter(), drops=[], kills=Counter(), xp=0, boss=False, discover=None)
        first = True; q0 = s.S["q"]
        for c in s.party: c.refresh()
        for fr in D["floor_rows"]:
            fq0 = s.S["q"]
            groups = [[Enemy(rng.choice(pool), fr["lv"], rng, r, D["emul"] * s.mercy(did)) for _ in range(fr["n"])] for _ in range(fr["battles"])]
            if fr["boss"]: groups[-1] = [Enemy(MON_BY_ID[D["boss"]], fr["lv"], rng, r, D["emul"] * s.mercy(did)), Enemy(rng.choice(pool), fr["lv"], rng, r, D["emul"] * s.mercy(did))]
            for gi, enemies in enumerate(groups):
                if not first:
                    s.G["used"] = s.G.get("used", Counter()) + s.use_items()
                    is_boss = fr["boss"] and gi == len(groups) - 1
                    if s.danger() or (is_boss and s.danger_boss()):
                        if s.items["帰還の羽"] > 0:
                            s.items["帰還の羽"] -= 1; return "return", loot, fr["floor"]
                res = B.battle(s.party, enemies, acc, rng, s.S, first=first, items=s.items if T["items_in_battle"] else None,
                               flee_policy=bool(s.P.get("flee", 0)))
                first = False
                if res == "lose": return "wipe", loot, fr["floor"]
                if res == "fled":
                    s.G["fled"] += 1; continue
                for e in enemies:
                    loot["kills"][e.name] += 1
                    loot["gold"] += ECON[r]["run_income"] * D["income"] * dr["gold"] / 27 * (dr["boss_gold"] if e.boss else 1) * rnd(rng, 0.8, 1.2)
                    x = (6 + 3.2 * e.L) * T["xp_k"] * (5 if e.boss else 1); loot["xp"] += x
                    for c in s.party:
                        if c.hp > 0: c.gain_xp(x * max(0.1, 1 - T["xp_pen"] * max(0, c.lv - e.L)))
                    cm_, rm_ = e.m["mat"]
                    if e.boss:
                        loot["mats"][cm_] += rng.choice([1, 2]); loot["boss"] = True
                        if rng.random() < 0.3: loot["mats"][rm_] += 1
                    else:
                        if rng.random() < dr["mat"] * (1 + B.party_has(s.party, "drop") * 0): loot["mats"][cm_] += 1
                        if rng.random() < dr["rare"]: loot["mats"][rm_] += 1
                for c in s.party:
                    c.ap[c.job] = c.ap.get(c.job, 0) + (3 if any(e.boss for e in enemies) else 1)
                    if c.hp > 0: c.mp = min(c.maxmp(), c.mp + T["mp_regen"] * c.maxmp())
                luk = 0.15 if any(c.job == "盗賊" for c in s.party) else 0.0
                p = dr["boss_gear"] if any(e.boss for e in enemies) else dr["gear"] * (1 + luk * 2)
                if rng.random() < p: loot["drops"].append(s.gen_drop(r, fr["floor"], D, luk))
            s.G.setdefault("floor_q", []).append(s.S["q"] - fq0)
            if fr["rp"] and s.danger_boss() and not all(c.hp > 0.6 * c.maxhp() for c in s.party):
                return "return", loot, fr["floor"]
        # 奥地の発見
        for j, u in UNLOCKS.items():
            if u["method"] == "発見" and u["dungeon"] == did and j not in s.unlocked:
                if did in s.discover_open or rng.random() < u["chance"]:
                    loot["discover"] = j
        return "clear", loot, D["floors"]
    # ---------------------------------------------------------------- 装備
    def gen_affixes(s, slot, n, ilvl, rar):
        pool = AFFIX["armor" if slot in ("head", "body", "arm") else slot][:]; out = {}
        for _ in range(n):
            if not pool: break
            tot = sum(a["w"] for a in pool); x = s.rng.random() * tot
            for a in pool:
                x -= a["w"]
                if x <= 0: break
            pool.remove(a)
            v = rnd(s.rng, a["lo"], a["hi"]) * ((1 + ilvl / 12) if a["scale"] else 1) * (1.15 if rar >= 5 else 1)
            k = a["stat"]
            if k == "TYPE_BONUS": k = "特効:" + s.rng.choice(list(db.TYPES.values()))
            if k == "ELEMENT": continue
            out[k] = out.get(k, 0) + v
        return out
    def roll_rarity(s, r, floor, luk):
        w = [x["w"] * (1 + 0.08 * (floor - 1) + 0.15 * (r - 1) + luk) if i >= 2 else x["w"] for i, x in enumerate(RAR)]
        t = s.rng.random() * sum(w)
        for i, x in enumerate(w):
            t -= x
            if t <= 0: return i
        return 0
    def gen_drop(s, r, floor, D, luk):
        lo, hi = D["ilvl"]; top = lo + (hi - lo) * floor / D["floors"]; ilvl = max(1, round(rnd(s.rng, top - 4, top)))
        rar = s.roll_rarity(r, floor, luk); n = RAR[rar]["n"]; x = s.rng.random()
        if x < 0.35: return dict(slot="weapon", t=s.rng.choice(list(WEAPONS)), ilvl=ilvl, q=1.0, enh=0, aff=s.gen_affixes("weapon", n, ilvl, rar), el=None, rar=rar, src="ドロップ")
        if x < 0.80:
            p = s.rng.choice(["head", "body", "arm"])
            return dict(slot=p, w=s.rng.choice(["重", "中", "軽"]), ilvl=ilvl, q=1.0, enh=0, aff=s.gen_affixes(p, n, ilvl, rar), rar=rar, src="ドロップ")
        if x < 0.88: return dict(slot="cloak", ilvl=ilvl, aff=s.gen_affixes("cloak", max(1, n), ilvl, rar), rar=rar, src="ドロップ")
        return dict(slot="accessory", ilvl=ilvl, aff=s.gen_affixes("accessory", max(1, n), ilvl, rar), rar=rar, src="ドロップ")
    MAIN = {"戦士": "STR", "ナイト": "STR", "黒魔道士": "MAG", "白魔道士": "MAG", "盗賊": "STR", "武闘家": "STR", "狩人": "STR", "吟遊詩人": "MAG",
            "精霊術士": "MAG", "銃士": "STR", "踊り子": "STR", "魔法剣士": "STR", "呪術師": "MAG", "薬師": "STR"}
    def main_stat(s, c):
        return s.MAIN.get(c.job, "MAG" if JOBS[c.job]["g"].split()[2] in ("A",) else "STR")
    def score_w(s, c, w):
        if w["t"] not in JOBS[c.job]["w"]: return -1
        if not c.gate_ok(w): return -1
        old = c.weapon; c.weapon = w; v = c.wpow() + w["aff"].get(s.main_stat(c), 0) + 0.4 * sum(x for k, x in w["aff"].items() if not k.startswith("特効")) + 8 * any(k.startswith("特効") for k in w["aff"]); c.weapon = old
        return v
    def score_p(s, c, p, part):
        apt = APT.get(JOBS[c.job]["armor"].get(p["w"], "×"), 0)
        if not apt: return -1
        return (6 + 1.3 * p["ilvl"]) * {"重": 1.0, "中": 0.65, "軽": 0.35}[p["w"]] * p["q"] * (1 + 0.05 * p["enh"]) * apt * 2 + 0.5 * sum(p["aff"].values()) \
            + (5 if p["w"] == JOBS[c.job]["arm"] else 0)
    def score_x(s, c, x): return x["aff"].get(s.main_stat(c), 0) * 1.5 + x["aff"].get("HP", 0) * 0.3 + sum(v for k, v in x["aff"].items() if k not in ("EXP", "DROP")) * 0.5 + x["ilvl"] * 0.05
    def try_equip(s, it):
        best = None
        for c in s.party:
            sl = it["slot"]
            if sl == "weapon":
                if it["t"] in JOBS[c.job]["w"] and not c.gate_ok(it) and APT.get(JOBS[c.job]["w"][it["t"]], 0) >= 1: s.G["gate_block"] += 1
                g = s.score_w(c, it) - s.score_w(c, c.weapon)
            elif sl in ("head", "body", "arm"): g = s.score_p(c, it, sl) - s.score_p(c, c.parts[sl], sl)
            elif sl == "cloak": g = s.score_x(c, it) - s.score_x(c, c.cloak)
            else: g = s.score_x(c, it) - min(s.score_x(c, a) for a in c.acc)
            if g > 0.5 and (best is None or g > best[0]): best = (g, c)
        if not best: return False
        c = best[1]; sl = it["slot"]
        if sl == "weapon": c.weapon = it
        elif sl in ("head", "body", "arm"): c.parts[sl] = it
        elif sl == "cloak": c.cloak = it
        else: i = min(range(2), key=lambda i: s.score_x(c, c.acc[i])); c.acc[i] = it
        s.G["equip_src"][it["src"]] += 1
        return True
    def sell_or_salvage(s, it):
        if it.get("rar", 0) >= 2:     # レア以上は分解して素材に
            r = min(12, max(1, (it["ilvl"] + 4) // 11 + 1)); s.mats[f"_salvage_{r}"] += it["rar"]; s.G["salvage"] += 1
        else:
            p = round(ECON[min(12, max(1, (it["ilvl"] + 4) // 11 + 1))]["run_income"] * 0.04 * (1 + 0.8 * it.get("rar", 0)))
            s.gold += p; s.G["earn"]["売却"] += p
    # ---------------------------------------------------------------- 町
    def buy_stock(s, r):
        spent = 0; k = s.P.get("stock_k", 1.0)
        for i, n in STOCK[min(r, 5)].items():
            n = max(0, round(n * k))
            if ITEMS[i]["rank"] > s.fac["item"]:
                i = ALT.get(i)
                if not i: continue
            need = max(0, n - s.items[i]); price = ITEMS[i]["price"] * (1 - ADV[s.adv]["disc"])
            can = min(need, int(max(0, s.gold) // price)); s.items[i] += can; s.gold -= can * price; spent += can * price
        s.G["spend"]["道具"] += spent
    def mercy(s, did):
        n = s.streak[did]
        return 1.0 - (T["mercy"] if n >= 2 else 0) - (T["mercy"] if n >= 4 else 0)
    def rsv(s, k):
        return max([n for j, u in UNLOCKS.items() if j not in s.unlocked and u["method"] == "素材" for m, n in u["mats"] if m == k] or [0])
    def craft_item_ok(s, r, n_common):
        have = sum(max(0, v - s.rsv(k)) for k, v in s.mats.items() if k in MAT and int(MAT[k]["rank"]) == r and MAT[k]["kind"] in ("common",) and v > 0)
        have += s.mats.get(f"_salvage_{r}", 0)
        return have >= n_common
    def take_common(s, r, n):
        for k in sorted([k for k in s.mats if k in MAT and int(MAT[k]["rank"]) == r and MAT[k]["kind"] == "common"], key=lambda k: -s.mats[k]):
            u = max(0, min(s.mats[k] - s.rsv(k), n)); s.mats[k] -= u; n -= u
            if n <= 0: return
        sk = f"_salvage_{r}"; u = min(s.mats.get(sk, 0), n); s.mats[sk] -= u
    def boss_mat(s, r):
        for k, v in s.mats.items():
            if v > 0 and k in MAT and int(MAT[k]["rank"]) == r and MAT[k]["kind"] == "boss": return k
        return None
    def craft(s):
        if s.P.get("no_craft"): return
        for r in range(min(12, max(s.fac["weapon"], s.fac["armor"])), 0, -1):
            il = FAC[r]["craft_item_lv"]; cost = ECON[r]["craft_gold"]
            for c in sorted(s.party, key=lambda c: s.main_stat(c) != "STR"):
                if s.fac["weapon"] >= r:
                    derive = c.weapon["src"] == "制作" and c.weapon.get("r") == r - 1
                    need = 3 if derive else 5; g = cost * (0.7 if derive else 1)
                    bm = s.boss_mat(r)
                    if bm and s.craft_item_ok(r, need) and s.gold - g > s.reserve():
                        t = max(JOBS[c.job]["w"], key=lambda w: APT[JOBS[c.job]["w"][w]] * WEAPONS[w].get("pm", 1))
                        new = dict(t=t, ilvl=il, q=1.15, enh=0, aff={}, el=None, src="制作", r=r, rar=0)
                        if s.score_w(c, new) > s.score_w(c, c.weapon) * 1.05:
                            s.take_common(r, need); s.mats[bm] -= 1; s.gold -= g; s.G["spend"]["制作"] += g; c.weapon = new; s.G["crafts"]["武器"] += 1
                            s.G["equip_src"]["制作"] += 1
                if s.fac["armor"] >= r:
                    for part in ("body", "head", "arm"):
                        if s.craft_item_ok(r, 3) and s.gold - cost * 0.6 > s.reserve():
                            new = dict(w=JOBS[c.job]["arm"], ilvl=il, q=1.15, enh=0, aff={}, src="制作", r=r, rar=0)
                            if s.score_p(c, new, part) > s.score_p(c, c.parts[part], part) * 1.05:
                                s.take_common(r, 3); s.gold -= cost * 0.6; s.G["spend"]["制作"] += cost * 0.6; c.parts[part] = new
                                s.G["crafts"]["防具"] += 1; s.G["equip_src"]["制作"] += 1
        # 付与（まれな素材で効果を足す）
        for c in s.party:
            for it, key in ((c.weapon, s.main_stat(c)), (c.parts["body"], "HP")):
                if it.get("src") == "制作" and len(it["aff"]) < 2:
                    r = it["r"]; cost = ECON[r]["craft_gold"] * 0.5
                    rk = [k for k, v in s.mats.items() if v > s.rsv(k) and k in MAT and MAT[k]["kind"] == "rare" and int(MAT[k]["rank"]) <= r]
                    if rk and s.gold - cost > s.reserve():
                        s.mats[rk[0]] -= 1; s.gold -= cost; s.G["spend"]["制作"] += cost
                        k = key if key not in it["aff"] else ("DEF" if key == "HP" else "CRT")
                        v = (4 * (1 + it["ilvl"] / 12) * (0.6 + 0.1 * s.fac["acc"])) if k != "CRT" else 2 + s.fac["acc"] * 0.5
                        if k == "HP": v *= 3
                        it["aff"][k] = v; s.G["crafts"]["付与"] += 1
        # マント・アクセサリーの制作（装飾工房）
        r = s.fac["acc"]
        for c in s.party:
            if c.acc[0]["ilvl"] < FAC[r]["craft_item_lv"] - 10 and s.craft_item_ok(r, 4) and s.gold - ECON[r]["craft_gold"] > s.reserve():
                il = FAC[r]["craft_item_lv"]
                new = dict(ilvl=il, aff={s.main_stat(c): 4 * (1 + il / 12), "HP": 3 * 4 * (1 + il / 12) * 0.5}, src="制作", rar=0)
                if s.score_x(c, new) > min(s.score_x(c, a) for a in c.acc):
                    s.take_common(r, 4); s.gold -= ECON[r]["craft_gold"]; s.G["spend"]["制作"] += ECON[r]["craft_gold"]
                    i = min(range(2), key=lambda i: s.score_x(c, c.acc[i])); c.acc[i] = new; s.G["crafts"]["アクセサリー"] += 1; s.G["equip_src"]["制作"] += 1
    def shop_gear(s):
        t = s.tier(); il = DUNGEONS[BY_RANK[t][0]]["ilvl"][0] + 3
        for c in sorted(s.party, key=lambda c: s.main_stat(c) != "STR"):
            wt = max(JOBS[c.job]["w"], key=lambda x: APT[JOBS[c.job]["w"][x]] * WEAPONS[x].get("pm", 1))
            w = dict(t=wt, ilvl=il, q=1.0, enh=0, aff={}, el=None, src="店", rar=0)
            price = round((8 + 1.6 * il) * 4.5)
            if s.score_w(c, w) > s.score_w(c, c.weapon) * 1.15 and s.gold - price > s.fixed_cost() * 0.5:
                s.gold -= price; c.weapon = w; s.G["spend"]["店の装備"] += price; s.G["equip_src"]["店"] += 1
            for part in ("body", "head", "arm"):
                a = dict(w=JOBS[c.job]["arm"], ilvl=il, q=1.0, enh=0, aff={}, src="店", rar=0); price = round((6 + 1.3 * il) * 1.6)
                if s.score_p(c, a, part) > s.score_p(c, c.parts[part], part) * 1.15 and s.gold - price > s.fixed_cost() * 0.5:
                    s.gold -= price; c.parts[part] = a; s.G["spend"]["店の装備"] += price; s.G["equip_src"]["店"] += 1
    def enhance(s):
        if s.P.get("no_enhance"): return
        cap = {"weapon": FAC[s.fac["weapon"]]["enhance_cap"], "armor": FAC[s.fac["armor"]]["enhance_cap"]}
        for _ in range(8):
            cands = []
            for c in s.party:
                for it, kind in [(c.weapon, "weapon")] + [(p, "armor") for p in c.parts.values()]:
                    if it["enh"] < cap[kind]: cands.append((round((20 + it["ilvl"] * 4) * (1 + it["enh"] * 0.6)) * (1 if kind == "weapon" else 0.5), it))
            if not cands: return
            cost, it = min(cands, key=lambda x: x[0])
            if s.gold - cost < s.reserve(): return
            s.gold -= cost; s.G["spend"]["強化"] += cost
            if s.rng.random() < ENH[int(it["enh"])]: it["enh"] += 1; s.G["enh_ok"] += 1
            else: s.G["enh_ng"] += 1
    def invest(s):
        if s.overdue > 0 or s.P.get("no_invest"): return
        t = s.tier()
        for _ in range(3):
            cands = [(k, v) for k, v in s.fac.items() if v < min(len(FAC), t + (1 if k in ("weapon", "armor") else 0))]
            if not cands: return
            order = ["weapon", "armor", "item", "inn", "acc"]
            k, v = min(cands, key=lambda x: (x[1], order.index(x[0])))
            cost = FAC[v + 1]["invest_cost"]
            if s.gold - cost < s.reserve(): return
            s.gold -= cost; s.fac[k] += 1; s.G["spend"]["投資"] += cost; s.G["invest_log"].append((s.day, k, v + 1))
    def quests(s, did):
        r = DUNGEONS[did]["rank"]; pool = db.pool(did, season_of(s.day)); qs = []
        for _ in range(3):
            x = s.rng.random()
            if x < 0.5: m = s.rng.choice(pool); qs.append(("討伐", m["name"], s.rng.randint(3, 6)))
            elif x < 0.8: qs.append(("採集", None, s.rng.randint(3, 5)))
            else: qs.append(("ボス退治", MON_BY_ID[DUNGEONS[did]["boss"]]["name"], 1))
        return qs
    def settle(s, qs, loot, did):
        r = DUNGEONS[did]["rank"]; pts = 0
        for typ, tgt, n in qs:
            done = False
            if typ in ("討伐", "ボス退治") and loot["kills"][tgt] >= n:
                g = ECON[r]["run_income"] * (0.15 if typ == "討伐" else 0.35) * (1 + ADV[s.adv]["qb"]); s.gold += g; s.G["earn"]["クエスト"] += g; done = True
            elif typ == "採集":
                have = sum(v for k, v in s.mats.items() if k in MAT and int(MAT[k]["rank"]) == r and MAT[k]["kind"] == "common")
                if have >= n + 5:
                    s.take_common(r, n); rm = s.rng.choice([m["mat"][1] for m in MONSTERS if m["rank"] == r and not m["boss"]]); s.mats[rm] += 1; done = True
            if done and r >= s.tier() - 1: pts += {"討伐": 1, "採集": 1, "ボス退治": 3}[typ] * (1.0 if r == s.tier() else 0.5)
        s.pts += pts
        while s.adv + 1 < len(ADV) and s.pts >= ADV[s.adv + 1]["pts"]:
            nxt = s.adv + 1
            if ADV[nxt]["boss"] and ADV[s.adv]["maxr"] not in s.cleared: break
            s.adv = nxt; s.G["adv_log"].append((s.day, ADV[nxt]["id"]))
    def temple(s):
        r = s.fee_tier()
        for c in s.party:
            if c.hp <= 0: s.gold -= ECON[r]["revive_per_person"]; s.G["spend"]["神殿"] += ECON[r]["revive_per_person"]; s.G["temple"]["復活"] += 1; c.hp = 1
            if c.persist:
                cost = ECON[r]["curse_cure"] * len(c.persist); s.gold -= cost; s.G["spend"]["神殿"] += cost
                for p in c.persist: s.G["temple"][p] += 1
                c.persist.clear()
    def inn(s):
        r = s.tier(); cost = ECON[r]["inn_good"]
        good = not s.P.get("no_good_room") and s.gold - cost > s.reserve() and s.overdue == 0
        fx = INN[s.fac["inn"]] if good else {}
        s.gold -= cost if good else 10; s.G["spend"]["宿屋"] += cost if good else 10; s.G["good_room"] += good; s.G["inn_stays"] += 1
        for c in s.party:
            c.room = dict(hp=fx.get("max_hp_pct", 0) / 100, mp=fx.get("max_mp_pct", 0) / 100, spd1=fx.get("first_battle_spd_pct", 0) / 100,
                          sres=fx.get("status_resist_pct", 0) / 100) if fx else {}
            c.hp = c.maxhp(); c.mp = c.maxmp()
    def check_unlocks(s, loot):
        for j, u in UNLOCKS.items():
            if j in s.unlocked: continue
            if u["method"] == "素材" and all(s.mats.get(m, 0) >= n for m, n in u["mats"]):
                for m, n in u["mats"]: s.mats[m] -= n
                s.unlocked.add(j); s.G["unlock_log"][j] = s.day
        if loot.get("discover"):
            j = loot["discover"]; s.unlocked.add(j); s.G["unlock_log"][j] = s.day
    def job_change(s):
        if not s.allow_switch: return
        for c in s.party:
            if TIER[c.job] == "上級": continue
            cands = []
            for alias in JOB_SWITCH.get(c.job, []) + JOB_SWITCH.get(c.ap and next(iter(c.ap)), []):
                j = UPPER_ALIAS.get(alias, alias)
                if j in s.unlocked and j not in [x.job for x in s.party] and j != c.job: cands.append(j)
            if not cands: continue
            j = cands[-1]
            if TIER[j] == TIER[c.job] or (TIER[c.job] == "基本" and c.ap.get(c.job, 0) < 120 and TIER[j] == "中級"): continue
            if TIER[c.job] == "中級" and TIER[j] == "中級": continue
            old = c.job; c.change_job(j); s.G["switch_log"].append((s.day, old, j))
            if c.weapon["t"] not in JOBS[j]["w"]:
                t = JOBS[j]["start_weapon"]; il = max(3, c.weapon["ilvl"] - 10) if not T["mastery_gate"] else 3
                c.weapon = dict(t=t, ilvl=il, q=1.0, enh=0, aff={}, el=None, src="ジョブチェンジ", rar=0)
    def train(s):
        c = min(s.party, key=lambda c: (c.lv, c.xp))
        ok = sum(s.rng.random() < s.acc_now(1) for _ in range(15))
        c.gain_xp(s.xpq * 0.8 * (ok + 0.3 * (15 - ok))); c.ap[c.job] += 3
        s.S["q"] += 15; s.G["train_days"] += 1; s.G["real_q"] += 15; s.advance(1)
    # ---------------------------------------------------------------- メインループ
    def play(s):
        cur = 0
        while s.day < s.max_days:
            if s.clear5_day is not None and s.day >= s.clear5_day + s.endgame_days: break
            did = s.choose_dungeon(); r = DUNGEONS[did]["rank"]
            qs = s.quests(did); s.buy_stock(r)
            snap = copy.deepcopy((s.party, s.gold, s.bank, s.overdue, s.day, s.fac, s.mats, s.items, s.pts, s.adv, s.cleared, s.cleared_d, s.unlocked))
            rng_state = s.rng.getstate(); q0 = s.S["q"]
            res, loot, floor = s.run(did)
            s.G["attempts"] += 1; s.G["attempts_by_rank"][r] += 1; s.G["real_q"] += s.S["q"] - q0; s.G["run_q"].append((r, s.S["q"] - q0, res))
            s.G["first_enter"].setdefault(r, (s.day, s.G["attempts"], s.G["real_q"])); s.G["dungeon_use"][did] += 1
            if res == "wipe":
                (s.party, s.gold, s.bank, s.overdue, s.day, s.fac, s.mats, s.items, s.pts, s.adv, s.cleared, s.cleared_d, s.unlocked) = snap
                for c in s.party: c.gain_xp(loot["xp"] * T["wipe_xp_keep"])
                s.G["wipes"] += 1; s.G["wipes_by_rank"][r] += 1; s.streak[did] += 1; cur += 1; s.G["max_streak"] = max(s.G["max_streak"], cur)
                s.G["runs"].append((s.day, did, "wipe", floor))
                if not s.P.get("no_train"):
                    if r > 1: s.farm = T["farm_after_wipe"]          # 負けたら★を1つ下げて鍛え直す
                    else:
                        for _ in range(4): s.train()
                elif s.streak[did] >= 6 and r > 1: s.farm = 2; s.streak[did] = 0
                continue
            cur = 0; s.streak[did] = 0
            s.advance(DUNGEONS[did]["days"])
            s.gold += loot["gold"]; s.G["earn"]["敵のお金"] += loot["gold"]; s.mats += loot["mats"]
            for d in loot["drops"]:
                if not s.try_equip(d): s.sell_or_salvage(d)
            for k, n in list(s.mats.items()):
                keep = max(15, s.rsv(k))
                if n > keep and not k.startswith("_"):
                    p = (n - keep) * (3 + 3 * int(MAT[k]["rank"]) if k in MAT else 3); s.gold += p; s.G["earn"]["素材売却"] += p; s.mats[k] = keep
            qn = s.S["q"] - q0; s.xpq = loot["xp"] / max(1, qn / 4)
            s.settle(qs, loot, did)
            if res == "clear":
                s.G["clears"][r] += 1; s.cleared.add(r); s.cleared_d.add(did)
                s.G["first_clear"].setdefault(r, (s.day, s.G["attempts"], s.G["real_q"]))
                if r == 5 and s.clear5_day is None: s.clear5_day = s.day
            else: s.G["returns"] += 1
            s.G["runs"].append((s.day, did, res, floor, round(loot["gold"]), qn))
            s.check_unlocks(loot); s.job_change()
            s.temple()
            for k in ("overdue", "bank"):
                pay = min(getattr(s, k), max(0, s.gold - s.fixed_cost())); setattr(s, k, getattr(s, k) - pay); s.gold -= pay
            s.invest(); s.craft(); s.shop_gear(); s.inn(); s.enhance()
            s.advance(1)
        return s
