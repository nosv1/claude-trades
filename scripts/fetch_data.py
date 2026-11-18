"""Fetch commodity, food-price and inflation data into site/data/.

Run:  python scripts/fetch_data.py
Needs: openpyxl (pip install openpyxl)

Sources (all free, no API key):
  World Bank "Pink Sheet"  monthly commodity prices since 1960 (metals, grains, oil, fertilizer)
  FAO Food Price Index     monthly, since 1990
  FRED CPIAUCSL            US consumer prices, for inflation adjustment
  FRED DTWEXBGS            Broad US dollar index (daily, averaged by month)
  FRED EXBZUS/EXCHUS/EXINUS  Brazilian real, Chinese yuan, Indian rupee per US dollar (monthly)
  gold-api.com             live silver/gold spot price
  NOAA CPC                 El Nino / La Nina status and the ONI ocean-temperature index

The World Bank and FAO file links change with each monthly release, so the script finds them on
each source's landing page and falls back to the last known link. If a source fails, the previous
data for it is kept, so one bad download never blanks the dashboard.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import openpyxl

OUT = Path(__file__).resolve().parent.parent / "site" / "data"
# Plain UA on purpose: FRED stalls browser-like strings it does not recognize.
UA = {"User-Agent": "data-fetch/1.0"}

WB_PAGE = "https://www.worldbank.org/en/research/commodity-markets"
WB_FALLBACK = (
    "https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/"
    "related/CMO-Historical-Data-Monthly.xlsx"
)
FAO_PAGE = "https://www.fao.org/worldfoodsituation/foodpricesindex/en/"
FAO_FALLBACK = (
    "https://www.fao.org/media/docs/worldfoodsituationlibraries/wfs-library/"
    "food_price_indices_data.csv"
)
CPI_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCSL"
USD_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DTWEXBGS"
FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={}"
# FRED monthly exchange rates (Federal Reserve H.10): id -> (our id, name, unit)
FX_SERIES = {
    "EXBZUS": ("brl", "Brazilian real", "reals per US dollar (higher = weaker real)"),
    "EXCHUS": ("cny", "Chinese yuan", "yuan per US dollar (higher = weaker yuan)"),
    "EXINUS": ("inr", "Indian rupee", "rupees per US dollar (higher = weaker rupee)"),
}
SPOT = "https://api.gold-api.com/price/{}"
ONI = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"
ENSO_PAGE = "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml"

# World Bank column header -> (id, display name, unit)
WB_SERIES = {
    "Silver": ("silver", "Silver", "$/troy oz"),
    "Gold": ("gold", "Gold", "$/troy oz"),
    "Copper": ("copper", "Copper", "$/metric ton"),
    "Wheat, US HRW": ("wheat", "Wheat", "$/metric ton"),
    "Maize": ("maize", "Maize (corn)", "$/metric ton"),
    "Rice, Thai 5%": ("rice", "Rice", "$/metric ton"),
    "Soybeans": ("soybeans", "Soybeans", "$/metric ton"),
    "Crude oil, Brent": ("brent", "Crude oil (Brent)", "$/barrel"),
    "Urea": ("urea", "Urea fertilizer", "$/metric ton"),
}

# FAO CSV column -> (id, display name)
FAO_SERIES = {
    "Food Price Index": ("fao_food", "FAO Food Price Index"),
    "Cereals": ("fao_cereals", "Cereals"),
    "Vegetable Oils": ("fao_oils", "Vegetable oils"),
    "Oils": ("fao_oils", "Vegetable oils"),
    "Dairy": ("fao_dairy", "Dairy"),
    "Meat": ("fao_meat", "Meat"),
    "Sugar": ("fao_sugar", "Sugar"),
}


def get(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def find_link(page: str, pattern: str, fallback: str) -> str:
    try:
        html = get(page).decode("utf-8", "replace")
        m = re.search(pattern, html)
        if m:
            return urllib.parse.urljoin(page, m.group(0))
    except Exception as e:  # noqa: BLE001 - any failure means "use the fallback"
        print(f"  warn: could not read {page}: {e}", file=sys.stderr)
    return fallback


def to_series(points: dict[str, float]) -> dict:
    """{"YYYY-MM": v} -> {"start": "YYYY-MM", "values": [v | None, ...]} with no gaps."""
    months = sorted(points)
    y, m = map(int, months[0].split("-"))
    ey, em = map(int, months[-1].split("-"))
    values = []
    while (y, m) <= (ey, em):  # one step per month from the first to the last: ends
        values.append(points.get(f"{y:04d}-{m:02d}"))
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return {"start": months[0], "values": values}


def fetch_world_bank() -> tuple[dict, dict]:
    url = find_link(WB_PAGE, r"https?://[^\"']+CMO-Historical-Data-Monthly\.xlsx", WB_FALLBACK)
    print(f"World Bank: {url}")
    wb = openpyxl.load_workbook(io.BytesIO(get(url, 120)), read_only=True, data_only=True)
    rows = list(wb["Monthly Prices"].iter_rows(values_only=True))
    updated = next(
        (str(r[0]).replace("Updated on", "").strip() for r in rows[:6]
         if r[0] and "Updated" in str(r[0])),
        None,
    )
    header_row = next(i for i, r in enumerate(rows[:12]) if r[1] and "Crude oil" in str(r[1]))
    headers = [str(h).replace("*", "").strip() if h else "" for h in rows[header_row]]
    out = {}
    for col, h in enumerate(headers):
        if h not in WB_SERIES:
            continue
        sid, name, unit = WB_SERIES[h]
        pts = {}
        for r in rows[header_row + 2:]:
            m = re.fullmatch(r"(\d{4})M(\d{2})", str(r[0] or ""))
            if m and isinstance(r[col], (int, float)):
                pts[f"{m.group(1)}-{m.group(2)}"] = round(float(r[col]), 4)
        out[sid] = {"name": name, "unit": unit, "source": "wb", **to_series(pts)}
    missing = {v[0] for v in WB_SERIES.values()} - set(out)
    if missing:
        raise RuntimeError(f"World Bank columns not found: {sorted(missing)}")
    return out, {"name": "World Bank Commodity Price Data (Pink Sheet)", "url": WB_PAGE,
                 "updated": updated}


def fetch_fao() -> tuple[dict, dict]:
    url = find_link(FAO_PAGE, r"[^\"']*food_price_indices_data\.csv", FAO_FALLBACK)
    print(f"FAO: {url}")
    text = get(url).decode("utf-8-sig", "replace")
    rows = list(csv.reader(io.StringIO(text)))
    header_row = next(i for i, r in enumerate(rows) if r and r[0].strip() == "Date")
    headers = [h.strip() for h in rows[header_row]]
    pts: dict[str, dict[str, float]] = {}
    for r in rows[header_row + 1:]:
        m = re.fullmatch(r"(\d{4})-(\d{1,2})", (r[0] if r else "").strip())
        if not m:
            continue
        month = f"{m.group(1)}-{int(m.group(2)):02d}"
        for col, h in enumerate(headers):
            if h in FAO_SERIES and col < len(r):
                try:
                    pts.setdefault(FAO_SERIES[h][0], {})[month] = float(r[col])
                except ValueError:
                    pass
    names = {sid: name for sid, name in FAO_SERIES.values()}
    out = {sid: {"name": names[sid], "unit": "index, 2014-2016 = 100", "source": "fao",
                 **to_series(p)} for sid, p in pts.items()}
    if "fao_food" not in out:
        raise RuntimeError("FAO Food Price Index column not found")
    return out, {"name": "FAO Food Price Index", "url": FAO_PAGE, "updated": None}


def fetch_cpi() -> tuple[dict, dict]:
    print(f"FRED: {CPI_CSV}")
    rows = list(csv.reader(io.StringIO(get(CPI_CSV).decode())))
    pts = {}
    for r in rows[1:]:
        try:
            pts[r[0][:7]] = float(r[1])
        except (ValueError, IndexError):
            pass
    return (
        {"cpi": {"name": "US consumer prices (CPI-U)", "unit": "index, 1982-84 = 100",
                 "source": "fred", **to_series(pts)}},
        {"name": "US Bureau of Labor Statistics CPI-U, via FRED",
         "url": "https://fred.stlouisfed.org/series/CPIAUCSL", "updated": None},
    )


def fetch_dollar() -> tuple[dict, dict]:
    """Broad trade-weighted US dollar index (Jan 2006 = 100), daily -> monthly averages.
    Only finished months, so it lines up with the other monthly series. FRED posts this about once
    a week with a lag, so a month counts only once FRED has a row (holidays are ".") for its last
    weekday; otherwise early in a month the previous month would be averaged from part of its days."""
    print(f"FRED: {USD_CSV}")
    rows = list(csv.reader(io.StringIO(get(USD_CSV).decode())))
    days: dict[str, list[float]] = {}
    last_row = ""
    for r in rows[1:]:
        if len(r) < 2 or len(r[0]) != 10:
            continue
        last_row = max(last_row, r[0])
        try:
            days.setdefault(r[0][:7], []).append(float(r[1]))
        except ValueError:
            continue  # holidays are "."
    if not days:
        raise RuntimeError("no dollar index rows")

    def last_weekday(m: str) -> str:
        y, mo = map(int, m.split("-"))
        d = dt.date(y + mo // 12, mo % 12 + 1, 1) - dt.timedelta(days=1)
        while d.weekday() > 4:  # at most 2 steps back, from a Sunday
            d -= dt.timedelta(days=1)
        return d.isoformat()

    pts = {m: round(sum(v) / len(v), 2) for m, v in days.items() if last_row >= last_weekday(m)}
    if not pts:
        raise RuntimeError("no finished month in the dollar index")
    return (
        {"usd": {"name": "US dollar index", "unit": "against a broad basket of 26 currencies, Jan 2006 = 100",
                 "source": "fred_usd", **to_series(pts)}},
        {"name": "Federal Reserve broad dollar index, via FRED",
         "url": "https://fred.stlouisfed.org/series/DTWEXBGS", "updated": None},
    )


def fetch_fx() -> tuple[dict, dict]:
    """Monthly average exchange rates. All three or none, so the cards never mix fresh and stale."""
    out = {}
    for fred_id, (sid, name, unit) in FX_SERIES.items():
        url = FRED_CSV.format(fred_id)
        print(f"FRED: {url}")
        pts = {}
        for r in list(csv.reader(io.StringIO(get(url).decode())))[1:]:
            try:
                pts[r[0][:7]] = float(r[1])
            except (ValueError, IndexError):
                continue  # header, blank or "." for a month not published yet
        if len(pts) < 120:
            raise RuntimeError(f"{fred_id}: only {len(pts)} months")
        out[sid] = {"name": name, "unit": unit, "source": "fred_fx", **to_series(pts)}
    return (
        out,
        {"name": "Federal Reserve exchange rates (H.10), via FRED",
         "url": "https://fred.stlouisfed.org/release/tables?rid=17", "updated": None},
    )


def fetch_spot() -> dict:
    spot = {}
    for sid, sym in (("silver", "XAG"), ("gold", "XAU")):
        d = json.loads(get(SPOT.format(sym), 20))
        spot[sid] = {"price": round(float(d["price"]), 2), "at": d.get("updatedAt")}
    return spot


def fetch_enso() -> dict:
    """NOAA's El Nino/La Nina status, synopsis and the last 3 years of the ONI index."""
    import html as htmllib
    oni = []
    for line in get(ONI).decode().splitlines():
        parts = line.split()
        if len(parts) == 4 and parts[1].isdigit():
            oni.append([parts[0], int(parts[1]), float(parts[3])])
    page = get(ENSO_PAGE).decode("cp1252", "replace")
    text = re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", " ", page)))
    status = re.search(r"Alert System Status:\s*(.+?)\s*Synopsis:", text)
    synopsis = re.search(r"Synopsis:\s*(.+?\.)\s+(?=[A-Z])", text)
    issued = re.search(r"(\d{1,2} (?:January|February|March|April|May|June|July|August|September|"
                       r"October|November|December) \d{4})", text)
    if not oni or not synopsis:
        raise RuntimeError("could not parse NOAA ENSO data")
    return {"status": status.group(1).strip() if status else None,
            "synopsis": synopsis.group(1).strip(), "issued": issued.group(1) if issued else None,
            "url": ENSO_PAGE, "oni": oni[-36:]}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    series_path, spot_path = OUT / "series.json", OUT / "spot.json"
    prev = json.loads(series_path.read_text()) if series_path.exists() else {"series": {},
                                                                            "sources": {}}
    series, sources, failed = dict(prev["series"]), dict(prev["sources"]), []

    fetchers = (("wb", fetch_world_bank), ("fao", fetch_fao), ("fred", fetch_cpi), ("fred_usd", fetch_dollar),
                ("fred_fx", fetch_fx))
    for key, fn in fetchers:
        try:
            got, meta = fn()
            series.update(got)
            sources[key] = meta
        except Exception as e:  # noqa: BLE001 - keep previous data for this source
            failed.append(key)
            print(f"  FAILED {key}: {e}", file=sys.stderr)

    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    if len(failed) < len(fetchers):
        series_path.write_text(json.dumps(
            {"generated": now, "sources": sources, "series": series}, separators=(",", ":")))

    try:
        (OUT / "enso.json").write_text(json.dumps(fetch_enso(), separators=(",", ":"), ensure_ascii=False),
                                       encoding="utf-8")
    except Exception as e:  # noqa: BLE001 - keep the previous enso.json
        failed.append("enso")
        print(f"  FAILED enso: {e}", file=sys.stderr)

    # Live spot snapshot, plus one row per day so a daily history builds up over time.
    try:
        spot = fetch_spot()
        prev_spot = json.loads(spot_path.read_text()) if spot_path.exists() else {}
        history = {row[0]: row for row in prev_spot.get("history", [])}
        history[now[:10]] = [now[:10], spot["silver"]["price"], spot["gold"]["price"]]
        spot_path.write_text(json.dumps(
            {"fetched": now, **spot, "history": sorted(history.values())},
            separators=(",", ":")))
    except Exception as e:  # noqa: BLE001
        failed.append("spot")
        print(f"  FAILED spot: {e}", file=sys.stderr)

    missing_now = [k for k in ("silver", "fao_food", "cpi") if k not in series]
    print(f"done; failed sources: {failed or 'none'}")
    return 1 if missing_now else 0


if __name__ == "__main__":
    sys.exit(main())
