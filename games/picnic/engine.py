"""Picnic Raid, the whole game: a set-a-trap card game for two to four.

Fill a picnic basket, pack it up to bank the points, and slip traps under
everyone else's blanket while they aren't looking. Our own game — its own
name, picnic, traps and art — not a copy of any published one. One game is
first to 20, with the round played out.

Cards are strings. Food is a kind and how many are on the card, which is
also what it scores:

    s Sandwiches · b Strawberries · c Cupcakes · l Lemonade · h Cheese

so `s1`, `b3`, `c2`. Each kind has four 1s, three 2s and two 3s. The traps
are `ants`, `wasp`, `gull` and `dog`; the defences are `shoo` and
`umbrella`. The deck is 45 food, 17 traps and 5 defences: 67 cards.

The rules as played here, including the choices the family table made:

- Deal five each. On your turn draw two, then:
  - **Hide a trap** if you like: one trap face down under someone else's
    blanket. Everyone sees a mystery card appear; nobody but you knows what
    it is, or that it was you. It costs you nothing — this is the game.
    Not in the first round (everyone gets to lay a picnic first), never a
    second one of yours under the same blanket, and a blanket only has room
    for two.
  - **Then do one thing**: lay up to two food cards in your basket, face up
    for everyone to see — a basket holds five snacks — or **pack up**.
  Hold more than six at the end of your turn and you throw away down to
  six, your choice.
- **Packing up** banks your basket. First every trap under your blanket
  springs, one at a time in the order they were hidden; whatever food is
  left then scores, safe for good, and the cards go on the thrown-away pile.
  An empty basket can be packed too — it clears the blanket.
- When a trap springs it's turned over, and whoever hid it is named. Then
  you may stop it with a defence from your hand, or let it happen:
  - **Ants** carry off your two smallest snacks to the trapper's basket.
  - **Wasp** chases off your biggest snack (thrown away).
  - **Seagull** snatches your biggest snack into the trapper's basket.
  - **Dog** gobbles half your basket, rounded down, biggest snacks first.
  - **Shoo!** sends it back: the trap springs on whoever hid it, right
    away, with you as the trapper — Ants bring *their* two smallest snacks
    to your basket, just in time to be packed. They may Shoo! it straight
    back at you, and so on, until someone has no Shoo! left.
  - **Umbrella** stops a trap; both are thrown away.
  Snacks the Ants or a Seagull bring always fit, whatever the basket holds:
  five is only how many you may lay.
- When someone's packed total reaches 20, the round is finished so
  everyone has had the same number of turns, and the highest packed total
  wins. Food still in a basket counts for nothing. A tie is shared.
- An empty draw pile is refilled from the thrown-away cards, shuffled by a
  seed kept in the state (`core.seeded`), so a game replays exactly from its
  deck, seed and moves, as Wildwood's do.

These rules were found by playtesting the first draft — some 200 rounds
read move by move, one game played by hand, and thousands simulated with
five personalities (a child who lays fast and always defends, a careful
player, a greedy one, a sneaky one, and controls who never trap or who
hoard). What each rule is fixing:

- **Free traps.** When hiding a trap cost your turn, a player who never
  trapped won as often as anyone, and more at four: trapping hurt one
  opponent and handed the tempo to the rest. Now never trapping wins a
  third as often as a fair share.
- **One of yours per blanket, two in all.** Uncapped, the fastest layer —
  in practice the child — had five or six traps on one blanket and banked
  nothing, again and again. Shaking a trap off took a whole turn and was
  undone the next, so that move is gone.
- **Five snacks to a basket.** With a full blanket nothing worse can come,
  so piling food in and packing one giant basket won 1.8 times a fair share
  at four. The limit makes the last slot not worth a turn.
- **Seagull takes from the basket.** Taking a random card from a hand cost
  its victim under a point — the dud of the four. Now it's a snatch, worth
  about three.
- **Shoo! is the common defence and can be sent back.** "No, YOU!" is the
  loudest moment at the table, and it happens about once in three games.
- **A trap-free first round.** Otherwise the first player's basket is the
  only one on the table when everyone else hides their first trap.
- **Finishing the round.** Ending on 20 at once handed the first seat 59%
  of two-player games. It also makes the last round a calculation: who
  still gets a turn, and can anyone pack before it ends.

A game runs eight to ten rounds. Every playing style wins within a fifth
of a fair share (greedy is the weakest), and seats within a few points. Two players is the calmer game:
the first seat wins about 54%, and there's about one big swing a game,
against four at a table of four. About one pack in ten banks nothing at
three or four — the Ants took everything — which is loud but stings; watch
how the youngest takes it.

Like Fugitive and Wildwood this is a game of secrets: hands, and what lies
under each blanket, are seen only by their owners and whoever hid the trap, so
`view(state, viewer)` is what one seat, or the table, may see. The state is
one plain, JSON-safe dict; nothing here knows about Flask, rooms or tokens.
"""

from core.seeded import Mulberry32

FOODS = ("s", "b", "c", "l", "h")
FOOD_NAMES = {"s": "Sandwiches", "b": "Strawberries", "c": "Cupcakes", "l": "Lemonade", "h": "Cheese"}
# How many cards of each size there are in every kind.
FOOD_SPREAD = {1: 4, 2: 3, 3: 2}
TRAPS = {"ants": 6, "wasp": 5, "gull": 4, "dog": 2}
DEFENCES = {"shoo": 3, "umbrella": 2}
NAMES = {"ants": "Ants", "wasp": "Wasp", "gull": "Seagull", "dog": "Dog", "shoo": "Shoo!", "umbrella": "Umbrella"}
HAND_SIZE = 5
DRAW = 2
LAY = 2
BASKET = 5
HAND_LIMIT = 6
# A blanket holds this many traps, and at most one of any one player's.
BLANKET = 2
TARGET = 20
MIN_PLAYERS = 2
MAX_PLAYERS = 4
# How much of the log a view carries: enough for any device to play out what
# it missed between polls, without sending a whole game every second.
LOG_SENT = 60
LOG_KEPT = 160


class IllegalMove(ValueError):
    """A move the rules don't allow right now. The message is player-facing."""


# --- cards -------------------------------------------------------------------

def full_deck():
    """All 67 cards in a fixed order: each kind's food, smallest first, then
    the traps and the defences."""
    deck = []
    for food in FOODS:
        for size, count in FOOD_SPREAD.items():
            deck += [f"{food}{size}"] * count
    for name, count in {**TRAPS, **DEFENCES}.items():
        deck += [name] * count
    return deck


def is_food(card):
    return isinstance(card, str) and len(card) == 2 and card[0] in FOODS and card[1] in "123"


def is_trap(card):
    return isinstance(card, str) and card in TRAPS


def is_defence(card):
    return isinstance(card, str) and card in DEFENCES


def is_card(card):
    return is_food(card) or is_trap(card) or is_defence(card)


def value(card):
    """What a food card scores; nothing else scores."""
    return int(card[1]) if is_food(card) else 0


def sort_key(card):
    """Hands are kept sorted: food by kind and size, then traps, then
    defences — the order a child would fan them in."""
    if is_food(card):
        return (0, FOODS.index(card[0]), card[1])
    if is_trap(card):
        return (1, tuple(TRAPS).index(card), "")
    return (2, tuple(DEFENCES).index(card), "")


def by_size(cards):
    """Smallest snack first. Ties break on kind, so "the two smallest" is
    always the same two cards."""
    return sorted(cards, key=lambda c: (value(c), sort_key(c)))


def basket_value(cards):
    return sum(value(c) for c in cards)


# --- a game ------------------------------------------------------------------

def new_game(rng, players, deck=None, shuffle_seed=None, first=0):
    """A fresh game for `players` seats, dealt, with seat `first` to move
    and holding its two drawn cards.

    `deck` is every card in the order it'll be drawn, top card last — given
    by tests; otherwise the full deck is shuffled with `rng`. `shuffle_seed`
    is the secret behind every reshuffle of the thrown-away pile, likewise
    drawn from `rng` unless given.
    """
    if not (_is_int(players) and MIN_PLAYERS <= players <= MAX_PLAYERS):
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
    first = first % players
    state = {
        "players": players,
        "hands": [sorted(h, key=sort_key) for h in hands],
        "baskets": [[] for _ in range(players)],
        # Each blanket is the traps under it, in the order they were hidden:
        # {"card", "by"}. Only the hider (and the end of the game) sees cards.
        "blankets": [[] for _ in range(players)],
        "scores": [0] * players,
        "packs": [0] * players,
        "draw": pile,
        "discard": [],
        "first": first,
        "turn": first,
        "round": 1,
        # "act": hide a trap and/or lay, pack or pass; "spring": a pack-up
        # waiting on someone's defence; "discard": down to the hand limit.
        "stage": "act",
        "hidden": False,
        # The trap springing right now: who it's on, who gains if it lands,
        # who hid it, and how many times it's been shooed.
        "springing": None,
        # The seat that reached TARGET first; the round is played out.
        "ending": None,
        "shuffle_seed": shuffle_seed,
        "reshuffles": 0,
        "phase": "play",
        "winners": None,
        "log": [],
        "event": 0,
        "seq": 0,
        "recorded": False,
    }
    _log(state, "deal", first=first)
    _start_turn(state, first)
    return state


def turn(state):
    """Who has to decide next — the player whose turn it is, or, while a
    trap springs, whoever it's on — or None once it's over."""
    if state["phase"] == "game_over":
        return None
    if state["stage"] == "spring":
        return state["springing"]["on"]
    return state["turn"]


def defences(state, seat):
    """The defences `seat` may play on the trap springing at them now. The
    first time it springs that's Shoo! or Umbrella; sent back, only Shoo!."""
    sp = state["springing"]
    if state["stage"] != "spring" or sp["on"] != seat:
        return []
    allowed = ("shoo", "umbrella") if sp["sends"] == 0 else ("shoo",)
    return [d for d in allowed if d in state["hands"][seat]]


def hide_targets(state, seat):
    """The blankets `seat` could hide a trap under on this turn."""
    if (state["phase"] != "play" or state["stage"] != "act" or state["turn"] != seat
            or state["hidden"] or state["round"] == 1):
        return []
    return [t for t in range(state["players"]) if t != seat and _room_under(state, seat, t) is None]


def basket_room(state, seat):
    # Loot can overfill a basket; that leaves no room, not less than none.
    return max(0, BASKET - len(state["baskets"][seat]))


def apply(state, seat, move):
    """Play one move for `seat`, in place. Raises IllegalMove before changing
    anything.

    On your turn: {"type": "hide", "card", "target"} (once, before the rest),
    then one of {"type": "lay", "cards"}, {"type": "pack"}, {"type": "pass"};
    and if you end it holding too many, {"type": "discard", "cards"}.

    While a trap springs on you: {"type": "defend", "card"} — "shoo",
    "umbrella", or None to let it happen.
    """
    if not (_is_int(seat) and 0 <= seat < state["players"]):
        raise IllegalMove("No such player.")
    if state["phase"] == "game_over":
        raise IllegalMove("The game is over.")
    if not isinstance(move, dict):
        raise IllegalMove("That isn't a move.")
    kind = move.get("type")
    stage = state["stage"]
    moves = {"act": {"hide": _hide, "lay": _lay, "pack": _pack, "pass": _pass},
             "spring": {"defend": _defend},
             "discard": {"discard": _discard}}[stage]
    if kind not in ("hide", "lay", "pack", "pass", "defend", "discard"):
        raise IllegalMove("That isn't a move.")
    if turn(state) != seat:
        if stage == "spring":
            raise IllegalMove("Wait — a trap is springing.")
        raise IllegalMove("It isn't your turn.")
    if kind not in moves:
        raise IllegalMove({"spring": "Shoo it, put up an umbrella, or let it happen.",
                           "discard": "Throw some cards away first.",
                           "act": "That isn't a move right now."}[stage])
    moves[kind](state, seat, move)
    state["seq"] += 1
    return state


def view(state, viewer):
    """What `viewer` — a seat number or "table" — may see.

    Your own hand, and your own traps under other blankets; for everyone
    else's, only that a mystery card is there. Baskets and scores are on the
    table for all. A draw, a discard or a hidden trap in the log says what
    only to whoever it belongs to. Once the game is over everything is shown.
    """
    if viewer != "table" and not (_is_int(viewer) and 0 <= viewer < state["players"]):
        raise ValueError(viewer)
    over = state["phase"] == "game_over"
    seat = None if viewer == "table" else viewer

    log = []
    for entry in state["log"][-LOG_SENT:]:
        entry = dict(entry)
        if entry["kind"] in ("draw", "discard") and not (over or entry["seat"] == seat):
            entry["cards"] = None
        if entry["kind"] == "hide" and not (over or entry["seat"] == seat):
            entry["card"] = None
        log.append(entry)

    acting = turn(state)
    sp = state["springing"]
    return {
        "viewer": viewer,
        "phase": state["phase"],
        "stage": state["stage"],
        "turn": acting,
        "current": None if over else state["turn"],
        "round": state["round"],
        "first": state["first"],
        "players": state["players"],
        "hand": list(state["hands"][seat]) if seat is not None else None,
        "hand_counts": [len(h) for h in state["hands"]],
        "hands": [list(h) for h in state["hands"]] if over else None,
        "baskets": [list(b) for b in state["baskets"]],
        "blankets": [[{"card": t["card"] if (over or t["by"] == seat) else None, "mine": t["by"] == seat}
                      for t in blanket] for blanket in state["blankets"]],
        "scores": list(state["scores"]),
        "packs": list(state["packs"]),
        "draw_count": len(state["draw"]),
        "discard_count": len(state["discard"]),
        "springing": dict(sp) if sp else None,
        "defences": defences(state, seat) if seat is not None else [],
        "hidden": state["hidden"],
        "hide_targets": hide_targets(state, seat) if seat is not None else [],
        "basket_room": basket_room(state, seat) if seat is not None else None,
        "must_discard": (len(state["hands"][seat]) - HAND_LIMIT
                         if seat is not None and state["stage"] == "discard" and acting == seat else 0),
        "ending": state["ending"],
        "target": TARGET,
        "winners": list(state["winners"]) if state["winners"] else None,
        "log": log,
        "seq": state["seq"],
    }


# --- moves -------------------------------------------------------------------

def _room_under(state, seat, target):
    """Why `seat` can't hide a trap under `target`'s blanket, or None."""
    if not (_is_int(target) and 0 <= target < state["players"]) or target == seat:
        return "Hide it under someone else's blanket."
    blanket = state["blankets"][target]
    if any(t["by"] == seat for t in blanket):
        return "You've already got a trap under that blanket."
    if len(blanket) >= BLANKET:
        return "That blanket is full."
    return None


def _hide(state, seat, move):
    if state["hidden"]:
        raise IllegalMove("One trap a turn.")
    if state["round"] == 1:
        raise IllegalMove("No traps in the first round — everyone lays a picnic first.")
    card, target = move.get("card"), move.get("target")
    if not is_trap(card) or card not in state["hands"][seat]:
        raise IllegalMove("That trap isn't in your hand.")
    problem = _room_under(state, seat, target)
    if problem:
        raise IllegalMove(problem)
    state["hands"][seat].remove(card)
    state["blankets"][target].append({"card": card, "by": seat})
    state["hidden"] = True
    _log(state, "hide", seat=seat, target=target, card=card)


def _lay(state, seat, move):
    cards = move.get("cards")
    if not isinstance(cards, list) or not 1 <= len(cards) <= LAY:
        raise IllegalMove(f"Lay one or {LAY} snacks.")
    hand = list(state["hands"][seat])
    for card in cards:
        if not is_food(card):
            raise IllegalMove("Only food goes in the basket.")
        if card not in hand:
            raise IllegalMove("That isn't in your hand.")
        hand.remove(card)
    room = basket_room(state, seat)
    if len(cards) > room:
        raise IllegalMove("Your basket is full — pack it up." if room == 0
                          else f"Your basket only has room for {room} more.")
    state["hands"][seat] = hand
    state["baskets"][seat] += cards
    _log(state, "lay", seat=seat, cards=list(cards))
    _end_turn(state)


def _pass(state, seat, move):
    _log(state, "pass", seat=seat)
    _end_turn(state)


def _pack(state, seat, move):
    if not state["baskets"][seat] and not state["blankets"][seat]:
        raise IllegalMove("Nothing to pack — lay some food first.")
    _log(state, "pack", seat=seat, points=basket_value(state["baskets"][seat]),
         traps=len(state["blankets"][seat]))
    state["stage"] = "spring"
    _spring_next(state)


def _spring_next(state):
    """Spring the traps under the packer's blanket in order, stopping
    whenever someone holds a defence and has to choose; bank when the
    blanket is clear."""
    packer = state["turn"]
    while True:
        sp = state["springing"]
        if sp is None:
            blanket = state["blankets"][packer]
            if not blanket:
                return _bank(state)
            trap = blanket.pop(0)
            sp = state["springing"] = {"card": trap["card"], "by": trap["by"], "on": packer,
                                       "from": trap["by"], "sends": 0}
            _log(state, "spring", seat=packer, card=trap["card"], by=trap["by"])
        if defences(state, sp["on"]):
            return
        _land(state)


def _defend(state, seat, move):
    card = move.get("card")
    sp = state["springing"]
    if card is not None and card not in defences(state, seat):
        raise IllegalMove("Sent back, only a Shoo! stops it." if sp["sends"] and card == "umbrella"
                          else "You haven't got that.")
    if card is None:
        _land(state)
    else:
        state["hands"][seat].remove(card)
        state["discard"].append(card)
        if card == "umbrella":
            _log(state, "umbrella", seat=seat, card=sp["card"])
            state["discard"].append(sp["card"])
            state["springing"] = None
        else:
            _log(state, "shoo", seat=seat, at=sp["from"], card=sp["card"])
            sp["on"], sp["from"] = sp["from"], sp["on"]
            sp["sends"] += 1
    _spring_next(state)


def _land(state):
    """The springing trap happens to whoever it's on now; whoever it came
    from gets what the Ants or the Seagull carry."""
    sp = state["springing"]
    on, gains, card = sp["on"], sp["from"], sp["card"]
    basket = by_size(state["baskets"][on])
    if card == "ants":
        taken, basket, to = basket[:2], basket[2:], gains
    elif card == "gull":
        taken, basket, to = basket[-1:], basket[:-1], gains
    elif card == "wasp":
        taken, basket, to = basket[-1:], basket[:-1], None
    else:  # the Dog: half, rounded down, biggest first
        half = len(basket) // 2
        taken, basket, to = basket[len(basket) - half:], basket[:len(basket) - half], None
    state["baskets"][on] = basket
    if to is None:
        state["discard"] += taken
    else:
        # Loot always fits: five is only how many you may lay.
        state["baskets"][to] += taken
    state["discard"].append(card)
    state["springing"] = None
    _log(state, "land", seat=on, card=card, cards=taken, to=to, by=sp["by"])


def _bank(state):
    seat = state["turn"]
    basket = state["baskets"][seat]
    points = basket_value(basket)
    state["scores"][seat] += points
    state["packs"][seat] += 1
    state["discard"] += basket
    state["baskets"][seat] = []
    state["stage"] = "act"
    _log(state, "bank", seat=seat, points=points, total=state["scores"][seat])
    if state["ending"] is None and state["scores"][seat] >= TARGET:
        state["ending"] = seat
        _log(state, "last_round", seat=seat)
    _end_turn(state)


def _end_turn(state):
    seat = state["turn"]
    if len(state["hands"][seat]) > HAND_LIMIT:
        state["stage"] = "discard"
        return
    _advance(state)


def _discard(state, seat, move):
    cards = move.get("cards")
    over = len(state["hands"][seat]) - HAND_LIMIT
    if not isinstance(cards, list) or len(cards) != over:
        raise IllegalMove(f"Throw away {over} card{'s' if over != 1 else ''}.")
    hand = list(state["hands"][seat])
    for card in cards:
        if not isinstance(card, str) or card not in hand:
            raise IllegalMove("That isn't in your hand.")
        hand.remove(card)
    state["hands"][seat] = hand
    state["discard"] += cards
    _log(state, "discard", seat=seat, count=len(cards), cards=list(cards))
    _advance(state)


def _advance(state):
    nxt = (state["turn"] + 1) % state["players"]
    if nxt == state["first"]:
        if state["ending"] is not None:
            return _finish(state)
        state["round"] += 1
    _start_turn(state, nxt)


def _start_turn(state, seat):
    state["turn"] = seat
    state["stage"] = "act"
    state["hidden"] = False
    cards = []
    for _ in range(DRAW):
        if not state["draw"]:
            _reshuffle(state)
        if not state["draw"]:
            break
        cards.append(state["draw"].pop())
    state["hands"][seat] = sorted(state["hands"][seat] + cards, key=sort_key)
    _log(state, "draw", seat=seat, count=len(cards), cards=cards)


def _reshuffle(state):
    """The thrown-away pile, shuffled, is the new draw pile."""
    if not state["discard"]:
        return
    pile, state["discard"] = state["discard"], []
    state["reshuffles"] += 1
    Mulberry32((state["shuffle_seed"] ^ ((state["reshuffles"] * 0x9E3779B1) & 0xFFFFFFFF)) & 0xFFFFFFFF).shuffle(pile)
    state["draw"] = pile
    _log(state, "reshuffle", count=len(pile))


def _finish(state):
    top = max(state["scores"])
    state["phase"] = "game_over"
    state["winners"] = [s for s in range(state["players"]) if state["scores"][s] == top]
    _log(state, "game_over", winners=list(state["winners"]), scores=list(state["scores"]))


def _log(state, kind, **fields):
    state["event"] += 1
    state["log"].append({"id": state["event"], "kind": kind, **fields})
    del state["log"][:-LOG_KEPT]


def _is_int(value):
    # bool is an int in Python, and True would quietly mean 1.
    return isinstance(value, int) and not isinstance(value, bool)
