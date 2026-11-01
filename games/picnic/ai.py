"""The computer at a Picnic Raid: one move at a time, from one seat's view.

`choose(seen, level, rng)` is the whole interface, as in Wildwood's ai.py.
`seen` is `engine.view(state, seat)` — exactly what that seat's phone is
sent — so the computer knows its own hand, where its own traps are, and what
everyone can see on the table: baskets, scores, how many mystery cards are
under each blanket. Nothing more.

Two levels, the playtest's personalities:

- **easy** plays like a child: hides whatever trap it holds under the
  biggest basket, lays its best food, packs up somewhere between 5 and 8,
  and throws a Shoo! (or an Umbrella) at every trap that springs.
- **hard** hides the trap that hurts most under the basket that's closest to
  winning, banks any basket of 4 while its blanket is clear, otherwise packs
  at 7 — later if it holds a defence for every trap waiting —
  saves its Shoo! for a trap worth sending back, and only shoos one back
  when it would cost something to take.

Both pack whatever they have once someone has reached the target, since
the round is the last. Randomness is `core.seeded.Mulberry32`, integer
picks only, so a Swift port could choose identically from the same seed.
"""

from core.seeded import Mulberry32, move_rng  # noqa: F401 — re-exported for game.py and tests
from games.picnic import engine

LEVELS = ("easy", "hard")
DEFAULT_LEVEL = "easy"
EASY_PACK_AT = (5, 6, 7, 8)
HARD_PACK_AT = 7
# With a clear blanket, a basket this good is worth banking straight away.
CLEAN_PACK = 4
# Worst first, for a basket worth the Dog, and for one that isn't.
BIG_BASKET = 6
BIG_TRAPS = ("dog", "ants", "gull", "wasp")
SMALL_TRAPS = ("ants", "gull", "wasp", "dog")


def choose(seen, level, rng):
    """The move to make, for the seat `seen` belongs to, when it's theirs."""
    seat = seen["viewer"]
    if seat == "table" or seen["turn"] != seat:
        raise ValueError("not this seat's move")
    hard = level == "hard"
    if seen["stage"] == "spring":
        return {"type": "defend", "card": _defend(seen, hard)}
    if seen["stage"] == "discard":
        return {"type": "discard", "cards": _throw_away(seen["hand"], seen["must_discard"])}
    hide = _hide(seen, hard, rng)
    if hide:
        return hide
    return _act(seen, hard, rng)


def _hide(seen, hard, rng):
    traps = [c for c in seen["hand"] if engine.is_trap(c)]
    targets = seen["hide_targets"]
    if not traps or not targets:
        return None
    baskets = seen["baskets"]
    if hard:
        # The basket nearest to winning, counting what's banked.
        target = max(targets, key=lambda t: (2 * engine.basket_value(baskets[t]) + seen["scores"][t], -t))
        if engine.basket_value(baskets[target]) < 2:
            return None
        order = BIG_TRAPS if engine.basket_value(baskets[target]) >= BIG_BASKET else SMALL_TRAPS
        card = min(traps, key=order.index)
    else:
        target = max(targets, key=lambda t: (engine.basket_value(baskets[t]), -t))
        card = rng.pick(traps)
    return {"type": "hide", "card": card, "target": target}


def _act(seen, hard, rng):
    me = seen["viewer"]
    basket = seen["baskets"][me]
    points = engine.basket_value(basket)
    waiting = len(seen["blankets"][me])
    food = sorted((c for c in seen["hand"] if engine.is_food(c)),
                  key=lambda c: (-engine.value(c), engine.sort_key(c)))
    room = seen["basket_room"]
    if _want_pack(seen, points, waiting, room, hard, rng):
        return {"type": "pack"}
    if food and room > 0:
        return {"type": "lay", "cards": food[:min(engine.LAY, room)]}
    if basket or waiting:
        return {"type": "pack"}
    return {"type": "pass"}


def _want_pack(seen, points, waiting, room, hard, rng):
    me = seen["viewer"]
    if not points:
        return False
    if seen["scores"][me] + points >= seen["target"] or seen["ending"] is not None:
        return True
    if room == 0:
        return True
    if hard:
        # The playtest's one real skill: bank while nobody has hidden anything.
        if not waiting and points >= CLEAN_PACK:
            return True
        held = sum(1 for c in seen["hand"] if engine.is_defence(c))
        return points >= HARD_PACK_AT + max(0, waiting - held)
    return points >= rng.pick(EASY_PACK_AT)


def _defend(seen, hard):
    options = seen["defences"]
    if not options:
        return None
    sp = seen["springing"]
    me = seen["viewer"]
    if not hard:
        return "shoo" if "shoo" in options else options[0]
    cost = _cost(sp["card"], seen["baskets"][me])
    back = _cost(sp["card"], seen["baskets"][sp["from"]])
    if sp["sends"]:
        # Sent back at us: only Shoo! is allowed, and only worth it if this hurts.
        return "shoo" if cost >= 2 else None
    if "shoo" in options and (back >= 2 or cost >= 3):
        return "shoo"
    if "umbrella" in options and cost >= 3:
        return "umbrella"
    if "shoo" in options and cost >= 2:
        return "shoo"
    return None


def _cost(trap, basket):
    """How many points `trap` would take out of `basket`."""
    cards = engine.by_size(basket)
    if trap == "ants":
        return engine.basket_value(cards[:2])
    if trap in ("wasp", "gull"):
        return engine.basket_value(cards[-1:])
    return engine.basket_value(cards[len(cards) - len(cards) // 2:])


def _throw_away(hand, count):
    """The smallest snacks first; traps after; defences last of all."""
    order = sorted(hand, key=lambda c: (engine.is_defence(c), engine.is_trap(c), engine.value(c), engine.sort_key(c)))
    return order[:count]


def fallback(seen):
    """A move that's always legal for this seat now, for game.py to fall back
    on if a choice is ever refused (a bug), so the table never sticks."""
    if seen["stage"] == "spring":
        return {"type": "defend", "card": None}
    if seen["stage"] == "discard":
        return {"type": "discard", "cards": seen["hand"][:seen["must_discard"]]}
    return {"type": "pass"}
