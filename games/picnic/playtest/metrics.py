"""Batch metrics for a ruleset across 2-4 player family tables."""
import itertools, random, statistics, sys
from sim import Rules, table, FAMILY

TABLES = {
    2: [["kid", "careful"], ["careful", "kid"], ["kid", "sneaky"], ["sneaky", "kid"], ["greedy", "sneaky"], ["careful", "greedy"]],
    3: [["kid", "careful", "sneaky"], ["sneaky", "kid", "greedy"], ["careful", "greedy", "kid"]],
    4: [["kid", "careful", "greedy", "sneaky"], ["sneaky", "greedy", "careful", "kid"], ["careful", "kid", "sneaky", "greedy"]],
}


def pct(a, b):
    return f"{100 * a / b:.0f}%" if b else "-"


def report(rules, n=600, label="", tables=TABLES, quiet=False):
    out = {}
    for p, tabs in tables.items():
        games = []
        for i in range(n):
            g = table(rules, tabs[i % len(tabs)], 10_000 + i, log=False)
            if getattr(g, "winners", None) is None:
                continue
            games.append((tabs[i % len(tabs)], g))
        rounds = [g.round for _, g in games]
        M = lambda k: sum(g.m[k] for _, g in games)
        turns = M("turns")
        acts = {}
        for _, g in games:
            for k, v in g.m["actions"].items():
                acts[k] = acts.get(k, 0) + v
        springs = M("springs")
        seat_wins = [0] * p
        persona_wins, persona_games = {}, {}
        for tab, g in games:
            for w in g.winners:
                seat_wins[w] += 1 / len(g.winners)
                persona_wins[tab[w]] = persona_wins.get(tab[w], 0) + 1 / len(g.winners)
            for t in tab:
                persona_games[t] = persona_games.get(t, 0) + 1
        margins = []
        comeback = 0
        close = 0
        for _, g in games:
            s = sorted(g.score, reverse=True)
            margins.append(s[0] - s[1])
            close += s[0] - s[1] <= 3
            # was the winner leading two rounds from the end?
            seq = g.m["leader_seq"]
            mid = seq[max(0, len(seq) - 2 * p - 1)]
            comeback += mid is not None and mid not in g.winners
        big = sum(len(g.m["big"]) for _, g in games)
        pack_traps = [x for _, g in games for x in g.m["pack_traps"]]
        maxb = [g.m["max_blanket"] for _, g in games]
        zero = M("zero_packs")
        packs = len(pack_traps)
        tp = [x for _, g in games for x in g.m["trap_points"]]
        dud = sum(1 for x in tp if x == 0)
        line = (f"{p}p: rounds {statistics.median(rounds):.0f} (p90 {sorted(rounds)[int(.9 * len(rounds))]}) | "
                f"seat wins {[pct(w, len(games)) for w in seat_wins]} | "
                f"acts " + " ".join(f"{k} {pct(v, turns)}" for k, v in sorted(acts.items())) + " | "
                f"land {pct(M('landed'), springs - M('pine'))} dud-landings {pct(dud, len(tp))} | "
                f"packs w/ traps {pct(sum(1 for x in pack_traps if x), packs)} zero-packs {pct(zero, packs)} | "
                f"max blanket med {statistics.median(maxb)} p90 {sorted(maxb)[int(.9 * len(maxb))]} | "
                f"big moments/game {big / len(games):.1f} | close finish {pct(close, len(games))} "
                f"comeback {pct(comeback, len(games))} lead changes {M('lead_changes') / len(games):.1f} "
                f"shoo-backs/game {M('shoo_back') / len(games):.2f} shoos/game {M('shoo') / len(games):.2f}")
        if not quiet:
            print(line)
            print("     personas win rate (vs fair share): " + ", ".join(
                f"{k} {persona_wins.get(k, 0) / persona_games[k] * p:.2f}" for k in sorted(persona_games)))
        by = {}
        for _, g in games:
            for t, (l, st, pts) in g.m["by_trap"].items():
                a = by.setdefault(t, [0, 0, 0])
                a[0] += l; a[1] += st; a[2] += pts
        if not quiet:
            print("     traps: " + ", ".join(f"{t} landed {pct(l, l + st)} avg {pts / l if l else 0:.1f}pt" for t, (l, st, pts) in sorted(by.items())))
        out[p] = dict(rounds=statistics.median(rounds), seat=seat_wins, games=len(games))
    return out


if __name__ == "__main__":
    report(Rules())
