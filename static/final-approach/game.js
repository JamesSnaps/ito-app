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
      emergencies: 'some', bestBy: {}, grownUp: true, free: {}, stamps: {}, passportNew: false,
    };
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { /* fresh start */ }
    const merged = Object.assign(blank, saved);
    merged.vol = Object.assign({ sfx: 0.8, voice: 0.9, music: 0.8 }, saved.vol || {});
    // Before v1.22.0 music was an on/off switch.
    if (saved.music === false && !saved.vol) merged.vol.music = 0;
    delete merged.music;
    // Before v1.23.0 Endless had no emergencies: that best is the "off" one.
    merged.bestBy = Object.assign({}, saved.bestBy || {});
    if (saved.best && !saved.bestBy) merged.bestBy.off = saved.best;
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
  // A prefix's variants are its numbered recordings only ("tower_drone_1",
  // "tower_drone_2"), so "tower_drone" never deals "tower_drone_gone_1".
  function variants(prefix) {
    return Object.keys(AUDIO).filter(n => n === prefix || (n.startsWith(prefix + '_') && /^\d+$/.test(n.slice(prefix.length + 1))));
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
      // Only the lines that fit: a storm, or an empty tank.
      if (p.divertedBy === 'Storm') say('say_divert_storm', p, { priority: true });
      else if (p.divertedBy === 'Out of fuel') say('say_divert_fuel', p, { priority: true });
      return playSound('divert', { vol: 0.6, pan: panOf(p.x) }) || tone(500, 0.4, { type: 'sawtooth', vol: 0.05, slide: -300 });
    },
    crash:     () => playSound('collision') || (noise(1, 0.5), tone(140, 0.7, { type: 'sawtooth', vol: 0.12, slide: -90 })),
    start:     () => playSound('chime_start', { vol: 0.6 }),
    win:       () => playSound('chime_clear', { vol: 0.7 }) || [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { vol: 0.1, delay: i * 0.12 })),
    lose:      () => playSound('chime_fail', { vol: 0.7 }) || [392, 330, 262].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.1, delay: i * 0.15 })),
    wind:      () => playSound('wind_shift', { vol: 0.7 }) || tone(260, 0.5, { type: 'triangle', vol: 0.08, slide: 240 }),
    rattle:    () => playSound('flap_rattle', { vol: 0.35 }),
    // An airport announcement chime for disruptions: two soft notes, down.
    chime:     () => playSound('attention', { vol: 0.6 }) || (tone(659, 0.5, { vol: 0.09 }), tone(523, 0.7, { vol: 0.09, delay: 0.32 })),
    // Disruptions, part 2: stand-ins until the recordings exist (balloon_burner,
    // display_flypast, cyber_glitch, gremlin_giggle, restore_ok).
    burner:    () => noise(0.9, 0.12, 380, 'lowpass'),
    flypast:   () => { noise(1.6, 0.16, 700, 'bandpass'); tone(180, 1.4, { type: 'sawtooth', vol: 0.03, slide: -90 }); },
    glitch:    () => { for (let i = 0; i < 7; i++) tone(200 + Math.random() * 1600, 0.05, { type: 'square', vol: 0.03, delay: i * 0.06 }); },
    giggle:    () => [880, 1040, 920, 1180, 1000].forEach((f, i) => tone(f, 0.09, { type: 'triangle', vol: 0.05, slide: 120, delay: i * 0.1 })),
    // A rubber stamp coming down on the passport.
    thunk:     () => { noise(0.07, 0.4, 260, 'lowpass'); tone(95, 0.14, { vol: 0.16, slide: -45 }); },
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

    // Conditions bring their own background: night and snow have one each.
    const c = S.level.condition;
    const bedName = 'bed_' + (c === 'night' || (c === 'dusk' && S.duskK > 0.6) ? 'night' : c === 'snow' ? 'snow' : S.level.theme);
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
    view.w = w; view.h = h;
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
    // Paint past the airspace to the edges of the screen: the airspace stays
    // 960 x 600 on every device, the landscape fills whatever is around it.
    const bleed = {
      x: Math.ceil(Math.max(0, (view.w / view.scale - W) / 2)) + 6,
      y: Math.ceil(Math.max(0, (view.h / view.scale - H) / 2)) + 6,
    };
    S.terrain = Art.buildTerrain(S.level, S.theme, px, Art.COLORS.heli.main, bleed);
    // Dusk fades into a second, after-dark painting of the same airport.
    S.terrainNight = S.duskTheme ? Art.buildTerrain(S.level, S.duskTheme, px, Art.COLORS.heli.main, bleed) : null;
    S.bounds = S.terrain.bounds;
    // Weather spreads over the whole painting.
    if (S.snow.length) S.snow = Art.snowfall(140);
    if (S.rain.length) S.rain = Art.rainfall(220);
  }

  function loadLevel(level) {
    const th = themeFor(level);
    Object.assign(S, {
      theme: th, duskTheme: level.condition === 'dusk' ? Art.nightTheme(th) : null, duskK: 0,
      rain: level.condition === 'storm' ? Art.rainfall(220) : [],
      level, planes: [], storms: [], effects: [], incoming: [], conflicts: [],
      landed: 0, lives: MAX_LIVES, time: 0, spawnTimer: 1,
      flipped: false, windTimer: level.windShift || 0, windWarned: false,
      drawing: null, overTimer: 0, outcome: null, warnCooldown: 0, shiftId: null, assisted: false,
      medals: 0, emgPending: null, emgLast: null, closures: [], police: null,
      fixes: holdingOn(level) ? (level.holds || []) : [], dis: null, disLast: null, disQuiet: 0, emgQuiet: 0,
      radar: null, smokeFade: null,
      sky: Art.sky(th, level.id * 31), snow: th.snowfall ? Art.snowfall(140) : [],
    });
    paintTerrain();
    notice('');
    hideRansom(false, true);
    restore.down = false;
    const plan = emergencyPlan(level);
    S.emgTimer = plan ? plan.first + Math.random() * 6 : Infinity;
    S.disTimer = level.disruptions ? level.disruptions.first + Math.random() * 6 : Infinity;
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
    const rush = S.level.rushFrom != null && progress() >= S.level.rushFrom ? 0.8 : 1;
    return lerp(a, b, progress()) * rush * (0.85 + Math.random() * 0.3);
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
      // A drone zone, from the moment it's announced until it's gone.
      const d = S.dis, when = S.time + lead + t;
      if (d && d.kind === 'drone' && when >= d.at - 1 && when <= d.until + 1 && dist(px, py, d.x, d.y) < d.r + 30) return false;
      // Balloons: where each will be by then (they drift in straight lines).
      if (d && d.kind === 'balloons' && when <= d.until + 1 &&
          d.balloons.some(b => { const q = balloonAt(d, b, when); return dist(px, py, q.x, q.y) < d.r + 30; })) return false;
      // The display corridor, the whole time it's shown, and a moment after.
      if (d && d.kind === 'display' && when <= d.until + 1 && Math.abs(corridorPos(d, px, py).across) < d.hw + 30) return false;
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
    const step = p.T.speed * (p.speedK || 1) * TRACK_STEP;
    // Holding (or on the way to a fix): round its ring once it gets there.
    const hold = p.hold && !(p.hold.on && p.path.length) ? Object.assign({}, p.hold) : null;
    const join = () => { hold.on = true; hold.a = Math.atan2(y - hold.fix.y, x - hold.fix.x); hold.r = Math.max(8, dist(x, y, hold.fix.x, hold.fix.y)); };
    for (let t = 0; t <= secs + 1e-6; t += TRACK_STEP) {
      out.push({ x, y });
      if (hold && !hold.on && (i >= p.path.length || dist(x, y, hold.fix.x, hold.fix.y) <= holdR(hold.slot) + 2)) join();
      if (hold && hold.on) {
        const q = { x, y, heading: h };
        holdStep(q, hold, TRACK_STEP, S.time + t);
        x = q.x; y = q.y; h = q.heading;
        continue;
      }
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
  function clearOfTraffic(type, x, y, heading, wait, self, speedK = 1, isState = false) {
    const r = TYPES[type].radius, v = TYPES[type].speed * speedK, span = wait + SAFE_FLIGHT;
    const others = [];
    for (const p of S.planes) if (p.state === 'fly') others.push({ r: p.T.radius, bubble: p.bubble, at: track(p, span) });
    for (const o of S.incoming) {
      if (o === self) continue;
      const ov = TYPES[o.type].speed * (o.speedK || 1), at = [];
      for (let t = 0; t <= span + 1e-6; t += TRACK_STEP) {
        const flown = t - o.t;
        at.push(flown < 0 ? null : { x: o.x + Math.cos(o.heading) * ov * flown, y: o.y + Math.sin(o.heading) * ov * flown });
      }
      others.push({ r: TYPES[o.type].radius, bubble: o.emg === 'state' ? BUBBLE : 0, at });
    }
    for (let t = 0; t <= SAFE_FLIGHT + 1e-6; t += TRACK_STEP) {
      const px = x + Math.cos(heading) * v * t, py = y + Math.sin(heading) * v * t;
      const k = Math.round((wait + t) / TRACK_STEP);
      for (const o of others) {
        const q = o.at[Math.min(k, o.at.length - 1)];
        // Warning distance, or State One's bubble (either way round) and a margin.
        let lim = (r + o.r) * 2.6;
        if (o.bubble) lim = Math.max(lim, o.bubble + r + 25);
        if (isState) lim = Math.max(lim, BUBBLE + o.r + 25);
        if (q && dist(px, py, q.x, q.y) < lim) return false;
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
      if (clearOfTraffic(s.type, s.x, s.y, heading, 0, s, s.speedK || 1, s.emg === 'state') &&
          clearOfStorms(s.x, s.y, heading, TYPES[s.type].speed * (s.speedK || 1), 0)) {
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

  // ---------- emergencies ----------
  // Now and then an arrival comes in with an emergency and has to come first.
  // It's announced like any arrival (longer, with an alert), flashes, and
  // behaves after its kind; land it for a medal, lose it and it costs two
  // strikes. Never two at once, never at the very start of a shift.
  const EMG_RATE = { some: [70, 110], lots: [35, 60] };
  const EMG = {
    fuel:      { label: 'Mayday · fuel', call: 'emg_fuel' },
    medical:   { label: 'Pan-pan · medical', call: 'emg_medical', time: 45 },
    ambulance: { label: 'Air ambulance', call: 'emg_ambulance', time: 38 },
    damaged:   { label: 'Mayday · damaged', call: 'emg_damaged' },
    state:     { label: 'State One', call: 'emg_state' },
    // Grown-up only (grownUpOK): never for a child's profile or a guest.
    birdstrike: { label: 'Mayday · birds', call: 'emg_birdstrike', grown: true },
    fire:      { label: 'Mayday · fire', call: 'emg_fire', time: 35, grown: true },
    depress:   { label: 'Mayday · pressure', call: 'emg_depress', time: 30, grown: true },
    gear:      { label: 'Mayday · gear', call: 'emg_gear', grown: true },
    hydraulic: { label: 'Mayday · hydraulics', call: 'emg_hydraulic', grown: true },
    unruly:    { label: 'Pan-pan · passenger', call: 'emg_unruly', time: 40, grown: true },
  };
  // Grown-up emergencies need a signed-in profile that the Family page hasn't
  // marked as a child's, and the player not to have switched them off. A
  // guest is treated as a child, so signing out never unlocks them.
  function grownUpEligible() {
    const mine = me();
    if (!mine || typeof GN === 'undefined') return false;
    const prof = GN.profiles.list.find(q => q.id === mine.id) || GN.profiles.byName(mine.name);
    return !!prof && !prof.kid;
  }
  const grownUpOK = () => save.grownUp !== false && grownUpEligible();
  // Endless ranks each mix of emergencies on its own board.
  function endlessKey() {
    const v = save.emergencies || 'some';
    return v === 'off' ? 'off' : v + (grownUpOK() ? '-grownup' : '');
  }
  const BUBBLE = 70;
  function emergencyPlan(L) {
    if (L.emergencies === 'choice') {
      const v = save.emergencies || 'some';
      return v === 'off' ? null : { every: EMG_RATE[v], first: 25 };
    }
    return L.emergencies || null;
  }
  // ---------- conditions ----------
  // A cleared airport again, harder: each condition changes how it looks and
  // one rule. Fixed per condition, so they're comparable and earn a stamp
  // (best stars kept per condition, apart from the airport's own stars).
  const CONDITIONS = {
    dusk:  { name: 'Dusk', wx: 'Dusk', ink: '#c0582a', at: 'at dusk',
             rule: 'Evening rush: in the last third, arrivals come closer together.' },
    night: { name: 'Night', wx: 'Night', ink: '#2d4f8f', at: 'at night',
             rule: 'Seen late: each arrival shows a second later than usual.' },
    snow:  { name: 'Snow', wx: 'Snow · icy runways', ink: '#2f86a6', at: 'in the snow',
             rule: 'Icy runways: line up within 45° of the runway, or the approach won\'t lock on.' },
    storm: { name: 'Storm', wx: 'Storms', ink: '#6b3f93', at: 'in a storm',
             rule: 'Storm cells: at least two, one more than usual. Fly round them.' },
    fog:   { name: 'Fog', wx: 'Fog · low visibility', ink: '#55666b', at: 'in fog',
             rule: 'Low visibility: follow the approach lights all the way in, from the runway sign.' },
  };
  const STORMS_TAUGHT = 6;
  const FOG_FINAL = 80;
  function conditionsFor(L) {
    if (L.endless) return [];
    const out = [];
    if (L.theme !== 'night') out.push('dusk', 'night');
    if (L.theme !== 'snow' && L.theme !== 'desert') out.push('snow');
    out.push('storm', 'fog');
    return out;
  }
  // Why a condition can't be played yet, or null when it can.
  function conditionLock(L, c) {
    if (!cleared(L.id)) return `Clear ${L.name} first`;
    if (c === 'storm' && !cleared(STORMS_TAUGHT)) return `Clear ${LEVELS.find(l => l.id === STORMS_TAUGHT).name} first`;
    return null;
  }
  function conditionLevel(L, c) {
    const lv = Object.assign({}, L, { base: L, condition: c });
    if (c === 'dusk') lv.rushFrom = 2 / 3;
    if (c === 'night') lv.traffic = Object.assign({}, L.traffic, { warning: Math.max(1, (L.traffic.warning || 2) - 1) });
    if (c === 'snow') lv.alignMax = Math.PI / 4;
    if (c === 'storm') lv.storms = Math.max(2, (L.storms || 0) + 1);
    if (c === 'fog') lv.finalMin = FOG_FINAL;
    return lv;
  }
  function themeFor(level) {
    let th = THEMES[level.theme];
    if (level.condition === 'snow') th = Art.snowTheme(th, THEMES.snow);
    if (level.condition === 'night' || (level.condition === 'snow' && th.night)) th = Art.nightTheme(th);
    if (level.condition === 'storm') th = Object.assign({}, th, { stormy: true });
    return th;
  }
  // Dusk: day until a third of the way, dark by 85%.
  const duskAt = k => clamp((k - 0.3) / 0.55, 0, 1);
  const isNight = () => (S.duskTheme ? S.duskK > 0.55 : !!(S.theme && S.theme.night));
  const stampsCount = () => Object.values(save.stamps || {}).reduce((n, st) => n + Object.keys(st).length, 0);

  // ---------- free play ----------
  // Any cleared airport, your way. The toggles build a new level object from
  // the airport, which runs like any other; `free` on it means nothing is
  // earned or ranked. A toggle only shows once the airport that teaches it
  // has been cleared (or this airport has it anyway).
  const cleared = id => (save.stars[id] || 0) > 0;
  const TEACHES = { jet: 2, heli: 3, heavy: 8, fuel: 5, storms: 6, wind: 7, emergencies: 11, disruptions: 12 };
  const TYPE_WEIGHT = { prop: 1, jet: 1, heavy: 0.6, heli: 0.8 };
  const LANDS_ON = { prop: 'short', jet: 'long', heavy: 'long', heli: 'pad' };
  const FREE_TRAFFIC = { light: { gap: 1.35, cap: -1 }, normal: { gap: 1, cap: 0 }, rush: { gap: 0.75, cap: 2 } };
  const LOW_FUEL = 45, FULL_FUEL = 85, FREE_WIND = 45;
  const canFree = L => !L.endless && cleared(L.id);
  function freeDefaults(L) {
    return {
      length: 'shift', traffic: 'normal', types: Object.keys(L.traffic.types),
      fuel: L.traffic.fuel < 60, storms: L.storms || 0, wind: !!L.windShift,
      emergencies: L.emergencies ? (L.emergencies.every[0] < EMG_RATE.lots[1] ? 'lots' : 'some') : 'off',
      disruptions: L.disruptions ? (L.disruptions.every[0] < DIS_RATE.lots[1] ? 'lots' : 'some') : 'off',
    };
  }
  // What can be changed at this airport, for this player.
  function freeOptions(L) {
    const has = kind => L.runways.some(r => r.kind === kind);
    const own = L.traffic.types;
    return {
      types: ['prop', 'jet', 'heli', 'heavy'].filter(t => has(LANDS_ON[t]) && (t in own || t === 'prop' || cleared(TEACHES[t]))),
      fuel: L.traffic.fuel < 60 || cleared(TEACHES.fuel),
      storms: !!L.storms || cleared(TEACHES.storms),
      wind: !!L.windShift || cleared(TEACHES.wind),
      emergencies: !!L.emergencies || cleared(TEACHES.emergencies),
      disruptions: !!L.disruptions || cleared(TEACHES.disruptions),
    };
  }
  // The remembered choices, with anything not (or no longer) allowed reset.
  function freeChoices(L) {
    const d = freeDefaults(L), opts = freeOptions(L);
    const c = Object.assign({}, d, (save.free || {})[L.id] || {});
    if (!['shift', 'endless'].includes(c.length)) c.length = d.length;
    if (!(c.traffic in FREE_TRAFFIC)) c.traffic = d.traffic;
    c.types = (Array.isArray(c.types) ? c.types : []).filter(t => opts.types.includes(t));
    if (!c.types.length) c.types = d.types;
    for (const k of ['fuel', 'storms', 'wind', 'emergencies', 'disruptions']) if (!opts[k]) c[k] = d[k];
    c.fuel = !!c.fuel; c.wind = !!c.wind;
    c.storms = clamp(Math.round(+c.storms) || 0, 0, 3);
    if (!['off', 'some', 'lots'].includes(c.emergencies)) c.emergencies = d.emergencies;
    if (!['off', 'some', 'lots'].includes(c.disruptions)) c.disruptions = d.disruptions;
    return c;
  }
  function freePlayLevel(L, c) {
    const t = L.traffic, tr = FREE_TRAFFIC[c.traffic];
    const types = {};
    for (const type of c.types) types[type] = t.types[type] || TYPE_WEIGHT[type];
    return Object.assign({}, L, {
      base: L, free: Object.assign({}, c, { types: c.types.slice() }), endless: c.length === 'endless',
      storms: c.storms, windShift: c.wind ? (L.windShift || FREE_WIND) : 0,
      emergencies: c.emergencies === 'off' ? undefined : { every: EMG_RATE[c.emergencies], first: 25 },
      disruptions: c.disruptions === 'off' ? undefined : { kinds: DIS_KINDS.slice(), every: DIS_RATE[c.disruptions], first: 30 },
      traffic: Object.assign({}, t, {
        types,
        interval: t.interval.map(v => v * tr.gap),
        maxPlanes: Math.max(2, t.maxPlanes + tr.cap),
        fuel: c.fuel ? Math.min(t.fuel, LOW_FUEL) : Math.max(t.fuel, FULL_FUEL),
      }),
    });
  }
  // "Rush · 2 storms · endless": a free-play run in a few words.
  function freeSummary(c) {
    const bits = [];
    if (c.traffic !== 'normal') bits.push(c.traffic === 'rush' ? 'Rush' : 'Light traffic');
    if (c.storms) bits.push(c.storms === 1 ? '1 storm' : `${c.storms} storms`);
    if (c.wind) bits.push('wind shifts');
    if (c.fuel) bits.push('low fuel');
    if (c.emergencies !== 'off') bits.push(c.emergencies === 'lots' ? 'lots of emergencies' : 'emergencies');
    if (c.disruptions && c.disruptions !== 'off') bits.push(c.disruptions === 'lots' ? 'lots of disruptions' : 'disruptions');
    if (c.length === 'endless') bits.push('endless');
    const s = bits.join(' · ');
    return s ? s[0].toUpperCase() + s.slice(1) : 'As usual';
  }

  function emergencyActive() {
    return S.planes.some(p => p.emg && p.state === 'fly') || S.incoming.some(s => s.emg);
  }
  // Which kinds this airport can host, and the aircraft each would be.
  function emergencyChoices() {
    const L = S.level, types = Object.keys(L.traffic.types);
    const has = kind => L.runways.some(r => r.kind === kind);
    const out = [];
    out.push(['fuel', null]);
    const fixedWing = types.filter(t => t !== 'heli');
    if (fixedWing.length) out.push(['medical', fixedWing[Math.floor(Math.random() * fixedWing.length)]]);
    if (has('pad')) out.push(['ambulance', 'heli']);
    if (has('long')) out.push(['damaged', types.includes('heavy') && Math.random() < 0.4 ? 'heavy' : 'jet']);
    if (has('long')) out.push(['state', 'heavy']);
    if (grownUpOK()) {
      const any = list => list[Math.floor(Math.random() * list.length)];
      if (has('long')) {
        out.push(['fire', types.includes('heavy') && Math.random() < 0.4 ? 'heavy' : 'jet']);
        out.push(['gear', 'jet']);
        out.push(['hydraulic', 'jet']);
      }
      if (fixedWing.length) {
        out.push(['depress', any(fixedWing)]);
        out.push(['unruly', any(fixedWing)]);
      }
    }
    return out.filter(([kind]) => kind !== S.emgLast || out.length === 1);
  }
  function emergencyTick(dt) {
    if (S.emgTimer === Infinity || S.time < 8) return;
    if (!S.emgPending) S.emgTimer -= dt;
    if (S.emgTimer > 0 || S.emgPending || emergencyActive() || S.dis || S.time < (S.disQuiet || 0)) return;
    if (grownUpOK() && S.emgLast !== 'birdstrike' && Math.random() < 0.2 && birdStrike()) return;
    const choices = emergencyChoices();
    S.emgPending = choices[Math.floor(Math.random() * choices.length)];
    S.spawnTimer = Math.min(S.spawnTimer, 0.3);
  }
  // An aircraft already in the air loses an engine. Only one that's well
  // clear of everyone, so the surprise is the emergency, not a collision.
  function birdStrike(force) {
    const q = S.planes.find(p => p.state === 'fly' && !p.emg && p.entered && p.type !== 'heli' && (force || p.age > 6) &&
      S.planes.every(o => o === p || o.state !== 'fly' || dist(o.x, o.y, p.x, p.y) > 130));
    if (!q) return false;
    q.emg = 'birdstrike';
    q.speedK = 0.65;
    q.turnRate = 1.1;
    q.smokeT = 0;
    for (let i = 0; i < 10; i++) {
      S.effects.push({ kind: 'feather', x: q.x + (Math.random() - 0.5) * 16, y: q.y + (Math.random() - 0.5) * 16,
        a: Math.random() * TAU, t: 0, life: 1.4 + Math.random() * 0.6 });
    }
    playSound('birdstrike', { vol: 0.8, pan: panOf(q.x) });
    announce({ emg: 'birdstrike' });
    say(EMG.birdstrike.call, q, { priority: true });
    return true;
  }

  // ---------- holding ----------
  // Each airport has two or three hold fixes: beacons near the edges, named
  // from one shared pool (HOLD_FIXES in levels.js, keyed BNN, OCK, …). A
  // route let go at one (within HOLD_CATCH) sends the aircraft there to circle,
  // burning fuel, until it's drawn out again. Up to HOLD_MAX stack on a fix,
  // each on its own ring (its own height, really), so aircraft in the same
  // stack never count as a conflict with each other. Taught by Holding
  // Pattern: shown from there on in the career, and everywhere once it's
  // cleared.
  const HOLD_TAUGHT = TEACHES.disruptions;
  const HOLD_CATCH = 30, HOLD_MAX = 4, HOLD_TURN = 0.7;   // rad/s round the fix
  const holdR = slot => 22 + slot * 10;
  const HOLD_OUTER = holdR(HOLD_MAX - 1);
  function holdingOn(L) {
    const base = L.base || L;
    return LEVELS.indexOf(base) >= LEVELS.findIndex(l => l.id === HOLD_TAUGHT) || cleared(HOLD_TAUGHT);
  }
  const stackOf = fix => S.planes.filter(p => p.state === 'fly' && p.hold && p.hold.fix === fix);
  function freeSlot(fix, self) {
    const used = new Set(stackOf(fix).filter(p => p !== self).map(p => p.hold.slot));
    for (let k = 0; k < HOLD_MAX; k++) if (!used.has(k)) return k;
    return -1;
  }
  function fixNear(x, y) {
    const reach = Math.max(HOLD_CATCH, 22 / view.scale);
    let best = null, bestD = reach;
    for (const f of S.fixes) {
      const d = dist(x, y, f.x, f.y);
      if (d < bestD) { best = f; bestD = d; }
    }
    return best;
  }
  // A route let go at a fix: the aircraft will hold there.
  function holdAt(p) {
    const end = p.path[p.path.length - 1];
    const fix = end && fixNear(end.x, end.y);
    if (!fix) return false;
    if (p.bubble) { addText(end.x, end.y - 22, 'State One can\'t hold', '#ffffff', 13); return false; }
    const slot = freeSlot(fix, p.pendingOf || p);
    if (slot < 0) { addText(fix.x, fix.y - 30, 'Stack full', '#ffffff', 13); return false; }
    p.hold = { fix, slot, on: false };
    S.effects.push({ kind: 'ring', x: fix.x, y: fix.y, color: '#f3ead2', t: 0, life: 0.6 });
    addText(fix.x, fix.y - holdR(HOLD_MAX - 1) - 6, `Hold · ${HOLD_FIXES[fix.fix] || fix.fix}`, '#f3ead2', 12);
    playSound('hold_ping', { vol: 0.5, pan: panOf(fix.x) }) ||
      (tone(880, 0.06, { type: 'triangle', vol: 0.045 }), tone(660, 0.09, { type: 'triangle', vol: 0.04, delay: 0.07 }));
    buzz(12);
    // The pilot reads the fix back by name ("Holding at Bovingdon").
    say(`say_hold_${fix.fix.toLowerCase()}`, p, { chance: 0.85 });
    return true;
  }
  function enterHold(p) {
    const h = p.hold;
    h.on = true;
    h.a = Math.atan2(p.y - h.fix.y, p.x - h.fix.x);
    h.r = Math.max(8, dist(p.x, p.y, h.fix.x, h.fix.y));
    p.path = [];
    if (!save.heldOnce) { save.heldOnce = true; persist(); }
  }
  // One step round the orbit (clockwise on screen: right-hand turns, as real
  // holds fly), easing out or in to the slot's ring. The whole stack turns
  // together, a quarter turn apart, so it stays spread out: each aircraft
  // drifts round to its slot's place after joining. Works on a copy for
  // predictions (track, `now` in the future) as well as the real aircraft.
  function holdStep(q, h, dt, now) {
    h.r += clamp(holdR(h.slot) - h.r, -14 * dt, 14 * dt);
    const want = now * HOLD_TURN + h.fix.x * 0.01 + h.slot * Math.PI / 2;
    h.a += (HOLD_TURN + clamp(angDiff(h.a, want) * 0.8, -0.35, 0.35)) * dt;
    const nx = h.fix.x + Math.cos(h.a) * h.r, ny = h.fix.y + Math.sin(h.a) * h.r;
    q.heading = Math.atan2(ny - q.y, nx - q.x);
    q.x = nx; q.y = ny;
  }
  // In a fix's stack: holding there, or on its way in and already among the rings.
  const inStack = p => p.hold && (p.hold.on || dist(p.x, p.y, p.hold.fix.x, p.hold.fix.y) < HOLD_OUTER + 14);
  const stacked = (a, b) => inStack(a) && inStack(b) && a.hold.fix === b.hold.fix;

  // ---------- disruptions ----------
  // Things that happen to the whole airport: a runway obstruction, a drone
  // closing a patch of sky, a wave of diverted arrivals. Always announced on
  // the board with a countdown before anything changes; temporary; one at a
  // time; never during an emergency (nor an emergency during one) and never
  // in a shift's first seconds. Holding Pattern teaches them; the first of
  // each kind on a device explains itself.
  const DIS_RATE = { some: [70, 100], lots: [40, 60] };
  const DIS_KINDS = ['runway', 'drone', 'wave', 'balloons', 'display', 'cyber'];
  const DIS_WARN = { runway: 8, drone: 8, wave: 10, balloons: 8, display: 10, cyber: 5 };
  // How long each lasts once it's on. Balloons and the display team last as
  // long as their crossing takes (worked out when they're planned).
  const DIS_FOR = { runway: 20, drone: 30, cyber: 15 };
  const DRONE_R = 46;
  // Hot-air balloons (v1.30.0): one to three drift across in a loose group.
  // An aircraft inside a balloon's bubble diverts, as for a storm.
  const BALLOON_R = 32, BALLOON_SPEED = 20;
  const BALLOON_GROUP = [[0, 0], [62, 95], [-58, 180]];          // [across, behind] the line
  // The air display (v1.30.0): the Kestrels cross along a corridor shown for
  // the whole countdown; anything in the corridor near them as they pass diverts.
  const DISPLAY_TEAM = 'the Kestrels';
  const DISPLAY_HW = 34, DISPLAY_SPEED = 120;
  const KESTRELS = [[0, 0], [-15, 13], [15, 13], [-30, 26], [30, 26]];   // [across, behind] the leader
  const KESTREL_SMOKE = ['#f4f1ea', '#e2733a', '#e2733a', '#5b86b8', '#5b86b8'];
  const DISPLAY_ZONE = [-60, 24];                                  // behind / ahead of the leader that counts
  // The cyber attack (grown-ups) or system gremlin (children and guests),
  // v1.30.0: the radar only updates as its beam sweeps by (once a second), a
  // new route takes COMMS_DELAY seconds to reach the pilot, and holding
  // Restore backup for RESTORE_HOLD seconds ends it early. Only what's drawn
  // and when a route is sent change: every aircraft flies exactly as before.
  const SWEEP = 1, COMMS_DELAY = 2, RESTORE_HOLD = 3;
  const RANSOM = {
    cyber: { note: ['Systems locked', 'Pay 40 BTC', 'To restore'], done: ['Systems', 'restored', ''] },
    gremlin: { note: ['Gremlin in', 'the wires!', 'Hee hee hee'], done: ['Gremlin', 'gone', 'Bye bye!'] },
  };
  const OBSTACLES = {
    deer: 'A deer is heading for runway',
    dog: 'A dog is loose near runway',
    cart: 'A runaway luggage trolley is rolling toward runway',
  };
  // The first of each kind on a device pauses the game on a card that says
  // what's happening and what to do (the countdown waits for "Got it").
  // (Keyed by kind, and 'gremlin' for the children's cyber attack.)
  const DIS_TITLE = {
    runway: 'Runway closing', drone: 'Drone sighted', wave: 'Diversions',
    balloons: 'Balloons', display: 'Air display', cyber: 'Cyber attack', gremlin: 'Gremlin',
  };
  const DIS_HOW = {
    runway: 'In 8 seconds the runway closes for about 20 seconds while a van clears it. Hold arrivals at a beacon, or land them on another runway of the same colour. The countdown is at the top left.',
    drone: 'In 8 seconds that patch of sky closes for about 30 seconds: anything that flies into the red circle diverts, like a storm. Route round it, or hold until it\'s gone.',
    wave: 'Park them at the hold beacons and bring them in one at a time.',
    balloons: 'Watch the dotted line: in 8 seconds the balloons start drifting slowly along it and out the other side. Nobody can move a balloon, and anything that flies into the circle round one diverts, like a storm. Route round them.',
    display: 'In 10 seconds they fly past, trailing smoke; it takes them less than ten seconds. Anything inside the band as they pass diverts. Move aircraft out of it, or hold them, until they\'ve gone by.',
    cyber: 'In 5 seconds the tower\'s systems lock up for about 15 seconds. The radar only updates once a second, so aircraft jump about, and a new route takes 2 seconds to reach the pilot. Everyone keeps flying the routes you gave them. Hold Restore backup for 3 seconds to fix it early, but you won\'t be watching the sky while you do.',
    gremlin: 'In 5 seconds a gremlin gets into the wires for about 15 seconds! The radar only updates once a second, so aircraft hop about, and a new route takes 2 seconds to reach the pilot. Everyone keeps flying the routes you gave them. Hold Restore backup for 3 seconds to shoo it out early.',
  };
  function emergencyBusy() {
    return emergencyActive() || !!S.emgPending || S.planes.some(p => p.emg && p.state === 'land') ||
      S.closures.length > 0 || (S.police && S.time < S.police.until) || S.time < (S.emgQuiet || 0);
  }
  function disruptionTick(dt) {
    if (S.dis) return stepDisruption(dt);
    const plan = S.level.disruptions;
    if (!plan) return;
    S.disTimer -= dt;
    if (S.disTimer > 0 || S.time < 20 || emergencyBusy()) return;
    if (!startDisruption(plan)) S.disTimer = 3;
  }
  function startDisruption(plan, only) {
    let kinds = (only ? [only] : plan.kinds).filter(k => k !== 'wave' || S.fixes.length);
    if (!only && kinds.length > 1) kinds = kinds.filter(k => k !== S.disLast);
    kinds = kinds.slice().sort(() => Math.random() - 0.5);
    for (const kind of kinds) {
      const plan = { runway: planObstruction, drone: planDrone, wave: planWave, balloons: planBalloons, display: planDisplay, cyber: planCyber }[kind];
      const d = plan && plan();
      if (!d) continue;
      Object.assign(d, { kind, phase: 'warn', since: S.time, at: S.time + DIS_WARN[kind] });
      d.until = d.at + (d.dur || DIS_FOR[kind] || 0);
      S.dis = d;
      S.disLast = kind;
      announceDisruption(d);
      return true;
    }
    return false;
  }
  function planObstruction() {
    const open = S.level.runways.filter(r => r.kind !== 'pad' && !S.closures.some(c => c.runway === r));
    if (!open.length) return null;
    const r = open[Math.floor(Math.random() * open.length)];
    const a = r.angle * Math.PI / 180;
    const mid = { x: r.x + Math.cos(a) * r.length * 0.5, y: r.y + Math.sin(a) * r.length * 0.5 };
    // The van comes from the side nearer the middle of the map, so it's on screen.
    let nx = -Math.sin(a), ny = Math.cos(a);
    if (nx * (W / 2 - mid.x) + ny * (H / 2 - mid.y) < 0) { nx = -nx; ny = -ny; }
    const what = pick(Object.keys(OBSTACLES));
    const end = runwayEnd(r);
    return { runway: r, mid, nx, ny, a, what, number: Art.designator(end.angle * 180 / Math.PI), since: S.time };
  }
  // Near an approach, but never over a runway, a pad, a hold fix or anyone
  // who'd be inside it when it closes.
  function planDrone() {
    const cands = [];
    const ends = S.level.runways.map(runwayEnd);
    for (const end of ends) {
      // A pad is approached from anywhere: try all round it.
      const angs = end.angle == null ? [0, 1, 2, 3, 4, 5, 6, 7].map(i => i * Math.PI / 4) : [end.angle];
      for (const ang of angs) {
        for (const d of [175, 200, 160, 225]) {
          for (const side of [0, 30, -30]) {
            cands.push({ x: end.x - Math.cos(ang) * d - Math.sin(ang) * side, y: end.y - Math.sin(ang) * d + Math.cos(ang) * side, pad: end.kind === 'pad' });
          }
        }
      }
    }
    const R = DRONE_R, warn = DIS_WARN.drone;
    const fine = c => {
      if (c.x < R + 30 || c.x > W - R - 30 || c.y < R + 70 || c.y > H - R - 30) return false;
      if ((c.x < 220 || c.x > 740) && c.y < 165) return false;     // clear of the HUD's corners
      for (const r of S.level.runways) {
        if (r.kind === 'pad') { if (dist(c.x, c.y, r.x, r.y) < R + 40) return false; continue; }
        const a = r.angle * Math.PI / 180;
        if (segDist(c.x, c.y, r.x, r.y, r.x + Math.cos(a) * r.length, r.y + Math.sin(a) * r.length) < R + 30) return false;
      }
      if (S.fixes.some(f => dist(c.x, c.y, f.x, f.y) < R + HOLD_OUTER + 16)) return false;
      if (S.storms.some(st => dist(c.x, c.y, st.x, st.y) < R + st.r)) return false;
      return true;
    };
    const nobodyInside = c => S.planes.every(p => {
      if (p.state !== 'fly') return true;
      const at = track(p, warn + 1);
      return at.every((q, i) => !q || i * TRACK_STEP < warn - 3 || dist(q.x, q.y, c.x, c.y) > R + 25);
    });
    const ok = cands.filter(fine).sort(() => Math.random() - 0.5).sort((a, b) => a.pad - b.pad);
    const spot = ok.find(nobodyInside) || null;
    return spot && { x: spot.x, y: spot.y, r: R, seed: Math.random() * 100 };
  }
  function planWave() {
    const L = S.level;
    const lots = L.disruptions && L.disruptions.every[0] < DIS_RATE.lots[1];
    let n = (lots ? 4 : 3) + (Math.random() < 0.5 ? 1 : 0);
    if (!L.endless) {
      const airborne = S.planes.filter(p => p.state === 'fly').length + S.incoming.length;
      n = Math.min(n, L.target - S.landed - airborne);
    }
    if (n < 2) return null;
    const others = LEVELS.filter(l => !l.endless && l !== (L.base || L));
    return { left: n, n, gap: 0, from: pick(others).name };
  }
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
    return dist(px, py, ax + t * dx, ay + t * dy);
  }
  // Where a straight line through (c) along (ux, uy) is inside the airspace:
  // [in, out] as distances along it from c (in < out), or null.
  function spanAcross(c, ux, uy) {
    let lo = -Infinity, hi = Infinity;
    for (const [p, u, max] of [[c.x, ux, W], [c.y, uy, H]]) {
      if (Math.abs(u) < 1e-9) { if (p < 0 || p > max) return null; continue; }
      const a = (0 - p) / u, b = (max - p) / u;
      lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
    }
    return lo < hi ? [lo, hi] : null;
  }
  // Balloons and the display team only fly in daylight and fair weather: never
  // at dusk or after dark (Night Shift, or the Dusk and Night conditions), nor
  // with storm cells about or in fog.
  const fairWeather = () => !(S.theme && S.theme.night) && !S.duskTheme && !S.storms.length && S.level.condition !== 'fog';
  // Clear of the hold fixes' stacks (holding is where you put aircraft to keep
  // them out of the way, so nothing should sweep through one).
  const clearOfFixes = (ax, ay, bx, by, r) => S.fixes.every(f => segDist(f.x, f.y, ax, ay, bx, by) > r + HOLD_OUTER + 8);
  // The top edge is under the HUD's plates (and the toast): balloons never come
  // in there, where their marker could be hidden.
  const underTopEdge = (x, y) => y < 70;

  // One to three balloons in a loose group, each on its own straight line
  // (parallel), starting just outside the airspace and drifting out the far side.
  function planBalloons() {
    if (!fairWeather()) return null;
    const lots = S.level.disruptions && S.level.disruptions.every[0] < DIS_RATE.lots[1];
    const n = lots ? 2 + Math.floor(Math.random() * 2) : 1 + Math.floor(Math.random() * 3);
    const R = BALLOON_R;
    for (let tries = 0; tries < 60; tries++) {
      const steep = Math.random() < 0.4;
      let a = (steep ? Math.PI / 2 : 0) + (Math.random() - 0.5) * 0.6;
      if (Math.random() < 0.5) a += Math.PI;
      const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
      const off = steep ? lerp(-210, 210, Math.random()) : lerp(-130, 170, Math.random());
      const mid = { x: W / 2 + nx * off * (steep ? 1 : 0.4), y: H / 2 + ny * off };
      const group = [];
      let ok = true;
      for (let i = 0; i < n && ok; i++) {
        const [across, behind] = BALLOON_GROUP[i];
        const c = { x: mid.x + nx * across, y: mid.y + ny * across };
        const span = spanAcross(c, ux, uy);
        if (!span || span[1] - span[0] < 320) { ok = false; break; }
        const s0 = span[0] - R - 14 - behind, s1 = span[1] + R + 14;
        const ein = { x: c.x + ux * span[0], y: c.y + uy * span[0] }, eout = { x: c.x + ux * span[1], y: c.y + uy * span[1] };
        if (underTopEdge(ein.x, ein.y) || !clearOfFixes(ein.x, ein.y, eout.x, eout.y, R)) { ok = false; break; }
        group.push({
          x0: c.x + ux * s0, y0: c.y + uy * s0, vx: ux * BALLOON_SPEED, vy: uy * BALLOON_SPEED,
          ein, eout, travel: (s1 - s0) / BALLOON_SPEED, look: Math.floor(Math.random() * Art.BALLOON_LOOKS.length), seed: Math.random() * 10,
        });
      }
      if (!ok) continue;
      // no two the same colours
      group.forEach((b, i) => { while (group.slice(0, i).some(o => o.look === b.look)) b.look = (b.look + 1) % Art.BALLOON_LOOKS.length; });
      return { balloons: group, r: R, dur: Math.max(...group.map(b => b.travel)) };
    }
    return null;
  }
  // A balloon's position at game time `when`: it reaches the edge of the
  // airspace as it comes on, so before that it's further out, drifting in.
  const balloonAt = (d, b, when) => {
    const k = when - d.at;
    return { x: b.x0 + b.vx * k, y: b.y0 + b.vy * k };
  };
  const inBalloon = p => {
    const d = S.dis;
    if (!d || d.kind !== 'balloons' || d.phase !== 'on') return false;
    return d.balloons.some(b => { const q = balloonAt(d, b, S.time); return dist(p.x, p.y, q.x, q.y) < d.r; });
  };

  // A straight corridor right across the map, clear of the hold fixes.
  function planDisplay() {
    if (!fairWeather()) return null;
    const hw = DISPLAY_HW;
    for (let tries = 0; tries < 80; tries++) {
      const steep = Math.random() < 0.35;
      let a = (steep ? Math.PI / 2 : 0) + (Math.random() - 0.5) * (steep ? 0.7 : 1);
      if (Math.random() < 0.5) a += Math.PI;
      const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
      const off = (Math.random() - 0.5) * (steep ? 440 : 280);
      const c = { x: W / 2 + nx * off, y: H / 2 + ny * off };
      const span = spanAcross(c, ux, uy);
      if (!span || span[1] - span[0] < 420) continue;
      const ein = { x: c.x + ux * span[0], y: c.y + uy * span[0] }, eout = { x: c.x + ux * span[1], y: c.y + uy * span[1] };
      if (!clearOfFixes(ein.x, ein.y, eout.x, eout.y, hw)) continue;
      const start = span[0] - 150, end = span[1] + 90;
      return { c, a, ux, uy, nx, ny, hw, span, start, end, dur: (end - start) / DISPLAY_SPEED, team: DISPLAY_TEAM };
    }
    return null;
  }
  // The leader's distance along the corridor at game time `when`.
  const displayLead = (d, when) => d.start + DISPLAY_SPEED * Math.max(0, when - d.at);
  // Where a point is relative to the corridor: along it and across it.
  const corridorPos = (d, x, y) => ({ along: (x - d.c.x) * d.ux + (y - d.c.y) * d.uy, across: (x - d.c.x) * d.nx + (y - d.c.y) * d.ny });
  const inDisplay = p => {
    const d = S.dis;
    if (!d || d.kind !== 'display' || d.phase !== 'on') return false;
    const q = corridorPos(d, p.x, p.y), lead = displayLead(d, S.time);
    return Math.abs(q.across) < d.hw && q.along > lead + DISPLAY_ZONE[0] && q.along < lead + DISPLAY_ZONE[1];
  };

  // Grown-ups get the cyber attack; children's profiles and guests the gremlin.
  function planCyber() {
    return { gremlin: !grownUpOK() };
  }
  const cyberOn = () => !!S.dis && S.dis.kind === 'cyber' && S.dis.phase === 'on';
  function announceDisruption(d) {
    const key = d.kind === 'cyber' && d.gremlin ? 'gremlin' : d.kind;
    const first = !(save.disSeen || {})[key];
    save.disSeen = Object.assign({}, save.disSeen, { [key]: true });
    persist();
    let line;
    if (d.kind === 'runway') { toast(`Rwy ${d.number} closing`); line = `${OBSTACLES[d.what]} ${d.number}!`; }
    if (d.kind === 'drone') { toast('Drone sighted'); line = 'A drone has been spotted near an approach!'; }
    if (d.kind === 'wave') { toast(`${d.n} diversions`); line = `${d.from} is closed: ${d.n} diversions inbound in 10 seconds.`; }
    if (d.kind === 'balloons') {
      const n = d.balloons.length;
      toast(n === 1 ? 'Balloon ahead' : 'Balloons ahead');
      line = n === 1 ? 'A hot-air balloon is drifting this way!' : `${n === 2 ? 'Two' : 'Three'} hot-air balloons are drifting this way!`;
    }
    if (d.kind === 'display') { toast('Air display'); line = `The ${d.team.replace(/^the /, '')} display team is coming through along the dashed band!`; }
    if (d.kind === 'cyber') {
      toast('Network fault');
      line = d.gremlin ? 'Something is nibbling the tower\'s wires!' : 'The tower\'s network is under attack!';
    }
    sfx.chime();
    // The tower says it too (the lines were recorded for each kind and wave size).
    if (d.kind === 'runway') say(`tower_obstruct_${d.what}`, null, { priority: true, delay: 1.2 });
    if (d.kind === 'drone') say('tower_drone', null, { priority: true, delay: 1.2 });
    if (d.kind === 'wave' && d.n >= 3) say(`tower_wave_${Math.min(5, d.n)}`, null, { priority: true, delay: 1.2 });
    if (d.kind === 'balloons') say('tower_balloons', null, { priority: true, delay: 1.2 });
    if (d.kind === 'display') say('tower_display', null, { priority: true, delay: 1.2 });
    if (d.kind === 'cyber') say(d.gremlin ? 'tower_gremlin' : 'tower_cyber', null, { priority: true, delay: 1.2 });
    if (d.kind === 'runway' && d.what === 'dog') setTimeout(() => playSound('dog_bark', { vol: 0.5 }), 2600);
    buzz([30, 40, 30]);
    if (first) explain(DIS_TITLE[key], `${line} ${DIS_HOW[key]}`);
    else notice(line, 5);
  }
  function stepDisruption(dt) {
    const d = S.dis;
    if (d.phase === 'warn' && S.time >= d.at) {
      d.phase = 'on';
      if (d.kind === 'runway') {
        S.closures.push({ runway: d.runway, until: Infinity, since: S.time, obstruction: d });
        goAround(d.runway);
        toast(`Runway ${rwyNumber(d)} closed`);
        say('tower_clearing', null, { priority: true });
        playSound('ops_van', { vol: 0.5 });
      }
      if (d.kind === 'drone') {
        toast('No-fly zone on');
        playSound('drone_buzz', { vol: 0.45, pan: panOf(d.x) });
        for (const p of S.planes) if (p.state === 'fly' && p.entered && inDrone(p)) divert(p, 'Drone');
      }
      if (d.kind === 'wave') toast('Inbound now');
      if (d.kind === 'balloons') {
        const mid = d.balloons[0];
        playSound('balloon_burner', { vol: 0.55, pan: panOf(Math.max(0, Math.min(W, mid.ein.x))) }) || sfx.burner();
        d.burnIn = 6 + Math.random() * 5;
      }
      if (d.kind === 'display') playSound('display_flypast', { vol: 0.7, pan: panOf(d.c.x + d.ux * d.span[0]) }) || sfx.flypast();
      if (d.kind === 'cyber') startCyber(d);
    }
    if (d.phase !== 'on') return;
    if (d.kind === 'wave') {
      d.gap -= dt;
      if (d.gap <= 0) {
        if (queueArrival()) { S.incoming[S.incoming.length - 1].wave = true; d.left--; d.gap = 1.1; } else d.gap = 0.4;
      }
      if (d.left <= 0) endDisruption();
      return;
    }
    if (d.kind === 'balloons') {
      // A burner roars now and then as they drift.
      d.burnIn -= dt;
      if (d.burnIn <= 0) {
        d.burnIn = 7 + Math.random() * 7;
        const b = pick(d.balloons), q = balloonAt(d, b, S.time);
        if (q.x > 0 && q.x < W && q.y > 0 && q.y < H) playSound('balloon_burner', { vol: 0.35, pan: panOf(q.x) });
      }
    }
    if (d.kind === 'cyber') radarSweep(dt);
    if (S.time >= d.until) {
      if (d.kind === 'runway') {
        const c = S.closures.find(x => x.obstruction === d);
        if (c) reopenRunway(c);
      } else if (d.kind === 'drone') { toast('Drone gone'); say('tower_drone_gone', null, { priority: true }); }
      else if (d.kind === 'balloons') { toast(d.balloons.length === 1 ? 'Balloon gone' : 'Balloons gone'); say('tower_balloons_gone', null, { priority: true }); }
      else if (d.kind === 'display') {
        toast('Display over');
        say('tower_display_clear', null, { priority: true });
        S.smokeFade = { d, until: S.time + 5 };          // the smoke drifts away after them
      } else if (d.kind === 'cyber') endCyber(d);
      endDisruption();
    }
  }

  // ---------- the cyber attack / system gremlin ----------
  // The board scrambles and flips to a ransom note (a cheeky one for
  // children and guests). Underneath, for DIS_FOR.cyber seconds: the radar
  // shows each aircraft only where its beam last saw it (a full turn every
  // SWEEP seconds), and a new route reaches the pilot COMMS_DELAY seconds
  // after it's drawn (shown as pending meanwhile). Restore backup, held for
  // RESTORE_HOLD seconds, ends it early. Input is never frozen and nothing
  // drawn is made up: a blip is a real aircraft where it really was.
  function startCyber(d) {
    S.radar = { beam: -Math.PI / 2, seen: new Map() };
    for (const p of S.planes) if (p.state === 'fly') blip(p);
    showRansom(d.gremlin);
    sfx.rattle();
    if (d.gremlin) playSound('gremlin_giggle', { vol: 0.7 }) || sfx.giggle();
    else playSound('cyber_glitch', { vol: 0.7 }) || sfx.glitch();
    // (no toast: the ransom note is the news, where the toast would be)
    buzz([20, 30, 20, 30, 20]);
  }
  // What the radar shows for an aircraft: where it was when the beam last
  // passed, and the route it was flying then.
  function blip(p) {
    S.radar.seen.set(p, { x: p.x, y: p.y, rot: p.rot, heading: p.heading, path: p.path.slice(), at: S.time });
  }
  // The beam turns once every SWEEP seconds round the middle of the map; an
  // aircraft's blip moves when the beam crosses its bearing.
  function radarSweep(dt) {
    const R = S.radar;
    if (!R) return;
    const from = R.beam, turn = TAU * dt / SWEEP;
    R.beam += turn;
    for (const p of S.planes) {
      if (p.state !== 'fly') { R.seen.delete(p); continue; }
      const bearing = Math.atan2(p.y - H / 2, p.x - W / 2);
      const past = ((bearing - from) % TAU + TAU) % TAU;
      if (past < turn || !R.seen.has(p)) blip(p);
    }
  }
  function endCyber(d) {
    S.radar = null;
    restore.down = false;
    setRestore(0);
    hideRansom(d.gremlin);                 // the note flips to "Systems restored" / "Gremlin gone"
    playSound('restore_ok', { vol: 0.7 }) || sfx.chime();
    say(d.gremlin ? 'tower_gremlin_gone' : 'tower_cyber_restored', null, { priority: true });
  }
  // Restore backup, held long enough: the attack ends now.
  function restoreSystems() {
    if (!cyberOn()) return;
    S.dis.until = S.time;
    S.dis.restored = true;
  }
  // The comms delay: a route drawn while it's on goes into a copy of the
  // aircraft (`into`, which reads everything else from the aircraft itself),
  // and is handed over COMMS_DELAY seconds after it's let go.
  const commsOn = () => cyberOn();
  function sendRoute(p, q) {
    p.pend = { q, at: S.time + COMMS_DELAY };
  }
  function applyRoute(p) {
    const q = p.pend.q;
    p.pend = null;
    if (p.state !== 'fly') return;
    let landing = q.landing;
    // The runway may have closed, or the wind turned, while it was on its way:
    // break off, as any go-around does (no route, fly on and be given another).
    if (landing && (isClosed(landing.runway, p) || (landing.kind !== 'pad' && q.flipped !== S.flipped))) {
      p.path = []; p.landing = null;
      if (p.hold && !p.hold.on) p.hold = null;
      addText(p.x, p.y - 22, 'Go around', '#ffffff', 13);
      say('say_goaround', p, { priority: true });
      return;
    }
    p.path = sinceStart(p, q.path, q.from);
    p.landing = landing;
    if (q.hold) {
      const slot = freeSlot(q.hold.fix, p);
      if (slot < 0) { if (p.hold && !p.hold.on) p.hold = null; addText(q.hold.fix.x, q.hold.fix.y - 30, 'Stack full', '#ffffff', 13); }
      else p.hold = { fix: q.hold.fix, slot, on: false };
    } else if (p.hold && !p.hold.on) p.hold = null;
    // The radar shows the route it's now flying from where it last saw it.
    const b = S.radar && S.radar.seen.get(p);
    if (b) b.path = p.path.slice();
    if (!b) S.effects.push({ kind: 'ring', x: p.x, y: p.y, color: '#f3ead2', t: 0, life: 0.5 });
  }

  // A route drawn during a radar fault starts where the blip was. By the time
  // it reaches the pilot the aircraft is further on, so the start of the
  // route it has already flown past is dropped: only points behind it and no
  // further from the route's start than the aircraft itself is (a route that
  // deliberately turns back further out is left alone).
  function sinceStart(p, path, from) {
    if (!from || !path.length) return path;
    const hx = Math.cos(p.heading), hy = Math.sin(p.heading);
    const reach = dist(from.x, from.y, p.x, p.y) + 10;
    let k = 0;
    while (k < path.length - 1 && (path[k].x - p.x) * hx + (path[k].y - p.y) * hy < 6 &&
           dist(path[k].x, path[k].y, from.x, from.y) <= reach) k++;
    return path.slice(k);
  }

  // The ransom note: three rows of flaps on the HUD, under the landed count.
  let ransomTimer = 0;
  const SCRAMBLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/?!-+';
  const junk = n => Array.from({ length: n }, () => SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)]).join('');
  function showRansom(gremlin) {
    const el = $('ransom');
    el.classList.toggle('gremlin', gremlin);
    el.classList.remove('done');
    show('ransom', true);
    boards.ransom.forEach(b => b.set(junk(14), { stagger: 6, maxSteps: 12 }));
    clearTimeout(ransomTimer);
    const note = RANSOM[gremlin ? 'gremlin' : 'cyber'].note;
    ransomTimer = setTimeout(() => {
      boards.ransom.forEach((b, i) => b.set(note[i], { align: 'center', stagger: 18, maxSteps: 10, delay: i * 90 }));
      sfx.rattle();
    }, 700);
  }
  function hideRansom(gremlin, now) {
    clearTimeout(ransomTimer);
    if (now) { show('ransom', false); return; }
    $('ransom').classList.add('done');
    const done = RANSOM[gremlin ? 'gremlin' : 'cyber'].done;
    boards.ransom.forEach((b, i) => b.set(done[i], { align: 'center', stagger: 20, maxSteps: 8 }));
    ransomTimer = setTimeout(() => show('ransom', false), 2200);
  }
  // Restore backup: a hold, not a tap, so it's a choice.
  const restore = { down: false, start: 0 };
  function setRestore(k) {
    const btn = $('btn-restore');
    btn.style.setProperty('--k', k.toFixed(3));
    btn.classList.toggle('holding', k > 0);
    btn.querySelector('.restore-label').textContent = k > 0 ? `Restoring… ${Math.max(1, Math.ceil(RESTORE_HOLD * (1 - k)))}` : 'Hold · restore backup';
  }
  function restoreFrame(now) {
    if (!restore.down) return;
    if (!cyberOn() || S.screen !== 'play') { restore.down = false; setRestore(0); return; }
    const k = (now - restore.start) / (RESTORE_HOLD * 1000);
    setRestore(Math.min(1, k));
    if (k >= 1) { restore.down = false; restoreSystems(); }
  }
  {
    const btn = $('btn-restore');
    const down = e => {
      if (!cyberOn() || restore.down) return;
      if (e.preventDefault) e.preventDefault();
      restore.down = true;
      restore.start = performance.now();
      tone(440, 0.08, { type: 'triangle', vol: 0.04 });
      if (e.pointerId != null) try { btn.setPointerCapture(e.pointerId); } catch { /* fine */ }
    };
    const up = () => { if (restore.down) { restore.down = false; setRestore(0); } };
    btn.addEventListener('pointerdown', down);
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, up);
    btn.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) down(e); });
    btn.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') up(); });
    btn.addEventListener('contextmenu', e => e.preventDefault());
  }

  function endDisruption() {
    S.dis = null;
    const plan = S.level.disruptions;
    S.disTimer = plan ? lerp(plan.every[0], plan.every[1], Math.random()) : Infinity;
    S.disQuiet = S.time + 8;          // a breather before any emergency
  }
  const rwyNumber = d => Art.designator(runwayEnd(d.runway).angle * 180 / Math.PI);
  const inDrone = p => S.dis && S.dis.kind === 'drone' && S.dis.phase === 'on' && dist(p.x, p.y, S.dis.x, S.dis.y) < S.dis.r;

  function queueArrival() {
    const pending = S.emgPending;
    const emg = pending ? pending[0] : null;
    const type = (pending && pending[1]) || pickType();
    const speedK = { damaged: 0.7, depress: 1.3, hydraulic: 0.85 }[emg] || 1;
    const lead = emg ? 3.5 : (S.level.traffic.warning || 2);
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
      if (!clearOfStorms(x, y, heading, TYPES[type].speed * speedK, lead)) continue;
      if (!clearOfTraffic(type, x, y, heading, lead, null, speedK, emg === 'state')) continue;
      const arrival = { type, x, y, heading, t: lead, lead, emg, speedK };
      const crowded = S.planes.some(p => dist(p.x, p.y, x, y) < 150) ||
                      S.incoming.some(s => dist(s.x, s.y, x, y) < 150);
      if (!crowded) { S.incoming.push(arrival); announce(arrival); return true; }
      fallback = fallback || arrival;
    }
    // Crowded is acceptable when nothing better turned up; into a storm or
    // someone's path never is.
    if (fallback) { S.incoming.push(fallback); announce(fallback); return true; }
    return false;
  }
  // An emergency is announced the moment its marker appears.
  function announce(s) {
    if (!s.emg) return;
    S.emgLast = s.emg;
    S.emgPending = null;
    const plan = emergencyPlan(S.level);
    S.emgTimer = plan ? lerp(plan.every[0], plan.every[1], Math.random()) : Infinity;
    toast(EMG[s.emg].label);
    playSound('emg_alert', { vol: 0.7 }) || sfx.warn();
    buzz([40, 60, 40, 60, 40]);
  }
  function spawnPlane(s) {
    const T = TYPES[s.type];
    const fuel = S.level.traffic.fuel * (0.9 + Math.random() * 0.25);
    const p = {
      id: S.nextId++, type: s.type, T, x: s.x, y: s.y, heading: s.heading, rot: s.heading,
      path: [], landing: null, state: 'fly', fuel, maxFuel: fuel, odo: 0,
      entered: false, warn: false, t: Math.random() * 10, age: 0, landT: 0, alt: 1, scale: 1, alpha: 1,
      trail: [], trailT: 0, speedK: s.speedK || 1, emg: s.emg || null,
    };
    if (p.emg === 'fuel') { p.fuel = p.maxFuel * 0.3; p.saidLow = p.saidMayday = true; }
    if (EMG[p.emg] && EMG[p.emg].time) p.emgLeft = p.emgMax = EMG[p.emg].time;
    if (p.emg === 'damaged') { p.turnRate = 0.9; p.smokeT = 0; }
    if (p.emg === 'state') p.bubble = BUBBLE;
    if (p.emg === 'fire') p.smokeT = 0;
    if (p.emg === 'depress') { p.speedK = 1.3; p.alt = 0.5; }
    if (p.emg === 'hydraulic') { p.turnRate = 0.45; p.speedK = 0.85; }
    S.planes.push(p);
    if (p.emg) {
      say(EMG[p.emg].call, p, { priority: true });
      if (p.emg === 'state') say('tower_state', null, { priority: true });
    } else {
      sfx.spawn();
      if (s.wave) say('say_divert_in', p, { chance: 0.5 });
    }
  }

  // ---------- simulation ----------
  function update(dt, clock) {
    for (const e of S.effects) e.t += dt;
    S.effects = S.effects.filter(e => e.t < e.life);
    if (S.level) {
      Art.updateSky(S.sky, dt);
      if (S.snow.length) Art.updateSnow(S.snow, dt, clock);
      if (S.rain.length) Art.updateRain(S.rain, dt);
      if (S.duskTheme) S.duskK = duskAt(progress());
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
    // A diversion wave brings its own arrivals: the usual ones wait for it.
    const wave = S.dis && S.dis.kind === 'wave';
    if (S.spawnTimer <= 0 && wave) S.spawnTimer = 1;
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

    emergencyTick(dt);
    disruptionTick(dt);
    for (const c of S.closures.slice()) {
      if (c.reservedFor) {
        const q = c.reservedFor;
        if (q.state === 'land' || (q.state === 'fly' && q.landing && q.landing.runway === c.runway)) continue;
        S.closures = S.closures.filter(x => x !== c);       // route dropped: foam no longer needed
        continue;
      }
      if (S.time >= c.until) reopenRunway(c);
    }
    for (const st of S.storms) updateStorm(st, dt);
    // Routes sent during a comms delay reach their pilots.
    for (const p of S.planes) if (p.pend && S.time >= p.pend.at) applyRoute(p);
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
    let step = p.T.speed * (p.speedK || 1) * dt;
    // Holding: drawn out the moment a new route has a point; joins its ring
    // as it reaches it (or its route's end).
    if (p.hold && p.hold.on && p.path.length) { p.hold = null; say('say_unhold', p, { chance: 0.6 }); }
    if (p.hold && !p.hold.on && dist(p.x, p.y, p.hold.fix.x, p.hold.fix.y) <= holdR(p.hold.slot) + 2) enterHold(p);
    if (p.hold && p.hold.on) {
      holdStep(p, p.hold, dt, S.time);
      step = 0;
    } else if (p.turnRate) {
      // A damaged aircraft can't turn sharply: it steers toward the route at
      // a limited rate and lets go of points it can no longer make. Missing
      // the runway that way means going around: it needs a long, straight
      // final, which is the point of it.
      while (p.path.length) {
        const q = p.path[0], d = dist(p.x, p.y, q.x, q.y);
        const off = Math.abs(angDiff(p.heading, Math.atan2(q.y - p.y, q.x - p.x)));
        if (d < 9 && p.path.length === 1 && p.landing) break;
        if (d < 9 || (off > 1.6 && d < 70)) {
          if (p.path.length === 1 && p.landing) {
            p.path = []; p.landing = null;
            addText(p.x, p.y - 22, 'Too tight: go around', '#ffffff', 13);
            say('say_goaround', p, { priority: true });
            break;
          }
          p.path.shift();
          continue;
        }
        break;
      }
      if (p.path.length) {
        const q = p.path[0];
        if (p.path.length === 1 && p.landing && dist(p.x, p.y, q.x, q.y) < 9) {
          // It has to arrive lined up, too: a damaged aircraft can't swing
          // onto the runway at the last moment.
          if (p.landing.angle == null || Math.abs(angDiff(p.heading, p.landing.angle)) < 0.6) { p.path = []; return beginLanding(p); }
          p.path = []; p.landing = null;
          addText(p.x, p.y - 22, 'Not lined up: go around', '#ffffff', 13);
          say('say_goaround', p, { priority: true });
        }
        if (p.path.length) {
          const want = Math.atan2(q.y - p.y, q.x - p.x);
          p.heading += clamp(angDiff(p.heading, want), -p.turnRate * dt, p.turnRate * dt);
        }
      }
      move(p, step);
      step = 0;
    } else {
      while (step > 0 && p.path.length) {
        const q = p.path[0];
        const d = dist(p.x, p.y, q.x, q.y);
        if (d > 0.001) p.heading = Math.atan2(q.y - p.y, q.x - p.x);
        if (d <= step) { p.x = q.x; p.y = q.y; p.odo += d; p.path.shift(); step -= d; }
        else { move(p, step); step = 0; }
      }
      if (!p.path.length && p.landing) return beginLanding(p);
    }
    if (p.hold && !p.hold.on && !p.path.length) enterHold(p);
    if (step > 0) move(p, step);

    if (!p.entered && p.x > EDGE && p.x < W - EDGE && p.y > EDGE && p.y < H - EDGE) p.entered = true;
    if (p.entered && !(p.hold && p.hold.on)) {
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

    if (p.emg === 'damaged' || p.emg === 'fire' || p.emg === 'birdstrike') {
      p.smokeT -= dt;
      if (p.smokeT <= 0) {
        p.smokeT = p.emg === 'fire' ? 0.08 : 0.12;
        const bx = p.x - Math.cos(p.heading) * 10, by = p.y - Math.sin(p.heading) * 10;
        S.effects.push({ kind: 'puff', x: bx, y: by, t: 0, life: 1.8 });
        if (p.emg === 'fire') S.effects.push({ kind: 'flame', x: bx, y: by, t: 0, life: 0.5 });
      }
    }
    if (p.emgLeft != null) {
      p.emgLeft -= dt;
      if (p.emgLeft <= 0) { say('emg_timeout', p, { priority: true }); return divert(p, 'Out of time'); }
    }
    const tank = p.fuel / p.maxFuel;
    if (tank < 0.4 && !p.saidLow) { p.saidLow = true; say('say_lowfuel', p, { priority: true }); }
    if (tank < 0.15 && !p.saidMayday) { p.saidMayday = true; say('say_mayday', p, { priority: true }); }
    if (p.fuel <= 0) return divert(p, 'Out of fuel');
    if (p.entered && S.storms.some(st => dist(p.x, p.y, st.x, st.y) < st.r * 0.8)) return divert(p, 'Storm');
    if (p.entered && inDrone(p)) return divert(p, 'Drone');
    if (p.entered && inBalloon(p)) return divert(p, 'Balloon');
    if (p.entered && inDisplay(p)) return divert(p, 'Air display');
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
    if (p.emg) S.emgQuiet = S.time + 8;
    if (p.emg) {
      S.medals++;
      addText(end.x, end.y - 44, 'Medal!', '#f2b33d', 18);
      playSound('medal', { vol: 0.7 });
      buzz([20, 40, 60]);
      say('emg_thanks', p, { priority: true });
      if ((p.emg === 'damaged' || p.emg === 'fire' || p.emg === 'gear') && end.kind !== 'pad') {
        S.closures = S.closures.filter(c => c.reservedFor !== p);
        if (p.emg === 'gear') {
          playSound('scrape', { vol: 0.8, pan: panOf(end.x) });
          for (let i = 0; i < 14; i++) S.effects.push({ kind: 'spark', x: end.x, y: end.y, a: end.angle + Math.PI + (Math.random() - 0.5) * 1.2, v: 30 + Math.random() * 60, t: 0, life: 0.6 + Math.random() * 0.5 });
        }
        closeRunway(end, p, p.emg === 'damaged' ? 8 : 14);
      }
      if (p.emg === 'unruly') sendPolice(end, p);
    } else say('say_thanks', p, { chance: 0.3 });
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
    S.lives -= p.emg ? 2 : 1;
    if (p.emg) S.emgQuiet = S.time + 8;
    if (S.drawing && S.drawing.plane === p) S.drawing = null;
    if (p.emg) addText(p.x, p.y - 36, 'Emergency lost: two strikes', '#ff8a7a', 13);
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
    const Bd = S.bounds || { x0: 0, y0: 0, x1: W, y1: H };
    if (p.x < Bd.x0 - 40 || p.x > Bd.x1 + 40 || p.y < Bd.y0 - 40 || p.y > Bd.y1 + 40) p.state = 'gone';
  }

  function checkSeparation(dt) {
    const fly = S.planes.filter(p => p.state === 'fly');
    S.conflicts = [];
    for (const p of fly) p.warn = false;
    for (let i = 0; i < fly.length; i++) {
      for (let j = i + 1; j < fly.length; j++) {
        const a = fly[i], b = fly[j];
        if (stacked(a, b)) continue;        // one stack, different heights
        const d = dist(a.x, a.y, b.x, b.y), r = a.T.radius + b.T.radius;
        if (d < r) return crash(a, b);
        if (d < r * 2.6) { a.warn = b.warn = true; S.conflicts.push([a, b]); }
      }
    }
    // State One: nobody into its bubble. Close is a warning; inside, the
    // intruder is turned away by security and it costs a strike.
    S.bubbleWarn = [];
    for (const st of fly) {
      if (!st.bubble) continue;
      for (const o of fly) {
        if (o === st || o.state !== 'fly') continue;
        const d = dist(st.x, st.y, o.x, o.y);
        if (d < st.bubble + o.T.radius) {
          say('tower_breach', null, { priority: true });
          divert(o, 'Security');
        } else if (d < st.bubble + o.T.radius + 35) { S.bubbleWarn.push([st, o]); o.warn = true; }
      }
    }
    S.warnCooldown -= dt;
    if ((S.conflicts.length || S.bubbleWarn.length) && S.warnCooldown <= 0) { sfx.warn(); S.warnCooldown = 0.45; }
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
    S.radar = null;
    restore.down = false;
    hideRansom(false, true);
    S.overTimer = delay;
    $('btn-pause').disabled = true;
    const L = S.level;
    S.newStamp = false;
    if (L.free) {
      S.newBest = false;          // free play: nothing to earn
    } else if (L.condition) {
      if (outcome === 'win') {
        const book = save.stamps[L.id] = save.stamps[L.id] || {};
        const had = book[L.condition];
        book[L.condition] = { stars: Math.max(had ? had.stars : 0, S.lives), at: had ? had.at : new Date().toISOString() };
        if (!had) { S.newStamp = true; save.passportNew = true; }
      }
    } else if (L.endless) {
      if (S.assisted) {
        S.newBest = S.landed > (save.bestCalm || 0);
        if (S.newBest) save.bestCalm = S.landed;
      } else {
        const v = S.endlessKey || endlessKey();
        S.newBest = S.landed > (save.bestBy[v] || 0);
        if (S.newBest) save.bestBy[v] = S.landed;
      }
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
      medals: S.medals,
      emergencies: L.emergencies === 'choice' ? (S.endlessKey || endlessKey()) : undefined,
      free: L.free ? Object.assign({}, L.free, { types: L.free.types.slice() }) : undefined,
      condition: L.condition || undefined,
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
  let familyBest = null, familyBoards = {};
  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
  // A random tag for this browser, so the owner's Activity page can tell
  // guests apart ("Guest 3F1A") without a name. It proves nothing, so it
  // never signs anyone in.
  function deviceTag() {
    if (!/^[0-9a-f]{8}$/.test(save.device || '')) {
      const bytes = new Uint8Array(4);
      if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
      else bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 256); });
      save.device = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
      persist();
    }
    return save.device;
  }
  // Every finished shift goes to the server: a profile's to the family
  // records, a guest's (marked `guest`) only to the owner's Activity log.
  function recordShift(shift) {
    shift.id = newId();
    shift.device = deviceTag();
    const mine = me();
    if (mine) shift.profile = mine.id; else shift.guest = true;
    save.outbox = (save.outbox || []).concat([shift]).slice(-20);
    persist();
    recordStatus[shift.id] = { state: mine ? 'sending' : 'guest' };
    flushOutbox();
    return shift.id;
  }
  let flushing = false;
  async function flushOutbox() {
    if (flushing || !(save.outbox || []).length) return;
    flushing = true;
    try {
      while ((save.outbox || []).length) {
        const shift = save.outbox[0];
        const mine = me();
        // Shifts queued before v1.26.0 carry neither mark: they were a profile's.
        const asMe = !!mine && !shift.guest && (!shift.profile || shift.profile === mine.id);
        const body = Object.assign({}, shift, { device: shift.device || deviceTag() });
        delete body.guest; delete body.profile;
        let res;
        try {
          res = await fetch('/final-approach/api/shifts', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, asMe ? GN.me.headers() : {}),
            body: JSON.stringify(body),
          });
        } catch {
          if (asMe) recordStatus[shift.id] = { state: 'kept' };
          break;                                   // offline: try again later
        }
        const reply = await res.json().catch(() => ({}));
        if (res.status >= 500) { if (asMe) recordStatus[shift.id] = { state: 'kept' }; break; }
        if (asMe) {
          recordStatus[shift.id] = res.ok ? { state: 'ok', name: mine.name }
            : { state: 'refused', error: reply.error || 'the server said no' };
        }
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
    familyBoards = data.leaderboards || {};
    familyBest = (familyBoards[endlessKey()] || [])[0] || null;
    const mine = me();
    let changed = false;
    const player = mine && (data.players || []).find(pl => GN.fold(pl.name) === GN.fold(mine.name));
    if (player) {
      for (const [id, n] of Object.entries(player.stars || {})) {
        if (n > (save.stars[id] || 0)) { save.stars[id] = n; changed = true; }
      }
      for (const [v, n] of Object.entries(player.endless || {})) {
        if (n > (save.bestBy[v] || 0)) { save.bestBy[v] = n; changed = true; }
      }
      if (player.endless_best_calm > (save.bestCalm || 0)) { save.bestCalm = player.endless_best_calm; changed = true; }
      for (const [id, book] of Object.entries(player.stamps || {})) {
        for (const [c, got] of Object.entries(book)) {
          const mine = (save.stamps[id] || {})[c];
          if (!mine || got.stars > mine.stars) {
            save.stamps[id] = Object.assign({}, save.stamps[id], { [c]: { stars: Math.max(got.stars, mine ? mine.stars : 0), at: mine ? mine.at : got.at } });
            changed = true;
          }
        }
      }
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

  // After a damaged aircraft lands, fire engines close its runway for a few
  // seconds. Anyone on approach to it goes around.
  const CLOSED_FOR = 8;
  // Closed to everyone, or (a foam reservation) to everyone but the aircraft it's kept for.
  // With no aircraft given (drawing the lights), any closure counts.
  const isClosed = (r, p) => S.closures.some(c => c.runway === r && (!c.reservedFor || c.reservedFor !== p));
  // A belly landing: once its route locks on, foam goes down and the runway
  // is kept for it alone; anyone else on approach goes around.
  function reserveForGear(p) {
    const r = p.landing.runway;
    if (S.closures.some(c => c.runway === r)) return;
    S.closures.push({ runway: r, reservedFor: p, until: Infinity, since: S.time, foam: true, from: [] });
    for (const q of S.planes) {
      if (q !== p && q.state === 'fly' && q.landing && q.landing.runway === r) {
        q.landing = null; q.path = [];
        addText(q.x, q.y - 22, 'Go around', '#ffffff', 13);
      }
    }
    say('tower_foam', null, { priority: true });
  }
  // Anyone on approach to a runway that's closing goes around (no strike).
  function goAround(runway) {
    for (const q of S.planes) {
      if (q.state === 'fly' && q.landing && q.landing.runway === runway) {
        q.landing = null; q.path = [];
        addText(q.x, q.y - 22, 'Go around', '#ffffff', 13);
        if (S.drawing && S.drawing.plane === q) S.drawing = null;
      }
    }
  }
  function closeRunway(end, p, secs = CLOSED_FOR) {
    const roll = end.length * 0.8;
    const stop = { x: end.x + Math.cos(end.angle) * roll, y: end.y + Math.sin(end.angle) * roll };
    const nx = -Math.sin(end.angle), ny = Math.cos(end.angle);
    S.closures.push({
      runway: end.runway, until: S.time + secs, since: S.time, stop, angle: end.angle,
      from: [{ x: stop.x + nx * 70, y: stop.y + ny * 70 }, { x: stop.x - nx * 70 - Math.cos(end.angle) * 30, y: stop.y - ny * 70 - Math.sin(end.angle) * 30 }],
    });
    goAround(end.runway);
    toast('Runway closed');
    playSound('siren', { vol: 0.5, fadeOut: 1.2 });
    say('tower_closed', null, { priority: true });
  }
  // An unruly passenger: police drive out to meet the aircraft.
  function sendPolice(end, p) {
    const roll = end.kind === 'pad' ? 0 : end.length * 0.8;
    const stop = { x: end.x + Math.cos(end.angle || 0) * roll, y: end.y + Math.sin(end.angle || 0) * roll };
    S.police = { stop, from: { x: stop.x, y: stop.y > H / 2 ? H + 20 : -20 }, since: S.time, until: S.time + 7 };
    say('tower_police', null, { priority: true });
  }
  function reopenRunway(c) {
    S.closures = S.closures.filter(x => x !== c);
    toast('Runway open');
    // "Emergency vehicles clear" only fits an emergency's closure.
    say(c.obstruction ? 'tower_open_1' : 'tower_open', null, { priority: true });
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
      // You grab what you can see: during a radar fault, the blip.
      const at = (S.radar && S.radar.seen.get(p)) || p;
      const d = dist(at.x, at.y, w.x, w.y);
      if (d < bestD) { best = { plane: p, end: null }; bestD = d; }
    }
    for (const p of S.planes) {
      if (p.state !== 'fly' || p.landing || p.hold || !p.path.length) continue;
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
    // A comms delay: the route is drawn into a copy and sent when it's let go.
    let into = null;
    if (commsOn()) {
      into = Object.create(p);
      // During a radar fault a fresh route starts at the blip you touched, not
      // at the aircraft's hidden position (applyRoute trims what it's passed).
      const blip = !pick.end && S.radar && S.radar.seen.get(p);
      Object.assign(into, { pendingOf: p, path: pick.end ? p.path.slice() : [], landing: null, hold: null, flipped: S.flipped,
        from: blip ? { x: blip.x, y: blip.y } : null });
      // The landing checks (landingFor, straightIn) read the route's origin
      // from the aircraft: for a route drawn from the blip, that's the blip.
      if (blip) Object.assign(into, { x: blip.x, y: blip.y, heading: blip.heading != null ? blip.heading : p.heading });
    } else if (!pick.end) {
      p.path = [];
      p.landing = null;
      // On its way to a fix: a new route cancels that. Already holding: it
      // stays in the hold until the new route has a point (a tap is no harm).
      if (p.hold && !p.hold.on) p.hold = null;
    }
    const from = pick.end || (into && into.from) || { x: p.x, y: p.y };
    S.drawing = { plane: p, into, pointerId: e.pointerId, last: { x: from.x, y: from.y }, done: false, extending: !!pick.end };
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
    const q = d.into || d.plane;
    // Let go at a hold fix: the aircraft holds there.
    const held = !d.done && q.path.length && holdAt(q);
    if (!held && !d.done && q.path.length > 4) say('say_turn', d.plane, { chance: 0.3 });
    S.drawing = null;
    // Drawn during a comms delay: on its way to the pilot (or straight there,
    // if the systems came back while it was being drawn).
    if (d.into) {
      if (commsOn()) sendRoute(d.plane, d.into);
      else { d.plane.pend = { q: d.into, at: S.time }; applyRoute(d.plane); }
    }
  };
  canvas.addEventListener('pointerup', endDraw);
  canvas.addEventListener('pointercancel', endDraw);

  function extendRoute(w) {
    const d = S.drawing;
    if (!d || d.done) return;
    const p = d.into || d.plane;
    const x = clamp(w.x, EDGE + 2, W - EDGE - 2), y = clamp(w.y, EDGE + 2, H - EDGE - 2);
    const gap = dist(d.last.x, d.last.y, x, y);
    if (gap < SPACING) return;
    const n = Math.floor(gap / SPACING);
    const from = d.last;
    for (let i = 1; i <= n; i++) {
      const pt = { x: lerp(from.x, x, i / n), y: lerp(from.y, y, i / n) };
      p.path.push(pt);
      d.last = pt;
      landingMiss = null;
      const end = landingFor(p, pt);
      if (!end && landingMiss && !d.missShown) {
        d.missShown = true;
        addText(pt.x, pt.y - 20, landingMiss, '#ffffff', 13);
      }
      if (end) {
        p.path.push({ x: end.x, y: end.y });
        p.landing = end;
        d.done = true;
        if (p.emg === 'gear' && end.kind !== 'pad') reserveForGear(p);
        S.effects.push({ kind: 'ring', x: end.x, y: end.y, color: KINDS[end.kind].color, t: 0, life: 0.6 });
        sfx.lock(p);
        return;
      }
    }
  }

  // Does this route point complete a valid approach for plane p?
  function landingFor(p, pt) {
    for (const r of S.level.runways) {
      if (r.kind !== p.T.kind || isClosed(r, p)) continue;
      const end = runwayEnd(r);
      if (r.kind === 'pad') {
        if (dist(pt.x, pt.y, end.x, end.y) < 24) return end;
        continue;
      }
      const zx = end.x - Math.cos(end.angle) * 14, zy = end.y - Math.sin(end.angle) * 14;
      if (dist(pt.x, pt.y, zx, zy) > 26) continue;
      const back = p.path.length >= 4 ? p.path[p.path.length - 4] : { x: p.x, y: p.y };
      const dir = dist(back.x, back.y, pt.x, pt.y) > 2 ? Math.atan2(pt.y - back.y, pt.x - back.x) : p.heading;
      const off = Math.abs(angDiff(dir, end.angle));
      if (off >= 1.2) continue;
      // Snow: icy runways need a straighter approach.
      if (S.level.alignMax && off >= S.level.alignMax) { landingMiss = 'Icy runway: line up straighter'; continue; }
      // Fog: the last stretch has to follow the approach lights in.
      if (S.level.finalMin && !straightIn(p, end, S.level.finalMin)) { landingMiss = 'Fog: follow the lights in'; continue; }
      return end;
    }
    return null;
  }
  let landingMiss = null;
  // Does the route's last `len` units (back from the threshold) stay on the
  // runway's extended centre line? The aircraft's own position counts as the
  // route's start, so one already on final passes.
  function straightIn(p, end, len) {
    const ux = Math.cos(end.angle), uy = Math.sin(end.angle);
    const pts = [{ x: p.x, y: p.y }].concat(p.path);
    let run = 0;
    for (let i = pts.length - 1; i >= 0; i--) {
      const q = pts[i];
      const along = (q.x - end.x) * ux + (q.y - end.y) * uy;
      const side = Math.abs(-(q.x - end.x) * uy + (q.y - end.y) * ux);
      if (side > 14 || along > 6) return false;
      if (i < pts.length - 1) run += dist(q.x, q.y, pts[i + 1].x, pts[i + 1].y);
      if (run >= len) return true;
    }
    return false;
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
    const Bd = S.bounds || { x0: 0, y0: 0, x1: W, y1: H };
    const BW = Bd.x1 - Bd.x0, BH = Bd.y1 - Bd.y0;
    ctx.save();
    ctx.beginPath(); ctx.rect(Bd.x0, Bd.y0, BW, BH); ctx.clip();

    const th = S.theme;
    const night = isNight();
    ctx.drawImage(S.terrain, Bd.x0, Bd.y0, BW, BH);
    if (S.terrainNight && S.duskK > 0) {
      ctx.globalAlpha = S.duskK;
      ctx.drawImage(S.terrainNight, Bd.x0, Bd.y0, BW, BH);
      ctx.globalAlpha = 1;
      // golden light on the way down
      const gold = Math.sin(Math.PI * Math.min(1, S.duskK * 1.4)) * 0.16;
      if (gold > 0.01) { ctx.fillStyle = `rgba(255,140,60,${gold})`; ctx.fillRect(Bd.x0, Bd.y0, BW, BH); }
    }
    if (th.stormy) { ctx.fillStyle = 'rgba(20,28,40,0.28)'; ctx.fillRect(Bd.x0, Bd.y0, BW, BH); }
    if (th.sea) Art.foam(ctx, t);
    ctx.globalAlpha = S.duskTheme ? 1 - S.duskK * 0.8 : 1;
    Art.cloudLayer(ctx, S.sky, true);
    ctx.globalAlpha = 1;
    if (S.level.condition === 'fog') Art.fog(ctx, t);

    const drawingKind = S.drawing && !S.drawing.done ? S.drawing.plane.T.kind : null;
    for (const r of S.level.runways) {
      if (isClosed(r)) continue;
      Art.approach(ctx, runwayEnd(r), KINDS[r.kind].color, t, r.kind === drawingKind, night, S.level.finalMin ? 9 : 6);
    }
    for (const c of S.closures) drawClosure(c, t);
    if (S.police) drawPolice(t);
    drawObstruction(t);
    drawBoundary(Bd, t);
    drawFixes(t);

    const landing = S.planes.filter(p => p.state === 'land');
    const air = S.planes.filter(p => p.state !== 'land');
    for (const p of landing) Art.aircraftShadow(ctx, p);
    for (const p of landing) Art.aircraft(ctx, p, p.t, night);
    for (const st of S.storms) Art.storm(ctx, st, t);
    if (S.dis && S.dis.kind === 'drone') Art.droneZone(ctx, S.dis, t, S.dis.phase === 'on', markK());
    drawDisplay(t, 'ground');
    drawBalloons(t, 'ground');
    // Route-end handles at least 22 CSS pixels across, like the markers.
    const handleR = Math.max(6.5, 11 / view.scale);
    // During a radar fault every aircraft in the air is drawn as its blip.
    const seen = air.map(shown).filter(Boolean);
    const d = S.drawing;
    for (const p of seen) if (p.state === 'fly') Art.route(ctx, p, p.T.color, t, d && d.plane === (p.real || p) && !d.into, handleR);
    for (const p of seen) {
      const real = p.real || p;
      if (real.pend) drawPending(real, p, t);
      if (d && d.into && d.plane === real) Art.route(ctx, Object.assign(Object.create(d.into), { x: p.x, y: p.y }), p.T.color, t, true, handleR);
    }
    for (const p of seen) Art.trail(ctx, p);
    for (const p of seen) Art.aircraftShadow(ctx, p);
    for (const p of seen) {
      if (p.state === 'fly') drawStatus(p, t, 'under');
      Art.aircraft(ctx, p, p.t, night);
      if (p.state === 'fly') drawStatus(p, t, 'over');
      if (p.state === 'fly' && p.emg) drawEmergency(p, t);
    }
    drawBalloons(t, 'sky');
    drawDisplay(t, 'sky');
    drawRadar(t);
    drawConflicts(t);
    // At least 30 CSS pixels across on any screen, so a phone shows it.
    const markerR = Math.max(16, 16 / view.scale);
    for (const s of S.incoming) {
      Art.incoming(ctx, s, t, TYPES[s.type].color, markerR, TYPES[s.type].kind);
      if (s.emg) {
        const x = clamp(s.x, markerR + 4, W - markerR - 4), y = clamp(s.y, markerR + 4, H - markerR - 4);
        ctx.save();
        ctx.lineWidth = 3.5; ctx.setLineDash([6, 5]); ctx.lineDashOffset = t * 30;
        ctx.strokeStyle = Math.sin(t * 9) > 0 ? '#ff3b30' : '#ffffff';
        ctx.beginPath(); ctx.arc(x, y, markerR + 6, 0, TAU); ctx.stroke();
        ctx.restore();
      }
    }
    drawGhost(t);
    ctx.globalAlpha = S.duskTheme ? 1 - S.duskK * 0.8 : 1;
    Art.cloudLayer(ctx, S.sky, false);
    ctx.globalAlpha = 1;
    if (S.snow.length) Art.drawSnow(ctx, S.snow);
    if (S.rain.length) Art.drawRain(ctx, S.rain);
    for (const e of S.effects) Art.effect(ctx, e);
    Art.vignette(ctx, night);
    ctx.restore();
  }

  // Marks on the map stay readable on a phone: at least their designed size
  // in CSS pixels.
  const markK = () => Math.max(1, 0.85 / view.scale);

  // ---------- hold fixes ----------
  function drawFixes(t) {
    if (!S.fixes.length) return;
    const d = S.drawing && !S.drawing.done ? S.drawing : null;
    const last = d && d.plane.path.length ? d.plane.path[d.plane.path.length - 1] : null;
    const near = last && !d.plane.bubble ? fixNear(last.x, last.y) : null;
    // Until someone has held an aircraft, Holding Pattern's beacons say "HOLD".
    const teach = !save.heldOnce && S.level.id === HOLD_TAUGHT && S.screen === 'play';
    for (const f of S.fixes) {
      Art.holdFix(ctx, f, t, {
        k: markK(), ring: holdR(1), count: stackOf(f).length, highlight: !!d && !d.plane.bubble, near: near === f,
        catchR: Math.max(HOLD_CATCH, 22 / view.scale), teach, night: isNight(),
      });
    }
  }

  // ---------- a runway obstruction ----------
  // While it's announced, the deer (or dog, or trolley) wanders onto the
  // runway from the far side; once the runway closes the ops van drives out,
  // the animal is shooed off the way it came (the trolley is towed away), and
  // the van goes home.
  function drawObstruction(t) {
    const d = S.dis;
    if (!d || d.kind !== 'runway') return;
    const ease = q => q * (2 - q);
    const k = markK(), face = Math.atan2(d.ny, d.nx);
    let o = { x: d.mid.x, y: d.mid.y, a: face, moving: false, alpha: 1 }, van = null;
    const along = (pt, off) => ({ x: pt.x + Math.cos(d.a) * off, y: pt.y + Math.sin(d.a) * off });
    if (d.phase === 'warn') {
      const q = clamp((S.time - d.since) / (d.at - d.since), 0, 1);
      const off = 46 * (1 - ease(q));
      o = Object.assign(o, along({ x: d.mid.x - d.nx * off, y: d.mid.y - d.ny * off }, Math.sin(S.time * 0.7) * 5), { moving: q < 1 });
    } else {
      const q = clamp((S.time - d.at) / (d.until - d.at), 0, 1);
      const from = { x: clamp(d.mid.x + d.nx * 120, 20, W - 20), y: clamp(d.mid.y + d.ny * 120, 20, H - 20) };
      const park = { x: d.mid.x + d.nx * 15, y: d.mid.y + d.ny * 15 };
      const vk = q < 0.3 ? ease(q / 0.3) : q < 0.8 ? 1 : 1 - ease((q - 0.8) / 0.2);
      van = { x: lerp(from.x, park.x, vk), y: lerp(from.y, park.y, vk), h: q < 0.8 ? face + Math.PI : face };
      if (d.what === 'cart') {
        if (q >= 0.8) o = Object.assign(o, { x: van.x - d.nx * 13, y: van.y - d.ny * 13, moving: true });
      } else {
        const g = q < 0.55 ? 0 : ease(Math.min(1, (q - 0.55) / 0.3));
        o = Object.assign(o, { x: d.mid.x - d.nx * 80 * g, y: d.mid.y - d.ny * 80 * g, a: face + Math.PI, moving: g > 0 && g < 1, alpha: 1 - Math.max(0, (g - 0.6) / 0.4) });
      }
    }
    if (o.alpha > 0) {
      ctx.save(); ctx.globalAlpha = o.alpha;
      Art.obstacle(ctx, d.what, o.x, o.y, o.a, t, o.moving, k);
      ctx.restore();
    }
    if (van) Art.opsVan(ctx, van.x, van.y, van.h, t);
  }

  // ---------- balloons ----------
  // Announced: a dotted line for each balloon from where it'll come in to
  // where it'll leave, and a marker at the edge counting down. On: the
  // balloons, their shadows and their bubbles, and the way still to go.
  function drawBalloons(t, layer) {
    const d = S.dis;
    if (!d || d.kind !== 'balloons') return;
    const k = markK(), live = d.phase === 'on';
    const at = d.balloons.map(b => balloonAt(d, b, S.time));
    if (layer === 'ground') {
      d.balloons.forEach((b, i) => {
        const q = at[i];
        // the rest of the way, once it's inside
        const from = live && insideAirspace(b, q) ? q : b.ein;
        Art.driftLine(ctx, from.x, from.y, b.eout.x, b.eout.y, t, live ? 0.5 : 0.9);
      });
      if (live) d.balloons.forEach((b, i) => Art.balloonBubble(ctx, at[i].x, at[i].y, d.r, t, true));
      d.balloons.forEach((b, i) => Art.balloonShadow(ctx, at[i].x, at[i].y, k));
      return;
    }
    d.balloons.forEach((b, i) => Art.balloon(ctx, at[i].x, at[i].y, t, k, b.look, b.seed, isNight()));
    if (!live) {
      // where each comes in, with the countdown filling round it
      const r = Math.max(16, 16 / view.scale), done = clamp((S.time - d.since) / (d.at - d.since), 0, 1);
      for (const b of d.balloons) {
        const x = clamp(b.ein.x, r + 4, W - r - 4), y = clamp(b.ein.y, r + 4, H - r - 4);
        ctx.save();
        ctx.translate(x, y);
        const pulse = (t * 1.4) % 1;
        ctx.strokeStyle = `rgba(242,179,61,${0.65 * (1 - pulse)})`; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(0, 0, r * (1.05 + pulse * 0.9), 0, TAU); ctx.stroke();
        ctx.fillStyle = 'rgba(20,24,28,0.86)';
        ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
        ctx.lineCap = 'round'; ctx.lineWidth = r * 0.16;
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.beginPath(); ctx.arc(0, 0, r * 0.88, 0, TAU); ctx.stroke();
        ctx.strokeStyle = '#f2b33d';
        ctx.beginPath(); ctx.arc(0, 0, r * 0.88, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0.02, done)); ctx.stroke();
        Art.balloon(ctx, 0, r * 0.12, t, r / 24, b.look, b.seed, false);
        ctx.restore();
      }
    }
  }
  // Has the balloon got into the airspace yet (so its line starts from it)?
  const insideAirspace = (b, q) => q.x >= -1 && q.x <= W + 1 && q.y >= -1 && q.y <= H + 1;

  // ---------- the air display ----------
  // The corridor shows for the whole countdown and, once they're coming,
  // ahead of the formation; behind them it's clear again and only the smoke
  // is left, drifting away.
  function displayPoint(d, along, across) {
    return { x: d.c.x + d.ux * along + d.nx * across, y: d.c.y + d.uy * along + d.ny * across };
  }
  function drawDisplay(t, layer) {
    const d = S.dis && S.dis.kind === 'display' ? S.dis : null;
    if (layer === 'ground') {
      if (!d) return;
      const live = d.phase === 'on', lead = displayLead(d, S.time);
      const s0 = live ? Math.max(d.span[0] - 30, lead + DISPLAY_ZONE[0]) : d.span[0] - 30;
      Art.corridor(ctx, d.c, d.a, d.hw, s0, d.span[1] + 30, t, live);
      if (!live) {
        const k = markK(), p = displayPoint(d, d.span[0] + Math.min(150, (d.span[1] - d.span[0]) / 2), 0);
        ctx.save();
        Art.tag(ctx, 'KESTRELS · DISPLAY', p.x, p.y, k, '#f2b33d');
        ctx.restore();
      }
      return;
    }
    const fade = !d && S.smokeFade && S.time < S.smokeFade.until ? S.smokeFade : null;
    const src = d || (fade && fade.d);
    if (!src || (d && d.phase !== 'on')) return;
    const alpha = d ? 1 : (fade.until - S.time) / 5;
    const lead = displayLead(src, Math.min(S.time, src.until));
    // A touch bigger than life, and bigger still on a phone, spaced to match.
    const k = markK() * 1.25;
    KESTRELS.forEach(([across, behind], i) => {
      const a = displayPoint(src, src.start - behind * k, across * k), b = displayPoint(src, lead - behind * k, across * k);
      Art.smoke(ctx, a.x, a.y, b.x, b.y, KESTREL_SMOKE[i], 560, alpha);
    });
    if (d) for (const [across, behind] of KESTRELS) {
      const p = displayPoint(d, lead - behind * k, across * k);
      Art.displayJet(ctx, p.x, p.y, d.a, k);
    }
  }

  // ---------- the cyber attack ----------
  // What's on screen for an aircraft: itself, or (radar fault) its blip.
  // Null for one the beam hasn't found yet.
  function shown(p) {
    const R = S.radar;
    if (!R || p.state !== 'fly') return p;
    const b = R.seen.get(p);
    if (!b) return null;
    const live = S.drawing && S.drawing.plane === p && !S.drawing.into;
    return Object.assign(Object.create(p), { real: p, x: b.x, y: b.y, rot: b.rot, heading: b.heading, path: live ? p.path : b.path, trail: [] });
  }
  // The radar's beam, a faint sweep, and each blip's afterglow.
  function drawRadar(t) {
    const R = S.radar;
    if (!R) return;
    ctx.save();
    const reach = Math.hypot(W, H) / 2 + 60;
    ctx.translate(W / 2, H / 2);
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = `rgba(70,230,140,${0.1 * (1 - i / 10)})`;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, reach, R.beam - (i + 1) * 0.06, R.beam - i * 0.06); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(60,210,130,0.7)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(R.beam) * reach, Math.sin(R.beam) * reach); ctx.stroke();
    ctx.restore();
    ctx.save();
    for (const [p, b] of R.seen) {
      const k = clamp(1 - (S.time - b.at) / 0.9, 0, 1);
      if (k <= 0 || p.state !== 'fly') continue;
      ctx.strokeStyle = `rgba(120,255,180,${0.8 * k})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(b.x, b.y, p.T.radius + 6 + (1 - k) * 10, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }
  // A route on its way to the pilot: dashed, with a clock filling at its end.
  function drawPending(p, from, t) {
    const q = p.pend.q, k = clamp(1 - (p.pend.at - S.time) / COMMS_DELAY, 0, 1);
    const end = q.path.length ? q.path[q.path.length - 1] : from;
    ctx.save();
    if (q.path.length) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(from.x, from.y);
      for (const pt of q.path) ctx.lineTo(pt.x, pt.y);
      ctx.setLineDash([7, 7]); ctx.lineDashOffset = -t * 20;
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(15,20,25,0.5)'; ctx.stroke();
      ctx.lineWidth = 2.8; ctx.strokeStyle = '#f2b33d'; ctx.stroke();
      ctx.setLineDash([]);
    }
    const r = Math.max(7, 10 / view.scale);
    ctx.fillStyle = 'rgba(20,24,28,0.8)';
    ctx.beginPath(); ctx.arc(end.x, end.y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#f2b33d'; ctx.lineWidth = r * 0.35; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.arc(end.x, end.y, r * 0.62, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0.02, k)); ctx.stroke();
    Art.tag(ctx, 'SENDING', end.x, end.y - r - 9 * markK(), markK(), '#f2b33d');
    ctx.restore();
  }

  // ---------- the edge of the control zone ----------
  // Outside the airspace the landscape carries on, a little dimmer, behind a
  // dashed amber line labelled with the airport's code ("THD CONTROL ZONE").
  // Only drawn where the screen shows past the airspace.
  function drawBoundary(Bd, t) {
    if (Bd.x0 >= 0 && Bd.y0 >= 0 && Bd.x1 <= W && Bd.y1 <= H) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(Bd.x0, Bd.y0, Bd.x1 - Bd.x0, Bd.y1 - Bd.y0);
    ctx.rect(0, 0, W, H);
    ctx.fillStyle = 'rgba(10,14,18,0.34)';
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(242,179,61,0.9)'; ctx.lineWidth = 1.6;
    ctx.setLineDash([10, 6]); ctx.lineDashOffset = -t * 4;
    ctx.strokeRect(0, 0, W, H);
    ctx.setLineDash([]);
    ctx.font = '600 9px Oswald, "Arial Narrow", sans-serif';
    ctx.letterSpacing = '2px';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(242,179,61,0.95)';
    const label = `${S.level.code} CONTROL ZONE`;
    if (Bd.x0 < -14) {
      ctx.save(); ctx.translate(-9, H / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(label, 0, 0); ctx.restore();
      ctx.save(); ctx.translate(W + 9, H / 2); ctx.rotate(Math.PI / 2); ctx.fillText(label, 0, 0); ctx.restore();
    }
    if (Bd.y0 < -14) { ctx.fillText(label, W / 2, -9); ctx.fillText(label, W / 2, H + 9); }
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
      if (S.drawing && S.drawing.plane === (p.real || p)) {
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

  // A closed runway: a red cross at each end and fire engines at the aircraft.
  function drawClosure(c, t) {
    const r = c.runway, a = r.angle * Math.PI / 180;
    if (c.foam && c.reservedFor) {
      // Foam laid down the runway's middle, waiting for the belly landing.
      ctx.save();
      ctx.translate(r.x, r.y); ctx.rotate(a);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (let i = 0; i < 14; i++) {
        const x = 30 + (r.length - 60) * (i / 13);
        ctx.beginPath(); ctx.ellipse(x, Math.sin(i * 2.3) * 2, 11, 5, 0, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    const ends = [{ x: r.x, y: r.y }, { x: r.x + Math.cos(a) * r.length, y: r.y + Math.sin(a) * r.length }];
    ctx.save();
    ctx.strokeStyle = '#ff3b30'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    for (const e of ends) {
      ctx.beginPath(); ctx.moveTo(e.x - 8, e.y - 8); ctx.lineTo(e.x + 8, e.y + 8); ctx.moveTo(e.x + 8, e.y - 8); ctx.lineTo(e.x - 8, e.y + 8); ctx.stroke();
    }
    if (!c.stop) { ctx.restore(); return; }
    const k = Math.min(1, (S.time - c.since) / 2.2), ease = k * (2 - k);
    c.from.forEach((f, i) => {
      const x = lerp(f.x, c.stop.x + (i ? -10 : 10) * Math.cos(c.angle + Math.PI / 2), ease);
      const y = lerp(f.y, c.stop.y + (i ? -10 : 10) * Math.sin(c.angle + Math.PI / 2), ease);
      const h = Math.atan2(c.stop.y - f.y, c.stop.x - f.x);
      ctx.save();
      ctx.translate(x, y); ctx.rotate(h);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-5, -2, 12, 6);
      ctx.fillStyle = '#d7322a'; ctx.fillRect(-6, -3, 12, 6);
      ctx.fillStyle = '#f3f0e8'; ctx.fillRect(-2, -2, 5, 4);
      const flash = Math.sin(t * 18 + i) > 0;
      ctx.fillStyle = flash ? '#4aa3ff' : '#ffffff';
      ctx.beginPath(); ctx.arc(-4, 0, 1.4, 0, TAU); ctx.fill();
      if (flash) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(74,163,255,0.35)';
        ctx.beginPath(); ctx.arc(-4, 0, 6, 0, TAU); ctx.fill();
      }
      ctx.restore();
    });
    ctx.restore();
  }

  function drawPolice(t) {
    const pc = S.police;
    if (S.time > pc.until) { S.police = null; return; }
    const k = Math.min(1, (S.time - pc.since) / 3), ease = k * (2 - k);
    const x = lerp(pc.from.x, pc.stop.x + 14, ease), y = lerp(pc.from.y, pc.stop.y + 12, ease);
    ctx.save();
    ctx.translate(x, y); ctx.rotate(Math.atan2(pc.stop.y - pc.from.y, pc.stop.x - pc.from.x));
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-4, -1.5, 10, 5);
    ctx.fillStyle = '#f3f0e8'; ctx.fillRect(-5, -2.5, 10, 5);
    ctx.fillStyle = '#2a5bd7'; ctx.fillRect(-5, -0.6, 10, 1.2);
    const flash = Math.sin(t * 20) > 0;
    ctx.fillStyle = flash ? '#4aa3ff' : '#ff3b30';
    ctx.beginPath(); ctx.arc(0, 0, 1.3, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = flash ? 'rgba(74,163,255,0.35)' : 'rgba(255,59,48,0.35)';
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // Emergencies are hard to miss: red-and-white strobes, a countdown for a
  // medical one, State One's bubble.
  function drawEmergency(p, t) {
    const R = p.T.radius * (save.large ? 1.25 : 1);
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.bubble) {
      ctx.strokeStyle = 'rgba(242,179,61,0.85)'; ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]); ctx.lineDashOffset = -t * 10;
      ctx.beginPath(); ctx.arc(0, 0, p.bubble, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(242,179,61,0.07)';
      ctx.beginPath(); ctx.arc(0, 0, p.bubble, 0, TAU); ctx.fill();
    }
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 5]);
    ctx.lineDashOffset = t * 30;
    ctx.strokeStyle = Math.sin(t * 9) > 0 ? '#ff3b30' : '#ffffff';
    ctx.beginPath(); ctx.arc(0, 0, R + 14, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    if (p.emgLeft != null) {
      const f = Math.max(0, p.emgLeft / p.emgMax);
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(20,24,28,0.6)'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(0, 0, R + 21, 0, TAU); ctx.stroke();
      ctx.strokeStyle = f < 0.3 ? '#ff3b30' : '#ffffff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, R + 21, -Math.PI / 2, -Math.PI / 2 + TAU * f); ctx.stroke();
    }
    const label = p.emg === 'state' ? 'STATE ONE' : p.emgLeft != null ? `${Math.ceil(p.emgLeft)}s`
      : p.emg === 'gear' ? 'NO GEAR' : 'MAYDAY';
    ctx.font = '600 11px Oswald, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(18,22,26,0.8)'; ctx.lineJoin = 'round';
    ctx.strokeText(label, 0, -R - 24);
    ctx.fillStyle = p.emg === 'state' ? '#f2b33d' : '#ffd0c9';
    ctx.fillText(label, 0, -R - 24);
    ctx.restore();
  }

  function drawConflicts(t) {
    if (S.bubbleWarn && S.bubbleWarn.length) {
      ctx.save();
      ctx.strokeStyle = '#f2b33d'; ctx.lineWidth = 1.6; ctx.setLineDash([5, 4]); ctx.lineDashOffset = -t * 20;
      ctx.beginPath();
      for (const [a, b] of S.bubbleWarn) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      ctx.stroke();
      ctx.restore();
    }
    if (!S.conflicts.length) return;
    ctx.save();
    ctx.strokeStyle = '#ff3b30';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 4]);
    ctx.lineDashOffset = -t * 20;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    // (between blips, during a radar fault)
    const at = p => (S.radar && S.radar.seen.get(p)) || p;
    for (const [a, b] of S.conflicts) { const pa = at(a), pb = at(b); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); }
    ctx.stroke();
    ctx.restore();
  }

  // ---------- UI ----------
  const show = (id, on) => $(id).classList.toggle('hidden', !on);
  const overlays = ['menu', 'brief', 'pause', 'result', 'settings', 'free', 'guest', 'passport', 'explain'];
  function only(id) { for (const o of overlays) show(o, o === id); }

  const boards = {
    title: new Flap.Board($('title-flaps'), 14),
    clock: new Flap.Board($('clock-flaps'), 5),
    code: new Flap.Board($('hud-code'), 3),
    landed: new Flap.Board($('hud-landed'), 5),
    wind: new Flap.Board($('hud-wind-flaps'), 4),
    dis: new Flap.Board($('hud-dis-flaps'), 4),
    toast: new Flap.Board($('toast-flaps'), 16),
    ransom: [1, 2, 3].map(i => new Flap.Board($('ransom-' + i), 14)),
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

  // A sentence under the toast: what a disruption is, and (the first time) what to do.
  let noticeTimer = 0;
  function notice(text, secs = 6) {
    const el = $('notice');
    el.textContent = text;
    show('notice', !!text);
    clearTimeout(noticeTimer);
    if (text) noticeTimer = setTimeout(() => show('notice', false), secs * 1000);
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
    // A disruption's countdown: to when it starts, then (runway, drone) to when it ends.
    const d = S.dis;
    const on = !!d && (d.phase === 'warn' || d.kind !== 'wave');
    if (hudState.disOn !== on) { hudState.disOn = on; show('hud-dis', on); }
    if (on) {
      const warn = d.phase === 'warn';
      const rwy = d.kind === 'runway' ? rwyNumber(d) : '';          // follows a wind shift
      const label = warn ? { runway: `Rwy ${rwy} closes`, drone: 'Drone zone in', wave: 'Diversions in', balloons: 'Balloons in', display: 'Display in', cyber: 'Network fault' }[d.kind]
        : { runway: `Rwy ${rwy} opens`, drone: 'Drone gone in', balloons: 'Balloons gone in', display: 'Display over in', cyber: d.gremlin ? 'Gremlin' : 'Systems locked' }[d.kind];
      if (hudState.disLabel !== label) { hudState.disLabel = label; $('hud-dis-label').textContent = label; }
      const s = Math.max(0, Math.ceil((warn ? d.at : d.until) - S.time));
      const text = `${Math.floor(s / 60)}:${pad2(s % 60)}`;
      if (hudState.dis !== text) { hudState.dis = text; boards.dis.set(text, { align: 'right', stagger: 0, maxSteps: 2 }); }
      $('hud-dis').classList.toggle('urgent', warn && s <= 3);
      $('hud-dis').classList.toggle('closed', !warn);
    }
  }

  const hudName = L => L.name + (L.condition ? ' · ' + CONDITIONS[L.condition].at : '') +
    (L.free ? ' · free play' : '') + (save.calm ? ' · calm skies' : '');
  function setupHud(L) {
    for (const k in hudState) delete hudState[k];
    boards.code.set(L.code, { stagger: 60 });
    $('hud-name').textContent = hudName(L);
    show('hud-wind', !!L.windShift);
    $('hud-landed-label').textContent = L.endless ? 'Landed' : 'Landed / target';
    updateHud();
  }

  const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.85 6.05 6.65.82-4.9 4.58 1.28 6.58L12 17.35 6.12 20.63l1.28-6.58-4.9-4.58 6.65-.82z"/></svg>';
  const stars = (n, cls = '') => `<span class="stars ${cls}">${[0, 1, 2].map(i => `<i class="${i < n ? 'on' : ''}">${STAR}</i>`).join('')}</span>`;

  function rowStamps(L) {
    const n = Object.keys(save.stamps[L.id] || {}).length;
    return n ? `<span class="row-stamps" title="${n} condition stamp${n === 1 ? '' : 's'}">${STAMP_ICON}${n}</span>` : '';
  }
  const STAMP_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/></svg>';

  // Open once the airport before it is cleared, or once it (or any airport
  // after it) has been: inserting a new airport must never close one that a
  // player has already reached.
  function isUnlocked(L) {
    if (L.unlock) return cleared(L.unlock);
    const i = LEVELS.indexOf(L);
    return i === 0 || cleared(LEVELS[i - 1].id) || cleared(L.id) ||
      LEVELS.slice(i + 1).some(later => !later.endless && cleared(later.id));
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
        `<span class="c-rating">${L.endless ? '<span class="best"></span>' : stars(save.stars[L.id] || 0) + rowStamps(L)}</span>` +
        `<span class="lamp ${tone === 'amber' ? 'blink' : ''}"></span>`;
      row.addEventListener('click', () => openBrief(L));
      if (L.endless) row.dataset.endless = '1';
      rows.appendChild(row);
      const delay = i * 70;
      new Flap.Board(row.querySelector('.c-flt'), 2).set(L.endless ? '--' : pad2(i + 1), { delay, maxSteps: 5 });
      new Flap.Board(row.querySelector('.c-name'), 16).set(L.name, { delay: delay + 40, maxSteps: 6, stagger: 18 });
      new Flap.Board(row.querySelector('.c-status'), 8).set(status, { delay: delay + 120, maxSteps: 6, stagger: 18 });
    });
    const total = LEVELS.reduce((s, L) => s + (save.stars[L.id] || 0), 0);
    const max = LEVELS.filter(L => !L.endless).length * 3;
    const stamps = stampsCount();
    $('star-total').innerHTML = `${STAR}<span>${total} / ${max}</span>` +
      (stamps ? `<span class="stamp-total">${stamps} stamp${stamps === 1 ? '' : 's'}</span>` : '');
    $('btn-passport').classList.toggle('dot', !!save.passportNew);
    refreshEndlessRow();
    updateController();
    only('menu');
    if (actx) sfx.rattle();
    askWhoIsPlaying();
  }

  // Once per browser, a guest is asked who's playing: add yourself (on the
  // hub's You page, then straight back) or carry on as a guest.
  function askWhoIsPlaying() {
    if (me() || save.guestOk) return;
    S.screen = 'guest';
    only('guest');
    new Flap.Board($('guest-flaps'), 13).set("Who's playing", { stagger: 30 });
  }
  $('btn-guest-ok').addEventListener('click', () => {
    save.guestOk = true;
    persist();
    S.screen = 'menu';
    only('menu');
  });

  // The Endless row: your best, and the family's best with their face.
  function refreshEndlessRow() {
    const cell = document.querySelector('.row[data-endless] .best');
    if (!cell) return;
    const v = endlessKey();
    const mine = save.bestBy[v] || 0;
    familyBest = (familyBoards[v] || [])[0] || null;
    cell.textContent = mine ? `Best ${mine}` : '';
    if (familyBest && familyBest.best > mine) {
      const fam = document.createElement('span');
      fam.className = 'family-best';
      fam.append(GN.avatar(familyBest.name, 18), ` ${familyBest.best}`);
      fam.title = `Family best: ${familyBest.name}`;
      if (mine) cell.append(' · ');
      cell.append(fam);
    }
  }

  function showEmergencyChoice() {
    for (const b of document.querySelectorAll('#emg-choice button')) {
      b.classList.toggle('on', b.dataset.v === (save.emergencies || 'some'));
    }
  }
  for (const b of document.querySelectorAll('#emg-choice button')) {
    b.addEventListener('click', () => {
      save.emergencies = b.dataset.v;
      persist();
      showEmergencyChoice();
      if (S.level) S.emgTimer = emergencyPlan(S.level) ? emergencyPlan(S.level).first : Infinity;
      refreshEndlessRow();
    });
  }

  function weather(L) {
    const wx = [];
    // Endless shows its emergencies choice just below, so it isn't repeated here.
    if (L.emergencies && L.emergencies !== 'choice') wx.push('Emergencies');
    if (L.disruptions) wx.push('Disruptions');
    if (L.storms) wx.push('Storms');
    if (L.windShift) wx.push('Wind shifts');
    if (L.traffic.fuel < 60) wx.push('Low fuel');
    if (L.theme === 'night') wx.push('Night');
    if (L.theme === 'snow') wx.push('Snow');
    return wx.length ? wx.join(' · ') : 'Clear skies';
  }

  function openBrief(L, cond) {
    L = L.base || L;
    S.briefCond = cond && !conditionLock(L, cond) ? cond : null;
    loadLevel(S.briefCond ? conditionLevel(L, S.briefCond) : L);
    S.screen = 'brief';
    show('hud', false);
    const flt = L.endless ? 'FA∞' : 'FA' + pad2(LEVELS.indexOf(L) + 1);
    // Endless: choose how many emergencies (each has its own leaderboard).
    show('emg-choice', L.emergencies === 'choice');
    showEmergencyChoice();
    $('pass-flight').textContent = flt;
    $('stub-flt').textContent = flt;
    $('pass-code').textContent = L.code;
    $('pass-name').textContent = L.name;
    $('pass-target').textContent = L.endless ? '∞' : L.target;
    $('pass-hint').textContent = L.hint;
    $('stub-wx').textContent = S.briefCond ? CONDITIONS[S.briefCond].wx : weather(L);
    if (S.briefCond) $('pass-hint').textContent = CONDITIONS[S.briefCond].rule;
    show('btn-free', canFree(L) && !S.briefCond);
    showConditions(L);
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

  // The strip of stamps on the boarding pass: Day, then each condition this
  // airport offers. Shown once the airport is cleared.
  function showConditions(L) {
    const strip = $('pass-conds');
    strip.textContent = '';
    const offered = conditionsFor(L);
    const pass = document.querySelector('#brief .pass');
    pass.dataset.cond = S.briefCond || '';
    show('pass-conds', !!offered.length && cleared(L.id));
    if (!offered.length || !cleared(L.id)) return;
    for (const c of [null].concat(offered)) {
      const b = document.createElement('button');
      const lock = c && conditionLock(L, c);
      const got = c && (save.stamps[L.id] || {})[c];
      b.className = 'cond' + ((S.briefCond || null) === c ? ' on' : '') + (lock ? ' locked' : '') + (got ? ' got' : '');
      b.disabled = !!lock;
      b.title = lock || (c ? CONDITIONS[c].rule : 'The airport as usual');
      b.innerHTML = Passport.icon(c || 'day') + `<span>${c ? CONDITIONS[c].name : 'Day'}</span>` +
        (got ? `<i>${'★'.repeat(got.stars)}</i>` : '');
      if (c) b.style.setProperty('--ink', CONDITIONS[c].ink);
      b.addEventListener('click', () => openBrief(L, c));
      strip.appendChild(b);
    }
  }

  // A new stamp lands on the result screen with a thunk.
  function showStamp(L) {
    const el = $('result-stamp');
    el.textContent = '';
    show('result-stamp', !!L);
    if (!L) return;
    const got = save.stamps[L.id][L.condition];
    el.innerHTML = Passport.stamp(L.condition, CONDITIONS[L.condition], L.code, got.at, got.stars, L.id);
    el.classList.remove('thunk'); void el.offsetWidth; el.classList.add('thunk');
    setTimeout(() => { if (actx) sfx.thunk(); buzz(40); }, 380);
  }

  function play() {
    S.screen = 'play';
    S.assisted = !!save.calm;
    S.endlessKey = endlessKey();          // the board this run counts for, fixed at the start
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
    $('result-stars').innerHTML = win && !L.free ? stars(S.lives, 'big') : '';
    $('result-stars').classList.toggle('hidden', !win || !!L.free);
    let text;
    const best = S.assisted ? save.bestCalm : save.bestBy[S.endlessKey || endlessKey()];
    if (L.free && L.endless) text = `You landed ${S.landed}.`;
    else if (L.free && win) text = S.lives === MAX_LIVES ? 'Every arrival down safely.' : `All down, with ${MAX_LIVES - S.lives} diverted.`;
    else if (L.endless) text = `You landed ${S.landed}. ${S.newBest ? 'A new best!' : `Your best is ${best || S.landed}.`}`;
    else if (win && L.condition) text = `Cleared ${CONDITIONS[L.condition].at}${S.lives === MAX_LIVES ? ', every arrival down safely' : `, with ${MAX_LIVES - S.lives} diverted`}. ${S.newStamp ? 'A new stamp for your passport!' : 'Your stamp keeps your best stars.'}`;
    else if (win) text = S.lives === MAX_LIVES ? 'Every arrival down safely. A perfect shift.' : `All down, with ${MAX_LIVES - S.lives} diverted. Fewer diversions earn more stars.`;
    else if (S.outcome === 'crash') text = `Two aircraft got too close. You landed ${S.landed} of ${L.target}.`;
    else text = `Three aircraft diverted. You landed ${S.landed} of ${L.target}.`;
    if (S.medals && !L.free) text += ` ${S.medals === 1 ? 'And a medal' : `And ${S.medals} medals`} for emergencies landed safely.`;
    if (L.free) text += ` Free play: ${freeSummary(L.free).toLowerCase()}.`;
    $('result-text').textContent = text;
    const next = LEVELS[LEVELS.indexOf(L) + 1];
    const canNext = win && !L.free && !L.condition && next && !next.endless && isUnlocked(next);
    show('btn-next', canNext);
    show('btn-result-free', !!L.free);
    showStamp(S.newStamp ? L : null);
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
  // A card over a paused sky, the first time something new happens.
  function explain(title, text) {
    if (S.screen !== 'play') return;
    S.screen = 'explain';
    S.drawing = null;
    $('explain-text').textContent = text;
    only('explain');
    new Flap.Board($('explain-flaps'), title.length).set(title, { stagger: 30 });
  }
  $('btn-explain-ok').addEventListener('click', resume);

  // ---------- free play sheet ----------
  let freeBase = null, freeChoice = null;
  function openFree(L) {
    freeBase = L;
    freeChoice = freeChoices(L);
    const opts = freeOptions(L);
    for (const btn of document.querySelectorAll('#free-types button')) btn.classList.toggle('hidden', !opts.types.includes(btn.dataset.v));
    show('free-types-row', opts.types.length > 1);
    for (const k of ['fuel', 'storms', 'wind', 'emergencies', 'disruptions']) show(`free-${k}-row`, opts[k]);
    $('free-sub').textContent = `${L.name}, your way. Free play earns no stars and never counts on a leaderboard.`;
    if (S.level !== L) loadLevel(L);
    S.screen = 'free';
    only('free');
    new Flap.Board($('free-flaps'), 9).set('Free play', { stagger: 30 });
    showFree();
  }
  function showFree() {
    const c = freeChoice;
    for (const seg of document.querySelectorAll('#free .seg[data-k]')) {
      const k = seg.dataset.k;
      for (const b of seg.querySelectorAll('button')) {
        const v = b.dataset.v;
        const on = k === 'types' ? c.types.includes(v) : String(c[k]) === v;
        b.classList.toggle('on', on);
      }
    }
  }
  for (const seg of document.querySelectorAll('#free .seg[data-k]')) {
    for (const b of seg.querySelectorAll('button')) {
      b.addEventListener('click', () => {
        const k = seg.dataset.k, v = b.dataset.v, c = freeChoice;
        if (k === 'types') {
          const has = c.types.includes(v);
          if (has && c.types.length === 1) return;     // something has to fly
          c.types = has ? c.types.filter(t => t !== v) : c.types.concat([v]);
        } else if (k === 'fuel' || k === 'wind') c[k] = v === 'true';
        else if (k === 'storms') c[k] = +v;
        else c[k] = v;
        save.free = Object.assign({}, save.free, { [freeBase.id]: c });
        persist();
        showFree();
      });
    }
  }
  $('btn-free').addEventListener('click', () => openFree(S.level.base || S.level));
  $('btn-free-back').addEventListener('click', () => openBrief(freeBase));
  $('btn-free-start').addEventListener('click', () => {
    loadLevel(freePlayLevel(freeBase, freeChoice));
    play();
  });
  $('btn-result-free').addEventListener('click', () => openFree(S.level.base || S.level));

  // ---------- the Passport ----------
  // Yours (this device's stamps, merged with your profile's), or someone
  // else's from the records, read-only (the records page links here).
  function passportModel(book, title, readOnly) {
    return {
      title, readOnly, conditions: CONDITIONS,
      airports: LEVELS.filter(L => conditionsFor(L).length).map(L => ({
        id: L.id, code: L.code, name: L.name, offered: conditionsFor(L), got: book[L.id] || {},
        lock: Object.fromEntries(conditionsFor(L).map(c => [c, readOnly ? null : conditionLock(L, c)])),
      })),
    };
  }
  async function openPassport(name, airportId) {
    const mine = me();
    let book = save.stamps, title = mine ? `${mine.name}'s passport` : 'Your passport', readOnly = false;
    if (name && !(mine && GN.fold(mine.name) === GN.fold(name))) {
      readOnly = true; title = `${name}'s passport`; book = {};
      try {
        const data = await (await fetch('/final-approach/api/stats')).json();
        const pl = (data.players || []).find(q => GN.fold(q.name) === GN.fold(name));
        book = (pl && pl.stamps) || {};
      } catch { /* offline: an empty book */ }
    }
    if (S.screen !== 'passport') S.passportFrom = S.screen;
    S.screen = 'passport';
    only('passport');
    const m = passportModel(book, title, readOnly);
    const at = m.airports.findIndex(a => a.id === airportId);
    Passport.open($('passport'), m, at >= 0 ? at + 1 : 0);
    if (!readOnly && save.passportNew) { save.passportNew = false; persist(); $('btn-passport').classList.remove('dot'); }
  }
  function closePassport() {
    if (S.passportFrom === 'result') { S.screen = 'result'; only('result'); }
    else openMenu();
  }
  Passport.bind($('passport'), closePassport);
  $('btn-passport').addEventListener('click', () => openPassport());
  $('result-stamp').addEventListener('click', () => openPassport(null, S.level.id));

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
    $('set-grownup').checked = save.grownUp !== false;
    show('set-grownup-row', grownUpEligible());
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
    save.grownUp = $('set-grownup').checked;
    persist();
    Art.setBoost(save.large ? 1.25 : 1);
    if (S.level) $('hud-name').textContent = hudName(S.level);
    audio(); applyVolumes();
    if (actx && musicWas !== musicOn()) { const name = scape.musicName; scape.musicName = null; setMusic(name); }
  }
  for (const id of ['set-sound', 'set-sfx', 'set-voice', 'set-music', 'set-large', 'set-haptics', 'set-calm', 'set-grownup']) {
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
      else if (S.screen === 'pause' || S.screen === 'explain') resume();
      else if (S.screen === 'settings') closeSettings();
      else if (S.screen === 'free') openBrief(freeBase);
      else if (S.screen === 'passport') closePassport();
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
    restoreFrame(now);
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
    // The records page links to someone's passport: /final-approach/?passport=Louis
    const wanted = new URLSearchParams(location.search).get('passport');
    if (wanted) openPassport(wanted);
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
    emergency: kind => {
      if (kind === 'birdstrike') return birdStrike(true);
      const types = { fire: 'jet', gear: 'jet', hydraulic: 'jet', depress: 'prop', unruly: 'prop' };
      S.emgPending = emergencyChoices().find(([k]) => k === kind) || [kind, types[kind] || null];
      S.emgTimer = 0; S.spawnTimer = 0;
    },
    conditionsFor, conditionLevel, conditionLock, CONDITIONS, landingFor, straightIn, openPassport,
    grownUpOK, endlessKey, freeOptions, freeChoices, freePlayLevel, freeSummary, openFree,
    HOLD_FIXES, isUnlocked, holdingOn, fixNear, holdAt, holdR, stacked, inDrone, planDrone, loadLevel,
    inBalloon, balloonAt, inDisplay, displayLead, corridorPos, shown, restoreSystems, emergencyBusy,
    // Start a disruption now (kind: runway, drone, wave, balloons, display or
    // cyber), as the schedule would. False when it can't (balloons at night).
    disrupt: kind => { S.disTimer = Infinity; return startDisruption(S.level.disruptions || { kinds: DIS_KINDS }, kind); },
    sound: { audio, load, buffers, scape, bus: () => bus } };
})();
