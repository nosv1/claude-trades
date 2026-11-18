"""Assert the fixed-period claims written into the page (site/index.html, site/quiz.js, the
currency card blurbs in site/app.js) about the US dollar, oil, food, other currencies and the top
sellers and buyers, against site/data/series.json and trade.json. Run after editing those sentences:

    python scripts/check_claims.py

The Heads-up card counts its own cases live, so it isn't covered here.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
S = json.loads((ROOT / "site/data/series.json").read_text(encoding="utf-8"))["series"]


def monthly(sid):
    s = S[sid]
    y, m = map(int, s["start"].split("-"))
    m0 = y * 12 + m - 1
    return {m0 + i: v for i, v in enumerate(s["values"]) if v is not None}


def yoy(d, m):
    return d[m] / d[m - 12] - 1 if m in d and m - 12 in d else None


usd, oil, food = monthly("usd"), monthly("brent"), monthly("fao_food")
period = [m for m in usd if 2007 <= m // 12 <= 2025 and yoy(usd, m) is not None]
up = [m for m in period if yoy(usd, m) >= 0.08]
down = [m for m in period if yoy(usd, m) <= -0.08]
def years(ms):
    return sorted({m // 12 for m in ms})


def all_(ms, test):
    """True if there are months and every one has data and passes; missing data fails the claim."""
    return bool(ms) and all(None not in v and test(*v) for v in ms)


def halved(d, ms):
    """The worst year-on-year change in these months was -45% or lower (missing data fails)."""
    v = [yoy(d, m) for m in ms]
    return bool(v) and None not in v and min(v) <= -0.45


foods_down = [yoy(food, m) for m in down]
brl, cny, inr, rub = monthly("brl"), monthly("cny"), monthly("inr"), monthly("rub")


def in_year(d, y):
    return [d[m] for m in range(y * 12, y * 12 + 12) if m in d]


def year_avg(d, y):
    """Average of a full year; NaN (fails every comparison) if any month is missing."""
    v = in_year(d, y)
    return sum(v) / 12 if len(v) == 12 else float("nan")


peg = [cny[m] for m in range(1998 * 12, 2005 * 12 + 6) if m in cny]  # Jan 1998 to Jun 2005
TRADE = {c["id"]: c for c in json.loads((ROOT / "site/data/trade.json").read_text(encoding="utf-8"))["commodities"]}


def top_seller(cid):
    """UN country code of the biggest exporter (codes: 76 Brazil, 156 China, 643 Russia, 699 India)."""
    return max(TRADE[cid]["exporters"], key=lambda e: e[1])[0]


def top_buyer(cid):
    return max(TRADE[cid]["importers"], key=lambda i: i["total"])["c"]


claims = {
    "strong-dollar years are 2008-09, 2012 (one month), 2014-16 and 2022":
        years(up) == [2008, 2009, 2012, 2014, 2015, 2016, 2022] and sum(m // 12 == 2012 for m in up) == 1,
    "outside 2022, oil and food fell in every strong-dollar month":
        all_([(yoy(oil, m), yoy(food, m)) for m in up if m // 12 != 2022], lambda o, f: o < 0 and f < 0),
    "oil fell by as much as half (worst month -45% or lower) in 2008-09 and 2014-16":
        all(halved(oil, [m for m in up if a <= m // 12 <= b]) for a, b in ((2008, 2009), (2014, 2016))),
    "in 2022 oil and food rose in every strong-dollar month":
        all_([(yoy(oil, m), yoy(food, m)) for m in up if m // 12 == 2022], lambda o, f: o > 0 and f > 0),
    "weak dollar: oil rose every time":
        all_([(yoy(oil, m),) for m in down], lambda o: o > 0),
    "weak dollar: food rose in all but one month":
        bool(foods_down) and None not in foods_down and sum(f <= 0 for f in foods_down) == 1,
    # Currency card blurbs (site/app.js CARDS.currency)
    "real: under 2 per dollar all of 2011, about 6 in Dec 2024":
        len(in_year(brl, 2011)) == 12 and max(in_year(brl, 2011)) < 2 and 5.5 <= brl.get(2024 * 12 + 11, 0) <= 6.5,
    "yuan: held near 8.28 (8.27-8.32) every month from 1998 to mid-2005":
        len(peg) == 90 and all(8.27 <= v <= 8.32 for v in peg),
    "rupee: about 45 per dollar in 2000 (yearly average 43-47)":
        len(in_year(inr, 2000)) == 12 and 43 <= sum(in_year(inr, 2000)) / 12 <= 47,
    "Brazil sells the most soybeans and China buys the most":
        top_seller("soybeans") == 76 and top_buyer("soybeans") == 156,
    "India sells the most rice": top_seller("rice") == 699,
    "ruble: about 32 per dollar in 2013, about 67 in 2016 (yearly averages within 2)":
        abs(year_avg(rub, 2013) - 32) <= 2 and abs(year_avg(rub, 2016) - 67) <= 2,
    "oil crashed in 2014: Brent's 2015-16 low was under half its June 2014 level":
        min(oil[m] for m in range(2015 * 12, 2017 * 12) if m in oil) < oil[2014 * 12 + 5] / 2,
    "Russia sells the most wheat and fertilizer":
        top_seller("wheat") == 643 and top_seller("fertilizer") == 643,
}
bad = [c for c, ok in claims.items() if not ok]
for c, ok in claims.items():
    print("ok  " if ok else "FAIL", c)
sys.exit(1 if bad else 0)
