'use strict';
// "Who feeds whom": reads data/trade.json (built by scripts/fetch_trade.py from UN Comtrade).
(() => {
  const WORD = { wheat: 'wheat', maize: 'maize', rice: 'rice', soybeans: 'soybeans', fertilizer: 'nitrogen fertilizer' };
  const SHORT = { wheat: 'Wheat', maize: 'Maize', rice: 'Rice', soybeans: 'Soybeans', fertilizer: 'Fertilizer' };
  const FIRST = 12; // buyers shown before "show all"

  const store = {
    get(k, d) { try { const v = localStorage.getItem('tp.' + k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('tp.' + k, String(v)); } catch { /* ignore */ } },
  };

  let T = null;
  const st = { crop: store.get('crop', 'wheat'), supplier: null, all: false };

  const $ = (id) => document.getElementById(id);
  function el(tag, attrs = {}, text) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else e.setAttribute(k, v); }
    if (text != null) e.textContent = text;
    return e;
  }
  const name = (c) => T.names[String(c)] || 'Unknown';
  // Mid-sentence form: "from the United States", "from Russia".
  const THE = new Set(['United States', 'United Kingdom', 'UAE', 'Netherlands', 'Philippines', 'Dominican Republic', 'Czech Republic', 'Gambia']);
  const inText = (c) => (THE.has(name(c)) ? 'the ' + name(c) : name(c));
  const pct = (x) => (x >= 0.995 ? '100%' : x > 0 && x < 0.01 ? '<1%' : Math.round(x * 100) + '%');
  function money(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(v >= 1e10 ? 0 : 1) + 'B';
    if (v >= 1e6) return '$' + Math.round(v / 1e6) + 'M';
    return '$' + Math.round(v / 1e3) + 'K';
  }
  const crop = () => T.commodities.find((c) => c.id === st.crop) || T.commodities[0];

  // share of each buyer's imports that comes from `sup` (or from its biggest supplier when sup is 'top')
  function exposure(c, sup) {
    return c.importers.map((b) => {
      const named = b.from.filter(([p]) => p !== -1);
      let p = sup, v = 0;
      if (sup === 'top') { if (named.length) [p, v] = named[0]; } else { v = (named.find(([q]) => q === sup) || [0, 0])[1]; }
      return { c: b.c, total: b.total, from: p, share: b.total ? v / b.total : 0, value: v };
    }).filter((r) => r.share > 0).sort((a, b) => b.share - a.share || b.total - a.total);
  }

  function renderCrops() {
    const seg = $('crop');
    seg.replaceChildren(...T.commodities.map((c) => {
      const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(c.id === st.crop), 'data-v': c.id }, SHORT[c.id] || c.name);
      return b;
    }));
  }

  function renderSellers(c) {
    const box = $('sellers');
    const top = c.exporters.slice(0, 10);
    const max = top.length ? top[0][1] : 1;
    box.classList.toggle('has-pick', st.supplier !== 'top');
    box.replaceChildren(...top.map(([p, v]) => {
      const row = el('button', { type: 'button', class: 'bar-row', 'aria-pressed': String(st.supplier === p),
        'aria-label': `${name(p)}: ${pct(v / c.covered)} of imports, ${money(v)}. Show who depends on ${name(p)}.` });
      const track = el('span', { class: 'track' });
      const fill = el('span', { class: 'fill' });
      fill.style.width = (v / max * 100).toFixed(1) + '%';
      track.append(fill);
      row.append(el('span', { class: 'nm' }, name(p)), track, el('span', { class: 'fig' }, `${pct(v / c.covered)} · ${money(v)}`));
      row.addEventListener('click', () => { st.supplier = st.supplier === p ? 'top' : p; st.all = false; render(); });
      return row;
    }));
    $('sell-note').textContent = `Each seller's share of what the ${c.importers.length} biggest buyers bought from abroad in ${T.year}. Tap a seller to see who relies on it.`;
  }

  function renderSupplierPicker(c) {
    const sel = $('supplier');
    const opts = [el('option', { value: 'top' }, 'Their biggest supplier, whoever it is')];
    for (const [p] of c.exporters.slice(0, 10)) opts.push(el('option', { value: String(p) }, name(p)));
    sel.replaceChildren(...opts);
    sel.value = String(st.supplier);
  }

  function renderBuyers(c) {
    const word = WORD[c.id] || c.name.toLowerCase();
    const rows = exposure(c, st.supplier);
    const n = c.importers.length;
    const over = rows.filter((r) => r.share > 0.5);
    const ins = $('insight');
    ins.replaceChildren();
    if (st.supplier === 'top') {
      ins.append(`${over.length} of the ${n} biggest ${word} buyers get more than half of it from a single country.`);
    } else if (!rows.length) {
      ins.append(`None of the ${n} biggest buyers reported ${word} from ${inText(st.supplier)} in ${T.year}.`);
    } else {
      const sup = inText(st.supplier);
      const h = rows[0];
      const big = rows.reduce((a, r) => (r.value > a.value ? r : a), rows[0]);
      ins.append(over.length
        ? `${over.length} of the ${n} biggest ${word} buyers get more than half of it from ${sup}. `
        : `No big buyer gets more than half its ${word} from ${sup}. `);
      ins.append('Hit hardest: ', el('strong', {}, `${name(h.c)} would lose ${pct(h.share)} of the ${word} it buys from abroad`), '.');
      if (big.c !== h.c) {
        ins.append(' Most money on the line: ', el('strong', {}, `${name(big.c)}, ${money(big.value)} a year`),
          ` (${pct(big.share)} of its ${word}).`);
      }
    }

    const shown = st.all ? rows : rows.slice(0, FIRST);
    $('buyers').replaceChildren(...shown.map((r) => {
      const row = el('div', { class: 'mrow' });
      const m = el('div', { class: 'meter', role: 'img', 'aria-label': `${name(r.c)}: ${pct(r.share)} from ${name(r.from)}` });
      const f = el('div', { class: 'fill' });
      f.style.width = (r.share * 100).toFixed(1) + '%';
      m.append(f);
      row.append(el('span', { class: 'nm' }, name(r.c)), el('span', { class: 'fig' }, pct(r.share)), m,
        el('span', { class: 'sub' }, `${st.supplier === 'top' ? 'from ' + inText(r.from) + ', its biggest supplier' : 'from ' + inText(r.from)} · buys ${money(r.total)} of ${word} a year from abroad`));
      return row;
    }));
    const more = $('more-buyers');
    more.hidden = rows.length <= FIRST;
    more.textContent = st.all ? 'Show fewer' : `Show all ${rows.length}`;
  }

  function render() {
    const c = crop();
    if (st.supplier == null || (st.supplier !== 'top' && !c.exporters.some(([p]) => p === st.supplier))) {
      st.supplier = c.exporters.length ? c.exporters[0][0] : 'top';
    }
    for (const b of $('crop').children) b.setAttribute('aria-checked', String(b.dataset.v === c.id));
    renderSellers(c);
    renderSupplierPicker(c);
    renderBuyers(c);
    $('trade-note').textContent = `${T.year} numbers from the UN's trade database, as reported by the buying countries (Russia stopped sharing its own numbers in 2022). `
      + `The ${c.importers.length} biggest buyers shown make up ${pct(c.covered / c.world)} of all the ${WORD[c.id] || c.name.toLowerCase()} bought from abroad. In US dollars.`;
  }

  async function init() {
    try {
      const r = await fetch('data/trade.json', { cache: 'no-cache' });
      if (!r.ok) return;
      T = await r.json();
    } catch { return; }
    if (!T.commodities || !T.commodities.length) return;
    renderCrops();
    $('crop').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      st.crop = b.dataset.v; st.supplier = null; st.all = false; store.set('crop', st.crop); render();
    });
    $('supplier').addEventListener('change', (e) => {
      st.supplier = e.target.value === 'top' ? 'top' : Number(e.target.value); st.all = false; render();
    });
    $('more-buyers').addEventListener('click', () => { st.all = !st.all; render(); });
    render();
    $('trade').hidden = false;

    $('trade-source').replaceChildren(el('a', { href: T.source.url, rel: 'noopener' }, 'UN Comtrade'), ' for trade between countries.');
  }

  init();
})();
