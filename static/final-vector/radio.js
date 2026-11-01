// The radio: pilots' readbacks spoken by stringing recorded pieces together
// (static/final-vector/voice/<voice>/<clip>.mp3, made by
// tools/final_vector_voice.py), through the same kind of radio filter as
// Final Approach's: a band-pass and a soft clipper, with a squelch either
// side, which is what smooths the joins.
//
// One transmission at a time. Every line is shown in the log as it starts,
// spoken or not: with the sound off, or a clip missing, the text still comes
// on the same beat.
(function (root) {
  'use strict';
  const FV = root.FV = root.FV || {};

  const URLS = root.FV_VOICE || {};          // {george: {d4: url, …}, alice: {…}}
  const VOICES = Object.keys(URLS).sort();   // alice, george
  const GAP = 0.4;                          // seconds of quiet between transmissions
  const PAUSE = 0.13;                        // a comma
  let actx = null, bus = null, hiss = null;
  const buffers = {}, loading = {};
  let busyUntil = 0;                         // performance-clock seconds
  const queue = [];
  const state = { said: [], spoken: 0, loaded: 0, failed: 0, muted: false, voices: VOICES };

  const now = () => performance.now() / 1000;

  function unlock() {
    if (!actx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
      const master = actx.createGain();
      master.connect(actx.destination);
      const hp = actx.createBiquadFilter(), lp = actx.createBiquadFilter(), drive = actx.createWaveShaper();
      hp.type = 'highpass'; hp.frequency.value = 380;
      lp.type = 'lowpass'; lp.frequency.value = 3000;
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 2.4) / Math.tanh(2.4); }
      drive.curve = curve;
      const radio = actx.createGain();
      radio.gain.value = 1.2;
      radio.connect(hp); hp.connect(lp); lp.connect(drive); drive.connect(master);
      const sfx = actx.createGain();
      sfx.gain.value = 0.5;
      sfx.connect(master);
      bus = { master, radio, sfx };
      bus.master.gain.value = state.muted ? 0 : 1;
      // The pieces are small (about 4 KB each): fetch every one now.
      for (const v of VOICES) for (const k of Object.keys(URLS[v])) load(v, k);
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }

  // Decode, then find where the speech starts and ends: the recordings
  // carry a little silence either side, which would put gaps in a phrase.
  function load(voice, key) {
    const id = voice + '/' + key;
    if (!URLS[voice] || !URLS[voice][key] || !actx) return Promise.resolve(null);
    if (!loading[id]) {
      loading[id] = fetch(URLS[voice][key])
        .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
        .then(data => new Promise((ok, fail) => actx.decodeAudioData(data, ok, fail)))
        .then(buf => {
          const d = buf.getChannelData(0), rate = buf.sampleRate;
          let a = 0, b = d.length - 1;
          while (a < b && Math.abs(d[a]) < 0.02) a++;
          while (b > a && Math.abs(d[b]) < 0.02) b--;
          const start = Math.max(0, a / rate - 0.012), end = Math.min(buf.duration, b / rate + 0.035);
          buffers[id] = { buf, start, dur: Math.max(0.05, end - start) };
          state.loaded++;
          return buffers[id];
        })
        .catch(() => { state.failed++; return null; });
    }
    return loading[id];
  }

  function squelch(at, len, vol) {
    if (!hiss) {
      hiss = actx.createBuffer(1, Math.floor(actx.sampleRate * 0.3), actx.sampleRate);
      const d = hiss.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = actx.createBufferSource(), g = actx.createGain();
    src.buffer = hiss;
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + len);
    src.connect(g).connect(bus.radio);
    src.start(at, Math.random() * 0.05, len);
  }

  // How long a phrase will take: the real clips if they're loaded, else an
  // estimate (so text-only lines keep the same rhythm).
  function plan(voice, clips) {
    if (!clips) return null;
    const parts = [];
    for (const k of clips) {
      if (k === ',') { parts.push({ pause: PAUSE }); continue; }
      const b = buffers[voice + '/' + k];
      if (!b) return null;
      parts.push(b);
    }
    return parts;
  }

  // A transmission. keys: a phrase from FV.Command (clip keys and ','), or
  // null for a line that's only shown (the controller's own). → nothing;
  // onStart runs when it goes out (the log line), onEnd when it's done.
  function say({ voice = 0, keys = null, text = '', onStart, onEnd, words = 0 }) {
    queue.push({ voice: VOICES.length ? VOICES[voice % VOICES.length] : null, keys, text, onStart, onEnd, words });
    pump();
  }

  let timer = 0;
  function pump() {
    clearTimeout(timer);
    if (!queue.length) return;
    const t = now();
    if (t < busyUntil) { timer = setTimeout(pump, (busyUntil - t) * 1000 + 10); return; }
    const item = queue.shift();
    const clips = item.keys ? FV.Command.clips(item.keys) : null;
    const parts = actx && !state.muted && item.voice ? plan(item.voice, clips) : null;
    let length;
    if (parts) {
      // Schedule every piece back to back on the audio clock.
      const t0 = actx.currentTime + 0.08;
      squelch(t0 - 0.06, 0.05, 0.12);
      let at = t0;
      for (const p of parts) {
        if (p.pause) { at += p.pause; continue; }
        const src = actx.createBufferSource(), g = actx.createGain();
        src.buffer = p.buf;
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(1, at + 0.008);
        g.gain.setValueAtTime(1, at + p.dur - 0.012);
        g.gain.linearRampToValueAtTime(0, at + p.dur);
        src.connect(g).connect(bus.radio);
        src.start(at, p.start, p.dur);
        at += p.dur - 0.015;
      }
      squelch(at + 0.02, 0.16, 0.18);
      length = at - t0 + 0.08;
      state.spoken++;
      state.said = state.said.concat(item.voice + ':' + clips.join(' ')).slice(-20);
    } else {
      // Text only. A pilot's line keeps a spoken pace (about a third of a
      // second a word); the controller's own line isn't played back, so it
      // only holds the frequency for a moment before the readback.
      const n = item.words || (item.keys ? item.keys.filter(k => k !== ',').length : item.text.split(/\s+/).length);
      length = item.keys ? 0.6 + n * 0.3 : Math.min(1.6, 0.5 + n * 0.04);
      if (item.keys && actx && !state.muted) {
        // Not loaded yet: start loading for next time.
        if (clips) for (const k of clips) if (k !== ',' && item.voice) load(item.voice, k);
      }
    }
    busyUntil = t + length + GAP;
    if (item.onStart) item.onStart();
    if (item.onEnd) setTimeout(item.onEnd, length * 1000);
    timer = setTimeout(pump, (length + GAP) * 1000 + 10);
  }

  // The conflict alert: a two-tone, synthesised (it repeats, so no recording).
  function alarm() {
    if (!actx || state.muted) return;
    const t0 = actx.currentTime + 0.02;
    [[880, 0], [660, 0.18], [880, 0.36], [660, 0.54]].forEach(([f, d]) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.06, t0 + d + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.16);
      o.connect(g).connect(bus.sfx);
      o.start(t0 + d); o.stop(t0 + d + 0.2);
    });
  }
  function blip() {
    if (!actx || state.muted) return;
    const t0 = actx.currentTime + 0.01, o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = 1320;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    o.connect(g).connect(bus.sfx);
    o.start(t0); o.stop(t0 + 0.15);
  }

  function setMuted(m) {
    state.muted = !!m;
    if (bus) bus.master.gain.setTargetAtTime(state.muted ? 0 : 1, actx.currentTime, 0.05);
  }
  // Drop anything waiting (a lesson restarting).
  function clear() { queue.length = 0; clearTimeout(timer); busyUntil = 0; }

  FV.Radio = { unlock, load, say, alarm, blip, setMuted, clear, state, buffers, VOICES, context: () => actx };
})(typeof window !== 'undefined' ? window : globalThis);
