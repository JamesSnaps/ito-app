# Project context for Claude Code

## What this is

**Game Night** — a hub for companion web apps to physical board games.
Today it holds one game, *ito* (cooperative, secret-number ordering
game), and `/` redirects straight to it; the hub menu at `/games` only
earns its keep once there's a second.

The ito app itself: The owner has the German edition, whose
topic prompts come as a printed booklet rather than cards, which isn't
useful to a non-German-speaking group. This app replaces just that one
component — a topic randomiser everyone can see live on their phones —
while the physical number cards and colour markers stay in play.

Scope is deliberately narrow: this is **not** a digital reimplementation
of the whole game (no secret number assignment, no card placement, no
turn logic). That's an intentional decision — the physical cards work
fine and digitising them would add complexity without solving a real
problem.

## Stack

- Python 3 / Flask, single process, no external database.
- Persisted state is flat files under `data/`, one Docker mount:
  `data/ito/topics.json` (topic content) and `data/stats.json`
  (win/loss history, keyed by game id).
- Live state is in-memory rooms (`core/rooms.py`): four-letter codes,
  one state dict per room, swept after 6h idle. Lost on restart, which
  is fine — a room is one sitting.
- Each game is a blueprint under `games/<id>/`, listed in
  `games/registry.py`. Adding a game shouldn't touch `app.py` except to
  drop the single-game redirect.
- Frontend is plain HTML/CSS/JS (Jinja templates extending
  `templates/base.html`, shared `static/style.css`, fetch polling), no
  build step, no framework. Player page polls
  `/ito/api/<code>/state` every 2s.
- Single container via `Dockerfile` + `docker-compose.yml`.
- Smoke tests in `tests/test_smoke.py` (`pytest tests -q`).

## Key design decisions (so you don't re-litigate them)

- **No numeric scoring.** Confirmed against the official English
  rulebook (`ito_Rules_V2.pdf` in the repo, Arcane Wonders edition) —
  ito's base rules are win/lose per round (cards revealed in ascending
  order = win), not points. `stats.json` tracks wins/losses/streaks/
  category counts instead of a score.
- **The rules page follows that PDF**, rewritten rather than copied —
  the rulebook is copyrighted. It had one invented rule in it for a
  while ("no direct comparisons"), which is the opposite of how the game
  works: comparing out loud is the game. Check the PDF before adding
  anything to that page.
- **Topics, not full game logic.** See "Scope" above.
- **Hub-first structure, one game.** Built as a hub up front because
  room codes and game separation touch the same code — retrofitting
  both later would mean rewriting every route twice.
- **Rooms in memory, stats on disk.** Rooms are ephemeral by design;
  stats are what people care about across sessions, so those persist
  globally per game (not per room — a deliberate call, so the group's
  all-time streak survives).
- **Codes exclude I/O/0/1.** They get read aloud across a table.
- **Topics are scales, not strings.** `topics.json` entries are
  `{text, low, high}` — the printed cards always name both ends
  ("Small … Big"), and the card UI is built around that. `load_topics()`
  still accepts bare strings (they get Low/High) so the file stays
  hand-editable.
- **`.card` is the generic surface panel; `.play-card` is the playing
  card.** They collided once — `.card { position:absolute; inset:0 }`
  stacked every stats tile on top of the others. Don't reuse `.card`
  for the card component.
- **Every in-game page carries the app bar** (`ito/_appbar.html`). Its
  left button is contextual: back to your room from a side page, out to
  the hub from the host page (with a confirm). A side page reached
  without a live room falls back to the hub.
- **Rooms are resumable and say so.** The host page remembers its code
  in `localStorage`; the landing page offers it back, but only after
  checking the room still exists — a dead code offered up is worse than
  no offer.
- **The card is one shared Jinja macro** (`ito/_card.html`), used by
  both host and display views so they can't drift apart. Category icons
  are SVG symbols in `ito/_icons.html`, referenced by `<use>`.
- **The scale line is one unbroken `<path>`** — straight, dip, hump,
  self-crossing loop, straight — not a line plus a separate circle.
  It's the card's signature detail; keep it a single stroke.
- **Category colours live in `:root`** (`--cat-<name>`) and are used by
  both the card chip and the wheel, so a category looks the same
  everywhere. A new category needs a colour and an icon symbol.
- **Categories are a scroll-snap wheel, not a grid.** A grid of buttons
  stops working past a handful; the wheel is native scrolling (flicks
  properly on touch, no drag handling of its own) and stays one row
  tall however many categories exist.
- **Baloo 2, self-hosted** (`static/fonts/`, OFL, latin subset, one
  variable file covering 400–800). Deliberately not linked from Google's
  CDN: the app has to work on a LAN with no internet, and no player's
  browser should call a third party mid-game. `--font-display` falls
  back through `ui-rounded` if it ever fails to load.
- **The player view is the display view.** It's sized in vw/vmin so the
  same URL works on a phone and cast to a TV — the topic is the reason
  the app exists, so it gets the whole screen. The host page carries a
  smaller copy plus controls.
- **The result is asked at the draw, not parked on the page.** Tapping
  the deck for the next card opens the dialog first ("how did the reveal
  go?"), records, then deals. A bar further down the page was easy to
  scroll past and miss.
  - Three ways out, and they differ: answering records *and* deals;
    "don't record it" deals without recording; cancel/Esc does neither
    and leaves the round still unscored, so the next tap asks again.
  - `pendingDraw` is cleared on the dialog's `close` event, not just in
    the button handlers — otherwise Esc would leave a draw armed.
- **Two cards on wide screens.** `deck_back()` renders a permanently
  face-down draw pile beside the dealt card at ≥900px, so the back art
  and the category tab stay visible instead of only existing mid-flip.
  Below that only the dealt card shows, and it flips as before. Both are
  draw controls; `.host-stage .deck-button { width: auto }` is load-
  bearing, since the button was full-width when it was the only one.
- **The card back is the ito logo** — one gradient path drawn twice, the
  second clipped to the stretch that should cross in front of the
  letters, which is what gives the woven look. It carries the same
  bottom tab as the front, showing what the *next* card will be drawn
  from: on the host it follows the wheel, on the display it's set to the
  incoming card's category as it flips. "Any" gets a neutral tab rather
  than borrowing a category's colour.
- **Category colours are keyed off `[data-category]` alone**, not
  `.card-front[data-category]`, so the front and the back's tab share
  one set of rules. Anything else using that attribute would inherit
  `--chip` too.
- **Win/lose only writes stats.** It doesn't advance the round or change
  what players see, and topic shuffling is unrelated to it. One result
  per round (`state["scored"]`), so a double tap can't log two. The
  result bar stays hidden until there's a round to score, so the
  resting host screen is just the card, the wheel and Draw.
- **Polling over WebSockets.** Player count is small (party game, same
  room) and a 2s poll is much simpler than managing socket connections
  through Traefik. Measured end-to-end: 1.7–2.2s from the host's tap to
  a phone showing the card (poll interval plus the 320ms card flip), so
  two phones can be up to ~2s apart. Fine for a shared prompt everyone
  reads at their own pace; it would not be fine for anything timed.
- **Topic categories `summer`, `football`, `animals`, `geeks`,
  `halloween`, `work`** were translated from HeidelBÄR Games' free
  bonus topic PDFs (https://www.heidelbaer.de/ito-extras — the German
  publisher). Original German source is copyrighted, so these are
  original English rewrites conveying the same prompt, not translations
  of protected text. One prompt was dropped entirely ("how to spot a
  German abroad" — no sensible English equivalent), and one category's
  name/pun ("Hier steppt der Bär", a German idiom) was renamed to
  "Animal Kingdom" with content adapted accordingly.

## Known rough edges / good next steps

- Flask dev server (`app.run(...)`) is fine for a living-room game but
  not hardened — swap to gunicorn if this ever needs to handle more
  than a handful of concurrent players.
- No auth on host URLs — knowing a room code is the only gate, and
  anyone with it can hit that room's host endpoints. Fine for a home
  LAN party game; would need a host token before exposing beyond that.
- Topic editing (`/ito/api/topics`) is global and unauthenticated, so
  any player in any room can edit the shared topic list. It lives on
  `/ito/settings/<code>` rather than the host screen, which keeps the
  host page to controls you'd actually touch mid-round.
- Rooms are in-memory, so a restart mid-game drops the current room.
  Stats and topics survive.
- Tests are smoke-level only (routing, room isolation, stats).
- Card faces are swapped with a `.show-back` class at the deal
  animation's midpoint, not `backface-visibility` — Chrome stops
  culling backfaces once a face is clipped by `overflow` +
  `border-radius`, and the back painted over the front.
- Stats' `category_counts` still records the *filter* used ("mixed" for
  an unfiltered draw), while the card chip shows the drawn topic's own
  category. Deliberate, but worth knowing they differ.
- The action category's bracketed instructions ("… (mime it)") are
  split out client-side into a card note. That's a parsing convention,
  not a data field — a topic with unrelated trailing brackets would be
  split too.

## Versioning — do this before every push

`APP_VERSION` in `app.py` is the single source of truth. **Bump it in the
same commit as any user-visible change, before pushing.** Watchtower
deploys `latest`, so without it there is no way to tell from a phone
which build the server is actually running.

- Semver-ish: patch for fixes and copy tweaks, minor for new behaviour
  or a redesign, major for anything that breaks a URL or a data file.
- It renders on the ito landing page, the hub and the settings page, and
  is served by `/healthz` alongside a live room count.
- There's a test asserting `/healthz` and the UI agree, so a stale
  version in one place fails the suite — but nothing forces the bump
  itself. That part is on you.

## Deployment

Runs on vm-core behind Traefik at gamenight.collardserver.co.uk. The
stack file is `docker-compose.gamenight.yml` in the docker repo, wired
into `docker-compose.sh` as the `gamenight` group.

- **Two Traefik routers on one host.** `/ito/host/*` and `/ito/settings/*`
  go through `auth@file` (Authelia); everything else is public, because
  guests scan a QR to join and can't have accounts. This is the only
  stack there that isn't wholly behind Authelia — deliberate.
- **`ProxyFix` is required**, not optional. QR codes are built from
  `request.host_url`; without trusting Traefik's `X-Forwarded-*` they'd
  encode `http://10.0.5.9:5000/` and no phone could reach it.
- **Exactly one gunicorn worker.** Rooms are a per-process dict, so a
  second worker would serve some requests from a process that's never
  heard of your room. Threads give the concurrency instead. Scaling past
  one process means moving room state out of memory first.
- HTML is sent `no-store`; static files are cache-busted by the `asset()`
  helper's `?v=<mtime>`. A stale page against newer CSS produced a real
  bug once (card wouldn't change, round number still advanced).

## Commands

```bash
# local dev
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python app.py  # http://localhost:5000 (PORT= to override;
                         # macOS AirPlay squats on 5000)
.venv/bin/python -m pytest tests -q

# docker
docker compose up -d --build
docker compose logs -f
docker compose down
```
