"""Fetch "who feeds whom" trade data into site/data/trade.json.

Run:  python scripts/fetch_trade.py [--force] [--only wheat,rice]

Source: UN Comtrade public preview API (free, no key; rate-limited, so calls are spaced ~3.5 s).
Trade data is annual and changes slowly, so by default this exits early if trade.json is less
than 30 days old. A full run takes about 5 minutes and ~75 calls; the preview API also has a daily
quota (HTTP 403 "Quota Exceeded"). Each crop is saved as soon as it is done, and a crop that fails
keeps its previous data, so a run cut short by the quota can be finished later with --only.

Why imports, not exports: Russia, the largest wheat exporter, has not reported its trade to
Comtrade since 2022. Reading what each importer says it bought, and from whom, captures Russia
anyway (so-called mirror data).

Method, per commodity:
  1. Every country's total imports (3 batched calls) -> keep the biggest buyers.
  2. For those buyers, imports broken down by supplying country.
  3. Exporter ranking = sum of those buyers' imports by supplier.
"""

from __future__ import annotations

import datetime as dt
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "site" / "data" / "trade.json"
UA = {"User-Agent": "data-fetch/1.0"}
API = "https://comtradeapi.un.org/public/v1/preview/C/A/HS"
REF = "https://comtradeapi.un.org/files/v1/app/reference/{}.json"
GAP = 3.5          # seconds between API calls
TOP_BUYERS = 40    # buyers fetched in detail per commodity
MIN_SHARE = 0.005  # suppliers below 0.5% of a buyer's imports fold into "Other"
STALE_DAYS = 30

COMMODITIES = [
    ("wheat", "Wheat", "1001"),
    ("maize", "Maize (corn)", "1005"),
    ("rice", "Rice", "1006"),
    ("soybeans", "Soybeans", "1201"),
    ("fertilizer", "Nitrogen fertilizer", "3102"),
]

# Comtrade's official names, shortened to what people say.
RENAME = {
    "Russian Federation": "Russia", "USA": "United States", "Rep. of Korea": "South Korea",
    "Viet Nam": "Vietnam", "China, Hong Kong SAR": "Hong Kong", "Türkiye": "Turkey",
    "United Rep. of Tanzania": "Tanzania", "Dem. Rep. of the Congo": "DR Congo",
    "Iran (Islamic Rep. of)": "Iran", "Bolivia (Plurinational State of)": "Bolivia",
    "Venezuela (Bolivarian Rep. of)": "Venezuela", "Lao People's Dem. Rep.": "Laos",
    "Syria": "Syria", "Syrian Arab Rep.": "Syria", "Rep. of Moldova": "Moldova",
    "Dominican Rep.": "Dominican Republic", "Czechia": "Czechia",
    "Bosnia Herzegovina": "Bosnia and Herzegovina", "Côte d'Ivoire": "Ivory Coast",
    "Other Asia, nes": "Taiwan", "United Arab Emirates": "UAE", "Areas, nes": "Unspecified",
}

_last_call = 0.0


def get_json(url: str, tries: int = 5) -> dict:
    global _last_call
    for attempt in range(tries):
        wait = GAP - (time.time() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.time()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == tries - 1:
                raise
            time.sleep(15 * (attempt + 1))  # rate limited: back off and retry
    raise RuntimeError("unreachable")


def query(hs: str, year: int, reporters: list[int], partner: int | None = None) -> list[dict]:
    url = f"{API}?cmdCode={hs}&flowCode=M&period={year}&reporterCode={','.join(map(str, reporters))}"
    if partner is not None:
        url += f"&partnerCode={partner}"
    rows = get_json(url).get("data") or []
    # Keep the plain totals (no split by customs regime, transport mode or second partner).
    plain = [r for r in rows if r.get("customsCode") in (None, "C00") and r.get("motCode") in (None, 0)
             and r.get("partner2Code") in (None, 0)]
    return plain or rows


def names() -> tuple[list[int], dict[int, str]]:
    reps = get_json(REF.format("Reporters"))["results"]
    parts = get_json(REF.format("partnerAreas"))["results"]
    codes = [r["reporterCode"] for r in reps if not r.get("isGroup") and not r.get("entryExpiredDate")]
    name = {p["PartnerCode"]: p["PartnerDesc"] for p in parts}
    name.update({r["reporterCode"]: r["reporterDesc"] for r in reps})
    return codes, {k: RENAME.get(v, v) for k, v in name.items()}


def totals(hs: str, year: int, codes: list[int]) -> dict[int, float]:
    out: dict[int, float] = {}
    for i in range(0, len(codes), 90):
        for r in query(hs, year, codes[i:i + 90], partner=0):
            out[r["reporterCode"]] = out.get(r["reporterCode"], 0) + (r["primaryValue"] or 0)
    return out


def pick_year(codes: list[int]) -> tuple[int, dict[int, float]]:
    """Latest year where nearly as many countries have reported wheat imports as the year before."""
    this = dt.date.today().year
    older = totals("1001", this - 2, codes)
    newer = totals("1001", this - 1, codes)
    print(f"  reporters: {this - 2}={len(older)}, {this - 1}={len(newer)}")
    return (this - 1, newer) if len(newer) >= 0.9 * len(older) else (this - 2, older)


def by_partner(hs: str, year: int, buyers: list[int]) -> dict[int, dict[int, float]]:
    """{buyer: {supplier: value}}, batching buyers and splitting a batch if it hits the row cap."""
    out: dict[int, dict[int, float]] = {}
    queue = [buyers[i:i + 4] for i in range(0, len(buyers), 4)]
    while queue:
        batch = queue.pop(0)
        rows = query(hs, year, batch)
        if len(rows) >= 100 and len(batch) > 1:  # may be truncated: retry one buyer at a time
            queue[:0] = [[b] for b in batch]
            continue
        for r in rows:
            if r["partnerCode"] == 0:
                continue
            d = out.setdefault(r["reporterCode"], {})
            d[r["partnerCode"]] = d.get(r["partnerCode"], 0) + (r["primaryValue"] or 0)
    return out


def save(year: int, commodities: list[dict], names_used: dict[str, str]) -> None:
    order = [c[0] for c in COMMODITIES]
    commodities = sorted(commodities, key=lambda c: order.index(c["id"]) if c["id"] in order else 99)
    OUT.write_text(json.dumps({
        "generated": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "year": year,
        "source": {"name": "UN Comtrade (imports as reported by buying countries)",
                   "url": "https://comtradeplus.un.org/"},
        "names": dict(sorted(names_used.items())) | {"-1": "Other"},
        "commodities": commodities,
    }, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")


def main() -> int:
    force = "--force" in sys.argv
    only = None
    if "--only" in sys.argv:
        only = set(sys.argv[sys.argv.index("--only") + 1].split(","))
        force = True
    prev = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    if not force:
        # Refresh only crops that are missing or older than STALE_DAYS, oldest first. With the
        # daily quota, a full refresh then spreads itself over a couple of daily runs.
        today = dt.date.today()
        fetched = {c["id"]: c.get("fetched", "2000-01-01") for c in prev.get("commodities", [])}
        age = {cid: (today - dt.date.fromisoformat(fetched.get(cid, "2000-01-01"))).days
               for cid, _, _ in COMMODITIES}
        only = {cid for cid, a in age.items() if a >= STALE_DAYS}
        if not only:
            print("trade.json: every crop is fresh; skipping (use --force to refresh all)")
            return 0
        print(f"trade.json: refreshing {sorted(only)}")

    print("Comtrade: reference tables")
    try:
        codes, name = names()
        year, wheat_totals = pick_year(codes)
    except Exception as e:  # noqa: BLE001 - usually the daily quota; try again tomorrow
        print(f"  FAILED before any crop: {e}. Keeping the previous trade.json.", file=sys.stderr)
        return 1
    print(f"  using {year}")

    # Start from the previous data for the same year, so finished crops survive a failed run.
    done = {c["id"]: c for c in prev.get("commodities", [])} if prev.get("year") == year else {}
    used = dict(prev.get("names", {})) if done else {}
    used.pop("-1", None)
    failed = []
    stale_first = sorted(COMMODITIES, key=lambda c: done.get(c[0], {}).get("fetched", ""))
    for cid, label, hs in stale_first:
        if only and cid not in only:
            continue
        print(f"Comtrade: {label} (HS {hs}), {year}")
        try:
            done[cid] = fetch_commodity(cid, label, hs, year, codes, name, wheat_totals, used)
        except Exception as e:  # noqa: BLE001 - keep previous data for this crop
            failed.append(cid)
            print(f"  FAILED {cid}: {e}", file=sys.stderr)
            if "Quota" in str(e) or "403" in str(e):
                print("  daily quota reached; stopping. Rerun later with --only "
                      + ",".join(c for c, _, _ in COMMODITIES if c not in done or c in failed),
                      file=sys.stderr)
                break
            continue
        save(year, list(done.values()), used)  # save after every crop
        print(f"  saved ({len(done)} crops in file)")
    print(f"done; failed: {failed or 'none'}")
    return 1 if failed else 0


def fetch_commodity(cid, label, hs, year, codes, name, wheat_totals, used) -> dict:
    tot = wheat_totals if hs == "1001" else totals(hs, year, codes)
    world = sum(tot.values())
    buyers = sorted(tot, key=tot.get, reverse=True)[:TOP_BUYERS]
    detail = by_partner(hs, year, buyers)
    importers, exporters = [], {}
    for b in buyers:
        sup = detail.get(b, {})
        total = sum(sup.values()) or tot[b]
        kept = sorted(((p, v) for p, v in sup.items()
                       if v >= MIN_SHARE * total and name.get(p, "Unspecified") != "Unspecified"),
                      key=lambda x: -x[1])
        other = total - sum(v for _, v in kept)
        for p, v in sup.items():
            exporters[p] = exporters.get(p, 0) + v
        for c in [b, *(p for p, _ in kept)]:
            used[str(c)] = name.get(c, str(c))
        importers.append({"c": b, "total": round(total),
                          "from": [[p, round(v)] for p, v in kept] + ([[-1, round(other)]] if other > 0 else [])})
    covered = sum(i["total"] for i in importers)
    ex = sorted(((p, v) for p, v in exporters.items() if name.get(p, "Unspecified") != "Unspecified"),
                key=lambda x: -x[1])[:15]
    for p, _ in ex:
        used[str(p)] = name.get(p, str(p))
    print(f"  {len(importers)} buyers, {covered / world:.0%} of world imports")
    return {"id": cid, "name": label, "hs": hs, "fetched": dt.date.today().isoformat(),
            "world": round(world), "covered": round(covered),
            "importers": importers, "exporters": [[p, round(v)] for p, v in ex]}


if __name__ == "__main__":
    sys.exit(main())
