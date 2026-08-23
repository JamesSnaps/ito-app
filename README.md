# Game Night

A small hub for companion web apps to the physical board games on the
shelf. Each game is self-contained; the hub provides what they all need —
room codes, joining, persisted stats, QR links.

Right now there's one game, **ito**, so `/` redirects straight to it.

## ito

Replaces the topic booklet only. Secret numbers, card placement and turn
order stay physical — the app just shows everyone the same prompt.

- The host taps **Start a new game** and gets a four-letter room code plus a QR.
- Players scan the QR, or go to `/join` and type the code.
- Everyone's phone shows the current topic, updating within ~2 seconds.

Two groups can use one instance at once: rooms don't share topic history.

## Running it

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python app.py          # http://localhost:5000
```

macOS AirPlay squats on port 5000 — set `PORT=5001` if that bites.

```bash
docker compose up -d --build   # http://localhost:5050
```

Tests:

```bash
.venv/bin/python -m pytest tests -q
```

## Layout

```
app.py                 hub: routing, /join, QR endpoint, APP_VERSION
core/rooms.py          room codes, expiry (in-memory, all games)
core/stats.py          win/loss history on disk, keyed by game
games/registry.py      the list of games
games/ito/game.py      ito's blueprint and topic logic
data/ito/topics.json   topic content, tracked in git
data/stats.json        win/loss history — runtime state, gitignored
templates/             hub-level pages
static/style.css       shared styling
```

## Before pushing

Bump `APP_VERSION` in `app.py`. Watchtower deploys `latest`, so it's the
only way to tell which build is live. `/healthz` reports it.

## Adding a game

1. `games/<id>/game.py` — a Flask blueprint at `/<id>`, a `new_room_state()`
   factory, and a `GAME = GameSpec(...)` at the bottom.
2. `games/<id>/templates/<id>/` — its pages, extending `base.html`.
3. Import it in `games/registry.py:all_games()`.
4. Remove the single-game redirect in `app.py:hub()` so the menu shows.

Rooms, joining, stats and QR come for free.
