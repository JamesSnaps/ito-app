// Final Vector: the page. Puts the simulation (sim.js), the scope
// (scope.js), the command grammar (command.js), the radio (radio.js) and
// the Academy (lessons.js) together: the strips, the radio log, the top
// bar, the command dial, the command line, lessons, the shift and its
// debrief, the save and the family records. window.__finalVector is the
// hook the browser checks drive.
(() => {
  'use strict';
  const { World, Sim, Command, Radio, Scope, LESSONS } = window.FV;
  const $ = id => document.getElementById(id);
  const pad2 = n => String(n).padStart(2, '0');
  const pad3 = n => String(Math.round(n)).padStart(3, '0');
  // Rounded down, so a pair 2.97 nm apart never reads as 3.0 (the minimum).
  const miles = h => (Math.floor(h * 10) / 10).toFixed(1);
  const feet = v => (Math.floor(v / 100) * 100).toLocaleString('en-GB');
  const FIXNAMES = Object.fromEntries(Object.entries(World.fixes).map(([k, f]) => [k, f.name]));
  const ALERTS = new Set(['stca', 'los', 'through', 'missed', 'left']);

  // ---------- save ----------
  const SAVE_KEY = 'final-vector:save';
  const save = (() => {
    const blank = { lessons: {}, muted: false, outbox: [], shifts: 0, best: null };
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { /* fresh */ }
    return Object.assign(blank, saved);
  })();
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* private mode */ } }
  const passed = n => !!save.lessons[n];
  const unlocked = n => n === 1 || passed(n - 1);
  const shiftOpen = () => LESSONS.every(L => passed(L.id));

  // ---------- state ----------
  let sim = Sim.create();
  const S = {
    mode: 'menu',            // menu (nothing running) | lesson | shift
    paused: true, speed: 1, fast: 0,
    selected: null, clock0: Date.now(),
    lesson: null, shift: null, history: [], histAt: -1, log: [],
  };
  const scope = Scope.create($('radar'));

  // ---------- the radio log ----------
  function clock() {
    const d = new Date(S.clock0 + sim.t * 1000);
    return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
  }
  function logLine(kind, text) {
    const row = document.createElement('div');
    row.className = 'line ' + kind;
    const t = document.createElement('small');
    t.textContent = clock();
    const s = document.createElement('span');
    s.textContent = text;
    row.append(t, s);
    $('log').append(row);
    while ($('log').children.length > 60) $('log').firstChild.remove();
    $('log').scrollTop = $('log').scrollHeight;
    S.log.push({ kind, text, t: sim.t });
    if (S.log.length > 200) S.log.shift();
  }
  const spoken = cs => Command.spoken(cs);

  // A pilot's transmission: shown as it starts, spoken if the clips are there.
  function pilot(ac, keys) {
    Radio.say({ voice: ac.voice, keys, onStart: () => logLine('pilot', Command.text(keys)) });
  }

  // ---------- giving instructions ----------
  function issue(cs, cmds, source) {
    const ac = sim.find(cs);
    if (!ac || ac.state !== 'air') { note(`${cs} isn't on your frequency.`); return false; }
    const snap = { cs, hdg: ac.hdg, alt: ac.alt, runway: World.runway };
    const r = sim.instruct(cs, cmds);
    if (!r.ok && !r.unable) { note(r.error); return false; }
    const said = Command.controllerKeys(cmds, snap, FIXNAMES);
    Radio.say({ text: Command.text(said), words: said.length, onStart: () => logLine('me', Command.text(said)) });
    const back = r.unable ? ['unable', ...Command.readbackKeys([r.unable], snap, FIXNAMES)] : Command.readbackKeys(cmds, snap, FIXNAMES);
    pilot(ac, back);
    if (r.unable) { note(r.error, false); return false; }
    lessonEvent({ kind: 'instruction', cs, cmds, source });
    return true;
  }
  // A quiet line under the command line (and in the log): the system
  // talking to you, not the radio.
  function note(text, toLog = true) {
    $('cmd-hint').textContent = text;
    $('cmd-hint').className = 'cmd-hint bad';
    if (toLog) logLine('sys', text);
  }

  // ---------- simulation events ----------
  function handle(ev) {
    const name = c => spoken(c);
    switch (ev.kind) {
      case 'stca':
        logLine('alert', `⚠ Conflict alert: ${name(ev.a)} and ${name(ev.b)}, ${miles(ev.h)} miles, ${feet(ev.v)} ft apart.`);
        Radio.alarm();
        break;
      case 'los':
        logLine('alert', `Loss of separation: ${ev.a} and ${ev.b}, ${miles(ev.h)} nm and ${feet(ev.v)} ft.`);
        Radio.alarm();
        break;
      case 'clear':
        if (ev.los) logLine('ok', `${ev.key.replace('|', ' and ')} separated again.`);
        break;
      case 'established': {
        const ac = sim.find(ev.cs);
        if (ac) pilot(ac, Command.establishedKeys(ac));
        break;
      }
      case 'through':
        logLine('alert', ev.high
          ? `${ev.cs} went through the localiser: too high to capture, above the glideslope.`
          : `${ev.cs} went through the localiser: a ${ev.cut}° cut (30° at most).`);
        break;
      case 'handoff':
        if (ev.on === 'late') logLine('sys', `Late handoff: ${ev.cs} at ${ev.d.toFixed(1)} miles (by 8, please).`);
        break;
      case 'missed':
        logLine('alert', `Missed handoff: ${ev.cs} is inside 4 miles on your frequency. The tower has taken it.`);
        break;
      case 'landed': {
        const late = ev.delay > 30 ? ` (${Math.floor(ev.delay / 60)}:${pad2(Math.round(ev.delay % 60))} late)` : '';
        logLine('ok', `${ev.cs} landed${S.mode === 'shift' ? late : ''}.`);
        break;
      }
      case 'left':
        logLine('alert', `${ev.cs} left your airspace.`);
        break;
      case 'held':
        logLine('sys', `${ev.cs} holding at ${FIXNAMES[ev.fix]}.`);
        break;
    }
    // ×2 is for quiet stretches: anything that needs you drops it back.
    if (ALERTS.has(ev.kind) && S.speed !== 1) setSpeed(1);
    if (ev.kind === 'los' || ev.kind === 'stca') flashAlert();
    lessonEvent(ev);
  }
  function drain() {
    while (sim.events.length) handle(sim.events.shift());
  }
  function advance(seconds) {
    // In slices, so events are handled in order and a lesson sees them.
    while (seconds > 0) {
      const dt = Math.min(1, seconds);
      sim.step(dt);
      if (S.speed > 1) S.fast += dt;
      seconds -= dt;
      drain();
      if (S.mode === 'shift') shiftTick();
      lessonTick();
    }
  }

  // ---------- selection, the scope ----------
  function select(cs, how = 'select') {
    S.selected = cs;
    if (cs) lessonEvent({ kind: how, cs });
    drawStrips(true);
  }
  function ui() {
    const conflicts = new Set();
    for (const c of sim.conflicts) { conflicts.add(c.a); conflicts.add(c.b); }
    const hints = [];
    const L = S.lesson;
    if (L && !L.done && !L.failed && L.task < L.def.tasks.length) {
      const t = L.def.tasks[L.task];
      if (t.hint) hints.push(...t.hint(lessonHandle()));
    }
    return { selected: S.selected, conflicts, hints };
  }

  $('radar').addEventListener('pointerdown', e => {
    Radio.unlock();
    if (S.paused) return;
    const r = $('radar').getBoundingClientRect();
    const ac = scope.pick(e.clientX - r.left, e.clientY - r.top, sim);
    if (ac) {
      select(ac.cs);
      openDial(ac);
      fillCallsign(ac.cs);
    } else {
      closeDial();
      select(null);
    }
  });

  // ---------- the command dial ----------
  let dial = null;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs, parent) => {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const RING = 112;
  const altLabel = ft => (ft > Command.TA ? `FL${ft / 100}` : String(ft));

  function openDial(ac) {
    closeDial();
    const box = $('scope').getBoundingClientRect();
    const cx = scope.sx(ac.x), cy = scope.sy(ac.y);
    const altList = [];
    for (let ft = World.ceiling; ft >= World.msa; ft -= 1000) altList.push(ft);
    if (!altList.includes(ac.cfl)) { altList.push(ac.cfl); altList.sort((a, b) => b - a); }
    const spdList = [];
    for (let v = ac.T.vmax; v >= ac.T.vmin; v -= 10) spdList.push(v);
    if (!spdList.includes(ac.spd)) { spdList.push(ac.spd); spdList.sort((a, b) => b - a); }
    dial = { cs: ac.cs, base: ac.hdg, turn: 0, alt: ac.cfl, spd: ac.spd, ils: false, twr: false, hold: null, altList, spdList };

    const root = document.createElement('div');
    root.className = 'dial';
    root.id = 'dial';
    // The ring: centred on the aircraft, kept on screen.
    const size = 300;
    const left = Math.max(4, Math.min(box.width - size - 4, cx - size / 2));
    const top = Math.max(4, Math.min(box.height - size - 4, cy - size / 2));
    const ring = svg('svg', { class: 'dial-ring', viewBox: '-150 -150 300 300', width: size, height: size });
    ring.style.left = left + 'px'; ring.style.top = top + 'px';
    svg('circle', { r: RING + 34, class: 'dr-back' }, ring);
    svg('circle', { r: RING, class: 'dr-band' }, ring);
    dial.arc = svg('path', { class: 'dr-arc' }, ring);
    for (let h = 0; h < 360; h += 10) {
      const a = h * Math.PI / 180, big = h % 30 === 0, s = Math.sin(a), c = -Math.cos(a);
      svg('line', { x1: s * (RING - (big ? 10 : 6)), y1: c * (RING - (big ? 10 : 6)), x2: s * (RING + 8), y2: c * (RING + 8), class: big ? 'dr-tick big' : 'dr-tick' }, ring);
      if (big) svg('text', { x: s * (RING + 22), y: c * (RING + 22) + 4, class: 'dr-num' }, ring).textContent = pad3(h);
    }
    dial.now = svg('line', { x1: 0, y1: 0, class: 'dr-now' }, ring);
    dial.to = svg('line', { x1: 0, y1: 0, class: 'dr-to' }, ring);
    dial.knob = svg('circle', { r: 11, class: 'dr-knob' }, ring);
    svg('circle', { r: 42, class: 'dr-hub' }, ring);
    dial.dirText = svg('text', { y: -6, class: 'dr-dir' }, ring);
    dial.hdgText = svg('text', { y: 18, class: 'dr-hdg' }, ring);
    root.append(ring);

    // The panel: level, speed, actions, Send.
    const panel = document.createElement('div');
    panel.className = 'dial-panel';
    const roomRight = box.width - (left + size), roomLeft = left;
    const pw = 186;
    const px = roomRight >= pw + 8 ? left + size + 4 : roomLeft >= pw + 8 ? left - pw - 4 : Math.max(4, box.width - pw - 4);
    panel.style.left = px + 'px';
    panel.style.top = Math.max(4, Math.min(box.height - 470, cy - 200)) + 'px';
    const title = document.createElement('div');
    title.className = 'dp-title';
    title.textContent = `${ac.cs} · ${ac.type} · ${ac.wake}`;
    const close = document.createElement('button');
    close.className = 'dp-close'; close.textContent = '×'; close.setAttribute('aria-label', 'Close');
    close.onclick = closeDial;
    title.append(close);
    const cols = document.createElement('div');
    cols.className = 'dp-cols';
    cols.append(column('ALT', 'alt', altList, altLabel), column('SPEED', 'spd', spdList, String));
    const acts = document.createElement('div');
    acts.className = 'dp-actions';
    dial.btn = {};
    const action = (key, label) => {
      const b = document.createElement('button');
      b.className = 'dp-act'; b.textContent = label; b.dataset.a = key;
      b.onclick = () => toggle(key);
      acts.append(b);
      dial.btn[key] = b;
    };
    action('ils', `Cleared ILS ${World.runway}`);
    for (const f of Object.keys(World.fixes)) action('hold:' + f, `Hold at ${f}`);
    action('twr', 'Contact tower');
    dial.send = document.createElement('button');
    dial.send.className = 'dp-send';
    dial.send.onclick = sendDial;
    panel.append(title, cols, acts, dial.send);
    root.append(panel);
    $('overlay').append(root);
    lessonEvent({ kind: 'dial', cs: ac.cs });

    // Dragging round the ring. The way you drag is the way it turns: the
    // total angle dragged is kept unwrapped, so dragging on past 180°
    // means the long way round.
    let last = null, moved = 0;
    const angleAt = e => {
      const r = ring.getBoundingClientRect();
      const x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
      return { a: (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360, d: Math.hypot(x, y) * 300 / r.width };
    };
    ring.addEventListener('pointerdown', e => {
      const p = angleAt(e);
      if (p.d < 44) return;                       // the hub: nothing
      e.preventDefault();
      ring.setPointerCapture(e.pointerId);
      const target = Sim.norm(dial.base + dial.turn);
      // Grabbing the knob carries on from it; anywhere else on the ring jumps there by the shorter way.
      if (Math.abs(Sim.diff(p.a, target)) > 12) { dial.turn = Sim.diff(p.a, dial.base); dial.hold = null; }
      last = p.a; moved = 0;
      paintDial();
    });
    ring.addEventListener('pointermove', e => {
      if (last === null) return;
      const p = angleAt(e), d = Sim.diff(p.a, last);
      dial.turn = Math.max(-355, Math.min(355, dial.turn + d));
      moved += Math.abs(d);
      last = p.a;
      dial.hold = null;
      paintDial();
    });
    const end = () => { last = null; };
    ring.addEventListener('pointerup', end);
    ring.addEventListener('pointercancel', end);
    paintDial();
    // Centre each column on its value.
    for (const k of ['alt', 'spd']) {
      const list = dial[k + 'List'], el = dial[k + 'El'];
      el.scrollTop = list.indexOf(dial[k]) * ITEM;
    }
  }

  const ITEM = 32;
  function column(label, key, list, fmt) {
    const col = document.createElement('div');
    col.className = 'dp-col';
    const h = document.createElement('div');
    h.className = 'dp-h'; h.textContent = label;
    const el = document.createElement('div');
    el.className = 'dp-list';
    el.dataset.k = key;
    list.forEach((v, i) => {
      const it = document.createElement('div');
      it.className = 'dp-item'; it.textContent = fmt(v); it.dataset.i = i;
      it.onclick = () => { dial[key] = v; el.scrollTo({ top: i * ITEM, behavior: 'smooth' }); paintDial(); };
      el.append(it);
    });
    // Scrolling picks whatever stops in the middle.
    let t = 0;
    el.addEventListener('scroll', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (!dial) return;
        const i = Math.max(0, Math.min(list.length - 1, Math.round(el.scrollTop / ITEM)));
        if (dial[key] !== list[i]) { dial[key] = list[i]; paintDial(); }
      }, 110);
    });
    dial[key + 'El'] = el;
    col.append(h, el);
    return col;
  }

  function toggle(key) {
    if (!dial) return;
    if (key === 'ils') dial.ils = !dial.ils;
    else if (key === 'twr') dial.twr = !dial.twr;
    else {
      const fix = key.split(':')[1];
      dial.hold = dial.hold === fix ? null : fix;
      if (dial.hold) { dial.turn = 0; dial.ils = false; }
    }
    paintDial();
  }

  // What the dial would send, as commands.
  function dialCmds() {
    const ac = sim.find(dial.cs);
    if (!ac) return [];
    const cmds = [];
    if (Math.abs(dial.turn) >= 2.5) {
      let h = Math.round(Sim.norm(dial.base + dial.turn) / 5) * 5 % 360;
      cmds.push({ t: 'hdg', hdg: h === 0 ? 360 : h, dir: dial.turn < 0 ? 'L' : 'R' });
    }
    if (dial.alt !== ac.cfl) cmds.push({ t: 'alt', ft: dial.alt, verb: null });
    if (dial.spd !== ac.spd) cmds.push({ t: 'spd', kt: dial.spd });
    if (dial.hold) cmds.push({ t: 'hold', fix: dial.hold });
    if (dial.ils) cmds.push({ t: 'ils' });
    if (dial.twr) cmds.push({ t: 'twr' });
    return cmds;
  }

  function paintDial() {
    if (!dial) return;
    const ac = sim.find(dial.cs);
    if (!ac) { closeDial(); return; }
    const pt = (h, r) => { const a = h * Math.PI / 180; return [Math.sin(a) * r, -Math.cos(a) * r]; };
    const [nx, ny] = pt(ac.hdg, RING - 12);
    dial.now.setAttribute('x2', nx); dial.now.setAttribute('y2', ny);
    const target = Sim.norm(dial.base + dial.turn);
    const shown = Math.round(target / 5) * 5 % 360 || 360;
    const [tx, ty] = pt(target, RING + 6), [kx, ky] = pt(target, RING);
    dial.to.setAttribute('x2', tx); dial.to.setAttribute('y2', ty);
    dial.knob.setAttribute('cx', kx); dial.knob.setAttribute('cy', ky);
    const turning = Math.abs(dial.turn) >= 2.5;
    if (turning) {
      const [ax, ay] = pt(dial.base, RING);
      const large = Math.abs(dial.turn) > 180 ? 1 : 0, sweep = dial.turn > 0 ? 1 : 0;
      dial.arc.setAttribute('d', `M${ax} ${ay} A${RING} ${RING} 0 ${large} ${sweep} ${kx} ${ky}`);
    } else dial.arc.setAttribute('d', '');
    dial.dirText.textContent = dial.hold ? 'HOLD' : turning ? (dial.turn < 0 ? 'LEFT' : 'RIGHT') : 'HDG';
    dial.hdgText.textContent = dial.hold ? dial.hold : turning ? pad3(shown) : pad3(ac.hdg) ;
    dial.hdgText.classList.toggle('same', !turning && !dial.hold);
    for (const k of ['alt', 'spd']) {
      const list = dial[k + 'List'], cur = k === 'alt' ? ac.cfl : ac.spd;
      [...dial[k + 'El'].children].forEach((it, i) => {
        it.classList.toggle('on', list[i] === dial[k]);
        it.classList.toggle('changed', list[i] === dial[k] && list[i] !== cur);
      });
    }
    dial.btn.ils.classList.toggle('on', dial.ils);
    dial.btn.ils.disabled = ac.ils;
    if (ac.ils) dial.btn.ils.textContent = ac.loc ? `On the ILS` : `ILS ${World.runway} cleared`;
    dial.btn.twr.classList.toggle('on', dial.twr);
    dial.btn.twr.disabled = !ac.loc || ac.freq !== 'mine';
    for (const f of Object.keys(World.fixes)) dial.btn['hold:' + f].classList.toggle('on', dial.hold === f);
    const cmds = dialCmds();
    dial.send.disabled = !cmds.length;
    dial.send.textContent = cmds.length ? `Send ▸ “${Command.brief(cmds, ac, FIXNAMES)}”` : 'Nothing to send';
  }

  function sendDial() {
    if (!dial) return false;
    const cmds = dialCmds();
    if (!cmds.length) return false;
    const cs = dial.cs;
    closeDial();
    // Tapping the aircraft put its callsign in the command line; it's said now.
    if (cmdEl.value.trim() === cs) { cmdEl.value = ''; preview(); }
    return issue(cs, cmds, 'dial');
  }
  function closeDial() {
    if ($('dial')) $('dial').remove();
    dial = null;
  }

  // ---------- the command line ----------
  const cmdEl = $('cmd');
  const ctx = () => ({ callsigns: sim.aircraft.filter(a => a.state === 'air' && a.freq === 'mine').map(a => a.cs), fixes: FIXNAMES, runway: World.runway });
  function fillCallsign(cs) {
    const v = cmdEl.value.trim();
    const rest = v.split(/\s+/).slice(1).join(' ');
    cmdEl.value = cs + ' ' + (rest && !Command.parse(v, ctx()).cs ? '' : rest);
    preview();
  }
  function preview() {
    const v = cmdEl.value;
    const hint = $('cmd-hint');
    if (!v.trim()) { hint.textContent = 'e.g. SKY412 L270 D40 S210 · ILS · TWR · HOLD DNK'; hint.className = 'cmd-hint'; return; }
    const r = Command.parse(v, ctx());
    if (r.cs && r.cs !== S.selected) select(r.cs, 'type');
    if (r.ok) {
      const ac = sim.find(r.cs);
      hint.textContent = `↵ ${r.cs}: ${Command.brief(r.cmds, ac || { hdg: 0 }, FIXNAMES)}`;
      hint.className = 'cmd-hint good';
    } else {
      hint.textContent = r.needsMore ? `${r.cs}: L270 · D40 · S210 · ILS · TWR` : r.error;
      hint.className = 'cmd-hint';
    }
  }
  function submitLine(text = cmdEl.value) {
    Radio.unlock();
    if (!text.trim() || S.paused) return false;
    const r = Command.parse(text, ctx());
    if (!r.ok) { note(r.error); return false; }
    S.history.unshift(r.canonical);
    S.history.length = Math.min(S.history.length, 30);
    S.histAt = -1;
    cmdEl.value = '';
    const ok = issue(r.cs, r.cmds, 'line');
    if (ok) preview();
    return ok;
  }
  cmdEl.addEventListener('input', preview);
  cmdEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submitLine(); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      const parts = cmdEl.value.split(/\s+/);
      const found = Command.complete(parts[0], ctx().callsigns);
      if (found.length === 1) { parts[0] = found[0]; cmdEl.value = parts.join(' ') + (parts.length === 1 ? ' ' : ''); }
      else if (found.length > 1) {
        let p = found[0];
        for (const f of found) while (!f.startsWith(p)) p = p.slice(0, -1);
        parts[0] = p; cmdEl.value = parts.join(' ');
        $('cmd-hint').textContent = found.join(' · ');
      }
      preview();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (S.history.length) { S.histAt = Math.min(S.history.length - 1, S.histAt + 1); cmdEl.value = S.history[S.histAt]; preview(); }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      S.histAt = Math.max(-1, S.histAt - 1);
      cmdEl.value = S.histAt >= 0 ? S.history[S.histAt] : '';
      preview();
    } else if (e.key === 'Escape') { cmdEl.value = ''; preview(); closeDial(); }
  });
  document.addEventListener('keydown', e => {
    Radio.unlock();
    if (e.key === 'Escape' && dial) closeDial();
    // Typing anywhere goes to the command line.
    if (!S.paused && document.activeElement !== cmdEl && /^[a-z0-9]$/i.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey
        && !(document.activeElement && /INPUT|TEXTAREA|BUTTON/.test(document.activeElement.tagName) && document.activeElement !== document.body)) {
      cmdEl.focus();
    }
  });

  // ---------- strips ----------
  let stripSig = '';
  function stripRoute(ac) {
    const from = ac.entry && ac.mode !== 'route' && ac.mode !== 'hold' ? `${ac.entry} → ` : '';
    const where = ac.freq === 'tower' ? 'Tower' : ac.loc ? `LOC ${World.runway}` : ac.ils ? `ILS ${World.runway}`
      : ac.mode === 'hold' ? `${ac.hold.fix} hold` : ac.mode === 'route' ? `${ac.entry} arrival`
      : `HDG ${pad3(ac.thdg != null ? ac.thdg : ac.hdg) === '000' ? '360' : pad3(ac.thdg != null ? ac.thdg : ac.hdg)}`;
    const arrow = ac.cfl < ac.alt - 50 ? '↓' : ac.cfl > ac.alt + 50 ? '↑' : ' ';
    return `${from}${where} · ${pad3(ac.alt / 100)}${arrow}${pad3(ac.cfl / 100)} · ${ac.spd}`;
  }
  function drawStrips(force) {
    const conflicts = new Set();
    for (const c of sim.conflicts) { conflicts.add(c.a); conflicts.add(c.b); }
    const live = sim.aircraft.filter(a => a.state === 'air');
    const bays = [['Inbound', live.filter(a => a.freq === 'mine' && a.mode !== 'hold')]];
    for (const f of Object.keys(World.fixes)) bays.push([`Holding · ${f}`, live.filter(a => a.freq === 'mine' && a.mode === 'hold' && a.hold && a.hold.fix === f)]);
    bays.push(['Tower', live.filter(a => a.freq === 'tower')]);
    const sig = JSON.stringify([S.selected, [...conflicts], bays.map(([n, l]) => [n, l.map(a => a.cs + stripRoute(a))])]);
    if (!force && sig === stripSig) return;
    stripSig = sig;
    const box = $('strips');
    box.textContent = '';
    for (const [name, list] of bays) {
      if (!list.length && name !== 'Inbound') continue;
      const h = document.createElement('div');
      h.className = 'bay'; h.textContent = name;
      box.append(h);
      for (const ac of list) {
        const s = document.createElement('button');
        s.className = 'strip' + (ac.cs === S.selected ? ' sel' : '') + (conflicts.has(ac.cs) ? ' conflict' : '') + (ac.freq === 'tower' ? ' tower' : '') + (ac.mode === 'hold' ? ' holding' : '');
        s.dataset.cs = ac.cs;
        const edge = document.createElement('i');
        const cs = document.createElement('span'); cs.className = 'cs'; cs.textContent = ac.cs;
        const ty = document.createElement('span'); ty.className = 'ty'; ty.textContent = `${ac.type} / ${ac.wake}`;
        const rt = document.createElement('span'); rt.className = 'rt'; rt.textContent = stripRoute(ac);
        s.append(edge, cs, ty, rt);
        s.onclick = () => {
          Radio.unlock();
          if (S.paused) return;
          select(ac.cs, 'strip');
          if (ac.freq === 'mine') openDial(ac);
          fillCallsign(ac.cs);
        };
        box.append(s);
      }
      if (!list.length) {
        const empty = document.createElement('div');
        empty.className = 'bay-empty'; empty.textContent = 'Nothing inbound';
        box.append(empty);
      }
    }
  }

  // ---------- top bar ----------
  function topBar() {
    const d = new Date(S.clock0 + sim.t * 1000);
    $('clock').textContent = `${S.mode === 'lesson' ? 'Training' : 'Live'} · ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}Z`;
    $('traffic').textContent = `Traffic ${sim.aircraft.filter(a => a.state === 'air' && a.freq === 'mine').length}`;
  }
  function setSpeed(v) {
    S.speed = v;
    $('btn-speed').textContent = v > 1 ? '×2 · fast' : '×1';
    $('btn-speed').classList.toggle('on', v > 1);
  }
  $('btn-speed').onclick = () => { Radio.unlock(); setSpeed(S.speed > 1 ? 1 : 2); };
  function setMuted(m) {
    save.muted = m; persist();
    Radio.setMuted(m);
    $('btn-sound').textContent = m ? 'Sound off' : 'Sound on';
    $('btn-sound').classList.toggle('off', m);
  }
  $('btn-sound').onclick = () => { Radio.unlock(); setMuted(!save.muted); };
  $('btn-menu').onclick = () => openMenu();
  let alertTimer = 0;
  function flashAlert() {
    document.body.classList.add('alerting');
    clearTimeout(alertTimer);
    alertTimer = setTimeout(() => document.body.classList.remove('alerting'), 1200);
  }

  // ---------- sessions ----------
  function reset(mode) {
    closeDial();
    Radio.clear();
    sim = Sim.create();
    S.mode = mode; S.selected = null; S.fast = 0; S.clock0 = Date.now(); S.lesson = null; S.shift = null;
    $('log').textContent = ''; S.log = [];
    cmdEl.value = ''; preview();
    setSpeed(1);
    document.body.classList.toggle('in-lesson', mode === 'lesson');
    $('lesson').classList.toggle('hidden', mode !== 'lesson');
    stripSig = '';
  }
  const VOICE_COUNT = Math.max(1, Radio.VOICES.length);
  let voiceTurn = 0;
  function spawn(spec) {
    return sim.spawn(Object.assign({ voice: voiceTurn++ % VOICE_COUNT }, spec));
  }

  // ---------- lessons ----------
  function lessonHandle() {
    const L = S.lesson;
    return { sim, find: cs => sim.find(cs), taskTime: L ? sim.t - L.taskStart : 0, memo: L ? L.memo : {}, instructed: L ? L.instructed : false, spawn };
  }
  function startLesson(n) {
    const def = LESSONS.find(l => l.id === n);
    if (!def || !unlocked(n)) return false;
    reset('lesson');
    S.lesson = { def, task: 0, taskStart: 0, memo: {}, instructed: false, done: false, failed: null, quiz: -1, wrong: false, praise: '' };
    def.setup(lessonHandle());
    $('where').textContent = `Academy · Lesson ${n} · ${def.title}`;
    closeMenu();
    S.paused = false;
    drawLesson();
    drawStrips(true);
    return true;
  }
  function lessonEvent(ev) {
    const L = S.lesson;
    if (!L || L.done || L.failed || S.mode !== 'lesson') return;
    if (ev && ev.kind === 'instruction') L.instructed = true;
    const g = lessonHandle();
    // Once the tasks are done the check is all that's left: nothing on the
    // scope can fail the lesson then.
    const why = L.quiz < 0 && L.def.fail && L.def.fail(g, ev);
    if (why) { L.failed = why; drawLesson(); return; }
    const t = L.def.tasks[L.task];
    if (t && t.done(g, ev)) {
      L.praise = t.praiseFor ? t.praiseFor(g, ev) : t.praise || '';
      L.task++;
      L.taskStart = sim.t;
      L.memo = {};
      Radio.blip();
      if (L.task >= L.def.tasks.length) L.quiz = 0;
      drawLesson();
    }
  }
  function lessonTick() { if (S.lesson) lessonEvent(null); }

  function drawLesson() {
    const L = S.lesson, box = $('lesson');
    if (!L) return;
    box.textContent = '';
    const h3 = document.createElement('h3');
    h3.textContent = `Lesson ${L.def.id} of ${LESSONS.length}`;
    const h2 = document.createElement('h2');
    h2.textContent = L.def.title;
    box.append(h3, h2);
    if (L.task === 0 && !L.failed) {
      const p = document.createElement('p'); p.className = 'intro'; p.textContent = L.def.intro; box.append(p);
    }
    const ul = document.createElement('ul');
    L.def.tasks.forEach((t, i) => {
      const li = document.createElement('li');
      li.className = i < L.task ? 'done' : i === L.task && !L.failed ? 'now' : '';
      li.textContent = t.text;
      ul.append(li);
    });
    box.append(ul);
    const coach = document.createElement('div');
    coach.className = 'coach';
    const face = document.createElement('span'); face.className = 'face'; face.textContent = 'AN';
    const say = document.createElement('span');
    const t = L.def.tasks[L.task];
    if (L.failed) say.textContent = `“${L.failed}”`;
    else if (L.done) say.textContent = `“${L.praise ? L.praise + ' ' : ''}Lesson passed. ${L.def.id < LESSONS.length ? 'On to the next one when you’re ready.' : 'You’re ready for a shift.'}”`;
    else if (t) say.textContent = `“${L.praise ? L.praise + ' ' : ''}${t.coach}”`;
    else say.textContent = `“${L.praise ? L.praise + ' ' : ''}Before the next lesson, a quick check.”`;
    coach.append(face, say);
    box.append(coach);
    if (L.quiz >= 0 && !L.done && !L.failed) {
      const q = L.def.quiz[L.quiz];
      const quiz = document.createElement('div');
      quiz.className = 'quiz' + (L.wrong ? ' wrong' : '');
      const head = document.createElement('div'); head.className = 'q-head'; head.textContent = `Check · ${L.quiz + 1} of ${L.def.quiz.length}`;
      const qq = document.createElement('div'); qq.className = 'q'; qq.textContent = q.q;
      quiz.append(head, qq);
      q.options.forEach((o, i) => {
        const b = document.createElement('button');
        b.className = 'q-opt'; b.textContent = o;
        b.onclick = () => answer(i);
        quiz.append(b);
      });
      if (L.wrong) { const w = document.createElement('div'); w.className = 'q-wrong'; w.textContent = 'Not quite. Have another look.'; quiz.append(w); }
      box.append(quiz);
    }
    const buttons = document.createElement('div');
    buttons.className = 'l-buttons';
    const btn = (label, cls, fn) => { const b = document.createElement('button'); b.className = 'fv-btn ' + cls; b.textContent = label; b.onclick = fn; buttons.append(b); return b; };
    if (L.done) {
      if (L.def.id < LESSONS.length) btn(`Lesson ${L.def.id + 1}`, 'primary', () => startLesson(L.def.id + 1));
      else btn('Start a shift', 'primary', () => startShift());
      btn('Academy', 'ghost', () => openMenu(true));
    } else {
      btn(L.failed ? 'Try again' : 'Restart', L.failed ? 'primary' : 'ghost', () => startLesson(L.def.id));
      btn('Academy', 'ghost', () => openMenu());
    }
    box.append(buttons);
  }
  function answer(i) {
    const L = S.lesson;
    if (!L || L.quiz < 0 || L.done) return false;
    const q = L.def.quiz[L.quiz];
    if (i !== q.answer) { L.wrong = true; drawLesson(); return false; }
    L.wrong = false;
    L.quiz++;
    if (L.quiz >= L.def.quiz.length) passLesson();
    drawLesson();
    return true;
  }
  function passLesson() {
    const L = S.lesson;
    L.done = true;
    L.praise = '';
    if (!save.lessons[L.def.id]) save.lessons[L.def.id] = { at: new Date().toISOString() };
    queueRecord({ kind: 'lessons', body: { lesson: L.def.id } });
    persist();
  }

  // ---------- the shift ----------
  // About twelve minutes of arrivals at Ambleford, from both stacks.
  const SHIFT = { arrivals: 8, firstGap: 40, gapMin: 75, gapMax: 105, limit: 25 * 60 };
  const TYPE_MIX = ['A320', 'A320', 'A320', 'B738', 'B738', 'B738', 'E190', 'E190', 'DH8D', 'DH8D', 'B77W', 'A333', 'BE20'];
  const pickOf = list => list[Math.floor(Math.random() * list.length)];
  function startShift() {
    if (!shiftOpen()) return false;
    reset('shift');
    S.shift = { started: 0, next: 2, spawned: 0, used: new Set(), endAt: null, ended: false, entries: [] };
    $('where').textContent = `${World.position} · Shift`;
    closeMenu();
    S.paused = false;
    drawStrips(true);
    logLine('sys', `Your shift at ${World.name}: ${SHIFT.arrivals} arrivals from Dunnock and Linnet. Vector them onto the ILS for runway ${World.runway}, three miles apart, and hand them to the tower by 8 miles.`);
    return true;
  }
  function newCallsign(used) {
    for (;;) {
      const des = pickOf(Object.keys(Command.AIRLINES));
      const n = Math.random() < 0.3 ? 1 + Math.floor(Math.random() * 9) : Math.random() < 0.6 ? 10 + Math.floor(Math.random() * 90) : 100 + Math.floor(Math.random() * 800);
      const cs = des + n;
      if (!used.has(cs) && !sim.find(cs) && !used.has(des + String(n).slice(0, 2))) { used.add(cs); return cs; }
    }
  }
  // A new arrival joins the top of its stack, as the sector before ours
  // would clear it: never down through aircraft already holding there.
  function stackLevel(fix) {
    const there = sim.aircraft.filter(a => a.state === 'air' && a.entry === fix && (a.mode === 'route' || a.mode === 'hold'));
    return there.length ? Math.max(...there.map(a => a.cfl)) + 1000 : World.stackBase;
  }
  function shiftTick() {
    const sh = S.shift;
    if (!sh || sh.ended) return;
    if (sh.spawned < SHIFT.arrivals && sim.t >= sh.next) {
      const fix = sh.spawned % 2 ? 'LNT' : 'DNK';
      const [x, y] = World.routes[fix][0];
      const lvl = stackLevel(fix);
      const alt = Math.max(lvl, 10000 + Math.floor(Math.random() * 3) * 1000);
      // Never on top of someone: wait a little if the entry's busy.
      const busy = sim.aircraft.some(a => a.state === 'air' && Math.hypot(a.x - x, a.y - y) < 7 && Math.abs(a.alt - alt) < 2000);
      if (busy) sh.next = sim.t + 10;
      else {
        const ac = spawn({ cs: newCallsign(sh.used), type: pickOf(TYPE_MIX), route: fix, x, y, alt, cfl: lvl, ias: 250 });
        sh.spawned++;
        sh.next = sim.t + (sh.spawned === 1 ? SHIFT.firstGap : SHIFT.gapMin + Math.random() * (SHIFT.gapMax - SHIFT.gapMin));
        const hour = new Date(S.clock0 + sim.t * 1000).getUTCHours();
        pilot(ac, Command.checkInKeys(ac, FIXNAMES[fix], hour));
      }
    }
    const flying = sim.aircraft.some(a => a.state === 'air');
    if (sh.spawned >= SHIFT.arrivals && !flying && sh.endAt === null) sh.endAt = sim.t + 4;
    if ((sh.endAt !== null && sim.t >= sh.endAt) || sim.t >= SHIFT.limit) endShift();
  }
  function shiftResult() {
    const st = sim.stats, sh = S.shift;
    const delays = st.delays;
    return {
      id: sh.id || (sh.id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10))),
      duration: Math.round(sim.t), arrivals: sh.spawned, landed: st.landed, losses: st.losses, alerts: st.alerts,
      on_time: st.onTime, late: st.late, missed: st.missed, through: st.through, left: st.left,
      delay: delays.length ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : 0,
      fast: Math.round(S.fast),
    };
  }
  function endShift() {
    const sh = S.shift;
    if (!sh || sh.ended) return null;
    sh.ended = true;
    S.paused = true;
    closeDial();
    const r = shiftResult();
    save.shifts = (save.shifts || 0) + 1;
    if (!save.best || r.losses < save.best.losses || (r.losses === save.best.losses && r.delay < save.best.delay)) save.best = { losses: r.losses, delay: r.delay, landed: r.landed };
    persist();
    queueRecord({ kind: 'shifts', body: r });
    showDebrief(r);
    return r;
  }
  const mmss = s => `${Math.floor(s / 60)}:${pad2(Math.round(s % 60))}`;
  function showDebrief(r) {
    const rows = [
      ['Landed', `${r.landed} of ${r.arrivals}`],
      ['Losses of separation', String(r.losses), r.losses ? 'bad' : 'good'],
      ['Conflict alerts', String(r.alerts), r.alerts ? 'warn' : 'good'],
      ['Handoffs on time', `${r.on_time}`, ''],
      ['Late handoffs', String(r.late), r.late ? 'warn' : 'good'],
      ['Missed handoffs', String(r.missed), r.missed ? 'bad' : 'good'],
      ['Through the localiser', String(r.through), r.through ? 'warn' : 'good'],
      ['Average delay', mmss(r.delay), r.delay > 240 ? 'warn' : ''],
      ['Shift length', `${mmss(r.duration)}${r.fast ? ` · ${mmss(r.fast)} at ×2` : ''}`],
    ];
    if (r.left) rows.splice(7, 0, ['Left your airspace', String(r.left), 'bad']);
    const table = $('debrief-rows');
    table.textContent = '';
    for (const [k, v, cls] of rows) {
      const row = document.createElement('div');
      row.className = 'd-row ' + (cls || '');
      const a = document.createElement('span'); a.textContent = k;
      const b = document.createElement('b'); b.textContent = v;
      row.append(a, b);
      table.append(row);
    }
    $('debrief-verdict').textContent = r.losses
      ? `“${r.losses === 1 ? 'One loss of separation' : `${r.losses} losses of separation`}. Look for the alerts sooner, and give vertical early: it takes time.”`
      : r.missed || r.late
        ? '“Safe all shift. Now get them to the tower by 8 miles: the tower needs time to plan.”'
        : r.landed === r.arrivals
          ? '“Every one down safely and handed over in good time. That’s a proper shift.”'
          : '“Safe, but not everyone got down. Keep the flow moving out of the stacks.”';
    $('debrief').classList.remove('hidden');
  }
  $('btn-debrief-again').onclick = () => { $('debrief').classList.add('hidden'); startShift(); };
  $('btn-debrief-menu').onclick = () => { $('debrief').classList.add('hidden'); openMenu(true); };

  // ---------- the menu (the Academy) ----------
  function openMenu(ended) {
    closeDial();
    if (ended) { S.mode = 'menu'; S.paused = true; }
    S.paused = true;
    const resumable = S.mode !== 'menu' && !(S.shift && S.shift.ended) && !(S.lesson && S.lesson.done);
    $('btn-resume').classList.toggle('hidden', !resumable);
    const list = $('lesson-list');
    list.textContent = '';
    for (const L of LESSONS) {
      const row = document.createElement('button');
      const open = unlocked(L.id);
      row.className = 'm-row' + (passed(L.id) ? ' passed' : '') + (open ? '' : ' locked');
      row.disabled = !open;
      row.innerHTML = '';
      const n = document.createElement('span'); n.className = 'm-n'; n.textContent = L.id;
      const t = document.createElement('span'); t.className = 'm-t';
      const tt = document.createElement('b'); tt.textContent = L.title;
      const ts = document.createElement('small'); ts.textContent = L.learn;
      t.append(tt, ts);
      const st = document.createElement('span'); st.className = 'm-s';
      st.textContent = passed(L.id) ? 'Passed ✓' : open ? 'Start' : 'Locked';
      row.append(n, t, st);
      row.onclick = () => startLesson(L.id);
      list.append(row);
    }
    const sb = $('btn-shift');
    sb.disabled = !shiftOpen();
    $('shift-note').textContent = shiftOpen()
      ? `About twelve minutes of arrivals into ${World.name}, then a debrief.${save.shifts ? ` Shifts so far: ${save.shifts}.` : ''}`
      : 'Opens once you’ve passed lesson 5.';
    const mine = me();
    $('m-who').textContent = mine ? `Signed in as ${mine.name}: your lessons go on the family records.` : 'Playing as a guest: lessons are kept on this device. Add yourself on the Game Night hub to keep them on your profile.';
    $('menu').classList.remove('hidden');
  }
  function closeMenu() { $('menu').classList.add('hidden'); }
  $('btn-resume').onclick = () => { closeMenu(); S.paused = false; };
  $('btn-shift').onclick = () => startShift();

  // ---------- family records ----------
  const me = () => (typeof GN !== 'undefined' && GN.me.get()) || null;
  function queueRecord(item) {
    if (!me()) return;
    save.outbox = (save.outbox || []).concat([item]).slice(-30);
    persist();
    flush();
  }
  let flushing = false;
  async function flush() {
    if (flushing || !me() || !(save.outbox || []).length) return;
    flushing = true;
    try {
      while (save.outbox.length) {
        const item = save.outbox[0];
        let res;
        try {
          res = await fetch(`/final-vector/api/${item.kind}`, {
            method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, GN.me.headers()), body: JSON.stringify(item.body),
          });
        } catch { break; }
        if (res.status >= 500) break;
        save.outbox.shift();             // recorded, or refused for good
        persist();
      }
    } finally { flushing = false; }
  }
  // Lessons passed on this device before signing in, or on another device
  // signed in as the same profile: both ways.
  async function syncLessons() {
    const mine = me();
    if (!mine) return;
    try {
      const data = await (await fetch('/final-vector/api/stats')).json();
      const player = (data.players || []).find(p => GN.fold(p.name) === GN.fold(mine.name));
      const there = new Set(player ? player.lessons : []);
      for (const n of there) if (!save.lessons[n]) save.lessons[n] = { at: new Date().toISOString() };
      const missing = LESSONS.map(L => L.id).filter(n => save.lessons[n] && !there.has(n));
      const queued = new Set((save.outbox || []).filter(i => i.kind === 'lessons').map(i => i.body.lesson));
      for (const n of missing) if (!queued.has(n)) save.outbox.push({ kind: 'lessons', body: { lesson: n } });
      persist();
      flush();
      if (!$('menu').classList.contains('hidden')) openMenu(S.mode === 'menu');
    } catch { /* offline: the next visit will */ }
  }

  // ---------- the loop ----------
  let last = performance.now(), hud = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!S.paused && S.mode !== 'menu') advance(dt * S.speed);
    scope.draw(sim, ui());
    if (dial) paintDial();
    if (now - hud > 250) { hud = now; drawStrips(); topBar(); }
    requestAnimationFrame(frame);
  }
  window.addEventListener('resize', () => { scope.resize(); closeDial(); });

  // A first look: the empty scope behind the Academy.
  const fontsReady = document.fonts && document.fonts.load
    ? Promise.all([document.fonts.load('600 12px Oswald'), document.fonts.load('500 14px Barlow')]).catch(() => {})
    : Promise.resolve();
  Promise.race([fontsReady, new Promise(r => setTimeout(r, 2000))]).then(() => {
    scope.resize();
    setMuted(!!save.muted);
    preview();
    openMenu(true);
    if (typeof GN !== 'undefined') GN.profiles.load().then(() => openMenu(S.mode === 'menu')).catch(() => {});
    syncLessons();
    flush();
    requestAnimationFrame(frame);
  });
  document.addEventListener('pointerdown', () => Radio.unlock(), { once: true });

  // Exposed for automated checks only.
  window.__finalVector = {
    FV: window.FV, S, save, scope,
    get sim() { return sim; },
    step: seconds => advance(seconds),
    parse: text => Command.parse(text, ctx()),
    command: text => { cmdEl.value = text; return submitLine(text); },
    issue, select, startLesson, startShift, endShift, answer, openMenu,
    openDial: cs => { const ac = sim.find(cs); if (ac) { select(cs); openDial(ac); } return !!dial; },
    get dial() { return dial; },
    setDial: v => { Object.assign(dial, v); paintDial(); return dialCmds(); },
    sendDial, closeDial, setSpeed, lessonEvent,
    radio: Radio.state, get log() { return S.log; }, spawn,
    get lesson() { return S.lesson; },
  };
})();
