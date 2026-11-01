// Player profiles on every page: who this device is, and everyone's faces.
// Plain globals under GN, no modules — no build step. Each game's own el()
// lives in its own script, so nothing here relies on one.
//
// Faces are looked up by name, the way the records already key players:
// trimmed, spaces collapsed, case ignored. A name with no profile behind it
// is a guest, and gets initials (or, in Fugitive, a drawn mugshot).

const GN = (() => {
  const ME_KEY = 'gamenight:me';

  function fold(name){ return (name || '').trim().replace(/\s+/g, ' ').toLowerCase(); }

  function node(tag, cls, text){
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // This device's profile, if it has one: {id, name, photo, token}.
  const me = {
    get(){
      try { return JSON.parse(localStorage.getItem(ME_KEY)); } catch (e) { return null; }
    },
    set(value){
      try { localStorage.setItem(ME_KEY, JSON.stringify(value)); } catch (e) {}
    },
    clear(){
      try { localStorage.removeItem(ME_KEY); } catch (e) {}
    },
    headers(){
      const mine = this.get();
      return mine && mine.token ? {'X-Profile-Token': mine.token} : {};
    }
  };

  const profiles = {
    list: [],
    loading: null,
    // Fetched once per page. A page that renders before it lands redraws
    // when it does (see the games' calls).
    load(){
      if (!this.loading) {
        this.loading = fetch('/api/profiles')
          .then(r => r.ok ? r.json() : {profiles: []})
          .then(d => { this.list = Array.isArray(d.profiles) ? d.profiles : []; return this.list; })
          .catch(() => this.list);
      }
      return this.loading;
    },
    byName(name){
      const key = fold(name);
      return key ? this.list.find(p => fold(p.name) === key) || null : null;
    },
    photo(name){
      const p = this.byName(name);
      return p ? p.photo : null;
    }
  };

  // A stable colour per name, for initials.
  function hue(name){
    let h = 0;
    for (const ch of fold(name)) h = (h * 31 + ch.codePointAt(0)) % 360;
    return h;
  }

  function initials(name){
    const words = (name || '?').trim().split(/\s+/).filter(Boolean);
    const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] || '?').slice(0, 2);
    return letters.toUpperCase();
  }

  // A round face: the profile photo if there is one, initials if not.
  function avatar(name, size, extraClass){
    const wrap = node('span', `gn-avatar ${extraClass || ''}`);
    wrap.style.setProperty('--size', `${size || 36}px`);
    const photo = profiles.photo(name);
    if (photo) {
      const img = node('img');
      img.src = photo;
      img.alt = '';
      img.decoding = 'async';
      img.loading = 'lazy';
      wrap.appendChild(img);
    } else {
      wrap.classList.add('gn-avatar-initials');
      wrap.style.setProperty('--hue', hue(name));
      wrap.appendChild(node('span', null, initials(name)));
    }
    wrap.title = name || '';
    return wrap;
  }

  // The regulars, as faces to tap: "who's playing?" without typing. `skip`
  // is names already at the table; `onPick(name)` adds one.
  function picker(onPick, skip, label){
    const taken = new Set((skip || []).map(fold));
    const people = profiles.list.filter(p => !taken.has(fold(p.name)));
    if (!people.length) return null;
    const row = node('div', 'gn-picker');
    if (label) row.appendChild(node('div', 'gn-picker-label', label));
    const faces = node('div', 'gn-picker-faces');
    const mine = me.get();
    people
      .sort((a, b) => (mine && b.id === mine.id) - (mine && a.id === mine.id))
      .forEach(p => {
        const button = node('button', 'gn-pick');
        button.type = 'button';
        button.appendChild(avatar(p.name, 44));
        button.appendChild(node('span', 'gn-pick-name', p.name));
        button.addEventListener('click', () => onPick(p.name));
        faces.appendChild(button);
      });
    row.appendChild(faces);
    return row;
  }

  // --- signing in from a new device (core/profiles.py, "pairing") --------
  //
  // The new device taps a face and asks; a device that's already that
  // person says yes. Both halves are a <dialog> over the page. Only the hub
  // and the You page use them (they need style.css's .gn-sheet).

  function sheet(){
    const d = node('dialog', 'gn-sheet');
    document.body.appendChild(d);
    d.addEventListener('close', () => d.remove());
    return d;
  }

  function button(text, cls, onClick){
    const b = node('button', `btn ${cls}`, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function buttons(...list){
    const row = node('div', 'gn-sheet-buttons');
    list.filter(Boolean).forEach(b => row.appendChild(b));
    if (list.filter(Boolean).length === 1) row.classList.add('gn-sheet-one');
    return row;
  }

  function spaced(code){ return `${code.slice(0, 3)} ${code.slice(3)}`; }

  async function json(url, options){
    try {
      const res = await fetch(url, options);
      return {ok: res.ok, status: res.status, data: await res.json().catch(() => ({}))};
    } catch (e) {
      return {ok: false, status: 0, data: {}};
    }
  }

  // This device asks to be `profile`. `onDone(profile)` once it is.
  function ask(profile, onDone){
    const d = sheet();
    const name = profile.name;
    let req = null;
    let timer = null;

    function show(...parts){
      d.replaceChildren(avatar(name, 72, 'gn-sheet-face'), node('h2', null, `Be ${name} here?`), ...parts);
    }
    function failed(text){
      req = null;
      show(node('p', 'gn-sheet-text', text),
           buttons(button('Close', 'btn-secondary', () => d.close()), button('Try again', 'btn-primary', start)));
    }

    async function poll(){
      if (!req || !d.open) return;
      const res = await json(`/api/profiles/pair/${req.code}`, {headers: {'X-Pair-Secret': req.secret}});
      if (!req || !d.open) return;
      const status = res.data.status;
      if (res.ok && status === 'approved') {
        req = null;
        const p = res.data.profile;
        profiles.list = profiles.list.filter(x => x.id !== p.id).concat([p]);
        me.set({id: p.id, name: p.name, photo: p.photo, token: res.data.token});
        d.replaceChildren(avatar(p.name, 72, 'gn-sheet-face'), node('h2', null, `You’re ${p.name} here now`),
          node('p', 'gn-sheet-text', 'Your name and photo will follow you into every game on this device.'),
          buttons(button('Done', 'btn-primary', () => d.close())));
        if (onDone) onDone(p);
      } else if (res.ok && status === 'refused') {
        failed(`${name}’s device said no.`);
      } else if (res.status === 404) {
        failed('That request ran out after five minutes.');
      } else {
        timer = setTimeout(poll, 2000);   // waiting, or a blip in the signal
      }
    }

    async function start(){
      show(node('p', 'gn-sheet-text', 'Asking…'));
      const res = await json('/api/profiles/pair', {method: 'POST', headers: {'Content-Type': 'application/json'},
                                                    body: JSON.stringify({profile: profile.id})});
      if (!d.open) return;
      if (!res.ok) return failed(res.data.error || 'Can’t reach Game Night. Check the connection.');
      req = res.data;
      const qr = node('div', 'qr gn-sheet-qr');
      qr.innerHTML = req.qr_svg;   // our own server's SVG
      const waiting = node('div', 'gn-waiting');
      const dots = node('span', 'gn-dots');
      dots.append(node('i'), node('i'), node('i'));
      waiting.append(dots, document.createTextNode(`Waiting for ${name}`));
      const other = node('a', 'gn-sheet-link', `Not ${name}? Make your own profile`);
      other.href = '/me';
      show(node('p', 'gn-sheet-text', `Open Game Night on ${name}’s phone or iPad and say yes there. It will show this code:`),
           node('div', 'gn-pair-code', spaced(req.code)),
           qr,
           node('p', 'gn-sheet-hint', 'Or scan this with that phone.'),
           waiting,
           buttons(button('Cancel', 'btn-secondary', () => d.close())),
           other);
      timer = setTimeout(poll, 2000);
    }

    d.addEventListener('close', () => {
      clearTimeout(timer);
      if (req) fetch(`/api/profiles/pair/${req.code}`, {method: 'DELETE', headers: {'X-Pair-Secret': req.secret}}).catch(() => {});
      req = null;
    });
    d.showModal();
    start();
  }

  // On a device that's already someone: requests to be them, to answer.
  const pairing = {
    seen: new Set(),
    open: false,
    watching: false,

    // Check now and every few seconds while the page is in view.
    watch(){
      if (this.watching) return;
      this.watching = true;
      const tick = async () => {
        if (!me.get()) { this.watching = false; return; }
        if (!document.hidden && !this.open) {
          const res = await json('/api/profiles/me/pairs', {headers: me.headers()});
          if (res.status === 403) { this.watching = false; return; }
          const next = (res.data.requests || []).find(r => !this.seen.has(r.code));
          if (next) this.review(next);
        }
        setTimeout(tick, 4000);
      };
      tick();
    },

    // The request with this code, from a scanned QR. False if there isn't one.
    async reviewCode(code){
      const res = await json('/api/profiles/me/pairs', {headers: me.headers()});
      const found = (res.data.requests || []).find(r => r.code === code);
      if (found) this.review(found);
      return !!found;
    },

    review(request){
      this.seen.add(request.code);
      this.open = true;
      const d = sheet();
      d.addEventListener('close', () => { this.open = false; });
      const mine = me.get();
      const where = request.where === 'home' ? ', on the home Wi-Fi'
        : request.where === 'away' ? ', not on the home Wi-Fi' : '';
      const answer = async approve => {
        const res = await json(`/api/profiles/me/pairs/${request.code}`, {
          method: 'POST', headers: {...me.headers(), 'Content-Type': 'application/json'},
          body: JSON.stringify({approve})});
        const text = !res.ok ? (res.data.error || 'That didn’t go through. Try again.')
          : approve ? `${request.device} is signed in as you.` : 'Turned down. Nothing was signed in.';
        d.replaceChildren(node('h2', null, res.ok && approve ? 'Signed in' : res.ok ? 'Done' : 'Hmm'),
          node('p', 'gn-sheet-text', text), buttons(button('Close', 'btn-secondary', () => d.close())));
      };
      if (mine) d.append(avatar(mine.name, 56, 'gn-sheet-face'));
      d.append(
        node('div', 'eyebrow', 'Sign-in request'),
        node('h2', null, 'A new device wants to be you'),
        node('p', 'gn-sheet-text', `${request.device}${where}. Say yes only if it’s showing this code:`),
        node('div', 'gn-pair-code', spaced(request.code)),
        buttons(button('That’s not me', 'btn-secondary', () => answer(false)),
                button('Yes, sign it in', 'btn-primary', () => answer(true))));
      d.showModal();
    }
  };

  return {me, profiles, avatar, picker, fold, pairing: Object.assign(pairing, {ask})};
})();
