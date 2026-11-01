"""Picnic Raid's rules: each one on a table set up by hand, then hundreds of
random games where no card may be lost or invented, and the computer
playing itself to the end."""

import random
from collections import Counter

import pytest

from games.picnic import ai, engine
from games.picnic.engine import IllegalMove


def table(hands, turn=0, round=2, baskets=None, blankets=None, scores=None, draw=None, **extra):
    """A game mid-play, built by hand. The seat to move already holds its
    draw, as it would at the start of a turn."""
    n = len(hands)
    state = engine.new_game(random.Random(1), n)
    state.update({
        "hands": [sorted(h, key=engine.sort_key) for h in hands],
        "baskets": [list(b) for b in (baskets or [[] for _ in range(n)])],
        "blankets": [[{"card": c, "by": by} for c, by in b] for b in (blankets or [[] for _ in range(n)])],
        "scores": list(scores or [0] * n),
        "draw": list(draw if draw is not None else ["s1", "s1", "b1", "b1", "c1", "c1", "l1", "l1"] * 3),
        "discard": [],
        "turn": turn,
        "round": round,
        "first": 0,
        "stage": "act",
        "hidden": False,
        "springing": None,
        "ending": None,
        **extra,
    })
    return state


def go(state, seat, kind, **move):
    return engine.apply(state, seat, {"type": kind, **move})


def every_card(state):
    cards = sum(state["hands"], []) + sum(state["baskets"], []) + state["draw"] + state["discard"]
    cards += [t["card"] for b in state["blankets"] for t in b]
    if state["springing"]:
        cards.append(state["springing"]["card"])
    return Counter(cards)


# --- the deck and the deal --------------------------------------------------

def test_the_deck_is_67_of_our_own_spread():
    deck = engine.full_deck()
    counts = Counter(deck)
    assert len(deck) == 67
    assert counts["s1"] == 4 and counts["s2"] == 3 and counts["s3"] == 2
    assert counts["ants"] == 6 and counts["wasp"] == 5 and counts["gull"] == 4 and counts["dog"] == 2
    assert counts["shoo"] == 3 and counts["umbrella"] == 2
    assert sum(map(engine.value, deck)) == 80
    assert all(engine.is_card(c) for c in deck)
    assert not any(engine.is_card(c) for c in ("s4", "x1", "", None, 3, ["ants"], "bear"))


def test_a_deal_gives_five_each_and_the_first_player_draws_two():
    state = engine.new_game(random.Random(3), 3, first=1)
    assert [len(h) for h in state["hands"]] == [5, 7, 5]
    assert engine.turn(state) == 1 and state["round"] == 1
    assert every_card(state) == Counter(engine.full_deck())


# --- hiding traps -----------------------------------------------------------

def test_no_traps_in_the_first_round():
    state = table([["ants", "s1"], ["b2"]], round=1)
    assert engine.hide_targets(state, 0) == []
    with pytest.raises(IllegalMove, match="first round"):
        go(state, 0, "hide", card="ants", target=1)


def test_a_trap_is_free_and_then_you_still_take_your_turn():
    state = table([["ants", "s3"], ["b2"]])
    go(state, 0, "hide", card="ants", target=1)
    assert state["blankets"][1] == [{"card": "ants", "by": 0}]
    assert engine.turn(state) == 0 and state["hidden"]
    with pytest.raises(IllegalMove, match="One trap a turn"):
        go(state, 0, "hide", card="ants", target=1)
    go(state, 0, "lay", cards=["s3"])
    assert state["baskets"][0] == ["s3"] and engine.turn(state) == 1


def test_one_of_yours_under_a_blanket_and_two_in_all():
    state = table([["ants", "wasp"], ["dog"], ["gull"]],
                  blankets=[[], [], [("dog", 1)]])
    with pytest.raises(IllegalMove, match="someone else"):
        go(state, 0, "hide", card="ants", target=0)
    go(state, 0, "hide", card="ants", target=2)
    assert len(state["blankets"][2]) == 2
    state["hidden"] = False
    with pytest.raises(IllegalMove, match="already got a trap"):
        go(state, 0, "hide", card="wasp", target=2)
    # Someone else's view: full.
    assert 2 not in engine.hide_targets(table([["gull"], [], []], blankets=[[], [], [("dog", 1), ("ants", 0)]]), 0)
    with pytest.raises(IllegalMove, match="isn't in your hand"):
        go(table([["s1"], []]), 0, "hide", card="dog", target=1)


# --- laying -----------------------------------------------------------------

def test_lay_one_or_two_snacks_into_a_basket_of_five():
    state = table([["s1", "s2", "b3", "ants"], []], baskets=[["c1", "c1", "c1", "c1"], []])
    with pytest.raises(IllegalMove, match="room for 1"):
        go(state, 0, "lay", cards=["s1", "s2"])
    with pytest.raises(IllegalMove, match="Only food"):
        go(state, 0, "lay", cards=["ants"])
    with pytest.raises(IllegalMove, match="one or 2"):
        go(state, 0, "lay", cards=[])
    go(state, 0, "lay", cards=["b3"])
    assert len(state["baskets"][0]) == 5
    full = table([["s1"], []], baskets=[["c1"] * 5, []])
    with pytest.raises(IllegalMove, match="full — pack it up"):
        go(full, 0, "lay", cards=["s1"])


# --- packing and the traps --------------------------------------------------

def test_a_clear_blanket_banks_the_whole_basket():
    state = table([[], []], baskets=[["s3", "b2"], []])
    go(state, 0, "pack")
    assert state["scores"][0] == 5 and state["baskets"][0] == [] and state["packs"][0] == 1
    assert engine.turn(state) == 1
    with pytest.raises(IllegalMove, match="Nothing to pack"):
        go(state, 1, "pack")


@pytest.mark.parametrize("trap, kept, gone, loot", [
    ("ants", ["c3"], [], ["s1", "b2"]),
    ("wasp", ["s1", "b2"], ["c3"], []),
    ("gull", ["s1", "b2"], [], ["c3"]),
    ("dog", ["s1", "b2"], ["c3"], []),
])
def test_each_trap_on_a_basket_of_three(trap, kept, gone, loot):
    state = table([[], ["l1"]], baskets=[["s1", "b2", "c3"], ["l1"]], blankets=[[(trap, 1)], []])
    go(state, 0, "pack")
    assert state["scores"][0] == engine.basket_value(kept)
    assert sorted(state["baskets"][1]) == sorted(["l1"] + loot)
    assert all(c in state["discard"] for c in gone + [trap])


def test_the_dog_eats_half_rounded_down_biggest_first():
    state = table([[], []], baskets=[["s1", "s1", "b2", "c3", "h3"], []], blankets=[[("dog", 1)], []])
    go(state, 0, "pack")
    assert state["scores"][0] == 4  # s1 s1 b2 left; c3 h3 gone


def test_traps_spring_in_the_order_they_were_hidden():
    state = table([[], [], []], baskets=[["s1", "b2", "c3"], [], []],
                  blankets=[[("gull", 2), ("ants", 1)], [], []])
    go(state, 0, "pack")
    # The Seagull first takes the 3; then the Ants carry both that are left.
    assert state["baskets"][2] == ["c3"] and sorted(state["baskets"][1]) == ["b2", "s1"]
    assert state["scores"][0] == 0
    kinds = [e["kind"] for e in state["log"] if e["kind"] in ("spring", "land")]
    assert kinds == ["spring", "land", "spring", "land"]


def test_an_umbrella_stops_a_trap():
    state = table([["umbrella"], []], baskets=[["c3"], []], blankets=[[("wasp", 1)], []])
    go(state, 0, "pack")
    assert engine.turn(state) == 0 and engine.view(state, 0)["defences"] == ["umbrella"]
    with pytest.raises(IllegalMove, match="haven't got"):
        go(state, 0, "defend", card="shoo")
    go(state, 0, "defend", card="umbrella")
    assert state["scores"][0] == 3 and "umbrella" in state["discard"]


def test_letting_it_happen():
    state = table([["umbrella"], []], baskets=[["c3"], []], blankets=[[("wasp", 1)], []])
    go(state, 0, "pack")
    go(state, 0, "defend", card=None)
    assert state["scores"][0] == 0 and state["hands"][0] == ["umbrella"]


def test_shoo_sends_the_ants_home_with_their_snacks_for_you():
    state = table([["shoo"], ["s1"]], baskets=[["c3"], ["b2", "h1", "l3"]], blankets=[[("ants", 1)], []])
    go(state, 0, "pack")
    go(state, 0, "defend", card="shoo")
    # Ben holds no Shoo!, so it lands on Ben straight away: his two smallest come over.
    assert state["scores"][0] == 3 + 1 + 2 and state["baskets"][1] == ["l3"]
    assert engine.turn(state) == 1


def test_shoo_back_and_back_again_until_someone_has_none():
    state = table([["shoo", "shoo"], ["shoo"]], baskets=[["c3", "s1"], ["b2"]], blankets=[[("gull", 1)], []])
    go(state, 0, "pack")
    go(state, 0, "defend", card="shoo")
    assert engine.turn(state) == 1 and engine.view(state, 1)["defences"] == ["shoo"]
    go(state, 1, "defend", card="shoo")
    assert engine.turn(state) == 0
    # Sent back, an umbrella won't do.
    state_copy = {**state, "hands": [["shoo", "umbrella"], []]}
    assert engine.defences(state_copy, 0) == ["shoo"]
    go(state, 0, "defend", card="shoo")
    # Ben has no Shoo! left: the Seagull takes his 2 for Ann.
    assert state["scores"][0] == 3 + 1 + 2 and state["baskets"][1] == []
    shoos = [e for e in state["log"] if e["kind"] == "shoo"]
    assert [e["seat"] for e in shoos] == [0, 1, 0]


def test_someone_off_turn_can_only_move_when_its_on_them():
    state = table([["shoo"], ["shoo", "s1"]], baskets=[["c3"], ["b2"]], blankets=[[("ants", 1)], []])
    with pytest.raises(IllegalMove, match="isn't your turn"):
        go(state, 1, "lay", cards=["s1"])
    go(state, 0, "pack")
    go(state, 0, "defend", card="shoo")
    with pytest.raises(IllegalMove, match="trap is springing"):
        go(state, 0, "defend", card=None)
    with pytest.raises(IllegalMove, match="Shoo it"):
        go(state, 1, "lay", cards=["s1"])
    go(state, 1, "defend", card=None)
    assert engine.turn(state) == 1 and state["stage"] == "act"


def test_loot_always_fits_a_full_basket():
    state = table([["shoo"], []], baskets=[["s1"] * 5, ["b2", "b3"]], blankets=[[("ants", 1)], []])
    go(state, 0, "pack")
    go(state, 0, "defend", card="shoo")
    assert state["scores"][0] == 5 + 5


def test_an_empty_basket_packed_clears_the_blanket():
    state = table([[], ["s1"]], baskets=[[], ["b2"]], blankets=[[("dog", 1), ("ants", 1)], []])
    go(state, 0, "pack")
    assert state["blankets"][0] == [] and state["scores"][0] == 0


# --- the end of a turn and of the game --------------------------------------

def test_more_than_six_and_you_throw_some_away():
    state = table([["s1", "s1", "b1", "b1", "c1", "c1", "l1", "ants"], []])
    go(state, 0, "pass")
    assert state["stage"] == "discard" and engine.view(state, 0)["must_discard"] == 2
    with pytest.raises(IllegalMove, match="Throw away 2"):
        go(state, 0, "discard", cards=["s1"])
    go(state, 0, "discard", cards=["s1", "ants"])
    assert len(state["hands"][0]) == 6 and engine.turn(state) == 1


def test_reaching_twenty_plays_out_the_round_and_the_top_score_wins():
    state = table([[], [], []], turn=1, baskets=[[], ["c3", "h3"], ["b3", "s2"]], scores=[17, 15, 15])
    go(state, 1, "pack")
    assert state["scores"][1] == 21 and state["ending"] == 1 and state["phase"] == "play"
    go(state, 2, "pack")
    # Seat 2 reaches 20 too, but the top total wins.
    assert state["scores"][2] == 20
    assert state["phase"] == "game_over" and state["winners"] == [1]


def test_a_tie_at_the_top_is_shared():
    state = table([[], []], turn=1, baskets=[[], ["c3"]], scores=[20, 17], ending=0)
    go(state, 1, "pack")
    assert state["winners"] == [0, 1]


def test_rounds_count_from_the_first_seat():
    state = table([["s1"], ["s1"], ["s1"]], turn=2, round=3)
    go(state, 2, "pass")
    assert state["round"] == 4 and engine.turn(state) == 0


def test_an_empty_draw_pile_is_the_shuffled_discards():
    state = table([[], []], draw=[], discard=["s1", "b2", "c3"])
    state["discard"] = ["s1", "b2", "c3"]
    go(state, 0, "pass")
    assert len(state["hands"][1]) == 2 and state["reshuffles"] == 1


# --- secrets ----------------------------------------------------------------

def test_the_view_hides_hands_and_other_peoples_traps():
    state = table([["s1", "ants"], ["dog", "b1"], ["gull"]],
                  blankets=[[("dog", 1)], [("ants", 0)], [("gull", 0), ("wasp", 1)]])
    mine = engine.view(state, 0)
    assert mine["hand"] == ["s1", "ants"] and mine["hand_counts"] == [2, 2, 1]
    assert mine["blankets"][0] == [{"card": None, "mine": False}]
    assert mine["blankets"][1] == [{"card": "ants", "mine": True}]
    assert mine["blankets"][2] == [{"card": "gull", "mine": True}, {"card": None, "mine": False}]
    table_view = engine.view(state, "table")
    assert table_view["hand"] is None and table_view["hands"] is None
    assert all(t["card"] is None for b in table_view["blankets"] for t in b)


def test_the_log_hides_draws_and_traps_from_everyone_else():
    state = table([["ants", "s1"], ["b1"]])
    go(state, 0, "hide", card="ants", target=1)
    go(state, 0, "lay", cards=["s1"])
    mine = [e for e in engine.view(state, 0)["log"] if e["kind"] == "hide"][-1]
    theirs = [e for e in engine.view(state, 1)["log"] if e["kind"] == "hide"][-1]
    assert mine["card"] == "ants" and mine["seat"] == 0
    # Nor who hid it: the hider stays a secret until the trap springs.
    assert theirs["card"] is None and theirs["seat"] is None and theirs["target"] == 1
    table_hide = [e for e in engine.view(state, "table")["log"] if e["kind"] == "hide"][-1]
    assert table_hide["seat"] is None and table_hide["card"] is None
    draw = [e for e in engine.view(state, 0)["log"] if e["kind"] == "draw"][-1]
    assert draw["seat"] == 1 and draw["cards"] is None
    assert [e for e in engine.view(state, 1)["log"] if e["kind"] == "draw"][-1]["cards"]


# --- whole games ------------------------------------------------------------

def random_move(state, rng):
    """Any legal move for whoever has to make one."""
    seat = engine.turn(state)
    seen = engine.view(state, seat)
    if seen["stage"] == "spring":
        return seat, {"type": "defend", "card": rng.choice(seen["defences"] + [None])}
    if seen["stage"] == "discard":
        return seat, {"type": "discard", "cards": rng.sample(seen["hand"], seen["must_discard"])}
    traps = [c for c in seen["hand"] if engine.is_trap(c)]
    if traps and seen["hide_targets"] and rng.random() < 0.6:
        return seat, {"type": "hide", "card": rng.choice(traps), "target": rng.choice(seen["hide_targets"])}
    food = [c for c in seen["hand"] if engine.is_food(c)]
    options = [{"type": "pass"}]
    if seen["baskets"][seat] or seen["blankets"][seat]:
        options += [{"type": "pack"}] * 2
    if food and seen["basket_room"]:
        options += [{"type": "lay", "cards": rng.sample(food, min(len(food), seen["basket_room"], rng.choice([1, 2])))}] * 3
    return seat, rng.choice(options)


def test_random_games_never_lose_or_invent_a_card():
    for game_no in range(200):
        rng = random.Random(game_no)
        n = 2 + game_no % 3
        state = engine.new_game(rng, n, first=game_no % n)
        for _ in range(3000):
            if state["phase"] == "game_over":
                break
            seat, move = random_move(state, rng)
            engine.apply(state, seat, move)
            assert every_card(state) == Counter(engine.full_deck())
            assert all(len(b) <= engine.BLANKET for b in state["blankets"])
            assert all(len({t["by"] for t in b}) == len(b) for b in state["blankets"])
        else:
            raise AssertionError(f"game {game_no} never ended")
        assert state["winners"] and max(state["scores"]) >= engine.TARGET


@pytest.mark.parametrize("level", ai.LEVELS)
def test_the_computer_plays_itself_to_the_end(level):
    for game_no in range(60):
        rng = random.Random(game_no)
        n = 2 + game_no % 3
        state = engine.new_game(rng, n)
        seed = rng.getrandbits(32)
        for _ in range(3000):
            if state["phase"] == "game_over":
                break
            seat = engine.turn(state)
            engine.apply(state, seat, ai.choose(engine.view(state, seat), level, ai.move_rng(seed, state["seq"])))
        else:
            raise AssertionError(f"{level} game {game_no} never ended")


def test_hard_beats_easy():
    wins = Counter()
    games = 300
    for game_no in range(games):
        rng = random.Random(500 + game_no)
        state = engine.new_game(rng, 2, first=game_no % 2)
        levels = ["hard", "easy"] if game_no % 4 < 2 else ["easy", "hard"]
        seed = rng.getrandbits(32)
        while state["phase"] != "game_over":
            seat = engine.turn(state)
            engine.apply(state, seat, ai.choose(engine.view(state, seat), levels[seat], ai.move_rng(seed, state["seq"])))
        for w in state["winners"]:
            wins[levels[w]] += 1
    assert wins["hard"] > wins["easy"] * 1.2
