# Game Night for iOS

A SwiftUI front end to the Game Night server: Flip 7 played on the app's
deck (as the dealer or from your own seat), Fugitive (dealt here, played on
two phones or passed across one), both games' records, ito (host a room or
watch its topic), and "You" — a profile name and selfie shared with the web. Room QR codes can
be scanned inside the app. The rules and the game state live on the server;
the app shows the table and sends moves. See `../CLAUDE.md` → "iOS app" for
the design notes.

## Develop

```bash
brew install xcodegen          # once
cd ios && xcodegen             # after any change to project.yml or new files
open GameNight.xcodeproj
```

Fugitive also plays with no internet (1.3.0): the rules are a Swift port
of `games/fugitive/engine.py`, pinned to it by scripted games, and finished
games are sent home to be recorded when there's signal. See `../CLAUDE.md`
→ "Offline Fugitive". The non-UI Swift — models, client, offline engine,
nearby play — also builds and tests on Linux (CI runs it):

```bash
ios/LinuxTests/run.sh          # Docker, swift:6.2 image
```

Fugitive's card faces are PNGs rendered from the web's own drawing code
(`static/fugitive.js`), so the two can't drift by hand. After changing the
card art or `TWO_FOOTPRINTS`, render them again (needs Node and the
Playwright package):

```bash
node ios/scripts/render_fugitive_cards.js
```

Fugitive's fonts (`GameNight/Fonts`) are the web's three, converted from the
woff2 files in `static/fonts` to TrueType and listed in `project.yml` under
`UIAppFonts`; licences alongside.

Point a dev build at the Flask server on your Mac, either in the app
(Settings → server) or by ticking the `-serverURL http://localhost:5001`
launch argument in the scheme. Tests: ⌘U in Xcode, or

```bash
xcodebuild test -project GameNight.xcodeproj -scheme GameNight \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro'
```

## TestFlight — family and friends

The plan is TestFlight with a **public link**: no App Store listing, and
anyone with the link installs the TestFlight app and taps it. Builds expire
after 90 days, so upload a fresh one at least once a quarter (testers update
from TestFlight; their games and seats aren't on the phone, so nothing is
lost).

### One-off setup

Signing is already set up: team **C729B84RYG** (the personal membership
Dishes, Keepsake and Brief use) is in `project.yml`, and the bundle ID is
`uk.collco.gamenight`. The first archive registers the App ID — with its
Associated Domains capability — through Xcode's automatic signing
(`-allowProvisioningUpdates`), using the account signed in to Xcode.

The one thing Xcode can't create is the **App Store Connect record**:
App Store Connect → Apps → + → New App → iOS, bundle ID
`uk.collco.gamenight` (it appears in the list once the first archive has
registered it, or add it under Identifiers first), SKU `gamenight`. If
"Game Night" is taken as a store name, use something like "Game Night
Companion" — the home-screen label stays "Game Night".

Room links (`/flip7/play/…`, `/ito/play/…`, `/join?code=…`) open the app
because the server's `/.well-known/apple-app-site-association` names
`C729B84RYG.uk.collco.gamenight` — hard-coded in `app.py`, as news-hub
does for Brief, and on the public Traefik router so Apple can fetch it.

### Each release

```bash
ios/scripts/testflight.sh            # archive and upload
UPLOAD=0 ios/scripts/testflight.sh   # archive and export an .ipa only
```

The build number is the UTC time, as for Brief, so every upload is newer
than the last. Signing and upload use the team's App Store Connect API key
(the one Brief and Dishes use): its ids go in `~/.appstoreconnect/gamenight.env`
as `ASC_KEY_ID` / `ASC_ISSUER_ID`, the `.p8` in
`~/.appstoreconnect/private_keys/`. Without that file the script falls back
to the account signed in to Xcode, which Xcode 27.1 no longer shares with
`xcodebuild`. Archives go to `~/Library/Developer/Xcode/DerivedData/GameNight`.

Then in App Store Connect → TestFlight:

- **Internal testing** (you, up to 100 people on your App Store Connect
  team): available as soon as the build has processed.
- **External testing** (family and friends): create a group, add the build,
  turn on **Public Link**, and share it. The first build of each version
  goes through Beta App Review (usually a day). Useful review notes:

  > No sign-in. Tap "Start a game", add two names, "Shuffle & deal", then
  > Hit/Stay. To test joining, open https://gamenight.collardserver.co.uk/flip7/play
  > in a browser, start a game there, and enter its four-letter code under
  > "Join with a code". ito: "Host a room", tap the card to draw a topic;
  > the QR button shows the code other phones join with. Fugitive: "Start a game", two
  > names, "Pass this device between us", Deal. The camera is used to scan
  > room QR codes and, optionally, for a profile photo on "You" (top left).
  > Fugitive also plays with no internet: choose "Pass this phone, offline"
  > in setup; or on two phones, "Two phones side by side, offline" on one
  > and "Join a nearby game" on the other — that asks for local network
  > access, which is only used to find the other phone.

The server has to be running a version with the app's API before a build
goes out — the app talks to production by default: v1.6.1 for Flip 7, v1.8.2
for 1.2.0 (Fugitive, profiles and the `/fugitive/play` and `/me/link` app
links).

Since 1.2.0 the app collects a name and an optional photo when a player makes
a profile, so App Store Connect's App Privacy answers need **Name** and
**Photos** under "Data linked to you", for app functionality, not tracking —
matching `PrivacyInfo.xcprivacy`.

## Ad hoc builds — Louis's iPad

TestFlight needs an Apple Account aged 13 or over, so a younger child's iPad
gets an ad hoc build instead, exactly as Brief does (news-hub's
`ios/RUNBOOK.md`, "Ad hoc builds"): signed for the devices registered with the
team, installed over a cable or Wi-Fi pairing, no review, and it runs for a
year (until its provisioning profile expires). It only opens with **Developer
Mode** on (Settings → Privacy & Security → Developer Mode).

```bash
# Register a new device once — same team as Brief, so use its script:
node ../news-hub/ios/scripts/register-device.mjs "Louis's iPad"
# Each update, with it plugged in or paired (a name from `xcrun devicectl list devices`, or its UDID):
ADHOC=1 INSTALL="iPad - H6VPQ0FWH9" ios/scripts/testflight.sh
# Or re-export a build already archived for TestFlight:
ADHOC=1 INSTALL="iPad - H6VPQ0FWH9" ARCHIVE=~/Library/Developer/Xcode/DerivedData/GameNight/GameNight-<build>.xcarchive ios/scripts/testflight.sh
```

- Louis's iPad is "iPad - H6VPQ0FWH9" (UDID `00008120-0009193E01B8201E`),
  registered for Brief. 1.11.0 (202610291120) installed on 29 Oct 2026.
- An ad hoc copy doesn't update itself: reinstall after each TestFlight build
  he should have, and at least once a year.
- If a newly registered device won't install ("not included in the
  provisioning profile"), delete the stale profile from
  `~/Library/Developer/Xcode/UserData/Provisioning Profiles` and build again.
