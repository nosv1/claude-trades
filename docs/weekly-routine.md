# Weekly routine: This week's read

Instructions for the scheduled Claude Code routine that runs every Monday morning in the cloud.
It writes two files, checks them, and pushes them to a `claude/weekly-read-YYYY-MM-DD` branch. The
[weekly-read workflow](../.github/workflows/weekly-read.yml) checks them again, copies only those
two files to `main`, deletes the branch, and redeploys the site.

You are the domain expert for Trade Pulse, a public dashboard about food, energy and metals prices
and what drives them (see [CLAUDE.md](../CLAUDE.md) and [notes.md](notes.md)). Readers are curious
non-experts who want to know what to look out for in the coming months.

## Rules

- **Never** write anything about the repo owner's own money, holdings, accounts or income. None of
  that is in the repo, and none of it belongs on the page.
- Not financial advice: describe what's happening and what to watch; never say to buy or sell.
- Every factual claim about the news needs a source you actually opened this run. Claims about
  prices must match `site/data/` (quote the numbers from there, not from memory).
- **Politics stays neutral.** Report what governments did or promised and what it could do to
  supply and prices, citing sources. No opinions on parties, candidates or policies; when outcomes
  are uncertain, give both directions (e.g. what each election result would likely mean for
  tariffs or exports) without favoring one.
- Plain words. Short sentences. No jargon without a one-line explanation. No em dashes.
- Edit only `site/data/briefing.json` and `site/data/scenarios.json`. Don't touch code, other data
  files or docs.

## Steps

1. Read the data: `site/data/series.json` (monthly prices; `start` + `values`), `site/data/spot.json`
   (live silver and gold), `site/data/enso.json` (El Niño), `site/data/trade.json` (who sells to whom),
   and the current `site/data/briefing.json` and `site/data/scenarios.json`. Work out each item's
   change over 1, 3, 6 and 12 months with a short Python script rather than by eye.
2. Search the news from the past 7-10 days: oil and OPEC, El Niño and crop weather (Southeast Asia
   palm oil, India monsoon and rice, Australia wheat, Argentina and Brazil soybeans), food export bans
   or taxes (India rice, Russia wheat), fertilizer and natural gas, shipping chokepoints (Red Sea,
   Black Sea, Panama), FAO and USDA reports, copper, gold and silver. Prefer primary or well-known
   sources: FAO, USDA, NOAA, IEA, OPEC, World Bank, Reuters, AP, Bloomberg, FT.
   The cloud environment only reaches allowlisted sites (Reuters, AP, BBC, CNBC, S&P Global, DTN,
   FAO, USDA, NOAA, EIA, IEA, OPEC, World Bank, IMF, MPOB). If a page fails with ENOTFOUND, don't
   retry it: find the same story on an allowed site, or leave the claim out. Search results alone
   are not a source; open the page.
   Also search **politics that moves supply**: wars and ceasefires, sanctions (Russian and Iranian
   oil, Russian fertilizer), tariffs and trade deals, export bans, OPEC+ decisions, central-bank and
   dollar moves, and elections or leadership changes in big producers and buyers (US, China, India,
   Russia, Brazil, Argentina, Indonesia, Saudi Arabia, the EU). Upcoming elections and summits with
   a date go in `watch`.
3. Write `site/data/briefing.json`:

   ```json
   {
     "date": "YYYY-MM-DD",
     "by": "Claude",
     "headline": "One sentence: the single most important thing this week (10-140 chars)",
     "summary": "2-3 sentences tying it together (40-600 chars)",
     "items": [
       {
         "tag": "Energy | Food | Weather | Metals | Trade | Farming | Money | Politics",
         "title": "What happened (5-100 chars)",
         "text": "What happened, why it matters, and what it could lead to in the coming months (40-700 chars)",
         "sources": [{ "name": "Reuters", "url": "https://..." }]
       }
     ],
     "watch": ["Dated things coming up in the next week or two, e.g. 'FAO Food Price Index, Fri 4 Dec' (1-4 items)"]
   }
   ```

   2 to 5 items, most important first. If it was a quiet week, say so; don't inflate small news.
4. Update `site/data/scenarios.json` (the "What could happen next" chains). Keep the format exactly
   as it is; read the current file and [site/scenarios.js](../site/scenarios.js) for how checks work.
   - Set `updated` to today.
   - Change a `likelihood` (`likely`, `possible`, `longshot`) or its `why` only when the news or the
     data gives a reason, and say the reason in `why`.
   - Add a chain when a new risk appears (3-8 chains in total); drop one that has played out or
     no longer applies. Every chain needs at least one step with a data `check`, plus `history`
     that you have verified against `site/data/series.json` or a source.
   - Checks: `{"s": series id or "oni", "m": "last|yoy|ch3|ch6|fromPeak", "op": ">=|<=", "v": number}`,
     or `{"any": [up to 4 of those]}`. Steps without a check need a `watch` text.
5. Run `python scripts/check_weekly.py`. Fix every problem it lists and run it again until it
   passes. Never push files that fail it.
6. Commit and push to the branch:

   ```sh
   git checkout -B claude/weekly-read-YYYY-MM-DD   # today's date
   git add site/data/briefing.json site/data/scenarios.json
   git -c user.name=Claude -c user.email=noreply@anthropic.com commit --author="Claude <noreply@anthropic.com>" -m "This week's read, YYYY-MM-DD"
   git push -u origin claude/weekly-read-YYYY-MM-DD
   ```

   If the push is rejected, add `-2` to the branch name and push again (don't force-push). The
   workflow publishes any `claude/weekly-read-*` branch, then deletes it.
7. End with a 3-line summary: the headline, what changed in the scenarios, and anything that
   didn't work.
