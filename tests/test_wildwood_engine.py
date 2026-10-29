"""Wildwood's rules: each one on a table set up by hand, then hundreds of
random games where no card may be lost or invented."""

import random
from collections import Counter

import pytest

from games.wildwood import ai, engine
from games.wildwood.engine import IllegalMove


def table(hands, top="r5", draw=None, turn=0, colour=None, **extra):
    """A game mid-play, built by hand: `hands` per seat, `top` on the pile."""
    state = engine.new_game(random.Random(1), len(hands))
    state.update({
        "hands": [sorted(h, key=engine.sort_key) for h in hands],
        "discard": ["g1", top],
        "draw": list(draw if draw is not None else ["b1", "b2", "b3", "b4", "b5", "b6"]),
        "colour": colour or engine.colour_of(top),
        "turn": turn,
        **extra,
    })
    return state


def play(state, seat, card, **more):
    return engine.apply(state, seat, {"type": "play", "card": card, **more})


def test_the_deck_is_104_of_our_own_spread():
    deck = engine.full_deck()
    assert len(deck) == 104
    counts = Counter(deck)
    assert counts["r7"] == 2 and counts["gS"] == 2 and counts["W"] == 4 and counts["W4"] == 4
    assert all(engine.is_card(c) for c in deck)
    assert not any(engine.is_card(c) for c in ("r0", "x5", "W2", "", None, 5))


def test_a_deal_gives_seven_each_and_starts_on_a_number():
    for n in (2, 3, 4):
        for seed in range(30):
            state = engine.new_game(random.Random(seed), n, first=1)
            assert [len(h) for h in state["hands"]] == [7] * n
            assert engine.is_number(state["discard"][-1])
            assert state["turn"] == 1 % n and state["colour"] == state["discard"][-1][0]
            everything = sum(state["hands"], []) + state["draw"] + state["discard"]
            assert Counter(everything) == Counter(engine.full_deck())


def test_actions_and_wilds_on_top_go_back_under_the_pile():
    # Top card last: the deal takes the top 14, then W4, rS and r3 are turned up.
    rest = engine.full_deck()
    for card in ("r3", "rS", "W4"):
        rest.remove(card)
    pile = rest[:-14] + ["r3", "rS", "W4"] + rest[-14:]
    state = engine.new_game(None, 2, deck=pile, shuffle_seed=1)
    assert state["discard"] == ["r3"]
    assert state["draw"][:2] == ["rS", "W4"]


def test_play_matches_colour_or_symbol():
    s = table([["r9", "g5", "b2", "y7"], ["r1"]], top="r5")
    assert engine.playable(s, 0) == ["r9", "g5"]
    with pytest.raises(IllegalMove, match="match"):
        play(s, 0, "b2")
    play(s, 0, "g5")
    assert s["colour"] == "g" and s["turn"] == 1


def test_only_the_player_to_move_can_play_or_draw():
    s = table([["r9"], ["r1"]])
    with pytest.raises(IllegalMove, match="isn't your turn"):
        play(s, 1, "r1")
    with pytest.raises(IllegalMove, match="isn't in your hand"):
        play(s, 0, "r1")


def test_skip_misses_the_next_player_and_reverse_turns_round():
    s = table([["rS", "r1"], ["r2"], ["r3"]])
    play(s, 0, "rS")
    assert s["turn"] == 2
    s = table([["rR", "r1", "r4"], ["r2"], ["r3"]])
    play(s, 0, "rR")
    assert s["direction"] == -1 and s["turn"] == 2


def test_between_two_a_reverse_is_a_skip():
    s = table([["rR", "r1", "r4"], ["r2"]])
    play(s, 0, "rR")
    assert s["turn"] == 0


def test_draw_twos_stack_and_the_last_player_takes_the_lot():
    s = table([["rD", "r1", "r4"], ["gD", "g1"], ["b7", "b8"]], top="r5")
    play(s, 0, "rD")
    assert s["stack"] == 2 and s["turn"] == 1
    assert engine.playable(s, 1) == ["gD"]
    with pytest.raises(IllegalMove, match="Take the 2 cards"):
        engine.apply(s, 1, {"type": "draw"})
    play(s, 1, "gD")
    assert s["stack"] == 4 and s["turn"] == 2
    assert engine.playable(s, 2) == []
    engine.apply(s, 2, {"type": "take"})
    assert len(s["hands"][2]) == 6 and s["stack"] == 0 and s["turn"] == 0


def test_a_bear_cant_be_stacked_and_a_draw_two_cant_go_on_it():
    s = table([["W4", "y1", "y2"], ["gD", "W4"], ["b7"]], top="r5")
    play(s, 0, "W4", colour="g")
    assert s["stack"] == 4 and s["colour"] == "g"
    assert engine.playable(s, 1) == []
    with pytest.raises(IllegalMove, match="Bear can't be stacked"):
        play(s, 1, "gD")
    engine.apply(s, 1, {"type": "take"})
    assert len(s["hands"][1]) == 6 and s["turn"] == 2


def test_the_bear_needs_no_card_of_the_colour_in_play():
    s = table([["W4", "r1", "g2"], ["b1"]], top="r5")
    assert "W4" not in engine.playable(s, 0)
    with pytest.raises(IllegalMove, match="no red cards"):
        play(s, 0, "W4", colour="g")
    s = table([["W4", "g1", "g2"], ["b1"]], top="r5")
    assert "W4" in engine.playable(s, 0)


def test_a_wild_needs_a_colour():
    s = table([["W", "g1"], ["b1"]])
    with pytest.raises(IllegalMove, match="Pick a colour"):
        play(s, 0, "W")
    play(s, 0, "W", colour="b")
    assert s["colour"] == "b" and s["discard"][-1] == "W"
    # On a wild, only the colour matters: no symbol to match.
    assert engine.playable(s, 1) == ["b1"]


def test_a_drawn_card_that_fits_may_be_played_or_kept():
    s = table([["g1", "g2"], ["b1"]], top="r5", draw=["y4", "r8"])
    engine.apply(s, 0, {"type": "draw"})
    assert s["drawn"] == "r8" and s["turn"] == 0
    assert engine.playable(s, 0) == ["r8"]
    with pytest.raises(IllegalMove, match="drawn already"):
        engine.apply(s, 0, {"type": "draw"})
    engine.apply(s, 0, {"type": "pass"})
    assert s["turn"] == 1 and "r8" in s["hands"][0]


def test_a_drawn_card_that_doesnt_fit_ends_the_turn():
    s = table([["g1", "g2"], ["b1"]], top="r5", draw=["y4", "b8"])
    engine.apply(s, 0, {"type": "draw"})
    assert s["drawn"] is None and s["turn"] == 1
    with pytest.raises(IllegalMove):
        engine.apply(s, 0, {"type": "pass"})


def test_the_first_empty_hand_wins():
    s = table([["r9"], ["r1", "r2"]])
    play(s, 0, "r9")
    assert s["phase"] == "game_over" and s["winner"] == 0 and engine.turn(s) is None
    with pytest.raises(IllegalMove, match="over"):
        play(s, 1, "r1")
    # Everyone's hand turns up at the end.
    assert engine.view(s, "table")["hands"] == [[], ["r1", "r2"]]


def test_last_card_called_with_the_play_is_safe():
    s = table([["r9", "r8"], ["r1", "r2"], ["g1"]])
    play(s, 0, "r9", call=True)
    assert s["exposed"] is None and s["log"][-1].get("called") is True
    with pytest.raises(IllegalMove, match="Nobody to catch"):
        engine.apply(s, 1, {"type": "catch"})


def test_a_forgotten_call_can_be_caught_until_the_next_player_moves():
    s = table([["r9", "r8"], ["r1", "r2"], ["g1", "g2"]])
    play(s, 0, "r9")
    assert s["exposed"] == 0
    with pytest.raises(IllegalMove, match="That's you"):
        engine.apply(s, 0, {"type": "catch"})
    # Anyone may catch, not only the next player.
    engine.apply(s, 2, {"type": "catch"})
    assert len(s["hands"][0]) == 3 and s["exposed"] is None
    assert s["log"][-2] == {**s["log"][-2], "kind": "catch", "seat": 0, "by": 2}
    assert s["turn"] == 1


def test_calling_late_still_counts_if_nobody_caught_you():
    s = table([["r9", "r8"], ["r1", "r2"]])
    play(s, 0, "r9")
    engine.apply(s, 0, {"type": "call"})
    assert s["exposed"] is None
    with pytest.raises(IllegalMove, match="one card"):
        engine.apply(s, 1, {"type": "call"})


def test_the_window_closes_when_the_next_player_moves():
    s = table([["r9", "r8"], ["r1", "r2", "r3"], ["g1", "g2"]])
    play(s, 0, "r9")
    play(s, 1, "r1")
    assert s["exposed"] is None
    with pytest.raises(IllegalMove, match="Nobody to catch"):
        engine.apply(s, 2, {"type": "catch"})


def test_an_empty_pile_is_refilled_from_the_discards_by_the_seed():
    s = table([["g1", "g2"], ["b1"]], top="r5", draw=[])
    s["discard"] = ["y1", "y2", "y3", "r5"]
    engine.apply(s, 0, {"type": "draw"})
    assert s["discard"] == ["r5"] and s["reshuffles"] == 1
    assert len(s["draw"]) == 2 and s["log"][-2]["kind"] == "reshuffle"
    again = table([["g1", "g2"], ["b1"]], top="r5", draw=[])
    again["discard"] = ["y1", "y2", "y3", "r5"]
    engine.apply(again, 0, {"type": "draw"})
    assert again["draw"] == s["draw"] and again["hands"] == s["hands"]


def test_a_draw_says_which_cards_only_to_whoever_drew_them():
    s = table([["g1", "g2"], ["b1"]], top="r5", draw=["y4", "b8"])
    engine.apply(s, 0, {"type": "draw"})
    entry = lambda viewer: engine.view(s, viewer)["log"][-1]
    assert entry(0)["cards"] == ["b8"]
    assert entry(1)["cards"] is None and entry("table")["cards"] is None
    assert engine.view(s, 1)["hand"] == ["b1"] and engine.view(s, "table")["hand"] is None
    assert engine.view(s, 1)["hand_counts"] == [3, 1]


def test_the_drawn_card_is_only_shown_to_its_player():
    s = table([["g1", "g2"], ["b1"]], top="r5", draw=["y4", "r8"])
    engine.apply(s, 0, {"type": "draw"})
    assert engine.view(s, 0)["drawn"] == "r8"
    assert engine.view(s, 1)["drawn"] is None and engine.view(s, 1)["deciding"] is True


def test_moves_that_arent_moves_are_refused():
    s = table([["r9"], ["r1"]])
    for seat, move in ((0, {"type": "fly"}), (0, {}), (5, {"type": "draw"}), (True, {"type": "draw"}),
                       (0, {"type": "play", "card": "r9", "call": "yes"}),
                       (0, {"type": "play", "card": ["r9"]})):
        with pytest.raises(IllegalMove):
            engine.apply(s, seat, move)


def random_move(state, rng):
    """Any legal move for whoever may make one: the player to move, or —
    now and then — someone calling or catching."""
    seat = state["turn"]
    if state["exposed"] is not None and rng.random() < 0.5:
        others = [s for s in range(state["players"]) if s != state["exposed"]]
        if rng.random() < 0.5:
            return state["exposed"], {"type": "call"}
        return rng.choice(others), {"type": "catch"}
    options = engine.playable(state, seat)
    if state["stack"] and not options:
        return seat, {"type": "take"}
    if state["drawn"] is not None and (not options or rng.random() < 0.3):
        return seat, {"type": "pass"}
    if options and (state["stack"] or state["drawn"] is not None or rng.random() < 0.85):
        card = rng.choice(options)
        move = {"type": "play", "card": card, "call": rng.random() < 0.5}
        if card in engine.WILDS:
            move["colour"] = rng.choice(engine.COLOURS)
        return seat, move
    if state["stack"]:
        return seat, {"type": "take"}
    return seat, {"type": "draw"}


def test_random_games_never_lose_or_invent_a_card():
    for game_no in range(200):
        rng = random.Random(game_no)
        n = 2 + game_no % 3
        state = engine.new_game(rng, n, first=game_no % n)
        moves = 0
        while state["phase"] != "game_over":
            seat, move = random_move(state, rng)
            engine.apply(state, seat, move)
            moves += 1
            everything = sum(state["hands"], []) + state["draw"] + state["discard"]
            assert Counter(everything) == Counter(engine.full_deck())
            assert state["stack"] % 2 == 0
            if state["phase"] != "game_over":
                # A view holds its own hand and nobody else's cards.
                for viewer in list(range(n)) + ["table"]:
                    seen = engine.view(state, viewer)
                    assert seen["hand"] == (None if viewer == "table" else state["hands"][viewer])
                    assert seen["hands"] is None
                    assert all(e["cards"] is None for e in seen["log"]
                               if e["kind"] == "draw" and e["seat"] != viewer)
            assert moves < 4000
        assert not state["hands"][state["winner"]]


def test_computers_finish_every_game_and_hard_beats_easy():
    wins = Counter()
    for game_no in range(300):
        rng = random.Random(game_no)
        n = 2 + game_no % 3
        state = engine.new_game(rng, n, first=game_no % n)
        levels = ["hard" if (seat + game_no) % 2 else "easy" for seat in range(n)]
        seed = rng.getrandbits(32)
        while state["phase"] != "game_over":
            seat = state["turn"]
            move = ai.choose(engine.view(state, seat), levels[seat], ai.move_rng(seed, state["seq"]))
            engine.apply(state, seat, move)
        wins[levels[state["winner"]]] += 1
    assert wins["hard"] > 1.5 * wins["easy"], wins
