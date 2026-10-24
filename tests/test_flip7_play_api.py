"""Flip 7 played on the app's deck: the JSON API, its guards, and a game
surviving a restart. The rules themselves are in test_flip7_engine.py."""

from pathlib import Path

from test_smoke import client

ROOT = Path(__file__).resolve().parent.parent


def new_game(c, names=("Ana", "Ben", "Cat")):
    res = c.post("/flip7/api/play", json={"players": list(names)})
    assert res.status_code == 200, res.get_json()
    return res.get_json()


def send(c, game, move, token=None):
    body = {**move, "seq": game["game"]["seq"]}
    headers = {"X-Flip7-Token": token} if token else {}
    return c.post(f"/flip7/api/play/{game['code']}/move", json=body, headers=headers)


def current_move(view):
    """Something legal for whoever the table is waiting on."""
    pending = view["pending"]
    if view["phase"] == "round_over":
        return {"type": "next_round"}
    if pending["kind"] == "give":
        return {"type": "give", "player": pending["player"], "target": pending["options"][0]}
    return {"type": "hit", "player": pending["player"]}


def test_a_game_is_dealt_and_never_shows_its_deck():
    c = client()
    game = new_game(c)
    assert game["host_token"]
    view = c.get(f"/flip7/api/play/{game['code']}").get_json()
    assert view["code"] == game["code"]
    assert "host_token" not in view
    assert "deck" not in view["game"] and "tasks" not in view["game"]
    assert [p["name"] for p in view["game"]["players"]] == ["Ana", "Ben", "Cat"]


def test_bad_seating_is_refused():
    c = client()
    for players in ([], ["Solo"], ["Ana", "ana"], ["Ana", ""], [f"P{i}" for i in range(13)], "Ana"):
        assert c.post("/flip7/api/play", json={"players": players}).status_code == 400, players


def test_moves_need_the_token():
    c = client()
    game = new_game(c)
    move = current_move(game["game"])
    assert send(c, game, move).status_code == 403
    assert send(c, game, move, token="nope").status_code == 403
    assert send(c, game, move, token=game["host_token"]).status_code == 200


def test_a_double_tap_is_one_move():
    c = client()
    game = new_game(c)
    move = current_move(game["game"])
    first = send(c, game, move, token=game["host_token"])
    second = send(c, game, move, token=game["host_token"])   # same seq again
    assert first.status_code == 200
    assert second.status_code == 409
    # The refusal carries the table as it now is, so the page can catch up.
    assert second.get_json()["game"]["seq"] == first.get_json()["game"]["seq"]


def test_an_illegal_move_is_a_400_and_changes_nothing():
    c = client()
    game = new_game(c)
    res = send(c, game, {"type": "next_round"}, token=game["host_token"])
    assert res.status_code == 400
    assert res.get_json()["game"]["seq"] == game["game"]["seq"]


def test_wrong_codes_are_throttled_and_spectator_codes_kept_apart():
    c = client()
    assert c.get("/flip7/api/play/ZZZZ").status_code == 404
    board = c.post("/flip7/rooms").get_json()
    assert c.get(f"/flip7/api/play/{board['code']}").status_code == 404
    game = new_game(c)
    pushed = c.post(f"/flip7/api/{game['code']}/board", json={"players": []},
                    headers={"X-Flip7-Token": game["host_token"]})
    assert pushed.status_code == 409


def test_a_game_code_at_join_lands_on_the_table():
    c = client()
    game = new_game(c)
    joined = c.get(f"/join?code={game['code']}")
    assert joined.headers["Location"].endswith(f"/flip7/watch/{game['code']}")
    watch = c.get(f"/flip7/watch/{game['code']}")
    assert watch.headers["Location"].endswith(f"/flip7/play/{game['code']}")
    assert c.get(f"/flip7/play/{game['code']}").status_code == 200
    assert c.get("/flip7/play").status_code == 200


def test_a_game_survives_a_restart():
    from core.rooms import rooms

    c = client()
    game = new_game(c)
    after = send(c, game, current_move(game["game"]), token=game["host_token"]).get_json()

    rooms._rooms.clear()        # what a restart does to memory

    back = c.get(f"/flip7/api/play/{game['code']}").get_json()
    assert back["game"] == after["game"]
    # And the dealer can carry on with the token they already had.
    assert send(c, back, current_move(back["game"]), token=game["host_token"]).status_code == 200
    rooms._rooms.clear()
    assert c.get(f"/join?code={game['code']}").status_code == 302


def test_a_saved_code_is_not_handed_out_again(monkeypatch):
    import core.rooms as core_rooms
    from core.rooms import rooms

    c = client()
    game = new_game(c)
    rooms._rooms.clear()
    picks = iter([list(game["code"]), list("WXYZ")])
    monkeypatch.setattr(core_rooms.random, "choices", lambda *a, **k: next(picks))
    assert rooms._unique_code() == "WXYZ"


def test_a_finished_game_is_recorded_once():
    c = client()
    game = new_game(c, names=("Ana", "Ben"))
    view = game
    for _ in range(5000):
        if view["game"]["phase"] == "game_over":
            break
        res = send(c, view, current_move(view["game"]), token=game["host_token"])
        assert res.status_code == 200, res.get_json()
        view = res.get_json()
    assert view["game"]["phase"] == "game_over"
    assert view["game"]["recorded"] is True

    record = c.get("/flip7/api/stats").get_json()
    assert record["games_played"] == 1
    assert sum(p["wins"] for p in record["players"].values()) >= 1
    # Polling the finished table doesn't record it again.
    c.get(f"/flip7/api/play/{game['code']}")
    assert c.get("/flip7/api/stats").get_json()["games_played"] == 1


def test_the_play_page_does_not_call_out_to_the_internet():
    body = client().get("/flip7/play").get_data(as_text=True)
    script = (ROOT / "static" / "flip7.js").read_text()
    for text in (body, script):
        text = text.replace("http://www.w3.org/2000/svg", "")
        assert "http://" not in text and "https://" not in text


def test_side_pages_lead_back_to_the_table_and_nowhere_else():
    """An installed app has no back button of its own, so the rules and the
    records return to the table that opened them — but only to a Flip 7 page."""
    c = client()
    table = c.get("/flip7/rules?back=/flip7/play/ABCD").get_data(as_text=True)
    assert 'href="/flip7/play/ABCD"' in table
    for bad in ("https://evil.example/", "//evil.example/flip7/", "/flip7//evil", "/ito/host/ABCD"):
        body = c.get("/flip7/stats", query_string={"back": bad}).get_data(as_text=True)
        assert 'aria-label="Back"' in body and 'href="/flip7/"' in body, bad


# --- seats: a phone per player -------------------------------------------

def claim(c, game, seat):
    return c.post(f"/flip7/api/play/{game['code']}/seats/{seat}/claim")


def finish(c, game, token):
    view = game
    for _ in range(5000):
        if view["game"]["phase"] == "game_over":
            return view
        res = send(c, view, current_move(view["game"]), token=token)
        assert res.status_code == 200, res.get_json()
        view = res.get_json()
    raise AssertionError("game never finished")


def test_a_phone_takes_a_seat_once():
    c = client()
    game = new_game(c)
    first = claim(c, game, 1)
    assert first.status_code == 200
    body = first.get_json()
    assert body["you"] == {"role": "seat", "seat": 1}
    assert [s["taken"] for s in body["seats"]] == [False, True, False]
    assert claim(c, game, 1).status_code == 409
    assert claim(c, game, 7).status_code == 404
    # Nobody can tell from the table which token sits where.
    view = c.get(f"/flip7/api/play/{game['code']}").get_json()
    assert body["seat_token"] not in str(view)
    assert view["you"] == {"role": None, "seat": None}


def test_a_seat_moves_only_for_itself_and_the_dealer_for_anyone():
    c = client()
    game = new_game(c)
    seats = [claim(c, game, i).get_json()["seat_token"] for i in range(3)]
    view = c.get(f"/flip7/api/play/{game['code']}").get_json()
    move = current_move(view["game"])
    mover = move["player"]
    other = (mover + 1) % 3

    assert send(c, view, move, token=seats[other]).status_code == 403
    assert send(c, view, move, token=seats[mover]).status_code == 200

    view = c.get(f"/flip7/api/play/{game['code']}").get_json()
    # The dealer's device can still play anyone's turn — the fallback for a
    # phone that's gone to sleep.
    assert send(c, view, current_move(view["game"]), token=game["host_token"]).status_code == 200


def test_the_state_tells_a_device_who_it_is():
    c = client()
    game = new_game(c)
    token = claim(c, game, 2).get_json()["seat_token"]
    url = f"/flip7/api/play/{game['code']}"
    assert c.get(url, headers={"X-Flip7-Token": token}).get_json()["you"] == {"role": "seat", "seat": 2}
    assert c.get(url, headers={"X-Flip7-Token": game["host_token"]}).get_json()["you"]["role"] == "host"
    assert c.get(url, headers={"X-Flip7-Token": "nope"}).get_json()["you"]["role"] is None


def test_only_the_dealer_frees_a_seat_and_the_old_phone_is_out():
    c = client()
    game = new_game(c)
    token = claim(c, game, 0).get_json()["seat_token"]
    release = f"/flip7/api/play/{game['code']}/seats/0/release"
    assert c.post(release, headers={"X-Flip7-Token": token}).status_code == 403
    freed = c.post(release, headers={"X-Flip7-Token": game["host_token"]})
    assert freed.status_code == 200
    assert freed.get_json()["seats"][0]["taken"] is False

    view = c.get(f"/flip7/api/play/{game['code']}", headers={"X-Flip7-Token": token}).get_json()
    assert view["you"]["role"] is None
    assert claim(c, game, 0).status_code == 200


def test_seats_survive_a_restart():
    from core.rooms import rooms

    c = client()
    game = new_game(c)
    token = claim(c, game, 1).get_json()["seat_token"]
    rooms._rooms.clear()
    view = c.get(f"/flip7/api/play/{game['code']}", headers={"X-Flip7-Token": token}).get_json()
    assert view["you"] == {"role": "seat", "seat": 1}


def test_a_rematch_keeps_everyone_in_their_seat():
    c = client()
    game = new_game(c, names=("Ana", "Ben"))
    seat = claim(c, game, 1).get_json()["seat_token"]
    rematch = f"/flip7/api/play/{game['code']}/rematch"
    host = {"X-Flip7-Token": game["host_token"]}

    assert c.post(rematch, headers=host).status_code == 400      # not over yet
    finish(c, game, game["host_token"])
    assert c.post(rematch, headers={"X-Flip7-Token": seat}).status_code == 403

    first = c.post(rematch, headers=host).get_json()
    again = c.post(rematch, headers=host).get_json()
    assert first == again                                          # one rematch, not two
    assert first["host_token"] == game["host_token"]

    old = c.get(f"/flip7/api/play/{game['code']}").get_json()
    assert old["next"] == first["code"]
    new = c.get(f"/flip7/api/play/{first['code']}", headers={"X-Flip7-Token": seat}).get_json()
    assert new["you"] == {"role": "seat", "seat": 1}
    assert new["game"]["phase"] == "playing" and new["game"]["round"] == 1
    assert [p["name"] for p in new["game"]["players"]] == ["Ana", "Ben"]
