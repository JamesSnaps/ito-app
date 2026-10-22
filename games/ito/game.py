"""ito — the topic randomiser.

Scope is unchanged from the single-game version: this replaces the topic
booklet only. Secret numbers, card placement and turn order all stay
physical. What's new is that a session lives in a room, so two groups can
use the same instance without stepping on each other.
"""

import random
import shutil
import threading

from pathlib import Path

from flask import (
    Blueprint, jsonify, redirect, render_template, request, url_for,
)

from core import jsonfile, stats
from core.paths import game_data_dir
from core.qr import svg as qr_svg
from core.rooms import find_room, require_room, rooms
from games.registry import GameSpec

GAME_ID = "ito"
TOPICS_PATH = game_data_dir(GAME_ID) / "topics.json"

# The shipped copy, inside the image and never mounted over. data/ is a bind
# mount in production, which shadows whatever the image had there — so the
# live topics file has to be seeded from here on first run rather than simply
# baked into data/.
DEFAULT_TOPICS_PATH = Path(__file__).resolve().parent / "default_topics.json"

bp = Blueprint(
    GAME_ID, __name__, url_prefix="/ito", template_folder="templates"
)


# Fallback poles for a topic saved without its own. The printed cards always
# name both ends of the scale ("Small … Big"), so a card is never label-less.
DEFAULT_LOW = "Low"
DEFAULT_HIGH = "High"


def _text(value):
    return value.strip() if isinstance(value, str) else ""


def normalise_topic(entry):
    """Accept either a plain string or a {text, low, high} object.

    Topics were bare strings before cards had scale labels, and hand-edited
    topics.json files are expected, so both shapes stay readable. Anything
    else (a number, a list) comes back with empty text and is dropped by
    `load_topics` rather than crashing every page that lists topics."""
    if isinstance(entry, str):
        return {"text": entry, "low": DEFAULT_LOW, "high": DEFAULT_HIGH}
    if not isinstance(entry, dict):
        return {"text": "", "low": DEFAULT_LOW, "high": DEFAULT_HIGH}
    return {
        "text": entry.get("text", "") if isinstance(entry.get("text"), str) else "",
        "low": _text(entry.get("low")) or DEFAULT_LOW,
        "high": _text(entry.get("high")) or DEFAULT_HIGH,
    }


class TopicsUnavailable(jsonfile.DataUnavailable):
    """topics.json and its backup are both unreadable."""


def ensure_topics():
    """Put the shipped topics in place if the data directory is empty.

    Without this, a fresh deploy with an empty bind mount 500s on the first
    draw — the room is created (that doesn't read topics), then every page
    that lists categories fails."""
    if TOPICS_PATH.exists():
        return
    TOPICS_PATH.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(DEFAULT_TOPICS_PATH, TOPICS_PATH)


# Topic edits are read-modify-write on one file. Two people in Settings at
# once would otherwise each save a list built from before the other's change.
_topics_lock = threading.Lock()


def _parse_topics(raw):
    if not isinstance(raw, dict):
        raise jsonfile.Unreadable("topics.json is not an object")
    topics = {}
    for cat, items in raw.items():
        if not isinstance(items, list):
            continue
        topics[cat] = [t for t in map(normalise_topic, items) if t["text"].strip()]
    return topics


def load_topics():
    """The live topic list. A damaged file falls back to the last good copy
    (`topics.json.bak`); with neither readable it's a clear 503, not a 500."""
    ensure_topics()
    try:
        return _parse_topics(jsonfile.read(TOPICS_PATH))
    except (FileNotFoundError, jsonfile.Unreadable):
        try:
            return _parse_topics(jsonfile.read(jsonfile.backup_path(TOPICS_PATH)))
        except (FileNotFoundError, jsonfile.Unreadable) as exc:
            raise TopicsUnavailable(
                "The topic list is damaged. Restore data/ito/topics.json, or "
                "delete it to start again from the shipped topics."
            ) from exc


def save_topics(topics):
    jsonfile.write(TOPICS_PATH, topics)


def drawable_categories(topics):
    """Categories with at least one topic in them. An emptied category stays
    in the file (so Settings can top it up) but has nothing to draw from, so
    it's kept off the host's wheel."""
    return [cat for cat, items in topics.items() if items]


def _json_body():
    """The request's JSON object, or None if it isn't one. The API is poked by
    hand often enough that a list or a string body must be a 400, not a 500."""
    body = request.get_json(silent=True)
    if body is None and not request.get_data():
        return {}
    return body if isinstance(body, dict) else None


def _bad_body():
    return jsonify({"error": "expected a JSON object"}), 400


def new_room_state():
    return {
        "current_topic": None,
        "current_category": None,  # the drawn topic's own category (the chip)
        "current_low": None,   # labels for the two ends of the card's scale
        "current_high": None,
        "current_type": None,
        "round_number": 0,
        # Bumped by every deal, a reroll included. round_number counts rounds
        # actually played; this counts cards on the table, which is what the
        # display views watch so a swapped card still flips on every phone.
        "draw_id": 0,
        "used": [],  # topics already drawn in this room, so we don't repeat
        "scored": False,  # has this round's outcome been logged yet?
    }


def _room_or_404(code):
    """Look up a room, throttling clients that keep guessing wrong codes."""
    return require_room(code, GAME_ID)


def _public_state(room):
    return {**room.state, "code": room.code}


# --- pages ---------------------------------------------------------------

@bp.route("/")
def landing():
    """Start a room, or join one that's already running."""
    return render_template("ito/landing.html", game=GAME)


@bp.route("/rooms", methods=["POST"])
def create_room():
    room = rooms.create(GAME_ID, new_room_state)
    return redirect(url_for("ito.host_view", code=room.code))


@bp.route("/host/<code>")
def host_view(code):
    room = _room_or_404(code)
    player_url = request.host_url.rstrip("/") + url_for("ito.player_view", code=room.code)
    return render_template(
        "ito/host.html",
        game=GAME,
        code=room.code,
        categories=drawable_categories(load_topics()),
        qr_svg=qr_svg(player_url).decode("utf-8"),
        player_url=player_url,
    )


@bp.route("/play/<code>")
def player_view(code):
    room = _room_or_404(code)
    return render_template("ito/player.html", game=GAME, code=room.code)


def _side_page_room(code):
    """The room a side page was opened from, if it's real.

    These pages render with or without a room, but whether the back link
    names one tells you if a code exists — so a wrong code here counts
    against the same guess throttle as /join and the room API."""
    return find_room(code, GAME_ID) if code else None


def _back_link(room):
    """Where a side page's back link should point. Pages are reachable both
    mid-game and from the landing screen, so follow the room if there is one."""
    if room is None:
        return url_for("ito.landing"), "Back to ito"
    return url_for("ito.host_view", code=room.code), f"Back to room {room.code}"


@bp.route("/rules")
def rules_view():
    room = _side_page_room(request.args.get("code"))
    href, label = _back_link(room)
    return render_template(
        "ito/rules.html",
        game=GAME,
        code=room.code if room else None,
        back_href=href,
        back_label=label,
    )


@bp.route("/stats")
def stats_view():
    room = _side_page_room(request.args.get("code"))
    href, label = _back_link(room)
    return render_template(
        "ito/stats.html",
        game=GAME,
        code=room.code if room else None,
        back_href=href,
        back_label=label,
    )


@bp.route("/settings")
@bp.route("/settings/<code>")
def settings_view(code=None):
    """Topic list and session housekeeping — kept off the host screen so that
    stays a one-thumb control surface during a round.

    Reachable without a room too: topics are global, and editing the list is
    something you do before anyone sits down, not only mid-game. Without a
    code the page simply drops the parts that are about a room."""
    room = _room_or_404(code) if code else None
    return render_template(
        "ito/settings.html",
        game=GAME,
        code=room.code if room else None,
        topics=load_topics(),
    )


# --- room API ------------------------------------------------------------

@bp.route("/api/<code>/state")
def api_state(code):
    room = _room_or_404(code)
    with room.lock:
        return jsonify(_public_state(room))


@bp.route("/api/<code>/draw", methods=["POST"])
def api_draw(code):
    """Draw a new topic for this room, optionally restricted to one category.

    A reroll replaces the card without starting a new round: you didn't play
    the topic, you just didn't like it, so it shouldn't count towards the
    round number or clear the result still owed on the round in progress."""
    room = _room_or_404(code)
    body = _json_body()
    if body is None:
        return _bad_body()
    category = body.get("category")
    if category is not None and not isinstance(category, str):
        return jsonify({"error": "category must be a string"}), 400
    reroll = bool(body.get("reroll"))
    topics = load_topics()

    if category and category in topics:
        pool = topics[category]
    else:
        # Remember each topic's own category, so an "Any" draw still shows a
        # real category on the card rather than a blank chip.
        pool = [dict(t, category=cat) for cat, group in topics.items() for t in group]
        category = None

    # Deleting a category's last topic in Settings leaves it empty, and an
    # emptied file leaves "Any" with nothing either. random.choice([]) was a
    # 500; this says what's wrong.
    if not pool:
        return jsonify({"error": f"There are no topics in {category} — add some in Settings."
                        if category else "There are no topics to draw — add some in Settings."}), 409

    with room.lock:
        state = room.state
        pool_texts = {t["text"] for t in pool}
        available = [t for t in pool if t["text"] not in state["used"]]
        if not available:
            # Everything in this pool has been used — reset just this pool
            state["used"] = [t for t in state["used"] if t not in pool_texts]
            available = pool

        chosen = random.choice(available)
        state["current_topic"] = chosen["text"]
        state["current_category"] = chosen.get("category", category)
        state["current_low"] = chosen["low"]
        state["current_high"] = chosen["high"]
        state["current_type"] = category
        state["draw_id"] += 1
        if not reroll or state["round_number"] == 0:
            state["round_number"] += 1
            state["scored"] = False
        state["used"].append(chosen["text"])
        return jsonify(_public_state(room))


@bp.route("/api/<code>/result", methods=["POST"])
def api_result(code):
    """Record whether the round's card order came out correct."""
    room = _room_or_404(code)
    body = _json_body()
    if body is None:
        return _bad_body()
    outcome = body.get("outcome")
    if outcome not in ("win", "lose"):
        return jsonify({"error": "outcome must be 'win' or 'lose'"}), 400

    with room.lock:
        if room.state["round_number"] == 0:
            return jsonify({"error": "no round to score yet"}), 409
        if room.state["scored"]:
            return jsonify({"error": "this round has already been scored"}), 409
        room.state["scored"] = True
        category = room.state.get("current_type")

    try:
        return jsonify(stats.record(GAME_ID, outcome, category))
    except stats.StatsUnavailable:
        # Not saved, so the round is still owed a result.
        with room.lock:
            room.state["scored"] = False
        raise


@bp.route("/api/<code>/reset", methods=["POST"])
def api_reset(code):
    """Clear this room's topic history for a fresh session (stats untouched)."""
    room = _room_or_404(code)
    with room.lock:
        room.state.update(new_room_state())
        return jsonify(_public_state(room))


# --- game-wide API (not room-scoped) ------------------------------------

@bp.route("/api/stats")
def api_stats():
    return jsonify(stats.load(GAME_ID))


@bp.route("/api/stats/reset", methods=["POST"])
def api_stats_reset():
    return jsonify(stats.reset(GAME_ID))


@bp.route("/api/topics", methods=["GET"])
def api_topics_get():
    return jsonify(load_topics())


@bp.route("/api/topics", methods=["POST"])
def api_topics_add():
    """Add a topic to a category, e.g. to top up with your own."""
    data = _json_body()
    if data is None:
        return _bad_body()
    category = data.get("category")
    for field in ("category", "text", "low", "high"):
        if data.get(field) is not None and not isinstance(data.get(field), str):
            return jsonify({"error": f"{field} must be a string"}), 400
    text = _text(data.get("text"))

    with _topics_lock:
        topics = load_topics()
        if category not in topics or not text:
            return jsonify({"error": "invalid category or empty text"}), 400

        if not any(t["text"] == text for t in topics[category]):
            topics[category].append(normalise_topic({
                "text": text,
                "low": _text(data.get("low")),
                "high": _text(data.get("high")),
            }))
            save_topics(topics)

    return jsonify(topics)


@bp.route("/api/topics/delete", methods=["POST"])
def api_topics_delete():
    """Remove a topic — mostly for pruning ones that never land with a group."""
    data = _json_body()
    if data is None:
        return _bad_body()
    category = data.get("category")
    text = data.get("text")
    if not isinstance(category, str) or not isinstance(text, str):
        return jsonify({"error": "category and text must be strings"}), 400

    with _topics_lock:
        topics = load_topics()
        if category not in topics:
            return jsonify({"error": "unknown topic"}), 400

        remaining = [t for t in topics[category] if t["text"] != text]
        if len(remaining) == len(topics[category]):
            return jsonify({"error": "unknown topic"}), 400

        topics[category] = remaining
        save_topics(topics)
    return jsonify(topics)


GAME = GameSpec(
    id=GAME_ID,
    name="ito",
    tagline="Rank your secret numbers without saying them out loud.",
    blueprint=bp,
    accent="#4f8cff",
    new_room_state=new_room_state,
    host_endpoint="ito.host_view",
    player_endpoint="ito.player_view",
)
