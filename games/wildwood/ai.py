"""The computer at a Wildwood table: one move at a time, from one seat's view.

`choose(seen, level, rng)` is the whole interface, as in Fugitive's ai.py.
`seen` is `engine.view(state, seat)` — exactly what that seat's phone is
sent — so the computer knows its own hand and how many cards everyone else
holds, and nothing more. game.py plays what comes back through the same
`engine.apply` a person's move goes through.

Two levels:

- **easy** — plays the first card in its hand that fits, picks a colour at
  random, and forgets to say "Last card!" half the time (so a child gets to
  catch it). It catches a forgotten call one time in three.
- **hard** — holds its wilds back until nothing else fits, aims Draw twos
  and Skips at a next player who's close to going out, otherwise plays the
  colour it holds most of, picks that colour for a wild, always calls, and
  always catches.

Both stack a Draw two when they can, play a drawn card that fits, and never
leave a table waiting. Randomness is `core.seeded.Mulberry32`, integer picks
only, so the app's Swift port chooses identically from the same seed.
"""

from core.seeded import Mulberry32, move_rng  # noqa: F401 — re-exported for game.py and tests
from games.wildwood import engine

LEVELS = ("easy", "hard")
DEFAULT_LEVEL = "easy"
# Out of these, how often easy forgets to call, and how often it catches.
EASY_FORGETS_IN_2 = 1
EASY_CATCHES_IN_3 = 1
# A next player down to this many cards is worth hitting with an action.
CLOSE_TO_OUT = 2


def choose(seen, level, rng):
    """The move to make, for the seat `seen` belongs to, on that seat's turn."""
    seat = seen["viewer"]
    if seat == "table" or seen["turn"] != seat:
        raise ValueError("not this seat's turn")
    hard = level == "hard"

    exposed = seen["exposed"]
    if exposed is not None and exposed != seat and (hard or rng.below(3) < EASY_CATCHES_IN_3):
        return {"type": "catch"}
    if seen["stack"]:
        stackable = [c for c in seen["playable"] if engine.symbol_of(c) == "D"]
        if stackable:
            return _play(seen, stackable[0], hard, rng)
        return {"type": "take"}
    if seen["deciding"]:
        if seen["drawn"] in seen["playable"]:
            return _play(seen, seen["drawn"], hard, rng)
        return {"type": "pass"}
    if not seen["playable"]:
        return {"type": "draw"}
    card = _pick(seen, hard) if hard else seen["playable"][0]
    return _play(seen, card, hard, rng)


def _pick(seen, hard):
    """Hard's card: an action at a next player close to going out, else the
    colour it holds most of, wilds last."""
    options = seen["playable"]
    coloured = [c for c in options if c not in engine.WILDS]
    if not coloured:
        # Only wilds fit: the plain one first, the Bear kept for when it's needed.
        return "W" if "W" in options else options[0]
    nxt = (seen["viewer"] + seen["direction"]) % seen["players"]
    if seen["hand_counts"][nxt] <= CLOSE_TO_OUT:
        for symbol in ("D", "S"):
            for card in coloured:
                if engine.symbol_of(card) == symbol:
                    return card
        if "W4" in options:
            return "W4"
    counts = _colour_counts(seen["hand"])
    # Most-held colour first; within it, numbers before actions (hand order).
    return max(coloured, key=lambda c: (counts[engine.colour_of(c)], -coloured.index(c)))


def _play(seen, card, hard, rng):
    move = {"type": "play", "card": card}
    if card in engine.WILDS:
        move["colour"] = _colour(seen, hard, rng)
    if len(seen["hand"]) == 2:
        move["call"] = hard or rng.below(2) >= EASY_FORGETS_IN_2
    return move


def _colour(seen, hard, rng):
    if not hard:
        return rng.pick(engine.COLOURS)
    counts = _colour_counts(seen["hand"])
    # Ties go to the earlier colour, so the choice never depends on dict order.
    return max(engine.COLOURS, key=lambda c: (counts[c], -engine.COLOURS.index(c)))


def _colour_counts(hand):
    counts = {c: 0 for c in engine.COLOURS}
    for card in hand:
        colour = engine.colour_of(card)
        if colour:
            counts[colour] += 1
    return counts


def fallback(seen):
    """A move that's always legal on this seat's turn, for game.py to fall
    back on if a choice is ever refused (a bug), so the table never sticks."""
    if seen["stack"]:
        return {"type": "take"}
    if seen["deciding"]:
        return {"type": "pass"}
    return {"type": "draw"}
