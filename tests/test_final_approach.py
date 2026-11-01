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
    """Effects and voices all load when the game starts, so that download is
    what a phone waits for: keep it under 4 MB (3.1 MB at v1.29.0). Music,
    landscape beds and engine loops load in the background as they're
    needed: under 6 MB (3.7 MB)."""
    later = re.compile(r"^(music|bed|engine)_")
    files = list((STATIC / "audio").glob("*.mp3"))
    upfront = sum(f.stat().st_size for f in files if not later.match(f.name))
    background = sum(f.stat().st_size for f in files if later.match(f.name))
    assert upfront < 4 * 1024 * 1024, upfront
    assert background < 6 * 1024 * 1024, background


def test_every_hold_fix_is_read_back_by_name():
    """Joining a hold, the pilot says the fix's name ("Holding at Bovingdon"),
    so every name in HOLD_FIXES needs its lines."""
    names = set(sound_list())
    levels = (STATIC / "levels.js").read_text(encoding="utf-8")
    block = levels.split("const HOLD_FIXES = {")[1].split("};")[0]
    for key in re.findall(r"([A-Z]{3}):", block):
        assert f"say_hold_{key.lower()}_1" in names and f"say_hold_{key.lower()}_2" in names, key


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
    endless = dict(level=10, outcome="crash", strikes=0, duration=300, emergencies="some")
    post(c, louis, shift(landed=40, assisted=True, **endless))
    data = c.get("/final-approach/api/stats").get_json()
    assert data["leaderboards"]["some"] == []
    assert data["players"][0]["endless_best_calm"] == 40
    post(c, louis, shift(landed=12, **endless))
    post(c, james, shift(landed=20, **endless))
    board = c.get("/final-approach/api/stats").get_json()["leaderboards"]["some"]
    assert [(row["name"], row["best"]) for row in board] == [("James", 20), ("Louis", 12)]


def test_each_emergencies_setting_has_its_own_endless_board():
    c = client()
    louis = profile(c, "Louis")
    base = dict(level=10, outcome="crash", strikes=0, duration=300)
    post(c, louis, shift(landed=30, emergencies="off", **base))
    post(c, louis, shift(landed=12, emergencies="lots", **base))
    post(c, louis, shift(landed=9, **base))                     # an older page sends no setting: off
    boards = c.get("/final-approach/api/stats").get_json()["leaderboards"]
    assert [row["best"] for row in boards["off"]] == [30]
    assert [row["best"] for row in boards["lots"]] == [12]
    assert boards["some"] == []
    assert post(c, louis, shift(landed=5, emergencies="loads", **base)).status_code == 400


def test_endless_bests_from_before_emergencies_count_as_off():
    from core import stats

    stats.update("final-approach", lambda _: {"players": {"louis": {
        "name": "Louis", "stars": {}, "best": {}, "shifts": 1, "landed": 22,
        "endless_best": 22, "endless_best_at": "2026-10-31T12:00:00+00:00", "endless_best_calm": 0}},
        "recent": [], "ids": []})
    c = client()
    data = c.get("/final-approach/api/stats").get_json()
    assert data["leaderboards"]["off"][0] == {"name": "Louis", "best": 22, "at": "2026-10-31T12:00:00+00:00"}
    assert data["players"][0]["endless"] == {"off": 22}
    louis = profile(c, "Louis")
    post(c, louis, shift(level=10, outcome="crash", strikes=0, duration=300, landed=25, emergencies="off"))
    assert c.get("/final-approach/api/stats").get_json()["leaderboards"]["off"][0]["best"] == 25


def test_medals_are_counted_and_cant_outnumber_landings():
    c = client()
    louis = profile(c, "Louis")
    assert post(c, louis, shift(level=11, landed=18, medals=3, duration=400)).status_code == 200
    data = c.get("/final-approach/api/stats").get_json()
    assert data["players"][0]["medals"] == 3 and data["recent"][0]["medals"] == 3
    assert post(c, louis, shift(landed=6, medals=7)).status_code == 400
    assert "Medals" in c.get("/final-approach/stats").get_data(as_text=True)


def test_lifeline_teaches_emergencies_before_endless():
    levels = (STATIC / "levels.js").read_text(encoding="utf-8")
    order = re.findall(r"name: '([^']+)'", levels.split("const LEVELS")[1])
    assert order[-3:] == ["Night Shift", "Lifeline", "Endless"]
    lifeline = levels.split("name: 'Lifeline'")[1].split("\n  },")[0]
    assert "emergencies: { every:" in lifeline and "kind: 'pad'" in lifeline and "kind: 'long'" in lifeline
    assert "emergencies: 'choice'" in levels.split("name: 'Endless'")[1]
    assert 'id="emg-choice"' in page()


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


def test_grown_up_emergency_runs_rank_on_their_own_boards():
    c = client()
    james = profile(c, "James")
    base = dict(level=10, outcome="crash", strikes=0, duration=300)
    post(c, james, shift(landed=15, emergencies="some-grownup", **base))
    post(c, james, shift(landed=11, emergencies="some", **base))
    boards = c.get("/final-approach/api/stats").get_json()["leaderboards"]
    assert [row["best"] for row in boards["some-grownup"]] == [15]
    assert [row["best"] for row in boards["some"]] == [11]
    assert "grown-up emergencies" in c.get("/final-approach/stats").get_data(as_text=True)


def test_the_grown_up_switch_is_on_the_page_but_hidden_until_it_applies():
    body = page()
    assert 'id="set-grownup-row"' in body and 'class="set-row hidden" id="set-grownup-row"' in body


# --- free play (v1.25.0) ---------------------------------------------------------

def free(**overrides):
    settings = {"length": "shift", "traffic": "normal", "types": ["prop"], "fuel": False,
                "storms": 0, "wind": False, "emergencies": "off"}
    settings.update(overrides)
    return settings


def test_free_play_is_recorded_but_never_earns_or_ranks():
    c = client()
    louis = profile(c, "Louis")
    post(c, louis, shift(strikes=1))                                       # a real shift: 2 stars
    res = post(c, louis, shift(free=free(traffic="rush", storms=2), medals=1))
    assert res.status_code == 200, res.get_json()
    post(c, louis, shift(free=free(length="endless"), outcome="crash", landed=40, duration=600))
    data = c.get("/final-approach/api/stats").get_json()
    player = data["players"][0]
    assert player["stars"] == {"1": 2} and player["medals"] == 0
    assert player["shifts"] == 3 and player["landed"] == 6 + 6 + 40
    assert all(board == [] for board in data["leaderboards"].values())
    endless_free, rush = data["recent"][0], data["recent"][1]
    assert endless_free["free"]["length"] == "endless" and endless_free["free_summary"] == "Endless"
    assert rush["stars"] == 0 and rush["free_summary"] == "Rush · 2 storms"


def test_free_play_settings_are_checked():
    c = client()
    louis = profile(c, "Louis")
    for bad in (
        free(traffic="mayhem"),
        free(types=[]),
        free(types=["prop", "prop"]),
        free(types=["blimp"]),
        free(storms=4),
        free(storms=True),
        free(fuel="yes"),
        free(emergencies="loads"),
        free(length="forever"),
        {"traffic": "normal"},                                               # settings missing
        dict(free(), extra=1),                                               # unknown setting
    ):
        assert post(c, louis, shift(free=bad)).status_code == 400, bad
    assert post(c, louis, shift(level=10, outcome="crash", landed=3, free=free())).status_code == 400   # not on Endless
    assert post(c, louis, shift(landed=7, free=free())).status_code == 400              # past the target in a shift
    assert post(c, louis, shift(outcome="win", landed=30, free=free(length="endless"))).status_code == 400
    assert c.get("/final-approach/api/stats").get_json()["players"] == []


def test_free_play_shows_on_the_records_page():
    c = client()
    louis = profile(c, "Louis")
    post(c, louis, shift(free=free(traffic="light", wind=True, fuel=True, emergencies="lots")))
    body = c.get("/final-approach/stats").get_data(as_text=True)
    assert "free play" in body and "Light traffic · wind shifts · low fuel · lots of emergencies" in body


def test_the_game_page_has_the_free_play_sheet():
    body = page()
    for needle in ('id="free"', 'id="btn-free"', 'id="btn-free-start"', 'id="btn-result-free"',
                   'data-k="types"', 'data-k="storms"', 'id="free-emergencies-row"'):
        assert needle in body, needle


# --- guests, activity and the profile lock (v1.26.0) ----------------------------

ADMIN = {"Remote-User": "james", "Remote-Groups": "admins"}
HOME = "10.0.10.0/24 10.0.4.0/24"


def test_a_guest_shift_goes_only_to_the_activity_log(monkeypatch):
    monkeypatch.setenv("GAMENIGHT_HOME_NETWORKS", HOME)
    c = client()
    res = c.post("/final-approach/api/shifts", json=shift(device="3f1a9c00"), environ_base={"REMOTE_ADDR": "81.2.69.160"})
    assert res.status_code == 200 and res.get_json() == {"recorded": False, "guest": True}
    data = c.get("/final-approach/api/stats").get_json()
    assert data["players"] == [] and data["recent"] == [] and data["guests_week"] == 1
    assert "Guests: 1 shift this week" in c.get("/final-approach/stats").get_data(as_text=True)
    from games.final_approach import game
    [entry] = game.activity()
    assert entry["name"] == "Guest 3F1A" and entry["guest"] and entry["where"] == "away"
    assert "81.2" not in str(entry)                                   # no address kept
    # a retry of the same shift counts once
    c.post("/final-approach/api/shifts", json={**shift(device="3f1a9c00"), "id": entry["id"]})
    assert len(game.activity()) == 1


def test_shifts_without_a_profile_or_a_proper_tag_are_refused():
    c = client()
    assert post(c, {}, shift(device="nope")).status_code == 403
    assert post(c, {"X-Profile-Token": "stale"}, shift(device="3f1a9c00")).status_code == 403
    from games.final_approach import game
    assert game.activity() == []


def test_a_profiles_shift_is_logged_with_its_name_and_time_played(monkeypatch):
    monkeypatch.setenv("GAMENIGHT_HOME_NETWORKS", HOME)
    c = client()
    louis = c.post("/api/profiles", json={"name": "Louis"}, environ_base={"REMOTE_ADDR": "10.0.10.40"}).get_json()
    headers = {"X-Profile-Token": louis["token"]}
    c.post("/final-approach/api/shifts", json=shift(device="00ff00ff", duration=90), headers=headers,
           environ_base={"REMOTE_ADDR": "10.0.10.40"})
    c.post("/final-approach/api/shifts", json=shift(device="00ff00ff", duration=60, free=free()), headers=headers,
           environ_base={"REMOTE_ADDR": "10.0.10.40"})
    player = c.get("/final-approach/api/stats").get_json()["players"][0]
    assert player["seconds"] == 150 and player["last_at"]
    from games.final_approach import game
    entries = game.activity()
    assert [e["name"] for e in entries] == ["Louis", "Louis"] and all(e["where"] == "home" for e in entries)
    assert entries[1]["free"] == "As usual"


def test_the_activity_page_is_only_for_a_signed_in_grown_up(monkeypatch):
    c = client()
    post(c, {}, shift(device="3f1a9c00"))
    assert c.get("/final-approach/activity", headers=ADMIN).status_code == 403    # Authelia not in front yet
    monkeypatch.setenv("GAMENIGHT_FAMILY", "authelia")
    for headers in ({}, {"Remote-User": "louis"}, {"Remote-User": "louis", "Remote-Groups": "family"}):
        res = c.get("/final-approach/activity", headers=headers)
        assert res.status_code == 403 and "Guest 3F1A" not in res.get_data(as_text=True)
    louis = profile(c, "Louis")
    post(c, louis, shift(outcome="crash", landed=2))
    body = c.get("/final-approach/activity", headers=ADMIN).get_data(as_text=True)
    assert "Guest 3F1A" in body and "Louis" in body and "Meadow Strip" in body and "Who's playing" in body


def test_activity_sums_people_and_airports():
    from games.final_approach import game
    c = client()
    louis = profile(c, "Louis")
    post(c, louis, shift(strikes=1))                                   # clears Meadow Strip
    post(c, louis, shift(level=2, outcome="crash", landed=4, duration=200))
    post(c, {}, shift(level=2, outcome="crash", landed=1, device="abcdef01"))
    data = game.activity_payload()
    assert data["totals"]["today"] == 3 and data["totals"]["week_people"] == 1 and data["totals"]["week_guests"] == 1
    people = {p["name"]: p for p in data["people"]}
    assert people["Louis"]["progress"] == "1 of 11" and people["Louis"]["stars"] == 2
    assert people["Louis"]["furthest"] == "Meadow Strip" and people["Guest ABCD"]["stars"] is None
    twin = next(a for a in data["airports"] if a["code"] == "TWF")
    assert twin["shifts"] == 2 and twin["crashes"] == 2 and twin["clear_rate"] == 0
    assert sum(d["family"] + d["guests"] for d in data["days"]) == 3


def test_profiles_can_be_made_anywhere_and_shifts_say_where(monkeypatch):
    monkeypatch.setenv("GAMENIGHT_HOME_NETWORKS", HOME)
    c = client()
    away = c.post("/api/profiles", json={"name": "Cousin"}, environ_base={"REMOTE_ADDR": "81.2.69.160"})
    assert away.status_code == 200
    forged = {"X-Forwarded-For": "10.0.10.5, 81.2.69.160"}                # a client can't claim home
    c.post("/final-approach/api/shifts", json=shift(device="0a0b0c0d"), headers={**forged, "X-Profile-Token": away.get_json()["token"]},
           environ_base={"REMOTE_ADDR": "81.2.69.160"})
    from games.final_approach import game
    assert game.activity()[0]["where"] == "away"


def test_the_game_page_asks_whos_playing():
    body = page()
    assert 'id="guest"' in body and 'id="btn-guest-ok"' in body and "/me?back=" in body


# --- conditions and stamps (v1.27.0) --------------------------------------------

def test_each_airport_offers_the_conditions_that_differ_from_it():
    from games.final_approach import game
    offered = {a["code"]: game.conditions_for(a) for a in game.airports().values()}
    assert offered["MDS"] == ("dusk", "night", "snow", "storm", "fog")
    assert offered["XRD"] == ("dusk", "night", "storm", "fog")          # desert: no snow
    assert offered["WVN"] == ("dusk", "night", "storm", "fog")          # already snow
    assert offered["NGT"] == ("snow", "storm", "fog")                   # already night
    assert offered["INF"] == ()
    assert offered["HLD"] == ("dusk", "night", "snow", "storm", "fog")  # Holding Pattern (v1.29.0): meadow
    assert sum(len(v) for v in offered.values()) == 50


def test_a_condition_earns_a_stamp_not_airport_stars():
    c = client()
    louis = profile(c, "Louis")
    post(c, louis, shift(condition="night", strikes=1))
    post(c, louis, shift(condition="night", strikes=0))                 # better: stars rise, date stays
    post(c, louis, shift(condition="fog", outcome="crash", landed=3))   # no stamp for a lost shift
    data = c.get("/final-approach/api/stats").get_json()
    player = data["players"][0]
    assert player["stars"] == {} and player["total_stars"] == 0
    assert set(player["stamps"]) == {"1"} and player["stamps"]["1"]["night"]["stars"] == 3
    assert player["total_stamps"] == 1
    first = data["recent"][-1]
    assert first["condition"] == "night" and first["condition_at"] == "at night"
    body = c.get("/final-approach/stats").get_data(as_text=True)
    assert "cleared at night" in body and "?passport=Louis" in body and "in fog" in body


def test_conditions_are_checked_against_the_airport():
    c = client()
    louis = profile(c, "Louis")
    for bad in (
        shift(condition="sandstorm"),
        shift(level=4, landed=16, condition="snow"),                    # Crossroads has no snow
        shift(level=9, landed=24, condition="night"),                   # Night Shift is already night
        shift(level=10, outcome="crash", landed=3, duration=300, condition="fog"),   # nor Endless
        shift(condition="fog", free=free()),                            # free play has no conditions
    ):
        assert post(c, louis, bad).status_code == 400, bad
    assert post(c, louis, shift(level=9, landed=24, condition="snow")).status_code == 200


def test_the_game_page_has_the_passport():
    body = page()
    for needle in ('id="passport"', 'id="btn-passport"', 'id="pass-conds"', 'id="result-stamp"',
                   'final-approach/passport.js', 'id="fa-ink"'):
        assert needle in body, needle


# --- holding and disruptions (v1.29.0) -------------------------------------------

def level_entries():
    levels = (STATIC / "levels.js").read_text(encoding="utf-8")
    return levels.split("const LEVELS")[1].split("\n  {\n")[1:]


def test_holding_pattern_comes_third_with_its_own_id():
    """It teaches holding early. Ids are the keys for saves and records, so
    it gets a new one and nobody else's moves; the board numbers by position."""
    from games.final_approach import game
    ids = [int(re.search(r"id: (\d+)", e).group(1)) for e in level_entries()]
    assert len(ids) == len(set(ids))
    assert ids[:4] == [1, 2, 12, 3] and ids[-2:] == [11, 10]
    hld = game.airports()[12]
    assert hld["code"] == "HLD" and hld["name"] == "Holding Pattern" and hld["target"] and not hld["endless"]
    assert len([a for a in game.airports().values() if not a["endless"]]) == 11


def test_unlocking_never_closes_an_airport_someone_has_reached():
    """Inserting an airport early must not lock anyone out: an airport is open
    when the one before it is cleared, or it or any later one is."""
    js = (STATIC / "game.js").read_text(encoding="utf-8")
    rule = js.split("function isUnlocked(L) {")[1].split("\n  }")[0]
    assert "cleared(LEVELS[i - 1].id)" in rule and "cleared(L.id)" in rule
    assert "LEVELS.slice(i + 1).some(" in rule


def test_every_airport_has_two_or_three_hold_fixes_clear_of_its_runways():
    """Fix names come from one shared pool (spoken lines will be recorded per
    name), placed per airport."""
    import math
    levels = (STATIC / "levels.js").read_text(encoding="utf-8")
    pool = dict(re.findall(r"([A-Z]{3}): '([A-Za-z]+)'", levels.split("const HOLD_FIXES = {")[1].split("};")[0]))
    assert pool == {"BOV": "Bovingdon", "OCK": "Ockham", "LAM": "Lambourne", "BIG": "Biggin", "WIL": "Willo", "TIM": "Timba"}
    used = set()
    for entry in level_entries():
        code = re.search(r"code: '([A-Z]{3})'", entry).group(1)
        fixes = re.findall(r"\{ fix: '([A-Z]{3})', x: (\d+), y: (\d+) \}", entry)
        assert 2 <= len(fixes) <= 3, code
        assert len({f[0] for f in fixes}) == len(fixes)
        assert all(f[0] in pool for f in fixes), code
        used.update(f[0] for f in fixes)
        runways = re.findall(r"kind: '(long|short)', x: (\d+), y: (\d+), angle: (-?\d+), length: (\d+)", entry)
        pads = re.findall(r"kind: 'pad', x: (\d+), y: (\d+)", entry)
        for _, x, y in fixes:
            x, y = int(x), int(y)
            # inside the airspace with room for the whole stack (rings out to 52)
            assert 80 <= x <= 880 and 120 <= y <= 520, (code, x, y)
            for px, py in pads:
                assert math.dist((x, y), (int(px), int(py))) > 120, code
            for _, rx, ry, angle, length in runways:
                a = math.radians(int(angle))
                ax, ay = int(rx) - math.cos(a) * 190, int(ry) - math.sin(a) * 190
                bx, by = int(rx) + math.cos(a) * (int(length) + 190), int(ry) + math.sin(a) * (int(length) + 190)
                dx, dy = bx - ax, by - ay
                t = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
                # well clear of the runway and both approaches (either wind)
                assert math.dist((x, y), (ax + t * dx, ay + t * dy)) > 85, (code, x, y)
    assert used == set(pool)


def test_disruptions_are_taught_before_they_turn_up():
    entries = level_entries()
    kinds_at = []
    for entry in entries:
        found = re.search(r"disruptions: \{ kinds: \[([^\]]*)\], every: \[(\d+), (\d+)\], first: (\d+) \}", entry)
        kinds_at.append(re.findall(r"'(\w+)'", found.group(1)) if found else [])
        if found:
            low, high, first = map(int, found.groups()[1:])
            assert 40 <= low <= high and first >= 25          # never in a shift's first seconds
    codes = [re.search(r"code: '([A-Z]{3})'", e).group(1) for e in entries]
    hld = codes.index("HLD")
    assert kinds_at[hld] == ["runway"]
    assert not any(kinds_at[:hld])                             # the first airports stay gentle
    assert not kinds_at[codes.index("RTW")]
    assert all(k in ("runway", "drone", "wave", "balloons", "display", "cyber") for ks in kinds_at for k in ks)
    assert not kinds_at[codes.index("INF")]                    # Endless: not yet
    # every kind turns up somewhere in the career, after Holding Pattern
    assert {k for ks in kinds_at for k in ks} == {"runway", "drone", "wave", "balloons", "display", "cyber"}
    # real balloons and display teams don't fly at night
    for entry, kinds in zip(entries, kinds_at):
        if "theme: 'night'" in entry or "storms:" in entry:
            assert "balloons" not in kinds and "display" not in kinds, entry[:60]


def test_free_play_disruptions_are_checked_and_old_pages_still_count():
    c = client()
    louis = profile(c, "Louis")
    for value in ("off", "some", "lots"):
        assert post(c, louis, shift(free=free(disruptions=value))).status_code == 200, value
    # a shift from a page older than v1.29.0, still waiting in someone's outbox
    assert post(c, louis, shift(free=free())).status_code == 200
    for bad in (free(disruptions="loads"), free(disruptions=True), dict(free(disruptions="some"), extra=1)):
        assert post(c, louis, shift(free=bad)).status_code == 400, bad
    recent = c.get("/final-approach/api/stats").get_json()["recent"]
    assert recent[0]["free"]["disruptions"] == "off" and recent[0]["free_summary"] == "As usual"
    assert [r["free_summary"] for r in recent[1:4]] == ["Lots of disruptions", "Disruptions", "As usual"]
    body = c.get("/final-approach/stats").get_data(as_text=True)
    assert "Lots of disruptions" in body


def test_free_play_summary_matches_the_game():
    from games.final_approach.game import free_summary
    assert free_summary(free(traffic="rush", storms=2, emergencies="some", disruptions="lots", length="endless")) == \
        "Rush · 2 storms · emergencies · lots of disruptions · endless"
    assert free_summary(free()) == "As usual"                  # no key at all: recorded before v1.29.0
    js = (STATIC / "game.js").read_text(encoding="utf-8")
    assert "'lots of disruptions' : 'disruptions'" in js


def test_the_game_page_has_the_disruption_parts():
    body = page()
    for needle in ('id="hud-dis"', 'id="hud-dis-flaps"', 'id="notice"', 'id="explain"', 'id="btn-explain-ok"',
                   'id="free-disruptions-row"', 'data-k="disruptions"'):
        assert needle in body, needle


# --- disruptions, part 2 (v1.30.0) ------------------------------------------------

def test_the_game_page_has_the_ransom_note_and_restore_backup():
    body = page()
    for needle in ('id="ransom"', 'id="ransom-1"', 'id="ransom-2"', 'id="ransom-3"', 'id="btn-restore"', 'class="gremlin-face"'):
        assert needle in body, needle
    # it's a plate on the HUD, so arrivals are never placed under it
    assert '<div class="plate hidden" id="ransom"' in body


def test_the_cyber_attack_is_a_gremlin_unless_grown_up_and_nothing_scary_for_children():
    js = (STATIC / "game.js").read_text(encoding="utf-8")
    assert "gremlin: !grownUpOK()" in js
    gremlin = js.split("gremlin: { note: [")[1].split("]")[0]
    assert "Gremlin in" in gremlin and "BTC" not in gremlin and "locked" not in gremlin.lower()
    assert "'Systems locked', 'Pay 40 BTC', 'To restore'" in js
    # every note row fits the 14-tile board
    for row in re.findall(r"'([^']*)'", js.split("const RANSOM = {")[1].split("};")[0]):
        assert len(row) <= 14, row


def test_disruption_part_two_uses_the_agreed_sound_names():
    """The recordings are made afterwards (tools/final_approach_sounds.py), so
    the game asks for these exact names and copes while they're missing."""
    js = (STATIC / "game.js").read_text(encoding="utf-8")
    for prefix in ("tower_balloons", "tower_balloons_gone", "tower_display", "tower_display_clear",
                   "tower_cyber", "tower_cyber_restored", "tower_gremlin", "tower_gremlin_gone"):
        assert f"'{prefix}'" in js, prefix
    for name in ("balloon_burner", "display_flypast", "cyber_glitch", "restore_ok", "gremlin_giggle"):
        assert f"playSound('{name}'" in js, name
    # a missing file is a no-op: playSound says so, and say() deals nothing
    assert "if (!actx || !buffers[name]) { if (actx) load(name); return false; }" in js
    assert "if (!AUDIO[name] || !actx) return Promise.resolve(null);" in js


def test_every_disruption_kind_is_explained_the_first_time():
    js = (STATIC / "game.js").read_text(encoding="utf-8")
    kinds = re.findall(r"'(\w+)'", js.split("const DIS_KINDS = [")[1].split("]")[0])
    assert kinds == ["runway", "drone", "wave", "balloons", "display", "cyber"]
    how = js.split("const DIS_HOW = {")[1].split("\n  };")[0]
    title = js.split("const DIS_TITLE = {")[1].split("\n  };")[0]
    for key in kinds + ["gremlin"]:
        assert re.search(rf"\b{key}: '", how), key
        assert re.search(rf"\b{key}: '", title), key


def test_free_play_disruptions_still_take_the_same_three_values():
    """Part 2 adds kinds, not settings: Some and Lots now mean all six, and a
    shift from before or after v1.30.0 is checked the same way."""
    c = client()
    louis = profile(c, "Louis")
    for value in ("off", "some", "lots"):
        assert post(c, louis, shift(free=free(disruptions=value))).status_code == 200, value
    for bad in ("balloons", "cyber", ["balloons"]):
        assert post(c, louis, shift(free=free(disruptions=bad))).status_code == 400, bad
