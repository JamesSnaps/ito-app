"""The computer opponent: one move at a time, from one seat's view.

`choose(seen, level, rng)` is the whole interface. `seen` is
`engine.view(state, role)` — exactly what that seat's phone would be sent,
the Marshal's with `candidates` worked out from it — so the computer knows
what a player in its chair would know and nothing more. It never touches the
game state; game.py hands it the view and plays what comes back through the
same `engine.apply` a person's move goes through.

Two levels:

- **easy** — the Fugitive hides on the lowest card it reaches with the
  fewest sprints and never bluffs; the Marshal draws from any deck and
  guesses one number at a time from anywhere the notepad leaves open.
- **hard** — the Fugitive picks among its reachable cards at random,
  sprints with cards it can't hide on any more first, and sometimes tucks a
  spare one under a hideout to widen what the Marshal has to cover; the
  Marshal draws where the hideouts could be, takes every hideout the
  notepad has pinned down in one guess, and otherwise guesses the hideout
  with fewest options left.

Both play 42 the moment it's in reach, and neither resigns.

Randomness comes from `Mulberry32`, not Python's `random`, so the iOS app's
Swift port (for offline play, a later step) can make exactly the same
choices from the same seed — the same deal as fugitive.js's mulberry32 and
the app's `Seeded`. Every draw from it is an integer pick, never a weighted
float sum, so nothing can round differently in Swift. Like engine.py,
nothing here knows about Flask or rooms.
"""

from core.seeded import Mulberry32, move_rng  # noqa: F401 — ai.Mulberry32 / ai.move_rng
from games.fugitive import engine

LEVELS = ("easy", "hard")
DEFAULT_LEVEL = "hard"
# Out of 3: how often the hard Fugitive tucks a spare dead card under a
# hideout it didn't need it for.
BLUFF_IN_3 = 1


def choose(seen, level, rng):
    """The move to make, for the seat `seen` belongs to, when it's that
    seat's turn."""
    role = seen["viewer"]
    if role not in engine.ROLES or seen["turn"] != role:
        raise ValueError("not this seat's turn")
    hard = level == "hard"
    phase = seen["phase"]
    if phase in ("fugitive_draw", "marshal_draw"):
        return {"type": "draw", "deck": _deck(seen, hard, rng)}
    if phase == "fugitive_hide":
        return _hide(seen, hard, rng)
    return _guess(seen, hard, rng)


# --- the Fugitive ----------------------------------------------------------

def _steps(seen, card):
    return seen["footprints"][str(card)]


def _last(seen):
    return seen["hideouts"][-1]["card"]


def _sprints_for(seen, card, hand):
    """The cheapest sprint cards that get from the last hideout to `card`,
    or None if the hand can't reach it. Cards below `card` go first — once
    it's down they can never be hideouts — lowest first; then the cards just
    above it."""
    needed = card - _last(seen) - seen["max_step"]
    if needed <= 0:
        return []
    spare = [c for c in hand if c != card and _steps(seen, c) > 0]
    order = [c for c in spare if c < card] + [c for c in spare if c > card]
    chosen = []
    for c in order:
        if needed <= 0:
            break
        chosen.append(c)
        needed -= _steps(seen, c)
    return sorted(chosen) if needed <= 0 else None


def _hide(seen, hard, rng):
    hand = seen["hand"]
    last = _last(seen)
    options = []
    for c in hand:
        if c <= last:
            continue
        sprints = _sprints_for(seen, c, hand)
        if sprints is not None:
            options.append((c, sprints))

    escape = [o for o in options if o[0] == engine.ESCAPE_CARD]
    if escape:
        card, sprints = escape[0]
        return {"type": "hide", "card": card, "sprints": sprints}
    options = [o for o in options if o[0] != engine.ESCAPE_CARD]

    # The first turn's second hideout is optional: taken only when it costs
    # no sprint. Later, lying low (and drawing) is for when nothing reaches.
    second = seen["first_turn"] and seen["hides_left"] == 1
    if second:
        options = [o for o in options if not o[1]]
    if not options:
        return {"type": "pass"}

    if not hard:
        card, sprints = min(options, key=lambda o: (len(o[1]), o[0]))
        return {"type": "hide", "card": card, "sprints": sprints}

    # Hard: cheapest first — no sprints, then only dead cards as sprints,
    # then cards that could have been hideouts — and at random within that.
    def cost(option):
        card, sprints = option
        if not sprints:
            return 0
        return 1 if all(c < card for c in sprints) else 2

    best = min(cost(o) for o in options)
    card, sprints = rng.pick([o for o in options if cost(o) == best])
    dead = [c for c in hand if c < card and c not in sprints and _steps(seen, c) > 0]
    # A bluff: one more face-down card under the hideout widens the
    # Marshal's range by two, and a card below it is no use as a hideout.
    # Keep one back for a sprint later.
    if len(dead) >= 2 and rng.below(3) < BLUFF_IN_3:
        sprints = sorted(sprints + [rng.pick(dead)])
    return {"type": "hide", "card": card, "sprints": sprints}


def _deck(seen, hard, rng):
    counts = seen["deck_counts"]
    live = [i for i, n in enumerate(counts) if n]
    if seen["viewer"] == "fugitive":
        if not hard:
            return rng.pick(live)
        # The deck the trail is heading into: cards a step or two past the
        # last hideout are the ones worth holding.
        ahead = _last(seen) + seen["max_step"]
        for i, (lo, hi) in enumerate(seen["decks"]):
            if counts[i] and hi >= ahead:
                return i
        return live[-1]
    if not hard:
        return rng.pick(live)
    # The Marshal: the deck with the most numbers a hideout could be on,
    # since every one drawn is one the Fugitive can't be hiding at.
    open_numbers = _open_numbers(seen)
    scores = [sum(1 for n in open_numbers if lo <= n <= hi) if counts[i] else -1
              for i, (lo, hi) in enumerate(seen["decks"])]
    top = max(scores)
    if top <= 0:
        # Nothing face down yet in any deck's range: the trail's next
        # stretch is the best bet.
        ahead = max(h["card"] for h in seen["hideouts"] if h["card"] is not None) + seen["max_step"]
        for i, (lo, hi) in enumerate(seen["decks"]):
            if counts[i] and hi >= ahead:
                return i
        return live[-1]
    return rng.pick([i for i, s in enumerate(scores) if s == top])


# --- the Marshal -----------------------------------------------------------

def _hidden(seen):
    """(index, options) for each hideout still face down."""
    sets = seen.get("candidates") or engine.candidates(seen)
    return [(i, s) for i, (h, s) in enumerate(zip(seen["hideouts"], sets)) if not h["revealed"]]


def _open_numbers(seen):
    return sorted({n for _, s in _hidden(seen) for n in s})


def _guess(seen, hard, rng):
    hidden = [(i, s) for i, s in _hidden(seen) if s]
    if not hidden:
        return {"type": "guess", "numbers": [_fallback(seen)]}
    manhunt = seen["phase"] == "manhunt"
    if not hard:
        return {"type": "guess", "numbers": [rng.pick(_open_numbers(seen))]}

    # Pinned down: every hideout the notepad leaves one number for. The
    # notepad never rules out the truth, so they're all right — one guess.
    sure = sorted({s[0] for _, s in hidden if len(s) == 1})
    if sure:
        return {"type": "guess", "numbers": sure if not manhunt else sure[:1]}
    fewest = min(len(s) for _, s in hidden)
    narrowest = [s for _, s in hidden if len(s) == fewest]
    # The earliest of them: it has fewer hideouts after it to have moved
    # its range.
    return {"type": "guess", "numbers": [rng.pick(narrowest[0])]}


def _fallback(seen):
    """Some legal number, should the notepad ever come back empty."""
    turned = {h["card"] for h in seen["hideouts"] if h["revealed"]}
    mine = set(seen["hand"] or [])
    numbers = [n for n in range(engine.START_CARD + 1, engine.ESCAPE_CARD) if n not in turned]
    return next((n for n in numbers if n not in mine), numbers[0])
