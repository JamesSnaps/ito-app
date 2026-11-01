"""Gem Delve: a side-on cave you run, jump, climb and dig through for gems (a test cave).

Louis's mining game, the first playable slice: one cave, three minutes, dig
for gems and get out through the mine shaft at the bottom. Gems only count
once you're out. Every cave comes from a four-letter code, so the family can
all play the same one and compare.

Like Final Vector it runs entirely in the browser (static/gem-delve/), and
the best score per cave lives in that browser's localStorage. The art is
pixel art drawn with pxl: the source is games/gem_delve/art.px.js, built to
the PNGs in static/gem-delve/art/.
"""

from pathlib import Path

from flask import Blueprint, current_app, render_template, url_for

from games.registry import GameSpec

GAME_ID = "gem-delve"

bp = Blueprint(GAME_ID, __name__, url_prefix="/gem-delve", template_folder="templates")


def art():
    """{sprite name: URL} for every built sprite, cache-busted like asset()."""
    folder = Path(current_app.static_folder) / "gem-delve" / "art"
    return {p.stem: url_for("static", filename=f"gem-delve/art/{p.name}", v=int(p.stat().st_mtime))
            for p in sorted(folder.glob("*.png"))}


@bp.route("/")
def landing():
    """The whole game: the cave, the HUD and the touch controls."""
    return render_template("gem_delve/play.html", art=art())


GAME = GameSpec(
    id=GAME_ID,
    name="Gem Delve",
    tagline="Preview: Louis's mining game. Dig through a cave for gems and get out before it caves in.",
    blueprint=bp,
    accent="#3fc48a",
    hub_action="Try the test cave",
)
