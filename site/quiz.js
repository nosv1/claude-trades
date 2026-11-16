'use strict';
// "Check yourself": a few questions per visit, spaced so missed ones come back sooner
// (Leitner boxes), plus "make a call" guesses on the next monthly update that get scored when
// the data arrives. Everything is kept in this browser's localStorage only.
(() => {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const PER_VISIT = 4;
  const GAPS = [0, 1, 3, 7, 21, 60]; // days until a question comes back, by box

  const $ = (id) => document.getElementById(id);
  function el(tag, attrs = {}, text) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else e.setAttribute(k, v); }
    if (text != null) e.textContent = text;
    return e;
  }
  const load = (k, d) => { try { const v = localStorage.getItem('tp.' + k); return v ? JSON.parse(v) : d; } catch { return d; } };
  // Saving also tells sync.js (if signed in) to copy the change to the cloud.
  const save = (k, v) => {
    try { localStorage.setItem('tp.' + k, JSON.stringify(v)); } catch { /* private mode */ }
    window.dispatchEvent(new Event('tp:progress'));
  };
  const today = () => { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
  const signed = (x) => (x >= 0 ? '+' : '−') + Math.abs(Math.round(x)) + '%';
  const usd = (v) => '$' + new Intl.NumberFormat('en-US', { maximumFractionDigits: v < 100 ? 2 : 0 }).format(v);
  const mlabel = (m) => MONTHS[((m % 12) + 12) % 12] + ' ' + Math.floor(m / 12);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  async function getJSON(url) {
    try { const r = await fetch(url, { cache: 'no-cache' }); return r.ok ? await r.json() : null; } catch { return null; }
  }

  function series(D, id) {
    const s = D.series[id];
    if (!s) return null;
    const [y, m] = s.start.split('-').map(Number);
    const p = s.values.map((v, i) => ({ m: y * 12 + m - 1 + i, v })).filter((q) => q.v != null);
    if (p.length < 13) return null;
    const last = p[p.length - 1];
    const at = (k) => (p.find((q) => q.m === last.m - k) || {}).v;
    const ch = (k) => (at(k) ? (last.v / at(k) - 1) * 100 : null);
    const prev5 = p.filter((q) => q.m < last.m).slice(-60);
    return { p, last, yoy: ch(12), ch3: ch(3), ch6: ch(6), avg5: prev5.reduce((a, q) => a + q.v, 0) / prev5.length };
  }
  // Pick the bucket a value falls in: edges are upper bounds, the last label catches the rest.
  function bucket(x, edges, labels) {
    const i = edges.findIndex((e) => x < e);
    return { options: labels, answer: i === -1 ? labels.length - 1 : i };
  }

  // ---- questions about what the data says now (answers change as the data does) ----
  function dataQuestions(D, E, T) {
    const qs = [];
    const oil = series(D, 'brent');
    if (oil && oil.yoy != null) {
      qs.push({ id: 'oil-year', q: 'Oil compared with a year ago?',
        ...bucket(oil.yoy, [-20, 20, 60], ['Down more than 20%', 'Within 20% either way', 'Up 20% to 60%', 'Up more than 60%']),
        why: `Oil averaged ${usd(oil.last.v)} a barrel in ${mlabel(oil.last.m)}, ${signed(oil.yoy)} in a year.`, link: 'card-brent' });
    }
    const food = series(D, 'fao_food');
    if (food && food.yoy != null) {
      qs.push({ id: 'food-year', q: 'The FAO Food Price Index (world food prices) compared with a year ago?',
        ...bucket(food.yoy, [-5, 5, 15], ['Down more than 5%', 'About flat (within 5%)', 'Up 5% to 15%', 'Up more than 15%']),
        why: `The FAO Food Price Index was ${food.last.v.toFixed(1)} in ${mlabel(food.last.m)}, ${signed(food.yoy)} in a year.`, link: 'card-fao_food' });
    }
    const urea = series(D, 'urea');
    if (urea && urea.ch6 != null) {
      qs.push({ id: 'urea-6m', q: 'What has fertilizer (urea) done over the past 6 months?',
        ...bucket(urea.ch6, [-30, -10, 10], ['Fell by a third or more', 'Fell somewhat', 'Stayed about flat', 'Rose']),
        why: `Urea is ${usd(urea.last.v)} a ton, ${signed(urea.ch6)} in 6 months. Cheaper fertilizer tends to mean cheaper crops a season later.`, link: 'card-urea' });
    }
    if (E && E.oni && E.oni.length) {
      const a = E.oni[E.oni.length - 1][2];
      const labels = ['A strong El Niño (warm)', 'A mild El Niño', 'Neutral', 'La Niña (cool)'];
      const answer = a >= 1.5 ? 0 : a >= 0.5 ? 1 : a > -0.5 ? 2 : 3;
      qs.push({ id: 'enso-now', q: 'What is the tropical Pacific doing right now?', options: labels, answer,
        why: `It's ${Math.abs(a).toFixed(1)}°C ${a >= 0 ? 'warmer' : 'cooler'} than normal. NOAA: ${E.status || ''}.`, link: 'outlook' });
    }
    if (T && T.commodities) {
      for (const c of T.commodities.filter((x) => ['wheat', 'rice', 'soybeans', 'maize'].includes(x.id))) {
        const ex = c.exporters;
        if (ex.length < 6) continue;
        const nm = (p) => T.names[String(p)] || '?';
        const the = (p) => (['United States', 'United Kingdom', 'Netherlands', 'Philippines'].includes(nm(p)) ? 'the ' + nm(p) : nm(p));
        const opts = shuffle([ex[0], ex[1], ex[2], ex[4 + Math.floor(Math.random() * Math.min(3, ex.length - 4))]]);
        const crop = c.id;
        qs.push({ id: 'seller-' + c.id, q: `Which country sells the most ${crop} to other countries?`,
          options: opts.map(([p]) => nm(p)), answer: opts.indexOf(ex[0]),
          why: `${nm(ex[0][0])} sells about ${Math.round(ex[0][1] / c.covered * 100)}% of it, then ${the(ex[1][0])} and ${the(ex[2][0])}.`, link: 'trade' });
      }
    }
    // Trend and value: rising >= 10% in a year but no more than 15% above the 5-year average
    const names = { silver: 'Silver', gold: 'Gold', copper: 'Copper', brent: 'Oil', wheat: 'Wheat', maize: 'Maize', rice: 'Rice', soybeans: 'Soybeans', urea: 'Urea' };
    const rows = Object.keys(names).map((id) => ({ id, s: series(D, id) })).filter((r) => r.s && r.s.yoy != null)
      .map((r) => ({ id: r.id, early: r.s.yoy >= 10 && (r.s.last.v / r.s.avg5 - 1) * 100 <= 15 }));
    const early = rows.filter((r) => r.early), rest = rows.filter((r) => !r.early);
    if (early.length && rest.length >= 3) {
      const pick = early[Math.floor(Math.random() * early.length)];
      const opts = shuffle([pick, ...shuffle(rest.slice()).slice(0, 3)]);
      qs.push({ id: 'early-trend', q: 'Which of these is in an "early rise": going up, but still near its usual price?',
        options: opts.map((r) => names[r.id]), answer: opts.indexOf(pick),
        why: `In an early rise right now: ${early.map((r) => names[r.id].toLowerCase()).join(', ')}.`, link: 'trendvalue' });
    }
    return qs;
  }

  // ---- questions about how things work (the part worth remembering for years) ----
  const CONCEPTS = [
    { id: 'c-gas', q: 'Natural gas is the main ingredient in which farm supply?',
      options: ['Nitrogen fertilizer, like urea', 'Tractor diesel', 'Pesticides', 'Seed'], answer: 0,
      why: 'Urea is made from natural gas, so a gas price spike shows up in fertilizer and then in crop prices a season later.' },
    { id: 'c-oilfood', q: 'How does expensive oil reach your grocery bill?',
      options: ['Through diesel, shipping and fertilizer costs', 'Through import taxes on food', 'Only through restaurant prices', 'It doesn\'t; they\'re unrelated'], answer: 0,
      why: 'Diesel runs tractors and trucks, fuel moves ships, and fertilizer is made from gas. Some crops also become biofuel.' },
    { id: 'c-palm', q: 'A strong El Niño tends to cut which crop, about a year later?',
      options: ['Palm oil in Indonesia and Malaysia', 'Soybeans in Argentina', 'Wheat in Canada', 'Maize in the US'], answer: 0,
      why: 'El Niño brings drought to Southeast Asia. Argentina usually gets more rain, not less.' },
    { id: 'c-lanina', q: 'What often follows a strong El Niño within 18 months?',
      options: ['La Niña, its cool opposite', 'An even stronger El Niño', 'Calm, neutral years', 'Nothing predictable'], answer: 0,
      why: 'After 7 of the 9 strong El Niños since 1950, La Niña followed. It tends to dry out Argentina and the southern US.' },
    { id: 'c-silver', q: 'Why does silver swing harder than gold?',
      options: ['It\'s half money, half industrial metal', 'It\'s rarer than gold', 'It\'s mostly used for jewelry', 'Governments set its price'], answer: 0,
      why: 'Solar panels and electronics use a lot of silver, so it moves with factories as well as with fear.' },
    { id: 'c-ban', q: 'What usually happens when a big food exporter bans exports?',
      options: ['Buyers panic and world prices jump', 'World prices fall', 'Nothing much', 'Only that country\'s prices rise'], answer: 0,
      why: '2008: rice nearly tripled in six months after India and Vietnam limited exports.' },
    { id: 'c-late', q: 'In "Trend and value", what does "late rise" mean?',
      options: ['Going up, and already well above its usual price', 'Going up, but still near its usual price', 'Falling from a high', 'Cheap and still falling'], answer: 0,
      why: 'A late rise can keep going, but more of the jump has already happened.' },
    { id: 'c-cure', q: 'After big oil spikes since 1970, where was oil a year later?',
      options: ['Higher about half the time, lower about half', 'Almost always higher', 'Almost always lower', 'Always back to where it started'], answer: 0,
      why: 'Higher after 5 of 9 spikes, lower after 4. High prices cut demand and bring more supply, but not on a schedule.' },
  ];

  // ---- spaced picking ----
  function pick(all, memo) {
    const t = today();
    const due = all.filter((q) => memo[q.id] && memo[q.id].due <= t).sort((a, b) => memo[a.id].box - memo[b.id].box);
    const fresh = shuffle(all.filter((q) => !memo[q.id]));
    const later = all.filter((q) => memo[q.id] && memo[q.id].due > t).sort((a, b) => memo[a.id].due - memo[b.id].due);
    const out = [];
    // keep a mix: at most 2 "how it works" questions and 1 "who sells the most" per visit
    const kind = (q) => (q.id.startsWith('c-') ? 'c' : q.id.startsWith('seller-') ? 's' : 'd');
    const cap = { c: 2, s: 1, d: PER_VISIT };
    for (const q of [...due, ...fresh, ...later]) {
      if (out.length >= PER_VISIT) break;
      if (out.filter((x) => kind(x) === kind(q)).length >= cap[kind(q)]) continue;
      out.push(q);
    }
    for (const q of [...due, ...fresh, ...later]) { if (out.length >= PER_VISIT) break; if (!out.includes(q)) out.push(q); }
    // "how it works" answers are written first; shuffle them (data buckets keep their natural order)
    return out.map((q) => {
      if (!q.id.startsWith('c-')) return q;
      const order = shuffle(q.options.map((_, i) => i));
      return { ...q, options: order.map((i) => q.options[i]), answer: order.indexOf(q.answer) };
    });
  }

  function renderQuiz(qs, memo) {
    let done = 0, right = 0;
    const score = $('quiz-score');
    score.textContent = `${qs.length} questions. Ones you miss come back on your next visit; ones you know come back less often.`;
    $('quiz').replaceChildren(...qs.map((q, n) => {
      const card = el('div', { class: 'qcard' });
      card.append(el('p', { class: 'qq' }, `${n + 1}. ${q.q}`));
      const opts = el('div', { class: 'qopts', role: 'group', 'aria-label': q.q });
      const fb = el('p', { class: 'qfb', 'aria-live': 'polite' });
      q.options.forEach((o, i) => {
        const b = el('button', { type: 'button', class: 'qopt' }, o);
        b.addEventListener('click', () => {
          const ok = i === q.answer;
          for (const x of opts.children) x.disabled = true;
          b.classList.add(ok ? 'is-right' : 'is-wrong');
          opts.children[q.answer].classList.add('is-right');
          const m = memo[q.id] || { box: 0 };
          m.box = ok ? Math.min(m.box + 1, GAPS.length - 1) : 0;
          m.due = addDays(GAPS[m.box]); // a miss is due again right away
          m.t = Date.now(); // for merging with other devices
          memo[q.id] = m;
          save('quiz', memo);
          fb.replaceChildren(el('span', { class: 'qmark ' + (ok ? 'ok' : 'no'), 'aria-hidden': 'true' }, ok ? '✓' : '✗'),
            el('strong', {}, ok ? 'Right. ' : 'Not quite. '), q.why + ' ');
          if (q.link) fb.append(el('a', { href: '#' + q.link }, 'See it'));
          done += 1; right += ok ? 1 : 0;
          if (done === qs.length) score.textContent = `${right} of ${qs.length} right. ${right === qs.length ? 'Nice.' : 'The ones you missed will come back next visit.'}`;
        });
        opts.append(b);
      });
      card.append(opts, fb);
      return card;
    }));
  }

  // ---- make a call ----
  const CALLS = [
    { s: 'fao_food', label: 'FAO Food Price Index', unit: (v) => v.toFixed(1),
      now: (v, m) => `The FAO Food Price Index was ${v.toFixed(1)} in ${m}.` },
    { s: 'brent', label: 'Oil', unit: (v) => usd(v),
      now: (v, m) => `Oil averaged ${usd(v)} a barrel in ${m}.` },
  ];
  function renderCalls(D) {
    let calls = load('calls', []);
    const latest = {};
    for (const c of CALLS) { const s = series(D, c.s); if (s) latest[c.s] = s; }
    // score calls whose next month has arrived
    for (const k of calls) {
      const s = latest[k.s];
      if (k.result || !s) continue;
      const nxt = s.p.find((q) => q.m === k.from + 1);
      if (!nxt) continue;
      const up = nxt.v > k.v;
      k.result = { v: nxt.v, right: (k.call === 'up') === up };
      k.seen = false;
    }
    save('calls', calls);

    const box = $('calls');
    box.replaceChildren(...CALLS.filter((c) => latest[c.s]).map((c) => {
      const s = latest[c.s];
      const card = el('div', { class: 'qcard' });
      card.append(el('p', { class: 'qq' }, `${c.now(s.last.v, mlabel(s.last.m))} Will ${mlabel(s.last.m + 1)} be higher or lower?`));
      const mine = calls.find((k) => k.s === c.s && k.from === s.last.m);
      const fb = el('p', { class: 'qfb' });
      if (mine) {
        fb.textContent = `Your call: ${mine.call === 'up' ? 'higher' : 'lower'}. It gets scored when the ${mlabel(s.last.m + 1)} number comes in, early next month.`;
        card.append(fb);
        return card;
      }
      const opts = el('div', { class: 'qopts two' });
      for (const [v, t] of [['up', 'Higher'], ['down', 'Lower']]) {
        const b = el('button', { type: 'button', class: 'qopt' }, t);
        b.addEventListener('click', () => {
          calls = load('calls', []);
          calls.push({ s: c.s, from: s.last.m, v: s.last.v, call: v, made: today() });
          save('calls', calls.slice(-40));
          renderCalls(D);
        });
        opts.append(b);
      }
      card.append(opts);
      return card;
    }));

    const done = calls.filter((k) => k.result);
    const rec = $('calls-record');
    rec.replaceChildren();
    if (done.length) {
      const r = done.filter((k) => k.result.right).length;
      rec.append(el('strong', {}, `Your record: ${r} of ${done.length} call${done.length > 1 ? 's' : ''} right. `));
      const lastFew = done.slice(-3).reverse().map((k) => {
        const c = CALLS.find((x) => x.s === k.s);
        return `${c ? c.label : k.s}, ${mlabel(k.from + 1)}: you said ${k.call === 'up' ? 'higher' : 'lower'}, it ${k.result.v > k.v ? 'rose' : 'fell'} to ${c ? c.unit(k.result.v) : k.result.v} ${k.result.right ? '✓' : '✗'}`;
      });
      rec.append(lastFew.join('; ') + '.');
    } else {
      rec.textContent = 'Guess before the new numbers come out. The page checks your guess when they do. Even experts are right only a bit more than half the time, so this is about paying attention, not winning.';
    }

    // banner near the top when a call has just been scored
    const unseen = calls.filter((k) => k.result && k.seen === false);
    const banner = $('callback');
    if (unseen.length) {
      const k = unseen[unseen.length - 1];
      const c = CALLS.find((x) => x.s === k.s);
      banner.replaceChildren(el('span', { class: 'qmark ' + (k.result.right ? 'ok' : 'no'), 'aria-hidden': 'true' }, k.result.right ? '✓' : '✗'),
        `Your call came in: ${c ? c.label : k.s} ${k.result.v > k.v ? 'rose' : 'fell'}, and you said ${k.call === 'up' ? 'higher' : 'lower'}. `,
        el('a', { href: '#check' }, 'Make the next one'));
      banner.hidden = false;
      for (const x of unseen) x.seen = true;
      save('calls', calls);
    }
  }

  async function init() {
    const [D, E, T] = await Promise.all([getJSON('data/series.json'), getJSON('data/enso.json'), getJSON('data/trade.json')]);
    if (!D || !D.series) return;
    const memo = load('quiz', {});
    const all = [...dataQuestions(D, E, T), ...CONCEPTS];
    renderQuiz(pick(all, memo), memo);
    renderCalls(D);
    // sync.js merged in progress from another device: refresh what we hold
    window.addEventListener('tp:synced', () => {
      for (const k of Object.keys(memo)) delete memo[k];
      Object.assign(memo, load('quiz', {}));
      renderCalls(D);
    });
    $('check').hidden = false;
  }

  init();
})();
