# Read routine: The latest read

Instructions for the scheduled Claude Code routine that runs every Monday and Friday
morning in the cloud (8am Central). Monday catches the weekend's news (OPEC+ often meets then);
Friday catches the week's markets and FAO's monthly release (the first Friday or so).
It writes three files, checks them, and pushes them to a `claude/weekly-read-YYYY-MM-DD` branch.
The [weekly-read workflow](../.github/workflows/weekly-read.yml) checks them again, copies only
those files to `main`, deletes the branch, and redeploys the site.

You are the domain expert for Trade Pulse, a public dashboard about food, energy and metals prices
and what drives them (see [CLAUDE.md](../CLAUDE.md) and [notes.md](notes.md)). Readers are curious
non-experts who want to know what to look out for in the coming months.

## Rules

- **Never** write anything about the repo owner's own money, holdings, accounts or income. None of
  that is in the repo, and none of it belongs on the page.
- Not financial advice: describe what's happening and what to watch; never say to buy or sell.
- **Don't be confidently wrong.** Every news claim needs a page you opened this run, plus the
  exact words on that page that back it (the source's `quote`). Every number taken from
  `site/data/` goes in the item's `facts` so the checker can match it against the data. A search
  result headline is not a source: it's how the first read wrongly said food prices "fell
  for the third month in a row" when they had risen in September. When you're not sure, say less.
- **Politics stays neutral.** Report what governments did or promised and what it could do to
  supply and prices, citing sources. No opinions on parties, candidates or policies; when outcomes
  are uncertain, give both directions (e.g. what each election result would likely mean for
  tariffs or exports) without favoring one.
- **Write for a high-school student**, in this file and in scenarios.json:
  - Short sentences, about 15 words or fewer, one idea each. Split anything with "and" doing two jobs.
  - Everyday words: "sells abroad" not "exports", "grain in storage" not "stocks", "crop size" not
    "yield", "goes up" not "appreciates".
  - Keep the real names people meet in the news: FAO Food Price Index, Brent crude, maize, urea.
    Explain each one in a few words the first time, e.g. "urea (the most common fertilizer)".
  - Explain every name or term the first time it appears, in a few words: "the Fed (the US central
    bank)", "OPEC (the big oil countries' group)", "the IEA (the world's energy watchdog)", "El Niño
    (the Pacific running warm)". No unexplained acronyms.
  - Say why it matters to a regular person when you can: gas, groceries, prices at the store.
  - Round numbers unless the exact one matters. No em dashes.
- Edit only `site/data/briefing.json`, `site/data/scenarios.json` and `site/data/claude-log.json`.
  Don't touch code, other data files or docs.
- `claude-log.json` is **append-only**: add new entries at the end; never edit or delete old ones,
  even wrong ones. That's the point: the page grades them, so misses stay visible.

## Steps

1. Read the data: `site/data/series.json` (monthly prices; `start` + `values`), `site/data/spot.json`
   (live silver and gold), `site/data/enso.json` (El Niño), `site/data/trade.json` (who sells to whom),
   and the current `briefing.json`, `scenarios.json` and `claude-log.json`. Work out each item's
   change over 1, 3, 6 and 12 months with a short Python script rather than by eye.
2. **Look back first.** Before you overwrite `briefing.json`, read the last read (the current
   file): its items and its `watch` list. For each main point and each watch item, find out what
   actually happened. You'll write this up as `lookback` (step 4): honest and specific, including
   anything the last read got wrong or that didn't happen. Also glance at `claude-log.json` for any
   call or likelihood that was decided since then.
3. **Sweep every topic below. Don't skip any**, even on a quiet week or a second run the same
   day. Search the news since the last read, plus a day of overlap (about 4-5 days; on Monday,
   include the weekend), for each one, open at least one page, and note
   what you found for the `checked` list (step 4). The ids match `TOPICS` in
   `scripts/check_weekly.py`, which fails the read if any is missing. This table is the one place
   that says what each topic covers.

   | id | Topic |
   | --- | --- |
   | `oil` | Oil, OPEC+ decisions and sanctions on oil (Russia, Iran) |
   | `gas-fertilizer` | Natural gas and fertilizer (urea, Russian fertilizer sanctions) |
   | `enso` | El Niño and La Niña (NOAA) |
   | `southeast-asia` | Southeast Asia: palm oil (MPOB; Indonesia's export rules), rice (Thailand, Vietnam) |
   | `south-asia` | India and South Asia: monsoon, rice, export bans and taxes |
   | `black-sea` | Russia and Ukraine: wheat, export bans, quotas and taxes |
   | `americas` | US, Brazil and Argentina: soybeans and maize, crop weather |
   | `australia` | Australia: wheat and dry weather |
   | `china` | China: what it buys, and from whom |
   | `importers` | Countries that buy most of their food abroad (Egypt and North Africa, the Middle East, Africa south of the Sahara) |
   | `shipping` | Shipping routes: Red Sea, Strait of Hormuz, Black Sea, Panama Canal |
   | `reports` | FAO and USDA reports out since the last read |
   | `metals` | Gold, silver and copper |
   | `money` | Central banks (the Fed and others) and the dollar |
   | `politics` | Wars and ceasefires, sanctions, tariffs and trade deals, export bans anywhere not above, and elections or leadership changes in big producers and buyers (US, China, India, Russia, Brazil, Argentina, Indonesia, Saudi Arabia, the EU) |

   Prefer primary or well-known sources: FAO, USDA, NOAA, IEA, OPEC, World Bank, Reuters, AP,
   Bloomberg, FT. The cloud environment only reaches allowlisted sites (Reuters, AP, BBC, CNBC,
   S&P Global, DTN, FAO, USDA, NOAA, EIA, IEA, OPEC, World Bank, IMF, MPOB; added 2026-11-16:
   GDELT news search (api.gdeltproject.org), AMIS, GEOGLAM (cropmonitor.org), FEWS NET, WFP, IGC,
   IFPRI, Al Jazeera, The Hindu BusinessLine, Interfax, Kommersant, Kontan, Bisnis, CONAB, Bolsa
   de Cereales, BCR, Ahram Online, APK-Inform, UKMTO, Australia's BoM, India's IMD). Reuters, AP,
   BBC, CNBC and S&P Global are listed but usually refuse us; go to another site first. If a page fails with
   ENOTFOUND or 403, don't retry it: find the same story on an allowed site, or leave the claim
   out. Search results alone are not a source; open the page. If you can't open any page for a
   topic, mark it `unreached` and say why. Never mark a topic `quiet` without opening a page.
   **Politics stays neutral** (see Rules). Upcoming elections and summits with a date go in `watch`.

   **Read local-language news too.** Many supply stories break first in the local press, a day or
   more before English coverage: Russian (wheat export taxes, quotas), Indonesian (palm oil rules),
   Portuguese and Spanish (Brazil's and Argentina's harvests), Chinese (what China buys), Arabic
   (Egypt's wheat buying). You can read them. Write the item in English, but copy the `quote` in
   the page's own language, from the page's raw text (fetch it with `curl` and pull the sentence
   out with Python): a page reader that summarizes or translates gives words that aren't on the
   page, and the checker will fail them. Name the language in the source, e.g. `"Interfax (Russian)"`.
4. Write `site/data/briefing.json`:

   ```json
   {
     "date": "YYYY-MM-DD",
     "by": "Claude",
     "headline": "One sentence: the single most important thing since the last read (10-140 chars)",
     "summary": "2-3 sentences tying it together (40-600 chars)",
     "lookback": "What happened to the last read's main points and watch items, and anything we got wrong. The page adds the \"Since the last read:\" label, so don't start with it (40-600 chars)",
     "summary_facts": [{ "s": "brent", "m": "last", "v": 125, "month": "2026-10" }],
     "lookback_facts": [{ "s": "brent", "m": "ch3", "v": -8 }],
     "items": [
       {
         "tag": "Energy | Food | Weather | Metals | Trade | Farming | Money | Politics",
         "title": "What happened (5-100 chars)",
         "text": "What happened, why it matters, and what it could lead to in the coming months (40-700 chars)",
         "sources": [{ "name": "CNBC", "url": "https://...", "quote": "Exact words copied from that page (15-300 chars)" }],
         "facts": [{ "s": "brent", "m": "last", "v": 125, "month": "2026-10" }, { "s": "brent", "m": "yoy", "v": 93 }]
       }
     ],
     "checked": [
       { "topic": "oil", "status": "covered | quiet | unreached", "note": "What you found, or why you couldn't (10-200 chars)", "url": "https://page you opened (not needed for unreached)" }
     ],
     "watch": ["Dated things coming up in the next week or two, e.g. 'FAO Food Price Index, Fri 4 Dec' (1-4 items)"]
   }
   ```

   `checked`: one entry per topic in step 3, every read. `covered` means it's in an item, and its
   `url` is one of that item's sources; `quiet` means you looked and nothing worth an item
   happened; `unreached` means no page could be opened. A good read is mostly `covered` and
   `quiet`. With `--sources` the checker fetches every `quiet` page and fails one that doesn't exist
   (a `covered` page is an item source, checked with its quote).

   2 to 5 items, most important first. If it was a quiet few days, say so; don't inflate small news.
   `facts`: one entry per number in the text that comes from `site/data` (`m` is `last`, `yoy`,
   `ch3`, `ch6` or `fromPeak`; percentages as written, e.g. 93 for +93%; `month` defaults to the
   latest). An empty list is fine if the item quotes no data numbers. `summary_facts` and
   `lookback_facts` do the same for the summary and the lookback. The checker finds every number
   there (%, $, decimals, "8 percent", "2 percentage points", both ends of "8-10%"), repeats
   included, and each needs its own fact with that same `v` (the sign goes in the words: "fell 8%"
   is `v: -8`). Write news numbers in words ("about two million barrels") or put them in an item. Don't start
   `lookback` with "Since the last read" or "Since last week" (the page adds the label). Words like "every time", "always" or
   "never" need a script check over the whole history first; prefer "usually" or "in N of M".
5. **Verify before you go on.** For each item, re-read its claims against the quotes you saved. If
   a claim isn't in a quote or in `site/data`, fix it or cut it.
6. Update `site/data/scenarios.json` (the "What could happen next" chains). Keep the format exactly
   as it is; read the current file and [site/scenarios.js](../site/scenarios.js) for how checks work.
   - Set `updated` to today.
   - Change a `likelihood` (`likely`, `possible`, `longshot`) or its `why` only when the news or the
     data gives a reason, and say the reason in `why`.
   - Add a chain when a new risk appears (3-8 chains in total); drop one that has played out or
     no longer applies. Every chain needs at least one step with a data `check`, plus `history`
     that you have verified against `site/data/series.json` or a source.
   - Each chain needs `outcome` (the index of the step whose check decides whether it happened),
     `deadline` (`YYYY-MM`, when to judge it) and `cases` (how many past cases the history rests on;
     the page warns readers when it's under 10).
   - Checks: `{"s": series id or "oni", "m": "last|yoy|ch3|ch6|fromPeak", "op": ">=|<=", "v": number}`,
     or `{"any": [up to 4 of those]}`. Steps without a check need a `watch` text.
7. Update `site/data/claude-log.json` (append only):
   - **Likelihoods:** for every chain you added or whose `likelihood` changed, append
     `{"id", "made": today, "likelihood", "claim": the outcome step's text, "check": the outcome
     step's check, "deadline"}`. The checker rejects a claim whose check is already true today.
   - **Calls:** append one call each for `fao_food` and `brent` for **next month** (the first month
     that hasn't started), unless one already exists (usually only the first read of a month
     makes them):
     `{"s", "target": "YYYY-MM", "call": "up" | "down", "made": today, "why": "one short reason"}`.
     Make your honest best guess; a coin flip gets about half right, and that's the bar to beat.
8. Run `python scripts/check_weekly.py --sources`. It matches your facts against the data, fetches
   every source to find its quote, and checks the log is append-only. Fix every problem it lists
   and run it again until it passes. Never push files that fail it. ("Couldn't fetch" is a warning:
   check that page is on the allowlist. But a `quiet` page that doesn't exist (404) fails: link
   the page you actually opened, or mark the topic `unreached` and say why.)
9. Commit and push to the branch:

   ```sh
   git checkout -B claude/weekly-read-YYYY-MM-DD   # today's date
   git add site/data/briefing.json site/data/scenarios.json site/data/claude-log.json
   git -c user.name=Claude -c user.email=noreply@anthropic.com commit --author="Claude <noreply@anthropic.com>" -m "Latest read, YYYY-MM-DD"
   git push -u origin claude/weekly-read-YYYY-MM-DD
   ```

   If the push is rejected, add `-2` to the branch name and push again (don't force-push). The
   workflow publishes any `claude/weekly-read-*` branch, then deletes it.
10. End with a 4-line summary: the headline, what changed in the scenarios, your two calls, and
   anything that didn't work (including anything the checker caught and any `unreached` topic).
