"""Generate Final Approach's recorded sounds and music with ElevenLabs.

A developer tool, never part of the game: the game only plays the files this
writes to static/final-approach/audio/. Every sound's wording lives here, so a
sound nobody likes is fixed by changing its prompt and running this again.

    .venv/bin/python tools/final_approach_sounds.py            # make missing files
    .venv/bin/python tools/final_approach_sounds.py touchdown_jet bed_coast   # remake these
    .venv/bin/python tools/final_approach_sounds.py --list

The key is read from ELEVENLABS_API_KEY, or from ~/.config/elevenlabs/env
(a line ELEVENLABS_API_KEY=...). Keep it out of the repo. The key needs the
Sound Effects, Music and Text to Speech permissions.
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
    "wind_shift": ("sfx", 2.0, "A strong gust of wind whooshing past outdoors, then settling"),
    "flap_1": ("sfx", 0.6, "Single mechanical split-flap departure board flap clack, close, dry"),
    "flap_2": ("sfx", 0.6, "One plastic flap of a split-flap display snapping over, short crisp click"),
    "emg_alert": ("sfx", 1.5, "Urgent airport alert tone: three quick high warning beeps, clean and clear, not harsh"),
    "siren": ("sfx", 4.0, "A fire engine siren wailing briefly in the distance, then fading away"),
    "birdstrike": ("sfx", 2.5, "A loud thud of a bird hitting a jet engine, then the engine sputtering and spooling down"),
    "scrape": ("sfx", 3.0, "Metal aircraft belly scraping along a runway, grinding and sparking, then sliding to a stop"),
    "medal": ("sfx", 2.0, "A short triumphant brass fanfare sting, two bright rising notes, cheerful"),
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


# --- radio dialogue (text-to-speech) ---------------------------------------
# Pilots talk to the tower in plain English. The game adds the radio sound
# (band-pass, crackle, squelch) live, so these are recorded clean. Callsigns
# are made up; never a real airline's.
VOICES = {
    "george": "JBFqnCBsd6RMkjVDRZzb",   # British
    "alice": "Xb7hH8MSUJpSbSDYk0k2",    # British
    "lily": "pFZP5JQG7iQjIQuC4Bku",     # British
    "charlie": "IKne3meq5aSn9XLyUdCD",  # Australian
    "fin": "D38z5RcWu1voky8WS1ja",      # Irish
    "brian": "nPczCjzI2devNBz1zQrb",    # American
    "chris": "iP95p4xoKVk53GoZ742B",    # American
    "laura": "FGY2WhTYpPnrIDTdsKH5",    # American
    "matilda": "XrExE9yKIg1WjnnlVkGX",  # American
    "bill": "pqHfZKP75CvOlQylNhV4",     # American
    "daniel": "onwK4e9ZLuTAKqWW03F9",   # British: the tower
}
PILOTS = [v for v in VOICES if v != "daniel"]
CALLSIGNS = ["Skylark one two", "Puffin four", "Kestrel seven", "Bluebird two one",
             "Heron three", "Swift five zero", "Gannet eight", "Meadow six"]
DIGITS = "zero one two three four five six seven eight niner".split()


def runway_numbers():
    """Every runway number painted in the game: both ends of every runway in
    levels.js, worked out exactly as art.js's designator() does."""
    import math
    import re
    levels = (OUT.parent / "levels.js").read_text()
    numbers = set()
    for angle in re.findall(r"kind: '(?:long|short)'[^}]*angle: (-?\d+)", levels):
        for end in (int(angle), int(angle) + 180):
            heading = ((end + 90) % 360 + 360) % 360
            n = math.floor(heading / 10 + 0.5) % 36 or 36
            numbers.add(f"{n:02d}")
    return sorted(numbers)


def spoken(number):
    return " ".join(DIGITS[int(d)] for d in number)


def speech_lines():
    """name: (voice, text, urgent). Names group into what the game deals
    from: say_land_27_1, say_land_27_2 … all answer to `say_land_27`."""
    lines = {}
    k = 0

    def add(prefix, texts, voices=None, urgent=False):
        nonlocal k
        for i, text in enumerate(texts, 1):
            voice = (voices or PILOTS)[k % len(voices or PILOTS)]
            k += 1
            lines[f"{prefix}_{i}"] = (voice, text, urgent)

    for number in runway_numbers():
        rw = spoken(number)
        call = CALLSIGNS[int(number) % len(CALLSIGNS)]
        add(f"say_land_{number}", [
            f"Cleared to land, runway {rw}.",
            f"Runway {rw}, cleared to land, {call}.",
            f"Cleared runway {rw}. Thanks, tower.",
        ])
    add("say_pad", ["Helipad in sight, coming in.", "Pad's in sight, setting down shortly.",
                    "Copy, heading for the pad.", "Rescue one, pad in sight."])
    add("say_turn", ["Copy, new heading.", "Wilco.", "Roger, turning now.",
                     "Understood, adjusting course.", "Turning, thanks tower.", "Copy that, on our way."])
    add("say_lowfuel", ["Tower, we're getting a bit low on fuel.",
                        "Tower, Puffin four, fuel's getting low. Could do with landing soon.",
                        "Fuel's running low up here, tower.",
                        "Request priority, we're low on fuel."])
    add("say_mayday", ["Mayday, mayday, mayday! Minimum fuel, we need to land now!",
                       "Mayday! We're nearly out of fuel, request immediate landing!",
                       "Mayday, mayday! Fuel critical!"], urgent=True)
    add("say_divert_fuel", ["Out of fuel, tower. Diverting to our alternate.",
                            "We can't wait any longer. Diverting."])
    add("say_divert_storm", ["Too rough in that storm. We're diverting.",
                             "Severe turbulence! We're out of here, diverting."], urgent=True)
    add("say_goaround", ["Going around.", "Going around, runway's changed.", "Copy, going around."])
    add("say_thanks", ["Thanks, tower. Lovely evening for it.", "On the ground. Thanks very much.",
                       "Smooth landing. Cheers, tower.", "Thank you, tower. See you next time.",
                       "Down safe, thanks!"])
    # Emergencies (v1.23.0): the arrival's call, its thanks, and what goes wrong.
    add("emg_fuel", ["Mayday, mayday, mayday. We're very low on fuel and need to land straight away.",
                     "Mayday, mayday, mayday. Fuel emergency, request priority landing.",
                     "Mayday, mayday. Minimum fuel. Please bring us straight in."], urgent=True)
    add("emg_medical", ["Pan-pan, pan-pan, pan-pan. Medical emergency on board, request priority landing.",
                        "Pan-pan, pan-pan. We have a sick passenger and need to land quickly.",
                        "Pan-pan, pan-pan, pan-pan. The doctor on board says we need to land as soon as possible."], urgent=True)
    add("emg_ambulance", ["Pan-pan, pan-pan. Air ambulance inbound with a patient, request the helipad.",
                          "Air ambulance, pan-pan, pan-pan. Patient on board, we need the pad please."], urgent=True)
    add("emg_damaged", ["Mayday, mayday, mayday. We've lost an engine and can't turn sharply. Request the long runway.",
                        "Mayday, mayday, mayday. Damaged aircraft, we need a long straight approach.",
                        "Mayday, mayday. One engine out. Long runway please, and fire crews standing by."], urgent=True)
    add("emg_state", ["Tower, State One inbound. Please keep the airspace clear around us.",
                      "State One on approach. We'll need the long runway and plenty of room."])
    add("emg_thanks", ["We're down safely. Thank you, tower, you're a star.",
                       "Wheels on the ground. Thank you so much, tower.",
                       "Landed safe and sound. Brilliant work, tower.",
                       "We made it. Thanks for getting us in, tower."])
    add("emg_timeout", ["We can't wait any longer, tower. Diverting to the hospital.",
                        "Out of time. We're diverting to get help."], urgent=True)
    # Grown-up emergencies (v1.24.0): only for grown-ups' profiles.
    add("emg_birdstrike", ["Mayday, mayday, mayday! Bird strike, we've lost an engine!",
                           "Mayday, mayday! We've hit a flock of birds. One engine down, request immediate landing."], urgent=True)
    add("emg_fire", ["Mayday, mayday, mayday! Engine fire! We need to land right now!",
                     "Mayday, mayday. Fire warning on the left engine. Request emergency landing, fire crews please."], urgent=True)
    add("emg_depress", ["Mayday, mayday! We've lost cabin pressure. Oxygen masks are down, descending now.",
                        "Mayday, mayday. Rapid decompression, emergency descent. We need the nearest runway."], urgent=True)
    add("emg_gear", ["Mayday, mayday, mayday. Our landing gear won't come down. We'll have to land on our belly.",
                     "Mayday, mayday. Gear failure. Request foam on the runway and fire crews standing by."], urgent=True)
    add("emg_hydraulic", ["Mayday, mayday. Hydraulic failure, we can barely steer. We need a long straight approach.",
                          "Mayday, mayday. We've lost hydraulics. Very limited control, give us plenty of room."], urgent=True)
    add("emg_unruly", ["Pan-pan, pan-pan. We have a disruptive passenger on board. Request priority landing and police.",
                       "Pan-pan, pan-pan. Unruly passenger, the crew need help. Please have the police meet us."], urgent=True)
    tower = ["daniel"]
    add("tower_foam", ["Foam going down on the runway. It's reserved for the emergency.",
                       "All aircraft, that runway is closed for a foam landing. Use another."], tower)
    add("tower_police", ["Police are on their way to meet the aircraft.",
                         "Police vehicles to the stand. Thank you, crew."], tower)
    add("tower_state", ["All aircraft, State One is inbound. Keep well clear.",
                        "Attention all traffic, State One approaching. Give them plenty of room."], tower)
    add("tower_breach", ["Traffic, you are too close to State One. Turn away immediately!",
                         "Security alert. Leave State One's airspace at once."], tower)
    add("tower_closed", ["All aircraft, runway closed for emergency vehicles.",
                         "Runway closed. Fire crews on the runway."], tower)
    add("tower_open", ["Runway open again. Thanks for waiting.",
                       "Emergency vehicles clear. The runway is open."], tower)
    add("tower_windwarn", ["All aircraft, wind change in five seconds. Runways will reverse.",
                           "All stations, stand by. The wind is shifting."], tower)
    add("tower_windflip", ["All aircraft, runways reversed. Check your approach.",
                           "Wind change complete. Landing direction reversed."], tower)
    add("tower_start", ["Tower is open. First arrivals inbound.", "Good evening, tower's open."], tower)
    add("tower_clear", ["That's the last one down. Lovely work, tower.",
                        "Shift complete. Nicely done."], tower)
    return lines


SPEECH = speech_lines()


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
    if name in SPEECH:
        voice, text, urgent = SPEECH[name]
        settings = {"stability": 0.3 if urgent else 0.5, "similarity_boost": 0.75,
                    "style": 0.45 if urgent else 0.15}
        audio = request(f"/text-to-speech/{VOICES[voice]}?output_format=mp3_22050_32",
                        {"text": text, "model_id": "eleven_multilingual_v2", "voice_settings": settings}, key)
        (OUT / f"{name}.mp3").write_bytes(audio)
        return len(audio)
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
            print(f"{name:20} {kind:6} {seconds:>4}s  {prompt}")
        for name, (voice, text, urgent) in SPEECH.items():
            print(f"{name:20} speech {voice:8} {text}")
        return
    OUT.mkdir(parents=True, exist_ok=True)
    everything = {**SOUNDS, **SPEECH}
    names = args or [n for n in everything if not (OUT / f"{n}.mp3").exists()]
    unknown = [n for n in names if n not in everything]
    if unknown:
        sys.exit(f"Unknown: {', '.join(unknown)}")
    key = api_key()
    for name in names:
        size = generate(name, key)
        print(f"{name}: {size // 1024} KB")


if __name__ == "__main__":
    main(sys.argv[1:])
