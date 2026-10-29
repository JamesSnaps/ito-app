"""Wildwood's JSON API: seats, secrets, the computer, records, rematches and
games coming home from offline. The rules themselves are in
test_wildwood_engine.py."""

import random
from pathlib import Path

import pytest

from games.wildwood import ai, engine
from games.wildwood import game as wildwood
from test_smoke import client
from test_wildwood_engine import random_move

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(autouse=True)
def no_computer_delay(monkeypatch):
    monkeypatch.setattr(wildwood, "COMPUTER_DELAY", 0)


def new_game(c, players=("Ana", "Ben", "Cy"), **more):
    res = c.post("/wildwood/api/play", json={"players": list(players), **more})
    assert res.status_code == 200, res.get_json()
    return res.get_json()


def sit(c, code, seat):
    res = c.post(f"/wildwood/api/play/{code}/seats/{seat}/claim")
    assert res.status_code == 200, res.get_json()
    return res.get_json()["seat_token"]


def state(c, code, token=None):
    headers = {"X-Wildwood-Token": token} if token else {}
    return c.get(f"/wildwood/api/play/{code}", headers=headers).get_json()


def send(c, code, token, move, seq=None):
    if seq is None:
        seq = state(c, code, token)["game"]["seq"]
    return c.post(f"/wildwood/api/play/{code}/move", json={**move, "seq": seq},
                  headers={"X-Wildwood-Token": token})


def room_state(code):
    from core.rooms import rooms
    return rooms.get(code).state


def seated(c, players=("Ana", "Ben", "Cy")):
    made = new_game(c, players)
    return made, [sit(c, made["code"], seat) for seat in range(len(players))]


def play_out(c, code, tokens, rng):
    """Random legal moves, each sent as whoever makes it, to the end."""
    for _ in range(4000):
        game = room_state(code)["game"]
        if game["phase"] == "game_over":
            return game
        seat, move = random_move(game, rng)
        res = send(c, code, tokens[seat], move, game["seq"])
        assert res.status_code == 200, (move, res.get_json())
    raise AssertionError("the game never ended")


def test_a_new_game_shows_the_dealer_the_table_and_no_hand():
    c = client()
    made = new_game(c)
    assert made["host_token"] and "<svg" in made["qr_svg"]
    assert made["invite_url"].endswith(f"/wildwood/play/{made['code']}")
    assert made["you"] == {"role": "host", "seat": None}
    assert made["players"] == ["Ana", "Ben", "Cy"]
    assert made["game"]["viewer"] == "table" and made["game"]["hand"] is None
    assert made["game"]["hand_counts"] == [7, 7, 7]
    assert all(s == {"taken": False, "computer": False} for s in made["seats"])
    assert "host_token" not in state(c, made["code"])


def test_bad_tables_are_refused():
    c = client()
    for body in ({}, {"players": "Ana"}, {"players": []}, {"players": ["Ana"]},
                 {"players": ["Ana", "ana"]}, {"players": ["Ana", ""]}, {"players": ["Ana", 3]},
                 {"players": ["A", "B", "C", "D", "E"]}, {"players": ["Ana", "Ben", "Cy"], "computers": 2},
                 {"players": ["Ana"], "computers": -1}, {"players": ["Ana"], "computers": True},
                 {"players": ["Ana"], "computers": 1, "level": "fiendish"}, ["Ana", "Ben"]):
        assert c.post("/wildwood/api/play", json=body).status_code == 400, body


def test_each_seat_sees_its_own_hand_and_nobody_else_does():
    c = client()
    made, tokens = seated(c)
    code = made["code"]
    hands = room_state(code)["game"]["hands"]
    for seat, token in enumerate(tokens):
        seen = state(c, code, token)
        assert seen["you"] == {"role": "seat", "seat": seat}
        assert seen["game"]["hand"] == hands[seat]
    for token in (made["host_token"], None, "nonsense"):
        seen = state(c, code, token)
        assert seen["game"]["hand"] is None and seen["game"]["hands"] is None
    # Nothing about anyone's cards leaks into the table view's text.
    table_text = str(state(c, code)["game"])
    assert str(hands[0]) not in table_text


def test_only_a_seat_moves_and_only_for_itself():
    c = client()
    made, tokens = seated(c)
    code = made["code"]
    assert send(c, code, made["host_token"], {"type": "draw"}).status_code == 403
    assert c.post(f"/wildwood/api/play/{code}/move", json={"type": "draw", "seq": 0}).status_code == 403
    # Seat 1 isn't to move; seat 0 is.
    res = send(c, code, tokens[1], {"type": "draw"})
    assert res.status_code == 400 and "isn't your turn" in res.get_json()["error"]
    assert send(c, code, tokens[0], {"type": "draw"}).status_code == 200


def test_a_stale_move_is_refused_with_the_table():
    c = client()
    made, tokens = seated(c)
    code = made["code"]
    assert send(c, code, tokens[0], {"type": "draw"}, seq=0).status_code == 200
    res = send(c, code, tokens[0], {"type": "draw"}, seq=0)
    assert res.status_code == 409 and res.get_json()["game"]["seq"] == 1


def test_seats_are_first_come_and_only_the_dealer_frees_them():
    c = client()
    made = new_game(c)
    code = made["code"]
    token = sit(c, code, 1)
    assert c.post(f"/wildwood/api/play/{code}/seats/1/claim").status_code == 409
    assert c.post(f"/wildwood/api/play/{code}/seats/9/claim").status_code == 404
    assert c.post(f"/wildwood/api/play/{code}/seats/1/release",
                  headers={"X-Wildwood-Token": token}).status_code == 403
    res = c.post(f"/wildwood/api/play/{code}/seats/1/release", headers={"X-Wildwood-Token": made["host_token"]})
    assert res.status_code == 200 and not res.get_json()["seats"][1]["taken"]
    assert state(c, code, token)["you"] == {"role": None, "seat": None}


def test_a_whole_game_between_people_is_recorded_once():
    c = client()
    made, tokens = seated(c)
    code = made["code"]
    game = play_out(c, code, tokens, random.Random(4))
    assert game["recorded"]
    stats = c.get("/wildwood/api/stats").get_json()
    assert stats["games_played"] == 1
    winner = made["players"][game["winner"]]
    assert stats["recent"][0] == {**stats["recent"][0], "players": ["Ana", "Ben", "Cy"], "winner": winner}
    board = {row["name"]: row for row in stats["leaderboard"]}
    assert board[winner]["wins"] == 1 and sum(r["games"] for r in board.values()) == 3
    catches = sum(1 for e in game["log"] if e["kind"] == "catch")
    assert sum(r["catches"] for r in board.values()) <= catches
    # Looking again doesn't count it twice.
    state(c, code)
    assert c.get("/wildwood/api/stats").get_json()["games_played"] == 1
    assert stats["computer"]["games_played"] == 0


def test_the_computer_sits_after_the_people_and_plays_its_own_turns():
    c = client()
    made = new_game(c, ["Ana"], computers=2, level="hard")
    code = made["code"]
    assert made["players"] == ["Ana", "Hedgehog", "Rabbit"]
    assert made["computer"] == {"seats": [1, 2], "level": "hard"}
    assert [s["taken"] for s in made["seats"]] == [False, True, True]
    assert [s["computer"] for s in made["seats"]] == [False, True, True]
    assert "seed" not in str(made)
    assert c.post(f"/wildwood/api/play/{code}/seats/1/claim").status_code == 409
    res = c.post(f"/wildwood/api/play/{code}/seats/2/release", headers={"X-Wildwood-Token": made["host_token"]})
    assert res.status_code == 400
    me = sit(c, code, 0)
    rng = random.Random(9)
    for _ in range(4000):
        seen = state(c, code, me)
        game = seen["game"]
        if game["phase"] == "game_over":
            break
        if game["turn"] == 0:
            seat, move = random_move(room_state(code)["game"], rng)
            if seat == 0:
                send(c, code, me, move, game["seq"])
    assert room_state(code)["game"]["phase"] == "game_over"
    stats = c.get("/wildwood/api/stats").get_json()
    # Recorded apart: the leaderboard never hears of it, and only Ana has a row.
    assert stats["games_played"] == 0 and stats["leaderboard"] == []
    assert stats["computer"]["games_played"] == 1
    assert [r["name"] for r in stats["computer_leaderboard"]] == ["Ana"]
    assert stats["computer_leaderboard"][0]["hard_games"] == 1


def test_the_computer_takes_an_animal_nobody_at_the_table_is_called():
    c = client()
    made = new_game(c, ["Hedgehog", "Ana"], computers=1)
    assert made["players"] == ["Hedgehog", "Ana", "Rabbit"]


def test_the_computer_only_sees_its_own_seat(monkeypatch):
    c = client()
    made = new_game(c, ["Ana"], computers=1)
    code = made["code"]
    me = sit(c, code, 0)
    seen_by_ai = []
    real = ai.choose

    def spy(seen, level, rng):
        seen_by_ai.append(seen)
        return real(seen, level, rng)

    monkeypatch.setattr(ai, "choose", spy)
    for _ in range(30):
        game = state(c, code, me)["game"]
        if game["phase"] == "game_over":
            break
        if game["turn"] == 0:
            options = game["playable"]
            move = {"type": "draw"} if not options and not game["stack"] else \
                {"type": "take"} if game["stack"] and not options else \
                {"type": "pass"} if game["deciding"] and not options else \
                {"type": "play", "card": options[0], "colour": "r"}
            send(c, code, me, move, game["seq"])
    assert seen_by_ai
    for seen in seen_by_ai:
        assert seen["viewer"] == 1 and "hands" not in seen or seen["hands"] is None
        assert "draw" not in seen and "shuffle_seed" not in seen


def test_a_rematch_keeps_the_seats_and_starts_one_further_round():
    c = client()
    made, tokens = seated(c)
    code = made["code"]
    host = {"X-Wildwood-Token": made["host_token"]}
    assert c.post(f"/wildwood/api/play/{code}/rematch", headers=host).status_code == 400
    play_out(c, code, tokens, random.Random(2))
    assert c.post(f"/wildwood/api/play/{code}/rematch",
                  headers={"X-Wildwood-Token": tokens[0]}).status_code == 403
    first = c.post(f"/wildwood/api/play/{code}/rematch", headers=host).get_json()
    again = c.post(f"/wildwood/api/play/{code}/rematch", headers=host).get_json()
    assert first == again and first["host_token"] == made["host_token"]
    assert state(c, code)["next"] == first["code"]
    fresh = state(c, first["code"], tokens[2])
    assert fresh["you"] == {"role": "seat", "seat": 2} and fresh["players"] == made["players"]
    assert fresh["game"]["turn"] == 1


def test_a_saved_room_comes_back_after_a_restart():
    c = client()
    made, tokens = seated(c)
    code = made["code"]
    send(c, code, tokens[0], {"type": "draw"})
    from core.rooms import rooms
    with rooms._lock:
        del rooms._rooms[code]
    back = state(c, code, tokens[0])
    assert back["game"]["seq"] == 1 and back["you"]["seat"] == 0


def test_join_finds_a_wildwood_code():
    c = client()
    code = new_game(c)["code"]
    res = c.get(f"/join?code={code.lower()}")
    assert res.status_code == 302 and res.headers["Location"].endswith(f"/wildwood/play/{code}")
    assert c.get(f"/api/join/{code}").get_json() == {
        "code": code, "game": "wildwood", "path": f"/wildwood/play/{code}"}


def test_pages_render_and_stay_on_this_server():
    c = client()
    code = new_game(c)["code"]
    css = (ROOT / "static" / "wildwood.css").read_text()
    script = (ROOT / "static" / "wildwood.js").read_text()
    assert "http://" not in script and "https://" not in script
    for path in ("/wildwood/", f"/wildwood/play/{code}", "/wildwood/rules", "/wildwood/stats",
                 f"/wildwood/rules?back=/wildwood/play/{code}"):
        res = c.get(path)
        assert res.status_code == 200, path
        body = res.get_data(as_text=True)
        assert 'rel="manifest"' in body
        for text in (body, css):
            assert "http://" not in text and "https://" not in text, path
    assert c.get("/wildwood/play/ZZZZ").status_code == 404
    assert 'href="/wildwood/"' in c.get("/wildwood/rules?back=https://evil.example/").get_data(as_text=True)


def test_the_rules_page_quotes_the_engine():
    body = client().get("/wildwood/rules").get_data(as_text=True)
    assert f"{engine.MIN_PLAYERS} to {engine.MAX_PLAYERS} players" in body
    assert f"starts with\n    {engine.HAND_SIZE} cards" in body or f"{engine.HAND_SIZE} cards" in body
    assert f"{len(engine.full_deck())} cards in all" in body
    assert f"you pick up {engine.PENALTY}" in body


# --- games played offline ---------------------------------------------------

def offline_game(players, computer=None, seed=5, rng_seed=1):
    """An offline game as the app would upload it: the deck, the shuffle
    seed, the first seat and every move — the computer's made by ai.py."""
    rng = random.Random(rng_seed)
    deck = engine.full_deck()
    rng.shuffle(deck)
    state = engine.new_game(None, len(players), deck=deck, shuffle_seed=seed, first=0)
    moves = []
    while state["phase"] != "game_over":
        if computer and state["turn"] in computer["seats"] and not (
                state["exposed"] is not None and rng.random() < 0.3):
            seat = state["turn"]
            move = ai.choose(engine.view(state, seat), computer["level"], ai.move_rng(computer["seed"], state["seq"]))
        else:
            seat, move = random_move(state, rng)
            if computer and seat in computer["seats"]:
                continue
        engine.apply(state, seat, move)
        moves.append({"seat": seat, "move": move})
    return {"id": f"offline-{rng_seed}-{seed}", "players": list(players), "deck": deck, "shuffle_seed": seed,
            "first": 0, "moves": moves, "played_at": "2026-10-01T12:00:00+00:00",
            **({"computer": computer} if computer else {})}, state


def test_an_offline_game_is_replayed_and_recorded_once():
    c = client()
    body, final = offline_game(["Ana", "Ben"])
    res = c.post("/wildwood/api/offline", json=body)
    assert res.get_json() == {"recorded": True}
    assert c.post("/wildwood/api/offline", json=body).get_json() == {"recorded": False}
    stats = c.get("/wildwood/api/stats").get_json()
    assert stats["games_played"] == 1 and "offline_ids" not in stats
    assert stats["recent"][0]["at"] == "2026-10-01T12:00:00+00:00"
    assert stats["recent"][0]["winner"] == ["Ana", "Ben"][final["winner"]]


def test_an_offline_game_against_the_computer_must_be_the_computers_play():
    c = client()
    computer = {"seats": [1], "level": "hard", "seed": 77}
    body, _ = offline_game(["Ana", "Rabbit"], computer=computer, rng_seed=3)
    assert c.post("/wildwood/api/offline", json=body).get_json() == {"recorded": True}
    assert c.get("/wildwood/api/stats").get_json()["computer"]["games_played"] == 1
    # The same game with one of the computer's moves swapped for another
    # legal one: a phone can't claim a computer that played along.
    replay = engine.new_game(None, 2, deck=body["deck"], shuffle_seed=body["shuffle_seed"])
    for index, step in enumerate(body["moves"]):
        if step["seat"] == 1 and replay["turn"] == 1 and not replay["stack"] and replay["drawn"] is None \
                and step["move"]["type"] == "play":
            break
        engine.apply(replay, step["seat"], step["move"])
    else:
        pytest.fail("the computer never played a card")
    moves = [*body["moves"][:index], {"seat": 1, "move": {"type": "draw"}}, *body["moves"][index + 1:]]
    res = c.post("/wildwood/api/offline", json={**body, "id": "offline-forged-1", "moves": moves})
    assert res.status_code == 400 and "computer would have made" in res.get_json()["error"]


def test_broken_offline_games_are_refused():
    c = client()
    body, _ = offline_game(["Ana", "Ben"], rng_seed=8)
    for change in ({"id": "x"}, {"players": ["Ana"]}, {"players": ["Ana", "ana"]},
                   {"deck": body["deck"][:-1]}, {"deck": body["deck"][:-1] + ["r1"]},
                   {"shuffle_seed": -1}, {"first": 5}, {"moves": body["moves"][:-1]},
                   {"moves": [{"seat": 9, "move": {"type": "draw"}}]},
                   {"computer": {"seats": [0], "level": "easy", "seed": 1}}):
        res = c.post("/wildwood/api/offline", json={**body, **change})
        assert res.status_code == 400, change
    assert c.get("/wildwood/api/stats").get_json()["games_played"] == 0
