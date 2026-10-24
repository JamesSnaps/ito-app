"""Flip 7, the whole game: deck, turns, action cards and scoring.

The scorekeeper adds up a round played with real cards. This is the other
half — the app is the deck. It runs on the server rather than in the page
for two reasons. A deck shuffled in the browser is a deck anyone can read
from the console. And rules written once, here, are the rules every client
gets: the shared-device page now, a phone per player or a native app later,
instead of being rewritten in each.

The state is one plain, JSON-safe dict, so saving a game is json.dump and
restoring it after a restart is json.load. Nothing in here knows about
Flask, rooms or tokens.

Action cards are the awkward part of the rules. A Flip Three can turn up
another Flip Three, a Freeze can arrive in the middle of the deal, and each
of them stops the game until somebody picks a target. Rather than nest all
of that, everything that has to happen goes on a queue (`tasks`). `_run`
works through it until it needs a person — whose turn it is, or who gets
this card — and stops there, with `pending` saying who and for what.

Two readings of the rulebook are baked in, because it doesn't spell them
out: drawing an action card *is* your hit, so the turn passes once it's
resolved; and a Flip 7 ends the round with everyone else who hasn't busted
still scoring what's in front of them.
"""

import copy

TARGET_SCORE = 200
MIN_PLAYERS = 2
MAX_PLAYERS = 12
FLIP7_BONUS = 15
FLAT_MODS = (2, 4, 6, 8, 10)
ACTIONS = ("freeze", "flip3", "chance")
# Enough history for a client that missed a couple of polls to animate what
# it missed, without the saved file growing all night.
LOG_LENGTH = 30


class IllegalMove(ValueError):
    """A move the rules don't allow right now. The message is player-facing."""


def full_deck():
    """All 94 cards, unshuffled: a single 0 and n copies of each n up to 12,
    the five flat modifiers and a x2, and three of each action."""
    cards = ["n0"]
    for n in range(1, 13):
        cards += [f"n{n}"] * n
    cards += [f"+{m}" for m in FLAT_MODS] + ["x2"]
    for action in ACTIONS:
        cards += [action] * 3
    return cards


def score_hand(hand, bust=False):
    """One player's round. Mirrors calcRoundScore in the scorekeeper — x2
    doubles the numbers only, flat modifiers go on after, seven distinct
    numbers is +15, and a bust is worth nothing at all."""
    if bust:
        return 0
    base = sum(hand["numbers"])
    doubled = base * 2 if hand["x2"] else base
    flat = sum(hand["mods"])
    bonus = FLIP7_BONUS if len(hand["numbers"]) >= 7 else 0
    return doubled + flat + bonus


def cards_on_table(hand):
    """Every card in front of a player, as deck ids — what goes to the
    discard pile when the table is cleared."""
    cards = [f"n{n}" for n in hand["numbers"]]
    if hand["bust_card"] is not None:
        cards.append(f"n{hand['bust_card']}")
    cards += [f"+{m}" for m in hand["mods"]]
    if hand["x2"]:
        cards.append("x2")
    if hand["chance"]:
        cards.append("chance")
    return cards + hand["actions"] + hand["held"]


def new_game(names, rng, deck=None):
    """A fresh game with the first round dealt.

    `deck` is for tests (and a rigged demo): the cards in the order they'll
    come off the top. Otherwise the full deck is shuffled with `rng`.
    """
    if not MIN_PLAYERS <= len(names) <= MAX_PLAYERS:
        raise ValueError(f"{MIN_PLAYERS}–{MAX_PLAYERS} players")
    if deck is None:
        deck = full_deck()
        rng.shuffle(deck)
    state = {
        "phase": "playing",     # playing → round_over → playing … → game_over
        "round": 0,
        # The seat before the first name, so whoever was typed in first is
        # dealt to first and plays first.
        "dealer": len(names) - 1,
        "players": [
            {"name": name, "total": 0, "rounds": [], "status": "active", "hand": _blank_hand()}
            for name in names
        ],
        "deck": list(deck),
        "discard": [],
        "tasks": [],
        "pending": None,
        "cursor": None,         # whose turn was last; the next is the active seat after it
        "flip7_by": None,
        "exhausted": False,
        "last_round": None,
        "winners": [],
        "log": [],
        "event": 0,
        "seq": 0,
        "recorded": False,
    }
    _start_round(state, rng)
    return state


def apply(state, move, rng):
    """Play one move, in place. Raises IllegalMove before changing anything.

    Moves: {"type": "hit"|"stay", "player"}, {"type": "give", "player",
    "target"} to hand over the card `pending` is waiting on, and
    {"type": "next_round"} once a round has been scored.
    """
    kind = move.get("type")
    player = _seat(state, move.get("player"))
    pending = state["pending"]

    if state["phase"] == "game_over":
        raise IllegalMove("The game is over.")

    if kind == "next_round":
        if state["phase"] != "round_over":
            raise IllegalMove("The round isn't over yet.")
        state["dealer"] = (state["dealer"] + 1) % len(state["players"])
        _start_round(state, rng)

    elif state["phase"] != "playing":
        raise IllegalMove("Deal the next round first.")

    elif kind in ("hit", "stay"):
        if not pending or pending["kind"] != "turn" or pending["player"] != player:
            raise IllegalMove("It isn't that player's turn.")
        hand = state["players"][player]["hand"]
        if kind == "stay" and not _has_cards(hand):
            raise IllegalMove("Take a card first — there's nothing to stay on.")
        state["pending"] = None
        state["cursor"] = player
        if kind == "hit":
            state["tasks"].append({"t": "draw", "player": player})
        else:
            state["players"][player]["status"] = "stayed"
            _log(state, "stay", player=player)
        _run(state, rng)

    elif kind == "give":
        if not pending or pending["kind"] != "give" or pending["player"] != player:
            raise IllegalMove("That player has no card to give.")
        target = _seat(state, move.get("target"))
        if target not in pending["options"]:
            raise IllegalMove("That player can't take this card.")
        state["pending"] = None
        _give(state, player, pending["card"], target)
        _run(state, rng)

    else:
        raise IllegalMove("Unknown move.")

    state["seq"] += 1
    return state


def public_view(state):
    """What any client may see. The deck's order is the one secret in an
    otherwise face-up game, so it goes out as a count; the queue and the
    turn cursor are bookkeeping."""
    view = {
        key: copy.deepcopy(value)
        for key, value in state.items()
        if key not in ("deck", "discard", "tasks", "cursor")
    }
    view["deck_count"] = len(state["deck"])
    view["discard_count"] = len(state["discard"])
    view["target"] = TARGET_SCORE
    for player in view["players"]:
        player["round_score"] = score_hand(player["hand"], player["status"] == "busted")
    return view


# --- internals -----------------------------------------------------------

def _blank_hand():
    return {
        "numbers": [],      # in the order drawn
        "mods": [],
        "x2": False,
        "chance": False,    # holding a Second Chance
        "actions": [],      # Freeze / Flip Three played on this player, kept on show
        "held": [],         # actions drawn during a Flip Three, waiting to be given
        "bust_card": None,  # the duplicate that ended it, so the table can see why
    }


def _seat(state, value):
    if value is None:
        return None
    # bool is an int in Python, and True would quietly mean seat 1.
    if not isinstance(value, int) or isinstance(value, bool) \
            or not 0 <= value < len(state["players"]):
        raise IllegalMove("No such player.")
    return value


def _has_cards(hand):
    return bool(hand["numbers"] or hand["mods"] or hand["x2"] or hand["chance"])


def _log(state, kind, **fields):
    state["event"] += 1
    state["log"].append({"id": state["event"], "kind": kind, **fields})
    del state["log"][:-LOG_LENGTH]


def _active(state):
    return [i for i, p in enumerate(state["players"]) if p["status"] == "active"]


def _start_round(state, rng):
    # Last round's cards stay on the table until now, so the round's end can
    # show what everyone finished with.
    for player in state["players"]:
        state["discard"] += cards_on_table(player["hand"])
        player["hand"] = _blank_hand()
        player["status"] = "active"
    state["round"] += 1
    state["phase"] = "playing"
    state["pending"] = None
    state["flip7_by"] = None
    state["exhausted"] = False
    state["last_round"] = None
    state["cursor"] = state["dealer"]
    n = len(state["players"])
    state["tasks"] = [{"t": "deal", "player": (state["dealer"] + 1 + i) % n} for i in range(n)]
    _log(state, "round", round=state["round"], dealer=state["dealer"])
    _run(state, rng)


def _run(state, rng):
    """Work through the queue until somebody has to decide something."""
    while True:
        if state["pending"] is not None:
            return
        if state["flip7_by"] is not None or state["exhausted"] or not _active(state):
            _end_round(state)
            return
        if state["tasks"]:
            _do(state, state["tasks"].pop(0), rng)
            continue
        cursor = state["cursor"]
        n = len(state["players"])
        nxt = next(
            (cursor + k) % n for k in range(1, n + 1)
            if state["players"][(cursor + k) % n]["status"] == "active"
        )
        state["pending"] = {"kind": "turn", "player": nxt}
        return


def _do(state, task, rng):
    p = task["player"]
    player = state["players"][p]

    if task["t"] == "deal":
        # Somebody frozen, or handed a Flip Three, before the deal reached
        # them has been dealt to already, in effect — they're skipped.
        if player["status"] == "active" and not _has_cards(player["hand"]):
            _draw(state, p, "deal", rng)

    elif task["t"] == "draw":
        _draw(state, p, "hit", rng)

    elif task["t"] == "flip3":
        if player["status"] != "active":
            return
        _draw(state, p, "flip3", rng)
        left = task["left"] - 1
        still_going = (player["status"] == "active" and state["flip7_by"] is None
                       and not state["exhausted"])
        # Inserted at the front either way, so it runs before anything that
        # was already queued — the deal pauses until a Flip Three is done.
        if left > 0 and still_going:
            state["tasks"].insert(0, {"t": "flip3", "player": p, "left": left})
        else:
            state["tasks"].insert(0, {"t": "give_held", "player": p})

    elif task["t"] == "give_held":
        hand = player["hand"]
        if not hand["held"]:
            return
        if player["status"] != "active":
            # Busted during the three: whatever they were holding is void.
            state["discard"] += hand["held"]
            hand["held"] = []
            return
        card = hand["held"].pop(0)
        if hand["held"]:
            state["tasks"].insert(0, {"t": "give_held", "player": p})
        _offer(state, p, card)


def _take(state, rng):
    """Top card, reshuffling the discards in when the deck runs dry. Cards
    still on the table stay there; only discards go back in."""
    if not state["deck"] and state["discard"]:
        state["deck"] = state["discard"]
        state["discard"] = []
        rng.shuffle(state["deck"])
        _log(state, "reshuffle", cards=len(state["deck"]))
    if not state["deck"]:
        state["exhausted"] = True
        return None
    return state["deck"].pop(0)


def _draw(state, p, context, rng):
    card = _take(state, rng)
    if card is None:
        return
    hand = state["players"][p]["hand"]
    _log(state, "draw", player=p, card=card, context=context)

    if card.startswith("n"):
        value = int(card[1:])
        if value in hand["numbers"]:
            if hand["chance"]:
                hand["chance"] = False
                state["discard"] += [card, "chance"]
                _log(state, "saved", player=p, card=card)
            else:
                state["players"][p]["status"] = "busted"
                hand["bust_card"] = value
                _log(state, "bust", player=p, card=card)
        else:
            hand["numbers"].append(value)
            if len(hand["numbers"]) == 7:
                state["flip7_by"] = p
                _log(state, "flip7", player=p)
    elif card.startswith("+"):
        hand["mods"].append(int(card[1:]))
    elif card == "x2":
        hand["x2"] = True
    elif card == "chance":
        if hand["chance"]:
            _offer(state, p, card)
        else:
            hand["chance"] = True
    elif context == "flip3":
        hand["held"].append(card)
    else:
        _offer(state, p, card)


def _offer(state, p, card):
    """Somebody has a card to hand out. Ask who gets it — unless the rules
    leave only one answer, in which case don't make anyone tap for it."""
    if card == "chance":
        # You can only hold one, so a second goes to someone without one.
        options = [i for i in _active(state)
                   if i != p and not state["players"][i]["hand"]["chance"]]
    else:
        options = _active(state)

    if not options:
        state["discard"].append(card)
        _log(state, "discarded", player=p, card=card)
    elif len(options) == 1:
        _give(state, p, card, options[0])
    else:
        state["pending"] = {"kind": "give", "player": p, "card": card, "options": options}


def _give(state, p, card, target):
    hand = state["players"][target]["hand"]
    _log(state, "give", player=p, target=target, card=card)
    if card == "freeze":
        state["players"][target]["status"] = "frozen"
        hand["actions"].append(card)
    elif card == "flip3":
        hand["actions"].append(card)
        state["tasks"].insert(0, {"t": "flip3", "player": target, "left": 3})
    elif card == "chance":
        hand["chance"] = True


def _end_round(state):
    state["tasks"] = []
    state["pending"] = None
    scores = []
    for player in state["players"]:
        bust = player["status"] == "busted"
        score = score_hand(player["hand"], bust)
        flip7 = not bust and len(player["hand"]["numbers"]) >= 7
        player["rounds"].append({"score": score, "bust": bust, "flip7": flip7})
        player["total"] += score
        scores.append(score)

    state["last_round"] = {"scores": scores, "flip7_by": state["flip7_by"],
                           "exhausted": state["exhausted"]}
    top = max(p["total"] for p in state["players"])
    if top >= TARGET_SCORE:
        state["phase"] = "game_over"
        state["winners"] = [i for i, p in enumerate(state["players"]) if p["total"] == top]
    else:
        state["phase"] = "round_over"
    _log(state, "round_end", round=state["round"])
