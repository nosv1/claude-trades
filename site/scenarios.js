'use strict';
// "What could happen next": chains of events from data/scenarios.json (written by Claude).
// Each step with a `check` lights up when the latest data passes it, as long as no earlier
// checked step is still waiting; steps without a check are news to watch for.
(() => {
  const LIKELY = {
    likely: { label: 'Likely', dots: '●●○', rank: 0 },
    possible: { label: 'Possible', dots: '●○○', rank: 1 },
    longshot: { label: 'Long shot', dots: '○○○', rank: 2 },
  };
  const NAME = {
    brent: 'Brent oil', fao_food: 'FAO Food Price Index', fao_oils: 'Cooking oils', fao_sugar: 'Sugar',
    fao_cereals: 'Cereals', rice: 'Rice', wheat: 'Wheat', maize: 'Maize', soybeans: 'Soybeans',
    urea: 'Urea', copper: 'Copper', gold: 'Gold', silver: 'Silver', usd: 'US dollar',
  };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const $ = (id) => document.getElementById(id);
  function el(tag, attrs = {}, text) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else e.setAttribute(k, v); }
    if (text != null) e.textContent = text;
    return e;
  }
  const signed = (x) => (x >= 0 ? '+' : '−') + Math.abs(Math.round(x)) + '%';
  const getJSON = window.TP.getJSON;

  // ---- metrics ----
  function series(D, id) {
    const s = D.series[id];
    if (!s) return null;
    const [y, m] = s.start.split('-').map(Number);
    const p = s.values.map((v, i) => ({ m: y * 12 + m - 1 + i, v })).filter((q) => q.v != null);
    return p.length ? p : null;
  }
  function metric(D, E, s, m) {
    if (s === 'oni') {
      const o = E && E.oni;
      if (!o || !o.length) return null;
      const last = o[o.length - 1][2];
      if (m === 'last') return last;
      if (m === 'fromPeak') return last - Math.max(...o.slice(-6).map((r) => r[2]));
      return null;
    }
    const p = series(D, s);
    if (!p) return null;
    const last = p[p.length - 1];
    const at = (k) => (p.find((q) => q.m === last.m - k) || {}).v;
    const pct = (b) => (b ? (last.v / b - 1) * 100 : null);
    if (m === 'last') return last.v;
    if (m === 'yoy') return pct(at(12));
    if (m === 'ch3') return pct(at(3));
    if (m === 'ch6') return pct(at(6));
    if (m === 'fromPeak') return pct(Math.max(...p.filter((q) => q.m >= last.m - 6).map((q) => q.v)));
    return null;
  }
  const OPS = { '>=': (a, b) => a >= b, '<=': (a, b) => a <= b };
  function test(D, E, c) {
    if (c.any) {
      const rs = c.any.map((x) => test(D, E, x));
      return rs.find((r) => r.pass) || rs.find((r) => r.value != null) || rs[0];
    }
    const value = metric(D, E, c.s, c.m);
    return { c, value, pass: value != null && OPS[c.op] ? OPS[c.op](value, c.v) : false };
  }
  function describe(r) {
    const { c, value: x } = r;
    if (x == null) return 'no data yet';
    if (c.s === 'oni') {
      if (c.m === 'last') return `Pacific ${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}°C vs normal`;
      return x > -0.05 ? 'Pacific still at its peak warmth' : `Pacific ${Math.abs(x).toFixed(1)}°C off its peak`;
    }
    const n = NAME[c.s] || c.s;
    if (c.m === 'yoy') return `${n} ${signed(x)} in a year`;
    if (c.m === 'ch3') return `${n} ${signed(x)} in 3 months`;
    if (c.m === 'ch6') return `${n} ${signed(x)} in 6 months`;
    if (c.m === 'fromPeak') return x > -0.5 ? `${n} at its 6-month high` : `${n} ${signed(x)} from its 6-month high`;
    return `${n} ${x}`;
  }

  // ---- evaluation ----
  function evaluate(sc, D, E) {
    let blocked = false;
    const steps = sc.steps.map((st) => {
      if (!st.check) return { ...st, state: 'news' };
      const r = test(D, E, st.check);
      const state = r.pass && !blocked ? 'seen' : r.pass ? 'after' : 'open';
      if (state !== 'seen') blocked = true;
      return { ...st, state, now: describe(r) };
    });
    const checked = steps.filter((s) => s.state !== 'news');
    return { ...sc, steps, seen: checked.filter((s) => s.state === 'seen').length, checked: checked.length };
  }

  // ---- rendering ----
  function stepEl(st) {
    const li = el('li', { class: 'step s-' + st.state });
    li.append(el('span', { class: 'node', 'aria-hidden': 'true' }, st.state === 'seen' ? '✓' : ''));
    const body = el('div', { class: 'step-body' });
    body.append(el('span', { class: 'step-text' }, st.text));
    const meta = el('span', { class: 'step-meta' });
    const status = st.state === 'seen' ? 'Happening now'
      : st.state === 'open' ? 'Not yet'
        : st.state === 'after' ? 'Waiting on the step above'
          : 'Watch the news';
    meta.append(el('strong', {}, status));
    if (!(st.state === 'seen' && /^now$/i.test(st.lag))) meta.append(` · ${st.lag}`);
    body.append(meta);
    if (st.now) body.append(el('span', { class: 'step-now' }, 'Now: ' + st.now));
    else if (st.watch) {
      const w = el('span', { class: 'step-now' }, 'Look for ' + st.watch);
      if (st.link) { w.textContent = 'Look for '; w.append(el('a', { href: '#' + st.link }, st.watch)); }
      body.append(w);
    }
    li.append(body);
    return li;
  }

  // Phones get folded cards (the gist only, tap for the full chain); wider screens start open.
  const WIDE = window.matchMedia('(min-width: 760px)').matches;

  function outcome(arrow, label, list) {
    const p = el('p', {});
    p.append(el('span', { class: 'arrow', 'aria-hidden': 'true' }, arrow), el('strong', {}, label), list.join(', '));
    return p;
  }

  function cardEl(sc) {
    const lk = LIKELY[sc.likelihood] || LIKELY.possible;
    const a = el('article', { class: 'card scn' });
    const fold = el('details', { class: 'fold' });
    fold.open = WIDE;
    const sum = el('summary');
    const top = el('div', { class: 'sig-top' });
    const chip = el('span', { class: 'chip lk' });
    chip.append(el('span', { class: 'dots', 'aria-hidden': 'true' }, lk.dots), lk.label);
    const right = el('span', { class: 'sig-right' });
    right.append(el('span', { class: 'sig-tag' }, sc.horizon), el('span', { class: 'chev', 'aria-hidden': 'true' }));
    top.append(chip, right);
    sum.append(top, el('h3', {}, sc.title));

    // progress strip: one mark per step, then where the chain stands
    const strip = el('div', { class: 'strip' });
    const marks = el('span', { class: 'marks', 'aria-hidden': 'true' });
    marks.append(...sc.steps.map((st) => el('span', { class: 'mk m-' + st.state })));
    const next = sc.steps.find((st) => st.state !== 'seen');
    strip.append(marks, el('span', { class: 'strip-txt' }, sc.checked
      ? `${sc.seen} of ${sc.checked} trackable steps have happened` : 'No trackable steps yet'));
    sum.append(strip);
    if (next) {
      const n = el('p', { class: 'scn-next' });
      n.append(el('strong', {}, 'Next: '), next.text);
      sum.append(n);
    }
    const out = el('div', { class: 'scn-out' });
    if (sc.up && sc.up.length) out.append(outcome('▲', 'Could push up: ', sc.up));
    if (sc.down && sc.down.length) out.append(outcome('▼', 'Could push down: ', sc.down));
    sum.append(out);

    const body = el('div', { class: 'fold-body' });
    const ol = el('ol', { class: 'chain' });
    ol.append(...sc.steps.map((st, i) => {
      const li = stepEl(st);
      if (st.state === 'seen' && sc.steps[i + 1] && sc.steps[i + 1].state === 'seen') li.classList.add('joined');
      return li;
    }));
    const why = el('p', { class: 'sig-body' });
    why.append(el('strong', {}, `Why ${lk.label.toLowerCase()}: `), sc.why);
    const hist = el('p', { class: 'sig-body' });
    hist.append(el('strong', {}, 'Last time: '), sc.history);
    body.append(ol, why, hist);
    if (Number.isInteger(sc.cases) && sc.cases > 0) {
      body.append(el('p', { class: 'scn-cases' }, sc.cases < 10
        ? `Based on ${sc.cases} past case${sc.cases > 1 ? 's' : ''}. That's only a few, so treat it as a rough guide.`
        : `Based on ${sc.cases} past cases.`));
    }
    fold.append(sum, body);
    a.append(fold);
    return a;
  }

  const valid = (S) => S && Array.isArray(S.scenarios) && S.scenarios.length
    && S.scenarios.every((s) => s && s.title && Array.isArray(s.steps) && s.steps.length && s.steps.every((t) => t && t.text));

  function dateLabel(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : String(iso);
  }

  async function init() {
    const [S, D, E] = await Promise.all([getJSON('data/scenarios.json'), getJSON('data/series.json'), getJSON('data/enso.json')]);
    if (!valid(S) || !D || !D.series) return;
    const list = S.scenarios.map((s) => evaluate(s, D, E)).sort((a, b) =>
      (LIKELY[a.likelihood] || LIKELY.possible).rank - (LIKELY[b.likelihood] || LIKELY.possible).rank
      || b.seen / (b.checked || 1) - a.seen / (a.checked || 1));
    const far = list.reduce((x, s) => (s.seen / (s.checked || 1) > x.seen / (x.checked || 1) ? s : x), list[0]);
    $('scn-summary').textContent = `${list.length} "if this happens, then that" chains. Each one has happened before, and each starts from where things are today. `
      + `Furthest along: “${far.title}” (${far.seen} of ${far.checked} steps).`;
    $('scenarios').replaceChildren(...list.map(cardEl));
    $('scn-byline').textContent = `Written by ${S.by || 'Claude'}, ${dateLabel(S.updated)}, using the price history on this page. `
      + 'Steps light up by themselves when new numbers show they happened. "Likely" and "Possible" are best guesses, not exact odds.';
    $('whatnext').hidden = false;
  }

  init();
})();
