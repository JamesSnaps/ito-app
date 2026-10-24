// Shared by every Flip 7 page: the scorekeeper, the played table and the
// watch view. Plain globals, no modules — there's no build step, and each
// page is one inline script on top of this file.

// Player names are typed at the table and go straight back on screen, so
// everything is built as DOM nodes: textContent can't be got wrong the way
// an escaped HTML string can.
function el(tag, attrs, children){
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  (children || []).forEach(c => c && node.appendChild(c));
  return node;
}

// One stroked family for the whole page, drawn inline rather than pulled
// from a font — same reason the typefaces are self-hosted, and emoji came
// out as dull grey specks on some of the phones this runs on.
const ICONS = {
  scores: ['M6 20V12', 'M12 20V5', 'M18 20v-5'],
  done:   ['M5 12.5l4.5 4.5L19 7'],
  next:   ['M4 12h13', 'M12 5l7 7-7 7'],
  bust:   ['M5 5l14 14', 'M19 5L5 19'],
  freeze: ['M12 3v18', 'M4 7.5l16 9', 'M20 7.5l-16 9'],
  grip:   ['M9 5v14', 'M15 5v14'],
  flip7:  ['M12 3.5l2.5 5.4 5.9.8-4.3 4.1 1.1 5.9-5.2-2.9-5.2 2.9 1.1-5.9L3.6 9.7l5.9-.8z'],
  // The action cards and the two moves of a turn, for the played table.
  flip3:  ['M4 6l5 6-5 6', 'M10 6l5 6-5 6', 'M16 6l5 6-5 6'],
  chance: ['M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z', 'M9 12l2 2 4-4'],
  hit:    ['M12 5v14', 'M5 12h14'],
  stay:   ['M6 11V8a6 6 0 0 1 12 0v3', 'M5 11h14v9H5z'],
  back:   ['M20 12H7', 'M12 5l-7 7 7 7'],
  phone:  ['M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M11 18h2']
};
const SVG_NS = 'http://www.w3.org/2000/svg';
function icon(name){
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'f7-icon');
  svg.setAttribute('aria-hidden', 'true');
  (ICONS[name] || []).forEach(d => {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  });
  return svg;
}

// The one moment in a round worth a bit of noise. It's over in about a
// second and can't be tapped through — on the scorekeeper the next player
// is already being scrolled to underneath it. Lives outside #app, so a
// re-render doesn't take it away.
let flashTimer;
function flashFlip7(name){
  const old = document.getElementById('f7-flash');
  if (old) old.remove();
  clearTimeout(flashTimer);
  const flash = el('div', {id: 'f7-flash', class: 'f7-flash', role: 'status'}, [
    el('div', {class: 'f7-flash-card'}, [
      el('div', {class: 'f7-flash-title', text: 'FLIP 7!'}),
      el('div', {class: 'f7-flash-bonus', text: '+15'}),
      el('div', {class: 'f7-flash-who', text: name})
    ])
  ]);
  document.body.appendChild(flash);
  flashTimer = setTimeout(() => flash.remove(), 1500);
}

// Pointer events rather than HTML5 drag-and-drop: this is used on phones,
// where dragstart never fires. The chip is moved in the DOM as it's
// dragged and the arrays are only rebuilt on drop — re-rendering mid-drag
// would destroy the node under the finger.
function makeChipDraggable(chip, container, onDrop){
  chip.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;   // the remove ✕
    const startX = e.clientX, startY = e.clientY;
    let dragging = false;
    // Deliberately not setPointerCapture: capture is dropped the moment the
    // captured node is re-inserted, which is exactly what a reorder does —
    // the drag would die on its first swap. The window sees every move.

    // Drop the chip in beside whichever one the pointer is over.
    const placeAt = (x, y) => {
      // The dragged chip must not be what's found under the pointer.
      chip.style.pointerEvents = 'none';
      const under = document.elementFromPoint(x, y);
      chip.style.pointerEvents = '';
      const target = under && under.closest('.f7-chip');
      if (target && target !== chip && target.parentNode === container) {
        const box = target.getBoundingClientRect();
        const after = x > box.left + box.width / 2;
        container.insertBefore(chip, after ? target.nextSibling : target);
        return;
      }
      // Dropped in the gap past the last chip — the natural "put them last"
      // gesture, and elementFromPoint has nothing to report there.
      const rest = [...container.querySelectorAll('.f7-chip')].filter(c => c !== chip);
      if (!rest.length) return;
      const last = rest[rest.length - 1].getBoundingClientRect();
      const first = rest[0].getBoundingClientRect();
      if (y > last.top && x > last.right) container.appendChild(chip);
      else if (y < first.bottom && x < first.left) container.insertBefore(chip, rest[0]);
    };

    const move = ev => {
      if (!dragging) {
        // A short threshold, so a tap that drifts isn't read as a drag.
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        dragging = true;
        chip.classList.add('is-dragging');
      }
      placeAt(ev.clientX, ev.clientY);
    };

    // Where the finger lifts is the answer, whatever the moves in between
    // said — a quick flick can report only a couple of them.
    const end = ev => {
      if (dragging && ev && ev.clientX !== undefined) placeAt(ev.clientX, ev.clientY);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      chip.classList.remove('is-dragging');
      chip.style.pointerEvents = '';
      if (dragging) onDrop();
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });
}
