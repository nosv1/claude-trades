"""Check the Claude-written files before they go on the site:
site/data/briefing.json, site/data/scenarios.json and site/data/claude-log.json.

    python scripts/check_weekly.py              # shape, numbers vs the data, append-only log
    python scripts/check_weekly.py --sources    # also fetch every source and find its quote

Run by the weekly routine (with --sources) before it pushes, and by the GitHub Action (without:
news sites block some cloud runners) before it publishes. Exits 1 with a list of problems.

What it checks, beyond shape:
- Every number in a briefing item's "facts" matches site/data (so quoted prices are real), and the
  summary and lookback need one entry in summary_facts / lookback_facts per number they quote.
- A lookback (what happened since last week) is required unless this is the very first read.
- With --sources, every source's "quote" appears on the page it links to (so news claims are
  backed by something that page actually says).
- claude-log.json only grows: old entries can't be edited or removed, so misses stay visible.
- Each scenario's likelihood matches its latest log entry (changes have to be logged).
- A newly logged likelihood can't already be true in the data (no free wins).
"""
import datetime as dt
import html
import json
import pathlib
import re
import subprocess
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "site" / "data"
TAGS = {"Energy", "Food", "Weather", "Metals", "Trade", "Farming", "Money", "Politics"}
LIKELY = {"likely", "possible", "longshot"}
METRICS = {"last", "yoy", "ch3", "ch6", "fromPeak"}
OPS = {">=", "<="}
CALL_SERIES = {"fao_food", "brent"}
SLUG = re.compile(r"^[a-z0-9-]{2,30}$")
YM = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
SEASONS = ["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"]
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"


class Problems(list):
    def need(self, ok, msg):
        if not ok:
            self.append(msg)
        return ok


def text(p, v, where, lo, hi):
    return p.need(isinstance(v, str) and lo <= len(v.strip()) <= hi, f"{where}: needs text of {lo}-{hi} characters")


def date(p, v, where):
    try:
        d = dt.date.fromisoformat(v)
    except (TypeError, ValueError):
        p.append(f"{where}: needs a YYYY-MM-DD date")
        return None
    p.need(d <= dt.date.today() + dt.timedelta(days=1), f"{where}: date is in the future")
    return d


def ym(s):
    y, m = map(int, s.split("-"))
    return y * 12 + m - 1


def month_of(d):
    return d.year * 12 + d.month - 1


# ---- the data, with the same metric definitions as the page (site/scenarios.js) ----
class Data:
    def __init__(self, series, enso):
        self.series, self.enso = series, enso

    def pts(self, s):
        if s == "oni":
            return [(int(y) * 12 + (SEASONS.index(se) if se in SEASONS else 0), v)
                    for se, y, v in (self.enso or {}).get("oni", [])]
        d = self.series.get(s)
        if not d:
            return []
        m0 = ym(d["start"])
        return [(m0 + i, v) for i, v in enumerate(d["values"]) if v is not None]

    def metric(self, s, m, upto=None):
        p = [q for q in self.pts(s) if upto is None or q[0] <= upto]
        if not p:
            return None
        lm, lv = p[-1]
        if s == "oni":
            if m == "last":
                return lv
            if m == "fromPeak":
                return lv - max(v for _, v in p[-6:])
            return None
        at = dict(p)
        pct = lambda b: (lv / b - 1) * 100 if b else None  # noqa: E731
        if m == "last":
            return lv
        if m in ("yoy", "ch3", "ch6"):
            return pct(at.get(lm - {"yoy": 12, "ch3": 3, "ch6": 6}[m]))
        if m == "fromPeak":
            return pct(max(v for mm, v in p if mm >= lm - 6))
        return None

    def passes(self, c, upto=None):
        if not isinstance(c, dict):
            return False
        if "any" in c:
            return any(self.passes(x, upto) for x in c["any"])
        v = self.metric(c.get("s"), c.get("m"), upto)
        if v is None or not isinstance(c.get("v"), (int, float)):
            return False
        return v >= c["v"] if c.get("op") == ">=" else v <= c["v"]


# ---- briefing.json ----
# A number that probably came from the data: a percent, a dollar amount or a decimal.
UNIT = r"(?:%|percent(?:age[\s-]+points?)?\b|per\s+cent\b|dollars?\b|points?\b|pts\b)"
# The low end of a range: "8" in "8-10%" or "3 to 10 percent".
RANGE_LOW = re.compile(r"\$?(\d[\d,]*(?:\.\d+)?)\s*(?:-|\u2013|to)\s*\$?\d[\d,]*(?:\.\d+)?[\s-]*" + UNIT, re.I)
NUMBER = re.compile(r"\$\s*(\d[\d,]*(?:\.\d+)?)"
                    r"|(\d[\d,]*(?:\.\d+)?)[\s-]*" + UNIT +
                    r"|(\d+\.\d+)", re.I)
NOT_LABEL = r"since last week"  # any opening with it would repeat the page's label


def quoted_numbers(t):
    """Every data-looking number in the text, as floats, repeats included."""
    nums = [float(next(g for g in m.groups() if g).replace(",", "")) for m in NUMBER.finditer(t)]
    return nums + [float(m.group(1).replace(",", "")) for m in RANGE_LOW.finditer(t)]


def unmatched(nums, facts):
    """Numbers with no fact of the same size behind them (each fact backs one number; the sign is
    in the words, e.g. 'fell 8%' for v = -8). v is the number as written, so the match is tight:
    within 0.05, or 0.5% for big numbers. Biggest numbers first, each taking its closest fact."""
    left = [abs(f["v"]) for f in facts if isinstance(f, dict) and isinstance(f.get("v"), (int, float))]
    miss = []
    for n in sorted(nums, reverse=True):
        near = [(abs(v - n), i) for i, v in enumerate(left) if abs(v - n) <= max(0.05, 0.005 * n)]
        hit = min(near)[1] if near else None
        if hit is None:
            miss.append(n)
        else:
            left.pop(hit)
    return miss


def check_briefing(b, p, data, prev=None):
    if not p.need(isinstance(b, dict), "briefing: not an object"):
        return
    date(p, b.get("date"), "briefing.date")
    text(p, b.get("by"), "briefing.by", 2, 40)
    text(p, b.get("headline"), "briefing.headline", 10, 140)
    text(p, b.get("summary"), "briefing.summary", 40, 600)
    # Required unless the published read is from the same day and had none (only the very first
    # read). Fails closed: if the published read can't be found, a lookback is required.
    same_day_first = (isinstance(prev, dict) and prev.get("date") == b.get("date")
                      and "lookback" not in prev)
    if "lookback" in b or not same_day_first:
        text(p, b.get("lookback"), "briefing.lookback (what happened since last week)", 40, 600)
    # Numbers in the summary and lookback get checked too, each against its own list.
    for k in ("summary", "lookback"):
        fl = b.get(k + "_facts", [])
        if not p.need(isinstance(fl, list) and len(fl) <= 12, f"briefing.{k}_facts: needs a list"):
            continue
        for j, f in enumerate(fl):
            check_fact(f, p, f"briefing.{k}_facts[{j}]", data)
        t = b.get(k)
        miss = unmatched(quoted_numbers(t), fl) if isinstance(t, str) else []
        p.need(not miss, f"briefing.{k}: no {k}_facts entry backs {', '.join(f'{n:g}' for n in miss)}; "
               "add one fact per number (same value), or write news numbers in words")
    if isinstance(b.get("lookback"), str):
        p.need(not re.match(r"\s*" + NOT_LABEL, b["lookback"], re.I),
               "briefing.lookback: don't start with \"Since last week\"; the page adds that label")
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
                        p.need(isinstance(s.get("url"), str) and s["url"].startswith("https://") and len(s["url"]) <= 400,
                               f"{sw}.url: needs an https:// link")
                        text(p, s.get("quote"), sw + ".quote (exact words on that page that back the claim)", 15, 300)
            facts = it.get("facts")
            if p.need(isinstance(facts, list) and len(facts) <= 12, f"{w}.facts: needs a list (can be empty) of the numbers taken from site/data"):
                for j, f in enumerate(facts):
                    check_fact(f, p, f"{w}.facts[{j}]", data)
    watch = b.get("watch")
    if p.need(isinstance(watch, list) and 1 <= len(watch) <= 4, "briefing.watch: needs 1-4 items"):
        for i, w in enumerate(watch):
            text(p, w, f"briefing.watch[{i}]", 10, 200)


def check_fact(f, p, where, data):
    """{"s": series, "m": metric, "v": the number as written, "month": "YYYY-MM" (optional; default latest)}"""
    if not p.need(isinstance(f, dict) and f.get("m") in METRICS and isinstance(f.get("v"), (int, float)), f"{where}: needs s, m and a number v"):
        return
    if not p.need(f.get("s") in data.series or f.get("s") == "oni", f"{where}.s: unknown series {f.get('s')!r}"):
        return
    upto = None
    if "month" in f:
        if not p.need(isinstance(f["month"], str) and bool(YM.match(f["month"])), f"{where}.month: YYYY-MM"):
            return
        upto = ym(f["month"])
        if not p.need(any(m == upto for m, _ in data.pts(f["s"])), f"{where}: no {f['s']} number for {f['month']}"):
            return
    real = data.metric(f["s"], f["m"], upto)
    if not p.need(real is not None, f"{where}: can't compute {f['s']} {f['m']}"):
        return
    ok = abs(real - f["v"]) <= (max(0.01 * abs(real), 0.06) if f["m"] == "last" else 1.0)
    p.need(ok, f"{where}: says {f['s']} {f['m']} = {f['v']}, but the data says {real:.2f}")


def check_sources(b, p, warn):
    def norm(s):
        s = (s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
              .replace(" ", " "))
        s = re.sub(r"[​-⁯]", "", s)
        return re.sub(r"\s+", " ", s).strip().lower()
    cache = {}
    for i, it in enumerate(b.get("items") or []):
        for j, s in enumerate(it.get("sources") or []):
            url, quote = s.get("url"), s.get("quote")
            if not (isinstance(url, str) and isinstance(quote, str)):
                continue
            if url not in cache:
                try:
                    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=25) as r:
                        t = r.read().decode(r.headers.get_content_charset() or "utf-8", "ignore")
                    t = re.sub(r"(?s)<(script|style)[^>]*>.*?</\1>", " ", t)
                    cache[url] = norm(html.unescape(re.sub(r"<[^>]+>", " ", t)))
                except Exception as e:  # noqa: BLE001 - any fetch failure just means "couldn't check"
                    cache[url] = None
                    warn.append(f"items[{i}].sources[{j}]: couldn't fetch {url} ({e}); quote not checked")
            if cache[url] is not None:
                p.need(norm(quote) in cache[url], f"items[{i}].sources[{j}]: quote not found on {url}: {quote[:80]!r}")


# ---- scenarios.json ----
def check_cond(c, p, where, data):
    if not p.need(isinstance(c, dict), f"{where}: not an object"):
        return
    if "any" in c:
        if p.need(isinstance(c["any"], list) and 1 <= len(c["any"]) <= 4, f"{where}.any: needs 1-4 conditions"):
            for i, x in enumerate(c["any"]):
                p.need(isinstance(x, dict) and "any" not in x, f"{where}.any[{i}]: no nesting")
                check_cond(x, p, f"{where}.any[{i}]", data)
        return
    s, m = c.get("s"), c.get("m")
    p.need(s in data.series or s == "oni", f"{where}.s: unknown series {s!r}")
    p.need(m in METRICS, f"{where}.m: one of {sorted(METRICS)}")
    p.need(s != "oni" or m in {"last", "fromPeak"}, f"{where}: oni supports only last and fromPeak")
    p.need(c.get("op") in OPS, f"{where}.op: one of {sorted(OPS)}")
    p.need(isinstance(c.get("v"), (int, float)) and not isinstance(c.get("v"), bool), f"{where}.v: needs a number")


def check_scenarios(sc, p, data):
    if not p.need(isinstance(sc, dict), "scenarios: not an object"):
        return
    updated = date(p, sc.get("updated"), "scenarios.updated")
    text(p, sc.get("by"), "scenarios.by", 2, 40)
    lst = sc.get("scenarios")
    if not p.need(isinstance(lst, list) and 3 <= len(lst) <= 8, "scenarios.scenarios: needs 3-8 chains"):
        return
    ids = set()
    for i, s in enumerate(lst):
        w = f"scenarios[{i}]"
        if not p.need(isinstance(s, dict), f"{w}: not an object"):
            continue
        p.need(isinstance(s.get("id"), str) and bool(SLUG.match(s["id"])) and s["id"] not in ids, f"{w}.id: unique lowercase slug")
        ids.add(s.get("id"))
        text(p, s.get("title"), w + ".title", 5, 70)
        p.need(s.get("likelihood") in LIKELY, f"{w}.likelihood: one of {sorted(LIKELY)}")
        text(p, s.get("why"), w + ".why", 20, 400)
        text(p, s.get("horizon"), w + ".horizon", 3, 40)
        text(p, s.get("history"), w + ".history", 20, 400)
        p.need(isinstance(s.get("cases"), int) and 1 <= s["cases"] <= 500,
               f"{w}.cases: how many past cases the history rests on (a whole number)")
        for k in ("up", "down"):
            v = s.get(k, [])
            p.need(isinstance(v, list) and len(v) <= 6 and all(isinstance(x, str) and 2 <= len(x) <= 50 for x in v), f"{w}.{k}: up to 6 short names")
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
                check_cond(st["check"], p, sw + ".check", data)
            else:
                text(p, st.get("watch"), sw + ".watch", 5, 160)
            p.need("link" not in st or st["link"] in {"trade", "outlook", "trendvalue"}, f"{sw}.link: a section id")
        o = s.get("outcome")
        p.need(isinstance(o, int) and 0 <= o < len(steps) and isinstance(steps[o], dict) and "check" in steps[o],
               f"{w}.outcome: index of the step (with a check) that decides whether the chain happened")
        dl = s.get("deadline")
        if p.need(isinstance(dl, str) and bool(YM.match(dl)), f"{w}.deadline: YYYY-MM") and updated:
            p.need(ym(dl) > month_of(updated), f"{w}.deadline: must be after the update date")


# ---- claude-log.json ----
def check_log(L, p, data, scenarios, base):
    if not p.need(isinstance(L, dict), "claude-log: not an object"):
        return
    calls, likes = L.get("calls"), L.get("likelihoods")
    if not p.need(isinstance(calls, list) and isinstance(likes, list), "claude-log: needs calls and likelihoods lists"):
        return
    # append-only against the version already published; fail closed if we can't find it
    if p.need(isinstance(base, dict), "claude-log: can't read the published claude-log.json "
              "(needs git with origin/main or main; HEAD only off claude/ branches), so can't check that "
              "old entries are unchanged"):
        for k in ("calls", "likelihoods"):
            old = base.get(k) or []
            p.need(len(L[k]) >= len(old) and L[k][:len(old)] == old,
                   f"claude-log.{k}: old entries were changed or removed; only add new ones at the end")
    n_old = len((base or {}).get("likelihoods") or []) if isinstance(base, dict) else 0
    seen = set()
    for i, c in enumerate(calls):
        w = f"claude-log.calls[{i}]"
        if not p.need(isinstance(c, dict), f"{w}: not an object"):
            continue
        p.need(c.get("s") in CALL_SERIES, f"{w}.s: one of {sorted(CALL_SERIES)}")
        p.need(c.get("call") in {"up", "down"}, f"{w}.call: up or down")
        made = date(p, c.get("made"), w + ".made")
        if p.need(isinstance(c.get("target"), str) and bool(YM.match(c["target"])), f"{w}.target: YYYY-MM") and made:
            p.need(ym(c["target"]) > month_of(made), f"{w}.target: must be a month that hasn't started yet")
        text(p, c.get("why"), w + ".why", 10, 200)
        key = (c.get("s"), c.get("target"))
        p.need(key not in seen, f"{w}: a call for {key} already exists")
        seen.add(key)
    latest = {}
    for i, x in enumerate(likes):
        w = f"claude-log.likelihoods[{i}]"
        if not p.need(isinstance(x, dict), f"{w}: not an object"):
            continue
        p.need(isinstance(x.get("id"), str) and bool(SLUG.match(x["id"])), f"{w}.id: scenario id")
        p.need(x.get("likelihood") in LIKELY, f"{w}.likelihood: one of {sorted(LIKELY)}")
        text(p, x.get("claim"), w + ".claim", 5, 110)
        made = date(p, x.get("made"), w + ".made")
        before = len(p)
        check_cond(x.get("check"), p, w + ".check", data)
        if p.need(isinstance(x.get("deadline"), str) and bool(YM.match(x["deadline"])), f"{w}.deadline: YYYY-MM") and made:
            p.need(ym(x["deadline"]) > month_of(made), f"{w}.deadline: must be after the month it was made")
        if i >= n_old and len(p) == before:
            p.need(not data.passes(x["check"]), f"{w}: its check already passes in today's data, so it isn't a prediction")
        latest[x.get("id")] = x
    for s in scenarios or []:
        if isinstance(s, dict):
            x = latest.get(s.get("id"))
            p.need(x is not None and x.get("likelihood") == s.get("likelihood"),
                   f"scenario {s.get('id')!r}: its likelihood ({s.get('likelihood')}) needs a matching entry at the end of claude-log.likelihoods")


def git_base(rel):
    """The published version of a file: origin/main, else main, else HEAD (but not on a claude/
    branch, where HEAD may be the routine's own commit); None if none of them has it."""
    refs = ["origin/main", "main"]
    try:
        branch = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=ROOT,
                                capture_output=True, text=True, timeout=20).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        branch = ""
    if branch and not branch.startswith("claude/"):
        refs.append("HEAD")  # on a weekly branch, HEAD may be our own commit: never compare with it
    for ref in refs:
        try:
            out = subprocess.run(["git", "show", f"{ref}:{rel}"], cwd=ROOT, capture_output=True,
                                 text=True, encoding="utf-8", timeout=20)
            if out.returncode == 0:
                return json.loads(out.stdout)
        except (OSError, ValueError, subprocess.SubprocessError):
            continue
    return None


def main():
    sources = "--sources" in sys.argv
    p, warn = Problems(), []
    try:
        series = json.loads((DATA / "series.json").read_text(encoding="utf-8"))["series"]
    except (OSError, ValueError, KeyError):
        print("Can't read site/data/series.json; run scripts/fetch_data.py first.")
        return 1
    try:
        enso = json.loads((DATA / "enso.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        enso = None
    data = Data(series, enso)
    docs = {}
    for name in ("briefing.json", "scenarios.json", "claude-log.json"):
        path = DATA / name
        if not path.exists():
            p.append(f"{name}: missing")
            continue
        if path.stat().st_size > 60_000:
            p.append(f"{name}: over 60 KB")
            continue
        try:
            docs[name] = json.loads(path.read_text(encoding="utf-8"))
        except ValueError as e:
            p.append(f"{name}: not valid JSON ({e})")
    if "briefing.json" in docs:
        check_briefing(docs["briefing.json"], p, data, git_base("site/data/briefing.json"))
        if sources:
            check_sources(docs["briefing.json"], p, warn)
    if "scenarios.json" in docs:
        check_scenarios(docs["scenarios.json"], p, data)
    if "claude-log.json" in docs:
        sc = docs["scenarios.json"].get("scenarios") if isinstance(docs.get("scenarios.json"), dict) else None
        check_log(docs["claude-log.json"], p, data, sc, git_base("site/data/claude-log.json"))
    for w in warn:
        print("Warning: " + w)
    if p:
        print("Problems:\n- " + "\n- ".join(p))
        return 1
    print("briefing.json, scenarios.json and claude-log.json look good" + (" (sources checked)." if sources else "."))
    return 0


if __name__ == "__main__":
    sys.exit(main())
