'use strict';
// "Claude's track record": grades what Claude said against what the data later showed.
// data/claude-log.json holds dated, append-only entries (scripts/check_weekly.py refuses edits to
// old ones):
//   calls:        { s, target: "YYYY-MM", call: up|down, made, why }  -> right if the target month
//                 moved that way from the month before
//   likelihoods:  { id, made, likelihood, claim, check, deadline }   -> "happened" if the check
//                 passed in any month from the month it was made through the deadline
(() => {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const LABEL = { likely: 'Likely', possible: 'Possible', longshot: 'Long shot' };
  const HOPE = { likely: 'Most of these should happen.', possible: 'Some should happen, but not most.', longshot: 'Few should happen.' };
  const NAME = { fao_food: 'FAO Food Price Index', brent: 'Brent oil' };
  const SEASON = ['DJF', 'JFM', 'FMA', 'MAM', 'AMJ', 'MJJ', 'JJA', 'JAS', 'ASO', 'SON', 'OND', 'NDJ'];
  const $ = (id) => document.getElementById(id);
  const { el } = window.TP;
  const ym = (s) => { const [y, m] = String(s).split('-').map(Number); return y * 12 + m - 1; };
  const mlabel = (m) => MONTHS[((m % 12) + 12) % 12] + ' ' + Math.floor(m / 12);
  const getJSON = window.TP.getJSON;

  // ---- the data as it stood at the end of month M ----
  function seriesPts(D, id) {
    const s = D.series[id];
    if (!s) return [];
    const m0 = ym(s.start);
    return s.values.map((v, i) => ({ m: m0 + i, v })).filter((q) => q.v != null);
  }
  function oniPts(E) {
    return ((E && E.oni) || []).map(([season, year, v]) => ({ m: year * 12 + Math.max(0, SEASON.indexOf(season)), v }));
  }
  function metricAt(D, E, s, metric, M) {
    const all = s === 'oni' ? oniPts(E) : seriesPts(D, s);
    const p = all.filter((q) => q.m <= M);
    if (!p.length || p[p.length - 1].m !== M) return null; // no number for that month yet
    const last = p[p.length - 1];
    if (s === 'oni') {
      if (metric === 'last') return last.v;
      if (metric === 'fromPeak') return last.v - Math.max(...p.slice(-6).map((q) => q.v));
      return null;
    }
    const at = (k) => (p.find((q) => q.m === M - k) || {}).v;
    const pct = (b) => (b ? (last.v / b - 1) * 100 : null);
    if (metric === 'last') return last.v;
    if (metric === 'yoy') return pct(at(12));
    if (metric === 'ch3') return pct(at(3));
    if (metric === 'ch6') return pct(at(6));
    if (metric === 'fromPeak') return pct(Math.max(...p.filter((q) => q.m >= M - 6).map((q) => q.v)));
    return null;
  }
  function passes(D, E, c, M) {
    if (c.any) return c.any.some((x) => passes(D, E, x, M));
    const v = metricAt(D, E, c.s, c.m, M);
    return v != null && (c.op === '>=' ? v >= c.v : v <= c.v);
  }
  function lastMonth(D, E, c) {
    if (c.any) return Math.max(...c.any.map((x) => lastMonth(D, E, x)));
    const p = c.s === 'oni' ? oniPts(E) : seriesPts(D, c.s);
    return p.length ? p[p.length - 1].m : -1;
  }

  // ---- grading ----
  function gradeLikelihood(D, E, x) {
    const from = ym(x.made), to = ym(x.deadline), upto = Math.min(to, lastMonth(D, E, x.check));
    for (let M = from; M <= upto; M++) if (passes(D, E, x.check, M)) return { state: 'happened', when: M };
    return upto >= to ? { state: 'didnt' } : { state: 'waiting' };
  }
  function gradeCall(D, x) {
    const p = seriesPts(D, x.s), T = ym(x.target);
    const a = p.find((q) => q.m === T - 1), b = p.find((q) => q.m === T);
    if (!a || !b) return { state: 'waiting' };
    const up = b.v > a.v;
    return { state: (x.call === 'up') === up ? 'right' : 'wrong', moved: up ? 'rose' : 'fell' };
  }

  // "Said Likely: X of Y happened" per label, then the monthly calls line
  function summaryRows(calls, likes, graded, right) {
    const rows = el('div', { class: 'sb-rows' });
    for (const lv of ['likely', 'possible', 'longshot']) {
      const xs = likes.filter((x) => x.likelihood === lv);
      if (!xs.length) continue;
      const decided = xs.filter((x) => x.g.state !== 'waiting');
      const hit = decided.filter((x) => x.g.state === 'happened').length;
      const row = el('p', { class: 'sb-row' });
      row.append(el('strong', {}, `Said "${LABEL[lv]}": `),
        decided.length ? `${hit} of ${decided.length} happened` : 'none decided yet',
        `, ${xs.length - decided.length} still open. ${HOPE[lv]}`);
      rows.append(row);
    }
    const first = calls.length ? 'result comes in early ' + mlabel(Math.min(...calls.map((x) => ym(x.target))) + 1) : 'call comes with the next weekly read';
    const cr = el('p', { class: 'sb-row' });
    cr.append(el('strong', {}, 'Monthly higher/lower calls: '), graded.length
      ? `${right} of ${graded.length} right. A coin flip would get about half.`
      : `none graded yet. The first ${first}.`);
    rows.append(cr);
    return rows;
  }

  function likeLine(x) {
    const st = x.g.state === 'happened' ? `✓ happened (${mlabel(x.g.when)})` : x.g.state === 'didnt' ? '✗ didn\'t happen by the deadline' : 'Still open';
    return `${x.made}: "${LABEL[x.likelihood] || x.likelihood}" that ${x.claim.charAt(0).toLowerCase() + x.claim.slice(1)}, by ${mlabel(ym(x.deadline))}. ${st}.`;
  }
  function callLine(x) {
    const st = x.g.state === 'waiting' ? 'Still open' : `${x.g.state === 'right' ? '✓ right' : '✗ wrong'} (it ${x.g.moved})`;
    return `${x.made}: ${NAME[x.s] || x.s} in ${mlabel(ym(x.target))} will be ${x.call === 'up' ? 'higher' : 'lower'} than the month before. ${x.why ? 'Why: ' + x.why + ' ' : ''}${st}.`;
  }

  function render(L, D, E) {
    const calls = (L.calls || []).map((x) => ({ ...x, g: gradeCall(D, x) }));
    const likes = (L.likelihoods || []).map((x) => ({ ...x, g: gradeLikelihood(D, E, x) }));
    const box = $('scoreboard');
    box.replaceChildren(el('h3', { class: 'card-title' }, 'Claude\'s track record'));
    box.append(el('p', { class: 'mini-note' }, 'Every call and "Likely / Possible" rating is logged with a date and graded by the data later. Old entries can\'t be edited, so misses stay visible.'));
    const graded = calls.filter((x) => x.g.state !== 'waiting');
    const right = graded.filter((x) => x.g.state === 'right').length;
    box.append(summaryRows(calls, likes, graded, right));

    // every entry
    const all = el('details', { class: 'tbl' });
    all.append(el('summary', {}, `See all ${calls.length + likes.length} entries`));
    const ul = el('ul', { class: 'sb-list' });
    ul.append(...likes.map((x) => el('li', {}, likeLine(x))), ...calls.map((x) => el('li', {}, callLine(x))));
    all.append(ul);
    box.append(all);
    box.hidden = false;

    // a one-line version next to the reader's own calls
    const mini = $('claude-record');
    if (mini) mini.textContent = graded.length ? `Claude's monthly calls so far: ${right} of ${graded.length} right.` : '';
  }

  async function init() {
    const [L, D, E] = await Promise.all([getJSON('data/claude-log.json'), getJSON('data/series.json'), getJSON('data/enso.json')]);
    if (!L || !D || !D.series) return;
    render(L, D, E);
  }
  init();
})();
