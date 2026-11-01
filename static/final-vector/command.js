// Final Vector's command grammar: one parser for every way an instruction is
// given. The typed command line uses it now ("SKY412 L270 D40 S210"); voice
// control will hand it a speech transcript later ("Skylark four one two, turn
// left heading two seven zero, descend four thousand feet") and get the same
// answer. It also builds the words: the controller's line, the pilot's
// readback, and the readback as the recorded clips that speak it.
//
// Pure functions, no DOM: it runs in the page and under node
// (tests/test_final_vector.py runs its cases with node when there is one).
// tools/final_vector_voice.py reads CLIPS from this file, so the list of
// recordings and the words the game can say can't drift apart.
(function (root) {
  'use strict';
  const FV = root.FV = root.FV || {};

  // Telephony designators: invented, never a real airline's.
  const AIRLINES = {
    SKY: 'Skylark', PUF: 'Puffin', KES: 'Kestrel', HER: 'Heron',
    SWF: 'Swift', GAN: 'Gannet', MDW: 'Meadow', BLB: 'Bluebird',
  };
  // Transition altitude: at or below it altitudes are in feet, above it
  // flight levels (as at most UK airports).
  const TA = 6000;
  const TOWER_FREQ = '118.5';

  // Every recorded piece, per pilot voice: key: what is said. Digits come
  // twice: "four," running on, and "four." ending a number (before a pause).
  const CLIPS = {
    d0: 'zero,', d1: 'one,', d2: 'two,', d3: 'three,', d4: 'four,',
    d5: 'five,', d6: 'six,', d7: 'seven,', d8: 'eight,', d9: 'niner,',
    e0: 'zero.', e1: 'one.', e2: 'two.', e3: 'three.', e4: 'four.',
    e5: 'five.', e6: 'six.', e7: 'seven.', e8: 'eight.', e9: 'niner.',
    left_heading: 'left heading', right_heading: 'right heading', heading: 'heading',
    descend: 'descend', climb: 'climb', maintain: 'maintain', altitude: 'altitude',
    flight_level: 'flight level', thousand: 'thousand', hundred: 'hundred', feet: 'feet',
    speed: 'speed', knots: 'knots',
    cleared_ils: 'cleared ILS runway', established: 'established localiser',
    contact_tower: 'contact tower', decimal: 'decimal', good_day: 'good day',
    hold_at: 'hold at', inbound: 'inbound', unable: 'unable', wilco: 'wilco', roger: 'roger',
    approach: 'Ambleford Approach',
    good_morning: 'good morning', good_afternoon: 'good afternoon', good_evening: 'good evening',
    skylark: 'Skylark', puffin: 'Puffin', kestrel: 'Kestrel', heron: 'Heron',
    swift: 'Swift', gannet: 'Gannet', meadow: 'Meadow', bluebird: 'Bluebird',
    dunnock: 'Dunnock', linnet: 'Linnet',
  };
  const DIGIT_WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];

  // ---------- words to tokens ----------
  const DIGITS = { ZERO: 0, OH: 0, ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9, NINER: 9 };
  const TEENS = { TEN: 10, ELEVEN: 11, TWELVE: 12, THIRTEEN: 13, FOURTEEN: 14, FIFTEEN: 15, SIXTEEN: 16, SEVENTEEN: 17, EIGHTEEN: 18, NINETEEN: 19 };
  const TENS = { TWENTY: 20, THIRTY: 30, FORTY: 40, FIFTY: 50, SIXTY: 60, SEVENTY: 70, EIGHTY: 80, NINETY: 90 };
  const isNum = t => /^\d+(\.\d+)?$/.test(t);
  const isNumWord = t => t in DIGITS || t in TEENS || t in TENS || isNum(t);

  // Runs of spoken numbers become one number token: "four thousand" → 4000,
  // "three zero zero" → 300, "two hundred and ten" → 210, "one one eight
  // decimal five" → 118.5. Typed digits pass straight through.
  function numberRun(toks, i) {
    let total = 0, cur = '', tensOpen = false, frac = '', any = false;
    for (; i < toks.length; i++) {
      const t = toks[i];
      if (isNum(t)) { cur += t; tensOpen = false; }
      else if (t in DIGITS) {
        if (tensOpen) cur = String(Number(cur) + DIGITS[t]); else cur += DIGITS[t];
        tensOpen = false;
      }
      else if (t in TEENS) { cur += TEENS[t]; tensOpen = false; }
      else if (t in TENS) { cur += TENS[t]; tensOpen = true; }
      else if (t === 'HUNDRED' && cur) { total += Number(cur) * 100; cur = ''; tensOpen = false; }
      else if (t === 'THOUSAND' && cur) { total += Number(cur) * 1000; cur = ''; tensOpen = false; }
      else if ((t === 'DECIMAL' || t === 'POINT') && (cur || total) && i + 1 < toks.length && isNumWord(toks[i + 1])) {
        for (i++; i < toks.length && (toks[i] in DIGITS || /^\d$/.test(toks[i])); i++) frac += toks[i] in DIGITS ? DIGITS[toks[i]] : toks[i];
        i--;
      }
      else if (t === 'AND' && any && i + 1 < toks.length && isNumWord(toks[i + 1]) && !isNum(toks[i + 1])) { continue; }
      else break;
      any = true;
    }
    const whole = total + (cur ? Number(cur) : 0);
    return { text: frac ? `${whole}.${frac}` : String(whole), next: i };
  }

  function tokenize(text) {
    const raw = String(text || '').toUpperCase().replace(/[^A-Z0-9.]+/g, ' ').replace(/(^|\s)\.+|\.+(\s|$)/g, ' ').trim();
    const words = raw ? raw.split(/\s+/) : [];
    const out = [];
    for (let i = 0; i < words.length;) {
      const w = words[i];
      if (w === 'FLIGHT' && words[i + 1] === 'LEVEL') { out.push('FL'); i += 2; continue; }
      if (isNumWord(w)) { const run = numberRun(words, i); out.push(run.text); i = run.next; continue; }
      out.push(w); i++;
    }
    return out;
  }

  // ---------- callsigns ----------
  const TELEPHONY = Object.fromEntries(Object.entries(AIRLINES).map(([k, v]) => [v.toUpperCase(), k]));

  // Callsigns starting with what's been typed (Tab completes, a unique
  // prefix is enough to send).
  function complete(prefix, callsigns) {
    const p = String(prefix || '').toUpperCase().replace(/\s+/g, '');
    if (!p) return [];
    return callsigns.filter(c => c.startsWith(p));
  }

  // The callsign at the start: typed ("SKY412", "SKY4", "SKY 412") or
  // spoken ("SKYLARK 412"). → {cs, next} or {error}.
  function readCallsign(toks, callsigns) {
    let t = toks[0], next = 1;
    if (!t) return { error: 'Start with a callsign.' };
    if (TELEPHONY[t]) {
      const des = TELEPHONY[t];
      if (toks[1] && isNum(toks[1])) { t = des + toks[1]; next = 2; }
      else {
        const mine = callsigns.filter(c => c.startsWith(des));
        if (mine.length === 1) return { cs: mine[0], next: 1 };
        return { error: mine.length ? `Which ${AIRLINES[des]}? ${mine.join(' or ')}.` : `No ${AIRLINES[des]} on frequency.` };
      }
    } else if (/^[A-Z]{3}$/.test(t) && toks[1] && isNum(toks[1]) && AIRLINES[t]) {
      t += toks[1]; next = 2;
    }
    if (!/^[A-Z]{1,3}\d{0,4}$/.test(t)) return { error: `"${toks[0]}" isn't a callsign on frequency.` };
    if (callsigns.includes(t)) return { cs: t, next };
    const found = complete(t, callsigns);
    if (found.length === 1) return { cs: found[0], next };
    if (found.length > 1) return { error: `${t} could be ${found.join(' or ')}.`, candidates: found };
    return { error: `No ${t} on frequency.` };
  }

  // ---------- instructions ----------
  const FILLER = new Set(['TURN', 'TO', 'FEET', 'FT', 'KNOTS', 'KTS', 'KT', 'AND', 'THEN', 'ALTITUDE', 'PLEASE', 'FLY', 'NOW', 'APPROACH', 'FOR', 'THE']);
  const fixFrom = (tok, fixes) => {
    if (fixes[tok]) return tok;
    for (const [id, name] of Object.entries(fixes)) if (name.toUpperCase() === tok) return id;
    return null;
  };
  const altFrom = (n, fl) => {
    const v = Number(n);
    if (fl) return v * 100;
    return v < 1000 ? v * 100 : v;
  };

  // The whole parse. ctx: {callsigns, fixes: {DNK: 'Dunnock'}, runway: '27'}.
  // → {ok: true, cs, cmds, canonical} or {ok: false, error, cs?}.
  // Nothing is acted on unless all of it parsed: a pilot asked to do half
  // of what was meant is worse than one asked to say again.
  function parse(text, ctx = {}) {
    const callsigns = ctx.callsigns || [], fixes = ctx.fixes || {}, runway = String(ctx.runway || '27');
    const toks = tokenize(text);
    if (!toks.length) return { ok: false, error: 'Type a callsign and an instruction.' };
    const who = readCallsign(toks, callsigns);
    if (who.error) return { ok: false, error: who.error, candidates: who.candidates };
    const cs = who.cs, cmds = [], seen = new Set();
    const add = (cmd, word) => {
      if (seen.has(cmd.t)) throw new Error(`Two ${word}s in one instruction.`);
      seen.add(cmd.t); cmds.push(cmd);
    };
    let i = who.next, dir = null;
    const num = () => (i < toks.length && isNum(toks[i]) ? toks[i++] : null);
    try {
      while (i < toks.length) {
        const t = toks[i++];
        let m;
        if (FILLER.has(t)) continue;
        if ((m = /^([LRH])(\d{1,3})$/.exec(t))) { add(heading(m[2], m[1] === 'H' ? dir : m[1]), 'heading'); dir = null; continue; }
        if ((m = /^([DCA])(\d{1,5})$/.exec(t))) { add(altitude(m[2], false, m[1]), 'level'); continue; }
        if ((m = /^([DC])?FL(\d{2,3})$/.exec(t))) { add(altitude(m[2], true, m[1] || null), 'level'); continue; }
        if ((m = /^S(\d{2,3})$/.exec(t))) { add(speed(m[1]), 'speed'); continue; }
        if ((m = /^ILS(\d{2}[LRC]?)?$/.exec(t))) { ils(m[1]); continue; }
        if (t === 'L' || t === 'LEFT' || t === 'R' || t === 'RIGHT') {
          const d = t[0];
          if (toks[i] === 'HEADING' || toks[i] === 'HDG' || toks[i] === 'H') i++;
          const n = num();
          if (n === null) { dir = d; continue; }      // "left, heading 270" said in two goes
          add(heading(n, d), 'heading'); dir = null; continue;
        }
        if (t === 'HEADING' || t === 'HDG' || t === 'H') {
          const n = num();
          if (n === null) throw new Error('Heading what? Say three figures: L270.');
          add(heading(n, dir), 'heading'); dir = null; continue;
        }
        if (t === 'DESCEND' || t === 'CLIMB' || t === 'MAINTAIN' || t === 'D' || t === 'C' || t === 'A') {
          const verb = { DESCEND: 'D', CLIMB: 'C', MAINTAIN: null, D: 'D', C: 'C', A: null }[t];
          while (toks[i] === 'TO' || toks[i] === 'ALTITUDE' || toks[i] === 'AND') i++;
          let fl = false;
          if (toks[i] === 'FL') { fl = true; i++; }
          const n = num();
          if (n === null) throw new Error(`${t === 'D' || t === 'DESCEND' ? 'Descend' : t === 'C' || t === 'CLIMB' ? 'Climb' : 'Maintain'} to what? D40 is 4,000 ft.`);
          add(altitude(n, fl, verb), 'level'); continue;
        }
        if (t === 'FL') {
          const n = num();
          if (n === null) throw new Error('Flight level what? FL80.');
          add(altitude(n, true, null), 'level'); continue;
        }
        if (t === 'SPEED' || t === 'SPD' || t === 'S' || t === 'REDUCE' || t === 'INCREASE') {
          while (toks[i] === 'SPEED' || toks[i] === 'TO') i++;
          const n = num();
          if (n === null) throw new Error('Speed what? S210.');
          add(speed(n), 'speed'); continue;
        }
        if (t === 'CLEARED' || t === 'ILS' || t === 'APP') {
          if (t === 'CLEARED') { if (toks[i] !== 'ILS') throw new Error('Cleared for what? ILS.'); i++; }
          while (toks[i] === 'APPROACH' || toks[i] === 'RUNWAY') i++;
          ils(isNum(toks[i] || '') ? toks[i++] : null); continue;
        }
        if (t === 'TWR' || t === 'TOWER' || t === 'CONTACT') {
          if (t === 'CONTACT') { if (toks[i] !== 'TOWER' && toks[i] !== 'TWR') throw new Error('Contact who? TWR.'); i++; }
          if (toks[i] && isNum(toks[i]) && parseFloat(toks[i]) === parseFloat(TOWER_FREQ)) i++;
          add({ t: 'twr' }, 'handoff'); continue;
        }
        if (t === 'HOLD') {
          if (toks[i] === 'AT') i++;
          const fix = fixFrom(toks[i] || '', fixes);
          if (!fix) throw new Error(`Hold where? ${Object.keys(fixes).join(' or ') || 'a fix'}.`);
          i++;
          add({ t: 'hold', fix }, 'hold'); continue;
        }
        throw new Error(`"${t}" isn't an instruction. Try L270, D40, S210, ILS or TWR.`);
      }
      if (dir) throw new Error('Left or right to what heading?');
    } catch (e) {
      return { ok: false, cs, error: e.message };
    }
    if (!cmds.length) return { ok: false, cs, error: `What should ${cs} do?`, needsMore: true };
    if (seen.has('hdg') && seen.has('hold')) return { ok: false, cs, error: 'A heading or a hold, not both.' };
    return { ok: true, cs, cmds, canonical: canonical(cs, cmds) };

    function heading(n, d) {
      let h = Number(n);
      if (h === 0) h = 360;
      if (!(h >= 1 && h <= 360)) throw new Error(`Heading ${n}? Headings run 001 to 360.`);
      return { t: 'hdg', hdg: h, dir: d || null };
    }
    function altitude(n, fl, verb) {
      const ft = altFrom(n, fl);
      if (!(ft >= 1000 && ft <= 25000)) throw new Error(`${ft.toLocaleString('en-GB')} ft is out of range: D40 is 4,000 ft, FL110 is a flight level.`);
      return { t: 'alt', ft, verb: verb || null };
    }
    function speed(n) {
      const kt = Number(n);
      if (!(kt >= 100 && kt <= 350)) throw new Error(`${kt} knots? Speeds run 100 to 350.`);
      return { t: 'spd', kt };
    }
    function ils(rwy) {
      if (rwy && rwy.replace(/[LRC]$/, '') !== runway) throw new Error(`Runway ${rwy} isn't in use: it's ${runway}.`);
      add({ t: 'ils' }, 'approach clearance');
    }
  }

  const pad3 = n => String(n).padStart(3, '0');
  function canonical(cs, cmds) {
    return [cs].concat(cmds.map(c => {
      if (c.t === 'hdg') return `${c.dir || 'H'}${pad3(c.hdg)}`;
      if (c.t === 'alt') return c.ft > TA ? `FL${c.ft / 100}` : `${c.verb || 'A'}${c.ft / 100}`;
      if (c.t === 'spd') return `S${c.kt}`;
      if (c.t === 'ils') return 'ILS';
      if (c.t === 'twr') return 'TWR';
      return `HOLD ${c.fix}`;
    })).join(' ');
  }

  // ---------- words ----------
  // A phrase is a list of clip keys (and plain words, for the controller's
  // lines, which aren't spoken), with ',' for a pause.
  const digitKeys = s => String(s).split('').map(d => 'd' + d);
  function callsignKeys(cs) {
    const m = /^([A-Z]+)(\d+)$/.exec(cs);
    return [AIRLINES[m[1]].toLowerCase()].concat(digitKeys(m[2]));
  }
  // 4000 → four thousand feet, 3500 → three thousand five hundred feet,
  // 8000 → flight level eight zero.
  function levelKeys(ft) {
    if (ft > TA) return ['flight_level'].concat(digitKeys(Math.round(ft / 100)));
    const th = Math.floor(ft / 1000), h = Math.round((ft % 1000) / 100);
    const out = ['altitude'];
    if (th) out.push(...digitKeys(th), 'thousand');
    if (h) out.push(...digitKeys(h), 'hundred');
    out.push('feet');
    return out;
  }
  const freqKeys = () => digitKeys(TOWER_FREQ.split('.')[0]).concat('decimal', digitKeys(TOWER_FREQ.split('.')[1]));

  // The verb an altitude needs from where the aircraft is now.
  const verbFor = (ft, alt) => (ft < alt - 50 ? 'descend' : ft > alt + 50 ? 'climb' : 'maintain');
  const turnFor = (c, hdg) => {
    if (c.dir) return c.dir;
    let d = ((c.hdg - hdg) % 360 + 540) % 360 - 180;
    return d < 0 ? 'L' : 'R';
  };

  // What the controller says (amber in the log). ac: {cs, hdg, alt}.
  function controllerKeys(cmds, ac, fixes = {}) {
    const out = callsignKeys(ac.cs);
    for (const c of cmds) {
      out.push(',');
      if (c.t === 'hdg') out.push('turn', turnFor(c, ac.hdg) === 'L' ? 'left' : 'right', 'heading', ...digitKeys(pad3(c.hdg)));
      if (c.t === 'alt') out.push(verbFor(c.ft, ac.alt), ...levelKeys(c.ft));
      if (c.t === 'spd') out.push('speed', ...digitKeys(c.kt), 'knots');
      if (c.t === 'ils') out.push('cleared_ils', ...digitKeys(ac.runway || '27'));
      if (c.t === 'twr') out.push('contact', 'Ambleford', 'tower', ...freqKeys(), ',', 'good_day');
      if (c.t === 'hold') out.push('hold_at', (fixes[c.fix] || c.fix).toLowerCase());
    }
    return out;
  }

  // The pilot's readback: the instruction, then the callsign.
  function readbackKeys(cmds, ac, fixes = {}) {
    const out = [];
    let tower = false;
    for (const c of cmds) {
      if (out.length) out.push(',');
      if (c.t === 'hdg') out.push(turnFor(c, ac.hdg) === 'L' ? 'left_heading' : 'right_heading', ...digitKeys(pad3(c.hdg)));
      if (c.t === 'alt') out.push(verbFor(c.ft, ac.alt), ...levelKeys(c.ft));
      if (c.t === 'spd') out.push('speed', ...digitKeys(c.kt), 'knots');
      if (c.t === 'ils') out.push('cleared_ils', ...digitKeys(ac.runway || '27'));
      if (c.t === 'twr') { out.push('contact_tower', ...freqKeys()); tower = true; }
      if (c.t === 'hold') out.push('hold_at', (fixes[c.fix] || c.fix).toLowerCase());
    }
    out.push(',', ...callsignKeys(ac.cs));
    if (tower) out.push(',', 'good_day');
    return out;
  }

  // "Unable speed one two zero, Skylark four one two."
  function unableKeys(what, ac) { return ['unable', ...what, ',', ...callsignKeys(ac.cs)]; }

  // A first call: "Ambleford Approach, good afternoon, Skylark four one two,
  // flight level eight zero, inbound Dunnock."
  function checkInKeys(ac, fixName, hour) {
    const greet = hour < 12 ? 'good_morning' : hour < 18 ? 'good_afternoon' : 'good_evening';
    const out = ['approach', ',', greet, ',', ...callsignKeys(ac.cs), ',', ...levelKeys(ac.alt)];
    if (fixName) out.push(',', 'inbound', fixName.toLowerCase());
    return out;
  }
  function establishedKeys(ac) { return [...callsignKeys(ac.cs), ',', 'established', ...digitKeys(ac.runway || '27')]; }

  // Words for the screen: digits as the words that are said.
  const WORDS = { tower: 'Tower', contact: 'contact', Ambleford: 'Ambleford' };
  function wordOf(k) {
    if (/^[de]\d$/.test(k)) return DIGIT_WORD[+k[1]];
    if (k in CLIPS) return CLIPS[k].replace(/[,.]$/, '');
    return WORDS[k] || k;
  }
  function text(keys) {
    let s = '';
    for (const k of keys) {
      if (k === ',') { s += ','; continue; }
      s += (s ? ' ' : '') + wordOf(k);
    }
    s = s.replace(/\s+,/g, ',');
    return s.charAt(0).toUpperCase() + s.slice(1) + '.';
  }
  // The clips that speak a phrase: a digit ending a number takes its
  // falling variant. Words with no clip (the controller's) make it null.
  function clips(keys) {
    const out = [];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k === ',') { out.push(','); continue; }
      let key = k;
      // "four thousand" runs on; "two seven." ends before a pause.
      if (/^d\d$/.test(k) && (keys[i + 1] === undefined || keys[i + 1] === ',')) key = 'e' + k[1];
      if (!(key in CLIPS)) return null;
      out.push(key);
    }
    return out;
  }

  // Short words for the dial's Send button: "Left 270, 4000, 210 kt".
  function brief(cmds, ac, fixes = {}) {
    return cmds.map(c => {
      if (c.t === 'hdg') return `${turnFor(c, ac.hdg) === 'L' ? 'Left' : 'Right'} ${pad3(c.hdg)}`;
      if (c.t === 'alt') return c.ft > TA ? `FL${pad3(c.ft / 100)}` : `${c.ft}`;
      if (c.t === 'spd') return `${c.kt} kt`;
      if (c.t === 'ils') return `Cleared ILS ${ac.runway || '27'}`;
      if (c.t === 'twr') return 'Contact tower';
      return `Hold at ${fixes[c.fix] || c.fix}`;
    }).join(', ');
  }

  FV.Command = {
    AIRLINES, CLIPS, TA, TOWER_FREQ, tokenize, parse, complete, canonical,
    callsignKeys, levelKeys, controllerKeys, readbackKeys, unableKeys, checkInKeys, establishedKeys,
    text, clips, brief, turnFor, verbFor, pad3,
    spoken: cs => text(callsignKeys(cs)).replace(/\.$/, ''),
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = FV.Command;
})(typeof window !== 'undefined' ? window : globalThis);
