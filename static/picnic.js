// Picnic Raid's cards, sound and motion, shared by its pages. Plain globals,
// no modules — no build step, and each page is one inline script on top of
// this, as Wildwood's are.
//
// Cards are pictures, not drawings. A card shows its painting when there is
// one — `static/picnic/cards/<code>.webp` (`s3`, `ants`, `back`…), or for food
// the kind's (`s`, with the number laid over it) — and until then a plain
// placeholder: a coloured card with its name. The page is handed the list of
// pictures there are (`PICNIC_ART`), so a missing one is never fetched.

// ------------------------------------------------------------------ DOM

// Names are typed at the table and go straight back on screen, so everything
// is built as DOM nodes; nothing here takes HTML from a player.
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

const ICON_PATHS = {
  soundOn: 'M4 9h4l5-4v14l-5-4H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  soundOff: 'M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6'
};
function icon(name){
  return `<svg class="pr-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON_PATHS[name]}"/></svg>`;
}

// ------------------------------------------------------------------ cards

const PR = {
  FOODS: ['s', 'b', 'c', 'l', 'h'],
  FOOD: {s: 'Sandwich', b: 'Strawberries', c: 'Cupcake', l: 'Lemonade', h: 'Cheese'},
  NAMES: {ants: 'Ants', wasp: 'Wasp', gull: 'Seagull', dog: 'Dog', shoo: 'Shoo!', umbrella: 'Umbrella'},
  DOES: {
    ants: 'carry off your two smallest snacks',
    wasp: 'chases off your biggest snack',
    gull: 'snatches your biggest snack',
    dog: 'gobbles half your basket',
    shoo: 'sends a trap back to whoever hid it',
    umbrella: 'stops a trap'
  },
  isFood: c => typeof c === 'string' && c.length === 2 && PR.FOODS.includes(c[0]),
  isTrap: c => ['ants', 'wasp', 'gull', 'dog'].includes(c),
  isDefence: c => c === 'shoo' || c === 'umbrella',
  value: c => PR.isFood(c) ? Number(c[1]) : 0,
  total: cards => cards.reduce((sum, c) => sum + PR.value(c), 0),
  label(card){
    if (PR.isFood(card)) return `${card[1]} ${PR.FOOD[card[0]]}`;
    return PR.NAMES[card] || card;
  },
  kind: c => PR.isFood(c) ? 'food' : PR.isTrap(c) ? 'trap' : 'defence'
};

function artFor(name){ return (window.PICNIC_ART || {})[name] || null; }

// One card, face up (`code`) or face down (null). `size` is a CSS width.
function cardEl(code, attrs){
  const extra = attrs || {};
  const cls = `pr-card ${code ? `pr-${PR.kind(code)} pr-c-${PR.isFood(code) ? code[0] : code}` : 'pr-back'} ${extra.class || ''}`;
  const node = el(extra.tag || 'div', {...extra, class: cls, tag: null, 'data-card': code || null,
                                       'aria-label': extra['aria-label'] || (code ? PR.label(code) : 'A mystery card')});
  const own = code ? artFor(code) : artFor('back');
  const kindArt = code && PR.isFood(code) ? artFor(code[0]) : null;
  const picture = own || kindArt;
  if (picture) {
    node.classList.add('pr-has-art');
    node.appendChild(el('img', {src: picture, alt: '', draggable: 'false', loading: 'lazy'}));
    // A kind's painting serves all three sizes; the number goes on top.
    if (!own && kindArt) node.appendChild(el('span', {class: 'pr-num', text: code[1]}));
    return node;
  }
  if (!code) return node;
  if (PR.isFood(code)) {
    node.append(el('span', {class: 'pr-num', text: code[1]}),
                el('span', {class: 'pr-name', text: PR.FOOD[code[0]]}),
                el('span', {class: 'pr-pips'}, Array.from({length: Number(code[1])}, () => el('i'))));
  } else {
    node.append(el('span', {class: 'pr-name pr-name-big', text: PR.NAMES[code]}),
                el('span', {class: 'pr-does', text: PR.DOES[code]}));
  }
  return node;
}

// ------------------------------------------------------------------ sound

// Synthesised, like Wildwood's: filtered noise for paper, decaying sines
// for chimes. Browsers only start audio after a tap.
const Sound = {
  ctx: null,
  get on(){
    try { return localStorage.getItem('picnic:sound') !== 'off'; } catch (e) { return true; }
  },
  set on(value){
    try { localStorage.setItem('picnic:sound', value ? 'on' : 'off'); } catch (e) {}
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
      riffle: () => { for (let i = 0; i < 14; i++) this.noise(i * 0.028, 0.05, 2600 + i * 60, 2, 0.18); },
      turn: () => { this.tone(0, 0.16, 784, 0.12); this.tone(0.08, 0.22, 1175, 0.1); },
      spring: () => { this.tone(0, 0.12, 300, 0.18, 'square', 900); this.noise(0.05, 0.12, 1800, 1, 0.25); },
      ouch: () => { this.tone(0, 0.18, 330, 0.16, 'square', 220); this.tone(0.2, 0.3, 220, 0.16, 'square', 150); },
      shoo: () => { this.noise(0, 0.25, 900, 0.6, 0.4, 'lowpass'); this.tone(0.05, 0.25, 500, 0.14, 'triangle', 1200); },
      umbrella: () => { this.tone(0, 0.12, 660, 0.12, 'triangle'); this.tone(0.1, 0.2, 990, 0.12, 'triangle'); },
      bank: () => { [523, 659, 784].forEach((f, i) => this.tone(i * 0.08, 0.25, f, 0.1, 'triangle')); },
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
  pop(node){
    if (!node || this.reduced) return;
    node.animate([{transform: 'scale(1)'}, {transform: 'scale(1.15)'}, {transform: 'scale(1)'}],
                 {duration: 360, easing: 'cubic-bezier(.3,1.5,.5,1)'});
  },
  shake(node){
    if (!node || this.reduced) return;
    node.animate([{transform: 'translateX(0)'}, {transform: 'translateX(-6px)'}, {transform: 'translateX(6px)'},
                  {transform: 'translateX(-3px)'}, {transform: 'translateX(0)'}], {duration: 320});
  },
  // A card (or a word) that bursts over the table: a trap turning over, Shoo!, +7.
  async burst(content, kind, hold){
    const node = el('div', {class: `pr-burst pr-burst-${kind || 'plain'}`, role: 'status'},
                    typeof content === 'string' ? [content] : content);
    document.body.appendChild(node);
    if (!this.reduced) {
      await node.animate([
        {transform: 'translate(-50%, -50%) scale(.3) rotate(-8deg)', opacity: 0},
        {transform: 'translate(-50%, -50%) scale(1.08) rotate(-3deg)', opacity: 1, offset: 0.6},
        {transform: 'translate(-50%, -50%) scale(1) rotate(-3deg)', opacity: 1}
      ], {duration: 320, easing: 'cubic-bezier(.3,1.4,.5,1)'}).finished.catch(() => {});
    }
    await this.wait(hold || 700);
    await node.animate([{opacity: 1}, {opacity: 0}], {duration: 220}).finished.catch(() => {});
    node.remove();
  }
};
