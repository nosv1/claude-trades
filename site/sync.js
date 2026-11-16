'use strict';
// Optional sign-in so quiz progress and calls follow you between devices.
// "Sign in with Google" gives us a one-time Google token; the sync worker (worker/) checks it and
// returns its own session token. Answers stay in localStorage either way; signing in adds a copy
// in the cloud and merges it with what's on this device.
(() => {
  const C = window.TP_SYNC || {};
  const box = document.getElementById('sync');
  if (!box || !C.api || !C.googleClientId) return;

  const KEY = (k) => 'tp.' + k;
  const load = (k, d) => { try { const v = localStorage.getItem(KEY(k)); return v ? JSON.parse(v) : d; } catch { return d; } };
  const store = (k, v) => { try { if (v == null) localStorage.removeItem(KEY(k)); else localStorage.setItem(KEY(k), JSON.stringify(v)); } catch { /* private mode */ } };
  function el(tag, attrs = {}, text) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else e.setAttribute(k, v); }
    if (text != null) e.textContent = text;
    return e;
  }

  async function api(method, path, body) {
    const token = load('syncToken', null);
    const r = await fetch(C.api + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401) { signedOut(); throw new Error('signed out'); }
    if (!r.ok) throw new Error('http ' + r.status);
    return r.json();
  }

  // ---- merging this device with the cloud copy ----
  function merge(local, remote) {
    const quiz = { ...remote.quiz };
    for (const [id, v] of Object.entries(local.quiz || {})) {
      if (!quiz[id] || (v.t || 0) >= (quiz[id].t || 0)) quiz[id] = v;
    }
    const byKey = new Map();
    for (const c of [...(remote.calls || []), ...(local.calls || [])]) {
      const k = c.s + '|' + c.from, prev = byKey.get(k);
      if (!prev) { byKey.set(k, c); continue; }
      const keep = prev.result && !c.result ? prev : c.result && !prev.result ? c : (prev.made || 0) <= (c.made || 0) ? prev : c;
      byKey.set(k, { ...keep, ...(prev.seen || c.seen ? { seen: true } : {}) });
    }
    const calls = [...byKey.values()].sort((a, b) => a.from - b.from || a.s.localeCompare(b.s)).slice(-40);
    return { quiz, calls };
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  let busy = false, again = false, timer = null;
  async function pull() {
    show('syncing');
    try {
      const remote = await api('GET', '/progress');
      const local = { quiz: load('quiz', {}), calls: load('calls', []) };
      const merged = merge(local, remote);
      store('quiz', merged.quiz);
      store('calls', merged.calls);
      window.dispatchEvent(new Event('tp:synced'));
      if (!same(merged, { quiz: remote.quiz, calls: remote.calls })) await api('PUT', '/progress', merged);
      show('in');
    } catch (e) { if (load('syncToken', null)) show('error'); }
  }
  async function push() {
    if (!load('syncToken', null)) return;
    if (busy) { again = true; return; }
    busy = true;
    try {
      await api('PUT', '/progress', { quiz: load('quiz', {}), calls: load('calls', []) });
      show('in');
    } catch (e) { if (load('syncToken', null)) show('error'); }
    busy = false;
    if (again) { again = false; push(); }
  }
  window.addEventListener('tp:progress', () => { clearTimeout(timer); timer = setTimeout(push, 1200); });

  // ---- Google sign-in ----
  function firstName(jwt) {
    try {
      const p = JSON.parse(decodeURIComponent(escape(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))));
      return p.given_name || p.name || '';
    } catch { return ''; }
  }
  async function onCredential(resp) {
    show('syncing');
    try {
      const r = await fetch(C.api + '/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: resp.credential }),
      });
      if (!r.ok) throw new Error('login ' + r.status);
      const { token } = await r.json();
      store('syncToken', token);
      store('syncName', firstName(resp.credential)); // kept on this device only, for the greeting
      await pull();
    } catch (e) { show('error'); }
  }
  let gisReady = null;
  function loadGoogle() {
    if (gisReady) return gisReady;
    gisReady = new Promise((resolve, reject) => {
      const s = el('script', { src: 'https://accounts.google.com/gsi/client', async: '' });
      s.onload = () => {
        window.google.accounts.id.initialize({ client_id: C.googleClientId, callback: onCredential, auto_select: false, cancel_on_tap_outside: true });
        resolve();
      };
      s.onerror = reject;
      document.head.append(s);
    });
    return gisReady;
  }

  function signedOut() { store('syncToken', null); store('syncName', null); show('out'); }

  // ---- the little box above the quiz ----
  function show(state) {
    box.hidden = false;
    box.replaceChildren();
    if (state === 'out') {
      box.append(el('p', {}, 'Sign in to keep your quiz progress and calls on every device you use.'));
      const btn = el('div', { class: 'gbtn' });
      box.append(btn);
      box.append(el('p', { class: 'mini-note' }, 'We save only an ID number from Google and your answers. No email, no name.'));
      loadGoogle().then(() => {
        const dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light'
          || document.documentElement.dataset.theme === 'dark';
        window.google.accounts.id.renderButton(btn, { type: 'standard', theme: dark ? 'filled_black' : 'outline', size: 'large', text: 'signin_with', shape: 'pill' });
      }).catch(() => { btn.replaceWith(el('p', { class: 'mini-note' }, 'Google sign-in didn\'t load. Your answers are still saved on this device.')); });
      return;
    }
    const name = load('syncName', '');
    const line = el('p', {});
    if (state === 'syncing') line.append('Syncing…');
    else if (state === 'error') line.append(el('span', { class: 'qmark no', 'aria-hidden': 'true' }, '!'), 'Couldn\'t sync just now. Your answers are still saved on this device.');
    else line.append(el('span', { class: 'qmark ok', 'aria-hidden': 'true' }, '✓'), `Saved to your account${name ? ', ' + name : ''}. Your progress follows you to any device where you sign in.`);
    const acts = el('div', { class: 'sync-acts' });
    const out = el('button', { type: 'button', class: 'more' }, 'Sign out');
    out.addEventListener('click', async () => {
      try { await api('POST', '/logout'); } catch { /* still sign out here */ }
      signedOut();
    });
    const del = el('button', { type: 'button', class: 'more' }, 'Delete saved copy');
    del.addEventListener('click', async () => {
      if (!confirm('Delete your saved progress from the cloud? Your answers on this device stay.')) return;
      try { await api('DELETE', '/progress'); } catch { /* signed out anyway */ }
      signedOut();
    });
    acts.append(out, del);
    box.append(line, acts);
  }

  if (load('syncToken', null)) pull(); else show('out');
})();
