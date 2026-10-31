// Split-flap display, like an old Solari departures board.
// Each tile is two static halves plus a leaf that folds down on every step; tiles step
// forward through the drum until they reach their target character.
const Flap = (() => {
  'use strict';

  const DRUM = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:/.-+!?\'';
  const STEP_MS = 46;  // per half-flip
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canAnimate = typeof Element !== 'undefined' && 'animate' in Element.prototype && !reduceMotion;
  let onTick = null;

  const wait = ms => new Promise(r => setTimeout(r, ms));

  function half(cls, ch) {
    const h = document.createElement('span');
    h.className = 'h ' + cls;
    const b = document.createElement('b');
    b.textContent = ch;
    h.appendChild(b);
    return h;
  }

  function sequence(from, to, maxSteps) {
    if (from === to) return [];
    const j = DRUM.indexOf(to);
    if (j < 0) return [to];
    let i = DRUM.indexOf(from);
    if (i < 0) i = 0;
    const seq = [];
    while (i !== j) { i = (i + 1) % DRUM.length; seq.push(DRUM[i]); }
    return seq.slice(-maxSteps);
  }

  class Tile {
    constructor(parent) {
      this.el = document.createElement('span');
      this.el.className = 'tile';
      this.top = half('t', ' ');
      this.bot = half('b', ' ');
      this.el.append(this.top, this.bot);
      parent.appendChild(this.el);
      this.ch = ' ';
      this.gen = 0;
    }

    show(ch) {
      this.gen++;
      this.ch = ch;
      this.top.firstChild.textContent = ch;
      this.bot.firstChild.textContent = ch;
    }

    async flipTo(target, delay, maxSteps) {
      const gen = ++this.gen;
      if (delay) await wait(delay);
      for (const ch of sequence(this.ch, target, maxSteps)) {
        if (gen !== this.gen) return;
        await this.step(ch);
      }
    }

    async step(next) {
      const prev = this.ch;
      this.ch = next;
      this.top.firstChild.textContent = next;
      if (onTick) onTick();
      const upper = half('t leaf', prev);
      this.el.appendChild(upper);
      await upper.animate(
        [{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-90deg)', filter: 'brightness(0.55)' }],
        { duration: STEP_MS, easing: 'ease-in' }).finished.catch(() => {});
      upper.remove();
      const lower = half('b leaf', next);
      this.el.appendChild(lower);
      await lower.animate(
        [{ transform: 'rotateX(90deg)', filter: 'brightness(1.5)' }, { transform: 'rotateX(0deg)' }],
        { duration: STEP_MS, easing: 'ease-out' }).finished.catch(() => {});
      this.bot.firstChild.textContent = this.ch;
      lower.remove();
    }
  }

  class Board {
    constructor(el, length) {
      this.el = el;
      el.classList.add('flaps');
      el.textContent = '';
      this.tiles = Array.from({ length }, () => new Tile(el));
      this.text = '';
    }

    // opts: instant, align ('left' | 'right' | 'center'), stagger (ms between tiles), maxSteps, delay
    set(text, opts = {}) {
      const n = this.tiles.length;
      let s = String(text).toUpperCase().slice(0, n);
      if (opts.align === 'right') s = s.padStart(n);
      else if (opts.align === 'center') s = s.padStart(Math.floor((n + s.length) / 2)).padEnd(n);
      else s = s.padEnd(n);
      if (s === this.text) return;
      this.text = s;
      const stagger = opts.stagger == null ? 24 : opts.stagger;
      const maxSteps = opts.maxSteps || 7;
      this.tiles.forEach((tile, i) => {
        const ch = s[i];
        if (opts.instant || !canAnimate) tile.show(ch);
        else tile.flipTo(ch, tile.ch === ch ? 0 : (opts.delay || 0) + i * stagger + Math.random() * 30, maxSteps);
      });
    }
  }

  return { Board, onTick: fn => { onTick = fn; } };
})();
