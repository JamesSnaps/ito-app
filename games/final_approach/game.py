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
from datetime import datetime, timedelta, timezone
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
# Every finished shift, guests' too, for the owner's Activity page. Kept in
# its own bucket so the family records stay small; the oldest drop off.
ACTIVITY_ID = "final-approach-activity"
ACTIVITY_KEEP = 3000
DEVICE = re.compile(r"[0-9a-f]{8}")
MAX_LIVES = 3
# Free play: a cleared airport with the player's own toggles. Recorded and
# shown, but it never earns stars, medals or a place on a leaderboard.
FREE_TYPES = ("prop", "jet", "heli", "heavy")
FREE_TRAFFIC = ("light", "normal", "rush")
FREE_EMERGENCIES = ("off", "some", "lots")
# Conditions: a cleared airport replayed harder, for a stamp. The same
# offer as the game's conditionsFor(): only what differs from the airport.
CONDITIONS = ("dusk", "night", "snow", "storm", "fog")
CONDITION_AT = {"dusk": "at dusk", "night": "at night", "snow": "in the snow", "storm": "in a storm", "fog": "in fog"}


@functools.lru_cache(maxsize=1)
def airports():
    """The airports, read from levels.js (the game's own source of truth):
    {id: {"id", "code", "name", "target", "endless"}} in play order."""
    levels = Path(__file__).resolve().parents[2] / "static" / "final-approach" / "levels.js"
    found = {}
    for entry in levels.read_text(encoding="utf-8").split("const LEVELS")[1].split("\n  {\n")[1:]:
        number = int(re.search(r"id: (\d+)", entry).group(1))
        target = re.search(r"target: (\d+)", entry)
        theme = re.search(r"theme: '([a-z]+)'", entry)
        found[number] = {
            "id": number,
            "code": re.search(r"code: '([A-Z]{3})'", entry).group(1),
            "name": re.search(r"name: '([^']+)'", entry).group(1),
            "target": int(target.group(1)) if target else None,
            "endless": "endless: true" in entry,
            "theme": theme.group(1) if theme else None,
        }
    return found


def conditions_for(airport):
    if airport["endless"]:
        return ()
    offered = []
    if airport["theme"] != "night":
        offered += ["dusk", "night"]
    if airport["theme"] not in ("snow", "desert"):
        offered.append("snow")
    return tuple(offered + ["storm", "fog"])


def _whole(value, low, high):
    """An int in [low, high] (not a bool, which Python counts as an int)."""
    return isinstance(value, int) and not isinstance(value, bool) and low <= value <= high


def parse_free(free):
    """A free-play run's settings, checked against the fixed list (the game's
    freeChoices). Raises ValueError."""
    if not isinstance(free, dict) or set(free) != {"length", "traffic", "types", "fuel", "storms", "wind", "emergencies"}:
        raise ValueError("Free play needs its settings.")
    types = free["types"]
    if (not isinstance(types, list) or not types or len(set(types)) != len(types)
            or any(t not in FREE_TYPES for t in types)):
        raise ValueError("Free play's aircraft are props, jets, helis or heavies.")
    if (free["length"] not in ("shift", "endless") or free["traffic"] not in FREE_TRAFFIC
            or free["emergencies"] not in FREE_EMERGENCIES or not _whole(free["storms"], 0, 3)
            or not isinstance(free["fuel"], bool) or not isinstance(free["wind"], bool)):
        raise ValueError("Those aren't free play's settings.")
    return {**free, "types": [t for t in FREE_TYPES if t in types]}


def free_summary(free):
    """"Rush · 2 storms · endless": a free-play run in a few words (the same
    words as the game's freeSummary)."""
    bits = []
    if free["traffic"] != "normal":
        bits.append("Rush" if free["traffic"] == "rush" else "Light traffic")
    if free["storms"]:
        bits.append("1 storm" if free["storms"] == 1 else f"{free['storms']} storms")
    if free["wind"]:
        bits.append("wind shifts")
    if free["fuel"]:
        bits.append("low fuel")
    if free["emergencies"] != "off":
        bits.append("lots of emergencies" if free["emergencies"] == "lots" else "emergencies")
    if free["length"] == "endless":
        bits.append("endless")
    text = " · ".join(bits)
    return text[:1].upper() + text[1:] if text else "As usual"


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
    free = body.get("free")
    condition = body.get("condition")
    if condition is not None and (free is not None or condition not in conditions_for(airport)):
        raise ValueError("That airport doesn't have that condition.")
    if free is not None:
        if airport["endless"]:
            raise ValueError("Endless has no free play.")
        free = parse_free(free)
        if free["length"] == "endless":
            if outcome == "win":
                raise ValueError("An endless run doesn't end in a win.")
        elif landed > airport["target"]:
            raise ValueError("More landings than the airport's target.")
        elif outcome == "win" and (landed != airport["target"] or strikes >= MAX_LIVES):
            raise ValueError("A cleared shift lands the whole target.")
        return {"id": shift_id, "level": level, "outcome": outcome, "landed": landed, "strikes": strikes,
                "stars": 0, "duration": round(float(duration), 1), "assisted": assisted,
                "endless": False, "medals": 0, "emergencies": None, "free": free}
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
    shift = {"id": shift_id, "level": level, "outcome": outcome, "landed": landed, "strikes": strikes,
             "stars": stars, "duration": round(float(duration), 1), "assisted": assisted,
             "endless": airport["endless"], "medals": medals, "emergencies": setting}
    if condition:
        shift["condition"] = condition
    return shift


def _blank_player(name):
    return {"name": name, "stars": {}, "best": {}, "shifts": 0, "landed": 0, "medals": 0,
            "endless": {}, "endless_at": {}, "endless_best_calm": 0, "seconds": 0, "last_at": None}


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
    player["seconds"] = round(player.get("seconds", 0) + shift["duration"], 1)
    player["last_at"] = at
    player["medals"] = player.get("medals", 0) + shift["medals"]
    level = str(shift["level"])
    if shift.get("free"):
        pass                      # free play: counted, never ranked
    elif shift.get("condition"):
        # A condition earns its stamp (best stars, first date), apart from the
        # airport's own stars.
        if shift["stars"]:
            book = player.setdefault("stamps", {}).setdefault(level, {})
            had = book.get(shift["condition"])
            book[shift["condition"]] = {"stars": max(shift["stars"], had["stars"] if had else 0),
                                        "at": had["at"] if had else at}
    elif shift["endless"]:
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
    entry = {"name": name, "at": at, **{k: shift[k] for k in
             ("level", "outcome", "landed", "stars", "assisted", "endless", "medals", "emergencies")}}
    if shift.get("free"):
        entry["free"] = shift["free"]
    if shift.get("condition"):
        entry["condition"] = shift["condition"]
    record["recent"] = ([entry] + record["recent"])[:RECENT_SHIFTS]
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
        "seconds": player.get("seconds", 0),
        "last_at": player.get("last_at"),
        "stamps": player.get("stamps", {}),
        "total_stamps": sum(len(book) for book in player.get("stamps", {}).values()),
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
    recent = [{**s, "free_summary": free_summary(s["free"])} if s.get("free") else s
              for s in record.get("recent", [])]
    recent = [{**s, "condition_at": CONDITION_AT[s["condition"]]} if s.get("condition") else s for s in recent]
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat(timespec="seconds")
    guests_week = sum(1 for e in activity() if e.get("guest") and e["at"] >= week_ago)
    return {"airports": list(airports().values()), "players": players,
            "leaderboards": leaderboards, "recent": recent, "guests_week": guests_week}


# --- the owner's Activity page ---------------------------------------------------

def activity():
    return (stats.read(ACTIVITY_ID, default={}) or {}).get("shifts", [])


def guest_name(device):
    return f"Guest {device[:4].upper()}"


def log_activity(shift, at, name, device, where):
    """Add a finished shift to the Activity log (once per shift id)."""
    entry = {"id": shift["id"], "at": at, "name": name or guest_name(device), "guest": name is None,
             "device": device, **{k: shift[k] for k in ("level", "outcome", "landed", "strikes", "duration",
                                                       "assisted", "medals", "endless", "emergencies")}}
    if shift.get("free"):
        entry["free"] = free_summary(shift["free"])
    if shift.get("condition"):
        entry["condition"] = CONDITION_AT[shift["condition"]]
    if where:
        entry["where"] = where

    def apply(record):
        record = record if isinstance(record, dict) else {}
        shifts = record.get("shifts", [])
        if any(e.get("id") == shift["id"] for e in shifts[-200:]):
            return record
        record["shifts"] = (shifts + [entry])[-ACTIVITY_KEEP:]
        return record

    stats.update(ACTIVITY_ID, apply)


def _clock(seconds):
    minutes = int(round(seconds / 60))
    return f"{minutes // 60}h {minutes % 60:02d}m" if minutes >= 60 else f"{minutes}m"


def activity_payload(now=None):
    """Everything on the Activity page, worked out from the log."""
    now = now or datetime.now(timezone.utc)
    shifts = activity()
    today = now.date().isoformat()
    week_ago = (now - timedelta(days=7)).isoformat(timespec="seconds")
    week = [e for e in shifts if e["at"] >= week_ago]
    order = {a["id"]: i for i, a in enumerate(airports().values())}
    names = {a["id"]: a for a in airports().values()}
    records = (stats.read(GAME_ID, default={}) or {}).get("players", {})

    people = {}
    for e in shifts:
        p = people.setdefault(e["name"], {"name": e["name"], "guest": e["guest"], "shifts": 0, "seconds": 0,
                                          "week_shifts": 0, "week_seconds": 0, "last_at": e["at"], "where": set(),
                                          "calm": 0, "free": 0, "cleared": set()})
        p["shifts"] += 1
        p["seconds"] += e["duration"]
        if e["at"] >= week_ago:
            p["week_shifts"] += 1
            p["week_seconds"] += e["duration"]
        p["last_at"] = max(p["last_at"], e["at"])
        if e.get("where"):
            p["where"].add(e["where"])
        p["calm"] += bool(e["assisted"])
        p["free"] += bool(e.get("free"))
        if e["outcome"] == "win" and not e.get("free"):
            p["cleared"].add(e["level"])
    playable = [a for a in airports().values() if not a["endless"]]
    for p in people.values():
        record = records.get(p["name"].casefold()) if not p["guest"] else None
        stars = (record or {}).get("stars", {})
        cleared = {int(k) for k, v in stars.items() if v} | p["cleared"]
        furthest = max(cleared, key=lambda i: order.get(i, -1), default=None)
        p["progress"] = f"{len(cleared)} of {len(playable)}"
        p["furthest"] = names[furthest]["name"] if furthest in names else None
        p["stars"] = sum(stars.values()) if record else None
        p["where"] = " & ".join(sorted(p["where"])) if p["where"] else ""
        p["time"], p["week_time"] = _clock(p["seconds"]), _clock(p["week_seconds"])
        del p["cleared"]
    people = sorted(people.values(), key=lambda p: p["last_at"], reverse=True)

    by_airport = []
    for a in airports().values():
        played = [e for e in shifts if e["level"] == a["id"]]
        if not played:
            continue
        ranked = [e for e in played if not e.get("free")]
        wins = sum(e["outcome"] == "win" for e in ranked)
        by_airport.append({
            "code": a["code"], "name": a["name"], "endless": a["endless"], "shifts": len(played),
            "free": len(played) - len(ranked),
            "wins": wins, "crashes": sum(e["outcome"] == "crash" for e in played),
            "struck_out": sum(e["outcome"] == "strikes" for e in played),
            "clear_rate": round(100 * wins / len(ranked)) if ranked and not a["endless"] else None,
            "best": max((e["landed"] for e in played), default=0),
            "average": round(sum(e["landed"] for e in played) / len(played), 1),
        })

    days = []
    for back in range(13, -1, -1):
        day = (now - timedelta(days=back)).date().isoformat()
        on_day = [e for e in shifts if e["at"][:10] == day]
        days.append({"day": day, "family": sum(not e["guest"] for e in on_day), "guests": sum(e["guest"] for e in on_day)})
    tallest = max((d["family"] + d["guests"] for d in days), default=0) or 1

    return {
        "totals": {
            "today": sum(e["at"][:10] == today for e in shifts),
            "week": len(week),
            "week_time": _clock(sum(e["duration"] for e in week)),
            "week_people": len({e["name"] for e in week if not e["guest"]}),
            "week_guests": len({e["name"] for e in week if e["guest"]}),
            "logged": len(shifts),
            "since": shifts[0]["at"] if shifts else None,
        },
        "people": people, "airports": by_airport, "days": days, "tallest": tallest,
        "recent": [dict(e, airport=names.get(e["level"], {}).get("name", "?")) for e in reversed(shifts[-60:])],
    }


@bp.route("/api/shifts", methods=["POST"])
def api_record_shift():
    """Record a finished shift for the profile this device is signed in as."""
    token = request.headers.get(profiles.TOKEN_HEADER, "")
    player = profiles.by_token(token) if token else None
    body = request.get_json(silent=True)
    device = body.get("device") if isinstance(body, dict) else None
    device = device if isinstance(device, str) and DEVICE.fullmatch(device) else None
    if player is None and (token or device is None):
        refused = jsonify({"error": "Add yourself on the Game Night hub to keep family records."})
        refused.status_code = 403
        abort(refused)
    try:
        shift = parse_shift(body)
    except ValueError as problem:
        refused = jsonify({"error": str(problem)})
        refused.status_code = 400
        abort(refused)
    at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    # Guests' shifts only go to the owner's Activity log, anonymously: a
    # random tag per browser, no name, no address.
    log_activity(shift, at, player["name"] if player else None, device or "00000000", profiles.where())
    if player is None:
        return jsonify({"recorded": False, "guest": True})
    outcome = {}

    def apply(record):
        record, outcome["recorded"] = record_shift(record, player["name"], shift, at)
        outcome["player"] = public_player(record["players"][player["name"].casefold()])
        return record

    stats.update(GAME_ID, apply)
    return jsonify(outcome)


@bp.route("/activity")
def activity_page():
    """Who's playing and how they're doing, guests included. Only for a
    grown-up signed in to the server (the Family page's rule)."""
    if not profiles.family_signed_in():
        return render_template("final_approach/activity.html", signed_in=False, data=None), 403
    return render_template("final_approach/activity.html", signed_in=True, data=activity_payload())


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
