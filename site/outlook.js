'use strict';
// "Heads up": turns the latest data into a short list of signals worth watching.
// Rules are deliberately simple and explained in the text; they flag conditions that came before
// price rises in the past, not predictions.
(() => {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const SEASON = { DJF: 'Dec-Feb', JFM: 'Jan-Mar', FMA: 'Feb-Apr', MAM: 'Mar-May', AMJ: 'Apr-Jun', MJJ: 'May-Jul',
    JJA: 'Jun-Aug', JAS: 'Jul-Sep', ASO: 'Aug-Oct', SON: 'Sep-Nov', OND: 'Oct-Dec', NDJ: 'Nov-Jan' };
  const LEVELS = {
    alert: { label: 'Alert', icon: '▲', rank: 0 },
    watch: { label: 'Watch', icon: '●', rank: 1 },
    point: { label: 'Weak spot', icon: '◆', rank: 2 },
    easing: { label: 'Easing', icon: '▼', rank: 3 },
  };
  const THE = new Set(['United States', 'United Kingdom', 'UAE', 'Netherlands', 'Philippines']);

  const $ = (id) => document.getElementById(id);
  function el(tag, attrs = {}, text) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else e.setAttribute(k, v); }
    if (text != null) e.textContent = text;
    return e;
  }
  const mi = (s) => { const [y, m] = s.split('-').map(Number); return y * 12 + m - 1; };
  const mlabel = (m) => MONTHS[((m % 12) + 12) % 12] + ' ' + Math.floor(m / 12);
  const signed = (x) => (x >= 0 ? '+' : '−') + Math.abs(Math.round(x)) + '%';
  const usd = (v) => '$' + new Intl.NumberFormat('en-US', { maximumFractionDigits: v < 100 ? 2 : 0 }).format(v);
  function money(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(v >= 1e10 ? 0 : 1) + 'B';
    return '$' + Math.round(v / 1e6) + 'M';
  }

  async function getJSON(url) {
    try { const r = await fetch(url, { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch { return null; }
  }

  function pts(D, id) {
    const s = D.series[id];
    if (!s) return [];
    const m0 = mi(s.start);
    return s.values.map((v, i) => ({ m: m0 + i, v })).filter((p) => p.v != null);
  }
  function stats(p) {
    const last = p[p.length - 1];
    const at = (m) => (p.find((q) => q.m === m) || {}).v;
    const prev10 = p.filter((q) => q.m >= last.m - 120 && q.m < last.m);
    const recent = p.filter((q) => q.m >= last.m - 6);
    const peak6 = recent.reduce((a, q) => (q.v > a.v ? q : a), recent[0]);
    const yo = at(last.m - 12), m3 = at(last.m - 3);
    return {
      last, pts: p,
      yoy: yo ? (last.v / yo - 1) * 100 : 0,
      ch3: m3 ? (last.v / m3 - 1) * 100 : 0,
      rank10: prev10.length ? prev10.filter((q) => q.v < last.v).length / prev10.length : 0,
      record: p.slice(0, -1).every((q) => q.v < last.v),
      peak6,
    };
  }

  // ---- the rules ----
  function signals(D, E, T) {
    const out = [], calm = [];
    const add = (s) => (s.level ? out.push(s) : calm.push(s.short));

    // Oil
    const oil = stats(pts(D, 'brent'));
    {
      const up = oil.yoy >= 40 || (oil.rank10 >= 0.9 && oil.yoy >= 15) ? 'alert' : oil.yoy >= 15 ? 'watch' : null;
      const level = up || (oil.yoy <= -20 ? 'easing' : null);
      add({
        level, short: 'oil', tag: 'Energy', series: oil, card: 'brent',
        title: level === 'easing'
          ? `Oil down ${Math.round(-oil.yoy)}% in a year, to ${usd(oil.last.v)} a barrel`
          : `Oil at ${usd(oil.last.v)} a barrel, up ${Math.round(oil.yoy)}% in a year${oil.rank10 >= 0.99 ? ', the highest in 10 years' : ''}`,
        body: level === 'easing'
          ? 'Cheaper energy makes shipping, fertilizer and food cheaper over the next few months.'
          : 'Energy is a hidden ingredient in food. Tractors and trucks run on diesel, ships burn fuel, and fertilizer is made from natural gas. Big changes in oil usually show up at the gas pump and the grocery store within a few months.',
        watch: level === 'easing' ? 'Whether the drop lasts. Gas prices should follow it down.'
          : `Whether oil stays ${oil.last.v >= 100 ? 'above $100' : 'this high'} through the winter. If it does, shipping and food will likely keep getting pricier into next year.`,
      });
    }

    // El Nino / La Nina
    let elNinoStrong = false;
    if (E && E.oni && E.oni.length) {
      const [season, year, anom] = E.oni[E.oni.length - 1];
      const a = Math.abs(anom);
      const strength = a >= 2 ? 'very strong' : a >= 1.5 ? 'strong' : a >= 1 ? 'moderate' : 'weak';
      const nino = anom >= 0.5, nina = anom <= -0.5;
      elNinoStrong = anom >= 1.5;
      const level = a >= 1.5 ? 'alert' : a >= 0.5 ? 'watch' : null;
      const phase = nino ? 'El Niño' : 'La Niña';
      add({
        level: nino || nina ? level : null, short: 'El Niño / La Niña', tag: 'Weather',
        title: `A ${strength} ${phase} is under way`,
        body: `${phase} means the Pacific Ocean near the equator is ${nino ? 'warmer' : 'cooler'} than normal, which shifts where rain falls around the world. Right now it's ${a.toFixed(1)}°C ${nino ? 'warmer' : 'cooler'} (${SEASON[season] || season} ${year}).`
          + ` (Source: NOAA, the US weather agency${E.issued ? ', ' + E.issued : ''}.)`,
        watch: nino
          ? 'El Niño usually brings dry weather to Australia (wheat), India and Thailand (rice and sugar), Indonesia and Malaysia (palm oil) and southern Africa (maize). Damaged harvests show up in prices 6 to 12 months later.'
          : 'La Niña usually brings dry weather to Argentina, the southern US (soybeans, maize, wheat) and East Africa. Watch soybean and maize prices over the next 6 to 12 months.',
        link: E.url,
      });
    }

    // World food prices + grains
    const food = stats(pts(D, 'fao_food'));
    const grains = ['wheat', 'rice', 'soybeans', 'maize'].map((id) => ({ id, s: stats(pts(D, id)) }))
      .sort((a, b) => b.s.yoy - a.s.yoy);
    const maxGrain = grains[0].s.yoy;
    {
      const level = food.yoy >= 15 || food.rank10 >= 0.95 || maxGrain >= 40 ? 'alert'
        : food.yoy >= 5 || food.ch3 >= 3 || maxGrain >= 20 ? 'watch'
          : food.yoy <= -5 ? 'easing' : null;
      const movers = grains.filter((g) => Math.abs(g.s.yoy) >= 10).map((g) => `${g.id} ${signed(g.s.yoy)}`);
      add({
        level, short: 'world food prices', tag: 'Food', series: food, card: 'fao_food',
        title: `World food prices ${food.yoy >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(food.yoy))}% in a year`,
        body: (movers.length ? `Grains moved the most this year: ${movers.join(', ')}. ` : '')
          + 'People eat grains, and so do farm animals, so grain prices spread to bread, meat, milk and more.',
        watch: 'Whether the FAO Food Price Index keeps rising when the next numbers come out early next month.',
      });
    }

    // Cooking oils
    const oils = stats(pts(D, 'fao_oils'));
    {
      const high = oils.rank10 >= 0.9;
      const level = high ? (elNinoStrong ? 'alert' : 'watch') : oils.yoy >= 20 ? 'watch' : null;
      add({
        level, short: 'cooking oils', tag: 'Food', series: oils, card: 'fao_food',
        title: `Cooking oils ${high ? 'near a 10-year high' : 'rising'}, up ${Math.round(oils.yoy)}% in a year`,
        body: 'Palm, soy, sunflower and canola oil are in cooking oil and most packaged food.'
          + (elNinoStrong ? ' Most palm oil comes from Indonesia and Malaysia. El Niño droughts there usually shrink the harvest about a year later.' : ''),
        watch: 'Prices of cooking oil, chips, snacks and baked goods.',
      });
    }

    // Fertilizer
    const urea = stats(pts(D, 'urea'));
    {
      const drop = (1 - urea.last.v / urea.peak6.v) * 100;
      const level = urea.yoy >= 50 ? 'alert' : urea.yoy >= 20 ? 'watch' : drop >= 30 || urea.yoy <= -20 ? 'easing' : null;
      add({
        level, short: 'fertilizer', tag: 'Farming', series: urea, card: 'urea',
        title: level === 'easing'
          ? (drop >= 30 ? `Urea fertilizer is getting cheaper: down ${Math.round(drop)}% since ${mlabel(urea.peak6.m)}` : `Urea fertilizer down ${Math.round(-urea.yoy)}% in a year`)
          : `Urea fertilizer up ${Math.round(urea.yoy)}% in a year`,
        body: level === 'easing'
          ? (drop >= 30 ? `Urea fertilizer jumped to ${usd(urea.peak6.v)} a ton in ${mlabel(urea.peak6.m)}. Now it's ${usd(urea.last.v)}. ` : '')
            + 'Cheaper fertilizer makes next season\'s crops cheaper to grow. That pushes against expensive oil.'
          : 'Farmers buy fertilizer months before harvest, so today\'s price shows up in food prices 6 to 12 months from now.',
        watch: level === 'easing' ? 'Whether it stays low until farmers plant in the spring.' : 'Fertilizer and natural gas prices.',
      });
    }

    // The US dollar: commodities are priced in it, so it tends to move against them
    const usdP = pts(D, 'usd');
    if (usdP.length > 24) {
      const dollar = stats(usdP);
      const up = dollar.yoy >= 8, down = dollar.yoy <= -8;
      add({
        level: up || down ? 'watch' : null, short: 'the dollar', tag: 'Money', series: dollar, card: 'usd',
        title: `The US dollar is ${up ? 'up' : 'down'} ${Math.abs(Math.round(dollar.yoy))}% in a year`,
        body: up
          ? 'Oil and grain are priced in dollars. A stronger dollar makes them cost more for everyone else, which usually pushes their dollar prices down. It\'s a push, not a rule: in 2022 a war pushed oil and food up anyway. Gold often holds up too, because people buy it when they\'re worried.'
          : 'A weaker dollar makes dollar-priced food, fuel and metals cheaper for the rest of the world, which pushes their dollar prices up. Since 2006, oil rose every time the dollar fell this much, and food almost every time.',
        watch: up
          ? 'Food import bills in countries with weak currencies, like Egypt, Nigeria and Pakistan. A falling local currency is often how world prices turn into local food crises.'
          : 'Whether gold, oil and grain keep climbing.',
      });
    }

    // Copper
    const copper = stats(pts(D, 'copper'));
    if (copper.rank10 >= 0.97 && copper.yoy >= 20) {
      add({
        level: 'watch', short: 'copper', tag: 'Metals', series: copper, card: 'copper',
        title: `Copper ${copper.record ? 'at a record high' : 'near a 10-year high'}, up ${Math.round(copper.yoy)}% in a year`,
        body: 'Copper goes into wires, motors, power lines and electronics. A price this high means factories want more copper than mines are digging up.',
        watch: 'Prices of anything electrical, from appliances to cars.',
      });
    } else calm.push('copper');

    // Pressure points from trade data: where one seller dominates
    if (T && T.commodities) {
      for (const id of ['wheat', 'rice']) {
        const c = T.commodities.find((x) => x.id === id);
        if (!c || !c.exporters.length) continue;
        const [p, v] = c.exporters[0];
        const share = v / c.covered;
        if (share < 0.15) continue;
        const nm = T.names[String(p)] || '?';
        const rows = c.importers.map((b) => {
          const got = (b.from.find(([q]) => q === p) || [0, 0])[1];
          return { c: b.c, share: b.total ? got / b.total : 0, value: got };
        });
        const over = rows.filter((r) => r.share > 0.5).length;
        const big = rows.reduce((a, r) => (r.value > a.value ? r : a), rows[0]);
        const black = nm === 'Russia' || nm === 'Ukraine';
        add({
          level: 'point', short: id, tag: 'Trade', card: null, anchor: 'trade',
          title: `${nm} sells ${Math.round(share * 100)}% of all the ${id} sold between countries`,
          body: `${over} of the ${c.importers.length} biggest ${id} buyers get more than half their ${id} from ${THE.has(nm) ? 'the ' + nm : nm}. `
            + `${T.names[String(big.c)]} has the most to lose: it buys ${money(big.value)} a year from ${THE.has(nm) ? 'the ' + nm : nm}, ${Math.round(big.share * 100)}% of its ${id}.`,
          watch: black ? 'News of ships blocked in the Black Sea, or Russia limiting what it sells abroad.' : `News of ${nm} limiting what it sells abroad, or a bad harvest there.`,
        });
      }
    }

    out.sort((a, b) => LEVELS[a.level].rank - LEVELS[b.level].rank);
    return { out, calm };
  }

  // ---- rendering ----
  function spark(s) {
    const p = s.pts.slice(-25);
    const W = 120, H = 36, vs = p.map((q) => q.v), lo = Math.min(...vs), hi = Math.max(...vs);
    const sx = (i) => 3 + i / (p.length - 1) * (W - 6), sy = (v) => 3 + (1 - (v - lo) / (hi - lo || 1)) * (H - 6);
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'sig-spark');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', p.map((q, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(q.v).toFixed(1)}`).join(''));
    Object.assign(path.style, { fill: 'none', stroke: 'var(--series)', strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' });
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', sx(p.length - 1)); dot.setAttribute('cy', sy(p[p.length - 1].v)); dot.setAttribute('r', 3.5);
    Object.assign(dot.style, { fill: 'var(--series)', stroke: 'var(--surface)', strokeWidth: 2 });
    svg.append(path, dot);
    return svg;
  }

  // Phones get folded cards (headline only, tap for the rest); wider screens start open.
  const WIDE = window.matchMedia('(min-width: 760px)').matches;

  function card(s) {
    const lv = LEVELS[s.level];
    const a = el('article', { class: 'card signal' });
    const fold = el('details', { class: 'fold' });
    fold.open = WIDE;
    const sum = el('summary');
    const top = el('div', { class: 'sig-top' });
    const chip = el('span', { class: 'chip ' + s.level });
    chip.append(el('span', { class: 'ic', 'aria-hidden': 'true' }, lv.icon), lv.label);
    const right = el('span', { class: 'sig-right' });
    right.append(el('span', { class: 'sig-tag' }, s.tag), el('span', { class: 'chev', 'aria-hidden': 'true' }));
    top.append(chip, right);
    const head = el('div', { class: 'sig-head' });
    head.append(el('h3', {}, s.title));
    if (s.series) head.append(spark(s.series));
    sum.append(top, head);
    const body = el('div', { class: 'fold-body' });
    body.append(el('p', { class: 'sig-body' }, s.body));
    const w = el('p', { class: 'sig-watch' });
    w.append(el('strong', {}, 'Watch for: '), s.watch);
    body.append(w);
    const target = s.card ? 'card-' + s.card : s.anchor;
    if (target) body.append(el('a', { class: 'sig-link', href: '#' + target }, 'See the data ↓'));
    else if (s.link) body.append(el('a', { class: 'sig-link', href: s.link, rel: 'noopener' }, 'NOAA\'s full update ↗'));
    fold.append(sum, body);
    a.append(fold);
    return a;
  }

  function forYou(list) {
    const on = (short) => list.some((s) => s.short === short && (s.level === 'alert' || s.level === 'watch'));
    const items = [];
    if (on('oil')) items.push(['Fuel', 'gas and delivery costs will likely stay high for a while. Plan for a little extra this winter.']);
    if (on('world food prices') || on('cooking oils') || on('El Niño / La Niña')) {
      items.push(['Groceries', 'rice, bread, cooking oil, sugar and meat are the most likely to cost more. A few extra weeks of shelf-stable food you already eat is cheap insurance. There\'s no need to stockpile more than that.']);
    }
    items.push(['Long-term money', 'it\'s hard to make money off news like this. It\'s a good reason to keep emergency savings, not to change long-term plans.']);
    return items;
  }

  // ---- trend and value ----
  // Trend = change over 12 months; value = today vs the average of the previous 5 years.
  // Both are documented long-run tendencies in commodity markets, weak and noisy for any one item.
  const RADAR = [
    ['silver', 'Silver', 'silver'], ['gold', 'Gold', 'gold'], ['copper', 'Copper', null],
    ['brent', 'Oil (Brent)', null], ['wheat', 'Wheat', null], ['maize', 'Maize', null], ['rice', 'Rice', null],
    ['soybeans', 'Soybeans', null], ['urea', 'Fertilizer (urea)', null],
  ];
  const READS = {
    early: { label: 'Early rise', rank: 0, text: 'going up, but still near its usual price' },
    turning: { label: 'Cheap, turning up', rank: 1, text: 'well below its usual price and starting to climb' },
    late: { label: 'Late rise', rank: 2, text: 'going up, and already well above its usual price' },
    cooling: { label: 'Cooling off', rank: 3, text: 'falling back, but still above its usual price' },
    cheap: { label: 'Cheap, still falling', rank: 4, text: 'well below its usual price and still dropping' },
    none: { label: 'No clear signal', rank: 5, text: null },
  };
  function radar(D, spot) {
    return RADAR.map(([id, label, live]) => {
      const p = pts(D, id);
      if (p.length < 70) return null;
      let last = p[p.length - 1];
      const liveV = live && spot && spot[live] && spot[live].price;
      if (liveV) {
        const d = new Date(spot.fetched || Date.now());
        last = { m: d.getFullYear() * 12 + d.getMonth(), v: liveV };
      }
      const hist = p.filter((q) => q.m < last.m);
      const at = (m) => (hist.find((q) => q.m === m) || {}).v;
      const prev5 = hist.slice(-60);
      const avg5 = prev5.reduce((a, q) => a + q.v, 0) / prev5.length;
      const yo = at(last.m - 12), m3 = at(last.m - 3);
      const peak2 = Math.max(...hist.slice(-24).map((q) => q.v), last.v);
      const r = {
        id, label,
        trend: yo ? (last.v / yo - 1) * 100 : 0,
        ch3: m3 ? (last.v / m3 - 1) * 100 : 0,
        value: (last.v / avg5 - 1) * 100,
        fromPeak: (last.v / peak2 - 1) * 100,
      };
      const rising = r.trend >= 10, falling = r.trend <= -10 || r.fromPeak <= -25;
      r.read = rising && r.value <= 15 ? 'early'
        : rising ? 'late'
          : r.value <= -15 && r.ch3 >= 3 ? 'turning'
            : r.value <= -15 && falling ? 'cheap'
              : falling && r.value > 15 ? 'cooling'
                : 'none';
      return r;
    }).filter(Boolean).sort((a, b) => READS[a.read].rank - READS[b.read].rank || b.trend - a.trend);
  }
  function renderRadar(rows) {
    $('radar').replaceChildren(...rows.map((r) => {
      const rd = READS[r.read];
      const row = el('div', { class: 'rrow' });
      const head = el('div', { class: 'rhead' });
      head.append(el('span', { class: 'nm' }, r.label), el('span', { class: 'rchip r-' + r.read }, rd.label));
      const nums = el('div', { class: 'rnums' });
      nums.append(el('span', {}, `Past year: ${signed(r.trend)}`), el('span', {}, `vs usual price: ${signed(r.value)}`));
      if (r.fromPeak <= -20) nums.append(el('span', {}, `from 2-year high: ${signed(r.fromPeak)}`));
      const pos = Math.abs(r.value) <= 15 ? 'near its usual price'
        : `${Math.round(Math.abs(r.value))}% ${r.value > 0 ? 'above' : 'below'} its usual price`;
      const text = rd.text || `Not moving much either way, and ${pos}`;
      row.append(head, nums, el('p', { class: 'rtext' }, text.charAt(0).toUpperCase() + text.slice(1) + '.'));
      return row;
    }));
    const early = rows.filter((r) => r.read === 'early').map((r) => r.label.toLowerCase());
    $('radar-summary').textContent = early.length
      ? `Going up but still near their usual price: ${early.join(', ')}. That's the "early rise" pattern. The rest are late in a rise, cooling off, or quiet.`
      : 'Nothing is in the "going up but still near its usual price" spot right now.';
  }

  async function init() {
    const [D, E, T, SP] = await Promise.all([getJSON('data/series.json'), getJSON('data/enso.json'), getJSON('data/trade.json'), getJSON('data/spot.json')]);
    if (!D) return;
    const { out, calm } = signals(D, E, T);
    const n = (lv) => out.filter((s) => s.level === lv).length;
    const lastM = Math.max(...['brent', 'fao_food', 'urea'].map((id) => { const p = pts(D, id); return p[p.length - 1].m; }));
    const parts = [];
    if (n('alert')) parts.push(`${n('alert')} alert${n('alert') > 1 ? 's' : ''}`);
    if (n('watch')) parts.push(`${n('watch')} to watch`);
    if (n('easing')) parts.push(`${n('easing')} easing`);
    $('outlook-summary').textContent = parts.length
      ? `${parts.join(', ')}, based on prices through ${mlabel(lastM)}${E && E.issued ? ' and NOAA\'s ' + E.issued + ' update' : ''}.`
      : `Nothing unusual right now, based on prices through ${mlabel(lastM)}.`;
    $('signals').replaceChildren(...out.map(card));
    $('calm').textContent = calm.length ? `Calm right now: ${calm.join(', ')}.` : '';
    $('for-you').replaceChildren(...forYou(out).map(([k, v]) => { const li = el('li'); li.append(el('strong', {}, k + ': '), v); return li; }));
    $('outlook').hidden = false;
    renderRadar(radar(D, SP));
    $('trendvalue').hidden = false;
  }

  init();
})();
