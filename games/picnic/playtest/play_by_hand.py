"""Play seat 0 by hand: replays the seeded game with my moves so far, then
stops at my next turn and shows only what my seat may see.

    python3 play_me.py SEED '<json list of my turns>'

Each turn is {"trap": [card, seat] | null, "act": "lay" | "pack" | "nothing",
"lay": [cards], "defend": {"ants": "shoo", ...}}.
"""
import json, random, re, sys
import sim as picnic
from sim import Rules, Game, Base, PERSONAS, bval, nice, NICE, is_food

R = Rules(trap_free=True, one_each=True, trap_cap=2, gull_basket=True, no_shake=True, shoo_back=True,
          defences={"umbrella": 2, "shoo": 3}, basket_max=5)


class Pause(Exception):
    pass


class Me(Base):
    name = "me"

    def __init__(self, rng, moves):
        super().__init__(rng)
        self.moves = list(moves)
        self.cur = None

    def free_trap(self, g, s):
        if not self.moves:
            raise Pause
        self.cur = self.moves.pop(0)
        t = self.cur.get("trap")
        return (t[0], t[1]) if t else None

    def act(self, g, s):
        a = self.cur["act"]
        if a == "lay":
            return ("lay", self.cur["lay"])
        return (a,)

    def defend(self, g, s, trap, setter):
        d = self.cur.get("defend", {}).get(trap)
        return d if d in g.hands[s] else None

    def shoo_back(self, g, s, trap, victim):
        return True


def main():
    seed = int(sys.argv[1])
    moves = json.loads(sys.argv[2]) if len(sys.argv) > 2 else []
    rng = random.Random(seed * 7919 + 1)
    me = Me(rng, moves)
    ps = [me, PERSONAS["kid"](rng), PERSONAS["sneaky"](rng)]
    names = ["Me", "Louis(kid)", "Ana(sneaky)"]
    g = Game(R, ps, names, seed)
    try:
        g.play()
        over = True
    except Pause:
        over = False
    # what I may see: other people's traps stay mystery cards
    seen = []
    for ln in g.lines:
        m = re.match(r"  (\S+) slips a mystery card under (\S+)'s blanket \[(.+?)\](.*)", ln)
        if m and m.group(1) != "Me":
            ln = f"  {m.group(1)} slips a mystery card under {m.group(2)}'s blanket{m.group(4)}"
        seen.append(ln)
    print("\n".join(seen[-int(sys.argv[3]) if len(sys.argv) > 3 else -40:]))
    if over:
        return
    print("\n--- MY TURN (drew 2) ---")
    print("hand:", ", ".join(g.hands[0]))
    for i, n in enumerate(names):
        mine = [t for t, st in g.blanket[i] if st == 0]
        print(f"  {n}: banked {g.score[i]}, basket {g.basket[i]} ({bval(g.basket[i])}), "
              f"blanket {len(g.blanket[i])} mystery" + (f" (mine: {mine})" if mine else "") + f", hand {len(g.hands[i])}")
    print(f"draw pile {len(g.draw)}")


main()
