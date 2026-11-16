'use strict';
// Small helpers shared by the page's scripts; loaded first.
// Progress lives in localStorage under "tp." keys. save() announces real changes with a
// "tp:progress" event so sync.js (when signed in) can copy them to the cloud.
// getJSON is the one way the page fetches JSON: data/ files are shape-checked where they come in.
window.TP = (() => {
  const key = (k) => 'tp.' + k;
  function el(tag, attrs = {}, text) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else e.setAttribute(k, v); }
    if (text != null) e.textContent = text;
    return e;
  }
  function load(k, d) {
    try { const v = localStorage.getItem(key(k)); return v ? JSON.parse(v) : d; } catch { return d; }
  }
  // quiet: write without announcing (used by sync.js when it writes what it just merged)
  function save(k, v, { quiet = false } = {}) {
    try {
      if (v == null) { localStorage.removeItem(key(k)); return; }
      const s = JSON.stringify(v);
      if (localStorage.getItem(key(k)) === s) return; // nothing changed
      localStorage.setItem(key(k), s);
    } catch { return; /* private mode */ }
    if (!quiet) window.dispatchEvent(new Event('tp:progress'));
  }
  // ---- data files (docs/coding-standard.md rules 3, 5, 7, 9) ----
  const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const obj = (x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
  const list = (x, ok) => Array.isArray(x) && x.every(ok);
  // Series the page reads without its own guard (hero, Heads-up, CPI); each needs 25+ numbers.
  const NEEDED = ['silver', 'gold', 'cpi', 'brent', 'fao_food', 'fao_oils', 'wheat', 'rice', 'soybeans', 'maize', 'urea', 'copper'];
  const seriesShape = (s) => obj(s) && YM.test(s.start) && list(s.values, (v) => v === null || num(v))
    && s.values.length <= 2400; // 200 years of months
  function seriesOK(D) {
    return obj(D) && obj(D.series) && obj(D.sources) && Object.values(D.series).every(seriesShape)
      && NEEDED.every((id) => D.series[id] && D.series[id].values.filter(num).length >= 25);
  }
  // One shape check per data file; a file that fails is treated as missing.
  const CHECKS = {
    'series.json': seriesOK,
    'enso.json': (d) => obj(d) && list(d.oni, (r) => Array.isArray(r) && typeof r[0] === 'string' && num(r[1]) && num(r[2])),
    'trade.json': (d) => obj(d) && obj(d.names) && list(d.commodities, (c) => obj(c) && typeof c.id === 'string'
      && num(c.covered) && list(c.exporters, (e) => Array.isArray(e) && num(e[1]))
      && list(c.importers, (i) => obj(i) && Array.isArray(i.from))),
    'spot.json': (d) => obj(d) && ['silver', 'gold'].every((k) => obj(d[k]) && num(d[k].price) && d[k].price > 0),
    'briefing.json': (d) => obj(d) && typeof d.headline === 'string' && Array.isArray(d.items),
    'scenarios.json': (d) => obj(d) && Array.isArray(d.scenarios),
    'claude-log.json': (d) => obj(d) && Array.isArray(d.calls) && Array.isArray(d.likelihoods),
  };
  const MAX_BYTES = 4e6; // our biggest file is about 0.3 MB
  function freeze(x) {
    if (x && typeof x === 'object' && !Object.isFrozen(x)) { Object.freeze(x); for (const v of Object.values(x)) freeze(v); }
    return x;
  }
  async function fetchJSON(url, timeout) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(url, { cache: 'no-cache', signal: ctl.signal });
      if (!r.ok || Number(r.headers.get('Content-Length') || 0) > MAX_BYTES) return null;
      const text = await r.text();
      return text.length > MAX_BYTES ? null : JSON.parse(text);
    } catch { return null; } finally { clearTimeout(t); } // offline, slow or not JSON: same as missing
  }
  // Fetch JSON; null if missing, slow, too big, not JSON, or (for our data/ files) the wrong shape.
  // Our data/ files are fetched once per page and shared frozen, so no script can change another's.
  const cache = new Map();
  function getJSON(url, { timeout = 15000 } = {}) {
    const check = url.startsWith('data/') ? CHECKS[url.slice(5)] : null;
    if (!check) return fetchJSON(url, timeout); // live prices: always fresh
    if (!cache.has(url)) cache.set(url, fetchJSON(url, timeout).then((d) => (check(d) ? freeze(d) : null)));
    return cache.get(url);
  }
  return { el, load, save, getJSON, seriesOK };
})();
