"""Persisted history, keyed by game.

One file, one bucket per game, so no two games can collide. Games don't
share a shape: ito has no numeric scoring in the base rules — a round is
won if the cards come out in ascending order — so `load`/`record`/`reset`
below deal in outcomes and streaks. Flip 7 keeps per-player scores, which
is nothing like that, so it uses the generic `read`/`update` pair and
owns its own shape.
"""

import copy
import threading

from core import jsonfile
from core.paths import STATS_PATH

_lock = threading.Lock()

DEFAULT_GAME_STATS = {
    "rounds_played": 0,
    "wins": 0,
    "losses": 0,
    "current_streak": 0,
    "best_streak": 0,
    "category_counts": {},
}


class StatsUnavailable(jsonfile.DataUnavailable):
    """stats.json is there but can't be parsed, so it must not be written.

    This used to read as `{}`, and the next result saved "empty plus one" over
    everybody's history. Now a write refuses instead, and the file (and its
    .bak) are left for someone to look at.
    """


def _parse(raw):
    if not isinstance(raw, dict):
        raise jsonfile.Unreadable("stats.json is not an object")
    # Pre-hub stats.json was a single flat ito record with no game key.
    if "rounds_played" in raw:
        return {"ito": raw}
    return raw


def _read_all():
    """Everything on disk, for a read-modify-write. Raises if it's corrupt."""
    try:
        return _parse(jsonfile.read(STATS_PATH))
    except FileNotFoundError:
        return {}
    except jsonfile.Unreadable as exc:
        raise StatsUnavailable(
            "The stats file is damaged, so nothing new can be saved to it. "
            "Restore data/stats.json from data/stats.json.bak."
        ) from exc


def _read_for_display():
    """For pages that only show stats: a damaged file falls back to the last
    good copy, then to nothing, rather than taking the page down with it."""
    try:
        return _read_all()
    except StatsUnavailable:
        try:
            return _parse(jsonfile.read(jsonfile.backup_path(STATS_PATH)))
        except (FileNotFoundError, jsonfile.Unreadable):
            return {}


def _write_all(data):
    jsonfile.write(STATS_PATH, data)


def read(game_id, default=None):
    """This game's raw bucket, whatever shape it keeps. For games that don't
    fit the win/loss shape below."""
    with _lock:
        stored = _read_for_display().get(game_id)
    return copy.deepcopy(stored) if stored is not None else copy.deepcopy(default)


def update(game_id, mutate):
    """Read-modify-write this game's bucket under the file lock.

    `mutate` is handed the stored record (or None on the first write) and
    returns the one to save. Doing it in one locked pass matters: two people
    finishing a game at the same moment would otherwise each write a record
    built from the state before the other's.
    """
    with _lock:
        data = _read_all()
        updated = mutate(copy.deepcopy(data.get(game_id)))
        data[game_id] = updated
        _write_all(data)
        return copy.deepcopy(updated)


def load(game_id):
    """ito's win/loss shape, with any keys added since backfilled."""
    with _lock:
        stats = _read_for_display().get(game_id, {})
    merged = {k: (dict(v) if isinstance(v, dict) else v) for k, v in DEFAULT_GAME_STATS.items()}
    merged.update(stats)
    # Backfill keys added in later versions
    for key, val in DEFAULT_GAME_STATS.items():
        merged.setdefault(key, val)
    return merged


def record(game_id, outcome, category=None):
    """Log one round. Returns the game's updated stats."""
    if outcome not in ("win", "lose"):
        raise ValueError("outcome must be 'win' or 'lose'")

    with _lock:
        data = _read_all()
        stats = data.get(game_id) or {k: (dict(v) if isinstance(v, dict) else v)
                                      for k, v in DEFAULT_GAME_STATS.items()}
        for key, val in DEFAULT_GAME_STATS.items():
            stats.setdefault(key, val)

        stats["rounds_played"] += 1
        if outcome == "win":
            stats["wins"] += 1
            stats["current_streak"] += 1
            stats["best_streak"] = max(stats["best_streak"], stats["current_streak"])
        else:
            stats["losses"] += 1
            stats["current_streak"] = 0

        key = category or "mixed"
        stats["category_counts"][key] = stats["category_counts"].get(key, 0) + 1

        data[game_id] = stats
        _write_all(data)
        return stats


def reset(game_id):
    with _lock:
        data = _read_all()
        data[game_id] = {k: (dict(v) if isinstance(v, dict) else v)
                         for k, v in DEFAULT_GAME_STATS.items()}
        _write_all(data)
        return data[game_id]
