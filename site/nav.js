'use strict';
// Sticky section nav: hides links to sections that aren't shown, highlights the one in view,
// and keeps the active link scrolled into the bar on phones.
(() => {
  const nav = document.getElementById('jump');
  if (!nav) return;
  const links = [...nav.querySelectorAll('a[data-for]')];
  const target = (a) => document.getElementById(a.dataset.for);

  function sync() {
    for (const a of links) { const t = target(a); a.hidden = !t || t.hidden; }
  }
  sync();
  const mo = new MutationObserver(() => { sync(); current = null; onScroll(); });
  for (const a of links) { const t = target(a); if (t) mo.observe(t, { attributes: true, attributeFilter: ['hidden'] }); }

  let current = null;
  function setActive(a) {
    if (a === current) return;
    current = a;
    for (const l of links) l.removeAttribute('aria-current');
    if (!a) return;
    a.setAttribute('aria-current', 'true');
    const r = a.getBoundingClientRect(), n = nav.getBoundingClientRect();
    if (r.left < n.left || r.right > n.right) nav.scrollTo({ left: a.offsetLeft - 16, behavior: 'smooth' });
  }
  function onScroll() {
    const line = nav.getBoundingClientRect().bottom + 40;
    let pick = null;
    for (const a of links) {
      const t = target(a);
      if (!t || t.hidden) continue;
      if (t.getBoundingClientRect().top <= line) pick = a;
    }
    setActive(pick || links.find((a) => !a.hidden) || null);
  }
  let queued = false;
  addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; onScroll(); });
  }, { passive: true });
  addEventListener('load', onScroll);
  onScroll();
})();
