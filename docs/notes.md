# Session notes

Newest first. Update at sign-off, commit as Claude.

## Scope

**Trade Pulse** (2026-11-15): a phone-first dashboard that puts today's prices for metals and food in
context, so he can tell whether "silver is low" or "food is expensive" is actually true. Static site
on GitHub Pages; a daily GitHub Action fetches free data (World Bank Pink Sheet, FAO Food Price
Index, FRED CPI) into `site/data/`; the page adds the live silver/gold price from gold-api.com.

**Milestone 1 (built 2026-11-15, branch `dashboard-v1`):** silver hero (live price, what a holding is
worth, rank vs 1/5/10 years and since 1960, inflation-adjusted record, gold/silver ratio verdict);
charts for silver, gold, gold/silver ratio, copper, FAO index, wheat, maize, rice, soybeans, Brent,
urea; FAO sub-index tiles; range filter, inflation toggle, table view per chart.

## Handoff

**Where it stands (2026-11-15):** milestone 1 merged to `main` and live at
<https://nosv1.github.io/claude-trades/>. Pages source must be "GitHub Actions"; with "Deploy from a
branch" the root shows the README and the dashboard only appears under `/site/`.

**Roadmap, in order (Claude's call as domain expert, 2026-11-15):**

1. ~~Who feeds whom~~ built 2026-11-16 (`scripts/fetch_trade.py`, `site/trade.js`): wheat, maize,
   rice, soybeans, nitrogen fertilizer; sellers, buyers, "if this seller stopped" picker.
2. (Partly done in Heads up.) Shortage early warnings: USDA stocks-to-use ratios (best single leading signal), export bans,
   shipping chokepoints (Red Sea, Panama). Prices only show a shortage after it starts.
3. Daily spot chart: `site/data/spot.json` already logs one silver/gold price a day.
4. Price alert when silver crosses a price he picks.

Code review fixes merged 2026-11-15 (CPI gap interpolation, workflow push retry, etc.).

## Log

- **2026-11-16:** He wants to actually remember it. Added **Check yourself** (`site/quiz.js`, nav
  "Quiz"): 4 questions per visit mixing live-data questions (oil and food vs a year ago, urea 6
  months, El Niño, top seller per crop, which item is in an early trend) with "how it works" ones;
  spaced repetition (Leitner boxes: misses due again at once, then 1/3/7/21/60 days). Plus **Make a
  call**: guess whether next month's food index and oil are higher or lower; scored when the data
  arrives, with a banner at the top of the page. All in localStorage (`tp.quiz`, `tp.calls`).
  Weekly routine status: first test run blocked (no GitHub write access for the cloud session;
  Default environment blocks news sites). He needs to install the Claude GitHub App on the repo and
  open up the environment's network.
- **2026-11-16:** Mobile reading pass: sticky section nav (`site/nav.js`, scroll-spy, hides links to
  hidden sections); Heads up, What could happen next and the weekly read's items fold on phones
  (`details.fold`, open by default at 760px+). Folded scenario cards show a progress strip, the
  next step and what it could push up or down. Heads up went from ~8 phone screens to ~3. Also:
  the weekly routine now covers politics that moves supply, neutrally (new `Politics` tag).
- **2026-11-16:** Option 3 wired: a weekly Claude Code routine (his subscription, no API key) runs
  Mondays 14:00 UTC, follows [weekly-routine.md](weekly-routine.md), writes `site/data/briefing.json`
  ("This week's read", top of the page) and updates `scenarios.json`, checks both with
  `scripts/check_weekly.py`, and pushes a `claude/weekly-read-YYYY-MM-DD` branch. The
  [weekly-read workflow](../.github/workflows/weekly-read.yml) re-checks, copies only those two files
  to `main`, deletes the branch and starts a deploy. The page hides the section if the file is bad.
  Next: mobile redesign for easier reading.
- **2026-11-16:** He asked for "a sequence of probable events that could trigger outcomes". Added
  **What could happen next** (`site/scenarios.js`, `site/data/scenarios.json`): 6 event chains written
  by Claude (El Niño harvests, La Niña follows, oil into food, oil cures itself, export-ban scramble,
  cheap fertilizer). Each step with a `check` (series + yoy/ch3/ch6/fromPeak, or ONI) lights up from
  the data, in order; the others are news to watch. Likelihoods and "last time" lines were checked
  against the data (e.g. cooking oils higher a year after all 5 strong El Niños since 1990; La Niña
  followed 7 of 9 strong El Niños since 1950). `scenarios.json` is the file the planned weekly Claude
  routine (option 3, not set up yet) would rewrite.
- **2026-11-16:** He wants "don't miss out" more than stock-up advice. Added **Trend and value**
  under Heads up: 12-month trend vs distance from the 5-year average (both documented long-run
  tendencies in commodities, weak per item), giving one reading per item: Early trend, Late trend,
  Cooling from a high, Out of favor (turning up), No clear signal. Copy is explicit that it's not a
  buy list and public info is already priced in. At launch: grains = early trend; oil, copper = late.
- **2026-11-16:** He clarified the goal: awareness, "look out for this in the coming months". Added a
  **Heads up** section at the top (`site/outlook.js`): rule-based signals (Alert / Watch / Pressure
  point / Easing) for oil, El Nino/La Nina (NOAA ONI + advisory, new `enso.json`), world food prices
  and grains, cooking oils, fertilizer, copper, and single-seller pressure points from the trade
  data, plus "what it could mean for you". Rules and thresholds live in `signals()`; keep the copy
  plain and say "signals, not predictions". At launch: oil $125 (+93% y/y), very strong El Nino,
  cooking oils near 10-year high = alerts; fertilizer easing.
- **2026-11-16:** "Who feeds whom" section. UN Comtrade public preview API (no key): ~3.5 s between
  calls or HTTP 429, and a daily quota (403 "Quota Exceeded") of roughly 50 calls, so a full fetch
  takes two days. The script saves per crop with a `fetched` date and the daily Action refreshes
  only crops missing or 30+ days old. Fertilizer was cut off by the quota on the first run and
  should arrive on the next daily run. Russia hasn't reported to Comtrade since 2022, so all flows
  are read from the importers' side. 2025 had 125 reporters vs 144 for 2024, so 2024 is used.
- **2026-11-15:** Repo made public (needed for free Pages). He handed over the domain calls ("be the
  expert"). Built milestone 1. Found: silver peaked at a $92.10 monthly average (Jan 2026) and is
  ~$48.7 now, so "low" holds only against this year; it's still above 98% of months since 1960.
- **2026-11-15:** GitHub repo created (private), merged its "Initial commit" with local history, pushed. Video that sparked it: "Why We're Suddenly Being Told to Stockpile" (The Invisible Hand, https://youtu.be/nrXNWn3BLK8). Wants a global-trends dashboard (food + metals) as a web app on GitHub Pages.
- **2026-11-15:** repo created (git init, CLAUDE.md, these notes). Mode "just build it". Local only.
  Folder is still named `cluade-trades` (typo); rename to `claude-trades` was blocked by a process
  holding the folder.
