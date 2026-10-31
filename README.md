# Game Night

The family's games night, on a phone. It started as a helper for the board
games on the shelf and has grown past that, so it now holds three kinds of
game:

- **Help for a box on the shelf**: the real cards stay on the table and the
  app replaces one fiddly part (ito's topic booklet, Flip 7's score pad).
- **A board game played on the app**: the whole game on phones or one
  passed-round device, for nights without the box (Flip 7's Play mode,
  Fugitive).
- **Games of our own**: designed here, for us (Wildwood, Final Approach).

Each game is self-contained; the hub provides what they need: room codes,
joining, player profiles, persisted records, QR links.

Five games so far: **ito**, **Flip 7**, **Fugitive**, **Wildwood** and
**Final Approach**. `/` is the menu.

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
- The game ends when someone reaches 200; the highest total wins (a tie at
  the top is a shared win), and the scoreboard says so.

No room and no code: it's one device on the table, and the game is kept in
that browser's `localStorage` so a refresh doesn't wipe it.

Finished games are posted to shared records at `/flip7/stats` — wins,
average per round, best game, Flip 7s and busts per player, plus the last
ten games. Only games somebody actually won are recorded. Names must be
unique (ignoring case) and a game takes at most 12 players; if a game can't
be recorded the scorekeeper says why and offers to try again.

## Fugitive

The whole game, not a companion to it: one player is the Fugitive, laying a
trail of face-down hideouts from 0 to 42; the other is the Marshal, guessing
numbers to turn them over.

- Type the two names and deal. Either pass one device between you (hands
  are hidden while it changes hands), or use this screen as the table and
  scan its QR on each phone to sit down.
- Each phone sees only its own player's cards; the table sees what both
  could see across a real table.
- The Marshal's notepad can show what each hideout could still be.
- Finished games are recorded at `/fugitive/stats`; a rematch swaps roles.

## Wildwood

Our own card game in the Crazy Eights family, made for the youngest at the
table: match the colour or the creature, wilds change the colour, call
"Last card!" or get caught, and empty your hand first. Two to four players,
any of them the computer, on one device passed round or a phone each.

## Final Approach

Our own solo air-traffic game. Drag from an aircraft to draw its route and
bring it down on the runway that matches its colour, lined up with the
approach lights. Keep everything apart; low fuel, storm cells and wind
shifts make it harder airport by airport.

- Nine airports, each adding one idea, plus an Endless mode. Stars for
  diversions avoided; clearing an airport unlocks the next.
- Runs entirely in the browser; progress is kept on the device.
- The menu is a split-flap arrivals board and each briefing is a boarding
  pass. Every airport is painted in code; there are no image files.
- Its playbook (what it is, how it's built, where it's going) is
  [`docs/final-approach/PLAYBOOK.md`](docs/final-approach/PLAYBOOK.md).

## Player profiles

Tap **Add yourself** on the hub (or go to `/me`) to claim your name and take
a selfie. Your face then shows up in every game — the setup pickers, the
tables and the records. Add your other devices by scanning the QR on the
"You" page. Photos are re-drawn by the server as small square JPEGs with
nothing else from the file kept, and are visible to anyone using the site.

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
core/profiles.py       player profiles and selfies, shared by every game
core/jsonfile.py       atomic JSON writes, keeps <file>.bak of the last good copy
games/registry.py      the list of games
games/ito/game.py      ito's blueprint and topic logic
games/ito/default_topics.json  shipped topics, tracked in git
games/flip7/game.py    Flip 7's blueprint (no rooms) and its records
games/fugitive/engine.py  Fugitive's rules, per-player views, deduction
games/fugitive/game.py    Fugitive's blueprint, seats, records
data/ito/topics.json   live topics, seeded on first run, gitignored
data/stats.json        win/loss history — runtime state, gitignored
data/**/*.bak          last good copy of each file, written on every save
games/final_approach/game.py  Final Approach's blueprint: one page, the game is client-side
static/final-approach/  Final Approach's scripts, stylesheet and fonts
docs/final-approach/   Final Approach's playbook and screenshots
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
2. `games/<id>/templates/<id>/` — its pages, extending `base.html`. A
   game with a look entirely its own can override the `shell_css` block to
   swap the shared stylesheet for its own, as Final Approach does. An id
   with a hyphen (`final-approach`) lives in a package with an underscore.
3. `templates/art/<id>.html` — the menu tile's artwork.
4. Import it in `games/registry.py:all_games()`.

Rooms, joining, stats and QR come for free for the games that want them.
`app.py` needs no changes.
