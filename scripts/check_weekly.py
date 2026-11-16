"""Validate the Claude-written files: site/data/briefing.json and site/data/scenarios.json.

Run by the weekly routine before it pushes, and again by the GitHub Action before it publishes.
Exits 1 with a list of problems if either file is malformed. The page has its own checks too,
so a bad file only means the section stays on last week's version.

    python scripts/check_weekly.py
"""
import datetime as dt
import json
import pathlib
import re
import sys

DATA = pathlib.Path(__file__).resolve().parent.parent / "site" / "data"
TAGS = {"Energy", "Food", "Weather", "Metals", "Trade", "Farming", "Money"}
LIKELY = {"likely", "possible", "longshot"}
METRICS = {"last", "yoy", "ch3", "ch6", "fromPeak"}
OPS = {">=", "<="}
SLUG = re.compile(r"^[a-z0-9-]{2,30}$")


class Problems(list):
    def need(self, ok, msg):
        if not ok:
            self.append(msg)
        return ok


def text(p, v, where, lo, hi):
    return p.need(isinstance(v, str) and lo <= len(v.strip()) <= hi,
                  f"{where}: needs text of {lo}-{hi} characters")


def date(p, v, where):
    try:
        d = dt.date.fromisoformat(v)
    except (TypeError, ValueError):
        p.append(f"{where}: needs a YYYY-MM-DD date")
        return
    p.need(d <= dt.date.today() + dt.timedelta(days=1), f"{where}: date is in the future")


def check_briefing(b, p):
    if not p.need(isinstance(b, dict), "briefing: not an object"):
        return
    date(p, b.get("date"), "briefing.date")
    text(p, b.get("by"), "briefing.by", 2, 40)
    text(p, b.get("headline"), "briefing.headline", 10, 140)
    text(p, b.get("summary"), "briefing.summary", 40, 600)
    items = b.get("items")
    if p.need(isinstance(items, list) and 2 <= len(items) <= 5, "briefing.items: needs 2-5 items"):
        for i, it in enumerate(items):
            w = f"briefing.items[{i}]"
            if not p.need(isinstance(it, dict), f"{w}: not an object"):
                continue
            text(p, it.get("title"), w + ".title", 5, 100)
            text(p, it.get("text"), w + ".text", 40, 700)
            p.need(it.get("tag") in TAGS, f"{w}.tag: one of {sorted(TAGS)}")
            src = it.get("sources")
            if p.need(isinstance(src, list) and 1 <= len(src) <= 4, f"{w}.sources: needs 1-4 sources"):
                for j, s in enumerate(src):
                    sw = f"{w}.sources[{j}]"
                    if p.need(isinstance(s, dict), f"{sw}: not an object"):
                        text(p, s.get("name"), sw + ".name", 2, 60)
                        p.need(isinstance(s.get("url"), str) and s["url"].startswith("https://")
                               and len(s["url"]) <= 400, f"{sw}.url: needs an https:// link")
    watch = b.get("watch")
    if p.need(isinstance(watch, list) and 1 <= len(watch) <= 4, "briefing.watch: needs 1-4 items"):
        for i, w in enumerate(watch):
            text(p, w, f"briefing.watch[{i}]", 10, 200)


def check_cond(c, p, where, series):
    if not p.need(isinstance(c, dict), f"{where}: not an object"):
        return
    if "any" in c:
        if p.need(isinstance(c["any"], list) and 1 <= len(c["any"]) <= 4, f"{where}.any: needs 1-4 conditions"):
            for i, x in enumerate(c["any"]):
                p.need(isinstance(x, dict) and "any" not in x, f"{where}.any[{i}]: no nesting")
                check_cond(x, p, f"{where}.any[{i}]", series)
        return
    s, m = c.get("s"), c.get("m")
    p.need(s in series, f"{where}.s: unknown series {s!r}")
    p.need(m in METRICS, f"{where}.m: one of {sorted(METRICS)}")
    p.need(s != "oni" or m in {"last", "fromPeak"}, f"{where}: oni supports only last and fromPeak")
    p.need(c.get("op") in OPS, f"{where}.op: one of {sorted(OPS)}")
    p.need(isinstance(c.get("v"), (int, float)) and not isinstance(c.get("v"), bool), f"{where}.v: needs a number")


def check_scenarios(sc, p, series):
    if not p.need(isinstance(sc, dict), "scenarios: not an object"):
        return
    date(p, sc.get("updated"), "scenarios.updated")
    text(p, sc.get("by"), "scenarios.by", 2, 40)
    lst = sc.get("scenarios")
    if not p.need(isinstance(lst, list) and 3 <= len(lst) <= 8, "scenarios.scenarios: needs 3-8 chains"):
        return
    ids = set()
    for i, s in enumerate(lst):
        w = f"scenarios[{i}]"
        if not p.need(isinstance(s, dict), f"{w}: not an object"):
            continue
        p.need(isinstance(s.get("id"), str) and SLUG.match(s["id"]) and s["id"] not in ids, f"{w}.id: unique lowercase slug")
        ids.add(s.get("id"))
        text(p, s.get("title"), w + ".title", 5, 70)
        p.need(s.get("likelihood") in LIKELY, f"{w}.likelihood: one of {sorted(LIKELY)}")
        text(p, s.get("why"), w + ".why", 20, 400)
        text(p, s.get("horizon"), w + ".horizon", 3, 40)
        text(p, s.get("history"), w + ".history", 20, 400)
        for k in ("up", "down"):
            v = s.get(k, [])
            p.need(isinstance(v, list) and len(v) <= 6 and all(isinstance(x, str) and 2 <= len(x) <= 50 for x in v),
                   f"{w}.{k}: up to 6 short names")
        p.need(bool(s.get("up")) or bool(s.get("down")), f"{w}: needs something in up or down")
        steps = s.get("steps")
        if not p.need(isinstance(steps, list) and 2 <= len(steps) <= 6, f"{w}.steps: needs 2-6 steps"):
            continue
        for j, st in enumerate(steps):
            sw = f"{w}.steps[{j}]"
            if not p.need(isinstance(st, dict), f"{sw}: not an object"):
                continue
            text(p, st.get("text"), sw + ".text", 5, 110)
            text(p, st.get("lag"), sw + ".lag", 2, 40)
            if "check" in st:
                check_cond(st["check"], p, sw + ".check", series)
            else:
                text(p, st.get("watch"), sw + ".watch", 5, 160)
            p.need("link" not in st or st["link"] in {"trade", "outlook", "trendvalue"}, f"{sw}.link: a section id")
        p.need(any("check" in st for st in steps if isinstance(st, dict)), f"{w}: needs at least one step with a check")


def main():
    p = Problems()
    try:
        series = set(json.loads((DATA / "series.json").read_text(encoding="utf-8"))["series"]) | {"oni"}
    except (OSError, ValueError, KeyError):
        print("Can't read site/data/series.json; run scripts/fetch_data.py first.")
        return 1
    for name, fn in (("briefing.json", lambda d: check_briefing(d, p)),
                     ("scenarios.json", lambda d: check_scenarios(d, p, series))):
        path = DATA / name
        if not path.exists():
            p.append(f"{name}: missing")
            continue
        if path.stat().st_size > 40_000:
            p.append(f"{name}: over 40 KB")
            continue
        try:
            fn(json.loads(path.read_text(encoding="utf-8")))
        except ValueError as e:
            p.append(f"{name}: not valid JSON ({e})")
    if p:
        print("Problems:\n- " + "\n- ".join(p))
        return 1
    print("briefing.json and scenarios.json look good.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
