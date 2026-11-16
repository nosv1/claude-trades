'use strict';
// Small helpers shared by the page's scripts; loaded first.
// Progress lives in localStorage under "tp." keys. save() announces real changes with a
// "tp:progress" event so sync.js (when signed in) can copy them to the cloud.
// getJSON checks every data file where it comes in (docs/coding-standard.md rules 5 and 7).
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
  // series.json: {series: {id: {start: "YYYY-MM", values: [number | null, ...]}}}, at most 1,200
  // months per series. Anything else means a broken refresh; the page then shows its error box.
  function seriesOK(D) {
    return Boolean(D && D.series && typeof D.series === 'object') && Object.values(D.series).every((s) =>
      s && /^\d{4}-\d{2}$/.test(s.start) && Array.isArray(s.values) && s.values.length <= 1200
      && s.values.every((v) => v === null || Number.isFinite(v)));
  }
  // Every data file goes through here: null if it's missing, not JSON, or (series.json) the wrong shape.
  async function getJSON(url) {
    let d;
    try {
      const r = await fetch(url, { cache: 'no-cache' });
      if (!r.ok) return null;
      d = await r.json();
    } catch { return null; } // offline or not JSON: same as missing
    return url.endsWith('series.json') && !seriesOK(d) ? null : d;
  }
  return { el, load, save, getJSON, seriesOK };
})();
