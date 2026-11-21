# 単語の学習モデル（ルーンストーン・復習・昇格試験）
import heapq, math, random

WORDS_NEW = [600, 700, 800, 900, 600, 1400, 1000, 1000, 1500, 1000, 1200, 1300]   # ★ごとの新しい単語
PHRASES = 250                                                                    # ★ごとのフレーズ
STONE = 30

class Learner:
    def __init__(s, rng, P=None):
        P = P or {}
        s.rng = rng
        s.prior0 = P.get("prior0", 0.65); s.prior_drop = P.get("prior_drop", 0.07)   # すでに知っている割合（★1で65%、★ごとに-7%）
        s.p_new = P.get("p_new", 0.35); s.preview = P.get("preview", 0.10)           # 初めての単語に正解する確率（予習で+10%）
        s.new_per_run = P.get("new_per_run", 12); s.new_low = P.get("new_low", 5); s.due_cap = P.get("due_cap", 50)
        s.grow = P.get("grow", 2.3)
        s.star = []; s.stone = []; s.phrase = []
        for k in range(1, 13):
            n = WORDS_NEW[k - 1] + PHRASES
            for i in range(n):
                s.star.append(k); s.stone.append((k, i // STONE)); s.phrase.append(i >= WORDS_NEW[k - 1])
        N = len(s.star); s.N = N
        s.seen = [False] * N; s.S = [0.0] * N; s.last = [0] * N; s.due = [0] * N; s.streak = [0] * N; s.lastok = [-1] * N
        s.learned = [False] * N; s.known = [False] * N
        s.heap = []                                # (due, idx)
        s.next_new = {k: sum(WORDS_NEW[:k - 1]) + PHRASES * (k - 1) for k in range(1, 13)}
        s.end_of = {k: s.next_new[k] + WORDS_NEW[k - 1] + PHRASES for k in range(1, 13)}
        s.learned_by_star = [0] * 13; s.size_by_star = [0] + [WORDS_NEW[k - 1] + PHRASES for k in range(1, 13)]
        s.new_this_run = 0; s.day = 0; s.asked_today = set(); s.stats = dict(q=0, ok=0, new=0, review=0, filler=0)
        s.awake = set(); s.stone_seen = {}
    # ---------------------------------------------------------------- 日付
    def set_day(s, day):
        if day != s.day: s.day = day; s.asked_today = set()
    def due_count(s):
        if len(s.heap) > 3 * s.N:   # 古い記録を掃除
            s.heap = [(s.due[i], i) for i in range(s.N) if s.seen[i]]; heapq.heapify(s.heap)
        return sum(1 for d, i in s.heap if d <= s.day and s.due[i] == d)
    def begin_run(s):
        s.new_this_run = 0; s.lim = s.new_per_run if s.due_count() <= s.due_cap else s.new_low
    # ---------------------------------------------------------------- 出題
    def _pop_due(s):
        while s.heap and s.heap[0][0] <= s.day:
            d, i = heapq.heappop(s.heap)
            if s.due[i] != d or i in s.asked_today: continue
            return i
        return None
    def pick(s, star_cap, mode="dungeon"):
        i = s._pop_due()
        if i is not None: s.stats["review"] += 1; return i
        if mode == "dungeon":
            k = s.cur_star(star_cap)
            if s.new_this_run < getattr(s, "lim", s.new_per_run) and k and s.next_new[k] < s.end_of[k]:
                i = s.next_new[k]; s.next_new[k] += 1; s.new_this_run += 1; s.stats["new"] += 1; return i
        s.stats["filler"] += 1
        k = s.cur_star(star_cap) or star_cap
        lo = s.end_of[k] - s.size_by_star[k]; hi = max(lo + 1, s.next_new[k])
        j = s.rng.randrange(lo, hi)
        return -2 - j if s.seen[j] else -1           # 見たことのある単語の練習（記録は動かさない）
    def cur_star(s, cap):
        for k in range(1, min(12, cap + 1) + 1):      # 今の★の石を全部読んだら、1つ上の★の石も持ち込める
            if s.next_new[k] < s.end_of[k]: return k
        return None
    # ---------------------------------------------------------------- 解答
    def p_correct(s, i):
        if i == -1: return 0.95
        if i < -1: i = -2 - i
        if not s.seen[i]:
            if s.rng.random() < max(0.0, s.prior0 - s.prior_drop * (s.star[i] - 1)): s.known[i] = True
            return 0.95 if s.known[i] else min(0.9, s.p_new + s.preview)
        el = max(0, s.day - s.last[i]); R = 0.9 ** (el / max(0.3, s.S[i]))
        return R + (1 - R) * 0.25
    def answer(s, i):
        p = s.p_correct(i); ok = s.rng.random() < p
        s.stats["q"] += 1; s.stats["ok"] += ok
        if i < 0: return ok
        first = not s.seen[i]; s.seen[i] = True; s.asked_today.add(i)
        k = s.stone[i]; s.stone_seen[k] = s.stone_seen.get(k, 0) + first
        if ok:
            if first: s.S[i] = 20.0 if s.known[i] else 1.0
            else:
                el = max(0, s.day - s.last[i]); R = 0.9 ** (el / max(0.3, s.S[i]))
                s.S[i] = max(1.0, s.S[i] * (s.grow + 1.5 * (1 - R))) if el >= 1 else s.S[i]
            if s.day > s.lastok[i]: s.streak[i] += 1; s.lastok[i] = s.day
            if s.streak[i] >= 3 and not s.learned[i]: s.learned[i] = True; s.learned_by_star[s.star[i]] += 1
        else:
            s.S[i] = max(0.5, s.S[i] * 0.3 if not first else 0.5); s.streak[i] = 0
            if s.learned[i]: s.learned[i] = False; s.learned_by_star[s.star[i]] -= 1
        s.last[i] = s.day; s.due[i] = s.day + max(1, round(s.S[i])); heapq.heappush(s.heap, (s.due[i], i))
        return ok
    def ask(s, star_cap, mode="dungeon"):
        return s.answer(s.pick(star_cap, mode))
    # ---------------------------------------------------------------- 試験
    def frac(s, k): return s.learned_by_star[k] / s.size_by_star[k]
    def exam(s, k, n=25, need=0.8):
        lo, hi = s.end_of[k] - s.size_by_star[k], s.end_of[k]
        ok = 0
        for _ in range(n):
            i = s.rng.randrange(lo, hi)
            if not s.seen[i]: ok += s.rng.random() < 0.3
            else: ok += s.rng.random() < s.p_correct(i)
        return ok >= need * n
    def stones_ready(s):
        """全部見た石（覚醒の試練を受けられる）"""
        out = []
        for (k, j), n in s.stone_seen.items():
            if (k, j) in s.awake: continue
            size = min(STONE, s.size_by_star[k] - j * STONE)
            if n >= size: out.append((k, j))
        return out
    def trial(s, kj, n=20, need=0.8):
        k, j = kj; base = s.end_of[k] - s.size_by_star[k] + j * STONE
        size = min(STONE, s.size_by_star[k] - j * STONE)
        ok = sum(s.rng.random() < s.p_correct(base + s.rng.randrange(size)) for _ in range(n))
        if ok >= need * n: s.awake.add(kj); return True
        return False

class QSource:
    """battle() の `rng.random() < acc` の acc の代わり。比べるたびに1問解く"""
    def __init__(s, L, cap, mode="dungeon"): s.L, s.cap, s.mode = L, cap, mode
    def __gt__(s, x): return s.L.ask(s.cap, s.mode)
    def __float__(s): return 0.7
