"""Throttling for room-code guesses.

A four-character code is ~1M combinations, which is only meaningful if
someone can't sit there trying all of them. This counts *wrong* guesses per
client and cuts them off after a handful.

Two deliberate choices:

- Only failures count. Players poll their room's state every 2 seconds; a
  limit that counted successful lookups would throttle a normal game.
- A correct code always works, even from a client that's over the limit, and
  clears their failures. Several people share one IP behind home NAT, so a
  stranger scanning must never be able to lock out a guest who has the real
  code and simply mistyped it.
"""

import threading
import time
from collections import deque

# Generous next to real typos (1–3), miserly next to a sweep: 15 guesses per
# 5 minutes is ~4.3k/day, so a full 1M-code sweep would take ~8 months.
DEFAULT_LIMIT = 15
DEFAULT_WINDOW = 300


class GuessThrottle:
    def __init__(self, limit=DEFAULT_LIMIT, window=DEFAULT_WINDOW):
        self._limit = limit
        self._window = window
        self._failures = {}
        self._lock = threading.Lock()

    def record_failure(self, key):
        """Log a wrong guess. Returns True if this client is now cut off."""
        now = time.time()
        with self._lock:
            self._sweep(now)
            hits = self._failures.setdefault(key, deque())
            hits.append(now)
            return len(hits) > self._limit

    def clear(self, key):
        """A correct code — forget their misses."""
        with self._lock:
            self._failures.pop(key, None)

    def is_blocked(self, key):
        now = time.time()
        with self._lock:
            self._sweep(now)
            return len(self._failures.get(key, ())) > self._limit

    def _sweep(self, now):
        """Drop expired hits, and clients with none left. Called under lock."""
        cutoff = now - self._window
        for key in list(self._failures):
            hits = self._failures[key]
            while hits and hits[0] < cutoff:
                hits.popleft()
            if not hits:
                del self._failures[key]


code_guesses = GuessThrottle()
