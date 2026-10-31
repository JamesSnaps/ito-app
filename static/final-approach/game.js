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
    const blank = { stars: {}, best: 0, muted: false };
    try { return Object.assign(blank, JSON.parse(localStorage.getItem(SAVE_KEY)) || {}); }
    catch { return blank; }
  })();
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* private mode */ }
  }

  // ---------- sound (tiny WebAudio synth, no assets) ----------
  let actx = null;
  function audio() {
    if (save.muted) return null;
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
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
    o.connect(g).connect(a.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise(dur, vol, freq = 900, type = 'lowpass') {
    const a = audio(); if (!a) return;
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
    const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    src.buffer = buf; f.type = type; f.frequency.value = freq; g.gain.value = vol;
    src.connect(f).connect(g).connect(a.destination);
    src.start();
  }
  let lastFlap = 0;
  const sfx = {
    land:   () => { tone(660, 0.12); tone(990, 0.18, { delay: 0.1 }); },
    lock:   () => tone(760, 0.08, { type: 'triangle', vol: 0.08 }),
    warn:   () => tone(880, 0.08, { type: 'square', vol: 0.04 }),
    spawn:  () => tone(520, 0.1, { type: 'triangle', vol: 0.05 }),
    divert: () => tone(500, 0.4, { type: 'sawtooth', vol: 0.05, slide: -300 }),
    crash:  () => { noise(1, 0.5); tone(140, 0.7, { type: 'sawtooth', vol: 0.12, slide: -90 }); },
    win:    () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { vol: 0.1, delay: i * 0.12 })),
    lose:   () => [392, 330, 262].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.1, delay: i * 0.15 })),
    wind:   () => tone(260, 0.5, { type: 'triangle', vol: 0.08, slide: 240 }),
    flap:   () => {
      if (!actx || save.muted || actx.currentTime - lastFlap < 0.028) return;
      lastFlap = actx.currentTime;
      noise(0.018, 0.09, 2400, 'bandpass');
    },
  };
  Flap.onTick(sfx.flap);
  document.addEventListener('pointerdown', () => audio(), { once: true });

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
      drawing: null, overTimer: 0, outcome: null, warnCooldown: 0,
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
      const arrival = { type, x, y, heading, t: lead, lead };
      const crowded = S.planes.some(p => dist(p.x, p.y, x, y) < 150) ||
                      S.incoming.some(s => dist(s.x, s.y, x, y) < 150);
      if (!crowded) { S.incoming.push(arrival); return true; }
      fallback = fallback || arrival;
    }
    // Crowded is acceptable when nothing better turned up; into a storm never is.
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
    for (const s of S.incoming) if (s.t <= 0) spawnPlane(s);
    S.incoming = S.incoming.filter(s => s.t > 0);

    // wind
    if (L.windShift) {
      S.windTimer -= dt;
      if (!S.windWarned && S.windTimer <= 5) {
        S.windWarned = true;
        toast('Wind shift in 5');
        sfx.wind();
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
      if (wasAirborne && p.alt === 0) S.effects.push({ kind: 'smoke', x: p.x, y: p.y, a: end.angle, t: 0, life: 0.9 });
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
    sfx.divert();
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
  }

  function crash(a, b) {
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
    finish('crash', 1.9);
  }

  function endLevel(outcome) {
    if (outcome === 'win') sfx.win(); else sfx.lose();
    finish(outcome, outcome === 'win' ? 1 : 1.2);
  }

  function finish(outcome, delay) {
    S.outcome = outcome;
    S.screen = 'ending';
    S.overTimer = delay;
    $('btn-pause').disabled = true;
    const L = S.level;
    if (L.endless) {
      S.newBest = S.landed > save.best;
      if (S.newBest) save.best = S.landed;
    } else if (outcome === 'win') {
      save.stars[L.id] = Math.max(save.stars[L.id] || 0, S.lives);
    }
    persist();
    updateHud();
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
        if (S.drawing && S.drawing.plane === p) S.drawing = null;
      }
    }
    toast('Runways reversed');
    sfx.wind();
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
  const endDraw = e => { if (S.drawing && S.drawing.pointerId === e.pointerId) S.drawing = null; };
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
        sfx.lock();
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
    for (const s of S.incoming) Art.incoming(ctx, s, t, TYPES[s.type].color, markerR);
    Art.cloudLayer(ctx, S.sky, false);
    if (S.snow.length) Art.drawSnow(ctx, S.snow);
    for (const e of S.effects) Art.effect(ctx, e);
    Art.vignette(ctx, !!th.night);
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
  const overlays = ['menu', 'brief', 'pause', 'result'];
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
    $('hud-name').textContent = L.name;
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
        `<span class="c-rating">${L.endless ? (save.best ? `<span class="best">Best ${save.best}</span>` : '') : stars(save.stars[L.id] || 0)}</span>` +
        `<span class="lamp ${tone === 'amber' ? 'blink' : ''}"></span>`;
      row.addEventListener('click', () => openBrief(L));
      rows.appendChild(row);
      const delay = i * 70;
      new Flap.Board(row.querySelector('.c-flt'), 2).set(L.endless ? '--' : pad2(L.id), { delay, maxSteps: 5 });
      new Flap.Board(row.querySelector('.c-name'), 16).set(L.name, { delay: delay + 40, maxSteps: 6, stagger: 18 });
      new Flap.Board(row.querySelector('.c-status'), 8).set(status, { delay: delay + 120, maxSteps: 6, stagger: 18 });
    });
    const total = LEVELS.reduce((s, L) => s + (save.stars[L.id] || 0), 0);
    const max = LEVELS.filter(L => !L.endless).length * 3;
    $('star-total').innerHTML = `${STAR}<span>${total} / ${max}</span>`;
    $('btn-mute').textContent = save.muted ? 'Sound off' : 'Sound on';
    only('menu');
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
      label.innerHTML = `<b>${T.name}</b><span><i style="background:${T.color}"></i>${KINDS[T.kind].label}</span>`;
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
    $('btn-pause').disabled = false;
    only(null);
    show('hud', true);
    setupHud(S.level);
    audio();  // unlock audio on this user gesture
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
  $('btn-mute').addEventListener('click', () => {
    save.muted = !save.muted;
    persist();
    $('btn-mute').textContent = save.muted ? 'Sound off' : 'Sound on';
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' || e.key === 'p') {
      if (S.screen === 'play') pause();
      else if (S.screen === 'pause') resume();
    }
  });

  // ---------- main loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt, now / 1000);
    render(now);
    requestAnimationFrame(frame);
  }

  // Runway numbers are painted into the terrain, so wait for the fonts first.
  const fontsReady = document.fonts && document.fonts.load
    ? Promise.all([document.fonts.load('600 20px Oswald'), document.fonts.load('500 16px Barlow')]).catch(() => {})
    : Promise.resolve();
  Promise.race([fontsReady, new Promise(r => setTimeout(r, 2500))]).then(() => {
    resize();
    loadLevel(LEVELS[0]);
    openMenu();
    boards.title.set('Final Approach', { stagger: 45, maxSteps: 10, delay: 200 });
    tickClock();
    setInterval(tickClock, 10000);
    requestAnimationFrame(frame);
  });

  // Exposed for automated tests only.
  window.__finalApproach = { S, LEVELS, runwayEnd, update, queueArrival, clearOfStorms, stormAt };
})();
