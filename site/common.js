'use strict';
// Small helpers shared by quiz.js, sync.js and scoreboard.js.
// Progress lives in localStorage under "tp." keys. save() announces real changes with a
// "tp:progress" event so sync.js (when signed in) can copy them to the cloud.
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
  return { el, load, save };
})();
