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
    const lb = $('read-lookback');
    lb.replaceChildren();
    if (str(b.lookback, 600)) {
      const t = b.lookback.replace(/^\s*since last week\s*[:,.;\u2013\u2014-]*\s*/i, '');
      lb.append(el('strong', {}, 'Since last week: '), t.charAt(0).toUpperCase() + t.slice(1));
    }
    lb.hidden = !lb.childNodes.length;
    $('read-items').replaceChildren(...b.items.map((it) => {
      const li = el('li', { class: 'read-item' });
      const fold = el('details', { class: 'fold' });
      fold.open = window.matchMedia('(min-width: 760px)').matches;
      const sum = el('summary');
      const head = el('div', { class: 'read-head' });
      const tagRow = el('span', { class: 'sig-right' });
      tagRow.append(el('span', { class: 'sig-tag' }, str(it.tag, 20) ? it.tag : ''), el('span', { class: 'chev', 'aria-hidden': 'true' }));
      head.append(tagRow, el('h3', {}, it.title));
      sum.append(head);
      const src = el('p', { class: 'read-src' });
      src.append('Sources: ');
      it.sources.forEach((s, i) => {
        if (i) src.append(', ');
        src.append(el('a', { href: s.url, rel: 'noopener', target: '_blank' }, s.name));
      });
      const body = el('div', { class: 'fold-body' });
      body.append(el('p', { class: 'read-text' }, it.text), src);
      fold.append(sum, body);
      li.append(fold);
      return li;
    }));
    const watch = Array.isArray(b.watch) ? b.watch : [];
    $('read-watch-wrap').hidden = !watch.length;
    $('read-watch').replaceChildren(...watch.map((w) => el('li', {}, w)));
    $('weekly').hidden = false;
  }

  init();
})();
