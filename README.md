# claude-trades

**Trade Pulse**: a dashboard for silver, gold, world food prices and what drives them (oil,
fertilizer), with decades of history so today's numbers have context.

Live at **<https://nosv1.github.io/claude-trades/>**.

## What's on it

- **This week's read:** a short briefing on the week's news, written by Claude every Monday
  with sources (see [docs/weekly-routine.md](docs/weekly-routine.md)).
- **Heads up:** the signals worth watching in the coming months (oil, El Niño, food prices,
  cooking oils, fertilizer, copper, single-seller pressure points), rated Alert / Watch / Easing
  and recomputed from the data every day.
- **What could happen next:** chains of events that have played out before (El Niño, La Niña,
  oil, export bans, fertilizer), each step lighting up when the data shows it. Written by Claude
  in `site/data/scenarios.json`.
- **Claude's track record:** every call and "Likely / Possible" rating Claude makes is logged with
  a date and graded against later data, and old entries can't be edited
  ([site/data/claude-log.json](site/data/claude-log.json)).
- **Trend and value:** for each commodity, its 12-month trend against its 5-year average, read as
  early trend, late trend, cooling, out of favor or no clear signal.
- **Silver right now:** live spot price, what your ounces are worth, and where today's price ranks
  against the last 1, 5 and 10 years and all history since 1960.
- **Metals:** silver, gold, the gold/silver ratio, copper.
- **Food:** the FAO Food Price Index and its five groups, plus wheat, maize, rice, soybeans.
- **Energy and fertilizer:** Brent crude oil and urea fertilizer.
- **Currencies:** the US dollar index, plus the Brazilian real, Chinese yuan and Indian rupee
  against the dollar (no inflation adjustment).
- Every chart has 1Y / 5Y / 10Y / 25Y / All ranges, an inflation adjustment and a table view.
- **Check yourself:** a short quiz that brings back what you missed, and "make a call" guesses on
  next month's food and oil prices that get scored when the data comes in. Saved in your browser,
  and synced across devices if you sign in with Google ([worker/](worker/README.md)).
- **Who feeds whom:** for wheat, maize, rice, soybeans and nitrogen fertilizer, who sells it, who
  buys it, and which buyers would be hit hardest if one seller stopped exporting.

## Data (all free, no API keys)

| Source | What | How often |
| --- | --- | --- |
| [World Bank Pink Sheet](https://www.worldbank.org/en/research/commodity-markets) | Monthly commodity prices since 1960 | Early each month |
| [FAO Food Price Index](https://www.fao.org/worldfoodsituation/foodpricesindex/en/) | Monthly food price indices since 1990 | Early each month |
| [FRED CPIAUCSL](https://fred.stlouisfed.org/series/CPIAUCSL) | US consumer prices, for inflation adjustment | Monthly |
| [FRED DTWEXBGS](https://fred.stlouisfed.org/series/DTWEXBGS) | Broad US dollar index, averaged by month | Daily |
| [FRED EXBZUS, EXCHUS, EXINUS](https://fred.stlouisfed.org/release/tables?rid=17) | Brazilian real, Chinese yuan, Indian rupee per US dollar | Monthly |
| [gold-api.com](https://gold-api.com) | Live silver and gold spot price | Live, in the browser |
| [NOAA CPC](https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/) | El Niño / La Niña status and ocean-temperature index | Monthly |
| [UN Comtrade](https://comtradeplus.un.org/) (public preview API) | Imports by country and supplier | Annual; refetched monthly by `scripts/fetch_trade.py` |

## How it works

A static site in `site/`, no build step. A GitHub Action
([.github/workflows/update-and-deploy.yml](.github/workflows/update-and-deploy.yml)) runs daily:
it runs `scripts/fetch_data.py`, commits any new data in `site/data/`, and publishes `site/` to
GitHub Pages. Every Monday a scheduled Claude Code routine writes `site/data/briefing.json` and
updates `site/data/scenarios.json` on a `claude/weekly-read-*` branch; the
[weekly-read workflow](.github/workflows/weekly-read.yml) checks them with
`scripts/check_weekly.py`, copies them to `main` and redeploys. The page also asks gold-api.com for the live silver and gold price when it loads.

## Run it locally

```sh
pip install openpyxl
python scripts/fetch_data.py          # refresh site/data/
python -m http.server 8000 -d site    # then open http://localhost:8000
```
