// All drawing that isn't UI: the painted landscape (rendered once per level/resize),
// aircraft sprites (rendered once, then stamped), and the live layers on top.
const Art = (() => {
  'use strict';

  const W = 960, H = 600;
  const TAU = Math.PI * 2;
  const SPR = 4;  // sprite supersampling

  const COLORS = {
    prop:  { main: '#f2b632', dark: '#946510', light: '#ffdc84' },
    jet:   { main: '#e8553f', dark: '#8c2a1c', light: '#ffa189' },
    heavy: { main: '#e8553f', dark: '#8c2a1c', light: '#ffa189' },
    heli:  { main: '#3d9be0', dark: '#1a5687', light: '#93d2ff' },
  };
  const PARKED = { main: '#ebe8e1', dark: '#9b9892', light: '#ffffff' };
  const INK = '#1e262c';
  const PAINT = '#f2efe6';
  const FONT = 'Oswald, "Arial Narrow", sans-serif';

  // ---------- helpers ----------
  function mulberry32(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const canvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    return c;
  };
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    return dist(px, py, ax + dx * t, ay + dy * t);
  }
  function poly(c, pts, mirror) {
    for (const sign of mirror ? [1, -1] : [1]) {
      c.moveTo(pts[0][0], pts[0][1] * sign);
      for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1] * sign);
      c.closePath();
    }
  }
  function rrect(c, x, y, w, h, r) {
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function smoothLine(c, pts) {
    c.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      c.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
    }
    const l = pts[pts.length - 1];
    c.lineTo(l.x, l.y);
  }
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function rwGeom(r) {
    const a = r.angle * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
    return {
      a, ux, uy, nx: -uy, ny: ux, x: r.x, y: r.y, len: r.length,
      ex: r.x + ux * r.length, ey: r.y + uy * r.length, w: r.kind === 'long' ? 22 : 16,
    };
  }
  const shoreX = y => 862 + Math.sin(y / 47) * 14 + Math.sin(y / 13) * 4;

  // ---------- aircraft ----------
  function tube(c, w, col) {
    const g = c.createLinearGradient(0, -w, 0, w);
    g.addColorStop(0, col.dark); g.addColorStop(0.22, col.light); g.addColorStop(0.5, col.main);
    g.addColorStop(0.85, col.dark); g.addColorStop(1, col.dark);
    return g;
  }
  function fuselage(c, nose, tail, w, tailW) {
    c.beginPath();
    c.moveTo(nose, 0);
    c.bezierCurveTo(nose, -w * 0.95, nose - w * 1.4, -w, nose - w * 2.6, -w);
    c.lineTo(-tail * 0.4, -w);
    c.quadraticCurveTo(-tail * 0.85, -w * 0.85, -tail, -tailW);
    c.lineTo(-tail, tailW);
    c.quadraticCurveTo(-tail * 0.85, w * 0.85, -tail * 0.4, w);
    c.lineTo(nose - w * 2.6, w);
    c.bezierCurveTo(nose - w * 1.4, w, nose, w * 0.95, nose, 0);
    c.closePath();
  }

  // Each body draws facing +x, centred, in world units. `sil` = flat black silhouette (for shadows).
  function drawJet(c, col, heavy, sil) {
    const f = s => (sil ? '#000' : s);
    const fw = heavy ? 3.7 : 3.1;
    // wings
    c.beginPath(); poly(c, [[5, 2.2], [-5.5, 17], [-9.6, 17.6], [-6.8, 2.2]], true);
    c.fillStyle = f(col.main); c.fill();
    if (!sil) {
      c.strokeStyle = col.dark; c.lineWidth = 0.9;
      c.beginPath(); poly(c, [[-6.6, 3], [-9.3, 17]], true); c.stroke();
      c.strokeStyle = hexA('#ffffff', 0.45); c.lineWidth = 0.7;
      c.beginPath(); c.moveTo(4.6, -2.6); c.lineTo(-5.2, -16.6); c.moveTo(4.6, 2.6); c.lineTo(-5.2, 16.6); c.stroke();
    }
    // engines
    const pods = heavy ? [[2, 7.2], [-3.4, 12.4]] : [[0.8, 7.6]];
    for (const [x, y] of pods) {
      for (const s of [1, -1]) {
        c.beginPath(); c.ellipse(x, y * s, 3.4, 1.45, 0, 0, TAU);
        c.fillStyle = f(col.dark); c.fill();
        if (!sil) { c.beginPath(); c.ellipse(x + 3, y * s, 0.6, 1.1, 0, 0, TAU); c.fillStyle = '#2a2f33'; c.fill(); }
      }
    }
    // tailplane
    c.beginPath(); poly(c, [[-11, 1.4], [-15.2, 7.6], [-17.6, 7.9], [-16.3, 1.2]], true);
    c.fillStyle = f(col.main); c.fill();
    // fuselage
    fuselage(c, 17.5, 17.5, fw, 0.9);
    c.fillStyle = sil ? '#000' : tube(c, fw, col); c.fill();
    if (sil) return;
    if (heavy) {
      c.fillStyle = hexA('#ffffff', 0.85);
      c.fillRect(-13, -fw * 0.42, 25, fw * 0.4);
    }
    // fin seen from above
    c.beginPath(); c.moveTo(-8.5, 0); c.lineTo(-17.8, -0.7); c.lineTo(-17.8, 0.7); c.closePath();
    c.fillStyle = col.dark; c.fill();
    // windscreen
    c.beginPath();
    c.moveTo(14.6, -fw * 0.62); c.quadraticCurveTo(16.6, 0, 14.6, fw * 0.62);
    c.lineTo(13.6, fw * 0.5); c.quadraticCurveTo(15.2, 0, 13.6, -fw * 0.5); c.closePath();
    c.fillStyle = '#1d2a33'; c.fill();
  }

  function drawProp(c, col, sil) {
    const f = s => (sil ? '#000' : s);
    c.beginPath(); poly(c, [[-8.4, 1], [-9.2, 6.4], [-12, 6.4], [-12, 1]], true);
    c.fillStyle = f(col.main); c.fill();
    fuselage(c, 11, 12, 2.5, 0.7);
    c.fillStyle = sil ? '#000' : tube(c, 2.5, col); c.fill();
    if (!sil) {
      c.beginPath(); c.moveTo(6.2, -1.7); c.quadraticCurveTo(7.8, 0, 6.2, 1.7); c.lineTo(5.3, 1.4); c.quadraticCurveTo(6.6, 0, 5.3, -1.4); c.closePath();
      c.fillStyle = '#1d2a33'; c.fill();
    }
    // high wing over the fuselage
    c.beginPath(); rrect(c, -2.4, -16, 6.2, 32, 2.2);
    if (sil) c.fillStyle = '#000';
    else {
      const g = c.createLinearGradient(3.8, 0, -2.4, 0);
      g.addColorStop(0, col.light); g.addColorStop(0.35, col.main); g.addColorStop(1, col.dark);
      c.fillStyle = g;
    }
    c.fill();
    if (sil) return;
    c.fillStyle = hexA('#ffffff', 0.7);
    c.fillRect(-2.4, -12.6, 6.2, 1.3); c.fillRect(-2.4, 11.3, 6.2, 1.3);
    c.beginPath(); c.ellipse(9.8, 0, 1.6, 2, 0, 0, TAU); c.fillStyle = col.dark; c.fill();
  }

  function drawHeli(c, col, sil) {
    const f = s => (sil ? '#000' : s);
    c.strokeStyle = f('#3b4247'); c.lineWidth = 1.1;
    c.beginPath();
    for (const s of [1, -1]) {
      c.moveTo(-5, 6.4 * s); c.lineTo(7.5, 6.4 * s);
      c.moveTo(-2, 6.4 * s); c.lineTo(-2, 3 * s);
      c.moveTo(4.5, 6.4 * s); c.lineTo(4.5, 3 * s);
    }
    c.stroke();
    c.beginPath(); c.moveTo(-3, -2); c.lineTo(-19, -0.9); c.lineTo(-19, 0.9); c.lineTo(-3, 2); c.closePath();
    c.fillStyle = sil ? '#000' : tube(c, 2, col); c.fill();
    c.beginPath(); rrect(c, -18.3, -4, 2.4, 8, 0.8); c.fillStyle = f(col.dark); c.fill();
    c.beginPath(); c.ellipse(1.5, 0, 8.8, 6.3, 0, 0, TAU);
    c.fillStyle = sil ? '#000' : tube(c, 6.3, col); c.fill();
    if (sil) return;
    c.beginPath(); rrect(c, -4.5, -2.6, 6.5, 5.2, 1.6); c.fillStyle = hexA(col.dark, 0.55); c.fill();
    const g = c.createLinearGradient(3, -4.6, 9, 4.6);
    g.addColorStop(0, '#5f8fb0'); g.addColorStop(1, '#1d3446');
    c.beginPath(); c.ellipse(6.2, 0, 4.1, 4.7, 0, -1.45, 1.45); c.closePath(); c.fillStyle = g; c.fill();
    c.beginPath(); c.ellipse(7.2, -1.8, 1.5, 0.8, -0.5, 0, TAU); c.fillStyle = hexA('#ffffff', 0.45); c.fill();
  }

  function drawBody(c, type, mode) {
    const sil = mode === 'sil';
    const col = mode === 'parked' ? PARKED : COLORS[type];
    if (type === 'heavy') { c.save(); c.scale(1.35, 1.35); drawJet(c, col, true, sil); c.restore(); }
    else if (type === 'jet') drawJet(c, col, false, sil);
    else if (type === 'prop') drawProp(c, col, sil);
    else drawHeli(c, col, sil);
  }

  const sprites = {};
  function sprite(type, mode) {
    const key = type + ':' + mode;
    if (sprites[key]) return sprites[key];
    const box = type === 'heavy' ? 64 : 48;
    const cv = canvas(box * SPR, box * SPR);
    const c = cv.getContext('2d');
    c.scale(SPR, SPR);
    c.translate(box / 2, box / 2);
    if (mode === 'shadow') {
      // draw far off-canvas and let the blurred shadow land in frame
      c.shadowColor = '#000';
      c.shadowBlur = 2.2 * SPR;
      c.shadowOffsetX = 1000 * SPR;
      c.translate(-1000, 0);
      drawBody(c, type, 'sil');
    } else {
      drawBody(c, type, mode);
    }
    return (sprites[key] = { cv, box });
  }
  function stamp(ctx, spr, x, y, rot, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const b = spr.box * scale;
    ctx.drawImage(spr.cv, -b / 2, -b / 2, b, b);
    ctx.restore();
  }

  // "Large aircraft" (a setting): draw everything flying a quarter bigger.
  // Drawing only; separation distances don't change.
  let boost = 1;
  function setBoost(k) { boost = k; }

  function aircraftShadow(ctx, p) {
    const alt = p.alt == null ? 1 : p.alt;
    ctx.save();
    ctx.globalAlpha = (p.alpha == null ? 1 : p.alpha) * (0.2 + 0.12 * (1 - alt));
    stamp(ctx, sprite(p.type, 'shadow'), p.x + 9 * alt + 1, p.y + 12 * alt + 1, p.rot, (p.scale || 1) * boost * (1 - 0.08 * alt));
    ctx.restore();
  }

  function aircraft(ctx, p, t, night) {
    const s = (p.scale || 1) * boost;
    ctx.save();
    ctx.globalAlpha = p.alpha == null ? 1 : p.alpha;
    stamp(ctx, sprite(p.type, 'body'), p.x, p.y, p.rot, s);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.scale(s, s);
    const k = p.type === 'heavy' ? 1.35 : 1;
    if (p.type === 'prop') {
      ctx.fillStyle = 'rgba(25,30,35,0.16)';
      ctx.beginPath(); ctx.ellipse(11.8, 0, 1, 7.2, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(25,30,35,0.7)'; ctx.lineWidth = 1.1;
      const a = p.t * 40;
      ctx.beginPath(); ctx.moveTo(11.8, Math.cos(a) * 7); ctx.lineTo(11.8, -Math.cos(a) * 7); ctx.stroke();
    } else if (p.type === 'heli') {
      ctx.fillStyle = 'rgba(25,30,35,0.09)';
      ctx.beginPath(); ctx.arc(0.5, 0, 17.5, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(25,30,35,0.55)'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
      const a = p.t * 22;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const b = a + i * Math.PI / 2;
        ctx.moveTo(0.5, 0); ctx.lineTo(0.5 + Math.cos(b) * 17, Math.sin(b) * 17);
      }
      ctx.stroke();
      ctx.fillStyle = '#2b3136'; ctx.beginPath(); ctx.arc(0.5, 0, 1.6, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(25,30,35,0.18)'; ctx.beginPath(); ctx.ellipse(-17.2, 4.2, 3.4, 0.9, 0, 0, TAU); ctx.fill();
    }
    // navigation lights: red port, green starboard, white strobe
    const tip = p.type === 'prop' ? [0.8, 16.2] : p.type === 'heli' ? null : [-9.4 * k, 17.6 * k];
    const strobe = (p.t * 1.3 + p.id * 0.37) % 1 < 0.08;
    const glow = night ? 3.2 : 1.6;
    const light = (x, y, color, r) => {
      if (night) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.5);
        g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 3.5, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    };
    if (tip) {
      light(tip[0], -tip[1], '#ff4b3e', 0.9);
      light(tip[0], tip[1], '#4dff7a', 0.9);
    }
    if (strobe) light(p.type === 'heli' ? -18 : -17 * k, 0, '#ffffff', glow * 0.7);
    ctx.restore();
  }

  function icon(type, size) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cv = canvas(size * dpr, size * dpr);
    cv.style.width = cv.style.height = size + 'px';
    const c = cv.getContext('2d');
    const spr = sprite(type, 'body'), sh = sprite(type, 'shadow');
    const k = (size * dpr) / (type === 'heavy' ? 54 : 42);
    c.translate(size * dpr / 2, size * dpr / 2);
    c.rotate(-Math.PI / 2);
    c.globalAlpha = 0.3;
    c.drawImage(sh.cv, -sh.box * k / 2 - 2 * k, -sh.box * k / 2 + 3 * k, sh.box * k, sh.box * k);
    c.globalAlpha = 1;
    c.drawImage(spr.cv, -spr.box * k / 2, -spr.box * k / 2, spr.box * k, spr.box * k);
    return cv;
  }

  // ---------- landscape ----------
  // The airspace is always 0..W x 0..H. The painting can run further, to fill
  // a screen that's wider or taller than it: B is the painted area. Anything
  // outside the airspace uses its own random sequence (brng), so the scenery
  // inside is exactly what it was before the painting grew.
  let B = { x0: 0, y0: 0, x1: W, y1: H };
  const inAirspace = (x, y, pad = 0) => x > -pad && x < W + pad && y > -pad && y < H + pad;
  function bleedPoint(rng) {
    for (let k = 0; k < 40; k++) {
      const x = B.x0 + rng() * (B.x1 - B.x0), y = B.y0 + rng() * (B.y1 - B.y0);
      if (!inAirspace(x, y, 20)) return { x, y };
    }
    return null;
  }
  let noiseTile = null;
  function grain() {
    if (noiseTile) return noiseTile;
    noiseTile = canvas(160, 160);
    const c = noiseTile.getContext('2d');
    const img = c.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() < 0.5 ? 0 : 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = Math.random() * 16;
    }
    c.putImageData(img, 0, 0);
    return noiseTile;
  }

  // Distance from a point to the nearest bit of airport the scenery must not cover.
  function airportClearance(level, x, y, opts = {}) {
    let best = Infinity;
    for (const r of level.runways) {
      if (r === opts.exclude) continue;
      if (r.kind === 'pad') { best = Math.min(best, dist(x, y, r.x, r.y) - 30); continue; }
      const g = rwGeom(r);
      const ext = opts.approaches ? 75 : 12;
      best = Math.min(best, segDist(x, y, g.x - g.ux * ext, g.y - g.uy * ext, g.ex + g.ux * ext, g.ey + g.uy * ext) - g.w / 2 - 14);
    }
    return best;
  }

  function placeComplex(level, th) {
    let best = null;
    const runways = level.runways.filter(r => r.kind !== 'pad').sort((a, b) => (b.kind === 'long') - (a.kind === 'long'));
    for (const r of runways) {
      const g = rwGeom(r);
      for (const side of [1, -1]) {
        const off = g.w / 2 + 48;
        const mx = g.x + g.ux * g.len / 2 + g.nx * side * off;
        const my = g.y + g.uy * g.len / 2 + g.ny * side * off;
        let clear = Infinity;
        for (const u of [-72, -36, 0, 36, 72]) {
          for (const v of [-18, 0, 20, 46]) {
            const x = mx + g.ux * u + g.nx * side * v, y = my + g.uy * u + g.ny * side * v;
            clear = Math.min(clear, airportClearance(level, x, y, { exclude: r, approaches: true }),
              x - 8, W - 8 - x, y - 8, H - 8 - y, th.sea ? shoreX(y) - 20 - x : Infinity);
          }
        }
        if (r.length < 200) clear -= 20;
        if (!best || clear > best.clear) best = { r, g, side, off, mx, my, clear };
      }
    }
    return best && best.clear > 4 ? best : null;
  }

  // Wiggly line across the map that keeps clear of the airport.
  function findCourse(level, rng, opts) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const vertical = rng() < (opts.vertical == null ? 0.5 : opts.vertical);
      const span = vertical ? H : W, cross = vertical ? W : H;
      const c0 = cross * (0.1 + rng() * 0.8);
      const a1 = 20 + rng() * 40, l1 = 80 + rng() * 90, p1 = rng() * TAU;
      const a2 = 6 + rng() * 10, l2 = 25 + rng() * 25;
      const pts = [];
      let ok = true;
      for (let s = -30; s <= span + 30; s += 18) {
        const c = c0 + Math.sin(s / l1 + p1) * a1 + Math.sin(s / l2) * a2;
        const pt = vertical ? { x: c, y: s } : { x: s, y: c };
        if (airportClearance(level, pt.x, pt.y) < opts.clear) { ok = false; break; }
        if (opts.avoid && opts.avoid(pt)) { ok = false; break; }
        pts.push(pt);
      }
      if (ok) {
        // The same curve, carried on to the edges of the painting.
        const at = s => { const c = c0 + Math.sin(s / l1 + p1) * a1 + Math.sin(s / l2) * a2; return vertical ? { x: c, y: s } : { x: s, y: c }; };
        const lo = vertical ? B.y0 : B.x0, hi = vertical ? B.y1 : B.x1;
        const before = [], after = [];
        for (let s = -48; s >= lo - 40; s -= 18) before.unshift(at(s));
        for (let s = pts.length * 18 - 30; s <= hi + 40; s += 18) after.push(at(s));
        pts.full = before.concat(pts, after);
        return pts;
      }
    }
    return null;
  }

  function drawTrees(c, trees, th) {
    c.fillStyle = 'rgba(20,30,20,0.22)';
    for (const t of trees) { c.beginPath(); c.ellipse(t.x + t.r * 0.55, t.y + t.r * 0.75, t.r, t.r * 0.9, 0, 0, TAU); c.fill(); }
    for (const t of trees) {
      c.fillStyle = th.tree[0]; c.beginPath(); c.arc(t.x, t.y, t.r, 0, TAU); c.fill();
      c.fillStyle = th.tree[1]; c.beginPath(); c.arc(t.x - t.r * 0.18, t.y - t.r * 0.2, t.r * 0.74, 0, TAU); c.fill();
      c.fillStyle = th.treeSnow ? '#f4f8fa' : th.tree[2];
      c.beginPath(); c.arc(t.x - t.r * 0.38, t.y - t.r * 0.4, t.r * (th.treeSnow ? 0.42 : 0.36), 0, TAU); c.fill();
    }
  }

  function farmland(c, th, rng, level, trees, brng) {
    const rngIn = rng;
    const ang = (rng() - 0.5) * 0.5, cs = Math.cos(ang), sn = Math.sin(ang);
    const cw = 92, ch = 74, n = 9;
    const P = [];
    for (let i = -n; i <= n; i++) {
      const col = [];
      for (let j = -n; j <= n; j++) {
        const gx = i * cw + (rng() - 0.5) * cw * 0.42, gy = j * ch + (rng() - 0.5) * ch * 0.36;
        col.push({ x: W / 2 + gx * cs - gy * sn, y: H / 2 + gx * sn + gy * cs });
      }
      P.push(col);
    }
    const fields = [];
    const lerpP = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    for (let i = 0; i < 2 * n; i++) {
      for (let j = 0; j < 2 * n; j++) {
        const q = [P[i][j], P[i + 1][j], P[i + 1][j + 1], P[i][j + 1]];
        const outside = q.every(p => p.x < -60) || q.every(p => p.x > W + 60) || q.every(p => p.y < -60) || q.every(p => p.y > H + 60);
        if (outside && (q.every(p => p.x < B.x0 - 60) || q.every(p => p.x > B.x1 + 60) || q.every(p => p.y < B.y0 - 60) || q.every(p => p.y > B.y1 + 60))) continue;
        const rng = outside ? brng : rngIn;
        let parts = [q];
        if (rng() < 0.35) {
          const t = 0.35 + rng() * 0.3;
          if (rng() < 0.5) {
            const a = lerpP(q[0], q[1], t), b = lerpP(q[3], q[2], t);
            parts = [[q[0], a, b, q[3]], [a, q[1], q[2], b]];
          } else {
            const a = lerpP(q[0], q[3], t), b = lerpP(q[1], q[2], t);
            parts = [[q[0], q[1], b, a], [a, b, q[2], q[3]]];
          }
        }
        for (const part of parts) {
          fields.push({ q: part, color: th.fields[Math.floor(rng() * th.fields.length)], rows: rng() < 0.55, along: rng() < 0.5, hedge: rng(), rng });
        }
      }
    }
    for (const f of fields) {
      c.beginPath(); poly(c, f.q.map(p => [p.x, p.y])); c.fillStyle = f.color; c.fill();
      if (!f.rows) continue;
      c.save(); c.clip();
      const cx = (f.q[0].x + f.q[2].x) / 2, cy = (f.q[0].y + f.q[2].y) / 2;
      const dx = f.along ? cs : -sn, dy = f.along ? sn : cs;
      c.strokeStyle = th.rows; c.lineWidth = 1.3;
      c.beginPath();
      for (let k = -110; k <= 110; k += 4.2) {
        const ox = cx - dy * k, oy = cy + dx * k;
        c.moveTo(ox - dx * 140, oy - dy * 140); c.lineTo(ox + dx * 140, oy + dy * 140);
      }
      c.stroke();
      c.restore();
    }
    // hedgerows with trees strung along them
    c.lineJoin = 'round';
    for (const f of fields) {
      if (f.hedge < 0.25) continue;
      c.beginPath(); poly(c, f.q.map(p => [p.x, p.y]));
      c.strokeStyle = th.hedge; c.lineWidth = 2.2; c.globalAlpha = 0.85; c.stroke(); c.globalAlpha = 1;
      if (f.hedge > 0.68) {
        const rng = f.rng;
        const e = Math.floor(rng() * 4), a = f.q[e], b = f.q[(e + 1) % 4];
        const len = dist(a.x, a.y, b.x, b.y);
        for (let s = 0; s < len; s += 6 + rng() * 8) {
          const x = a.x + (b.x - a.x) * s / len + (rng() - 0.5) * 2, y = a.y + (b.y - a.y) * s / len + (rng() - 0.5) * 2;
          trees.push({ x, y, r: 2.6 + rng() * 1.8 });
        }
      }
    }
    // a few copses
    const copse = (rng, x0, y0) => {
      const rad = 22 + rng() * 34;
      for (let m = 0; m < rad * rad / 28; m++) {
        const a = rng() * TAU, d = Math.sqrt(rng()) * rad;
        trees.push({ x: x0 + Math.cos(a) * d, y: y0 + Math.sin(a) * d * 0.8, r: 3.4 + rng() * 2.6 });
      }
    };
    for (let k = 0; k < 5; k++) copse(rng, rng() * W, rng() * H);
    const extra = Math.round(((B.x1 - B.x0) * (B.y1 - B.y0) - W * H) / (W * H) * 5);
    for (let k = 0; k < extra; k++) { const pt = bleedPoint(brng); if (pt) copse(brng, pt.x, pt.y); }
  }

  function desert(c, th, rng, trees, brng) {
    const dune = (rng, y0) => {
      const amp = 6 + rng() * 16, wl = 90 + rng() * 160, ph = rng() * TAU, thick = 10 + rng() * 22;
      const top = x => y0 + Math.sin(x / wl + ph) * amp + Math.sin(x / 31 + ph) * 2;
      const xa = Math.min(-10, B.x0 - 10), xb = Math.max(W + 10, B.x1 + 10);
      c.beginPath();
      for (let x = xa; x <= xb; x += 10) c.lineTo(x, top(x));
      for (let x = xb; x >= xa; x -= 10) c.lineTo(x, top(x) + thick + Math.sin(x / 57) * 4);
      c.closePath();
      c.fillStyle = hexA(th.dune, 0.45); c.fill();
      c.beginPath();
      for (let x = xa; x <= xb; x += 10) c.lineTo(x, top(x));
      c.strokeStyle = hexA(th.duneLight, 0.85); c.lineWidth = 1.4; c.stroke();
    };
    for (let k = 0; k < 30; k++) dune(rng, -40 + rng() * (H + 80));
    const rows = Math.round(((B.y1 - B.y0) - H) / 22);
    for (let k = 0; k < rows; k++) dune(brng, brng() < 0.5 ? B.y0 + brng() * (-B.y0 - 30) : H + 30 + brng() * (B.y1 - H - 30));
    const rock = (rng, x, y) => {
      const rad = 12 + rng() * 22;
      const pts = [];
      const n = 9;
      for (let i = 0; i < n; i++) { const a = (i / n) * TAU; const d = rad * (0.7 + rng() * 0.45); pts.push([x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8]); }
      c.beginPath(); poly(c, pts.map(([px, py]) => [px + 7, py + 9])); c.fillStyle = 'rgba(90,50,20,0.22)'; c.fill();
      c.beginPath(); poly(c, pts); c.fillStyle = th.rockDark; c.fill();
      c.beginPath(); poly(c, pts.map(([px, py]) => [x + (px - x) * 0.78 - 2, y + (py - y) * 0.78 - 2])); c.fillStyle = th.rock; c.fill();
      c.beginPath(); poly(c, pts.map(([px, py]) => [x + (px - x) * 0.45 - 3, y + (py - y) * 0.45 - 3])); c.fillStyle = th.rockLight; c.fill();
    };
    for (let k = 0; k < 7; k++) rock(rng, rng() * W, rng() * H);
    for (let k = 0; k < 220; k++) {
      trees.push({ x: rng() * W, y: rng() * H, r: 1.4 + rng() * 1.8, scrub: true });
    }
    const more = ((B.x1 - B.x0) * (B.y1 - B.y0) - W * H) / (W * H);
    for (let k = 0; k < Math.round(more * 7); k++) { const pt = bleedPoint(brng); if (pt) rock(brng, pt.x, pt.y); }
    for (let k = 0; k < Math.round(more * 220); k++) { const pt = bleedPoint(brng); if (pt) trees.push({ x: pt.x, y: pt.y, r: 1.4 + brng() * 1.8, scrub: true }); }
  }

  function drawScrub(c, trees, th) {
    c.fillStyle = 'rgba(90,60,20,0.2)';
    for (const t of trees) { c.beginPath(); c.arc(t.x + 1.2, t.y + 1.6, t.r, 0, TAU); c.fill(); }
    for (const t of trees) {
      // Wrapped so scrub left of or above the airspace (negative x or y)
      // still picks a colour; the same index as before for positive ones.
      c.fillStyle = th.scrub[((Math.floor(t.x * 7 + t.y) % 3) + 3) % 3];
      c.beginPath(); c.arc(t.x, t.y, t.r, 0, TAU); c.fill();
    }
  }

  function sea(c, th) {
    const edge = (off, fill) => {
      const ya = Math.min(-5, B.y0 - 5), yb = Math.max(H + 5, B.y1 + 5), xr = Math.max(W, B.x1) + 5;
      c.beginPath(); c.moveTo(xr, ya);
      for (let y = ya; y <= yb; y += 6) c.lineTo(shoreX(y) + off, y);
      c.lineTo(xr, yb); c.closePath();
      c.fillStyle = fill; c.fill();
    };
    edge(-16, th.sand);
    edge(-3, hexA('#d8c38e', 1));
    edge(0, th.shallows);
    const g = c.createLinearGradient(860, 0, W, 0);
    g.addColorStop(0, th.shallows); g.addColorStop(0.45, th.sea); g.addColorStop(1, '#25698c');
    edge(16, g);
  }

  function water(c, pts, th) {
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); smoothLine(c, pts.full || pts);
    c.strokeStyle = th.riverEdge; c.lineWidth = 15; c.stroke();
    c.strokeStyle = th.river; c.lineWidth = 10.5; c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.18)'; c.lineWidth = 2; c.stroke();
  }

  function road(c, pts, th, rng, houses) {
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); smoothLine(c, pts.full || pts);
    c.strokeStyle = th.roadEdge; c.lineWidth = 7.5; c.stroke();
    c.strokeStyle = th.road; c.lineWidth = 5.5; c.stroke();
    c.setLineDash([4, 5]); c.strokeStyle = th.night ? 'rgba(255,240,200,0.25)' : 'rgba(255,255,255,0.55)'; c.lineWidth = 0.6; c.stroke();
    c.setLineDash([]);
    for (let i = 2; i < pts.length - 2; i++) {
      if (rng() > 0.22) continue;
      const a = pts[i - 1], b = pts[i + 1];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const side = rng() < 0.5 ? 1 : -1;
      const n = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) {
        const along = (k - (n - 1) / 2) * 11;
        const off = 11 + rng() * 5;
        houses.push({
          x: pts[i].x + Math.cos(ang) * along - Math.sin(ang) * off * side,
          y: pts[i].y + Math.sin(ang) * along + Math.cos(ang) * off * side,
          a: ang, w: 7 + rng() * 4, h: 5 + rng() * 2, roof: th.roof[Math.floor(rng() * th.roof.length)],
        });
      }
    }
  }

  function building(c, x, y, a, w, h, roof, px, night) {
    c.save();
    c.translate(x, y); c.rotate(a);
    c.shadowColor = 'rgba(0,0,0,0.35)'; c.shadowBlur = 1.5 * px; c.shadowOffsetX = 2 * px; c.shadowOffsetY = 2.6 * px;
    c.fillStyle = roof; c.fillRect(-w / 2, -h / 2, w, h);
    c.shadowColor = 'transparent';
    c.fillStyle = 'rgba(0,0,0,0.16)'; c.fillRect(-w / 2, 0, w, h / 2);
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(-w / 2, -h / 2, w, 0.6);
    if (night) glow(c, w * 0.3, h * 0.7, '#ffcf7a', 3.2);
    c.restore();
  }

  function glow(c, x, y, color, r) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(0.3, hexA(color, 0.5)); g.addColorStop(1, hexA(color, 0));
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  }

  function airfield(c, r, th) {
    if (r.kind === 'pad') {
      c.beginPath(); c.arc(r.x, r.y, 36, 0, TAU); c.fillStyle = th.airfield; c.fill();
      return;
    }
    const g = rwGeom(r);
    const half = g.w / 2 + 20;
    c.save();
    c.translate(g.x, g.y); c.rotate(g.a);
    c.beginPath(); rrect(c, -26, -half, g.len + 52, half * 2, 14);
    c.fillStyle = th.airfield; c.fill();
    c.clip();
    c.fillStyle = th.airfieldStripe;
    for (let y = -half; y < half; y += 14) c.fillRect(-30, y, g.len + 60, 7);
    c.restore();
  }

  function designator(angleDeg) {
    const heading = ((angleDeg + 90) % 360 + 360) % 360;
    const n = Math.round(heading / 10) % 36 || 36;
    return String(n).padStart(2, '0');
  }

  function paintRunway(c, r, th) {
    const g = rwGeom(r), L = g.len, w = g.w;
    c.save();
    c.translate(g.x, g.y); c.rotate(g.a);
    c.fillStyle = 'rgba(0,0,0,0.14)'; c.fillRect(-4, -w / 2 - 3, L + 8, w + 6);
    c.fillStyle = th.asphalt; c.fillRect(0, -w / 2, L, w);
    // tyre rubber in the touchdown zones
    c.fillStyle = 'rgba(0,0,0,0.2)';
    for (const [x0, x1] of [[14, 80], [L - 80, L - 14]]) {
      for (let k = 0; k < 6; k++) c.fillRect(x0 + k * 6, -2.4 + (k % 3) * 1.6, x1 - x0 - k * 10, 0.9);
    }
    c.fillStyle = PAINT;
    c.fillRect(0, -w / 2 + 1, L, 0.7); c.fillRect(0, w / 2 - 1.7, L, 0.7);
    // threshold bars and numbers at both ends
    for (const end of [0, 1]) {
      c.save();
      if (end) { c.translate(L, 0); c.rotate(Math.PI); }
      for (let y = -w / 2 + 2.6; y <= w / 2 - 3.6; y += 2.4) {
        if (Math.abs(y + 0.5) < 1) continue;
        c.fillRect(2.5, y, 11, 1.4);
      }
      c.save();
      c.translate(19, 0); c.rotate(Math.PI / 2);
      c.font = `600 ${w * 0.56}px ${FONT}`;
      c.textAlign = 'center'; c.textBaseline = 'top';
      c.fillText(designator(r.angle + (end ? 180 : 0)), 0, 0);
      c.restore();
      c.fillRect(44, -w / 4 - 1, 12, 1.6); c.fillRect(44, w / 4 - 0.6, 12, 1.6);
      if (L > 220) { c.fillRect(64, -w / 4 - 1.6, 18, 2.6); c.fillRect(64, w / 4 - 1, 18, 2.6); }
      c.restore();
    }
    for (let x = 40; x < L - 44; x += 15) c.fillRect(x, -0.45, 8, 0.9);
    if (th.night) {
      c.globalCompositeOperation = 'lighter';
      for (let x = 0; x <= L; x += 16) { glow(c, x, -w / 2 - 2.5, '#ffe2a6', 3); glow(c, x, w / 2 + 2.5, '#ffe2a6', 3); }
      for (let y = -w / 2; y <= w / 2; y += 4) { glow(c, -2, y, '#7dff9a', 2.6); glow(c, L + 2, y, '#7dff9a', 2.6); }
      c.globalCompositeOperation = 'source-over';
    }
    c.restore();
  }

  function paintPad(c, r, th, px, heliColor) {
    c.save();
    c.translate(r.x, r.y);
    c.shadowColor = 'rgba(0,0,0,0.3)'; c.shadowBlur = 2 * px; c.shadowOffsetX = 1.5 * px; c.shadowOffsetY = 2 * px;
    c.beginPath(); rrect(c, -21, -21, 42, 42, 5); c.fillStyle = th.concrete; c.fill();
    c.shadowColor = 'transparent';
    c.beginPath(); rrect(c, -19, -19, 38, 38, 4); c.fillStyle = th.asphalt; c.fill();
    c.beginPath(); c.arc(0, 0, 14.5, 0, TAU); c.strokeStyle = heliColor; c.lineWidth = 2.6; c.stroke();
    c.fillStyle = PAINT;
    c.font = `600 17px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('H', 0, 1);
    if (th.night) {
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; glow(c, Math.cos(a) * 19, Math.sin(a) * 19, '#7cc7ff', 3); }
      c.globalCompositeOperation = 'source-over';
    }
    c.restore();
  }

  function complexGround(c, cx, th) {
    const { g, side, off } = cx;
    c.save();
    c.transform(g.ux, g.uy, g.nx * side, g.ny * side, cx.mx, cx.my);
    c.fillStyle = th.taxi;
    for (const u of [-42, 42]) c.fillRect(u - 4, -off + g.w / 2 - 1, 8, off - g.w / 2 - 12);
    c.fillStyle = th.concrete;
    c.beginPath(); rrect(c, -62, -16, 124, 32, 3); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.07)'; c.lineWidth = 0.5;
    c.beginPath();
    for (let u = -54; u < 62; u += 10) { c.moveTo(u, -16); c.lineTo(u, 16); }
    c.stroke();
    c.strokeStyle = '#e8b931'; c.lineWidth = 0.7;
    c.beginPath();
    for (const u of [-42, 42]) { c.moveTo(u, -off + g.w / 2); c.lineTo(u, -6); }
    for (const u of [-36, 0, 36]) { c.moveTo(u, -6); c.lineTo(u, 12); }
    c.moveTo(-56, -8); c.lineTo(56, -8);
    c.stroke();
    c.restore();
  }

  function complexBuildings(c, cx, th, px, rng) {
    const { g, side } = cx;
    c.save();
    c.transform(g.ux, g.uy, g.nx * side, g.ny * side, cx.mx, cx.my);
    // car park
    c.fillStyle = th.asphalt; c.fillRect(-60, 33, 40, 12);
    c.fillStyle = 'rgba(255,255,255,0.4)';
    for (let u = -58; u < -20; u += 4) c.fillRect(u, 33, 0.4, 5);
    const cars = ['#c94c3c', '#e8e4da', '#3d6f9e', '#2c2f33', '#d9b23a'];
    for (let u = -57; u < -21; u += 4) if (rng() < 0.6) { c.fillStyle = cars[Math.floor(rng() * cars.length)]; c.fillRect(u + 0.8, 34, 2.4, 3.6); }
    // terminal
    c.shadowColor = 'rgba(0,0,0,0.35)'; c.shadowBlur = 2 * px; c.shadowOffsetX = 3 * px; c.shadowOffsetY = 4 * px;
    c.fillStyle = th.night ? '#3a454e' : '#e6e2d8';
    c.beginPath(); rrect(c, -58, 17, 116, 14, 2); c.fill();
    c.shadowColor = 'transparent';
    c.fillStyle = th.night ? '#46525c' : '#d4cfc3';
    c.fillRect(-56, 19, 112, 10);
    c.fillStyle = th.night ? '#2f3940' : '#bfb9ad';
    for (const u of [-40, -12, 18, 42]) c.fillRect(u, 21, 7, 5);
    c.fillStyle = th.night ? 'rgba(255,210,140,0.9)' : 'rgba(80,120,150,0.55)';
    c.fillRect(-58, 16.6, 116, 1.4);
    // tower
    c.shadowColor = 'rgba(0,0,0,0.4)'; c.shadowBlur = 2 * px; c.shadowOffsetX = 6 * px; c.shadowOffsetY = 8 * px;
    c.beginPath(); c.arc(70, 6, 6.5, 0, TAU); c.fillStyle = '#d9d4c8'; c.fill();
    c.shadowColor = 'transparent';
    c.beginPath(); c.arc(70, 6, 5, 0, TAU); c.fillStyle = th.night ? '#5fd3c4' : '#2d4352'; c.fill();
    c.beginPath(); c.arc(70, 6, 2.8, 0, TAU); c.fillStyle = '#ece8df'; c.fill();
    c.beginPath(); c.arc(68.4, 4.2, 1.4, 0, TAU); c.fillStyle = 'rgba(255,255,255,0.5)'; c.fill();
    c.restore();
    // parked aircraft at the stands, nose-in to the terminal
    const spr = sprite('jet', 'parked'), sh = sprite('jet', 'shadow');
    for (const u of [-36, 0, 36]) {
      if (rng() < 0.35) continue;
      const x = cx.mx + g.ux * u + g.nx * side * 3, y = cx.my + g.uy * u + g.ny * side * 3;
      const rot = Math.atan2(g.ny * side, g.nx * side);
      c.globalAlpha = 0.25; stamp(c, sh, x + 1.5, y + 2, rot, 0.62); c.globalAlpha = 1;
      stamp(c, spr, x, y, rot, 0.62);
    }
  }

  // `bleed` is how far past the airspace to paint ({x, y}, world units).
  function buildTerrain(level, th, px, heliColor, bleed = { x: 0, y: 0 }) {
    B = { x0: -bleed.x, y0: -bleed.y, x1: W + bleed.x, y1: H + bleed.y };
    const cv = canvas((B.x1 - B.x0) * px, (B.y1 - B.y0) * px);
    cv.bounds = Object.assign({}, B);
    const c = cv.getContext('2d');
    c.scale(px, px);
    c.translate(-B.x0, -B.y0);
    const rng = mulberry32(level.id * 9301 + 49297);
    const brng = mulberry32(level.id * 7919 + 1013);
    c.fillStyle = th.base; c.fillRect(B.x0, B.y0, B.x1 - B.x0, B.y1 - B.y0);

    const trees = [], houses = [];
    if (th.style === 'farm') farmland(c, th, rng, level, trees, brng);
    else desert(c, th, rng, trees, brng);
    if (th.sea) sea(c, th);

    const complex = placeComplex(level, th);
    const nearComplex = (x, y, pad) => complex && dist(x, y, complex.mx + complex.g.nx * complex.side * 14, complex.my + complex.g.ny * complex.side * 14) < 90 + pad;
    const wet = (x) => th.sea && x > 820;

    if (th.river) {
      const river = findCourse(level, rng, { clear: 22, avoid: p => nearComplex(p.x, p.y, 12) });
      if (river) water(c, river, th);
    }
    const roadPts = findCourse(level, rng, { clear: 14, avoid: p => nearComplex(p.x, p.y, 0) || wet(p.x) , vertical: th.sea ? 0 : 0.5 });
    if (roadPts) road(c, roadPts, th, rng, houses);

    const keep = t => airportClearance(level, t.x, t.y) > t.r + 6 && !nearComplex(t.x, t.y, t.r) && !(th.sea && t.x > shoreX(t.y) - 22);
    if (th.style === 'farm') drawTrees(c, trees.filter(keep), th); else drawScrub(c, trees.filter(keep), th);
    for (const h of houses) if (keep({ x: h.x, y: h.y, r: 6 })) building(c, h.x, h.y, h.a, h.w, h.h, h.roof, px, th.night);
    if (th.night && roadPts) {
      c.globalCompositeOperation = 'lighter';
      for (let i = 1; i < roadPts.length; i += 2) glow(c, roadPts[i].x + 4, roadPts[i].y + 4, '#ffb661', 7);
      c.globalCompositeOperation = 'source-over';
    }

    for (const r of level.runways) airfield(c, r, th);
    if (complex) complexGround(c, complex, th);
    for (const r of level.runways) if (r.kind !== 'pad') paintRunway(c, r, th);
    for (const r of level.runways) if (r.kind === 'pad') paintPad(c, r, th, px, heliColor);
    if (complex) complexBuildings(c, complex, th, px, rng);

    // The grain lines up with the airspace's corner, whatever the bleed.
    c.save();
    const gx = ((-B.x0 * px) % 160 + 160) % 160, gy = ((-B.y0 * px) % 160 + 160) % 160;
    c.setTransform(1, 0, 0, 1, gx, gy);
    c.fillStyle = c.createPattern(grain(), 'repeat');
    c.fillRect(-gx, -gy, cv.width, cv.height);
    c.restore();
    return cv;
  }

  // ---------- live layers ----------
  function foam(ctx, t) {
    ctx.save();
    ctx.lineWidth = 1.4;
    for (let k = 0; k < 3; k++) {
      const off = 2 + ((t * 5 + k * 9) % 27);
      ctx.strokeStyle = `rgba(255,255,255,${0.55 * (1 - off / 28)})`;
      ctx.beginPath();
      for (let y = Math.min(-5, B.y0 - 5); y <= Math.max(H + 5, B.y1 + 5); y += 8) ctx.lineTo(shoreX(y) + off + Math.sin(y / 9 + t) * 1.5, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // A shape per runway kind, so colour is never the only cue:
  // ▲ short strip, ■ long runway, ● helipad. On a dark disc, always upright.
  function glyph(ctx, kind, x, y, r, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(20,24,28,0.85)';
    ctx.beginPath(); ctx.arc(0, 0, r * 1.2, 0, TAU); ctx.fill();
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = Math.max(0.8, r * 0.14);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (kind === 'short') { ctx.moveTo(0, -r * 0.72); ctx.lineTo(r * 0.72, r * 0.52); ctx.lineTo(-r * 0.72, r * 0.52); ctx.closePath(); }
    else if (kind === 'long') ctx.rect(-r * 0.58, -r * 0.58, r * 1.16, r * 1.16);
    else ctx.arc(0, 0, r * 0.62, 0, TAU);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function approach(ctx, end, color, t, highlight, night, lights = 6) {
    ctx.save();
    if (end.kind === 'pad') {
      if (highlight) {
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
        ctx.lineDashOffset = -t * 14;
        ctx.globalAlpha = 0.6 + 0.3 * Math.sin(t * 8);
        ctx.beginPath(); ctx.arc(end.x, end.y, 27, 0, TAU); ctx.stroke();
      }
      const k = (t * 0.8) % 1;
      ctx.strokeStyle = hexA(color, 0.6 * (1 - k)); ctx.lineWidth = 2; ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(end.x, end.y, 15 + k * 16, 0, TAU); ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.translate(end.x, end.y);
    ctx.rotate(end.angle);
    if (highlight) {
      ctx.save();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = -t * 14;
      ctx.globalAlpha = 0.6 + 0.3 * Math.sin(t * 8);
      ctx.beginPath(); ctx.arc(-14, 0, 27, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    // approach light bars shaped as chevrons, with a sequenced flash running in to the threshold
    const n = lights, gap = 10;
    const seq = Math.floor(((t * 1.5) % 1) * (n + 3));
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 0; i < n; i++) {
      const x = -8 - (n - 1 - i) * gap;
      const w = 4 + i * 0.7;
      const lit = seq === i;
      ctx.beginPath(); ctx.moveTo(x - 4, -w); ctx.lineTo(x, 0); ctx.lineTo(x - 4, w);
      if (!night) { ctx.strokeStyle = 'rgba(20,25,30,0.35)'; ctx.lineWidth = 4.2; ctx.stroke(); }
      ctx.strokeStyle = lit ? '#ffffff' : color; ctx.lineWidth = 2.4;
      ctx.globalAlpha = highlight || lit ? 1 : 0.85;
      ctx.stroke();
      if (night || lit) {
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(x - 2, 0, 0, x - 2, 0, lit ? 10 : 6);
        g.addColorStop(0, hexA(lit ? '#ffffff' : color, night ? 0.55 : 0.35)); g.addColorStop(1, hexA(color, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x - 2, 0, lit ? 10 : 6, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.restore();
    // The runway's shape, just beyond the farthest light, standing upright.
    const far = 8 + n * gap + 9;
    glyph(ctx, end.kind, end.x - Math.cos(end.angle) * far, end.y - Math.sin(end.angle) * far, 6.5, color);
  }

  function route(ctx, p, color, t, active, handleR) {
    const hr = handleR || 6.5;
    if (!p.path.length) return;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
    for (const q of p.path) ctx.lineTo(q.x, q.y);
    ctx.setLineDash([0.01, 7]);
    ctx.lineDashOffset = p.odo % 7;
    ctx.lineWidth = 5.2; ctx.strokeStyle = 'rgba(15,20,25,0.35)'; ctx.stroke();
    // Locked onto a runway or a hold fix: in the aircraft's colour, no handle.
    const locked = p.landing || p.hold;
    ctx.lineWidth = 3.2; ctx.strokeStyle = locked ? color : 'rgba(255,255,255,0.95)'; ctx.stroke();
    ctx.setLineDash([]);
    if (!locked) {
      // The end of an unfinished route is a handle: grab it to carry on.
      const e = p.path[p.path.length - 1];
      const pulse = active ? 0 : (Math.sin((t || 0) * 4) + 1) / 2;
      ctx.fillStyle = hexA(color, 0.22 + 0.18 * pulse);
      ctx.beginPath(); ctx.arc(e.x, e.y, hr * (1.4 + pulse * 0.3), 0, TAU); ctx.fill();
      ctx.lineWidth = hr * 0.6; ctx.strokeStyle = 'rgba(15,20,25,0.4)';
      ctx.beginPath(); ctx.arc(e.x, e.y, hr, 0, TAU); ctx.stroke();
      ctx.lineWidth = hr * 0.34; ctx.strokeStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(e.x, e.y, hr, 0, TAU); ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(e.x, e.y, hr * 0.4, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function trail(ctx, p) {
    if (!p.trail || p.trail.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    const n = p.trail.length;
    for (let i = 1; i < n; i++) {
      ctx.strokeStyle = `rgba(255,255,255,${(i / n) * 0.32})`;
      ctx.lineWidth = 1 + (i / n) * 1.6;
      ctx.beginPath(); ctx.moveTo(p.trail[i - 1].x, p.trail[i - 1].y); ctx.lineTo(p.trail[i].x, p.trail[i].y); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(p.trail[n - 1].x, p.trail[n - 1].y); ctx.lineTo(p.x, p.y); ctx.stroke();
    ctx.restore();
  }

  // An arrival about to appear: its own silhouette in a dark disc at the
  // edge, pointing the way it will fly, with a band that fills as it nears.
  const MARKER_SPAN = { prop: 33, jet: 36, heavy: 48, heli: 30 };
  function incoming(ctx, s, t, color, r, kind) {
    const x = Math.max(r + 4, Math.min(W - r - 4, s.x)), y = Math.max(r + 4, Math.min(H - r - 4, s.y));
    const done = s.held ? 1 : Math.max(0, Math.min(1, 1 - s.t / (s.lead || 2)));
    ctx.save();
    ctx.translate(x, y);
    const k = (t * 1.4) % 1;
    ctx.strokeStyle = hexA(color, 0.65 * (1 - k)); ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, r * (1.05 + k * 0.9), 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(20,24,28,0.86)';
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = r * 0.16;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.88, 0, TAU); ctx.stroke();
    ctx.strokeStyle = color;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.88, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0.02, done)); ctx.stroke();
    const spr = sprite(s.type, 'body');
    stamp(ctx, spr, 0, 0, s.heading, (r * 1.25) / MARKER_SPAN[s.type]);
    if (kind) glyph(ctx, kind, r * 0.78, r * 0.78, r * 0.34, color);
    ctx.restore();
  }

  function stormSprite(st, rng) {
    const r = st.r, box = r * 2.6, px = 3;
    const cv = canvas(box * px, box * px);
    const c = cv.getContext('2d');
    c.scale(px, px); c.translate(box / 2, box / 2);
    const puffs = [];
    for (let k = 0; k < 11; k++) {
      const a = rng() * TAU, d = Math.sqrt(rng()) * r * 0.62;
      puffs.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: r * (0.32 + rng() * 0.22) });
    }
    for (const p of puffs) {
      const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 1.25);
      g.addColorStop(0, 'rgba(48,52,74,0.75)'); g.addColorStop(0.7, 'rgba(56,60,84,0.55)'); g.addColorStop(1, 'rgba(60,64,90,0)');
      c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, p.r * 1.25, 0, TAU); c.fill();
    }
    for (const p of puffs) {
      const g = c.createRadialGradient(p.x - p.r * 0.35, p.y - p.r * 0.4, 0, p.x - p.r * 0.35, p.y - p.r * 0.4, p.r * 0.8);
      g.addColorStop(0, 'rgba(150,156,190,0.45)'); g.addColorStop(1, 'rgba(150,156,190,0)');
      c.fillStyle = g; c.beginPath(); c.arc(p.x - p.r * 0.35, p.y - p.r * 0.4, p.r * 0.8, 0, TAU); c.fill();
    }
    c.save();
    c.beginPath(); c.arc(0, 0, r * 0.7, 0, TAU); c.clip();
    c.strokeStyle = 'rgba(190,205,235,0.16)'; c.lineWidth = 0.7;
    for (let k = 0; k < 70; k++) {
      const x = (rng() - 0.5) * r * 1.6, y = (rng() - 0.5) * r * 1.6;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x - 3, y + 7); c.stroke();
    }
    c.restore();
    return { cv, box };
  }

  function storm(ctx, st, t) {
    ctx.save();
    ctx.fillStyle = 'rgba(10,15,30,0.16)';
    ctx.beginPath(); ctx.ellipse(st.x + 22, st.y + 30, st.r * 0.9, st.r * 0.8, 0, 0, TAU); ctx.fill();
    ctx.translate(st.x, st.y);
    ctx.save();
    ctx.rotate(st.rot);
    const b = st.sprite.box;
    ctx.drawImage(st.sprite.cv, -b / 2, -b / 2, b, b);
    ctx.restore();
    if (st.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, st.r);
      g.addColorStop(0, `rgba(220,225,255,${st.flash * 3})`); g.addColorStop(1, 'rgba(220,225,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, st.r, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(255,252,220,0.95)'; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
      ctx.beginPath();
      st.bolt.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,92,80,0.75)'; ctx.lineWidth = 1.8;
    ctx.setLineDash([6, 6]); ctx.lineDashOffset = -t * 10;
    ctx.beginPath(); ctx.arc(0, 0, st.r * 0.8, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  function cloudSprite(rng, dark) {
    const bw = 240, bh = 150, px = 1.5;
    const cv = canvas(bw * px, bh * px);
    const c = cv.getContext('2d');
    c.scale(px, px);
    const puffs = [];
    for (let k = 0; k < 9; k++) puffs.push({ x: bw * (0.25 + rng() * 0.5), y: bh * (0.3 + rng() * 0.4), r: 26 + rng() * 26 });
    for (const p of puffs) {
      const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      g.addColorStop(0, dark ? 'rgba(15,25,35,0.09)' : 'rgba(255,255,255,0.26)');
      g.addColorStop(1, dark ? 'rgba(15,25,35,0)' : 'rgba(255,255,255,0)');
      c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, p.r, 0, TAU); c.fill();
    }
    return { cv, w: bw, h: bh };
  }

  function sky(th, seed) {
    if (!th.clouds) return { clouds: [] };
    const rng = mulberry32(seed);
    const clouds = [];
    for (let k = 0; k < 4; k++) {
      const s2 = rng() * 1e9;
      clouds.push({
        x: rng() * W, y: rng() * H, s: 0.8 + rng() * 0.5, v: 5 + rng() * 5,
        cloud: cloudSprite(mulberry32(s2), false), shadow: cloudSprite(mulberry32(s2), true),
      });
    }
    return { clouds };
  }
  function updateSky(sk, dt) {
    for (const c of sk.clouds) {
      c.x += c.v * dt;
      if (c.x - c.cloud.w * c.s > B.x1) { c.x = B.x0 - c.cloud.w * c.s * 0.5; c.y = B.y0 + Math.random() * (B.y1 - B.y0); }
    }
  }
  function cloudLayer(ctx, sk, shadows) {
    for (const c of sk.clouds) {
      const spr = shadows ? c.shadow : c.cloud;
      const w = spr.w * c.s, h = spr.h * c.s;
      ctx.drawImage(spr.cv, c.x - w / 2 + (shadows ? 40 : 0), c.y - h / 2 + (shadows ? 55 : 0), w, h);
    }
  }

  // ---------- conditions ----------
  // A theme's colours after dark: each one dimmed and pulled toward a night
  // blue, so fields, roads and roofs keep their differences. `night` turns
  // on the lit windows, street lamps and glowing approach lights.
  const NIGHT = [20, 33, 46];
  function nightColour(r, g, b) {
    const k = 0.2;
    return [Math.round(r * k + NIGHT[0] * 0.8), Math.round(g * k + NIGHT[1] * 0.8), Math.round(b * k + NIGHT[2] * 0.85)];
  }
  function mapColours(value, fn) {
    if (Array.isArray(value)) return value.map(v => mapColours(v, fn));
    if (typeof value !== 'string') return value;
    let m = /^#([0-9a-f]{6})$/i.exec(value);
    if (m) {
      const n = parseInt(m[1], 16);
      return '#' + fn(n >> 16, (n >> 8) & 255, n & 255).map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
    }
    m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
    if (m) {
      const [r, g, b] = fn(+m[1], +m[2], +m[3]);
      return `rgba(${r},${g},${b},${m[4]})`;
    }
    return value;
  }
  function nightTheme(th) {
    const out = {};
    for (const [k, v] of Object.entries(th)) out[k] = mapColours(v, nightColour);
    return Object.assign(out, { night: true, clouds: false });
  }
  // The same layout under snow: the ground, hedges, roofs and water take the
  // snow theme's colours; the sea and the desert's style stay as they are.
  const SNOW_KEYS = ['base', 'fields', 'rows', 'hedge', 'tree', 'airfield', 'airfieldStripe', 'road', 'roadEdge',
    'river', 'riverEdge', 'concrete', 'taxi', 'asphalt', 'roof'];
  function snowTheme(th, snow) {
    const out = Object.assign({}, th);
    // `river` is both the river's colour and the switch that paints one, so a
    // landscape without a river must not be given the snow theme's.
    for (const k of SNOW_KEYS) {
      if ((k === 'river' || k === 'riverEdge') && !th.river) continue;
      if (snow[k] != null) out[k] = snow[k];
    }
    if (th.sand) out.sand = '#e4e9ec';
    return Object.assign(out, { snowfall: true, treeSnow: true });
  }

  // Weather particles cover the whole painting (B), in proportion to its area.
  const area = () => ((B.x1 - B.x0) * (B.y1 - B.y0)) / (W * H);
  function rainfall(n) {
    return Array.from({ length: Math.round(n * area()) }, () => ({ x: B.x0 + Math.random() * (B.x1 - B.x0), y: B.y0 + Math.random() * (B.y1 - B.y0), v: 380 + Math.random() * 160, l: 7 + Math.random() * 7 }));
  }
  function updateRain(drops, dt) {
    for (const d of drops) {
      d.y += d.v * dt; d.x -= d.v * 0.18 * dt;
      if (d.y > B.y1 + 10) { d.y = B.y0 - 10; d.x = B.x0 + Math.random() * (B.x1 - B.x0 + 80); }
    }
  }
  function drawRain(ctx, drops) {
    ctx.save();
    ctx.strokeStyle = 'rgba(210,225,240,0.32)'; ctx.lineWidth = 0.8; ctx.lineCap = 'round';
    ctx.beginPath();
    for (const d of drops) { ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + d.l * 0.18, d.y - d.l); }
    ctx.stroke();
    ctx.restore();
  }
  // Fog: a pale wash, thickest at the edges, under the approach lights and
  // the aircraft (so it changes how you land, never what you can see).
  let fogCache = null;
  function fog(ctx, t) {
    if (!fogCache) {
      const g = ctx.createRadialGradient(W / 2, H / 2, 120, W / 2, H / 2, 620);
      g.addColorStop(0, 'rgba(226,231,233,0.38)');
      g.addColorStop(1, 'rgba(226,231,233,0.8)');
      fogCache = g;
    }
    ctx.save();
    ctx.fillStyle = fogCache;
    ctx.fillRect(B.x0, B.y0, B.x1 - B.x0, B.y1 - B.y0);
    // slow drifting banks
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#eef1f2';
    const span = B.x1 - B.x0 + 400;
    for (let i = 0; i < 5; i++) {
      const x = B.x0 + ((t * (6 + i * 2) + i * 230) % span) - 200, y = 70 + i * 115;
      ctx.beginPath(); ctx.ellipse(x, y, 190, 34, 0, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function snowfall(n) {
    return Array.from({ length: Math.round(n * area()) }, () => ({ x: B.x0 + Math.random() * (B.x1 - B.x0), y: B.y0 + Math.random() * (B.y1 - B.y0), r: 0.6 + Math.random() * 1.4, v: 14 + Math.random() * 18, ph: Math.random() * TAU }));
  }
  function updateSnow(flakes, dt, t) {
    for (const f of flakes) {
      f.y += f.v * dt; f.x += (Math.sin(t + f.ph) * 6 + 8) * dt;
      if (f.y > B.y1 + 4) { f.y = B.y0 - 4; f.x = B.x0 + Math.random() * (B.x1 - B.x0); }
      if (f.x > B.x1 + 4) f.x = B.x0 - 4;
    }
  }
  function drawSnow(ctx, flakes) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    for (const f of flakes) { ctx.moveTo(f.x + f.r, f.y); ctx.arc(f.x, f.y, f.r, 0, TAU); }
    ctx.fill();
  }

  function effect(ctx, e) {
    const k = e.t / e.life;
    ctx.save();
    if (e.kind === 'text') {
      ctx.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      ctx.font = `600 ${e.size || 14}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const y = e.y - k * 18;
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(18,22,26,0.75)'; ctx.lineJoin = 'round';
      ctx.strokeText(e.text, e.x, y);
      ctx.fillStyle = e.color; ctx.fillText(e.text, e.x, y);
    } else if (e.kind === 'ring') {
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = e.color; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(e.x, e.y, 8 + k * 26, 0, TAU); ctx.stroke();
    } else if (e.kind === 'feather') {
      ctx.globalAlpha = 0.9 * (1 - k);
      ctx.translate(e.x + Math.cos(e.a) * k * 26, e.y + Math.sin(e.a) * k * 26 + k * 8);
      ctx.rotate(e.a + k * 6);
      ctx.fillStyle = k < 0.5 ? '#f4efe4' : '#8a7660';
      ctx.beginPath(); ctx.ellipse(0, 0, 2.6, 0.9, 0, 0, TAU); ctx.fill();
    } else if (e.kind === 'flame') {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, 6 + k * 4);
      g.addColorStop(0, `rgba(255,230,140,${0.9 * (1 - k)})`); g.addColorStop(0.5, `rgba(255,120,40,${0.6 * (1 - k)})`); g.addColorStop(1, 'rgba(255,60,20,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(e.x, e.y, 6 + k * 4, 0, TAU); ctx.fill();
    } else if (e.kind === 'spark') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,${180 + Math.floor(60 * (1 - k))},90,${1 - k})`;
      ctx.beginPath(); ctx.arc(e.x + Math.cos(e.a) * e.v * k, e.y + Math.sin(e.a) * e.v * k, 1.2, 0, TAU); ctx.fill();
    } else if (e.kind === 'puff') {
      // A damaged aircraft's smoke: dark and spreading as it drifts behind.
      ctx.globalAlpha = 0.45 * (1 - k);
      ctx.fillStyle = k < 0.15 ? '#5a4a42' : '#6b6e72';
      ctx.beginPath(); ctx.arc(e.x + k * 6, e.y + k * 4, 3 + k * 10, 0, TAU); ctx.fill();
    } else if (e.kind === 'smoke') {
      ctx.globalAlpha = 0.55 * (1 - k);
      ctx.fillStyle = '#e9ecee';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(e.x - Math.cos(e.a) * k * 6 + Math.cos(e.a + Math.PI / 2) * s * 3.5, e.y - Math.sin(e.a) * k * 6 + Math.sin(e.a + Math.PI / 2) * s * 3.5, 2 + k * 6, 0, TAU);
        ctx.fill();
      }
    } else if (e.kind === 'boom') {
      ctx.globalAlpha = Math.max(0, 1 - k);
      for (const p of e.parts) {
        const d = Math.min(1, k * 1.8);
        ctx.fillStyle = p.c;
        ctx.save(); ctx.translate(e.x + p.vx * d, e.y + p.vy * d); ctx.rotate(p.a + k * p.spin);
        ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
      }
      const r = 8 + 46 * Math.min(1, k * 2.5);
      ctx.fillStyle = 'rgba(70,70,74,0.55)';
      ctx.beginPath(); ctx.arc(e.x + 8 * k, e.y - 16 * k, r * 1.1, 0, TAU); ctx.fill();
      const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r * 0.85);
      g.addColorStop(0, `rgba(255,240,170,${1 - k})`); g.addColorStop(0.45, `rgba(255,140,50,${1 - k})`); g.addColorStop(1, 'rgba(200,60,30,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(e.x, e.y, r * 0.85, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // ---------- holding and disruptions ----------
  // A hold fix: a beacon (the VOR hexagon) with its holding ring, dots
  // drifting clockwise round it as the aircraft will, and its three letters
  // on a dark tag that reads on any landscape. `k` scales the marks so they
  // stay finger-sized on a phone; `count` is how many are in the stack.
  function tag(ctx, text, x, y, k, ink, extra, extraInk) {
    ctx.font = `600 ${11 * k}px ${FONT}`;
    ctx.letterSpacing = `${k}px`;
    const w1 = ctx.measureText(text).width, w2 = extra ? ctx.measureText(extra).width + 4 * k : 0;
    const w = w1 + w2 + 9 * k, h = 15 * k;
    ctx.fillStyle = 'rgba(20,24,28,0.86)';
    ctx.beginPath(); rrect(ctx, x - w / 2, y - h / 2, w, h, 3 * k); ctx.fill();
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = ink;
    ctx.fillText(text, x - w / 2 + 4.5 * k, y + 0.5 * k);
    if (extra) { ctx.fillStyle = extraInk; ctx.fillText(extra, x - w / 2 + 4.5 * k + w1 + 4 * k, y + 0.5 * k); }
    ctx.letterSpacing = '0px';
  }
  function holdFix(ctx, f, t, o) {
    const k = o.k || 1, ring = o.ring || 32;
    ctx.save();
    ctx.translate(f.x, f.y);
    if (o.near || o.highlight) {
      ctx.fillStyle = `rgba(243,234,210,${o.near ? 0.16 : 0.07})`;
      ctx.beginPath(); ctx.arc(0, 0, o.catchR, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = -t * 14;
      ctx.globalAlpha = o.near ? 1 : 0.6 + 0.3 * Math.sin(t * 8);
      ctx.beginPath(); ctx.arc(0, 0, o.catchR, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1; ctx.setLineDash([]);
    }
    if (o.teach) {
      const q = (t * 0.7) % 1;
      ctx.strokeStyle = `rgba(242,179,61,${0.8 * (1 - q)})`; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, 12 + q * 40, 0, TAU); ctx.stroke();
    }
    // the ring the stack flies, dots drifting round clockwise
    ctx.lineCap = 'round';
    ctx.setLineDash([0.01, 7]); ctx.lineDashOffset = -t * 9;
    ctx.strokeStyle = 'rgba(20,24,28,0.35)'; ctx.lineWidth = 4.2;
    ctx.beginPath(); ctx.arc(0, 0, ring, 0, TAU); ctx.stroke();
    ctx.strokeStyle = o.night ? 'rgba(243,234,210,0.7)' : 'rgba(255,252,240,0.85)'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.arc(0, 0, ring, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    // a chevron at the top showing which way round
    ctx.strokeStyle = 'rgba(255,252,240,0.95)'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(-3, -ring - 4.5); ctx.lineTo(2.5, -ring); ctx.lineTo(-3, -ring + 4.5); ctx.stroke();
    // the beacon
    const r = 8 * k;
    if (o.night) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.4);
      g.addColorStop(0, 'rgba(242,179,61,0.35)'); g.addColorStop(1, 'rgba(242,179,61,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r * 2.4, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath();
    ctx.fillStyle = 'rgba(20,24,28,0.9)'; ctx.fill();
    ctx.strokeStyle = PAINT; ctx.lineWidth = 1.6 * k; ctx.stroke();
    const blink = 0.55 + 0.45 * Math.sin(t * 3);
    ctx.fillStyle = `rgba(242,179,61,${0.6 + 0.4 * blink})`;
    ctx.beginPath(); ctx.arc(0, 0, 2.4 * k, 0, TAU); ctx.fill();
    tag(ctx, f.fix, 0, r + 11 * k, k, '#f3ead2', o.count ? `×${o.count}` : '', '#f2b33d');
    if (o.teach) {
      ctx.font = `600 ${12 * k}px ${FONT}`; ctx.letterSpacing = `${1.5 * k}px`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(18,22,26,0.8)'; ctx.lineJoin = 'round';
      ctx.strokeText('HOLD', 0, -ring - 8);
      ctx.fillStyle = '#f2b33d'; ctx.fillText('HOLD', 0, -ring - 8);
      ctx.letterSpacing = '0px';
    }
    ctx.restore();
  }

  // A small quadcopter, rotors blurred.
  function drone(ctx, x, y, s, t) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(t * 1.3) * 0.3);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(s * 0.9, s * 1.5, s * 1.1, s * 0.7, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#2b3136'; ctx.lineWidth = s * 0.28; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-s, -s); ctx.lineTo(s, s); ctx.moveTo(s, -s); ctx.lineTo(-s, s); ctx.stroke();
    for (const [dx, dy] of [[-s, -s], [s, -s], [s, s], [-s, s]]) {
      ctx.fillStyle = 'rgba(220,226,230,0.55)';
      ctx.beginPath(); ctx.arc(dx, dy, s * 0.62, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(40,46,50,0.7)'; ctx.lineWidth = s * 0.12;
      const a = t * 40 + dx;
      ctx.beginPath(); ctx.moveTo(dx - Math.cos(a) * s * 0.6, dy - Math.sin(a) * s * 0.6); ctx.lineTo(dx + Math.cos(a) * s * 0.6, dy + Math.sin(a) * s * 0.6); ctx.stroke();
    }
    ctx.fillStyle = '#e8553f';
    ctx.beginPath(); rrect(ctx, -s * 0.5, -s * 0.38, s, s * 0.76, s * 0.2); ctx.fill();
    ctx.fillStyle = Math.sin(t * 10) > 0 ? '#7dff9a' : '#2b3136';
    ctx.beginPath(); ctx.arc(0, 0, s * 0.16, 0, TAU); ctx.fill();
    ctx.restore();
  }
  // A drone zone: dashed amber while it's announced, then closed sky in red
  // and white with the drone buzzing about inside it.
  function droneZone(ctx, z, t, live, k) {
    ctx.save();
    ctx.translate(z.x, z.y);
    if (live) {
      ctx.fillStyle = 'rgba(232,85,63,0.17)';
      ctx.beginPath(); ctx.arc(0, 0, z.r, 0, TAU); ctx.fill();
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, z.r, 0, TAU); ctx.clip();
      ctx.strokeStyle = 'rgba(232,85,63,0.28)'; ctx.lineWidth = 2;
      for (let d = -z.r * 2; d < z.r * 2; d += 11) { ctx.beginPath(); ctx.moveTo(d, -z.r); ctx.lineTo(d + z.r * 2, z.r); ctx.stroke(); }
      ctx.restore();
      ctx.lineWidth = 3.4; ctx.strokeStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(0, 0, z.r, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#e8402f'; ctx.setLineDash([9, 7]); ctx.lineDashOffset = -t * 10;
      ctx.beginPath(); ctx.arc(0, 0, z.r, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 6);
      ctx.strokeStyle = '#f2b33d'; ctx.lineWidth = 2.6; ctx.setLineDash([7, 6]); ctx.lineDashOffset = -t * 14;
      ctx.beginPath(); ctx.arc(0, 0, z.r, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(242,179,61,0.08)';
      ctx.beginPath(); ctx.arc(0, 0, z.r, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
    const s = 7 * Math.max(1, k * 0.85);
    drone(ctx, Math.cos(t * 0.9 + z.seed) * z.r * 0.4, Math.sin(t * 1.4 + z.seed) * z.r * 0.3, s, t);
    tag(ctx, live ? 'DRONE · NO FLY' : 'DRONE', 0, -z.r - 11 * k, k, live ? '#ffb3a8' : '#f2b33d');
    ctx.restore();
  }

  // Whatever is on the runway: a deer, a dog, or a runaway luggage trolley.
  // Drawn facing `a`, a little bigger than life so a phone shows it.
  function obstacle(ctx, kind, x, y, a, t, moving, k) {
    ctx.save();
    ctx.translate(x, y);
    const q = (t * 2) % 1;
    ctx.strokeStyle = `rgba(242,179,61,${0.85 * (1 - q)})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, (12 + q * 10) * k, 0, TAU); ctx.stroke();
    ctx.scale(k * 1.35, k * 1.35);
    ctx.rotate(a);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(1.5, 2, 6.5, 3, 0, 0, TAU); ctx.fill();
    const step = moving ? Math.sin(t * 18) * 1.2 : 0;
    if (kind === 'cart') {
      ctx.fillStyle = '#7d8489'; ctx.fillRect(-6, -3.6, 12, 7.2);
      ctx.fillStyle = '#3a4147'; ctx.fillRect(5, -1, 3, 2);
      ctx.fillStyle = '#d64b3a'; ctx.fillRect(-5, -3, 4.5, 3);
      ctx.fillStyle = '#3d9be0'; ctx.fillRect(0, -3, 4.5, 3);
      ctx.fillStyle = '#f2b632'; ctx.fillRect(-4, 0.4, 7, 2.6);
    } else {
      const deer = kind === 'deer';
      const coat = deer ? '#a8743f' : '#f2efe6', dark = deer ? '#6e4a28' : '#7a5a3a';
      ctx.strokeStyle = dark; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-3, -1.6); ctx.lineTo(-3 - step, -3.6); ctx.moveTo(-3, 1.6); ctx.lineTo(-3 + step, 3.6);
      ctx.moveTo(2.6, -1.6); ctx.lineTo(2.6 + step, -3.6); ctx.moveTo(2.6, 1.6); ctx.lineTo(2.6 - step, 3.6);
      ctx.stroke();
      ctx.fillStyle = coat;
      ctx.beginPath(); ctx.ellipse(0, 0, deer ? 5 : 4.4, deer ? 2.3 : 2.1, 0, 0, TAU); ctx.fill();
      if (!deer) { ctx.fillStyle = '#8a6440'; ctx.beginPath(); ctx.arc(-1, -0.4, 1.3, 0, TAU); ctx.fill(); }
      ctx.fillStyle = coat;
      ctx.beginPath(); ctx.arc(deer ? 6 : 5.2, 0, deer ? 1.9 : 1.8, 0, TAU); ctx.fill();
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.arc(deer ? 7.6 : 6.7, 0, 0.7, 0, TAU); ctx.fill();
      if (deer) {
        ctx.strokeStyle = '#5a3c20'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(5.6, -1.2); ctx.lineTo(4.6, -3.4); ctx.lineTo(3.6, -3.8); ctx.moveTo(4.9, -2.6); ctx.lineTo(5.8, -3.6);
        ctx.moveTo(5.6, 1.2); ctx.lineTo(4.6, 3.4); ctx.lineTo(3.6, 3.8); ctx.moveTo(4.9, 2.6); ctx.lineTo(5.8, 3.6); ctx.stroke();
        ctx.fillStyle = '#fbf6ec'; ctx.beginPath(); ctx.arc(-5, 0, 0.9, 0, TAU); ctx.fill();
      } else {
        ctx.strokeStyle = coat; ctx.lineWidth = 1.1;
        const wag = Math.sin(t * 16) * 1.6;
        ctx.beginPath(); ctx.moveTo(-4.2, 0); ctx.lineTo(-6.8, wag); ctx.stroke();
      }
    }
    ctx.restore();
  }
  // The airport's ops van: yellow, with an amber light that flashes.
  function opsVan(ctx, x, y, h, t) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(h); ctx.scale(1.3, 1.3);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-5, -2, 12, 6);
    ctx.fillStyle = '#f2b632'; ctx.fillRect(-6, -3, 12, 6);
    ctx.fillStyle = '#2b3136'; ctx.fillRect(2.5, -2.4, 2.4, 4.8);
    ctx.fillStyle = '#1e262c'; ctx.fillRect(-6, -0.5, 8, 1);
    const flash = Math.sin(t * 14) > 0;
    ctx.fillStyle = flash ? '#ffb02e' : '#8a5a10';
    ctx.beginPath(); ctx.arc(-1, 0, 1.4, 0, TAU); ctx.fill();
    if (flash) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,176,46,0.4)';
      ctx.beginPath(); ctx.arc(-1, 0, 7, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  let vignetteCache = null;
  function vignette(ctx, night) {
    if (!vignetteCache || vignetteCache.night !== night) {
      const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, H * 1.0);
      g.addColorStop(0, 'rgba(10,14,20,0)');
      g.addColorStop(1, night ? 'rgba(4,8,14,0.6)' : 'rgba(30,25,15,0.3)');
      vignetteCache = { g, night };
    }
    ctx.fillStyle = vignetteCache.g;
    ctx.fillRect(0, 0, W, H);
  }

  return {
    COLORS, mulberry32, buildTerrain, sprite, icon, aircraft, aircraftShadow, approach, route, trail,
    incoming, storm, stormSprite, sky, updateSky, cloudLayer, snowfall, updateSnow, drawSnow, effect,
    nightTheme, snowTheme, rainfall, updateRain, drawRain, fog, bounds: () => Object.assign({}, B),
    foam, vignette, designator, hexA, glyph, setBoost, holdFix, droneZone, obstacle, opsVan,
  };
})();
