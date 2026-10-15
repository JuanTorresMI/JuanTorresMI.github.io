#!/usr/bin/env python3
"""Copies the Worker's live data into the site, so pages that fill themselves in by script
also have real content in their HTML: for search engines, AI crawlers and readers with
JavaScript off. The script on each page still fetches fresh numbers for everyone else.

    python3 scripts/snapshot.py

Writes _data/live/youtube.json, watching.json and reefer.json (plus a stub page for each reefer
lane in _reefer_lanes/), already formatted the way the pages show them (Liquid on GitHub Pages can't put commas in numbers or say "Oct 14"), so the
templates only loop. A source that fails or answers with an error is skipped and its last
good file stays. The `Snapshot live pages` workflow runs this once a day and commits the result.
Needs only the standard library.
"""
import json, os, re, sys, urllib.request
from urllib.parse import quote
from datetime import datetime, timedelta, timezone
from itertools import groupby

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "_data", "live")

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("America/Detroit")        # dates read as they would at home
except Exception:
    TZ = timezone.utc


def worker_url():
    if os.environ.get("WORKER_URL"): return os.environ["WORKER_URL"].rstrip("/")     # for testing against a local copy
    for line in open(os.path.join(ROOT, "_config.yml"), encoding="utf-8"):
        if line.startswith("worker_url:"):
            return line.split(":", 1)[1].strip().strip('"').strip("'").rstrip("/")
    return ""


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "site-snapshot (github.com/JuanTorresMI)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.load(r)
    if not isinstance(d, dict) or d.get("error"):
        raise RuntimeError(d.get("error") if isinstance(d, dict) else "not an object")
    return d


def when(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(TZ)

fmt = lambda n: f"{n:,}"
signed = lambda n: ("+" if n > 0 else "−" if n < 0 else "") + fmt(abs(n))
plural = lambda n, one, many: fmt(n) + " " + (one if n == 1 else many)
delta = lambda n, one, many: signed(n) + " " + (one if abs(n) == 1 else many)
day_label = lambda d: f"{d:%a}, {d:%b} {d.day}"                          # Wed, Oct 14
full_date = lambda d: f"{d:%b} {d.day}, {d.year}"                        # Oct 14, 2026
hour_label = lambda d: f"{d:%b} {d.day}, {d.hour % 12 or 12} {'AM' if d.hour < 12 else 'PM'}"


def length(s):
    if s is None: return ""
    if s >= 3600: return f"{s // 3600}:{s // 60 % 60:02d}:{s % 60:02d}"
    return f"{s // 60}:{s % 60:02d}"


def youtube(d):
    s, h = d.get("stats") or {}, d.get("history") or []
    now = when(d["updated"])

    def change(field, n):                   # same rule as the page: no "last 7 days" from 2 days
        rows = [r for r in h if r.get(field) is not None]
        return None if len(rows) < n + 1 else rows[-1][field] - rows[-1 - n][field]

    week = change("views", 7)
    tiles = [
        {"n": "Hidden" if s.get("subscribers") is None else fmt(s["subscribers"]), "l": "subscribers"},
        {"n": "—" if s.get("views") is None else fmt(s["views"]), "l": "views, all time"},
        {"n": "—" if s.get("videos") is None else fmt(s["videos"]), "l": "videos"},
    ] + ([] if week is None else [{"n": signed(week), "l": "views, last 7 days"}])

    recent = []
    for v in d.get("recent") or []:
        meta = [None if v.get("views") is None else plural(v["views"], "view", "views"), length(v.get("seconds"))]
        recent.append({"date": hour_label(when(v["published"])), "kind": "Short" if v.get("short") else "Video",
                       "title": v.get("title", ""), "url": v.get("url", ""), "meta": " · ".join(m for m in meta if m)})
    this_week = sum(1 for v in d.get("recent") or [] if now - when(v["published"]) < timedelta(days=7))

    days = []
    for a, b in list(zip(h[1:], h[:-1]))[::-1][:14]:
        parts = []
        if a.get("views") is not None and b.get("views") is not None: parts.append(delta(a["views"] - b["views"], "view", "views"))
        if a.get("subscribers") is not None and b.get("subscribers") is not None: parts.append(delta(a["subscribers"] - b["subscribers"], "subscriber", "subscribers"))
        if a.get("videos") is not None and b.get("videos") is not None and a["videos"] != b["videos"]: parts.append(delta(a["videos"] - b["videos"], "video", "videos"))
        days.append({"day": day_label(datetime.fromisoformat(a["day"])), "text": " · ".join(parts) or "No change"})

    # The gamer layout's pieces: the newest full game, the newest Shorts, and the matchups named
    # in recent titles ("Kalista vs Corki"), each a search of the channel.
    vids = d.get("recent") or []
    channel_url = (d.get("channel") or {}).get("url")
    full = next((v for v in vids if not v.get("short")), None)
    featured = None if not full else {"title": full.get("title", ""), "url": full.get("url", ""), "thumb": full.get("thumb"),
                                      "length": length(full.get("seconds")), "date": f"{when(full['published']):%b} {when(full['published']).day}"}
    shorts = [{"title": v.get("title", ""), "url": v.get("url", ""), "thumb": v.get("thumb"),
               "views": "" if v.get("views") is None else fmt(v["views"])} for v in vids if v.get("short")][:3]
    matchups = []
    for v in vids:
        m = re.search(r"([A-Z][\w'’]*) vs ([^|:(…]+)", v.get("title", ""))
        if not m or m.group(1).lower() in ("kill", "double", "triple", "quadra", "penta"): continue
        rest = re.sub(r"\s+(ADC|Mid|Top|Jungle|Support|clip)\s*$", "", m.group(2).strip().rstrip(","), flags=re.I)
        label = f"{m.group(1)} vs {rest}"
        if label not in [x["label"] for x in matchups] and channel_url:
            matchups.append({"label": label, "url": f"{channel_url}/search?query={quote(label)}"})
    hud = [{"n": "—" if s.get("views") is None else fmt(s["views"]), "l": "views, all time"},
           {"n": "—" if s.get("videos") is None else fmt(s["videos"]), "l": "videos"},
           {"n": "Hidden" if s.get("subscribers") is None else fmt(s["subscribers"]), "l": "subscribers"},
           {"n": fmt(this_week), "l": "uploads this week", "hot": True}]

    return {"generated": d["updated"], "checked": full_date(now), "channel_url": channel_url,
            "tiles": tiles, "hud": hud, "featured": featured, "shorts": shorts, "matchups": matchups[:8],
            "recent": recent, "recent_count": plural(this_week, "upload", "uploads") + " this week", "days": days}


def runtime(m):
    return f"{m / 1440:.1f} days" if m >= 1440 else f"{round(m / 60)} h"


def watching(d):
    now = when(d["updated"]) if d.get("updated") else datetime.now(TZ)
    it = d.get("now") or d.get("last")
    last = None
    if it:                                   # a day-old copy is never "playing now"
        meta = [None if it.get("pct") is None else f"{round(it['pct'])}% through",
                None if it.get("leftMin") is None else f"{it['leftMin']} min left",
                f"stopped {full_date(when(it['watchedAt']))}" if it.get("watchedAt") else None]
        last = {"title": it.get("title", ""), "sub": it.get("sub") or "", "poster": it.get("poster"), "link": it.get("link"),
                "initials": str(it.get("title") or "?").strip()[:2].upper(), "meta": " · ".join(m for m in meta if m)}

    t = d.get("tally") or {}
    tiles = [{"n": runtime(v) if time else f"{v:,}", "l": label}
             for k, label, time in (("shows", "shows", 0), ("films", "films", 0), ("titles", "in the library", 0), ("minutes", "of runtime", 1))
             for v in [t.get(k)] if v]

    lately = d.get("lately") or []
    week = sum(1 for i in lately if now - when(i["watchedAt"]) < timedelta(days=7))
    days = [{"day": day, "items": [{"kind": "TV" if i.get("type") == "series" else "Film", "title": i.get("title", ""), "link": i.get("link"),
                                     "meta": i.get("sub") or ""} for i in items]}
            for day, items in groupby(lately, key=lambda i: day_label(when(i["watchedAt"])))]

    deck = [{"title": x.get("title", ""), "poster": x.get("poster"), "initials": str(x.get("title") or "?").strip()[:2].upper(),
             "link": f"https://www.imdb.com/title/{x['id'].split(':')[0]}/" if str(x.get("id", "")).startswith("tt") else None}
            for x in d.get("deck") or []]

    return {"generated": d.get("updated") or now.isoformat(), "checked": full_date(now), "last": last, "tiles": tiles,
            "count": f"{week} title{'' if week == 1 else 's'} this week", "days": days, "deck": deck}


# ------------------------------------------------------------------ the reefer rate board ----
# /reefer-rates/ and one page per lane (/reefer-rates/<origin>-to-<city>/). Unlike the other two,
# this page has no script of its own: the data changes once a week, so the daily copy *is* the
# page. Lane pages are a Jekyll collection (_reefer_lanes/); this writes a stub for every lane
# with enough history and never deletes one, so a lane out of season keeps its address.

LANES_DIR = os.path.join(ROOT, "_reefer_lanes")
LANE_MIN_WEEKS = 4                          # fewer quotes than this makes too thin a page
CITY_CODES = {"Atlanta": "ATL", "Baltimore": "BAL", "Boston": "BOS", "Chicago": "CHI", "Dallas": "DAL", "Los Angeles": "LA",
              "Miami": "MIA", "New York": "NYC", "Philadelphia": "PHL", "Seattle": "SEA"}
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def slugify(s):
    out = "".join(c.lower() if c.isalnum() else "-" for c in s)
    while "--" in out: out = out.replace("--", "-")
    return out.strip("-")


def districts():
    d = json.load(open(os.path.join(ROOT, "_data", "reefer_districts.json"), encoding="utf-8"))
    d.pop("_about", None)
    return d


money = lambda n: f"${n:,}"
def span(a, b):
    if a is None or b is None: return ""
    return money(a) if a == b else f"${a:,}–{b:,}"
def mid(w):                                  # [week, low, high, mostly_low, mostly_high, ...]
    if w[3] is not None and w[4] is not None: return (w[3] + w[4]) / 2
    return None if w[1] is None or w[2] is None else (w[1] + w[2]) / 2
pct = lambda n: "" if n is None else ("0%" if n == 0 else f"{'+' if n > 0 else '−'}{abs(n)}%")
week_of = lambda iso: full_date(datetime.fromisoformat(iso))


def season(weeks):
    """'November to May', from the months a lane has ever been quoted in."""
    have = sorted({int(w[0][5:7]) - 1 for w in weeks})
    if len(have) >= 11: return "all year"
    runs, start = [], None
    for m in range(12):                      # runs of consecutive months, wrapping December→January
        if m in have and start is None: start = m
        if m not in have and start is not None: runs.append([start, m - 1]); start = None
    if start is not None: runs.append([start, 11])
    if len(runs) > 1 and runs[0][0] == 0 and runs[-1][1] == 11: runs[0][0] = runs.pop()[0]
    return ", ".join(MONTHS[a] if a == b else f"{MONTHS[a]} to {MONTHS[b]}" for a, b in runs)


def chart(weeks, w=640, h=200, pad=8):
    """SVG paths for a lane's history: the low–high band and the midpoint line, split where the
    lane went out of season so a gap is drawn as a gap."""
    pts = [x for x in weeks if x[1] is not None and x[2] is not None]
    if len(pts) < 2: return None
    t0, t1 = datetime.fromisoformat(pts[0][0]), datetime.fromisoformat(pts[-1][0])
    lo, hi = min(x[1] for x in pts), max(x[2] for x in pts)
    if hi == lo: hi = lo + 1
    days = max((t1 - t0).days, 1)
    X = lambda iso: round(pad + (datetime.fromisoformat(iso) - t0).days / days * (w - 2 * pad), 1)
    Y = lambda v: round(h - pad - (v - lo) / (hi - lo) * (h - 2 * pad), 1)
    runs, cur = [], [pts[0]]
    for a, b in zip(pts, pts[1:]):
        if (datetime.fromisoformat(b[0]) - datetime.fromisoformat(a[0])).days > 14: runs.append(cur); cur = []
        cur.append(b)
    runs.append(cur)
    band = line = ""
    for r in runs:
        if len(r) == 1: r = r * 2
        band += "M" + " L".join(f"{X(x[0])},{Y(x[2])}" for x in r) + " L" + " L".join(f"{X(x[0])},{Y(x[1])}" for x in reversed(r)) + " Z "
        line += "M" + " L".join(f"{X(x[0])},{Y(mid(x))}" for x in r) + " "
    return {"w": w, "h": h, "band": band.strip(), "line": line.strip(), "top": money(hi), "bottom": money(lo),
            "start": week_of(pts[0][0]), "end": week_of(pts[-1][0])}


def spark(weeks, n=26, w=96, h=24):
    vals = [mid(x) for x in weeks[-n:] if mid(x) is not None]
    if len(vals) < 3: return None
    lo, hi = min(vals), max(vals)
    hi = hi if hi > lo else lo + 1
    step = (w - 2) / (len(vals) - 1)
    return " ".join(f"{round(1 + i * step, 1)},{round(h - 2 - (v - lo) / (hi - lo) * (h - 4), 1)}" for i, v in enumerate(vals))


def reefer(base):
    cur = get(base + "/reefer")
    if not cur.get("latest"): raise RuntimeError("the Worker has no reefer data yet")
    names = districts()
    def place(d):
        if d not in names:
            print(f"reefer: add {d!r} to _data/reefer_districts.json", file=sys.stderr)
            names[d] = {"name": d.title(), "short": d.title(), "slug": slugify(d)}
        return names[d]
    lane_slug = lambda district, dest: f"{place(district)['slug']}-to-{slugify(dest)}"

    lanes = {}
    for y in cur.get("years") or []:
        for l in get(f"{base}/reefer/history?year={y}")["lanes"]:
            lanes.setdefault((l["district"], l["dest"]), []).extend(l["weeks"])
    for weeks in lanes.values(): weeks.sort(key=lambda x: x[0])
    latest = cur["latest"]
    year_start = (datetime.fromisoformat(latest) - timedelta(days=364)).date().isoformat()

    # The lane pages.
    pages = {}
    for (district, dest), weeks in lanes.items():
        if len(weeks) < LANE_MIN_WEEKS: continue
        o, slug, last = place(district), lane_slug(district, dest), weeks[-1]
        year = [x for x in weeks if x[0] > year_start]
        mids = [mid(x) for x in year if mid(x) is not None]
        ago = next((x for x in reversed(weeks) if abs((datetime.fromisoformat(last[0]) - datetime.fromisoformat(x[0])).days - 364) <= 3), None)
        pages[slug] = {
            "origin": o["name"], "short": o["short"], "usda": district, "dest": dest,
            "current": last[0] == latest, "last_week": week_of(last[0]), "last_iso": last[0],
            "range": span(last[1], last[2]), "mostly": span(last[3], last[4]), "change": pct(last[5]), "availability": last[6] or "",
            "year_ago": None if not ago or mid(ago) is None or mid(last) is None else
                {"week": week_of(ago[0]), "mid": money(round(mid(ago))), "diff": pct(round((mid(last) - mid(ago)) / mid(ago) * 100))},
            "avg": money(round(sum(mids) / len(mids))) if mids else "",
            "low": money(min(x[1] for x in year if x[1] is not None)) if mids else "",
            "high": money(max(x[2] for x in year if x[2] is not None)) if mids else "",
            "weeks_year": len(year), "weeks_all": len(weeks), "since": week_of(weeks[0][0]), "season": season(weeks), "chart": chart(weeks),
            "rows": [{"week": week_of(x[0]), "range": span(x[1], x[2]), "mostly": span(x[3], x[4]), "change": pct(x[5]), "availability": x[6] or ""}
                     for x in reversed(weeks[-52:])],
        }

    # This week's board as a rate sheet: one row per origin, one column per city, each cell the
    # main quote in thousands ("3.8–4.4"). Rows with the most cities come first.
    k = lambda n: f"{n / 1000:.1f}"
    cities = sorted({q["dest"] for q in cur["quotes"]})
    cells, also = {}, []
    for q in cur["quotes"]:
        o = place(q["district"])
        if q["quote"] == 0:
            slug = lane_slug(q["district"], q["dest"])
            cells[(q["district"], q["dest"])] = {
                "k": "" if q["low"] is None or q["high"] is None else (k(q["low"]) if q["low"] == q["high"] else f"{k(q['low'])}–{k(q['high'])}"),
                "range": span(q["low"], q["high"]), "mostly": span(q["mostly_low"], q["mostly_high"]),
                "change": pct(q["change_pct"]), "n": q["change_pct"] or 0, "trucks": q["availability"] or "",
                "lane": slug if slug in pages else None, "from": o["short"], "to": q["dest"],
                "spark": spark(lanes.get((q["district"], q["dest"]), [])) or "",
                "big": abs(q["change_pct"] or 0) >= 5}
        else:
            also.append({"from": o["short"], "to": q["dest"], "range": span(q["low"], q["high"]), "for": ", ".join(q["commodities"])})
    origins = sorted({d for d, _ in cells}, key=lambda d: (-sum(1 for (x, _) in cells if x == d), place(d)["short"]))
    sheet = [{"short": place(d)["short"], "name": place(d)["name"],
              "cells": [cells.get((d, c)) for c in cities]} for d in origins]
    movers = sorted(cells.values(), key=lambda c: -abs(c["n"]))
    featured = movers[0] if movers else None
    also.sort(key=lambda a: (a["from"], a["to"]))

    # Every lane into each city this week, cheapest first, for the lane pages' comparison.
    into = {}
    for (district, dest), weeks in lanes.items():
        w = weeks[-1]
        if w[0] != latest or mid(w) is None: continue
        slug = lane_slug(district, dest)
        into.setdefault(dest, []).append({"short": place(district)["short"], "lane": slug if slug in pages else None, "range": span(w[1], w[2]), "m": mid(w)})
    for v in into.values(): v.sort(key=lambda x: x["m"])
    for slug, p in pages.items():
        p["compare"] = [{"short": c["short"], "lane": c["lane"], "range": c["range"], "here": c["lane"] == slug} for c in into.get(p["dest"], [])]

    fuel = cur.get("diesel") or []
    diesel = None
    if fuel:
        a, b = fuel[-1], (fuel[-2] if len(fuel) > 1 else None)
        d = None if not b else round((a["price"] - b["price"]) * 100, 1)
        diesel = {"price": f"${a['price']:.3f}", "week": week_of(a["week"]),
                  "delta": "" if d is None else ("±0¢" if d == 0 else f"{'+' if d > 0 else '−'}{abs(d):.1f}¢"),
                  "change": "" if d is None else ("no change from the week before" if d == 0 else f"{'+' if d > 0 else '−'}{abs(d):.1f}¢ from the week before")}

    # The download: every lane's main quote for every week, oldest first. A static file, so it
    # costs the Worker nothing and the link is on this site.
    os.makedirs(os.path.join(ROOT, "reefer-rates"), exist_ok=True)
    with open(os.path.join(ROOT, "reefer-rates", "usda-reefer-truck-rates.csv"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("week_of,origin_district,destination,low_usd,high_usd,mostly_low_usd,mostly_high_usd,change_pct,truck_availability\n")
        cell = lambda v: "" if v is None else (f'"{v}"' if "," in str(v) else str(v))
        for w, district, dest, *rest in sorted(((x[0], d, c, *x[1:]) for (d, c), weeks in lanes.items() for x in weeks), key=lambda r: r[:3]):
            fh.write(",".join(cell(v) for v in (w, district, dest, *rest)) + "\n")

    # Lane stubs: new ones only, so the daily commit only changes when a lane first appears.
    os.makedirs(LANES_DIR, exist_ok=True)
    for slug, p in pages.items():
        f = os.path.join(LANES_DIR, slug + ".md")
        if os.path.exists(f): continue
        title = f"{p['short']} to {p['dest']} reefer rates"
        desc = (f"Weekly spot rates for a refrigerated truck from {p['origin']} to {p['dest']}, from USDA's National "
                f"Truck Rate Report: the latest rate, every week on record, and how the lane compares.")
        with open(f, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(f"---\nlane: {slug}\ntitle: {json.dumps(title, ensure_ascii=False)}\ndescription: {json.dumps(desc, ensure_ascii=False)}\n---\n")

    return {"generated": cur["updated"], "latest": latest, "week": week_of(latest), "first": week_of(cur["first"]), "first_iso": cur["first"],
            "backfill_done": bool(cur.get("backfill_done")), "diesel": diesel, "lanes": pages,
            "cities": [{"name": c, "code": CITY_CODES.get(c, c[:3].upper())} for c in cities], "sheet": sheet, "also": also,
            "featured": featured, "quoted": len(cells), "origin_count": len(sheet), "lane_count": len(pages),
            "row_count": sum(len(w) for w in lanes.values())}


def main():
    base = worker_url()
    if not base: sys.exit("no worker_url in _config.yml")
    os.makedirs(OUT, exist_ok=True)
    failed = 0
    jobs = (("youtube", lambda: youtube(get(base + "/youtube"))), ("watching", lambda: watching(get(base + "/"))),
            ("reefer", lambda: reefer(base)))
    for name, job in jobs:
        try:
            data = job()
        except Exception as e:
            print(f"{name}: kept the last snapshot ({e})", file=sys.stderr); failed += 1; continue
        with open(os.path.join(OUT, name + ".json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, ensure_ascii=False, indent=1); f.write("\n")
        print(f"{name}: written")
    sys.exit(1 if failed == len(jobs) else 0)


if __name__ == "__main__":
    main()
