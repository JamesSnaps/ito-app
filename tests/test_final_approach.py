"""Final Approach is all client-side, so these pin the page and its files:
everything it loads exists and is ours, it has a way back, and the level
data hangs together."""

import re
from pathlib import Path

from test_smoke import client

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static" / "final-approach"


def page():
    res = client().get("/final-approach/")
    assert res.status_code == 200
    return res.get_data(as_text=True)


def test_the_hub_opens_the_game_directly():
    from games.final_approach.game import GAME

    assert not GAME.starts_rooms and not GAME.has_rooms
    body = client().get("/").get_data(as_text=True)
    assert 'href="/final-approach/"' in body
    assert "Final Approach" in body


def test_every_file_the_page_loads_exists():
    body = page()
    loaded = re.findall(r'(?:src|href)="/static/([^"?]+)', body)
    assert any(path.startswith("final-approach/") for path in loaded)
    for path in loaded:
        assert (ROOT / "static" / path).is_file(), path
    # Scripts depend on each other in this order: levels, art, flap, game.
    order = [body.index(f"final-approach/{name}.js") for name in ("levels", "art", "flap", "game")]
    assert order == sorted(order)


def test_it_brings_its_own_look_instead_of_the_shell():
    """The shell's .btn/.row/button rules would leak into the board."""
    body = page()
    assert "final-approach/style.css" in body
    assert 'href="/static/style.css' not in body


def test_there_is_a_way_back_to_the_hub():
    """Installed to a home screen there's no browser back button."""
    assert 'href="/"' in page()


def test_nothing_is_fetched_from_anywhere_else():
    """Same rule as every game here: it must work on a LAN with no internet."""
    assert "http://" not in page() and "https://" not in page()
    for path in STATIC.glob("*.*"):
        if path.suffix in {".js", ".css"}:
            text = path.read_text(encoding="utf-8")
            assert "http://" not in text and "https://" not in text, path.name


def test_fonts_are_bundled_with_their_licences():
    css = (STATIC / "style.css").read_text(encoding="utf-8")
    fonts = re.findall(r"url\((fonts/[^)]+)\)", css)
    assert fonts
    for font in fonts:
        assert (STATIC / font).is_file(), font
    assert (STATIC / "fonts" / "OFL-Oswald.txt").is_file()
    assert (STATIC / "fonts" / "OFL-Barlow.txt").is_file()


def test_every_level_has_a_theme_a_code_and_runways():
    levels = (STATIC / "levels.js").read_text(encoding="utf-8")
    themes = set(re.findall(r"^  (\w+): \{", levels.split("const LEVELS")[0], re.M))
    entries = levels.split("const LEVELS")[1].split("\n  {\n")[1:]
    assert len(entries) >= 10
    codes = set()
    for entry in entries:
        assert re.search(r"theme: '(\w+)'", entry).group(1) in themes
        code = re.search(r"code: '([A-Z]{3})'", entry).group(1)
        assert code not in codes, code
        codes.add(code)
        assert "runways: [" in entry
    # An arrival's warning, where an airport sets one, is long enough to see
    # and short enough not to clutter the edges.
    for entry in entries:
        warning = re.search(r"warning: ([\d.]+)", entry)
        if warning:
            assert 2 <= float(warning.group(1)) <= 4
    # Exactly one endless mode, and it says what unlocks it.
    endless = [e for e in entries if "endless: true" in e]
    assert len(endless) == 1 and "unlock:" in endless[0]


def sound_list():
    """The generator's list of sounds, read without importing the module
    (it isn't a package, and it never runs in the server)."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("sounds", ROOT / "tools" / "final_approach_sounds.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return {**module.SOUNDS, **module.SPEECH}


def test_every_listed_sound_has_a_file_and_every_file_is_listed():
    """The generator is the record of how each sound was made; a file it
    doesn't know about couldn't be remade, and a listed one missing would
    leave the game on its fallback synth."""
    files = {path.stem for path in (STATIC / "audio").glob("*.mp3")}
    assert files == set(sound_list())


def test_the_page_is_told_where_each_sound_lives():
    body = page()
    for name in sound_list():
        assert f"/static/final-approach/audio/{name}.mp3?v=" in body, name
    assert 'id="set-music"' in body


def test_the_sounds_stay_a_small_download():
    """Effects load when the game starts and music in the background; keep
    the whole lot comfortably under 6 MB."""
    total = sum(path.stat().st_size for path in (STATIC / "audio").glob("*.mp3"))
    assert total < 6 * 1024 * 1024, total


def test_every_runway_number_has_a_readback():
    """A route that locks onto runway 27 is read back as "runway two seven",
    so every number painted in the game needs its own lines."""
    names = set(sound_list())
    levels = (STATIC / "levels.js").read_text(encoding="utf-8")
    import math
    for angle in re.findall(r"kind: '(?:long|short)'[^}]*angle: (-?\d+)", levels):
        for end in (int(angle), int(angle) + 180):
            heading = ((end + 90) % 360 + 360) % 360
            number = f"{(math.floor(heading / 10 + 0.5) % 36) or 36:02d}"
            assert f"say_land_{number}_1" in names, number


# --- family records (v1.22.0) ----------------------------------------------------

def profile(c, name):
    res = c.post("/api/profiles", json={"name": name})
    assert res.status_code == 200, res.get_json()
    return {"X-Profile-Token": res.get_json()["token"]}


def shift(**overrides):
    import uuid

    body = {"id": uuid.uuid4().hex, "level": 1, "outcome": "win", "landed": 6, "strikes": 0,
            "duration": 120.5, "assisted": False}
    body.update(overrides)
    return body


def post(c, headers, body):
    return c.post("/final-approach/api/shifts", json=body, headers=headers)


def test_a_shift_needs_a_profile():
    c = client()
    assert post(c, {}, shift()).status_code == 403
    assert post(c, {"X-Profile-Token": "nope"}, shift()).status_code == 403


def test_a_cleared_shift_records_its_stars_under_the_profiles_name():
    c = client()
    louis = profile(c, "Louis")
    res = post(c, louis, shift(strikes=1, name="Somebody else"))
    assert res.status_code == 200
    assert res.get_json()["recorded"] is True
    data = c.get("/final-approach/api/stats").get_json()
    player = data["players"][0]
    assert player["name"] == "Louis" and player["stars"] == {"1": 2} and player["total_stars"] == 2
    assert data["recent"][0]["name"] == "Louis" and data["recent"][0]["stars"] == 2


def test_stars_keep_the_best_and_a_retry_counts_once():
    c = client()
    louis = profile(c, "Louis")
    perfect = shift()
    assert post(c, louis, perfect).get_json()["recorded"] is True
    assert post(c, louis, perfect).get_json()["recorded"] is False
    post(c, louis, shift(strikes=2))
    post(c, louis, shift(outcome="crash", landed=3))
    player = c.get("/final-approach/api/stats").get_json()["players"][0]
    assert player["stars"] == {"1": 3}
    assert player["shifts"] == 3


def test_calm_skies_endless_runs_stay_off_the_ranked_board():
    c = client()
    louis, james = profile(c, "Louis"), profile(c, "James")
    endless = dict(level=10, outcome="crash", strikes=0, duration=300)
    post(c, louis, shift(landed=40, assisted=True, **endless))
    data = c.get("/final-approach/api/stats").get_json()
    assert data["leaderboard"] == []
    assert data["players"][0]["endless_best_calm"] == 40
    post(c, louis, shift(landed=12, **endless))
    post(c, james, shift(landed=20, **endless))
    board = c.get("/final-approach/api/stats").get_json()["leaderboard"]
    assert [(row["name"], row["best"]) for row in board] == [("James", 20), ("Louis", 12)]


def test_impossible_shifts_are_refused():
    c = client()
    louis = profile(c, "Louis")
    for bad in (
        shift(level=99),                                  # no such airport
        shift(level=True),                                # a bool isn't a level
        shift(landed=5),                                  # cleared without the whole target
        shift(landed=7),                                  # more than the target
        shift(outcome="strikes", strikes=2, landed=3),    # strikes ends with all three
        shift(outcome="win", strikes=3),                  # can't clear with three strikes
        shift(level=10, outcome="win", landed=30, duration=300),  # Endless has no win
        shift(landed=6, duration=0.5),                    # no time to land six
        shift(outcome="draw"),
        shift(id="x"),
        shift(assisted="yes"),
    ):
        assert post(c, louis, bad).status_code == 400, bad
    assert c.post("/final-approach/api/shifts", data="[1,2]", headers=dict(louis, **{"Content-Type": "application/json"})).status_code == 400
    assert c.get("/final-approach/api/stats").get_json()["players"] == []


def test_the_records_page_renders_with_and_without_records():
    c = client()
    empty = c.get("/final-approach/stats")
    assert empty.status_code == 200 and "No shifts recorded yet" in empty.get_data(as_text=True)
    louis = profile(c, "Louis")
    post(c, louis, shift())
    post(c, louis, shift(level=10, outcome="crash", landed=9, duration=200, assisted=True))
    body = c.get("/final-approach/stats").get_data(as_text=True)
    assert "Louis" in body and "calm skies" in body and "Meadow Strip" in body
    assert "http://" not in body and "https://" not in body


def test_the_game_page_has_settings_records_and_profiles():
    body = page()
    for needle in ('id="settings"', 'id="set-calm"', 'id="set-large"', 'id="btn-settings"',
                   'href="/final-approach/stats"', '/static/profiles.js', 'id="controller"'):
        assert needle in body, needle
    assert 'id="btn-mute"' not in body
