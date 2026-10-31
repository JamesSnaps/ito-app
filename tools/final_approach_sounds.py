"""Generate Final Approach's recorded sounds and music with ElevenLabs.

A developer tool, never part of the game: the game only plays the files this
writes to static/final-approach/audio/. Every sound's wording lives here, so a
sound nobody likes is fixed by changing its prompt and running this again.

    .venv/bin/python tools/final_approach_sounds.py            # make missing files
    .venv/bin/python tools/final_approach_sounds.py touchdown_jet bed_coast   # remake these
    .venv/bin/python tools/final_approach_sounds.py --list

The key is read from ELEVENLABS_API_KEY, or from ~/.config/elevenlabs/env
(a line ELEVENLABS_API_KEY=...). Keep it out of the repo. The key only needs
the Sound Effects and Music permissions.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "static" / "final-approach" / "audio"
API = "https://api.elevenlabs.io/v1"

# name: (kind, seconds, prompt). Loops are generated as seamless loops; the game
# still cross-fades each repeat, as MP3 adds a little silence at either end.
SOUNDS = {
    # one-shots
    # Touchdowns: three of each, longer than they sound, each fading to
    # silence by itself (the game fades the tail too). One recording heard
    # every landing was the first thing the family noticed.
    "touchdown_jet_1": ("sfx", 4.5, "Airliner landing heard from beside the runway: a tyre chirp on touchdown, a short swell of reverse thrust, then fading smoothly away to silence"),
    "touchdown_jet_2": ("sfx", 4.5, "Distant jet airliner touching down on a runway: soft double tyre squeak, engines spooling down, gently fading out to silence"),
    "touchdown_jet_3": ("sfx", 4.5, "Passenger jet landing far down the runway: muffled thump of the wheels, a brief rumble of reverse thrust dying away to silence"),
    "touchdown_prop_1": ("sfx", 4.0, "Small propeller plane landing: a light tyre squeak on tarmac, the engine throttling back to idle, then fading away to silence"),
    "touchdown_prop_2": ("sfx", 4.0, "Light aircraft touching down on a grass and tarmac strip: a little bump and squeak, propeller buzz easing off and fading out"),
    "touchdown_prop_3": ("sfx", 4.0, "Single-engine plane landing in the distance: a soft chirp of tyres, engine note dropping, then quiet"),
    "touchdown_heli_1": ("sfx", 4.5, "Helicopter settling onto a helipad: skids touching down, rotor blades slowing and winding down to silence"),
    "touchdown_heli_2": ("sfx", 4.5, "Helicopter landing nearby: rotor wash easing, a soft thud of skids on concrete, turbine whine winding down and fading out"),
    "touchdown_heli_3": ("sfx", 4.5, "Distant helicopter landing: rotor thudding slowing gradually, then fading away to silence"),
    "chime_start": ("sfx", 2.5, "Vintage airport public address chime, three soft ascending bell tones, warm and clean, no voice"),
    "chime_clear": ("sfx", 3.0, "Cheerful airport chime, four bright ascending bell tones resolving, celebratory but gentle, no voice"),
    "chime_fail": ("sfx", 2.5, "Soft descending airport chime, three low bell tones, gentle and a little sad, no voice"),
    "collision": ("sfx", 3.0, "Distant mid-air explosion heard from the ground: a deep muffled boom, then light metal debris scattering"),
    "divert": ("sfx", 2.5, "Aviation radio static burst, then a jet engine fading away into the distance"),
    "radio_1": ("sfx", 1.5, "Short aviation radio transmission: squelch click, about one second of indistinct garbled male air traffic controller speech, squelch tail"),
    "radio_2": ("sfx", 1.5, "Short aviation radio transmission: squelch click, about one second of indistinct garbled female air traffic controller speech, squelch tail"),
    "radio_3": ("sfx", 1.5, "Brief crackly aviation radio call: click, a few muffled unintelligible words from a pilot, click"),
    "wind_shift": ("sfx", 2.0, "A strong gust of wind whooshing past outdoors, then settling"),
    "flap_1": ("sfx", 0.6, "Single mechanical split-flap departure board flap clack, close, dry"),
    "flap_2": ("sfx", 0.6, "One plastic flap of a split-flap display snapping over, short crisp click"),
    "flap_rattle": ("sfx", 2.5, "Split-flap departure board updating: rapid mechanical clattering of many flaps turning over, then settling"),
    # loops: one bed per landscape, one engine per aircraft family
    "bed_meadow": ("loop", 20, "Peaceful countryside ambience: soft breeze over fields, skylarks and distant birdsong, calm, continuous"),
    "bed_coast": ("loop", 20, "Coastal ambience: gentle waves on a sandy beach, distant seagulls, light sea breeze, continuous"),
    "bed_desert": ("loop", 20, "Desert ambience: dry hot wind over sand, sparse insects, vast and still, continuous"),
    "bed_snow": ("loop", 20, "Winter ambience: soft muffled wind over snowy fields, very quiet and hushed, continuous"),
    "bed_night": ("loop", 20, "Night countryside ambience: crickets chirping, a soft warm breeze, the faint hum of a distant airport, continuous"),
    "engine_jet": ("loop", 10, "Distant jet airliner flying at steady power: smooth engine whine and low rumble, continuous"),
    "engine_prop": ("loop", 10, "Small single-engine propeller plane droning steadily in flight, distant, continuous"),
    "engine_heli": ("loop", 10, "Helicopter rotor blades thudding steadily in flight, distant, continuous"),
    # music: one theme for the board, a calm and a busy one for shifts
    "music_board": ("music", 60, "Instrumental 1960s jet-age lounge jazz for an airport departures lounge: soft vibraphone melody, warm electric piano chords, upright bass, light brushed drums. Relaxed and elegant. No vocals."),
    "music_calm": ("music", 90, "Instrumental 1960s jet-age lounge jazz: gentle vibraphone, warm electric piano, walking upright bass, soft brushed drums. A steady, unhurried groove to concentrate to. No vocals."),
    "music_busy": ("music", 90, "Instrumental 1960s jet-age jazz with urgency: driving walking bass, busy brushed drums and ride cymbal, punchy vibraphone and muted trumpet stabs. Tense but stylish, like a busy control tower. No vocals."),
}


def api_key():
    key = os.environ.get("ELEVENLABS_API_KEY")
    if key:
        return key
    env = Path.home() / ".config" / "elevenlabs" / "env"
    for line in env.read_text().splitlines():
        if line.startswith("ELEVENLABS_API_KEY="):
            return line.split("=", 1)[1].strip()
    sys.exit("No ELEVENLABS_API_KEY in the environment or ~/.config/elevenlabs/env")


def request(path, body, key):
    req = urllib.request.Request(
        API + path, data=json.dumps(body).encode(), method="POST",
        headers={"xi-api-key": key, "Content-Type": "application/json"},
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=300) as res:
                return res.read()
        except urllib.error.HTTPError as e:
            detail = e.read()[:300].decode(errors="replace")
            if e.code in (429, 500, 502, 503) and attempt < 2:
                time.sleep(5 * (attempt + 1))
                continue
            raise SystemExit(f"{path}: HTTP {e.code} {detail}")


def generate(name, key):
    kind, seconds, prompt = SOUNDS[name]
    if kind == "music":
        audio = request("/music?output_format=mp3_44100_96",
                        {"prompt": prompt, "music_length_ms": int(seconds * 1000), "force_instrumental": True}, key)
    else:
        body = {"text": prompt, "duration_seconds": seconds, "prompt_influence": 0.6,
                "model_id": "eleven_text_to_sound_v2"}
        if kind == "loop":
            body["loop"] = True
        quality = "mp3_44100_64" if kind == "loop" else "mp3_44100_96"
        audio = request(f"/sound-generation?output_format={quality}", body, key)
    (OUT / f"{name}.mp3").write_bytes(audio)
    return len(audio)


def main(args):
    if "--list" in args:
        for name, (kind, seconds, prompt) in SOUNDS.items():
            print(f"{name:15} {kind:5} {seconds:>4}s  {prompt}")
        return
    OUT.mkdir(parents=True, exist_ok=True)
    names = args or [n for n in SOUNDS if not (OUT / f"{n}.mp3").exists()]
    unknown = [n for n in names if n not in SOUNDS]
    if unknown:
        sys.exit(f"Unknown: {', '.join(unknown)}")
    key = api_key()
    for name in names:
        size = generate(name, key)
        print(f"{name}: {size // 1024} KB")


if __name__ == "__main__":
    main(sys.argv[1:])
