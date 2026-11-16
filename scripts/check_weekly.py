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
  backed by something that page actually says), and every quiet page exists.
- Every topic in the news sweep (TOPICS) is reported in "checked" by every new read from 2026-11-17
  on (whatever date it gives itself); a "covered" topic links one of the items' sources. The
  topic table in docs/weekly-routine.md lists the same ids.
- Odd JSON (a list where text belongs, say) is reported as a problem, never a crash.
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
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "site" / "data"
TAGS = {"Energy", "Food", "Weather", "Metals", "Trade", "Farming", "Money", "Politics"}
LIKELY = {"likely", "possible", "longshot"}
METRICS = {"last", "yoy", "ch3", "ch6", "fromPeak"}
OPS = {">=", "<="}
CALL_SERIES = {"fao_food", "brent"}
SLUG = re.compile(r"^[a-z0-9-]{2,30}$")
# The news sweep: every weekly read reports on each of these. What each one covers is the table in
# docs/weekly-routine.md, step 3 (one place, so the two can't drift).
TOPICS = ("oil", "gas-fertilizer", "enso", "southeast-asia", "south-asia", "black-sea", "americas",
          "australia", "china", "importers", "shipping", "reports", "metals", "money", "politics")
STATUSES = {"covered", "quiet", "unreached"}
CHECKLIST_FROM = dt.date(2026, 11, 17)  # reads dated before this were written without a checklist
FETCH_CAP = 5_000_000  # bytes read per page; a bigger page counts as "couldn't check"
FETCH_WORKERS = 8
MAX_FETCHES = 60  # 5 items x 4 sources + 15 topics is 35; anything past this isn't fetched
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


def one_of(v, allowed):
    """Membership that can't crash: a list or object from the JSON is simply not allowed."""
    return isinstance(v, str) and v in allowed


def https_url(v):
    return isinstance(v, str) and v.startswith("https://") and len(v) <= 400


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
NUM = r"\d[\d,]*(?:\.\d+)?"
# One pass, each span once: "$125"; "8%" / "8 percent" / "2 percentage points"; a range's low end
# too ("8-10%", "3 to 10 percent", but not a year: "through 2024 to 15%"); any other decimal.
NUMBER = re.compile(r"\$\s*(" + NUM + r")"
                    r"|(?<![\d.,])(?:(?!(?:19|20)\d\d\b)(" + NUM + r")\s*(?:-|\u2013|to)\s*\$?)?"
                    r"(" + NUM + r")[\s-]*" + UNIT +
                    r"|(\d+\.\d+)", re.I)
NOT_LABEL = r"since last week(?!end)"  # would repeat the page's label ("weekend" is fine)


def quoted_numbers(t):
    """Every data-looking number in the text, as floats, repeats included."""
    return [float(g.replace(",", "")) for m in NUMBER.finditer(t) for g in m.groups() if g]


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


def check_lookback(b, p, prev):
    """Required unless the published read is from the same day and had none (only the very first
    read). Fails closed: if the published read can't be found, a lookback is required."""
    same_day_first = (isinstance(prev, dict) and prev.get("date") == b.get("date")
                      and "lookback" not in prev)
    if "lookback" in b or not same_day_first:
        text(p, b.get("lookback"), "briefing.lookback (what happened since last week)", 40, 600)
    if isinstance(b.get("lookback"), str):
        p.need(not re.match(r"\s*" + NOT_LABEL, b["lookback"], re.I),
               "briefing.lookback: don't start with \"Since last week\"; the page adds that label")


def check_quoted(b, p, data):
    """Numbers in the summary and lookback, each against its own facts list."""
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


def check_briefing(b, p, data, prev, warn):
    if not p.need(isinstance(b, dict), "briefing: not an object"):
        return
    date(p, b.get("date"), "briefing.date")
    text(p, b.get("by"), "briefing.by", 2, 40)
    text(p, b.get("headline"), "briefing.headline", 10, 140)
    text(p, b.get("summary"), "briefing.summary", 40, 600)
    check_lookback(b, p, prev)
    check_quoted(b, p, data)
    check_checklist(b, p, prev, warn)
    items = b.get("items")
    if p.need(isinstance(items, list) and 2 <= len(items) <= 5, "briefing.items: needs 2-5 items"):
        for i, it in enumerate(items):
            w = f"briefing.items[{i}]"
            if not p.need(isinstance(it, dict), f"{w}: not an object"):
                continue
            text(p, it.get("title"), w + ".title", 5, 100)
            text(p, it.get("text"), w + ".text", 40, 700)
            p.need(one_of(it.get("tag"), TAGS), f"{w}.tag: one of {sorted(TAGS)}")
            src = it.get("sources")
            if p.need(isinstance(src, list) and 1 <= len(src) <= 4, f"{w}.sources: needs 1-4 sources"):
                for j, s in enumerate(src):
                    sw = f"{w}.sources[{j}]"
                    if p.need(isinstance(s, dict), f"{sw}: not an object"):
                        text(p, s.get("name"), sw + ".name", 2, 60)
                        p.need(https_url(s.get("url")), f"{sw}.url: needs an https:// link")
                        text(p, s.get("quote"), sw + ".quote (exact words on that page that back the claim)", 15, 300)
            facts = it.get("facts")
            if p.need(isinstance(facts, list) and len(facts) <= 12,
                      f"{w}.facts: needs a list (can be empty) of the numbers taken from site/data"):
                for j, f in enumerate(facts):
                    check_fact(f, p, f"{w}.facts[{j}]", data)
    watch = b.get("watch")
    if p.need(isinstance(watch, list) and 1 <= len(watch) <= 4, "briefing.watch: needs 1-4 items"):
        for i, w in enumerate(watch):
            text(p, w, f"briefing.watch[{i}]", 10, 200)


def dicts(v):
    """(index, object) for the objects in a JSON list, indices as in the file; nothing if not a list."""
    return [(i, x) for i, x in enumerate(v) if isinstance(x, dict)] if isinstance(v, list) else []


def item_sources(b):
    """(where, url, quote) for every item source with a usable https:// url."""
    return [(f"items[{i}].sources[{j}]", s["url"], s.get("quote"))
            for i, it in dicts(b.get("items")) for j, s in dicts(it.get("sources")) if https_url(s.get("url"))]


def checklist_required(b, prev):
    """A read dated CHECKLIST_FROM or later; any new read (its date differs from the published one)
    once today is that late, so a backdated date can't dodge it; and always once the published read
    has one. A fix to the published read keeps its date and isn't held to it. Fails closed: a
    missing or bad date requires it."""
    if isinstance(prev, dict) and "checked" in prev:
        return True
    prev_date = prev.get("date") if isinstance(prev, dict) else None
    if b.get("date") != prev_date and dt.date.today() >= CHECKLIST_FROM:
        return True
    try:
        return dt.date.fromisoformat(b.get("date")) >= CHECKLIST_FROM
    except (TypeError, ValueError):
        return True


def check_checked_entry(c, w, p, seen, item_urls):
    t, st, url = c.get("topic"), c.get("status"), c.get("url")
    p.need(one_of(t, TOPICS) and t not in seen, f"{w}.topic: one of {list(TOPICS)}, once each")
    if one_of(t, TOPICS):
        seen.add(t)
    p.need(one_of(st, STATUSES), f"{w}.status: one of {sorted(STATUSES)}")
    text(p, c.get("note"), w + ".note (what you found, or why you couldn't)", 10, 200)
    p.need(st == "unreached" or https_url(url), f"{w}.url: the https:// page you opened (only 'unreached' can skip it)")
    p.need(st != "covered" or (isinstance(url, str) and url in item_urls),
           f"{w}.url: a 'covered' topic is in an item, so link one of that item's sources")


def check_checklist(b, p, prev, warn):
    """Every topic in TOPICS once: covered (in an item, linking one of its sources), quiet (looked,
    nothing new) or unreached (no page could be opened). Covered and quiet need the page opened."""
    lst = b.get("checked")
    if lst is None and not checklist_required(b, prev):
        return
    if not p.need(isinstance(lst, list), f"briefing.checked: needs a list, one entry per topic: {', '.join(TOPICS)}"):
        return
    p.need(len(lst) <= len(TOPICS), f"briefing.checked: {len(lst)} entries, but there are {len(TOPICS)} topics")
    seen, item_urls = set(), {url for _, url, _ in item_sources(b)}
    for i, c in enumerate(lst[:2 * len(TOPICS)]):
        if p.need(isinstance(c, dict), f"briefing.checked[{i}]: not an object"):
            check_checked_entry(c, f"briefing.checked[{i}]", p, seen, item_urls)
    missing = [t for t in TOPICS if t not in seen]
    p.need(not missing, f"briefing.checked: topics not reported: {', '.join(missing)}")
    unreached = sum(1 for _, c in dicts(lst) if c.get("status") == "unreached")
    if unreached * 3 > len(TOPICS):
        warn.append(f"checked: {unreached} of {len(TOPICS)} topics unreached; the read's view is narrow")
    quiet = [c["url"] for _, c in dicts(lst) if c.get("status") == "quiet" and https_url(c.get("url"))]
    if len(set(quiet)) < len(quiet):
        warn.append("checked: some quiet topics share one page; each should link the page that showed it was quiet")
    if any(re.fullmatch(r"https://[^/]+/?", u) for u in quiet):
        warn.append("checked: a quiet topic links a bare homepage; link the page that showed it was quiet")


def check_fact(f, p, where, data):
    """{"s": series, "m": metric, "v": the number as written, "month": "YYYY-MM" (optional; default latest)}"""
    shaped = isinstance(f, dict) and one_of(f.get("m"), METRICS) and isinstance(f.get("v"), (int, float))
    if not p.need(shaped, f"{where}: needs s, m and a number v"):
        return
    if not p.need(one_of(f.get("s"), data.series) or f.get("s") == "oni", f"{where}.s: unknown series {f.get('s')!r}"):
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


def norm(s):
    s = (s.replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
          .replace("\u00a0", " "))
    s = re.sub(r"[\u200b-\u206f]", "", s)
    return re.sub(r"\s+", " ", s).strip().lower()


def fetch_text(url):
    """(visible text normalized, None, False) or (None, why, gone). `gone` means the page doesn't
    exist (HTTP 404 or 410); anything else (blocked, timeout, too big) is just "couldn't check"."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=25) as r:
            raw = r.read(FETCH_CAP + 1)
            if len(raw) > FETCH_CAP:
                return None, f"page over {FETCH_CAP:,} bytes", False
            t = raw.decode(r.headers.get_content_charset() or "utf-8", "ignore")
    except urllib.error.HTTPError as e:
        return None, str(e), e.code in (404, 410)
    except Exception as e:  # noqa: BLE001 - any other failure (an unknown charset too) means "couldn't check"
        return None, str(e), False
    t = re.sub(r"(?s)<(script|style)[^>]*>.*?</\1>", " ", t)
    return norm(html.unescape(re.sub(r"<[^>]+>", " ", t))), None, False


def fetch_all(urls):
    """{url: fetch_text(url)}, a few at a time, at most MAX_FETCHES distinct pages."""
    urls = list(dict.fromkeys(urls))[:MAX_FETCHES]
    with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as ex:
        return dict(zip(urls, ex.map(fetch_text, urls), strict=True))


def check_sources(b, p, warn):
    """Each item source's quote is on its page, and each quiet page exists (a covered page is one of
    the item sources, checked with its quote). A quiet page that's gone (404/410) fails: it's the
    only proof the topic was looked at. Anything else that can't be reached (blocked, timeout, too
    big, or an item source some site 404s to bots) warns."""
    srcs = [(where, url, quote, False) for where, url, quote in item_sources(b)]
    quiet = [(f"checked[{i}]", c["url"], None, True) for i, c in dicts(b.get("checked"))
             if c.get("status") == "quiet" and https_url(c.get("url"))]
    pages = fetch_all([u for _, u, _, _ in srcs + quiet])
    for where, url, quote, must_exist in srcs + quiet:
        page, why, gone = pages.get(url, (None, "not fetched: too many links", False))
        if must_exist and not p.need(not gone, f"{where}: {url} doesn't exist ({why}); link the page you opened"):
            continue
        if page is None:
            warn.append(f"{where}: couldn't fetch {url} ({why}); not checked")
        elif isinstance(quote, str):  # a quoted sentence may end mid-sentence on the page
            p.need(norm(quote).rstrip(".,;:") in page, f"{where}: quote not found on {url}: {quote[:80]!r}")


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
    p.need(one_of(s, data.series) or s == "oni", f"{where}.s: unknown series {s!r}")
    p.need(one_of(m, METRICS), f"{where}.m: one of {sorted(METRICS)}")
    p.need(s != "oni" or one_of(m, {"last", "fromPeak"}), f"{where}: oni supports only last and fromPeak")
    p.need(one_of(c.get("op"), OPS), f"{where}.op: one of {sorted(OPS)}")
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
        p.need(isinstance(s.get("id"), str) and bool(SLUG.match(s["id"])) and s["id"] not in ids,
               f"{w}.id: unique lowercase slug")
        if isinstance(s.get("id"), str):
            ids.add(s["id"])
        text(p, s.get("title"), w + ".title", 5, 70)
        p.need(one_of(s.get("likelihood"), LIKELY), f"{w}.likelihood: one of {sorted(LIKELY)}")
        text(p, s.get("why"), w + ".why", 20, 400)
        text(p, s.get("horizon"), w + ".horizon", 3, 40)
        text(p, s.get("history"), w + ".history", 20, 400)
        p.need(isinstance(s.get("cases"), int) and 1 <= s["cases"] <= 500,
               f"{w}.cases: how many past cases the history rests on (a whole number)")
        for k in ("up", "down"):
            v = s.get(k, [])
            names_ok = isinstance(v, list) and len(v) <= 6 and all(isinstance(x, str) and 2 <= len(x) <= 50 for x in v)
            p.need(names_ok, f"{w}.{k}: up to 6 short names")
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
            p.need("link" not in st or one_of(st["link"], {"trade", "outlook", "trendvalue"}),
                   f"{sw}.link: a section id")
        o = s.get("outcome")
        p.need(isinstance(o, int) and 0 <= o < len(steps) and isinstance(steps[o], dict) and "check" in steps[o],
               f"{w}.outcome: index of the step (with a check) that decides whether the chain happened")
        dl = s.get("deadline")
        if p.need(isinstance(dl, str) and bool(YM.match(dl)), f"{w}.deadline: YYYY-MM") and updated:
            p.need(ym(dl) > month_of(updated), f"{w}.deadline: must be after the update date")


# ---- claude-log.json ----
def check_calls(calls, p):
    seen = set()
    for i, c in enumerate(calls):
        w = f"claude-log.calls[{i}]"
        if not p.need(isinstance(c, dict), f"{w}: not an object"):
            continue
        p.need(one_of(c.get("s"), CALL_SERIES), f"{w}.s: one of {sorted(CALL_SERIES)}")
        p.need(one_of(c.get("call"), {"up", "down"}), f"{w}.call: up or down")
        made = date(p, c.get("made"), w + ".made")
        if p.need(isinstance(c.get("target"), str) and bool(YM.match(c["target"])), f"{w}.target: YYYY-MM") and made:
            p.need(ym(c["target"]) > month_of(made), f"{w}.target: must be a month that hasn't started yet")
        text(p, c.get("why"), w + ".why", 10, 200)
        key = (c.get("s"), c.get("target"))
        if all(isinstance(k, str) for k in key):  # a bad s or target is reported above
            p.need(key not in seen, f"{w}: a call for {key} already exists")
            seen.add(key)


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
    check_calls(calls, p)
    latest = {}
    for i, x in enumerate(likes):
        w = f"claude-log.likelihoods[{i}]"
        if not p.need(isinstance(x, dict), f"{w}: not an object"):
            continue
        p.need(isinstance(x.get("id"), str) and bool(SLUG.match(x["id"])), f"{w}.id: scenario id")
        p.need(one_of(x.get("likelihood"), LIKELY), f"{w}.likelihood: one of {sorted(LIKELY)}")
        text(p, x.get("claim"), w + ".claim", 5, 110)
        made = date(p, x.get("made"), w + ".made")
        before = len(p)
        check_cond(x.get("check"), p, w + ".check", data)
        deadline_ok = isinstance(x.get("deadline"), str) and bool(YM.match(x["deadline"]))
        if p.need(deadline_ok, f"{w}.deadline: YYYY-MM") and made:
            p.need(ym(x["deadline"]) > month_of(made), f"{w}.deadline: must be after the month it was made")
        if i >= n_old and len(p) == before:
            p.need(not data.passes(x["check"]),
                   f"{w}: its check already passes in today's data, so it isn't a prediction")
        if isinstance(x.get("id"), str):
            latest[x["id"]] = x
    for s in scenarios or []:
        if isinstance(s, dict):
            x = latest.get(s.get("id")) if isinstance(s.get("id"), str) else None
            p.need(x is not None and x.get("likelihood") == s.get("likelihood"),
                   f"scenario {s.get('id')!r}: its likelihood ({s.get('likelihood')}) needs a matching entry "
                   "at the end of claude-log.likelihoods")


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


def guarded(p, name, check, *args):
    """Run one file's checks. Odd JSON that gets past the shape checks (a list used as a key, say)
    becomes a listed problem instead of a traceback. Fails closed: the read is rejected."""
    try:
        check(*args)
    except (TypeError, AttributeError, KeyError, IndexError, ValueError) as e:
        p.append(f"{name}: checks stopped at an unexpected value ({type(e).__name__}: {e}); look for a list or "
                 "object where text or a number belongs, here or in site/data")


def check_topic_table(p):
    """The routine follows the table in docs/weekly-routine.md; its ids must be TOPICS, in order."""
    try:
        doc = (ROOT / "docs" / "weekly-routine.md").read_text(encoding="utf-8")
    except OSError:
        p.append("docs/weekly-routine.md: missing (it holds the topic table)")
        return
    ids = tuple(re.findall(r"^\s*\| `([a-z-]+)` \|", doc, re.M))
    p.need(ids == TOPICS, f"docs/weekly-routine.md: topic table {list(ids)} doesn't match TOPICS {list(TOPICS)}")


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
    check_topic_table(p)
    b = docs.get("briefing.json")
    if "briefing.json" in docs:
        guarded(p, "briefing.json", check_briefing, b, p, data, git_base("site/data/briefing.json"), warn)
    if sources and isinstance(b, dict):
        guarded(p, "briefing.json sources", check_sources, b, p, warn)
    if "scenarios.json" in docs:
        guarded(p, "scenarios.json", check_scenarios, docs["scenarios.json"], p, data)
    if "claude-log.json" in docs:
        sc = docs["scenarios.json"].get("scenarios") if isinstance(docs.get("scenarios.json"), dict) else None
        guarded(p, "claude-log.json", check_log, docs["claude-log.json"], p, data, sc,
                git_base("site/data/claude-log.json"))
    for w in warn:
        print("Warning: " + w)
    if p:
        print("Problems:\n- " + "\n- ".join(p))
        return 1
    print("briefing.json, scenarios.json and claude-log.json look good" + (" (sources checked)." if sources else "."))
    return 0


if __name__ == "__main__":
    sys.exit(main())
