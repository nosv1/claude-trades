'use strict';
// Optional sign-in so quiz progress and calls follow you between devices.
// "Sign in with Google" gives us a one-time Google token; the sync worker (worker/) checks it and
// returns its own session token. Answers stay in localStorage either way; signing in adds a copy
// in the cloud. Every sync reads the cloud copy, merges it with this device, then writes the
// result back, so one device never wipes out another's progress.
(() => {
  const C = window.TP_SYNC || {};
  const box = document.getElementById('sync');
  if (!box || !C.api || !C.googleClientId) return;
  const { el, load, save } = window.TP;

  const note = document.getElementById('check-note');
  if (note) note.textContent += ' If you sign in, a copy is also saved to your account so it works on your other devices.';

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
  // Same shapes the worker keeps (worker/src/index.js clean()), so equal data compares equal.
  const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  function normQuiz(q) {
    const out = {};
    for (const [k, v] of Object.entries(q || {})) if (v && typeof v === 'object') out[k] = { box: num(v.box), due: num(v.due), t: num(v.t) };
    return out;
  }
  function normCall(c) {
    return {
      s: c.s, from: num(c.from), v: num(c.v), call: c.call === 'down' ? 'down' : 'up', made: num(c.made),
      ...(c.result ? { result: { v: num(c.result.v), right: !!c.result.right } } : {}),
      ...(typeof c.seen === 'boolean' ? { seen: c.seen } : {}),
    };
  }
  function merge(local, remote) {
    const quiz = normQuiz(remote.quiz);
    for (const [id, v] of Object.entries(normQuiz(local.quiz))) if (!quiz[id] || v.t >= quiz[id].t) quiz[id] = v;
    const byKey = new Map();
    for (const c of [...(remote.calls || []), ...(local.calls || [])].filter((c) => c && c.s).map(normCall)) {
      const k = c.s + '|' + c.from, prev = byKey.get(k);
      if (!prev) { byKey.set(k, c); continue; }
      const keep = prev.result && !c.result ? prev : c.result && !prev.result ? c : prev.made <= c.made ? prev : c;
      byKey.set(k, prev.seen || c.seen ? { ...keep, seen: true } : keep);
    }
    const calls = [...byKey.values()].sort((a, b) => a.from - b.from || a.s.localeCompare(b.s)).slice(-40);
    return { quiz, calls };
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // One sync at a time; a change during a sync queues one more.
  let running = false, again = false, timer = null;
  async function sync() {
    if (!load('syncToken', null)) return;
    if (running) { again = true; return; }
    running = true;
    show('syncing');
    try {
      const remote = await api('GET', '/progress');
      const local = { quiz: load('quiz', {}), calls: load('calls', []) };
      const merged = merge(local, remote);
      const changedHere = !same(merged.quiz, normQuiz(local.quiz)) || !same(merged.calls, (local.calls || []).map(normCall));
      save('quiz', merged.quiz, { quiet: true });
      save('calls', merged.calls, { quiet: true });
      if (changedHere) window.dispatchEvent(new Event('tp:synced'));
      if (!same(merged, merge({}, remote))) await api('PUT', '/progress', merged);
      show('in');
    } catch (e) {
      if (load('syncToken', null)) show('error');
    }
    running = false;
    if (again) { again = false; sync(); }
  }
  window.addEventListener('tp:progress', () => { clearTimeout(timer); timer = setTimeout(sync, 1200); });

  // ---- Google sign-in ----
  function firstName(jwt) {
    try {
      const p = JSON.parse(decodeURIComponent(escape(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))));
      return p.given_name || '';
    } catch { return ''; }
  }
  async function onCredential(resp) {
    show('syncing');
    let token;
    try {
      const r = await fetch(C.api + '/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: resp.credential }),
      });
      if (r.ok) token = (await r.json()).token;
    } catch { /* network */ }
    if (!token) { show('out', 'Sign-in didn\'t work. Please try again.'); return; }
    save('syncToken', token, { quiet: true });
    save('syncName', firstName(resp.credential), { quiet: true }); // on this device only, for the greeting
    await sync();
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
      s.onerror = () => { gisReady = null; s.remove(); reject(new Error('gsi')); }; // let the next try load it again
      document.head.append(s);
    });
    return gisReady;
  }

  function signedOut() { save('syncToken', null, { quiet: true }); save('syncName', null, { quiet: true }); show('out'); }

  // ---- the little box above the quiz ----
  function show(state, message) {
    box.hidden = false;
    box.replaceChildren();
    if (state === 'out') {
      if (message) box.append(el('p', { class: 'sync-msg' }, message));
      box.append(el('p', {}, 'Sign in to keep your quiz progress and calls on every device you use.'));
      const btn = el('div', { class: 'gbtn' });
      box.append(btn);
      box.append(el('p', { class: 'mini-note' }, 'We save only an ID number from Google and your answers. No email, no name.'));
      loadGoogle().then(() => {
        const t = document.documentElement.dataset.theme;
        const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
        window.google.accounts.id.renderButton(btn, { type: 'standard', theme: dark ? 'filled_black' : 'outline', size: 'large', text: 'signin_with', shape: 'pill' });
      }).catch(() => { btn.replaceWith(el('p', { class: 'mini-note' }, 'Google sign-in didn\'t load. Your answers are still saved on this device.')); });
      return;
    }
    const name = load('syncName', '');
    const line = el('p', {});
    if (state === 'syncing') line.append('Syncing…');
    else if (state === 'error') line.append(el('span', { class: 'qmark no', 'aria-hidden': 'true' }, '!'), 'Couldn\'t sync just now. Your answers are still saved on this device, and they\'ll sync next time.');
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

  if (load('syncToken', null)) sync(); else show('out');
})();
