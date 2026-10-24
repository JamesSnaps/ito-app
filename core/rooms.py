"""Game rooms, keyed by a short code people can read out loud.

Rooms live in memory only. That's deliberate and matches how the app was
already scoped: a room is one sitting of one game, and losing it on a
restart is no worse than losing the current topic was before. Stats,
which people do care about across sessions, are on disk instead.

The one exception is opt-in per game: a game that can't afford to lose a
room saves it itself and registers a loader (`add_loader`), and a code
that isn't in memory is looked for there before it's called unknown.
"""

import random
import re
import string
import threading
import time

# No I/O/0/1 — these get read aloud across a table and mis-heard otherwise.
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 4
CODE_PATTERN = re.compile(f"[{CODE_ALPHABET}]{{{CODE_LENGTH}}}")

# A room nobody has touched for this long is assumed abandoned. Long enough
# to survive a break mid-game night, short enough that the dict never grows.
IDLE_TIMEOUT = 6 * 60 * 60


class Room:
    def __init__(self, code, game_id, state):
        self.code = code
        self.game_id = game_id
        self.state = state
        self.created_at = time.time()
        self.last_seen = self.created_at
        self.lock = threading.Lock()

    def touch(self):
        self.last_seen = time.time()


class RoomManager:
    """Holds every live room across every game."""

    def __init__(self, idle_timeout=IDLE_TIMEOUT):
        self._rooms = {}
        self._lock = threading.Lock()
        self._idle_timeout = idle_timeout
        self._loaders = []

    def add_loader(self, loader):
        """Let a game bring its rooms back after a restart.

        `loader(code)` returns (game_id, state) for a room it saved, or None.
        Rooms are in memory by design, and most of them can stay that way —
        but a Flip 7 game played on the app's own deck *is* its room, and a
        deploy mid-game shouldn't end it. Asking the loaders on a miss means
        /join and require_room find a saved room without knowing it was.
        """
        self._loaders.append(loader)

    def create(self, game_id, state_factory):
        with self._lock:
            self._sweep()
            code = self._unique_code()
            room = Room(code, game_id, state_factory())
            self._rooms[code] = room
            return room

    def get(self, code, game_id=None):
        """Return the room, or None if it's unknown, expired, or the wrong game."""
        if not code:
            return None
        code = code.strip().upper()
        with self._lock:
            self._sweep()
            room = self._rooms.get(code) or self._load(code)
            if room is None:
                return None
            if game_id is not None and room.game_id != game_id:
                return None
            room.touch()
            return room

    def count(self, game_id=None):
        with self._lock:
            self._sweep()
            return sum(
                1 for r in self._rooms.values() if game_id is None or r.game_id == game_id
            )

    def _unique_code(self):
        while True:
            code = "".join(random.choices(CODE_ALPHABET, k=CODE_LENGTH))
            # A saved room that hasn't been looked up since a restart still
            # owns its code.
            if code not in self._rooms and self._load(code) is None:
                return code

    def _load(self, code):
        """A saved room, back in memory. Called under self._lock."""
        # The code ends up in a file name, so nothing but a well-formed one
        # gets as far as a loader.
        if not CODE_PATTERN.fullmatch(code):
            return None
        for loader in self._loaders:
            found = loader(code)
            if found is not None:
                game_id, state = found
                room = Room(code, game_id, state)
                self._rooms[code] = room
                return room
        return None

    def _sweep(self):
        """Drop idle rooms. Called under self._lock from the methods above."""
        cutoff = time.time() - self._idle_timeout
        for code in [c for c, r in self._rooms.items() if r.last_seen < cutoff]:
            del self._rooms[code]


rooms = RoomManager()


def require_room(code, game_id):
    """Look up a room for a game, throttling clients that keep guessing.

    Both games need the same three lines around `rooms.get` — find it, forgive
    the client that got it right, and rate-limit the one that keeps not.
    """
    from flask import abort, request

    from core.ratelimit import code_guesses

    client = request.remote_addr or "unknown"
    room = rooms.get(code, game_id)

    if room is not None:
        code_guesses.clear(client)
        return room

    if code_guesses.record_failure(client):
        abort(429, description="Too many incorrect room codes from this device. "
                               "Wait a few minutes, then try again.")
    abort(404, description="That room code isn't active. It may have expired.")
