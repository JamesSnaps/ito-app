// Fugitive's look, sound and motion, shared by its pages. Plain globals, no
// modules — no build step, and each page is one inline script on top of this.
//
// Everything here is drawn or synthesised on the spot: the card art is SVG
// built from the card's number, the sounds are noise and sine waves. Nothing
// to license, nothing to download, and nothing fetched from a third party
// mid-game (the app has to work on a LAN with no internet).

// ------------------------------------------------------------------ DOM

// Names are typed at the table and go straight back on screen, so anything
// carrying one is built as DOM nodes: textContent can't be got wrong. The
// card art below is the exception — built as SVG markup, but only ever from
// numbers.
function el(tag, attrs, children){
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    // setProperty, not Object.assign: custom properties (--w, --under) set
    // as plain keys are silently dropped.
    else if (k === 'style' && typeof v === 'object') for (const [p, x] of Object.entries(v)) node.style.setProperty(p, x);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  (children || []).forEach(c => c != null && c !== false &&
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return node;
}

// ------------------------------------------------------------------ art

const FG = {
  // Which leg of the escape a card belongs to: the rulebook's deck icons
  // (on foot, by car, by plane), plus the cell you broke out of and the
  // plane out.
  era(n){
    if (n === 0) return 'cell';
    if (n === 42) return 'escape';
    if (n <= 14) return 'foot';
    if (n <= 28) return 'car';
    return 'plane';
  },
  deckOf(n){ return n >= 29 ? 2 : n >= 15 ? 1 : 0; },
  uid: 0
};

// Same number, same drawing, every time and on every device.
function seeded(n){
  let a = (n * 7919 + 101) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ICON_PATHS = {
  foot: 'M13.5 4.5a2 2 0 1 0 0-.1M10 21l2-6 2.5 2.5V21M8 12.5l2.5-4.5 3 1 2.5 3.5M10.5 8l-1 5 3.5 2',
  car: 'M3 14l2-5h14l2 5v4h-3M6 18H3v-4h18M7 18a2 2 0 1 0 4 0 2 2 0 1 0-4 0M15 18a2 2 0 1 0 4 0 2 2 0 1 0-4 0',
  plane: 'M2.5 13.5l19-6-6 6 2 6-3-2.5-3 3 .5-4.5L2.5 13.5',
  star: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z',
  soundOn: 'M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  soundOff: 'M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6'
};
function icon(name, cls){
  return `<svg class="fg-icon ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON_PATHS[name]}"/></svg>`;
}
function iconEl(name, cls){ return el('span', {class: 'fg-icon-wrap', html: icon(name, cls)}); }

// One shoe print, toe up, with the gap at the arch; `x, y` is the toe.
// A right foot is the left one mirrored.
const SOLE = 'M0 0c2.4 0 3.5 2.2 3.3 4.9-.2 2-1.1 3.1-1.3 4.1H-2.2c-.4-1.2-1.2-2.4-1.1-4.4C-3.1 2-1.9 0 0 0z' +
             'M-1.9 10.4h3.8c.3 1.1.4 2.3-.1 3.2-.5.8-1.3 1.1-1.9 1.1s-1.5-.3-1.9-1.1c-.4-.9-.2-2.1.1-3.2z';
function footprint(x, y, right){
  return `<path transform="translate(${x} ${y}) rotate(${right ? 10 : -10}) scale(${right ? -0.9 : 0.9} 0.9)" d="${SOLE}"/>`;
}

const PALETTE = {
  cell:   {sky: ['#2b3242', '#3d4658'], ink: '#1a1f2b', glow: '#cfd8e8'},
  foot:   {sky: ['#14223d', '#2c4772'], ink: '#0c1528', glow: '#f2c66d'},
  car:    {sky: ['#102a33', '#2b5f6b'], ink: '#08181e', glow: '#fff1c2'},
  plane:  {sky: ['#241d42', '#7a4f80'], ink: '#140f26', glow: '#ffd59a'},
  escape: {sky: ['#f6a35b', '#f7d488'], ink: '#3b2032', glow: '#fff4d6'}
};

function skyline(r, ink, glow, base, maxH, windows){
  let out = '';
  for (let x = 4; x < 96;) {
    const w = 7 + Math.floor(r() * 9);
    const h = maxH * (0.35 + r() * 0.65);
    out += `<rect x="${x}" y="${base - h}" width="${w}" height="${h + 2}" fill="${ink}"/>`;
    if (windows) {
      for (let wy = base - h + 4; wy < base - 4; wy += 6) {
        for (let wx = x + 2; wx < x + w - 2; wx += 4) {
          if (r() < 0.32) out += `<rect x="${wx}" y="${wy}" width="2" height="2.6" fill="${glow}" opacity="${0.55 + r() * 0.45}"/>`;
        }
      }
    }
    x += w + (r() < 0.3 ? 2 : 0);
  }
  return out;
}

function scene(n, id){
  const era = FG.era(n), p = PALETTE[era], r = seeded(n);
  let s = `<defs><linearGradient id="sky${id}" x1="0" y1="0" x2="0" y2="1">` +
          `<stop offset="0" stop-color="${p.sky[0]}"/><stop offset="1" stop-color="${p.sky[1]}"/></linearGradient>` +
          `<clipPath id="win${id}"><rect x="7" y="7" width="86" height="84" rx="5"/></clipPath></defs>`;
  s += `<g clip-path="url(#win${id})"><rect x="0" y="0" width="100" height="100" fill="url(#sky${id})"/>`;
  // Stars, then a moon somewhere different on every card.
  if (era !== 'escape' && era !== 'cell') {
    for (let i = 0; i < 9; i++) s += `<circle cx="${8 + r() * 84}" cy="${9 + r() * 34}" r="${0.4 + r() * 0.6}" fill="#fff" opacity="${0.4 + r() * 0.5}"/>`;
    // Clear of the corner number.
    const mx = 40 + r() * 46;
    s += `<circle cx="${mx}" cy="${18 + r() * 10}" r="6" fill="${p.glow}" opacity="0.9"/>`;
  }
  if (era === 'cell') {
    // The cell: block wall, a barred window and the moon you're heading for.
    for (let y = 10; y < 92; y += 7) {
      for (let x = (y / 7) % 2 ? 4 : 0; x < 100; x += 14) {
        s += `<rect x="${x}" y="${y}" width="13" height="6" fill="#4a5466" opacity="0.65"/>`;
      }
    }
    s += `<rect x="30" y="22" width="40" height="32" rx="3" fill="#1b2232"/><circle cx="58" cy="32" r="6" fill="${p.glow}"/>`;
    for (let x = 36; x < 70; x += 8) s += `<rect x="${x}" y="22" width="2.4" height="32" fill="#8e98aa"/>`;
    s += `<path d="M24 92 L38 70 L44 72 L40 92 Z" fill="#8e98aa" opacity="0.5"/>`;
  } else if (era === 'foot') {
    s += skyline(r, p.ink, p.glow, 80, 50, true);
    // A streetlamp and its pool of light.
    const lx = 14 + r() * 70;
    s += `<polygon points="${lx - 2},48 ${lx + 2},48 ${lx + 16},92 ${lx - 16},92" fill="${p.glow}" opacity="0.13"/>` +
         `<rect x="${lx - 0.8}" y="48" width="1.6" height="40" fill="#0a0f1c"/><circle cx="${lx}" cy="48" r="2.4" fill="${p.glow}"/>`;
    s += `<rect x="0" y="80" width="100" height="20" fill="#0b1222"/>`;
  } else if (era === 'car') {
    s += skyline(r, p.ink, p.glow, 62, 30, true);
    // The road, its centre line, and a car's headlights cutting across it.
    s += `<polygon points="0,62 100,62 100,100 0,100" fill="#0d1d23"/>`;
    for (let x = 4; x < 100; x += 14) s += `<rect x="${x}" y="77" width="7" height="1.6" fill="#f2c66d" opacity="0.8"/>`;
    const cx = 18 + r() * 50, dir = r() < 0.5 ? 1 : -1;
    const tip = cx + dir * 46;
    s += `<polygon points="${cx + dir * 12},70 ${tip},62 ${tip},84" fill="${p.glow}" opacity="0.22"/>`;
    s += `<path d="M${cx - 12} 76 l3-6 h18 l3 6 v4 h-24z" fill="#05090c" transform="scale(${dir} 1) translate(${dir < 0 ? -2 * cx : 0} 0)"/>`;
    s += `<circle cx="${cx + dir * 12}" cy="73.5" r="1.6" fill="${p.glow}"/>`;
  } else if (era === 'plane') {
    s += skyline(r, p.ink, p.glow, 78, 22, true);
    s += `<rect x="0" y="78" width="100" height="22" fill="#120d22"/>`;
    for (let x = 6; x < 100; x += 9) s += `<circle cx="${x}" cy="86" r="1.1" fill="${r() < 0.5 ? '#ffd59a' : '#9fd3ff'}"/>`;
    const px = 20 + r() * 50, py = 28 + r() * 16;
    s += `<g transform="translate(${px} ${py}) rotate(${-8 - r() * 10}) scale(1.3)" fill="#0d0a1a">` +
         `<path d="M-14 0 h22 l6 -2 l1 2 l-6 2 h-22z M-2 0 l-6 -8 h3 l9 8z M-2 1 l-6 7 h3 l9 -7z M-14 0 l-3 -5 h2 l4 5z"/></g>`;
  } else {
    // 42: the plane out, climbing into the sunrise.
    s += `<circle cx="50" cy="78" r="26" fill="#fff4d6" opacity="0.85"/>`;
    for (let i = 0; i < 5; i++) s += `<rect x="0" y="${74 + i * 5}" width="100" height="1.4" fill="#f7d488" opacity="0.6"/>`;
    s += skyline(r, '#5a2f45', p.glow, 92, 14, false);
    s += `<g transform="translate(58 36) rotate(-18) scale(1.6)" fill="${p.ink}">` +
         `<path d="M-14 0 h22 l6 -2 l1 2 l-6 2 h-22z M-2 0 l-6 -8 h3 l9 8z M-2 1 l-6 7 h3 l9 -7z M-14 0 l-3 -5 h2 l4 5z"/></g>`;
    s += `<path d="M10 66 q20 -10 36 -26" stroke="#fff4d6" stroke-width="1.2" fill="none" stroke-dasharray="2 3"/>`;
  }
  return s + '</g>';
}

// A card face: art window, the number, footprints and the deck icon, framed
// like a printed card.
function cardSVG(n, steps){
  const id = `c${n}-${++FG.uid}`;
  const era = FG.era(n);
  const ink = era === 'escape' ? '#7a3b2a' : '#13213a';
  let prints = '';
  for (let i = 0; i < steps; i++) prints += footprint(79 + i * 9, 103 - (i % 2) * 3, i % 2);
  const deckIcon = n >= 4 && n <= 41 ? ['foot', 'car', 'plane'][FG.deckOf(n)] : null;
  return `<svg class="fg-art" viewBox="0 0 100 140" aria-hidden="true">` +
    `<rect x="1" y="1" width="98" height="138" rx="9" fill="#f3ead8"/>` +
    `<rect x="4" y="4" width="92" height="132" rx="7" fill="none" stroke="${ink}" stroke-opacity="0.25"/>` +
    scene(n, id) +
    `<rect x="7" y="7" width="22" height="17" rx="4" fill="#f3ead8" opacity="0.92"/>` +
    `<text x="18" y="20.5" text-anchor="middle" class="fg-art-corner" fill="${ink}">${n}</text>` +
    `<text x="50" y="128" text-anchor="middle" class="fg-art-num" fill="${ink}">${n}</text>` +
    `<g fill="${ink}" opacity="0.75">${prints}</g>` +
    (deckIcon ? `<g transform="translate(9 101) scale(0.62)" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"><path d="${ICON_PATHS[deckIcon]}"/></g>` : '') +
    `</svg>`;
}

// The back every hidden card shares — no deck icon, or it would give away
// which third of the trail a face-down hideout is in.
function backSVG(label){
  let rings = '';
  for (let r = 10; r <= 46; r += 6) rings += `<circle cx="50" cy="70" r="${r}" fill="none" stroke="#e0a84f" stroke-opacity="${0.08 + (46 - r) / 400}"/>`;
  return `<svg class="fg-art" viewBox="0 0 100 140" aria-hidden="true">` +
    `<rect x="1" y="1" width="98" height="138" rx="9" fill="#13213a"/>` +
    `<rect x="6" y="6" width="88" height="128" rx="6" fill="none" stroke="#e0a84f" stroke-opacity="0.45"/>` +
    `<rect x="9" y="9" width="82" height="122" rx="4" fill="none" stroke="#e0a84f" stroke-opacity="0.18" stroke-dasharray="2 3"/>` +
    rings +
    `<g transform="translate(29 49) scale(1.75)" fill="#e0a84f" opacity="0.92"><path d="${ICON_PATHS.star}"/></g>` +
    (label != null ? `<rect x="30" y="104" width="40" height="24" rx="12" fill="#f3ead8"/>` +
                     `<text x="50" y="122" text-anchor="middle" class="fg-art-back" fill="#13213a">${label}</text>` : '') +
    `</svg>`;
}

// ------------------------------------------------------------------ sound

// Synthesised, like the iOS app's: filtered noise for paper, decaying sines
// for thuds and chimes. Browsers only start audio after a tap, so the first
// tap anywhere unlocks it.
const Sound = {
  ctx: null,
  get on(){
    try { return localStorage.getItem('fugitive:sound') !== 'off'; } catch (e) { return true; }
  },
  set on(value){
    try { localStorage.setItem('fugitive:sound', value ? 'on' : 'off'); } catch (e) {}
  },
  unlock(){
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  ready(){ return this.on && this.ctx && this.ctx.state === 'running'; },

  noise(at, dur, freq, q, gain, type){
    const c = this.ctx, len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    const filter = c.createBiquadFilter(); filter.type = type || 'bandpass';
    filter.frequency.value = freq; filter.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, c.currentTime + at);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + dur);
    src.connect(filter).connect(g).connect(c.destination);
    src.start(c.currentTime + at); src.stop(c.currentTime + at + dur + 0.02);
  },
  tone(at, dur, freq, gain, type, slideTo){
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, c.currentTime + at);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + at + dur);
    g.gain.setValueAtTime(0.0001, c.currentTime + at);
    g.gain.exponentialRampToValueAtTime(gain, c.currentTime + at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + at + dur);
    o.connect(g).connect(c.destination);
    o.start(c.currentTime + at); o.stop(c.currentTime + at + dur + 0.02);
  },

  play(name){
    if (!this.ready()) return;
    const fx = {
      flick: () => this.noise(0, 0.07, 3200, 1.4, 0.35),
      land: () => { this.noise(0, 0.1, 900, 0.9, 0.4); this.tone(0, 0.09, 140, 0.25); },
      slide: () => { this.noise(0, 0.22, 1600, 0.7, 0.18, 'lowpass'); this.noise(0.18, 0.08, 800, 1, 0.3); },
      riffle: () => { for (let i = 0; i < 14; i++) this.noise(i * 0.028, 0.05, 2600 + i * 60, 2, 0.18); this.noise(0.42, 0.12, 700, 1, 0.35); },
      stamp: () => { this.tone(0, 0.22, 95, 0.6); this.noise(0, 0.06, 500, 0.8, 0.5, 'lowpass'); },
      miss: () => { this.tone(0, 0.18, 240, 0.12, 'square', 150); this.noise(0, 0.08, 400, 0.8, 0.3, 'lowpass'); },
      turn: () => { this.tone(0, 0.18, 880, 0.12); this.tone(0.09, 0.24, 1320, 0.1); },
      siren: () => { for (let i = 0; i < 4; i++) this.tone(i * 0.42, 0.42, i % 2 ? 660 : 880, 0.09, 'triangle', i % 2 ? 880 : 660); },
      escape: () => { this.noise(0, 1.1, 600, 0.6, 0.25, 'lowpass'); this.tone(0, 1.1, 220, 0.12, 'sawtooth', 880); this.tone(0.9, 0.5, 1320, 0.08); },
      caught: () => { [420, 1260, 2390].forEach((f, i) => this.tone(i * 0.01, 0.5, f, 0.12 / (i + 1), 'square')); this.tone(0, 0.3, 80, 0.5); }
    }[name];
    if (fx) fx();
  }
};
document.addEventListener('pointerdown', () => Sound.unlock(), {capture: true});

// ------------------------------------------------------------------ motion

const Motion = {
  reduced: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  wait(ms){ return new Promise(resolve => setTimeout(resolve, this.reduced ? 0 : ms)); },

  // FLIP: `target` is already where it ends up; play it in from `from`.
  async fly(target, from, opts){
    if (!target) return;
    target.style.visibility = '';
    if (this.reduced || !from) return;
    const a = from.getBoundingClientRect(), b = target.getBoundingClientRect();
    if (!b.width) return;
    const dx = a.left + a.width / 2 - (b.left + b.width / 2);
    const dy = a.top + a.height / 2 - (b.top + b.height / 2);
    const s = Math.max(0.35, Math.min(2, a.width / b.width));
    const turn = (opts && opts.spin) || 0;
    await target.animate([
      {transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(${turn}deg)`, zIndex: 50},
      {transform: 'translate(0, 0) scale(1) rotate(0deg)', zIndex: 50}
    ], {duration: (opts && opts.duration) || 520, easing: 'cubic-bezier(.2,.8,.25,1)'}).finished.catch(() => {});
  },

  // A card that only travels: a back flying from one place to another, for
  // a draw the viewer isn't allowed to see.
  async ghost(from, to){
    if (this.reduced || !from || !to) return;
    const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    const card = el('div', {class: 'fg-card fg-ghost', html: backSVG()});
    document.body.appendChild(card);
    const w = card.getBoundingClientRect().width || 60;
    const place = r => `translate(${r.left + r.width / 2 - w / 2}px, ${r.top + r.height / 2 - w * 0.7}px)`;
    await card.animate([
      {transform: place(a) + ' rotate(-6deg)', opacity: 1},
      {transform: place(b) + ' rotate(4deg) scale(.8)', opacity: 0.2}
    ], {duration: 560, easing: 'cubic-bezier(.3,.7,.3,1)'}).finished.catch(() => {});
    card.remove();
  },

  // Turn a card over: it's drawn face up, and starts as a back laid on top.
  async turnOver(card){
    if (!card || this.reduced) return;
    const back = el('div', {class: 'fg-card-cover', html: backSVG()});
    card.appendChild(back);
    await card.animate([{transform: 'rotateY(0)'}, {transform: 'rotateY(90deg)'}],
                       {duration: 200, easing: 'ease-in'}).finished.catch(() => {});
    back.remove();
    await card.animate([{transform: 'rotateY(-90deg)'}, {transform: 'rotateY(0)'}],
                       {duration: 220, easing: 'ease-out'}).finished.catch(() => {});
  },

  // An ink stamp across something: FOUND, NOT HERE, CAUGHT.
  async stamp(over, text, kind, hold){
    if (!over) return;
    const r = over.getBoundingClientRect();
    const mark = el('div', {class: `fg-stamp fg-stamp-${kind}`, text});
    document.body.appendChild(mark);
    const m = mark.getBoundingClientRect();
    mark.style.left = `${r.left + r.width / 2 - m.width / 2 + window.scrollX}px`;
    mark.style.top = `${r.top + r.height / 2 - m.height / 2 + window.scrollY}px`;
    Sound.play('stamp');
    if (!this.reduced) {
      await mark.animate([
        {transform: 'rotate(-14deg) scale(2.4)', opacity: 0},
        {transform: 'rotate(-14deg) scale(1)', opacity: 1, offset: 0.6},
        {transform: 'rotate(-12deg) scale(1.04)', opacity: 1}
      ], {duration: 300, easing: 'cubic-bezier(.3,1.4,.5,1)'}).finished.catch(() => {});
    }
    await this.wait(hold || 900);
    await mark.animate([{opacity: 1}, {opacity: 0}], {duration: 300}).finished.catch(() => {});
    mark.remove();
  },

  shake(node){
    if (!node || this.reduced) return;
    node.animate([{transform: 'translateX(0)'}, {transform: 'translateX(-6px)'}, {transform: 'translateX(6px)'},
                  {transform: 'translateX(-3px)'}, {transform: 'translateX(0)'}], {duration: 320});
  }
};

// ------------------------------------------------------------------ the map

// The street map the trail is laid across: a blueprint of blocks, a river
// and a couple of avenues. Seeded by the room code, so every device at the
// table shows the same city.
function cityMap(seedText){
  let seed = 0;
  for (const ch of seedText || 'MAP') seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const r = seeded(seed % 100000);
  let s = '<svg class="fg-map-art" viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">';
  // River.
  const y0 = 40 + r() * 120;
  s += `<path d="M-10 ${y0} C 80 ${y0 - 60 + r() * 120}, 200 ${y0 - 60 + r() * 120}, 410 ${y0 - 40 + r() * 80}" ` +
       `stroke="#3d6d8a" stroke-opacity="0.45" stroke-width="16" fill="none"/>`;
  // Street grid, a little crooked.
  for (let x = 0; x <= 400; x += 22 + r() * 18) {
    s += `<line x1="${x}" y1="0" x2="${x + (r() - 0.5) * 30}" y2="200" stroke="#f3ead8" stroke-opacity="0.08" stroke-width="${r() < 0.15 ? 4 : 1.2}"/>`;
  }
  for (let y = 0; y <= 200; y += 18 + r() * 16) {
    s += `<line x1="0" y1="${y}" x2="400" y2="${y + (r() - 0.5) * 24}" stroke="#f3ead8" stroke-opacity="0.08" stroke-width="${r() < 0.15 ? 4 : 1.2}"/>`;
  }
  // Two diagonal avenues and a park.
  s += `<line x1="0" y1="${r() * 200}" x2="400" y2="${r() * 200}" stroke="#e0a84f" stroke-opacity="0.12" stroke-width="5"/>`;
  s += `<line x1="${r() * 400}" y1="0" x2="${r() * 400}" y2="200" stroke="#e0a84f" stroke-opacity="0.1" stroke-width="5"/>`;
  s += `<rect x="${40 + r() * 300}" y="${20 + r() * 140}" width="${30 + r() * 30}" height="${20 + r() * 20}" rx="4" fill="#57b97a" fill-opacity="0.08"/>`;
  return s + '</svg>';
}
