"""The Flip 7 rules, played out card by card.

Most tests rig the deck — `rigged()` puts the named cards on top in that
order — so each one reads as the table would: who was dealt what, who hit,
what came up. The last test plays hundreds of random games to check the
things that must hold whatever happens: no card is ever lost or invented,
and the game never stalls without asking somebody something.
"""

import json
import random
from collections import Counter

import pytest

from games.flip7.engine import (
    IllegalMove,
    apply,
    cards_on_table,
    full_deck,
    new_game,
    public_view,
    score_hand,
)

A, B, C = 0, 1, 2


class NoShuffle:
    def shuffle(self, cards):
        pass


def rigged(top, names=("Ana", "Ben", "Cat")):
    deck = full_deck()
    for card in top:
        deck.remove(card)
    return new_game(list(names), NoShuffle(), deck=list(top) + deck)


def move(state, kind, player=None, target=None):
    return apply(state, {"type": kind, "player": player, "target": target}, NoShuffle())


def hand(state, p):
    return state["players"][p]["hand"]


def turn(state):
    assert state["pending"]["kind"] == "turn"
    return state["pending"]["player"]


def all_cards(state):
    cards = state["deck"] + state["discard"]
    for player in state["players"]:
        cards += cards_on_table(player["hand"])
    # A card waiting for someone to pick its target is in nobody's hand yet.
    if state["pending"] and state["pending"]["kind"] == "give":
        cards.append(state["pending"]["card"])
    return Counter(cards)


def test_the_deck_is_the_printed_one():
    deck = Counter(full_deck())
    assert sum(deck.values()) == 94
    assert deck["n0"] == 1
    for n in range(1, 13):
        assert deck[f"n{n}"] == n
    for card in ("+2", "+4", "+6", "+8", "+10", "x2"):
        assert deck[card] == 1
    for card in ("freeze", "flip3", "chance"):
        assert deck[card] == 3


def test_deal_goes_round_from_the_dealers_left_and_play_follows():
    state = rigged(["n1", "n2", "n3"])
    # The dealer sits before the first name, so the first name typed is
    # dealt to first and plays first.
    assert state["dealer"] == C
    assert [hand(state, p)["numbers"] for p in (A, B, C)] == [[1], [2], [3]]
    assert turn(state) == A


def test_a_duplicate_busts_and_takes_the_modifiers_with_it():
    state = rigged(["n5", "n6", "n7", "+4", "n5"])
    move(state, "hit", A)          # +4
    move(state, "stay", B)
    move(state, "stay", C)
    assert turn(state) == A
    move(state, "hit", A)          # 5 again
    assert state["phase"] == "round_over"
    assert [r[-1] for r in (p["rounds"] for p in state["players"])] == [
        {"score": 0, "bust": True, "flip7": False},
        {"score": 6, "bust": False, "flip7": False},
        {"score": 7, "bust": False, "flip7": False},
    ]
    assert hand(state, A)["bust_card"] == 5


def test_flip_7_ends_the_round_and_everyone_else_still_scores():
    state = rigged(
        ["n1", "n12", "n2", "+2", "n3", "+4", "n4", "+6", "n5", "+8", "n6", "+10", "n7"],
        names=("Ana", "Ben"),
    )
    for _ in range(6):
        move(state, "hit", A)
        if state["phase"] == "playing":
            move(state, "hit", B)
    assert state["phase"] == "round_over"
    assert state["last_round"]["flip7_by"] == A
    assert state["players"][A]["rounds"][-1] == {"score": 28 + 15, "bust": False, "flip7": True}
    # Ben was still in when it ended, and banks what he had.
    assert state["players"][B]["rounds"][-1]["score"] == 12 + 30


def test_second_chance_saves_one_bust():
    state = rigged(["n5", "n6", "n7", "chance", "n5"])
    move(state, "hit", A)          # Second Chance
    move(state, "stay", B)
    move(state, "stay", C)
    move(state, "hit", A)          # 5 again — saved
    assert state["players"][A]["status"] == "active"
    assert hand(state, A)["numbers"] == [5]
    assert hand(state, A)["chance"] is False
    assert Counter(state["discard"]) == Counter(["n5", "chance"])


def test_a_second_second_chance_must_be_given_away():
    state = rigged(["chance", "n6", "n7", "chance"])
    move(state, "hit", A)
    assert state["pending"] == {"kind": "give", "player": A, "card": "chance", "options": [B, C]}
    with pytest.raises(IllegalMove):
        move(state, "give", A, A)
    move(state, "give", A, C)
    assert hand(state, C)["chance"] is True
    assert turn(state) == B


def test_a_second_chance_nobody_can_take_is_discarded():
    state = rigged(["chance", "chance", "chance"], names=("Ana", "Ben"))
    move(state, "hit", A)
    assert "chance" in state["discard"]
    assert turn(state) == B


def test_freeze_goes_to_any_active_player_including_yourself():
    state = rigged(["n1", "n2", "n3", "n4", "n5", "freeze"])
    move(state, "hit", A)
    move(state, "hit", B)
    move(state, "stay", C)
    move(state, "hit", A)          # Freeze
    assert state["pending"]["options"] == [A, B]
    with pytest.raises(IllegalMove):
        move(state, "give", A, C)  # already stayed
    move(state, "give", A, B)
    assert state["players"][B]["status"] == "frozen"
    assert turn(state) == A        # Ben's out and Cat stayed


def test_the_last_one_in_freezes_themself_without_being_asked():
    state = rigged(["n1", "n2", "freeze"], names=("Ana", "Ben"))
    move(state, "stay", A)
    move(state, "hit", B)
    assert state["players"][B]["status"] == "frozen"
    assert state["phase"] == "round_over"


def test_flip_three_holds_actions_until_the_three_are_drawn():
    state = rigged(["n1", "n2", "n3", "flip3", "n4", "flip3", "n5", "n6", "n7", "n8"])
    move(state, "hit", A)
    move(state, "give", A, B)
    # Ben drew 4, a Flip Three (held) and 5 — and now gives the held one.
    assert hand(state, B)["numbers"] == [2, 4, 5]
    assert state["pending"]["kind"] == "give" and state["pending"]["player"] == B
    move(state, "give", B, C)
    assert hand(state, C)["numbers"] == [3, 6, 7, 8]
    assert turn(state) == B


def test_flip_three_stops_at_a_bust_and_voids_what_was_held():
    state = rigged(["n1", "n2", "n3", "flip3", "freeze", "n2", "n9"])
    move(state, "hit", A)
    move(state, "give", A, B)
    assert state["players"][B]["status"] == "busted"
    assert "freeze" in state["discard"]
    assert state["deck"][0] == "n9"    # the third card was never drawn
    assert turn(state) == C


def test_flip_three_in_the_deal_pauses_it():
    state = rigged(["flip3", "n1", "n2", "n3", "n4"])
    assert state["pending"] == {"kind": "give", "player": A, "card": "flip3", "options": [A, B, C]}
    move(state, "give", A, C)
    # Cat drew three, the deal carried on to Ben, and skipped Cat.
    assert hand(state, C)["numbers"] == [1, 2, 3]
    assert hand(state, B)["numbers"] == [4]
    assert turn(state) == A
    with pytest.raises(IllegalMove):
        move(state, "stay", A)     # nothing in front of her yet


def test_out_of_turn_and_unknown_moves_are_refused_untouched():
    state = rigged(["n1", "n2", "n3"])
    before = json.dumps(state)
    for bad in ({"type": "hit", "player": B}, {"type": "give", "player": A, "target": B},
                {"type": "next_round"}, {"type": "hit", "player": True},
                {"type": "hit", "player": 9}, {"type": "dance", "player": A}):
        with pytest.raises(IllegalMove):
            apply(state, bad, NoShuffle())
    assert json.dumps(state) == before


def test_rounds_carry_the_deck_over_and_reshuffle_only_discards():
    state = new_game(["Ana", "Ben"], random.Random(1), deck=["n1", "n2", "n3"])
    move(state, "stay", A)
    move(state, "stay", B)
    move(state, "next_round")
    assert state["dealer"] == A
    # Ben is dealt the last card in the deck; Ana's comes from last round's
    # discards, reshuffled. Ben's 3 is on the table, so it isn't in there.
    assert hand(state, B)["numbers"] == [3]
    assert hand(state, A)["numbers"][0] in (1, 2)
    assert any(e["kind"] == "reshuffle" for e in state["log"])
    assert all_cards(state) == Counter(["n1", "n2", "n3"])


def test_no_cards_left_anywhere_ends_the_round():
    state = new_game(["Ana", "Ben"], random.Random(1), deck=["n1", "n2"])
    move(state, "hit", A)
    assert state["phase"] == "round_over"
    assert state["last_round"]["exhausted"] is True
    assert [p["total"] for p in state["players"]] == [1, 2]


def test_scoring_matches_the_scorekeeper():
    blank = {"numbers": [], "mods": [], "x2": False}
    assert score_hand({**blank, "numbers": [12, 11], "mods": [10]}, bust=True) == 0
    assert score_hand({**blank, "numbers": [3, 4], "mods": [2], "x2": True}) == 16
    assert score_hand({**blank, "numbers": [0, 1, 2, 3, 4, 5, 6]}) == 21 + 15
    assert score_hand({**blank, "numbers": [5], "mods": [2, 4]}) == 11


def test_crossing_200_ends_the_game_and_ties_share_it():
    state = rigged(["n5", "n5", "n9"], names=("Ana", "Ben", "Cat"))
    state["players"][A]["total"] = 195
    state["players"][B]["total"] = 195
    for p in (A, B, C):
        move(state, "stay", p)
    assert state["phase"] == "game_over"
    assert state["winners"] == [A, B]
    with pytest.raises(IllegalMove):
        move(state, "next_round")


def test_the_view_hides_the_deck():
    view = public_view(rigged(["n1", "n2", "n3"]))
    assert "deck" not in view and "tasks" not in view
    assert view["deck_count"] == 91
    assert [p["round_score"] for p in view["players"]] == [1, 2, 3]


def legal_moves(state):
    pending = state["pending"]
    if state["phase"] == "round_over":
        return [{"type": "next_round"}]
    if pending["kind"] == "give":
        return [{"type": "give", "player": pending["player"], "target": t}
                for t in pending["options"]]
    p = pending["player"]
    moves = [{"type": "hit", "player": p}]
    if cards_on_table(state["players"][p]["hand"]):
        moves.append({"type": "stay", "player": p})
    return moves


@pytest.mark.parametrize("seed", range(200))
def test_random_games_never_lose_a_card_or_stall(seed):
    rng = random.Random(seed)
    names = [f"P{i}" for i in range(rng.randint(2, 8))]
    state = new_game(names, rng)
    for _ in range(3000):
        assert all_cards(state) == Counter(full_deck())
        # The state is saved as JSON after every move; it has to survive that.
        state = json.loads(json.dumps(state))
        if state["phase"] == "game_over":
            break
        assert state["phase"] == "round_over" or state["pending"] is not None
        # Hitting more often than staying, like people do.
        options = legal_moves(state)
        choice = options[0] if len(options) > 1 and rng.random() < 0.6 else rng.choice(options)
        apply(state, choice, rng)
    assert state["phase"] == "game_over"
    assert max(p["total"] for p in state["players"]) >= 200
