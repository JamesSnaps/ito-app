// The Passport: where conditions' stamps live. Plain global, no build step.
// Draws the condition icons, the stamps (inked, at a slight angle, each
// condition its own shape) and the book: a contents page, then one page per
// airport. game.js owns the data and hands it over as a model; this only draws.

const Passport = (() => {
  const ICONS = {
    day: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    dusk: '<path d="M6.5 16a5.5 5.5 0 0 1 11 0"/><path d="M2.5 16h19M5 20h14M12 5v3M4.6 8.6l2 2M19.4 8.6l-2 2"/>',
    night: '<path d="M15.5 3.5a8.5 8.5 0 1 0 5 14.6A7 7 0 0 1 15.5 3.5z"/>',
    snow: '<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6M9.5 4l2.5 2 2.5-2M9.5 20l2.5-2 2.5 2"/>',
    storm: '<path d="M13.5 2.5L5 13.5h6l-1.5 8 9-11h-6z"/>',
    fog: '<path d="M8 20V8l2-4 2 4v12M6.5 8h7"/><path d="M2.5 13h4M15.5 13h6M2.5 17h5M14.5 17h7"/>',
  };
  const icon = (c, cls = 'cond-icon') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[c] || ''}</svg>`;

  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  function stampDate(at) {
    const d = at ? new Date(at) : null;
    if (!d || isNaN(d)) return '';
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`;
  }
  // A small seeded wobble, so a stamp always sits at the same angle.
  function angle(seed) {
    const x = Math.sin(seed * 9301 + 49297) * 233280;
    return ((x - Math.floor(x)) - 0.5) * 22;
  }
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  // Each condition has its own outline, doubled like a rubber stamp's.
  const SHAPES = {
    dusk: r => `<circle cx="60" cy="60" r="${54 - r}"/>`,
    night: r => `<rect x="${8 + r}" y="${8 + r}" width="${104 - 2 * r}" height="${104 - 2 * r}" rx="10"/>`,
    snow: r => { const a = 52 - r, b = a * 0.414; return `<path d="M${60 - b} ${60 - a}H${60 + b}L${60 + a} ${60 - b}V${60 + b}L${60 + b} ${60 + a}H${60 - b}L${60 - a} ${60 + b}V${60 - b}Z"/>`; },
    storm: r => `<rect x="${4 + r}" y="${18 + r}" width="${112 - 2 * r}" height="${84 - 2 * r}" rx="4"/>`,
    fog: r => `<ellipse cx="60" cy="60" rx="${56 - r}" ry="${46 - r}"/>`,
  };
  function stamp(c, info, code, at, stars, seed) {
    const shape = SHAPES[c] || SHAPES.dusk;
    return `<svg class="stamp" viewBox="0 0 120 120" role="img" aria-label="${esc(info.name)} stamp, ${esc(code)}, ${stars} star${stars === 1 ? '' : 's'}" style="--ink:${info.ink}">
      <g transform="rotate(${angle(seed * 7 + c.length * 13 + c.charCodeAt(0)).toFixed(1)} 60 60)" filter="url(#fa-ink)">
        <g class="stamp-line">${shape(0)}${shape(5)}</g>
        <text x="60" y="38" class="stamp-code">${esc(code)}</text>
        <g transform="translate(47 41) scale(1.08)" class="stamp-icon">${ICONS[c]}</g>
        <text x="60" y="82" class="stamp-name">${esc(info.name.toUpperCase())}</text>
        <text x="60" y="95" class="stamp-date">${esc(stampDate(at))}</text>
        <text x="60" y="${c === 'storm' ? 104 : 107}" class="stamp-stars">${'★'.repeat(stars)}${'☆'.repeat(Math.max(0, 3 - stars))}</text>
      </g>
    </svg>`;
  }

  // ---------- the book ----------
  // model: { title, readOnly, conditions, airports: [{ id, code, name, offered: [c],
  //          got: { c: { stars, at } }, lock: { c: message | null } }] }
  let model = null, page = 0, root = null;
  const pages = () => (model ? model.airports.length + 1 : 1);

  function hint(a, c) {
    const lock = a.lock[c];
    if (lock) return `<span class="slot-lock">${esc(lock)}</span>`;
    return model.readOnly ? 'Not yet' : `Clear ${esc(a.name)} ${esc(model.conditions[c].at)}`;
  }
  function contents() {
    const tiles = model.airports.map((a, i) => {
      const dots = a.offered.map(c => {
        const info = model.conditions[c];
        return `<i class="${a.got[c] ? 'on' : ''}" style="--ink:${info.ink}" title="${esc(info.name)}"></i>`;
      }).join('');
      const n = a.offered.filter(c => a.got[c]).length;
      return `<button class="pp-tile" data-page="${i + 1}"><b>${esc(a.code)}</b><span>${esc(a.name)}</span><em>${dots}</em><small>${n} of ${a.offered.length}</small></button>`;
    }).join('');
    const total = model.airports.reduce((s, a) => s + a.offered.filter(c => a.got[c]).length, 0);
    const all = model.airports.reduce((s, a) => s + a.offered.length, 0);
    return `<div class="pp-head"><h2>${esc(model.title)}</h2><span>${total} of ${all} stamps</span></div><div class="pp-tiles">${tiles}</div>`;
  }
  function airportPage(a) {
    const slots = a.offered.map(c => {
      const info = model.conditions[c], got = a.got[c];
      if (got) return `<div class="pp-slot got">${stamp(c, info, a.code, got.at, got.stars, a.id)}</div>`;
      return `<div class="pp-slot empty" style="--ink:${info.ink}"><div class="pp-ghost">${icon(c)}<b>${esc(info.name)}</b></div><p>${hint(a, c)}</p></div>`;
    }).join('');
    const n = a.offered.filter(c => a.got[c]).length;
    return `<div class="pp-head"><h2>${esc(a.code)} <small>${esc(a.name)}</small></h2><span>${n} of ${a.offered.length} stamps</span></div><div class="pp-slots">${slots}</div>`;
  }
  function draw() {
    const body = root.querySelector('.pp-page');
    body.innerHTML = page === 0 ? contents() : airportPage(model.airports[page - 1]);
    root.querySelector('.pp-title').textContent = model.title;
    root.querySelector('.pp-prev').disabled = page === 0;
    root.querySelector('.pp-next').disabled = page >= pages() - 1;
    root.querySelector('.pp-contents').disabled = page === 0;
    root.querySelector('.pp-folio').textContent = page === 0 ? 'Contents' : `${page} / ${pages() - 1}`;
    for (const t of body.querySelectorAll('[data-page]')) t.addEventListener('click', () => go(+t.dataset.page));
  }
  function go(n) {
    page = Math.max(0, Math.min(pages() - 1, n));
    draw();
  }
  function open(el, m, start = 0) {
    root = el; model = m;
    go(start);
  }
  function bind(el, onClose) {
    el.querySelector('.pp-prev').addEventListener('click', () => go(page - 1));
    el.querySelector('.pp-next').addEventListener('click', () => go(page + 1));
    el.querySelector('.pp-contents').addEventListener('click', () => go(0));
    el.querySelector('.pp-close').addEventListener('click', onClose);
    // Swipe between pages.
    let x0 = null;
    const book = el.querySelector('.pp-book');
    book.addEventListener('pointerdown', e => { x0 = e.clientX; });
    book.addEventListener('pointerup', e => {
      if (x0 == null) return;
      const dx = e.clientX - x0; x0 = null;
      if (Math.abs(dx) > 50) go(page + (dx < 0 ? 1 : -1));
    });
    window.addEventListener('keydown', e => {
      if (!model || el.classList.contains('hidden')) return;
      if (e.key === 'ArrowRight') go(page + 1);
      if (e.key === 'ArrowLeft') go(page - 1);
    });
  }

  return { icon, stamp, stampDate, open, bind, go, get page() { return page; } };
})();
