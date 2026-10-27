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

  return {me, profiles, avatar, picker, fold};
})();
