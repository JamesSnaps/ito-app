"""Fugitive's JSON API: seats, secrets, guards, records and rematches. The
rules themselves are in test_fugitive_engine.py."""

import random
from pathlib import Path

from test_fugitive_engine import random_move
from test_smoke import client

ROOT = Path(__file__).resolve().parent.parent


def new_game(c, fugitive="Ana", marshal="Ben"):
    res = c.post("/fugitive/api/play", json={"fugitive": fugitive, "marshal": marshal})
    assert res.status_code == 200, res.get_json()
    return res.get_json()


def sit(c, code, role):
    res = c.post(f"/fugitive/api/play/{code}/seats/{role}/claim")
    assert res.status_code == 200, res.get_json()
    return res.get_json()["seat_token"]


def seated_game(c):
    game = new_game(c)
    return game, {"fugitive": sit(c, game["code"], "fugitive"), "marshal": sit(c, game["code"], "marshal")}


def state(c, code, token=None):
    headers = {"X-Fugitive-Token": token} if token else {}
    return c.get(f"/fugitive/api/play/{code}", headers=headers).get_json()


def send(c, code, token, move, seq=None):
    if seq is None:
        seq = state(c, code, token)["game"]["seq"]
    return c.post(f"/fugitive/api/play/{code}/move", json={**move, "seq": seq},
                  headers={"X-Fugitive-Token": token})


def room_state(code):
    from core.rooms import rooms
    return rooms.get(code).state


def test_a_new_game_shows_the_dealer_the_table_and_no_hand():
    c = client()
    game = new_game(c)
    assert game["host_token"] and "<svg" in game["qr_svg"]
    assert game["invite_url"].endswith(f"/fugitive/play/{game['code']}")
    assert game["you"] == {"role": "host", "seat": None}
    assert game["game"]["viewer"] == "table" and game["game"]["hand"] is None
    assert game["players"] == {"fugitive": "Ana", "marshal": "Ben"}
    view = state(c, game["code"])
    assert "host_token" not in view and "decks" in view["game"]
    assert all(isinstance(d, list) and len(d) == 2 for d in view["game"]["decks"])


def test_bad_names_are_refused():
    c = client()
    for body in ({}, {"fugitive": "Ana"}, {"fugitive": "Ana", "marshal": "ana"},
                 {"fugitive": "", "marshal": "Ben"}, {"fugitive": 1, "marshal": "Ben"}, ["Ana", "Ben"]):
        assert c.post("/fugitive/api/play", json=body).status_code == 400, body


def test_each_seat_sees_its_own_hand_and_nobody_else_does():
    c = client()
    game, tokens = seated_game(c)
    code = game["code"]
    fugitive = state(c, code, tokens["fugitive"])
    marshal = state(c, code, tokens["marshal"])
    assert fugitive["you"] == {"role": "seat", "seat": "fugitive"}
    assert len(fugitive["game"]["hand"]) == 9
    assert marshal["game"]["hand"] == [] and "candidates" in marshal["game"]
    assert "candidates" not in fugitive["game"]

    send(c, code, tokens["fugitive"], {"type": "hide", "card": 2, "sprints": []})
    secret = room_state(code)["game"]["hands"]["fugitive"]
    for token in (tokens["marshal"], game["host_token"], None):
        seen = state(c, code, token)["game"]
        assert seen["hideouts"][1]["card"] is None
        assert seen["hand"] != secret


def test_a_taken_seat_cannot_be_taken_again():
    c = client()
    game = new_game(c)
    sit(c, game["code"], "fugitive")
    res = c.post(f"/fugitive/api/play/{game['code']}/seats/fugitive/claim")
    assert res.status_code == 409 and "seat_token" not in res.get_json()
    assert c.post(f"/fugitive/api/play/{game['code']}/seats/dealer/claim").status_code == 404


def test_only_the_seated_player_moves_and_the_dealer_cannot():
    c = client()
    game, tokens = seated_game(c)
    code = game["code"]
    move = {"type": "hide", "card": 2, "sprints": []}
    assert send(c, code, game["host_token"], move).status_code == 403
    assert send(c, code, "nope", move).status_code == 403
    res = send(c, code, tokens["marshal"], move)
    assert res.status_code == 400 and "your turn" in res.get_json()["error"]
    assert send(c, code, tokens["fugitive"], move).status_code == 200


def test_a_stale_or_illegal_move_changes_nothing():
    c = client()
    game, tokens = seated_game(c)
    code = game["code"]
    seq = state(c, code, tokens["fugitive"])["game"]["seq"]
    assert send(c, code, tokens["fugitive"], {"type": "hide", "card": 2, "sprints": []}, seq=seq).status_code == 200
    stale = send(c, code, tokens["fugitive"], {"type": "hide", "card": 3, "sprints": []}, seq=seq)
    assert stale.status_code == 409 and stale.get_json()["game"]["seq"] == seq + 1
    before = room_state(code)["game"]["seq"]
    bad = send(c, code, tokens["fugitive"], {"type": "hide", "card": 1, "sprints": []})
    assert bad.status_code == 400 and room_state(code)["game"]["seq"] == before
    assert c.post(f"/fugitive/api/play/{code}/move", json=[1],
                  headers={"X-Fugitive-Token": tokens["fugitive"]}).status_code == 400


def test_only_the_dealer_frees_a_seat_and_the_old_token_stops_working():
    c = client()
    game, tokens = seated_game(c)
    code = game["code"]
    assert c.post(f"/fugitive/api/play/{code}/seats/marshal/release",
                  headers={"X-Fugitive-Token": tokens["fugitive"]}).status_code == 403
    assert c.post(f"/fugitive/api/play/{code}/seats/marshal/release",
                  headers={"X-Fugitive-Token": game["host_token"]}).status_code == 200
    gone = state(c, code, tokens["marshal"])
    assert gone["you"] == {"role": None, "seat": None} and gone["game"]["viewer"] == "table"
    assert not gone["seats"]["marshal"]["taken"]


def play_out(c, code, tokens, seed=1):
    """Play to the end with legal moves, through the API."""
    rng = random.Random(seed)
    for _ in range(500):
        game = room_state(code)["game"]
        if game["phase"] == "game_over":
            return game
        role, move = random_move(game, rng)
        assert send(c, code, tokens[role], move).status_code == 200
    raise AssertionError("game never ended")


def test_a_finished_game_is_recorded_once_by_the_server():
    c = client()
    game, tokens = seated_game(c)
    finished = play_out(c, game["code"], tokens)
    stats = c.get("/fugitive/api/stats").get_json()
    assert stats["games_played"] == 1
    winner = "Ana" if finished["winner"] == "fugitive" else "Ben"
    assert stats["leaderboard"][0]["name"] == winner
    ana = stats["players"]["ana"]
    assert (ana["games"], ana["fugitive_games"], ana["marshal_games"]) == (1, 1, 0)
    assert stats["recent"][0]["reason"] == finished["reason"]
    # Looking again doesn't record it again.
    state(c, game["code"])
    assert c.get("/fugitive/api/stats").get_json()["games_played"] == 1
    assert c.get("/fugitive/stats").status_code == 200


def test_a_game_abandoned_before_anyone_moved_is_not_recorded():
    c = client()
    game, tokens = seated_game(c)
    assert send(c, game["code"], tokens["marshal"], {"type": "resign"}).status_code == 200
    assert c.get("/fugitive/api/stats").get_json()["games_played"] == 0


def test_a_rematch_swaps_roles_and_takes_everyone_with_it():
    c = client()
    game, tokens = seated_game(c)
    code = game["code"]
    host = {"X-Fugitive-Token": game["host_token"]}
    assert c.post(f"/fugitive/api/play/{code}/rematch", headers=host).status_code == 400
    play_out(c, code, tokens)
    assert c.post(f"/fugitive/api/play/{code}/rematch",
                  headers={"X-Fugitive-Token": tokens["fugitive"]}).status_code == 403

    fresh = c.post(f"/fugitive/api/play/{code}/rematch", headers=host).get_json()
    again = c.post(f"/fugitive/api/play/{code}/rematch", headers=host).get_json()
    assert fresh["code"] == again["code"] != code
    assert state(c, code)["next"] == fresh["code"]

    swapped = state(c, fresh["code"], tokens["fugitive"])
    assert swapped["players"] == {"fugitive": "Ben", "marshal": "Ana"}
    # Ana's token now sits in the Marshal's seat.
    assert swapped["you"] == {"role": "seat", "seat": "marshal"}
    assert swapped["game"]["phase"] == "fugitive_hide"


def test_a_game_survives_a_restart():
    from core.rooms import rooms

    c = client()
    game, tokens = seated_game(c)
    send(c, game["code"], tokens["fugitive"], {"type": "hide", "card": 3, "sprints": []})
    rooms._rooms.clear()
    back = state(c, game["code"], tokens["fugitive"])
    assert back["game"]["hideouts"][1]["card"] == 3


def test_codes_join_the_table_from_the_web_and_the_app():
    c = client()
    code = new_game(c)["code"]
    res = c.get(f"/join?code={code.lower()}")
    assert res.status_code == 302 and res.headers["Location"].endswith(f"/fugitive/play/{code}")
    assert c.get(f"/api/join/{code}").get_json() == {
        "code": code, "game": "fugitive", "path": f"/fugitive/play/{code}"}


def test_pages_render_and_stay_on_this_server():
    c = client()
    code = new_game(c)["code"]
    css = (ROOT / "static" / "fugitive.css").read_text()
    for path in ("/fugitive/", f"/fugitive/play/{code}", "/fugitive/rules", "/fugitive/stats",
                 f"/fugitive/rules?back=/fugitive/play/{code}"):
        res = c.get(path)
        assert res.status_code == 200, path
        body = res.get_data(as_text=True)
        assert 'rel="manifest"' in body
        for text in (body, css):
            assert "http://" not in text and "https://" not in text, path
    assert c.get("/fugitive/play/ZZZZ").status_code == 404
    # The back link only ever leads somewhere in this game.
    assert 'href="/fugitive/"' in c.get("/fugitive/rules?back=https://evil.example/").get_data(as_text=True)


def test_the_rules_page_quotes_the_engine():
    from games.fugitive import engine

    body = client().get("/fugitive/rules").get_data(as_text=True)
    assert f"at most {engine.MAX_STEP} higher" in body
    assert f"above {engine.MANHUNT_MAX_REVEALED}" in body
    assert "1, 2, 3, 42" in body
