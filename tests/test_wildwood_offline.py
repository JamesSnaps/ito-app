"""Wildwood offline: the rules and the computer in Swift, pinned to these.

The iOS app plays Wildwood without the server on a plane, so its Swift ports
of engine.py and ai.py have to agree with them move for move. These tests
play seeded games here and write down what happened:

- `engine_scripts()` — legal moves and refused ones, the state after every
  move (less the log, plus its newest entry), every refusal word for word,
  and every viewer's view now and then
  (ios/GameNightTests/Fixtures/wildwood_engine_games.json);
- `ai_scripts()` — computer seats at every level pairing, and each level
  against a random player, with the seed and every move
  (ios/GameNightTests/Fixtures/wildwood_ai_games.json).

WildwoodEngineTests and WildwoodAITests replay them in Swift and must come
out the same. When the rules or the computer change on purpose, rewrite the
fixtures with WRITE_IOS_FIXTURES=1 pytest tests -q -k wildwood_offline and
make the Swift tests pass again.
"""

import copy
import json
import os
import random
from pathlib import Path

from games.wildwood import ai, engine
from games.wildwood.engine import IllegalMove
from test_wildwood_engine import random_move

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "ios" / "GameNightTests" / "Fixtures"
DIGEST_KEYS = ("hands", "colour", "turn", "direction", "stack", "drawn", "exposed",
               "reshuffles", "phase", "winner", "event", "seq")
# Two, three and four players, each with a catch and a reshuffle, and two
# short games; between them stacks, reverses with two, and Bears.
ENGINE_SEEDS = (1, 15, 56, 28, 12)


def digest(state):
    """The state after a move, less the log and most of the piles: their
    sizes and the next three cards to be drawn, which later draws check."""
    out = {key: copy.deepcopy(state[key]) for key in DIGEST_KEYS}
    out.update(draw_count=len(state["draw"]), draw_top=state["draw"][-3:],
               discard_count=len(state["discard"]), top=state["discard"][-1])
    return out


def illegal_moves(state, rng):
    """Moves the rules refuse right now, for whoever might try them."""
    seat = state["turn"]
    other = (seat + 1) % state["players"]
    hand = state["hands"][seat]
    options = engine.playable(state, seat)
    tries = [(other, {"type": "draw"})]
    if state["exposed"] != seat:
        tries.append((seat, {"type": "call"}))
    if state["exposed"] is None:
        tries.append((other, {"type": "catch"}))
    if state["drawn"] is None:
        tries.append((seat, {"type": "pass"}))
    if not state["stack"]:
        tries.append((seat, {"type": "take"}))
    else:
        tries.append((seat, {"type": "draw"}))
    blocked = [c for c in hand if c not in options]
    if blocked:
        tries.append((seat, {"type": "play", "card": rng.choice(blocked), "colour": "r"}))
    wild = next((c for c in options if c in engine.WILDS), None)
    if wild:
        tries.append((seat, {"type": "play", "card": wild}))
    missing = next(c for c in engine.full_deck() if c not in hand)
    tries.append((seat, {"type": "play", "card": missing}))
    return tries


def engine_scripts():
    games = []
    for seed in ENGINE_SEEDS:
        rng = random.Random(seed)
        players = 2 + seed % 3
        deck = engine.full_deck()
        rng.shuffle(deck)
        shuffle_seed = rng.getrandbits(32)
        first = seed % players
        state = engine.new_game(None, players, deck=deck, shuffle_seed=shuffle_seed, first=first)
        steps = []
        while state["phase"] != "game_over":
            if rng.random() < 0.25:
                seat, move = rng.choice(illegal_moves(state, rng))
                before = copy.deepcopy(state)
                try:
                    engine.apply(state, seat, move)
                    raise AssertionError(f"{move} should have been refused")
                except IllegalMove as refusal:
                    assert state == before
                    steps.append({"seat": seat, "move": move, "refused": str(refusal)})
                continue
            seat, move = random_move(state, rng)
            engine.apply(state, seat, move)
            step = {"seat": seat, "move": move, "state": digest(state), "last": state["log"][-1]}
            if state["seq"] % 15 == 0 or state["phase"] == "game_over":
                step["views"] = {str(v): engine.view(state, v) for v in list(range(players)) + ["table"]}
            steps.append(step)
        games.append({"players": players, "deck": deck, "shuffle_seed": shuffle_seed, "first": first,
                      "start": {"state": digest(engine.new_game(None, players, deck=deck,
                                                                 shuffle_seed=shuffle_seed, first=first))},
                      "steps": steps})
    return {"games": games}


def ai_scripts():
    """Computer seats at every pairing of levels, and each level against a
    random player, every computer move made by ai.py from its own view."""
    tables = [("easy", "easy"), ("hard", "hard"), ("easy", "hard"), ("hard", "easy", "hard"),
              ("easy", None), ("hard", None), (None, "hard", "easy", None)]
    games = []
    for number, levels in enumerate(tables):
        rng = random.Random(100 + number)
        players = len(levels)
        deck = engine.full_deck()
        rng.shuffle(deck)
        shuffle_seed = rng.getrandbits(32)
        seed = rng.getrandbits(32)
        state = engine.new_game(None, players, deck=deck, shuffle_seed=shuffle_seed, first=number % players)
        moves = []
        while state["phase"] != "game_over":
            seat = state["turn"]
            level = levels[seat]
            if level:
                move = ai.choose(engine.view(state, seat), level, ai.move_rng(seed, state["seq"]))
            else:
                seat, move = random_move(state, rng)
                if levels[seat]:
                    # A random catch or call from a computer's seat isn't
                    # a move the computer makes.
                    continue
            engine.apply(state, seat, move)
            moves.append({"seat": seat, "move": move, "computer": bool(levels[seat])})
        games.append({"levels": list(levels), "seed": seed, "deck": deck, "shuffle_seed": shuffle_seed,
                      "first": number % players, "moves": moves, "winner": state["winner"]})
    return {"games": games}


def check(name, fresh):
    path = FIXTURES / f"{name}.json"
    if os.environ.get("WRITE_IOS_FIXTURES"):
        path.write_text(json.dumps(fresh, separators=(",", ":"), ensure_ascii=False) + "\n")
    assert json.loads(path.read_text()) == json.loads(json.dumps(fresh)), \
        f"{name}.json no longer matches the Python — rewrite it with WRITE_IOS_FIXTURES=1 and make the Swift agree"


def test_wildwood_offline_engine_scripts_still_play_the_same():
    scripts = engine_scripts()
    games = scripts["games"]
    assert {g["players"] for g in games} == {2, 3, 4}
    assert all(any(s.get("state", {}).get("reshuffles") for s in g["steps"]) for g in games[:3])
    kinds = {s["last"]["kind"] for g in games for s in g["steps"] if "last" in s}
    assert {"play", "draw", "skip", "reverse", "keep", "game_over"} <= kinds
    # A catch is followed by its penalty draw, so it's never the newest entry.
    assert any(s["move"]["type"] == "catch" and "state" in s for g in games for s in g["steps"])
    assert any(s.get("refused") for g in games for s in g["steps"])
    check("wildwood_engine_games", scripts)


def test_wildwood_offline_ai_scripts_still_choose_the_same():
    scripts = ai_scripts()
    assert all(any(m["computer"] for m in g["moves"]) for g in scripts["games"])
    check("wildwood_ai_games", scripts)
