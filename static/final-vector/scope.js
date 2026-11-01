// The radar scope, drawn on a canvas every frame: range rings, the sector's
// edge, the runway's extended centreline with a tick every mile and the
// localiser cone, the stacks and their routes, then every aircraft with its
// history trail, a one-minute speed vector and a data tag. Calm colours;
// amber for what's yours (the selected aircraft), red only for conflicts.
(function (root) {
  'use strict';
  const FV = root.FV = root.FV || {};
  const C = {
    bg: '#0b1014', ring: '#13212a', ring10: '#1a2e38', ringText: '#2f4a55',
    sector: '#24414d', sectorText: '#2f5361', centre: '#3c6b7a', fix: '#5a8794', hold: '#24414d', route: '#1b333d',
    ac: '#e9f3f2', holding: '#9fb3c0', tower: '#5f7a82', amber: '#f2b33d', red: '#ff8a75', redLine: '#e0533f', green: '#7fd1a3',
    land: '#122027', coast: '#18303a', river: '#14262e',
  };
  const RAD = Math.PI / 180;
  const pad3 = n => String(Math.max(0, Math.round(n))).padStart(3, '0');

  function create(canvas) {
    const g = canvas.getContext('2d');
    const view = { w: 0, h: 0, k: 10, ox: 0, oy: 0, dpr: 1 };
    let tagBoxes = [];

    function resize() {
      const r = canvas.getBoundingClientRect();
      view.dpr = Math.min(2, root.devicePixelRatio || 1);
      view.w = r.width; view.h = r.height;
      canvas.width = Math.round(r.width * view.dpr);
      canvas.height = Math.round(r.height * view.dpr);
      // Fit the sector, with a little room round it.
      const W = FV.World, xs = W.sector.map(p => p[0]), ys = W.sector.map(p => p[1]);
      const minX = Math.min(...xs) - 1.5, maxX = Math.max(...xs) + 1.5, minY = Math.min(...ys) - 1.5, maxY = Math.max(...ys) + 1.5;
      view.k = Math.min(view.w / (maxX - minX), view.h / (maxY - minY));
      view.ox = view.w / 2 - (minX + maxX) / 2 * view.k;
      view.oy = view.h / 2 + (minY + maxY) / 2 * view.k;
    }
    const sx = x => view.ox + x * view.k;
    const sy = y => view.oy - y * view.k;
    const toWorld = (px, py) => ({ x: (px - view.ox) / view.k, y: (view.oy - py) / view.k });

    function text(s, x, y, colour, size = 12, weight = 600, align = 'left', spacing = 0) {
      g.font = `${weight} ${size}px Oswald, 'Arial Narrow', sans-serif`;
      if ('letterSpacing' in g) g.letterSpacing = spacing + 'px';
      g.fillStyle = colour; g.textAlign = align; g.textBaseline = 'alphabetic';
      g.fillText(s, x, y);
      if ('letterSpacing' in g) g.letterSpacing = '0px';
    }
    function line(x1, y1, x2, y2, colour, width = 1, dash = null) {
      g.strokeStyle = colour; g.lineWidth = width; g.setLineDash(dash || []);
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      g.setLineDash([]);
    }

    function background() {
      const W = FV.World, k = view.k;
      g.fillStyle = C.bg; g.fillRect(0, 0, view.w, view.h);
      // A coastline and a river, very faint, for orientation.
      g.lineWidth = 2; g.strokeStyle = C.coast; g.beginPath();
      const coast = [[-16, -22], [-6, -24], [6, -21], [16, -26], [30, -23], [42, -27], [50, -25]];
      coast.forEach(([x, y], i) => (i ? g.lineTo(sx(x), sy(y)) : g.moveTo(sx(x), sy(y))));
      g.stroke();
      g.lineWidth = 3; g.strokeStyle = C.river; g.beginPath();
      const river = [[-16, 4], [-8, 2.5], [-2, 3.6], [6, 1.6], [14, 3.2], [24, 0.8], [34, 2.6], [50, 1]];
      river.forEach(([x, y], i) => (i ? g.lineTo(sx(x), sy(y)) : g.moveTo(sx(x), sy(y))));
      g.stroke();
      // Range rings every 5 nm round the airport.
      const ax = sx(-W.length / 2), ay = sy(0);
      for (let r = 5; r <= 60; r += 5) {
        g.strokeStyle = r % 10 ? C.ring : C.ring10; g.lineWidth = 1;
        g.beginPath(); g.arc(ax, ay, r * k, 0, Math.PI * 2); g.stroke();
      }
      for (const r of [10, 20, 30, 40]) text(String(r), ax + 4, ay - r * k - 4, C.ringText, 10, 500);
      // The sector's edge.
      g.strokeStyle = C.sector; g.lineWidth = 1.4; g.setLineDash([10, 7]); g.beginPath();
      W.sector.forEach(([x, y], i) => (i ? g.lineTo(sx(x), sy(y)) : g.moveTo(sx(x), sy(y))));
      g.closePath(); g.stroke(); g.setLineDash([]);
      const [lx, ly] = W.sector[1];
      text(`${W.name.toUpperCase()} APPROACH · TRAINING SECTOR`, sx(lx) + 10, sy(ly) + 18, C.sectorText, 11, 600, 'left', 2);
      // Arrival routes into the stacks.
      for (const pts of Object.values(W.routes)) {
        g.strokeStyle = C.route; g.lineWidth = 1; g.beginPath();
        pts.forEach(([x, y], i) => (i ? g.lineTo(sx(x), sy(y)) : g.moveTo(sx(x), sy(y))));
        g.stroke();
      }
      // The localiser cone and the extended centreline, a tick every mile.
      const reach = 20;
      g.fillStyle = 'rgba(80,160,180,0.06)'; g.beginPath();
      g.moveTo(sx(0), sy(0)); g.lineTo(sx(reach), sy(2.2)); g.lineTo(sx(reach), sy(-2.2)); g.closePath(); g.fill();
      line(sx(0), sy(0), sx(reach), sy(0), C.centre, 1, [2, 3]);
      for (let d = 1; d <= reach; d++) {
        const big = d % 5 === 0;
        line(sx(d), sy(0) - (big ? 5 : 2.5), sx(d), sy(0) + (big ? 5 : 2.5), C.centre, 1);
      }
      text('8 NM', sx(8) - 9, sy(0) + 17, C.centre, 9.5, 500);
      g.fillStyle = C.centre; g.beginPath(); g.arc(sx(10), sy(0), 2.6, 0, Math.PI * 2); g.fill();
      text('D10', sx(10) - 8, sy(0) - 9, C.centre, 9.5, 500);
      // The runway.
      line(sx(0), sy(0), sx(-W.length), sy(0), '#d8e6e8', 3.2);
      text(W.runway, sx(0) + 4, sy(0) + 15, '#8fb3b9', 11);
      text(W.code, sx(-W.length / 2), sy(0) + 30, '#8fb3b9', 11, 600, 'center', 1.5);
      // Stacks: a triangle, the name and the holding pattern.
      for (const [id, f] of Object.entries(W.fixes)) {
        const x = sx(f.x), y = sy(f.y);
        g.strokeStyle = C.fix; g.lineWidth = 1.4; g.beginPath();
        g.moveTo(x, y - 7); g.lineTo(x + 6, y + 4); g.lineTo(x - 6, y + 4); g.closePath(); g.stroke();
        text(id, x + 9, y + 4, C.fix, 11);
        // The racetrack: outbound away from the inbound course, right turns.
        const out = (f.inbound + 180) * RAD, side = (f.inbound + 90) * RAD;
        const len = 4.5 * k, wide = 1.4 * k;
        const cx = x + Math.sin(out) * len / 2 + Math.sin(side) * wide, cy = y - Math.cos(out) * len / 2 - Math.cos(side) * wide;
        g.save(); g.translate(cx, cy); g.rotate(out - Math.PI / 2);
        g.strokeStyle = C.hold; g.setLineDash([3, 3]); g.beginPath();
        g.ellipse(0, 0, len / 2 + wide, wide, 0, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
        g.restore();
      }
      // Scale.
      line(18, view.h - 16, 18 + 5 * k, view.h - 16, '#4e6a73', 1);
      text('5 NM', 18, view.h - 22, '#4e6a73', 10, 500);
    }

    function colourOf(ac, ui) {
      if (ui.conflicts.has(ac.cs)) return C.red;
      if (ac.cs === ui.selected) return C.amber;
      if (ac.freq === 'tower') return C.tower;
      if (ac.mode === 'hold') return C.holding;
      return C.ac;
    }

    // Tags try four places round the aircraft and take the first that
    // doesn't sit on another tag.
    function placeTag(x, y, w, h) {
      const tries = [[12, -h - 6], [12, 10], [-w - 12, -h - 6], [-w - 12, 10]];
      for (const [dx, dy] of tries) {
        const r = { x: x + dx, y: y + dy, w, h };
        if (r.x < 4 || r.x + w > view.w - 4 || r.y < 4 || r.y + h > view.h - 4) continue;
        if (!tagBoxes.some(b => r.x < b.x + b.w && r.x + w > b.x && r.y < b.y + b.h && r.y + h > b.y)) return r;
      }
      return { x: x + (x > view.w - w - 20 ? -w - 12 : 12), y: y - h - 6, w, h };
    }

    function aircraft(ac, ui) {
      const k = view.k, x = sx(ac.x), y = sy(ac.y), c = colourOf(ac, ui);
      const mine = ac.freq === 'mine';
      g.globalAlpha = ac.state === 'air' ? 1 : 0.4;
      // History: where it was at each of the last few sweeps.
      ac.trail.forEach(([tx, ty], i) => {
        g.fillStyle = c; g.globalAlpha = Math.max(0.08, 0.55 - i * 0.08);
        g.beginPath(); g.arc(sx(tx), sy(ty), 1.7, 0, Math.PI * 2); g.fill();
      });
      g.globalAlpha = ac.state === 'air' ? 1 : 0.4;
      // Where it'll be in a minute.
      const gs = ac.gsKt || ac.ias, a = ac.hdg * RAD, v = gs / 60 * k;
      line(x, y, x + Math.sin(a) * v, y - Math.cos(a) * v, c, 1);
      // The symbol.
      g.strokeStyle = c; g.lineWidth = 1.6;
      g.strokeRect(x - 4.5, y - 4.5, 9, 9);
      if (ui.conflicts.has(ac.cs)) {
        g.strokeStyle = C.redLine; g.lineWidth = 1.4; g.setLineDash([4, 3]);
        g.beginPath(); g.arc(x, y, 1.5 * k, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      }
      // The data tag.
      const l1 = `${ac.cs}  ${ac.wake}`;
      const arrow = ac.cfl < ac.alt - 50 ? '↓' : ac.cfl > ac.alt + 50 ? '↑' : ' ';
      const l2 = mine ? `${pad3(ac.alt / 100)}${arrow}${pad3(ac.cfl / 100)}  ${Math.round(gs)}` : `${pad3(ac.alt / 100)}  TWR`;
      g.font = '600 12.5px Oswald, sans-serif';
      if ('letterSpacing' in g) g.letterSpacing = '0.5px';
      const tw = Math.max(g.measureText(l1).width, g.measureText(l2).width);
      if ('letterSpacing' in g) g.letterSpacing = '0px';
      const w = tw + 34, h = 34;
      const r = placeTag(x, y, w, h);
      tagBoxes.push(r);
      ac._tag = r;
      line(x + (r.x > x ? 4 : -4), y + (r.y > y ? 4 : -4), r.x > x ? r.x - 2 : r.x + r.w - 26, r.y > y ? r.y + 6 : r.y + h - 8, c, 1);
      if (ac.cs === ui.selected) {
        g.fillStyle = 'rgba(242,179,61,0.12)'; g.fillRect(r.x - 4, r.y - 2, r.w, h);
        g.strokeStyle = C.amber; g.lineWidth = 1.2; g.strokeRect(r.x - 4, r.y - 2, r.w, h);
      }
      text(l1, r.x, r.y + 12, c, 12.5, 600, 'left', 0.5);
      text(l2, r.x, r.y + 28, c, 12.5, 600, 'left', 0.5);
      if (ac.loc) text('LOC', r.x + tw + 6, r.y + 28, C.green, 10);
      else if (ac.ils && mine) text('ILS', r.x + tw + 6, r.y + 28, C.amber, 10);
      if (ac.mode === 'hold' && ac.hold) text(ac.hold.fix, r.x + tw + 6, r.y + 12, C.holding, 10);
      g.globalAlpha = 1;
    }

    function hint(h, sim) {
      const ac = sim.find(h.cs);
      if (!ac) return;
      const x = sx(ac.x), y = sy(ac.y);
      if (h.kind === 'heading') {
        const a = h.hdg * RAD, L = (h.len || 12) * view.k;
        line(x, y, x + Math.sin(a) * L, y - Math.cos(a) * L, C.amber, 1.6, [6, 5]);
        text(h.label || `HDG ${pad3(h.hdg)}`, x + Math.sin(a) * L + 6, y - Math.cos(a) * L - 6, C.amber, 12);
      }
      if (h.kind === 'ring') {
        const pulse = 14 + 4 * Math.sin(performance.now() / 260);
        g.strokeStyle = C.amber; g.globalAlpha = 0.8; g.lineWidth = 1.6;
        g.beginPath(); g.arc(x, y, pulse, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
      }
    }

    function draw(sim, ui) {
      g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      background();
      tagBoxes = [];
      for (const h of ui.hints || []) hint(h, sim);
      // Selected and conflicting aircraft last, so their tags sit on top.
      const order = sim.aircraft.slice().sort((a, b) => rank(a, ui) - rank(b, ui));
      for (const ac of order) aircraft(ac, ui);
      // The separation between each pair in conflict.
      for (const c of sim.conflicts) {
        const a = sim.find(c.a), b = sim.find(c.b);
        if (!a || !b) continue;
        const mx = (sx(a.x) + sx(b.x)) / 2, my = (sy(a.y) + sy(b.y)) / 2;
        text(`${(Math.floor(c.h * 10) / 10).toFixed(1)} NM · ${Math.floor(c.v / 100) * 100} FT`, mx + 8, my + 24, C.red, 11);
      }
    }
    const rank = (ac, ui) => (ac.cs === ui.selected ? 3 : ui.conflicts.has(ac.cs) ? 2 : ac.freq === 'mine' ? 1 : 0);

    // The aircraft under a tap: its symbol, or its tag.
    function pick(px, py, sim) {
      let best = null, bestD = 22;
      for (const ac of sim.aircraft) {
        if (ac.state !== 'air') continue;
        const d = Math.hypot(sx(ac.x) - px, sy(ac.y) - py);
        if (d < bestD) { best = ac; bestD = d; }
      }
      if (best) return best;
      for (const ac of sim.aircraft) {
        const r = ac._tag;
        if (ac.state === 'air' && r && px >= r.x - 4 && px <= r.x + r.w && py >= r.y - 2 && py <= r.y + r.h) return ac;
      }
      return null;
    }

    return { resize, draw, pick, toWorld, sx, sy, view };
  }

  FV.Scope = { create, COLOURS: C };
})(window);
