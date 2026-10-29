"""Picnic Raid — a set-a-trap card game for two to four, played on the app's cards.

Built the way Wildwood is, and this file follows its game.py function for
function: the engine on the server (engine.py), a JSON API any client can
drive, a room saved to disk after every move, the finished game recorded by
the server itself. What's different is who moves: while a trap springs, the
next decision can be someone else's (a Shoo! sent back), so "whose move" is
always `engine.turn`, never "whose turn".

Every hand is secret, so a request gets the view for whoever its token says
is asking:

- a **seat token** sees that seat's hand and moves for that seat only;
- the **host token**, held by the device that dealt, sees the table and runs
  the room (free a seat, rematch) but can't move — moving means seeing a hand;
- no token sees the table and can sit down in a free seat.

One device can hold the host token and every seat: that's pass-and-play,
the page asking as whoever has to decide behind a "pass it to Ana" screen.

Computer seats (ai.py) get tokens nobody is handed. A computer moves one move
per look at the table once the last move has had COMPUTER_DELAY to play out,
from its own seat's view. A game with any computer at the table is recorded
apart from games between people (`record["computer"]`), as in Fugitive.
"""

import copy
import json
import os
import random
import re
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path

from flask import Blueprint, abort, current_app, jsonify, render_template, request, url_for

from core import stats
from core.jsonfile import DataUnavailable
from core.paths import game_data_dir
from core.qr import svg as qr_svg
from core.rooms import IDLE_TIMEOUT, require_room, rooms
from games.registry import GameSpec
from games.picnic import ai, engine
from games.picnic.engine import IllegalMove

GAME_ID = "picnic"

bp = Blueprint(GAME_ID, __name__, url_prefix="/picnic", template_folder="templates")

MAX_NAME = 20
RECENT_GAMES = 10
# The computer's seats are picnickers nobody at the table is called, in this order.
COMPUTER_NAMES = ("Bramble", "Pip", "Clover", "Tansy")
# Seconds between a move and the computer's next one: long enough for the
# table to play the last move out. Tests set it to 0.
COMPUTER_DELAY = 1.5

# The deck is the secret; shuffles have to be unguessable.
_rng = random.SystemRandom()

ART_TYPES = (".webp", ".png", ".jpg", ".jpeg")
ART_NAME = re.compile(r"^[a-z0-9_-]{1,24}$")


# --- saved rooms ----------------------------------------------------------

def play_dir():
    """Looked up at call time, so tests can point DATA_DIR somewhere else."""
    path = game_data_dir(GAME_ID) / "play"
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_room(room):
    """Temp file then os.replace, so a crash mid-write keeps the last good
    copy. Rooms past the idle sweep are pruned here too."""
    folder = play_dir()
    target = folder / f"{room.code}.json"
    temp = target.with_suffix(".tmp")
    temp.write_text(json.dumps({"game_id": GAME_ID, "state": room.state}), encoding="utf-8")
    os.replace(temp, target)

    cutoff = time.time() - IDLE_TIMEOUT
    for old in folder.glob("*.json"):
        if old.stat().st_mtime < cutoff:
            old.unlink(missing_ok=True)


def load_room(code):
    """The rooms.add_loader hook: a saved game back after a restart."""
    path = play_dir() / f"{code}.json"
    try:
        if path.stat().st_mtime < time.time() - IDLE_TIMEOUT:
            return None
        saved = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(saved, dict) or saved.get("game_id") != GAME_ID:
        return None
    return GAME_ID, saved["state"]


rooms.add_loader(load_room)


# --- who's asking ---------------------------------------------------------

def request_token():
    return (request.headers.get("X-Picnic-Token") or "").encode("utf-8", "surrogateescape")


def identify(room, token):
    """("host", None), ("seat", n), or (None, None) for anyone else.
    Compared as bytes, as in Fugitive."""
    if isinstance(token, str):
        token = token.encode("utf-8", "surrogateescape")
    if not token:
        return None, None
    if secrets.compare_digest(token, room.state["host_token"].encode()):
        return "host", None
    for seat, seat_token in enumerate(room.state["seats"]):
        if seat_token and secrets.compare_digest(token, seat_token.encode()):
            return "seat", seat
    return None, None


def computer_seats(state):
    return (state.get("computer") or {}).get("seats", [])


def payload(room, token=None):
    """The game as this token may see it, plus who's sitting where — whether
    a seat is taken, never by which token — and who the token belongs to,
    which is how a phone notices its seat was freed."""
    kind, seat = identify(room, token)
    computers = computer_seats(room.state)
    out = {
        "code": room.code,
        "players": list(room.state["players"]),
        "seats": [{"taken": bool(t), "computer": i in computers} for i, t in enumerate(room.state["seats"])],
        "you": {"role": kind, "seat": seat},
        "game": engine.view(room.state["game"], seat if kind == "seat" else "table"),
        "next": room.state.get("next"),
    }
    computer = room.state.get("computer")
    if computer:
        out["computer"] = {"seats": list(computer["seats"]), "level": computer["level"]}
    return out


# --- the computer ---------------------------------------------------------

def parse_computer(body, humans):
    """{"seats", "level"} from a new game's `computers` and `level`, None for
    a table of people. The computer sits after the people. Returns
    (computer, error)."""
    count = body.get("computers", 0) if isinstance(body, dict) else 0
    if not engine._is_int(count) or count < 0:
        return None, "computers is how many: 0 to 3"
    if count == 0:
        return None, None
    if humans + count > engine.MAX_PLAYERS:
        return None, f"at most {engine.MAX_PLAYERS} at the table"
    level = body.get("level", ai.DEFAULT_LEVEL)
    if level not in ai.LEVELS:
        return None, "the computer plays easy or hard"
    return {"seats": list(range(humans, humans + count)), "level": level}, None


def computer_seat(computer):
    """The room's record of the computer: its seats, level and the secret
    seed its choices come from."""
    return {**computer, "seed": _rng.getrandbits(32)}


def computer_moves(room):
    """Make a computer's move, if it's a computer's turn and the last move
    has had time to play out. One move per look. Returns whether it moved."""
    computer = room.state.get("computer")
    game = room.state["game"]
    seat = engine.turn(game)
    if not computer or seat not in computer["seats"]:
        return False
    if time.time() - room.state.get("moved_at", 0) < COMPUTER_DELAY:
        return False
    seen = engine.view(game, seat)
    trial = copy.deepcopy(game)
    try:
        move = ai.choose(seen, computer["level"], ai.move_rng(computer["seed"], game["seq"]))
        engine.apply(trial, seat, move)
    except (IllegalMove, ValueError):
        # A bug, which the random-game tests exist to stop. A plain pass
        # beats a table stuck on the computer's move for good.
        current_app.logger.exception("Picnic Raid computer stuck in %s; it falls back", room.code)
        trial = copy.deepcopy(game)
        engine.apply(trial, seat, ai.fallback(seen))
    room.state["game"] = trial
    room.state["moved_at"] = time.time()
    record_if_finished(room)
    save_room(room)
    return True


def require_game(code):
    return require_room(code, GAME_ID)


# --- players and records --------------------------------------------------

def clean_name(value):
    return value.strip()[:MAX_NAME] if isinstance(value, str) else ""


def parse_players(body):
    """(names, computer, error) for a new game: the people's names in seat
    order, and the computer's seats after them, each named for an animal
    nobody at the table is called."""
    if not isinstance(body, dict) or not isinstance(body.get("players"), list):
        return None, None, "expected the players' names"
    names = [clean_name(n) for n in body["players"]]
    if not names or not all(names):
        return None, None, "every player needs a name"
    computer, error = parse_computer(body, len(names))
    if error:
        return None, None, error
    if computer:
        taken = {n.casefold() for n in names}
        free = [n for n in COMPUTER_NAMES if n.casefold() not in taken]
        names += free[:len(computer["seats"])]
    if not engine.MIN_PLAYERS <= len(names) <= engine.MAX_PLAYERS:
        return None, None, f"{engine.MIN_PLAYERS} to {engine.MAX_PLAYERS} players"
    # The records key players case-insensitively, so the table has to too.
    if len({n.casefold() for n in names}) != len(names):
        return None, None, "everyone needs a different name"
    return names, computer, None


def blank_stats():
    return {"games_played": 0, "players": {}, "recent": [], "computer": blank_computer_stats()}


def blank_computer_stats():
    return {"games_played": 0, "players": {}, "recent": []}


def blank_player(name):
    # Best: the highest total this player has finished a game on.
    return {"name": name, "games": 0, "wins": 0, "best": 0}


def blank_computer_player(name):
    row = blank_player(name)
    for level in ai.LEVELS:
        row[f"{level}_games"] = 0
        row[f"{level}_wins"] = 0
    return row


def load_stats():
    stored = stats.read(GAME_ID, blank_stats())
    merged = blank_stats()
    merged.update(stored if isinstance(stored, dict) else {})
    merged["computer"] = {**blank_computer_stats(), **(merged.get("computer") or {})}
    return merged


def leaderboard(record):
    """Most wins first, then the better win rate."""
    rows = []
    for player in record["players"].values():
        games = player.get("games") or 0
        rows.append({**blank_player(player["name"]), **player,
                     "win_rate": round(100 * player.get("wins", 0) / games) if games else 0})
    rows.sort(key=lambda p: (p["wins"], p["win_rate"]), reverse=True)
    return rows


def computer_leaderboard(record):
    """Against the computer: wins on hard first, then all wins, then the
    better win rate — as Fugitive ranks it."""
    rows = []
    for player in (record.get("computer") or {}).get("players", {}).values():
        row = {**blank_computer_player(player["name"]), **player}
        games = row["games"]
        row["win_rate"] = round(100 * row["wins"] / games) if games else 0
        rows.append(row)
    rows.sort(key=lambda p: (p["hard_wins"], p["wins"], p["win_rate"]), reverse=True)
    return rows


def record_if_finished(room):
    """Recorded by the server the moment the game ends, once. A game with
    the computer at the table goes in its own records."""
    game = room.state["game"]
    if game["phase"] != "game_over" or game["recorded"]:
        return
    computer = room.state.get("computer")
    try:
        if computer:
            stats.update(GAME_ID, lambda stored: add_computer_result(
                stored, room.state["players"], computer, game))
        else:
            stats.update(GAME_ID, lambda stored: add_result(stored, room.state["players"], game))
    except DataUnavailable:
        # stats.json is damaged and refuses writes; tried again on the next look.
        current_app.logger.error("Picnic Raid game %s not recorded yet: stats unavailable", room.code)
        return
    game["recorded"] = True


def add_result(stored, names, game, at=None):
    """The records with one finished game between people added."""
    record = blank_stats()
    record.update(stored if isinstance(stored, dict) else {})
    record["games_played"] += 1
    players = dict(record["players"])
    for seat, name in enumerate(names):
        key = name.casefold()
        player = {**blank_player(name), **players.get(key, {})}
        # Keyed case-insensitively; the latest spelling wins the display name.
        player["name"] = name
        player["games"] += 1
        player["best"] = max(player["best"], game["scores"][seat])
        # A shared win is a win for everyone in it.
        if seat in game["winners"]:
            player["wins"] += 1
        players[key] = player
    record["players"] = players
    record["recent"] = [{
        "at": at or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "players": list(names),
        "scores": list(game["scores"]),
        "winners": [names[w] for w in game["winners"]],
    }, *record["recent"]][:RECENT_GAMES]
    return record


def add_computer_result(stored, names, computer, game, at=None):
    """The records with one game against the computer added, under each
    person's name — the computer has no row of its own."""
    record = stored if isinstance(stored, dict) else {}
    played = {**blank_computer_stats(), **(record.get("computer") or {})}
    level = computer["level"]
    players = dict(played["players"])
    for seat, name in enumerate(names):
        if seat in computer["seats"]:
            continue
        key = name.casefold()
        player = {**blank_computer_player(name), **players.get(key, {})}
        player["name"] = name
        player["games"] += 1
        player[f"{level}_games"] += 1
        player["best"] = max(player["best"], game["scores"][seat])
        if seat in game["winners"]:
            player["wins"] += 1
            player[f"{level}_wins"] += 1
        players[key] = player
    played["players"] = players
    played["games_played"] += 1
    played["recent"] = [{
        "at": at or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "players": list(names),
        "computers": list(computer["seats"]),
        "level": level,
        "scores": list(game["scores"]),
        "winners": [names[w] for w in game["winners"]],
        "computer_won": any(w in computer["seats"] for w in game["winners"]),
    }, *played["recent"]][:RECENT_GAMES]
    return {**record, "computer": played}


# --- pages ----------------------------------------------------------------

def card_art():
    """The card pictures there are so far, by card code or food kind:
    `static/picnic/cards/<name>.(webp|png|jpg)`. A card without one is drawn
    as a plain placeholder, so art can arrive a picture at a time."""
    folder = Path(current_app.static_folder) / "picnic" / "cards"
    found = {}
    if folder.is_dir():
        for path in sorted(folder.iterdir()):
            if path.suffix.lower() in ART_TYPES and ART_NAME.match(path.stem):
                found.setdefault(path.stem, url_for("static", filename=f"picnic/cards/{path.name}"))
    return found


def page(code=None):
    return render_template("picnic/play.html", game=GAME, code=code, max_name=MAX_NAME,
                           max_players=engine.MAX_PLAYERS, computer_names=COMPUTER_NAMES,
                           art=card_art(), engine=engine)


@bp.route("/")
def landing():
    """Who's playing, and deal. The game itself lives at play_view."""
    return page()


@bp.route("/play/<code>")
def play_view(code):
    """The table. What it shows depends on the tokens this device holds."""
    return page(require_game(code).code)


def back_link():
    """Where a side page's back button goes: the Picnic Raid page that linked
    here, or the landing page. Same-game paths only."""
    back = request.args.get("back", "")
    if back.startswith("/picnic/") and "//" not in back and "\\" not in back:
        return back
    return url_for("picnic.landing")


@bp.route("/rules")
def rules_view():
    return render_template("picnic/rules.html", game=GAME, back=back_link(), engine=engine, art=card_art())


@bp.route("/stats")
def stats_view():
    record = load_stats()
    return render_template("picnic/stats.html", game=GAME, back=back_link(),
                           record=record, rows=leaderboard(record),
                           computer_rows=computer_leaderboard(record))


# --- API ------------------------------------------------------------------

def invite_url(code):
    return request.host_url.rstrip("/") + url_for("picnic.play_view", code=code)


@bp.route("/api/play", methods=["POST"])
def api_create():
    """Deal. `players` (names, in seat order), and `computers` (0–3) with a
    `level` for computer seats, which sit after the people."""
    names, computer, error = parse_players(request.get_json(silent=True))
    if error:
        return jsonify({"error": error}), 400

    def state():
        made = {
            "game": engine.new_game(_rng, len(names)),
            "players": names,
            "first": 0,
            "host_token": secrets.token_urlsafe(12),
            "seats": [None] * len(names),
            "moved_at": time.time(),
        }
        if computer:
            made["computer"] = computer_seat(computer)
            for seat in computer["seats"]:
                # Taken, by a token nobody is ever given.
                made["seats"][seat] = secrets.token_urlsafe(12)
        return made

    room = rooms.create(GAME_ID, state)
    with room.lock:
        save_room(room)
        token = room.state["host_token"]
        url = invite_url(room.code)
        return jsonify({**payload(room, token), "host_token": token,
                        "invite_url": url, "qr_svg": qr_svg(url).decode("utf-8")})


@bp.route("/api/play/<code>")
def api_state(code):
    room = require_game(code)
    with room.lock:
        computer_moves(room)
        game = room.state["game"]
        if game["phase"] == "game_over" and not game["recorded"]:
            record_if_finished(room)
            if game["recorded"]:
                save_room(room)
        return jsonify(payload(room, request_token()))


@bp.route("/api/play/<code>/invite")
def api_invite(code):
    """The QR into this game, for whichever device is showing it."""
    room = require_game(code)
    url = invite_url(room.code)
    return jsonify({"url": url, "qr_svg": qr_svg(url).decode("utf-8")})


def seat_number(room, seat):
    if not 0 <= seat < len(room.state["seats"]):
        abort(404, description="No such seat.")
    return seat


@bp.route("/api/play/<code>/seats/<int:seat>/claim", methods=["POST"])
def api_claim(code, seat):
    """Sit down. First come, first served — the code is the gate, as
    everywhere here — and the dealing device can free a seat."""
    room = require_game(code)
    with room.lock:
        seat = seat_number(room, seat)
        if room.state["seats"][seat]:
            return jsonify({"error": "Someone's already sitting there.", **payload(room)}), 409
        token = secrets.token_urlsafe(12)
        room.state["seats"][seat] = token
        save_room(room)
        return jsonify({**payload(room, token), "seat_token": token})


@bp.route("/api/play/<code>/seats/<int:seat>/release", methods=["POST"])
def api_release(code, seat):
    """Free a seat: the dealing device's call only."""
    room = require_game(code)
    with room.lock:
        seat = seat_number(room, seat)
        if identify(room, request_token())[0] != "host":
            return jsonify({"error": "Only the device that dealt can free a seat."}), 403
        if seat in computer_seats(room.state):
            return jsonify({"error": "The computer keeps its seat — start a new game instead."}), 400
        room.state["seats"][seat] = None
        save_room(room)
        return jsonify(payload(room, request_token()))


@bp.route("/api/play/<code>/move", methods=["POST"])
def api_move(code):
    """One move, for the seat whose token came with it. `seq` is the state
    the client was looking at; a move against anything older is refused
    (409, with the current game), so a double tap can't count twice."""
    room = require_game(code)
    move = request.get_json(silent=True)
    if not isinstance(move, dict):
        return jsonify({"error": "expected an object"}), 400

    token = request_token()
    with room.lock:
        kind, seat = identify(room, token)
        if kind != "seat":
            return jsonify({"error": "Only the players can move — sit down first."}), 403
        game = room.state["game"]
        if move.get("seq") != game["seq"]:
            return jsonify({"error": "The game had moved on — this is the latest.",
                            **payload(room, token)}), 409
        trial = copy.deepcopy(game)
        try:
            engine.apply(trial, seat, move)
        except IllegalMove as err:
            return jsonify({"error": str(err), **payload(room, token)}), 400
        room.state["game"] = trial
        room.state["moved_at"] = time.time()
        record_if_finished(room)
        save_room(room)
        return jsonify(payload(room, token))


@bp.route("/api/play/<code>/rematch", methods=["POST"])
def api_rematch(code):
    """The same table, dealt again, starting one seat further round. Every
    seat token carries over, so phones follow `next` without re-joining.
    Asking twice gets the same rematch."""
    room = require_game(code)
    with room.lock:
        if identify(room, request_token())[0] != "host":
            return jsonify({"error": "Only the device that dealt can start a rematch."}), 403
        if room.state["game"]["phase"] != "game_over":
            return jsonify({"error": "This game isn't over yet."}), 400
        if not room.state.get("next"):
            old = room.state
            first = (old.get("first", 0) + 1) % len(old["players"])
            carried = {key: copy.deepcopy(old[key]) for key in ("players", "seats", "host_token")}
            computer = old.get("computer")

            def state():
                made = {"game": engine.new_game(_rng, len(carried["players"]), first=first),
                        **copy.deepcopy(carried), "first": first, "moved_at": time.time()}
                if computer:
                    made["computer"] = computer_seat({"seats": computer["seats"], "level": computer["level"]})
                return made

            fresh = rooms.create(GAME_ID, state)
            with fresh.lock:
                save_room(fresh)
            room.state["next"] = fresh.code
            save_room(room)
        return jsonify({"code": room.state["next"], "host_token": room.state["host_token"]})


@bp.route("/api/stats")
def api_stats():
    """The record, plus both leaderboards in the order the records page shows them."""
    record = load_stats()
    return jsonify({**record, "leaderboard": leaderboard(record),
                    "computer_leaderboard": computer_leaderboard(record)})


GAME = GameSpec(
    id=GAME_ID,
    name="Picnic Raid",
    tagline="Fill your basket, pack it up, and hide ants under everyone else’s blanket.",
    blueprint=bp,
    accent="#d9534f",
    host_endpoint=None,
    player_endpoint="picnic.play_view",
    hub_action="Play",
)
