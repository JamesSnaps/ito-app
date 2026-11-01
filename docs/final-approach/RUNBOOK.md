# Final Approach: runbook

How Final Approach is worked on day to day: where bugs and ideas live, how
a change goes from a branch to the live site, how to test it, and what has
shipped. The *why* and the long-term plan are in [the playbook](PLAYBOOK.md);
this is the *how*.

## 1. Bugs, balance and ideas: GitHub Issues

Everything to fix or build is an issue on
[JamesSnaps/ito-app](https://github.com/JamesSnaps/ito-app/issues), so it
can be found, discussed and closed by the PR that fixes it.

| Label | Means |
|---|---|
| `final-approach` | This game (every Final Approach issue has it) |
| `bug` | Something isn't working as it should |
| `balance` | Tuning: difficulty, timings, traffic |
| `idea` | A feature for the roadmap, not yet planned in detail |
| `next` | Planned for the next release or two |
| `ios-app` | Shows up in, or needs, the iOS app |

- **Report a bug** with the *Bug* template (New issue → Bug): what happened,
  where (airport, condition, device, profile) and a screenshot if there is
  one. From a phone the GitHub app works fine.
- **Ideas** use the *Idea* template; when one is planned it moves into the
  playbook's roadmap and gets `next`.
- **A PR that fixes an issue** says `Fixes #NN` in its description, so the
  issue closes when it merges.
- **Bugbot findings** on a PR are fixed in the PR itself, not filed.

Open issues for this game:
[label:final-approach](https://github.com/JamesSnaps/ito-app/issues?q=is%3Aopen+label%3Afinal-approach) ·
[bugs](https://github.com/JamesSnaps/ito-app/issues?q=is%3Aopen+label%3Afinal-approach+label%3Abug) ·
[next](https://github.com/JamesSnaps/ito-app/issues?q=is%3Aopen+label%3Afinal-approach+label%3Anext).

## 2. From a change to the live site

1. **Branch** from up-to-date `main` (`claude/<topic>` for Claude's work).
   Build on main, not on another open PR's branch: merging a PR with
   `--delete-branch` closes any PR stacked on it.
2. **Bump the version** in `app.py` (`APP_VERSION`): a new feature is a
   minor bump (1.31.0 → 1.32.0), a fix a patch (→ 1.31.1). If another open
   PR already took the next number, take the one after; renumber at merge
   time if two land together.
3. **Docs in the same PR:** `CLAUDE.md` (the Final Approach section: how it
   works, for the next developer), `README.md` (what players get), the
   playbook (current state, the roadmap phase), and this runbook's release
   log.
4. **Tests** (section 3) pass locally.
5. **Open the PR.** CI runs pytest (and the Swift tests if `ios/` changed);
   **Bugbot** reviews it. Fix what it finds in the PR, push, and wait for
   it to pass the latest commit.
6. **Merge** once James has said so and the checks are clean
   (`gh pr merge NN --merge --delete-branch`).
7. **Deploy:** wait for the *Publish container* run on main to finish,
   then `ssh -n vm-core recreate gamenight`, and check
   `https://gamenight.collardserver.co.uk/healthz` shows the new version.
   Watchtower would pick it up at 02:00 anyway; recreating makes it now.
8. **Tell James** what to try, where (which airport, condition or toggle),
   and to reload once on the iPad.

## 3. Testing

- **Server:** `.venv/bin/python -m pytest -q` (the Final Approach tests are
  `tests/test_final_approach.py`).
- **In a browser:** Playwright with the pre-installed Chromium. On the
  dev VM it needs the extra libraries in `/tmp/fa-libs`:
  `LD_LIBRARY_PATH=/tmp/fa-libs/root/usr/lib/x86_64-linux-gnu FONTCONFIG_FILE=/tmp/fa-libs/fonts.conf node <script>`,
  with scripts in `/tmp/fa-test` (where `require('playwright')` resolves).
  Run a local server with
  `GAMENIGHT_FAMILY=authelia PORT=5055 setsid .venv/bin/python app.py > /tmp/fa-test/http.log 2>&1 < /dev/null & echo $! > /tmp/gn.pid`;
  stop it with `kill $(cat /tmp/gn.pid)`. **Never** `pkill -f app.py` (it
  kills the shell running it).
- **The test hook** `window.__finalApproach` steps the simulation
  (`update(0.05, t)` in a loop) and starts things on demand: `emergency(kind)`,
  `disrupt(kind)`, `queueArrival()`, plus the state `S` and `save`. Seed the
  save in `localStorage['final-approach:save']` (stars, `taught: true`,
  `guestOk: true`, `disSeen`) to skip the first-time cards.
- **Screen sizes to check:** 844×390 (a phone held sideways) and 1180×820
  (an iPad held sideways). Read the screenshots, don't just take them.
- **Test data:** posting shifts from the browser writes to the repo's
  `data/`; remove test profiles and records afterwards.
- **Audio:** new voices and sounds go in `tools/final_approach_sounds.py`
  and are recorded with ElevenLabs (key in `~/.config/elevenlabs/env`);
  the download test keeps the up-front sounds under 4 MB and the
  background ones under 6 MB.

## 4. Playtesting on the iPad (after a release)

- [ ] Reload once; the board's footer and `/healthz` show the new version.
- [ ] Try what changed, where the release notes say.
- [ ] One ordinary shift start to finish: sound, music, radio.
- [ ] As Louis (a child's profile): no grown-up emergencies or cyber
      attack (the gremlin instead).
- [ ] The records page shows the shift.
- [ ] Anything odd → an issue (section 1).

## 5. Release log

| Version | Date | What shipped |
|---|---|---|
| 1.18.0 | 30 Oct 2026 | Final Approach joins the hub |
| 1.19.0 | 31 Oct | Carry a route on from its end; bigger arrival markers; storm-safe arrivals |
| 1.20.0 | 31 Oct | Recorded sound and music (ElevenLabs) |
| 1.21.0–1.21.1 | 31 Oct | Spoken radio dialogue; varied touchdowns; arrivals never fly into traffic |
| 1.22.0 | 31 Oct | Family records with faces; settings; calm skies |
| 1.23.0 | 31 Oct | Emergencies (the everyone set), Lifeline, Endless Off/Some/Lots |
| 1.24.0–1.24.1 | 31 Oct | Children's profiles (the Family page) and grown-up emergencies |
| 1.25.0 | 31 Oct | Free play |
| 1.26.0–1.26.1 | 31 Oct–1 Nov | Who's playing: guests, the owner's Activity page; centred back arrows |
| 1.27.0 | 1 Nov | Conditions (Dusk, Night, Snow, Storm, Fog), stamps and the Passport |
| 1.28.0 | 1 Nov | The landscape fills any screen; the control zone's edge |
| 1.29.0 | 1 Nov | Holding (Holding Pattern) and disruptions part 1 |
| 1.30.0 | 1 Nov | Disruptions part 2: balloons, the Kestrels, the cyber attack / gremlin; real fix codes (BNN, WILLO, TIMBA) |
| 1.31.0 | 1 Nov | Arrivals seen flying in beyond the control zone; check-in calls |
| 1.32.0 | 1 Nov | Hub-wide: Bricolage Grotesque display face |
| 1.32.1 | 1 Nov | `/api/games` for the iOS app (web games full screen, app 1.14.0) |
| 1.33.0 | 1 Nov | Final Vector prototype; Final Approach links to it |
