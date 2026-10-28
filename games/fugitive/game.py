"""Fugitive — played on the app's cards, two players, one trail.

The third kind of game here: not a companion to a physical box but the
whole game, like Flip 7's Play mode, and shaped the same way — the engine
on the server (engine.py), a JSON API any client can drive, a room saved to
disk after every move, and the finished game recorded by the server itself.

What's different is that Fugitive is a game of secrets. The Fugitive's
hand and face-down hideouts are hidden from the Marshal, and the Marshal's
cards from the Fugitive. So where Flip 7 sends everyone the same table, a
request here gets the view for whoever its token says is asking:

- a **seat token** (Fugitive or Marshal) sees that player's hand and moves
  for that player only;
- the **host token**, held by the device that dealt, sees the table — the
  public view — and runs the room: freeing a seat, starting a rematch. It
  can't move for a player, because moving means seeing their hand;
- no token sees the table and can sit down in a free seat.

One device can hold the host token and both seats. That's pass-and-play:
the page asks as whichever player's turn it is, behind a "pass it over"
screen so nobody sees the other's hand.

Or one of the seats is the computer (ai.py). Its seat token is made here and
never leaves the server; it plays from that seat's view only, one move at a
time, whenever anyone looks at the table and the last move has had
COMPUTER_DELAY to play out on screen. Games against it aren't recorded.
"""

import copy
import json
import os
import random
import re
import secrets
import time
from datetime import datetime, timezone

from flask import Blueprint, abort, current_app, jsonify, render_template, request, url_for

from core import stats
from core.jsonfile import DataUnavailable
from core.paths import game_data_dir
from core.qr import svg as qr_svg
from core.rooms import IDLE_TIMEOUT, require_room, rooms
from games.fugitive import ai, engine
from games.fugitive.engine import IllegalMove
from games.registry import GameSpec

GAME_ID = "fugitive"

bp = Blueprint(GAME_ID, __name__, url_prefix="/fugitive", template_folder="templates")

MAX_NAME = 20
RECENT_GAMES = 10
ROLES = engine.ROLES
COMPUTER_NAME = "Computer"
# Seconds between a move and the computer's next one: long enough for the
# table to play the last move out (a draw's flight, a hideout sliding in, a
# NOT HERE stamp) before the next one lands. Tests set it to 0.
COMPUTER_DELAY = 1.5

# The decks are the secret; shuffles have to be unguessable.
_rng = random.SystemRandom()


# --- saved rooms ----------------------------------------------------------
# The same scheme as Flip 7's played games: a game here *is* its room, so a
# deploy mid-evening mustn't end it.

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
    return (request.headers.get("X-Fugitive-Token") or "").encode("utf-8", "surrogateescape")


def identify(room, token):
    """("host", None), ("seat", role), or (None, None) for anyone else.

    Compared as bytes: compare_digest raises on a non-ASCII str, and a
    header is whatever the client sent."""
    if isinstance(token, str):
        token = token.encode("utf-8", "surrogateescape")
    if not token:
        return None, None
    if secrets.compare_digest(token, room.state["host_token"].encode()):
        return "host", None
    for role in ROLES:
        seat_token = room.state["seats"][role]
        if seat_token and secrets.compare_digest(token, seat_token.encode()):
            return "seat", role
    return None, None


def seat_view(game, viewer):
    """What `viewer` is sent: the engine's view, plus the Marshal's notepad
    help. That's worked out from the Marshal's own view, so it can't tell
    them anything they couldn't have deduced on paper. The computer is
    handed exactly this, so it knows no more than a person in its chair."""
    seen = engine.view(game, viewer)
    if viewer == "marshal" and seen["phase"] != "game_over":
        seen["candidates"] = engine.candidates(seen)
    return seen


def payload(room, token=None):
    """The game as this token may see it, plus who's sitting where — whether
    a seat is taken, never by which token — and who the token belongs to,
    which is how a phone notices its seat was freed. A game against the
    computer also says which seat it's in, and at what level."""
    kind, role = identify(room, token)
    out = {
        "code": room.code,
        "players": dict(room.state["players"]),
        "seats": {r: {"taken": bool(room.state["seats"][r])} for r in ROLES},
        "you": {"role": kind, "seat": role},
        "game": seat_view(room.state["game"], role if kind == "seat" else "table"),
        "next": room.state.get("next"),
    }
    computer = room.state.get("computer")
    if computer:
        out["computer"] = {"role": computer["role"], "level": computer["level"]}
    return out


# --- the computer ---------------------------------------------------------

def parse_computer(body):
    """{"role", "level"} from a new game's `computer`, None for two people.
    Returns (computer, error)."""
    wanted = body.get("computer") if isinstance(body, dict) else None
    if wanted is None:
        return None, None
    if not isinstance(wanted, dict) or wanted.get("role") not in ROLES:
        return None, "the computer needs a seat: fugitive or marshal"
    level = wanted.get("level", ai.DEFAULT_LEVEL)
    if level not in ai.LEVELS:
        return None, "the computer plays easy or hard"
    return {"role": wanted["role"], "level": level}, None


def computer_seat(computer):
    """The room's record of the computer: its seat, level and the secret seed
    its choices come from (secret, or its moves could be worked out ahead)."""
    return {**computer, "seed": _rng.getrandbits(32)}


def computer_moves(room):
    """Make the computer's move, if it's its turn and the last move has had
    time to play out. One move per look — a Marshal's two draws and a guess
    land a beat apart, as a person's would. Returns whether it moved."""
    computer = room.state.get("computer")
    game = room.state["game"]
    role = computer and computer["role"]
    if not computer or engine.turn(game) != role:
        return False
    if time.time() - room.state.get("moved_at", 0) < COMPUTER_DELAY:
        return False
    trial = copy.deepcopy(game)
    try:
        move = ai.choose(seat_view(game, role), computer["level"],
                         ai.move_rng(computer["seed"], game["seq"]))
        engine.apply(trial, role, move)
    except (IllegalMove, ValueError):
        # A bug, which the random-game tests exist to stop. Giving up beats
        # a table stuck on the computer's turn for good.
        current_app.logger.exception("Fugitive computer stuck in %s; it resigns", room.code)
        trial = copy.deepcopy(game)
        engine.apply(trial, role, {"type": "resign"})
    room.state["game"] = trial
    room.state["moved_at"] = time.time()
    record_if_finished(room)
    save_room(room)
    return True


def require_game(code):
    return require_room(code, GAME_ID)


# --- records --------------------------------------------------------------

def clean_name(value):
    return value.strip()[:MAX_NAME] if isinstance(value, str) else ""


def parse_players(body):
    """{"fugitive": name, "marshal": name} for a new game. Returns (players, error)."""
    if not isinstance(body, dict):
        return None, "expected an object"
    players = {role: clean_name(body.get(role)) for role in ROLES}
    if not all(players.values()):
        return None, "both players need a name"
    # The records key players case-insensitively, so the table has to too.
    if players["fugitive"].casefold() == players["marshal"].casefold():
        return None, "the two players need different names"
    return players, None


def blank_stats():
    return {"games_played": 0, "players": {}, "recent": []}


def blank_player(name):
    return {
        "name": name,
        "games": 0,
        "wins": 0,
        "fugitive_games": 0,
        "fugitive_wins": 0,
        "marshal_games": 0,
        "marshal_wins": 0,
        # Catches won by a Manhunt — the Marshal's last-second ones.
        "manhunt_catches": 0,
    }


def load_stats():
    stored = stats.read(GAME_ID, blank_stats())
    merged = blank_stats()
    merged.update(stored if isinstance(stored, dict) else {})
    return merged


def leaderboard(record):
    """Most wins first, then the better win rate, so the group's newest
    player isn't stuck at the bottom for having played least."""
    rows = []
    for player in record["players"].values():
        games = player.get("games") or 0
        rows.append({**blank_player(player["name"]), **player,
                     "win_rate": round(100 * player.get("wins", 0) / games) if games else 0})
    rows.sort(key=lambda p: (p["wins"], p["win_rate"]), reverse=True)
    return rows


def worth_recording(game):
    """Dealt and abandoned before anyone moved isn't a game anybody played."""
    return not (game["reason"] == "resigned" and len(game["hideouts"]) <= 1)


def record_if_finished(room):
    """Recorded by the server the moment the game ends, once — there's no
    page to post it, and nothing to trust a page about anyway. A game
    against the computer never is: the records are games between people."""
    game = room.state["game"]
    if game["phase"] != "game_over" or game["recorded"]:
        return
    if room.state.get("computer") or not worth_recording(game):
        game["recorded"] = True
        return
    try:
        stats.update(GAME_ID, lambda stored: add_result(stored, room.state["players"], game))
    except DataUnavailable:
        # stats.json is damaged and refuses writes. The game stays saved
        # and unrecorded, and is tried again on the next look at the table.
        current_app.logger.error("Fugitive game %s not recorded yet: stats unavailable", room.code)
        return
    game["recorded"] = True


def add_result(stored, names, game, at=None):
    """The records with one finished game added: per player and per role."""
    winner = game["winner"]
    manhunt = any(e["kind"] == "manhunt" for e in game["log"])
    record = blank_stats()
    record.update(stored if isinstance(stored, dict) else {})
    record["games_played"] += 1
    for role in ROLES:
        name = names[role]
        key = name.casefold()
        player = {**blank_player(name), **record["players"].get(key, {})}
        # Keyed case-insensitively; the latest spelling wins the display name.
        player["name"] = name
        player["games"] += 1
        player[f"{role}_games"] += 1
        if role == winner:
            player["wins"] += 1
            player[f"{role}_wins"] += 1
            if role == "marshal" and manhunt:
                player["manhunt_catches"] += 1
        record["players"][key] = player
    record["recent"].insert(0, {
        "at": at or datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fugitive": names["fugitive"],
        "marshal": names["marshal"],
        "winner": winner,
        "reason": game["reason"],
        "hideouts": len(game["hideouts"]) - 1,
    })
    del record["recent"][RECENT_GAMES:]
    return record


# --- pages ----------------------------------------------------------------

@bp.route("/")
def landing():
    """Who's playing, and deal. The game itself lives at play_view."""
    return render_template("fugitive/play.html", game=GAME, code=None, max_name=MAX_NAME,
                           computer_name=COMPUTER_NAME)


@bp.route("/play/<code>")
def play_view(code):
    """The table. What it shows depends on the tokens this device holds."""
    room = require_game(code)
    return render_template("fugitive/play.html", game=GAME, code=room.code, max_name=MAX_NAME,
                           computer_name=COMPUTER_NAME)


def back_link():
    """Where a side page's back button goes: the Fugitive page that linked
    here, or the landing page. Same-game paths only."""
    back = request.args.get("back", "")
    if back.startswith("/fugitive/") and "//" not in back and "\\" not in back:
        return back
    return url_for("fugitive.landing")


@bp.route("/rules")
def rules_view():
    return render_template("fugitive/rules.html", game=GAME, back=back_link(), engine=engine)


@bp.route("/stats")
def stats_view():
    record = load_stats()
    return render_template("fugitive/stats.html", game=GAME, back=back_link(),
                           record=record, rows=leaderboard(record))


# --- API ------------------------------------------------------------------

@bp.route("/api/play", methods=["POST"])
def api_create():
    """Deal. Two names, or one name and `computer: {role, level}` for a game
    against the computer, which takes the other seat under its own name."""
    body = request.get_json(silent=True)
    computer, error = parse_computer(body)
    if computer:
        body = {**body, computer["role"]: COMPUTER_NAME}
    players, error = (None, error) if error else parse_players(body)
    if error:
        return jsonify({"error": error}), 400

    def state():
        made = {
            "game": engine.new_game(_rng),
            "players": players,
            "host_token": secrets.token_urlsafe(12),
            "seats": {role: None for role in ROLES},
            "moved_at": time.time(),
        }
        if computer:
            made["computer"] = computer_seat(computer)
            # Taken, by a token nobody is ever given.
            made["seats"][computer["role"]] = secrets.token_urlsafe(12)
        return made

    room = rooms.create(GAME_ID, state)
    with room.lock:
        save_room(room)
        token = room.state["host_token"]
        url = request.host_url.rstrip("/") + url_for("fugitive.play_view", code=room.code)
        return jsonify({**payload(room, token), "host_token": token,
                        "invite_url": url, "qr_svg": qr_svg(url).decode("utf-8")})


@bp.route("/api/play/<code>")
def api_state(code):
    room = require_game(code)
    with room.lock:
        computer_moves(room)
        game = room.state["game"]
        # A finished game that couldn't be recorded gets another go whenever
        # anyone looks at the table.
        if game["phase"] == "game_over" and not game["recorded"]:
            record_if_finished(room)
            if game["recorded"]:
                save_room(room)
        return jsonify(payload(room, request_token()))


@bp.route("/api/play/<code>/invite")
def api_invite(code):
    """The QR into this game, for whichever device is showing it."""
    room = require_game(code)
    url = request.host_url.rstrip("/") + url_for("fugitive.play_view", code=room.code)
    return jsonify({"url": url, "qr_svg": qr_svg(url).decode("utf-8")})


def seat_role(role):
    if role not in ROLES:
        abort(404, description="No such seat.")
    return role


@bp.route("/api/play/<code>/seats/<role>/claim", methods=["POST"])
def api_claim(code, role):
    """Sit down as one of the two players. First come, first served — the
    code is the gate, as everywhere here — and the dealing device can free
    a seat taken by the wrong person."""
    room = require_game(code)
    role = seat_role(role)
    with room.lock:
        if room.state["seats"][role]:
            return jsonify({"error": "Someone's already sitting there.", **payload(room)}), 409
        token = secrets.token_urlsafe(12)
        room.state["seats"][role] = token
        save_room(room)
        return jsonify({**payload(room, token), "seat_token": token})


@bp.route("/api/play/<code>/seats/<role>/release", methods=["POST"])
def api_release(code, role):
    """Free a seat: the dealing device's call only. The old token stops
    working, so the phone that had it drops back to watching."""
    room = require_game(code)
    role = seat_role(role)
    with room.lock:
        if identify(room, request_token())[0] != "host":
            return jsonify({"error": "Only the device that dealt can free a seat."}), 403
        if (room.state.get("computer") or {}).get("role") == role:
            return jsonify({"error": "The computer keeps its seat — start a new game instead."}), 400
        room.state["seats"][role] = None
        save_room(room)
        return jsonify(payload(room, request_token()))


@bp.route("/api/play/<code>/move", methods=["POST"])
def api_move(code):
    """One move, for the seat whose token came with it. `seq` is the state
    the client was looking at; a move against anything older is refused
    (409, with the current game), which stops a double tap counting twice."""
    room = require_game(code)
    move = request.get_json(silent=True)
    if not isinstance(move, dict):
        return jsonify({"error": "expected an object"}), 400

    token = request_token()
    with room.lock:
        kind, role = identify(room, token)
        if kind != "seat":
            return jsonify({"error": "Only the two players can move — sit down first."}), 403
        game = room.state["game"]
        if move.get("seq") != game["seq"]:
            return jsonify({"error": "The game had moved on — this is the latest.",
                            **payload(room, token)}), 409
        # Applied to a copy, so a refused move can't leave the room half-changed.
        trial = copy.deepcopy(game)
        try:
            engine.apply(trial, role, move)
        except engine.IllegalMove as err:
            return jsonify({"error": str(err), **payload(room, token)}), 400
        room.state["game"] = trial
        room.state["moved_at"] = time.time()
        record_if_finished(room)
        save_room(room)
        return jsonify(payload(room, token))


@bp.route("/api/play/<code>/rematch", methods=["POST"])
def api_rematch(code):
    """The same two, roles swapped — that's how Fugitive is played, and a
    best-of series wants it anyway. Each player's seat token follows them
    to their new role, so phones carry on without anyone re-joining, and
    the finished room points at the new one. Asking twice gets the same
    rematch."""
    room = require_game(code)
    with room.lock:
        if identify(room, request_token())[0] != "host":
            return jsonify({"error": "Only the device that dealt can start a rematch."}), 403
        if room.state["game"]["phase"] != "game_over":
            return jsonify({"error": "This game isn't over yet."}), 400
        if not room.state.get("next"):
            old = room.state
            carried = {
                "players": {"fugitive": old["players"]["marshal"], "marshal": old["players"]["fugitive"]},
                "seats": {"fugitive": old["seats"]["marshal"], "marshal": old["seats"]["fugitive"]},
                "host_token": old["host_token"],
            }
            computer = old.get("computer")

            def state():
                made = {"game": engine.new_game(_rng), **copy.deepcopy(carried), "moved_at": time.time()}
                if computer:
                    # The computer swaps roles too, with a fresh seed.
                    made["computer"] = computer_seat({"role": engine._other(computer["role"]),
                                                      "level": computer["level"]})
                return made

            fresh = rooms.create(GAME_ID, state)
            with fresh.lock:
                save_room(fresh)
            room.state["next"] = fresh.code
            save_room(room)
        return jsonify({"code": room.state["next"], "host_token": room.state["host_token"]})


@bp.route("/api/stats")
def api_stats():
    """The record, plus the leaderboard in the order the records page shows it."""
    record = load_stats()
    record.pop("offline_ids", None)
    return jsonify({**record, "leaderboard": leaderboard(record)})


# --- games played offline -------------------------------------------------
# The iOS app plays Fugitive with no signal (on a plane), with the rules in
# Swift — a port of engine.py pinned to it by tests/test_fugitive_offline.py.
# A finished game comes home later as its shuffled decks and its moves, and
# is replayed here through engine.py: only a game the real rules accept, to
# the end, is recorded. The app is trusted no further than that — the same
# trust as everywhere else on this public router.

OFFLINE_ID = re.compile(r"^[A-Za-z0-9-]{8,64}$")
MAX_OFFLINE_MOVES = 1000
# Ids of offline games already recorded, newest last, so a retried upload
# isn't counted twice. A game is uploaded within days, not months.
OFFLINE_IDS_KEPT = 500


def replay_offline(body):
    """(players, game, played_at) for an uploaded offline game, or raises
    ValueError with a sentence saying what's wrong with it."""
    if not isinstance(body, dict):
        raise ValueError("expected an object")
    if not isinstance(body.get("id"), str) or not OFFLINE_ID.match(body["id"]):
        raise ValueError("the game needs an id")
    players, error = parse_players(body.get("players"))
    if error:
        raise ValueError(error)
    decks = body.get("decks")
    if (not isinstance(decks, list) or len(decks) != len(engine.DECKS)
            or not all(isinstance(d, list) and all(engine._is_int(c) for c in d) for d in decks)
            or any(sorted(d) != list(range(lo, hi + 1)) for d, (lo, hi) in zip(decks, engine.DECKS))):
        raise ValueError("those aren't Fugitive's three decks")
    moves = body.get("moves")
    if not isinstance(moves, list) or len(moves) > MAX_OFFLINE_MOVES:
        raise ValueError("the moves need to be a list")

    game = engine.new_game(None, decks=decks)
    for number, step in enumerate(moves, start=1):
        if not isinstance(step, dict) or step.get("role") not in ROLES or not isinstance(step.get("move"), dict):
            raise ValueError(f"move {number} isn't a move")
        try:
            engine.apply(game, step["role"], dict(step["move"]))
        except IllegalMove as refusal:
            raise ValueError(f"move {number} breaks the rules: {refusal}") from None
    if game["phase"] != "game_over":
        raise ValueError("that game isn't finished")
    return players, game, played_at(body.get("played_at"))


def played_at(value):
    """When the game ended, by the phone's clock — kept only if it reads as a
    time and isn't in the future. Otherwise now, when it reached here."""
    now = datetime.now(timezone.utc)
    try:
        when = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return now.isoformat(timespec="seconds")
    if when.tzinfo is None or when > now:
        return now.isoformat(timespec="seconds")
    return when.astimezone(timezone.utc).isoformat(timespec="seconds")


@bp.route("/api/offline", methods=["POST"])
def api_offline():
    """Record a game the app played offline. Answers {recorded}: false for a
    game already recorded (a retried upload) or one nobody played."""
    body = request.get_json(silent=True)
    try:
        players, game, at = replay_offline(body)
    except ValueError as problem:
        return jsonify({"error": str(problem)}), 400
    if not worth_recording(game):
        return jsonify({"recorded": False})
    outcome = {}

    def apply(stored):
        record = stored if isinstance(stored, dict) else {}
        seen = list(record.get("offline_ids") or [])
        if body["id"] in seen:
            outcome["recorded"] = False
            return record
        record = add_result(record, players, game, at)
        record["offline_ids"] = (seen + [body["id"]])[-OFFLINE_IDS_KEPT:]
        outcome["recorded"] = True
        return record

    stats.update(GAME_ID, apply)
    return jsonify(outcome)


GAME = GameSpec(
    id=GAME_ID,
    name="Fugitive",
    tagline="One runs, one hunts. Lay a trail of hideouts to 42 — or find them all.",
    blueprint=bp,
    accent="#5fb3c9",
    # Set up from the landing page rather than straight from the hub: the
    # two names come first. A code typed at /join opens the table.
    host_endpoint=None,
    player_endpoint="fugitive.play_view",
    hub_action="Play",
)
