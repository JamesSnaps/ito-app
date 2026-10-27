"""The Fugitive rules, played out turn by turn.

Most tests rig the starting hand with `game_with_hand()`, so each one reads
as the table would. The last test plays hundreds of random games to check
what must hold whatever happens: no card is lost or invented, hideouts only
go up, nobody's view leaks a hidden card, and the Marshal's deduction never
rules out where the Fugitive really is.
"""

import json
import random

import pytest

from games.fugitive.engine import (
    DECKS,
    ESCAPE_CARD,
    IllegalMove,
    apply,
    candidates,
    footprints,
    hide_error,
    new_game,
    turn,
    view,
)


class NoShuffle:
    def shuffle(self, cards):
        pass


def game_with_hand(hand):
    """A game whose Fugitive holds exactly `hand`; every other card from
    4–41 is in the decks, in order, so draws are predictable."""
    state = new_game(NoShuffle())
    state["decks"] = [
        [c for c in range(lo, hi + 1) if c not in hand] for lo, hi in DECKS
    ]
    state["hands"]["fugitive"] = sorted(hand)
    return state


def play(state, role, **move):
    return apply(state, role, move)


def refused(state, role, **move):
    before = json.dumps(state, sort_keys=True)
    with pytest.raises(IllegalMove) as err:
        apply(state, role, move)
    assert json.dumps(state, sort_keys=True) == before, "a refused move changed the game"
    return str(err.value)


def at_marshal_guess():
    """The Fugitive hides at 2 and then 5 (with 1 sprinting, which wasn't
    needed); the Marshal draws twice from the low deck."""
    s = game_with_hand([1, 2, 3, 5, 7, 9])
    play(s, "fugitive", type="hide", card=2, sprints=[])
    play(s, "fugitive", type="hide", card=5, sprints=[1])
    play(s, "marshal", type="draw", deck=0)
    play(s, "marshal", type="draw", deck=0)
    assert s["phase"] == "marshal_guess"
    return s


# --- setup and the first turns --------------------------------------------

def test_the_fugitive_starts_with_1_2_3_42_and_five_drawn():
    s = new_game(random.Random(7))
    hand = s["hands"]["fugitive"]
    assert len(hand) == 9 and {1, 2, 3, 42} <= set(hand)
    drawn = [c for c in hand if c not in (1, 2, 3, 42)]
    assert len([c for c in drawn if 4 <= c <= 14]) == 3
    assert len([c for c in drawn if 15 <= c <= 28]) == 2
    assert [len(d) for d in s["decks"]] == [8, 12, 13]
    assert s["hands"]["marshal"] == []
    assert s["hideouts"] == [{"card": 0, "sprints": [], "revealed": True}]
    assert turn(s) == "fugitive"


def test_first_turn_places_one_or_two_and_the_marshal_then_draws_two():
    s = game_with_hand([1, 2, 3, 42])
    assert "at least one" in refused(s, "fugitive", type="pass")
    play(s, "fugitive", type="hide", card=2, sprints=[])
    assert s["phase"] == "fugitive_hide" and s["hides_left"] == 1
    play(s, "fugitive", type="hide", card=3, sprints=[])
    assert s["phase"] == "marshal_draw" and s["draws_left"] == 2

    s = game_with_hand([1, 2, 3, 42])
    play(s, "fugitive", type="hide", card=3, sprints=[])
    play(s, "fugitive", type="pass")
    assert s["phase"] == "marshal_draw"
    # Stopping after one opening hideout isn't "not hiding": no extra card.
    assert len(s["hands"]["fugitive"]) == 3


# --- hiding and sprinting -------------------------------------------------

def test_hideouts_go_up_by_at_most_three_unless_sprinting():
    s = game_with_hand([1, 2, 3, 4, 5, 6])
    assert "only reaches 3" in refused(s, "fugitive", type="hide", card=4, sprints=[])
    assert hide_error(s, 4, [1]) is None


def test_sprints_add_their_footprints_and_overpaying_is_allowed():
    assert footprints(10) == 2 and footprints(1) == 1 and footprints(ESCAPE_CARD) == 0
    s = game_with_hand([1, 2, 6, 8, 10])
    assert "only reaches 5" in refused(s, "fugitive", type="hide", card=6, sprints=[1, 2])
    play(s, "fugitive", type="hide", card=6, sprints=[10, 2, 1])
    assert s["hideouts"][1] == {"card": 6, "sprints": [1, 2, 10], "revealed": False}
    assert s["hands"]["fugitive"] == [8]


def test_bad_hides_are_refused_untouched():
    s = game_with_hand([1, 2, 3, 5, 42])
    play(s, "fugitive", type="hide", card=3, sprints=[])
    assert "go up" in refused(s, "fugitive", type="hide", card=2, sprints=[])
    assert "hideout and a sprint" in refused(s, "fugitive", type="hide", card=5, sprints=[5])
    assert "once" in refused(s, "fugitive", type="hide", card=5, sprints=[1, 1])
    assert "don't hold" in refused(s, "fugitive", type="hide", card=7, sprints=[])
    assert "can't be used to sprint" in refused(s, "fugitive", type="hide", card=5, sprints=[42])
    assert refused(s, "fugitive", type="hide", card=True, sprints=[])
    assert refused(s, "fugitive", type="hide", card=5, sprints="1")


def test_not_hiding_draws_from_the_lowest_deck_that_has_cards():
    s = at_marshal_guess()
    play(s, "marshal", type="guess", numbers=[9])
    play(s, "fugitive", type="draw", deck=2)
    s["decks"][0] = []
    before = len(s["hands"]["fugitive"])
    play(s, "fugitive", type="pass")
    assert len(s["hands"]["fugitive"]) == before + 1
    assert [e["kind"] for e in s["log"][-2:]] == ["passed", "drew"]
    assert s["log"][-1]["deck"] == 1
    # The Marshal sees which deck, never which card.
    assert view(s, "marshal")["log"][-1]["card"] is None
    assert s["phase"] == "marshal_draw" and s["draws_left"] == 1


# --- guessing -------------------------------------------------------------

def test_a_right_guess_turns_the_hideout_and_its_sprints_over():
    s = play(at_marshal_guess(), "marshal", type="guess", numbers=[5])
    assert s["hideouts"][2] == {"card": 5, "sprints": [1], "revealed": True}
    assert not s["hideouts"][1]["revealed"]
    assert s["phase"] == "fugitive_draw"


def test_several_numbers_reveal_nothing_unless_all_are_right():
    s = play(at_marshal_guess(), "marshal", type="guess", numbers=[2, 4])
    assert sum(h["revealed"] for h in s["hideouts"]) == 1
    assert s["log"][-1] == {"id": s["event"], "kind": "guessed", "numbers": [2, 4],
                            "hit": False, "revealed": []}


def test_finding_every_hideout_catches_the_fugitive():
    s = play(at_marshal_guess(), "marshal", type="guess", numbers=[5, 2])
    assert (s["phase"], s["winner"], s["reason"]) == ("game_over", "marshal", "caught")


def test_bad_guesses_are_refused_untouched():
    s = at_marshal_guess()
    assert "at least one" in refused(s, "marshal", type="guess", numbers=[])
    assert "1 to 41" in refused(s, "marshal", type="guess", numbers=[42])
    assert "once" in refused(s, "marshal", type="guess", numbers=[4, 4])
    assert refused(s, "marshal", type="guess", numbers=[True])
    assert refused(s, "marshal", type="guess", numbers="5")
    play(s, "marshal", type="guess", numbers=[5])
    play(s, "fugitive", type="draw", deck=1)
    play(s, "fugitive", type="pass")
    play(s, "marshal", type="draw", deck=1)
    assert "already turned over" in refused(s, "marshal", type="guess", numbers=[5])


def test_out_of_turn_and_unknown_moves_are_refused():
    s = at_marshal_guess()
    assert "your turn" in refused(s, "fugitive", type="pass")
    assert refused(s, "marshal", type="hide", card=4, sprints=[])
    assert refused(s, "dealer", type="pass")
    play(s, "marshal", type="guess", numbers=[9])
    s["decks"][0] = []
    assert "empty" in refused(s, "fugitive", type="draw", deck=0)
    assert refused(s, "fugitive", type="draw", deck=3)


def test_drawing_is_skipped_once_every_deck_is_empty():
    s = at_marshal_guess()
    s["decks"] = [[], [], []]
    play(s, "marshal", type="guess", numbers=[9])
    assert s["phase"] == "fugitive_hide"
    play(s, "fugitive", type="pass")
    assert s["phase"] == "marshal_guess"


def test_either_player_can_resign_at_any_time():
    s = play(new_game(random.Random(3)), "marshal", type="resign")
    assert (s["winner"], s["reason"]) == ("fugitive", "resigned")
    assert "over" in refused(s, "fugitive", type="pass")


# --- escaping -------------------------------------------------------------

def on_the_verge(revealed_up_to):
    """The Fugitive's trail runs to 40 and they hold 42; the Marshal has
    found every hideout up to `revealed_up_to`."""
    s = game_with_hand([42])
    s["hideouts"] = [{"card": c, "sprints": [], "revealed": c <= revealed_up_to}
                     for c in (0, 10, 20, 30, 40)]
    s["phase"], s["first_turn"], s["hides_left"] = "fugitive_hide", False, 1
    return s


def test_42_escapes_at_once_if_the_marshal_has_found_anything_above_29():
    s = play(on_the_verge(30), "fugitive", type="hide", card=42, sprints=[])
    assert (s["winner"], s["reason"]) == ("fugitive", "escaped")


def test_otherwise_42_starts_a_manhunt_of_single_guesses():
    s = play(on_the_verge(20), "fugitive", type="hide", card=42, sprints=[])
    assert s["phase"] == "manhunt" and s["hideouts"][-1]["revealed"]
    assert "one hideout at a time" in refused(s, "marshal", type="guess", numbers=[30, 40])
    play(s, "marshal", type="guess", numbers=[30])
    assert s["phase"] == "manhunt"
    play(s, "marshal", type="guess", numbers=[40])
    assert (s["winner"], s["reason"]) == ("marshal", "caught")


def test_one_miss_in_a_manhunt_or_letting_them_go_is_an_escape():
    hunt = play(on_the_verge(20), "fugitive", type="hide", card=42, sprints=[])
    missed = play(json.loads(json.dumps(hunt)), "marshal", type="guess", numbers=[31])
    assert (missed["winner"], missed["reason"]) == ("fugitive", "manhunt_failed")
    let_go = play(hunt, "marshal", type="let_go")
    assert (let_go["winner"], let_go["reason"]) == ("fugitive", "let_go")


def test_what_42_sprinted_with_stays_hidden():
    s = on_the_verge(20)
    s["hands"]["fugitive"] = [5, 42]
    play(s, "fugitive", type="hide", card=42, sprints=[5])
    assert view(s, "marshal")["hideouts"][-1] == {
        "card": 42, "sprint_count": 1, "sprints": None, "revealed": True}


# --- views ----------------------------------------------------------------

def test_the_marshal_and_the_table_see_no_face_down_card():
    s = at_marshal_guess()
    for viewer in ("marshal", "table"):
        v = view(s, viewer)
        assert [h["card"] for h in v["hideouts"]] == [0, None, None]
        assert v["hideouts"][2]["sprint_count"] == 1 and v["hideouts"][2]["sprints"] is None
        assert all(e.get("card") in (None, *s["hands"]["marshal"]) for e in v["log"])
    assert view(s, "marshal")["hand"] == s["hands"]["marshal"]
    assert view(s, "table")["hand"] is None
    assert view(s, "table")["hand_counts"] == {"fugitive": 3, "marshal": 2}
    assert [h["card"] for h in view(s, "fugitive")["hideouts"]] == [0, 2, 5]
    # Nor does the Fugitive see what the Marshal drew.
    assert [e["card"] for e in view(s, "fugitive")["log"] if e["kind"] == "drew"] == [None, None]


def test_everything_is_turned_up_at_the_end():
    s = play(at_marshal_guess(), "fugitive", type="resign")
    v = view(s, "table")
    assert [h["card"] for h in v["hideouts"]] == [0, 2, 5]
    assert v["hideouts"][2]["sprints"] == [1]


# --- deduction --------------------------------------------------------------

def test_deduction_narrows_a_hideout_between_known_neighbours():
    s = play(at_marshal_guess(), "marshal", type="guess", numbers=[5])
    sets = candidates(view(s, "marshal"))
    assert 2 in sets[1]
    assert all(0 < c < 5 and c != 1 and c not in s["hands"]["marshal"] for c in sets[1])


def test_a_missed_number_is_only_ruled_out_for_hideouts_already_down():
    s = play(at_marshal_guess(), "marshal", type="guess", numbers=[7])
    assert 7 not in sum(candidates(view(s, "marshal")), [])
    play(s, "fugitive", type="draw", deck=2)
    play(s, "fugitive", type="hide", card=7, sprints=[])
    play(s, "marshal", type="draw", deck=2)
    sets = candidates(view(s, "marshal"))
    assert 7 not in sets[1] and 7 not in sets[2] and 7 in sets[3]


# --- random games -----------------------------------------------------------

def random_move(state, rng):
    """Something legal for whoever's turn it is. The Fugitive spends the
    fewest sprint cards that reach; the Marshal guesses from the deduced
    candidates, so games actually end."""
    role = turn(state)
    if state["phase"] in ("fugitive_draw", "marshal_draw"):
        return role, {"type": "draw", "deck": rng.choice([i for i, d in enumerate(state["decks"]) if d])}
    if state["phase"] == "fugitive_hide":
        hand = state["hands"]["fugitive"]
        last = state["hideouts"][-1]["card"]
        options = []
        for card in hand:
            sprints, reach = [], 3
            for c in hand:
                if card - last <= reach:
                    break
                if c != card and footprints(c):
                    sprints.append(c)
                    reach += footprints(c)
            if hide_error(state, card, sprints) is None:
                options.append({"type": "hide", "card": card, "sprints": sprints})
        must = state["first_turn"] and state["placed"] == 0
        if not must and (not options or rng.random() < 0.2):
            return role, {"type": "pass"}
        return role, rng.choice(options)
    sets = candidates(view(state, "marshal"))
    open_sets = [s for i, s in enumerate(sets) if not state["hideouts"][i]["revealed"] and s]
    assert open_sets, "no hidden hideout has a candidate left"
    return role, {"type": "guess", "numbers": [rng.choice(rng.choice(open_sets))]}


@pytest.mark.parametrize("seed", range(300))
def test_random_games_keep_every_card_and_every_secret(seed):
    rng = random.Random(seed)
    s = new_game(rng)
    for _ in range(500):
        if s["phase"] == "game_over":
            break
        cards = sorted(sum(s["decks"], []) + s["hands"]["fugitive"] + s["hands"]["marshal"]
                       + [c for h in s["hideouts"] for c in [h["card"], *h["sprints"]]])
        assert cards == list(range(43))
        trail = [h["card"] for h in s["hideouts"]]
        assert trail == sorted(trail)

        marshal = view(s, "marshal")
        seen = json.dumps(marshal)
        secret = set(s["hands"]["fugitive"]) | {h["card"] for h in s["hideouts"] if not h["revealed"]}
        assert not any(f'"card": {c},' in seen or f'"card": {c}}}' in seen for c in secret)
        if s["phase"] in ("marshal_guess", "manhunt"):
            for i, options in enumerate(candidates(marshal)):
                assert s["hideouts"][i]["card"] in options

        role, move = random_move(s, rng)
        seq = s["seq"]
        apply(s, role, move)
        assert s["seq"] == seq + 1
    assert s["phase"] == "game_over" and s["winner"] in ("fugitive", "marshal")
