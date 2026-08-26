# Game Night

A small hub for companion web apps to the physical board games on the
shelf. Each game is self-contained; the hub provides what they all need —
room codes, joining, persisted stats, QR links.

Two games so far: **ito** and **Flip 7**. `/` is the menu.

## ito

Replaces the topic booklet only. Secret numbers, card placement and turn
order stay physical — the app just shows everyone the same prompt.

- The host taps **Start a new game** and gets a four-letter room code plus a QR.
- Players scan the QR, or go to `/join` and type the code.
- Everyone's phone shows the current topic, updating within ~2 seconds.

Two groups can use one instance at once: rooms don't share topic history.

## Flip 7

Replaces the score pad only. The cards, the flipping and the arguing stay
on the table; the app adds up the round.

- Tap the numbers each player got out, plus any modifiers and the x2.
- Mark who busted (zero for the round) and who froze.
- Seven distinct numbers scores the +15 Flip 7 bonus automatically.
- First to 200 wins, and the scoreboard says so.

No room and no code: it's one device on the table, and the game is kept in
that browser's `localStorage` so a refresh doesn't wipe it.

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
core/ratelimit.py      throttles wrong-code guessing
core/stats.py          win/loss history on disk, keyed by game
games/registry.py      the list of games
games/ito/game.py      ito's blueprint and topic logic
games/ito/default_topics.json  shipped topics, tracked in git
games/flip7/game.py    Flip 7's blueprint (two pages, no rooms)
data/ito/topics.json   live topics, seeded on first run, gitignored
data/stats.json        win/loss history — runtime state, gitignored
templates/             hub-level pages
templates/art/         per-game menu artwork, one SVG per game id
static/style.css       shared styling
static/flip7.css       Flip 7's felt-and-gold theme, scoped to .flip7
```

## Before pushing

Bump `APP_VERSION` in `app.py`. Watchtower deploys `latest`, so it's the
only way to tell which build is live. `/healthz` reports it.

## Adding a game

1. `games/<id>/game.py` — a Flask blueprint at `/<id>` and a
   `GAME = GameSpec(...)` at the bottom, with an `accent` colour. Add a
   `new_room_state()` factory and the host/player endpoints only if the
   game actually needs rooms; Flip 7 doesn't.
2. `games/<id>/templates/<id>/` — its pages, extending `base.html`.
3. `templates/art/<id>.html` — the menu tile's artwork.
4. Import it in `games/registry.py:all_games()`.

Rooms, joining, stats and QR come for free for the games that want them.
`app.py` needs no changes.
