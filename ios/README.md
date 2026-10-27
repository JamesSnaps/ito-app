# Game Night for iOS

A SwiftUI front end to the Game Night server: Flip 7 played on the app's
deck (as the dealer or from your own seat), Flip 7 records, and ito's topic
display. The rules and the game state live on the server; the app shows the
table and sends moves. See `../CLAUDE.md` → "iOS app" for the design notes.

## Develop

```bash
brew install xcodegen          # once
cd ios && xcodegen             # after any change to project.yml or new files
open GameNight.xcodeproj
```

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
  > "Join with a code". ito: "Host a room" opens the web host page, which
  > needs a sign-in reviewers won't have — the in-app part of ito is the
  > topic display reached by a room code.

The server has to be running a version with the app's API (v1.6.1 or later)
before a build goes out — the app talks to production by default.
