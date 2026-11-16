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

**Where it stands (2026-11-16, end of session):** live at <https://nosv1.github.io/claude-trades/>
(Pages source must be "GitHub Actions"). Sections: This week's read, Heads up, What could happen
next (+ Claude's track record), Trend and value, Silver, Charts, Who feeds whom, Check yourself.

**Running on their own:** daily data refresh + deploy (Action); weekly read every Monday 14:00 UTC
(routine `trig_01XVXQyruGPYEB3Pps7ASnkE`, follows [weekly-routine.md](weekly-routine.md), publishes
via the weekly-read workflow); sync worker auto-deploys on changes under `worker/`.

**Next session, first:**
1. **Google sign-in is on** (client ID added 2026-11-16, button live). Not yet confirmed: a real
   sign-in on his phone, cross-device sync, and the dark-mode fix for a white box behind the
   Google button on iPhone (`color-scheme: light` on `.gbtn iframe`; couldn't reproduce in Edge).
2. **Check Monday's routine run** (2026-11-23 is the first with the new rules: facts, quotes,
   `--sources`, claude-log calls). `RemoteTrigger list_runs`/`get_run_log`, then read what it
   published and whether the checker caught anything.
3. Early Jan 2027: first graded calls (Dec FAO up, Dec Brent down) appear on the track record.

**Roadmap, in order (Claude's call as domain expert, 2026-11-15):**

1. ~~Who feeds whom~~ built 2026-11-16 (`scripts/fetch_trade.py`, `site/trade.js`): wheat, maize,
   rice, soybeans, nitrogen fertilizer; sellers, buyers, "if this seller stopped" picker.
2. (Partly done in Heads up.) Shortage early warnings: USDA stocks-to-use ratios (best single leading signal), export bans,
   shipping chokepoints (Red Sea, Panama). Prices only show a shortage after it starts.
3. Daily spot chart: `site/data/spot.json` already logs one silver/gold price a day.
4. Price alert when silver crosses a price he picks.

Code review fixes merged 2026-11-15 (CPI gap interpolation, workflow push retry, etc.).

## Log

- **2026-11-16:** "How are we making sure we're not confidently wrong?" Built three guards:
  (1) **Claude's track record** (`site/scoreboard.js`, `site/data/claude-log.json`): append-only log
  of Claude's monthly higher/lower calls (fao_food, brent; next unstarted month) and every scenario
  likelihood with a data check and deadline; the page grades them and shows "said Likely: X of Y
  happened". Seeded 2026-11-16 with 6 likelihoods and 2 calls (Dec 2026: FAO up, Brent down).
  (2) **Fact check** (`scripts/check_weekly.py`): briefing items list `facts` (numbers matched
  against site/data) and each source carries an exact `quote`; `--sources` fetches every page and
  finds it. Also enforces append-only log, logged likelihood changes, no already-true "predictions",
  calls only on unstarted months. Proved it catches 7 kinds of error. Applying it to the first
  weekly read found 2 real errors, now fixed: "fell for the third month in a row" (it rose in Sep;
  came from an unopened search headline) and "one of the strongest" (NOAA: ~60% chance of the
  strongest since 1950). (3) **Case counts**: each chain has `cases`; under 10 shows "only a few,
  treat it as a rough guide". Also fixed all 10 /code-review findings on sync (merge before every
  write, no writes on no-change visits, login-failure state, JWKS refetch, 400 on bad JSON, byte
  cap, GIS retry, conditional sync note, shared `site/common.js`, real names). Sync worker live at
  https://trade-pulse-sync.nosv1.workers.dev; the workflow's YAML had an unquoted colon (my bug),
  which is why his Actions failed. Still waiting on the Google OAuth client ID.
- **2026-11-16:** He marked up the plain-words summary: keep "usual price", "sells abroad", "Weak
  spot", "Early rise", "trackable steps"; undo the name swaps. Real names are back (FAO Food Price
  Index, Brent crude, maize, urea), each explained once in plain words; the "grocery bill" line is
  gone. Routine style rules and CLAUDE.md updated to keep real names.
- **2026-11-16:** He asked for Google sign-in to save quiz answers, on his Cloudflare account. Built
  [worker/](../worker/README.md): a Cloudflare Worker (Durable Object per Google `sub`, SQLite-backed,
  free plan) that verifies Google ID tokens itself and issues random session tokens; stores only
  `sub`, sessions, quiz progress and calls (no email/name). Page side: `site/sync.js` +
  `site/sync-config.js` (empty = sign-in hidden), merge = newer `t` per question, calls unioned.
  Deployed by `.github/workflows/sync-worker.yml` (skips until the Cloudflare secrets exist).
  Tested locally with wrangler dev + `DEV_FAKE_LOGIN` (gitignored .dev.vars): CORS, bad tokens,
  scrubbing, isolation, 64 KB cap, logout, and a page-to-cloud merge. Waiting on him for:
  Cloudflare token + account ID as GitHub secrets, Google OAuth client ID, workers.dev URL.
- **2026-11-16:** He asked for it to read like it's for a high-schooler, not a graduate. Plain-words
  pass over every page string, the scenarios, this week's read and the routine's style rules (now
  "write for a high-school student", with a word list). Jargon swapped or explained: FAO index ->
  world food price index, Brent -> oil, maize -> corn, 5-year average -> usual price, exports ->
  sells abroad, "Pressure point" -> "Weak spot", "Early trend" -> "Early rise". Measured on the page's
  prose: ~13.4 -> ~11.8 words per sentence, and "5-year average" 16 -> 0, "maize" 17 -> 5. The
  formula grade was already ~6; the real problem was jargon and assumed background.
- **2026-11-16:** He wants to actually remember it. Added **Check yourself** (`site/quiz.js`, nav
  "Quiz"): 4 questions per visit mixing live-data questions (oil and food vs a year ago, urea 6
  months, El Niño, top seller per crop, which item is in an early trend) with "how it works" ones;
  spaced repetition (Leitner boxes: misses due again at once, then 1/3/7/21/60 days). Plus **Make a
  call**: guess whether next month's food index and oil are higher or lower; scored when the data
  arrives, with a banner at the top of the page. All in localStorage (`tp.quiz`, `tp.calls`).
  Weekly routine: first test run was blocked (no GitHub write access; Default environment blocked
  news sites). He installed the Claude GitHub App and set Default to Limited plus a news allowlist
  (listed in weekly-routine.md). Second run published end to end on 2026-11-16; spot-checked its
  numbers against site/data (all matched; sugar "highest since Dec 2024" is FAO's wording).
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
