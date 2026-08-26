"""Flip 7 — the scorekeeper.

Same narrow scope as ito: this replaces one physical component and nothing
else. Flip 7 is played with real cards being flipped in front of you; what
it doesn't come with is a good way to add up a round of numbers, modifiers
and a x2 across five players without an argument. So this is pencil and
paper, not a digital deck — no dealing, no hit/stay, no bust detection.

There is no room here, and that's deliberate. A scorekeeper is one device
on the table that everybody leans over, the way the paper pad was; making
it live for five phones would mean five people able to edit the same score.
State lives in the browser's localStorage instead, so a locked phone or a
stray refresh mid-game doesn't wipe the night.
"""

from flask import Blueprint, render_template

from games.registry import GameSpec

GAME_ID = "flip7"

bp = Blueprint(
    GAME_ID, __name__, url_prefix="/flip7", template_folder="templates"
)

# Reaching this ends the game. Printed on the box; kept here so the page and
# the rules summary can't disagree.
TARGET_SCORE = 200


@bp.route("/")
def landing():
    return render_template("flip7/scorekeeper.html", game=GAME, target=TARGET_SCORE)


@bp.route("/rules")
def rules_view():
    return render_template("flip7/rules.html", game=GAME, target=TARGET_SCORE)


GAME = GameSpec(
    id=GAME_ID,
    name="Flip 7",
    tagline="Push your luck, bank your cards — first to 200 takes it.",
    blueprint=bp,
    accent="#d9a94e",
    # No rooms: the scorekeeper is one shared device, not a host and players.
    new_room_state=None,
    host_endpoint=None,
    player_endpoint=None,
)
