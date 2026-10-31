"""Final Approach — a solo air-traffic game: draw each arrival's route down
to the runway that matches it, and keep everything apart.

The first game here that isn't for a table at all. It runs entirely in the
browser (static/final-approach/): the levels, the simulation, the painted
airports and the split-flap board are all client-side JS, with progress in
that browser's localStorage (`final-approach:save`).

The server keeps the family's records (v1.22.0). A finished shift is posted
by a device signed in to a Game Night profile, and recorded under that
profile's name: the token says who, so nobody can post as someone else.
The record is the player's stars per airport (their best), their best
Endless run (calm-skies runs kept apart, so the ranked board compares like
with like), and the last few shifts. A device that signs in elsewhere picks
its stars back up from here. See the playbook (docs/final-approach/PLAYBOOK.md)
for where the game is headed.
"""

import functools
import re
from datetime import datetime, timezone
from pathlib import Path

from flask import Blueprint, abort, current_app, jsonify, render_template, request

from core import profiles, stats
from games.registry import GameSpec

GAME_ID = "final-approach"

bp = Blueprint(GAME_ID, __name__, url_prefix="/final-approach", template_folder="templates")


def audio_names():
    """The recorded sounds on disk (made by tools/final_approach_sounds.py).
    The page is told which exist; anything missing falls back to the synth."""
    folder = Path(current_app.static_folder) / "final-approach" / "audio"
    return sorted(path.stem for path in folder.glob("*.mp3"))


RECENT_SHIFTS = 12
# Endless is ranked per emergencies setting, so each board is like-for-like.
# Runs from before emergencies existed (v1.23.0) count as "off".
# Grown-ups' profiles can also have the grown-up emergencies mixed in; those
# runs rank on their own boards too.
SETTINGS = ("some", "lots", "off", "some-grownup", "lots-grownup")
SEEN_IDS = 400
MAX_LIVES = 3


@functools.lru_cache(maxsize=1)
def airports():
    """The airports, read from levels.js (the game's own source of truth):
    {id: {"id", "code", "name", "target", "endless"}} in play order."""
    levels = Path(__file__).resolve().parents[2] / "static" / "final-approach" / "levels.js"
    found = {}
    for entry in levels.read_text(encoding="utf-8").split("const LEVELS")[1].split("\n  {\n")[1:]:
        number = int(re.search(r"id: (\d+)", entry).group(1))
        target = re.search(r"target: (\d+)", entry)
        found[number] = {
            "id": number,
            "code": re.search(r"code: '([A-Z]{3})'", entry).group(1),
            "name": re.search(r"name: '([^']+)'", entry).group(1),
            "target": int(target.group(1)) if target else None,
            "endless": "endless: true" in entry,
        }
    return found


def _whole(value, low, high):
    """An int in [low, high] (not a bool, which Python counts as an int)."""
    return isinstance(value, int) and not isinstance(value, bool) and low <= value <= high


def parse_shift(body):
    """A posted shift, checked: sane bounds, consistent with the airport and
    the rules. Stars are worked out here, never taken from the page. Raises
    ValueError with a sentence the page can show."""
    if not isinstance(body, dict):
        raise ValueError("That isn't a shift.")
    shift_id = body.get("id")
    if not isinstance(shift_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,64}", shift_id):
        raise ValueError("A shift needs an id.")
    level = body.get("level")
    airport = airports().get(level) if _whole(level, 1, 999) else None
    if airport is None:
        raise ValueError("No such airport.")
    outcome = body.get("outcome")
    if outcome not in ("win", "crash", "strikes"):
        raise ValueError("A shift ends in a win, a crash or three strikes.")
    landed, strikes = body.get("landed"), body.get("strikes")
    if not _whole(landed, 0, 999) or not _whole(strikes, 0, MAX_LIVES):
        raise ValueError("Landed and strikes need to be whole numbers.")
    duration = body.get("duration")
    if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not 1 <= duration <= 6 * 3600:
        raise ValueError("A shift needs a length.")
    if landed > duration + 5:
        raise ValueError("That's more landings than the time allows.")
    assisted = body.get("assisted", False)
    if not isinstance(assisted, bool):
        raise ValueError("Assisted is yes or no.")
    medals = body.get("medals", 0)
    if not _whole(medals, 0, 999) or medals > landed:
        raise ValueError("Medals are for emergencies landed.")
    setting = body.get("emergencies")
    if outcome == "strikes" and strikes != MAX_LIVES:
        raise ValueError("A shift ended by strikes has all three.")
    if airport["endless"]:
        if outcome == "win":
            raise ValueError("Endless doesn't end in a win.")
        setting = "off" if setting is None else setting
        if setting not in SETTINGS:
            raise ValueError("Emergencies are off, some or lots.")
        stars = 0
    else:
        if landed > airport["target"]:
            raise ValueError("More landings than the airport's target.")
        if outcome == "win" and (landed != airport["target"] or strikes >= MAX_LIVES):
            raise ValueError("A cleared shift lands the whole target.")
        stars = MAX_LIVES - strikes if outcome == "win" else 0
        setting = None
    return {"id": shift_id, "level": level, "outcome": outcome, "landed": landed, "strikes": strikes,
            "stars": stars, "duration": round(float(duration), 1), "assisted": assisted,
            "endless": airport["endless"], "medals": medals, "emergencies": setting}


def _blank_player(name):
    return {"name": name, "stars": {}, "best": {}, "shifts": 0, "landed": 0, "medals": 0,
            "endless": {}, "endless_at": {}, "endless_best_calm": 0}


def _endless(player):
    """Best Endless run per emergencies setting. Before v1.23.0 there was one
    best, `endless_best`, from runs without emergencies: that's "off"."""
    bests = dict(player.get("endless") or {})
    if player.get("endless_best") and "off" not in bests:
        bests["off"] = player["endless_best"]
    return bests


def _endless_at(player):
    when = dict(player.get("endless_at") or {})
    if player.get("endless_best_at") and "off" not in when:
        when["off"] = player["endless_best_at"]
    return when


def record_shift(record, name, shift, at):
    """The record with this shift added, and whether it was new (a retried
    post of the same shift id counts once)."""
    record = record if isinstance(record, dict) else {}
    record.setdefault("players", {})
    record.setdefault("recent", [])
    record.setdefault("ids", [])
    if shift["id"] in record["ids"]:
        return record, False
    player = record["players"].setdefault(name.casefold(), _blank_player(name))
    player["name"] = name
    player["shifts"] += 1
    player["landed"] += shift["landed"]
    player["medals"] = player.get("medals", 0) + shift["medals"]
    level = str(shift["level"])
    if shift["endless"]:
        if shift["assisted"]:
            player["endless_best_calm"] = max(player.get("endless_best_calm", 0), shift["landed"])
        else:
            bests, when = _endless(player), _endless_at(player)
            setting = shift["emergencies"]
            if shift["landed"] > bests.get(setting, 0):
                bests[setting] = shift["landed"]
                when[setting] = at
            player["endless"], player["endless_at"] = bests, when
            player.pop("endless_best", None)
            player.pop("endless_best_at", None)
    else:
        player["stars"][level] = max(player["stars"].get(level, 0), shift["stars"])
        player["best"][level] = max(player["best"].get(level, 0), shift["landed"])
    record["recent"] = ([{"name": name, "at": at, **{k: shift[k] for k in
                          ("level", "outcome", "landed", "stars", "assisted", "endless", "medals", "emergencies")}}]
                        + record["recent"])[:RECENT_SHIFTS]
    record["ids"] = (record["ids"] + [shift["id"]])[-SEEN_IDS:]
    return record, True


def public_player(player):
    return {
        "name": player["name"],
        "stars": player.get("stars", {}),
        "total_stars": sum(player.get("stars", {}).values()),
        "shifts": player.get("shifts", 0),
        "landed": player.get("landed", 0),
        "medals": player.get("medals", 0),
        "endless": _endless(player),
        "endless_best_calm": player.get("endless_best_calm", 0),
    }


def stats_payload():
    record = stats.read(GAME_ID, default={}) or {}
    players = [public_player(p) for p in record.get("players", {}).values()]
    players.sort(key=lambda p: (-p["total_stars"], p["name"].casefold()))
    leaderboards = {}
    for setting in SETTINGS:
        rows = []
        for p in record.get("players", {}).values():
            best = _endless(p).get(setting, 0)
            if best > 0:
                rows.append({"name": p["name"], "best": best, "at": _endless_at(p).get(setting)})
        rows.sort(key=lambda row: (-row["best"], row["at"] or ""))
        leaderboards[setting] = rows
    return {"airports": list(airports().values()), "players": players,
            "leaderboards": leaderboards, "recent": record.get("recent", [])}


@bp.route("/api/shifts", methods=["POST"])
def api_record_shift():
    """Record a finished shift for the profile this device is signed in as."""
    player = profiles.by_token(request.headers.get(profiles.TOKEN_HEADER, ""))
    if player is None:
        refused = jsonify({"error": "Add yourself on the Game Night hub to keep family records."})
        refused.status_code = 403
        abort(refused)
    try:
        shift = parse_shift(request.get_json(silent=True))
    except ValueError as problem:
        refused = jsonify({"error": str(problem)})
        refused.status_code = 400
        abort(refused)
    at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    outcome = {}

    def apply(record):
        record, outcome["recorded"] = record_shift(record, player["name"], shift, at)
        outcome["player"] = public_player(record["players"][player["name"].casefold()])
        return record

    stats.update(GAME_ID, apply)
    return jsonify(outcome)


@bp.route("/api/stats")
def api_stats():
    return jsonify(stats_payload())


@bp.route("/stats")
def stats_page():
    """The family's records: the Endless leaderboard, everyone's stars per
    airport, and the last few shifts."""
    return render_template("final_approach/stats.html", data=stats_payload())


@bp.route("/")
def landing():
    """The whole game: the arrivals board, the briefings and the airports
    are all on this one page."""
    return render_template("final_approach/play.html", audio_names=audio_names())


GAME = GameSpec(
    id=GAME_ID,
    name="Final Approach",
    tagline="Draw their routes down, match the runways, keep the sky clear.",
    blueprint=bp,
    accent="#e8553f",
    hub_action="Play",
)
