# Final Approach: playbook

What the game is, how it's built, what it wants to be, and how we plan to
get there. Keep it current: when something here stops being true, change
it in the same pull request as the code.

![The arrivals board](img/arrivals-board.jpg)

---

## 1. What it is

**Final Approach is a solo air-traffic game.** Aircraft arrive at the edges
of an airport seen from above. Drag from one to draw its route; if the route
ends lined up with the approach lights of a runway in the aircraft's colour,
it lands. Keep everything apart while the traffic builds.

- **The loop:** spot an arrival → draw its route → watch for conflicts →
  redraw → land it → repeat, faster.
- **A session** is one airport: 6 to 24 landings, about three to six
  minutes. Endless mode runs until you fail.
- **Failing:** two aircraft touching is a collision and ends the shift at
  once. An aircraft that runs out of fuel or flies into a storm *diverts*
  (a strike); three strikes end the shift.
- **Progress:** stars per airport for strikes avoided (3 = none), and
  clearing an airport unlocks the next. Endless unlocks after airport 5 and
  keeps a best score.

### Where it came from, and what's ours

It's a game in the path-drawing landing genre that some of the early
iPhone hits belonged to. **It is our own game, not a remake of any of
them**: its own name, rules, airports and art. What makes it ours:

- **Runway kinds by colour**: yellow props use the short strip, red jets
  and heavies the long runway, blue helicopters the pad.
- **The lined-up rule**: a route only lands if it comes in along the
  approach lights, not from the side. That makes the angle of approach the
  core skill.
- **Fuel, drifting storm cells, and wind shifts that reverse the runways**
  mid-level, each introduced by its own airport.
- **The look**: a painted mid-century airfield under a split-flap
  departures board, with no image files at all.

Keep it that way: don't borrow another game's names, level layouts or art.

![Thunderheads: storm cells over a coastal airport](img/thunderheads.jpg)

---

## 2. What it wants to be

### The pitch

*The calm-then-frantic pleasure of being a good air-traffic controller, in
a few minutes, on the phone you already have in your hand. It should look
like something you'd frame.*

### Pillars

Every feature should serve at least one of these and harm none.

1. **Readable at a glance.** Colour says where an aircraft goes; the
   approach lights say from which way; a red line says two are too close. A
   new player should land their first plane without reading anything.
   Nothing on screen should need explaining twice.
2. **Calm tension.** Pressure comes from traffic building, not chaos. Every
   failure should feel like *your* mistake, with a visible warning first:
   arrivals are announced two seconds ahead, conflicts flash before they
   collide, the fuel gauge appears long before the tank is dry.
3. **Made with care.** The art is the game's personality: hand-tuned
   palettes, painted fields, runway numbers that are actually right,
   split-flap tiles that really flip. Polish is a feature, not a phase.
4. **Pocket-sized.** Landscape phone first, three-to-six-minute sessions,
   instant resume, works on the LAN with no internet. No accounts, no
   loading screens.
5. **Ours, as a family.** It belongs in Game Night: faces, records and
   friendly rivalry across the family, not strangers' leaderboards.

### Not goals

- **A real ATC simulator.** No altitudes, no radio phraseology, no
  real-world airports.
- **Ads, purchases, accounts or third-party anything.**
- **Real-time online multiplayer.** Our servers poll; if we do two
  players, it's on one screen or turn-based (see the roadmap).

---

## 3. How to play (the rules as built)

| Aircraft | Colour | Lands on | Speed (world units/s) | Separation radius |
|---|---|---|---|---|
| Prop | Yellow | Short strip | 30 | 11 |
| Jet | Red | Long runway | 44 | 13 |
| Heavy | Red, bigger | Long runway | 50 | 18 |
| Helicopter | Blue | Helipad, any direction | 24 | 10 |

- **Landing:** the route has to reach a circle (radius 26) just short of
  the active threshold, travelling within about 70° of the runway heading.
  Pads accept any route ending within 24 of the centre.
- **Separation:** aircraft closer than 2.6× their combined radii are in
  conflict (red rings and a dashed red line, plus a beep). Closer than their
  combined radii is a collision.
- **Edges:** an aircraft without a route flies straight and turns back at
  the edge of the map.
- **Fuel:** a gauge ring appears below 40% and flashes red below 15%.
- **Storms:** flying inside 80% of a storm cell's radius diverts the
  aircraft.
- **Wind shifts:** five seconds' warning, then every runway reverses. Any
  aircraft on approach to a runway's old end has to go around.
- **Traffic:** the gap between arrivals eases from the airport's start
  value to its end value as you land aircraft (in Endless, over five
  minutes). Each airport caps how many can be in the air at once, and stops
  sending arrivals once enough are inbound to reach the target.

### Airports

| # | Code | Airport | Landscape | Target | New idea |
|---|---|---|---|---|---|
| 1 | MDS | Meadow Strip | Meadow | 6 | Drawing routes |
| 2 | TWF | Twin Fields | Meadow | 10 | Jets and colour matching |
| 3 | RTW | Rotor Wash | Coast | 14 | Helicopters and pads |
| 4 | XRD | Crossroads | Desert | 16 | Angled runways |
| 5 | FUM | Running on Fumes | Meadow | 16 | Low fuel |
| 6 | THD | Thunderheads | Coast | 18 | Storm cells |
| 7 | WVN | Weathervane | Snow | 18 | Wind shifts reverse runways |
| 8 | HVY | Heavy Metal | Snow | 20 | Heavies, two long runways |
| 9 | NGT | Night Shift | Night | 24 | Everything, after dark |
| ∞ | INF | Endless | Coast | — | Traffic keeps building |

![Heavy Metal: a heavy on final, a near miss, a low-fuel prop](img/heavy-metal-traffic.jpg)

---

## 4. How it's built

### Where it lives

Final Approach is a game in the Game Night hub (`JamesSnaps/ito-app`),
served at `/final-approach/`. Unlike the hub's other games, **it runs
entirely in the browser**: the server's only job is the page.

```
games/final_approach/game.py        blueprint: one route, the GameSpec (accent #e8553f)
games/final_approach/templates/final_approach/play.html   the page: canvas + overlays
templates/art/final-approach.html   the hub tile's drawing
static/final-approach/levels.js     THEMES (landscape palettes) and LEVELS (airports, traffic)
static/final-approach/art.js        Art: terrain painter, aircraft sprites, live layers
static/final-approach/flap.js       Flap: the split-flap display component
static/final-approach/game.js       simulation, input, rendering order, menus, HUD, save, sound
static/final-approach/style.css     the board, boarding pass, HUD; @font-face for the fonts
static/final-approach/fonts/        Oswald (variable) and Barlow 400/500/600, with OFL licences
tests/test_final_approach.py        page, files, no outside URLs, level data shape
docs/final-approach/                this playbook and its screenshots
```

The scripts are plain scripts, loaded in that order, sharing globals
(`THEMES`, `LEVELS`, `Art`, `Flap`). There's no build step, as everywhere in
Game Night.

### Hub integration

- **Its own stylesheet.** The page extends `base.html` (for the manifest,
  icons and home-screen tags) but overrides the `shell_css` block. The
  shared `.btn`, `.row` and `button` rules would otherwise leak into the
  board.
- **A way back.** The board's footer has "← Game Night", because the
  installed web app has no back button.
- **Cache-busting** through the hub's `asset()` helper, like every other
  game.
- **Save data:** `final-approach:save` in localStorage holds
  `{stars: {levelId: 0-3}, best, muted}`. It's per browser.

### The world and the loop

- **A fixed 960×600 world**, scaled to fit and letterboxed. All gameplay
  numbers are in world units. Phones held upright get a "turn sideways"
  overlay and the game pauses.
- **One `requestAnimationFrame` loop**: `update(dt)` (dt capped at 50ms),
  then `render()`.
- **Screens are a state machine**: `menu → brief → play ⇄ pause → ending →
  result`. The simulation only advances in `play`; `ending` lets the last
  landing roll or explosion play out before the result board.
- **An aircraft's states** are `fly → land → gone`, or `fly → divert →
  gone`. A diverted aircraft flies off the nearest edge rather than
  vanishing.
- **Routes** are points 8 units apart, collected from pointer events
  (coalesced events included) and clamped inside the edges. A route
  "locks" the moment a point satisfies the landing rule: the threshold is
  appended and drawing stops.
- **The test hook:** `window.__finalApproach` exposes `{S, LEVELS,
  runwayEnd}` for Playwright.

### Rendering, in layers

1. **Terrain, painted once** per airport and per resize into an offscreen
   canvas at the screen's resolution (capped at 3×). It's seeded by the
   level id, so an airport always looks the same:
   - farmland (a jittered, rotated field grid with crop rows, hedgerows,
     copses) or desert (dune bands, mesas, scrub)
   - sea and beach, a river and a road with farmhouses, placed by searching
     for courses that keep clear of the airport
   - mown airfield grass, then a terminal complex (apron, taxiways,
     terminal, tower, car park, parked aircraft), positioned on whichever
     side of a runway has the most room
   - runways with real designators (heading ÷ 10, so a runway landing east
     is 09 and its other end 27), threshold bars, touchdown and aiming-point
     marks and tyre rubber; pads
   - night lighting baked in, and a film-grain pattern over the lot
2. **Live, every frame**, bottom to top:
   - surf and cloud shadows
   - approach lights: chevrons with a sequenced flash running in to the
     threshold, which brighten with a dashed target ring while you draw a
     matching aircraft
   - aircraft rolling out on the ground, then storm cells
   - routes: round dots that stay put on the ground as the aircraft eats
     the route, in the aircraft's colour once locked
   - contrails, aircraft shadows, then the aircraft themselves with their
     status rings (selected, conflict, fuel)
   - conflict lines and arrival markers
   - clouds, snowfall, effects (text, rings, tyre smoke, explosions) and a
     vignette
3. **Aircraft sprites** are drawn once from vector shapes at 4× and
   stamped. Shadows are blurred silhouettes, using the canvas-shadow trick
   because Safari's canvas `filter` can't be relied on. The parts that
   move (propeller blur, rotors, nav lights and strobes) are drawn live.

### The UI

- **Flap boards** (`flap.js`): each tile is two static halves plus a leaf
  that folds over with the Web Animations API. Tiles step forward through
  the character drum to their target, staggered, with a clack per step,
  capped at a few steps so a board settles in under a second. With
  reduced motion they snap straight to their text.
- **Arrivals board** (the level select): flight number, airport, status
  (CLEARED, BOARDING with a blinking amber lamp, or CLOSED) and rating,
  plus a live clock.
- **Boarding pass** (the briefing): airport code, arrivals to land, the
  hint, the aircraft you'll meet and the runways they need, and a stub with
  the conditions and a per-airport barcode.
- **In-game display:** the airport code, the landed count as a flap
  counter, strike lamps, a wind-shift countdown, and flap toasts.
- **Sound** is synthesised with WebAudio: no audio files.

![A phone held sideways, drawing a jet's route](img/phone-drawing-a-route.jpg)

### Art direction

- **Two references:** a mid-century travel poster (a limited warm palette,
  flat shapes, gentle shading, paper grain) for the world, and a Solari
  split-flap departures board for the interface.
- **Colours:**
  - aircraft: mustard `#f2b632`, vermilion `#e8553f`, cerulean `#3d9be0`
  - interface: board black `#121314`, tile slate, cream `#f3ead2`, amber
    `#f2b33d`
- **Type:** **Oswald** for the flaps and headings, **Barlow** for
  everything else. Oswald was picked over Antonio, Barlow Condensed and
  B612 Mono (the typeface Airbus commissioned for cockpits) because it
  looks most like a real Solari board at phone size. B612 Mono was the
  runner-up on character, but its wide tiles don't fit a phone.
- **No image files.** Everything is drawn in code, so the art scales to any
  screen, costs nothing to download and can't drift between devices.

![The four flap typeface candidates](img/flap-typefaces.jpg)

### How to check a change

1. `.venv/bin/python -m pytest tests -q`: the whole suite, including
   `test_final_approach.py`.
2. Run the hub (`PORT=5055 .venv/bin/python app.py`) and drive
   `/final-approach/` in Playwright at **1280×800** and at **844×390**
   (phone landscape). Screenshot the board, a briefing, and a level after
   about 8 seconds of play. Use `window.__finalApproach.S` to stage scenes:
   park aircraft on final, set up a near miss, run fuel low.
3. Look at the screenshots. Most bugs in this game are visual.
4. Bump `APP_VERSION` and update this playbook.

![Night Shift](img/night-shift.jpg)

---

## 5. Current state (v1.18.0)

**Done:**

- [x] Core loop: route drawing, landing rule, separation, fuel, diversions, strikes
- [x] Nine airports plus Endless; stars, unlocks and a best score saved on the device
- [x] Storm cells, wind shifts, five landscapes (meadow, coast, desert, snow, night)
- [x] Painted terrain, airport complexes, approach lights, shaded aircraft, weather effects
- [x] Arrivals board, boarding pass, flap HUD and toasts, synthesised sound
- [x] Part of the Game Night hub, with a tile, tests and docs

**Known rough edges:**

- **Balance hasn't been played by hand.** Traffic intervals, fuel and
  storm speeds are first guesses; tune them by playing.
- **Not yet tried on a real phone.** Touch has only been tested in an
  emulated browser. Check the drawing feel, frame rate on an older phone,
  and the tile flips' cost on the board.
- **Progress is per browser.** Safari and the home-screen app don't share
  it, and clearing site data loses it. Records (Phase 2) fix the part that
  matters.
- **Colour is the only way to tell runway kinds apart.** That's a
  colour-blindness problem (Phase 3).
- **The iOS app doesn't show it**; it's web only (Phase 7).
- **Repainting the terrain on resize** takes a beat on slow devices
  (debounced, but noticeable when rotating).

---

## 6. Roadmap

In order. Each phase is one or more pull requests with its own version
bump. "Done when" is the bar for ticking it off.

### Phase 1: in the hub ✅ (v1.18.0)

Moved from a standalone prototype into Game Night, with the tile, tests,
docs and this playbook.

### Phase 2: records and faces

The family leaderboard is the reason to be in Game Night.

- Post a finished shift to `POST /final-approach/api/stats/games`, keyed by
  the device's profile name (`GN.me`): `{level, landed, strikes, stars,
  duration}`, and Endless runs `{landed, duration}`. No profile means no
  record, the same as guests elsewhere.
- Validate on the server (sane bounds: landed ≤ what the airport's target
  and time allow, duration ≥ a floor), as Flip 7 does. This isn't real
  anti-cheat, just protection from bugs and bored guests.
- A records page at `/final-approach/stats`: an Endless leaderboard with
  faces, stars per airport per person, recent shifts. Link it from the
  board.
- The arrivals board's rating column shows *the family's* best as well as
  yours (a small face beside the stars).
- **Done when:** two profiles on two devices see each other's Endless bests
  on the board.

### Phase 3: feel, balance and access

- Play every airport by hand on a phone and tune `traffic` per airport.
  Record the numbers here.
- **Teach without words on airport 1:** a ghost finger drawing the first
  route, until the first landing.
- **Haptics** (`navigator.vibrate` where there is one) on conflict, lock
  and divert.
- **Shapes as well as colours:** a small runway-kind glyph on each
  aircraft's arrival marker and on the runway's end (▲ short, ■ long, ● pad),
  so colour is never the only cue.
- A settings sheet: sound, music, haptics, left-handed HUD.
- **Done when:** someone new lands their first plane without help, and the
  game holds 60fps on the family's oldest phone.

### Phase 4: weather that changes

The weather is decoration plus storms today. Make it a system:

- **Storms that build:** a cell starts as a small grey cloud with a
  warning ring, grows, rains, and drifts off.
- **Fog banks** that roll in and hide aircraft inside them (only their
  arrival markers and routes show) until they clear.
- **Crosswind gusts** that push unrouted aircraft sideways, with a windsock
  on the HUD.
- **Time of day across a level:** a long Endless run goes from afternoon
  to dusk to night, and the runway lights come up.
- **Snow closing a runway:** a plough crosses it and no landings are
  possible for a few seconds, telegraphed on the board.
- **Done when:** two runs of the same airport feel different because of
  the weather.

### Phase 5: more to control

- **New aircraft:**
  - seaplanes landing on water (a lane marked on the sea)
  - gliders, which can't go around, so the first route is final
  - emergencies (flashing, low fuel, priority)
  - a VIP whose approach must be clear of all traffic
- **Holding:** draw a loop to put an aircraft in a holding circle.
- **Departures:** aircraft taxi out and take off along the runway, and
  must reach a marked edge. Arrivals can't land on a runway with a
  departure rolling.
- **Ground traffic:** a landed aircraft must clear the runway before the
  next can land.
- **New airports:** a mountain valley (terrain to route around), an
  island chain, a city at night, an aircraft carrier (a moving runway).
- **Done when:** a second set of nine airports exists, each with one new
  idea, in the same teach-one-thing-per-airport rhythm.

### Phase 6: modes

- **Daily approach:** the same seeded Endless run for the whole family each
  day, with its own leaderboard. One try counts.
- **Two in the tower:** pass-and-play turns, or a split screen where each
  player owns half the airspace (one device, both thumbs).
- **Tower view:** cast an Endless run to the TV while others watch (the
  watch-page idea from Flip 7).
- **Done when:** a family evening has a reason to play it *together*.

### Phase 7: platform

- **iOS app:** a tile opening `/final-approach/` in the in-app Safari sheet,
  like Flip 7's Keep score, with the screen kept awake. Consider a native
  port only if web performance on iPhone falls short.
- **Music:** a synthesised ambient score rising with traffic, like
  Fugitive's on iOS.
- **Offline:** Game Night has deliberately no service worker. This game
  would genuinely work offline, so if we want it on a plane, decide
  whether a worker scoped to `/final-approach/` is worth the exception.
- **Done when:** it's on the iOS app's home screen and playable with no
  signal.

---

## 7. Decisions so far

| Decision | Why |
|---|---|
| Built in Game Night, not as its own app | Same stack and rules (plain JS, self-hosted fonts); profiles and records come free; already hosted and installed on the family's phones. |
| Client-side only, for now | It's a solo game: there's nothing to keep secret and no table to share, so a server engine would be cost without benefit. Records will be the first server part. |
| Its own stylesheet via `shell_css` | The shared button and row rules broke the board. |
| Oswald and Barlow, bundled | Oswald looks most like a Solari board at phone size; the no-CDN rule. |
| No image files | Resolution-independent, nothing to download, consistent everywhere. |
| A fixed 960×600 world, letterboxed | Level design needs fixed geometry; landscape phones and desktops both fit. |
| Approach must be lined up | It makes the angle of approach the skill, and the approach lights make it readable. |
| A collision ends the shift; diversions are strikes | Collisions are the cardinal sin; fuel and weather are pressure, so they forgive twice. |
| Arrivals announced two seconds ahead | Calm tension: you always get a warning. |

## 8. Open questions

- **Accent colour.** Vermilion (`#e8553f`) is close-ish to Wildwood's
  orange on the hub. Is amber (the board's colour) better?
- **Endless unlock.** After airport 5, or after all nine?
- **Records.** Should a shift count only from a device with a profile (my
  recommendation), or also anonymously?
- **The repo's name.** `ito-app` no longer describes it; `game-night` would
  match the image, the domain and the app.
