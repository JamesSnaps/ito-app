"""Wildwood, the whole game: a Crazy Eights card game for two to four.

Match the card on the pile by colour or by symbol, or play a wild and pick
the colour; first to empty their hand wins. Our own game in the Crazy Eights
family — its own name, animals, deck spread and art — not a copy of any
published one. One round is one game: no points carried over.

The four colours are woodland animals, and so are the wilds:

    r Fox · g Frog · b Owl · y Duckling · W Badger (wild) · W4 Bear (wild +4)

Cards are strings: a colour and a symbol (`r7`, `gS` skip, `bR` reverse,
`yD` draw two), or `W` / `W4`. The deck is 1–9 twice in each colour, two of
each action per colour, and four of each wild: 104 cards.

The rules as played here, including the choices the family table made:

- Deal seven each, then turn up the top card. Action cards and wilds go back
  under the pile until a number turns up, so the first turn is always plain.
- On your turn, play a card that matches, or draw one. A drawn card you can
  play may go straight down; otherwise the turn passes.
- Skip misses the next player; Reverse turns the direction (between two
  players it's a Skip); Draw two makes the next player take two and miss
  their turn — unless they play a Draw two of their own, which passes the
  total on. Bear (+4) is the same for four cards, and can't be stacked; a
  Draw two can't go on a Bear.
- A Bear may only go down when you hold nothing of the colour in play. The
  engine enforces it rather than allowing a bluff and a challenge, which is
  too fiddly for a child.
- Down to one card, you say "Last card!" — with the play, or any time while
  you hold it. Forget, and until the next player's move lands anyone else
  can catch you, and you draw two.
- An empty draw pile is refilled from the discards under the top card,
  shuffled by a seed kept in the state (`core.seeded`), so a game replays
  exactly from its deck, seed and moves — which is how a game the app played
  offline is checked when it comes home.

Like Fugitive this is a game of secrets: each hand is its owner's alone, so
`view(state, viewer)` is what one seat, or the table, may see. The state is
one plain, JSON-safe dict; nothing here knows about Flask, rooms or tokens.
"""

from core.seeded import Mulberry32

COLOURS = ("r", "g", "b", "y")
ANIMALS = {"r": "Fox", "g": "Frog", "b": "Owl", "y": "Duckling", "W": "Badger", "W4": "Bear"}
COLOUR_NAMES = {"r": "red", "g": "green", "b": "blue", "y": "yellow"}
NUMBERS = tuple(str(n) for n in range(1, 10))
ACTIONS = ("S", "R", "D")
WILDS = ("W", "W4")
SYMBOLS = NUMBERS + ACTIONS
HAND_SIZE = 7
MIN_PLAYERS = 2
MAX_PLAYERS = 4
PENALTY = 2
# How much of the log a view carries: enough for any device to play out what
# it missed between polls, without sending a whole game every second.
LOG_SENT = 60
LOG_KEPT = 120


class IllegalMove(ValueError):
    """A move the rules don't allow right now. The message is player-facing."""


# --- cards -------------------------------------------------------------------

def full_deck():
    """All 104 cards in a fixed order: each colour's numbers and actions,
    then the wilds."""
    deck = []
    for colour in COLOURS:
        for symbol in SYMBOLS:
            deck += [colour + symbol] * 2
    for wild in WILDS:
        deck += [wild] * 4
    return deck


def is_card(card):
    return isinstance(card, str) and (card in WILDS or (len(card) == 2 and card[0] in COLOURS and card[1] in SYMBOLS))


def colour_of(card):
    """A card's colour, or None for a wild."""
    return None if card in WILDS else card[0]


def symbol_of(card):
    return card if card in WILDS else card[1]


def is_number(card):
    return card not in WILDS and card[1] in NUMBERS


def sort_key(card):
    """Hands are kept sorted: by colour, then numbers before actions, wilds
    last — the order a child would fan them in."""
    if card in WILDS:
        return (len(COLOURS), WILDS.index(card))
    return (COLOURS.index(card[0]), SYMBOLS.index(card[1]))


# --- a game ------------------------------------------------------------------

def new_game(rng, players, deck=None, shuffle_seed=None, first=0):
    """A fresh game for `players` seats, dealt and ready for seat `first`.

    `deck` is every card in the order it'll be drawn, top card last — given
    by tests and by an offline game coming home; otherwise the full deck is
    shuffled with `rng`. `shuffle_seed` is the secret behind every reshuffle
    of the discards, likewise drawn from `rng` unless given.
    """
    if not (isinstance(players, int) and MIN_PLAYERS <= players <= MAX_PLAYERS):
        raise ValueError("two to four players")
    if deck is None:
        deck = full_deck()
        rng.shuffle(deck)
    if shuffle_seed is None:
        shuffle_seed = rng.getrandbits(32)
    pile = list(deck)
    hands = [[] for _ in range(players)]
    for _ in range(HAND_SIZE):
        for hand in hands:
            hand.append(pile.pop())
    # Turn up a number to start on; anything else goes back under the pile.
    while not is_number(pile[-1]):
        pile.insert(0, pile.pop())
    top = pile.pop()
    state = {
        "players": players,
        "hands": [sorted(h, key=sort_key) for h in hands],
        "draw": pile,
        "discard": [top],
        "colour": colour_of(top),
        "turn": first % players,
        "direction": 1,
        # Cards the player to move must take, from Draw twos or a Bear.
        "stack": 0,
        # The card the player to move just drew and may still play.
        "drawn": None,
        # The seat that went down to one card without calling, while they
        # can still be caught.
        "exposed": None,
        "shuffle_seed": shuffle_seed,
        "reshuffles": 0,
        "phase": "play",
        "winner": None,
        "log": [],
        "event": 0,
        "seq": 0,
        "recorded": False,
    }
    _log(state, "deal", first=state["turn"], top=top)
    return state


def turn(state):
    """Whose move it is, or None once it's over."""
    return None if state["phase"] == "game_over" else state["turn"]


def can_play(state, seat, card):
    """Whether `seat` may put `card` down on the pile now (on their turn)."""
    top = state["discard"][-1]
    if state["drawn"] is not None and card != state["drawn"]:
        return False
    if state["stack"]:
        return symbol_of(card) == "D" and symbol_of(top) == "D"
    if card == "W":
        return True
    if card == "W4":
        return not any(colour_of(c) == state["colour"] for c in state["hands"][seat])
    return colour_of(card) == state["colour"] or (top not in WILDS and symbol_of(card) == symbol_of(top))


def playable(state, seat):
    """The distinct cards `seat` could play now, in hand order."""
    if turn(state) != seat:
        return []
    seen = []
    for card in state["hands"][seat]:
        if card not in seen and can_play(state, seat, card):
            seen.append(card)
    return seen


def next_seat(state, seat, steps=1):
    return (seat + state["direction"] * steps) % state["players"]


def apply(state, seat, move):
    """Play one move for `seat`, in place. Raises IllegalMove before changing
    anything.

    On your turn: {"type": "play", "card", "colour"?, "call"?} (colour for a
    wild; call to say "Last card!" as you go down to one), {"type": "draw"},
    {"type": "pass"} (keep the card you just drew), {"type": "take"} (take
    the Draw two or Bear cards waiting for you).

    At any time: {"type": "call"} (you hold one card and haven't said so)
    and {"type": "catch"} (someone else forgot to).
    """
    if not (_is_int(seat) and 0 <= seat < state["players"]):
        raise IllegalMove("No such player.")
    if state["phase"] == "game_over":
        raise IllegalMove("The game is over.")
    kind = move.get("type")

    if kind == "call":
        _call(state, seat)
    elif kind == "catch":
        _catch(state, seat)
    elif kind in ("play", "draw", "pass", "take"):
        if state["turn"] != seat:
            raise IllegalMove("It isn't your turn.")
        {"play": _play, "draw": _draw_move, "pass": _pass, "take": _take}[kind](state, seat, move)
    else:
        raise IllegalMove("That isn't a move.")

    state["seq"] += 1
    return state


def view(state, viewer):
    """What `viewer` — a seat number or "table" — may see.

    Your own hand, and the card you just drew; for everyone else only how
    many cards they hold. A draw in the log says how many cards, and which
    only to whoever drew them. Once the game is over every hand is shown.
    """
    if viewer != "table" and not (_is_int(viewer) and 0 <= viewer < state["players"]):
        raise ValueError(viewer)
    over = state["phase"] == "game_over"
    seat = None if viewer == "table" else viewer

    log = []
    for entry in state["log"][-LOG_SENT:]:
        entry = dict(entry)
        if entry["kind"] == "draw" and not (over or entry["seat"] == seat):
            entry["cards"] = None
        log.append(entry)

    return {
        "viewer": viewer,
        "phase": state["phase"],
        "turn": turn(state),
        "players": state["players"],
        "hand": list(state["hands"][seat]) if seat is not None else None,
        "hand_counts": [len(h) for h in state["hands"]],
        "hands": [list(h) for h in state["hands"]] if over else None,
        "top": state["discard"][-1],
        "colour": state["colour"],
        "direction": state["direction"],
        "stack": state["stack"],
        "draw_count": len(state["draw"]),
        "discard_count": len(state["discard"]),
        # Whether the player to move has drawn and is deciding; which card
        # only to them.
        "deciding": state["drawn"] is not None,
        "drawn": state["drawn"] if seat is not None and seat == state["turn"] else None,
        "exposed": state["exposed"],
        "playable": playable(state, seat) if seat is not None else [],
        "winner": state["winner"],
        "log": log,
        "seq": state["seq"],
    }


# --- moves -------------------------------------------------------------------

def _play(state, seat, move):
    card = move.get("card")
    hand = state["hands"][seat]
    if not is_card(card) or card not in hand:
        raise IllegalMove("That card isn't in your hand.")
    if not can_play(state, seat, card):
        raise IllegalMove(_refusal(state, seat, card))
    colour = move.get("colour")
    if card in WILDS:
        if colour not in COLOURS:
            raise IllegalMove("Pick a colour for the wild.")
    else:
        colour = colour_of(card)
    call = move.get("call", False)
    if not isinstance(call, bool):
        raise IllegalMove("Last card is yes or no.")

    _close_window(state, seat)
    hand.remove(card)
    state["discard"].append(card)
    state["colour"] = colour
    state["drawn"] = None
    if not hand:
        _log(state, "play", seat=seat, card=card, colour=colour)
        _end(state, seat)
        return
    called = len(hand) == 1 and call
    _log(state, "play", seat=seat, card=card, colour=colour, **({"called": True} if called else {}))
    if len(hand) == 1 and not call:
        state["exposed"] = seat

    symbol = symbol_of(card)
    if symbol == "S":
        _log(state, "skip", seat=next_seat(state, seat))
        _advance(state, 2)
    elif symbol == "R":
        state["direction"] = -state["direction"]
        _log(state, "reverse", direction=state["direction"])
        # Between two players a Reverse is a Skip: the same player goes again.
        _advance(state, 2 if state["players"] == 2 else 1)
    elif symbol == "D":
        state["stack"] += 2
        _advance(state, 1)
    elif card == "W4":
        state["stack"] = 4
        _advance(state, 1)
    else:
        _advance(state, 1)


def _refusal(state, seat, card):
    top = state["discard"][-1]
    if state["drawn"] is not None:
        return "You can only play the card you just drew — or keep it."
    if state["stack"]:
        if symbol_of(top) == "D":
            return f"Play a Draw two, or take the {state['stack']} cards."
        return f"Take the {state['stack']} cards — a Bear can't be stacked."
    if card == "W4":
        return f"The Bear only goes down when you've no {COLOUR_NAMES[state['colour']]} cards."
    return f"That doesn't match — it needs to be {COLOUR_NAMES[state['colour']]}, or the same symbol."


def _draw_move(state, seat, move):
    if state["stack"]:
        raise IllegalMove(f"Take the {state['stack']} cards, or play a Draw two on top.")
    if state["drawn"] is not None:
        raise IllegalMove("You've drawn already — play that card or keep it.")
    _close_window(state, seat)
    drawn = _deal_to(state, seat, 1, "draw")
    if drawn and can_play(state, seat, drawn[0]):
        state["drawn"] = drawn[0]
    else:
        _advance(state, 1)


def _pass(state, seat, move):
    if state["drawn"] is None:
        raise IllegalMove("Play a card, or draw one.")
    state["drawn"] = None
    _log(state, "keep", seat=seat)
    _advance(state, 1)


def _take(state, seat, move):
    if not state["stack"]:
        raise IllegalMove("There's nothing to take.")
    _close_window(state, seat)
    count = state["stack"]
    state["stack"] = 0
    _deal_to(state, seat, count, "take")
    _advance(state, 1)


def _call(state, seat):
    if state["exposed"] != seat:
        raise IllegalMove("That's for when you're down to one card.")
    state["exposed"] = None
    _log(state, "call", seat=seat)


def _catch(state, seat):
    caught = state["exposed"]
    if caught is None:
        raise IllegalMove("Nobody to catch — everyone said Last card!")
    if caught == seat:
        raise IllegalMove("That's you — say Last card! instead.")
    state["exposed"] = None
    _log(state, "catch", seat=caught, by=seat)
    _deal_to(state, caught, PENALTY, "caught")


# --- helpers -----------------------------------------------------------------

def _close_window(state, seat):
    """The next player's move has landed: whoever forgot to call is safe."""
    if state["exposed"] is not None and state["exposed"] != seat:
        state["exposed"] = None


def _advance(state, steps):
    state["turn"] = next_seat(state, state["turn"], steps)


def _deal_to(state, seat, count, reason):
    """Up to `count` cards from the pile to `seat`, refilling the pile from
    the discards when it runs out. Fewer if every card is already in a hand."""
    cards = []
    for _ in range(count):
        if not state["draw"]:
            _reshuffle(state)
        if not state["draw"]:
            break
        cards.append(state["draw"].pop())
    if cards and state["exposed"] == seat:
        # More than one card again: nothing left to be caught for.
        state["exposed"] = None
    state["hands"][seat] = sorted(state["hands"][seat] + cards, key=sort_key)
    _log(state, "draw", seat=seat, count=len(cards), cards=cards, reason=reason)
    return cards


def _reshuffle(state):
    """Everything under the top card goes back as the new draw pile."""
    if len(state["discard"]) < 2:
        return
    top = state["discard"].pop()
    pile, state["discard"] = state["discard"], [top]
    state["reshuffles"] += 1
    Mulberry32((state["shuffle_seed"] ^ ((state["reshuffles"] * 0x9E3779B1) & 0xFFFFFFFF)) & 0xFFFFFFFF).shuffle(pile)
    state["draw"] = pile
    _log(state, "reshuffle", count=len(pile))


def _end(state, winner):
    state["phase"] = "game_over"
    state["winner"] = winner
    state["drawn"] = None
    state["exposed"] = None
    state["stack"] = 0
    _log(state, "game_over", winner=winner)


def _log(state, kind, **fields):
    state["event"] += 1
    state["log"].append({"id": state["event"], "kind": kind, **fields})
    del state["log"][:-LOG_KEPT]


def _is_int(value):
    # bool is an int in Python, and True would quietly mean 1.
    return isinstance(value, int) and not isinstance(value, bool)
