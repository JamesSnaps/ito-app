// Wildwood's look, sound and motion, shared by its pages. Plain globals, no
// modules — no build step, and each page is one inline script on top of this.
//
// Every card is drawn here as SVG from its code (`r7`, `gS`, `W4`…): a
// coloured card with an arch into the wood, the colour's animal sitting in
// it, the number or action above. Our own flat storybook style — nothing
// from any published deck. Sounds are synthesised. Nothing to license,
// nothing to download, nothing fetched from a third party mid-game.

// ------------------------------------------------------------------ DOM

// Names are typed at the table and go straight back on screen, so anything
// carrying one is built as DOM nodes. The card art below is the exception —
// built as SVG markup, but only ever from card codes and constants.
function el(tag, attrs, children){
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    // setProperty, not Object.assign: custom properties set as plain keys
    // are silently dropped.
    else if (k === 'style' && typeof v === 'object') for (const [p, x] of Object.entries(v)) node.style.setProperty(p, x);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  (children || []).forEach(c => c != null && c !== false &&
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return node;
}

// ------------------------------------------------------------------ cards

const WW = {
  COLOURS: ['r', 'g', 'b', 'y'],
  WILDS: ['W', 'W4'],
  NAMES: {r: 'red', g: 'green', b: 'blue', y: 'yellow'},
  ANIMALS: {r: 'Fox', g: 'Frog', b: 'Owl', y: 'Duckling', W: 'Badger', W4: 'Bear'},
  ACTION_NAMES: {S: 'Skip', R: 'Reverse', D: 'Draw two'},
  PAINT: {
    r: {main: '#e0533a', dark: '#a3301d', light: '#fde3d6', hill: '#f6b9a2'},
    g: {main: '#3e9a4f', dark: '#22692f', light: '#dcf2d9', hill: '#a9dba5'},
    b: {main: '#2f6fc4', dark: '#1b4787', light: '#dbe8f8', hill: '#a9c6ec'},
    y: {main: '#efb21c', dark: '#a8780a', light: '#fff2c8', hill: '#f8d97a'},
    W: {main: '#2c2b35', dark: '#141319', light: '#efeae0', hill: '#d6cfc2'}
  },
  INK: '#2b2017',
  isWild(card){ return card === 'W' || card === 'W4'; },
  colourOf(card){ return WW.isWild(card) ? null : card[0]; },
  symbolOf(card){ return WW.isWild(card) ? card : card[1]; },
  // What a card is called, for screen readers and the log.
  label(card){
    if (card === 'W') return 'Badger wild';
    if (card === 'W4') return 'Bear wild +4';
    const s = card[1];
    return `${WW.NAMES[card[0]]} ${WW.ACTION_NAMES[s] || s}`;
  },
  uid: 0
};

// Same card, same drawing, on every device.
function seeded(text){
  let a = 2166136261;
  for (const ch of String(text)) a = Math.imul(a ^ ch.charCodeAt(0), 16777619) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ICON_PATHS = {
  skip: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M5.6 18.4L18.4 5.6',
  reverse: 'M4 9h12l-3.5-3.5M20 15H8l3.5 3.5',
  draw: 'M7 4h9v13H7zM10 8h9v13h-9',
  wild: 'M12 3l2.4 6.3H21l-5.3 4 2 6.7-5.7-4-5.7 4 2-6.7L3 9.3h6.6z',
  star: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z',
  leaf: 'M5 19C5 10 11 4 20 4c0 9-6 15-15 15zM5 19l8-8',
  hand: 'M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11V5a1.5 1.5 0 0 1 3 0v6M14 11V6.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6 7s-5-2-6.5-4.5L3 13.5a1.5 1.5 0 0 1 2.5-1.5L8 15',
  soundOn: 'M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  soundOff: 'M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6'
};
function icon(name, cls){
  return `<svg class="ww-icon ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON_PATHS[name]}"/></svg>`;
}

// ---- the animals: heads about 40 wide, centred on 0,0, with a dark outline.
// `face` is 'open', 'shut' (asleep, for a Skip) or 'look' (glancing back).

function eyes(x, y, face, r){
  r = r || 2.3;
  if (face === 'shut') {
    return `<path d="M${-x - r} ${y}q${r} ${r * 0.9} ${r * 2} 0M${x - r} ${y}q${r} ${r * 0.9} ${r * 2} 0" fill="none" stroke="${WW.INK}" stroke-width="1.4" stroke-linecap="round"/>`;
  }
  const dx = face === 'look' ? -r * 0.45 : 0;
  return `<circle cx="${-x + dx}" cy="${y}" r="${r}" fill="${WW.INK}"/><circle cx="${x + dx}" cy="${y}" r="${r}" fill="${WW.INK}"/>` +
    `<circle cx="${-x + dx + r * 0.35}" cy="${y - r * 0.35}" r="${r * 0.35}" fill="#fff"/><circle cx="${x + dx + r * 0.35}" cy="${y - r * 0.35}" r="${r * 0.35}" fill="#fff"/>`;
}

const OUTLINE = `stroke="${WW.INK}" stroke-width="1.3" stroke-linejoin="round"`;

const HEADS = {
  Fox(face){
    return `<path d="M-17-8L-13-27-3-15ZM17-8L13-27 3-15Z" fill="#e8742f" ${OUTLINE}/>` +
      `<path d="M-14.5-12L-12.5-22-7-15ZM14.5-12L12.5-22 7-15Z" fill="#5b2c17"/>` +
      `<path d="M-19-9Q-18 8 0 17Q18 8 19-9Q11-17 0-17Q-11-17-19-9Z" fill="#e8742f" ${OUTLINE}/>` +
      `<path d="M-17-3Q-9 3-3 6L0 17Q-14 10-17-3ZM17-3Q9 3 3 6L0 17Q14 10 17-3Z" fill="#fff7ea"/>` +
      eyes(7, -4, face) + `<ellipse cx="0" cy="13" rx="2.8" ry="2.1" fill="${WW.INK}"/>`;
  },
  Frog(face){
    return `<circle cx="-10" cy="-9" r="7.5" fill="#6cc15f" ${OUTLINE}/><circle cx="10" cy="-9" r="7.5" fill="#6cc15f" ${OUTLINE}/>` +
      `<ellipse cx="0" cy="4" rx="21" ry="13.5" fill="#6cc15f" ${OUTLINE}/>` +
      `<circle cx="-10" cy="-9" r="4.6" fill="#fff"/><circle cx="10" cy="-9" r="4.6" fill="#fff"/>` +
      eyes(10, -9, face, 2.4) +
      `<path d="M-11 6Q0 15 11 6" fill="none" stroke="${WW.INK}" stroke-width="1.4" stroke-linecap="round"/>` +
      `<circle cx="-14" cy="5" r="2.6" fill="#f39aa6" opacity=".8"/><circle cx="14" cy="5" r="2.6" fill="#f39aa6" opacity=".8"/>`;
  },
  Owl(face){
    return `<path d="M-18 17Q-21-5-14-15L-11-25-4-17Q0-18 4-17L11-25 14-15Q21-5 18 17Z" fill="#8b6442" ${OUTLINE}/>` +
      `<path d="M-11 9q3 3 6 0M-3 12q3 3 6 0M5 9q3 3 6 0" fill="none" stroke="#5e4029" stroke-width="1.2"/>` +
      `<circle cx="-8" cy="-4" r="7.2" fill="#fff6e0" stroke="#e7a43a" stroke-width="1.6"/><circle cx="8" cy="-4" r="7.2" fill="#fff6e0" stroke="#e7a43a" stroke-width="1.6"/>` +
      eyes(8, -4, face, 3.2) + `<path d="M-2.6 2.5L2.6 2.5 0 8Z" fill="#e7a43a" ${OUTLINE}/>`;
  },
  Duckling(face){
    return `<path d="M-2-15q2-7 6-5-3 0-2 6M0-15q-4-6-7-3 3 0 4 4" fill="#ffd84a" ${OUTLINE}/>` +
      `<circle cx="0" cy="1" r="17" fill="#ffd84a" ${OUTLINE}/>` +
      eyes(6.5, -3, face) +
      `<path d="M-8 6Q0 1 8 6Q0 13-8 6Z" fill="#f3913a" ${OUTLINE}/>` +
      `<circle cx="-11" cy="4" r="2.6" fill="#f7a35b" opacity=".6"/><circle cx="11" cy="4" r="2.6" fill="#f7a35b" opacity=".6"/>`;
  },
  Badger(face){
    return `<circle cx="-14" cy="-12" r="5" fill="#3a3843" ${OUTLINE}/><circle cx="14" cy="-12" r="5" fill="#3a3843" ${OUTLINE}/>` +
      `<path d="M-19-4Q-18-17 0-17Q18-17 19-4Q17 12 0 18Q-17 12-19-4Z" fill="#f3efe7" ${OUTLINE}/>` +
      `<path d="M-15-11Q-9-3-6 13L-10 12Q-17 2-18.5-5ZM15-11Q9-3 6 13L10 12Q17 2 18.5-5Z" fill="#3a3843"/>` +
      `<g>${eyes(10, -1, face, 2.1).replaceAll(WW.INK, '#f3efe7').replaceAll('#fff', WW.INK)}</g>` +
      `<ellipse cx="0" cy="14" rx="3.2" ry="2.3" fill="${WW.INK}"/>`;
  },
  Bear(face){
    return `<circle cx="-13" cy="-12" r="6.5" fill="#8a5a33" ${OUTLINE}/><circle cx="13" cy="-12" r="6.5" fill="#8a5a33" ${OUTLINE}/>` +
      `<circle cx="-13" cy="-12" r="3.2" fill="#d9b48a"/><circle cx="13" cy="-12" r="3.2" fill="#d9b48a"/>` +
      `<circle cx="0" cy="2" r="17.5" fill="#8a5a33" ${OUTLINE}/>` +
      `<ellipse cx="0" cy="8.5" rx="8.5" ry="6.5" fill="#d9b48a"/>` +
      eyes(7, -3, face) + `<ellipse cx="0" cy="5.5" rx="3.4" ry="2.4" fill="${WW.INK}"/>` +
      `<path d="M-3 10q3 2.5 6 0" fill="none" stroke="${WW.INK}" stroke-width="1.2" stroke-linecap="round"/>`;
  },
  // The computer's seats.
  Hedgehog(face){
    let spikes = '';
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * (0.95 + i * 0.137), x = Math.cos(a) * 19, y = Math.sin(a) * 17;
      spikes += `L${(x * 1.25).toFixed(1)} ${(y * 1.25).toFixed(1)}L${(Math.cos(a + 0.07) * 19).toFixed(1)} ${(Math.sin(a + 0.07) * 17).toFixed(1)}`;
    }
    return `<path d="M-19 4${spikes}L19 4Z" fill="#7a5a3f" ${OUTLINE}/>` +
      `<path d="M-14 0Q0-8 14 0Q12 14 0 17Q-12 14-14 0Z" fill="#e8cfae" ${OUTLINE}/>` +
      eyes(5.5, 4, face, 2) + `<circle cx="0" cy="12" r="2.4" fill="${WW.INK}"/>`;
  },
  Rabbit(face){
    return `<path d="M-9-10Q-14-34-6-34Q-1-30-3-10ZM9-10Q14-34 6-34Q1-30 3-10Z" fill="#c9c3bd" ${OUTLINE}/>` +
      `<path d="M-7-12Q-10-29-6-30Q-4-27-5-12ZM7-12Q10-29 6-30Q4-27 5-12Z" fill="#f2b6c0"/>` +
      `<ellipse cx="0" cy="3" rx="16" ry="14.5" fill="#c9c3bd" ${OUTLINE}/>` +
      eyes(6, 0, face) + `<path d="M-2.2 7h4.4L0 9.5Z" fill="#e48798"/>` +
      `<path d="M0 9.5v2.5M0 12q-3 2-5 0M0 12q3 2 5 0" fill="none" stroke="${WW.INK}" stroke-width="1"/>`;
  },
  Squirrel(face){
    return `<path d="M-12-10L-13-24-4-15ZM12-10L13-24 4-15Z" fill="#c46a2c" ${OUTLINE}/>` +
      `<ellipse cx="0" cy="2" rx="16" ry="15.5" fill="#c46a2c" ${OUTLINE}/>` +
      `<ellipse cx="0" cy="8" rx="9" ry="7" fill="#f3d9b6"/>` +
      eyes(6, -2, face) + `<ellipse cx="0" cy="6" rx="2.6" ry="1.9" fill="${WW.INK}"/>` +
      `<path d="M-2 12h4" stroke="#fff" stroke-width="2.4"/>`;
  },
  Mole(face){
    return `<ellipse cx="0" cy="3" rx="17" ry="15" fill="#4a4550" ${OUTLINE}/>` +
      `<ellipse cx="0" cy="9" rx="8" ry="6" fill="#6b6472"/>` +
      eyes(6.5, -1, face, 1.5) + `<ellipse cx="0" cy="8" rx="4" ry="3" fill="#f39aa6" ${OUTLINE}/>`;
  }
};

function head(name, x, y, s, face, flip){
  return `<g transform="translate(${x} ${y}) scale(${flip ? -s : s} ${s})">${HEADS[name](face || 'open')}</g>`;
}

// A face for a seat: a computer's animal, for the seat list and the mats.
function critterSVG(name){
  const kind = HEADS[name] ? name : 'Hedgehog';
  return `<svg class="ww-critter" viewBox="-24 -26 48 48" aria-hidden="true">` +
    `<circle cx="0" cy="-2" r="23" fill="#f1ead9"/>${head(kind, 0, kind === 'Rabbit' ? 4 : 0, kind === 'Rabbit' ? 0.85 : 1)}</svg>`;
}

// ---- the faces

function symbolMark(symbol, x, y, size, colour){
  if (symbol === 'S' || symbol === 'R' || symbol === 'D') {
    const name = {S: 'skip', R: 'reverse', D: 'draw'}[symbol];
    const s = size / 24;
    return `<g transform="translate(${x - size / 2} ${y - size / 2}) scale(${s})" fill="none" stroke="${colour}" stroke-width="${2.6}" stroke-linecap="round" stroke-linejoin="round"><path d="${ICON_PATHS[name]}"/></g>`;
  }
  return '';
}

function cornerText(card){
  if (card === 'W') return '★';
  if (card === 'W4') return '+4';
  return {S: '', R: '', D: '+2'}[card[1]] ?? card[1];
}

function corner(card, paint, x, y, rotate){
  const sym = WW.symbolOf(card);
  const mark = (sym === 'S' || sym === 'R')
    ? symbolMark(sym, 0, 0, 13, '#fff')
    : `<text x="0" y="5" text-anchor="middle" class="ww-art-corner" fill="#fff">${cornerText(card)}</text>`;
  return `<g transform="translate(${x} ${y}) rotate(${rotate})">${mark}</g>`;
}

// The wild cards' mark, and the back's: four leaves crossed like a clover,
// one in each colour.
function leaves4(cx, cy, size){
  const leaf = 'M0 0C-7-6-8-17 0-26C8-17 7-6 0 0Z';
  return WW.COLOURS.map((c, i) =>
    `<path d="${leaf}" transform="translate(${cx} ${cy}) rotate(${i * 90 - 45}) scale(${size / 26})" ` +
    `fill="${WW.PAINT[c].main}" stroke="${WW.INK}" stroke-width="${26 / size}" stroke-linejoin="round"/>` +
    `<path d="M0-3V-20" transform="translate(${cx} ${cy}) rotate(${i * 90 - 45}) scale(${size / 26})" ` +
    `stroke="#fff" stroke-opacity=".55" stroke-width="${32 / size}" stroke-linecap="round"/>`).join('');
}

function cardSVG(card){
  const id = `ww${++WW.uid}`;
  const wild = WW.isWild(card);
  const paint = WW.PAINT[wild ? 'W' : card[0]];
  const sym = WW.symbolOf(card);
  const animal = WW.ANIMALS[wild ? card : card[0]];
  const r = seeded(card);
  const tilt = ((r() - 0.5) * 14).toFixed(1);
  let leaves = '';
  for (let i = 0; i < 4; i++) {
    const lx = 16 + r() * 68, ly = 92 + r() * 28, ls = 0.28 + r() * 0.2, rot = Math.round(r() * 360);
    leaves += `<g transform="translate(${lx.toFixed(1)} ${ly.toFixed(1)}) rotate(${rot}) scale(${ls.toFixed(2)})"><path d="${ICON_PATHS.leaf}" transform="translate(-12 -12)" fill="${paint.main}" opacity=".35"/></g>`;
  }

  let middle, critter;
  if (wild) {
    middle = leaves4(50, 56, 28) +
      (card === 'W4' ? `<circle cx="50" cy="56" r="12" fill="#fff" ${OUTLINE}/><text x="50" y="63.5" text-anchor="middle" class="ww-art-num ww-art-four" fill="${paint.dark}">+4</text>`
                     : `<circle cx="50" cy="56" r="8" fill="#fff" ${OUTLINE}/><g transform="translate(43.4 49.4) scale(.55)" fill="${paint.dark}"><path d="${ICON_PATHS.wild}"/></g>`);
    critter = head(animal, 50, 106, 0.95, 'open');
  } else if (sym === 'S') {
    middle = symbolMark('S', 50, 54, 46, paint.dark) +
      `<text x="70" y="88" class="ww-art-z" fill="${paint.dark}">z</text><text x="77" y="80" class="ww-art-z ww-art-z-small" fill="${paint.dark}">z</text>`;
    critter = head(animal, 50, 106, 0.9, 'shut');
  } else if (sym === 'R') {
    middle = symbolMark('R', 50, 54, 46, paint.dark);
    critter = head(animal, 50, 106, 0.9, 'look', true);
  } else if (sym === 'D') {
    middle = `<g transform="translate(50 56) rotate(-12)"><rect x="-17" y="-20" width="20" height="28" rx="3" fill="#fff" ${OUTLINE}/></g>` +
      `<g transform="translate(50 56) rotate(10)"><rect x="-3" y="-18" width="20" height="28" rx="3" fill="${paint.main}" ${OUTLINE}/></g>` +
      `<text x="50" y="66" text-anchor="middle" class="ww-art-num ww-art-plus" fill="${paint.dark}">+2</text>`;
    critter = head(animal, 50, 106, 0.9, 'open');
  } else {
    middle = `<text x="50" y="72" text-anchor="middle" class="ww-art-num" fill="${paint.dark}">${sym}</text>`;
    critter = head(animal, 50, 106, 0.9, 'open', r() < 0.5);
  }

  return `<svg class="ww-art" viewBox="0 0 100 140" aria-hidden="true">` +
    `<defs><clipPath id="${id}"><path d="M14 126V46A36 36 0 0 1 86 46V126Z"/></clipPath></defs>` +
    `<rect x="1" y="1" width="98" height="138" rx="10" fill="${paint.main}"/>` +
    `<rect x="4" y="4" width="92" height="132" rx="8" fill="none" stroke="#fff" stroke-opacity=".35"/>` +
    `<path d="M14 126V46A36 36 0 0 1 86 46V126Z" fill="${paint.light}"/>` +
    `<g clip-path="url(#${id})">` +
      `<path d="M8 110Q30 94 52 104T96 100V132H8Z" fill="${paint.hill}"/>${leaves}` +
      `<g transform="rotate(${tilt} 50 106)">${critter}</g>` +
    `</g>` +
    `<path d="M14 126V46A36 36 0 0 1 86 46V126Z" fill="none" stroke="${paint.dark}" stroke-width="1.6"/>` +
    middle +
    corner(card, paint, 12, 15, 0) + corner(card, paint, 88, 125, 180) +
    `</svg>`;
}

// The back every hidden card shares: the wood at night, a ring of the four
// colours, and the name.
function backSVG(){
  const r = seeded('back');
  let trees = '';
  for (let i = 0; i < 7; i++) {
    const x = 8 + i * 14 + r() * 4, h = 18 + r() * 14;
    trees += `<path d="M${x.toFixed(1)} ${132 - h}L${(x - 7).toFixed(1)} 132H${(x + 7).toFixed(1)}Z" fill="#163a22"/>`;
  }
  return `<svg class="ww-art" viewBox="0 0 100 140" aria-hidden="true">` +
    `<rect x="1" y="1" width="98" height="138" rx="10" fill="#1f4a2c"/>` +
    `<rect x="5" y="5" width="90" height="130" rx="7" fill="none" stroke="#f2d488" stroke-opacity=".5"/>` +
    trees +
    `<circle cx="50" cy="60" r="30" fill="#163a22" stroke="#f2d488" stroke-opacity=".4"/>` + leaves4(50, 60, 24) +
    `<circle cx="50" cy="60" r="4" fill="#f2d488"/>` +
    `<text x="50" y="108" text-anchor="middle" class="ww-art-back">Wildwood</text>` +
    `</svg>`;
}

// ------------------------------------------------------------------ sound

// Synthesised, like Fugitive's: filtered noise for paper, decaying sines for
// thuds and chimes. Browsers only start audio after a tap, so the first tap
// anywhere unlocks it.
const Sound = {
  ctx: null,
  get on(){
    try { return localStorage.getItem('wildwood:sound') !== 'off'; } catch (e) { return true; }
  },
  set on(value){
    try { localStorage.setItem('wildwood:sound', value ? 'on' : 'off'); } catch (e) {}
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
      land: () => { this.noise(0, 0.09, 1100, 0.9, 0.35); this.tone(0, 0.08, 180, 0.2); },
      riffle: () => { for (let i = 0; i < 14; i++) this.noise(i * 0.028, 0.05, 2600 + i * 60, 2, 0.18); this.noise(0.42, 0.12, 700, 1, 0.35); },
      turn: () => { this.tone(0, 0.16, 784, 0.12); this.tone(0.08, 0.22, 1175, 0.1); },
      skip: () => { this.tone(0, 0.25, 520, 0.12, 'triangle', 260); },
      reverse: () => { this.tone(0, 0.12, 440, 0.1, 'triangle', 660); this.tone(0.12, 0.12, 660, 0.1, 'triangle', 440); },
      wild: () => { [523, 659, 784, 1047].forEach((f, i) => this.tone(i * 0.07, 0.25, f, 0.09)); },
      stack: () => { this.tone(0, 0.18, 196, 0.25, 'square', 160); this.noise(0, 0.08, 600, 0.8, 0.3, 'lowpass'); },
      call: () => { [659, 880, 1319].forEach((f, i) => this.tone(i * 0.09, 0.3, f, 0.11, 'triangle')); },
      caught: () => { this.tone(0, 0.18, 330, 0.16, 'square', 220); this.tone(0.2, 0.3, 220, 0.16, 'square', 165); },
      win: () => { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(i * 0.12, 0.32, f, 0.11, 'triangle')); }
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
    ], {duration: (opts && opts.duration) || 460, easing: 'cubic-bezier(.2,.8,.25,1)'}).finished.catch(() => {});
  },

  // A card that only travels, face down: a draw the viewer may not see.
  async ghost(from, to, face){
    if (this.reduced || !from || !to) return;
    const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    const node = el('div', {class: 'ww-card ww-ghost', html: face ? cardSVG(face) : backSVG()});
    document.body.appendChild(node);
    const w = node.getBoundingClientRect().width || 60;
    const place = r => `translate(${r.left + r.width / 2 - w / 2}px, ${r.top + r.height / 2 - w * 0.7}px)`;
    await node.animate([
      {transform: place(a) + ' rotate(-6deg)', opacity: 1},
      {transform: place(b) + ' rotate(4deg) scale(.7)', opacity: 0.3}
    ], {duration: 420, easing: 'cubic-bezier(.3,.7,.3,1)'}).finished.catch(() => {});
    node.remove();
  },

  pop(node){
    if (!node || this.reduced) return;
    node.animate([{transform: 'scale(1)'}, {transform: 'scale(1.18)'}, {transform: 'scale(1)'}],
                 {duration: 360, easing: 'cubic-bezier(.3,1.5,.5,1)'});
  },

  shake(node){
    if (!node || this.reduced) return;
    node.animate([{transform: 'translateX(0)'}, {transform: 'translateX(-6px)'}, {transform: 'translateX(6px)'},
                  {transform: 'translateX(-3px)'}, {transform: 'translateX(0)'}], {duration: 320});
  },

  // A word that bursts over the table: LAST CARD!, CAUGHT!, SKIP.
  async burst(text, kind, hold){
    const node = el('div', {class: `ww-burst ww-burst-${kind || 'plain'}`, text, role: 'status'});
    document.body.appendChild(node);
    if (!this.reduced) {
      await node.animate([
        {transform: 'translate(-50%, -50%) scale(.3) rotate(-8deg)', opacity: 0},
        {transform: 'translate(-50%, -50%) scale(1.08) rotate(-4deg)', opacity: 1, offset: 0.6},
        {transform: 'translate(-50%, -50%) scale(1) rotate(-4deg)', opacity: 1}
      ], {duration: 320, easing: 'cubic-bezier(.3,1.4,.5,1)'}).finished.catch(() => {});
    }
    await this.wait(hold || 700);
    await node.animate([{opacity: 1}, {opacity: 0}], {duration: 220}).finished.catch(() => {});
    node.remove();
  }
};
