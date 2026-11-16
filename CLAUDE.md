# claude-trades

**Trade Pulse**: a static dashboard on GitHub Pages for silver, gold, world food prices and what
drives them, with decades of history for context. Scope and milestones: [docs/notes.md](docs/notes.md).

## Read first

**Before anything else this session, fetch and read Chris's profile:**
https://raw.githubusercontent.com/nosv1/nosv1/main/PROFILE.md

It says who he is and how to work with him. If the fetch fails, say so; don't proceed as a generic
assistant. Local copy of the hub: `C:\Users\chris\nosv1`.

Then read this repo's [docs/notes.md](docs/notes.md) (session notes; update at sign-off, commit as
Claude).

## This project

- **Mode: "just build it"** (his call, 2026-11-15). Claude writes the code, as in SpellIt! and
  afterwatch. The flight-instructor default in PROFILE.md doesn't apply here unless he says so.
- **Claude is the domain expert too** (his call, 2026-11-15): he knows little about global trade and
  said to make the calls. Pick what to show and explain it in plain words on the page; check claims
  against the data before writing them.
- **Audience: a high-schooler** (his call, 2026-11-16). All page text, scenarios and the weekly read
  use short sentences, everyday words ("sells abroad", "usual price") and explain any name or
  term the first time ("the Fed (the US central bank)"). Keep real names (FAO Food Price Index,
  Brent, maize, urea) rather than swapping them for plain ones (his call, 2026-11-16). Rules in
  [docs/weekly-routine.md](docs/weekly-routine.md).
- **Commits:** authored as Claude (`--author="Claude <noreply@anthropic.com>"`), explicit paths
  only, never `git add -A` or `git add .`.
- **Remote:** public repo [nosv1/claude-trades](https://github.com/nosv1/claude-trades); site at
  <https://nosv1.github.io/claude-trades/>, deployed by the GitHub Action on every push to `main`
  and daily (it also refreshes `site/data/`).
- **Run it:** `pip install openpyxl`, `python scripts/fetch_data.py`, then
  `python -m http.server 8000 -d site` and open <http://localhost:8000>.
- **Data quirk:** FRED stalls browser-like User-Agent strings; the fetch script uses a plain one.
