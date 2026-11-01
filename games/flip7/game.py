"""Flip 7 — the scorekeeper.

Same narrow scope as ito: this replaces one physical component and nothing
else. Flip 7 is played with real cards being flipped in front of you; what
it doesn't come with is a good way to add up a round of numbers, modifiers
and a x2 across five players without an argument. So this is pencil and
paper, not a digital deck — no dealing, no hit/stay, no bust detection.

The scorekeeper itself is one device on the table that everybody leans
over, the way the paper pad was: only that device enters scores, because
five people able to edit one scoreboard is a worse pad of paper, not a
better one. Its state lives in the browser's localStorage, so a locked
phone or a stray refresh mid-game doesn't wipe the night.

What a room adds on top of that is *watching*, nothing else. The
scorekeeper can push a snapshot of the banked scoreboard into a room and
read the code out; anyone who joins it gets the standings on their own
phone, read-only. The board still lives on the one device — the room is a
copy of it, so losing the room to a restart costs a spectator view and
never the game.

The one thing that does reach the server is a finished game. Who won on a
Tuesday in March is exactly what a group wants to still have in June, and
that can't live in one phone's browser storage — so a completed game is
posted once, and the leaderboard is global, like ito's stats.

Play mode is the other way round: the app is the deck (engine.py), so the
game has to live on the server, in a room. That room is saved to disk after
every move — it's the game itself now, not a copy of one, and a deploy
mid-evening mustn't end it.
"""

import copy
import json
import os
import random
import secrets
import time
from datetime import datetime, timezone

from flask import Blueprint, abort, current_app, jsonify, redirect, render_template, request, url_for

from core import stats
from core.jsonfile import DataUnavailable
from core.paths import game_data_dir
from core.qr import svg as qr_svg
from core.rooms import IDLE_TIMEOUT, require_room, rooms
from games.flip7 import engine
from games.registry import GameSpec

GAME_ID = "flip7"

bp = Blueprint(
    GAME_ID, __name__, url_prefix="/flip7", template_folder="templates"
)

# Reaching this ends the game. Printed on the box; kept in the engine so the
# scorekeeper, the rules summary and a played game can't disagree.
TARGET_SCORE = engine.TARGET_SCORE

# Sanity bounds for a posted game. This endpoint is unauthenticated, like
# ito's topic editing, so the point isn't to stop someone determined — it's
# to stop a bug or a bored guest turning the leaderboard into a wall of junk.
MAX_PLAYERS = 12
MAX_NAME = 20
MAX_ROUNDS = 60
MAX_ROUND_SCORE = 500
RECENT_GAMES = 10


def new_room_state():
    """A spectator room holds a copy of the board and nothing else.

    `host_token` is handed out once, when the room is made, and kept by the
    scorekeeper. Codes get read out across a table, so anyone in the room
    knows one; without the token a spectator who poked at the API could
    overwrite the scoreboard everybody else is reading.
    """
    return {
        "board": None,      # None until the scorekeeper pushes its first snapshot
        "host_token": secrets.token_urlsafe(12),
    }


def public_room_state(room):
    """What a spectator is allowed to see: the board, never the token."""
    return {"code": room.code, "board": room.state.get("board")}


# --- play rooms ----------------------------------------------------------

# Shuffles have to be unguessable: the deck order is the one secret in a
# face-up game.
_rng = random.SystemRandom()


def play_dir():
    """Looked up at call time, so tests can point DATA_DIR somewhere else."""
    path = game_data_dir(GAME_ID) / "play"
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_play_room(room):
    """Write the room after every move, via a temp file so a crash mid-write
    leaves the last good copy rather than half of a new one. Rooms nobody
    has touched for as long as the in-memory sweep allows are pruned here
    too, so the directory never grows."""
    folder = play_dir()
    target = folder / f"{room.code}.json"
    temp = target.with_suffix(".tmp")
    temp.write_text(json.dumps({"game_id": GAME_ID, "state": room.state}), encoding="utf-8")
    os.replace(temp, target)

    cutoff = time.time() - IDLE_TIMEOUT
    for old in folder.glob("*.json"):
        if old.stat().st_mtime < cutoff:
            old.unlink(missing_ok=True)


def load_play_room(code):
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


rooms.add_loader(load_play_room)


def is_play_room(room):
    return room.state.get("mode") == "play"


def require_play_room(code):
    room = require_room(code, GAME_ID)
    if not is_play_room(room):
        abort(404, description="That code is for a scoreboard, not a game.")
    return room


def parse_names(payload):
    """Validate the seating list for a new game. Returns (names, error)."""
    raw = payload.get("players") if isinstance(payload, dict) else None
    if not isinstance(raw, list):
        return None, "players must be a list"
    if not engine.MIN_PLAYERS <= len(raw) <= engine.MAX_PLAYERS:
        return None, f"{engine.MIN_PLAYERS}–{engine.MAX_PLAYERS} players"
    names = []
    for name in raw:
        name = clean_name(name)
        if not name:
            return None, "every player needs a name"
        names.append(name)
    # The records key players case-insensitively, so the table has to too.
    if len({n.casefold() for n in names}) != len(names):
        return None, "two players can't have the same name"
    return names, None


def record_if_finished(game):
    """A game played here is recorded by the server the moment it ends —
    there's no page to post it, and nothing to trust a page about anyway."""
    if game["phase"] != "game_over" or game["recorded"]:
        return
    players, error = parse_game({
        "players": [{"name": p["name"], "rounds": p["rounds"]} for p in game["players"]]
    })
    if error:
        # Can't happen with an engine-run game short of a 60-round marathon;
        # marked anyway so it isn't retried on every poll.
        current_app.logger.warning("Flip 7 game not recorded: %s", error)
    else:
        try:
            record_game(players)
        except DataUnavailable:
            # stats.json is damaged and refuses writes. The game itself is
            # fine and stays saved; it's left unrecorded and tried again on
            # the next look at the table, once the file has been restored.
            current_app.logger.error("Flip 7 game %s not recorded yet: stats unavailable",
                                     ", ".join(p["name"] for p in players))
            return
    game["recorded"] = True


def seats_of(room):
    """One slot per player: None, or the token of the phone sitting there.
    Games saved before seats existed get them on first use."""
    return room.state.setdefault("seats", [None] * len(room.state["game"]["players"]))


def identify(room, token):
    """Who is asking: ("host", None) for the device that dealt, ("seat", i)
    for a phone sitting at seat i, or (None, None) for anyone else.

    Compared as bytes, like api_push_board: compare_digest raises on a
    non-ASCII str, and a header is whatever the client sent."""
    if isinstance(token, str):
        token = token.encode("utf-8", "surrogateescape")
    if not token:
        return None, None
    if secrets.compare_digest(token, room.state["host_token"].encode()):
        return "host", None
    for i, seat_token in enumerate(seats_of(room)):
        if seat_token and secrets.compare_digest(token, seat_token.encode()):
            return "seat", i
    return None, None


def play_payload(room, token=None):
    """The table, plus who's sitting where — whether a seat is taken, never
    by which token — and, if the request carried a token, who it belongs to.
    That's how a phone finds out its seat was freed from under it."""
    role, seat = identify(room, token)
    return {
        "code": room.code,
        "game": engine.public_view(room.state["game"]),
        "seats": [{"taken": bool(t)} for t in seats_of(room)],
        "you": {"role": role, "seat": seat},
        "next": room.state.get("next"),
    }


def request_token():
    return (request.headers.get("X-Flip7-Token") or "").encode("utf-8", "surrogateescape")


def clean_name(value):
    """A player name as it's stored: trimmed, then cut to MAX_NAME. Anything
    that isn't a string is no name at all (a 400, not a 500 on `.strip()`).
    The scorekeeper applies the same rule when a name is typed in."""
    return value.strip()[:MAX_NAME] if isinstance(value, str) else ""


def parse_board(payload):
    """Validate a pushed snapshot. Returns (board, error).

    Same bounds as a recorded game and for the same reason: this endpoint is
    only as private as a four-letter code, so the point is to stop a bug or a
    bored guest turning a room into a wall of junk.
    """
    if not isinstance(payload, dict):
        return None, "expected an object"

    raw_players = payload.get("players")
    if not isinstance(raw_players, list):
        return None, "players must be a list"
    if len(raw_players) > MAX_PLAYERS:
        return None, f"at most {MAX_PLAYERS} players"

    players = []
    for entry in raw_players:
        if not isinstance(entry, dict):
            return None, "each player must be an object"
        name = clean_name(entry.get("name"))
        if not name:
            return None, "every player needs a name"

        scores = entry.get("scores")
        if not isinstance(scores, list) or len(scores) > MAX_ROUNDS:
            return None, f"scores must be a list of at most {MAX_ROUNDS}"
        clean = []
        for score in scores:
            if not isinstance(score, int) or isinstance(score, bool):
                return None, "round scores must be whole numbers"
            if not 0 <= score <= MAX_ROUND_SCORE:
                return None, f"round scores must be between 0 and {MAX_ROUND_SCORE}"
            clean.append(score)

        players.append({"name": name, "scores": clean, "total": sum(clean)})

    return {"players": players, "target": TARGET_SCORE}, None


def blank_stats():
    return {
        "games_played": 0,
        "players": {},
        "best_round": {"score": 0, "player": None},
        "recent": [],
    }


def blank_player(name):
    return {
        "name": name,
        "games": 0,
        "wins": 0,
        "points": 0,
        "rounds": 0,
        "best_game": 0,
        "best_round": 0,
        "flip7s": 0,
        "busts": 0,
    }


def load_stats():
    """Stored record, with anything added in a later version backfilled."""
    stored = stats.read(GAME_ID, blank_stats())
    merged = blank_stats()
    merged.update(stored if isinstance(stored, dict) else {})
    for key, value in blank_stats().items():
        merged.setdefault(key, value)
    return merged


def leaderboard(record):
    """Players sorted for display: most wins first, then by average round.

    Average rather than total points, so someone who has played every game
    night since January doesn't permanently own the top of the table.
    """
    rows = []
    for player in record["players"].values():
        rounds = player.get("rounds") or 0
        rows.append({
            **player,
            "average": round(player.get("points", 0) / rounds, 1) if rounds else 0,
        })
    rows.sort(key=lambda p: (p["wins"], p["average"], p["best_game"]), reverse=True)
    return rows


def parse_game(payload):
    """Validate a posted game and reduce it to what gets stored.

    Returns (players, error). Each player is (key, name, total, rounds,
    flip7s, busts, best_round).
    """
    if not isinstance(payload, dict):
        return None, "expected an object"

    raw_players = payload.get("players")
    if not isinstance(raw_players, list) or not raw_players:
        return None, "a game needs at least one player"
    if len(raw_players) > MAX_PLAYERS:
        return None, f"at most {MAX_PLAYERS} players"

    parsed = []
    for entry in raw_players:
        if not isinstance(entry, dict):
            return None, "each player must be an object"
        name = clean_name(entry.get("name"))
        if not name:
            return None, "every player needs a name"

        rounds = entry.get("rounds")
        if not isinstance(rounds, list) or len(rounds) > MAX_ROUNDS:
            return None, f"rounds must be a list of at most {MAX_ROUNDS}"

        total = flip7s = busts = best_round = 0
        for r in rounds:
            if not isinstance(r, dict):
                return None, "each round must be an object"
            score = r.get("score")
            if not isinstance(score, int) or isinstance(score, bool):
                return None, "round scores must be whole numbers"
            if not 0 <= score <= MAX_ROUND_SCORE:
                return None, f"round scores must be between 0 and {MAX_ROUND_SCORE}"
            total += score
            best_round = max(best_round, score)
            if r.get("flip7"):
                flip7s += 1
            if r.get("bust"):
                busts += 1

        parsed.append({
            "key": name.casefold(),
            "name": name,
            "total": total,
            "rounds": len(rounds),
            "flip7s": flip7s,
            "busts": busts,
            "best_round": best_round,
        })

    # Only finished games are recorded. An abandoned one has no winner, and
    # counting it would quietly punish whoever was ahead when it stopped.
    if not any(p["total"] >= TARGET_SCORE for p in parsed):
        return None, f"no one has reached {TARGET_SCORE} yet"

    keys = [p["key"] for p in parsed]
    if len(set(keys)) != len(keys):
        return None, "two players can't have the same name"

    return parsed, None


def record_game(players):
    """Fold one finished game into the stored record."""
    top = max(p["total"] for p in players)

    def apply(stored):
        record = blank_stats()
        record.update(stored if isinstance(stored, dict) else {})
        for key, value in blank_stats().items():
            record.setdefault(key, value)

        record["games_played"] += 1
        for p in players:
            # Keyed case-insensitively, but the latest spelling wins the
            # display name — names are typed fresh at the table every time.
            player = record["players"].get(p["key"]) or blank_player(p["name"])
            player["name"] = p["name"]
            player["games"] += 1
            player["points"] += p["total"]
            player["rounds"] += p["rounds"]
            player["flip7s"] += p["flip7s"]
            player["busts"] += p["busts"]
            player["best_game"] = max(player["best_game"], p["total"])
            player["best_round"] = max(player["best_round"], p["best_round"])
            # A draw at the top is vanishingly rare but not impossible, and
            # nobody at the table would call it half a win each.
            if p["total"] == top:
                player["wins"] += 1
            record["players"][p["key"]] = player

            if p["best_round"] > record["best_round"]["score"]:
                record["best_round"] = {"score": p["best_round"], "player": p["name"]}

        winners = [p["name"] for p in players if p["total"] == top]
        record["recent"].insert(0, {
            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "winner": ", ".join(winners),
            "score": top,
            "players": len(players),
        })
        del record["recent"][RECENT_GAMES:]
        return record

    return stats.update(GAME_ID, apply)


@bp.route("/")
def landing():
    return render_template(
        "flip7/scorekeeper.html", game=GAME, target=TARGET_SCORE,
        max_players=MAX_PLAYERS, max_name=MAX_NAME,
    )


@bp.route("/rooms", methods=["POST"])
def create_room():
    """Open a spectator room for the scorekeeper on this device."""
    room = rooms.create(GAME_ID, new_room_state)
    watch_url = request.host_url.rstrip("/") + url_for("flip7.watch_view", code=room.code)
    return jsonify({
        "code": room.code,
        "host_token": room.state["host_token"],
        "watch_url": watch_url,
        "qr_svg": qr_svg(watch_url).decode("utf-8"),
    })


@bp.route("/watch/<code>")
def watch_view(code):
    """The read-only side of a game: standings on your own phone."""
    room = require_room(code, GAME_ID)
    # /join sends every Flip 7 code here. A played game has its own table,
    # which is read-only on any device that didn't deal it.
    if is_play_room(room):
        return redirect(url_for("flip7.play_view", code=room.code))
    return render_template(
        "flip7/watch.html", game=GAME, target=TARGET_SCORE, code=room.code
    )


@bp.route("/play")
def play_setup():
    """Seat the players and deal. The game itself lives at play_view."""
    return render_template("flip7/play.html", game=GAME, target=TARGET_SCORE, code=None)


@bp.route("/play/<code>")
def play_view(code):
    """The table. Controls only show on the device holding the room's token."""
    room = require_play_room(code)
    return render_template("flip7/play.html", game=GAME, target=TARGET_SCORE, code=room.code)


def back_link():
    """Where a side page's back button goes: the page that linked to it, if
    that was a Flip 7 page, or the scorekeeper. An installed app has no
    browser back button, so leaving the table for the rules must not strand
    you at the scorekeeper. Same-game paths only, so this can't be pointed
    off-site."""
    back = request.args.get("back", "")
    if back.startswith("/flip7/") and "//" not in back and "\\" not in back:
        return back
    return url_for("flip7.landing")


@bp.route("/rules")
def rules_view():
    return render_template("flip7/rules.html", game=GAME, target=TARGET_SCORE, back=back_link())


@bp.route("/stats")
def stats_view():
    record = load_stats()
    return render_template(
        "flip7/stats.html",
        game=GAME,
        target=TARGET_SCORE,
        back=back_link(),
        record=record,
        rows=leaderboard(record),
    )


# --- room API ------------------------------------------------------------

@bp.route("/api/<code>/state")
def api_room_state(code):
    room = require_room(code, GAME_ID)
    with room.lock:
        return jsonify(public_room_state(room))


@bp.route("/api/<code>/board", methods=["POST"])
def api_push_board(code):
    """Replace this room's copy of the board. Scorekeeper only."""
    room = require_room(code, GAME_ID)
    if is_play_room(room):
        return jsonify({"error": "this room is a game, not a scoreboard"}), 409
    payload = request.get_json(silent=True) or {}

    # compare_digest so a wrong token can't be narrowed down by timing. It's
    # a low-stakes secret, but it costs one import.
    # Compared as bytes: compare_digest raises on a non-ASCII str, and a header
    # is whatever the client sent.
    token = (request.headers.get("X-Flip7-Token") or "").encode("utf-8", "surrogateescape")
    if not secrets.compare_digest(token, room.state["host_token"].encode()):
        return jsonify({"error": "not the scorekeeper for this room"}), 403

    board, error = parse_board(payload)
    if error:
        return jsonify({"error": error}), 400

    with room.lock:
        room.state["board"] = board
        return jsonify(public_room_state(room))


# --- play API ------------------------------------------------------------
#
# Shaped for any client, not just play.html: the shared device, a phone per
# player, a native app later. Reads are open, like the spectator board.
#
# Two kinds of token. The device that dealt holds the host token and can
# move for anyone — that's what makes one shared iPad work, and it's also
# the fallback when a phone goes to sleep on its owner's turn. A phone that
# takes a seat gets a seat token, which only moves for that seat.

@bp.route("/api/play", methods=["POST"])
def api_play_create():
    names, error = parse_names(request.get_json(silent=True))
    if error:
        return jsonify({"error": error}), 400

    def state():
        return {
            "mode": "play",
            "game": engine.new_game(names, _rng),
            "host_token": secrets.token_urlsafe(12),
        }

    room = rooms.create(GAME_ID, state)
    with room.lock:
        save_play_room(room)
        token = room.state["host_token"]
        return jsonify({**play_payload(room, token), "host_token": token})


@bp.route("/api/play/<code>")
def api_play_state(code):
    room = require_play_room(code)
    with room.lock:
        game = room.state["game"]
        # A finished game that couldn't be recorded (stats.json was damaged)
        # gets another go whenever anyone looks at the table.
        if game["phase"] == "game_over" and not game["recorded"]:
            record_if_finished(game)
            if game["recorded"]:
                save_play_room(room)
        return jsonify(play_payload(room, request_token()))


@bp.route("/api/play/<code>/seats/<int:seat>/claim", methods=["POST"])
def api_play_claim(code, seat):
    """Sit down at a seat from your own phone. First come, first served —
    knowing the code is the gate, the same as everywhere else here — and
    the dealer's device can free a seat taken by the wrong person."""
    room = require_play_room(code)
    with room.lock:
        seats = seats_of(room)
        if not 0 <= seat < len(seats):
            return jsonify({"error": "No such seat."}), 404
        if seats[seat]:
            return jsonify({"error": "Someone's already sitting there.",
                            **play_payload(room)}), 409
        token = secrets.token_urlsafe(12)
        seats[seat] = token
        save_play_room(room)
        return jsonify({**play_payload(room, token), "seat_token": token})


@bp.route("/api/play/<code>/seats/<int:seat>/release", methods=["POST"])
def api_play_release(code, seat):
    """Free a seat: the dealer's call only. The old token stops working, so
    the phone that had it drops back to watching."""
    room = require_play_room(code)
    with room.lock:
        if identify(room, request_token())[0] != "host":
            return jsonify({"error": "Only the dealer's device can free a seat."}), 403
        seats = seats_of(room)
        if not 0 <= seat < len(seats):
            return jsonify({"error": "No such seat."}), 404
        seats[seat] = None
        save_play_room(room)
        return jsonify(play_payload(room, request_token()))


@bp.route("/api/play/<code>/rematch", methods=["POST"])
def api_play_rematch(code):
    """Same players, new game. Everyone keeps their seat — the seat tokens
    and the dealer's token carry over — and the finished room points at the
    new one, so phones follow without anyone typing a code. Asking twice
    gets the same rematch, not a second one."""
    room = require_play_room(code)
    with room.lock:
        if identify(room, request_token())[0] != "host":
            return jsonify({"error": "Only the dealer's device can start a rematch."}), 403
        if room.state["game"]["phase"] != "game_over":
            return jsonify({"error": "This game isn't over yet."}), 400
        if not room.state.get("next"):
            names = [p["name"] for p in room.state["game"]["players"]]
            carried = {"host_token": room.state["host_token"], "seats": list(seats_of(room))}

            def state():
                return {"mode": "play", "game": engine.new_game(names, _rng), **carried}

            fresh = rooms.create(GAME_ID, state)
            with fresh.lock:
                save_play_room(fresh)
            room.state["next"] = fresh.code
            save_play_room(room)
        return jsonify({"code": room.state["next"], "host_token": room.state["host_token"]})


@bp.route("/api/play/<code>/move", methods=["POST"])
def api_play_move(code):
    """One move. `seq` is the state the client was looking at: a move made
    against anything older is refused (409, with the current table), which
    is what stops a double tap on Hit from drawing two cards."""
    room = require_play_room(code)
    move = request.get_json(silent=True)
    if not isinstance(move, dict):
        return jsonify({"error": "expected an object"}), 400

    token = request_token()
    with room.lock:
        role, seat = identify(room, token)
        if role is None:
            return jsonify({"error": "This device isn't playing in this game."}), 403
        # A phone moves for its own seat. Dealing the next round is the
        # table's business, so anyone sitting at it can.
        if role == "seat" and move.get("type") != "next_round" and move.get("player") != seat:
            return jsonify({"error": "That's not your seat.", **play_payload(room, token)}), 403

        game = room.state["game"]
        if move.get("seq") != game["seq"]:
            return jsonify({"error": "The table had moved on — this is the latest.",
                            **play_payload(room, token)}), 409
        # Applied to a copy, so a move the engine refuses can't leave the
        # room half-changed.
        trial = copy.deepcopy(game)
        try:
            engine.apply(trial, move, _rng)
        except engine.IllegalMove as err:
            return jsonify({"error": str(err), **play_payload(room, token)}), 400
        room.state["game"] = trial
        record_if_finished(trial)
        save_play_room(room)
        return jsonify(play_payload(room, token))


# --- stats API -----------------------------------------------------------

@bp.route("/api/stats")
def api_stats():
    """The record, plus the leaderboard in the order the records page shows
    it — so a client (the iOS app) doesn't re-implement the ranking."""
    record = load_stats()
    return jsonify({**record, "leaderboard": leaderboard(record)})


@bp.route("/api/stats/games", methods=["POST"])
def api_record_game():
    """Log one finished game. Posted by the scorekeeper the moment somebody
    crosses the line, once — the page remembers that it has."""
    players, error = parse_game(request.get_json(silent=True))
    if error:
        return jsonify({"error": error}), 400
    return jsonify(record_game(players))


@bp.route("/api/stats/reset", methods=["POST"])
def api_stats_reset():
    return jsonify(stats.update(GAME_ID, lambda _stored: blank_stats()))


GAME = GameSpec(
    id=GAME_ID,
    name="Flip 7",
    tagline="Push your luck, bank your cards — first to 200 takes it.",
    blueprint=bp,
    accent="#d9a94e",
    new_room_state=new_room_state,
    # No host endpoint on purpose: you don't start a Flip 7 room from the hub,
    # you open the scorekeeper and share it from there if you want to. The
    # player endpoint is what makes a code joinable at /join.
    host_endpoint=None,
    player_endpoint="flip7.watch_view",
    hub_action="Play or keep score",
    native_app=True,
)
