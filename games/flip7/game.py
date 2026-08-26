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

The one thing that does reach the server is a finished game. Who won on a
Tuesday in March is exactly what a group wants to still have in June, and
that can't live in one phone's browser storage — so a completed game is
posted once, and the leaderboard is global, like ito's stats.
"""

from datetime import datetime, timezone

from flask import Blueprint, jsonify, render_template, request

from core import stats
from games.registry import GameSpec

GAME_ID = "flip7"

bp = Blueprint(
    GAME_ID, __name__, url_prefix="/flip7", template_folder="templates"
)

# Reaching this ends the game. Printed on the box; kept here so the page and
# the rules summary can't disagree.
TARGET_SCORE = 200

# Sanity bounds for a posted game. This endpoint is unauthenticated, like
# ito's topic editing, so the point isn't to stop someone determined — it's
# to stop a bug or a bored guest turning the leaderboard into a wall of junk.
MAX_PLAYERS = 12
MAX_NAME = 20
MAX_ROUNDS = 60
MAX_ROUND_SCORE = 500
RECENT_GAMES = 10


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
        name = (entry.get("name") or "").strip()[:MAX_NAME]
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
    return render_template("flip7/scorekeeper.html", game=GAME, target=TARGET_SCORE)


@bp.route("/rules")
def rules_view():
    return render_template("flip7/rules.html", game=GAME, target=TARGET_SCORE)


@bp.route("/stats")
def stats_view():
    record = load_stats()
    return render_template(
        "flip7/stats.html",
        game=GAME,
        target=TARGET_SCORE,
        record=record,
        rows=leaderboard(record),
    )


# --- stats API -----------------------------------------------------------

@bp.route("/api/stats")
def api_stats():
    return jsonify(load_stats())


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
    # No rooms: the scorekeeper is one shared device, not a host and players.
    new_room_state=None,
    host_endpoint=None,
    player_endpoint=None,
)
