"""Fugitive offline: the rules in Swift, pinned to these ones, and offline
games coming home to be recorded.

The iOS app plays Fugitive without the server on a plane, so its Swift port
of engine.py has to agree with it move for move. `engine_scripts()` plays
seeded games here — legal moves and refused ones — and writes down what
every seat sees after each move. The Swift tests replay the same moves and
must produce the same views and the same refusals, word for word
(ios/GameNightTests/Fixtures/fugitive_engine_games.json). This file checks
the fixture still matches the engine; when the rules change on purpose,
rewrite it with WRITE_IOS_FIXTURES=1 pytest tests -q -k engine_scripts and
make the Swift tests pass again.
"""

import copy
import json
import random
from pathlib import Path

from games.fugitive.engine import (
    DECKS,
    ESCAPE_CARD,
    IllegalMove,
    MAX_STEP,
    ROLES,
    apply,
    candidates,
    footprints,
    new_game,
    turn,
    view,
)
from test_fugitive_engine import random_move
from test_smoke import client

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "ios" / "GameNightTests" / "Fixtures" / "fugitive_engine_games.json"

# Chosen so that between them the games end every way a game can.
SEEDS = (6, 27, 19, 14, 0, 1)


def seat_views(state):
    """What each of the three viewers sees, as the server would send it —
    the Marshal's with the notepad's candidates, as game.payload adds them."""
    views = {}
    for viewer in ROLES + ("table",):
        seen = view(state, viewer)
        if viewer == "marshal" and seen["phase"] != "game_over":
            seen["candidates"] = candidates(seen)
        # The same in every view of every game; the Swift test checks them
        # once, from the first view, instead of a few hundred times.
        for constant in ("decks", "footprints", "max_step"):
            seen.pop(constant)
        views[viewer] = seen
    return views


def illegal_moves(state, rng):
    """Moves the rules refuse right now, for whoever might try them."""
    role = turn(state)
    phase = state["phase"]
    if phase == "game_over":
        return [("fugitive", {"type": "draw", "deck": 0}), ("marshal", {"type": "guess", "numbers": [5]})]
    other = "marshal" if role == "fugitive" else "fugitive"
    out = [(other, {"type": "draw", "deck": 0})]
    if phase in ("fugitive_draw", "marshal_draw"):
        out.append((role, {"type": "hide", "card": 5, "sprints": []}))
        out.append((role, {"type": "draw", "deck": 3}))
        empty = [i for i, d in enumerate(state["decks"]) if not d]
        if empty:
            out.append((role, {"type": "draw", "deck": empty[0]}))
    elif phase == "fugitive_hide":
        hand = state["hands"]["fugitive"]
        last = state["hideouts"][-1]["card"]
        out.append((role, {"type": "guess", "numbers": [5]}))
        missing = next(c for c in range(1, ESCAPE_CARD) if c not in hand)
        out.append((role, {"type": "hide", "card": missing, "sprints": []}))
        low = [c for c in hand if c <= last]
        if low:
            out.append((role, {"type": "hide", "card": low[0], "sprints": []}))
        far = [c for c in hand if c - last > MAX_STEP]
        if far:
            out.append((role, {"type": "hide", "card": far[-1], "sprints": []}))
        if len(hand) >= 2:
            out.append((role, {"type": "hide", "card": hand[-1], "sprints": [hand[0], hand[0]]}))
            out.append((role, {"type": "hide", "card": hand[-1], "sprints": [hand[-1]]}))
        if ESCAPE_CARD in hand and len(hand) >= 2:
            card = next(c for c in hand if c != ESCAPE_CARD)
            out.append((role, {"type": "hide", "card": card, "sprints": [ESCAPE_CARD]}))
        if state["first_turn"] and state["placed"] == 0:
            out.append((role, {"type": "pass"}))
    elif phase == "marshal_guess":
        revealed = [h["card"] for h in state["hideouts"] if h["revealed"]]
        out.append((role, {"type": "draw", "deck": 0}))
        out.append((role, {"type": "guess", "numbers": []}))
        out.append((role, {"type": "guess", "numbers": [7, 7]}))
        out.append((role, {"type": "guess", "numbers": [rng.choice([0, ESCAPE_CARD, 50])]}))
        if revealed[-1] != 0:
            out.append((role, {"type": "guess", "numbers": [revealed[-1]]}))
    elif phase == "manhunt":
        out.append((role, {"type": "draw", "deck": 0}))
        out.append((role, {"type": "guess", "numbers": [8, 8]}))
        out.append((role, {"type": "guess", "numbers": [5, 6]}))
    return out


def play_script(seed):
    rng = random.Random(seed)
    # Shuffled exactly as new_game shuffles, but kept as they were before
    # the deal: the Swift side deals from them itself.
    decks = []
    for lo, hi in DECKS:
        cards = list(range(lo, hi + 1))
        rng.shuffle(cards)
        decks.append(cards)
    state = new_game(rng, decks=decks)
    script = {"seed": seed, "decks": copy.deepcopy(decks), "steps": []}

    def attempt(role, move):
        step = {"role": role, "move": move}
        try:
            apply(state, role, copy.deepcopy(move))
        except IllegalMove as refusal:
            step["error"] = str(refusal)
        else:
            step["views"] = seat_views(state)
        script["steps"].append(step)
        return "error" not in step

    script["start"] = seat_views(state)
    for _ in range(400):
        # Every refusal the position allows, at the start and now and then.
        if not script["steps"] or rng.random() < 0.3:
            for role, move in illegal_moves(state, rng):
                assert not attempt(role, move), (seed, move)
        if state["phase"] == "game_over":
            break
        if seed % 5 == 4 and state["phase"] == "manhunt":
            role, move = "marshal", {"type": "let_go"}
        elif seed % 7 == 1 and len(state["hideouts"]) >= 4:
            role, move = rng.choice(ROLES), {"type": "resign"}
        else:
            role, move = random_move(state, rng)
        assert attempt(role, move), (seed, move, script["steps"][-1])
    # One refusal from a finished game, every time.
    attempt("fugitive", {"type": "draw", "deck": 0})
    script["reason"] = state["reason"]
    return script


def engine_scripts():
    return {
        "constants": {"decks": [list(r) for r in DECKS],
                      "footprints": {str(c): footprints(c) for c in range(0, ESCAPE_CARD + 1)},
                      "max_step": MAX_STEP},
        "games": [play_script(seed) for seed in SEEDS],
    }


def test_the_swift_engine_scripts_still_match_the_engine():
    import os

    fresh = engine_scripts()
    reasons = {g["reason"] for g in fresh["games"]}
    assert reasons == {"caught", "escaped", "manhunt_failed", "let_go", "resigned"}, reasons
    refusals = {s["error"] for g in fresh["games"] for s in g["steps"] if "error" in s}
    assert len(refusals) >= 12, refusals
    if os.environ.get("WRITE_IOS_FIXTURES"):
        SCRIPTS.write_text(json.dumps(fresh, separators=(",", ":"), ensure_ascii=False) + "\n")
    assert json.loads(SCRIPTS.read_text()) == json.loads(json.dumps(fresh)), (
        "engine.py plays differently from the Swift fixture: rewrite it with "
        "WRITE_IOS_FIXTURES=1 and make the Swift engine agree")


# --- offline games coming home --------------------------------------------

def upload_body(seed, game_id="offline-game-0001", **extra):
    """An offline game as the app sends it: the decks before the deal, and
    the moves the rules accepted, in order."""
    script = play_script(seed)
    moves = [{"role": s["role"], "move": s["move"]} for s in script["steps"] if "error" not in s]
    return {"id": game_id, "players": {"fugitive": "Ana", "marshal": "Ben"},
            "decks": script["decks"], "moves": moves, **extra}


def test_an_offline_game_is_replayed_and_recorded_once():
    c = client()
    body = upload_body(6, played_at="2026-10-20T18:30:00+01:00")
    res = c.post("/fugitive/api/offline", json=body)
    assert res.status_code == 200 and res.get_json() == {"recorded": True}
    record = c.get("/fugitive/api/stats").get_json()
    assert record["games_played"] == 1
    assert "offline_ids" not in record
    assert record["recent"][0]["at"] == "2026-10-20T17:30:00+00:00"
    assert record["recent"][0]["winner"] == "marshal" and record["recent"][0]["reason"] == "caught"
    ben = next(r for r in record["leaderboard"] if r["name"] == "Ben")
    assert ben["marshal_wins"] == 1

    # A retried upload — the app never heard the first answer — counts once.
    again = c.post("/fugitive/api/offline", json=body)
    assert again.status_code == 200 and again.get_json() == {"recorded": False}
    assert c.get("/fugitive/api/stats").get_json()["games_played"] == 1

    # The same moves under a new id are a new game.
    assert c.post("/fugitive/api/offline", json={**body, "id": "offline-game-0002"}).get_json() == {"recorded": True}
    assert c.get("/fugitive/api/stats").get_json()["games_played"] == 2


def test_only_a_legal_finished_game_is_recorded():
    c = client()
    body = upload_body(19)

    tampered = copy.deepcopy(body)
    first_hide = next(i for i, m in enumerate(tampered["moves"]) if m["move"]["type"] == "hide")
    tampered["moves"][first_hide]["move"]["card"] = 41
    res = c.post("/fugitive/api/offline", json=tampered)
    assert res.status_code == 400 and f"move {first_hide + 1} breaks the rules" in res.get_json()["error"]

    unfinished = {**body, "moves": body["moves"][:-1]}
    assert c.post("/fugitive/api/offline", json=unfinished).get_json()["error"] == "that game isn't finished"

    stacked = copy.deepcopy(body)
    stacked["decks"][0][0] = 42
    assert c.post("/fugitive/api/offline", json=stacked).status_code == 400

    for broken in ({**body, "id": "x"}, {**body, "players": {"fugitive": "Ana", "marshal": "ana"}},
                   {**body, "moves": "all of them"}, {**body, "moves": [{"role": "judge", "move": {}}]}, ["nope"]):
        assert c.post("/fugitive/api/offline", json=broken).status_code == 400, broken
    assert c.get("/fugitive/api/stats").get_json()["games_played"] == 0


def computer_upload(seed, you="marshal", level="hard", game_id="offline-game-ai-01"):
    """An offline game against the computer as the app sends it: the
    computer's moves are ai.py's from the game's seed, the person's random."""
    from games.fugitive import ai
    from games.fugitive.game import seat_view

    rng = random.Random(seed)
    decks = []
    for lo, hi in DECKS:
        cards = list(range(lo, hi + 1))
        rng.shuffle(cards)
        decks.append(cards)
    state = new_game(rng, decks=decks)
    computer = {"role": "fugitive" if you == "marshal" else "marshal", "level": level, "seed": seed * 7919}
    moves = []
    for _ in range(1000):
        if state["phase"] == "game_over":
            break
        role = turn(state)
        if role == computer["role"]:
            move = ai.choose(seat_view(state, role), level, ai.move_rng(computer["seed"], state["seq"]))
        else:
            role, move = random_move(state, rng)
        moves.append({"role": role, "move": {**move, "seq": state["seq"]}})
        apply(state, role, copy.deepcopy(move))
    return {"id": game_id, "players": {you: "Ana", computer["role"]: "Computer"},
            "decks": decks, "moves": moves, "computer": computer}, state


def test_an_offline_game_against_the_computer_is_recorded_apart_once():
    c = client()
    body, final = computer_upload(11)
    assert c.post("/fugitive/api/offline", json=body).get_json() == {"recorded": True}
    assert c.post("/fugitive/api/offline", json=body).get_json() == {"recorded": False}
    record = c.get("/fugitive/api/stats").get_json()
    assert record["games_played"] == 0 and record["computer"]["games_played"] == 1
    [ana] = record["computer_leaderboard"]
    assert ana["marshal_hard_games"] == 1 and ana["wins"] == int(final["winner"] == "marshal")


def test_an_offline_win_the_computer_didnt_play_along_with_is_refused():
    c = client()
    body, _ = computer_upload(12)
    # A legal move, just not the one the computer would have made.
    forged = copy.deepcopy(body)
    state = new_game(None, decks=forged["decks"])
    number = None
    for index, step in enumerate(forged["moves"], start=1):
        if step["role"] == "fugitive" and step["move"]["type"] == "draw":
            others = [d for d in range(len(DECKS)) if d != step["move"]["deck"] and state["decks"][d]]
            if others:
                step["move"]["deck"], number = others[0], index
                break
        apply(state, step["role"], copy.deepcopy(step["move"]))
    assert number, "the computer never drew with a choice of decks"
    res = c.post("/fugitive/api/offline", json=forged)
    assert res.status_code == 400
    assert res.get_json()["error"] == f"move {number} isn't the move the computer would have made"
    # The same game under another seed isn't the computer's either.
    reseeded = {**body, "computer": {**body["computer"], "seed": body["computer"]["seed"] + 1}}
    assert c.post("/fugitive/api/offline", json=reseeded).status_code == 400
    for broken in ({**body, "computer": {"role": "fugitive", "level": "hard"}},
                   {**body, "computer": {**body["computer"], "level": "impossible"}},
                   {**body, "computer": {**body["computer"], "seed": -1}},
                   {**body, "computer": "yes"}):
        assert c.post("/fugitive/api/offline", json=broken).status_code == 400, broken
    assert c.get("/fugitive/api/stats").get_json()["computer"]["games_played"] == 0


def test_a_game_given_up_before_anyone_moved_isnt_recorded():
    c = client()
    body = {**upload_body(6), "moves": [{"role": "marshal", "move": {"type": "resign"}}]}
    assert c.post("/fugitive/api/offline", json=body).get_json() == {"recorded": False}
    assert c.get("/fugitive/api/stats").get_json()["games_played"] == 0


def test_a_future_or_unreadable_time_is_replaced_with_now():
    c = client()
    for i, when in enumerate(("2999-01-01T00:00:00+00:00", "yesterday", 12, "2026-10-20T18:30:00")):
        assert c.post("/fugitive/api/offline", json=upload_body(6, f"offline-time-{i:04}", played_at=when)).status_code == 200
    stamps = [g["at"] for g in c.get("/fugitive/api/stats").get_json()["recent"]]
    assert all(not s.startswith("2999") and not s.startswith("2026-10-20") for s in stamps), stamps


def test_an_offline_game_played_without_hints_says_so_in_the_records():
    c = client()
    assert c.post("/fugitive/api/offline", json=upload_body(6, game_id="offline-no-hint-1", hints="off")).status_code == 400
    res = c.post("/fugitive/api/offline", json=upload_body(6, game_id="offline-no-hint-2", hints=False))
    assert res.get_json() == {"recorded": True}
    assert c.get("/fugitive/api/stats").get_json()["recent"][0]["hints"] is False
