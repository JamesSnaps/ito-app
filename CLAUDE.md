# Project context for Claude Code

## What this is

**Game Night** — the family's games, on a phone. It began as companion
apps for the board games on the shelf and is deliberately more than that
now (v1.18.0). Three kinds of game live here, and a new one should be
clear which it is:

- **Help for a box on the shelf** — the physical game stays on the table
  and the app replaces one part of it, narrowly (ito's topics, Flip 7's
  scorekeeper). Scope stays tight: see ito's "Scope" below.
- **A board game played on the app** — the whole game, server-side rules,
  for nights without the box (Flip 7's Play mode, Fugitive).
- **Games of our own** — designed here, not copies of published games:
  their own names, rules and art (*Wildwood*, *Final Approach*,
  *Picnic Raid*).

It holds six: *ito* (cooperative, secret-number ordering game),
*Flip 7* (push-your-luck card game), *Fugitive* (two-player
hidden-movement card game, played entirely on the app, against a person or
the computer — see its section), *Wildwood* (our own Crazy Eights-style
card game for the family, two to four, also played entirely on the app),
*Final Approach* (our own solo air-traffic game, all client-side; its
playbook is `docs/final-approach/PLAYBOOK.md`) and *Picnic Raid* (our own
set-a-trap card game, two to four, web only so far). `/` is the menu — it
used to redirect straight to ito when ito was the only game.

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
- Persisted state is flat files under `data/`, one Docker mount (player
  profiles too: `data/profiles.json` and `data/profiles/photos/`):
  `data/ito/topics.json` (topic content), `data/stats.json`
  (win/loss history, keyed by game id), `data/flip7/play/<code>.json`
  (Flip 7 games played on the app's deck — see Play mode below) and
  `data/fugitive/play/<code>.json` (Fugitive games, saved the same way).
  `stats.json` and `topics.json` are written through
  `core/jsonfile.py`: temp file + `os.replace`, previous good copy kept as
  `<name>.bak`. A corrupt `stats.json` is never written over — writes 503
  (`DataUnavailable`, handled once in `app.py`) and read-only pages fall
  back to the `.bak`. It used to read as `{}`, so the next result saved
  "empty plus one" over everyone's history. A corrupt `topics.json` falls
  back to its `.bak` for reads too; topic edits run under a lock.
- Live state is in-memory rooms (`core/rooms.py`): four-letter codes,
  one state dict per room, swept after 6h idle. Lost on restart, which
  is fine — a room is one sitting. The exception is opt-in: a game that
  can't lose a room saves it and registers `rooms.add_loader`, and a code
  missing from memory is looked for there first.
- Each game is a blueprint under `games/<id>/`, listed in
  `games/registry.py`. Adding a game shouldn't touch `app.py` at all.
- Not every game needs rooms, and the two halves are independent.
  `GameSpec.host_endpoint` is "the hub tile starts a room" (`starts_rooms`,
  ito only); `player_endpoint` is "a code resolves here at `/join`"
  (`has_rooms`). Flip 7 sets the second and not the first: its room is a
  read-only spectator view opened from inside the scorekeeper.
- Frontend is plain HTML/CSS/JS (Jinja templates extending
  `templates/base.html`, shared `static/style.css`, fetch polling), no
  build step, no framework. A game with a look wholly its own may swap the
  shared stylesheet out through base.html's `shell_css` block (Final
  Approach does; the others layer over it). Player page polls
  `/ito/api/<code>/state` every 2s.
- Single container via `Dockerfile` + `docker-compose.yml`.
- Smoke tests in `tests/test_smoke.py` (`pytest tests -q`). CI runs the whole
  suite on every PR (`.github/workflows/tests.yml`) and again on main
  before publishing the image.
- Flip 7's scorekeeper is one page of client-side JS plus its own
  `static/flip7.css`; its state never reaches the server. Play mode is the
  opposite — the game runs in `games/flip7/engine.py` on the server.
  Helpers every Flip 7 page uses (`el`, `icon`/`ICONS`, the Flip 7 flash,
  chip dragging) live in `static/flip7.js`.

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
- **Topics self-seed.** `games/ito/default_topics.json` ships in the
  image; `data/ito/topics.json` is runtime and gitignored, copied from
  the default on first read. `data/` is a bind mount in production,
  which shadows whatever the image put there — baking topics into
  `data/` meant a fresh deploy 500'd on the first host page. Edit the
  default file to change the shipped set; the live file is edited
  through Settings.
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
- **A reroll isn't a round.** "Not this one — swap the card" redraws
  without advancing `round_number` or clearing `scored`: you didn't play
  the topic, you just didn't fancy it, so it must not cost you the result
  still owed on the round in progress, and it never opens the win/lose
  dialog. `draw_id` is what changed to make this work — it counts cards
  dealt, a reroll included, and the host and display views key their flip
  off it rather than off the round number.
- **Settings is reachable without a room** (`/ito/settings`, alongside
  `/ito/settings/<code>`). Topics are global and editing them is a
  before-anyone-sits-down job; without a code the page just drops the
  room-scoped parts. Traefik's `auth@file` router covers the bare
  `/ito/settings` as well as `/ito/settings/<code>` (see Deployment).
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
- **An empty category stays in the file but leaves the wheel.** Deleting
  a category's last topic in Settings is allowed (so it can be topped up
  again), but `drawable_categories()` keeps it off the host's wheel, and a
  draw from an empty pool — that category, or "Any" with nothing at all —
  is a 409 with a sentence the host shows under the deck. It used to be
  `random.choice([])` and a 500.
- **Topic categories `summer`, `football`, `animals`, `geeks`,
  `halloween`, `work`** were translated from HeidelBÄR Games' free
  bonus topic PDFs (https://www.heidelbaer.de/ito-extras — the German
  publisher). Original German source is copyrighted, so these are
  original English rewrites conveying the same prompt, not translations
  of protected text. One prompt was dropped entirely ("how to spot a
  German abroad" — no sensible English equivalent), and one category's
  name/pun ("Hier steppt der Bär", a German idiom) was renamed to
  "Animal Kingdom" with content adapted accordingly.

### ito's host token (v1.10.0)

- **The device that starts a room runs it.** `new_room_state` makes a
  `host_token`; draw, result and reset need it in `X-Ito-Token` and 403
  without it. `/state` never carries it (`_public_state` drops it), so the
  code — read aloud across a table — lets you watch, not deal. A reset keeps
  the token: a new session, the same host.
- **Two ways to get one.** The web host page and room settings render it in
  (`/ito/host/<code>` and `/ito/settings/<code>` stay behind Authelia, so
  only someone signed in sees it); the app starts a room with
  `POST /ito/api/rooms`, which answers the room, its token and the
  drawable categories (also `GET /ito/api/categories` — names only; the
  topics stay with Settings behind Authelia).
- **That's what let draw/result/reset leave the Authelia rule** (docker
  repo): the token is the gate now, as for Flip 7's board and play. Starting
  a room is public — it costs nothing and ages out after 6h — and anyone who
  starts one can record ito results, the same openness as Flip 7's records.
  Topic editing and both stats resets stay behind Authelia.
- Tests' `Client` (tests/test_smoke.py) sends the token for rooms it
  started, so a test of what a draw does doesn't repeat the header.

## Flip 7 (added v1.2.0)

- **The scorekeeper is scorekeeping only**, same narrow scope as ito: it
  adds up a round of number cards, modifiers and a x2. It does not deal,
  track hits, or detect a bust — you tell it who busted. That's still true
  of the scorekeeper; Play mode (v1.6.0) is a separate, deliberate
  exception for nights without the deck, and the scorekeeper is unchanged
  for nights with it.
- **One device enters scores, and that's the point** (scorekeeper). A scorekeeper is one
  device on the table that everyone leans over. Five phones editing one
  scoreboard is a worse pad of paper, not a better one. The optional
  spectator room (below) doesn't change that — it copies the board out, it
  never takes input in.
- **State is in `localStorage` (`flip7:game`), players and banked rounds
  only.** A half-entered round is deliberately not restored — coming back
  to a partly filled round is more confusing than re-entering it. Reads
  and writes are try/caught: private browsing shouldn't break the game.
- **Scoring lives in `calcRoundScore` and is mirrored by
  `/flip7/rules`.** x2 doubles the number cards *only*; flat modifiers are
  added after; seven distinct numbers is +15; a bust scores zero
  including its modifiers. A test pins those four lines so the page and
  the rules can't drift.
- **Rendered as DOM nodes, not an HTML string.** The original standalone
  page built markup with an `escapeHtml` helper; player names are typed at
  the table and go straight back on screen, and `textContent` can't be
  got wrong.
- **Its felt-and-gold theme is `static/flip7.css`, scoped under `.flip7`
  on `<body>`**, layered over the shared shell rather than replacing it.
- **Fonts are the app's own.** The standalone page pulled Fraunces and
  IBM Plex Mono from Google's CDN; that's out for the same reason ito
  self-hosts Baloo 2 — LAN with no internet, and no third-party calls
  mid-game. A test asserts the page and its CSS contain no absolute URLs.
- **Bust and Freeze are exclusive** — they're how a turn ended. Bust also
  locks the number/modifier chips so a stray tap can't score a bust.

### Flip 7 spectator rooms (added v1.4.0)

- **The room is a copy of the board, not the board.** The game still lives
  in the scorekeeper's `localStorage`; sharing pushes a snapshot
  (`{players:[{name, scores, total}], target}`) to a room, and watchers poll
  `/flip7/api/<code>/state` every 2s. So a restart that sweeps rooms costs a
  spectator view and never the game — which is why the board wasn't moved
  server-side wholesale.
- **Read-only, deliberately.** `/flip7/watch/<code>` renders a scoreboard and
  has no controls at all; a test asserts the page contains no entry markup.
  Wanting to enter your own round is the thing that was ruled out, not an
  oversight.
- **Only banked rounds go out.** A half-entered round isn't in the snapshot,
  the same call as not restoring one from storage. `pushBoard()` skips a
  push whose body matches the last one, because `render()` runs on every
  chip tap.
- **No host endpoint on the spec.** You don't start a Flip 7 room from the
  hub — you open the scorekeeper and share it if you want to. That's why the
  hub label moved from `has_rooms` to `starts_rooms`.
- **The push needs a token, the read doesn't.** Codes get read out across a
  table, so the code alone can't be what protects the board: `create_room`
  hands back a `host_token` (kept in `flip7:share` alongside the code) and
  `POST /api/<code>/board` requires it. `/state` never returns it.
- **A 404 on push clears the share.** The room expired or a restart swept it;
  leaving a dead code on screen is worse than saying it's gone. Stopping a
  share just drops it locally — the room ages out on its own.
- **`core.rooms.require_room` is the shared lookup**, moved out of ito so
  both games throttle wrong codes identically (only failures count; a right
  code always works and clears the client).

### Flip 7 round entry (v1.5.0)

- **Two columns on wide screens, a takeover on phones.** Entering a round
  beside the scoreboard is the whole point on a laptop; on a phone the
  board would be pushed off the bottom anyway, so `.f7-col-board` is
  hidden while drafting and the round entry gets the screen.
- **Every player box carries a running tally** — banked + this round =
  where they'd stand, and how far off 200 they are. That's what the
  board would have been consulted for, which is what makes hiding it on
  mobile safe. The scoreboard shows the same running figure while a round
  is open, with "N banked + M this round" underneath so nobody misreads it.
- **Player chips are the seating order, and drag to reorder.** People don't
  sit down in the order they're typed in. The drag is pointer-events, not
  HTML5 drag-and-drop (which never fires on a phone), and deliberately does
  *not* use `setPointerCapture` — capture is dropped the moment the captured
  node is re-inserted, which is exactly what a reorder does, so the drag
  would die on its first swap. Window-level listeners instead. The DOM is
  moved during the drag and the arrays are rebuilt only on drop, from the
  chips' `data-index`; a round in progress is reordered with it so nobody's
  entry follows the wrong name. Dropping in the empty gap past the last chip
  is handled separately — `elementFromPoint` has nothing to report there,
  and "drag them to the end" is the obvious gesture.
- **Enter keeps the cursor in the name field**, so a table of five is typed
  in without reaching for the input again. The field is a new node after the
  re-render, hence the lookup by id.
- **A finished turn moves you on.** Bust, Freeze and the seventh number all
  scroll the next player who is still in into view (or the Save bar, if
  nobody is). With five players the entry panel is taller than a phone, and
  hunting for the next name was the fiddly part of keeping score.
- **Seven numbers gets a flash.** A gold card scales in over the page with
  "FLIP 7! +15" and the player's name, and is gone in 1.5s. It's
  `pointer-events: none` and lives outside `#app`, so it survives the
  re-render and never eats the tap that comes next — the following player is
  being scrolled to underneath it. Only fires on the tap that *adds* the
  seventh card, so untapping and retapping re-fires it and removing one
  doesn't.
- **Seven numbers freezes itself.** It's the rule, not a choice: no more
  cards can be taken, so the box locks and the Freeze button becomes a
  disabled "Turn over" rather than something you can toggle back off.
- **A locked turn still lets you untap what's already on.** Only the cards
  *not* chosen are disabled. Locking those too meant a mis-tapped seventh
  card had no way back. The documented invariant still holds — nothing can
  be added to a finished turn.
- **Saving a round opens the next one.** Play doesn't stop between rounds,
  so neither does the scorekeeper; "Save & next round" banks and re-opens
  in one tap. The exception is a game that just ended — nobody deals over
  the winner. "Done for now" on an empty round is how you stop.
- **One stroked SVG icon family, drawn inline** (`ICONS` + `icon()` in the
  scorekeeper's JS). Emoji came out as dull grey specks on some phones, and
  an icon font would be a third-party fetch — same objection as the
  typefaces. `createElementNS` puts the SVG namespace URL in the page, so
  the "no absolute URLs" test exempts that one string explicitly.
- **The sticky bar's secondary buttons are pale, not dark.** They were
  `rgba(15,46,36,.92)` on the felt — green on green, effectively invisible.
  They're translucent cream with a cream edge now, so the only gold thing
  down there is the button that ends the round.
- **Below 480px the two secondary labels collapse to their icons**
  (`.f7-label-long`, with `aria-label` carrying the name). Three labelled
  buttons overflowed 375px, and the bar is the one thing that must stay
  reachable by thumb — it must never scroll.
- **The board comes back as a pull-up sheet on phones.** Hiding it during
  entry is right, but "who's close to 200?" is a mid-round question, so the
  sticky bar carries a Scores button (narrow screens only — on a wide one
  the board is already beside you) that opens the standings as a bottom
  sheet. `standingsTable()` builds it, shared with the board panel so the
  two can't drift; left open, it refills on every render and closes itself
  when the round it was watching ends.
- **The scoreboard still sorts on banked totals mid-round**, so rows don't
  jump around under the finger that's tapping them.
- **Crossing the target pops a dialog**, once per crossing, not once per
  render — a restored finished game counts as already announced, so a
  reload doesn't re-celebrate. The gold banner stays as the persistent
  version.

### Flip 7 Play mode (added v1.6.0)

The app is the deck. One shared device (an iPad flat on the table), a
phone per player, or a mix of the two; a native iOS app later — which is
why everything here is shaped around a JSON API.

- **The engine is on the server, in Python** (`games/flip7/engine.py`). A
  deck shuffled in the browser is a deck anyone can read from the console,
  and rules written once are rules every future client gets instead of
  being rewritten in Swift or JS. It knows nothing of Flask or rooms; the
  state is one JSON-safe dict, which is what makes saving it trivial.
- **Action cards run off a work queue** (`tasks`). `_run` works through it
  until a person has to decide — a turn, or who gets a card — and parks
  that in `pending`. That's how a Flip Three inside a Flip Three, or a
  Freeze in the middle of the deal, resolve without nesting.
- **Two readings the rulebook doesn't spell out**, both the common ones:
  drawing an action card *is* your hit (the turn passes once it's
  resolved), and a Flip 7 ends the round with everyone else who hasn't
  bust still scoring. A card with only one legal target is given
  automatically — the last player in freezes themself without a tap.
- **`seq` is the double-tap guard.** Every move carries the `seq` the
  client was looking at; anything older is a 409 with the current table.
  Two taps on Hit draw one card. Moves are applied to a copy, so a refused
  one can't leave the room half-changed.
- **Tokens protect moves, not reads** — same pattern as the spectator
  board. `/join` sends a play code to `/flip7/play/<code>`, which is
  read-only until the device sits down.
- **Two kinds of token.** The dealing device holds the host token
  (`flip7:play`) and may move for any seat. A phone that taps its name gets
  a seat token (`flip7:seat`) that moves only for that seat — plus
  `next_round`, which is the table's business. Seats are first come, first
  served (the code is the gate, as everywhere here); only the host can free
  one, and the freed phone notices because `/state` echoes back who its
  token belongs to (`you`).
- **The dealer's device plays every seat that isn't on a phone, and steps
  in for one that is only when asked** ("Play Ana's turn"). Without the
  first, a mixed table can't work; without the second, someone's turn gets
  tapped from across the room. Server-side the host token can move anyone
  — the restraint is in the page.
- **A rematch carries the tokens over** — host and every seat — into a new
  room, and the finished room's `next` points at it. Phones see `next` on
  their next poll and follow with the tokens they already have; nobody
  re-joins. Asking twice returns the same rematch.
- **Play pages poll every 1s while a round is live** (2.5s otherwise): on a
  phone the poll is how you find out it's your turn. Still polling, not
  sockets — one gunicorn worker with 8 threads handles a table of phones
  at 1 request/s each easily. Your turn sets `● Your turn` in the title and
  vibrates where the browser allows it (only after the page has been
  touched — before that it's refused with a console error).
- **Saved to disk after every move** (`data/flip7/play/<code>.json`, temp
  file + `os.replace`, pruned on the same 6h rule as memory). A game played
  here is the game, not a copy of one, so a Watchtower deploy mid-evening
  mustn't end it. Restoring is `rooms.add_loader`; codes reaching a loader
  are validated against the code alphabet first, since they become file
  names. `_unique_code` asks the loaders too, so a saved code isn't reused.
- **The server records a finished game itself** via `parse_game`/
  `record_game`, once (`recorded` in the game state). No page posts it.
- **`score_hand` mirrors `calcRoundScore`.** The scorekeeper's JS is still
  pinned by string-matching; the Python is pinned by real tests, including
  200 random full games that check no card is ever lost or invented.
- **iPad landscape is the layout that was designed**; everything else is
  squeezed down from it. At ≥1000px landscape the table is exactly one
  screen (`100dvh`, nothing scrolls): a grid of mats sized to the player
  count (`--cols`/`--rows` from `gridShape`), a rail with status, the draw
  pile, the log and Hit/Stay. Each mat is a CSS size container and its
  cards are sized in `cqw`/`cqh`, so they scale with the mat, not the
  screen. Below that, the acting player's mat moves to the top and Hit/
  Stay are a sticky bottom bar. Seats never move on the iPad — only the
  highlight does.
- **Card faces are our own** — cream numbers, gold modifiers, a colour per
  action with an icon from the shared stroked set. Not the published art.
- **Handing out an action card can't be cancelled** (the dialog swallows
  Esc): the rules say it goes to someone.
- **Side pages take `?back=`** so the rules and records lead back to the
  table, which matters once there's no browser back button. Only
  `/flip7/…` paths are honoured.

### Installable (added v1.6.0)

- `/manifest.webmanifest` plus Apple's meta tags in `base.html`; icons in
  `static/icons/` (`icon.svg` is the source, the PNGs are rasterised from
  it once with `qlmanage` and committed — nothing new at runtime).
- **No service worker, deliberately.** The game state is on the server, so
  offline means nothing, and a worker caching pages would fight `no-store`.
- `viewport-fit=cover`, so body padding and the sticky bars use
  `env(safe-area-inset-*)`. Anything new pinned to an edge needs the same.
- **Every page needs its own way back** — standalone mode has no browser
  chrome. `join.html` and ito's landing gained one for this; ito's player
  display has a quiet "← Game Night" in its footer (v1.9.1) — it's cast to
  TVs, so it stays as small as the room code beside it.

### Flip 7 records (added v1.3.0)

- **A finished game is the one thing that reaches the server.** Who won in
  March is what a group still wants in June, and one phone's localStorage
  is no place for it. Everything else about a game stays client-side.
- **Only finished games count** — somebody has to have crossed 200. An
  abandoned game has no winner, and recording it would quietly punish
  whoever happened to be ahead when it stopped. The API 400s otherwise.
- **The winner is the top total, not the first across the line.** Two
  players can pass 200 in the same round; `winnersOf()` (scorekeeper) and
  the watch page both take the highest total among those past it, which is
  what `record_game` does. They disagreed once — the screen named whoever
  sat first. A tie at the top shows as a shared win ("A & B share the win"),
  matching the records.
- **Posted once, guarded by a flag that persists with the game**
  (`recorded` in `flip7:game`). The winner banner survives a reload, so a
  guard that didn't survive with it would re-post on every refresh. It's
  only set on a successful POST. A failed one is shown under the banner
  with the server's reason and a Try again button, and render() doesn't
  re-post on its own while that's up — a refused game would otherwise be
  re-sent on every render and an offline one would retry in a loop.
- **`recorded` resets whenever the board has no winner.** "Reset scores"
  was the only thing that cleared it, so removing the players and adding a
  new table's meant the next finished game was never posted. A board nobody
  has won can't have been recorded, whatever route led to it.
- **Names are checked against the records' rules when they're added**:
  trimmed and cut to `MAX_NAME`, compared case-insensitively, at most
  `MAX_PLAYERS` (both rendered into the page from `game.py`). The server
  refused duplicates and a 13th player only at the end, silently. JS has no
  `casefold`; lower-casing plus ß covers names typed at a table, and
  anything it misses surfaces as a failed record rather than vanishing.
- **Players are keyed case-insensitively, and the newest spelling wins**
  the display name. Names are typed fresh at the table every time; "ana"
  and "Ana" being two people on the leaderboard is never what was meant.
- **The leaderboard sorts on wins, then average points per round** — not
  total points, or whoever has played since January owns the top of the
  table permanently.
- **`core/stats.py` grew a generic `read`/`update` pair.** `load`/`record`
  are ito's win-loss shape and Flip 7 is nothing like it, so it keeps its
  own shape in its own bucket of the same file. `update` does the whole
  read-modify-write under the file lock — two games finishing at once
  would otherwise each write a record built from before the other's.
- **A draw at the top gives everyone tied a win.** Vanishingly rare, but
  nobody at the table would call it half a win each.

## iOS app (`ios/`, started alongside v1.6.0)

A native SwiftUI front end to the same server: Flip 7 Play (dealer or
seat), Fugitive (since app 1.2.0; against the computer, online or off,
since 1.5.0), Wildwood (since 1.11.0: online, offline and nearby), the
games' records, ito hosting (since app 1.4.0) and its
topic display, and player profiles. Rules pages, ito's
stats, the Flip 7 scorekeeper and a scorekeeper's spectator board open the
server's own pages in an in-app Safari sheet rather than being rebuilt.

- **Keep score is the web scorekeeper** (app 1.12.0): the Flip 7 tile's
  second button opens `/flip7/` in the Safari sheet, for nights with the real
  cards. Its game is in that sheet's localStorage, which is the app's own —
  not Safari's, not the home-screen web app's — and survives the sheet
  closing or a swipe down, so opening it again carries on. Every web sheet
  keeps the screen awake, as the tables do.

- **The server is still the game.** The app holds no rules: it shows the
  table from `/flip7/api/play/<code>` and sends moves, exactly like
  `play.html`. Anything rule-shaped belongs in `engine.py`, not in Swift.
  The one exception is offline Fugitive (below), and it's a pinned port,
  not a second set of rules.
- **It mirrors the web table on purpose.** The same three modes (`table`,
  `player`, `watch`), the same `canAct` / `takenByPhone` / `token(for:)`
  rules, the same card order and log wording, the same layout split (iPad
  landscape: mat grid + rail; anything narrower: your mat first and a
  bottom Hit/Stay bar). When one changes, change the other — they're
  played at the same table.
- **Project is generated.** `ios/project.yml` → `cd ios && xcodegen`.
  `GameNight.xcodeproj` is gitignored. iOS 18+, Swift 6, default actor
  isolation `MainActor`; the API value types are `nonisolated` because
  they're compared and decoded off the main actor.
- **Tokens live in UserDefaults** (`TokenStore`), per game code — the same
  low stakes as the web's localStorage. A rematch copies them to the new
  code (`carry(from:to:)`).
- **Server URL**: production by default; `-serverURL http://localhost:5001`
  as a launch argument or the Settings screen for a dev server.
  `NSAllowsLocalNetworking` permits plain http on the LAN only.
- **Fixtures are real responses.** `ios/GameNightTests/Fixtures/*.json`
  were captured from the Flask code, the Swift models are tested against
  them, and `test_the_ios_app_fixtures_still_match_the_api` fails the
  Python suite if the API's keys drift.
- **The Swift that doesn't need UIKit also builds on Linux**
  (`ios/LinuxTests`): a Swift package of symlinks to the app's models,
  client, offline engine, computer opponent and table, nearby play and
  ito's host store, with the Xcode project's settings (Swift 6.2, MainActor
  by default) and a signature-only MultipeerConnectivity stub. `./run.sh` runs it in the
  `swift:6.2` image; CI runs it on every PR touching `ios/` or Fugitive
  (`.github/workflows/swift-tests.yml`). The SwiftUI screens still only
  build in Xcode. A new non-UI file worth checking needs a symlink there.
- **The invite QR opens the web table**, not the app, so a phone without
  the app can still join.
- **Every invite QR has a Send invite beside it** (v1.16.0, app 1.10.0):
  the share sheet with the QR's own link and a line naming the game and code,
  so someone not at the table yet can be sent it over Messages. iOS:
  `InviteLink` (Support.swift) in Flip 7's phones sheet, Fugitive's room-code
  sheet and seats panel, and ito's invite sheet. Web: `static/share.js`
  (`Invite.button` / `Invite.wire`) in the same places plus the
  scorekeeper's spectator share — `navigator.share` where there is one, else
  the link copied, else a prompt to copy it by hand (plain http on the LAN
  has no clipboard API). Paths are made absolute from the page's origin, so
  no page carries a URL. There are no push notifications: nobody has an
  account to send one to, only devices holding a profile's token.
- **One join for every game.** `GET /api/join/<code>` (app.py) is /join's
  JSON twin — same throttle — and answers `{code, game, path}`. The app
  then opens Flip 7 play natively, ito natively, or the web `path` (a
  scorekeeper's board). `Joining.resolve` is shared by the Join screen and
  links.
- **Links open in the app.** `gamenight://join/ABCD`, and the web paths
  `/flip7/play|watch/<code>`, `/ito/play/<code>`, `/join?code=` all parse to
  a code (`Joining.code(in:)`). The https ones reach the app through
  Associated Domains (below).
- **`/flip7/api/stats` carries `leaderboard`** in the records page's order,
  so the app doesn't re-implement the ranking.
- **Tables and the topic display keep the screen awake**
  (`.keepsScreenAwake()`): they sit on the table for an hour. It's counted
  (app 1.12.0), not a switch: a web sheet closing over a table used to turn
  it off under the table still showing.
- **ito's card is drawn natively** from the same geometry as
  `ito/_card.html` — the scale line and the back's swirl are the SVG paths,
  ported point for point, and the deal is the same edge-on swap.
- **ito hosting is native since app 1.4.0** (`ItoHostView` / `ItoHostStore`,
  see "ito's host token" above): the web host page's card, category choice,
  deck, swap and result question, the same three ways out of it. The invite
  QR opens the web display. A code this device started — typed, scanned or a
  link — opens the host screen rather than the display; the hub offers the
  last hosted room back while it's open.
- **Distribution is TestFlight with a public link** for family and
  friends — no App Store listing, which also sidesteps the App Store's
  likely objection to the "Flip 7" and "ito" trademarks. Builds expire after
  90 days, so one goes up at least quarterly. Steps in `ios/README.md`.
- **Signing follows the other apps** (Dishes, Keepsake, Brief): team
  `C729B84RYG` — the personal membership, not the Snapdragons team — in
  `project.yml`, automatic signing, bundle `uk.collco.gamenight`. A test
  checks `project.yml` and `app.py`'s `IOS_APP_ID` agree.
- **`ios/scripts/testflight.sh`** is Brief's script adapted: archive and
  upload with the Xcode-signed-in account, build number = UTC time,
  archives outside the repo.
- **Required for any upload**: `PrivacyInfo.xcprivacy` (no tracking;
  since 1.2.0 a profile's name and photo declared as collected for app
  functionality; UserDefaults declared with reason CA92.1) and
  `ITSAppUsesNonExemptEncryption: false` (HTTPS only). Add to the manifest
  if the app ever touches another required-reason API.
- **Room links open the app**: `/.well-known/apple-app-site-association`
  (app.py) names `IOS_APP_ID`, hard-coded as news-hub does for Brief, and
  claims only the pages a player is sent to; the app carries the
  `applinks:gamenight.collardserver.co.uk` entitlement. The file must stay
  on the public Traefik router — Apple fetches it with no sign-in.
- **The app talks to production by default**, so the server must be on a
  version with the app's endpoints (v1.6.1+; v1.8.2+ for app 1.2.0; v1.9.0+
  for app 1.3.0's offline uploads — offline play itself needs no server;
  v1.10.0+ for app 1.4.0's ito hosting; v1.11.0+ for app 1.5.0's online
  games against the computer; v1.12.0+ for app 1.6.0's records against the
  computer; v1.15.0+ for app 1.9.0's games without hints, which an older
  server deals with hints on — the app holds offline computer games back until the server's
  stats carry `computer_leaderboard`; v1.17.0+ for app 1.11.0's Wildwood) before a build goes out.
- **`.dockerignore` keeps `ios/` out of the server image.**
- **QR codes are scanned in the app** (`ScanSheet`, VisionKit's
  `DataScannerViewController`, QR only), from the hub's toolbar and the Join
  screen. What it reads goes through `Joining.destination(for:)` — the same
  path as a link opened from outside — so a room QR and a profile sign-in QR
  both work. `NSCameraUsageDescription` covers this and the selfie.
- **App links claim what the app shows**: `/flip7/play|watch`, `/fugitive/play`,
  `/wildwood/play`, `/ito/play`, `/join?code=` and `/me/link`. Claiming a path sends it to every
  installed version of the app, so claim a new one only once a build that
  handles it is on TestFlight.

### Fugitive on a phone held sideways (app 1.8.1)

- **Compact height gets its own layout** (`LandscapeTable`), chosen before
  the iPad split: the biggest iPhones are regular width sideways, and used
  to get the iPad's long desk column beside a 370pt panel column.
- **One screen, nothing to scroll in normal play**: on the left the other
  player on one line (`OpponentLine`), the trail, and your hand in a compact
  plate at full width; on the right a column with the turn's banner, the
  decks (`Decks(compact:)`: icons, no ranges), the hiding step and switch
  (`FugitiveControls(compact:)`: the heading drops "First turn", and the
  hint waits until a hideout is picked — before that the badges say it),
  and Hide/Done pinned at its foot (`HideActions`, shared with portrait's
  `HideBar`), with a smaller banner (`StatusTag(compact:)`). Card width
  comes from the height: two rows of cards plus the chrome.
- **The Marshal's column is the notepad** (app 1.8.2): eleven numbers to a
  row in smaller writing (`Notepad(compact:)`), so 1–41 is four rows, the
  pencil-in switch shares the title's line, and Guess (with Let them go in
  a Manhunt, side by side) is pinned at the column's foot (`GuessActions`,
  which is also what sits under the portrait notepad). While guessing the
  decks step out — nothing can be drawn — and there's no `MarshalHint`, as
  the banner says it. Before this the notepad ran off the bottom and Guess
  needed a scroll to find.
- **Seats and case notes are a panel away**: the toolbar's sidebar button
  slides them in from the right over a dimmed table (`LandscapePanels`);
  tapping the table closes it. Only shown sideways. The panel stops at the
  navigation bar: run up under it, its edge cut through the centred title.

### Fugitive on an iPad in landscape (app 1.8.3, 1.8.4)

- **Cards are sized from the height** (`FugitiveTableScreen.deskCard`):
  about 5.2 card widths plus ~450pt of chrome, between 72 (what every iPad
  had before) and 112 (the 240px card images' sharp limit). A 13" gets
  ~95pt cards; an 11" stays at 72. Upright, up to 88.
- **Hiding is in the side column** (`HidingPanel`, above the seats): the
  step switch, the hint, Hide and Lie low — not under the hand with a bar
  pinned over it. With bigger cards the bar covered the hand. The desk is
  `Desk(controls: false)` there; the panel also carries the "tap a deck"
  and Marshal hints on your turn.
- **A hideout with sprint cards could stay invisible** (app 1.8.4): the
  case notes had it, the trail didn't, until the next move redrew it. The
  store cleared `landing` but SwiftUI missed that one change, so the trail
  was left drawn with the stop held back — reproduced online on an iPad,
  hiding with four or more sprint cards. The trail now also reads
  `store.animating` and only holds a stop back while the table is still
  playing out, so a settled table always shows every hideout.
  `everyHideoutLandsOverAWholeGame` covers the store side.
- **Reopening a dealt game kept the seat** (1.8.4): the hub kept the
  payload a game was handed over with and reused it on every later open —
  the dealer's view from the deal, which told the store this device's seat
  had been freed ("You're no longer the Fugitive"). Handed-over payloads
  are dropped back at the hub, and one is never read as news about a seat.
- **The iPad's columns only scroll when they must** (`scrollBounceBehavior(.basedOnSize)`).

### Fugitive on iOS (app 1.2.0)

- **Same server, same secrecy.** `FugitiveStore` is play.html in Swift: it
  asks with the token the device holds and draws only what comes back; a
  hand that isn't yours arrives as nil. `FugitiveDevice` mirrors the web's
  `fugitive:game:<code>` (dealer token, a token per seat, pass-and-play),
  kept per code in UserDefaults (`FugitiveTokens`); a rematch swaps the seat
  tokens as the web does.
- **Pass-and-play's folder** covers the desk whenever it's someone's turn
  and the screen isn't theirs yet, and only once the table has settled; the
  device polls as the table (the dealer's token) until it's opened.
- **The desk is the web's desk**: the other hand fanned across, the trail on
  the code-seeded city map, the three decks, your hand nearest you; the
  Marshal's notepad, seats (with the invite QR) and case notes beside it on
  an iPad in landscape, below it elsewhere. Status lines and case notes use
  play.html's wording (`StatusTag.words`, `fugitiveNote`).
- **Played out like the web**: new log entries are queued and performed one
  at a time — a drawn card is held out of the hand until it lands
  (`incomingCards` / `incomingBacks`), a new hideout slides onto the trail
  (`landing`), a find stamps FOUND, a miss stamps and shakes the trail, a
  Manhunt washes the screen red and blue. Only a fresh deal is dealt out.
- **The endings** (app 1.13.0): a catch drops cell bars over the desk
  (`CellBars`, `lockingUp`), the door slams as they land, and CAUGHT is
  stamped over them; an escape flies a big plane slowly up across the
  screen on a curve, with a contrail and a sunrise glow (`PlaneAway`, a
  `Canvas` in a `TimelineView`, 2.8s; the `escape` sound is as long), and
  ESCAPED lands while it's still climbing. The last stamp is bigger
  (`Stamp.ending`) and knocks out a ring of ink, and on a device that holds
  one seat it says "You win" / "You lose" (none on a table or a device passed
  between both), with a success or error buzz to match. Reduce Motion fades
  instead.
- **The art is the web's, not a copy of it.** Card faces are PNGs rendered
  from `fugitive.js` by `ios/scripts/render_fugitive_cards.js` (into
  `Assets.xcassets/Fugitive`); mugshots and the city map are `Canvas` ports
  of `mugshotSVG` / `cityMap`, seeded by the same mulberry32 and FNV hash
  (`Seeded`) — a Swift test pins its output to values from the JS. The
  three fonts are bundled TrueType conversions of `static/fonts`.
- **Fixtures**: `fugitive_*.json` and `profile*.json` come from one scripted
  game (`ios_fixtures` in tests/test_fugitive_play_api.py), which also fails
  the Python suite if the API's shape drifts.
  `WRITE_IOS_FIXTURES=1 pytest tests -q -k fugitive_fixtures` rewrites them.

### Offline Fugitive (app 1.3.0, server 1.9.0)

For a plane: Fugitive with no internet, on one phone passed across or two
phones side by side.

- **The rules in Swift, pinned to engine.py.** `FugitiveEngine.swift` is a
  line-for-line port — the same state (the Python dict's JSON keys), the
  same order of checks, the same refusals word for word, `view` and
  `candidates` included. `tests/test_fugitive_offline.py` plays six seeded
  games (every ending, every refusal) and writes every seat's view after
  every move to `Fixtures/fugitive_engine_games.json`, failing if engine.py
  no longer plays that way; `FugitiveEngineTests` replays it in Swift and
  must match all of it. **Change engine.py → rewrite the fixture
  (`WRITE_IOS_FIXTURES=1 pytest tests -q -k engine_scripts`) → make the
  Swift agree.** CI runs both halves.
- **The table doesn't know it's offline.** `FugitiveTransport` is the five
  calls the table makes; `GameNightClient` is one, `OfflineTable` another —
  game.py's room kept as a file per code in Application Support, answering
  with the same payloads, tokens, seats, refusals and rematches. So
  `FugitiveStore` and every screen are unchanged, pass-and-play's folder
  included. Offline codes and tokens have their own shelf
  (`FugitiveTokens.offline`), so they can't collide with the server's.
- **Two phones: one keeps the game.** The host phone advertises over
  MultipeerConnectivity (`NearbyLink`: Bluetooth / peer-to-peer Wi-Fi, no
  network) while its table is on screen; the other joins from "Join a
  nearby game" and sends the server's API calls across (`Nearby.swift`),
  which the host answers from its `OfflineTable` — the view for the
  guest's token only, as online. If the link drops it rejoins the same
  host. The host phone holds the whole game, as the server would; fine for
  a family game. Both phones must stay in the foreground — iOS suspends
  the link in the background.
- **Coming home.** An offline game keeps its decks from before the deal and
  every move. Once there's signal (`OfflineUploads`: when the hub or the
  records open, and when a game ends) it's posted to
  `POST /fugitive/api/offline`, which replays it through engine.py and
  records it only if the real rules accept it to the end — once per game
  id, so a retried upload doesn't count twice. A 4xx is remembered, not
  retried; sent games are cleared after a week; a finished game is never
  dropped unsent. The records screen says how many are waiting.
- **Against the computer, offline** (app 1.5.0): the saved game keeps
  `computer {role, level, seed}` and `movedAt`, and the computer's seat
  gets a token nobody is handed, exactly as game.py's room does. Every look
  at the table (`fugitiveState`) runs `computerMoves`: if it's the
  computer's turn and `computerDelay` (game.py's 1.5s) has passed since the
  last move, it makes *one* move with `FugitiveAI.choose` from its seat's
  view and `moveRNG(seed, seq)`, recorded in `moves` like anyone's. The
  store's 1s poll is the clock. A rematch swaps its seat, with a fresh seed;
  its seat can't be freed. It isn't advertised for a nearby phone — both
  seats are taken. Since app 1.6.0 a finished one is uploaded like any
  other, with `computer {role, level, seed}` in the body (see "Records
  against the computer"), but only to a server whose `/fugitive/api/stats`
  has `computer_leaderboard`: an older one would ignore `computer` and put
  the game on the leaderboard against a player called Computer. `OfflineTableTests` replays the
  fixture's computer-v-person games through the table, one look per
  computer move.
- `NSLocalNetworkUsageDescription` and `NSBonjourServices`
  (`_gn-fugitive._tcp/_udp`) are in `project.yml` and the committed
  `Info.plist`; iOS asks before the first nearby game.

### Poor signal (app 1.13.0)

- **Offline is chosen by asking the server, not the phone.**
  `Connectivity.online()` checks the phone has a network (NWPathMonitor)
  *and* that `/healthz` answers within 2.5s (`GameNightClient.reachable`, a
  hard limit: `timeoutInterval` only counts the gaps, so a trickle outlasts
  it). The network alone said yes to one bar, a hotel's sign-in page and
  Wi-Fi with its broadband down. Fugitive's and Wildwood's setup run it
  when they open, after anything that needs no signal and before anything
  that does, and only ever turn Offline *on*.
- **A deal that can't reach the server turns Offline on** and says so;
  dealing again plays without it. It doesn't deal offline by itself: with
  "own phones" that's a nearby game, which the other phone has to join.
- **Tables say "Reconnecting…"** (`PollHealth`, `.reconnecting(_:)` in
  Support.swift) after two failed polls in a row, or a poll that's taken
  more than 4s — on one bar a request hangs for its whole timeout before
  failing. Any answer from the server, a refusal included, clears it, and a
  poll cancelled by leaving the table doesn't count. Flip 7, Fugitive and
  Wildwood all use it; an offline table never fails, and a dropped nearby
  link shows it too.
- **No global "offline mode" switch, deliberately.** Only Fugitive and
  Wildwood can play offline and each has its own switch; everything else
  needs the server, so a global switch would mostly turn things off.

### The table as a real deck (iOS)

- **The deck is the hit control.** A stack of card backs (`DeckView`) you
  tap, or peel the top card up off; there's no separate Hit button. The face
  comes from the server's answer, so a peel can't reveal anything early.
  Stay stays a button.
- **The log is played out, not just shown.** `PlayStore` queues every new
  log entry and performs them one at a time: a card flies from the deck to
  the player's mat and turns over on the way (`FlyingCard`), the deal goes
  round one card at a time, a shuffle riffles the deck, a bust shakes the
  mat. Cards still in the air are held back from the mats (`inFlight`,
  `cards(for:)`) so they appear where the flight lands; the newest copy of
  a card is the one held back, so a bust's duplicate is what arrives.
  Controls, the give sheet and the winner alert wait until the table has
  settled (`animating`). Only a game dealt on this device is played from the
  top (shuffle, then the deal); opening a game already under way doesn't
  replay it.
- **The deck and mats report their frames** (`DeckFrameKey`, `MatFramesKey`
  in a named coordinate space) so the flying card knows where to go.
- **Sounds are synthesised, not shipped** (`Sound.swift`): filtered noise
  for paper (flick, land, riffle), decaying sines for thuds and chimes.
  Nothing to license or download. `.ambient` session: follows the silent
  switch and mixes with music. Toggle in Settings and in the table toolbar.
- **iPad layouts are their own, not a stretched phone.** Hub: game tiles
  side by side, Join beside the title, one gold button at a time. Up to
  1280pt wide, three across from 1100pt and two-and-one below that, in a
  `Grid` so a row's tiles end level (app 1.8.2: capped at 1000 with three
  across, a tile's two half-width buttons were too narrow and "Records"
  broke over two lines). Every tile is one row of buttons across (Flip 7's
  Start a game and Keep score, ito's Back to / New room), then Records and
  Rules — ito's Records is the server's stats page — and the buttons are
  one line each. New game
  and Join: a centred column. Records: two columns. Table: mats capped at
  the height two rows of cards need and centred, cards up to 112pt, so two
  players don't sit in a sea of empty felt.
- **The New game name field sits above the list.** Below it, each added name
  moved the field mid-typing and letters went missing; focus also comes back
  a beat after return, because setting it inside the submit doesn't stick.
- **Turn order is the official rule**: an initial deal of one card each,
  then one Hit or Stay per turn round the table (checked against the
  publisher's FAQ). "Draw until you stop, then the next player" is a house
  rule, not how the engine plays — and offered as an option, it was turned
  down. Don't add it.

## Fugitive (added v1.7.0)

The whole game on the app, like Flip 7's Play mode and built the same way:
the engine on the server (`games/fugitive/engine.py`), a JSON API, rooms
saved after every move, the finished game recorded by the server. Card
faces are our own. Rules checked against the 2nd-edition rulebook (it was
read in full; not in the repo).

- **Hidden information changes the token model.** Flip 7 sends everyone
  one public table; here `engine.view(state, viewer)` is per seat. A seat
  token (`fugitive` / `marshal`) sees that player's hand and moves for that
  player only. The host token — the device that dealt — sees the *table*
  view and runs the room (free a seat, rematch) but **cannot move**:
  moving for a player means seeing their hand, which is exactly what the
  Flip 7 dealer's "play Ana's turn" would leak. No token: the table view.
- **What's public is what's visible across a real table**: how many
  sprint cards sit under each hideout (not which), which deck each draw
  came from (not the card), both hand sizes, and wrong guesses. 42 goes
  down face up but its sprints stay hidden. Everything turns up at the end.
- **Pass-and-play is one device holding both seats.** The page asks as
  whoever's turn it is, but only after the "Pass to Ana" curtain is tapped;
  until then it polls with the host token, so a hand never reaches the
  screen while the device is changing hands.
- **A rematch swaps roles**, and each player's seat token moves with them
  (the server swaps `seats`, the page swaps its stored tokens), so phones
  follow `next` and carry on without re-joining.
- **Not hiding draws a card** from the lowest deck that has any (2nd
  edition). Nobody remembers whether 1st edition did; it's one block in
  `_hide_move` if it turns out otherwise.
- **Which cards have two footprints is our own spread** (`TWO_FOOTPRINTS`);
  the rulebook only says +1 or +2. Swap in the real list when someone reads
  it off the cards — the rules page prints the current one.
- **The Marshal's notepad help** is `engine.candidates()`, sent only in the
  Marshal's payload and computed from the Marshal's *view*, so it can't
  know anything the Marshal couldn't deduce on paper. A wrong single guess
  only rules a number out for hideouts already down — the Fugitive may
  hide there later (the random-game test caught the version that forgot).
  The random-game test also asserts it never rules out the true card.
- **Records** are per player and per role (Fugitive wins, Marshal wins,
  Manhunt catches). A game resigned before the Fugitive's first hideout
  isn't recorded — nobody played it.
  A game against the computer is recorded apart (see below).
- **No admin routes**, so nothing new for the Authelia rule in the docker repo.
- **iOS is native since app 1.2.0** (see "Fugitive on iOS" below), and the
  AASA file claims `/fugitive/play/*`.
- **Offline (plane) play is in the iOS app** (since 1.3.0; see "Offline
  Fugitive"): the rules in Swift, pinned to this engine by scripted games
  the Python suite writes out and the Swift tests replay, and finished games
  replayed through this engine by `POST /fugitive/api/offline` before
  they're recorded. Any change to engine.py has to be made in
  `FugitiveEngine.swift` too — the fixture test makes sure of it.

### Fugitive's table (v1.7.0)

- **A desk, not a dashboard.** The page is a detective's desk at night:
  dark wood lit from above, a street map spread on it (`cityMap()`, seeded
  by the room code so every device shows the same city) with the trail laid
  across it, the three decks below, the other player's hand fanned as backs
  across the table and yours fanned at the bottom. The table view seats the
  Marshal across and the Fugitive near.
- **Every card is drawn, not shipped** (`cardSVG()` in `static/fugitive.js`):
  since v1.14.0 an illustrated scene in our own 60s-caper style, flat shapes
  in a small palette — **not** the published cards' art, which is
  copyrighted. Two recurring characters: the runner (dark suit, red tie,
  briefcase: `runner()`, poses run/leap/stand/climb) and the one on his tail
  (trench coat, fedora, torch or newspaper: `pursuer()`). Five scenes per
  deck (`SCENE_SETS`) in turn by number, so neighbours differ — on foot
  (1–14, the starting cards too): rooftops, alley, fire escape, subway,
  newsstand; by car (15–28): bridge, cab in the rain, motel, tunnel, gas
  station; by plane (29–41): tower, helicopter, hangar, runway, terminal —
  each varied by `seeded(n)` (which way he runs, car paint, lit windows, the
  moon), so a card looks the same on every device. 0 is the cell with a bent
  bar and a rope of sheets; 42 the plane out at sunrise, the pursuer left on
  the tarmac. The art window runs to y 106 of the 140-high card; the band
  under it has the number (30px), footprints and the deck icon. Signs on the
  art stay clear of the corner number. The **back is one design for every
  card**: a deck icon on the back would say which third of the trail a
  face-down hideout is in. **Change the art → re-render the iOS PNGs**
  (`node ios/scripts/render_fugitive_cards.js`; Playwright must match the
  cached Chromium build).
- **The web Hide bar is moved to the top of `#app` after each render**: the
  desk is its own stacking context, so the panels after it painted over a
  bar left inside it, whatever its z-index. `#app:has(> .fg-hidebar)` keeps
  room for it at the end of the page.
- **Sprint cards are tucked under their hideout**, each peeking out a little
  lower, faces showing once they're known — the count is public, as on a
  real table. While hiding, the next slot on the trail previews the pick.
- **The log is played out, not just shown** — the iOS app's PlayStore idea
  in the browser. `show()` renders, then works through log entries newer
  than `seenEvent`: a draw flies from its deck to the drawer's fan (turning
  over only for the drawer), a hideout slides in from the Fugitive's hand,
  a find turns the card over under a FOUND stamp, a miss stamps NOT HERE
  and shakes the trail, a Manhunt sounds a siren and washes the desk red and
  blue, and the end is CAUGHT or a plane taking off. Targets are hidden
  until their animation lands them, payloads that arrive mid-animation wait
  (`waiting`), and opening a game already under way doesn't replay it — only
  a fresh deal is dealt out. Polls only redraw when the payload changed, so
  nothing restarts every second. `prefers-reduced-motion` skips the motion.
- **Sounds are synthesised** (`Sound` in `fugitive.js`), as on iOS: noise
  bursts for paper, sines for thuds and chimes. Browsers only start audio
  after a tap, so the first tap anywhere unlocks it; the bar has a mute
  toggle (`fugitive:sound`).
- **Hiding is two steps, said out loud** (v1.13.0, app 1.7.0): a
  "1 · Hideout / 2 · Sprint" switch above the hint says what a tap in the
  hand does. It used to be implied by tap order — the first card was the
  hideout and every later one a sprint — so a player picking their *second*
  first-turn hideout (2, then 11) silently sprinted with it instead.
  - **Choosing a hideout**, each card shows its cost: a gold ✓ inside the
    free reach (last hideout + 3), "+N" for the footprints it would need
    from sprint cards, faded and untappable if even the whole hand can't get
    there. Another card *moves* the hideout; it never becomes a sprint.
  - **Picking one out of reach switches to Sprint** by itself — sprinting is
    the only way there. Sprint is still there by hand for a hideout in
    reach: tucking a spare card under one is a real bluff (the hard computer
    does it), so cards are never greyed out for not being needed. In Sprint
    every card shows "+1"/"+2"; only 42 (no footprints) is faded.
  - The hint is a running total ("Hide at 7 · reach 3 + 4 from 1, 2, 17 =
    7"), the first turn says "hideout 1 of 2" / "2 of 2, or stop at one",
    and a hand that can't reach anything says so rather than explaining ✓.
  - Every card but 42 has at least one footprint (`footprints()`), so every
    card can sprint. Tapping the hideout again starts over.
  - One logic in two places: `FugitiveHiding.swift` (tested in
    `FugitiveHidingTests`, on Linux too) and `hideCost`/`canTapCard`/
    `tapCard`/`hideHint` in play.html. Change one, change the other.
  - **Hide and its way out are pinned to the bottom of the screen**
    (v1.13.1, app 1.7.1) — below the hand and the hint, Hide was off-screen
    on a phone. "Choose a hideout" until one is picked; the way out is a
    plain line under it, not a squashed half-width button. iOS draws the bar
    *over* the table (`HideBar`), with `safeAreaInset` only reserving room:
    as the scroll view's inset it got iOS 26's scroll edge effect and the
    hand showed through. The web bar is `position: fixed` with a spacer.
  - **Lie low names its deck** ("Lie low · draw from 4–14"): not hiding
    draws from the lowest deck with cards, not one you choose (2nd edition,
    `_hide_move`) — the turn's ordinary draw is the one from any deck.
- **iOS: read observable state in `body`, not only inside `ForEach`.** The
  trail's `landing` and the hand's hiding choice were read only inside
  `ForEach` content, which SwiftUI didn't track — a hideout stayed invisible
  after it landed until something else redrew the trail (after a first-turn
  hideout nothing did, so it looked lost), and the badges kept the last
  step. Both are read in `body` and passed down now.
- **The room code is a QR icon in the iOS table's toolbar**, opening a sheet
  with the code large and the invite QR; it used to be text squeezed in
  beside the icons. A game kept on the phone shows no code.
- **The Marshal's notepad is paper**: lined, a red margin, handwriting from
  the device's own fonts. Your cards and seen sprints are struck in pen,
  wrong single guesses ticked in pencil, finds circled green, picks circled
  red, and your own marks crossed in pencil (see Pure mode below).
  The Guess buttons live on the notepad; on a phone it scrolls into view
  when it's time to guess.
- **`el()` sets `style` objects with `setProperty`.** `Object.assign` onto
  `node.style` silently drops custom properties (`--under`, `--tilt`), which
  is how the tucked sprint cards were clipped for a while.
- **Three bundled faces give it its voice**: Bebas Neue (wanted-poster
  capitals — title, card numbers, nameplates), Special Elite (a worn
  typewriter — case tags, notes, stamps, the folder) and Caveat (the
  Marshal's handwriting). Self-hosted in `static/fonts/` like Baloo 2, latin
  subsets only, licences and sources in its README. Body copy stays on the
  system UI face for legibility.
- **Drawn mugshots when there's no photo.** Each player without one gets a silhouette drawn from a hash of their name (`mugshotSVG()`):
  hair or a hat, maybe glasses, a scarf in their own colour — same name,
  same face, on every device — against the role's backdrop: the height
  chart and a booking placard for the Fugitive, the badge for the Marshal.
  The name itself never enters the SVG markup. They're on the nameplates,
  the seat list, the setup rows (live as you type), the pass-and-play
  folder and the records. A player with a profile photo gets that instead
  (see Player profiles).
- **The pass-and-play folder waits for the table to settle**, and the
  opening deal is played when the folder is first opened, not behind it —
  cards in flight are drawn above everything and showed through it.
- No images and no URLs in `fugitive.js` (a test checks).

### Fugitive against the computer (v1.11.0)

One person can play alone, as either role: setup's third choice, "Against
the computer", takes your name, a seat (Swap roles) and Easy or Hard.

- **The computer is on the server** (`games/fugitive/ai.py`, beside
  engine.py), so the web table and the app's online play get it alike.
  `ai.choose(seen, level, rng)` is its whole interface, and `seen` is
  `game.seat_view(state, role)` — exactly what that seat's phone is sent,
  the Marshal's with `candidates`. It never sees the state, so it can't
  cheat; a test spies on every call and checks that.
- **It plays through the same path as a person.** The room keeps
  `computer: {role, level, seed}` and gives its seat a token nobody is ever
  handed (so the seat reads taken, can't be claimed, and can't be freed).
  `computer_moves(room)` runs on every look at the table (`GET /state`):
  if it's the computer's turn and `COMPUTER_DELAY` (1.5s) has passed since
  the last move (`moved_at`), it applies *one* move with `engine.apply` on a
  copy, bumping `seq` like any move. No timers or threads — the 1s poll is
  the clock, a restart picks up where it was, and a Marshal's two draws and
  a guess land a beat apart so the table plays each one out. A move the
  rules refuse (a bug) makes it resign rather than hang the table.
- **Recorded apart, since v1.12.0** (see "Records against the computer").
  The payload carries `computer: {role, level}` only when there is one, so
  the iOS fixtures' shape didn't change.
- **A rematch swaps the computer's seat too**, with a fresh seed.
- **Two levels.** Easy: the Fugitive hides on the lowest card it reaches
  with the fewest sprints, never bluffs; the Marshal draws anywhere and guesses one number from
  anything the notepad leaves open. Hard: the Fugitive picks at random among
  its cheapest options (no sprint, then sprints with dead cards — those
  below the new hideout — then live ones), sometimes tucks a spare dead card
  under as a bluff (`BLUFF_IN_3`), and draws from the deck the trail is
  heading into; the Marshal draws where hideouts could be, guesses every
  pinned hideout at once (candidates never rule out the truth, so they're
  certain), else one number from the narrowest hideout. Both play 42 the
  moment it's reachable, and the Manhunt is always played out (letting go
  can never beat a guess). Over 1,000 computer-v-computer games: Hard v
  Hard ~47% Fugitive wins, Easy Fugitive v Hard Marshal ~21%, Hard
  Fugitive v Easy Marshal ~74%.
- **Its randomness is `Mulberry32`, not `random`** — fugitive.js's
  mulberry32 (and the app's `Seeded`) with the seed taken raw — and every
  draw is an integer pick, so a Swift port can choose identically. The
  per-move generator is `move_rng(seed, seq)`; the seed is secret (or the
  computer's moves could be worked out from the code), from SystemRandom.
- **Offline, it's a Swift port** (app 1.5.0): on a plane there's no
  server, so `ios/.../Offline/FugitiveAI.swift` is ai.py line for line —
  `Mulberry32` with wrapping `UInt32` arithmetic, `moveRNG`, `choose` and
  every helper in the same order — and `OfflineTable` plays it the way
  game.py plays ai.py (see "Offline Fugitive"). It's pinned:
  `tests/test_fugitive_ai.py` writes `Fixtures/fugitive_ai_games.json`
  (every level pairing, and each level against a random player, with the
  decks, the seed and every move — the computer's marked) and fails if
  ai.py stops choosing that way; `FugitiveAITests` deals each game with
  `FugitiveEngine` and, at every computer move, the Swift AI must choose
  exactly that move from that seat's view. **Change ai.py → rewrite the
  fixture (`WRITE_IOS_FIXTURES=1 pytest tests -q -k ai_scripts`) → make the
  Swift agree.** CI runs both halves.
- **The app's setup offers it twice**: "Against the computer" (online:
  `computer: {role, level}` to `POST /fugitive/api/play`, the server plays
  it) and "Against the computer, offline" (OfflineTable plays it). Your
  name, a seat (Swap roles) and Easy or Hard, as on the web. The payload's
  `computer` is what the table reads: its seat shows "Computer · Hard" and
  has no Free seat button.

### Records against the computer (v1.12.0, app 1.6.0)

- **Kept apart from the leaderboard**, in `record["computer"]` of
  Fugitive's stats bucket: `{games_played, players, recent}`, players keyed
  case-insensitively by name like the main records. Only the person gets a
  row — the computer has none. Beating easy a hundred times must never put
  someone above a person who wins games against people, so the leaderboard
  never hears of these games.
- **Per seat and level**: `{role}_{level}_games/_wins` for both seats and
  both levels, plus `games`/`wins`. `computer_leaderboard()` adds the
  per-level totals and `win_rate`, and ranks by wins on hard, then all wins,
  then win rate. `/fugitive/api/stats` carries it as `computer_leaderboard`.
- **Shown under its own heading** on the records page ("Against the
  computer": Hard, Easy and All, each level's wins split by seat in small
  type so four columns fit 375px) and in the app's records as its own
  panel. A resigned-before-the-first-hideout game isn't recorded, as ever.
- **Offline games prove the computer played them.** The upload carries the
  computer's seed, and `replay_offline` checks every one of its moves is
  the one ai.py makes from that seat's view and `move_rng(seed, seq)`, by
  applying both to copies and comparing the states (so the JSON's spelling
  of a move doesn't matter). A phone can't claim a win over a computer that
  played along. This only works because the Swift AI is pinned to ai.py;
  `OfflineTableTests` can write the app's own uploads (`AI_UPLOADS_OUT`) to
  post at a dev server.

### Pure mode, the notepad, the table's extras (v1.15.0, app 1.9.0)

- **Hints are one setting for the table, chosen at the deal** (`hints` on
  `POST /fugitive/api/play`, kept in the room as `hints: false` only when
  off, carried by a rematch). Off is the game as printed: no reach badges
  (✓/+N), no running total, no "up to N" slot, nothing switches to Sprint
  for you, Hide is offered for any card on from the trail (the rules still
  refuse one out of reach), and the Marshal's notepad starts blank with no
  "Pencil in". **The server enforces it**: `payload()` leaves `candidates`
  out, so no device can show the help. Both players see a NO HINTS tag on
  the banner, and the records mark the game ("· no hints"). The computer
  still thinks with its full view — only people go without. Offline games
  keep it in the saved game and send it with the upload. `hints_on()` /
  `parse_hints()` in game.py; `FugitiveHiding.hints`, `payload.hintsOn` in
  the app; `hintsOn()` in play.html.
- **The Marshal's own pencil**: a Guess (Look) / ✎ Mark switch on the
  notepad; in Mark a tap crosses a number out or clears it. Kept per game
  (`fugitive.marks.<code>` / `fugitive:marks:<code>`), with or without hints.
- **A wrong single guess is a pencil tick by the number, not a strike.** It
  only says the number wasn't any hideout *then*; a later hideout can still
  be it, and a strike read as ruled out for good. The candidates (and the
  computer) always knew this.
- **Found cards turn over one at a time** (iOS `turning`, like `landing`:
  held face down until the play-out turns each, "Found · 1 of 2", then the
  next), with a `reveal` sound per card and a heavier `caught`. The banner
  says "The cards turn over…" until they have, rather than announcing the
  result first. Stamps are much bigger on both.
- **At the table folds to one line** once both seats are taken and the game
  is going; a tap opens it, and it opens itself when a seat frees up or the
  game ends (Rematch).
- **Setup (iOS) is three plain choices**: Against (a friend / the computer),
  On (own phones / one device) or Plays (Easy / Hard), and Offline and
  Hints switches; `mode` is worked out from them. Offline turns itself on
  when `Connectivity.online()` says the server is out of reach (see "Poor
  signal"). Two
  columns on an iPad. The paper form uses light controls — dark segmented
  pickers washed out on it. Simulator taps on a SwiftUI Toggle need a
  slightly longer press (`duration: 0.2`) to register.
- **Music** (`App/Music.swift`, iOS only, off by default): synthesised live
  in an `AVAudioSourceNode` — a low pulse and a D minor bass figure, then a
  ticking clock, a heartbeat and a high ostinato as `intensity` rises, and
  the tempo climbs 84→132 in a Manhunt. `FugitiveStore.tension` drives it
  (hideouts found, trail length, how near 42), nil once the game ends.
  Toggles: the table's toolbar and Settings. `.ambient`, like the sounds.

## Wildwood (added v1.17.0)

A card game made for the family's youngest (Louis reads fine, so words on
screen are OK): match the colour or the symbol, wilds change the colour,
first to empty their hand wins. **Our own game in the Crazy Eights family**,
not a copy of a published one: its own name, animals, deck spread and art.
Built exactly the way Fugitive is — read that section first.

- **The rules are the family's choices** (engine.py's docstring has them in
  full): 2–4 players, seven each, 1–9 twice per colour plus two Skips,
  Reverses and Draw twos (104 cards with four Badgers and four Bears).
  Draw twos stack; a Bear (+4) can't be stacked and a Draw two can't go on
  one. The Bear only goes down when you hold nothing of the colour in play —
  enforced, no bluff-and-challenge, which is too fiddly for a child. A drawn
  card that fits may be played or kept. One round is one game.
- **"Last card!" has a penalty.** Say it with the play (the page arms it
  when you hold two) or any time while you hold one. Forget, and anyone can
  catch you until the next player's move lands (`exposed` in the state),
  and you draw two. `call` and `catch` are the only moves made off-turn.
- **Four animals and two wilds**: Fox (red), Frog (green), Owl (blue),
  Duckling (yellow), Badger (wild), Bear (wild +4). Every face is drawn by
  `cardSVG()` in `static/wildwood.js`: a coloured card, an arch into the
  wood, the animal on a hillock, the number or action above. A Skip's animal
  is asleep, a Reverse's looks back. The wilds' mark and the back are four
  leaves crossed, one per colour — deliberately not a four-colour ring, which
  read as someone else's logo.
- **Seats, not roles.** `seats` is a list of tokens; a seat token sees that
  seat's hand, the host token sees the table and runs the room, no token
  watches. One device can hold several seats: pass-and-play, with a
  "Pass to Ana" curtain that waits until the last move has played out.
- **The computer sits after the people**, named for woodland animals
  nobody at the table is called (Hedgehog, Rabbit, Squirrel, Mole), one
  level for all of them. `ai.py` sees one seat's view, nothing else. Easy
  plays the first card that fits and forgets "Last card!" half the time (so
  a child gets to catch it); Hard holds wilds back, aims actions at a next
  player near going out, and always calls and catches. Hard beats Easy about
  two games in three.
- **Reshuffles are seeded** (`shuffle_seed` in the state, `core.seeded`),
  so an offline game replays exactly from its deck, seed, first seat and
  moves. `core/seeded.py` is Fugitive's Mulberry32 moved out to be shared;
  `games/fugitive/ai.py` re-exports it, nothing there changed.
- **Records**: per player wins, games and catches (forgotten calls they
  spotted). Any game with a computer at the table goes in
  `record["computer"]` instead, per person by level, as in Fugitive.
- **A table catching up plays out at most the last ten moves** (`PLAY_OUT`),
  so a phone that slept through several turns doesn't spend a minute
  replaying them.
- **`POST /wildwood/api/offline`** is ready for the iOS app's offline games
  (same checks as Fugitive's: the real rules to the end, every computer move
  the one ai.py makes, once per game id). Nothing uses it yet.

### Wildwood on iOS (app 1.11.0)

- **Online, it's play.html in Swift** (`WildwoodStore`, `WildwoodTableScreen`,
  `WildwoodSetupView`, `WildwoodRecordsView`): the same seats and tokens, the
  pass-and-play curtain, the play-out (a card onto the pile, cards into
  hands, Last card!, Caught!) capped at the last ten entries as on the web.
  The card faces are the web's own drawing rendered to PNGs
  (`node ios/scripts/render_wildwood_cards.js`, with Playwright, or
  `playwright-core` and `CHROMIUM_PATH` set to a cached Chromium); re-render
  whenever `cardSVG`/`backSVG`/`critterSVG` change.
- **Offline, the rules and the computer are Swift ports**
  (`WildwoodEngine.swift`, `WildwoodAI.swift`), pinned exactly as Fugitive's
  are: `tests/test_wildwood_offline.py` writes `wildwood_engine_games.json`
  (every state, refusal and some views) and `wildwood_ai_games.json` (every
  computer choice), and `WildwoodEngineTests` replays both. **Change
  engine.py or ai.py → `WRITE_IOS_FIXTURES=1 pytest tests -q -k
  wildwood_offline` → make the Swift agree.** The view is the app's own
  `WildwoodGame`, so the offline table, store and computer read one shape.
- **`WildwoodOfflineTable`** is game.py's room on the phone (a file per code
  under Application Support/Wildwood/Offline): the same payloads, tokens,
  refusals, computer turns (one per look after 1.5s) and rematches. A
  finished game keeps its deck, reshuffle seed, first seat and moves, and
  `WildwoodOfflineUploads` posts it to `/wildwood/api/offline` once there's
  signal (hub, records, game end). A Swift-made game against two Hard
  computers was posted to a dev server and recorded, once.
- **Nearby play is up to four phones.** `NearbyLink.swift` now carries bytes
  under one Bonjour service per game (`gn-fugitive`, `gn-wildwood`, both in
  `NSBonjourServices`), matching answers to requests by their `id`; the host
  answers each guest on its own. `WildwoodNearby.swift` is Wildwood's calls
  over it. Offline with "A phone each", the dealing phone sits in seat 1 and
  advertises while any person's seat is free; the others "Join a nearby
  game" from setup and tap their name. Needs real devices to try — the
  Simulator has no peers.
- **The AASA file claims `/wildwood/play/*`** since v1.17.1, added once
  app 1.11.0 was on TestFlight (claiming a path sends it to every installed
  version of the app).

## Final Approach (added v1.18.0)

A solo air-traffic game: aircraft arrive at the edges, you drag from one to
draw its route, and it lands if the route ends lined up with the approach
lights of a runway in its colour. Two touching is a collision (shift over);
three diversions (out of fuel, flown into a storm) is the same. **The full
picture — what it is, how it's built, where it's going — is the playbook,
`docs/final-approach/PLAYBOOK.md`.** Read it before changing the game; keep
it current when you do (its "Current state" and roadmap especially).

- **Our own game in a genre, not a remake.** Path-drawing landing games are
  a genre (the early iPhone hits among them); this one has its own name,
  mechanics (colour-coded runway kinds, the lined-up approach rule, fuel,
  drifting storm cells, wind shifts that reverse the runways), airports and
  art. Don't borrow another game's names, levels or look.
- **All client-side, one route.** `games/final_approach/game.py` serves
  `/final-approach/`; everything else is `static/final-approach/`:
  `levels.js` (airports, palettes, traffic), `art.js` (terrain painter,
  sprites, live layers), `flap.js` (the split-flap component), `game.js`
  (simulation, input, UI, save). Loaded in that order as plain scripts —
  they share globals (`THEMES`, `LEVELS`, `Art`, `Flap`). No rooms, tokens
  or records yet; records against profiles are the next step (playbook).
- **Its own stylesheet, not the shell's.** The page overrides `shell_css`:
  the shared `.btn`, `.row` and `button` rules leaked into the board. It
  still extends base.html for the manifest and icons.
- **Progress is per browser** (`final-approach:save` in localStorage:
  stars per airport, the Endless best, mute). The home-screen app and Safari
  keep separate storage on iOS, as for Flip 7's scorekeeper.
- **The game id has a hyphen** (`final-approach`, so the URL reads well);
  the package is `final_approach`. The blueprint, the art file and the
  static folder use the id.
- **Oswald and Barlow, bundled** (`static/final-approach/fonts/`, OFL, with
  licences). Oswald is the split-flap face — chosen over Antonio, Barlow
  Condensed and B612 Mono for looking most like a Solari board at phone
  size. Same no-CDN rule as everywhere; a test checks the page, scripts and
  CSS carry no absolute URLs.
- **Runway numbers are painted into the terrain, so the game waits for the
  fonts** (`document.fonts.load`, 2.5s cap) before painting the first
  airport.
- **A fixed 960×600 world, letterboxed.** Phones held upright get a "turn
  sideways" overlay, and the game pauses behind it.
- **The terrain is painted once per airport (and per resize) into an
  offscreen canvas** at the screen's resolution, seeded by the level id so
  an airport always looks the same; per frame only the live layers draw.
- **No arrival can fail you before you've had a chance** (v1.19.0). Storms
  drift in straight lines and bounce off the edges, so `stormAt` predicts
  them exactly, and `queueArrival` only accepts an entry whose straight-line
  flight stays clear of every storm from the moment its marker shows until
  it has flown for `SAFE_FLIGHT` (5s). If every way in is blocked it waits a
  second and tries again; crowded is an acceptable fallback, into a storm
  never is. It used to accept any entry on its last attempt, and an arrival
  could appear inside a storm and divert at once.
- **The same promise for traffic** (v1.21.1). An arrival used to be checked
  only for other aircraft near its entry point, with a crowded entry
  accepted as a last resort, so one could appear and fly straight into an
  aircraft already on screen. Now `track(p, secs)` predicts each aircraft
  (along its route, then straight on, turning back at the edges; dropping
  out once it's on the ground), and `clearOfTraffic` only accepts an entry
  whose first `SAFE_FLIGHT` seconds stay outside *warning* distance (2.6×
  the combined radii) of everyone, arrivals still waiting at the edges
  included. Routes change after an entry is chosen, so `admit()` checks
  again at the moment of arrival: in if clear, else swung up to ±0.75 rad
  onto a clear heading, else held at the edge (band full) and retried every
  0.3s. A ten-minute no-input stress test of Night Shift and Endless went
  from 9 collisions within 5s of arriving (and ~280 frames of brand-new
  arrivals in conflict) to none, with about the same number of arrivals.
- **Arrival markers and route handles are sized in screen pixels**, not
  world units (`Math.max(16, 16 / view.scale)` and `11 / view.scale`), so
  they stay finger-sized on a phone. Markers never sit under the HUD's
  plates: `underHud` rules those stretches of the top edge out.
- **A route can be carried on from its end** (v1.19.0): `pickAt` offers the
  nearest aircraft or unfinished route end, a near-tie going to the aircraft;
  grabbing an end continues the route instead of clearing it. Locked routes
  have no handle.
- **Recorded sound and music** (v1.20.0; dialogue v1.21.0): 114 MP3s in
  `static/final-approach/audio/` (about 5.3 MB), made once with ElevenLabs by
  `tools/final_approach_sounds.py`, which holds every sound's prompt. To
  change a sound, change its prompt and run the script with its name. The
  key lives in `~/.config/elevenlabs/env` on the dev VM, never in the repo,
  and the game never calls ElevenLabs. `game.py` lists the files present,
  and the page gets their cache-busted URLs as `window.FA_AUDIO`; anything
  missing or not loaded yet falls back to the old synth. Effects preload on
  the first tap; beds, engines and music load when first needed.
  - Four buses: effects, the landscape's **bed** (one loop per theme),
    **engines** (one loop per family: jet/heavy, prop, heli, louder with
    more aircraft and panned to their average position) and **music**
    (board theme off-shift; calm or busy on shift, busy when 70% of the
    traffic cap is up or two aircraft are in conflict, calm again only after
    10 quiet seconds).
  - **Loops cross-fade each repeat** (`startLoop`) rather than looping the
    buffer: MP3 pads both ends with silence, which would click.
  - The conflict alert stays synthesised (a two-tone), as it repeats and
    needs no recording.
  - **Variants are dealt, not picked** (`deal(prefix)`, v1.21.0): every file
    named `prefix` or `prefix_*` is a variant, shuffled like a deck, all
    played before any repeats and never the same one twice running. Every
    one-shot fades in, and out over its tail (`fadeOut`); a touchdown within
    2s of another plays quieter.
  - **Radio dialogue** (v1.21.0): 85 spoken lines (`say_*`, `tower_*`) made
    with ElevenLabs text-to-speech in eleven voices (British, Australian,
    Irish, American; the tower is one voice), recorded clean. The game adds
    the radio live: `bus.radio` is a band-pass (380 Hz–3 kHz) and a soft
    clipper, and `say()` puts a squelch either side. One call at a time,
    3.5s quiet after; `priority` calls (fuel, maydays, diverts, the tower)
    queue (at most two) instead of being dropped; bed and music duck under
    speech. Readbacks name the runway end actually in use
    (`say_land_<designator>`), so `runway_numbers()` in the generator reads
    levels.js and a test checks every painted number has lines: **a new
    runway angle means running the generator.** The key needs the Text to
    Speech permission; listing voices isn't needed (voice IDs are in the
    script).
  - The sound function is `playSound`, not `play`: `play()` starts a shift,
    and a function named the same in the same scope replaced it once (every
    effect started a new shift until the stack overflowed).
- **`window.__finalApproach`** exposes the state for Playwright checks,
  plus `update` (step the simulation, e.g. ten minutes in a loop),
  `queueArrival`, `clearOfStorms`, `stormAt`, `clearOfTraffic`, `track`
  and `sound` (load, buffers, the soundscape's state). `S.crashes` records
  each collision's two ages, for checks.
  There's no JS test runner; `tests/test_final_approach.py` pins the page,
  its files and the level data's shape, and visual changes are checked by
  driving the page in a headless browser at desktop and phone-landscape
  sizes (the playbook has the routine).
- **Not in the iOS app.** The native hub's tiles are its own; the cheap way
  in is a tile opening `/final-approach/` in the Safari sheet, like Keep
  score (playbook roadmap).

## Picnic Raid (added v1.22.0)

Our own game, made for the family the way Wildwood was: fill a picnic
basket, pack it up to bank the points, and hide traps (Ants, Wasp, Seagull,
Dog) under everyone else's blanket; Shoo! sends one back, Umbrella stops it.
First to 20 with the round played out. **Built exactly the way Wildwood is**
— game.py is its game.py function for function, minus the offline replay —
so read that section first. Web only: no iOS screens, no AASA path.

- **The rules came out of a playtest, and engine.py's docstring says why
  each one is there** — don't change one without re-running the harness
  (`games/picnic/playtest/`, its README says how; `compare.py`'s `BASE` is
  what the engine plays). The draft lost to a player who never trapped,
  buried the youngest under six traps, and had a hoard-under-a-full-blanket
  loophole; free traps, one-of-yours-per-blanket (two in all) and a basket of
  five are what fixed them. The harness is a separate model, not the engine.
- **"Whose move" is `engine.turn`, never `state["turn"]`.** A pack-up pauses
  at each trap for whoever it's on to defend (stage `spring`), and a Shoo!
  sent back makes the *hider* decide, off their turn. The computer, the
  pass-and-play curtain and the poll all go by `turn`. Someone with no
  defence in hand isn't asked: the trap lands at once.
- **Traps are free and come first**: `hide` (once, round 2 on), then one of
  `lay`/`pack`/`pass`, then `discard` if over six. Loot (Ants, Seagull)
  ignores the five-snack limit; `basket_room` never goes below 0.
- **Secrets**: hands, and which trap is which, are seen only by the hider
  (`blankets[n][i].card` is None for everyone else, `mine` marks your own).
  The hider isn't named until the trap springs. `hide`, `draw` and
  `discard` log entries are redacted the same way.
- **The computer** (`ai.py`): Easy is the playtest's kid — traps the biggest
  basket, packs at a random 5–8, always defends. Hard banks any basket of 4
  while its blanket is clear (the one real skill the playtest found — it
  takes Hard from barely better than Easy to ~1.25–1.55× a fair share),
  otherwise packs at 7, and saves Shoo! for traps worth sending back.
  Computers are Bramble, Pip, Clover and Tansy.
- **Card faces are pictures, not code-drawn SVG** — the owner wants real
  artwork. `static/picnic/cards/<code>.webp` (or `<kind>.webp` for all of a
  food, with the number laid over) is used the moment it exists; game.py's
  `card_art()` lists what's there so nothing missing is fetched, and every
  card without one is a plain CSS placeholder. `games/picnic/ART.md` is the
  brief: sizes, names, style, prompts. A test keeps its names in step.
- **The table holds still during a play-out**: new log entries play as
  bursts over the board as it stood, and the board is redrawn after, so a
  trap turns over before anyone sees what it took. `.pr-playing` stops taps
  meanwhile. A pack-up is ~3s of bursts plus 1.5s per computer decision.
- **Records**: wins, games and best score per player; a shared win counts
  for each. Games with a computer go in `record["computer"]`, as Wildwood's.

## Player profiles (added v1.8.0)

A name and, optionally, a selfie that follow a player into every game:
`core/profiles.py` (store, photo processing, routes — a hub blueprint, the
one thing besides the games that `app.py` registers), `templates/me.html`
(the "You" page), `static/profiles.js` (`GN.me`, `GN.profiles`,
`GN.avatar`, `GN.picker`, used by every game page).

- **A profile is a claimed name, nothing more.** Records have always keyed
  players by their name, case-insensitively; a profile is that same name,
  so every record lines up with no migration and guests carry on exactly as
  before. Faces are looked up by name on the client (`GN.profiles.photo`),
  so no game's payload or record shape changed. Names are unique ignoring
  case; renaming isn't offered (it would orphan the records' key).
- **Devices hold profiles; there are no accounts.** Guests can't use
  Authelia, so making a profile gives *this device* a random token
  (`gamenight:me` in localStorage), stored server-side only as a SHA-256.
  Only a device holding one of a profile's tokens can change its photo or
  delete it. Another device joins by scanning a one-time link code from the
  first (`/me/link/<code>`, ten minutes, in memory, redeemed by a POST from
  the page so a link preview can't spend it; wrong codes count against the
  room-code throttle). Up to `MAX_DEVICES` tokens per profile.
- **Photos are redrawn, never stored as sent.** The page crops a square on
  a canvas first (which already drops the file's metadata); the server then
  decodes with Pillow (`MAX_IMAGE_PIXELS` as a bomb guard), applies EXIF
  rotation, crops to 320×320 and saves a fresh JPEG — no EXIF, so no
  location — as `data/profiles/photos/<id>-<random>.jpg`. A new photo gets a
  new random name, so photos are served `immutable` and the old file is
  deleted. Photo filenames are pattern-checked before touching disk.
- **Public by design, and the page says so.** `/api/profiles` and the photos
  are on the public router like the leaderboards, because guests join by QR
  without signing in. The "You" page states this above the camera button.
  There is no admin UI: to take a photo down, delete its file and clear
  `photo` in `data/profiles.json` on vm-core (or add an Authelia-protected
  route — remember the docker repo's Traefik rule).
- **The last device out deletes the profile.** Signing out leaves the
  profile for your other devices, but a profile no device holds could never
  be changed or deleted, and its name would stay claimed for good — so the
  last sign-out removes it and its photo. `/forget` answers `deleted` so
  the page and the app can say so.
- **A photo upload needs a length.** `Content-Length` is what caps the read
  (Werkzeug stops there), so a chunked body — no length, read to the end
  whatever its size — is a 411 before anything is read.
- **`profiles.json` follows the stats rules**: atomic writes with a `.bak`,
  a damaged file is never written over (503 via `DataUnavailable`) and reads
  fall back to the backup.
- **Where faces show**: the hub's "You" chip; Flip 7's setup chips, a
  "Regulars — tap to add" picker (scorekeeper and play), the table's mats
  and the records; Fugitive's setup picker, nameplates, seats ("That's me —
  sit" on a signed-in device), the pass-and-play folder and the records —
  there, a photo replaces the drawn mugshot (faded a touch for the
  Fugitive, with the booking number on big ones). No photo: initials, or
  the drawn mugshot in Fugitive.
- **iOS (app 1.2.0)** has a native "You" (`YouScreen`: camera selfie,
  library photo, sign-in QR for another device, sign out, delete) and the
  same faces — `AvatarView` (photo or initials in the web's hue) and
  `RegularsPicker` in Flip 7's setup, mats and records; `Mugshot` in
  Fugitive. `Faces.shared` holds the public profile list, refreshed when the
  hub appears; this device's profile is `gamenight.me` in UserDefaults. The
  photo is cropped to a square on the phone and the server redraws it as
  always. `/me/link/*` is claimed by the AASA file, so a sign-in QR scanned
  with the Camera opens the app.

## Hub artwork

- Each game's menu tile has an SVG in `templates/art/<id>.html` and an
  `accent` colour on its `GameSpec`. A tile that doesn't start a room
  shows `hub_action` as its call to action. Both are required — a test fails a
  game that has neither, since it would render as a blank untinted card.
- The drawings share a vocabulary (`.art-plate`, `.art-pip`,
  `.art-stroke`) so a third game inherits the same card stock instead of
  inventing its own. ito's tile is the card's scale line; Flip 7's is a
  three-card fan with the 7 face up; Fugitive's is the trail — two
  face-down hideouts, footprints, and 42 turned up; Final Approach's is a
  runway with its approach chevrons lit and a jet coming in on a dotted
  route.

## Pixel art (the pxl skill)

- **Use pxl for raster game art** — sprites, card faces, icons, tiles,
  animated GIFs, sprite sheets. It's a Claude Code skill
  ([uilianks/pxl](https://github.com/uilianks/pxl), MIT, a fork of
  crsolver/claude-pxl): art is written as a `.px.js` file and built to PNGs.
  Its `SKILL.md` has the workflow; the short version is write → `build
  --only <name>` → look at `out/_preview/<name>.png` → patch, and
  `lint <name>` before calling a sprite done.
- **It isn't in git.** It lives in `.claude/skills/pxl-pixel-art/`, which is
  gitignored (and `.claude/` is dockerignored), so a fresh clone doesn't have
  it. Install it on a new machine, pinned to the commit that was checked:
  ```bash
  git clone https://github.com/uilianks/pxl.git .claude/skills/pxl-pixel-art
  git -C .claude/skills/pxl-pixel-art checkout a012fc78b92e5deff27e56bba563f22895c3916c
  ```
  Needs Node ≥ 22.18. Update by checking out a newer commit deliberately,
  not by pulling blind — a skill runs code on this machine.
- **CLI**: `node .claude/skills/pxl-pixel-art/bin/pxl.js build|serve|lint|ascii|trace …`.
  `serve` is the live viewer (http://127.0.0.1:4321/); its annotate mode
  writes `out/_feedback/<asset>.json`, which is what "check the feedback"
  means.
- **The output is a file like any other asset.** The server and the iOS app
  never run pxl: the built PNGs go into `static/` (or an asset catalogue) and
  get committed, and nothing new runs at runtime — the same rule as the
  rasterised icons. Keep the `.px.js` source alongside so the art can be
  rebuilt; `out/_preview/` and `out/_feedback/` are working files.
- **Same art rule as everywhere else**: our own designs, not the published
  games' art (see Fugitive's cards). `pxl trace` / `image()` turn a PNG into
  pixel art — never feed them a scan of a real card.

## Known rough edges / good next steps

- Flask dev server (`app.run(...)`) is fine for a living-room game but
  not hardened — swap to gunicorn if this ever needs to handle more
  than a handful of concurrent players.
- Driving an ito room needs its host token (v1.10.0), so a guessed code
  only lets someone watch a topic. In production Traefik also puts
  `/ito/host`, `/ito/settings`, `/ito/api/topics*`, `/ito/api/stats/reset`
  and `/flip7/api/stats/reset` behind Authelia, so nobody without a sign-in
  edits topics or wipes stats.
- Room codes are throttled, not secret: `core/ratelimit.py` counts wrong
  guesses per IP (15 per 5 min, then 429). Two invariants worth keeping
  — only *failures* count (players poll every 2s), and a correct code
  always works even from a blocked client and clears its failures, so a
  scanner can't lock out a guest sharing their NAT. ito's rules and stats
  pages count too (`core.rooms.find_room`): they render with or without a
  room, but whether the back link named one told a scanner the code was
  live.
- `/healthz` deliberately reports no room count: it's public, and the
  count tells a scanner whether guessing is worth the effort.
- Topic editing (`/ito/api/topics`) is global and has no auth of its own;
  in production it's behind Authelia with the host pages. It lives on
  `/ito/settings/<code>` rather than the host screen, which keeps the
  host page to controls you'd actually touch mid-round.
- Rooms are in-memory, so a restart mid-game drops the current room.
  Stats and topics survive.
- Tests are smoke-level for routing, rooms and stats; the Flip 7 engine
  has real rule tests. The scorekeeper's scoring is still only pinned by
  string-matching its JS — there's no JS test runner in this project.
- iOS keeps a home-screen app's storage apart from Safari's. A scorekeeper
  game (or a Play token) from Safari won't be in the installed app.
- Not yet tried on a device: signing in through Authelia from the
  installed web app (the home-screen one, not the iOS app — it affects the
  ito host pages: iOS opens an off-scope login in a sheet, and the cookie
  may not come back with it). The iOS app no longer needs it.
- A device that's both the dealer and a seat must only treat an answer to
  its *seat* token as news about its seat: a move made as the dealer comes
  back with `you.role == "host"`. Getting this wrong dropped the seat of a
  dealer covering someone's turn (fixed in play.html and the app alike).
- Seats are claimed by whoever taps first. A guest who knows the code can
  sit in someone else's seat; the dealer frees it. Fine for a living room,
  not for anything adversarial.
- `flip7:seat` holds one seat per browser, so two "phones" in tabs of one
  browser share it. To test a host and a phone on one machine, use
  `localhost` for one and `127.0.0.1` for the other — separate storage.
- A Flip 7 spectator room shows the board as of the last successful push.
  A failed push is shown in the share panel and retried on the next change,
  not on a timer, so watchers can sit a round behind until then. Fine for
  standings, not for anything timed.
- Flip 7's in-progress scores are per-browser. Clearing site data or
  switching device mid-game loses the night — only the finished game is
  posted, so there's nothing on the server to recover mid-game from.
- `/flip7/api/stats/games` is unauthenticated, like ito's topic editing,
  and its validation (player/round/score bounds) is there to stop a bug or
  a bored guest filling the leaderboard with junk — not real auth.
  `/flip7/api/stats/reset` wipes records for everyone, so it's behind
  Authelia in production and asks twice in the UI.
- API bodies are type-checked: a JSON list, or a number where a name or
  category should be, is a 400. Several routes used to call `.get()` /
  `.strip()` on whatever arrived and 500.
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

Watchtower on vm-core runs **once a day, at 02:00** (`WATCHTOWER_SCHEDULE`
in the docker repo's `docker-stacks/vm-core/docker-compose.yml`), so a
merge to `main` goes live the following night, not within minutes. To ship
sooner, pull and restart the `gamenight` service on vm-core by hand. Don't
read a stale `/healthz` on the evening of a merge as a broken deploy.

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

- **Two Traefik routers on one host.** The host and admin surface goes
  through `auth@file` (Authelia): `/ito/host`, `/ito/settings`,
  `/ito/api/topics*`, `/ito/api/stats/reset` and `/flip7/api/stats/reset`.
  Everything else is public — the hub, `/join`, the player and watch views,
  state polling, the Flip 7 scorekeeper and its record/board posts, and
  ito's room API (`/ito/api/rooms`, and draw/result/reset, which check the
  host token themselves since v1.10.0) — because guests scan a QR to join
  and can't have accounts. **Deploy order matters for a rule that loosens:**
  the server that checks the token must be live before Traefik stops
  checking the sign-in. This is the only stack there that isn't wholly
  behind Authelia — deliberate. A new host-only route needs adding to that
  rule in the docker repo (`docker-compose.gamenight.yml`).
- **`ProxyFix` is required**, not optional. QR codes are built from
  `request.host_url`; without trusting Traefik's `X-Forwarded-*` they'd
  encode `http://10.0.5.9:5000/` and no phone could reach it.
- **Exactly one gunicorn worker.** Rooms are a per-process dict, so a
  second worker would serve some requests from a process that's never
  heard of your room. Threads give the concurrency instead. Scaling past
  one process means moving room state out of memory first.
- A bind mount shadows the image's `data/`, so anything the app needs
  there must be seeded at runtime, not baked into the image. See the
  topics note above; it cost a broken first deploy.
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

# iOS's non-UI Swift on Linux (Docker; or `swift test` with Swift 6.2)
ios/LinuxTests/run.sh

# iOS (needs Xcode + XcodeGen)
cd ios && xcodegen && open GameNight.xcodeproj
xcodebuild test -project ios/GameNight.xcodeproj -scheme GameNight \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro'

# docker
docker compose up -d --build
docker compose logs -f
docker compose down
```
