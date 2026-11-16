# claude-trades

**Trade Pulse**: a dashboard for silver, gold, world food prices and what drives them (oil,
fertilizer), with decades of history so today's numbers have context.

Live at **<https://nosv1.github.io/claude-trades/>**.

## What's on it

- **Heads up:** the signals worth watching in the coming months (oil, El Niño, food prices,
  cooking oils, fertilizer, copper, single-seller pressure points), rated Alert / Watch / Easing
  and recomputed from the data every day.
- **Silver right now:** live spot price, what your ounces are worth, and where today's price ranks
  against the last 1, 5 and 10 years and all history since 1960.
- **Metals:** silver, gold, the gold/silver ratio, copper.
- **Food:** the FAO Food Price Index and its five groups, plus wheat, maize, rice, soybeans.
- **Drivers:** Brent crude oil and urea fertilizer.
- Every chart has 1Y / 5Y / 10Y / 25Y / All ranges, an inflation adjustment and a table view.
- **Who feeds whom:** for wheat, maize, rice, soybeans and nitrogen fertilizer, who sells it, who
  buys it, and which buyers would be hit hardest if one seller stopped exporting.

## Data (all free, no API keys)

| Source | What | How often |
| --- | --- | --- |
| [World Bank Pink Sheet](https://www.worldbank.org/en/research/commodity-markets) | Monthly commodity prices since 1960 | Early each month |
| [FAO Food Price Index](https://www.fao.org/worldfoodsituation/foodpricesindex/en/) | Monthly food price indices since 1990 | Early each month |
| [FRED CPIAUCSL](https://fred.stlouisfed.org/series/CPIAUCSL) | US consumer prices, for inflation adjustment | Monthly |
| [gold-api.com](https://gold-api.com) | Live silver and gold spot price | Live, in the browser |
| [NOAA CPC](https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/) | El Niño / La Niña status and ocean-temperature index | Monthly |
| [UN Comtrade](https://comtradeplus.un.org/) (public preview API) | Imports by country and supplier | Annual; refetched monthly by `scripts/fetch_trade.py` |

## How it works

A static site in `site/`, no build step. A GitHub Action
([.github/workflows/update-and-deploy.yml](.github/workflows/update-and-deploy.yml)) runs daily:
it runs `scripts/fetch_data.py`, commits any new data in `site/data/`, and publishes `site/` to
GitHub Pages. The page also asks gold-api.com for the live silver and gold price when it loads.

## Run it locally

```sh
pip install openpyxl
python scripts/fetch_data.py          # refresh site/data/
python -m http.server 8000 -d site    # then open http://localhost:8000
```
