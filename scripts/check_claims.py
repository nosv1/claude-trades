"""Assert the fixed-period claims written into the page (site/index.html, site/quiz.js) about the
US dollar, oil and food, against site/data/series.json. Run after editing those sentences:

    python scripts/check_claims.py

The Heads-up card counts its own cases live, so it isn't covered here.
"""
import json
import pathlib
import sys

S = json.loads((pathlib.Path(__file__).resolve().parent.parent / "site/data/series.json")
               .read_text(encoding="utf-8"))["series"]


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
years = lambda ms: sorted({m // 12 for m in ms})

def all_(ms, test):
    """True if there are months and every one has data and passes; missing data fails the claim."""
    return bool(ms) and all(None not in v and test(*v) for v in ms)


def halved(d, ms):
    """The worst year-on-year change in these months was -45% or lower (missing data fails)."""
    v = [yoy(d, m) for m in ms]
    return bool(v) and None not in v and min(v) <= -0.45


foods_down = [yoy(food, m) for m in down]


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
}
bad = [c for c, ok in claims.items() if not ok]
for c, ok in claims.items():
    print("ok  " if ok else "FAIL", c)
sys.exit(1 if bad else 0)
