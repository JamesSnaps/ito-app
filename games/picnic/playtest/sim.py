"""Picnic Raid playtest harness: the draft rules, narrated, with personalities.

Rule variants are switches on `Rules`, so a fix can be played against the
draft with the same personalities and seeds.
"""
import random
from dataclasses import dataclass, field

FOODS = "sbclh"
FOOD_NAME = {"s": "sandwich", "b": "strawberries", "c": "cupcake", "l": "lemonade", "h": "cheese"}
NICE = {"ants": "Ants", "wasp": "Wasp", "gull": "Seagull", "dog": "Dog",
        "umbrella": "Umbrella", "shoo": "Shoo!", "pine": "Pinecone"}


@dataclass
class Rules:
    hand: int = 5
    draw: int = 2
    lay: int = 2
    limit: int = 6
    target: int = 20
    spread: dict = field(default_factory=lambda: {1: 4, 2: 3, 3: 2})
    traps: dict = field(default_factory=lambda: {"ants": 6, "wasp": 5, "gull": 4, "dog": 2})
    defences: dict = field(default_factory=lambda: {"umbrella": 3, "shoo": 2})
    # variants
    gull_basket: bool = False     # Seagull snatches your biggest snack into the trapper's basket
    feast: int = 0                # bonus for packing three of one kind
    trap_cap: int = 0             # most mystery cards one blanket may hold (0 = no cap)
    shoo_back: bool = False       # the setter may Shoo! it straight back
    shake_peek: bool = False      # shaking: look at them all, throw one away, then lay one food
    decoys: int = 0               # harmless Pinecones that sit on blankets like traps
    trap_draws: bool = False      # setting a trap also lays one food (traps aren't a lost turn)
    trap_free: bool = False       # set one trap AND take your turn's action
    one_each: bool = False        # at most one of YOUR traps under any one blanket
    no_shake: bool = False        # shaking the blanket isn't a move
    basket_max: int = 0           # most snacks (cards) a basket holds (0 = no limit)
    later_extra: int = 0          # extra starting cards for every seat after the first
    settle_in: bool = False       # nobody sets a trap in the first round
    loot_overflows: bool = False  # Ants' and Seagull's loot fits whatever the basket limit
    reveal_setter: bool = True    # (always True: shown when it springs)
    end_round: bool = True


def is_food(c):
    return len(c) == 2 and c[0] in FOODS


def val(c):
    return int(c[1]) if is_food(c) else 0


def deck_for(r):
    d = []
    for k in FOODS:
        for v, n in r.spread.items():
            d += [f"{k}{v}"] * n
    for t, n in {**r.traps, **r.defences}.items():
        d += [t] * n
    d += ["pine"] * r.decoys
    return d


def nice(c):
    return f"{c[1]} {FOOD_NAME[c[0]]}" if is_food(c) else NICE[c]


def bval(b):
    return sum(map(val, b))


class Game:
    def __init__(self, rules, players, names, seed, log=True):
        self.r = rules
        self.rng = random.Random(seed)
        self.n = len(players)
        self.p = players
        self.names = names
        self.draw = deck_for(rules)
        self.rng.shuffle(self.draw)
        self.disc = []
        self.hands = [[self.draw.pop() for _ in range(rules.hand + (rules.later_extra if i else 0))] for i in range(self.n)]
        self.basket = [[] for _ in range(self.n)]
        self.blanket = [[] for _ in range(self.n)]  # [card, setter]
        self.score = [0] * self.n
        self.packs = [0] * self.n
        self.lines = [] if log else None
        self.round = 0
        self.m = dict(turns=0, actions={}, springs=0, landed=0, umbrella=0, shoo=0, shoo_back=0,
                      by_trap={}, swing=[], big=[], dead=0, max_blanket=0, shakes=0,
                      lead_changes=0, leader_seq=[], pack_traps=[], feasts=0, zero_packs=0,
                      trap_points=[], pine=0)

    def say(self, s):
        if self.lines is not None:
            self.lines.append(s)

    def take(self):
        if not self.draw:
            if not self.disc:
                return None
            self.draw, self.disc = self.disc, []
            self.rng.shuffle(self.draw)
        return self.draw.pop()

    # --- public info helpers for players ---
    def total(self, s):
        return self.score[s] + bval(self.basket[s])

    def leader(self):
        return max(range(self.n), key=lambda s: self.score[s])

    # --- traps ---
    def spring(self, trap, victim, trapper):
        """Apply `trap` to `victim`, the trapper gaining. Returns points swung."""
        b = self.basket[victim]
        b.sort(key=val)
        lost = 0
        if trap == "ants":
            moved = b[:2]
            del b[:2]
            if self.r.basket_max and not self.r.loot_overflows:
                room = max(0, self.r.basket_max - len(self.basket[trapper]))
                self.disc += moved[room:]
                moved = moved[:room]
            self.basket[trapper] += moved
            lost = bval(moved)
            if moved:
                self.say(f"      ants carry {', '.join(map(nice, moved))} to {self.names[trapper]}'s basket")
            else:
                self.say("      ants find nothing")
        elif trap == "wasp":
            if b:
                c = b.pop()
                self.disc.append(c)
                lost = val(c)
                self.say(f"      wasp chases off {nice(c)}")
            else:
                self.say("      wasp finds nothing")
        elif trap == "dog":
            k = len(b) // 2
            eaten = [b.pop() for _ in range(k)]
            self.disc += eaten
            lost = bval(eaten)
            self.say(f"      dog gobbles {', '.join(map(nice, eaten)) or 'nothing'}")
        elif trap == "gull":
            if self.r.gull_basket:
                if b:
                    c = b.pop()
                    if self.r.basket_max and not self.r.loot_overflows and len(self.basket[trapper]) >= self.r.basket_max:
                        self.disc.append(c)
                    else:
                        self.basket[trapper].append(c)
                    lost = val(c)
                    self.say(f"      seagull snatches {nice(c)} into {self.names[trapper]}'s basket")
                else:
                    self.say("      seagull finds nothing")
            else:
                h = self.hands[victim]
                if h:
                    c = h.pop(self.rng.randrange(len(h)))
                    self.hands[trapper].append(c)
                    lost = val(c)
                    self.say(f"      seagull pinches a card from the hand ({nice(c)}) for {self.names[trapper]}")
        elif trap == "pine":
            self.say("      just a pinecone!")
        return lost

    def resolve(self, trap, victim, setter):
        """A trap springs on victim during their pack-up."""
        m = self.m
        m["springs"] += 1
        m["by_trap"].setdefault(trap, [0, 0, 0])  # landed, stopped, points
        self.say(f"    springs: {NICE[trap]} (set by {self.names[setter]})")
        if trap == "pine":
            m["pine"] += 1
            self.spring(trap, victim, setter)
            self.disc.append(trap)
            return
        d = self.p[victim].defend(self, victim, trap, setter)
        if d:
            self.hands[victim].remove(d)
            self.disc.append(d)
        if d == "umbrella":
            m["umbrella"] += 1
            m["by_trap"][trap][1] += 1
            self.say(f"    {self.names[victim]} opens an Umbrella")
        elif d == "shoo":
            m["shoo"] += 1
            m["by_trap"][trap][1] += 1
            self.say(f"    {self.names[victim]} shouts Shoo! — back to {self.names[setter]}")
            if self.r.shoo_back and "shoo" in self.hands[setter] and self.p[setter].shoo_back(self, setter, trap, victim):
                self.hands[setter].remove("shoo")
                self.disc.append("shoo")
                m["shoo_back"] += 1
                self.say(f"    {self.names[setter]} shouts Shoo! right back!")
                pts = self.spring(trap, victim, setter)
                m["swing"].append(pts)
                if pts >= 4:
                    m["big"].append(f"shoo-back {trap} {pts}")
            else:
                pts = self.spring(trap, setter, victim)
                m["swing"].append(pts)
                if pts >= 3:
                    m["big"].append(f"shoo {trap} {pts}")
        else:
            m["landed"] += 1
            m["by_trap"][trap][0] += 1
            pts = self.spring(trap, victim, setter)
            m["by_trap"][trap][2] += pts
            m["trap_points"].append(pts)
            if pts >= 4:
                m["big"].append(f"{trap} {pts}")
        self.disc.append(trap)

    # --- a turn ---
    def turn(self, s):
        r, P = self.r, self.p[s]
        h = self.hands[s]
        for _ in range(r.draw):
            c = self.take()
            if c:
                h.append(c)
        if r.trap_free and not (r.settle_in and self.round == 1):
            ft = P.free_trap(self, s)
            if ft:
                c, tgt = ft
                h.remove(c)
                self.blanket[tgt].append([c, s])
                self.m['free_traps'] = self.m.get('free_traps', 0) + 1
                self.m['max_blanket'] = max(self.m['max_blanket'], len(self.blanket[tgt]))
                self.say(f"  {self.names[s]} slips a mystery card under {self.names[tgt]}'s blanket [{NICE[c]}] "
                         f"({len(self.blanket[tgt])} there, basket {bval(self.basket[tgt])})")
        act = P.act(self, s)
        kind = act[0]
        self.m["actions"][kind] = self.m["actions"].get(kind, 0) + 1
        self.m["turns"] += 1
        nm = self.names[s]
        if kind == "lay":
            for c in act[1]:
                h.remove(c)
                self.basket[s].append(c)
            self.say(f"  {nm} lays {', '.join(map(nice, act[1]))} (basket {bval(self.basket[s])})")
        elif kind == "trap":
            c, tgt = act[1], act[2]
            h.remove(c)
            self.blanket[tgt].append([c, s])
            self.m["max_blanket"] = max(self.m["max_blanket"], len(self.blanket[tgt]))
            self.say(f"  {nm} slips a mystery card under {self.names[tgt]}'s blanket [{NICE[c]}] "
                     f"({len(self.blanket[tgt])} there, basket {bval(self.basket[tgt])})")
            if r.trap_draws and len(act) > 3 and act[3]:
                h.remove(act[3])
                self.basket[s].append(act[3])
                self.say(f"    and lays {nice(act[3])} (basket {bval(self.basket[s])})")
        elif kind == "shake":
            idx = act[1]
            if r.shake_peek:
                self.say(f"  {nm} shakes the blanket and peeks: {', '.join(NICE[t] for t, _ in self.blanket[s])}")
            t, setter = self.blanket[s].pop(idx)
            self.disc.append(t)
            self.m["shakes"] += 1
            self.say(f"  {nm} shakes off a {NICE[t]} (set by {self.names[setter]})")
            if r.shake_peek and len(act) > 2 and act[2]:
                h.remove(act[2])
                self.basket[s].append(act[2])
                self.say(f"    and lays {nice(act[2])} (basket {bval(self.basket[s])})")
        elif kind == "pack":
            nt = len(self.blanket[s])
            self.m["pack_traps"].append(nt)
            self.say(f"  {nm} packs up a basket of {bval(self.basket[s])} with {nt} under the blanket")
            for t, setter in list(self.blanket[s]):
                self.resolve(t, s, setter)
            self.blanket[s] = []
            b = self.basket[s]
            v = bval(b)
            bonus = 0
            if r.feast:
                counts = {}
                for c in b:
                    counts[c[0]] = counts.get(c[0], 0) + 1
                feasts = sum(n // 3 for n in counts.values())
                bonus = feasts * r.feast
                if bonus:
                    self.m["feasts"] += feasts
                    self.say(f"    FEAST! +{bonus}")
            self.score[s] += v + bonus
            self.packs[s] += 1
            if v == 0:
                self.m["zero_packs"] += 1
            self.disc += b
            self.basket[s] = []
            self.say(f"    banks {v + bonus} → {self.score[s]}")
        else:
            self.m["dead"] += 1
            self.say(f"  {nm} does nothing (hand {len(h)})")
        while len(h) > r.limit:
            c = P.discard(self, s)
            h.remove(c)
            self.disc.append(c)

    def play(self):
        ending = False
        lead = None
        start_lead = None
        while True:
            self.round += 1
            if self.round > 60:
                return None
            self.say(f"Round {self.round}  " + "  ".join(f"{self.names[i]} {self.score[i]}" for i in range(self.n)))
            for s in range(self.n):
                self.turn(s)
                if self.score[s] >= self.r.target and not ending:
                    ending = True
                    start_lead = self.round
                    self.say(f"  ** {self.names[s]} reaches {self.score[s]} — finish the round **")
                top = max(self.score)
                ls = [i for i in range(self.n) if self.score[i] == top]
                if top > 0 and len(ls) == 1 and ls[0] != lead:
                    if lead is not None:
                        self.m["lead_changes"] += 1
                    lead = ls[0]
                self.m["leader_seq"].append(lead)
            if ending:
                break
        top = max(self.score)
        winners = [i for i in range(self.n) if self.score[i] == top]
        self.winners = winners
        self.say(f"END after {self.round} rounds: " + ", ".join(f"{self.names[i]} {self.score[i]}" for i in range(self.n))
                 + f" — {' & '.join(self.names[w] for w in winners)} win")
        return winners


# --- personalities -------------------------------------------------------------

class Base:
    name = "base"
    pack_at = 7
    trap_rate = 0.5
    shakes = False

    def __init__(self, rng):
        self.rng = rng

    free_min = 3  # smallest basket worth a free trap

    def foods(self, g, s):
        fs = [c for c in g.hands[s] if is_food(c)]
        if g.r.feast:
            have = {}
            for c in g.basket[s] + fs:
                have[c[0]] = have.get(c[0], 0) + 1
            return sorted(fs, key=lambda c: (have[c[0]] >= 2, val(c)), reverse=True)
        return sorted(fs, key=val, reverse=True)

    def free_trap(self, g, s):
        ts = self.traps(g, s)
        if not ts:
            return None
        tgt = self.pick_target(g, s, None)
        if tgt is None or bval(g.basket[tgt]) < self.free_min:
            return None
        return self.pick_trap(g, s, tgt), tgt

    def traps(self, g, s):
        return [c for c in g.hands[s] if c in g.r.traps or c == "pine"]

    def defs(self, g, s):
        return [c for c in g.hands[s] if c in g.r.defences]

    def targets(self, g, s):
        out = [t for t in range(g.n) if t != s]
        if g.r.trap_cap:
            out = [t for t in out if len(g.blanket[t]) < g.r.trap_cap]
        if g.r.one_each:
            out = [t for t in out if all(st != s for _, st in g.blanket[t])]
        return out

    def pick_target(self, g, s, trap):
        ts = self.targets(g, s)
        return max(ts, key=lambda t: (bval(g.basket[t]), self.rng.random())) if ts else None

    def pick_trap(self, g, s, tgt):
        ts = self.traps(g, s)
        b = bval(g.basket[tgt])
        order = ["dog", "ants", "wasp", "gull", "pine"] if b >= 6 else ["ants", "wasp", "gull", "dog", "pine"]
        return min(ts, key=lambda c: order.index(c))

    def want_pack(self, g, s):
        b = bval(g.basket[s])
        nt = len(g.blanket[s])
        if g.score[s] + b >= g.r.target and b:
            return True
        # finishing round: last chance
        return b >= self.pack_at + (1 if nt and not self.defs(g, s) else 0) * nt

    def act(self, g, s):
        food = self.foods(g, s)
        traps = self.traps(g, s)
        b = bval(g.basket[s])
        nt = len(g.blanket[s])
        if self.shakes and not g.r.no_shake and nt >= (1 if g.r.shake_peek else 2) and b >= 4 and len(self.defs(g, s)) < nt:
            return self.shake(g, s)
        if self.want_pack(g, s):
            return ("pack",)
        if traps and self.targets(g, s) and not g.r.trap_free:
            tgt = self.pick_target(g, s, None)
            if tgt is not None and (not food or (bval(g.basket[tgt]) >= 3 and self.rng.random() < self.trap_rate)):
                c = self.pick_trap(g, s, tgt)
                extra = food[0] if g.r.trap_draws and food else None
                return ("trap", c, tgt, extra)
        room = g.r.lay if not g.r.basket_max else min(g.r.lay, g.r.basket_max - len(g.basket[s]))
        if food and room > 0:
            return ("lay", food[:room])
        if b or nt:
            return ("pack",)
        return ("nothing",)

    def shake(self, g, s):
        idx = 0
        extra = None
        if g.r.shake_peek:
            order = ["dog", "ants", "wasp", "gull", "pine"]
            idx = min(range(len(g.blanket[s])), key=lambda i: order.index(g.blanket[s][i][0]))
            f = self.foods(g, s)
            extra = f[0] if f else None
        else:
            idx = self.rng.randrange(len(g.blanket[s]))
        return ("shake", idx, extra)

    def defend(self, g, s, trap, setter):
        d = self.defs(g, s)
        if not d:
            return None
        b = bval(g.basket[s])
        worth = trap == "gull" and not g.r.gull_basket or b >= 3
        if not worth:
            return None
        if "shoo" in d and trap in ("ants", "dog", "gull") and bval(g.basket[setter]) >= 2:
            return "shoo"
        return "umbrella" if "umbrella" in d else "shoo"

    def shoo_back(self, g, s, trap, victim):
        return bval(g.basket[s]) >= 3

    def discard(self, g, s):
        h = g.hands[s]
        keep_order = lambda c: (c in g.r.defences, c in g.r.traps, val(c))
        return min(h, key=keep_order)


class Kid(Base):
    """Eager: lays food, traps whoever has the most, always defends, never shakes."""
    name = "kid"
    free_min = 0
    trap_rate = 0.5

    def want_pack(self, g, s):
        b = bval(g.basket[s])
        if g.score[s] + b >= g.r.target and b:
            return True
        return b >= self.rng.choice([5, 6, 7, 8])

    def pick_trap(self, g, s, tgt):
        return self.rng.choice(self.traps(g, s))

    def defend(self, g, s, trap, setter):
        d = self.defs(g, s)
        if not d:
            return None
        return "shoo" if "shoo" in d else "umbrella"


class Careful(Base):
    """Packs early, shakes off traps when exposed, targets the leader."""
    name = "careful"
    pack_at = 6
    shakes = True
    trap_rate = 0.5

    def pick_target(self, g, s, trap):
        ts = self.targets(g, s)
        return max(ts, key=lambda t: (g.total(t), self.rng.random())) if ts else None


class Greedy(Base):
    """Builds big baskets, defends everything."""
    name = "greedy"
    pack_at = 10
    free_min = 5
    trap_rate = 0.3

    def want_pack(self, g, s):
        b = bval(g.basket[s])
        nt = len(g.blanket[s])
        if g.score[s] + b >= g.r.target and b:
            return True
        return b >= (10 if nt == 0 else 7 if len(self.defs(g, s)) >= nt else 6)


class Sneaky(Base):
    """Traps first, saves Shoo! for juicy setters, Umbrella for big hits."""
    name = "sneaky"
    pack_at = 7
    free_min = 2
    trap_rate = 0.75
    shakes = True

    def pick_target(self, g, s, trap):
        ts = self.targets(g, s)
        return max(ts, key=lambda t: (bval(g.basket[t]) + 0.5 * g.score[t], self.rng.random())) if ts else None

    def defend(self, g, s, trap, setter):
        d = self.defs(g, s)
        if not d:
            return None
        b = bval(g.basket[s])
        if "shoo" in d and trap in ("ants", "dog") and bval(g.basket[setter]) >= 3:
            return "shoo"
        if trap == "dog" and b >= 4 or trap == "wasp" and b >= 5 or trap == "ants" and b >= 4:
            return "umbrella" if "umbrella" in d else "shoo"
        return None


class Pacifist(Base):
    """Never sets a trap — only food and packing. The control."""
    name = "pacifist"

    def free_trap(self, g, s):
        return None

    def act(self, g, s):
        food = self.foods(g, s)
        if self.want_pack(g, s):
            return ("pack",)
        room = g.r.lay if not g.r.basket_max else min(g.r.lay, g.r.basket_max - len(g.basket[s]))
        if food and room > 0:
            return ("lay", food[:room])
        if g.basket[s] or g.blanket[s]:
            return ("pack",)
        return ("nothing",)

    def discard(self, g, s):
        h = g.hands[s]
        return min(h, key=lambda c: (c in g.r.defences, is_food(c), val(c)))


PERSONAS = {c.name: c for c in (Kid, Careful, Greedy, Sneaky, Pacifist)}
FAMILY = ["kid", "careful", "greedy", "sneaky"]
NAMES = ["Louis", "Mum", "Dad", "Ana"]


def table(rules, personas, seed, log=True):
    rng = random.Random(seed * 7919 + 1)
    ps = [PERSONAS[p](rng) for p in personas]
    names = [f"{NAMES[i]}({personas[i]})" for i in range(len(personas))]
    g = Game(rules, ps, names, seed, log)
    g.play()
    return g


class Hoarder(Base):
    """Exploits a full blanket: once nobody can add a trap, keeps piling food."""
    name = "hoarder"
    free_min = 3

    def full(self, g, s):
        opp = g.n - 1
        cap = min(g.r.trap_cap or 99, opp if g.r.one_each else 99)
        return len(g.blanket[s]) >= cap

    def want_pack(self, g, s):
        b = bval(g.basket[s])
        if g.score[s] + b >= g.r.target and b:
            return True
        if self.full(g, s):
            return b >= 16
        return b >= 7


PERSONAS["hoarder"] = Hoarder
