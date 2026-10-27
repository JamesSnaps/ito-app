"""Fugitive, the whole game: three decks, a trail of hideouts, and guesses.

One player is the Fugitive, laying numbered cards face down from 0 towards
42; the other is the Marshal, guessing numbers to turn them over. Unlike
Flip 7 this is a game of hidden information: the Fugitive's hand and every
face-down hideout are secrets from the Marshal, and the Marshal's hand is a
secret from the Fugitive. So there's no one public view — `view(state,
viewer)` is what each seat, or the table, may see, and the server only ever
sends that.

Checked against the 2nd-edition rulebook. Two things it doesn't give, and
how they're read here:

- Which cards sprint for two. It only says each card is +1 or +2;
  TWO_FOOTPRINTS is our own spread until it's read off the real cards.
- 1st-edition Events and 2nd-edition SHIFT cards aren't in yet. The base
  game below is the same in both editions.

The state is one plain, JSON-safe dict, as in Flip 7. Nothing in here knows
about Flask, rooms or tokens.
"""

START_CARD = 0
ESCAPE_CARD = 42
# Inclusive ranges, drawn from the end of each list.
DECKS = ((4, 14), (15, 28), (29, 41))
STARTING_CARDS = (1, 2, 3, 42)
STARTING_DRAWS = (3, 2, 0)
MAX_STEP = 3
FIRST_TURN_HIDEOUTS = 2
MARSHAL_FIRST_DRAWS = 2
# A Manhunt is only on while no hideout above this has been revealed.
MANHUNT_MAX_REVEALED = 29
# Placeholder until read off the cards; everything else sprints for one.
# 42 sprints for nothing — spending it would be giving up the escape.
TWO_FOOTPRINTS = frozenset({6, 10, 13, 17, 20, 23, 27, 30, 33, 37, 40})
ROLES = ("fugitive", "marshal")
VIEWERS = ROLES + ("table",)


class IllegalMove(ValueError):
    """A move the rules don't allow right now. The message is player-facing."""


def footprints(card):
    if card == ESCAPE_CARD:
        return 0
    return 2 if card in TWO_FOOTPRINTS else 1


MAX_FOOTPRINTS = 2


def new_game(rng, decks=None):
    """A fresh game, ready for the Fugitive's first turn.

    `decks` is for tests: the three decks as they'll be drawn, top card
    last. Otherwise each is shuffled with `rng`. The Fugitive's starting
    draws come off them either way.
    """
    if decks is None:
        decks = []
        for lo, hi in DECKS:
            cards = list(range(lo, hi + 1))
            rng.shuffle(cards)
            decks.append(cards)
    decks = [list(d) for d in decks]
    hand = list(STARTING_CARDS)
    for deck, count in zip(decks, STARTING_DRAWS):
        for _ in range(count):
            hand.append(deck.pop())
    return {
        "decks": decks,
        "hands": {"fugitive": sorted(hand), "marshal": []},
        "hideouts": [{"card": START_CARD, "sprints": [], "revealed": True}],
        # fugitive_draw → fugitive_hide → marshal_draw → marshal_guess → …,
        # with manhunt and game_over off the end.
        "phase": "fugitive_hide",
        "hides_left": FIRST_TURN_HIDEOUTS,
        "placed": 0,
        "first_turn": True,
        "draws_left": 0,
        "marshal_has_played": False,
        "winner": None,
        "reason": None,       # caught | escaped | manhunt_failed | let_go | resigned
        "log": [],
        "event": 0,
        "seq": 0,
        "recorded": False,
    }


def turn(state):
    """Whose move it is, or None once it's over."""
    return {
        "fugitive_draw": "fugitive",
        "fugitive_hide": "fugitive",
        "marshal_draw": "marshal",
        "marshal_guess": "marshal",
        "manhunt": "marshal",
    }.get(state["phase"])


def apply(state, role, move):
    """Play one move for `role`, in place. Raises IllegalMove before
    changing anything.

    Moves: {"type": "draw", "deck"}, {"type": "hide", "card", "sprints"},
    {"type": "pass"} (the Fugitive places nothing, or stops after one of
    their two opening hideouts), {"type": "guess", "numbers"},
    {"type": "let_go"} (the Marshal declines a Manhunt) and
    {"type": "resign"}, which either player may make at any time.
    """
    if role not in ROLES:
        raise IllegalMove("No such player.")
    if state["phase"] == "game_over":
        raise IllegalMove("The game is over.")
    kind = move.get("type")

    if kind == "resign":
        _end(state, _other(role), "resigned")
    elif turn(state) != role:
        raise IllegalMove("It isn't your turn.")
    elif state["phase"] in ("fugitive_draw", "marshal_draw"):
        _draw_move(state, role, move)
    elif state["phase"] == "fugitive_hide":
        _hide_move(state, move)
    elif state["phase"] == "marshal_guess":
        _guess_move(state, move)
    else:
        _manhunt_move(state, move)

    state["seq"] += 1
    return state


def hide_error(state, card, sprints):
    """Why the Fugitive can't hide at `card` with `sprints` under it, or None."""
    hand = state["hands"]["fugitive"]
    if not _is_int(card) or not isinstance(sprints, list) or not all(_is_int(c) for c in sprints):
        return "Pick a card to hide, and the cards to sprint with."
    if card not in hand:
        return f"You don't hold {card}."
    if len(set(sprints)) != len(sprints):
        return "A card can only be used once."
    for c in sprints:
        if c == card:
            return "A card can't be the hideout and a sprint."
        if c not in hand:
            return f"You don't hold {c}."
        if footprints(c) == 0:
            return f"{c} can't be used to sprint."
    last = _last(state)
    if card <= last:
        return f"Hideouts have to go up — your last was {last}."
    reach = MAX_STEP + sum(footprints(c) for c in sprints)
    if card - last > reach:
        return f"{card} is {card - last} past {last}; that only reaches {last + reach}."
    return None


def view(state, viewer):
    """What `viewer` — "fugitive", "marshal" or "table" — may see.

    The Fugitive sees their whole trail. Everyone else sees a face-down
    hideout as a card of None, with how many sprint cards are under it
    (that's visible across a real table) but not which. 42 goes down face
    up, but what it sprinted with stays hidden. Each player's hand is theirs
    alone, as is which card they drew — the deck it came from is public.
    Once the game is over, everything is turned up.
    """
    if viewer not in VIEWERS:
        raise ValueError(viewer)
    over = state["phase"] == "game_over"
    fugitive = viewer == "fugitive"

    hideouts = []
    for h in state["hideouts"]:
        shown = fugitive or over or h["revealed"]
        sprints_shown = fugitive or over or (h["revealed"] and h["card"] != ESCAPE_CARD)
        hideouts.append({
            "card": h["card"] if shown else None,
            "sprint_count": len(h["sprints"]),
            "sprints": list(h["sprints"]) if sprints_shown else None,
            "revealed": h["revealed"],
        })

    log = []
    for entry in state["log"]:
        entry = dict(entry)
        if entry["kind"] == "drew" and not (over or entry["role"] == viewer):
            entry["card"] = None
        elif entry["kind"] == "hid":
            entry["card"] = hideouts[entry["index"]]["card"]
            entry["sprints"] = hideouts[entry["index"]]["sprints"]
        log.append(entry)

    return {
        "viewer": viewer,
        "phase": state["phase"],
        "turn": turn(state),
        "hides_left": state["hides_left"],
        "first_turn": state["first_turn"],
        "draws_left": state["draws_left"],
        "hideouts": hideouts,
        "deck_counts": [len(d) for d in state["decks"]],
        "decks": [list(r) for r in DECKS],
        "hand": list(state["hands"][viewer]) if viewer in ROLES else None,
        "hand_counts": {role: len(state["hands"][role]) for role in ROLES},
        "footprints": {str(c): footprints(c) for c in range(START_CARD, ESCAPE_CARD + 1)},
        "max_step": MAX_STEP,
        "winner": state["winner"],
        "reason": state["reason"],
        "log": log,
        "seq": state["seq"],
    }


def candidates(seen):
    """Every number each hideout could still be, from a view the Marshal (or
    the table) can see: revealed cards and their sprints, the Marshal's own
    hand, earlier wrong guesses, and how far apart hideouts can be given the
    cards tucked under them. Revealed hideouts come back as [card].

    It drives the Marshal's optional notepad assist. It must never rule out
    the truth; the random-game test checks that on every guess.
    """
    hideouts = seen["hideouts"]
    n = len(hideouts)

    excluded = set(seen["hand"] or []) if seen["viewer"] == "marshal" else set()
    for h in hideouts:
        if h["card"] is not None:
            excluded.add(h["card"])
        excluded.update(h["sprints"] or [])

    # A wrong single guess only clears the hideouts that existed when it was
    # made: the Fugitive is free to hide on that number afterwards.
    missed_before = {}
    placed = 1
    for entry in seen["log"]:
        if entry["kind"] == "hid":
            placed += 1
        elif entry["kind"] == "guessed" and not entry["hit"] and len(entry["numbers"]) == 1:
            missed_before[entry["numbers"][0]] = placed

    # How far past the one before each hideout can be: exact when its
    # sprints are known.
    stretch = [
        MAX_STEP + (sum(footprints(c) for c in h["sprints"]) if h["sprints"] is not None
                    else h["sprint_count"] * MAX_FOOTPRINTS)
        for h in hideouts
    ]
    lo = [h["card"] if h["card"] is not None else START_CARD + 1 for h in hideouts]
    hi = [h["card"] if h["card"] is not None else ESCAPE_CARD - 1 for h in hideouts]
    # Hideouts are all different, so one pinned to a single number rules
    # that number out for the rest.
    forced = {}
    sets = []

    changed = True
    while changed:
        changed = False

        def tighten(i, new_lo, new_hi):
            nonlocal changed
            if new_lo > lo[i]:
                lo[i], changed = new_lo, True
            if new_hi < hi[i]:
                hi[i], changed = new_hi, True

        for i in range(1, n):
            tighten(i, lo[i - 1] + 1, hi[i - 1] + stretch[i])
        for i in range(n - 2, -1, -1):
            tighten(i, lo[i + 1] - stretch[i + 1], hi[i + 1] - 1)

        sets = []
        for i, h in enumerate(hideouts):
            if h["card"] is not None:
                sets.append([h["card"]])
                continue
            sets.append([
                c for c in range(lo[i], hi[i] + 1)
                if c not in excluded and i >= missed_before.get(c, 0) and forced.get(c, i) == i
            ])
        for i, options in enumerate(sets):
            if hideouts[i]["card"] is not None or not options:
                continue
            tighten(i, options[0], options[-1])
            if len(options) == 1 and options[0] not in forced:
                forced[options[0]] = i
                changed = True
    return sets


# --- internals -----------------------------------------------------------

def _draw_move(state, role, move):
    if move.get("type") != "draw":
        raise IllegalMove("Draw a card first.")
    deck = move.get("deck")
    if not _is_int(deck) or not 0 <= deck < len(state["decks"]):
        raise IllegalMove("No such deck.")
    if not state["decks"][deck]:
        raise IllegalMove("That deck is empty.")
    _draw(state, role, deck)

    if role == "fugitive":
        _fugitive_hides(state, first_turn=False)
    else:
        state["draws_left"] -= 1
        if state["draws_left"] == 0 or _decks_empty(state):
            state["phase"] = "marshal_guess"


def _hide_move(state, move):
    kind = move.get("type")
    if kind == "pass":
        if state["first_turn"] and state["placed"] == 0:
            raise IllegalMove("Place at least one hideout on your first turn.")
        if state["placed"] == 0:
            _log(state, "passed")
            # Not hiding buys a card from the lowest deck that has any.
            lowest = next((i for i, d in enumerate(state["decks"]) if d), None)
            if lowest is not None:
                _draw(state, "fugitive", lowest)
        _marshals_turn(state)
        return
    if kind != "hide":
        raise IllegalMove("Hide somewhere, or draw instead.")

    card, sprints = move.get("card"), move.get("sprints", [])
    error = hide_error(state, card, sprints)
    if error:
        raise IllegalMove(error)
    used = {card, *sprints}
    state["hands"]["fugitive"] = [c for c in state["hands"]["fugitive"] if c not in used]
    escaped = card == ESCAPE_CARD
    state["hideouts"].append({"card": card, "sprints": sorted(sprints), "revealed": escaped})
    _log(state, "hid", index=len(state["hideouts"]) - 1, card=card, sprints=sorted(sprints))

    if escaped:
        _escape(state)
        return
    state["hides_left"] -= 1
    state["placed"] += 1
    if state["hides_left"] == 0:
        _marshals_turn(state)


def _guess_move(state, move):
    if move.get("type") != "guess":
        raise IllegalMove("Guess where the Fugitive is.")
    numbers = _check_guess(state, move.get("numbers"))
    _resolve_guess(state, numbers)
    if state["phase"] == "game_over":
        return
    state["marshal_has_played"] = True
    _fugitive_hides(state, first_turn=False, draw_first=True)


def _manhunt_move(state, move):
    kind = move.get("type")
    if kind == "let_go":
        _end(state, "fugitive", "let_go")
        return
    if kind != "guess":
        raise IllegalMove("Guess a hideout, or let the Fugitive go.")
    numbers = _check_guess(state, move.get("numbers"))
    if len(numbers) != 1:
        raise IllegalMove("In a Manhunt, guess one hideout at a time.")
    if not _resolve_guess(state, numbers):
        _end(state, "fugitive", "manhunt_failed")


def _check_guess(state, numbers):
    if not isinstance(numbers, list) or not numbers:
        raise IllegalMove("Guess at least one number.")
    if not all(_is_int(n) for n in numbers):
        raise IllegalMove("Guesses are whole numbers.")
    if len(set(numbers)) != len(numbers):
        raise IllegalMove("Each number can only be guessed once.")
    revealed = {h["card"] for h in state["hideouts"] if h["revealed"]}
    for n in numbers:
        if not START_CARD < n < ESCAPE_CARD:
            raise IllegalMove(f"{n} isn't a hideout number — guess 1 to 41.")
        if n in revealed:
            raise IllegalMove(f"{n} is already turned over.")
    return numbers


def _resolve_guess(state, numbers):
    """Several numbers at once reveal nothing unless every one is right."""
    hidden = {h["card"]: i for i, h in enumerate(state["hideouts"]) if not h["revealed"]}
    hit = all(n in hidden for n in numbers)
    revealed = sorted(hidden[n] for n in numbers) if hit else []
    for i in revealed:
        state["hideouts"][i]["revealed"] = True
    _log(state, "guessed", numbers=list(numbers), hit=hit, revealed=revealed)
    if hit and all(h["revealed"] for h in state["hideouts"]):
        _end(state, "marshal", "caught")
    return hit


def _escape(state):
    highest = max(h["card"] for h in state["hideouts"] if h["revealed"] and h["card"] != ESCAPE_CARD)
    if highest <= MANHUNT_MAX_REVEALED and any(not h["revealed"] for h in state["hideouts"]):
        state["phase"] = "manhunt"
        _log(state, "manhunt")
    else:
        _end(state, "fugitive", "escaped")


def _fugitive_hides(state, first_turn, draw_first=False):
    state["first_turn"] = first_turn
    state["hides_left"] = 1
    state["placed"] = 0
    state["phase"] = "fugitive_draw" if draw_first and not _decks_empty(state) else "fugitive_hide"


def _marshals_turn(state):
    state["hides_left"] = 0
    state["first_turn"] = False
    if _decks_empty(state):
        state["phase"] = "marshal_guess"
    else:
        state["phase"] = "marshal_draw"
        state["draws_left"] = 1 if state["marshal_has_played"] else MARSHAL_FIRST_DRAWS


def _draw(state, role, deck):
    card = state["decks"][deck].pop()
    state["hands"][role] = sorted(state["hands"][role] + [card])
    _log(state, "drew", role=role, deck=deck, card=card)


def _end(state, winner, reason):
    state["phase"] = "game_over"
    state["winner"] = winner
    state["reason"] = reason
    state["hides_left"] = state["draws_left"] = 0
    _log(state, "game_over", winner=winner, reason=reason)


def _log(state, kind, **fields):
    # Kept whole, unlike Flip 7's: the trail's history is what the Marshal
    # deduces from, and a game is only forty-odd turns.
    state["event"] += 1
    state["log"].append({"id": state["event"], "kind": kind, **fields})


def _last(state):
    return state["hideouts"][-1]["card"]


def _decks_empty(state):
    return not any(state["decks"])


def _other(role):
    return "marshal" if role == "fugitive" else "fugitive"


def _is_int(value):
    # bool is an int in Python, and True would quietly mean 1.
    return isinstance(value, int) and not isinstance(value, bool)
