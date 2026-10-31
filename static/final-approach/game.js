(() => {
  'use strict';

  const W = 960, H = 600;
  const TAU = Math.PI * 2;
  const EDGE = 14;          // aircraft turn back when they reach this close to the edge
  const SPACING = 8;        // distance between recorded route points
  const MAX_LIVES = 3;

  const TYPES = {
    prop:  { name: 'Prop',       speed: 30, radius: 11, kind: 'short', trail: false },
    jet:   { name: 'Jet',        speed: 44, radius: 13, kind: 'long',  trail: true },
    heavy: { name: 'Heavy',      speed: 50, radius: 18, kind: 'long',  trail: true },
    heli:  { name: 'Helicopter', speed: 24, radius: 10, kind: 'pad',   trail: false },
  };
  for (const k in TYPES) TYPES[k].color = Art.COLORS[k].main;
  const KINDS = {
    short: { label: 'Short strip', color: Art.COLORS.prop.main },
    long:  { label: 'Long runway', color: Art.COLORS.jet.main },
    pad:   { label: 'Helipad',     color: Art.COLORS.heli.main },
  };

  // ---------- helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const angDiff = (a, b) => {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  };
  const $ = id => document.getElementById(id);
  const pad2 = n => String(n).padStart(2, '0');

  // ---------- save data ----------
  const SAVE_KEY = 'final-approach:save';
  const save = (() => {
    const blank = {
      stars: {}, best: 0, bestCalm: 0, muted: false,
      vol: { sfx: 0.8, voice: 0.9, music: 0.8 },
      large: false, haptics: true, calm: false, taught: false, outbox: [],
    };
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { /* fresh start */ }
    const merged = Object.assign(blank, saved);
    merged.vol = Object.assign({ sfx: 0.8, voice: 0.9, music: 0.8 }, saved.vol || {});
    // Before v1.22.0 music was an on/off switch.
    if (saved.music === false && !saved.vol) merged.vol.music = 0;
    delete merged.music;
    return merged;
  })();
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* private mode */ }
  }

  // ---------- sound ----------
  // Recorded sounds and music (static/final-approach/audio/, made once with
  // tools/final_approach_sounds.py) play through WebAudio. Anything not loaded
  // yet falls back to the small synth below, so the game is never silent and
  // never waits on a download. Four buses: effects, the landscape's bed, the
  // engines of whatever is flying, and music.
  const AUDIO = window.FA_AUDIO || {};
  let actx = null, bus = null;
  function audio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
      const master = actx.createGain();
      master.connect(actx.destination);
      const mk = vol => { const g = actx.createGain(); g.gain.value = vol; g.connect(master); return g; };
      bus = { master, sfx: mk(0.9), bed: mk(0), engine: mk(0.3), music: mk(0) };
      // The radio: clean recordings in, a small band-limited speaker out.
      const hp = actx.createBiquadFilter(), lp = actx.createBiquadFilter(), drive = actx.createWaveShaper();
      hp.type = 'highpass'; hp.frequency.value = 380;
      lp.type = 'lowpass'; lp.frequency.value = 3000;
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2); }
      drive.curve = curve;
      bus.radio = actx.createGain();
      bus.radio.gain.value = 1.1;
      bus.radio.connect(hp); hp.connect(lp); lp.connect(drive); drive.connect(bus.sfx);
      applyVolumes();
      // Effects and speech are small: fetch them all now. Loops and music load when needed.
      for (const name of Object.keys(AUDIO)) if (!/^(bed|engine|music)_/.test(name)) load(name);
    }
    if (actx.state === 'suspended' && !document.hidden) actx.resume();
    return actx;
  }
  function applyVolumes() {
    if (!bus) return;
    const now = actx.currentTime;
    bus.master.gain.setTargetAtTime(save.muted ? 0 : 1, now, 0.05);
    bus.sfx.gain.setTargetAtTime(0.9 * save.vol.sfx, now, 0.05);
    bus.engine.gain.setTargetAtTime(0.3 * save.vol.sfx, now, 0.05);
    if (bus.radio) bus.radio.gain.setTargetAtTime(1.1 * save.vol.voice, now, 0.05);
  }
  const musicOn = () => !save.muted && save.vol.music > 0;

  // Vibration, where the phone allows it (Android does; iPhones don't).
  function buzz(pattern) {
    if (save.haptics === false || !navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch { /* not allowed here */ }
  }

  const buffers = {}, loading = {};
  function load(name) {
    if (!AUDIO[name] || !actx) return Promise.resolve(null);
    if (!loading[name]) {
      loading[name] = fetch(AUDIO[name])
        .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
        .then(data => new Promise((ok, fail) => actx.decodeAudioData(data, ok, fail)))
        .then(buf => (buffers[name] = buf))
        .catch(() => null);
    }
    return loading[name];
  }

  // A one-shot from a file. False when it isn't loaded, so the caller can fall
  // back. Every sound fades in over a few milliseconds (no click), and can
  // fade out over its last `fadeOut` seconds, so nothing stops dead.
  function playSound(name, { vol = 1, rate = 1, pan = 0, fadeOut = 0.08 } = {}) {
    if (!actx || !buffers[name]) { if (actx) load(name); return false; }
    const src = actx.createBufferSource(), g = actx.createGain();
    src.buffer = buffers[name];
    src.playbackRate.value = rate;
    const t0 = actx.currentTime, dur = src.buffer.duration / rate;
    const fade = Math.min(fadeOut, dur / 2);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.015);
    g.gain.setValueAtTime(vol, t0 + dur - fade);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    let out = g;
    if (pan && actx.createStereoPanner) { const p = actx.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    src.connect(g);
    out.connect(bus.sfx);
    src.start();
    return true;
  }
  const pick = list => list[Math.floor(Math.random() * list.length)];

  // Every recording of something (`touchdown_jet` → touchdown_jet_1, _2, …),
  // dealt like a shuffled deck: all of them before any repeats, and never the
  // same one twice running.
  const decks = {};
  function variants(prefix) {
    return Object.keys(AUDIO).filter(n => n === prefix || n.startsWith(prefix + '_'));
  }
  function deal(prefix) {
    const all = variants(prefix);
    if (!all.length) return null;
    let d = decks[prefix];
    if (!d || !d.left.length) {
      const left = all.slice().sort(() => Math.random() - 0.5);
      if (d && left.length > 1 && left[left.length - 1] === d.last) left.unshift(left.pop());
      d = decks[prefix] = { left, last: d && d.last };
    }
    d.last = d.left.pop();
    return d.last;
  }

  // A loop that never clicks: each repeat fades in over the last one's tail.
  // (MP3 adds a sliver of silence at both ends, so buffer looping would gap.)
  function startLoop(name, out, fade = 1) {
    const loop = { gain: actx.createGain(), timer: 0, stopped: false, sources: new Set() };
    loop.gain.connect(out);
    const run = when => {
      const buf = buffers[name];
      if (!buf || loop.stopped) return;
      const f = Math.min(fade, buf.duration / 3);
      const src = actx.createBufferSource(), g = actx.createGain();
      src.buffer = buf;
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(1, when + f);
      g.gain.setValueAtTime(1, when + buf.duration - f);
      g.gain.linearRampToValueAtTime(0, when + buf.duration);
      src.connect(g).connect(loop.gain);
      src.start(when);
      src.stop(when + buf.duration + 0.05);
      loop.sources.add(src);
      src.onended = () => loop.sources.delete(src);
      const next = when + buf.duration - f;
      loop.timer = setTimeout(() => run(next), Math.max(0, (next - actx.currentTime - 0.6) * 1000));
    };
    load(name).then(() => run(actx.currentTime + 0.05));
    loop.stop = (secs = 1) => {
      loop.stopped = true;
      clearTimeout(loop.timer);
      loop.gain.gain.setTargetAtTime(0, actx.currentTime, secs / 3);
      setTimeout(() => {
        for (const src of loop.sources) { try { src.stop(); } catch { /* already stopped */ } }
        loop.gain.disconnect();
      }, secs * 1000 + 300);
    };
    return loop;
  }

  // The fallback synth, from before there were recordings.
  function tone(freq, dur, { type = 'sine', vol = 0.12, slide = 0, delay = 0 } = {}) {
    const a = audio(); if (!a) return;
    const t0 = a.currentTime + delay;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(bus.sfx);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise(dur, vol, freq = 900, type = 'lowpass') {
    const a = audio(); if (!a) return;
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
    const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    src.buffer = buf; f.type = type; f.frequency.value = freq; g.gain.value = vol;
    src.connect(f).connect(g).connect(bus.sfx);
    src.start();
  }

  const FAMILY = { prop: 'prop', jet: 'jet', heavy: 'jet', heli: 'heli' };
  const panOf = x => Math.max(-0.7, Math.min(0.7, (x / 960 - 0.5) * 1.4));
  let lastFlap = 0, lastTouchdown = -9;

  // Radio calls. Pilots (and now and then the tower) speak through the radio
  // bus with a squelch either side. One call at a time with a few seconds'
  // quiet after, so it stays a treat; urgent calls (maydays, diverts, the
  // tower) wait their turn instead of being dropped. Music and the background
  // dip while anyone speaks.
  let radioBusy = 0, radioFree = 0;
  const radioQueue = [];
  let hiss = null;
  function squelch(at, len, vol) {
    if (!hiss) {
      hiss = actx.createBuffer(1, Math.floor(actx.sampleRate * 0.3), actx.sampleRate);
      const d = hiss.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = actx.createBufferSource(), g = actx.createGain();
    src.buffer = hiss;
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + len);
    src.connect(g).connect(bus.radio);
    src.start(at, Math.random() * 0.05, len);
  }
  function say(prefix, p, { priority = false, chance = 1, delay = 0 } = {}) {
    if (!actx || save.muted || Math.random() > chance) return false;
    const now = actx.currentTime;
    if (now < radioBusy || (!priority && now < radioFree)) {
      if (priority && radioQueue.length < 2) radioQueue.push([prefix, p]);
      return false;
    }
    const name = deal(prefix);
    if (!name) return false;
    if (!buffers[name]) { load(name); return false; }
    const buf = buffers[name], t0 = now + 0.09 + delay;
    scape.said = (scape.said || []).concat(name).slice(-12);  // for checks
    squelch(t0 - 0.07, 0.05, 0.12);
    const src = actx.createBufferSource(), g = actx.createGain();
    src.buffer = buf;
    g.gain.value = 0.95;
    let out = g;
    if (p && actx.createStereoPanner) { const pan = actx.createStereoPanner(); pan.pan.value = panOf(p.x) * 0.5; g.connect(pan); out = pan; }
    src.connect(g);
    out.connect(bus.radio);
    src.start(t0);
    const end = t0 + buf.duration;
    squelch(end + 0.02, 0.16, 0.18);
    radioBusy = end + 0.25;
    radioFree = radioBusy + 3.5;
    scape.duckUntil = radioBusy;
    setTimeout(() => {
      const next = radioQueue.shift();
      if (next) say(next[0], next[1], { priority: true });
    }, (radioBusy - now) * 1000 + 60);
    return true;
  }

  const sfx = {
    land:      () => tone(1320, 0.14, { vol: 0.05 }),
    // A landing right after another is quieter, and each fades out gently.
    touchdown: p => {
      const name = actx && deal('touchdown_' + FAMILY[p.type]);
      const close = actx && actx.currentTime - lastTouchdown < 2;
      if (actx) lastTouchdown = actx.currentTime;
      return (name && playSound(name, { vol: close ? 0.35 : 0.75, pan: panOf(p.x), rate: 0.94 + Math.random() * 0.12, fadeOut: 1.4 })) ||
             (tone(660, 0.12), tone(990, 0.18, { delay: 0.1 }));
    },
    // A readback with the real runway number ("cleared to land, runway two seven").
    lock:      p => {
      tone(1180, 0.05, { type: 'triangle', vol: 0.05 });
      buzz(12);
      const end = p.landing;
      say(end.kind === 'pad' ? 'say_pad' : 'say_land_' + Art.designator(end.angle * 180 / Math.PI), p);
    },
    // A two-tone traffic alert: high, then low.
    warn:      () => { tone(1046, 0.09, { type: 'square', vol: 0.035 }); tone(784, 0.11, { type: 'square', vol: 0.035, delay: 0.1 }); },
    spawn:     () => tone(520, 0.1, { type: 'triangle', vol: 0.035 }),
    divert:    p => {
      say(p.divertedBy === 'Storm' ? 'say_divert_storm' : 'say_divert_fuel', p, { priority: true });
      return playSound('divert', { vol: 0.6, pan: panOf(p.x) }) || tone(500, 0.4, { type: 'sawtooth', vol: 0.05, slide: -300 });
    },
    crash:     () => playSound('collision') || (noise(1, 0.5), tone(140, 0.7, { type: 'sawtooth', vol: 0.12, slide: -90 })),
    start:     () => playSound('chime_start', { vol: 0.6 }),
    win:       () => playSound('chime_clear', { vol: 0.7 }) || [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { vol: 0.1, delay: i * 0.12 })),
    lose:      () => playSound('chime_fail', { vol: 0.7 }) || [392, 330, 262].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.1, delay: i * 0.15 })),
    wind:      () => playSound('wind_shift', { vol: 0.7 }) || tone(260, 0.5, { type: 'triangle', vol: 0.08, slide: 240 }),
    rattle:    () => playSound('flap_rattle', { vol: 0.35 }),
    flap:      () => {
      if (!actx || actx.currentTime - lastFlap < 0.03) return;
      lastFlap = actx.currentTime;
      playSound(pick(['flap_1', 'flap_2']), { vol: 0.18, rate: 0.9 + Math.random() * 0.25 }) || noise(0.018, 0.09, 2400, 'bandpass');
    },
  };
  Flap.onTick(sfx.flap);
  document.addEventListener('pointerdown', () => audio());

  // The soundscape follows the game every frame: the landscape's bed, an
  // engine loop per aircraft family (louder with more of them, panned to
  // where they are), and music that turns busy as the sky fills.
  const scape = { bedName: null, bed: null, engines: {}, musicName: null, music: null, busySince: 0, calmSince: 0 };
  function setMusic(name) {
    if (scape.musicName === name) return;
    if (scape.music) scape.music.stop(4);
    scape.musicName = name;
    scape.music = name && musicOn() ? startLoop(name, bus.music, 3) : null;
  }
  function soundscape(clock) {
    if (!actx || !S.level) return;
    const now = actx.currentTime;
    const playing = S.screen === 'play' || S.screen === 'ending';

    const bedName = 'bed_' + S.level.theme;
    if (scape.bedName !== bedName) {
      if (scape.bed) scape.bed.stop(1.5);
      scape.bedName = bedName;
      scape.bed = startLoop(bedName, bus.bed, 2);
    }
    const duck = now < (scape.duckUntil || 0) ? 0.5 : 1;
    bus.bed.gain.setTargetAtTime((playing ? 0.32 : 0.12) * duck * save.vol.sfx, now, 0.25);

    const counts = { jet: [], prop: [], heli: [] };
    if (playing) for (const p of S.planes) if (p.state === 'fly' || p.state === 'divert') counts[FAMILY[p.type]].push(p.x);
    for (const fam of Object.keys(counts)) {
      const xs = counts[fam];
      let e = scape.engines[fam];
      if (!e && xs.length) {
        e = scape.engines[fam] = { loop: startLoop('engine_' + fam, bus.engine, 1), pan: actx.createStereoPanner ? actx.createStereoPanner() : null };
        if (e.pan) { e.loop.gain.disconnect(); e.loop.gain.connect(e.pan); e.pan.connect(bus.engine); }
      }
      if (!e) continue;
      e.loop.gain.gain.setTargetAtTime(xs.length ? Math.min(1, 0.35 + 0.2 * xs.length) : 0, now, 0.5);
      if (e.pan && xs.length) e.pan.pan.setTargetAtTime(panOf(xs.reduce((a, b) => a + b, 0) / xs.length), now, 0.5);
    }

    // Busy when most of the allowed traffic is up, or two are in conflict;
    // back to calm only after a quiet spell, so it doesn't flicker.
    let track = 'music_board';
    if (playing) {
      const airborne = counts.jet.length + counts.prop.length + counts.heli.length;
      // Calm skies keeps the music calm too.
      const busy = !save.calm && (S.conflicts.length > 0 || airborne >= Math.max(3, S.level.traffic.maxPlanes * 0.7));
      if (busy) scape.busySince = clock; else scape.calmSince = clock;
      const wasBusy = scape.musicName === 'music_busy';
      track = busy || (wasBusy && clock - scape.busySince < 10) ? 'music_busy' : 'music_calm';
    }
    setMusic(track);
    bus.music.gain.setTargetAtTime(musicOn() ? (S.screen === 'pause' || S.screen === 'settings' ? 0.12 : 0.3) * duck * save.vol.music : 0, now, 0.3);
  }

  // ---------- canvas / view ----------
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0, dpr: 1 };
  let terrainTimer = 0;
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    view.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(w * view.dpr);
    canvas.height = Math.round(h * view.dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    view.scale = Math.min(w / W, h / H);
    view.x = (w - W * view.scale) / 2;
    view.y = (h - H * view.scale) / 2;
    clearTimeout(terrainTimer);
    terrainTimer = setTimeout(paintTerrain, 120);
  }
  // Phones held upright get a "turn sideways" overlay (see style.css); don't let the game run behind it.
  const portrait = window.matchMedia('(orientation: portrait) and (max-width: 700px)');
  window.addEventListener('resize', () => { resize(); if (portrait.matches) pause(); });

  // ---------- game state ----------
  const S = {
    screen: 'menu',   // menu | brief | play | pause | ending | result
    level: null, terrain: null, sky: { clouds: [] }, snow: [],
    planes: [], storms: [], effects: [], incoming: [], conflicts: [],
    landed: 0, lives: MAX_LIVES, time: 0, spawnTimer: 0,
    flipped: false, windTimer: 0, windWarned: false,
    drawing: null, overTimer: 0, outcome: null, warnCooldown: 0, nextId: 1,
  };

  function paintTerrain() {
    if (!S.level) return;
    const px = Math.min(3, Math.max(1, view.scale * view.dpr));
    S.terrain = Art.buildTerrain(S.level, THEMES[S.level.theme], px, Art.COLORS.heli.main);
  }

  function loadLevel(level) {
    const th = THEMES[level.theme];
    Object.assign(S, {
      level, planes: [], storms: [], effects: [], incoming: [], conflicts: [],
      landed: 0, lives: MAX_LIVES, time: 0, spawnTimer: 1,
      flipped: false, windTimer: level.windShift || 0, windWarned: false,
      drawing: null, overTimer: 0, outcome: null, warnCooldown: 0, shiftId: null, assisted: false,
      sky: Art.sky(th, level.id * 31), snow: th.snowfall ? Art.snowfall(140) : [],
    });
    paintTerrain();
    const rng = Art.mulberry32(level.id * 977);
    for (let i = 0; i < (level.storms || 0); i++) S.storms.push(makeStorm(level, rng));
  }

  function runwayEnd(r) {
    if (r.kind === 'pad') return { kind: 'pad', x: r.x, y: r.y, angle: null, runway: r };
    const a = r.angle * Math.PI / 180;
    if (!S.flipped) return { kind: r.kind, x: r.x, y: r.y, angle: a, length: r.length, runway: r };
    return {
      kind: r.kind, length: r.length, runway: r, angle: a + Math.PI,
      x: r.x + Math.cos(a) * r.length, y: r.y + Math.sin(a) * r.length,
    };
  }

  function makeStorm(level, rng) {
    const r = 48 + rng() * 14;
    const a = rng() * TAU;
    // start clear of runways and approach paths
    let x = W / 2, y = H / 2;
    for (let tries = 0; tries < 40; tries++) {
      x = lerp(r + 40, W - r - 40, rng());
      y = lerp(r + 40, H - r - 40, rng());
      const clear = level.runways.every(rw => {
        if (rw.kind === 'pad') return dist(x, y, rw.x, rw.y) > r + 50;
        const ra = rw.angle * Math.PI / 180;
        const ex = rw.x + Math.cos(ra) * rw.length, ey = rw.y + Math.sin(ra) * rw.length;
        return dist(x, y, rw.x - Math.cos(ra) * 60, rw.y - Math.sin(ra) * 60) > r + 50 &&
               dist(x, y, ex + Math.cos(ra) * 60, ey + Math.sin(ra) * 60) > r + 50 &&
               dist(x, y, (rw.x + ex) / 2, (rw.y + ey) / 2) > r + 40;
      });
      if (clear) break;
    }
    const st = { x, y, r, vx: Math.cos(a) * 14, vy: Math.sin(a) * 14, rot: 0, flash: 0, flashIn: 2 + rng() * 3, bolt: [] };
    st.sprite = Art.stormSprite(st, rng);
    return st;
  }

  // ---------- traffic ----------
  function progress() {
    return S.level.endless ? clamp(S.time / 300, 0, 1) : clamp(S.landed / S.level.target, 0, 1);
  }
  function spawnInterval() {
    const [a, b] = S.level.traffic.interval;
    return lerp(a, b, progress()) * (0.85 + Math.random() * 0.3);
  }
  function pickType() {
    const entries = Object.entries(S.level.traffic.types);
    let roll = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
    for (const [type, w] of entries) if ((roll -= w) <= 0) return type;
    return entries[0][0];
  }
  // Where a storm will be `t` seconds from now. Storms drift in straight
  // lines and bounce off the edges, so this is exact, not a guess.
  function stormAt(st, t) {
    let x = st.x, y = st.y, vx = st.vx, vy = st.vy;
    const m = st.r * 0.6, step = 0.1;
    for (let k = 0; k < t; k += step) {
      x += vx * step; y += vy * step;
      if ((x < m && vx < 0) || (x > W - m && vx > 0)) vx = -vx;
      if ((y < m && vy < 0) || (y > H - m && vy > 0)) vy = -vy;
    }
    return { x, y };
  }

  // An arrival must never meet a storm before you've had a chance to route
  // it: checked from the moment its marker appears until it has been in the
  // air for SAFE_FLIGHT seconds, flying straight as it will until you draw.
  const SAFE_FLIGHT = 5;
  function clearOfStorms(x, y, heading, speed, lead) {
    for (let t = 0; t <= SAFE_FLIGHT; t += 0.25) {
      const px = x + Math.cos(heading) * speed * t, py = y + Math.sin(heading) * speed * t;
      for (const st of S.storms) {
        const at = stormAt(st, lead + t);
        if (dist(px, py, at.x, at.y) < st.r * 0.8 + 30) return false;
      }
    }
    return true;
  }

  // Where every aircraft will be over the next few seconds if nobody touches
  // it: along its route, then straight on, turning back at the edges as it
  // would. Samples every TRACK_STEP seconds. Aircraft on the ground, or that
  // will be by then, drop out (null); so do diverting ones, which can't collide.
  const TRACK_STEP = 0.2;
  function track(p, secs) {
    const out = [];
    let x = p.x, y = p.y, h = p.heading, i = 0, entered = p.entered;
    const step = p.T.speed * TRACK_STEP;
    for (let t = 0; t <= secs + 1e-6; t += TRACK_STEP) {
      out.push({ x, y });
      let left = step;
      while (left > 0 && i < p.path.length) {
        const q = p.path[i], d = dist(x, y, q.x, q.y);
        if (d > 0.001) h = Math.atan2(q.y - y, q.x - x);
        if (d <= left) { x = q.x; y = q.y; i++; left -= d; } else { x += Math.cos(h) * left; y += Math.sin(h) * left; left = 0; }
      }
      if (i >= p.path.length && p.landing) { while (out.length <= secs / TRACK_STEP + 1) out.push(null); break; }
      x += Math.cos(h) * left; y += Math.sin(h) * left;
      if (!entered && x > EDGE && x < W - EDGE && y > EDGE && y < H - EDGE) entered = true;
      if (entered) {
        if ((x < EDGE && Math.cos(h) < 0) || (x > W - EDGE && Math.cos(h) > 0)) h = Math.PI - h;
        if ((y < EDGE && Math.sin(h) < 0) || (y > H - EDGE && Math.sin(h) > 0)) h = -h;
      }
    }
    return out;
  }

  // An arrival must not come within warning distance of anyone in its first
  // SAFE_FLIGHT seconds: not those already flying (wherever their routes take
  // them), nor arrivals still waiting at the edges. `wait` is how long until
  // it appears. Same promise as the storms: nothing ends your shift before
  // you've had a chance to act.
  function clearOfTraffic(type, x, y, heading, wait, self) {
    const r = TYPES[type].radius, v = TYPES[type].speed, span = wait + SAFE_FLIGHT;
    const others = [];
    for (const p of S.planes) if (p.state === 'fly') others.push({ r: p.T.radius, at: track(p, span) });
    for (const o of S.incoming) {
      if (o === self) continue;
      const ov = TYPES[o.type].speed, at = [];
      for (let t = 0; t <= span + 1e-6; t += TRACK_STEP) {
        const flown = t - o.t;
        at.push(flown < 0 ? null : { x: o.x + Math.cos(o.heading) * ov * flown, y: o.y + Math.sin(o.heading) * ov * flown });
      }
      others.push({ r: TYPES[o.type].radius, at });
    }
    for (let t = 0; t <= SAFE_FLIGHT + 1e-6; t += TRACK_STEP) {
      const px = x + Math.cos(heading) * v * t, py = y + Math.sin(heading) * v * t;
      const k = Math.round((wait + t) / TRACK_STEP);
      for (const o of others) {
        const q = o.at[Math.min(k, o.at.length - 1)];
        if (q && dist(px, py, q.x, q.y) < (r + o.r) * 2.6) return false;
      }
    }
    return true;
  }

  // At the moment an arrival is due: in if its way is clear, otherwise swung
  // onto a clear heading, otherwise held at the edge for another moment.
  function admit(s) {
    const turns = [0, 0.25, -0.25, 0.5, -0.5, 0.75, -0.75];
    for (const turn of turns) {
      const heading = s.heading + turn;
      const inward = Math.cos(heading) * (W / 2 - s.x) + Math.sin(heading) * (H / 2 - s.y) > 0;
      if (!inward) continue;
      if (clearOfTraffic(s.type, s.x, s.y, heading, 0, s) && clearOfStorms(s.x, s.y, heading, TYPES[s.type].speed, 0)) {
        s.heading = heading;
        return true;
      }
    }
    return false;
  }

  // The HUD's plates sit over the top of the map. An arrival's marker must
  // never hide under one, so those stretches of the top edge are off limits.
  function underHud(x, y) {
    if (y > 0) return false;
    const r = canvas.getBoundingClientRect();
    const sx = r.left + view.x + x * view.scale;
    for (const plate of document.querySelectorAll('#hud .plate')) {
      const b = plate.getBoundingClientRect();
      if (!b.width) continue;
      if (sx > b.left - 40 && sx < b.right + 40) return true;
    }
    return false;
  }

  function queueArrival() {
    const type = pickType();
    const lead = S.level.traffic.warning || 2;
    let fallback = null;
    for (let attempt = 0; attempt < 24; attempt++) {
      const side = Math.floor(Math.random() * 4);
      const along = Math.random();
      let x, y;
      if (side === 0) { x = lerp(80, W - 80, along); y = -30; }
      else if (side === 1) { x = W + 30; y = lerp(80, H - 80, along); }
      else if (side === 2) { x = lerp(80, W - 80, along); y = H + 30; }
      else { x = -30; y = lerp(80, H - 80, along); }
      const tx = lerp(W * 0.3, W * 0.7, Math.random()), ty = lerp(H * 0.3, H * 0.7, Math.random());
      const heading = Math.atan2(ty - y, tx - x);
      if (underHud(x, y)) continue;
      if (!clearOfStorms(x, y, heading, TYPES[type].speed, lead)) continue;
      if (!clearOfTraffic(type, x, y, heading, lead, null)) continue;
      const arrival = { type, x, y, heading, t: lead, lead };
      const crowded = S.planes.some(p => dist(p.x, p.y, x, y) < 150) ||
                      S.incoming.some(s => dist(s.x, s.y, x, y) < 150);
      if (!crowded) { S.incoming.push(arrival); return true; }
      fallback = fallback || arrival;
    }
    // Crowded is acceptable when nothing better turned up; into a storm or
    // someone's path never is.
    if (fallback) { S.incoming.push(fallback); return true; }
    return false;
  }
  function spawnPlane(s) {
    const T = TYPES[s.type];
    const fuel = S.level.traffic.fuel * (0.9 + Math.random() * 0.25);
    S.planes.push({
      id: S.nextId++, type: s.type, T, x: s.x, y: s.y, heading: s.heading, rot: s.heading,
      path: [], landing: null, state: 'fly', fuel, maxFuel: fuel, odo: 0,
      entered: false, warn: false, t: Math.random() * 10, age: 0, landT: 0, alt: 1, scale: 1, alpha: 1,
      trail: [], trailT: 0,
    });
    sfx.spawn();
  }

  // ---------- simulation ----------
  function update(dt, clock) {
    for (const e of S.effects) e.t += dt;
    S.effects = S.effects.filter(e => e.t < e.life);
    if (S.level) {
      Art.updateSky(S.sky, dt);
      if (S.snow.length) Art.updateSnow(S.snow, dt, clock);
    }

    if (S.screen === 'ending') {
      S.overTimer -= dt;
      for (const p of S.planes) if (p.state === 'land') updateLanding(p, dt);
      if (S.overTimer <= 0) showResult();
      return;
    }
    if (S.screen !== 'play') return;

    const L = S.level;
    S.time += dt;

    // arrivals
    S.spawnTimer -= dt;
    if (S.spawnTimer <= 0) {
      const airborne = S.planes.filter(p => p.state === 'fly').length + S.incoming.length;
      const needed = L.endless || S.landed + airborne < L.target;
      if (airborne < L.traffic.maxPlanes && needed) {
        // Every way in blocked by storms: try again in a moment.
        S.spawnTimer = queueArrival() ? spawnInterval() : 1;
      } else {
        S.spawnTimer = 1;
      }
    }
    for (const s of S.incoming) s.t -= dt;
    for (const s of S.incoming) {
      if (s.t > 0) continue;
      if (admit(s)) { spawnPlane(s); s.done = true; }
      else { s.t = 0.3; s.held = true; }   // held at the edge: try again shortly
    }
    S.incoming = S.incoming.filter(s => !s.done);

    // wind
    if (L.windShift) {
      S.windTimer -= dt;
      if (!S.windWarned && S.windTimer <= 5) {
        S.windWarned = true;
        toast('Wind shift in 5');
        sfx.wind();
        say('tower_windwarn', null, { priority: true });
      }
      if (S.windTimer <= 0) flipWind();
    }

    for (const st of S.storms) updateStorm(st, dt);
    for (const p of S.planes) {
      if (p.state === 'fly') updateFlight(p, dt);
      else if (p.state === 'land') updateLanding(p, dt);
      else if (p.state === 'divert') updateDivert(p, dt);
    }
    S.planes = S.planes.filter(p => p.state !== 'gone');

    checkSeparation(dt);
    if (S.screen !== 'play') return;

    if (S.lives <= 0) return endLevel('strikes');
    if (!L.endless && S.landed >= L.target && !S.planes.some(p => p.state === 'land')) return endLevel('win');
    updateHud();
  }

  function move(p, step) {
    p.x += Math.cos(p.heading) * step;
    p.y += Math.sin(p.heading) * step;
    p.odo += step;
  }

  function updateFlight(p, dt) {
    p.t += dt;
    p.age += dt;
    p.fuel -= dt;
    let step = p.T.speed * dt;
    while (step > 0 && p.path.length) {
      const q = p.path[0];
      const d = dist(p.x, p.y, q.x, q.y);
      if (d > 0.001) p.heading = Math.atan2(q.y - p.y, q.x - p.x);
      if (d <= step) { p.x = q.x; p.y = q.y; p.odo += d; p.path.shift(); step -= d; }
      else { move(p, step); step = 0; }
    }
    if (!p.path.length && p.landing) return beginLanding(p);
    if (step > 0) move(p, step);

    if (!p.entered && p.x > EDGE && p.x < W - EDGE && p.y > EDGE && p.y < H - EDGE) p.entered = true;
    if (p.entered) {
      const c = Math.cos(p.heading), s = Math.sin(p.heading);
      if ((p.x < EDGE && c < 0) || (p.x > W - EDGE && c > 0)) p.heading = Math.PI - p.heading;
      if ((p.y < EDGE && s < 0) || (p.y > H - EDGE && s > 0)) p.heading = -p.heading;
    }
    p.rot += angDiff(p.rot, p.heading) * Math.min(1, dt * 10);

    if (p.T.trail) {
      p.trailT -= dt;
      if (p.trailT <= 0) {
        p.trailT = 0.08;
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 14) p.trail.shift();
      }
    }

    const tank = p.fuel / p.maxFuel;
    if (tank < 0.4 && !p.saidLow) { p.saidLow = true; say('say_lowfuel', p, { priority: true }); }
    if (tank < 0.15 && !p.saidMayday) { p.saidMayday = true; say('say_mayday', p, { priority: true }); }
    if (p.fuel <= 0) return divert(p, 'Out of fuel');
    if (p.entered && S.storms.some(st => dist(p.x, p.y, st.x, st.y) < st.r * 0.8)) return divert(p, 'Storm');
  }

  function beginLanding(p) {
    const end = p.landing;
    p.state = 'land';
    p.landT = 0;
    p.trail = [];
    p.x = p.lx = end.x;
    p.y = p.ly = end.y;
    if (end.angle != null) p.heading = p.rot = end.angle;
    if (S.drawing && S.drawing.plane === p) S.drawing = null;
    S.landed++;
    sfx.land();
    if (S.level.id === 1 && !save.taught) { save.taught = true; persist(); }
    say('say_thanks', p, { chance: 0.3 });
    if (end.kind === 'pad') sfx.touchdown(p);
    addText(end.x, end.y - 24, '+1', '#fff6dc', 16);
  }

  function updateLanding(p, dt) {
    const end = p.landing;
    if (end.kind === 'pad') {
      p.landT += dt / 2;
      p.t += dt * (1 - p.landT * 0.8);       // rotor spins down
      p.alt = Math.max(0, 1 - p.landT * 1.6);
      p.rot += dt * 0.4 * (1 - p.landT);
      p.scale = 0.84 + 0.16 * p.alt;
    } else {
      p.t += dt;
      const roll = end.length * 0.8;
      const dur = (2 * roll) / p.T.speed;      // decelerate from approach speed to a stop
      p.landT += dt / dur;
      const e = 1 - (1 - Math.min(1, p.landT)) ** 2;
      p.x = p.lx + Math.cos(end.angle) * roll * e;
      p.y = p.ly + Math.sin(end.angle) * roll * e;
      const wasAirborne = p.alt > 0;
      p.alt = Math.max(0, 1 - p.landT * 6);
      p.scale = 0.84 + 0.16 * p.alt;
      if (wasAirborne && p.alt === 0) {
        S.effects.push({ kind: 'smoke', x: p.x, y: p.y, a: end.angle, t: 0, life: 0.9 });
        sfx.touchdown(p);
      }
    }
    p.alpha = p.landT > 0.72 ? Math.max(0, 1 - (p.landT - 0.72) / 0.28) : 1;
    if (p.landT >= 1) p.state = 'gone';
  }

  function divert(p, why) {
    p.divertedBy = why;
    p.state = 'divert';
    p.path = [];
    p.landing = null;
    S.lives--;
    if (S.drawing && S.drawing.plane === p) S.drawing = null;
    // head for the nearest edge
    const exits = [[-1, 0, p.x], [1, 0, W - p.x], [0, -1, p.y], [0, 1, H - p.y]].sort((a, b) => a[2] - b[2]);
    p.heading = Math.atan2(exits[0][1], exits[0][0]);
    addText(p.x, p.y - 20, `${why}: diverted`, '#ffcabf', 13);
    S.effects.push({ kind: 'ring', x: p.x, y: p.y, color: '#ff5a4a', t: 0, life: 0.9 });
    sfx.divert(p);
    buzz(70);
  }

  function updateDivert(p, dt) {
    p.t += dt;
    move(p, p.T.speed * 1.2 * dt);
    p.rot += angDiff(p.rot, p.heading) * Math.min(1, dt * 4);
    p.alpha = Math.max(0.25, p.alpha - dt * 0.4);
    if (p.x < -40 || p.x > W + 40 || p.y < -40 || p.y > H + 40) p.state = 'gone';
  }

  function checkSeparation(dt) {
    const fly = S.planes.filter(p => p.state === 'fly');
    S.conflicts = [];
    for (const p of fly) p.warn = false;
    for (let i = 0; i < fly.length; i++) {
      for (let j = i + 1; j < fly.length; j++) {
        const a = fly[i], b = fly[j];
        const d = dist(a.x, a.y, b.x, b.y), r = a.T.radius + b.T.radius;
        if (d < r) return crash(a, b);
        if (d < r * 2.6) { a.warn = b.warn = true; S.conflicts.push([a, b]); }
      }
    }
    S.warnCooldown -= dt;
    if (S.conflicts.length && S.warnCooldown <= 0) { sfx.warn(); S.warnCooldown = 0.45; }
    S.buzzCooldown = (S.buzzCooldown || 0) - dt;
    if (S.conflicts.length && S.buzzCooldown <= 0) { buzz([30, 50, 30]); S.buzzCooldown = 1.5; }
  }

  function crash(a, b) {
    S.crashes = (S.crashes || []).concat([[a.age, b.age]]);  // for checks
    a.crashed = b.crashed = true;
    a.state = b.state = 'gone';
    S.planes = S.planes.filter(p => p.state !== 'gone');
    S.drawing = null;
    S.conflicts = [];
    const colors = [Art.COLORS[a.type].main, Art.COLORS[b.type].main, '#3a3f44', '#f2efe6'];
    const parts = Array.from({ length: 18 }, () => {
      const ang = Math.random() * TAU, sp = 20 + Math.random() * 50;
      return { vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, a: ang, spin: (Math.random() - 0.5) * 12, s: 2 + Math.random() * 4, c: colors[Math.floor(Math.random() * colors.length)] };
    });
    S.effects.push({ kind: 'boom', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, parts, t: 0, life: 2 });
    sfx.crash();
    buzz([160, 60, 260]);
    finish('crash', 1.9);
  }

  function endLevel(outcome) {
    if (outcome === 'win') { sfx.win(); buzz([20, 40, 20, 40, 80]); say('tower_clear', null, { priority: true, delay: 1.2 }); } else sfx.lose();
    finish(outcome, outcome === 'win' ? 1 : 1.2);
  }

  function finish(outcome, delay) {
    S.outcome = outcome;
    S.screen = 'ending';
    S.overTimer = delay;
    $('btn-pause').disabled = true;
    const L = S.level;
    if (L.endless) {
      const field = S.assisted ? 'bestCalm' : 'best';
      S.newBest = S.landed > (save[field] || 0);
      if (S.newBest) save[field] = S.landed;
    } else if (outcome === 'win') {
      save.stars[L.id] = Math.max(save.stars[L.id] || 0, S.lives);
    }
    persist();
    updateHud();
    S.shiftId = recordShift({
      level: L.id, outcome,
      landed: L.endless ? S.landed : Math.min(S.landed, L.target),
      strikes: MAX_LIVES - Math.max(0, S.lives),
      duration: Math.max(1, Math.round(S.time * 10) / 10),
      assisted: !!S.assisted,
    });
  }

  // ---------- family records ----------
  // A finished shift goes to the server under this device's Game Night
  // profile. Unsent shifts wait in the save (the outbox) and go when they
  // can; the server ignores a shift id it already has, so retrying is safe.
  // profiles.js declares GN with const, so it's a global name but not a
  // property of window: test for it by name.
  const me = () => (typeof GN !== 'undefined' && GN.me.get()) || null;
  const recordStatus = {};
  let familyBest = null;
  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
  function recordShift(shift) {
    shift.id = newId();
    if (!me()) { recordStatus[shift.id] = { state: 'guest' }; return shift.id; }
    save.outbox = (save.outbox || []).concat([shift]).slice(-20);
    persist();
    recordStatus[shift.id] = { state: 'sending' };
    flushOutbox();
    return shift.id;
  }
  let flushing = false;
  async function flushOutbox() {
    if (flushing || !me() || !(save.outbox || []).length) return;
    flushing = true;
    try {
      while ((save.outbox || []).length) {
        const shift = save.outbox[0];
        let res;
        try {
          res = await fetch('/final-approach/api/shifts', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, GN.me.headers()),
            body: JSON.stringify(shift),
          });
        } catch {
          recordStatus[shift.id] = { state: 'kept' };
          break;                                   // offline: try again later
        }
        const body = await res.json().catch(() => ({}));
        if (res.ok) recordStatus[shift.id] = { state: 'ok', name: me() && me().name };
        else if (res.status >= 500) { recordStatus[shift.id] = { state: 'kept' }; break; }
        else recordStatus[shift.id] = { state: 'refused', error: body.error || 'the server said no' };
        save.outbox.shift();
        persist();
      }
    } finally {
      flushing = false;
      showRecordLine();
      syncProgress();
    }
  }
  function showRecordLine() {
    const el = $('result-record');
    const st = S.shiftId && recordStatus[S.shiftId];
    el.textContent = '';
    if (!st) return;
    if (st.state === 'guest') {
      const a = document.createElement('a');
      a.href = '/me'; a.textContent = 'Add yourself';
      el.append(a, ' on the Game Night hub to keep family records.');
    } else {
      el.textContent = {
        sending: 'Sending to the family records…',
        ok: `On the family records for ${st.name || 'you'}.`,
        kept: "Kept on this device. It'll go to the family records when you're back online.",
        refused: `Not recorded: ${st.error}`,
      }[st.state];
    }
  }
  // Your stars and bests follow your profile: whatever the records hold for
  // you is merged into this device's save (the better of each).
  async function syncProgress() {
    let data;
    try {
      const res = await fetch('/final-approach/api/stats');
      if (!res.ok) return;
      data = await res.json();
    } catch { return; }
    familyBest = (data.leaderboard || [])[0] || null;
    const mine = me();
    let changed = false;
    const player = mine && (data.players || []).find(pl => GN.fold(pl.name) === GN.fold(mine.name));
    if (player) {
      for (const [id, n] of Object.entries(player.stars || {})) {
        if (n > (save.stars[id] || 0)) { save.stars[id] = n; changed = true; }
      }
      if (player.endless_best > (save.best || 0)) { save.best = player.endless_best; changed = true; }
      if (player.endless_best_calm > (save.bestCalm || 0)) { save.bestCalm = player.endless_best_calm; changed = true; }
      if (changed) persist();
    }
    if (S.screen === 'menu') {
      if (changed) openMenu(); else refreshEndlessRow();
    }
  }
  function updateController() {
    const chip = $('controller');
    const mine = me();
    chip.textContent = '';
    if (!mine) { chip.textContent = 'Add yourself'; return; }
    chip.appendChild(GN.avatar(mine.name, 24));
    const label = document.createElement('span');
    label.append(mine.name);
    chip.appendChild(label);
  }

  function flipWind() {
    S.flipped = !S.flipped;
    S.windTimer = S.level.windShift;
    S.windWarned = false;
    for (const p of S.planes) {
      if (p.state === 'fly' && p.landing && p.landing.kind !== 'pad') {
        p.landing = null;
        p.path = [];
        addText(p.x, p.y - 22, 'Go around', '#ffffff', 13);
        say('say_goaround', p);
        if (S.drawing && S.drawing.plane === p) S.drawing = null;
      }
    }
    toast('Runways reversed');
    sfx.wind();
    say('tower_windflip', null, { priority: true });
  }

  function updateStorm(st, dt) {
    st.x += st.vx * dt;
    st.y += st.vy * dt;
    st.rot += dt * 0.06;
    const m = st.r * 0.6;
    if ((st.x < m && st.vx < 0) || (st.x > W - m && st.vx > 0)) st.vx = -st.vx;
    if ((st.y < m && st.vy < 0) || (st.y > H - m && st.vy > 0)) st.vy = -st.vy;
    st.flash = Math.max(0, st.flash - dt);
    st.flashIn -= dt;
    if (st.flashIn <= 0) {
      st.flash = 0.2;
      st.flashIn = 1.5 + Math.random() * 4;
      st.bolt = [];
      let x = (Math.random() - 0.5) * st.r * 0.6, y = -st.r * 0.55;
      while (y < st.r * 0.5) { st.bolt.push([x, y]); x += (Math.random() - 0.5) * 14; y += 6 + Math.random() * 8; }
    }
  }

  function addText(x, y, text, color, size) {
    S.effects.push({ kind: 'text', x, y, text: text.toUpperCase(), color, size, t: 0, life: 1.6 });
  }

  // ---------- route drawing ----------
  function toWorld(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.scale, y: (e.clientY - r.top - view.y) / view.scale };
  }

  // A touch picks the nearest of: an aircraft (start a fresh route) or the
  // end of an unfinished route (carry it on). A near-tie goes to the
  // aircraft, so the gesture everyone learns first never changes meaning.
  function pickAt(w) {
    const reach = Math.max(40, 34 / view.scale);  // generous for fingers
    let best = null, bestD = reach;
    for (const p of S.planes) {
      if (p.state !== 'fly') continue;
      const d = dist(p.x, p.y, w.x, w.y);
      if (d < bestD) { best = { plane: p, end: null }; bestD = d; }
    }
    for (const p of S.planes) {
      if (p.state !== 'fly' || p.landing || !p.path.length) continue;
      const e = p.path[p.path.length - 1];
      const d = dist(e.x, e.y, w.x, w.y);
      if (d < bestD - 4) { best = { plane: p, end: e }; bestD = d; }
    }
    return best;
  }

  canvas.addEventListener('pointerdown', e => {
    if (S.screen !== 'play') return;
    const w = toWorld(e);
    const pick = pickAt(w);
    if (!pick) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const p = pick.plane;
    if (!pick.end) {
      p.path = [];
      p.landing = null;
    }
    const from = pick.end || { x: p.x, y: p.y };
    S.drawing = { plane: p, pointerId: e.pointerId, last: { x: from.x, y: from.y }, done: false, extending: !!pick.end };
    extendRoute(w);
  });
  canvas.addEventListener('pointermove', e => {
    if (!S.drawing || S.drawing.pointerId !== e.pointerId || S.screen !== 'play') return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) extendRoute(toWorld(ev));
  });
  const endDraw = e => {
    const d = S.drawing;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.done && d.plane.path.length > 4) say('say_turn', d.plane, { chance: 0.3 });
    S.drawing = null;
  };
  canvas.addEventListener('pointerup', endDraw);
  canvas.addEventListener('pointercancel', endDraw);

  function extendRoute(w) {
    const d = S.drawing;
    if (!d || d.done) return;
    const p = d.plane;
    const x = clamp(w.x, EDGE + 2, W - EDGE - 2), y = clamp(w.y, EDGE + 2, H - EDGE - 2);
    const gap = dist(d.last.x, d.last.y, x, y);
    if (gap < SPACING) return;
    const n = Math.floor(gap / SPACING);
    const from = d.last;
    for (let i = 1; i <= n; i++) {
      const pt = { x: lerp(from.x, x, i / n), y: lerp(from.y, y, i / n) };
      p.path.push(pt);
      d.last = pt;
      const end = landingFor(p, pt);
      if (end) {
        p.path.push({ x: end.x, y: end.y });
        p.landing = end;
        d.done = true;
        S.effects.push({ kind: 'ring', x: end.x, y: end.y, color: KINDS[end.kind].color, t: 0, life: 0.6 });
        sfx.lock(p);
        return;
      }
    }
  }

  // Does this route point complete a valid approach for plane p?
  function landingFor(p, pt) {
    for (const r of S.level.runways) {
      if (r.kind !== p.T.kind) continue;
      const end = runwayEnd(r);
      if (r.kind === 'pad') {
        if (dist(pt.x, pt.y, end.x, end.y) < 24) return end;
        continue;
      }
      const zx = end.x - Math.cos(end.angle) * 14, zy = end.y - Math.sin(end.angle) * 14;
      if (dist(pt.x, pt.y, zx, zy) > 26) continue;
      const back = p.path.length >= 4 ? p.path[p.path.length - 4] : { x: p.x, y: p.y };
      const dir = dist(back.x, back.y, pt.x, pt.y) > 2 ? Math.atan2(pt.y - back.y, pt.x - back.x) : p.heading;
      if (Math.abs(angDiff(dir, end.angle)) < 1.2) return end;
    }
    return null;
  }

  // ---------- rendering ----------
  function render(now) {
    const t = now / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d0f10';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!S.level || !S.terrain) return;
    const k = view.dpr * view.scale;
    ctx.setTransform(k, 0, 0, k, view.dpr * view.x, view.dpr * view.y);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();

    const th = THEMES[S.level.theme];
    ctx.drawImage(S.terrain, 0, 0, W, H);
    if (th.sea) Art.foam(ctx, t);
    Art.cloudLayer(ctx, S.sky, true);

    const drawingKind = S.drawing && !S.drawing.done ? S.drawing.plane.T.kind : null;
    for (const r of S.level.runways) Art.approach(ctx, runwayEnd(r), KINDS[r.kind].color, t, r.kind === drawingKind, th.night);

    const landing = S.planes.filter(p => p.state === 'land');
    const air = S.planes.filter(p => p.state !== 'land');
    for (const p of landing) Art.aircraftShadow(ctx, p);
    for (const p of landing) Art.aircraft(ctx, p, p.t, th.night);
    for (const st of S.storms) Art.storm(ctx, st, t);
    // Route-end handles at least 22 CSS pixels across, like the markers.
    const handleR = Math.max(6.5, 11 / view.scale);
    for (const p of air) if (p.state === 'fly') Art.route(ctx, p, p.T.color, t, S.drawing && S.drawing.plane === p, handleR);
    for (const p of air) Art.trail(ctx, p);
    for (const p of air) Art.aircraftShadow(ctx, p);
    for (const p of air) {
      if (p.state === 'fly') drawStatus(p, t, 'under');
      Art.aircraft(ctx, p, p.t, th.night);
      if (p.state === 'fly') drawStatus(p, t, 'over');
    }
    drawConflicts(t);
    // At least 30 CSS pixels across on any screen, so a phone shows it.
    const markerR = Math.max(16, 16 / view.scale);
    for (const s of S.incoming) Art.incoming(ctx, s, t, TYPES[s.type].color, markerR, TYPES[s.type].kind);
    drawGhost(t);
    Art.cloudLayer(ctx, S.sky, false);
    if (S.snow.length) Art.drawSnow(ctx, S.snow);
    for (const e of S.effects) Art.effect(ctx, e);
    Art.vignette(ctx, !!th.night);
    ctx.restore();
  }

  // The first airport teaches without words: until the first landing, a
  // ghost finger drags from the arriving plane along the approach lights.
  function drawGhost(t) {
    if (S.level.id !== 1 || save.taught || S.screen !== 'play' || S.drawing) return;
    if (S.planes.some(q => q.landing)) return;
    const p = S.planes.find(q => q.state === 'fly' && q.entered);
    if (!p) return;
    const r = S.level.runways.find(rw => rw.kind === p.T.kind);
    if (!r) return;
    const end = runwayEnd(r);
    const a = { x: end.x - Math.cos(end.angle) * 90, y: end.y - Math.sin(end.angle) * 90 };
    const pts = [{ x: p.x, y: p.y }, a, { x: end.x, y: end.y }];
    const seg = [dist(pts[0].x, pts[0].y, a.x, a.y), dist(a.x, a.y, end.x, end.y)];
    const k = (t % 2.8) / 2.8;
    const along = k < 0.15 ? 0 : k > 0.85 ? 1 : (k - 0.15) / 0.7;
    let d = (seg[0] + seg[1]) * (along < 1 ? along * (2 - along) : 1);
    let fx, fy;
    if (d <= seg[0]) { fx = lerp(pts[0].x, a.x, d / seg[0]); fy = lerp(pts[0].y, a.y, d / seg[0]); }
    else { d -= seg[0]; fx = lerp(a.x, end.x, d / seg[1]); fy = lerp(a.y, end.y, d / seg[1]); }
    ctx.save();
    ctx.globalAlpha = k > 0.9 ? (1 - k) / 0.1 : Math.min(1, k / 0.06);
    ctx.lineCap = 'round';
    ctx.setLineDash([0.01, 9]);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(a.x, a.y); ctx.lineTo(end.x, end.y); ctx.stroke();
    ctx.setLineDash([]);
    if (k < 0.18) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(fx, fy, 10 + (k / 0.18) * 14, 0, TAU); ctx.stroke();
    }
    ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = 8 * view.dpr;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.arc(fx, fy, 9, 0, TAU); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = '600 13px Oswald, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('DRAG', pts[0].x, pts[0].y + 30);
    ctx.restore();
  }

  function drawStatus(p, t, layer) {
    const R = p.T.radius;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (layer === 'under') {
      if (S.drawing && S.drawing.plane === p) {
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.beginPath(); ctx.arc(0, 0, R + 7, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, R + 7, 0, TAU); ctx.stroke();
      }
    } else {
      if (p.warn) {
        ctx.strokeStyle = '#ff3b30';
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(t * 16);
        ctx.setLineDash([4, 3]); ctx.lineDashOffset = t * 12;
        ctx.beginPath(); ctx.arc(0, 0, R * 1.25 + 7, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      const f = p.fuel / p.maxFuel;
      if (f < 0.4) {
        const critical = f < 0.15;
        if (!critical || Math.sin(t * 14) > -0.3) {
          const r = R + 10;
          ctx.lineCap = 'round';
          ctx.strokeStyle = 'rgba(20,24,28,0.55)'; ctx.lineWidth = 4.5;
          ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
          ctx.strokeStyle = critical ? '#ff3b30' : '#ffb02e'; ctx.lineWidth = 2.6;
          ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0.02, f / 0.4)); ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  function drawConflicts(t) {
    if (!S.conflicts.length) return;
    ctx.save();
    ctx.strokeStyle = '#ff3b30';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 4]);
    ctx.lineDashOffset = -t * 20;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (const [a, b] of S.conflicts) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    ctx.stroke();
    ctx.restore();
  }

  // ---------- UI ----------
  const show = (id, on) => $(id).classList.toggle('hidden', !on);
  const overlays = ['menu', 'brief', 'pause', 'result', 'settings'];
  function only(id) { for (const o of overlays) show(o, o === id); }

  const boards = {
    title: new Flap.Board($('title-flaps'), 14),
    clock: new Flap.Board($('clock-flaps'), 5),
    code: new Flap.Board($('hud-code'), 3),
    landed: new Flap.Board($('hud-landed'), 5),
    wind: new Flap.Board($('hud-wind-flaps'), 4),
    toast: new Flap.Board($('toast-flaps'), 16),
  };

  let toastTimer = 0;
  function toast(msg) {
    show('toast', true);
    boards.toast.set(msg, { align: 'center', stagger: 14, maxSteps: 6 });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      boards.toast.set('', { stagger: 10, maxSteps: 3 });
      setTimeout(() => show('toast', false), 700);
    }, 2800);
  }

  const hudState = {};
  function updateHud() {
    const L = S.level;
    const landed = L.endless ? String(S.landed).padStart(3, '0') : `${pad2(Math.min(S.landed, L.target))}/${pad2(L.target)}`;
    if (hudState.landed !== landed) { hudState.landed = landed; boards.landed.set(landed, { align: 'right', stagger: 30 }); }
    const strikes = MAX_LIVES - Math.max(0, S.lives);
    if (hudState.strikes !== strikes) {
      hudState.strikes = strikes;
      [...$('hud-lamps').children].forEach((el, i) => el.classList.toggle('on', i < strikes));
    }
    if (L.windShift) {
      const s = Math.max(0, Math.ceil(S.windTimer));
      const wind = `${Math.floor(s / 60)}:${pad2(s % 60)}`;
      if (hudState.wind !== wind) { hudState.wind = wind; boards.wind.set(wind, { align: 'right', stagger: 0, maxSteps: 2 }); }
      $('hud-wind').classList.toggle('urgent', s <= 5);
    }
  }

  function setupHud(L) {
    for (const k in hudState) delete hudState[k];
    boards.code.set(L.code, { stagger: 60 });
    $('hud-name').textContent = L.name + (save.calm ? ' · calm skies' : '');
    show('hud-wind', !!L.windShift);
    $('hud-landed-label').textContent = L.endless ? 'Landed' : 'Landed / target';
    updateHud();
  }

  const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.85 6.05 6.65.82-4.9 4.58 1.28 6.58L12 17.35 6.12 20.63l1.28-6.58-4.9-4.58 6.65-.82z"/></svg>';
  const stars = (n, cls = '') => `<span class="stars ${cls}">${[0, 1, 2].map(i => `<i class="${i < n ? 'on' : ''}">${STAR}</i>`).join('')}</span>`;

  function isUnlocked(L) {
    if (L.unlock) return (save.stars[L.unlock] || 0) > 0;
    const i = LEVELS.indexOf(L);
    return i === 0 || (save.stars[LEVELS[i - 1].id] || 0) > 0;
  }

  function openMenu() {
    S.screen = 'menu';
    S.drawing = null;
    show('hud', false);
    const rows = $('level-rows');
    rows.textContent = '';
    LEVELS.forEach((L, i) => {
      const unlocked = isUnlocked(L);
      const cleared = (save.stars[L.id] || 0) > 0;
      const status = !unlocked ? 'Closed' : L.endless ? 'Open' : cleared ? 'Cleared' : 'Boarding';
      const tone = !unlocked ? 'dim' : status === 'Boarding' || status === 'Open' ? 'amber' : '';
      const row = document.createElement('button');
      row.className = 'row ' + tone;
      row.disabled = !unlocked;
      row.innerHTML = `<span class="c-flt"></span><span class="c-name"></span><span class="c-status"></span>` +
        `<span class="c-rating">${L.endless ? '<span class="best"></span>' : stars(save.stars[L.id] || 0)}</span>` +
        `<span class="lamp ${tone === 'amber' ? 'blink' : ''}"></span>`;
      row.addEventListener('click', () => openBrief(L));
      if (L.endless) row.dataset.endless = '1';
      rows.appendChild(row);
      const delay = i * 70;
      new Flap.Board(row.querySelector('.c-flt'), 2).set(L.endless ? '--' : pad2(L.id), { delay, maxSteps: 5 });
      new Flap.Board(row.querySelector('.c-name'), 16).set(L.name, { delay: delay + 40, maxSteps: 6, stagger: 18 });
      new Flap.Board(row.querySelector('.c-status'), 8).set(status, { delay: delay + 120, maxSteps: 6, stagger: 18 });
    });
    const total = LEVELS.reduce((s, L) => s + (save.stars[L.id] || 0), 0);
    const max = LEVELS.filter(L => !L.endless).length * 3;
    $('star-total').innerHTML = `${STAR}<span>${total} / ${max}</span>`;
    refreshEndlessRow();
    updateController();
    only('menu');
    if (actx) sfx.rattle();
  }

  // The Endless row: your best, and the family's best with their face.
  function refreshEndlessRow() {
    const cell = document.querySelector('.row[data-endless] .best');
    if (!cell) return;
    cell.textContent = save.best ? `Best ${save.best}` : '';
    if (familyBest && familyBest.best > (save.best || 0)) {
      const fam = document.createElement('span');
      fam.className = 'family-best';
      fam.append(GN.avatar(familyBest.name, 18), ` ${familyBest.best}`);
      fam.title = `Family best: ${familyBest.name}`;
      if (save.best) cell.append(' · ');
      cell.append(fam);
    }
  }

  function weather(L) {
    const wx = [];
    if (L.storms) wx.push('Storms');
    if (L.windShift) wx.push('Wind shifts');
    if (L.traffic.fuel < 60) wx.push('Low fuel');
    if (L.theme === 'night') wx.push('Night');
    if (L.theme === 'snow') wx.push('Snow');
    return wx.length ? wx.join(' · ') : 'Clear skies';
  }

  function openBrief(L) {
    loadLevel(L);
    S.screen = 'brief';
    show('hud', false);
    const flt = L.endless ? 'FA∞' : 'FA' + pad2(L.id);
    $('pass-flight').textContent = flt;
    $('stub-flt').textContent = flt;
    $('pass-code').textContent = L.code;
    $('pass-name').textContent = L.name;
    $('pass-target').textContent = L.endless ? '∞' : L.target;
    $('pass-hint').textContent = L.hint;
    $('stub-wx').textContent = weather(L);
    const legend = $('pass-legend');
    legend.textContent = '';
    for (const type of Object.keys(L.traffic.types)) {
      const T = TYPES[type];
      const row = document.createElement('div');
      row.className = 'legend-row';
      row.appendChild(Art.icon(type, 34));
      const label = document.createElement('div');
      const shape = { short: '<path d="M6 1L11 10.5H1Z"/>', long: '<rect x="1.5" y="1.5" width="9" height="9"/>', pad: '<circle cx="6" cy="6" r="4.8"/>' }[T.kind];
      label.innerHTML = `<b>${T.name}</b><span><svg class="kind-shape" viewBox="0 0 12 12" aria-hidden="true" style="fill:${T.color};stroke:#1e262c;stroke-width:1">${shape}</svg>${KINDS[T.kind].label}</span>`;
      row.appendChild(label);
      legend.appendChild(row);
    }
    // barcode from the level id, so each pass is a little different
    const rng = Art.mulberry32(L.id * 13);
    let x = 0, stops = [];
    while (x < 100) {
      const bar = 0.6 + rng() * 1.8, gap = 0.6 + rng() * 1.6;
      stops.push(`#1e262c ${x}%`, `#1e262c ${x + bar}%`, `transparent ${x + bar}%`, `transparent ${x + bar + gap}%`);
      x += bar + gap;
    }
    $('barcode').style.background = `linear-gradient(90deg, ${stops.join(',')})`;
    only('brief');
  }

  function play() {
    S.screen = 'play';
    S.assisted = !!save.calm;
    $('btn-pause').disabled = false;
    only(null);
    show('hud', true);
    setupHud(S.level);
    audio();  // unlock audio on this user gesture
    sfx.start();
    say('tower_start', null, { priority: true, delay: 1.4 });
  }

  function restart() {
    loadLevel(S.level);
    play();
  }

  function showResult() {
    S.screen = 'result';
    const L = S.level;
    const win = S.outcome === 'win';
    const titles = { win: 'Cleared', crash: 'Collision', strikes: 'Shift over' };
    only('result');
    new Flap.Board($('result-flaps'), titles[S.outcome].length).set(titles[S.outcome], { stagger: 40, maxSteps: 9 });
    $('result-stars').innerHTML = win ? stars(S.lives, 'big') : '';
    $('result-stars').classList.toggle('hidden', !win);
    let text;
    if (L.endless) text = `You landed ${S.landed}. ${S.newBest ? 'A new best!' : `Your best is ${save.best}.`}`;
    else if (win) text = S.lives === MAX_LIVES ? 'Every arrival down safely. A perfect shift.' : `All down, with ${MAX_LIVES - S.lives} diverted. Fewer diversions earn more stars.`;
    else if (S.outcome === 'crash') text = `Two aircraft got too close. You landed ${S.landed} of ${L.target}.`;
    else text = `Three aircraft diverted. You landed ${S.landed} of ${L.target}.`;
    $('result-text').textContent = text;
    const next = LEVELS[LEVELS.indexOf(L) + 1];
    const canNext = win && next && !next.endless && isUnlocked(next);
    show('btn-next', canNext);
    showRecordLine();
    $('btn-retry').textContent = win ? 'Replay' : 'Try again';
    $('btn-retry').className = 'btn ' + (canNext ? 'ghost' : 'primary');
  }

  function pause() {
    if (S.screen !== 'play') return;
    S.screen = 'pause';
    S.drawing = null;
    only('pause');
    new Flap.Board($('pause-flaps'), 6).set('Paused', { stagger: 30 });
  }
  function resume() {
    S.screen = 'play';
    only(null);
  }

  // ---------- settings ----------
  function openSettings() {
    S.settingsFrom = S.screen;
    S.screen = 'settings';
    $('set-sound').checked = !save.muted;
    $('set-sfx').value = Math.round(save.vol.sfx * 100);
    $('set-voice').value = Math.round(save.vol.voice * 100);
    $('set-music').value = Math.round(save.vol.music * 100);
    $('set-large').checked = !!save.large;
    $('set-haptics').checked = save.haptics !== false;
    $('set-calm').checked = !!save.calm;
    only('settings');
    new Flap.Board($('settings-flaps'), 8).set('Settings', { stagger: 30 });
  }
  function closeSettings() {
    S.screen = S.settingsFrom || 'menu';
    only(S.screen === 'pause' ? 'pause' : 'menu');
    if (S.screen === 'menu') updateController();
  }
  function changeSettings() {
    const musicWas = musicOn();
    save.muted = !$('set-sound').checked;
    save.vol = { sfx: $('set-sfx').value / 100, voice: $('set-voice').value / 100, music: $('set-music').value / 100 };
    save.large = $('set-large').checked;
    save.haptics = $('set-haptics').checked;
    save.calm = $('set-calm').checked;
    persist();
    Art.setBoost(save.large ? 1.25 : 1);
    if (S.level) $('hud-name').textContent = S.level.name + (save.calm ? ' · calm skies' : '');
    audio(); applyVolumes();
    if (actx && musicWas !== musicOn()) { const name = scape.musicName; scape.musicName = null; setMusic(name); }
  }
  for (const id of ['set-sound', 'set-sfx', 'set-voice', 'set-music', 'set-large', 'set-haptics', 'set-calm']) {
    $(id).addEventListener('input', changeSettings);
    $(id).addEventListener('change', changeSettings);
  }

  function tickClock() {
    const d = new Date();
    boards.clock.set(`${pad2(d.getHours())}:${pad2(d.getMinutes())}`, { stagger: 40, maxSteps: 4 });
  }

  $('btn-start').addEventListener('click', play);
  $('btn-brief-back').addEventListener('click', openMenu);
  $('btn-pause').addEventListener('click', pause);
  $('btn-resume').addEventListener('click', resume);
  $('btn-restart').addEventListener('click', restart);
  $('btn-pause-menu').addEventListener('click', openMenu);
  $('btn-retry').addEventListener('click', restart);
  $('btn-result-menu').addEventListener('click', openMenu);
  $('btn-next').addEventListener('click', () => openBrief(LEVELS[LEVELS.indexOf(S.level) + 1]));
  $('btn-settings').addEventListener('click', openSettings);
  $('btn-pause-settings').addEventListener('click', openSettings);
  $('btn-settings-done').addEventListener('click', closeSettings);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pause(); if (actx) actx.suspend(); }
    else if (actx) actx.resume();
  });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' || e.key === 'p') {
      if (S.screen === 'play') pause();
      else if (S.screen === 'pause') resume();
      else if (S.screen === 'settings') closeSettings();
    }
  });

  // ---------- main loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // Calm skies: the whole sky at three-quarter speed, and the shift marked.
    const calm = save.calm && S.screen === 'play';
    if (calm) S.assisted = true;
    update(calm ? dt * 0.75 : dt, now / 1000);
    soundscape(now / 1000);
    render(now);
    requestAnimationFrame(frame);
  }

  // Runway numbers are painted into the terrain, so wait for the fonts first.
  const fontsReady = document.fonts && document.fonts.load
    ? Promise.all([document.fonts.load('600 20px Oswald'), document.fonts.load('500 16px Barlow')]).catch(() => {})
    : Promise.resolve();
  Promise.race([fontsReady, new Promise(r => setTimeout(r, 2500))]).then(() => {
    resize();
    Art.setBoost(save.large ? 1.25 : 1);
    loadLevel(LEVELS[0]);
    openMenu();
    GN.profiles.load().then(() => { updateController(); refreshEndlessRow(); });
    syncProgress();
    flushOutbox();
    boards.title.set('Final Approach', { stagger: 45, maxSteps: 10, delay: 200 });
    tickClock();
    setInterval(tickClock, 10000);
    requestAnimationFrame(frame);
  });

  // Exposed for automated tests only.
  window.__finalApproach = { S, LEVELS, runwayEnd, update, queueArrival, clearOfStorms, stormAt, clearOfTraffic, track,
    save, recordStatus, flushOutbox, syncProgress,
    sound: { audio, load, buffers, scape, bus: () => bus } };
})();
