// Final Vector's simulation, in real units: nautical miles, feet, knots,
// seconds. x is east and y north of runway 27's threshold; headings are
// degrees from north. No DOM: it runs in the page and under node, where
// tests/test_final_vector.py drives it to check turn rates, ILS capture and
// the conflict alert.
//
// Aircraft fly the instructions they're given and nothing else: a heading,
// an altitude, a speed, cleared ILS (they intercept the localiser only within
// 30° and from below the glideslope, then fly it down by themselves), a hold,
// and contact tower (they leave your frequency). They start to comply a
// couple of seconds after the readback, as pilots do.
(function (root) {
  'use strict';
  const FV = root.FV = root.FV || {};

  // ---------- the training airport ----------
  // Ambleford: fictional, one runway, two stacks, light traffic. The whole
  // Academy happens here.
  const World = {
    name: 'Ambleford',
    position: 'Ambleford Approach',
    code: 'AMB',
    runway: '27',
    course: 270,                 // the localiser, inbound
    length: 1.4,                 // runway, nm (threshold at 0,0, running west)
    gsFeet: 318,                 // a 3° glideslope: 318 ft per nm
    tch: 50,                     // crossing the threshold at 50 ft
    qnh: 1013,
    wind: { from: 260, kt: 8 },
    msa: 2000,                   // lowest altitude you may give
    ceiling: 15000,              // the approach's top
    sep: { nm: 3, ft: 1000 },
    stcaAhead: 60,               // the short-term conflict alert looks this far ahead
    handoffBy: 7.5,              // "by about 8 miles"
    handoffLate: 4,              // later than this and the tower never heard of them
    // Holding stacks: a fix, the inbound course and right-hand turns.
    fixes: {
      DNK: { name: 'Dunnock', x: 21, y: 12, inbound: 250 },
      LNT: { name: 'Linnet', x: 21, y: -12, inbound: 290 },
    },
    // Arrival routes into the stacks, from the sector's edge.
    routes: {
      DNK: [[44, 22], [33, 17], [21, 12]],
      LNT: [[44, -22], [33, -17], [21, -12]],
    },
    // The sector's edge (an aircraft out past it has left your airspace).
    sector: [[-10, 15], [8, 24], [46, 24], [46, -24], [8, -24], [-10, -15]],
    stackBase: 7000,             // the lowest holding level, FL70
  };
  World.gsAlt = d => World.tch + d * World.gsFeet;

  // ---------- aircraft types ----------
  // turn °/s; climb and descent ft/min; speeds kt (vmin..vmax is what you may
  // give, vapp what they fly on final); accel/decel kt/s. A heavy turns,
  // slows and descends like a heavy.
  const TYPES = {
    A320: { wake: 'M', turn: 3.0, climb: 2200, descent: 1800, vmin: 160, vmax: 250, vapp: 140, accel: 1.4, decel: 0.8 },
    B738: { wake: 'M', turn: 3.0, climb: 2200, descent: 1800, vmin: 160, vmax: 250, vapp: 145, accel: 1.4, decel: 0.8 },
    E190: { wake: 'M', turn: 3.0, climb: 2400, descent: 1900, vmin: 150, vmax: 250, vapp: 135, accel: 1.5, decel: 0.9 },
    DH8D: { wake: 'M', turn: 3.0, climb: 1800, descent: 1500, vmin: 140, vmax: 240, vapp: 125, accel: 1.6, decel: 1.1 },
    B77W: { wake: 'H', turn: 2.5, climb: 1800, descent: 1600, vmin: 170, vmax: 250, vapp: 150, accel: 1.0, decel: 0.6 },
    A333: { wake: 'H', turn: 2.6, climb: 1900, descent: 1700, vmin: 170, vmax: 250, vapp: 140, accel: 1.0, decel: 0.6 },
    BE20: { wake: 'L', turn: 3.0, climb: 1800, descent: 1500, vmin: 120, vmax: 220, vapp: 110, accel: 1.8, decel: 1.2 },
  };

  // ---------- geometry ----------
  const RAD = Math.PI / 180;
  const norm = h => ((h % 360) + 360) % 360;
  const hdgOut = h => { const n = Math.round(norm(h)); return n === 0 ? 360 : n; };
  const diff = (to, from) => ((to - from) % 360 + 540) % 360 - 180;     // -180..180, + is right
  const bearing = (x1, y1, x2, y2) => norm(Math.atan2(x2 - x1, y2 - y1) / RAD);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const inside = (pts, x, y) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const tas = (ias, alt) => ias * (1 + alt / 1000 * 0.017);
  // Ground speed along the heading: true airspeed less the headwind. (The
  // wind doesn't drift aircraft sideways here: simplified where it doesn't
  // change the job.)
  const groundSpeed = (ac, wind = World.wind) => tas(ac.ias, ac.alt) - wind.kt * Math.cos((ac.hdg - wind.from) * RAD);

  const STEP = 0.25;            // seconds per simulation step
  const RESPOND = 2.5;          // seconds before a pilot starts to comply
  const TRAIL_EVERY = 4;        // a history dot every radar sweep

  function create(opts = {}) {
    const sim = {
      t: 0, aircraft: [], events: [], conflicts: [], pairs: {},
      wind: opts.wind || World.wind,
      stats: { losses: 0, alerts: 0, onTime: 0, late: 0, missed: 0, through: 0, landed: 0, left: 0, delays: [] },
      spawn, step, instruct, find, check, predict, World, TYPES,
    };
    let acc = 0;

    function emit(kind, data) { sim.events.push(Object.assign({ kind, t: sim.t }, data)); }
    function find(cs) { return sim.aircraft.find(a => a.cs === cs) || null; }

    // spec: {cs, type, x, y, hdg, alt, cfl, ias, spd, route: 'DNK', mode, freq, voice}
    function spawn(spec) {
      const T = TYPES[spec.type];
      const ac = {
        cs: spec.cs, type: spec.type, wake: T.wake, T,
        x: spec.x, y: spec.y, hdg: spec.hdg != null ? spec.hdg : 270, alt: spec.alt, ias: spec.ias || 250,
        vs: 0, cfl: spec.cfl != null ? spec.cfl : spec.alt, spd: spec.spd || spec.ias || 250,
        thdg: null, dir: null, mode: spec.mode || 'hdg', route: null, leg: 0, hold: null,
        ils: false, loc: false, gs: false, freq: spec.freq || 'mine', state: 'air',
        trail: [], trailT: 0, pending: [], born: sim.t, voice: spec.voice || 0, runway: World.runway,
        thru: false, entry: spec.entry || null, nominal: 0,
      };
      if (spec.route) {
        ac.mode = 'route'; ac.route = World.routes[spec.route].slice(); ac.entry = spec.route;
        ac.leg = 1;
        ac.hdg = bearing(ac.x, ac.y, ac.route[1][0], ac.route[1][1]);
      }
      // What an unhindered arrival would take from here to the threshold:
      // the basis of "delay" in the debrief.
      const via = spec.route ? World.fixes[spec.route] : { x: ac.x, y: ac.y };
      const track = Math.hypot(ac.x - via.x, ac.y - via.y) + Math.hypot(via.x - 12, via.y) + 12;
      ac.nominal = track / 210 * 3600;
      sim.aircraft.push(ac);
      return ac;
    }

    // An instruction: validated against what this type can do (the pilot
    // says "unable" otherwise, and nothing changes). → {ok, unable?, error?}
    function instruct(cs, cmds, { delay = RESPOND } = {}) {
      const ac = find(cs);
      if (!ac || ac.state !== 'air') return { ok: false, error: `${cs} isn't on your frequency.` };
      if (ac.freq !== 'mine') return { ok: false, error: `${cs} is with the tower now.` };
      for (const c of cmds) {
        if (c.t === 'alt') {
          if (c.ft < World.msa) return { ok: false, unable: c, error: `${c.ft.toLocaleString('en-GB')} ft is below the minimum, ${World.msa.toLocaleString('en-GB')} ft.` };
          if (c.ft > World.ceiling) return { ok: false, unable: c, error: `That's above the approach (${World.ceiling / 100 | 0} is the top).` };
          if (c.verb === 'D' && c.ft > ac.alt + 50) return { ok: false, error: `${cs} is below ${c.ft.toLocaleString('en-GB')} ft: that's a climb.` };
          if (c.verb === 'C' && c.ft < ac.alt - 50) return { ok: false, error: `${cs} is above ${c.ft.toLocaleString('en-GB')} ft: that's a descent.` };
        }
        if (c.t === 'spd' && (c.kt < ac.T.vmin || c.kt > ac.T.vmax)) return { ok: false, unable: c, error: `${cs} is a${/^[AE]/.test(ac.type) ? 'n' : ''} ${ac.type}: ${ac.T.vmin} to ${ac.T.vmax} knots here.` };
        if (c.t === 'twr' && !ac.loc) return { ok: false, error: `Hand ${cs} to the tower once it's established on the localiser.` };
        if (c.t === 'hold' && !World.fixes[c.fix]) return { ok: false, error: `No fix ${c.fix}.` };
      }
      // What the strip and tag show changes now (the controller writes it
      // down as it's said); the aircraft follows a moment later.
      for (const c of cmds) {
        if (c.t === 'alt') ac.cfl = c.ft;
        if (c.t === 'spd') ac.spd = c.kt;
        if (c.t === 'hdg') { ac.shownHdg = c.hdg; }
        if (c.t === 'ils') ac.ils = true;
        if (c.t === 'twr') handoff(ac);
      }
      ac.pending.push({ at: sim.t + delay, cmds });
      return { ok: true };
    }

    function comply(ac, cmds) {
      for (const c of cmds) {
        if (c.t === 'hdg') {
          // A heading takes it off the approach and out of any hold.
          if (ac.loc) { ac.loc = false; ac.gs = false; ac.ils = false; }
          ac.mode = 'hdg'; ac.hold = null; ac.route = null;
          ac.thdg = c.hdg; ac.dir = c.dir || null;
          if (!ac.dir && Math.abs(diff(c.hdg, ac.hdg)) < 0.5) ac.thdg = null;
        }
        if (c.t === 'alt') {
          if (ac.gs) { ac.gs = false; ac.loc = false; ac.ils = false; ac.mode = 'hdg'; ac.thdg = null; }
          ac.cfl = c.ft;
        }
        if (c.t === 'spd') ac.spd = c.kt;
        if (c.t === 'ils') ac.ils = true;
        if (c.t === 'hold') {
          ac.mode = 'hold'; ac.route = null; ac.loc = false; ac.ils = false; ac.gs = false;
          ac.hold = { fix: c.fix, phase: 'to', timer: 0 };
        }
      }
      ac.shownHdg = null;
    }

    function handoff(ac) {
      const d = ac.x;
      ac.freq = 'tower';
      if (d >= World.handoffBy) { sim.stats.onTime++; emit('handoff', { cs: ac.cs, d, on: 'time' }); }
      else { sim.stats.late++; emit('handoff', { cs: ac.cs, d, on: 'late' }); }
    }

    // ---------- flying ----------
    function turnToward(ac, target, dir, dt) {
      const rate = ac.T.turn * dt;
      let d = diff(target, ac.hdg);
      if (dir === 'L' && d > 0.01) d -= 360;
      if (dir === 'R' && d < -0.01) d += 360;
      if (Math.abs(d) <= rate) { ac.hdg = norm(target); return true; }
      ac.hdg = norm(ac.hdg + Math.sign(d) * rate);
      return false;
    }

    function lateral(ac, dt) {
      if (ac.mode === 'loc') {
        // Track the centreline: aim back at it, at most 30° off.
        const want = World.course - Math.max(-30, Math.min(30, ac.y * 45));
        turnToward(ac, want, null, dt);
        return;
      }
      if (ac.mode === 'route' && ac.route) {
        const [px, py] = ac.route[ac.leg];
        if (Math.hypot(px - ac.x, py - ac.y) < 1.2) {
          if (ac.leg < ac.route.length - 1) ac.leg++;
          else {
            // Reached the stack with no instruction: hold there.
            const fix = Object.keys(World.fixes).find(k => World.fixes[k].x === px && World.fixes[k].y === py);
            ac.mode = 'hold'; ac.route = null;
            ac.hold = { fix, phase: 'to', timer: 0 };
            emit('hold', { cs: ac.cs, fix });
          }
        }
        if (ac.route) { turnToward(ac, bearing(ac.x, ac.y, ac.route[ac.leg][0], ac.route[ac.leg][1]), null, dt); return; }
      }
      if (ac.mode === 'hold' && ac.hold) {
        const h = ac.hold, f = World.fixes[h.fix];
        if (h.phase === 'to') {
          turnToward(ac, bearing(ac.x, ac.y, f.x, f.y), null, dt);
          if (Math.hypot(f.x - ac.x, f.y - ac.y) < 0.5) { h.phase = 'out'; h.timer = 75; if (!h.joined) { h.joined = true; emit('held', { cs: ac.cs, fix: h.fix }); } }
        } else if (h.phase === 'out') {
          turnToward(ac, norm(f.inbound + 180), 'R', dt);
          h.timer -= dt;
          if (h.timer <= 0) h.phase = 'back';
        } else if (turnToward(ac, bearing(ac.x, ac.y, f.x, f.y), 'R', dt)) h.phase = 'to';
        return;
      }
      if (ac.thdg != null && turnToward(ac, ac.thdg, ac.dir, dt)) { ac.thdg = null; ac.dir = null; }
    }

    // Cleared ILS and not yet on it: capture when the turn onto the
    // localiser should begin, if the cut is 30° or less and it's below the
    // glideslope. Otherwise it flies straight through.
    function intercept(ac, prevY) {
      if (!ac.ils || ac.loc || ac.x < 1 || ac.x > 25) { if (Math.abs(ac.y) > 1.5) ac.thru = false; return; }
      const vy = Math.cos(ac.hdg * RAD);
      const cut = Math.abs(diff(ac.hdg, World.course));
      const converging = ac.y * vy < 0 && cut < 90;
      const radius = tas(ac.ias, ac.alt) / 3600 / (ac.T.turn * RAD);
      const lead = radius * (1 - Math.cos(Math.min(cut, 90) * RAD)) + 0.03;
      const crossed = prevY !== null && Math.sign(prevY) !== Math.sign(ac.y) && prevY !== 0;
      if ((converging && Math.abs(ac.y) <= lead) || crossed) {
        const high = ac.alt > World.gsAlt(ac.x) + 150;
        if (cut <= 30.5 && !high && Math.abs(ac.y) < 1) {
          ac.loc = true; ac.mode = 'loc'; ac.thdg = null; ac.dir = null; ac.thru = false;
          emit('established', { cs: ac.cs, d: ac.x, cut: Math.round(cut) });
        } else if (!ac.thru) {
          ac.thru = true;
          sim.stats.through++;
          emit('through', { cs: ac.cs, cut: Math.round(cut), high, d: ac.x });
        }
      }
      if (Math.abs(ac.y) > 1.5 || ac.y * vy > 0) { if (!crossed && Math.abs(ac.y) > 1.5) ac.thru = false; }
    }

    function vertical(ac, dt) {
      let target = ac.cfl;
      if (ac.loc) {
        const g = World.gsAlt(Math.max(0, ac.x));
        if (!ac.gs && ac.alt >= g - 30) { ac.gs = true; emit('glideslope', { cs: ac.cs, d: ac.x }); }
        if (ac.gs) {
          const before = ac.alt;
          ac.alt = Math.min(ac.alt, g);
          ac.vs = (ac.alt - before) / dt * 60;
          return;
        }
      }
      const delta = target - ac.alt;
      const max = delta < 0 ? ac.T.descent : ac.T.climb;
      // Ease the last few hundred feet, as an autopilot levels off.
      const want = Math.sign(delta) * Math.min(max, Math.abs(delta) * 6 + 150);
      ac.vs += Math.max(-600 * dt, Math.min(600 * dt, want - ac.vs));
      if (Math.abs(delta) < 5) { ac.alt = target; ac.vs = 0; return; }
      const move = ac.vs / 60 * dt;
      ac.alt = Math.abs(move) >= Math.abs(delta) && Math.sign(move) === Math.sign(delta) ? target : ac.alt + move;
    }

    function speedStep(ac, dt) {
      let target = ac.spd;
      // Established on the glideslope and inside 6 miles, pilots slow to
      // their approach speed by themselves.
      if (ac.gs && ac.x < 6) target = Math.min(target, ac.T.vapp + Math.max(0, ac.x - 3) * 8);
      if (ac.alt < 10000 && target > 250) target = 250;
      const d = target - ac.ias;
      const rate = d > 0 ? ac.T.accel : ac.T.decel * (ac.vs < -500 ? 0.55 : 1);
      ac.ias = Math.abs(d) <= rate * dt ? target : ac.ias + Math.sign(d) * rate * dt;
    }

    function fly(ac, dt) {
      while (ac.pending.length && ac.pending[0].at <= sim.t) comply(ac, ac.pending.shift().cmds);
      const prevY = ac.y;
      lateral(ac, dt);
      vertical(ac, dt);
      speedStep(ac, dt);
      const gs = groundSpeed(ac, sim.wind);
      ac.gsKt = gs;
      ac.x += Math.sin(ac.hdg * RAD) * gs / 3600 * dt;
      ac.y += Math.cos(ac.hdg * RAD) * gs / 3600 * dt;
      intercept(ac, prevY);
      ac.trailT += dt;
      if (ac.trailT >= TRAIL_EVERY) {
        ac.trailT = 0;
        ac.trail.unshift([ac.x, ac.y]);
        ac.trail.length = Math.min(ac.trail.length, 6);
      }
      // Still yours inside 4 miles: the tower never heard of it.
      if (ac.loc && ac.freq === 'mine' && ac.x < World.handoffLate) {
        ac.freq = 'tower';
        sim.stats.missed++;
        emit('missed', { cs: ac.cs, d: ac.x });
      }
      if (ac.loc && ac.x <= 0) {
        ac.state = 'landed';
        sim.stats.landed++;
        const delay = Math.max(0, sim.t - ac.born - ac.nominal);
        sim.stats.delays.push(delay);
        emit('landed', { cs: ac.cs, delay });
      } else if (!inside(World.sector, ac.x, ac.y)) {
        ac.state = 'gone';
        sim.stats.left++;
        emit('left', { cs: ac.cs });
      }
    }

    // ---------- separation ----------
    // Where an aircraft will be in `secs`: straight on along its heading, its
    // altitude moving toward the cleared level at the rate it has now (at
    // least the type's usual rate once it's on its way). Turns aren't
    // predicted: the alert is about what happens if nothing changes.
    function predict(ac, secs) {
      const gs = ac.gsKt || groundSpeed(ac, sim.wind);
      const x = ac.x + Math.sin(ac.hdg * RAD) * gs / 3600 * secs;
      const y = ac.y + Math.cos(ac.hdg * RAD) * gs / 3600 * secs;
      let alt;
      if (ac.gs) alt = World.gsAlt(Math.max(0, ac.x - gs / 3600 * secs));
      else {
        const target = ac.cfl, d = target - ac.alt;
        const rate = Math.max(Math.abs(ac.vs), Math.abs(d) > 100 ? 0.6 * (d < 0 ? ac.T.descent : ac.T.climb) : 0);
        alt = ac.alt + Math.sign(d) * Math.min(Math.abs(d), rate / 60 * secs);
      }
      return { x, y, alt };
    }
    const lost = (h, v) => h < World.sep.nm - 1e-6 && v < World.sep.ft - 25;

    function check() {
      const live = sim.aircraft.filter(a => a.state === 'air');
      const now = [];
      const seen = new Set();
      for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) {
          const a = live[i], b = live[j];
          const key = [a.cs, b.cs].sort().join('|');
          const h = dist(a, b), v = Math.abs(a.alt - b.alt);
          let kind = null, inT = 0;
          if (lost(h, v)) kind = 'los';
          else if (h < 12) {
            for (let s = 5; s <= World.stcaAhead; s += 5) {
              const pa = predict(a, s), pb = predict(b, s);
              if (lost(Math.hypot(pa.x - pb.x, pa.y - pb.y), Math.abs(pa.alt - pb.alt))) { kind = 'stca'; inT = s; break; }
            }
          }
          const was = sim.pairs[key];
          if (kind) {
            seen.add(key);
            now.push({ a: a.cs, b: b.cs, kind, h, v, inT, key });
            if (kind === 'los' && (!was || !was.los)) {
              sim.stats.losses++;
              emit('los', { a: a.cs, b: b.cs, h, v });
            }
            if (!was) {
              if (kind === 'stca') { sim.stats.alerts++; emit('stca', { a: a.cs, b: b.cs, h, v, inT }); }
              sim.pairs[key] = { since: sim.t, los: kind === 'los', alerted: kind === 'stca' };
            } else if (kind === 'los') was.los = true;
          }
        }
      }
      for (const key of Object.keys(sim.pairs)) {
        if (!seen.has(key)) { emit('clear', { key, los: sim.pairs[key].los }); delete sim.pairs[key]; }
      }
      sim.conflicts = now;
    }

    function step(seconds) {
      acc += seconds;
      while (acc >= STEP - 1e-9) {
        acc -= STEP;
        sim.t += STEP;
        for (const ac of sim.aircraft) if (ac.state === 'air') fly(ac, STEP);
        sim.aircraft = sim.aircraft.filter(a => a.state === 'air' || sim.t - (a.endT || (a.endT = sim.t)) < 2);
        check();
      }
    }

    return sim;
  }

  FV.World = World;
  FV.TYPES = TYPES;
  FV.Sim = { create, diff, norm, hdgOut, bearing, groundSpeed, tas, inside, STEP, RESPOND };
  if (typeof module !== 'undefined' && module.exports) module.exports = { World, TYPES, Sim: FV.Sim };
})(typeof window !== 'undefined' ? window : globalThis);
