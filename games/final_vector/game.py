"""Final Vector: radar approach control for grown-ups (a prototype).

Final Approach's grown-up sibling. On a radar scope, arrivals come down out
of the holding stacks at a training airport, Ambleford, and you turn,
descend and slow them onto the ILS, three miles apart, with a command dial or
a typed command line, then hand each one to the tower. Pilots read every
instruction back, in recorded voices strung together word by word. The
Academy teaches it one idea at a time (lessons 1 to 5 so far); passing
lesson 5 opens a free shift. The design is docs/final-vector/CONCEPT.md.

Like Final Approach it runs entirely in the browser (static/final-vector/),
with progress in that browser's localStorage (`final-vector:save`). The
server keeps the family's records: lessons passed and shifts flown, posted by
a device signed in to a Game Night profile and kept under that profile's
name (the token says who, so nobody can post as someone else).
"""

import re
from datetime import datetime, timezone
from pathlib import Path

from flask import Blueprint, abort, current_app, jsonify, render_template, request

from core import profiles, stats
from games.registry import GameSpec

GAME_ID = "final-vector"
LESSONS = 5          # lessons in the Academy so far (static/final-vector/lessons.js)
RECENT = 12
SEEN_IDS = 400

bp = Blueprint(GAME_ID, __name__, url_prefix="/final-vector", template_folder="templates")


def voice_clips():
    """{voice: [clip, …]}: the recorded pieces on disk (tools/final_vector_voice.py).
    The page is told which exist; a readback with a piece missing is shown
    as text only."""
    folder = Path(current_app.static_folder) / "final-vector" / "voice"
    if not folder.is_dir():
        return {}
    return {voice.name: sorted(p.stem for p in voice.glob("*.mp3"))
            for voice in sorted(folder.iterdir()) if voice.is_dir()}


def _whole(value, low, high):
    """An int in [low, high] (not a bool, which Python counts as an int)."""
    return isinstance(value, int) and not isinstance(value, bool) and low <= value <= high


def _refuse(status, message):
    response = jsonify({"error": message})
    response.status_code = status
    abort(response)


def _player():
    token = request.headers.get(profiles.TOKEN_HEADER, "")
    player = profiles.by_token(token) if token else None
    if player is None:
        _refuse(403, "Add yourself on the Game Night hub to keep your lessons on the family records.")
    return player


def _blank(name):
    return {"name": name, "lessons": [], "shifts": 0, "landed": 0, "losses": 0, "best": None, "last_at": None}


SHIFT_FIELDS = ("arrivals", "landed", "losses", "alerts", "on_time", "late", "missed", "through", "left")


def parse_shift(body):
    """A finished shift, checked: whole numbers in sane bounds that agree with
    each other. Raises ValueError with a sentence the page can show."""
    if not isinstance(body, dict):
        raise ValueError("That isn't a shift.")
    shift_id = body.get("id")
    if not isinstance(shift_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,64}", shift_id):
        raise ValueError("A shift needs an id.")
    shift = {"id": shift_id}
    for key in SHIFT_FIELDS:
        value = body.get(key, 0)
        if not _whole(value, 0, 99):
            raise ValueError(f"{key.replace('_', ' ').capitalize()} needs to be a whole number.")
        shift[key] = value
    for key, top in (("duration", 6 * 3600), ("delay", 3 * 3600), ("fast", 6 * 3600)):
        value = body.get(key, 0)
        if not _whole(value, 0, top):
            raise ValueError(f"{key.capitalize()} needs to be whole seconds.")
        shift[key] = value
    if shift["duration"] < 60:
        raise ValueError("That shift is too short to count.")
    if shift["arrivals"] < 1:
        raise ValueError("A shift has arrivals.")
    if shift["landed"] + shift["left"] > shift["arrivals"]:
        raise ValueError("More aircraft down than arrived.")
    if shift["on_time"] + shift["late"] + shift["missed"] > shift["arrivals"]:
        raise ValueError("More handoffs than arrivals.")
    if shift["fast"] > shift["duration"]:
        raise ValueError("More time at ×2 than the shift lasted.")
    return shift


def record_lesson(record, name, lesson):
    """The record with a passed lesson added. Lessons are passed in order, so
    one is only taken once every lesson before it is on the record."""
    record = record if isinstance(record, dict) else {}
    player = record.setdefault("players", {}).setdefault(name.casefold(), _blank(name))
    player["name"] = name
    have = set(player.get("lessons", []))
    missing = [n for n in range(1, lesson) if n not in have]
    if missing:
        raise ValueError(f"Pass lesson {missing[0]} first.")
    have.add(lesson)
    player["lessons"] = sorted(have)
    player["last_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return record, player


def record_shift(record, name, shift, at):
    """The record with a shift added; a retried post of the same id counts once."""
    record = record if isinstance(record, dict) else {}
    record.setdefault("recent", [])
    record.setdefault("ids", [])
    player = record.setdefault("players", {}).setdefault(name.casefold(), _blank(name))
    if len(player.get("lessons", [])) < LESSONS:
        raise ValueError("Shifts open once the Academy's lessons are passed.")
    if shift["id"] in record["ids"]:
        return record, player, False
    player["name"] = name
    player["shifts"] += 1
    player["landed"] += shift["landed"]
    player["losses"] += shift["losses"]
    player["last_at"] = at
    # The best shift: fewest losses of separation, then least delay.
    best = player.get("best")
    if best is None or (shift["losses"], shift["delay"]) < (best["losses"], best["delay"]):
        player["best"] = {k: shift[k] for k in ("losses", "delay", "landed", "arrivals", "on_time")} | {"at": at}
    entry = {"name": name, "at": at} | {k: shift[k] for k in ("arrivals", "landed", "losses", "on_time", "late", "missed", "delay")}
    record["recent"] = ([entry] + record["recent"])[:RECENT]
    record["ids"] = (record["ids"] + [shift["id"]])[-SEEN_IDS:]
    return record, player, True


def public_player(player):
    return {k: player.get(k) for k in ("name", "lessons", "shifts", "landed", "losses", "best", "last_at")}


def stats_payload():
    record = stats.read(GAME_ID, default={}) or {}
    players = [public_player(p) for p in record.get("players", {}).values()]
    players.sort(key=lambda p: (-len(p["lessons"] or []), -(p["shifts"] or 0), p["name"].casefold()))
    return {"lessons": LESSONS, "players": players, "recent": record.get("recent", [])}


@bp.route("/api/lessons", methods=["POST"])
def api_lesson():
    """A lesson passed, for the profile this device is signed in as."""
    player = _player()
    body = request.get_json(silent=True)
    lesson = body.get("lesson") if isinstance(body, dict) else None
    if not _whole(lesson, 1, LESSONS):
        _refuse(400, f"Lessons run from 1 to {LESSONS}.")
    outcome = {}

    def apply(record):
        record, outcome["player"] = record_lesson(record, player["name"], lesson)
        return record

    try:
        stats.update(GAME_ID, apply)
    except ValueError as problem:
        _refuse(400, str(problem))
    return jsonify({"lessons": outcome["player"]["lessons"]})


@bp.route("/api/shifts", methods=["POST"])
def api_shift():
    """A finished shift, for the profile this device is signed in as."""
    player = _player()
    try:
        shift = parse_shift(request.get_json(silent=True))
    except ValueError as problem:
        _refuse(400, str(problem))
    at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    outcome = {}

    def apply(record):
        record, mine, outcome["recorded"] = record_shift(record, player["name"], shift, at)
        outcome["player"] = public_player(mine)
        return record

    try:
        stats.update(GAME_ID, apply)
    except ValueError as problem:
        _refuse(400, str(problem))
    return jsonify(outcome)


@bp.route("/api/stats")
def api_stats():
    return jsonify(stats_payload())


@bp.route("/")
def landing():
    """The whole game: the scope, the strips, the Academy and the shift."""
    return render_template("final_vector/play.html", voice=voice_clips())


GAME = GameSpec(
    id=GAME_ID,
    name="Final Vector",
    tagline="Preview: real radar approach control, for grown-ups. Vector them onto the ILS, three miles apart.",
    blueprint=bp,
    accent="#f2b33d",
    hub_action="Play the preview",
)
