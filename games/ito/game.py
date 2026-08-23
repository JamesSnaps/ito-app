"""ito — the topic randomiser.

Scope is unchanged from the single-game version: this replaces the topic
booklet only. Secret numbers, card placement and turn order all stay
physical. What's new is that a session lives in a room, so two groups can
use the same instance without stepping on each other.
"""

import json
import random

from flask import (
    Blueprint, abort, jsonify, redirect, render_template, request, url_for,
)

from core import stats
from core.paths import game_data_dir
from core.qr import svg as qr_svg
from core.rooms import rooms
from games.registry import GameSpec

GAME_ID = "ito"
TOPICS_PATH = game_data_dir(GAME_ID) / "topics.json"

bp = Blueprint(
    GAME_ID, __name__, url_prefix="/ito", template_folder="templates"
)


# Fallback poles for a topic saved without its own. The printed cards always
# name both ends of the scale ("Small … Big"), so a card is never label-less.
DEFAULT_LOW = "Low"
DEFAULT_HIGH = "High"


def normalise_topic(entry):
    """Accept either a plain string or a {text, low, high} object.

    Topics were bare strings before cards had scale labels, and hand-edited
    topics.json files are expected, so both shapes stay readable."""
    if isinstance(entry, str):
        return {"text": entry, "low": DEFAULT_LOW, "high": DEFAULT_HIGH}
    return {
        "text": entry.get("text", ""),
        "low": (entry.get("low") or DEFAULT_LOW).strip(),
        "high": (entry.get("high") or DEFAULT_HIGH).strip(),
    }


def load_topics():
    with open(TOPICS_PATH, "r", encoding="utf-8") as f:
        raw = json.load(f)
    return {cat: [normalise_topic(t) for t in items] for cat, items in raw.items()}


def save_topics(topics):
    with open(TOPICS_PATH, "w", encoding="utf-8") as f:
        json.dump(topics, f, indent=2, ensure_ascii=False)


def new_room_state():
    return {
        "current_topic": None,
        "current_category": None,  # the drawn topic's own category (the chip)
        "current_low": None,   # labels for the two ends of the card's scale
        "current_high": None,
        "current_type": None,
        "round_number": 0,
        "used": [],  # topics already drawn in this room, so we don't repeat
        "scored": False,  # has this round's outcome been logged yet?
    }


def _room_or_404(code):
    room = rooms.get(code, GAME_ID)
    if room is None:
        abort(404, description="That room code isn't active. It may have expired.")
    return room


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
        categories=list(load_topics().keys()),
        qr_svg=qr_svg(player_url).decode("utf-8"),
        player_url=player_url,
    )


@bp.route("/play/<code>")
def player_view(code):
    room = _room_or_404(code)
    return render_template("ito/player.html", game=GAME, code=room.code)


def _back_link(code):
    """Where a side page's back link should point. Pages are reachable both
    mid-game and from the landing screen, so follow the room if there is one."""
    room = rooms.get(code, GAME_ID) if code else None
    if room is None:
        return url_for("ito.landing"), "Back to ito"
    return url_for("ito.host_view", code=room.code), f"Back to room {room.code}"


@bp.route("/rules")
def rules_view():
    code = request.args.get("code")
    href, label = _back_link(code)
    room = rooms.get(code, GAME_ID) if code else None
    return render_template(
        "ito/rules.html",
        game=GAME,
        code=room.code if room else None,
        back_href=href,
        back_label=label,
    )


@bp.route("/stats")
def stats_view():
    code = request.args.get("code")
    href, label = _back_link(code)
    room = rooms.get(code, GAME_ID) if code else None
    return render_template(
        "ito/stats.html",
        game=GAME,
        code=room.code if room else None,
        back_href=href,
        back_label=label,
    )


@bp.route("/settings/<code>")
def settings_view(code):
    """Topic list and session housekeeping — kept off the host screen so that
    stays a one-thumb control surface during a round."""
    room = _room_or_404(code)
    return render_template(
        "ito/settings.html",
        game=GAME,
        code=room.code,
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
    """Draw a new topic for this room, optionally restricted to one category."""
    room = _room_or_404(code)
    category = request.json.get("category") if request.is_json else None
    topics = load_topics()

    if category and category in topics:
        pool = topics[category]
    else:
        # Remember each topic's own category, so an "Any" draw still shows a
        # real category on the card rather than a blank chip.
        pool = [dict(t, category=cat) for cat, group in topics.items() for t in group]
        category = None

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
        state["round_number"] += 1
        state["used"].append(chosen["text"])
        state["scored"] = False
        return jsonify(_public_state(room))


@bp.route("/api/<code>/result", methods=["POST"])
def api_result(code):
    """Record whether the round's card order came out correct."""
    room = _room_or_404(code)
    outcome = request.json.get("outcome") if request.is_json else None
    if outcome not in ("win", "lose"):
        return jsonify({"error": "outcome must be 'win' or 'lose'"}), 400

    with room.lock:
        if room.state["round_number"] == 0:
            return jsonify({"error": "no round to score yet"}), 409
        if room.state["scored"]:
            return jsonify({"error": "this round has already been scored"}), 409
        room.state["scored"] = True
        category = room.state.get("current_type")

    return jsonify(stats.record(GAME_ID, outcome, category))


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
    data = request.json or {}
    category = data.get("category")
    text = (data.get("text") or "").strip()
    topics = load_topics()

    if category not in topics or not text:
        return jsonify({"error": "invalid category or empty text"}), 400

    if not any(t["text"] == text for t in topics[category]):
        topics[category].append(normalise_topic({
            "text": text,
            "low": (data.get("low") or "").strip(),
            "high": (data.get("high") or "").strip(),
        }))
        save_topics(topics)

    return jsonify(topics)


@bp.route("/api/topics/delete", methods=["POST"])
def api_topics_delete():
    """Remove a topic — mostly for pruning ones that never land with a group."""
    data = request.json or {}
    category = data.get("category")
    text = data.get("text")
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
    new_room_state=new_room_state,
    host_endpoint="ito.host_view",
    player_endpoint="ito.player_view",
)
