# Coding standard

Adapted from NASA/JPL's "Power of Ten" (Gerard Holzmann, 2006), the core of the JPL Institutional
Coding Standard. Those rules are for flight software in C, where nobody can patch a broken
spacecraft. This is a static site in JavaScript and Python, so some rules don't apply (memory
allocation, pointers, the preprocessor) and others become their nearest equivalent here. Each
rule says how it's checked; "lint" means the Lint workflow, which runs on every push and allows
zero warnings.

## The rules

1. **Simple control flow.** No recursion except over data whose depth is capped where it enters
   (say where). No `eval`, no `with`, no labels. *(lint: `no-eval`, `no-labels`, `no-with`)*
2. **Every loop has a bound you can state.** `for` over a collection, or a counter with a fixed
   cap. A `while` needs a comment saying why it ends (for example "at most 2 steps back from a
   weekend"). Retry loops have a fixed number of tries.
3. **Inputs have size limits.** The nearest thing to "no allocation after startup": every file or
   request we read from outside has a cap (fetched JSON, Worker bodies, Claude-written files).
4. **Functions fit on one screen: 60 lines at most**, and stay simple (cyclomatic complexity 15
   at most). Split by job, not by line count. *(lint: `max-lines-per-function`, `complexity`;
   Ruff `C901`, `PLR0915`)*
5. **Check data where it comes in.** Anything from outside (APIs, `site/data/*.json`, files Claude
   writes, the Worker's request bodies) is checked for shape and range at the edge, once, and the
   code after that can trust it. Bad input gives a clear message, not a half-drawn page.
   `check_weekly.py` does this for the weekly files; `TP.getJSON` (site/common.js) does it for the
   page's data files, and a damaged `series.json` shows the page's error box.
6. **Smallest scope.** `const` by default, `let` only when reassigned, never `var`. No new
   globals beyond `window.TP`, `window.TP_SYNC`. No name that hides an outer one.
   *(lint: `no-var`, `prefer-const`, `no-shadow`, `no-implicit-globals`)*
7. **Check every result.** Every `fetch` checks `r.ok`; every subprocess checks its exit code;
   every parse can fail. A broad `except Exception` / `catch` is allowed only where any failure
   means the same thing, with a comment saying what (for example "keep the previous data").
   No unused variables, no empty `catch` without a comment. *(lint: `no-unused-vars`,
   `no-empty`; Ruff `BLE`, `F`)*
8. **Plain language features.** Strict mode in every script (`'use strict'`); `===` (except
   `== null`). *(lint: `strict`, `eqeqeq`)*
9. **No hidden state.** Modules talk through `window.TP` and DOM events (`tp:progress`,
   `tp:synced`), not shared mutable globals. Storage access is wrapped in `try`.
10. **Zero warnings, checked on every push.** ESLint and Ruff run in the Lint workflow, kept
    separate from the deploy so a lint failure never blocks the daily data refresh. A warning is
    fixed or, if the rule is wrong for that line, disabled on that line with a reason.

## This project's extra rule

11. **Claims are code too.** Any sentence on the page that states a fact about the data is
    checked against the data before it ships. Words like "every", "always" and "never" need a
    script that asserts them (`scripts/check_claims.py`), or the text says "in N of M" and counts
    live. The weekly read's numbers go through `check_weekly.py` facts.

## Running it

```sh
npx eslint@10.14.0 .          # JavaScript: site/ and worker/
uvx ruff@0.17.3 check .       # Python: scripts/
python scripts/check_claims.py
python scripts/check_weekly.py
```
