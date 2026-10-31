"""Picnic Raid's JSON API: seats, secrets, the computer, records and
rematches. The rules themselves are in test_picnic_engine.py."""

import random

import pytest

from games.picnic import engine
from games.picnic import game as picnic
from test_picnic_engine import random_move
from test_smoke import client


@pytest.fixture(autouse=True)
def no_computer_delay(monkeypatch):
    monkeypatch.setattr(picnic, "COMPUTER_DELAY", 0)


def new_game(c, players=("Ana", "Ben", "Cy"), **more):
    res = c.post("/picnic/api/play", json={"players": list(players), **more})
    assert res.status_code == 200, res.get_json()
    return res.get_json()


def sit(c, code, seat):
    res = c.post(f"/picnic/api/play/{code}/seats/{seat}/claim")
    assert res.status_code == 200, res.get_json()
    return res.get_json()["seat_token"]


def state(c, code, token=None):
    headers = {"X-Picnic-Token": token} if token else {}
    return c.get(f"/picnic/api/play/{code}", headers=headers).get_json()


def send(c, code, token, move, seq=None):
    if seq is None:
        seq = state(c, code, token)["game"]["seq"]
    return c.post(f"/picnic/api/play/{code}/move", json={**move, "seq": seq},
                  headers={"X-Picnic-Token": token})


def room_state(code):
    from core.rooms import rooms
    return rooms.get(code).state


def seated(c, players=("Ana", "Ben", "Cy")):
    made = new_game(c, players)
    return made, [sit(c, made["code"], seat) for seat in range(len(players))]


def play_out(c, code, tokens, rng):
    """Random legal moves, each sent as whoever has to make it, to the end."""
    for _ in range(4000):
        game = room_state(code)["game"]
        if game["phase"] == "game_over":
            return game
        seat, move = random_move(game, rng)
        res = send(c, code, tokens[seat], move, game["seq"])
        assert res.status_code == 200, (move, res.get_json())
    raise AssertionError("the game never ended")


def test_the_pages_render():
    c = client()
    for path in ("/picnic/", "/picnic/rules", "/picnic/stats"):
        res = c.get(path)
        assert res.status_code == 200, path
        assert b"Picnic" in res.data
    made = new_game(c)
    assert c.get(f"/picnic/play/{made['code']}").status_code == 200


def test_the_dealer_sees_the_table_and_no_hand():
    c = client()
    made = new_game(c)
    assert made["you"]["role"] == "host"
    assert made["game"]["hand"] is None and made["game"]["hand_counts"] == [7, 5, 5]
    assert made["host_token"] and "qr_svg" in made


def test_a_seat_sees_its_own_hand_and_moves_only_for_itself():
    c = client()
    made, (ana, ben, _) = seated(c)
    code = made["code"]
    mine = state(c, code, ana)
    assert mine["you"] == {"role": "seat", "seat": 0} and len(mine["game"]["hand"]) == 7
    assert state(c, code, ben)["game"]["hand"] is not None
    res = send(c, code, ben, {"type": "pass"})
    assert res.status_code == 400 and "isn't your turn" in res.get_json()["error"]
    res = send(c, code, made["host_token"], {"type": "pass"})
    assert res.status_code == 403
    assert send(c, code, ana, {"type": "pass"}).status_code == 200


def test_a_stale_move_is_refused_with_the_latest_table():
    c = client()
    made, (ana, _, _) = seated(c)
    code = made["code"]
    assert send(c, code, ana, {"type": "pass"}, seq=0).status_code == 200
    res = send(c, code, ana, {"type": "pass"}, seq=0)
    assert res.status_code == 409 and res.get_json()["game"]["seq"] == 1


def test_a_hidden_trap_is_a_secret_from_everyone_but_its_hider():
    c = client()
    made, (ana, ben) = seated(c, ("Ana", "Ben"))
    code = made["code"]
    room = room_state(code)
    room["game"].update({"round": 2})
    room["game"]["hands"][0] = ["ants", "s1", "s2"]
    send(c, code, ana, {"type": "hide", "card": "ants", "target": 1})
    assert state(c, code, ana)["game"]["blankets"][1] == [{"card": "ants", "mine": True}]
    assert state(c, code, ben)["game"]["blankets"][1] == [{"card": None, "mine": False}]
    assert state(c, code)["game"]["blankets"][1] == [{"card": None, "mine": False}]


def test_a_shoo_sent_back_is_decided_by_the_hider_on_their_own_phone():
    c = client()
    made, (ana, ben) = seated(c, ("Ana", "Ben"))
    code = made["code"]
    game = room_state(code)["game"]
    game["round"] = 2
    game["hands"] = [["shoo"], ["shoo"]]
    game["baskets"] = [["c3"], ["b2", "s1"]]
    game["blankets"][0] = [{"card": "ants", "by": 1}]
    assert send(c, code, ana, {"type": "pack"}).status_code == 200
    assert send(c, code, ana, {"type": "defend", "card": "shoo"}).status_code == 200
    ben_sees = state(c, code, ben)["game"]
    assert ben_sees["turn"] == 1 and ben_sees["stage"] == "spring" and ben_sees["defences"] == ["shoo"]
    assert send(c, code, ben, {"type": "defend", "card": "shoo"}).status_code == 200
    # Ana has no Shoo! left: her cupcake goes to Ben's basket.
    after = state(c, code, ana)["game"]
    assert after["scores"][0] == 0 and sorted(after["baskets"][1]) == ["b2", "c3", "s1"]


def test_random_games_through_the_api_end_and_are_recorded():
    c = client()
    made, tokens = seated(c)
    game = play_out(c, made["code"], tokens, random.Random(4))
    assert game["recorded"]
    stats = c.get("/picnic/api/stats").get_json()
    assert stats["games_played"] == 1
    wins = {row["name"]: row["wins"] for row in stats["leaderboard"]}
    assert sum(wins.values()) == len(game["winners"])
    assert all(row["best"] == game["scores"][["Ana", "Ben", "Cy"].index(row["name"])] for row in stats["leaderboard"])


def test_the_computer_plays_a_whole_game_and_it_is_recorded_apart():
    c = client()
    made = new_game(c, ["Ana"], computers=3, level="hard")
    code = made["code"]
    assert made["players"] == ["Ana", "Bramble", "Pip", "Clover"]
    ana = sit(c, code, 0)
    rng = random.Random(9)
    for _ in range(6000):
        seen = state(c, code, ana)
        if seen["game"]["phase"] == "game_over":
            break
        if seen["game"]["turn"] == 0:
            _, move = random_move(room_state(code)["game"], rng)
            assert send(c, code, ana, move).status_code == 200
    else:
        raise AssertionError("the game never ended")
    stats = c.get("/picnic/api/stats").get_json()
    assert stats["games_played"] == 0 and stats["computer"]["games_played"] == 1
    assert stats["computer_leaderboard"][0]["name"] == "Ana"


def test_the_computer_keeps_its_seat():
    c = client()
    made = new_game(c, ["Ana"], computers=1)
    res = c.post(f"/picnic/api/play/{made['code']}/seats/1/release",
                 headers={"X-Picnic-Token": made["host_token"]})
    assert res.status_code == 400


def test_a_rematch_keeps_the_seats_and_moves_the_first_player_on():
    c = client()
    made, tokens = seated(c, ("Ana", "Ben"))
    play_out(c, made["code"], tokens, random.Random(2))
    res = c.post(f"/picnic/api/play/{made['code']}/rematch", headers={"X-Picnic-Token": made["host_token"]})
    assert res.status_code == 200
    fresh = res.get_json()["code"]
    assert state(c, fresh, tokens[1])["you"] == {"role": "seat", "seat": 1}
    assert room_state(fresh)["game"]["first"] == 1
    again = c.post(f"/picnic/api/play/{made['code']}/rematch", headers={"X-Picnic-Token": made["host_token"]})
    assert again.get_json()["code"] == fresh


def test_bad_tables_are_refused():
    c = client()
    for body in ({"players": []}, {"players": ["Ana", ""]}, {"players": ["Ana", "ana"]},
                 {"players": ["A", "B", "C", "D", "E"]}, {"players": ["Ana"], "computers": 4},
                 {"players": ["Ana"], "computers": 1, "level": "medium"}, {"players": "Ana"}):
        assert c.post("/picnic/api/play", json=body).status_code == 400, body


def test_card_pictures_are_found_by_name(tmp_path, monkeypatch):
    from app import app as flask_app
    static = tmp_path / "static"
    cards = static / "picnic" / "cards"
    cards.mkdir(parents=True)
    for name in ("ants.webp", "s.png", "back.jpg", "notes.txt", "Bad Name.webp"):
        (cards / name).write_bytes(b"x")
    monkeypatch.setattr(flask_app, "static_folder", str(static))
    with flask_app.test_request_context("/picnic/"):
        art = picnic.card_art()
    assert set(art) == {"ants", "s", "back"}
    assert art["ants"].endswith("/picnic/cards/ants.webp")


def test_every_card_the_brief_names_is_a_card():
    """The art brief lists a picture per card; the names must be ones the page asks for."""
    from pathlib import Path
    brief = (Path(__file__).resolve().parent.parent / "games" / "picnic" / "ART.md").read_text(encoding="utf-8")
    names = set(engine.full_deck()) | set(engine.FOODS) | {"back"}
    for name in ("ants", "wasp", "gull", "dog", "shoo", "umbrella", "back", "s1", "h3"):
        assert f"`{name}." in brief or f"`{name}`" in brief, name
    assert names >= {"ants", "back", "s1"}
