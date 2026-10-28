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

// ---- The card art --------------------------------------------------------
// Our own 60s caper, drawn as flat shapes: the runner (dark suit, red tie,
// briefcase) and whoever's on his tail (trench coat, fedora, a torch), in a
// scene chosen by the card's deck and number, varied by `seeded(n)` so the
// same card looks the same on every device. The art window is 7..93 across
// and 7..106 down; scenes draw in that space and are clipped to it.

const INK = {
  suit: '#1c2230', shirt: '#f4efe4', tie: '#c8372d', skin: '#e9b48c', hair: '#14120f',
  case: '#7b4a2b', coat: '#b88a4f', coatDark: '#8d6637', hat: '#4b3a2b', beam: '#fff1b8',
  glow: '#f2c66d', moon: '#f6d68a'
};
const SKIES = {
  cell: ['#262d3c', '#3d4658'], foot: ['#14223d', '#3a5a8c'], car: ['#102a33', '#2f6a77'],
  plane: ['#241d42', '#7a4f80'], escape: ['#f6a35b', '#f7d488']
};
const CAR_PAINT = ['#c8372d', '#3e8e9e', '#e6e1d6', '#2f4f8f', '#7b4a2b', '#5c7a3a'];

const pick = (r, list) => list[Math.floor(r() * list.length)];

// A limb or a body line: thick, round-ended strokes in one colour.
function limb(points, colour, width){
  return `<polyline points="${points.map(p => p.join(',')).join(' ')}" fill="none" stroke="${colour}" ` +
         `stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// The runner, feet at (x, y), about 32*s tall. Poses: run, leap, stand, climb.
function runner(x, y, s, pose, flip){
  const P = {
    run:   {lean: 12, legF: [[1, -13], [6, -7], [4, 0]], legB: [[-1, -13], [-5, -7], [-10, -5]],
            armF: [[2, -22], [7, -18], [10, -21]], armB: [[-1, -22], [-5, -17], [-7, -13]]},
    leap:  {lean: 18, legF: [[1, -13], [8, -11], [12, -6]], legB: [[-1, -13], [-7, -12], [-12, -15]],
            armF: [[2, -22], [8, -26], [12, -28]], armB: [[-1, -22], [-6, -18], [-9, -15]]},
    stand: {lean: 0, legF: [[1.4, -13], [1.8, -7], [2.2, 0]], legB: [[-1.4, -13], [-1.8, -7], [-2.2, 0]],
            armF: [[2.8, -22], [4, -17], [4.4, -13]], armB: [[-2.8, -22], [-4, -17], [-4.4, -12]]},
    climb: {lean: -4, legF: [[1, -13], [5, -11], [5, -5]], legB: [[-1, -13], [-2, -7], [-2, 0]],
            armF: [[2, -22], [4, -27], [5, -31]], armB: [[-2, -22], [-3, -27], [-3, -31]]}
  }[pose];
  const hand = P.armB[2];
  let g = limb(P.legB, INK.suit, 3.4) + limb(P.armB, INK.suit, 2.6);
  // The case swings from the back hand.
  if (pose !== 'climb') {
    g += `<rect x="${hand[0] - 3.4}" y="${hand[1]}" width="6.8" height="5" rx="1" fill="${INK.case}"/>` +
         `<rect x="${hand[0] - 1.2}" y="${hand[1] - 1.2}" width="2.4" height="1.6" rx="0.6" fill="none" stroke="${INK.case}" stroke-width="0.8"/>`;
  }
  g += `<g transform="rotate(${P.lean} 0 -13)">` +
       `<path d="M-4 -24 Q0 -25.5 4 -24 L3.2 -12.5 L-3.2 -12.5 Z" fill="${INK.suit}"/>` +
       `<path d="M-1.6 -24 L0 -20 L1.6 -24 Z" fill="${INK.shirt}"/>` +
       `<path d="M-0.7 -23 L0.7 -23 L1 -17 L0 -15.6 L-1 -17 Z" fill="${INK.tie}"/>` +
       `<rect x="-1.1" y="-26.6" width="2.2" height="2.4" fill="${INK.skin}"/>` +
       `<ellipse cx="0.6" cy="-29" rx="3" ry="3.4" fill="${INK.skin}"/>` +
       `<path d="M-2.6 -29.6 Q-2.8 -33.2 1 -33 Q4.2 -32.8 3.6 -30.4 Q1.8 -31.4 -0.6 -30.6 Z" fill="${INK.hair}"/>` +
       `</g>`;
  g += limb(P.legF, INK.suit, 3.4) + limb(P.armF, INK.suit, 2.6);
  g += `<ellipse cx="${P.legF[2][0] + 1}" cy="${P.legF[2][1]}" rx="2.2" ry="1.1" fill="${INK.hair}"/>` +
       `<ellipse cx="${P.legB[2][0] - 1}" cy="${P.legB[2][1]}" rx="2.2" ry="1.1" fill="${INK.hair}"/>` +
       `<circle cx="${P.armF[2][0]}" cy="${P.armF[2][1]}" r="1.2" fill="${INK.skin}"/>`;
  return `<g transform="translate(${x} ${y}) scale(${flip ? -s : s} ${s})">${g}</g>`;
}

// The one on his tail: trench coat and fedora. `hold` is 'torch', 'paper'
// or nothing.
function pursuer(x, y, s, flip, hold){
  let g = '';
  if (hold === 'torch') g += `<polygon points="4,-19 46,-30 46,-6" fill="${INK.beam}" opacity="0.28"/>`;
  g += limb([[-1.5, -12], [-2, 0]], '#2a2118', 3) + limb([[1.5, -12], [2.4, 0]], '#2a2118', 3);
  g += `<path d="M-5 -25 Q0 -27 5 -25 L6.5 -9 L-6.5 -9 Z" fill="${INK.coat}"/>` +
       `<path d="M0 -25 L0 -9" stroke="${INK.coatDark}" stroke-width="0.6"/>` +
       `<rect x="-5.6" y="-17" width="11.2" height="1.6" fill="${INK.coatDark}"/>`;
  if (hold === 'paper') {
    g += `<rect x="-1" y="-24" width="10" height="8" fill="#e8e2d2" transform="rotate(-6 4 -20)"/>` +
         `<rect x="0.4" y="-22.6" width="7" height="1" fill="#555" transform="rotate(-6 4 -20)"/>`;
  } else {
    g += limb([[3.6, -23], [6, -19], [5, -19.4]], INK.coat, 2.6);
    if (hold === 'torch') g += `<rect x="4" y="-20.6" width="3.4" height="1.8" rx="0.6" fill="#333"/>`;
  }
  g += `<ellipse cx="0" cy="-28.4" rx="2.8" ry="3.1" fill="${INK.skin}"/>` +
       `<path d="M-5.2 -30.4 L5.2 -30.4 L4 -31.6 L2.8 -35.2 Q0 -36.2 -2.8 -35.2 L-4 -31.6 Z" fill="${INK.hat}"/>` +
       `<rect x="-2.8" y="-32.4" width="5.6" height="0.9" fill="#2b2017"/>`;
  return `<g transform="translate(${x} ${y}) scale(${flip ? -s : s} ${s})">${g}</g>`;
}

// A two-door saloon side on, wheels at y; `taxi` adds the light and a stripe.
function car(x, y, s, paint, flip, taxi){
  let g = `<path d="M-14 -2 Q-14 -6 -10 -6 L-6 -6 L-3 -11 H6 L9 -6 H12 Q15 -6 15 -2 V1 H-14 Z" fill="${paint}"/>` +
          `<path d="M-2.2 -10 H2.4 V-6.4 H-4 Z M3.4 -10 H5.6 L8 -6.4 H3.4 Z" fill="#9fc3d6"/>` +
          `<circle cx="-8" cy="1.4" r="2.8" fill="#111"/><circle cx="9" cy="1.4" r="2.8" fill="#111"/>` +
          `<circle cx="-8" cy="1.4" r="1" fill="#888"/><circle cx="9" cy="1.4" r="1" fill="#888"/>` +
          `<rect x="13" y="-4.6" width="2.2" height="1.6" fill="#fff4c2"/>` +
          `<polygon points="15,-4 44,-9 44,4" fill="#fff4c2" opacity="0.16"/>`;
  if (taxi) g += `<rect x="-0.5" y="-13.4" width="5" height="2.4" rx="0.6" fill="#222"/><rect x="-14" y="-3.2" width="29" height="1" fill="#222"/>`;
  return `<g transform="translate(${x} ${y}) scale(${flip ? -s : s} ${s})">${g}</g>`;
}

// A light aircraft side on, nose right, centred on (x, y).
function plane(x, y, s, angle, ink){
  return `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${s})" fill="${ink}">` +
         `<path d="M-14 0 h22 l6 -2 l1 2 l-6 2 h-22z M-2 0 l-6 -8 h3 l9 8z M-2 1 l-6 7 h3 l9 -7z M-14 0 l-3 -5 h2 l4 5z"/></g>`;
}

function stars(r, count, depth, from = 9){
  let s = '';
  for (let i = 0; i < count; i++) {
    s += `<circle cx="${8 + r() * 84}" cy="${from + r() * depth}" r="${0.35 + r() * 0.5}" fill="#fff" opacity="${0.35 + r() * 0.5}"/>`;
  }
  return s;
}
function moon(r, y){ return `<circle cx="${48 + r() * 36}" cy="${y + r() * 8}" r="6.5" fill="${INK.moon}"/>`; }
function windows(r, x, y, w, h, step, chance){
  let s = '';
  for (let wy = y + 3; wy < y + h - 3; wy += step) {
    for (let wx = x + 2; wx < x + w - 2; wx += step * 0.75) {
      if (r() < chance) s += `<rect x="${wx}" y="${wy}" width="2.2" height="2.8" fill="${INK.glow}" opacity="${0.5 + r() * 0.5}"/>`;
    }
  }
  return s;
}
// A row of blocks against the sky, their tops between `top` and `base`.
function blocks(r, base, low, high, fill, lit){
  let s = '';
  for (let x = -2; x < 100;) {
    const w = 8 + r() * 9, h = low + r() * (high - low);
    s += `<rect x="${x}" y="${base - h}" width="${w}" height="${h + 40}" fill="${fill}"/>`;
    if (lit) s += windows(r, x, base - h, w, h, 5, lit);
    x += w + (r() < 0.3 ? 2 : 0);
  }
  return s;
}
function sign(x, y, w, h, text, size, colour){
  return `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="1.6" fill="#16121c" stroke="${colour}" stroke-width="1"/>` +
         `<text x="${x}" y="${y + size * 0.36}" text-anchor="middle" font-family="Bebas Neue, Impact, sans-serif" font-size="${size}" fill="${colour}">${text}</text>`;
}
function rain(r, count){
  let s = '';
  for (let i = 0; i < count; i++) {
    const x = r() * 104, y = r() * 108;
    s += `<line x1="${x}" y1="${y}" x2="${x - 2}" y2="${y + 7}" stroke="#9fb8d0" stroke-width="0.35" opacity="0.5"/>`;
  }
  return s;
}

const SCENES = {
  // On foot (1–14) --------------------------------------------------------
  rooftops(r, sky){
    let s = sky + stars(r, 10, 34) + moon(r, 18);
    s += blocks(r, 84, 18, 40, '#22355a', 0);
    const left = 80 + r() * 6, right = 74 + r() * 6;
    s += `<rect x="0" y="${left}" width="40" height="40" fill="#101a2e"/><rect x="58" y="${right}" width="42" height="40" fill="#101a2e"/>` +
         `<rect x="0" y="${left - 2}" width="41" height="3" fill="#2d4167"/><rect x="57" y="${right - 2}" width="44" height="3" fill="#2d4167"/>` +
         `<rect x="80" y="${right - 12}" width="6" height="10" fill="#101a2e"/><rect x="79" y="${right - 14}" width="8" height="2" fill="#2d4167"/>`;
    s += windows(r, 2, left + 4, 36, 24, 6, 0.25) + windows(r, 60, right + 4, 38, 28, 6, 0.25);
    return s + runner(49, Math.min(left, right) - 16, 1.1, 'leap', r() < 0.3);
  },
  alley(r){
    let s = `<rect width="100" height="110" fill="#0f1729"/>`;
    s += `<polygon points="0,0 30,26 30,90 0,110" fill="#3a2a2a"/><polygon points="100,0 70,26 70,90 100,110" fill="#332525"/>`;
    for (let y = 6; y < 110; y += 5) {
      s += `<line x1="0" y1="${y}" x2="30" y2="${26 + (y - 6) * 0.6}" stroke="#4a3434" stroke-width="0.5"/>` +
           `<line x1="100" y1="${y}" x2="70" y2="${26 + (y - 6) * 0.6}" stroke="#442f2f" stroke-width="0.5"/>`;
    }
    s += `<rect x="30" y="26" width="40" height="64" fill="#16213a"/>` + windows(r, 32, 28, 36, 40, 6, 0.18);
    s += `<polygon points="30,90 70,90 100,110 0,110" fill="#0a0f1c"/>`;
    const lx = r() < 0.5 ? 20 : 80;
    s += `<polygon points="${lx - 2},32 ${lx + 2},32 ${lx + 20},110 ${lx - 20},110" fill="${INK.moon}" opacity="0.14"/>` +
         `<rect x="${lx - 0.6}" y="24" width="1.4" height="8" fill="#111"/><path d="M${lx - 6} 24 h12" stroke="#111" stroke-width="1.4"/>` +
         `<circle cx="${lx}" cy="33" r="2" fill="${INK.moon}"/>`;
    // Bins, and the pursuer at the far end.
    s += `<rect x="62" y="86" width="5" height="5" fill="#26303f"/><rect x="61.5" y="85" width="6" height="1.4" fill="#36404f"/>`;
    s += pursuer(54, 90, 0.6, true, 'torch');
    return s + runner(36, 106, 1.15, 'run');
  },
  fireEscape(r, sky){
    let s = sky + stars(r, 8, 18);
    s += `<rect x="8" y="10" width="84" height="100" fill="#5a3b33"/>`;
    for (let y = 14; y < 110; y += 4) s += `<line x1="8" y1="${y}" x2="92" y2="${y}" stroke="#4a302a" stroke-width="0.5"/>`;
    for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) {
      const lit = r() < 0.4;
      s += `<rect x="${17 + col * 24}" y="${16 + row * 24}" width="12" height="15" fill="${lit ? INK.glow : '#1d2535'}" opacity="${lit ? 0.85 : 1}"/>`;
    }
    for (let row = 0; row < 4; row++) {
      const y = 34 + row * 24;
      s += `<rect x="13" y="${y}" width="74" height="1.6" fill="#141414"/><rect x="13" y="${y - 6}" width="74" height="0.8" fill="#141414"/>`;
      for (let x = 13; x <= 87; x += 6) s += `<rect x="${x}" y="${y - 6}" width="0.8" height="6" fill="#141414"/>`;
      if (row < 3) s += `<line x1="${row % 2 ? 24 : 76}" y1="${y}" x2="${row % 2 ? 76 : 24}" y2="${y + 24}" stroke="#141414" stroke-width="1.4"/>`;
    }
    const row = 1 + Math.floor(r() * 2);
    return s + runner(40 + r() * 20, 34 + row * 24, 0.95, 'climb');
  },
  subway(r, sky){
    let s = sky + stars(r, 8, 26) + moon(r, 14);
    s += blocks(r, 70, 16, 40, '#1d2c4a', 0.22);
    s += `<rect x="0" y="70" width="100" height="40" fill="#283247"/><rect x="0" y="70" width="100" height="1.4" fill="#3a4660"/>`;
    // The stairs down, in perspective, with railings.
    s += `<polygon points="30,80 70,80 78,110 22,110" fill="#0b101b"/>`;
    for (let i = 0; i < 6; i++) {
      const y = 82 + i * 4.6, inset = 8 - i * 1.4;
      s += `<rect x="${30 - (8 - inset)}" y="${y}" width="${40 + (8 - inset) * 2}" height="1.2" fill="#3a4660" opacity="${0.8 - i * 0.1}"/>`;
    }
    s += runner(50, 104, 1.05, 'run', r() < 0.5);
    s += `<path d="M28 80 L20 110 M72 80 L80 110 M28 80 H72" stroke="#1f6b4a" stroke-width="1.8" fill="none"/>`;
    s += `<rect x="18" y="56" width="1.4" height="24" fill="#1f6b4a"/><rect x="80.6" y="56" width="1.4" height="24" fill="#1f6b4a"/>` +
         `<circle cx="18.7" cy="55" r="2.6" fill="#8ef0c5"/><circle cx="81.3" cy="55" r="2.6" fill="#8ef0c5"/>`;
    return s + sign(50, 66, 34, 9, 'SUBWAY', 8, '#8ef0c5');
  },
  newsstand(r, sky){
    let s = sky + stars(r, 10, 26) + moon(r, 14);
    s += blocks(r, 76, 20, 48, '#1d2c4a', 0.25);
    s += `<rect x="0" y="76" width="100" height="34" fill="#202a3d"/><rect x="0" y="96" width="100" height="14" fill="#121a29"/>`;
    // The kiosk: an awning, papers fanned on the counter.
    s += `<rect x="58" y="62" width="34" height="34" fill="#2f4a3a"/><path d="M55 62 H95 L92 56 H58 Z" fill="#c8372d"/>`;
    for (let x = 58; x < 95; x += 6) s += `<rect x="${x}" y="56" width="3" height="6" fill="#e8e2d2" opacity="0.5"/>`;
    for (let i = 0; i < 4; i++) s += `<rect x="${61 + i * 7}" y="72" width="6" height="8" fill="#e8e2d2"/><rect x="${62 + i * 7}" y="73.4" width="4" height="1.2" fill="#333"/>`;
    s += `<text x="75" y="68" text-anchor="middle" font-family="Bebas Neue, Impact, sans-serif" font-size="5.4" fill="${INK.glow}">EXTRA!</text>`;
    const lamp = 22 + r() * 10;
    s += `<rect x="${lamp}" y="40" width="1.4" height="60" fill="#111"/><circle cx="${lamp + 0.7}" cy="40" r="2.6" fill="${INK.moon}"/>` +
         `<polygon points="${lamp - 2},42 ${lamp + 3},42 ${lamp + 18},104 ${lamp - 15},104" fill="${INK.moon}" opacity="0.12"/>`;
    s += pursuer(50, 100, 0.85, false, 'paper');
    return s + runner(16, 106, 1.05, 'run');
  },

  // By car (15–28) --------------------------------------------------------
  bridge(r, sky){
    let s = sky + stars(r, 10, 28);
    s += `<rect x="0" y="80" width="100" height="30" fill="#0b2230"/>`;
    for (let i = 0; i < 7; i++) s += `<rect x="${r() * 90}" y="${84 + r() * 22}" width="${6 + r() * 10}" height="0.8" fill="${INK.moon}" opacity="0.35"/>`;
    s += `<rect x="18" y="20" width="5" height="60" fill="#9b3b2f"/><rect x="77" y="20" width="5" height="60" fill="#9b3b2f"/>`;
    s += `<path d="M-10 44 Q20 18 20.5 20 Q50 58 79.5 20 Q82 18 110 44" fill="none" stroke="#9b3b2f" stroke-width="1.4"/>`;
    // Hangers from the main cable (a parabola through the tower tops, 39 at mid-span) to the deck.
    for (let x = 24; x < 77; x += 5) s += `<line x1="${x}" y1="${39 - 19 * Math.pow((x - 50) / 29.5, 2)}" x2="${x}" y2="70" stroke="#9b3b2f" stroke-width="0.4"/>`;
    s += `<rect x="0" y="70" width="100" height="5" fill="#2a1d24"/><rect x="0" y="69" width="100" height="1.2" fill="#9b3b2f"/>`;
    return s + car(36 + r() * 26, 70, 1.05, pick(r, CAR_PAINT), r() < 0.5);
  },
  cab(r){
    let s = `<rect width="100" height="110" fill="#14202e"/>`;
    s += blocks(r, 78, 30, 64, '#1f3142', 0.3);
    s += `<rect x="0" y="78" width="100" height="32" fill="#0c141d"/>`;
    for (let i = 0; i < 7; i++) s += `<rect x="${r() * 100}" y="${82 + r() * 26}" width="${8 + r() * 10}" height="0.8" fill="${INK.glow}" opacity="0.25"/>`;
    const flip = r() < 0.5;
    s += car(flip ? 70 : 30, 100, 1.15, '#f0b429', flip, true);
    s += runner(flip ? 28 : 72, 104, 1.05, 'run', !flip);
    return s + rain(r, 55);
  },
  motel(r, sky){
    let s = sky + stars(r, 12, 30);
    s += `<rect x="0" y="76" width="100" height="34" fill="#121b22"/>`;
    s += `<rect x="4" y="64" width="92" height="22" fill="#3a2f3d"/><rect x="2" y="62" width="96" height="3" fill="#4d3f52"/>`;
    for (let i = 0; i < 6; i++) {
      const lit = r() < 0.4;
      s += `<rect x="${9 + i * 14.6}" y="70" width="7" height="16" fill="#1d1820"/>` +
           `<rect x="${17 + i * 14.6}" y="71" width="4" height="5" fill="${lit ? INK.glow : '#28202c'}"/>`;
    }
    s += `<rect x="68" y="20" width="3" height="42" fill="#222"/>` + sign(69.5, 26, 30, 14, 'MOTEL', 10, '#ff8fa3') +
         sign(69.5, 38, 24, 6, r() < 0.7 ? 'VACANCY' : 'NO VACANCY', 4.4, '#8ef0c5');
    s += car(28, 102, 1.0, pick(r, CAR_PAINT), false);
    return s + runner(56, 104, 0.95, 'stand', true);
  },
  tunnel(r, sky){
    let s = sky + stars(r, 10, 22) + moon(r, 12);
    s += `<path d="M0 46 Q25 28 50 40 Q75 26 100 42 V110 H0 Z" fill="#1d2a22"/>`;
    s += `<path d="M10 92 V66 Q30 44 50 66 V92 Z" fill="#46524a"/><path d="M14 92 V68 Q30 50 46 68 V92 Z" fill="#06090a"/>`;
    for (let i = 0; i < 4; i++) s += `<circle cx="${18 + i * 8}" cy="${66 - Math.sin((i + 0.5) / 4 * Math.PI) * 12}" r="0.9" fill="${INK.glow}"/>`;
    s += `<polygon points="14,92 46,92 100,104 100,110 0,110 0,98" fill="#202a2c"/>`;
    for (let x = 52; x < 100; x += 12) s += `<rect x="${x}" y="${96 + (x - 52) * 0.2}" width="6" height="1" fill="${INK.glow}" opacity="0.7"/>`;
    return s + car(66 + r() * 10, 100, 1.1, pick(r, CAR_PAINT), false);
  },
  gasStation(r, sky){
    let s = sky + stars(r, 10, 28);
    s += `<rect x="0" y="86" width="100" height="24" fill="#141c1f"/>`;
    s += `<rect x="20" y="52" width="66" height="5" fill="#e6e1d6"/><rect x="20" y="57" width="66" height="1.4" fill="#c8372d"/>` +
         `<rect x="24" y="58" width="2.4" height="28" fill="#a9a39a"/><rect x="80" y="58" width="2.4" height="28" fill="#a9a39a"/>` +
         `<polygon points="20,58 86,58 96,96 10,96" fill="#fff4c2" opacity="0.08"/>`;
    // The sign on the right, clear of the corner number.
    s += `<rect x="88" y="22" width="2.4" height="64" fill="#222"/><circle cx="89.2" cy="22" r="7" fill="#c8372d"/>` +
         `<text x="89.2" y="24.4" text-anchor="middle" font-family="Bebas Neue, Impact, sans-serif" font-size="6.4" fill="#f4efe4">GAS</text>`;
    s += `<rect x="47" y="72" width="7" height="14" rx="1" fill="#c8372d"/><rect x="48.2" y="74" width="4.6" height="3.6" fill="#f4efe4"/>` +
         `<path d="M54 76 q4 0 4 6" stroke="#111" stroke-width="0.8" fill="none"/>`;
    const flip = r() < 0.5;
    s += car(flip ? 30 : 72, 92, 1.05, pick(r, CAR_PAINT), flip);
    return s + runner(flip ? 66 : 36, 94, 0.95, 'stand', !flip);
  },

  // By plane (29–41) ------------------------------------------------------
  tower(r, sky){
    let s = sky + stars(r, 10, 34);
    s += `<polygon points="70,26 100,8 100,34" fill="${INK.beam}" opacity="0.16"/><polygon points="70,26 6,12 12,32" fill="${INK.beam}" opacity="0.1"/>`;
    s += `<rect x="64" y="30" width="12" height="64" fill="#2b2446"/><path d="M60 30 L80 30 L77 20 L63 20 Z" fill="#3a3160"/>` +
         `<rect x="62" y="22" width="16" height="5" fill="#9fd3ff" opacity="0.7"/><circle cx="70" cy="17" r="1.6" fill="#ff5f5f"/>`;
    s += `<rect x="0" y="92" width="100" height="18" fill="#151024"/>`;
    for (let x = 4; x < 100; x += 8) s += `<circle cx="${x}" cy="97" r="1" fill="${x % 16 ? '#9fd3ff' : '#ffd59a'}"/>`;
    s += `<path d="M0 104 H100" stroke="#e8e0f4" stroke-width="0.8" stroke-dasharray="5 4" opacity="0.6"/>`;
    return s + runner(24 + r() * 16, 106, 1.1, 'run');
  },
  helicopter(r, sky){
    let s = sky + stars(r, 8, 22);
    const hx = 42 + r() * 24;
    s += `<polygon points="${hx},36 ${hx - 26},110 ${hx + 22},110" fill="${INK.beam}" opacity="0.2"/>`;
    s += blocks(r, 94, 8, 22, '#221a3a', 0);
    s += `<rect x="0" y="94" width="100" height="16" fill="#151024"/>`;
    s += `<g transform="translate(${hx} 32)"><ellipse cx="0" cy="0" rx="10" ry="6" fill="#2f4f8f"/>` +
         `<path d="M-3 -4 Q2 -7 7 -2 L7 2 L-3 2 Z" fill="#9fd3ff" opacity="0.8"/>` +
         `<path d="M-9 -1 L-28 -4 L-28 0 L-9 2 Z" fill="#2f4f8f"/><rect x="-30" y="-7" width="2" height="7" fill="#2f4f8f"/>` +
         `<path d="M-7 8 H8 M-5 5 V8 M5 5 V8" stroke="#111" stroke-width="1"/><path d="M-20 -8 H20" stroke="#ccd" stroke-width="1.2"/>` +
         `<rect x="-1" y="-8" width="2" height="2.4" fill="#111"/>` +
         `<text x="-1" y="2.4" text-anchor="middle" font-family="Bebas Neue, Impact, sans-serif" font-size="3.4" fill="#f4efe4">POLICE</text></g>`;
    return s + runner(hx - 4, 106, 1.1, 'run', r() < 0.5);
  },
  hangar(r, sky){
    let s = sky + stars(r, 10, 24);
    s += `<path d="M2 90 V52 Q50 18 98 52 V90 Z" fill="#3a3256"/><path d="M12 90 V58 Q50 32 88 58 V90 Z" fill="#14101f"/>`;
    s += `<rect x="0" y="90" width="100" height="20" fill="#1a1428"/>`;
    s += `<g transform="translate(44 84)"><path d="M-30 -4 H20 Q28 -4 28 0 Q28 4 20 4 H-30 Z" fill="#e6e1d6"/>` +
         `<rect x="-8" y="-16" width="10" height="12" rx="2" fill="#e6e1d6" transform="skewX(-12)"/>` +
         `<rect x="-6" y="-2" width="20" height="2" fill="${pick(r, ['#c8372d', '#2f4f8f', '#5c7a3a'])}"/>` +
         `<circle cx="28" cy="0" r="2" fill="#555"/><path d="M28 -9 V9" stroke="#555" stroke-width="1.2"/>` +
         `<rect x="10" y="-2.6" width="6" height="2.2" rx="1" fill="#9fd3ff"/>` +
         `<path d="M-14 4 V10 M14 4 V10" stroke="#333" stroke-width="1"/><circle cx="-14" cy="10" r="1.8" fill="#111"/><circle cx="14" cy="10" r="1.8" fill="#111"/></g>`;
    return s + runner(84, 106, 1.05, 'run', true);
  },
  runway(r, sky){
    let s = sky + stars(r, 12, 34);
    s += `<rect x="0" y="70" width="100" height="40" fill="#151024"/>`;
    s += `<polygon points="44,70 56,70 92,110 8,110" fill="#2a2240"/>`;
    for (let i = 0; i < 7; i++) {
      const t = i / 6, y = 72 + t * t * 36, w = 0.6 + t * 2.6;
      s += `<rect x="${50 - w / 2}" y="${y}" width="${w}" height="${0.8 + t * 2}" fill="#e8e0f4" opacity="0.7"/>`;
      s += `<circle cx="${44 - t * 36}" cy="${70 + t * 40}" r="${0.6 + t * 1.2}" fill="#ffd59a"/><circle cx="${56 + t * 36}" cy="${70 + t * 40}" r="${0.6 + t * 1.2}" fill="#ffd59a"/>`;
    }
    s += plane(56 + r() * 20, 38 + r() * 12, 1.3, -12 - r() * 8, '#0d0a1a');
    return s + runner(26, 104, 0.85, 'run');
  },
  terminal(r){
    let s = `<rect width="100" height="110" fill="#1b1730"/>`;
    // The big window: night airfield outside, a plane at the gate.
    s += `<rect x="0" y="24" width="100" height="58" fill="#3b2d5a"/>` + stars(r, 8, 20, 28);
    s += `<rect x="0" y="66" width="100" height="16" fill="#151024"/>` + plane(60, 62, 1.8, 0, '#0d0a1a');
    for (let x = 0; x <= 100; x += 20) s += `<rect x="${x - 1}" y="24" width="2" height="58" fill="#0f0c1c"/>`;
    s += `<rect x="0" y="23" width="100" height="2" fill="#0f0c1c"/><rect x="0" y="81" width="100" height="2" fill="#0f0c1c"/>`;
    s += `<rect x="0" y="83" width="100" height="27" fill="#2a2440"/>`;
    // The departures board.
    // The departures board, right of the corner number.
    s += `<rect x="34" y="6" width="56" height="16" rx="1" fill="#0d0b14"/>` +
         `<text x="62" y="11.6" text-anchor="middle" font-family="Bebas Neue, Impact, sans-serif" font-size="4.6" fill="${INK.glow}">DEPARTURES</text>`;
    for (let i = 0; i < 2; i++) s += `<rect x="38" y="${14 + i * 3.4}" width="${18 + r() * 12}" height="1.6" fill="${INK.glow}" opacity="0.6"/>` +
                                     `<rect x="76" y="${14 + i * 3.4}" width="10" height="1.6" fill="#8ef0c5" opacity="0.7"/>`;
    s += `<rect x="58" y="96" width="30" height="3" fill="#1a1428"/><rect x="60" y="99" width="2" height="6" fill="#1a1428"/><rect x="84" y="99" width="2" height="6" fill="#1a1428"/>`;
    s += pursuer(72, 97, 0.8, true, 'paper');
    return s + runner(28, 106, 1.05, 'run', r() < 0.3);
  },

  // The cell (0) and the plane out (42) ------------------------------------
  cell(r){
    let s = `<rect width="100" height="110" fill="#2d3444"/>`;
    for (let y = 4; y < 110; y += 7) {
      for (let x = (y / 7) % 2 ? -6 : 0; x < 100; x += 14) s += `<rect x="${x}" y="${y}" width="13" height="6" fill="#465063" opacity="0.7"/>`;
    }
    // The window: night outside, one bar bent out of the way, sheets knotted into a rope.
    s += `<rect x="30" y="18" width="40" height="32" rx="2" fill="#141b2b"/><circle cx="58" cy="28" r="6" fill="${INK.moon}"/>` + stars(r, 4, 20, 22);
    for (const x of [36, 44, 60, 66]) s += `<rect x="${x}" y="18" width="2.4" height="32" fill="#8e98aa"/>`;
    s += `<path d="M52 18 Q58 34 52 50" stroke="#8e98aa" stroke-width="2.4" fill="none"/>`;
    s += `<rect x="28" y="49" width="44" height="3" fill="#5a6476"/>`;
    s += `<path d="M50 50 Q47 64 51 78 Q48 92 50 110" stroke="#e8e2d2" stroke-width="3" fill="none"/>`;
    for (const y of [62, 78, 94]) s += `<circle cx="50" cy="${y}" r="2.6" fill="#e8e2d2"/>`;
    s += `<polygon points="70,0 100,0 100,110 46,110" fill="#cfd8e8" opacity="0.06"/>`;
    return s;
  },
  escape(r, sky){
    let s = sky + `<circle cx="50" cy="88" r="30" fill="#fff4d6" opacity="0.85"/>`;
    for (let i = 0; i < 5; i++) s += `<rect x="0" y="${84 + i * 5}" width="100" height="1.4" fill="#f7d488" opacity="0.6"/>`;
    s += blocks(r, 100, 4, 14, '#5a2f45', 0);
    s += `<rect x="0" y="100" width="100" height="10" fill="#3b2032"/>`;
    s += plane(58, 38, 1.7, -18, '#3b2032');
    s += `<path d="M8 76 q22 -12 40 -32" stroke="#fff4d6" stroke-width="1.2" fill="none" stroke-dasharray="2 3"/>`;
    // Left behind on the tarmac, watching it go.
    return s + pursuer(20, 104, 0.8, false, null);
  }
};

// Five scenes a deck, in turn, so neighbouring numbers never share one.
const SCENE_SETS = {
  foot: ['rooftops', 'alley', 'fireEscape', 'subway', 'newsstand'],
  car: ['bridge', 'cab', 'motel', 'tunnel', 'gasStation'],
  plane: ['tower', 'helicopter', 'hangar', 'runway', 'terminal']
};
// On foot starts at 1: the Fugitive's starting cards are on foot too.
const DECK_START = {foot: 1, car: 15, plane: 29};

function sceneName(n){
  const era = FG.era(n);
  if (era === 'cell' || era === 'escape') return era;
  const set = SCENE_SETS[era];
  return set[(n - DECK_START[era]) % set.length];
}

function scene(n, id){
  const era = FG.era(n), r = seeded(n);
  const [top, bottom] = SKIES[era];
  const sky = `<rect width="100" height="110" fill="url(#sky${id})"/>`;
  return `<defs><linearGradient id="sky${id}" x1="0" y1="0" x2="0" y2="1">` +
         `<stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>` +
         `<clipPath id="win${id}"><rect x="7" y="7" width="86" height="99" rx="5"/></clipPath></defs>` +
         `<g clip-path="url(#win${id})">${SCENES[sceneName(n)](r, sky)}</g>`;
}

// A card face: the art window over most of it, then a band with the number,
// footprints and the deck icon, framed like a printed card.
function cardSVG(n, steps){
  const id = `c${n}-${++FG.uid}`;
  const era = FG.era(n);
  const ink = era === 'escape' ? '#7a3b2a' : '#13213a';
  let prints = '';
  for (let i = 0; i < steps; i++) prints += footprint(80 + i * 8, 115 - (i % 2) * 3, i % 2);
  const deckIcon = n >= 4 && n <= 41 ? ['foot', 'car', 'plane'][FG.deckOf(n)] : null;
  return `<svg class="fg-art" viewBox="0 0 100 140" aria-hidden="true">` +
    `<rect x="1" y="1" width="98" height="138" rx="9" fill="#f3ead8"/>` +
    `<rect x="4" y="4" width="92" height="132" rx="7" fill="none" stroke="${ink}" stroke-opacity="0.25"/>` +
    scene(n, id) +
    `<rect x="7" y="7" width="22" height="17" rx="4" fill="#f3ead8" opacity="0.92"/>` +
    `<text x="18" y="20.5" text-anchor="middle" class="fg-art-corner" fill="${ink}">${n}</text>` +
    `<text x="50" y="132" text-anchor="middle" class="fg-art-num" fill="${ink}">${n}</text>` +
    `<g fill="${ink}" opacity="0.75">${prints}</g>` +
    (deckIcon ? `<g transform="translate(9 114) scale(0.62)" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.7"><path d="${ICON_PATHS[deckIcon]}"/></g>` : '') +
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

// ------------------------------------------------------------------ mugshots

// There are no profile photos in Game Night, so each player gets a mugshot
// drawn from their name: the same name always gets the same silhouette —
// hair or hat, glasses, a scarf in their own colour — against the role's
// backdrop. The Fugitive stands at the height chart holding a booking
// placard; the Marshal stands in front of the badge. The name itself never
// goes into the markup (it's typed at the table); only a hash of it does.
function nameSeed(name){
  let h = 2166136261;
  for (const ch of (name || '').trim().toLowerCase()) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return (h >>> 0) % 1000003;
}

const SCARVES = ['#e0a84f', '#d9483b', '#5fb3c9', '#57b97a', '#b07cd8', '#f08aa8', '#f2d06b', '#7aa2ff'];

function mugshotSVG(name, role){
  const r = seeded(nameSeed(name));
  const id = `m${++FG.uid}`;
  const ink = '#141a28';
  const scarf = SCARVES[Math.floor(r() * SCARVES.length)];
  const hair = Math.floor(r() * 5);         // short, long, bun, curls, none
  const hat = r() < 0.3 ? Math.floor(r() * 3) : -1;   // fedora, beanie, cap
  const glasses = r() < 0.28;
  const tilt = (r() - 0.5) * 6;
  let s = `<svg class="fg-mug" viewBox="0 0 100 100" aria-hidden="true"><defs><clipPath id="${id}"><circle cx="50" cy="50" r="50"/></clipPath></defs><g clip-path="url(#${id})">`;
  if (role === 'marshal') {
    s += `<rect width="100" height="100" fill="#2c5f73"/>`;
    s += `<g transform="translate(20 6) scale(2.5)" fill="#ffffff" opacity="0.08"><path d="${ICON_PATHS.star}"/></g>`;
  } else {
    // The height chart.
    s += `<rect width="100" height="100" fill="#cbc3b1"/>`;
    for (let y = 8; y < 100; y += 8) s += `<rect x="0" y="${y}" width="100" height="${y % 24 === 8 ? 1.6 : 0.8}" fill="#6d6555" opacity="0.6"/>`;
  }
  s += `<g transform="rotate(${tilt} 50 80) translate(50 100) scale(1.14) translate(-50 -100)">`;
  // Shoulders, neck, head.
  s += `<path d="M6 104 C 8 80, 28 72, 50 72 C 72 72, 92 80, 94 104 Z" fill="${ink}"/>`;
  s += `<rect x="43" y="56" width="14" height="18" fill="${ink}"/>`;
  s += `<ellipse cx="50" cy="44" rx="16" ry="19" fill="${ink}"/>`;
  if (hat === -1) {
    if (hair === 0) s += `<path d="M33 42 C 32 26, 44 21, 52 22 C 62 22, 69 30, 67 42 C 63 34, 56 31, 48 31 C 41 31, 36 35, 33 42 Z" fill="${ink}"/>`;
    if (hair === 1) s += `<path d="M32 46 C 28 24, 46 18, 56 22 C 70 26, 72 44, 70 66 L 63 66 C 66 50, 62 36, 50 33 C 40 34, 36 48, 37 66 L 30 66 C 28 58, 30 52, 32 46 Z" fill="${ink}"/>`;
    if (hair === 2) s += `<circle cx="50" cy="20" r="8" fill="${ink}"/>`;
    if (hair === 3) for (let i = 0; i < 7; i++) s += `<circle cx="${36 + i * 4.7}" cy="${27 + Math.abs(i - 3) * 1.8}" r="6" fill="${ink}"/>`;
  } else if (hat === 0) {
    s += `<ellipse cx="50" cy="31" rx="27" ry="4.5" fill="${ink}"/><path d="M35 31 C 36 18, 42 14, 50 15 C 58 14, 64 18, 65 31 Z" fill="${ink}"/>` +
         `<rect x="35" y="25" width="30" height="3.4" fill="${scarf}" opacity="0.9"/>`;
  } else if (hat === 1) {
    s += `<path d="M33 36 C 33 20, 67 20, 67 36 Z" fill="${ink}"/><rect x="32" y="33" width="36" height="6" rx="3" fill="${scarf}"/>`;
  } else {
    s += `<path d="M34 35 C 34 21, 66 21, 66 35 Z" fill="${ink}"/><path d="M60 33 L 80 36 L 64 38 Z" fill="${ink}"/>`;
  }
  if (glasses) {
    s += `<g fill="none" stroke="#f3ead8" stroke-opacity="0.75" stroke-width="1.6"><circle cx="43.5" cy="45" r="4.5"/><circle cx="56.5" cy="45" r="4.5"/><path d="M48 45 h4"/></g>`;
  }
  // A scarf in their colour, so two silhouettes at the table tell apart.
  s += `<path d="M38 70 C 44 76, 56 76, 62 70 L 64 76 C 57 82, 43 82, 36 76 Z" fill="${scarf}"/>`;
  s += `</g>`;
  if (role === 'marshal') {
    s += `<g transform="translate(60 76) scale(0.75)" fill="#e0a84f" stroke="#7a5a2a" stroke-width="0.8"><path d="${ICON_PATHS.star}"/></g>`;
  } else {
    s += `<rect x="28" y="80" width="44" height="16" rx="1.5" fill="#1b1f2a"/>` +
         `<text x="50" y="92" text-anchor="middle" class="fg-mug-placard" fill="#f3ead8">${String(nameSeed(name) % 90000 + 10000)}</text>`;
  }
  return s + `</g></svg>`;
}

// A mugshot as an element, ringed in the role's colour: the player's own
// photo if they have a profile with one (static/profiles.js), the drawn
// silhouette if not.
function mugshot(name, role, size){
  size = size || 36;
  const photo = typeof GN !== 'undefined' && GN.profiles.photo(name);
  if (!photo) {
    return el('span', {class: `fg-mugshot fg-mugshot-${role}`, style: {'--m': `${size}px`}, html: mugshotSVG(name, role)});
  }
  const img = document.createElement('img');
  img.className = 'fg-mug';
  img.src = photo;
  img.alt = '';
  img.decoding = 'async';
  return el('span', {class: `fg-mugshot fg-mugshot-${role} fg-mugshot-photo`, style: {'--m': `${size}px`}}, [
    img,
    // Booked: the same number the drawn mugshot holds, where there's room.
    role === 'fugitive' && size >= 80 ? el('span', {class: 'fg-mug-tag', text: String(nameSeed(name) % 90000 + 10000)}) : null
  ]);
}
