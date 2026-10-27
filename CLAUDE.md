# Project context for Claude Code

## What this is

**Game Night** — a hub for companion web apps to physical board games.
It holds three: *ito* (cooperative, secret-number ordering game),
*Flip 7* (push-your-luck card game) and *Fugitive* (two-player
hidden-movement card game, played entirely on the app — see its section).
`/` is the menu — it used to redirect straight to ito when ito was the
only game.

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
  build step, no framework. Player page polls
  `/ito/api/<code>/state` every 2s.
- Single container via `Dockerfile` + `docker-compose.yml`.
- Smoke tests in `tests/test_smoke.py` (`pytest tests -q`).
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
  chrome. `join.html` and ito's landing gained one for this.

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
seat), Fugitive (since app 1.2.0), both games' records, ito's topic display
and player profiles. Rules pages, ito hosting
and a scorekeeper's spectator board open the server's own pages in an
in-app Safari sheet rather than being rebuilt.

- **The server is still the game.** The app holds no rules: it shows the
  table from `/flip7/api/play/<code>` and sends moves, exactly like
  `play.html`. Anything rule-shaped belongs in `engine.py`, not in Swift.
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
  Python suite if the API's keys drift — iOS tests don't run in CI.
- **The invite QR opens the web table**, not the app, so a phone without
  the app can still join.
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
  (`.keepsScreenAwake()`): they sit on the table for an hour.
- **ito's card is drawn natively** from the same geometry as
  `ito/_card.html` — the scale line and the back's swirl are the SVG paths,
  ported point for point, and the deal is the same edge-on swap.
- **ito hosting isn't native**: its host pages sit behind Authelia, which
  a native app can't get through, so "Host a room" opens the web page.
  Native hosting needs a token or OIDC decision first.
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
  version with the app's endpoints (v1.6.1+; v1.8.1+ for app 1.2.0) before
  a build goes out.
- **`.dockerignore` keeps `ios/` out of the server image.**
- **QR codes are scanned in the app** (`ScanSheet`, VisionKit's
  `DataScannerViewController`, QR only), from the hub's toolbar and the Join
  screen. What it reads goes through `Joining.destination(for:)` — the same
  path as a link opened from outside — so a room QR and a profile sign-in QR
  both work. `NSCameraUsageDescription` covers this and the selfie.
- **App links claim what the app shows**: `/flip7/play|watch`, `/fugitive/play`,
  `/ito/play`, `/join?code=` and `/me/link`. Claiming a path sends it to every
  installed version of the app, so claim a new one only once a build that
  handles it is on TestFlight.

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
  Manhunt washes the screen red and blue, an escape flies a plane off. Only a
  fresh deal is dealt out.
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
- **Offline play** is still the plan from the Fugitive section: not in 1.2.0.

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
  side by side, Join beside the title, one gold button at a time. New game
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
- **No admin routes**, so nothing new for the Authelia rule in the docker repo.
- **iOS is native since app 1.2.0** (see "Fugitive on iOS" below), and the
  AASA file claims `/fugitive/play/*`.
- **Offline (plane) play is planned for the iOS app only**: one device
  hosts over MultipeerConnectivity. That needs the rules in Swift too — the
  one deliberate exception to "rules live in engine.py" — so the Swift
  engine must be pinned to this one by fixtures: scripted games (moves,
  expected views, expected errors) generated by the Python suite and
  replayed by the Swift tests. An offline game's moves are uploaded later
  and replayed here before they're recorded.

### Fugitive's table (v1.7.0)

- **A desk, not a dashboard.** The page is a detective's desk at night:
  dark wood lit from above, a street map spread on it (`cityMap()`, seeded
  by the room code so every device shows the same city) with the trail laid
  across it, the three decks below, the other player's hand fanned as backs
  across the table and yours fanned at the bottom. The table view seats the
  Marshal across and the Fugitive near.
- **Every card is drawn, not shipped** (`cardSVG()` in `static/fugitive.js`):
  a night scene seeded by the number, so the same card looks the same on
  every device. The era follows the rulebook's deck icons — 0 the cell, 1–14
  on foot, 15–28 by car, 29–41 the airfield, 42 the plane out at sunrise —
  with corner numbers, shoe prints for footprints and the deck icon. The
  **back is one design for every card**: a deck icon on the back would say
  which third of the trail a face-down hideout is in.
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
- **The Marshal's notepad is paper**: lined, a red margin, handwriting from
  the device's own fonts. Your cards and seen sprints are struck in pen,
  wrong single guesses in pencil, finds circled green, picks circled red.
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
  face-down hideouts, footprints, and 42 turned up.

## Known rough edges / good next steps

- Flask dev server (`app.run(...)`) is fine for a living-room game but
  not hardened — swap to gunicorn if this ever needs to handle more
  than a handful of concurrent players.
- No auth on host URLs in the app itself — knowing a room code is the
  only gate there. In production Traefik puts `/ito/host`, `/ito/settings`,
  `/ito/api/topics*`, `/ito/api/stats/reset`, `/flip7/api/stats/reset` and
  `/ito/api/<code>/draw|result|reset` behind Authelia, so a guessed code
  only lets someone watch a topic — not drive the game, edit topics or
  wipe stats.
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
  installed app (it affects the ito host pages — iOS opens an off-scope
  login in a sheet, and the cookie may not come back with it).
- ito's player display (`/ito/play/<code>`) has no way back, which is fine
  in a browser tab and a dead end in the installed app.
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
  `/ito/api/topics*`, `/ito/api/stats/reset`, `/flip7/api/stats/reset` and
  `/ito/api/<code>/draw|result|reset`. Everything else is public — the hub,
  `/join`, the player and watch views, state polling, the Flip 7
  scorekeeper and its record/board posts — because guests scan a QR to join
  and can't have accounts. This is the only stack there that isn't wholly
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

# iOS (needs Xcode + XcodeGen)
cd ios && xcodegen && open GameNight.xcodeproj
xcodebuild test -project ios/GameNight.xcodeproj -scheme GameNight \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro'

# docker
docker compose up -d --build
docker compose logs -f
docker compose down
```
