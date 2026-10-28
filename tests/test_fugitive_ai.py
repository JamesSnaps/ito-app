"""The computer opponent (games/fugitive/ai.py) and games against it.

What must hold whatever happens: the computer never makes a move the rules
refuse, every game it plays ends, and all it is ever shown is its own
seat's view. The fixture at the bottom pins its choices for the Swift port
that will play it offline, the way fugitive_engine_games.json pins the rules.
"""

import copy
import json
import os
import random
from pathlib import Path

import pytest

from games.fugitive import ai, engine
from test_fugitive_engine import random_move
from test_fugitive_play_api import room_state, send, sit, state
from test_smoke import client

ROOT = Path(__file__).resolve().parent.parent
AI_SCRIPTS = ROOT / "ios" / "GameNightTests" / "Fixtures" / "fugitive_ai_games.json"
PAIRINGS = [(f, m) for f in ai.LEVELS for m in ai.LEVELS]


def seat_view(game, role):
    from games.fugitive.game import seat_view
    return seat_view(game, role)


def play(seed, levels, rng_seed=None, cap=500):
    """A game where `levels[role]` is the computer's level for that seat, or
    None for a random legal player. Returns the finished state and every
    move, marking the computer's."""
    rng = random.Random(seed)
    state_ = engine.new_game(rng)
    moves = []
    for _ in range(cap):
        if state_["phase"] == "game_over":
            return state_, moves
        role = engine.turn(state_)
        level = levels.get(role)
        if level:
            move = ai.choose(seat_view(state_, role), level,
                             ai.move_rng(seed if rng_seed is None else rng_seed, state_["seq"]))
        else:
            role, move = random_move(state_, rng)
        # apply raises IllegalMove on anything the rules refuse.
        engine.apply(state_, role, copy.deepcopy(move))
        moves.append({"role": role, "move": move, "computer": bool(level)})
    raise AssertionError(f"game {seed} {levels} never ended")


@pytest.mark.parametrize("fugitive,marshal", PAIRINGS)
def test_the_computer_against_itself_always_finishes_legally(fugitive, marshal):
    reasons = set()
    for seed in range(60):
        finished, _ = play(seed, {"fugitive": fugitive, "marshal": marshal})
        assert finished["winner"] in engine.ROLES
        assert finished["reason"] != "resigned"
        reasons.add(finished["reason"])
    assert reasons <= {"caught", "escaped", "manhunt_failed"}


@pytest.mark.parametrize("level", ai.LEVELS)
@pytest.mark.parametrize("role", engine.ROLES)
def test_the_computer_against_a_random_player_always_finishes_legally(level, role):
    for seed in range(60):
        finished, moves = play(seed, {role: level})
        assert finished["phase"] == "game_over"
        assert any(m["computer"] for m in moves)


def test_hard_beats_easy_from_either_seat():
    """Not a strength benchmark — just that the levels mean something."""
    def fugitive_wins(f, m):
        return sum(play(seed, {"fugitive": f, "marshal": m})[0]["winner"] == "fugitive" for seed in range(80))

    assert fugitive_wins("hard", "hard") > fugitive_wins("easy", "hard")
    assert fugitive_wins("easy", "easy") > fugitive_wins("easy", "hard")


def test_the_fugitive_takes_42_the_moment_it_reaches():
    s = engine.new_game(random.Random(3))
    s["hands"]["fugitive"] = [5, 6, 40, 42]
    s["hideouts"].append({"card": 39, "sprints": [], "revealed": False})
    s["first_turn"], s["hides_left"] = False, 1
    move = ai.choose(seat_view(s, "fugitive"), "easy", ai.Mulberry32(1))
    assert move == {"type": "hide", "card": 42, "sprints": []}


def test_the_hard_marshal_names_every_pinned_hideout_at_once():
    s = engine.new_game(random.Random(3))
    s["hideouts"] += [{"card": 2, "sprints": [], "revealed": False},
                      {"card": 3, "sprints": [], "revealed": True}]
    s["hands"]["fugitive"] = [c for c in s["hands"]["fugitive"] if c not in (2, 3)]
    s["phase"], s["first_turn"] = "marshal_guess", False
    # Between 0 and the revealed 3, hideout 1 can only be 1 or 2; holding 1
    # leaves 2.
    s["hands"]["marshal"] = [1]
    assert seat_view(s, "marshal")["candidates"][1] == [2]
    assert ai.choose(seat_view(s, "marshal"), "hard", ai.Mulberry32(1)) == {"type": "guess", "numbers": [2]}


def test_the_computer_only_moves_on_its_own_turn():
    s = engine.new_game(random.Random(3))
    with pytest.raises(ValueError):
        ai.choose(seat_view(s, "marshal"), "hard", ai.Mulberry32(1))
    with pytest.raises(ValueError):
        ai.choose(seat_view(s, "table"), "hard", ai.Mulberry32(1))


def test_mulberry32_matches_the_javascript_one():
    """The first draws for seed 1, as fugitive.js's mulberry32 makes them
    (times 2**32) — the Swift port starts from the same numbers."""
    rng = ai.Mulberry32(1)
    assert [rng.next() for _ in range(3)] == [2693262067, 11749833, 2265367787]


# --- games against the computer, through the API ---------------------------

@pytest.fixture
def no_delay(monkeypatch):
    from games.fugitive import game
    monkeypatch.setattr(game, "COMPUTER_DELAY", 0)


def solo_game(c, you="fugitive", level="hard", name="Ana"):
    other = "marshal" if you == "fugitive" else "fugitive"
    res = c.post("/fugitive/api/play", json={you: name, "computer": {"role": other, "level": level}})
    assert res.status_code == 200, res.get_json()
    made = res.get_json()
    return made, sit(c, made["code"], you)


def test_a_game_against_the_computer_seats_it_and_says_so():
    c = client()
    made, token = solo_game(c, you="marshal", level="easy")
    assert made["players"] == {"fugitive": "Computer", "marshal": "Ana"}
    assert made["computer"] == {"role": "fugitive", "level": "easy"}
    assert made["seats"]["fugitive"]["taken"]
    # Its seat can't be sat in, freed, or reached with any token handed out.
    code = made["code"]
    assert c.post(f"/fugitive/api/play/{code}/seats/fugitive/claim").status_code == 409
    released = c.post(f"/fugitive/api/play/{code}/seats/fugitive/release",
                      headers={"X-Fugitive-Token": made["host_token"]})
    assert released.status_code == 400
    assert "seed" not in json.dumps(state(c, code, token))
    secret = room_state(code)["seats"]["fugitive"]
    assert secret not in json.dumps(made) and secret not in json.dumps(state(c, code, token))


def test_bad_computer_settings_are_refused():
    c = client()
    for computer in ("marshal", {"role": "table"}, {"role": "marshal", "level": "impossible"}, []):
        res = c.post("/fugitive/api/play", json={"fugitive": "Ana", "computer": computer})
        assert res.status_code == 400, computer
    # Your name can't be the computer's: the two need telling apart.
    res = c.post("/fugitive/api/play", json={"fugitive": "computer", "computer": {"role": "marshal"}})
    assert res.status_code == 400


def test_the_computer_waits_for_the_table_to_catch_up(monkeypatch):
    from games.fugitive import game
    monkeypatch.setattr(game, "COMPUTER_DELAY", 3600)
    c = client()
    made, token = solo_game(c, you="fugitive")
    send(c, made["code"], token, {"type": "hide", "card": 2, "sprints": []})
    send(c, made["code"], token, {"type": "pass"})
    assert state(c, made["code"], token)["game"]["phase"] == "marshal_draw"
    monkeypatch.setattr(game, "COMPUTER_DELAY", 0)
    # One move per look, so the table plays them out a beat apart.
    seq = state(c, made["code"], token)["game"]["seq"]
    assert state(c, made["code"], token)["game"]["seq"] == seq + 1


def play_against(c, code, token, you, seed):
    rng = random.Random(seed)
    for _ in range(1000):
        live = room_state(code)["game"]
        if live["phase"] == "game_over":
            return live
        if engine.turn(live) == you:
            _, move = random_move(live, rng)
            assert send(c, code, token, move).status_code == 200
        else:
            state(c, code, token)
    raise AssertionError("game never ended")


@pytest.mark.parametrize("you", engine.ROLES)
def test_a_game_against_the_computer_is_recorded_apart_from_the_leaderboard(no_delay, you):
    c = client()
    made, token = solo_game(c, you=you)
    finished = play_against(c, made["code"], token, you, seed=4)
    assert finished["recorded"] and finished["reason"] != "resigned"
    record = c.get("/fugitive/api/stats").get_json()
    # Not a game between people: the leaderboard never hears of it.
    assert record["games_played"] == 0 and record["leaderboard"] == []
    played = record["computer"]
    assert played["games_played"] == 1
    won = finished["winner"] == you
    assert played["recent"][0] == {**played["recent"][0], "name": "Ana", "role": you,
                                   "level": "hard", "won": won}
    [ana] = record["computer_leaderboard"]
    assert ana["name"] == "Ana" and ana["games"] == 1 and ana["wins"] == int(won)
    assert ana[f"{you}_hard_games"] == 1 and ana[f"{you}_hard_wins"] == int(won)
    assert ana["hard_wins"] == int(won) and ana["hard_games"] == 1 and ana["easy_games"] == 0
    # The computer has no row of its own.
    assert "computer" not in played["players"]
    page = c.get("/fugitive/stats").get_data(as_text=True)
    assert "Against the computer" in page and "Ana" in page and "No games yet" not in page


def test_the_computer_records_rank_wins_on_hard_first():
    from games.fugitive.game import add_computer_result, computer_leaderboard

    def finished(winner):
        return {"winner": winner, "reason": "caught", "hideouts": [0, 3]}

    record = {}
    for _ in range(3):  # Ben beats easy three times
        record = add_computer_result(record, {"fugitive": "Computer", "marshal": "Ben"},
                                     {"role": "fugitive", "level": "easy"}, finished("marshal"))
    record = add_computer_result(record, {"fugitive": "ana", "marshal": "Computer"},
                                 {"role": "marshal", "level": "hard"}, finished("fugitive"))
    record = add_computer_result(record, {"fugitive": "Ana", "marshal": "Computer"},
                                 {"role": "marshal", "level": "hard"}, finished("marshal"))
    rows = computer_leaderboard(record)
    assert [r["name"] for r in rows] == ["Ana", "Ben"]
    assert rows[0]["games"] == 2 and rows[0]["fugitive_hard_wins"] == 1 and rows[0]["win_rate"] == 50
    assert rows[1]["marshal_easy_wins"] == 3 and rows[1]["hard_wins"] == 0
    assert record["computer"]["games_played"] == 5


def test_the_computer_is_shown_only_its_own_seats_view(no_delay, monkeypatch):
    from games.fugitive import game

    seen_by_computer = []
    real = ai.choose

    def spy(seen, level, rng):
        live = room_state(code)["game"]
        role = room_state(code)["computer"]["role"]
        # Exactly what its seat's phone would be sent, and nothing else.
        assert seen == game.seat_view(live, role)
        assert seen["viewer"] == role
        seen_by_computer.append(copy.deepcopy(seen))
        return real(seen, level, rng)

    monkeypatch.setattr(ai, "choose", spy)
    c = client()
    made, token = solo_game(c, you="fugitive")
    code = made["code"]
    play_against(c, code, token, "fugitive", seed=2)
    assert seen_by_computer
    # Nothing in any of it gave away a hand or a face-down hideout — the
    # Fugitive's secrets as they stood at the end.
    final = room_state(code)["game"]
    for seen in seen_by_computer:
        assert all(h["card"] is None or h["revealed"] for h in seen["hideouts"])
        assert seen["hand"] is not None and not set(seen["hand"]) & set(final["hands"]["fugitive"])
        assert all(e.get("card") is None for e in seen["log"] if e["kind"] == "drew" and e["role"] == "fugitive")


def test_a_rematch_against_the_computer_swaps_its_seat_too(no_delay):
    c = client()
    made, token = solo_game(c, you="fugitive", level="easy")
    code = made["code"]
    play_against(c, code, token, "fugitive", seed=5)
    fresh = c.post(f"/fugitive/api/play/{code}/rematch", headers={"X-Fugitive-Token": made["host_token"]}).get_json()
    swapped = state(c, fresh["code"], token)
    assert swapped["computer"] == {"role": "fugitive", "level": "easy"}
    assert swapped["players"] == {"fugitive": "Computer", "marshal": "Ana"}
    assert swapped["you"] == {"role": "seat", "seat": "marshal"}
    # And it moved first — on that look — as the Fugitive now.
    assert swapped["game"]["seq"] == 1 and swapped["game"]["log"][0]["kind"] == "hid"


def test_a_game_against_the_computer_survives_a_restart(no_delay):
    from core.rooms import rooms

    c = client()
    made, token = solo_game(c, you="marshal")
    rooms._rooms.clear()
    back = state(c, made["code"], token)
    assert back["computer"]["role"] == "fugitive" and back["game"]["seq"] == 1


def test_the_setup_page_offers_the_computer():
    page = client().get("/fugitive/").get_data(as_text=True)
    assert "Against the computer" in page and '"Computer"' in page


# --- the Swift port's fixture ---------------------------------------------

def ai_scripts():
    """Seeded games for the Swift port to replay: every pairing of levels,
    and each level against a random player in each seat. A step the computer
    made is marked, and the Swift AI must choose that same move from that
    position's view."""
    games = []
    setups = [{"fugitive": f, "marshal": m} for f, m in PAIRINGS]
    setups += [{role: level} for role in engine.ROLES for level in ai.LEVELS]
    for n, levels in enumerate(setups):
        seed = 100 + n
        rng = random.Random(seed)
        decks = []
        for lo, hi in engine.DECKS:
            cards = list(range(lo, hi + 1))
            rng.shuffle(cards)
            decks.append(cards)
        ai_seed = random.Random(seed).getrandbits(32)
        s = engine.new_game(rng, decks=decks)
        steps = []
        for _ in range(500):
            if s["phase"] == "game_over":
                break
            role = engine.turn(s)
            if levels.get(role):
                move = ai.choose(seat_view(s, role), levels[role], ai.move_rng(ai_seed, s["seq"]))
            else:
                role, move = random_move(s, rng)
            engine.apply(s, role, copy.deepcopy(move))
            steps.append({"role": role, "move": move, "computer": bool(levels.get(role))})
        games.append({"levels": levels, "seed": ai_seed, "decks": decks, "steps": steps,
                      "reason": s["reason"]})
    rng = ai.Mulberry32(1)
    return {"mulberry32_seed_1": [rng.next() for _ in range(5)],
            "move_rng_seed_7_seq_3": [ai.move_rng(7, 3).next()],
            "games": games}


def test_the_swift_ai_scripts_still_match_the_ai():
    fresh = ai_scripts()
    if os.environ.get("WRITE_IOS_FIXTURES"):
        AI_SCRIPTS.write_text(json.dumps(fresh, separators=(",", ":")) + "\n")
    assert json.loads(AI_SCRIPTS.read_text()) == json.loads(json.dumps(fresh)), (
        "ai.py chooses differently from the Swift fixture: rewrite it with "
        "WRITE_IOS_FIXTURES=1 pytest tests -q -k ai_scripts and make the Swift AI agree")
