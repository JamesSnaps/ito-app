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
    # Exactly one endless mode, and it says what unlocks it.
    endless = [e for e in entries if "endless: true" in e]
    assert len(endless) == 1 and "unlock:" in endless[0]
