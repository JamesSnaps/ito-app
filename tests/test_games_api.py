"""/api/games: the hub's menu for the iOS app. The app draws its own tiles
for the games it has screens for, and a tile opening the web page full
screen for every other game it's told about — so a new web game reaches the
app without an app update."""

import json
from pathlib import Path

from test_smoke import client

ROOT = Path(__file__).resolve().parent.parent


def games():
    res = client().get("/api/games")
    assert res.status_code == 200
    return res.get_json()["games"]


def test_lists_every_playable_game_in_the_hubs_order():
    from games.registry import playable_games

    assert [g["id"] for g in games()] == [g.id for g in playable_games()]


def test_each_game_has_what_a_tile_needs():
    for game in games():
        assert set(game) == {"id", "name", "tagline", "accent", "path", "action", "native_app"}
        assert game["name"] and game["tagline"], game["id"]
        assert game["accent"].startswith("#") and len(game["accent"]) == 7, game["id"]
        assert isinstance(game["native_app"], bool), game["id"]
        assert game["action"], game["id"]


def test_each_path_is_the_games_own_page():
    c = client()
    for game in games():
        assert game["path"] == f"/{game['id']}/", game["id"]
        assert c.get(game["path"]).status_code == 200, game["id"]


def test_the_app_has_screens_for_the_four_table_games_only():
    flags = {g["id"]: g["native_app"] for g in games()}
    assert {gid for gid, native in flags.items() if native} == {"flip7", "fugitive", "ito", "wildwood"}
    # Final Approach is played in the app as its web page.
    assert flags["final-approach"] is False


def test_the_tiles_call_to_action_matches_the_web_hub():
    by_id = {g["id"]: g for g in games()}
    assert by_id["ito"]["action"] == "Start a room"
    assert by_id["final-approach"]["action"] == "Play"


def test_native_app_defaults_to_false():
    """A game added to the registry without a word about the app is a web
    game there — which is what makes it appear with no app update."""
    from flask import Blueprint

    from games.registry import GameSpec

    spec = GameSpec(id="x", name="X", tagline="t", blueprint=Blueprint("x", __name__), accent="#000000")
    assert spec.native_app is False


def test_an_unavailable_game_is_left_out(monkeypatch):
    from dataclasses import replace

    from games import registry

    real = registry.all_games()
    hidden = [replace(g, available=False) if g.id == "final-approach" else g for g in real]
    c = client()  # built with every game's blueprint, then the list shrinks
    monkeypatch.setattr(registry, "all_games", lambda: hidden)
    import app as app_module
    monkeypatch.setattr(app_module, "playable_games", registry.playable_games)
    ids = [g["id"] for g in c.get("/api/games").get_json()["games"]]
    assert "final-approach" not in ids and "flip7" in ids


def test_the_ios_fixture_still_matches_the_api():
    """GameNightTests/Fixtures/games.json is what the Swift model is tested
    against; its keys must be the API's."""
    saved = json.loads((ROOT / "ios" / "GameNightTests" / "Fixtures" / "games.json").read_text())
    fresh = games()
    assert set(saved) == {"games"}
    assert {k for g in saved["games"] for k in g} == {k for g in fresh for k in g}
    assert any(not g["native_app"] for g in saved["games"])
