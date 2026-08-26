"""Enough coverage to catch a broken route or a room that doesn't isolate."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import create_app  # noqa: E402


def client():
    app = create_app()
    app.config["TESTING"] = True
    return app.test_client()


def new_room(c):
    res = c.post("/ito/rooms")
    assert res.status_code == 302
    return res.headers["Location"].rsplit("/", 1)[-1]


def test_hub_lists_every_game():
    """/ used to short-circuit to ito when it was the only game. With two on
    the shelf it's a menu again, and both have to be on it."""
    from games.registry import playable_games

    body = client().get("/").get_data(as_text=True)
    for game in playable_games():
        assert game.name in body, game.id
        assert f"/{game.id}" in body, game.id


def test_every_game_has_artwork_and_an_accent():
    """The menu tiles are drawn per game; a game without either would render
    as an untinted blank card."""
    from games.registry import playable_games

    for game in playable_games():
        assert game.accent.startswith("#"), game.id
        art = Path(__file__).resolve().parent.parent / "templates" / "art" / f"{game.id}.html"
        assert art.exists(), f"no hub artwork for {game.id}"


def test_flip7_pages_render_without_a_room():
    """A Flip 7 room is optional — the scorekeeper is a whole game on its own,
    and the hub opens it directly rather than starting a room for it."""
    from games.flip7.game import GAME as FLIP7

    c = client()
    assert not FLIP7.starts_rooms
    assert c.get("/flip7/").status_code == 200
    assert c.get("/flip7/rules").status_code == 200
    assert "Open scorekeeper" in c.get("/").get_data(as_text=True)


def test_flip7_does_not_call_out_to_the_internet():
    """The app has to work on a LAN with no internet, and no player's browser
    should be fetching fonts from a third party mid-game."""
    body = client().get("/flip7/").get_data(as_text=True)
    css = (Path(__file__).resolve().parent.parent / "static" / "flip7.css").read_text()
    for text in (body, css):
        assert "http://" not in text and "https://" not in text


def test_flip7_scoring_matches_the_rules_page():
    """The scoring is in the page's JS, so this pins the rules the app claims:
    x2 doubles the numbers only, flat modifiers are added after, seven
    distinct numbers is +15, and a bust is worth nothing at all."""
    body = client().get("/flip7/").get_data(as_text=True)
    assert "if (entry.bust) return 0;" in body
    assert "entry.x2 ? base*2 : base" in body
    assert "entry.numbers.length >= 7 ? 15 : 0" in body
    assert "doubled + flat + flip7" in body


def test_host_and_player_pages_render():
    c = client()
    code = new_room(c)
    assert c.get(f"/ito/host/{code}").status_code == 200
    assert c.get(f"/ito/play/{code}").status_code == 200
    assert c.get("/ito/rules").status_code == 200
    assert c.get("/ito/stats").status_code == 200


def test_unknown_room_is_404():
    c = client()
    assert c.get("/ito/play/ZZZZ").status_code == 404
    assert c.get("/ito/api/ZZZZ/state").status_code == 404


def test_join_redirects_to_the_right_room():
    c = client()
    code = new_room(c)
    res = c.get(f"/join?code={code.lower()}")
    assert res.status_code == 302 and code in res.headers["Location"]
    assert c.get("/join?code=ZZZZ").status_code == 404


def test_rooms_do_not_share_topics():
    c = client()
    a, b = new_room(c), new_room(c)
    c.post(f"/ito/api/{a}/draw", json={})
    state_a = c.get(f"/ito/api/{a}/state").get_json()
    state_b = c.get(f"/ito/api/{b}/state").get_json()
    assert state_a["round_number"] == 1
    assert state_b["round_number"] == 0 and state_b["current_topic"] is None


def test_draw_respects_category_and_reset_clears_history():
    c = client()
    code = new_room(c)
    topics = c.get("/ito/api/topics").get_json()
    category = next(iter(topics))
    drawn = c.post(f"/ito/api/{code}/draw", json={"category": category}).get_json()
    assert drawn["current_type"] == category
    assert drawn["current_topic"] in [t["text"] for t in topics[category]]
    # Every card names both ends of its scale, like the printed ones.
    assert drawn["current_low"] and drawn["current_high"]

    after = c.post(f"/ito/api/{code}/reset", json={}).get_json()
    assert after["round_number"] == 0 and after["used"] == []


def test_result_records_stats_and_rejects_junk():
    c = client()
    code = new_room(c)
    c.post(f"/ito/api/{code}/draw", json={})
    before = c.get("/ito/api/stats").get_json()["rounds_played"]
    after = c.post(f"/ito/api/{code}/result", json={"outcome": "win"}).get_json()
    assert after["rounds_played"] == before + 1
    assert c.post(f"/ito/api/{code}/result", json={"outcome": "nope"}).status_code == 400


def test_qr_endpoint_serves_svg():
    res = client().get("/qr.svg?path=/ito/play/ABCD")
    assert res.status_code == 200 and res.mimetype == "image/svg+xml"


def test_a_round_can_only_be_scored_once():
    c = client()
    code = new_room(c)
    # Nothing drawn yet, so there's nothing to score.
    assert c.post(f"/ito/api/{code}/result", json={"outcome": "win"}).status_code == 409

    c.post(f"/ito/api/{code}/draw", json={})
    assert c.post(f"/ito/api/{code}/result", json={"outcome": "win"}).status_code == 200
    assert c.post(f"/ito/api/{code}/result", json={"outcome": "win"}).status_code == 409

    # Drawing again opens a fresh round to score.
    c.post(f"/ito/api/{code}/draw", json={})
    assert c.post(f"/ito/api/{code}/result", json={"outcome": "lose"}).status_code == 200


def test_side_pages_return_you_to_your_room():
    c = client()
    code = new_room(c)
    body = c.get(f"/ito/rules?code={code}").get_data(as_text=True)
    assert f"/ito/host/{code}" in body
    # Without a code — reached from the landing page — it falls back to ito's home.
    assert f"/ito/host/" not in c.get("/ito/rules").get_data(as_text=True)


def test_settings_page_lists_and_edits_topics():
    c = client()
    code = new_room(c)
    assert c.get(f"/ito/settings/{code}").status_code == 200
    assert c.get("/ito/settings/ZZZZ").status_code == 404

    category = next(iter(c.get("/ito/api/topics").get_json()))
    added = c.post("/ito/api/topics", json={
        "category": category, "text": "Test topic", "low": "Nope", "high": "Yep",
    }).get_json()
    assert {"text": "Test topic", "low": "Nope", "high": "Yep"} in added[category]

    removed = c.post("/ito/api/topics/delete",
                     json={"category": category, "text": "Test topic"}).get_json()
    assert "Test topic" not in [t["text"] for t in removed[category]]
    assert c.post("/ito/api/topics/delete",
                  json={"category": category, "text": "nope"}).status_code == 400


def test_topics_saved_as_bare_strings_still_load():
    """topics.json is hand-editable, and predates scale labels."""
    from games.ito.game import normalise_topic

    assert normalise_topic("Cute animals") == {
        "text": "Cute animals", "low": "Low", "high": "High",
    }
    assert normalise_topic({"text": "X", "low": "", "high": None}) == {
        "text": "X", "low": "Low", "high": "High",
    }


def test_any_draw_still_reports_the_topics_own_category():
    """The card's chip needs a real category even with no filter applied."""
    c = client()
    code = new_room(c)
    drawn = c.post(f"/ito/api/{code}/draw", json={}).get_json()
    assert drawn["current_type"] is None          # no filter was applied
    assert drawn["current_category"] in c.get("/ito/api/topics").get_json()


def test_qr_uses_the_public_url_behind_a_proxy():
    """Behind Traefik the QR must encode https://<domain>/..., not the
    container's internal address — a phone can't reach the latter."""
    from core.qr import svg as qr_svg

    res = client().get(
        "/qr.svg?path=/ito/play/ABCD",
        headers={
            "X-Forwarded-Proto": "https",
            "X-Forwarded-Host": "gamenight.collardserver.co.uk",
        },
    )
    assert res.status_code == 200
    expected = qr_svg("https://gamenight.collardserver.co.uk/ito/play/ABCD")
    assert res.data == expected


def test_html_is_never_cached():
    """A stale page against newer CSS/JS is a confusing bug to report."""
    c = client()
    code = new_room(c)
    for path in ("/join", f"/ito/host/{code}", f"/ito/play/{code}"):
        assert "no-store" in c.get(path).headers["Cache-Control"], path


def test_side_pages_link_back_to_the_room_not_out_of_the_game():
    """The app bar's left button should return you to your room from a side
    page — leaving the game is not what you want from the stats screen."""
    c = client()
    code = new_room(c)
    for path in (f"/ito/rules?code={code}", f"/ito/stats?code={code}",
                 f"/ito/settings/{code}"):
        body = c.get(path).get_data(as_text=True)
        assert f"/ito/host/{code}" in body, path


def test_a_dead_code_on_a_side_page_does_not_offer_a_room():
    """Otherwise the bar would link back to a room that no longer exists."""
    body = client().get("/ito/rules?code=ZZZZ").get_data(as_text=True)
    assert "/ito/host/ZZZZ" not in body


def test_stats_tiles_do_not_use_the_playing_card_class():
    """`.card` is the generic surface panel; the playing card is `.play-card`.
    Conflating them absolutely-positioned the stats tiles on top of each other."""
    css = (Path(__file__).resolve().parent.parent / "static" / "style.css").read_text()
    assert ".play-card {" in css
    # The generic panel must not be absolutely positioned.
    panel = css.split(".card {")[1].split("}")[0]
    assert "position: absolute" not in panel


def test_host_page_markup_is_balanced():
    """A stray </div> survived a refactor once; it renders, but it means the
    page structure isn't what the template appears to say."""
    from html.parser import HTMLParser

    class Balance(HTMLParser):
        VOID = {"br", "img", "input", "meta", "link", "hr", "source", "use", "path",
                "circle", "rect", "ellipse", "stop", "polygon", "line"}

        def __init__(self):
            super().__init__()
            self.stack = []
            self.errors = []

        def handle_starttag(self, tag, attrs):
            if tag not in self.VOID:
                self.stack.append(tag)

        def handle_endtag(self, tag):
            if tag in self.VOID:
                return
            if not self.stack:
                self.errors.append(f"</{tag}> with nothing open")
            elif self.stack[-1] != tag:
                self.errors.append(f"</{tag}> closed while <{self.stack[-1]}> was open")
            else:
                self.stack.pop()

    c = client()
    code = new_room(c)
    parser = Balance()
    parser.feed(c.get(f"/ito/host/{code}").get_data(as_text=True))
    assert not parser.errors, parser.errors
    assert not parser.stack, f"never closed: {parser.stack}"


def test_wide_screens_get_a_second_deck_beside_the_dealt_card():
    """The draw pile keeps the back artwork and category tab on screen when
    there's room; narrow screens fall back to the single flipping card."""
    c = client()
    code = new_room(c)
    body = c.get(f"/ito/host/{code}").get_data(as_text=True)
    assert 'id="draw-pile"' in body and 'id="draw-btn"' in body
    # The pile is face-up-never: it keeps `show-back` permanently.
    assert 'class="play-card show-back" id="deck"' in body

    css = (Path(__file__).resolve().parent.parent / "static" / "style.css").read_text()
    assert ".stage-pile { display: none; }" in css      # hidden by default
    assert "@media (min-width: 900px)" in css           # shown when there's room


def test_healthz_reports_the_running_version():
    """Watchtower deploys `latest`, so this is how you confirm what's live."""
    from app import APP_VERSION

    body = client().get("/healthz").get_json()
    assert body["status"] == "ok"
    assert body["version"] == APP_VERSION
    # No room count: /healthz is public, and it would tell a scanner whether
    # there's anything live worth guessing at.
    assert "rooms" not in body


def test_version_is_shown_in_the_ui():
    from app import APP_VERSION

    c = client()
    code = new_room(c)
    assert APP_VERSION in c.get("/ito/").get_data(as_text=True)
    assert APP_VERSION in c.get(f"/ito/settings/{code}").get_data(as_text=True)


def test_missing_topics_file_is_seeded_not_a_500(tmp_path, monkeypatch):
    """A fresh deploy's bind mount is empty. The room creates fine (that
    doesn't read topics), and every page listing categories used to 500."""
    from games.ito import game

    missing = tmp_path / "fresh" / "topics.json"
    monkeypatch.setattr(game, "TOPICS_PATH", missing)
    assert not missing.exists()

    c = client()
    code = new_room(c)
    assert c.get(f"/ito/host/{code}").status_code == 200
    assert missing.exists(), "topics should have been seeded from the shipped copy"
    assert c.post(f"/ito/api/{code}/draw", json={}).status_code == 200


def test_resume_banner_is_actually_hidden_when_it_has_no_room():
    """`hidden` alone wasn't enough: an author `display` rule beat the
    browser's [hidden], so an empty banner showed for everyone."""
    css = (Path(__file__).resolve().parent.parent / "static" / "style.css").read_text()
    assert ".resume[hidden] { display: none; }" in css
    assert 'id="resume"' in client().get("/ito/").get_data(as_text=True)


def test_wrong_codes_are_throttled_but_the_right_one_always_works():
    """A 4-char code only means something if it can't be swept. Failures are
    counted; correct codes are not, or a normal game's polling would trip it."""
    from core.ratelimit import DEFAULT_LIMIT

    c = client()
    code = new_room(c)

    for _ in range(DEFAULT_LIMIT):
        assert c.get("/ito/api/ZZZZ/state").status_code == 404
    assert c.get("/ito/api/ZZZZ/state").status_code == 429

    # The real code still works from the same client, and clears the misses.
    assert c.get(f"/ito/api/{code}/state").status_code == 200
    assert c.get("/ito/api/YYYY/state").status_code == 404


def test_polling_a_valid_room_is_never_throttled():
    from core.ratelimit import DEFAULT_LIMIT

    c = client()
    code = new_room(c)
    for _ in range(DEFAULT_LIMIT * 3):
        assert c.get(f"/ito/api/{code}/state").status_code == 200


def test_join_page_throttles_wrong_codes_too():
    from core.ratelimit import DEFAULT_LIMIT

    c = client()
    for _ in range(DEFAULT_LIMIT):
        assert c.get("/join?code=ZZZZ").status_code == 404
    assert c.get("/join?code=ZZZZ").status_code == 429


def finished_game(winner_score=210):
    """A minimal completed game: one player over the line, one not."""
    return {"players": [
        {"name": "Ana", "rounds": [
            {"score": winner_score - 36, "bust": False, "flip7": False},
            {"score": 36, "bust": False, "flip7": True},
        ]},
        {"name": "Bo", "rounds": [
            {"score": 40, "bust": False, "flip7": False},
            {"score": 0, "bust": True, "flip7": False},
        ]},
    ]}


def test_flip7_records_a_finished_game():
    c = client()
    assert c.get("/flip7/api/stats").get_json()["games_played"] == 0

    record = c.post("/flip7/api/stats/games", json=finished_game()).get_json()
    assert record["games_played"] == 1

    ana, bo = record["players"]["ana"], record["players"]["bo"]
    assert ana["wins"] == 1 and bo["wins"] == 0
    assert ana["points"] == 210 and ana["flip7s"] == 1
    assert bo["busts"] == 1 and bo["best_game"] == 40
    assert record["best_round"] == {"score": 174, "player": "Ana"}
    assert record["recent"][0]["winner"] == "Ana"

    # A second game accumulates rather than replacing.
    again = c.post("/flip7/api/stats/games", json=finished_game()).get_json()
    assert again["games_played"] == 2 and again["players"]["ana"]["games"] == 2
    assert c.get("/flip7/stats").status_code == 200


def test_flip7_only_records_finished_games():
    """An abandoned game has no winner, and counting it would quietly punish
    whoever happened to be ahead when it stopped."""
    c = client()
    unfinished = {"players": [{"name": "Ana", "rounds": [{"score": 30}]}]}
    assert c.post("/flip7/api/stats/games", json=unfinished).status_code == 400
    assert c.get("/flip7/api/stats").get_json()["games_played"] == 0


def test_flip7_rejects_junk_rather_than_storing_it():
    """The endpoint is unauthenticated, like ito's topic editing. The bar is
    'a bug or a bored guest can't wreck the leaderboard', not real auth."""
    c = client()
    for payload in (
        {},                                                       # no players
        {"players": []},
        {"players": [{"name": "  ", "rounds": []}]},               # nameless
        {"players": [{"name": "Ana", "rounds": [{"score": "lots"}]}]},
        {"players": [{"name": "Ana", "rounds": [{"score": -5}]}]},
        {"players": [{"name": "Ana", "rounds": [{"score": 99999}]}]},
        {"players": [{"name": "A", "rounds": [{"score": 200}]},     # duplicate
                     {"name": "a", "rounds": [{"score": 10}]}]},
        {"players": [{"name": f"P{i}", "rounds": [{"score": 200}]} for i in range(13)]},
    ):
        assert c.post("/flip7/api/stats/games", json=payload).status_code == 400, payload
    assert c.get("/flip7/api/stats").get_json()["games_played"] == 0


def test_flip7_stats_can_be_cleared_and_do_not_touch_itos():
    """One stats.json, one bucket per game — a Flip 7 reset must not take
    ito's streaks with it."""
    c = client()
    code = new_room(c)
    c.post(f"/ito/api/{code}/draw", json={})
    c.post(f"/ito/api/{code}/result", json={"outcome": "win"})
    c.post("/flip7/api/stats/games", json=finished_game())

    cleared = c.post("/flip7/api/stats/reset").get_json()
    assert cleared["games_played"] == 0 and cleared["players"] == {}
    assert c.get("/ito/api/stats").get_json()["wins"] == 1


def test_flip7_page_posts_the_game_once():
    """The winner banner survives a reload, so the post has to be guarded by
    something that survives with it."""
    body = client().get("/flip7/").get_data(as_text=True)
    assert "if (winnerIndex >= 0 && !state.recorded) recordGame();" in body
    assert "state.recorded = !!saved.recorded;" in body
    # Only a successful post counts, or a server that was down at the final
    # round would lose the game silently.
    assert "if (res.ok) { state.recorded = true; save(); }" in body


# --- Flip 7 spectator rooms ---------------------------------------------

def new_flip7_room(c):
    res = c.post("/flip7/rooms")
    assert res.status_code == 200
    return res.get_json()


def test_flip7_room_is_watchable_and_joinable_by_code():
    """The one thing a Flip 7 room does: put the scorekeeper's board on
    everyone else's phone, reachable by the same /join as ito."""
    c = client()
    room = new_flip7_room(c)

    # Nothing to see until the scorekeeper pushes.
    assert c.get(f"/flip7/api/{room['code']}/state").get_json()["board"] is None

    push = c.post(
        f"/flip7/api/{room['code']}/board",
        json={"players": [{"name": "Ana", "scores": [30, 25]}, {"name": "Bo", "scores": [12]}]},
        headers={"X-Flip7-Token": room["host_token"]},
    )
    assert push.status_code == 200
    board = push.get_json()["board"]
    assert [p["total"] for p in board["players"]] == [55, 12]

    watch = c.get(f"/flip7/watch/{room['code']}")
    assert watch.status_code == 200
    assert room["code"] in watch.get_data(as_text=True)

    joined = c.get(f"/join?code={room['code']}")
    assert joined.status_code == 302
    assert joined.headers["Location"].endswith(f"/flip7/watch/{room['code']}")


def test_flip7_board_needs_the_host_token():
    """A code gets read out across a table; the token doesn't. Without this a
    spectator could overwrite the board everyone else is reading."""
    c = client()
    room = new_flip7_room(c)
    good = {"players": [{"name": "Ana", "scores": [10]}]}

    assert c.post(f"/flip7/api/{room['code']}/board", json=good).status_code == 403
    assert c.post(f"/flip7/api/{room['code']}/board", json=good,
                  headers={"X-Flip7-Token": "nope"}).status_code == 403
    # And the token never leaves by the front door.
    assert "host_token" not in c.get(f"/flip7/api/{room['code']}/state").get_json()


def test_flip7_board_rejects_junk():
    c = client()
    room = new_flip7_room(c)
    head = {"X-Flip7-Token": room["host_token"]}

    for payload in (
        {"players": [{"name": "", "scores": []}]},
        {"players": [{"name": "Ana", "scores": ["lots"]}]},
        {"players": [{"name": "Ana", "scores": [99999]}]},
        {"players": [{"name": f"P{i}", "scores": []} for i in range(20)]},
    ):
        res = c.post(f"/flip7/api/{room['code']}/board", json=payload, headers=head)
        assert res.status_code == 400, payload


def test_flip7_rooms_do_not_collide_with_itos():
    """Both games share one code space, and a code only opens its own game."""
    c = client()
    ito_code = new_room(c)
    f7 = new_flip7_room(c)

    assert c.get(f"/flip7/api/{ito_code}/state").status_code == 404
    assert c.get(f"/ito/api/{f7['code']}/state").status_code == 404


def test_flip7_watch_page_has_no_way_to_enter_a_score():
    """Read-only is the whole point: five people editing one scoreboard is a
    worse pad of paper, not a better one."""
    c = client()
    room = new_flip7_room(c)
    body = c.get(f"/flip7/watch/{room['code']}").get_data(as_text=True)

    for entry in ("f7-num", "f7-mod", "Save round", "Add round", "addPlayer"):
        assert entry not in body, entry
