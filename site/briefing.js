'use strict';
// "This week's read": a short briefing Claude writes each week into data/briefing.json
// (see docs/weekly-routine.md). The section stays hidden if the file is missing or malformed.
(() => {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const $ = (id) => document.getElementById(id);
  function el(tag, attrs = {}, text) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else e.setAttribute(k, v); }
    if (text != null) e.textContent = text;
    return e;
  }
  const str = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  const https = (u) => typeof u === 'string' && /^https:\/\//.test(u);

  function valid(b) {
    return b && /^\d{4}-\d{2}-\d{2}$/.test(b.date) && str(b.headline, 140) && str(b.summary, 600)
      && Array.isArray(b.items) && b.items.length >= 1 && b.items.length <= 5
      && b.items.every((it) => it && str(it.title, 100) && str(it.text, 700)
        && Array.isArray(it.sources) && it.sources.every((s) => s && str(s.name, 60) && https(s.url)))
      && (!b.watch || (Array.isArray(b.watch) && b.watch.every((w) => str(w, 200))));
  }

  async function init() {
    let b;
    try { const r = await fetch('data/briefing.json', { cache: 'no-cache' }); if (!r.ok) return; b = await r.json(); } catch { return; }
    if (!valid(b)) return;
    const [y, m, d] = b.date.split('-').map(Number);
    const when = new Date(y, m - 1, d);
    const age = Math.floor((Date.now() - when) / 864e5);
    const label = `${d} ${MONTHS[m - 1]} ${y}`;

    $('read-byline').textContent = `Written by ${str(b.by, 40) ? b.by : 'Claude'} · ${label}`
      + (age > 13 ? ' · a newer one is overdue' : '');
    $('read-headline').textContent = b.headline;
    $('read-summary').textContent = b.summary;
    $('read-items').replaceChildren(...b.items.map((it) => {
      const li = el('li', { class: 'read-item' });
      const head = el('div', { class: 'read-head' });
      if (str(it.tag, 20)) head.append(el('span', { class: 'sig-tag' }, it.tag));
      head.append(el('h3', {}, it.title));
      const src = el('p', { class: 'read-src' });
      src.append('Sources: ');
      it.sources.forEach((s, i) => {
        if (i) src.append(', ');
        src.append(el('a', { href: s.url, rel: 'noopener', target: '_blank' }, s.name));
      });
      li.append(head, el('p', { class: 'read-text' }, it.text), src);
      return li;
    }));
    const watch = Array.isArray(b.watch) ? b.watch : [];
    $('read-watch-wrap').hidden = !watch.length;
    $('read-watch').replaceChildren(...watch.map((w) => el('li', {}, w)));
    $('weekly').hidden = false;
  }

  init();
})();
