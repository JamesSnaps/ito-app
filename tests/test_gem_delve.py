"""Gem Delve is client-side like Final Vector, so these pin the page and its
files: every sprite the script draws is a PNG pxl built, the art's source is
kept beside it, and nothing is fetched from anywhere else. The script is
syntax-checked with node where node is installed (there's no JS test runner)."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

from test_smoke import client

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static" / "gem-delve"
ART = STATIC / "art"


def page():
    res = client().get("/gem-delve/")
    assert res.status_code == 200
    return res.get_data(as_text=True)


def test_the_hub_lists_it_as_a_preview():
    from games.gem_delve.game import GAME
    from games.registry import get_game

    assert get_game("gem-delve") is GAME
    assert not GAME.starts_rooms and not GAME.has_rooms
    assert not GAME.native_app
    assert "Preview" in GAME.tagline
    body = client().get("/").get_data(as_text=True)
    assert 'href="/gem-delve/"' in body and "Gem Delve" in body


def test_every_file_the_page_loads_exists():
    body = page()
    loaded = re.findall(r'(?:src|href)="/static/([^"?]+)', body)
    assert "gem-delve/game.js" in loaded and "gem-delve/style.css" in loaded
    for path in loaded:
        assert (ROOT / "static" / path).is_file(), path


def test_it_brings_its_own_look_and_a_way_back():
    body = page()
    assert 'href="/static/style.css' not in body
    assert 'href="/"' in body


def test_every_sprite_the_game_draws_is_handed_to_the_page():
    """game.js names sprites in strings ("m_run1", "ore_" + name, "gem_" + type);
    each must be one of the PNGs the page is given."""
    body = page()
    given = set(re.findall(r'"([a-z_0-9]+)": "/static/gem-delve/art/', body))
    on_disk = {p.stem for p in ART.glob("*.png")}
    assert given == on_disk and on_disk
    js = (STATIC / "game.js").read_text(encoding="utf-8")
    named = set(re.findall(r'"((?:m|bat|heart|ore|gem)_[a-z0-9_]+)"', js))
    named |= {"ore_" + g for g in ("emerald", "sapphire", "ruby", "gold")}
    named |= {"gem_" + g for g in ("emerald", "sapphire", "ruby", "gold")}
    tile_art = re.search(r"const TILE_ART = \{([^}]+)\}", js).group(1)
    named |= set(re.findall(r'\d+: "([a-z_]+)"', tile_art))
    named |= {"backwall"}
    assert named <= on_disk, named - on_disk


def test_the_art_source_is_kept_and_names_every_sprite():
    source = (ROOT / "games" / "gem_delve" / "art.px.js").read_text(encoding="utf-8")
    defined = set(re.findall(r'sprite\("([a-z][a-z_0-9]*)"', source))
    defined |= {"m_" + n for n in re.findall(r'miner\("m_([a-z0-9]+)"', source)}
    defined |= {"ore_" + g for g in re.findall(r'\["(emerald|sapphire|ruby|gold)", "', source)}
    assert {p.stem for p in ART.glob("*.png")} <= defined


def test_nothing_is_fetched_from_anywhere_else():
    body = page()
    assert "http://" not in body and "https://" not in body
    for path in STATIC.glob("*.*"):
        text = path.read_text(encoding="utf-8")
        assert "http://" not in text and "https://" not in text, path.name
    css = (STATIC / "style.css").read_text(encoding="utf-8")
    for font in re.findall(r"url\(\"?([^)\"]+)\"?\)", css):
        assert (STATIC / font).resolve().is_file(), font


def test_cave_codes_use_the_room_code_alphabet():
    """Codes are read across a table: no I, O, 0 or 1."""
    js = (STATIC / "game.js").read_text(encoding="utf-8")
    alphabet = re.search(r'CODE_CHARS = "([A-Z0-9]+)"', js).group(1)
    assert not set(alphabet) & set("IO01") and len(set(alphabet)) == len(alphabet)


@pytest.mark.skipif(shutil.which("node") is None, reason="node isn't installed")
def test_the_script_parses():
    subprocess.run(["node", "--check", str(STATIC / "game.js")], check=True)
