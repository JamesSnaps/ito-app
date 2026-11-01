/* Gem Delve test cave. One cave per four-letter code, so everyone can play the same one.
   Sprites come from window.DELVE_ART ({name: url}, rendered by games/gem_delve/game.py);
   the art's source is games/gem_delve/art.px.js. */
(() => {
"use strict";

const TILE = 16, VW = 320, VH = 180;
const W = 32, H = 44;
const TIME_LIMIT = 180;
const T = { AIR: 0, DIRT: 1, ROCK: 2, BEDROCK: 3, ORE_E: 4, ORE_S: 5, ORE_R: 6, ORE_G: 7, LADDER: 8, SPIKES: 9, EXIT: 10 };
const ORE_GEM = { 4: "emerald", 5: "sapphire", 6: "ruby", 7: "gold" };
const GEM_VALUE = { emerald: 1, sapphire: 2, ruby: 3, gold: 5 };
const TILE_ART = { 1: "dirt", 2: "rock", 3: "bedrock", 4: "ore_emerald", 5: "ore_sapphire", 6: "ore_ruby", 7: "ore_gold", 8: "ladder", 9: "spikes", 10: "exit" };
const isSolid = (t) => t >= 1 && t <= 7;
const isDiggable = (t) => t === T.DIRT || (t >= 4 && t <= 7);
const isOre = (t) => t >= 4 && t <= 7;

const GRAVITY = 900, MAX_FALL = 340, RUN = 88, JUMP = 268, CLIMB = 62;

// ------------------------------------------------------------------ cave codes and randomness
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no I/O/0/1, as with room codes
const randomCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
const cleanCode = (s) => (s || "").toUpperCase().split("").filter((ch) => CODE_CHARS.includes(ch)).join("").slice(0, 4);

function hashCode(s) {
  let h = 2166136261;
  for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ the cave
// Only the border and small boulders are undiggable, so every cave can be finished with the pickaxe.
function generate(code) {
  const rnd = mulberry32(hashCode(code));
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const g = new Uint8Array(W * H);
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? T.BEDROCK : g[y * W + x];
  const set = (x, y, t) => { if (x > 0 && y > 0 && x < W - 1 && y < H - 1) g[y * W + x] = t; };
  const border = (x, y) => x === 0 || y === 0 || x === W - 1 || y === H - 1;

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    g[y * W + x] = border(x, y) ? T.BEDROCK : (rnd() < 0.5 ? T.DIRT : T.AIR);

  for (let pass = 0; pass < 4; pass++) {
    const next = g.slice();
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
        if ((dx || dy) && at(x + dx, y + dy) !== T.AIR) n++;
      if (n >= 5) next[y * W + x] = T.DIRT;
      else if (n <= 3) next[y * W + x] = T.AIR;
    }
    g.set(next);
  }

  // Start near the top, way out near the bottom.
  const sx = ri(4, W - 5);
  for (let y = 1; y <= 4; y++) for (let x = sx - 2; x <= sx + 2; x++) set(x, y, T.AIR);
  for (let x = sx - 2; x <= sx + 2; x++) set(x, 5, T.DIRT);
  const ex = ri(4, W - 5), ey = H - 3;
  for (let y = H - 6; y <= H - 3; y++) for (let x = ex - 2; x <= ex + 2; x++) set(x, y, T.AIR);
  for (let x = ex - 2; x <= ex + 2; x++) set(x, H - 2, T.DIRT);
  set(ex, ey, T.EXIT);
  const nearStart = (x, y) => Math.abs(x - sx) < 6 && y < 9;
  const nearExit = (x, y) => Math.abs(x - ex) < 4 && y > H - 8;

  // Boulders: only into dirt, so they never wall a passage off on their own.
  for (let i = 0; i < 34; i++) {
    const bx = ri(2, W - 5), by = ri(7, H - 8), bw = ri(1, 3), bh = ri(1, 2);
    for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++)
      if (at(x, y) === T.DIRT && !nearExit(x, y)) set(x, y, T.ROCK);
  }

  // Ore: mostly on cave walls, some buried. Better gems deeper down.
  const oreFor = (y) => {
    const d = y / H, r = rnd();
    if (d > 0.7 && r < 0.25) return T.ORE_G;
    if (d > 0.4 && r < 0.45) return T.ORE_R;
    if (r < 0.5) return T.ORE_S;
    return T.ORE_E;
  };
  for (let y = 6; y < H - 2; y++) for (let x = 1; x < W - 1; x++) {
    if (at(x, y) !== T.DIRT) continue;
    const open = at(x - 1, y) === T.AIR || at(x + 1, y) === T.AIR || at(x, y - 1) === T.AIR || at(x, y + 1) === T.AIR;
    if (rnd() < (open ? 0.06 : 0.02)) set(x, y, oreFor(y));
  }

  // Ladders up to a ledge you can step off onto.
  let ladders = 0;
  for (let y = H - 3; y > 7 && ladders < 14; y--) for (let x = 2; x < W - 2 && ladders < 14; x++) {
    if (at(x, y) !== T.AIR || !isSolid(at(x, y + 1)) || nearExit(x, y)) continue;
    for (let h = 3; h <= 7; h++) {
      let clear = true;
      for (let k = 0; k <= h; k++) if (at(x, y - k) !== T.AIR) { clear = false; break; }
      if (!clear) break;
      const ty = y - h;
      const ledge = [-1, 1].some((s) => at(x + s, ty) === T.AIR && isSolid(at(x + s, ty + 1)));
      if (ledge && rnd() < 0.3) {
        for (let k = 0; k <= h; k++) set(x, y - k, T.LADDER);
        ladders++;
        break;
      }
    }
  }

  const pickups = [], bats = [];
  for (let y = 2; y < H - 2; y++) for (let x = 1; x < W - 1; x++) {
    if (at(x, y) !== T.AIR) continue;
    const floor = isSolid(at(x, y + 1)), ceiling = isSolid(at(x, y - 1));
    if (floor && !nearStart(x, y) && !nearExit(x, y) && rnd() < 0.045) { set(x, y, T.SPIKES); continue; }
    if (floor && rnd() < 0.03) {
      const types = ["emerald", "emerald", "sapphire", "ruby"];
      pickups.push(makeGem(x * TILE + 5, y * TILE + 9, types[ri(0, 3)], 0, 0, 1));
    }
    if (ceiling && !floor && y > 9 && bats.length < 12 && rnd() < 0.03)
      bats.push({ x: x * TILE + 3, y: y * TILE, w: 10, h: 7, state: "hang", t: rnd() * 6, vx: 0, vy: 0 });
  }
  return { g, at, set, start: { x: sx * TILE + 3, y: 5 * TILE - 14 }, exit: { x: ex, y: ey }, pickups, bats };
}

function makeGem(x, y, type, vx, vy, age = 0) {
  return { x, y, w: 6, h: 6, type, vx, vy, age, rest: vy === 0 && vx === 0 };
}

// ------------------------------------------------------------------ art
const ART = window.DELVE_ART;
const img = {};
function loadArt() {
  return Promise.all(Object.entries(ART).map(([name, src]) => new Promise((ok, fail) => {
    const im = new Image();
    im.onload = () => { img[name] = im; ok(); };
    im.onerror = fail;
    im.src = src;
  })));
}

// ------------------------------------------------------------------ sound
let actx = null, muted = false;
try { muted = localStorage.getItem("delve:muted") === "1"; } catch (e) {}
function blip(freq, dur, type = "square", vol = 0.06, slide = 0) {
  if (muted) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), gn = actx.createGain(), t = actx.currentTime;
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    gn.gain.setValueAtTime(vol, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn).connect(actx.destination); o.start(t); o.stop(t + dur);
  } catch (e) {}
}
const sfx = {
  jump: () => blip(330, 0.12, "square", 0.04, 220),
  dig: () => blip(110, 0.08, "triangle", 0.12, -40),
  clink: () => blip(900, 0.06, "square", 0.04),
  gem: () => { blip(880, 0.07, "square", 0.04); setTimeout(() => blip(1320, 0.09, "square", 0.04), 60); },
  hurt: () => blip(200, 0.25, "sawtooth", 0.07, -150),
  bat: () => blip(600, 0.1, "square", 0.04, -400),
  out: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 0.14, "square", 0.05), i * 90)),
};

// ------------------------------------------------------------------ input
const held = { left: false, right: false, up: false, down: false, jump: false, dig: false };
const latch = { jump: false, dig: false, up: false };
const keys = {}, touch = {}, pad = {};
const KEYMAP = {
  ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
  ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
  Space: "jump", KeyZ: "jump", KeyK: "jump", KeyX: "dig", KeyJ: "dig", ShiftLeft: "dig", ShiftRight: "dig",
};
addEventListener("keydown", (e) => {
  const a = KEYMAP[e.code];
  if (!a || state !== "play") return;
  e.preventDefault();
  if (!keys[a] && a in latch) latch[a] = true;
  keys[a] = true;
});
addEventListener("keyup", (e) => { const a = KEYMAP[e.code]; if (a) keys[a] = false; });
addEventListener("blur", () => { for (const k in keys) keys[k] = false; });

function setTouch(a, on) {
  if (on && !touch[a] && a in latch) latch[a] = true;
  touch[a] = on;
}

function pollPad() {
  for (const k in pad) pad[k] = false;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of pads) {
    if (!gp) continue;
    const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    pad.left = pad.left || ax < -0.4 || b(14);
    pad.right = pad.right || ax > 0.4 || b(15);
    pad.up = pad.up || ay < -0.5 || b(12);
    pad.down = pad.down || ay > 0.5 || b(13);
    pad.jump = pad.jump || b(0);
    pad.dig = pad.dig || b(2) || b(1);
  }
}

const prev = {};
function readInput() {
  pollPad();
  const pressed = {};
  for (const a in held) {
    held[a] = !!(keys[a] || touch[a] || pad[a]);
    pressed[a] = (held[a] && !prev[a]) || !!latch[a];
    prev[a] = held[a];
  }
  for (const a in latch) latch[a] = false;
  return pressed;
}

// ------------------------------------------------------------------ game state
let cave, player, pickups, bats, particles, damage, code, timeLeft, state = "title", camX = 0, camY = 0, shake = 0;

function newGame(c) {
  code = c;
  cave = generate(code);
  pickups = cave.pickups; bats = cave.bats; particles = []; damage = new Map();
  player = {
    x: cave.start.x, y: cave.start.y, w: 10, h: 14, vx: 0, vy: 0, face: 1,
    onGround: false, climbing: false, coyote: 0, jumpBuf: 0, hearts: 3, inv: 0, stun: 0,
    swing: 0, swingHit: false, swingDir: "side", bag: [], anim: 0,
  };
  timeLeft = TIME_LIMIT;
  camX = player.x - VW / 2; camY = player.y - VH / 2;
  state = "play";
  ui.codeLabel.textContent = code;
  hideOverlay();
  updateHud(true);
  stage.focus();
}

// ------------------------------------------------------------------ collision helpers
const tileAt = (px, py) => cave.at(Math.floor(px / TILE), Math.floor(py / TILE));
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function moveX(e, dx) {
  e.x += dx;
  const top = Math.floor(e.y / TILE), bot = Math.floor((e.y + e.h - 0.01) / TILE);
  if (dx > 0) {
    const tx = Math.floor((e.x + e.w) / TILE);
    for (let ty = top; ty <= bot; ty++) if (isSolid(cave.at(tx, ty))) { e.x = tx * TILE - e.w; return true; }
  } else if (dx < 0) {
    const tx = Math.floor(e.x / TILE);
    for (let ty = top; ty <= bot; ty++) if (isSolid(cave.at(tx, ty))) { e.x = (tx + 1) * TILE; return true; }
  }
  return false;
}
function moveY(e, dy) {
  e.y += dy;
  const l = Math.floor(e.x / TILE), r = Math.floor((e.x + e.w - 0.01) / TILE);
  if (dy > 0) {
    const ty = Math.floor((e.y + e.h) / TILE);
    for (let tx = l; tx <= r; tx++) if (isSolid(cave.at(tx, ty))) { e.y = ty * TILE - e.h; return true; }
  } else if (dy < 0) {
    const ty = Math.floor(e.y / TILE);
    for (let tx = l; tx <= r; tx++) if (isSolid(cave.at(tx, ty))) { e.y = (ty + 1) * TILE; return true; }
  }
  return false;
}

function burst(x, y, colors, n, speed = 70) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random());
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life: 0.35 + Math.random() * 0.35, color: colors[i % colors.length], size: Math.random() < 0.5 ? 1 : 2 });
  }
}
const DIRT_BITS = ["#8a6340", "#6b4a2f", "#4a3220"];
const GEM_BITS = { emerald: ["#6fe0a8", "#1f8a5b"], sapphire: ["#7fb0ff", "#2a5fc0"], ruby: ["#ff6f8a", "#c0284a"], gold: ["#ffe27a", "#c99a14"] };

// ------------------------------------------------------------------ the step
function hurt(fromX) {
  const p = player;
  if (p.inv > 0 || state !== "play") return;
  p.hearts--; p.inv = 1.4; p.stun = 0.25; p.climbing = false;
  p.vy = -170; p.vx = (p.x + p.w / 2 < fromX ? -1 : 1) * 110;
  shake = 0.25; sfx.hurt();
  const drop = Math.ceil(p.bag.length / 3);
  for (let i = 0; i < drop; i++) {
    const type = p.bag.splice(Math.floor(Math.random() * p.bag.length), 1)[0];
    pickups.push(makeGem(p.x + 2, p.y + 2, type, (Math.random() - 0.5) * 160, -120 - Math.random() * 80));
  }
  updateHud();
  if (p.hearts <= 0) end("dead");
}

function strike() {
  const p = player, cx = p.x + p.w / 2, cy = p.y + p.h / 2;
  let tx, ty, box;
  if (p.swingDir === "down") { tx = Math.floor(cx / TILE); ty = Math.floor((p.y + p.h + 2) / TILE); box = { x: p.x - 2, y: p.y + p.h - 2, w: p.w + 4, h: 14 }; }
  else if (p.swingDir === "up") { tx = Math.floor(cx / TILE); ty = Math.floor((p.y - 3) / TILE); box = { x: p.x - 2, y: p.y - 12, w: p.w + 4, h: 14 }; }
  else {
    tx = Math.floor((p.face > 0 ? p.x + p.w + 3 : p.x - 4) / TILE); ty = Math.floor(cy / TILE);
    box = { x: p.face > 0 ? p.x + p.w - 2 : p.x - 14, y: p.y - 2, w: 16, h: p.h + 4 };
  }
  for (const b of bats) if (!b.dead && overlaps(box, b)) killBat(b);

  const t = cave.at(tx, ty), mx = tx * TILE + 8, my = ty * TILE + 8;
  if (isDiggable(t)) {
    const key = ty * W + tx;
    if (isOre(t) && !damage.get(key)) {
      damage.set(key, 1); sfx.dig(); burst(mx, my, DIRT_BITS, 5);
      return;
    }
    damage.delete(key);
    cave.set(tx, ty, T.AIR);
    sfx.dig(); burst(mx, my, DIRT_BITS, 10);
    if (isOre(t)) {
      const type = ORE_GEM[t], n = type === "gold" ? 1 : 2;
      for (let i = 0; i < n; i++) pickups.push(makeGem(mx - 3, my - 3, type, (Math.random() - 0.5) * 90, -110 - Math.random() * 60));
      burst(mx, my, GEM_BITS[type], 6);
    }
    // A ladder or spikes left floating over a hole fall away with it.
    const above = cave.at(tx, ty - 1);
    if (above === T.SPIKES) cave.set(tx, ty - 1, T.AIR);
  } else if (t === T.ROCK || t === T.BEDROCK) {
    sfx.clink(); burst(mx, my, ["#a0a0b0", "#fff6e0"], 4, 50);
  }
}

function killBat(b) {
  b.dead = true; sfx.bat();
  burst(b.x + 5, b.y + 3, ["#6a4a8a", "#3a2450", "#e0405a"], 10);
}

function step(dt, input) {
  const p = player;
  timeLeft -= dt;
  if (timeLeft <= 0) { timeLeft = 0; end("time"); return; }
  p.inv = Math.max(0, p.inv - dt); p.stun = Math.max(0, p.stun - dt);
  const ctrl = p.stun <= 0;
  const dir = ctrl ? (held.right ? 1 : 0) - (held.left ? 1 : 0) : 0;
  if (dir) p.face = dir;

  const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
  const onLadder = (y) => cave.at(Math.floor(cx / TILE), Math.floor(y / TILE)) === T.LADDER;

  if (!p.climbing && ctrl && (held.up || (held.down && !p.onGround)) && onLadder(cy)) {
    p.climbing = true; p.vx = 0;
    p.x = Math.floor(cx / TILE) * TILE + 8 - p.w / 2;
  }

  if (input.jump) p.jumpBuf = 0.12; else p.jumpBuf = Math.max(0, p.jumpBuf - dt);

  if (p.climbing) {
    const vdir = (held.down ? 1 : 0) - (held.up ? 1 : 0);
    p.vy = vdir * CLIMB;
    if (vdir < 0 && !onLadder(cy + p.vy * dt)) p.vy = 0;
    p.vx = 0;
    if (dir) { p.climbing = false; p.vx = dir * RUN * 0.6; }
    if (p.jumpBuf > 0) { p.climbing = false; p.jumpBuf = 0; p.vy = -JUMP * 0.75; sfx.jump(); }
    if (vdir) p.anim += dt;
  } else {
    const target = dir * RUN, accel = p.onGround ? 1100 : 700;
    if (ctrl) p.vx += Math.sign(target - p.vx) * Math.min(Math.abs(target - p.vx), accel * dt);
    p.vy += GRAVITY * dt;
    if (p.vy < 0 && !held.jump) p.vy += GRAVITY * dt * 1.4;   // let go early for a short hop
    p.vy = Math.min(p.vy, MAX_FALL);
    if (p.jumpBuf > 0 && (p.onGround || p.coyote > 0) && ctrl) {
      p.vy = -JUMP; p.jumpBuf = 0; p.coyote = 0; sfx.jump();
    }
  }

  if (moveX(p, p.vx * dt)) p.vx = 0;
  const wasFalling = p.vy > 0;
  p.onGround = false;
  if (moveY(p, p.vy * dt)) { if (wasFalling) p.onGround = true; p.vy = 0; }
  if (p.climbing && !onLadder(p.y + p.h / 2)) p.climbing = false;
  p.coyote = p.onGround ? 0.08 : Math.max(0, p.coyote - dt);
  if (p.onGround && Math.abs(p.vx) > 5) p.anim += dt;

  // Pickaxe.
  if (input.dig && p.swing <= 0 && ctrl) {
    p.swing = 0.26; p.swingHit = false;
    p.swingDir = held.down ? "down" : held.up ? "up" : "side";
  }
  if (p.swing > 0) {
    p.swing -= dt;
    if (!p.swingHit && p.swing <= 0.14) { p.swingHit = true; strike(); }
  }

  // Spikes: only the points hurt, and only on the way down.
  for (let tx = Math.floor(p.x / TILE); tx <= Math.floor((p.x + p.w - 0.01) / TILE); tx++) {
    const ty = Math.floor((p.y + p.h - 1) / TILE);
    if (cave.at(tx, ty) === T.SPIKES && p.y + p.h > ty * TILE + 10 && p.vy >= 0) hurt(tx * TILE + 8);
  }

  // Bats.
  for (const b of bats) {
    if (b.dead) continue;
    b.t += dt;
    const dx = cx - (b.x + b.w / 2), dy = cy - (b.y + b.h / 2), dist = Math.hypot(dx, dy);
    if (b.state === "hang" && dist < 72 && dy > -8) { b.state = "fly"; sfx.bat(); }
    if (b.state === "fly") {
      const sp = 46;
      b.vx = (dx / (dist || 1)) * sp;
      b.vy = (dy / (dist || 1)) * sp + Math.sin(b.t * 9) * 40;
      const ox = b.x, oy = b.y;
      b.x += b.vx * dt; if (isSolid(tileAt(b.x + b.w / 2, b.y + b.h / 2))) b.x = ox;
      b.y += b.vy * dt; if (isSolid(tileAt(b.x + b.w / 2, b.y + b.h / 2))) b.y = oy;
    }
    if (overlaps(p, b)) {
      if (p.vy > 30 && p.y + p.h - b.y < 8) { killBat(b); p.vy = -210; }
      else hurt(b.x + b.w / 2);
    }
  }
  bats = bats.filter((b) => !b.dead);

  // Gems.
  for (const gm of pickups) {
    gm.age += dt;
    if (!gm.rest) {
      gm.vy = Math.min(gm.vy + GRAVITY * dt, MAX_FALL);
      if (moveX(gm, gm.vx * dt)) gm.vx = -gm.vx * 0.4;
      if (moveY(gm, gm.vy * dt)) {
        if (gm.vy > 0) { gm.vx *= 0.6; gm.vy = Math.abs(gm.vy) < 60 ? 0 : -gm.vy * 0.35; if (!gm.vy && Math.abs(gm.vx) < 8) gm.rest = true; }
        else gm.vy = 0;
      }
    } else if (!isSolid(tileAt(gm.x + 3, gm.y + gm.h + 1))) gm.rest = false;
    if (gm.age > 0.4 && overlaps(p, gm)) {
      gm.taken = true; p.bag.push(gm.type); sfx.gem();
      burst(gm.x + 3, gm.y + 3, GEM_BITS[gm.type], 6, 40);
      updateHud();
    }
  }
  pickups = pickups.filter((gm) => !gm.taken);

  for (const pt of particles) { pt.life -= dt; pt.vy += GRAVITY * 0.6 * dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; }
  particles = particles.filter((pt) => pt.life > 0);
  shake = Math.max(0, shake - dt);

  // The way out.
  const atExit = cave.at(Math.floor(cx / TILE), Math.floor(cy / TILE)) === T.EXIT;
  ui.prompt.hidden = !atExit;
  if (atExit && input.up && p.onGround) end("out");
}

// ------------------------------------------------------------------ drawing
const canvas = document.getElementById("view");
const ctx = canvas.getContext("2d");
canvas.width = VW; canvas.height = VH;
const dark = document.createElement("canvas");
dark.width = VW; dark.height = VH;
const dctx = dark.getContext("2d");

function minerFrame() {
  const p = player;
  if (p.swing > 0) return p.swing > 0.14 ? "m_swing1" : "m_swing2";
  if (p.climbing) return Math.floor(p.anim * 6) % 2 ? "m_climb2" : "m_climb1";
  if (!p.onGround) return "m_jump";
  if (Math.abs(p.vx) > 5) return ["m_run1", "m_run2", "m_run3", "m_run2"][Math.floor(p.anim * 10) % 4];
  return "m_idle";
}

function draw() {
  const p = player;
  const tcx = p.x + p.w / 2 - VW / 2, tcy = p.y + p.h / 2 - VH / 2;
  camX += (tcx - camX) * 0.15; camY += (tcy - camY) * 0.15;
  camX = Math.max(0, Math.min(W * TILE - VW, camX));
  camY = Math.max(0, Math.min(H * TILE - VH, camY));
  let ox = Math.round(camX), oy = Math.round(camY);
  if (shake > 0) { ox += Math.round((Math.random() - 0.5) * 4); oy += Math.round((Math.random() - 0.5) * 4); }

  ctx.fillStyle = "#1e1828"; ctx.fillRect(0, 0, VW, VH);
  const ores = [], now = performance.now() / 1000;
  const x0 = Math.max(0, Math.floor(ox / TILE)), y0 = Math.max(0, Math.floor(oy / TILE));
  const x1 = Math.min(W - 1, Math.floor((ox + VW) / TILE)), y1 = Math.min(H - 1, Math.floor((oy + VH) / TILE));
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const t = cave.at(tx, ty), sx = tx * TILE - ox, sy = ty * TILE - oy;
    if (!isSolid(t)) ctx.drawImage(img.backwall, sx, sy);
    if (t !== T.AIR) ctx.drawImage(img[TILE_ART[t]], sx, sy);
    if (t === T.DIRT || isOre(t)) {
      if (!isSolid(cave.at(tx, ty - 1))) { ctx.fillStyle = "#8a6340"; ctx.fillRect(sx, sy, TILE, 2); }
      if (!isSolid(cave.at(tx, ty + 1))) { ctx.fillStyle = "#4a3220"; ctx.fillRect(sx, sy + TILE - 2, TILE, 2); }
    }
    if (isOre(t)) {
      ores.push([sx + 8, sy + 8]);
      // A glint wanders across each ore block, a different moment for each.
      const ph = (now * 0.8 + tx * 0.37 + ty * 0.61) % 1;
      if (ph < 0.12) {
        const gx = sx + 3 + ((tx * 7 + ty * 3) % 10), gy = sy + 3 + ((tx * 5 + ty * 11) % 10);
        ctx.fillStyle = "#fff6e0";
        ctx.fillRect(gx, gy - 1, 1, 3); ctx.fillRect(gx - 1, gy, 3, 1);
      }
    }
    if (damage.get(ty * W + tx)) {
      ctx.fillStyle = "#14101c";
      ctx.fillRect(sx + 7, sy + 2, 1, 5); ctx.fillRect(sx + 8, sy + 6, 1, 4); ctx.fillRect(sx + 5, sy + 9, 3, 1); ctx.fillRect(sx + 9, sy + 10, 1, 4);
    }
  }

  for (const gm of pickups) {
    const bob = gm.rest ? Math.round(Math.sin(gm.age * 3 + gm.x) * 1) : 0;
    ctx.drawImage(img["gem_" + gm.type], Math.round(gm.x - 1 - ox), Math.round(gm.y - 1 - oy + bob));
  }
  for (const b of bats) {
    const art = b.state === "hang" ? "bat_hang" : (Math.floor(b.t * 10) % 2 ? "bat_up" : "bat_down");
    ctx.drawImage(img[art], Math.round(b.x - ox), Math.round(b.y - oy));
  }

  if (!(p.inv > 0 && Math.floor(p.inv * 12) % 2)) {
    const art = img[minerFrame()];
    const dx = Math.round(p.x - 2 - ox), dy = Math.round(p.y + p.h - art.height + 1 - oy);
    ctx.save();
    if (p.face < 0) { ctx.translate(dx + art.width, dy); ctx.scale(-1, 1); ctx.drawImage(art, 0, 0); }
    else ctx.drawImage(art, dx, dy);
    ctx.restore();
  }

  for (const pt of particles) { ctx.fillStyle = pt.color; ctx.fillRect(Math.round(pt.x - ox), Math.round(pt.y - oy), pt.size, pt.size); }

  // The miner's lamp: the cave is dim except around you, gems glint a little.
  dctx.globalCompositeOperation = "source-over";
  dctx.clearRect(0, 0, VW, VH);
  dctx.fillStyle = "rgba(8,6,14,0.55)"; dctx.fillRect(0, 0, VW, VH);
  dctx.globalCompositeOperation = "destination-out";
  const hole = (x, y, r, a) => {
    const gr = dctx.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, "rgba(0,0,0,0)");
    dctx.fillStyle = gr; dctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  hole(p.x + p.w / 2 + p.face * 10 - ox, p.y + 2 - oy, 110, 1);
  for (const gm of pickups) hole(gm.x + 3 - ox, gm.y + 3 - oy, 14, 0.7);
  for (const [x, y] of ores) hole(x, y, 12, 0.55);
  hole(cave.exit.x * TILE + 8 - ox, cave.exit.y * TILE + 5 - oy, 40, 0.9);
  ctx.drawImage(dark, 0, 0);
}

// ------------------------------------------------------------------ HUD and screens
const $ = (id) => document.getElementById(id);
const stage = $("stage");
const ui = {
  hearts: $("hearts"), bag: $("bag"), time: $("time"), codeLabel: $("code-label"), prompt: $("prompt"),
  overlay: $("overlay"), panel: $("panel"), mute: $("mute"),
};

function bagValue(bag) { return bag.reduce((s, t) => s + GEM_VALUE[t], 0); }

let lastSec = -1;
function updateHud(force) {
  const p = player;
  ui.hearts.innerHTML = "";
  for (let i = 0; i < 3; i++) {
    const im = document.createElement("img");
    im.src = ART[i < p.hearts ? "heart" : "heart_empty"]; im.alt = "";
    ui.hearts.appendChild(im);
  }
  ui.hearts.setAttribute("aria-label", `${p.hearts} hearts left`);
  ui.bag.textContent = bagValue(p.bag);
  if (force) lastSec = -1;
}
function updateTimer() {
  const s = Math.ceil(timeLeft);
  if (s === lastSec) return;
  lastSec = s;
  ui.time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  ui.time.classList.toggle("low", s <= 30);
}

function readBest() { try { return JSON.parse(localStorage.getItem("delve:best") || "{}"); } catch (e) { return {}; } }
function writeBest(b) { try { localStorage.setItem("delve:best", JSON.stringify(b)); } catch (e) {} }

function gemSummary(bag) {
  const counts = {};
  for (const t of bag) counts[t] = (counts[t] || 0) + 1;
  return ["gold", "ruby", "sapphire", "emerald"].filter((t) => counts[t]).map((t) =>
    `<span class="chip"><img src="${ART["gem_" + t]}" alt="">${counts[t]} × ${GEM_VALUE[t]}</span>`).join("");
}

function end(why) {
  if (state !== "play") return;
  state = "over";
  ui.prompt.hidden = true;
  const p = player, value = why === "out" ? bagValue(p.bag) : 0;
  const best = readBest(), prevBest = best[code] || 0;
  if (value > prevBest) { best[code] = value; writeBest(best); }
  if (why === "out") sfx.out();
  const head = { out: "You made it out!", dead: "The cave got you", time: "Time's up: the tunnel caved in" }[why];
  const line = why === "out"
    ? (p.bag.length ? `You banked <b>${value}</b> from ${p.bag.length} gem${p.bag.length === 1 ? "" : "s"}.` : "You got out, but with an empty bag.")
    : (p.bag.length ? `The ${p.bag.length} gem${p.bag.length === 1 ? "" : "s"} you were carrying stay down here.` : "Nothing lost: your bag was empty.");
  showOverlay(`
    <h2>${head}</h2>
    <p>${line}</p>
    ${why === "out" && p.bag.length ? `<div class="chips">${gemSummary(p.bag)}</div>` : ""}
    <p class="small">Cave <b>${code}</b> · your best here: <b>${Math.max(prevBest, value)}</b>${value > prevBest && prevBest > 0 ? " (new best!)" : ""}</p>
    <div class="buttons">
      <button type="button" id="again" class="primary">Same cave again</button>
      <button type="button" id="fresh">New cave</button>
    </div>
    ${codeForm()}
    <a class="back" href="/">← Game Night</a>`);
  $("again").onclick = () => newGame(code);
  $("fresh").onclick = () => newGame(randomCode());
  wireCodeForm();
  $("again").focus();
}

function codeForm() {
  return `<form id="code-form" class="code-form" autocomplete="off">
    <label for="code-input">Play a friend's cave</label>
    <div class="row"><input id="code-input" maxlength="4" placeholder="ABCD" spellcheck="false" autocapitalize="characters"><button type="submit">Go</button></div>
  </form>`;
}
function wireCodeForm() {
  const f = $("code-form"), inp = $("code-input");
  inp.addEventListener("input", () => { inp.value = cleanCode(inp.value); });
  f.addEventListener("submit", (e) => {
    e.preventDefault();
    const c = cleanCode(inp.value);
    if (c.length === 4) newGame(c); else { inp.focus(); inp.classList.add("bad"); }
  });
}

function showOverlay(html) { ui.panel.innerHTML = html; ui.overlay.hidden = false; }
function hideOverlay() { ui.overlay.hidden = true; }

function title() {
  state = "title";
  const firstCode = (/^#[A-Za-z0-9]{4}$/.test(location.hash) && cleanCode(location.hash.slice(1)).length === 4) ? cleanCode(location.hash.slice(1)) : randomCode();
  showOverlay(`
    <p class="eyebrow">Test cave</p>
    <h1>Gem Delve</h1>
    <p>Dig for gems and get out through the mine shaft at the bottom before the three minutes run out. Gems only count once you're out.</p>
    <ul class="how">
      <li><b>Dirt</b> digs away. <b>Grey rock</b> doesn't. Sparkly ore takes two hits.</li>
      <li><b>Bats</b>: jump on them or hit them with the pick. <b>Spikes</b> hurt.</li>
      <li>Get hurt and you drop some of your gems. Lose all three hearts and you lose the lot.</li>
    </ul>
    <div class="keys">
      <span><kbd>←</kbd><kbd>→</kbd> run</span><span><kbd>Space</kbd> jump</span><span><kbd>X</kbd> dig (hold <kbd>↓</kbd> or <kbd>↑</kbd> to dig down or up)</span><span><kbd>↑</kbd> climb, and leave at the shaft</span>
    </div>
    <div class="buttons"><button type="button" id="go" class="primary">Start cave ${firstCode}</button></div>
    ${codeForm()}
    <a class="back" href="/">← Game Night</a>`);
  $("go").onclick = () => newGame(firstCode);
  wireCodeForm();
}

ui.mute.addEventListener("click", () => {
  muted = !muted;
  try { localStorage.setItem("delve:muted", muted ? "1" : "0"); } catch (e) {}
  ui.mute.setAttribute("aria-pressed", String(!muted));
  ui.mute.textContent = muted ? "Sound off" : "Sound on";
});
ui.mute.setAttribute("aria-pressed", String(!muted));
ui.mute.textContent = muted ? "Sound off" : "Sound on";

// ------------------------------------------------------------------ touch controls
function bindTouch() {
  const padEl = $("dpad");
  const active = new Map();
  const capture = (el, id) => { try { el.setPointerCapture(id); } catch (e) {} };
  const apply = () => {
    const dirs = { left: false, right: false, up: false, down: false };
    for (const d of active.values()) for (const k in d) dirs[k] = dirs[k] || d[k];
    for (const k in dirs) setTouch(k, dirs[k]);
    padEl.dataset.dir = Object.keys(dirs).filter((k) => dirs[k]).join(" ");
  };
  const read = (e) => {
    const r = padEl.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const dead = r.width * 0.14;
    return { left: dx < -dead, right: dx > dead, up: dy < -dead * 1.4, down: dy > dead * 1.4 };
  };
  padEl.addEventListener("pointerdown", (e) => { e.preventDefault(); capture(padEl, e.pointerId); active.set(e.pointerId, read(e)); apply(); });
  padEl.addEventListener("pointermove", (e) => { if (active.has(e.pointerId)) { active.set(e.pointerId, read(e)); apply(); } });
  for (const ev of ["pointerup", "pointercancel", "lostpointercapture"])
    padEl.addEventListener(ev, (e) => { active.delete(e.pointerId); apply(); });

  for (const btn of document.querySelectorAll("[data-act]")) {
    const a = btn.dataset.act, ids = new Set();
    btn.addEventListener("pointerdown", (e) => { e.preventDefault(); capture(btn, e.pointerId); ids.add(e.pointerId); setTouch(a, true); btn.classList.add("down"); });
    for (const ev of ["pointerup", "pointercancel", "lostpointercapture"])
      btn.addEventListener(ev, (e) => { ids.delete(e.pointerId); if (!ids.size) { setTouch(a, false); btn.classList.remove("down"); } });
  }
}

// Touch controls show on touch screens, and as soon as anyone touches the page.
const coarse = matchMedia("(pointer: coarse)").matches;
document.body.classList.toggle("touch", coarse);
addEventListener("touchstart", () => document.body.classList.add("touch"), { once: true, passive: true });

// ------------------------------------------------------------------ loop
let last = 0, acc = 0;
const DT = 1 / 60;
function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = Math.min(0.1, (now - last) / 1000 || 0);
  last = now;
  if (state === "play") {
    acc += elapsed;
    while (acc >= DT && state === "play") { step(DT, readInput()); acc -= DT; }
    updateTimer();
  } else acc = 0;
  if (cave) draw();
}

// Test builds only: step the game by hand (a hidden tab gets no animation frames).
if (window.DELVE_DEBUG) window.DELVE_DEBUG.api = {
  start: (c) => newGame(c),
  run(seconds, input = {}) {
    for (const k in keys) keys[k] = false;
    Object.assign(keys, input);
    for (let i = 0; i < Math.round(seconds * 60) && state === "play"; i++) step(DT, readInput());
    for (const k in keys) keys[k] = false;
    updateTimer();
    for (let i = 0; i < 40; i++) draw();   // let the camera catch up
    return this.peek();
  },
  tap(action) { latch[action] = true; return this.run(1 / 60, { [action]: true }); },
  peek: () => ({ state, x: Math.round(player.x), y: Math.round(player.y), onGround: player.onGround, climbing: player.climbing,
    hearts: player.hearts, bag: player.bag.length, time: Math.round(timeLeft), pickups: pickups.length, bats: bats.length,
    exit: cave.exit }),
  around(r = 4) {
    const tx = Math.floor((player.x + 5) / TILE), ty = Math.floor((player.y + 7) / TILE), rows = [];
    for (let y = ty - r; y <= ty + r; y++) {
      let s = "";
      for (let x = tx - r * 2; x <= tx + r * 2; x++) s += (x === tx && y === ty) ? "@" : " #XBooooHSE"[cave.at(x, y)] || "?";
      rows.push(s.replace(/ /g, "."));
    }
    return rows.join("\n");
  },
  cave: () => cave, player: () => player,
};

loadArt().then(() => {
  bindTouch();
  $("bag-icon").src = ART.gem_ruby;
  // A cave behind the title screen, so the first frame isn't empty.
  code = randomCode(); cave = generate(code); pickups = cave.pickups; bats = cave.bats; particles = []; damage = new Map();
  player = { x: cave.start.x, y: cave.start.y, w: 10, h: 14, vx: 0, vy: 0, face: 1, onGround: true, climbing: false, hearts: 3, inv: 0, swing: 0, bag: [], anim: 0 };
  camX = player.x - VW / 2; camY = player.y - VH / 2;
  updateHud(true);
  title();
  requestAnimationFrame(frame);
});
})();
