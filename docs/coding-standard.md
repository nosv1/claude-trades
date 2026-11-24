# Coding standard

The standard is the hub's [CODING.md](https://github.com/nosv1/nosv1/blob/main/CODING.md): NASA/JPL's "Power of
Ten" carried into JavaScript and Python at the strictest settings the tools have. It replaced this file's own
version on 2026-11-23. This page keeps only what's particular to Trade Pulse.

## How the rules land here

- **Rule 2, loops.** A `while` needs a comment saying why it ends (for example "at most 2 steps back from a
  weekend"). Retry loops have a fixed number of tries.
- **Rule 3, inputs have size limits.** Every file or request we read from outside has a cap: fetched JSON,
  Worker bodies, files Claude writes.
- **Rule 5, check data where it comes in.** Anything from outside (APIs, `site/data/*.json`, files Claude
  writes, the Worker's request bodies) is checked for shape and range at the edge, once, and the code after
  that can trust it. Bad input gives a clear message, not a half-drawn page. On the page, every JSON fetch
  goes through `TP.getJSON` (site/common.js): a timeout, a size cap and a shape check per data file. A file
  that fails counts as missing, and a damaged `series.json` shows the error box. `check_weekly.py` does the
  same for the weekly files before they publish.
- **Rule 6 and 9, no hidden state.** The page's scripts are classic scripts in strict mode (`'use strict'`).
  No globals beyond `window.TP` and `window.TP_SYNC`. Modules talk through those and DOM events
  (`tp:progress`, `tp:synced`). Storage access is wrapped in `try`.
- **Rule 7, broad catches.** `except Exception` / `catch` only where any failure means the same thing, with
  the reason on that line (for example `# noqa: BLE001 - keep the previous data`).

## This project's extra rule

11. **Claims are code too.** Any sentence on the page that states a fact about the data is checked against
    the data before it ships. Words like "every", "always" and "never" need a script that asserts them
    (`scripts/check_claims.py`), or the text says "in N of M" and counts live. The weekly read's numbers go
    through `check_weekly.py` facts.

## Running it

One-time: `npm ci` and `pip install -r requirements-dev.txt`. Then, before every commit:

```sh
npm run check     # ESLint, strict tsc, Ruff + mypy strict, the baselines, check_claims.py, check_weekly.py
```

The Lint workflow runs the same on every push, apart from the deploy so a lint failure never blocks the daily
data refresh.

**Old findings (2026-11-23)** are in `eslint-suppressions.json` (41) and `checks-baseline.json` (765 type
findings, mostly untyped parameters, plus 190 Ruff and 179 mypy). Both only shrink: when you're in a
file, clean its entries where that's reasonable, then `npm run lint:prune`, `npm run types:update` or
`npm run py:update`.
