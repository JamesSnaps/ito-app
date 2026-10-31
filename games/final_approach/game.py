"""Final Approach — a solo air-traffic game: draw each arrival's route down
to the runway that matches it, and keep everything apart.

The first game here that isn't for a table at all. It runs entirely in the
browser (static/final-approach/): the levels, the simulation, the painted
airports and the split-flap board are all client-side JS, and progress is
kept in that browser's localStorage (`final-approach:save`). So the server's
part is small — one page — and there are no rooms, tokens or records yet.
Records against player profiles are the next step; see the playbook
(docs/final-approach/PLAYBOOK.md) for where the game is headed.
"""

from flask import Blueprint, render_template

from games.registry import GameSpec

GAME_ID = "final-approach"

bp = Blueprint(GAME_ID, __name__, url_prefix="/final-approach", template_folder="templates")


@bp.route("/")
def landing():
    """The whole game: the arrivals board, the briefings and the airports
    are all on this one page."""
    return render_template("final_approach/play.html")


GAME = GameSpec(
    id=GAME_ID,
    name="Final Approach",
    tagline="Draw their routes down, match the runways, keep the sky clear.",
    blueprint=bp,
    accent="#e8553f",
    hub_action="Play",
)
