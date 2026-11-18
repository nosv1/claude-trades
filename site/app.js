'use strict';
// Trade Pulse: static dashboard. Reads data/series.json + data/spot.json (built daily by
// scripts/fetch_data.py) and the live silver/gold spot price from gold-api.com.
(() => {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const SVG = 'http://www.w3.org/2000/svg';
  const LIVE_URL = 'https://api.gold-api.com/price/';

  // ---- per-viewer preferences (best effort; the page works without storage) ----
  const store = {
    get(k, d) { try { const v = localStorage.getItem('tp.' + k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('tp.' + k, String(v)); } catch { /* ignore */ } },
  };
  const RANGES = ['1', '5', '10', '25', 'all'];
  const state = {
    range: RANGES.includes(store.get('range', '10')) ? store.get('range', '10') : '10',
    real: store.get('real', '0') === '1',
    oz: parseFloat(store.get('oz', '1')),
  };
  if (!(state.oz >= 0)) state.oz = 1;

  let D = null;      // series.json
  let live = null;   // {silver, gold, at: Date, isLive}

  // ---- card definitions ----
  const CARDS = {
    metals: [
      { id: 'silver', kind: 'usd', live: 'silver', unit: '$ per ounce' },
      { id: 'gold', kind: 'usd', live: 'gold', unit: '$ per ounce',
        blurb: 'What people buy when they\'re scared: it tends to rise when people worry about money or war.' },
      { id: 'ratio', kind: 'ratio', live: 'ratio', name: 'Gold/silver ratio', unit: 'oz of silver per oz of gold',
        blurb: 'How many ounces of silver one ounce of gold buys. Higher means silver is cheaper next to gold.' },
      { id: 'copper', kind: 'usd' },
    ],
    food: [
      { id: 'fao_food', kind: 'index', wide: true, unit: '100 = the 2014-2016 average' },
      { id: 'wheat', kind: 'usd', name: 'Wheat',
        blurb: 'Russia sells the most, then the EU, Canada, Australia and the US.' },
      { id: 'maize', kind: 'usd',
        blurb: 'The US, Brazil, Argentina and Ukraine sell most of it. Most maize feeds farm animals.' },
      { id: 'rice', kind: 'usd', name: 'Rice (from Thailand)',
        blurb: 'Only about a tenth of the world\'s rice is sold abroad. So when a big seller like India stops selling (2023), the price jumps fast.' },
      { id: 'soybeans', kind: 'usd',
        blurb: 'Brazil and the US grow most of it, and China buys most of it, mainly to feed pigs.' },
    ],
    drivers: [
      { id: 'brent', kind: 'usd', blurb: 'Brent is the main world price for crude oil. A barrel is 42 gallons. Gas, diesel and jet fuel are made from it.' },
      { id: 'urea', kind: 'usd', blurb: 'Urea is the most common fertilizer. It\'s made from natural gas.' },
    ],
    // Not adjusted for inflation (noReal): these compare currencies, not prices.
    currency: [
      { id: 'usd', kind: 'index', noReal: true, blurb: 'Higher means a stronger dollar. Not adjusted for inflation, since it compares currencies, not prices.' },
      { id: 'brl', kind: 'fx', noReal: true,
        blurb: 'Brazil sells more soybeans abroad than any other country, plus lots of sugar, coffee and beef. When the real is weak, each dollar of sales turns into more reals at home, so farmers there sell and plant more. In 2011 a dollar bought less than 2 reals. At the end of 2024 it bought about 6.' },
      { id: 'cny', kind: 'fx', noReal: true,
        blurb: 'China buys more soybeans than any other country, and lots of copper and oil. A lower number means a stronger yuan, which makes those cheaper for Chinese buyers. China\'s government held it near 8.28 per dollar from 1998 to 2005, and it still steers it.' },
      { id: 'inr', kind: 'fx', noReal: true,
        blurb: 'India sells more rice abroad than any other country, and Indian families buy lots of gold. A weaker rupee makes gold cost more in India and Indian rice cheaper abroad. In 2000 a dollar bought about 45 rupees.' },
    ],
    parts: ['fao_cereals', 'fao_oils', 'fao_dairy', 'fao_meat', 'fao_sugar'],
  };

  // ---- month helpers ----
  const mi = (s) => { const [y, m] = s.split('-').map(Number); return y * 12 + m - 1; };
  const mlabel = (m) => MONTHS[((m % 12) + 12) % 12] + ' ' + Math.floor(m / 12);
  const monthOf = (d) => d.getFullYear() * 12 + d.getMonth();

  function monthly(id) {
    const s = D.series[id];
    if (!s) return [];
    const m0 = mi(s.start);
    const out = [];
    s.values.forEach((v, i) => { if (v != null) out.push({ x: m0 + i + 0.5, m: m0 + i, v, label: mlabel(m0 + i) }); });
    return out;
  }

  // ---- inflation (US CPI) ----
  let cpiMap, cpiLast;
  function setupCPI() {
    const c = monthly('cpi');
    cpiMap = new Map(c.map((p) => [p.m, p.v]));
    cpiLast = c[c.length - 1];
    // Fill gaps (BLS published no October 2025 CPI after the government shutdown) by
    // interpolating between the neighboring months, so no price month is dropped.
    for (let i = 1; i < c.length; i++) {
      const a = c[i - 1], b = c[i];
      for (let m = a.m + 1; m < b.m; m++) cpiMap.set(m, a.v + (b.v - a.v) * (m - a.m) / (b.m - a.m));
    }
  }
  const cpiAt = (m) => cpiMap.get(m) ?? (m > cpiLast.m ? cpiLast.v : null);
  function toReal(pts) {
    return pts.flatMap((p) => {
      if (p.live) return [p];
      const c = cpiAt(p.m);
      return c ? [{ ...p, v: p.v * cpiLast.v / c }] : [];
    });
  }

  // ---- building a card's points ----
  function livePoint(v, after) {
    const d = live.at || new Date();
    const m = monthOf(d);
    const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    let x = m + (d.getDate() - 0.5) / dim;
    if (after && x <= after.x) x = after.x + 0.05;
    return { x, m, v, live: true, label: live.isLive ? 'Now (live)' : 'Latest spot, ' + shortDate(d) };
  }

  function ratioMonthly() {
    const silver = new Map(monthly('silver').map((p) => [p.m, p.v]));
    return monthly('gold').flatMap((p) => {
      const s = silver.get(p.m);
      return s ? [{ ...p, v: p.v / s }] : [];
    });
  }

  function pointsFor(def, real) {
    let pts = def.id === 'ratio' ? ratioMonthly() : monthly(def.id);
    if (def.live && live) {
      const v = def.live === 'ratio' ? live.gold / live.silver : live[def.live];
      if (v) pts = [...pts, livePoint(v, pts[pts.length - 1])];
    }
    if (real && def.kind !== 'ratio' && !def.noReal) pts = toReal(pts);
    return pts;
  }

  function windowed(pts) {
    if (state.range === 'all' || !pts.length) return pts;
    const cut = pts[pts.length - 1].x - Number(state.range) * 12;
    return pts.filter((p) => p.x >= cut);
  }

  // ---- formatting ----
  const nf = (d) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  function fmt(v, kind) {
    if (v == null || !isFinite(v)) return '-';
    if (kind === 'usd') return '$' + nf(Math.abs(v) < 100 ? 2 : 0).format(v);
    if (kind === 'fx') return nf(Math.abs(v) < 20 ? 2 : 1).format(v); // 5.13 reals, 95.5 rupees
    return nf(1).format(v);
  }
  function fmtAxis(v, kind, step) {
    const d = step < 1 ? (step < 0.1 ? 2 : 1) : 0;
    const s = Math.abs(v) >= 10000 ? nf(Math.abs(v) % 1000 ? 1 : 0).format(v / 1000) + 'K' : nf(d).format(v);
    return kind === 'usd' ? '$' + s : s;
  }
  const pct = (a, b) => (a - b) / b * 100;
  function fmtDelta(a, b) {
    if (!b) return '';
    const p = pct(a, b);
    const arrow = p > 0.05 ? '▲' : p < -0.05 ? '▼' : '■';
    return `${arrow} ${nf(Math.abs(p) < 10 ? 1 : 0).format(Math.abs(p))}%`;
  }
  const shortDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  function el(tag, attrs = {}, text) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v; else e.setAttribute(k, v);
    }
    if (text != null) e.textContent = text;
    return e;
  }
  function sv(tag, attrs = {}, style = {}) {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    Object.assign(e.style, style);
    return e;
  }

  // ---- stats ----
  const yearAgo = (pts) => {
    const last = pts[pts.length - 1];
    return pts.find((p) => p.m === last.m - 12 && !p.live);
  };
  function shareBelow(pts, v) {
    const hist = pts.filter((p) => !p.live);
    return hist.length ? hist.filter((p) => p.v < v).length / hist.length : 0;
  }
  const maxPt = (pts) => pts.reduce((a, p) => (p.v > a.v ? p : a), pts[0]);
  const minPt = (pts) => pts.reduce((a, p) => (p.v < a.v ? p : a), pts[0]);
  const median = (vs) => { const s = [...vs].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

  // ---- nice axis ticks ----
  function niceScale(lo, hi, target = 4) {
    if (lo === hi) { lo -= Math.abs(lo) * 0.1 || 1; hi += Math.abs(hi) * 0.1 || 1; }
    const raw = (hi - lo) / target;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => (hi - lo) / s <= target + 0.5) || 10 * mag;
    const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
    const ticks = [];
    for (let t = a; t <= b + step * 1e-6; t += step) ticks.push(+t.toFixed(10));
    return { lo: a, hi: b, step, ticks };
  }

  function xTicks(x0, x1, maxN) {
    const years = (x1 - x0) / 12;
    const out = [];
    if (years <= 2.2) {
      const step = [1, 2, 3, 6].find((s) => (x1 - x0) / s <= maxN) || 6;
      for (let m = Math.ceil(x0); m <= x1; m++) {
        if (m % step === 0) out.push({ x: m, label: m % 12 === 0 ? String(m / 12) : MONTHS[m % 12] });
      }
    } else {
      const step = [1, 2, 5, 10, 20, 25, 50].find((s) => years / s <= maxN) || 50;
      for (let y = Math.ceil(x0 / 12); y * 12 <= x1; y++) {
        if (y % step === 0) out.push({ x: y * 12, label: String(y) });
      }
    }
    return out;
  }

  // ---- line chart (single series, crosshair tooltip, keyboard, table twin) ----
  // Layout: plot size, y scale and the x/y mappings, shared by the drawing and hover parts below.
  function chartFrame(host, pts, def) {
    const W = Math.max(240, Math.round(host.clientWidth || 320));
    const top = 10, PH = 170, AX = 24, H = top + PH + AX;
    const vs = pts.map((p) => p.v);
    const sc = niceScale(Math.min(...vs), Math.max(...vs));
    const labels = sc.ticks.map((t) => fmtAxis(t, def.kind, sc.step));
    const ml = Math.max(...labels.map((l) => l.length)) * 6.4 + 12, mr = 10;
    const x0 = pts[0].x, x1 = pts[pts.length - 1].x;
    const sx = (x) => ml + (x - x0) / (x1 - x0) * (W - ml - mr);
    const sy = (v) => top + PH - (v - sc.lo) / (sc.hi - sc.lo) * PH;
    return { W, H, top, PH, AX, sc, labels, ml, mr, x0, x1, sx, sy };
  }

  function drawAxes(svg, f) {
    f.sc.ticks.forEach((t, i) => {
      const y = f.sy(t);
      if (i > 0) svg.append(sv('line', { x1: f.ml, x2: f.W - f.mr, y1: y, y2: y }, { stroke: 'var(--grid)', strokeWidth: 1 }));
      const tx = sv('text', { x: f.ml - 8, y: y + 4, 'text-anchor': 'end' });
      tx.textContent = f.labels[i];
      svg.append(tx);
    });
    svg.append(sv('line', { x1: f.ml, x2: f.W - f.mr, y1: f.top + f.PH, y2: f.top + f.PH }, { stroke: 'var(--axis)', strokeWidth: 1 }));
    for (const t of xTicks(f.x0, f.x1, Math.max(2, Math.floor((f.W - f.ml - f.mr) / 58)))) {
      const x = f.sx(t.x);
      if (x < f.ml + 12 || x > f.W - f.mr - 12) continue;
      const tx = sv('text', { x, y: f.top + f.PH + 17, 'text-anchor': 'middle' });
      tx.textContent = t.label;
      svg.append(tx);
    }
  }

  function drawLine(svg, pts, f) {
    const { sx, sy, top, PH } = f;
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.v).toFixed(1)}`).join('');
    svg.append(sv('path', { d: `${line}L${sx(f.x1).toFixed(1)},${top + PH}L${sx(f.x0).toFixed(1)},${top + PH}Z` }, { fill: 'var(--series-wash)' }));
    svg.append(sv('path', { d: line }, { fill: 'none', stroke: 'var(--series)', strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' }));
    const last = pts[pts.length - 1];
    svg.append(sv('circle', { cx: sx(last.x), cy: sy(last.v), r: 4 }, { fill: 'var(--series)', stroke: 'var(--surface)', strokeWidth: 2 }));
  }

  // Index of the point nearest an x position on screen (binary search: about log2(n) steps)
  function nearestIndex(svg, pts, f, clientX) {
    const r = svg.getBoundingClientRect();
    const x = (clientX - r.left) * (f.W / r.width);
    const target = f.x0 + (x - f.ml) / (f.W - f.ml - f.mr) * (f.x1 - f.x0);
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].x < target) lo = mid; else hi = mid; } // halves each step
    return Math.abs(pts[lo].x - target) <= Math.abs(pts[hi].x - target) ? lo : hi;
  }

  // Crosshair, dot and tooltip that follow the pointer or the arrow keys
  function attachHover(host, svg, pts, def, f) {
    const { W, sx, sy, top, PH, AX, ml, mr } = f;
    const cross = sv('line', { y1: top, y2: top + PH }, { stroke: 'var(--axis-text)', strokeWidth: 1, display: 'none' });
    const hdot = sv('circle', { r: 5 }, { fill: 'var(--series)', stroke: 'var(--surface)', strokeWidth: 2, display: 'none' });
    const hit = sv('rect', { x: ml, y: top, width: W - ml - mr, height: PH + AX }, { fill: 'transparent', cursor: 'crosshair' });
    svg.append(cross, hdot, hit);
    host.append(svg);

    const tip = el('div', { class: 'tip', hidden: '' });
    const tv = el('div', { class: 'v' }), td = el('div', { class: 'd' });
    tip.append(tv, td);
    host.append(tip);

    let idx = -1;
    function show(i) {
      idx = Math.max(0, Math.min(pts.length - 1, i));
      const p = pts[idx], x = sx(p.x), y = sy(p.v);
      cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.style.display = '';
      hdot.setAttribute('cx', x); hdot.setAttribute('cy', y); hdot.style.display = '';
      tv.textContent = fmt(p.v, def.kind);
      td.textContent = p.label;
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = (x > W / 2 ? Math.max(0, x - tw - 10) : Math.min(W - tw, x + 10)) + 'px';
    }
    function hide() { idx = -1; cross.style.display = 'none'; hdot.style.display = 'none'; tip.hidden = true; }
    const at = (e) => show(nearestIndex(svg, pts, f, e.clientX));
    hit.addEventListener('pointermove', at);
    hit.addEventListener('pointerdown', at);
    hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 12 : 1;
      if (e.key === 'ArrowLeft') show((idx < 0 ? pts.length : idx) - step);
      else if (e.key === 'ArrowRight') show((idx < 0 ? pts.length - 2 : idx) + step);
      else if (e.key === 'Home') show(0);
      else if (e.key === 'End') show(pts.length - 1);
      else if (e.key === 'Escape') hide();
      else return;
      e.preventDefault();
    });
  }

  function lineChart(host, pts, def, meta) {
    host.replaceChildren();
    host._pts = pts;
    if (pts.length < 2) { host.append(el('p', { class: 'context' }, 'Not enough data in this range.')); return; }
    const f = chartFrame(host, pts, def);
    const svg = sv('svg', { viewBox: `0 0 ${f.W} ${f.H}`, width: f.W, height: f.H, tabindex: 0, role: 'img',
      'aria-label': `${meta.name}: line chart of ${meta.rangeText}. Latest ${fmt(pts[pts.length - 1].v, def.kind)}. Use left and right arrow keys to read values.` });
    drawAxes(svg, f);
    drawLine(svg, pts, f);
    attachHover(host, svg, pts, def, f);
  }

  function fillTable(details, def) {
    const wrap = details.querySelector('.tblwrap');
    const pts = details._host._pts || [];
    const table = el('table');
    const head = el('tr');
    head.append(el('th', {}, 'Month'), el('th', {}, !state.real || def.kind === 'ratio' || def.noReal ? 'Value'
      : def.kind === 'usd' ? 'Value (today\'s $)' : 'Value (inflation-adjusted)'));
    const thead = el('thead'); thead.append(head);
    const tbody = el('tbody');
    for (const p of [...pts].reverse()) {
      const tr = el('tr');
      tr.append(el('td', {}, p.label), el('td', {}, fmt(p.v, def.kind)));
      tbody.append(tr);
    }
    table.append(thead, tbody);
    wrap.replaceChildren(table);
  }

  // ---- chart cards ----
  const rangeText = () => (state.range === 'all' ? 'all available history' : `the last ${state.range} year${state.range === '1' ? '' : 's'}`);

  function buildCard(def) {
    const s = D.series[def.id] || {};
    const meta = { name: def.name || s.name || def.id, unit: def.unit || s.unit || '' };
    const card = el('article', { class: def.wide ? 'card chart-card wide' : 'card chart-card', id: 'card-' + def.id });
    const h = el('h3', {}, meta.name);
    const unit = el('div', { class: 'unit' }, meta.unit);
    const stat = el('div', { class: 'stat' });
    const context = el('p', { class: 'context' });
    const host = el('div', { class: 'chart' });
    const details = el('details', { class: 'tbl' });
    details.append(el('summary', {}, 'Show as table'), el('div', { class: 'tblwrap' }));
    details._host = host;
    details.addEventListener('toggle', () => { if (details.open) fillTable(details, def); });
    card.append(h, unit, stat, context, host);
    if (def.blurb) card.append(el('p', { class: 'blurb' }, def.blurb));
    card.append(details);

    let lastW = 0;
    const render = () => {
      const all = pointsFor(def, state.real);
      const pts = windowed(all);
      if (!pts.length) return;
      const last = pts[pts.length - 1];
      const ago = yearAgo(all);
      stat.replaceChildren(el('span', { class: 'val' }, fmt(last.v, def.kind)));
      if (ago) stat.append(el('span', { class: 'delta' }, `${fmtDelta(last.v, ago.v)} vs a year ago`));
      stat.append(el('span', { class: 'when' }, last.label));
      const hi = maxPt(pts), lo = minPt(pts);
      // Rank the latest point against the other months (same convention as the hero).
      const share = shareBelow(pts.slice(0, -1), last.v);
      const rank = share === 1 ? `Highest of any month in ${rangeText()}`
        : share === 0 ? `Lowest of any month in ${rangeText()}`
        : `Higher than ${Math.round(share * 100)}% of months in ${rangeText()}`;
      context.textContent = `${rank}. Range: ${fmt(lo.v, def.kind)} (${lo.label}) to ${fmt(hi.v, def.kind)} (${hi.label}).`;
      lineChart(host, pts, def, { ...meta, rangeText: rangeText() });
      lastW = host.clientWidth;
      if (details.open) fillTable(details, def);
    };
    card._render = render;
    card._live = Boolean(def.live);
    new ResizeObserver(() => { if (Math.abs(host.clientWidth - lastW) > 4) render(); }).observe(host);
    return card;
  }

  // ---- sparkline tiles (inside the food index) ----
  function buildTile(id) {
    const s = D.series[id];
    const tile = el('div', { class: 'card tile' });
    tile._render = () => {
      const all = pointsFor({ id, kind: 'index' }, state.real);
      const pts = all.slice(-13);
      const last = pts[pts.length - 1], ago = yearAgo(all);
      tile.replaceChildren(el('div', { class: 'name' }, { fao_cereals: 'Grains', fao_oils: 'Cooking oils' }[id] || s.name), el('div', { class: 'val' }, fmt(last.v, 'index')));
      tile.append(el('div', { class: 'delta' }, ago ? `${fmtDelta(last.v, ago.v)} vs a year ago` : last.label));
      const W = 140, H = 32, vs = pts.map((p) => p.v), lo = Math.min(...vs), hi = Math.max(...vs) || 1;
      const sx = (i) => 4 + i / (pts.length - 1) * (W - 8);
      const sy = (v) => 4 + (1 - (v - lo) / (hi - lo || 1)) * (H - 8);
      const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
      svg.append(sv('path', { d: pts.map((p, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(p.v).toFixed(1)}`).join(''), 'vector-effect': 'non-scaling-stroke' },
        { fill: 'none', stroke: 'var(--spark)', strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' }));
      tile.append(svg);
      const dot = el('div');
      tile.append(dot);
      // End dot as an HTML overlay so it stays round when the SVG stretches.
      dot.style.cssText = `position:relative;height:0;`;
      const d = el('span');
      d.style.cssText = `position:absolute;right:${(4 / W * 100).toFixed(2)}%;top:${-(H - sy(last.v)) - 4}px;width:8px;height:8px;margin-right:-4px;border-radius:50%;background:var(--series);box-shadow:0 0 0 2px var(--surface);`;
      dot.append(d);
    };
    return tile;
  }

  // ---- hero ----
  // The plain-words lines under the silver price: record, rank, inflation, and gold/silver ratio
  function heroVerdict(price, nominal, since) {
    const real = toReal(nominal);
    const peak = maxPt(nominal), rpeak = maxPt(real);
    const items = [];
    const fromPeak = pct(price, peak.v);
    items.push(fromPeak >= 0
      ? `This is a record: higher than any month ever (the old record was ${fmt(peak.v, 'usd')}, ${peak.label}).`
      : fromPeak < -5
        ? `${Math.round(-fromPeak)}% below its record month, ${fmt(peak.v, 'usd')} in ${peak.label}.`
        : `Within ${Math.max(1, Math.round(-fromPeak))}% of its record month, ${fmt(peak.v, 'usd')} in ${peak.label}.`);
    const share = Math.round(shareBelow(nominal, price) * 100);
    items.push(share >= 50
      ? `Higher than ${share}% of all months since ${since} (not counting inflation).`
      : `Lower than ${100 - share}% of all months since ${since} (not counting inflation).`);
    if (rpeak.m !== peak.m) {
      const fromReal = pct(price, rpeak.v);
      items.push(fromReal >= 0
        ? `Even counting inflation, this beats the old record of ${fmt(rpeak.v, 'usd')} in today's dollars (${rpeak.label}).`
        : `Counting inflation, the record was ${rpeak.label}, at ${fmt(rpeak.v, 'usd')} in today's dollars. Today's price is ${Math.max(1, Math.round(-fromReal))}% below that.`);
    }
    const ratioNow = live.gold / live.silver;
    const med = median(ratioMonthly().map((q) => q.v));
    const verdict = ratioNow > med * 1.1 ? 'silver is cheap compared with gold'
      : ratioNow < med * 0.9 ? 'silver is expensive compared with gold' : 'silver is about normally priced against gold';
    items.push(`One ounce of gold buys ${nf(0).format(ratioNow)} ounces of silver. Usually (since ${since}) it buys about ${nf(0).format(med)}, so ${verdict}.`);
    return items;
  }

  // One meter row: where today's price sits among the monthly averages in a window
  function rangeRow(label, pts, price) {
    const lo = Math.min(price, ...pts.map((q) => q.v)), hi = Math.max(price, ...pts.map((q) => q.v));
    const below = shareBelow(pts, price); // rank, not linear price, so the dot agrees with the label
    const sh = Math.round(below * 100);
    const row = el('div', { class: 'range-row' });
    row.append(el('span', { class: 'lbl' }, label),
      el('span', { class: 'pct' }, below === 0 ? 'Lowest in window' : below === 1 ? 'Highest in window' : `Higher than ${sh}%`));
    const m = el('div', { class: 'meter', role: 'img',
      'aria-label': `${label}: ${fmt(price, 'usd')} is higher than ${sh}% of monthly averages, range ${fmt(lo, 'usd')} to ${fmt(hi, 'usd')}` });
    const dot = el('span', { class: 'dot' });
    dot.style.left = (below * 100).toFixed(1) + '%';
    m.append(dot);
    const ends = el('div', { class: 'meter-ends' });
    ends.append(el('span', {}, fmt(lo, 'usd')), el('span', {}, fmt(hi, 'usd')));
    const box = el('div', { class: 'meter-box' });
    box.append(m, ends);
    row.append(box);
    return row;
  }

  function renderHero() {
    const price = live.silver;
    document.getElementById('silver-price').textContent = fmt(price, 'usd');
    const status = document.getElementById('live-status');
    status.textContent = live.isLive
      ? 'Live · ' + live.at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : 'As of ' + shortDate(live.at) + ' (live price unavailable)';
    status.classList.toggle('on', live.isLive);
    renderStash();

    const nominal = monthly('silver');
    const since = nominal[0].label.split(' ')[1];
    document.getElementById('verdict').replaceChildren(...heroVerdict(price, nominal, since).map((t) => el('li', {}, t)));
    const lastM = nominal[nominal.length - 1].m;
    const windows = [['1 year', 12], ['5 years', 60], ['10 years', 120], ['Since ' + since, Infinity]];
    document.getElementById('silver-ranges').replaceChildren(
      ...windows.map(([label, months]) => rangeRow(label, nominal.filter((q) => q.m > lastM - months), price)));
  }

  function renderStash() {
    document.getElementById('stash-value').textContent = live ? fmt(live.silver * state.oz, 'usd') : '-';
  }

  // ---- filters ----
  function syncFilters() {
    for (const b of document.querySelectorAll('#range button')) {
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(b.dataset.v === state.range));
    }
    document.getElementById('real').checked = state.real;
    document.getElementById('filter-note').textContent = state.real
      ? `Past prices shown in ${mlabel(cpiLast.m)} dollars, adjusted with US consumer prices.`
      : 'Prices as they were at the time, not adjusted for inflation.';
  }

  const cards = [];
  function renderAll() {
    syncFilters();
    for (const c of cards) c._render();
  }

  // ---- data loading (window.TP.getJSON: timeout, size cap, shape checks) ----
  async function refreshLive() {
    const get = (sym) => window.TP.getJSON(LIVE_URL + sym, { timeout: 8000 });
    const [s, g] = await Promise.all([get('XAG'), get('XAU')]);
    if (!(s && g && s.price > 0 && g.price > 0)) return false;
    live = { silver: s.price, gold: g.price, at: new Date(s.updatedAt || Date.now()), isLive: true };
    return true;
  }

  function showError(msg) {
    const e = document.getElementById('error');
    e.textContent = msg;
    e.hidden = false;
  }

  function renderSources() {
    const box = document.getElementById('sources');
    box.replaceChildren();
    const list = Object.values(D.sources);
    list.forEach((s) => {
      const a = el('a', { href: s.url, rel: 'noopener' }, s.name);
      box.append(a);
      if (s.updated) box.append(document.createTextNode(` (updated ${s.updated})`));
      box.append(document.createTextNode('; '));
    });
    const g = el('a', { href: 'https://gold-api.com', rel: 'noopener' }, 'gold-api.com');
    box.append(g, document.createTextNode(' for live spot prices.'));
  }

  async function init() {
    let spot;
    [D, spot] = await Promise.all([window.TP.getJSON('data/series.json'), window.TP.getJSON('data/spot.json')]);
    if (!D) {
      showError('Could not load the data files. Try reloading the page.');
      return;
    }
    setupCPI();
    if (spot && spot.silver) live = { silver: spot.silver.price, gold: spot.gold.price, at: new Date(spot.silver.at || spot.fetched), isLive: false };

    for (const key of ['metals', 'food', 'drivers', 'currency']) {
      const box = document.getElementById(key);
      // A series missing from series.json (say, a new one before its first refresh) gets no card.
      // The ratio has no series of its own: it's worked out from gold and silver, which seriesOK requires.
      const has = (def) => def.id === 'ratio' || D.series[def.id];
      for (const def of CARDS[key].filter(has)) { const c = buildCard(def); box.append(c); cards.push(c); }
    }
    const parts = document.getElementById('fao-parts');
    for (const id of CARDS.parts) if (D.series[id]) { const t = buildTile(id); parts.append(t); cards.push(t); }
    renderSources();

    document.getElementById('range').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      state.range = b.dataset.v; store.set('range', state.range); renderAll();
    });
    document.getElementById('real').addEventListener('change', (e) => {
      state.real = e.target.checked; store.set('real', state.real ? '1' : '0'); renderAll();
    });
    document.getElementById('oz').value = String(state.oz);
    document.getElementById('oz').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      state.oz = v >= 0 ? v : 0; store.set('oz', state.oz); renderStash();
    });

    if (live) { renderHero(); }
    renderAll();
    // Only the hero and the cards that plot the live price change when it updates.
    const renderLive = () => { renderHero(); for (const c of cards) if (c._live) c._render(); };
    if (await refreshLive()) renderLive();
    else if (!live) showError('Live silver price is unavailable right now.');
    else renderHero();
    setInterval(async () => {
      if (document.visibilityState === 'visible' && await refreshLive()) renderLive();
    }, 5 * 60 * 1000);
  }

  init();
})();
