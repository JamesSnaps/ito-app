"""Record Final Vector's pilot voices with ElevenLabs.

A developer tool, never part of the game: the game only plays the files this
writes to static/final-vector/voice/<voice>/<clip>.mp3. Readbacks have to say
any callsign, heading, level and speed, so they can't be recorded line by
line as Final Approach's are. Each voice records the pieces once (digits,
"heading", "descend", "flight level", the callsign words, a few greetings)
and the game strings them together, with the radio filter smoothing the
joins.

The pieces are read from CLIPS in static/final-vector/command.js, the same
list the game builds its readbacks from, so the two can't drift apart.

    .venv/bin/python tools/final_vector_voice.py              # record missing clips
    .venv/bin/python tools/final_vector_voice.py george/d4    # re-record these
    .venv/bin/python tools/final_vector_voice.py --list

The key is read from ELEVENLABS_API_KEY, or from ~/.config/elevenlabs/env
(a line ELEVENLABS_API_KEY=...). Keep it out of the repo. It needs the Text
to Speech permission.
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "static" / "final-vector" / "voice"
API = "https://api.elevenlabs.io/v1"

# Two pilots, both British (the same voices as Final Approach's George and
# Alice). Aircraft are given one each, alternately.
VOICES = {
    "george": "JBFqnCBsd6RMkjVDRZzb",
    "alice": "Xb7hH8MSUJpSbSDYk0k2",
}

# Words either side, so a piece is said the way it sits in a readback (a
# digit running on, a number ending), not as a word on its own.
CONTEXT = {
    "d": ("left heading two", "seven zero, Skylark four one two."),
    "e": ("left heading two seven", ", Skylark four one two."),
    "thousand": ("descend altitude four", "feet, Skylark four one two."),
    "hundred": ("altitude three thousand five", "feet."),
    "feet": ("descend altitude four thousand", ", Skylark four one two."),
    "knots": ("speed two one zero", ", Skylark four one two."),
    "altitude": ("descend", "four thousand feet."),
    "flight_level": ("descend", "eight zero, Skylark four one two."),
    "left_heading": ("", "two seven zero, descend altitude four thousand feet."),
    "right_heading": ("", "zero niner zero, Skylark four one two."),
    "descend": ("left heading two seven zero,", "altitude four thousand feet."),
    "climb": ("right heading zero niner zero,", "altitude five thousand feet."),
    "maintain": ("", "altitude four thousand feet."),
    "speed": ("descend altitude four thousand feet,", "two one zero knots."),
    "cleared_ils": ("left heading two four zero,", "two seven, Skylark four one two."),
    "contact_tower": ("", "one one eight decimal five, Skylark four one two, good day."),
    "decimal": ("contact tower one one eight", "five."),
    "hold_at": ("", "Dunnock, Skylark four one two."),
    "established": ("Skylark four one two,", "two seven."),
    "good_day": ("contact tower one one eight decimal five, Skylark four one two,", ""),
}
CALLSIGN_NEXT = "four one two."


def clips():
    """{key: text}, from command.js's CLIPS."""
    source = (ROOT / "static" / "final-vector" / "command.js").read_text(encoding="utf-8")
    block = source.split("const CLIPS = {")[1].split("};")[0]
    return dict(re.findall(r"(\w+): '([^']+)'", block))


def context(key):
    if re.fullmatch(r"[de]\d", key):
        return CONTEXT[key[0]]
    if key in CONTEXT:
        return CONTEXT[key]
    if key in ("skylark", "puffin", "kestrel", "heron", "swift", "gannet", "meadow", "bluebird"):
        return ("speed two one zero knots,", CALLSIGN_NEXT)
    return ("", "")


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
            with urllib.request.urlopen(req, timeout=120) as res:
                return res.read()
        except urllib.error.HTTPError as e:
            detail = e.read()[:300].decode(errors="replace")
            if e.code in (429, 500, 502, 503) and attempt < 2:
                time.sleep(5 * (attempt + 1))
                continue
            raise SystemExit(f"{path}: HTTP {e.code} {detail}")


def generate(voice, key, text, api):
    before, after = context(key)
    body = {
        "text": text,
        "model_id": "eleven_multilingual_v2",
        # Calm and brisk, as pilots are on the radio.
        "voice_settings": {"stability": 0.6, "similarity_boost": 0.75, "style": 0.05, "speed": 1.08},
    }
    if before:
        body["previous_text"] = before
    if after:
        body["next_text"] = after
    audio = request(f"/text-to-speech/{VOICES[voice]}?output_format=mp3_22050_32", body, api)
    path = OUT / voice / f"{key}.mp3"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(audio)
    return len(audio)


def main(args):
    words = clips()
    everything = [f"{voice}/{key}" for voice in VOICES for key in words]
    if "--list" in args:
        for name in everything:
            print(f"{name:24} {words[name.split('/')[1]]}")
        print(f"{len(everything)} clips")
        return
    names = args or [n for n in everything if not (OUT / f"{n}.mp3").exists()]
    unknown = [n for n in names if n not in everything]
    if unknown:
        sys.exit(f"Unknown: {', '.join(unknown)}")
    api = api_key()
    for name in names:
        voice, key = name.split("/")
        size = generate(voice, key, words[key], api)
        print(f"{name}: {size // 1024} KB")


if __name__ == "__main__":
    main(sys.argv[1:])
