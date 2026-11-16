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
