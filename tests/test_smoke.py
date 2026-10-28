"""Enough coverage to catch a broken route or a room that doesn't isolate."""

import json
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
    assert "Play or keep score" in c.get("/").get_data(as_text=True)


def test_flip7_does_not_call_out_to_the_internet():
    """The app has to work on a LAN with no internet, and no player's browser
    should be fetching fonts from a third party mid-game."""
    body = client().get("/flip7/").get_data(as_text=True)
    css = (Path(__file__).resolve().parent.parent / "static" / "flip7.css").read_text()
    # The SVG namespace is an XML identifier, not an address — createElementNS
    # never fetches it. Everything else that looks like a URL is a real one.
    for text in (body.replace("http://www.w3.org/2000/svg", ""), css):
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


def test_flip7_seventh_number_ends_the_turn():
    """Seven numbers is the end of a turn by rule, not a choice, so the entry
    page has to lock it and the rules page has to say so."""
    body = client().get("/flip7/").get_data(as_text=True)
    rules = client().get("/flip7/rules").get_data(as_text=True)
    assert "d.bust || d.frozen || d.numbers.length >= 7" in body
    assert "turn is over" in rules


def test_host_and_player_pages_render():
    c = client()
    code = new_room(c)
    assert c.get(f"/ito/host/{code}").status_code == 200
    player = c.get(f"/ito/play/{code}")
    assert player.status_code == 200
    # The installed app has no browser chrome: the display needs its own way out.
    assert 'class="display-leave" href="/"' in player.get_data(as_text=True)
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


def test_reroll_swaps_the_card_without_starting_a_round():
    """Swapping a topic you don't like isn't a round played: the round number
    and the result still owed on it both have to survive it. draw_id is what
    the display views watch, so that must move or no phone re-flips."""
    c = client()
    code = new_room(c)
    first = c.post(f"/ito/api/{code}/draw", json={}).get_json()
    after = c.post(f"/ito/api/{code}/draw", json={"reroll": True}).get_json()
    assert after["round_number"] == first["round_number"] == 1
    assert after["draw_id"] == first["draw_id"] + 1
    assert after["scored"] is False

    # A reroll before the first card is just a draw — there's no round to keep.
    fresh = new_room(c)
    started = c.post(f"/ito/api/{fresh}/draw", json={"reroll": True}).get_json()
    assert started["round_number"] == 1

    # And it doesn't clear a result already recorded for the round.
    c.post(f"/ito/api/{code}/result", json={"outcome": "win"})
    assert c.post(f"/ito/api/{code}/draw", json={"reroll": True}).get_json()["scored"]


def test_settings_is_reachable_without_a_room():
    """Topics are global, so editing them shouldn't need a game in progress."""
    c = client()
    page = c.get("/ito/settings")
    assert page.status_code == 200
    body = page.get_data(as_text=True)
    # No room, so nothing room-scoped on the page.
    assert "Clear this room's topic history" not in body
    assert "Reset all ito stats" in body


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
    assert "if (winners.length && !state.recorded && !recordFailure) recordGame();" in body
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


# --- sweep fixes: winners, empty categories, data files, junk JSON ---------

def two_past_the_line(first=205, second=230):
    """Both players cross 200 in the same final round, the lower one seated
    first — the case the scorekeeper used to get wrong."""
    return {"players": [
        {"name": "Ana", "rounds": [{"score": first - 20}, {"score": 20}]},
        {"name": "Bo", "rounds": [{"score": second - 40}, {"score": 40}]},
    ]}


def test_flip7_highest_total_wins_not_the_first_past_the_line():
    record = client().post("/flip7/api/stats/games", json=two_past_the_line()).get_json()
    assert record["players"]["bo"]["wins"] == 1
    assert record["players"]["ana"]["wins"] == 0
    assert record["recent"][0] == {**record["recent"][0], "winner": "Bo", "score": 230}


def test_flip7_a_tie_at_the_top_is_a_shared_win():
    record = client().post("/flip7/api/stats/games",
                           json=two_past_the_line(210, 210)).get_json()
    assert record["players"]["ana"]["wins"] == record["players"]["bo"]["wins"] == 1
    assert record["recent"][0]["winner"] == "Ana, Bo"


def test_flip7_pages_pick_the_winner_the_way_the_records_do():
    """No JS runner here, so pin the rule by its text: the screen must go on
    the top total, like record_game, not the first seat to reach 200."""
    c = client()
    page = c.get("/flip7/").get_data(as_text=True)
    assert "totals.findIndex(t => t >= TARGET_SCORE)" not in page
    assert "if (top < TARGET_SCORE) return [];" in page
    assert "filter(i => totals[i] === top)" in page

    code = c.post("/flip7/rooms").get_json()["code"]
    watch = c.get(f"/flip7/watch/{code}").get_data(as_text=True)
    assert "players.find(p => p.total >= TARGET_SCORE)" not in watch
    assert "players.filter(p => p.total === maxTotal)" in watch


def test_flip7_page_checks_names_the_way_the_records_do():
    """A game the server would refuse (duplicate names, too many players)
    mustn't be set up in the first place, and a refusal must be shown."""
    from games.flip7.game import MAX_NAME, MAX_PLAYERS

    page = client().get("/flip7/").get_data(as_text=True)
    assert f"const MAX_PLAYERS = {MAX_PLAYERS};" in page
    assert f"const MAX_NAME = {MAX_NAME};" in page
    assert "state.players.length >= MAX_PLAYERS" in page
    assert "nameKey(cleanName(p.name)) === nameKey(name)" in page
    assert "recordFailure = failure;" in page
    # A board nobody has won can't have been recorded: a new game resets it.
    assert "if (!winners.length) { state.recorded = false; recordFailure = null; }" in page


def empty_category(c):
    """Delete every topic in one category through the API, as Settings would."""
    topics = c.get("/ito/api/topics").get_json()
    category = next(iter(topics))
    for topic in topics[category]:
        assert c.post("/ito/api/topics/delete",
                      json={"category": category, "text": topic["text"]}).status_code == 200
    return category


def test_an_emptied_category_is_a_clear_409_not_a_500():
    c = client()
    code = new_room(c)
    category = empty_category(c)
    res = c.post(f"/ito/api/{code}/draw", json={"category": category})
    assert res.status_code == 409
    assert "no topics" in res.get_json()["error"]
    # Nothing was dealt.
    assert c.get(f"/ito/api/{code}/state").get_json()["draw_id"] == 0
    # "Any" still draws from what's left.
    assert c.post(f"/ito/api/{code}/draw", json={}).status_code == 200


def test_an_emptied_category_is_kept_off_the_wheel():
    c = client()
    code = new_room(c)
    category = empty_category(c)
    host = c.get(f"/ito/host/{code}").get_data(as_text=True)
    assert f'data-cat="{category}"' not in host
    # Settings still lists it, so it can be topped up again.
    assert f'value="{category}"' in c.get("/ito/settings").get_data(as_text=True)


def test_an_empty_topic_list_does_not_break_any(monkeypatch):
    from games.ito import game

    c = client()
    code = new_room(c)
    for content in ({}, {"wordplay": []}):
        game.TOPICS_PATH.write_text(json.dumps(content))
        res = c.post(f"/ito/api/{code}/draw", json={})
        assert res.status_code == 409, content
        assert "no topics" in res.get_json()["error"]


def test_a_damaged_topics_file_falls_back_to_its_backup():
    from core import jsonfile
    from games.ito import game

    c = client()
    code = new_room(c)
    category = next(iter(c.get("/ito/api/topics").get_json()))
    # Any save leaves the previous good copy behind as .bak.
    c.post("/ito/api/topics", json={"category": category, "text": "Kept"})
    assert jsonfile.backup_path(game.TOPICS_PATH).exists()

    game.TOPICS_PATH.write_text('{"half a fi')
    assert c.post(f"/ito/api/{code}/draw", json={}).status_code == 200

    jsonfile.backup_path(game.TOPICS_PATH).write_text("")
    res = c.post(f"/ito/api/{code}/draw", json={})
    assert res.status_code == 503 and "topic list is damaged" in res.get_json()["error"]
    assert c.get(f"/ito/host/{code}").status_code == 503


def test_stats_writes_are_atomic_and_keep_a_backup(tmp_path):
    from core import jsonfile, stats

    stats.record("ito", "win")
    stats.record("ito", "lose")
    assert json.loads(stats.STATS_PATH.read_text())["ito"]["rounds_played"] == 2
    # The copy from before the last write.
    assert json.loads(jsonfile.backup_path(stats.STATS_PATH).read_text())["ito"]["rounds_played"] == 1
    # No temp files left lying around.
    assert sorted(p.name for p in stats.STATS_PATH.parent.glob(".stats.json.*")) == []


def test_a_damaged_stats_file_is_never_written_over():
    """It used to read as {} — and the next result saved 'empty plus one' over
    everybody's history."""
    from core import jsonfile, stats

    c = client()
    code = new_room(c)
    stats.record("ito", "win")
    stats.record("ito", "win")       # .bak now holds one win
    stats.STATS_PATH.write_text('{"ito": {"wins": 2, "rou')
    damaged = stats.STATS_PATH.read_text()

    c.post(f"/ito/api/{code}/draw", json={})
    res = c.post(f"/ito/api/{code}/result", json={"outcome": "win"})
    assert res.status_code == 503 and "damaged" in res.get_json()["error"]
    assert c.post("/flip7/api/stats/games", json=finished_game()).status_code == 503
    assert c.post("/flip7/api/stats/reset").status_code == 503
    assert stats.STATS_PATH.read_text() == damaged

    # The round is still owed its result, so it can be logged once fixed.
    assert c.get(f"/ito/api/{code}/state").get_json()["scored"] is False

    # Read-only pages show the last good copy rather than falling over.
    assert c.get("/ito/api/stats").get_json()["wins"] == 1
    assert c.get("/flip7/stats").status_code == 200
    assert c.get("/ito/stats").status_code == 200

    stats.STATS_PATH.write_text(jsonfile.backup_path(stats.STATS_PATH).read_text())
    assert c.post(f"/ito/api/{code}/result", json={"outcome": "win"}).status_code == 200


def test_concurrent_topic_edits_all_land():
    import threading

    c_app = create_app()
    category = next(iter(c_app.test_client().get("/ito/api/topics").get_json()))

    def add(n):
        c_app.test_client().post("/ito/api/topics",
                                 json={"category": category, "text": f"Concurrent {n}"})

    threads = [threading.Thread(target=add, args=(n,)) for n in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    texts = {t["text"] for t in c_app.test_client().get("/ito/api/topics").get_json()[category]}
    assert {f"Concurrent {n}" for n in range(20)} <= texts


def test_junk_json_is_a_400_not_a_500():
    c = client()
    code = new_room(c)
    category = next(iter(c.get("/ito/api/topics").get_json()))
    for url, payload in (
        (f"/ito/api/{code}/draw", ["not", "an", "object"]),
        (f"/ito/api/{code}/draw", {"category": ["a", "list"]}),
        (f"/ito/api/{code}/draw", {"category": {"a": 1}}),
        (f"/ito/api/{code}/result", ["win"]),
        (f"/ito/api/{code}/result", "win"),
        ("/ito/api/topics", ["x"]),
        ("/ito/api/topics", {"category": ["x"], "text": "Hi"}),
        ("/ito/api/topics", {"category": category, "text": 7}),
        ("/ito/api/topics", {"category": category, "text": "Hi", "low": 3}),
        ("/ito/api/topics/delete", ["x"]),
        ("/ito/api/topics/delete", {"category": ["x"], "text": "Hi"}),
        ("/ito/api/topics/delete", {"category": category, "text": ["Hi"]}),
        ("/flip7/api/stats/games", {"players": [{"name": 7, "rounds": [{"score": 200}]}]}),
        ("/flip7/api/stats/games", {"players": [{"name": ["A"], "rounds": []}]}),
        ("/flip7/api/stats/games", ["players"]),
    ):
        assert c.post(url, json=payload).status_code == 400, (url, payload)

    room = new_flip7_room(c)
    head = {"X-Flip7-Token": room["host_token"]}
    assert c.post(f"/flip7/api/{room['code']}/board", headers=head,
                  json={"players": [{"name": 7, "scores": []}]}).status_code == 400
    # A non-ASCII token is just a wrong token.
    assert c.post(f"/flip7/api/{room['code']}/board",
                  headers={"X-Flip7-Token": "caf\u00e9".encode().decode("latin-1")},
                  json={"players": []}).status_code == 403


def test_a_hand_edited_topics_file_with_junk_entries_still_loads():
    from games.ito import game

    game.TOPICS_PATH.write_text(json.dumps({
        "wordplay": ["Fine", 42, None, {"text": 5}, {"text": "Also fine", "low": 1}],
        "broken": "not a list",
    }))
    topics = game.load_topics()
    assert [t["text"] for t in topics["wordplay"]] == ["Fine", "Also fine"]
    assert topics["wordplay"][1]["low"] == "Low"
    assert "broken" not in topics


def test_side_pages_count_wrong_codes_against_the_throttle():
    """Whether the back link names a room says whether the code is live, so
    /ito/rules and /ito/stats are a guessing oracle without this."""
    from core.ratelimit import DEFAULT_LIMIT

    c = client()
    code = new_room(c)
    for i in range(DEFAULT_LIMIT):
        page = "/ito/rules" if i % 2 else "/ito/stats"
        assert c.get(f"{page}?code=ZZZZ").status_code == 200
    assert c.get("/ito/rules?code=ZZZZ").status_code == 429
    assert c.get("/ito/api/YYYY/state").status_code == 429   # one budget, shared

    # The right code still works, and clears the misses.
    assert f"/ito/host/{code}" in c.get(f"/ito/stats?code={code}").get_data(as_text=True)
    assert c.get("/ito/rules?code=ZZZZ").status_code == 200


def test_the_site_is_installable():
    """Add to Home Screen needs a manifest with real icons, and every page
    has to point at it."""
    c = client()
    res = c.get("/manifest.webmanifest")
    assert res.mimetype == "application/manifest+json"
    manifest = res.get_json(force=True)
    assert manifest["display"] == "standalone" and manifest["start_url"] == "/"
    for icon in manifest["icons"]:
        assert c.get(icon["src"]).status_code == 200, icon["src"]
    assert any(i.get("purpose") == "maskable" for i in manifest["icons"])

    for page in ("/", "/join", "/flip7/", "/flip7/play", "/ito/"):
        body = c.get(page).get_data(as_text=True)
        assert 'rel="manifest"' in body and "apple-touch-icon" in body, page


def test_pages_an_installed_app_can_reach_have_a_way_back():
    """Standalone mode has no browser back button."""
    c = client()
    assert 'href="/"' in c.get("/join").get_data(as_text=True)
    assert 'href="/"' in c.get("/ito/").get_data(as_text=True)


def test_an_app_can_ask_which_game_a_code_is():
    """/join's JSON twin, for the iOS app: same answer, same throttle."""
    c = client()
    ito = new_room(c)
    res = c.get(f"/api/join/{ito.lower()}").get_json()
    assert res == {"code": ito, "game": "ito", "path": f"/ito/play/{ito}"}

    board = c.post("/flip7/rooms").get_json()["code"]
    assert c.get(f"/api/join/{board}").get_json()["game"] == "flip7"

    assert c.get("/api/join/ZZZZ").status_code == 404
    for _ in range(20):
        last = c.get("/api/join/ZZZZ")
    assert last.status_code == 429


def test_flip7_stats_api_carries_the_leaderboard_order():
    c = client()
    c.post("/flip7/api/stats/games", json=finished_game())
    stats = c.get("/flip7/api/stats").get_json()
    assert [row["name"] for row in stats["leaderboard"]][0] == max(
        stats["players"].values(), key=lambda p: (p["wins"], p["points"] / max(p["rounds"], 1)))["name"]
    assert "average" in stats["leaderboard"][0]


def test_room_links_open_the_ios_app():
    """The file Apple checks names the app, and claims only the pages a
    player is sent to — never the host's, which sit behind Authelia."""
    res = client().get("/.well-known/apple-app-site-association")
    assert res.status_code == 200 and res.mimetype == "application/json"
    details = res.get_json()["applinks"]["details"][0]
    assert details["appIDs"] == ["C729B84RYG.uk.collco.gamenight"]
    paths = {c["/"] for c in details["components"]}
    assert "/flip7/play/*" in paths and "/ito/play/*" in paths
    assert "/fugitive/play/*" in paths and "/me/link/*" in paths
    assert not any(p.startswith("/ito/host") or p.startswith("/ito/settings") for p in paths)


def test_the_ios_app_and_the_server_agree_on_its_id():
    """The bundle ID lives in ios/project.yml and in app.py; if they drift,
    links quietly stop opening the app."""
    import app
    spec = (Path(__file__).resolve().parent.parent / "ios" / "project.yml").read_text()
    team, bundle = app.IOS_APP_ID.split(".", 1)
    assert f"PRODUCT_BUNDLE_IDENTIFIER: {bundle}" in spec
    assert f"DEVELOPMENT_TEAM: {team}" in spec
    assert "applinks:gamenight.collardserver.co.uk" in spec
