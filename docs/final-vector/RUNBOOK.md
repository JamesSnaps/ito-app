# Final Vector: runbook

How Final Vector is worked on day to day. The design, decisions and what's
next are in [the concept](CONCEPT.md); this is the *how*. It follows
[Final Approach's runbook](../final-approach/RUNBOOK.md) wherever the two
are the same (issues, branches, releases, deploying), and notes what's
different here.

## 1. Where it stands

**A first playable prototype** (Game Night v1.34.0): the Ambleford training
airport, arrivals only; the scope, strips and radio log; the command dial
and the typed command line (one parser, ready for voice); spoken readbacks
assembled from recorded clips for two voices; Academy lessons 1–5 and a
free shift with a debrief. The hub tile says "Preview". See the concept's
section 15 for what was built and why.

## 2. Bugs, tuning and ideas: GitHub Issues

Every issue for this game has the `final-vector` label, plus `bug`,
`balance`, `idea` or `next` as for Final Approach (its runbook, section 1).
Use the *Bug* and *Idea* templates.

Open issues:
[label:final-vector](https://github.com/JamesSnaps/ito-app/issues?q=is%3Aopen+label%3Afinal-vector) ·
[bugs](https://github.com/JamesSnaps/ito-app/issues?q=is%3Aopen+label%3Afinal-vector+label%3Abug) ·
[next](https://github.com/JamesSnaps/ito-app/issues?q=is%3Aopen+label%3Afinal-vector+label%3Anext).

**The order we expect to build in** (each an issue):
1. Listen to the readbacks and tune them; enforce wake turbulence; tags
   that can be moved.
2. Voice control (push to talk), then Academy lessons 6–12 and the
   checkride.
3. Heathrow; departures; debrief replay, pause and resume, readback errors.

## 3. From a change to the live site

Exactly as Final Approach's runbook, section 2: branch from `main`, bump
`APP_VERSION`, docs in the same PR (`CLAUDE.md`'s Final Vector section,
`README.md`, the concept's "what's built" section, this runbook's release
log), tests, PR, Bugbot clean, merge when James says, deploy with
`ssh -n vm-core recreate gamenight`, check `/healthz`.

## 4. Testing

- **Server:** `.venv/bin/python -m pytest -q`; this game's tests are
  `tests/test_final_vector.py`. With node installed they also run the
  command parser and the simulation directly (turn rates, ILS capture,
  the conflict alert).
- **In a browser:** the same Playwright setup as Final Approach (runbook
  section 3). The test hook is `window.__finalVector`: `step(seconds)`,
  `command(text)`, `parse(text)`, `startLesson(n)`, `startShift()`,
  `openDial(cs)`, `sim` (the simulation's state). Lessons unlock in order:
  seed `localStorage['final-vector:save']` with `{ "lessons": {"1": true, …} }`
  to start further in. The strips and scope redraw in the page's own
  animation loop, so check them after a frame, not straight after `step()`.
- **Screen sizes:** 1180×820 (an iPad held sideways) first, 1440×900 (a
  laptop) second. Phones get a "needs a bigger screen" card.
- **Voices:** the clip list lives in `static/final-vector/command.js`;
  `tools/final_vector_voice.py` records any missing clips with ElevenLabs.
  Check them by ear on the iPad after re-recording.

## 5. Playtesting on the iPad

- [ ] The hub's Final Vector tile and Final Approach's "harder challenge"
      link both open it.
- [ ] Lesson 1 to 5 in order, each check passes and opens the next.
- [ ] Readbacks: clear, right numbers, sensible pacing.
- [ ] A shift: no false conflict alerts; the debrief adds up.
- [ ] Anything odd → an issue with `final-vector`.

## 6. Release log

| Version | Date | What shipped |
|---|---|---|
| 1.34.0 | 1 Nov 2026 | First playable prototype (preview) |
