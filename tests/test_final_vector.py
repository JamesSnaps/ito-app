"""Final Vector is client-side like Final Approach, so these pin the page and
its files, the recorded voice pieces against the words the game can say, and
the records API. The command parser and the simulation are pure JS with no
DOM, so where node is installed they're run for real (skipped otherwise:
there's no JS test runner in this project)."""

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from test_smoke import client

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static" / "final-vector"


def page():
    res = client().get("/final-vector/")
    assert res.status_code == 200
    return res.get_data(as_text=True)


# --- the page ------------------------------------------------------------------

def test_the_hub_lists_it_as_a_preview():
    from games.final_vector.game import GAME
    from games.registry import get_game

    assert get_game("final-vector") is GAME
    assert not GAME.starts_rooms and not GAME.has_rooms
    assert "Preview" in GAME.tagline
    body = client().get("/").get_data(as_text=True)
    assert 'href="/final-vector/"' in body and "Final Vector" in body


def test_every_file_the_page_loads_exists_in_order():
    body = page()
    loaded = re.findall(r'(?:src|href)="/static/([^"?]+)', body)
    for path in loaded:
        assert (ROOT / "static" / path).is_file(), path
    order = [body.index(f"final-vector/{name}.js") for name in ("command", "sim", "radio", "scope", "lessons", "game")]
    assert order == sorted(order)


def test_it_brings_its_own_look_and_a_way_back():
    body = page()
    assert "final-vector/style.css" in body and 'href="/static/style.css' not in body
    assert 'href="/"' in body


def test_nothing_is_fetched_from_anywhere_else():
    """Fonts are Final Approach's, by URL; nothing from a CDN."""
    body = page()
    assert "http://" not in body and "https://" not in body
    for path in STATIC.glob("*.*"):
        text = path.read_text(encoding="utf-8").replace("http://www.w3.org/2000/svg", "")   # a namespace, not a fetch
        assert "http://" not in text and "https://" not in text, path.name
    css = (STATIC / "style.css").read_text(encoding="utf-8")
    for font in re.findall(r"url\(([^)]+)\)", css):
        assert (STATIC / font).resolve().is_file(), font


def test_final_approach_points_grown_ups_to_it():
    body = client().get("/final-approach/").get_data(as_text=True)
    assert 'href="/final-vector/"' in body and "Final Vector" in body


def test_the_academy_has_as_many_lessons_as_the_server_records():
    from games.final_vector.game import LESSONS

    lessons = (STATIC / "lessons.js").read_text(encoding="utf-8")
    assert re.findall(r"^      id: (\d+),", lessons, re.M) == [str(n) for n in range(1, LESSONS + 1)]
    # Every lesson has tasks, Ann's lines and a check.
    assert lessons.count("quiz: [") == LESSONS
    assert lessons.count("coach:") >= LESSONS * 3


# --- the pilots' voices -----------------------------------------------------------

def clips():
    source = (STATIC / "command.js").read_text(encoding="utf-8")
    return dict(re.findall(r"(\w+): '([^']+)'", source.split("const CLIPS = {")[1].split("};")[0]))


def test_every_piece_is_recorded_for_both_voices_and_listed_for_the_page():
    words = clips()
    voices = sorted(p.name for p in (STATIC / "voice").iterdir() if p.is_dir())
    assert len(voices) == 2
    for voice in voices:
        on_disk = {p.stem for p in (STATIC / "voice" / voice).glob("*.mp3")}
        assert on_disk == set(words), voice
    body = page()
    urls = json.loads(re.search(r"window\.FV_VOICE = (.*?);</script>", body).group(1))
    assert sorted(urls) == voices and all(set(urls[v]) == set(words) for v in voices)


def test_the_voices_stay_small():
    files = list((STATIC / "voice").rglob("*.mp3"))
    assert len(files) < 400
    assert sum(p.stat().st_size for p in files) < 1_000_000


def test_the_generator_reads_the_same_pieces():
    import importlib.util

    spec = importlib.util.spec_from_file_location("fvv", ROOT / "tools" / "final_vector_voice.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.clips() == clips()


# --- records ------------------------------------------------------------------------

def profile(c, name):
    res = c.post("/api/profiles", json={"name": name})
    assert res.status_code == 200, res.get_json()
    return {"X-Profile-Token": res.get_json()["token"]}


def lesson(c, headers, n):
    return c.post("/final-vector/api/lessons", json={"lesson": n}, headers=headers)


def shift(**overrides):
    import uuid

    body = {"id": uuid.uuid4().hex, "duration": 900, "arrivals": 8, "landed": 7, "losses": 1, "alerts": 2,
            "on_time": 6, "late": 1, "missed": 0, "through": 1, "left": 0, "delay": 95, "fast": 120}
    body.update(overrides)
    return body


def test_lessons_need_a_profile():
    c = client()
    assert lesson(c, {}, 1).status_code == 403
    assert lesson(c, {"X-Profile-Token": "nope"}, 1).status_code == 403


def test_lessons_are_passed_in_order_and_counted_once():
    c = client()
    ann = profile(c, "Ann")
    assert lesson(c, ann, 2).status_code == 400
    assert lesson(c, ann, 1).get_json() == {"lessons": [1]}
    assert lesson(c, ann, 1).get_json() == {"lessons": [1]}
    assert lesson(c, ann, 2).get_json() == {"lessons": [1, 2]}
    player = c.get("/final-vector/api/stats").get_json()["players"][0]
    assert player["name"] == "Ann" and player["lessons"] == [1, 2]


@pytest.mark.parametrize("body", [{"lesson": 0}, {"lesson": 6}, {"lesson": "1"}, {"lesson": True}, {"lesson": 1.5}, {}, [1]])
def test_odd_lessons_are_refused(body):
    c = client()
    ann = profile(c, "Ann")
    assert c.post("/final-vector/api/lessons", json=body, headers=ann).status_code == 400


def test_a_shift_needs_a_profile_and_the_academy():
    c = client()
    assert c.post("/final-vector/api/shifts", json=shift()).status_code == 403
    ann = profile(c, "Ann")
    res = c.post("/final-vector/api/shifts", json=shift(), headers=ann)
    assert res.status_code == 400 and "Academy" in res.get_json()["error"]


def test_a_shift_is_recorded_once_and_the_best_kept():
    c = client()
    ann = profile(c, "Ann")
    for n in range(1, 6):
        assert lesson(c, ann, n).status_code == 200
    first = shift()
    assert c.post("/final-vector/api/shifts", json=first, headers=ann).get_json()["recorded"] is True
    assert c.post("/final-vector/api/shifts", json=first, headers=ann).get_json()["recorded"] is False
    clean = shift(losses=0, delay=200)
    assert c.post("/final-vector/api/shifts", json=clean, headers=ann).status_code == 200
    data = c.get("/final-vector/api/stats").get_json()
    player = data["players"][0]
    assert player["shifts"] == 2 and player["landed"] == 14 and player["losses"] == 1
    assert player["best"]["losses"] == 0 and player["best"]["delay"] == 200
    assert len(data["recent"]) == 2


@pytest.mark.parametrize("change", [
    {"id": "x"}, {"landed": 9}, {"landed": -1}, {"losses": "2"}, {"on_time": 9}, {"duration": 10},
    {"fast": 5000}, {"arrivals": 0}, {"delay": 1.5}, {"missed": True},
])
def test_impossible_shifts_are_refused(change):
    c = client()
    ann = profile(c, "Ann")
    for n in range(1, 6):
        lesson(c, ann, n)
    res = c.post("/final-vector/api/shifts", json=shift(**change), headers=ann)
    assert res.status_code == 400, change


# --- the parser and the simulation, run by node ---------------------------------------

NODE = shutil.which("node")


def run_node(script):
    out = subprocess.run([NODE, "-e", script], capture_output=True, text=True, timeout=60, cwd=ROOT)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


@pytest.mark.skipif(NODE is None, reason="node isn't installed")
def test_the_command_grammar_reads_typed_and_spoken_commands_alike():
    cases = {
        "SKY412 L270 D40 S210": "SKY412 L270 A40 S210",
        "Skylark four one two, turn left heading two seven zero, descend four thousand feet, speed two one zero knots": "SKY412 L270 A40 S210",
        "sky4 ils": "SKY412 ILS",
        "PUF TWR": "PUF27 TWR",
        "Puffin two seven, contact tower one one eight decimal five": "PUF27 TWR",
        "MDW6 C50 S180": "MDW6 A50 S180",
        "Meadow six, descend flight level seven zero, reduce speed two hundred and ten knots": "MDW6 FL70 S210",
        "KES71 hold at Linnet": "KES71 HOLD LNT",
        "SKY412 H090 FL110": "SKY412 H090 FL110",
        "SKY412 cleared ILS approach runway two seven": "SKY412 ILS",
        "SKY 412 D3500": "SKY412 A35",
        "skylark 412 right heading 180": "SKY412 R180",
    }
    refused = ["SKY ILS", "SKY412 D4", "SKY412 L270 R090", "SKY412 ILS09", "SKY412 left", "SKY412 banana",
               "SKY412", "BLB9 L270", "SKY412 HOLD", "SKY412 L400"]
    script = f"""
      const C = require('./static/final-vector/command.js');
      const ctx = {{ callsigns: ['SKY412', 'SKY27', 'PUF27', 'MDW6', 'KES71'], fixes: {{ DNK: 'Dunnock', LNT: 'Linnet' }}, runway: '27' }};
      const norm = c => c.replace(/ [DC](\\d+)/g, ' A$1');
      const out = {{}};
      for (const t of {json.dumps(list(cases))}) {{ const r = C.parse(t, ctx); out[t] = r.ok ? norm(r.canonical) : 'ERR ' + r.error; }}
      out.refused = {json.dumps(refused)}.filter(t => C.parse(t, ctx).ok);
      const p = C.parse('SKY412 L270 D40 S210 ILS', ctx);
      const ac = {{ cs: 'SKY412', hdg: 300, alt: 6000 }};
      out.readback = C.text(C.readbackKeys(p.cmds, ac, ctx.fixes));
      out.clips = C.clips(C.readbackKeys(p.cmds, ac, ctx.fixes));
      out.controller = C.text(C.controllerKeys(p.cmds, ac, ctx.fixes));
      out.level = C.text(C.levelKeys(8000)) + ' / ' + C.text(C.levelKeys(3500));
      console.log(JSON.stringify(out));
    """
    out = run_node(script)
    for text, want in cases.items():
        assert out[text] == want, text
    assert out["refused"] == []
    assert out["readback"] == ("Left heading two seven zero, descend altitude four thousand feet, "
                               "speed two one zero knots, cleared ILS runway two seven, Skylark four one two.")
    assert out["controller"].startswith("Skylark four one two, turn left heading two seven zero")
    assert out["level"] == "Flight level eight zero. / Altitude three thousand five hundred feet."
    # Every piece of a readback is a recording, a number's last digit the falling one.
    words = clips()
    assert all(k == "," or k in words for k in out["clips"])
    assert out["clips"][:4] == ["left_heading", "d2", "d7", "e0"]


@pytest.mark.skipif(NODE is None, reason="node isn't installed")
def test_aircraft_fly_what_they_are_told_at_real_rates():
    script = """
      const { Sim } = require('./static/final-vector/sim.js');
      const out = {};
      // Turn, descent and speed.
      let s = Sim.create();
      let a = s.spawn({ cs: 'SKY412', type: 'A320', x: 20, y: 5, hdg: 270, alt: 6000, ias: 220 });
      s.instruct('SKY412', [{ t: 'hdg', hdg: 360, dir: 'R' }, { t: 'alt', ft: 4000 }, { t: 'spd', kt: 180 }]);
      s.step(20); out.hdg20 = a.hdg; out.alt20 = a.alt;
      s.step(60); out.hdg80 = a.hdg; out.alt80 = a.alt; out.ias80 = a.ias;
      // The long way round when told.
      s = Sim.create(); a = s.spawn({ cs: 'SKY412', type: 'A320', x: 20, y: 5, hdg: 270, alt: 6000, ias: 220 });
      s.instruct('SKY412', [{ t: 'hdg', hdg: 180, dir: 'R' }]); s.step(20); out.longWay = a.hdg;
      // A heavy turns slower.
      s = Sim.create(); a = s.spawn({ cs: 'KES71', type: 'B77W', x: 20, y: 5, hdg: 270, alt: 6000, ias: 220 });
      s.instruct('KES71', [{ t: 'hdg', hdg: 360, dir: 'R' }]); s.step(22.5); out.heavy = a.hdg;
      // ILS: a 30° cut below the glideslope captures and lands; 70° flies through; above the glideslope flies through.
      const ils = (hdg, alt, y) => {
        const s = Sim.create(); const a = s.spawn({ cs: 'SKY412', type: 'A320', x: 16, y, hdg, alt, ias: 180 });
        s.instruct('SKY412', [{ t: 'ils' }]);
        for (let i = 0; i < 900 && a.state === 'air'; i++) { s.step(1); if (a.loc && a.freq === 'mine' && a.x < 10) s.instruct('SKY412', [{ t: 'twr' }]); }
        return { state: a.state, kinds: s.events.map(e => e.kind), stats: s.stats };
      };
      out.good = ils(300, 3000, -4); out.steep = ils(340, 3000, -4); out.high = ils(240, 7000, 3);
      // Already lined up when cleared: on the centreline, or just beside it and parallel.
      out.onLine = ils(270, 2500, 0); out.beside = ils(270, 2500, 0.2);
      // Head on at the same level: the alert comes a minute before the loss.
      s = Sim.create();
      s.spawn({ cs: 'SKY412', type: 'A320', x: 25, y: 0, hdg: 270, alt: 5000, ias: 220 });
      s.spawn({ cs: 'MDW6', type: 'DH8D', x: 0, y: 0.2, hdg: 90, alt: 5000, ias: 200 });
      s.step(200);
      out.conflict = s.events.filter(e => e.kind === 'stca' || e.kind === 'los').map(e => [e.kind, e.t]);
      // ...and 1,000 ft apart they never conflict.
      s = Sim.create();
      s.spawn({ cs: 'SKY412', type: 'A320', x: 25, y: 0, hdg: 270, alt: 5000, ias: 220 });
      s.spawn({ cs: 'MDW6', type: 'DH8D', x: 0, y: 0.2, hdg: 90, alt: 4000, ias: 200 });
      s.step(200); out.stacked = s.events.length;
      // Unable: a speed the type can't fly changes nothing.
      s = Sim.create(); a = s.spawn({ cs: 'PUF27', type: 'B738', x: 20, y: 5, hdg: 270, alt: 6000, ias: 220 });
      out.unable = s.instruct('PUF27', [{ t: 'spd', kt: 120 }]).ok; out.spd = a.spd;
      out.early = s.instruct('PUF27', [{ t: 'twr' }]).ok;
      console.log(JSON.stringify(out));
    """
    out = run_node(script)
    # 3°/s after a 2.5 s pause: 52.5° in 20 s; level at 360 well inside 80 s.
    assert 50 <= out["hdg20"] - 270 <= 55 and out["hdg80"] == 0
    assert 5300 < out["alt20"] < 5700 and out["alt80"] < 4100 and out["ias80"] < 190
    assert 300 <= out["longWay"] <= 330          # right from 270, not left toward 180
    assert 318 <= out["heavy"] <= 323            # 2.5°/s, where an A320 would be at 330
    assert out["good"]["state"] == "landed" and out["good"]["stats"]["onTime"] == 1
    assert out["good"]["kinds"][0] == "established" and "glideslope" in out["good"]["kinds"] and "through" not in out["good"]["kinds"]
    assert out["steep"]["state"] != "landed" and "through" in out["steep"]["kinds"]
    assert out["high"]["state"] != "landed" and "through" in out["high"]["kinds"]
    for lined_up in ("onLine", "beside"):
        assert out[lined_up]["state"] == "landed" and out[lined_up]["kinds"][0] == "established", lined_up
    kinds = [k for k, _ in out["conflict"]]
    assert kinds == ["stca", "los"]
    assert 55 <= out["conflict"][1][1] - out["conflict"][0][1] <= 65
    assert out["stacked"] == 0
    assert out["unable"] is False and out["spd"] == 220 and out["early"] is False
