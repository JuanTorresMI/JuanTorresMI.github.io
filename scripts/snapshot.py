#!/usr/bin/env python3
"""Copies the Worker's live data into the site, so pages that fill themselves in by script
also have real content in their HTML: for search engines, AI crawlers and readers with
JavaScript off. The script on each page still fetches fresh numbers for everyone else.

    python3 scripts/snapshot.py
    python3 scripts/snapshot.py beef                                  # one source only
    WORKER_URL=http://127.0.0.1:8787 python3 scripts/snapshot.py     # against `wrangler dev`

Writes, already formatted the way the pages show them (Liquid on GitHub Pages can't put commas
in numbers or say "Oct 14"), so the templates only loop:

    _data/live/youtube.json     /youtube/
    _data/live/watching.json    /watching/
    _data/live/reefer.json      /reefer-rates/ and every lane page
    _data/live/border.json      /border-waits/, /es/tiempos-de-espera/ and every crossing page
    _data/live/beef.json        /beef-prices/, /es/precios-de-carne-de-res/ and every cut page
    _data/live/pork.json        /pork-prices/, /es/precios-de-cerdo/ and every cut page
    _data/live/cattle.json      /fed-cattle-prices/, /es/precios-de-ganado-gordo/ and every region page

plus a front-matter stub for each reefer lane (_reefer_lanes/), each named border crossing
(_border_crossings/, _border_crossings_es/), each beef and pork cut and each cattle region, in both
languages (_beef_cuts/, _pork_cuts/, _cattle_regions/ and their _es twins), never deleted, and the
CSV downloads. A source that fails or answers with an error is skipped and its last good file
stays. The `Snapshot live pages` workflow runs this twice a day and commits whatever changed.
Needs only the standard library.
"""
import calendar, csv, json, os, re, sys, urllib.request
from urllib.parse import quote
from datetime import date, datetime, timedelta, timezone
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

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
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


# ------------------------------------------------------------------ the border wait board ----
# /border-waits/ and a page per major crossing (/border-waits/<slug>/), plus a Spanish page for
# each Mexico crossing (/es/tiempos-de-espera/<slug>/). Built from the Worker's /border (now) and
# /border/port (the last 30 days by weekday and hour). The pages' scripts only refresh "now".
# Numbers stay numbers and the few strings come in pairs (en, es); the words are in the layouts.

BORDER_DIR = os.path.join(ROOT, "_border_crossings")
BORDER_ES_DIR = os.path.join(ROOT, "_border_crossings_es")
BORDER_CSV = os.path.join(ROOT, "border-waits", "border-truck-wait-times.csv")
DAYS_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
LEVELS = (10, 20, 40, 60)                    # minutes: the heat map's steps, the same for every crossing
SURE = 2                                     # readings an hour needs before it can be called best or worst
ENOUGH = 48                                  # readings (about two days) before a crossing gets averages or a best hour
fecha = lambda d: f"{d.day} {MONTHS_ES[d.month - 1]} {d.year}"
local_time = lambda s: datetime.strptime(s, "%Y-%m-%d %H:%M")


STALE_MIN = 180                              # a reading this old when copied gets marked as old


def posted_label(at, cbp):
    """'2026-10-15 22:00' + 'At 10:00 pm CDT' -> ('Oct 15, 10:00 PM CDT', '15 oct, 22:00 CDT')."""
    if not at: return "", ""
    t = local_time(at)
    zone = (re.findall(r"[A-Z]{3}$", (cbp or "").strip()) or [""])[-1]
    en = f"{t:%b} {t.day}, {t.hour % 12 or 12}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'}" + (f" {zone}" if zone else "")
    es = f"{t.day} {MONTHS_ES[t.month - 1]}, {t.hour}:{t.minute:02d}" + (f" {zone}" if zone else "")
    return en, es


def hours_es(h):
    """CBP's '7 am-Midnight' / '24 hrs/day' in Spanish."""
    if not h: return ""
    if "24" in h and "day" in h: return "24 horas"
    def one(x):
        x = x.strip().lower()
        if x == "midnight": return "medianoche"
        if x == "noon": return "mediodía"
        m = re.match(r"(\d{1,2})(?::(\d{2}))?\s*([ap])m", x)
        if not m: return x
        return f"{int(m[1]) % 12 + (12 if m[3] == 'p' else 0)}:{m[2] or '00'}"
    return " a ".join(one(x) for x in h.split("-"))


def ensure_front(path, key, value):
    """Adds `key: value` to an existing stub's front matter if the key is missing."""
    lines = open(path, encoding="utf-8").read().replace("\r\n", "\n").split("\n")
    if any(l.startswith(key + ":") for l in lines): return
    end = lines.index("---", 1)
    lines.insert(end, f"{key}: {json.dumps(value, ensure_ascii=False)}")
    with open(path, "w", encoding="utf-8", newline="\n") as fh: fh.write("\n".join(lines))


def fit(*titles, limit=60):
    """The first title that fits in a search result, or the last one."""
    return next((t for t in titles if len(t) <= limit), titles[-1])


def crossings():
    d = json.load(open(os.path.join(ROOT, "_data", "border_crossings.json"), encoding="utf-8"))
    return {c["port"]: c for c in d["crossings"]}, d.get("names", {})


def wait(lane):
    """{'v': minutes or None, 'en': ..., 'es': ..., 'lanes': open}. Unknown is never shown as zero."""
    v, st = lane.get("delay"), (lane.get("status") or "").lower()
    if v is not None:
        return {"v": v, "en": "No wait" if v == 0 else f"{v} min", "es": "Sin demora" if v == 0 else f"{v} min", "lanes": lane.get("lanes")}
    en, es = {"lanes closed": ("Closed", "Cerrado"), "update pending": ("Pending", "Pendiente")}.get(st, ("—", "—"))
    return {"v": None, "en": en, "es": es, "lanes": lane.get("lanes")}


def level(v):
    return None if v is None else sum(1 for t in LEVELS if v >= t)


def wait_chart(recent, w=640, h=160, pad=8):
    """The last 7 days of standard-lane waits as an SVG line, broken where readings stop for more
    than three hours (the port closed for the night, or nobody posted)."""
    pts = [(local_time(r[0]), r[1]) for r in recent if r[1] is not None]
    if len(pts) < 2: return None
    t1 = pts[-1][0]
    t0 = max(pts[0][0], t1 - timedelta(days=7))
    pts = [p for p in pts if p[0] >= t0]
    if len(pts) < 2: return None
    top = max(30, max(v for _, v in pts))
    secs = max((t1 - t0).total_seconds(), 1)
    X = lambda t: round(pad + (t - t0).total_seconds() / secs * (w - 2 * pad), 1)
    Y = lambda v: round(h - pad - v / top * (h - 2 * pad), 1)
    line, prev = "", None
    for t, v in pts:
        line += ("L" if prev and (t - prev).total_seconds() <= 3 * 3600 else " M") + f"{X(t)},{Y(v)}"
        prev = t
    return {"w": w, "h": h, "line": line.strip(), "top": top, "start_en": day_label(t0), "end_en": day_label(t1),
            "start_es": fecha(t0), "end_es": fecha(t1)}


def weighted(cells, v, n):
    total = sum(c[n] for c in cells if c[v] is not None)
    return round(sum(c[v] * c[n] for c in cells if c[v] is not None) / total) if total else None


def summarize(profile):
    """A [dow, hour, std_avg, std_n, fast_avg, fast_n] profile -> the heat map, the averages by hour,
    the best and worst hour, and the overall averages (each hour weighted by its readings)."""
    cells = {(r[0], r[1]): r for r in profile}
    hours = sorted({h for _, h in cells})
    grid = []
    for h in hours:
        row = []
        for dw in range(7):
            c = cells.get((dw, h))
            v = None if c is None or c[2] is None else round(c[2])
            row.append({"v": v, "lvl": level(v)})
        grid.append({"h": h, "cells": row})
    known = [c for c in profile if c[2] is not None]
    sure = [c for c in known if c[3] >= SURE] or known
    pick = lambda c: {"dow": c[0], "hour": c[1], "v": round(c[2])}
    by_hour = [{"h": h, "v": weighted([c for c in known if c[1] == h], 2, 3)} for h in hours]
    by_hour = [b for b in by_hour if b["v"] is not None]
    top = max([b["v"] for b in by_hour] + [1])
    for b in by_hour: b["w"] = round(b["v"] / top * 100, 1)
    # A port where every hour averages the same (usually 0: a quiet crossing) has no best or worst hour.
    flat = bool(sure) and round(min(c[2] for c in sure)) == round(max(c[2] for c in sure))
    return {"grid": grid, "by_hour": by_hour, "avg": weighted(profile, 2, 3), "fast_avg": weighted(profile, 4, 5), "flat": flat,
            "best": pick(min(sure, key=lambda c: (c[2], c[0], c[1]))) if sure and not flat else None,
            "worst": pick(max(sure, key=lambda c: (c[2], -c[0], -c[1]))) if sure and not flat else None}


def port_detail(base, port):
    d = get(f"{base}/border/port?id={port}")
    profile = d.get("profile") or []                       # [dow, hour, std_avg, std_n, fast_avg, fast_n]
    first = local_time(d["first"]) if d.get("first") else None
    out = summarize(profile)
    if (d.get("readings") or 0) < ENOUGH:                  # a few readings are not a "usual" anything
        out.update(grid=[], by_hour=[], avg=None, fast_avg=None, best=None, worst=None, flat=False)
    return {**out, "readings": d.get("readings") or 0, "first": d.get("first") or "",
            "first_en": full_date(first) if first else "", "first_es": fecha(first) if first else "",
            "chart": wait_chart(d.get("recent") or []), "profile": profile}


# CBP's own history: its Border Wait Times site publishes, for every port, the average wait in each
# hour of each weekday of a given month, "based on data from previous year". The live board can't
# say what October is usually like until it has watched an October; this can, from day one.
# Fetched straight from CBP here (no key, one request per port), never through the Worker.
CBP_BWT = "https://bwt.cbp.gov/api"
MONTHS_ES_FULL = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


def cbp_get(path):
    req = urllib.request.Request(f"{CBP_BWT}/{path}", headers={"User-Agent": "site-snapshot (github.com/JuanTorresMI)", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read().decode("utf-8"))
    return json.loads(d) if isinstance(d, str) else d          # the crossing list comes JSON-in-a-string


def cbp_ids():
    """Our six-digit port numbers -> CBP's eight-digit Border Wait Times ids ("230404" -> "07230404")."""
    d = cbp_get("bwtmodern/crossingslist")
    items = d if isinstance(d, list) else next(v for v in d.values() if isinstance(v, list))
    return {i["bwtId"][-6:]: i["bwtId"] for i in items if i.get("bwtId")}


def cbp_year(bwt_id, month, has_fast):
    """CBP's averages for one port and month, last year, as a summary like ours. 0 is CBP's average
    for an hour the port was open with no wait; hours it was closed aren't listed at all."""
    rows = cbp_get(f"historicalwaittimes/{bwt_id}/COV/GENERAL/{month}/7").get("wait_times") or []
    n = lambda v: int(v) if str(v).strip().isdigit() else None
    profile = [[int(r["bwt_day"]), int(r["time_slot"]), n(r.get("cv_time_avg")), 1,
                n(r.get("xcv_time_avg")) if has_fast else None, 1 if has_fast else 0] for r in rows
               if str(r.get("bwt_day", "")).isdigit() and str(r.get("time_slot", "")).isdigit() and 0 <= int(r["bwt_day"]) <= 6]
    if has_fast and not any(r[4] for r in profile):          # FAST lanes listed but never used
        for r in profile: r[4], r[5] = None, 0
    if not profile: return None
    out = summarize(profile)
    out.update(month=month, month_en=MONTHS[month - 1], month_es=MONTHS_ES_FULL[month - 1])
    return out


def border(base):
    now = get(base + "/border")
    ports = now.get("ports") or []
    if not ports: raise RuntimeError("the Worker has no border data yet")
    named, renamed = crossings()
    reefer_area = {}
    for d in districts().values():
        for port in d.get("border", []): reefer_area.setdefault(port, {"slug": d["slug"], "short": d["short"]})
    out = {}
    for p in ports:
        c = named.get(p["port"], {})
        crossing = (p.get("crossing") or "").strip()
        cbp_name = renamed.get(p["port"]) or p["name"] + (f" – {crossing}" if crossing and p["name"].lower() not in crossing.lower() else "")
        std, fast = p.get("std") or {}, p.get("fast") or {}
        x = {"port": p["port"], "border": p["border"], "name": c.get("name") or cbp_name, "cbp": cbp_name,
             "slug": c.get("slug"), "city": c.get("city", ""), "across": c.get("across", ""), "es": c.get("es"),
             "hours": p.get("hours", ""), "open": p.get("status") == "Open", "max": p.get("max"),
             "std": wait(std), "fast": wait(fast),
             "posted": re.sub(r"^At\s+", "", std.get("update") or fast.get("update") or ""), "notice": p.get("notice") or "",
             "hours_es": hours_es(p.get("hours", "")), "stale": p.get("age") is not None and p["age"] >= STALE_MIN,
             "reefer": reefer_area.get(p["port"]), "bcis": p["port"][:2] in ("23", "24", "26", "53")}
        x["posted_en"], x["posted_es"] = posted_label(p.get("posted_at"), std.get("update") or fast.get("update"))
        try:
            x.update(port_detail(base, p["port"]))
        except Exception as e:
            print(f"border: no history for {p['port']} ({e})", file=sys.stderr)
            x.update({"readings": 0, "first": "", "first_en": "", "first_es": "", "avg": None, "fast_avg": None,
                      "grid": [], "by_hour": [], "best": None, "worst": None, "chart": None, "profile": []})
        out[p["port"]] = x
    # Nearby: the other commercial ports in the same CBP district (the first two digits of the
    # port number: 23 is the Laredo/Rio Grande Valley stretch, 38 Detroit and Port Huron, and so on),
    # the same city first (the first four digits: 2304 is Laredo).
    for k, v in out.items():
        near = sorted((o for o in out.values() if o["port"] != k and o["port"][:2] == k[:2]), key=lambda o: (o["port"][:4] != k[:4], o["name"]))
        v["nearby"] = [o["port"] for o in near][:8]
    month = when(now["updated"]).month
    try:
        before = json.load(open(os.path.join(OUT, "border.json"), encoding="utf-8")).get("ports", {})
    except Exception:
        before = {}
    try:
        ids = cbp_ids()
    except Exception as e:
        print(f"border: CBP's crossing list didn't answer ({e})", file=sys.stderr); ids = {}
    for k, v in out.items():
        year = None
        if k in ids:
            try: year = cbp_year(ids[k], month, v["fast"]["en"] != "—")
            except Exception as e: print(f"border: no CBP history for {k} ({e})", file=sys.stderr)
        old = (before.get(k) or {}).get("last_year")
        v["last_year"] = year or (old if old and old.get("month") == month else None)
    for port in named:
        if port not in out: print(f"border: {port} is in border_crossings.json but not in CBP's feed", file=sys.stderr)

    order = lambda b: [v["port"] for v in sorted((v for v in out.values() if v["border"] == b), key=lambda v: v["name"])]
    ours = sum(1 for v in out.values() if v["avg"] is not None) * 2 >= len(out)
    usual = lambda v: v["avg"] if ours else (v["last_year"] or {}).get("avg")
    for v in out.values():
        src = v if ours else (v["last_year"] or {})
        v["usual"] = {"avg": usual(v), "best": src.get("best"), "worst": src.get("worst")}
    busiest = sorted((v for v in out.values() if usual(v) is not None), key=lambda v: (-usual(v), v["name"]))[:8]
    firsts = [v["first"] for v in out.values() if v["first"]]
    since = local_time(min(firsts)) if firsts else None

    # The download: the 30-day averages, one row per crossing, lane, weekday and hour.
    stamp = when(now["updated"]).date().isoformat()
    os.makedirs(os.path.dirname(BORDER_CSV), exist_ok=True)
    with open(BORDER_CSV, "w", encoding="utf-8", newline="") as fh:
        wr = csv.writer(fh, lineterminator="\n")
        wr.writerow(["port_number", "border", "crossing", "lane", "weekday", "hour_local", "average_wait_min", "readings", "window_days", "as_of"])
        for k in order("mexico") + order("canada"):
            v = out[k]
            for dw, h, s, sn, f, fn in v["profile"]:
                if s is not None: wr.writerow([k, v["border"], v["cbp"], "standard", DAYS_EN[dw], h, s, sn, 30, stamp])
                if f is not None: wr.writerow([k, v["border"], v["cbp"], "FAST", DAYS_EN[dw], h, f, fn, 30, stamp])
    for v in out.values(): v.pop("profile", None)

    # Page stubs for the named crossings: new ones only, never deleted (as with the reefer lanes).
    for c in named.values():
        pages = [(BORDER_DIR, c["slug"], {"port": c["port"],
                  "title": f"{c['name']} truck wait times",
                  "description": f"Commercial truck wait times at the {c['name']}: the wait right now and the usual wait at each hour of the week, from CBP's readings.",
                  **({"translation": f"/es/tiempos-de-espera/{c['es']['slug']}/"} if c.get("es") else {})})]
        if c.get("es"):
            e = c["es"]
            pages.append((BORDER_ES_DIR, e["slug"], {"port": c["port"],
                          "title": f"Tiempo de espera para camiones: {e['short']}",
                          "description": fit(f"Cuánto esperan hoy los camiones de carga en el cruce {e['short']}, de {e['across']} a {e['city']}: la espera ahora y la habitual por hora, según CBP.",
                                             f"Cuánto esperan hoy los camiones de carga en el cruce {e['short']}: la espera ahora y la habitual por hora, según CBP.", limit=160),
                          "translation": f"/border-waits/{c['slug']}/"}))
        pages[0][2]["seo_title"] = fit(f"{c['name']} Truck Wait Times Now & by Hour", f"{c['name']} Truck Wait Times")
        if c.get("es"):
            pages[1][2]["seo_title"] = fit(f"{c['es']['short']}: tiempo de espera de camiones hoy", f"{c['es']['short']}: espera de camiones hoy")
        for folder, slug, fm in pages:
            os.makedirs(folder, exist_ok=True)
            f = os.path.join(folder, slug + ".md")
            if os.path.exists(f):
                ensure_front(f, "seo_title", fm["seo_title"])
                continue
            with open(f, "w", encoding="utf-8", newline="\n") as fh:
                fh.write("---\n" + "".join(f"{k}: {json.dumps(v, ensure_ascii=False)}\n" for k, v in fm.items()) + "---\n")

    t = when(now["updated"])
    reporting = [v for v in out.values() if v["std"]["v"] is not None or v["fast"]["v"] is not None]
    longest = max(reporting, key=lambda v: v["std"]["v"] or 0, default=None)
    return {"generated": now["updated"], "as_of_iso": stamp,
            "as_of_en": f"{full_date(t)}, {t.hour % 12 or 12}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'} Michigan time",
            "as_of_es": f"{fecha(t)}, {t.hour}:{t.minute:02d} (hora de Michigan)",
            "since_en": full_date(since) if since else "", "since_es": fecha(since) if since else "", "since_iso": since.date().isoformat() if since else stamp,
            "ports": out, "mexico": order("mexico"), "canada": order("canada"), "busiest": [v["port"] for v in busiest],
            "busiest_source": "ours" if ours else "cbp", "month_en": MONTHS[month - 1], "month_es": MONTHS_ES_FULL[month - 1],
            "reporting": len(reporting), "total": len(out),
            "longest": longest["port"] if longest and longest["std"]["v"] else None}

# ------------------------------------------------------------------ the reefer rate board ----
# /reefer-rates/ and one page per lane (/reefer-rates/<origin>-to-<city>/). Unlike the other two,
# this page has no script of its own: the data changes once a week, so the daily copy *is* the
# page. Lane pages are a Jekyll collection (_reefer_lanes/); this writes a stub for every lane
# with enough history and never deletes one, so a lane out of season keeps its address.
#
# USDA keeps the history, so nothing else does: the committed CSV is read back first, and the
# Worker (which holds the USDA key) is asked only for the weeks it doesn't settle, normally the
# newest and the four before it. `REEFER_FILL=1 python3 scripts/snapshot.py reefer` also walks
# back through any gap and past the oldest week to REEFER_START (or until USDA has nothing older);
# it was run once, by hand, on Oct 17, 2026, and the CSV keeps what it found.

LANES_DIR = os.path.join(ROOT, "_reefer_lanes")
LANE_MIN_WEEKS = 4                          # fewer quotes than this makes too thin a page
REEFER_RECENT_WEEKS = 4                     # weeks before the newest that are always re-read (USDA corrects)
REEFER_GIVE_UP = 26                         # filling: half a year of empty weeks in a row means USDA's history has ended
REEFER_START = "2020-01-06"                 # filling stops here (the beef board's window too); USDA has older weeks
REEFER_FIRST_WEEK = "2021-04-19"            # the oldest week USDA's API has for report 2375, as the fill found it
CITY_CODES = {"Atlanta": "ATL", "Baltimore": "BAL", "Boston": "BOS", "Chicago": "CHI", "Dallas": "DAL", "Los Angeles": "LA",
              "Miami": "MIA", "New York": "NYC", "Philadelphia": "PHL", "Seattle": "SEA"}


def slugify(s):
    import unicodedata          # Spanish names: "vacío" becomes "vacio" in an address
    s = unicodedata.normalize("NFKD", s.replace("–", "-").replace("—", "-")).encode("ascii", "ignore").decode()
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


CSV_PATH = os.path.join(ROOT, "reefer-rates", "usda-reefer-truck-rates.csv")


def archive():
    """The committed CSV read back, as {(district, dest): {week: row}}. It is the long-term record:
    whatever the Worker returns is merged over it, so a week once collected is never lost."""
    out = {}
    if not os.path.exists(CSV_PATH): return out
    with open(CSV_PATH, encoding="utf-8", newline="") as fh:
        for r in csv.DictReader(fh):
            n = lambda k: None if r[k] == "" else int(r[k])
            out.setdefault((r["origin_district"], r["destination"]), {})[r["week_of"]] = [
                r["week_of"], n("low_usd"), n("high_usd"), n("mostly_low_usd"), n("mostly_high_usd"), n("change_pct"), r["truck_availability"] or None]
    return out


def plausible(w):
    """A week as the pages show it. USDA's report sometimes drops digits from a low ($53 for a
    $5,300 load, Florida to New York, May 25, 2026; $740 for $7,400 two months later), and real
    ranges never span more than about 2x, so a low under a quarter of its high is left out rather
    than drawn as a record low. The CSV keeps the report as published."""
    w = list(w)
    for lo, hi in ((1, 2), (3, 4)):
        if w[lo] is not None and w[hi] is not None and w[lo] * 4 < w[hi]: w[lo] = None
    return w


def verdict(weeks):
    """How the latest week compares with the lane's own history, in words."""
    m = mid(weeks[-1])
    prior = [mid(x) for x in weeks[:-1] if mid(x) is not None]
    if m is None or len(prior) < 3:
        return {"text": "Too few weeks on record yet to say how this rate compares.", "tag": "", "pos": None}
    n, lower, higher = len(prior), sum(1 for p in prior if p < m), sum(1 for p in prior if p > m)
    if lower == n: text = f"The highest of the {n + 1} weeks on record."
    elif higher == n: text = f"The lowest of the {n + 1} weeks on record."
    else: text = f"Higher than {lower} of the {n} earlier weeks on record."
    tag = "On the high side" if lower / n > 2 / 3 else "On the low side" if lower / n < 1 / 3 else "About average"
    return {"text": text, "tag": tag, "pos": round(lower / n * 100)}


cents = lambda c: "±0¢" if c == 0 else f"{'+' if c > 0 else '−'}{abs(c):.1f}¢"


def crop_name(c):
    """USDA's 'Lettuce, Boston' -> 'Boston lettuce', so a list of crops reads as one."""
    if ", " not in c: return c
    kind, variety = c.split(", ", 1)
    return f"{variety} {kind.lower()}"


def crop_list(items, show=6):
    items = sorted({crop_name(c) for c in items})
    if len(items) <= show: return ", ".join(items)
    return ", ".join(items[:show]) + f" and {len(items) - show} more"


place_key = lambda x: x["usda"]


def reefer(base):
    cur = get(base + "/reefer")
    if not cur.get("latest"): raise RuntimeError("USDA returned no truck rate report")
    names = districts()
    def place(d):
        if d not in names:
            print(f"reefer: add {d!r} to _data/reefer_districts.json", file=sys.stderr)
            names[d] = {"name": d.title(), "short": d.title(), "slug": slugify(d)}
        return names[d]
    lane_slug = lambda district, dest: f"{place(district)['slug']}-to-{slugify(dest)}"

    # History: the archive (the committed CSV) first, then the weeks it doesn't settle, from USDA
    # through the Worker: the newest, the REEFER_RECENT_WEEKS before it, and any since the archive's
    # newest. A week USDA answers replaces that week whole (a correction can drop a lane).
    merged = archive()
    plus = lambda w, n: (datetime.fromisoformat(w) + timedelta(days=7 * n)).date().isoformat()
    def lay(payload):
        main = [q for q in payload.get("quotes") or [] if q.get("quote") == 0]
        if not payload.get("latest") or not main: return False
        wk = payload["latest"]
        for v in merged.values(): v.pop(wk, None)
        for q in main:
            merged.setdefault((q["district"], q["dest"]), {})[wk] = [wk, q["low"], q["high"], q["mostly_low"], q["mostly_high"], q["change_pct"], q["availability"]]
        return True
    week = lambda w: get(f"{base}/reefer?week={w}")
    on_file = sorted({w for v in merged.values() for w in v})
    ask = {plus(cur["latest"], -n) for n in range(1, REEFER_RECENT_WEEKS + 1)}
    w = on_file[-1] if on_file else cur["latest"]
    while plus(w, 1) < cur["latest"]:
        w = plus(w, 1); ask.add(w)
    asked = 0
    for w in sorted(ask):
        lay(week(w)); asked += 1
    if os.environ.get("REEFER_FILL") and on_file:
        held = set(on_file)
        w = on_file[0]
        while w < on_file[-1]:                                       # gaps inside the record
            w = plus(w, 1)
            if w not in held and w not in ask: lay(week(w)); asked += 1
        misses, w = 0, on_file[0]
        while misses < REEFER_GIVE_UP and plus(w, -1) >= REEFER_START:   # and back past its oldest week
            w = plus(w, -1); asked += 1
            misses = 0 if lay(week(w)) else misses + 1
        print(f"reefer: filled back to {min(x for v in merged.values() for x in v)}; set REEFER_FIRST_WEEK to it")
    lay(cur)
    print(f"reefer: asked USDA for {asked} week{'s' if asked != 1 else ''} besides the newest")
    lanes = {k: [v[w] for w in sorted(v)] for k, v in merged.items() if v}      # as published: the CSV
    shown = {k: [plausible(w) for w in v] for k, v in lanes.items()}              # what the pages show
    latest = cur["latest"]
    year_start = (datetime.fromisoformat(latest) - timedelta(days=364)).date().isoformat()

    # What each shipping area is shipping this week (every quote, not just the main one).
    crops = {}
    for q in cur["quotes"]:
        crops.setdefault(q["district"], set()).update(q.get("commodities") or [])

    # The lane pages.
    pages = {}
    for (district, dest), weeks in shown.items():
        if len(weeks) < LANE_MIN_WEEKS: continue
        o, slug, last = place(district), lane_slug(district, dest), weeks[-1]
        year = [x for x in weeks if x[0] > year_start]
        mids = [mid(x) for x in year if mid(x) is not None]
        ago = next((x for x in reversed(weeks) if abs((datetime.fromisoformat(last[0]) - datetime.fromisoformat(x[0])).days - 364) <= 3), None)
        pages[slug] = {
            "origin": o["name"], "short": o["short"], "usda": district, "dest": dest, "border": o.get("border", []),
            "current": last[0] == latest, "last_week": week_of(last[0]), "last_iso": last[0],
            "range": span(last[1], last[2]), "mostly": span(last[3], last[4]), "change": pct(last[5]), "availability": last[6] or "",
            "raw": {"low": last[1], "high": last[2], "mostly_low": last[3], "mostly_high": last[4]}, "first_iso": weeks[0][0],
            "verdict": verdict(weeks),
            "crops": crop_list(crops.get(district, []), 8) if last[0] == latest else "",
            "year_ago": None if not ago or mid(ago) is None or mid(last) is None else
                {"week": week_of(ago[0]), "mid": money(round(mid(ago))), "diff": pct(round((mid(last) - mid(ago)) / mid(ago) * 100))},
            "avg": money(round(sum(mids) / len(mids))) if mids else "",
            "low": money(min(x[1] for x in year if x[1] is not None)) if mids else "",
            "high": money(max(x[2] for x in year if x[2] is not None)) if mids else "",
            "weeks_year": len(year), "weeks_all": len(weeks), "since": week_of(weeks[0][0]), "season": season(weeks), "chart": chart(weeks),
            "rows": [{"week": week_of(x[0]), "range": span(x[1], x[2]), "mostly": span(x[3], x[4]), "change": pct(x[5]), "availability": x[6] or ""}
                     for x in reversed(weeks[-52:])],
        }

    # This week's main quote for every lane quoted.
    k = lambda n: f"{n / 1000:.1f}"
    cities = sorted({q["dest"] for q in cur["quotes"]})
    cells, also = {}, []
    for q in cur["quotes"]:
        o = place(q["district"])
        if q["quote"] == 0:
            slug = lane_slug(q["district"], q["dest"])
            w = [latest, q["low"], q["high"], q["mostly_low"], q["mostly_high"], q["change_pct"], q["availability"]]
            cells[(q["district"], q["dest"])] = {
                "k": "" if q["low"] is None or q["high"] is None else (k(q["low"]) if q["low"] == q["high"] else f"{k(q['low'])}–{k(q['high'])}"),
                "range": span(q["low"], q["high"]), "mostly": span(q["mostly_low"], q["mostly_high"]),
                "change": pct(q["change_pct"]), "n": q["change_pct"] or 0, "trucks": q["availability"] or "",
                "lane": slug if slug in pages else None, "from": o["short"], "usda": q["district"], "to": q["dest"], "m": mid(w),
                "verdict": pages[slug]["verdict"] if slug in pages else verdict([w]),
                "big": abs(q["change_pct"] or 0) >= 5}
        else:
            also.append({"from": o["short"], "to": q["dest"], "range": span(q["low"], q["high"]), "for": ", ".join(q["commodities"])})
    also.sort(key=lambda a: (a["from"], a["to"]))
    origins = sorted({d for d, _ in cells}, key=lambda d: (-sum(1 for (x, _) in cells if x == d), place(d)["short"]))
    sheet = [{"short": place(d)["short"], "name": place(d)["name"], "cells": [cells.get((d, c)) for c in cities]} for d in origins]
    public = lambda c: {key: c[key] for key in ("range", "mostly", "change", "trucks", "lane", "from", "to", "verdict")}

    # Lane pages: what else goes into the same city this week (cheapest first), and where else the
    # same shipping area is sending trucks. Both link to their own lane pages.
    for slug, pg in pages.items():
        here = (pg["usda"], pg["dest"])
        into = sorted((x for (d, c), x in cells.items() if c == pg["dest"] and x["m"] is not None), key=lambda x: x["m"])
        pg["compare"] = [{"short": x["from"], "range": x["range"], "lane": x["lane"], "here": (place_key(x), pg["dest"]) == here} for x in into]
        out = sorted((x for (d, c), x in cells.items() if d == pg["usda"] and x["m"] is not None), key=lambda x: x["m"])
        pg["outbound"] = [{"to": x["to"], "range": x["range"], "change": x["change"], "lane": x["lane"], "here": x["to"] == pg["dest"]} for x in out]

    # 1. The market this week, in a sentence and two short lists.
    by_city = {c: [x["n"] for (d, cc), x in cells.items() if cc == c and x["n"] is not None] for c in cities}
    avg = {c: sum(v) / len(v) for c, v in by_city.items() if v}
    rose = sorted([c for c in avg if avg[c] >= 1], key=lambda c: -avg[c])[:4]
    fell = sorted([c for c in avg if avg[c] <= -1], key=lambda c: avg[c])[:3]
    trucks = {}
    for (d, _), x in cells.items():
        if x["trucks"]: trucks.setdefault(d, set()).add(x["trucks"])
    short = sorted(place(d)["short"] for d, t in trucks.items() if t & {"Shortage"})
    long_ = sorted(place(d)["short"] for d, t in trucks.items() if t & {"Surplus"})
    sign = lambda v: f"{'+' if v > 0 else '−'}{abs(v):.1f}%"
    listing = lambda xs: xs[0] if len(xs) == 1 else ", ".join(xs[:-1]) + " and " + xs[-1]
    parts = []
    if rose: parts.append("Rates rose most into " + listing([f"{c} ({sign(avg[c])} on average)" if i == 0 else f"{c} ({sign(avg[c])})" for i, c in enumerate(rose)]) + ".")
    if fell: parts.append("They fell into " + listing([f"{c} ({sign(avg[c])})" for c in fell]) + ".")
    if not rose and not fell: parts.append("Rates held about steady this week.")
    if short: parts.append("Trucks were short in " + listing(short) + ".")
    if long_: parts.append("Trucks were plentiful in " + listing(long_) + ".")
    ups = sorted([x for x in cells.values() if x["n"] > 0], key=lambda x: -x["n"])[:5]
    downs = sorted([x for x in cells.values() if x["n"] < 0], key=lambda x: x["n"])[:5]

    # 3. Capacity: each shipping area quoted this week.
    capacity = []
    for d in origins:
        mine = [x for (dd, _), x in cells.items() if dd == d]
        t = sorted({x["trucks"] for x in mine if x["trucks"]})
        ch = [x["n"] for x in mine if x["n"] is not None]
        capacity.append({"short": place(d)["short"], "name": place(d)["name"], "trucks": " / ".join(t) or "—",
                         "short_trucks": "Shortage" in t, "lanes": len(mine),
                         "change": sign(sum(ch) / len(ch)) if ch and abs(sum(ch) / len(ch)) >= 0.05 else "0%",
                         "crops": crop_list(crops.get(d, []))})
    capacity.sort(key=lambda a: (not a["short_trucks"], a["short"]))

    # 4. Every origin into each city, cheapest first.
    city_tables = []
    for c in cities:
        rows = sorted([x for (d, cc), x in cells.items() if cc == c and x["m"] is not None], key=lambda x: x["m"])
        top = max((x["m"] for x in rows), default=1)
        city_tables.append({"name": c, "slug": slugify(c), "rows": [{**public(x), "bar": round(x["m"] / top * 100)} for x in rows]})

    # 5. Seasons: the months each shipping area has been quoted in, and what it ships now.
    months = {}
    for (d, _), weeks in shown.items():
        months.setdefault(d, set()).update(int(x[0][5:7]) for x in weeks)
    shipping_now = {d for d, _ in cells}
    seasons = [{"short": place(d)["short"], "now": d in shipping_now, "months": [m in ms for m in range(1, 13)],
                "crops": crop_list(crops.get(d, [])) if d in shipping_now else "Not quoted this week"}
               for d, ms in months.items()]
    seasons.sort(key=lambda s: (not s["now"], s["short"]))
    record = sorted({x[0][:7] for weeks in lanes.values() for x in weeks})
    have = sorted({x[0] for weeks in lanes.values() for x in weeks})
    run = latest
    while (datetime.fromisoformat(run) - timedelta(days=7)).date().isoformat() in have:
        run = (datetime.fromisoformat(run) - timedelta(days=7)).date().isoformat()
    older = [w for w in have if w < run]
    # Complete once the record reaches the oldest week USDA has; a week missing after that is one
    # USDA didn't publish (the fill asked for every one of them).
    complete = bool(REEFER_FIRST_WEEK) and have[0] <= REEFER_FIRST_WEEK
    skipped = (datetime.fromisoformat(latest) - datetime.fromisoformat(have[0])).days // 7 + 1 - len(have)
    if complete:
        history = f"Every week back to {week_of(have[0])}." if not skipped else \
            f"Every report back to {week_of(have[0])}: {fmt(len(have))} weeks (USDA published none for {skipped} of the weeks in between)."
    elif not older:
        history = f"Every week back to {week_of(run)}."
    else:
        history = (f"Every week back to {week_of(run)}, plus {len(older)} week{'s' if len(older) != 1 else ''} from "
                   f"{week_of(older[0])} to {week_of(older[-1])}.")

    # When USDA published this week's report, and when the next one is due (Wednesdays, for the
    # week that started the Monday before).
    pub = None
    try: pub = datetime.strptime((cur.get("published") or "").split(" ")[0], "%m/%d/%Y")
    except ValueError: pass
    due = datetime.fromisoformat(latest) + timedelta(days=9)

    # 6. Diesel. If EIA didn't answer this time, the last copy's diesel section stays.
    fuel = cur.get("diesel") or []
    diesel = None
    if not fuel:
        try: diesel = json.load(open(os.path.join(OUT, "reefer.json"), encoding="utf-8")).get("diesel")
        except Exception: diesel = None
    if fuel:
        a, b = fuel[-1], (fuel[-2] if len(fuel) > 1 else None)
        d = None if not b else round((a["price"] - b["price"]) * 100, 1)
        peak = max(fuel, key=lambda x: x["price"])
        bases, mpgs = [1.25, 2.00, 2.50, 3.00, 3.50, 4.00], [5.5, 6.0, 6.5, 7.0]
        surcharge = {"bases": [f"${x:.2f}" for x in bases],
                     "rows": [{"mpg": f"{m:g}", "cells": [f"${(a['price'] - x) / m:.3f}" if a["price"] > x else "$0.000" for x in bases]} for m in mpgs]}
        diesel = {"price": f"${a['price']:.3f}", "v": a["price"], "surcharge": surcharge, "week": week_of(a["week"]),
                  "delta": "" if d is None else ("±0¢" if d == 0 else f"{'+' if d > 0 else '−'}{abs(d):.1f}¢"),
                  "change": "" if d is None else ("no change from the week before" if d == 0 else f"{'+' if d > 0 else '−'}{abs(d):.1f}¢ from the week before"),
                  "peak": f"${peak['price']:.3f}", "peak_week": week_of(peak["week"]),
                  "oldest": f"${fuel[0]['price']:.3f}", "oldest_week": week_of(fuel[0]["week"]),
                  "rows": [{"week": week_of(fuel[i]["week"]), "price": f"${fuel[i]['price']:.3f}",
                            "change": "" if i == 0 else cents(round((fuel[i]["price"] - fuel[i - 1]["price"]) * 100, 1))}
                           for i in range(len(fuel) - 1, max(len(fuel) - 9, -1), -1)]}

    # The lane lookup: origin -> city -> this week's quote, as JSON for the page's two menus.
    lookup = {}
    for (d, c), x in cells.items():
        lookup.setdefault(place(d)["short"], {})[c] = public(x)

    # The download: every lane's main quote for every week on record, oldest first. A static file,
    # so it costs the Worker nothing; it is also the archive the next run reads back.
    os.makedirs(os.path.dirname(CSV_PATH), exist_ok=True)
    with open(CSV_PATH, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("week_of,origin_district,destination,low_usd,high_usd,mostly_low_usd,mostly_high_usd,change_pct,truck_availability\n")
        cell = lambda v: "" if v is None else (f'"{v}"' if "," in str(v) else str(v))
        for w, district, dest, *rest in sorted(((x[0], d, c, *x[1:]) for (d, c), weeks in lanes.items() for x in weeks), key=lambda r: r[:3]):
            fh.write(",".join(cell(v) for v in (w, district, dest, *rest)) + "\n")

    # Lane stubs: new ones only, so the daily commit only changes when a lane first appears.
    os.makedirs(LANES_DIR, exist_ok=True)
    for slug, p in pages.items():
        f = os.path.join(LANES_DIR, slug + ".md")
        seo = fit(f"{p['short']} to {p['dest']} Reefer Rates This Week (USDA)", f"{p['short']} to {p['dest']} Reefer Rates This Week",
                  f"{p['short']} to {p['dest']} Reefer Rates")
        if os.path.exists(f):
            ensure_front(f, "seo_title", seo)
            continue
        title = f"{p['short']} to {p['dest']} reefer rates"
        desc = fit(f"USDA's weekly spot rates for a reefer truck from {p['short']} to {p['dest']}: the latest rate, every week on record, and every origin into {p['dest']}.",
                   f"USDA's weekly spot rates for a reefer truck from {p['short']} to {p['dest']}: the latest rate and every week on record.", limit=160)
        with open(f, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(f"---\nlane: {slug}\ntitle: {json.dumps(title, ensure_ascii=False)}\nseo_title: {json.dumps(seo, ensure_ascii=False)}\n"
                     f"description: {json.dumps(desc, ensure_ascii=False)}\n---\n")

    return {"generated": cur["updated"], "latest": latest, "week": week_of(latest), "first": week_of(record[0] + "-01") if record else week_of(latest),
            "first_iso": min(x[0] for weeks in lanes.values() for x in weeks), "record_months": len(record),
            "backfill_done": complete, "diesel": diesel, "lanes": pages, "history": history,
            "published": full_date(pub) if pub else "", "next_due": f"{due:%a}, {full_date(due)}",
            "summary": " ".join(parts), "ups": [public(x) for x in ups], "downs": [public(x) for x in downs],
            "capacity": capacity, "city_tables": city_tables, "seasons": seasons, "lookup": lookup,
            "cities": [{"name": c, "code": CITY_CODES.get(c, c[:3].upper())} for c in cities], "sheet": sheet, "also": also,
            "quoted": len(cells), "origin_count": len(sheet), "lane_count": len(pages),
            "row_count": sum(len(w) for w in lanes.values())}


# ------------------------------------------------------------------- the boxed beef board ----
# /beef-prices/ and a page per cut (/beef-prices/<slug>/), from USDA's own archive. USDA keeps every
# report and its datamart serves any date range with no key, so neither the Worker nor this script
# logs a history of its own: the CSV downloads are read back first (they hold every day already
# fetched), and only the months they don't settle are asked of USDA, which on an ordinary run is the
# last month or two. The Worker keeps just the newest report, for the page script that shows a new
# report within half an hour of USDA posting it (beef-prices/live.js).

BEEF_DIR = os.path.join(ROOT, "beef-prices")
BEEF_CUTS_DIR = os.path.join(ROOT, "_beef_cuts")
BEEF_CUTS_ES_DIR = os.path.join(ROOT, "_beef_cuts_es")
BEEF_CUTOUT_CSV = os.path.join(BEEF_DIR, "boxed-beef-cutout-daily.csv")
BEEF_YEAR_CSV = lambda y: os.path.join(BEEF_DIR, f"boxed-beef-cut-prices-{y}.csv")
BEEF_PAGE_DAYS = 26                          # days with a price in the last year before an item gets a page
BEEF_RECENT_DAYS = 45                        # months this close to the newest day are always re-read (USDA corrects)
BEEF_START = date(2020, 1, 1)                # how far back the history goes; earlier years exist if ever wanted
BEEF_USDA = "https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2453"
BEEF_MOVER_TRADES = 10                       # trades a cut needs today to count as a mover (thin days are noise)
PRIMALS_ES = {"rib": "Costillar", "chuck": "Espaldilla", "round": "Pierna", "loin": "Lomo", "brisket": "Pecho", "plate": "Plato", "flank": "Falda", "": "Otros cortes"}
SECTIONS_ES = {"primal": "Valor del primal", "cut": "Corte de res en caja", "mixed": "Corte vendido sin grado", "ground": "Carne molida",
               "blended": "Carne molida mezclada", "trim": "Recortes"}
PRIMALS = [("rib", "Rib"), ("chuck", "Chuck"), ("round", "Round"), ("loin", "Loin"), ("brisket", "Brisket"), ("plate", "Short plate"), ("flank", "Flank")]
PRIMAL_ITEM = {"rib": "Primal Rib", "chuck": "Primal Chuck", "round": "Primal Round", "loin": "Primal Loin",
               "brisket": "Primal Brisket", "plate": "Primal Plate", "flank": "Primal Flank"}
SECTIONS = {"primal": "Primal value", "cut": "Boxed beef cut", "mixed": "Cut sold without a grade", "ground": "Ground beef",
            "blended": "Blended ground beef", "trim": "Trimmings"}
GRADE_NAMES = {"choice": "Choice", "select": "Select", "": "Price"}
# USDA's fat limitation codes, from its boxed beef reports' key (the number after the IMPS number).
FAT = {1: "3/4 inch average fat, 1 inch at most", 2: "1/4 inch average fat, 1/2 inch at most", 3: "1/8 inch average fat, 1/4 inch at most",
       4: "practically free of fat (at least 75% of the surface lean)", 5: "peeled or denuded", 6: "peeled or denuded, with the surface membrane removed"}
MONTH_ABBR = [m[:3] for m in MONTHS]

usd = lambda v: "" if v is None else f"${v:,.2f}"
per_lb = lambda v: "" if v is None else f"${v / 100:,.2f}"
iso_day = lambda s: datetime.fromisoformat(s)
d_label = lambda s: day_label(iso_day(s))                  # Fri, Oct 16
d_full = lambda s: full_date(iso_day(s))                   # Oct 16, 2026
DIAS_ES = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]
d_label_es = lambda s: f"{DIAS_ES[iso_day(s).weekday()]} {iso_day(s).day} {MONTHS_ES[iso_day(s).month - 1]}"   # vie 16 oct
d_full_es = lambda s: f"{iso_day(s).day} {MONTHS_ES[iso_day(s).month - 1]} {iso_day(s).year}"                # 16 oct 2026
DAYS_ES_WORDS = {"days it traded": "días con ventas", "business days": "días hábiles", "weeks": "semanas", "weeks it traded": "semanas con ventas"}


def money_change(a, b):
    if a is None or b is None: return ""
    d = round(a - b, 2)
    return "±$0.00" if d == 0 else f"{'+' if d > 0 else '−'}${abs(d):,.2f}"


def pct_change(a, b):
    if a is None or not b: return ""
    p = round((a - b) / b * 100, 1)
    return "0.0%" if p == 0 else f"{'+' if p > 0 else '−'}{abs(p):.1f}%"


def next_business_day(s):
    d = iso_day(s) + timedelta(days=1)
    while d.weekday() >= 5: d += timedelta(days=1)
    return d


def cut_names():
    d = json.load(open(os.path.join(ROOT, "_data", "beef_cuts.json"), encoding="utf-8"))
    d.pop("_about", None)
    return d


def beef_usda(first, last):
    """USDA's whole report (allSections) for every business day from `first` to `last`, as
    days {day: [day, choice, select, choice_loads, select_loads, trim_loads, coarse_loads]},
    items {(section, item, grade): {day: [day, low, high, wavg, trades, lbs]}} and published
    {day: USDA's timestamp}. The same rules as parse() in worker/src/beef.js: a cut that didn't
    trade (USDA's $0.00) is no row, and runs of spaces in a description are made one."""
    q = f"q=report_date={first:%m/%d/%Y}:{last:%m/%d/%Y}&allSections=true"
    req = urllib.request.Request(f"{BEEF_USDA}?{q}", headers={"User-Agent": "site-snapshot (github.com/JuanTorresMI)", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        body = json.load(r)
    by = {sec.get("reportSection"): sec.get("results") or [] for sec in (body if isinstance(body, list) else [body])}
    def num(v):
        try: return None if v in (None, "") else float(str(v).replace(",", ""))
        except ValueError: return None
    tidy = lambda v: " ".join(str(v or "").split())
    day = lambda r: datetime.strptime(str(r["report_date"]).split(" ")[0], "%m/%d/%Y").date().isoformat()
    days, items, published = {}, {}, {}
    for r in by.get("Summary", []): published[day(r)] = r.get("published_date") or ""
    vol = {day(r): r for r in by.get("Current Volume", [])}
    for r in by.get("Current Cutout Values", []):
        d, v = day(r), vol.get(day(r), {})
        days[d] = [d, num(r.get("choice_600_900_current")), num(r.get("select_600_900_current")), num(v.get("choice_volume_loads")),
                   num(v.get("select_volume_loads")), num(v.get("trimmings_volume_loads")), num(v.get("coarse_volume_loads"))]
    for r in by.get("Composite Primal Values", []):
        for grade, v in (("choice", num(r.get("choice_600_900"))), ("select", num(r.get("select_600_900")))):
            if tidy(r.get("primal_desc")) and v: items.setdefault(("primal", tidy(r["primal_desc"]), grade), {})[day(r)] = [day(r), None, None, v, None, None]
    for name, section, grade, field in (("Choice Cuts", "cut", "choice", "item_description"), ("Select Cuts", "cut", "select", "item_description"),
                                        ("Choice and Select Cuts", "mixed", "", "trim_description"), ("Ground Beef", "ground", "", "trim_description"),
                                        ("Blended Ground Beef", "blended", "", "trim_description"), ("Beef Trimmings", "trim", "", "trim_description")):
        for r in by.get(name, []):
            wavg, item = num(r.get("weighted_average")), tidy(r.get(field))
            if not item or not wavg: continue
            n = lambda k: None if num(r.get(k)) is None else int(num(r.get(k)))
            items.setdefault((section, item, grade), {})[day(r)] = [day(r), num(r.get("price_range_low")) or None, num(r.get("price_range_high")) or None, wavg, n("number_trades"), n("total_pounds")]
    days = {d: v for d, v in days.items() if v[1] is not None or any(d in rows for rows in items.values())}
    return days, items, published


def beef_archive():
    """The committed CSVs read back: days {day: [day, choice, select, choice_loads, select_loads,
    trim_loads, coarse_loads]} and items {(section, item, grade): {day: [day, low, high, wavg, trades, lbs]}}."""
    days, items = {}, {}
    f = lambda r, k: None if r.get(k, "") == "" else float(r[k])
    n = lambda r, k: None if r.get(k, "") == "" else int(float(r[k]))
    if os.path.exists(BEEF_CUTOUT_CSV):
        with open(BEEF_CUTOUT_CSV, encoding="utf-8", newline="") as fh:
            for r in csv.DictReader(fh):
                d = r["date"]
                days[d] = [d, f(r, "choice_cutout"), f(r, "select_cutout"), f(r, "choice_loads"), f(r, "select_loads"), f(r, "trimmings_loads"), f(r, "coarse_ground_loads")]
                for k, _ in PRIMALS:
                    for g in ("choice", "select"):
                        v = f(r, f"{k}_{g}")
                        if v: items.setdefault(("primal", PRIMAL_ITEM[k], g), {})[d] = [d, None, None, v, None, None]
    year = 2000
    while year <= datetime.now().year + 1:
        p = BEEF_YEAR_CSV(year)
        if os.path.exists(p):
            with open(p, encoding="utf-8", newline="") as fh:
                for r in csv.DictReader(fh):
                    items.setdefault((r["section"], r["usda_description"], r["grade"]), {})[r["date"]] = [
                        r["date"], f(r, "low"), f(r, "high"), f(r, "weighted_average"), n(r, "trades"), n(r, "pounds")]
        year += 1
    return days, items


def standing(prior, value, days="days it traded"):
    """How today's price ranks against the other days of the past year, in words."""
    prior = [v for v in prior if v is not None]
    if value is None or len(prior) < (10 if days.startswith("week") else 20):
        return {"text": "Too few days on record yet to say how this price compares.", "tag": "", "pos": None,
                "text_es": "Todavía hay muy pocos datos para decir cómo se compara este precio.", "tag_es": ""}
    n, lower, higher = len(prior), sum(1 for p in prior if p < value), sum(1 for p in prior if p > value)
    es = DAYS_ES_WORDS.get(days, days)
    if lower == n: text, text_es = f"Higher than on any of the other {n} {days} in the past year.", f"Más alto que en cualquiera de los otros {n} {es} del último año."
    elif higher == n: text, text_es = f"Lower than on any of the other {n} {days} in the past year.", f"Más bajo que en cualquiera de los otros {n} {es} del último año."
    else: text, text_es = f"Higher than on {lower} of the other {n} {days} in the past year.", f"Más alto que en {lower} de los otros {n} {es} del último año."
    hi, lo = lower / n > 2 / 3, lower / n < 1 / 3
    tag = "On the high side" if hi else "On the low side" if lo else "About average"
    tag_es = "Del lado alto" if hi else "Del lado bajo" if lo else "Cerca del promedio"
    return {"text": text, "tag": tag, "pos": round(lower / n * 100), "text_es": text_es, "tag_es": tag_es}


def near(rows, target, slack=5):
    """The row nearest a date, within `slack` days of it (rows are [day, ...] sorted by day)."""
    t = iso_day(target)
    best = min(rows, key=lambda r: abs((iso_day(r[0]) - t).days), default=None)
    return best if best and abs((iso_day(best[0]) - t).days) <= slack else None


def on_or_before(rows, target, within=14):
    """The last row on or before a date, if it is no more than `within` days before it."""
    t = iso_day(target)
    for r in reversed(rows):
        d = iso_day(r[0])
        if d <= t: return r if (t - d).days <= within else None
    return None


def beef_chart(lines, fmt, w=640, h=220, pad=8, weekly=False):
    """Several price lines on one scale, as SVG paths. lines = [(class, label, [(day, value)])].
    Weekly averages the days of each week (Monday to Friday); a line breaks where it has no point
    for more than three weeks, so a cut that stopped trading is drawn with a gap, not a ramp."""
    series, seen = [], []
    for cls, label, pts in lines:
        pts = [(d, v) for d, v in pts if v is not None]
        seen += [pts[0][0], pts[-1][0]] if pts else []
        if weekly:
            wk = {}
            for d, v in pts:
                monday = (iso_day(d) - timedelta(days=iso_day(d).weekday())).date().isoformat()
                wk.setdefault(monday, []).append(v)
            pts = [(k, sum(v) / len(v)) for k, v in sorted(wk.items())]
        if len(pts) >= 2: series.append((cls, label, pts))
    if not series: return None
    t0 = min(iso_day(s[2][0][0]) for s in series)
    t1 = max(iso_day(s[2][-1][0]) for s in series)
    lo = min(v for s in series for _, v in s[2])
    hi = max(v for s in series for _, v in s[2])
    if hi == lo: hi = lo + 1
    span_days = max((t1 - t0).days, 1)
    X = lambda d: round(pad + (iso_day(d) - t0).days / span_days * (w - 2 * pad), 1)
    Y = lambda v: round(h - pad - (v - lo) / (hi - lo) * (h - 2 * pad), 1)
    out = []
    for cls, label, pts in series:
        path, prev = "", None
        for d, v in pts:
            gap = prev is None or (iso_day(d) - iso_day(prev)).days > 21
            path += (" M" if gap else " L") + f"{X(d)},{Y(v)}"
            prev = d
        out.append({"cls": cls, "label": label, "d": path.strip()})
    # The dates name the first and last day with a price, not the Monday of their week.
    return {"w": w, "h": h, "lines": out, "top": fmt(hi), "bottom": fmt(lo), "start": d_full(min(seen)), "end": d_full(max(seen)),
            "start_es": d_full_es(min(seen)), "end_es": d_full_es(max(seen))}


def monthly(rows):
    """[day, low, high, wavg, trades, lbs] rows -> {(year, month): average}, weighted by pounds where
    USDA gives them (a day that moved 700,000 lb counts for more than one that moved 4,000)."""
    acc = {}
    for r in rows:
        if r[3] is None: continue
        k = (int(r[0][:4]), int(r[0][5:7]))
        wt = r[5] if r[5] else 1
        a = acc.setdefault(k, [0.0, 0.0])
        a[0] += r[3] * wt; a[1] += wt
    return {k: a[0] / a[1] for k, a in acc.items() if a[1]}


def year_grid(months_avg, fmt):
    """The monthly averages as a year-by-month table, newest year first, with each year's average."""
    if not months_avg: return []
    years = sorted({y for y, _ in months_avg}, reverse=True)
    rows = []
    for y in years:
        vals = [months_avg.get((y, m)) for m in range(1, 13)]
        have = [v for v in vals if v is not None]
        rows.append({"year": y, "cells": [fmt(v) if v is not None else "" for v in vals], "avg": fmt(sum(have) / len(have)) if have else ""})
    return rows


def seasons(months_avg, latest):
    """Each calendar month against its own year's average, the median over the full years on record.
    Prices drift a long way in six years; comparing a month to its own year takes the drift out. The
    median, not the mean, so one wild year can't make a season: May 2020, when plants closed and the
    cutout hit its record, would otherwise make every May look 15% dear. Needs three full years."""
    full = []
    for y in sorted({y for y, _ in months_avg}):
        vals = [months_avg.get((y, m)) for m in range(1, 13)]
        if y < int(latest[:4]) and sum(1 for v in vals if v is not None) >= 11:
            have = [v for v in vals if v is not None]
            mean = sum(have) / len(have)
            full.append((y, [None if v is None else (v / mean - 1) * 100 for v in vals]))
    if len(full) < 3: return None
    def median(xs):
        xs = sorted(xs); n = len(xs)
        return None if not n else xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2
    idx = [median([row[m] for _, row in full if row[m] is not None]) for m in range(12)]
    known = [(m, v) for m, v in enumerate(idx) if v is not None]
    hi = max(known, key=lambda x: x[1]); lo = min(known, key=lambda x: x[1])
    return {"years": f"{full[0][0]}–{full[-1][0]}", "count": len(full), "high_es": MONTHS_ES_FULL[hi[0]], "low_es": MONTHS_ES_FULL[lo[0]],
            "cells": [{"m": MONTH_ABBR[m], "m_es": MONTHS_ES[m], "v": "" if v is None else f"{'+' if v >= 0.05 else '−' if v <= -0.05 else '±'}{abs(v):.1f}%",
                       "hi": m == hi[0], "lo": m == lo[0]} for m, v in enumerate(idx)],
            "high": MONTHS[hi[0]], "high_v": f"{hi[1]:+.1f}%".replace("-", "−"), "low": MONTHS[lo[0]], "low_v": f"{lo[1]:+.1f}%".replace("-", "−")}


def grade_facts(rows, latest, days="days it traded"):
    """The newest price of one item in one grade, and how it sits against its own past year."""
    last = rows[-1]
    before = rows[-2] if len(rows) > 1 else None
    year_start = (iso_day(latest) - timedelta(days=365)).date().isoformat()
    year = [r for r in rows if r[0] > year_start]
    vals = [r[3] for r in year]
    lo = min(year, key=lambda r: r[3]) if year else None
    hi = max(year, key=lambda r: r[3]) if year else None
    ago = near(rows, (iso_day(last[0]) - timedelta(days=365)).date().isoformat())
    return {
        "current": last[0] == latest, "day": d_label(last[0]), "date": d_full(last[0]), "iso": last[0],
        "day_es": d_label_es(last[0]), "date_es": d_full_es(last[0]), "change_since_es": d_label_es(before[0]) if before else "",
        "low_day_es": d_full_es(lo[0]) if lo else "", "high_day_es": d_full_es(hi[0]) if hi else "",
        "cwt": usd(last[3]), "lb": per_lb(last[3]), "v": last[3],
        "range": "" if last[1] is None or last[2] is None else (usd(last[1]) if last[1] == last[2] else f"{usd(last[1])}–{usd(last[2])}"),
        "trades": "" if last[4] is None else fmt(last[4]), "lbs": "" if last[5] is None else fmt(last[5]),
        "change": money_change(last[3], before[3]) if before else "", "change_pct": pct_change(last[3], before[3]) if before else "",
        "change_since": d_label(before[0]) if before else "",
        "standing": standing([r[3] for r in year if r is not last], last[3], days),
        "year_ago": None if not ago else {"date": d_full(ago[0]), "date_es": d_full_es(ago[0]), "cwt": usd(ago[3]), "lb": per_lb(ago[3]), "change": pct_change(last[3], ago[3])},
        "avg": usd(sum(vals) / len(vals)) if vals else "", "low": usd(lo[3]) if lo else "", "low_day": d_full(lo[0]) if lo else "",
        "high": usd(hi[3]) if hi else "", "high_day": d_full(hi[0]) if hi else "", "days_year": len(year),
    }


def beef():
    names = cut_names()

    # History: the archive (the committed CSVs) first. USDA is asked only for the months it doesn't
    # settle: any month since BEEF_START with nothing in it, and the last BEEF_RECENT_DAYS, which
    # USDA sometimes corrects. On an ordinary run that is one or two requests of about 2 MB each.
    days, items = beef_archive()
    have = {d[:7] for d in days}
    today_ct = datetime.now(ZoneInfo("America/Chicago")).date() if TZ is not timezone.utc else datetime.now(timezone.utc).date()
    recent = ((iso_day(max(days)) - timedelta(days=BEEF_RECENT_DAYS)).date() if days else BEEF_START).isoformat()[:7]
    published, fetched = {}, 0
    y, m = BEEF_START.year, BEEF_START.month
    while (y, m) <= (today_ct.year, today_ct.month):
        key = f"{y}-{m:02d}"
        if key not in have or key >= recent:
            first_day, last_day = date(y, m, 1), min(date(y, m, calendar.monthrange(y, m)[1]), today_ct)
            got_days, got_items, got_pub = beef_usda(first_day, last_day)
            fetched += 1
            if got_days:
                for k in items:
                    for d in got_days: items[k].pop(d, None)
                days.update(got_days); published.update(got_pub)
                for k, rows in got_items.items(): items.setdefault(k, {}).update(rows)
        m += 1
        if m > 12: y, m = y + 1, 1
    if not days: raise RuntimeError("USDA returned no boxed beef reports")
    print(f"beef: asked USDA for {fetched} month{'s' if fetched != 1 else ''}")
    series = {k: [v[d] for d in sorted(v)] for k, v in items.items() if v}
    order = sorted(days)
    latest, first = order[-1], order[0]
    complete = (iso_day(first).date() - BEEF_START).days < 7      # the record reaches back to the start
    today, prior = days[latest], (days[order[-2]] if len(order) > 1 else None)

    def info(item):
        if item not in names:
            print(f"beef: add {item!r} to _data/beef_cuts.json", file=sys.stderr)
            names[item] = {"name": item, "slug": slugify(item), "es": item, "slug_es": slugify(item) + "-es"}
        return names[item]

    # Every item, its grades together: {(section, item): {grade: rows}}.
    by_item = {}
    for (section, item, grade), rows in series.items():
        by_item.setdefault((section, item), {})[grade] = rows
    year_start = (iso_day(latest) - timedelta(days=365)).date().isoformat()
    grade_order = {"choice": 0, "select": 1, "": 2}

    # ---- the item pages
    def tool_grade(g, rows):
        """What a cut page's price check needs for one grade, in dollars per hundredweight: the
        latest day's average and range, the last 30 days' range of averages, and every daily average
        of the past year, sorted, to say where a quoted price would have ranked."""
        last = rows[-1]
        since30 = (iso_day(last[0]) - timedelta(days=30)).date().isoformat()
        d30 = [r[3] for r in rows if r[0] > since30]
        return {"key": g, "grade": GRADE_NAMES.get(g, g), "date": d_full(last[0]), "current": last[0] == latest,
                "v": last[3], "low": last[1], "high": last[2], "d30": [min(d30), max(d30)] if d30 else None,
                "year": sorted(round(r[3], 2) for r in rows if r[0] > year_start)}

    pages = {}
    for (section, item), grades in by_item.items():
        traded = {r[0] for rows in grades.values() for r in rows if r[0] > year_start}
        if section != "primal" and len(traded) < BEEF_PAGE_DAYS and not os.path.exists(os.path.join(BEEF_CUTS_DIR, info(item)["slug"] + ".md")):
            continue
        i = info(item)
        gs = sorted(grades, key=lambda g: grade_order.get(g, 3))
        main = gs[0]
        facts = [{"grade": g, "label": GRADE_NAMES.get(g, g), "label_es": GRADE_NAMES.get(g, g) if g else "Precio", **grade_facts(grades[g], latest, "business days" if section == "primal" else "days it traded")} for g in gs]
        lines = [("line" if n == 0 else "line2", GRADE_NAMES.get(g, g), [(r[0], r[3]) for r in grades[g]]) for n, g in enumerate(gs)]
        mavg = monthly(grades[main])
        # The last 20 days it traded, in any grade, newest first.
        recent_days = sorted({r[0] for g in gs for r in grades[g]})[-20:][::-1]
        lookup = {g: {r[0]: r for r in grades[g]} for g in gs}
        rows = []
        for d in recent_days:
            cells = [lookup[g].get(d) for g in gs]
            rows.append({"day": d_full(d), "day_es": d_full_es(d), "cells": [{"cwt": usd(c[3]) if c else "", "lb": per_lb(c[3]) if c else "",
                                                       "range": "" if not c or c[1] is None or c[2] is None else f"{usd(c[1])}–{usd(c[2])}",
                                                       "lbs": "" if not c or c[5] is None else fmt(c[5]), "trades": "" if not c or c[4] is None else fmt(c[4])} for c in cells]})
        all_days = sorted({r[0] for g in gs for r in grades[g]})
        pk = i.get("primal")
        pages[i["slug"]] = {
            "name": i["name"], "es": i.get("es", i["name"]), "slug_es": i.get("slug_es", i["slug"]), "also_es": i.get("also_es", ""),
            "kind_es": SECTIONS_ES.get(section, section), "primal_name_es": PRIMALS_ES.get(pk or "", "") if pk else "", "since_es": d_full_es(all_days[0]),
            "main_es": GRADE_NAMES.get(main, main) if main else "Precio", "heads_es": [GRADE_NAMES.get(g, g) if g else "Precio" for g in gs],
            "usda": item, "section": section, "kind": SECTIONS.get(section, section),
            "imps": i.get("imps", ""), "fl": i.get("fl"), "fat": FAT.get(i.get("fl"), ""), "also": i.get("also", ""),
            "primal": pk or "", "primal_name": dict(PRIMALS).get(pk, ""), "grades": facts, "main": GRADE_NAMES.get(main, main),
            "current": any(f["current"] for f in facts), "last_iso": max(f["iso"] for f in facts),
            "since": d_full(all_days[0]), "first_iso": all_days[0], "days_all": fmt(len(all_days)), "days_year": len(traded),
            "chart": beef_chart(lines, usd, weekly=True),
            "grid": year_grid(mavg, lambda v: f"{v / 100:,.2f}" if section != "primal" else f"{v:,.0f}"),
            "grid_unit": "$ per lb" if section != "primal" else "$ per cwt",
            "season": seasons(mavg, latest),
            "heads": [GRADE_NAMES.get(g, g) for g in gs], "rows": rows,
            "tool": [tool_grade(g, grades[g]) for g in gs],
        }

    # Where each item sits: the primal it comes from, and what else from there traded today.
    slug_of = {(s, it): info(it)["slug"] for (s, it) in by_item}
    today_price = {}
    for (section, item), grades in by_item.items():
        g = "choice" if "choice" in grades else sorted(grades, key=lambda x: grade_order.get(x, 3))[0]
        last = grades[g][-1]
        if last[0] == latest: today_price[(section, item)] = (g, last)
    for slug, pg in pages.items():
        if not pg["primal"]: pg["siblings"] = []; continue
        sib = []
        for (section, item), (g, last) in today_price.items():
            if section in ("cut", "mixed") and info(item).get("primal") == pg["primal"] and slug_of[(section, item)] in pages:
                sib.append({"name": info(item)["name"], "es": info(item).get("es", info(item)["name"]), "slug_es": info(item).get("slug_es", ""),
                            "slug": slug_of[(section, item)], "lb": per_lb(last[3]), "grade": GRADE_NAMES.get(g, g),
                            "here": slug_of[(section, item)] == slug, "v": last[3]})
        pg["siblings"] = [{k: v for k, v in s.items() if k != "v"} for s in sorted(sib, key=lambda s: -s["v"])]
        pv = series.get(("primal", PRIMAL_ITEM[pg["primal"]], "choice"))
        pg["primal_slug"] = slug_of.get(("primal", PRIMAL_ITEM[pg["primal"]]), "")
        pg["primal_slug_es"] = info(PRIMAL_ITEM[pg["primal"]]).get("slug_es", "")
        pg["primal_value"] = usd(pv[-1][3]) if pv and pv[-1][0] == latest else ""

    # ---- the board: the cutout
    cday = [(d, days[d][1]) for d in order if days[d][1] is not None]
    sday = [(d, days[d][2]) for d in order if days[d][2] is not None]
    c, s = today[1], today[2]
    pc, ps = (prior[1], prior[2]) if prior else (None, None)
    spread = None if c is None or s is None else c - s
    loads = [today[i] for i in (3, 4, 5, 6)]
    say = lambda a, b, tail="": "" if a is None or b is None else ("unchanged" + tail if round(a - b, 2) == 0 else f"{'up' if a > b else 'down'} {usd(abs(a - b))}{tail}")
    weekday = f"{iso_day(latest):%A}, {iso_day(latest):%B} {iso_day(latest).day}"
    parts = [f"On {weekday}, the Choice cutout was {usd(c)} per hundredweight" + (f", {say(c, pc, ' from the day before')}" if say(c, pc) else "") +
             f", and Select was {usd(s)}" + (f", {say(s, ps)}" if say(s, ps) else "") + "."]
    weekday_es = f"{['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'][iso_day(latest).weekday()]} {iso_day(latest).day} de {MONTHS_ES_FULL[iso_day(latest).month - 1]}"
    say_es = lambda a, b, tail="": "" if a is None or b is None else ("sin cambio" + tail if round(a - b, 2) == 0 else f"{'un alza' if a > b else 'una baja'} de {usd(abs(a - b))}{tail}")
    parts_es = [f"El {weekday_es}, el valor del corte (cutout) Choice fue de {usd(c)} por quintal (cwt)" + (f", {say_es(c, pc, ' frente al día anterior')}" if say_es(c, pc) else "") +
                f", y el Select de {usd(s)}" + (f", {say_es(s, ps)}" if say_es(s, ps) else "") + "."]
    if spread is not None: parts_es.append(f"El Choice estuvo {usd(spread)} por encima del Select.")
    if loads[0] is not None and loads[1] is not None:
        parts_es.append(f"Los empacadores vendieron {fmt(round(loads[0]))} cargas de cortes Choice y {fmt(round(loads[1]))} de Select en tratos negociados ese día.")
    if spread is not None: parts.append(f"Choice ran {usd(spread)} over Select.")
    if loads[0] is not None and loads[1] is not None:
        parts.append(f"Packers sold {fmt(round(loads[0]))} loads of Choice cuts and {fmt(round(loads[1]))} of Select on negotiated deals that day"
                     + (f", plus {fmt(round(loads[2]))} of trimmings and {fmt(round(loads[3]))} of coarse ground beef." if loads[2] is not None and loads[3] is not None else "."))
    year_c = [v for d, v in cday if d > year_start]
    hi52 = max(((d, v) for d, v in cday if d > year_start), key=lambda x: x[1])
    lo52 = min(((d, v) for d, v in cday if d > year_start), key=lambda x: x[1])
    rec = max(cday, key=lambda x: x[1])
    ago = near([[d, v] for d, v in cday], (iso_day(latest) - timedelta(days=365)).date().isoformat())
    cutout = {"standing": standing([v for d, v in cday if year_start < d < latest], c, "business days"),
              "high_day_es": d_full_es(hi52[0]), "low_day_es": d_full_es(lo52[0]), "record_day_es": d_full_es(rec[0]),
              "high": usd(hi52[1]), "high_day": d_full(hi52[0]), "low": usd(lo52[1]), "low_day": d_full(lo52[0]),
              "avg": usd(sum(year_c) / len(year_c)), "record": usd(rec[1]), "record_day": d_full(rec[0]),
              "record_now": rec[0] == latest, "carcass_lb": per_lb(c),
              "year_ago": None if not ago else {"date": d_full(ago[0]), "date_es": d_full_es(ago[0]), "cwt": usd(ago[1]), "change": pct_change(c, ago[1])}}
    chart_year = beef_chart([("line", "Choice", [x for x in cday if x[0] > year_start]), ("line2", "Select", [x for x in sday if x[0] > year_start])], usd)
    chart_all = beef_chart([("line", "Choice", cday), ("line2", "Select", sday)], usd, weekly=True)
    recent = []
    for n, d in enumerate(order[::-1][:10]):
        r, p = days[d], (days[order[-2 - n]] if len(order) > n + 1 else None)
        recent.append({"day": d_label(d), "day_es": d_label_es(d), "choice": usd(r[1]), "choice_chg": money_change(r[1], p[1]) if p else "",
                       "select": usd(r[2]), "select_chg": money_change(r[2], p[2]) if p else "",
                       "spread": usd(r[1] - r[2]) if r[1] is not None and r[2] is not None else "",
                       "loads": fmt(round(r[3] + r[4])) if r[3] is not None and r[4] is not None else ""})
    cmonths = monthly([[d, None, None, v, None, None] for d, v in cday])

    # The primal values.
    primals = []
    for k, label in PRIMALS:
        ch, se = series.get(("primal", PRIMAL_ITEM[k], "choice"), []), series.get(("primal", PRIMAL_ITEM[k], "select"), [])
        if not ch or ch[-1][0] != latest: continue
        primals.append({"name": label, "es": PRIMALS_ES[k], "slug": slug_of.get(("primal", PRIMAL_ITEM[k]), ""), "slug_es": info(PRIMAL_ITEM[k]).get("slug_es", ""),
                        "choice": usd(ch[-1][3]), "choice_chg": money_change(ch[-1][3], ch[-2][3]) if len(ch) > 1 else "",
                        "select": usd(se[-1][3]) if se and se[-1][0] == latest else "",
                        "select_chg": money_change(se[-1][3], se[-2][3]) if len(se) > 1 and se[-1][0] == latest else ""})

    # Every cut that traded today, by primal; then the ones that didn't.
    def traded_today(grades, g):
        rows = grades.get(g)
        return rows[-1] if rows and rows[-1][0] == latest else None

    def row(section, item):
        grades = by_item[(section, item)]
        ch, se, un = traded_today(grades, "choice"), traded_today(grades, "select"), traded_today(grades, "")
        main, sold = ch or un, [x for x in (ch, se, un) if x]
        total = lambda i: fmt(sum(x[i] for x in sold if x[i])) if any(x[i] for x in sold) else ""
        # The main price against the same grade's on the last day a week or more before.
        g = "choice" if ch else ""
        then = on_or_before(grades.get(g, [])[:-1], (iso_day(latest) - timedelta(days=7)).date().isoformat()) if main and grades.get(g) else None
        i = info(item)
        words = " ".join(x for x in (i["name"], i.get("imps", ""), i.get("also", ""), dict(PRIMALS).get(i.get("primal") or "", ""), item) if x)
        words = words + " " + " ".join(x for x in (i.get("es", ""), i.get("also_es", "")) if x)
        return {"name": i["name"], "es": i.get("es", i["name"]), "also_es": i.get("also_es", ""),
                "slug_es": i.get("slug_es", "") if slug_of[(section, item)] in pages else "", "grade_es": "Choice" if ch else ("Cualquier grado" if section == "mixed" else "Precio" if un else "Select"),
                "slug": slug_of[(section, item)] if slug_of[(section, item)] in pages else "",
                "imps": i.get("imps", ""), "fl": i.get("fl", ""), "also": i.get("also", ""), "find": " ".join(words.lower().replace(",", " ").split()),
                "week": pct_change(main[3], then[3]) if main and then else "", "then_v": then[3] if main and then else None,
                "grade": "Choice" if ch else ("Any grade" if section == "mixed" else "Price" if un else "Select"),
                "price": usd(main[3]) if main else "", "price_lb": per_lb(main[3]) if main else "",
                "select": usd(se[3]) if se else "", "select_lb": per_lb(se[3]) if se else "",
                "lbs": total(5), "trades": total(4), "traded": bool(sold), "ungraded": section == "mixed", "v": (main or se)[3] if sold else 0}
    groups, quiet = [], []
    for k, label in PRIMALS + [("", "Other cuts")]:
        rows = []
        for (section, item) in by_item:
            if section not in ("cut", "mixed") or (info(item).get("primal") or "") != k: continue
            r = row(section, item)
            if r["traded"]: rows.append(r)
            elif r["slug"]:
                last = max(rows_[-1][0] for rows_ in by_item[(section, item)].values())
                quiet.append({"name": r["name"], "es": r["es"], "slug": r["slug"], "slug_es": r["slug_es"], "last": d_full(last), "last_es": d_full_es(last)})
        if rows: groups.append({"name": label, "es": PRIMALS_ES[k], "key": k, "rows": sorted(rows, key=lambda r: -r["v"])})
    ground = [row(section, item) for (section, item) in by_item if section in ("ground", "blended", "trim")]
    ground = sorted([g for g in ground if g["traded"]], key=lambda r: -r["v"])

    # Movers: today's weighted average against the same cut a week earlier, busy cuts only.
    moves = []
    for (section, item, grade), rows in series.items():
        if section not in ("cut", "mixed") or grade == "select" or rows[-1][0] != latest or (rows[-1][4] or 0) < BEEF_MOVER_TRADES: continue
        then = on_or_before(rows[:-1], (iso_day(latest) - timedelta(days=7)).date().isoformat())
        if not then: continue
        p = (rows[-1][3] - then[3]) / then[3] * 100
        moves.append({"name": info(item)["name"], "es": info(item).get("es", ""), "slug_es": info(item).get("slug_es", "") if slug_of[(section, item)] in pages else "",
                      "slug": slug_of[(section, item)] if slug_of[(section, item)] in pages else "",
                      "lb": per_lb(rows[-1][3]), "then": per_lb(then[3]), "then_day": d_label(then[0]), "change": pct_change(rows[-1][3], then[3]), "p": p})
    ups = [{k: v for k, v in m.items() if k != "p"} for m in sorted([m for m in moves if m["p"] >= 0.5], key=lambda m: -m["p"])[:6]]
    downs = [{k: v for k, v in m.items() if k != "p"} for m in sorted([m for m in moves if m["p"] <= -0.5], key=lambda m: m["p"])[:6]]

    # The index of every page, grouped the way a meat case is.
    index = []
    ent = lambda sl: {"name": pages[sl]["name"], "slug": sl, "imps": pages[sl]["imps"], "es": pages[sl]["es"], "slug_es": pages[sl]["slug_es"]}
    for k, label in PRIMALS:
        entries = sorted([slug for slug, pg in pages.items() if pg["primal"] == k and pg["section"] != "primal"], key=lambda sl: pages[sl]["name"])
        prim = next((slug for slug, pg in pages.items() if pg["section"] == "primal" and pg["primal"] == k), None)
        index.append({"name": label, "es": PRIMALS_ES[k], "primal": prim, "primal_es": pages[prim]["slug_es"] if prim else None, "pages": [ent(sl) for sl in entries]})
    other = sorted([slug for slug, pg in pages.items() if not pg["primal"] and pg["section"] in ("cut", "mixed")], key=lambda sl: pages[sl]["name"])
    if other: index.append({"name": "Other cuts", "es": "Otros cortes", "primal": None, "primal_es": None, "pages": [ent(sl) for sl in other]})
    grinds = sorted([slug for slug, pg in pages.items() if pg["section"] in ("ground", "blended", "trim")], key=lambda sl: pages[sl]["name"])
    if grinds: index.append({"name": "Ground beef and trimmings", "es": "Carne molida y recortes", "primal": None, "primal_es": None, "pages": [ent(sl) for sl in grinds]})

    # ---- the downloads, which are also the archive the next run reads back
    os.makedirs(BEEF_DIR, exist_ok=True)
    num2 = lambda v: "" if v is None else f"{v:.2f}"
    numi = lambda v: "" if v is None else str(int(v))
    with open(BEEF_CUTOUT_CSV, "w", encoding="utf-8", newline="") as fh:
        wr = csv.writer(fh, lineterminator="\n")
        wr.writerow(["date", "choice_cutout", "select_cutout", "choice_select_spread", "choice_loads", "select_loads", "trimmings_loads", "coarse_ground_loads"]
                    + [f"{k}_{g}" for k, _ in PRIMALS for g in ("choice", "select")])
        for d in order:
            r = days[d]
            prim = []
            for k, _ in PRIMALS:
                for g in ("choice", "select"):
                    x = items.get(("primal", PRIMAL_ITEM[k], g), {}).get(d)
                    prim.append(num2(x[3]) if x else "")
            wr.writerow([d, num2(r[1]), num2(r[2]), num2(r[1] - r[2]) if r[1] is not None and r[2] is not None else "",
                         num2(r[3]), num2(r[4]), num2(r[5]), num2(r[6])] + prim)
    downloads = [{"file": os.path.basename(BEEF_CUTOUT_CSV), "label": f"The cutout and primal values, every day since {d_full(first)}",
                  "label_es": f"El valor del corte y de los primales, cada día desde el {d_full_es(first)}",
                  "rows": fmt(len(order)), "kb": fmt(round(os.path.getsize(BEEF_CUTOUT_CSV) / 1024))}]
    sec_order = {"cut": 0, "mixed": 1, "ground": 2, "blended": 3, "trim": 4}
    flat = sorted(((r[0], sec_order.get(sec, 9), sec, item, grade, r) for (sec, item, grade), rows in series.items() if sec != "primal" for r in rows),
                  key=lambda x: x[:2] + (x[3], grade_order.get(x[4], 3)))
    for y, grp in groupby(flat, key=lambda x: x[0][:4]):
        grp = list(grp)
        with open(BEEF_YEAR_CSV(y), "w", encoding="utf-8", newline="") as fh:
            wr = csv.writer(fh, lineterminator="\n")
            wr.writerow(["date", "section", "usda_description", "name", "imps", "fat_limitation", "primal", "grade",
                         "low", "high", "weighted_average", "weighted_average_per_lb", "trades", "pounds"])
            for d, _, sec, item, grade, r in grp:
                i = info(item)
                wr.writerow([d, sec, item, i["name"], i.get("imps", ""), i.get("fl", ""), i.get("primal", ""), grade,
                             num2(r[1]), num2(r[2]), num2(r[3]), "" if r[3] is None else f"{r[3] / 100:.4f}", numi(r[4]), numi(r[5])])
        downloads.append({"file": os.path.basename(BEEF_YEAR_CSV(y)), "label": f"Every cut, every day of {y}" + (" so far" if y == latest[:4] else ""),
                          "label_es": f"Cada corte, cada día de {y}" + (" hasta hoy" if y == latest[:4] else ""),
                          "rows": fmt(len(grp)), "kb": fmt(round(os.path.getsize(BEEF_YEAR_CSV(y)) / 1024)), "year": y})
    downloads = downloads[:1] + sorted(downloads[1:], key=lambda x: x["year"], reverse=True)

    # ---- page stubs: new ones only, never deleted, so a cut that stops trading keeps its address
    os.makedirs(BEEF_CUTS_DIR, exist_ok=True)
    for slug, pg in pages.items():
        f = os.path.join(BEEF_CUTS_DIR, slug + ".md")
        code = f" ({pg['imps']})" if pg["imps"] else ""
        if pg["section"] == "primal":
            title = f"Beef {pg['primal_name'].lower()} primal value"
            seo = fit(f"Beef {pg['primal_name']} Primal Value Today · USDA Cutout", f"Beef {pg['primal_name']} Primal Value Today")
            desc = f"USDA's daily composite value of the beef {pg['primal_name'].lower()} primal, Choice and Select: the latest value, every day since {pg['since']}, and the cuts it is made of."
        elif pg["section"] in ("ground", "blended", "trim"):
            title = f"{pg['name']} wholesale price"
            seo = fit(f"{pg['name']} Wholesale Price Today · USDA", f"{pg['name']} Wholesale Price Today", f"{pg['name']} Wholesale Price")
            desc = fit(f"USDA's daily wholesale price for {pg['name'].lower()}, per pound and per hundredweight: the latest weighted average and every day since {pg['since']}.",
                       f"USDA's daily wholesale price for {pg['name'].lower()}: the latest weighted average per pound and every day on record.", limit=160)
        else:
            title = f"{pg['name']}{code} wholesale price"
            seo = fit(f"{pg['name']}{code} Wholesale Price Today · USDA", f"{pg['name']}{code} Wholesale Price Today",
                      f"{pg['name']}{code} Wholesale Price", f"{pg['name']} Wholesale Price")
            grades = " and ".join(g["label"] for g in pg["grades"] if g["grade"])
            desc = fit(f"USDA's daily boxed beef price for {pg['name'].lower()}{' (IMPS ' + pg['imps'] + ')' if pg['imps'] else ''}"
                       f"{', ' + grades if grades else ''}: the latest price per pound, every day since {pg['since']}, and its usual seasonal swing.",
                       f"USDA's daily boxed beef price for {pg['name'].lower()}{' (IMPS ' + pg['imps'] + ')' if pg['imps'] else ''}: the latest price per pound and every day since {pg['since']}.",
                       f"USDA's daily boxed beef price for {pg['name'].lower()}: the latest price per pound and every day on record.", limit=160)
        es, ses = pg["es"], pg["slug_es"]
        if pg["section"] == "primal":
            pn = PRIMALS_ES[pg["primal"]]
            title_es = f"{pn} de res: valor del primal"
            seo_es = fit(f"{pn} de res: valor del primal hoy · USDA", f"{pn} de res: valor del primal hoy")
            desc_es = fit(f"El valor diario del primal de {pn.lower()} de res según el USDA, Choice y Select: el último, cada día desde el {pg['since_es']} y los cortes que lo forman.",
                          f"El valor diario del primal de {pn.lower()} de res según el USDA, Choice y Select, desde el {pg['since_es']}.", limit=160)
        else:
            title_es = f"{es}: precio de mayoreo"
            seo_es = fit(f"{es}: precio de la res hoy · USDA", f"{es}: precio hoy · USDA", f"{es}: precio hoy", es)
            low = es[0].lower() + es[1:]
            desc_es = fit(f"El precio de mayoreo diario de {low} según el USDA (carne de res en caja), por libra y por quintal: el último y cada día desde el {pg['since_es']}.",
                          f"Precio de mayoreo diario de {low} según el USDA, por libra: el último y cada día desde el {pg['since_es']}.",
                          f"Precio de mayoreo diario de {low} según el USDA, por libra.", limit=160)
        tr_es = f"/es/precios-de-carne-de-res/{ses}/"
        if os.path.exists(f):
            ensure_front(f, "seo_title", seo)
            ensure_front(f, "translation", tr_es)
        else:
            with open(f, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(f"---\ncut: {slug}\ntitle: {json.dumps(title, ensure_ascii=False)}\nseo_title: {json.dumps(seo, ensure_ascii=False)}\n"
                         f"description: {json.dumps(desc, ensure_ascii=False)}\ntranslation: {json.dumps(tr_es)}\n---\n")
        os.makedirs(BEEF_CUTS_ES_DIR, exist_ok=True)
        fe = os.path.join(BEEF_CUTS_ES_DIR, ses + ".md")
        if not os.path.exists(fe):
            with open(fe, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(f"---\ncut: {slug}\ntitle: {json.dumps(title_es, ensure_ascii=False)}\nseo_title: {json.dumps(seo_es, ensure_ascii=False)}\n"
                         f"description: {json.dumps(desc_es, ensure_ascii=False)}\ntranslation: {json.dumps('/beef-prices/' + slug + '/')}\n---\n")

    pub = None
    try: pub = datetime.strptime((published.get(latest) or "").split(" ")[0], "%m/%d/%Y")
    except ValueError: pass
    due = next_business_day(latest)

    # The newest report as one plain JSON file, for anyone who wants it in code without learning
    # USDA's datamart: plain names, codes and both units, beside the CSVs. Served by GitHub Pages,
    # which allows any site to fetch it. No timestamp of its own, so it only changes with the data.
    feed = {"source": "USDA AMS Livestock Mandatory Reporting, LM_XB403 (National Daily Boxed Beef Cutout & Boxed Beef Cuts, Negotiated Sales, PM)",
            "source_url": "https://mymarketnews.ams.usda.gov/viewReport/2453", "license": "U.S. government data, public domain. Credit USDA AMS.",
            "units": "USD per hundredweight (100 lb) unless a field says per_lb", "report_date": latest, "published": published.get(latest, ""),
            "cutout": {"choice": today[1], "select": today[2], "choice_select_spread": None if today[1] is None or today[2] is None else round(today[1] - today[2], 2)},
            "loads": {"choice": today[3], "select": today[4], "trimmings": today[5], "coarse_ground": today[6]},
            "primals": [{"primal": k, "choice": (items.get(("primal", PRIMAL_ITEM[k], "choice")) or {}).get(latest, [None] * 4)[3],
                         "select": (items.get(("primal", PRIMAL_ITEM[k], "select")) or {}).get(latest, [None] * 4)[3]} for k, _ in PRIMALS],
            "items": [{"name": info(item)["name"], "usda_description": item, "section": sec, "grade": grade, "imps": info(item).get("imps", ""),
                       "fat_limitation": info(item).get("fl"), "primal": info(item).get("primal", ""), "low": r[1], "high": r[2], "weighted_average": r[3],
                       "weighted_average_per_lb": round(r[3] / 100, 4), "trades": r[4], "pounds": r[5],
                       "page": f"https://juantorresmi.github.io/beef-prices/{info(item)['slug']}/" if info(item)["slug"] in pages else None}
                      for (sec, item, grade), rows in sorted(series.items(), key=lambda kv: (kv[0][0], kv[0][1], grade_order.get(kv[0][2], 3)))
                      if sec != "primal" for r in [rows[-1]] if r[0] == latest],
            "history": {"cutout_daily": "https://juantorresmi.github.io/beef-prices/boxed-beef-cutout-daily.csv",
                        "cuts_by_year": [f"https://juantorresmi.github.io/beef-prices/{x['file']}" for x in downloads[1:]]}}
    with open(os.path.join(BEEF_DIR, "latest.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(feed, fh, ensure_ascii=False, indent=1); fh.write("\n")

    return {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "latest": latest, "date": d_full(latest), "day": d_label(latest), "on_day": f"{iso_day(latest):%A}, {d_full(latest)}",
            "date_es": d_full_es(latest), "day_es": d_label_es(latest), "on_day_es": weekday_es, "first_es": d_full_es(first), "summary_es": " ".join(parts_es),
            "next_due_es": f"{DIAS_ES[due.weekday()]} {due.day} {MONTHS_ES[due.month - 1]} {due.year}",
            "published": full_date(pub) if pub else "", "next_due": f"{due:%a}, {full_date(due)}",
            "first_iso": first, "first": d_full(first), "record_days": fmt(len(order)), "backfill_done": complete,
            "stamp": {"choice": usd(c), "choice_chg": money_change(c, pc), "select": usd(s), "select_chg": money_change(s, ps),
                      "spread": usd(spread) if spread is not None else "", "loads": fmt(round(loads[0] + loads[1])) if loads[0] is not None and loads[1] is not None else ""},
            "raw": {"choice": c, "select": s}, "summary": " ".join(parts), "cutout": cutout, "chart_year": chart_year, "chart_all": chart_all, "recent": recent,
            "grid": year_grid(cmonths, lambda v: f"{v:,.0f}"), "season": seasons(cmonths, latest),
            "primals": primals, "groups": groups, "quiet": sorted(quiet, key=lambda q: q["name"]), "ground": ground,
            "ups": ups, "downs": downs, "index": index, "downloads": downloads,
            "traded": sum(len(g["rows"]) for g in groups), "page_count": len(pages), "items": pages}


# ------------------------------------------------------------------- the pork cutout board ----
# /pork-prices/ (and /es/precios-de-cerdo/) and a page per primal and cut, the same way as the beef
# board: USDA's datamart is the archive, the committed CSVs are read back first, and only the months
# they don't settle are asked of USDA. The report is LM_PK602, the National Daily Pork FOB Plant,
# Negotiated Sales, afternoon. It has no grades; every item has one price a day, in dollars per
# hundredweight, with the pounds sold.

PORK_DIR = os.path.join(ROOT, "pork-prices")
PORK_CUTS_DIR = os.path.join(ROOT, "_pork_cuts")
PORK_CUTS_ES_DIR = os.path.join(ROOT, "_pork_cuts_es")
PORK_CUTOUT_CSV = os.path.join(PORK_DIR, "pork-cutout-daily.csv")
PORK_YEAR_CSV = lambda y: os.path.join(PORK_DIR, f"pork-cut-prices-{y}.csv")
PORK_USDA = "https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2498"
PORK_PAGE_DAYS = 26
PORK_MOVER_LBS = 20000                        # pounds a cut needs today to count as a mover
PORK_PRIMALS = [("loin", "Loin", "Lomo"), ("butt", "Butt", "Espaldilla (Boston butt)"), ("picnic", "Picnic", "Paleta picnic"),
                ("rib", "Rib", "Costilla"), ("ham", "Ham", "Pierna"), ("belly", "Belly", "Panceta")]
PORK_TABLES = [("Loin Cuts", "loin"), ("Butt Cuts", "butt"), ("Picnic Cuts", "picnic"), ("Ham Cuts", "ham"), ("Belly Cuts", "belly"),
               ("Sparerib Cuts", "sparerib"), ("Jowl Cuts", "jowl"), ("Trim Cuts", "trim"), ("Variety Cuts", "variety"),
               ("Added Ingredients Cuts", "ai")]
PORK_GROUPS = [("loin", "Loin", "Lomo"), ("butt", "Butt (Boston butt)", "Espaldilla (Boston butt)"), ("picnic", "Picnic shoulder", "Paleta picnic"),
               ("ham", "Ham", "Pierna"), ("belly", "Belly", "Panceta"), ("sparerib", "Spareribs", "Costillas"), ("jowl", "Jowl", "Papada"),
               ("trim", "Trimmings", "Recortes"), ("variety", "Variety meats", "Subproductos"), ("ai", "With added ingredients", "Con ingredientes añadidos")]

# Plain names for USDA's terse descriptions ("1/4 Trim Bnls Butt VAC"). An item is a core (what it
# is) plus qualifiers (bone, trim, weight, lean, pack, frozen, added ingredients), each said in both
# languages. _data/pork_cuts.json holds the result; new items get named with the same rules.
PORK_CORE = {
    "loin": ("Pork loin", "Lomo de cerdo"), "backribs": ("Pork back ribs", "Costillas de lomo (baby back)"),
    "blade ends": ("Pork loin blade ends", "Puntas de lomo, lado de la paleta"),
    "cc strap-off": ("Center-cut pork loin, strap off", "Lomo de cerdo de corte central, sin tira"),
    "cc strap-off, 1/2 cut": ("Center-cut pork loin, strap off, half cut", "Lomo de cerdo de corte central, sin tira, medio corte"),
    "cc strap-on": ("Center-cut pork loin, strap on", "Lomo de cerdo de corte central, con tira"),
    "cc strap-on, 1/2 cut": ("Center-cut pork loin, strap on, half cut", "Lomo de cerdo de corte central, con tira, medio corte"),
    "cc, tender-in loin": ("Center-cut pork loin, tenderloin in", "Lomo de cerdo de corte central, con filete"),
    "cc, tender-in, flon loin": ("Center-cut pork loin, tenderloin in, FLON", "Lomo de cerdo de corte central, con filete, FLON"),
    "riblets": ("Pork riblets", "Costillitas de cerdo"), "sirloin": ("Pork sirloin", "Sirloin de cerdo"),
    "tenderloin": ("Pork tenderloin", "Filete de cerdo"),
    "butt": ("Pork butt", "Espaldilla de cerdo"), "ct butt": ("Pork butt, cellar trim", "Espaldilla de cerdo, recorte cellar"),
    "steak ready butt": ("Steak-ready pork butt", "Espaldilla de cerdo para bistec"),
    "picnic cushion meat": ("Pork picnic cushion meat", "Cojín de paleta de cerdo"),
    "ss smoker trim picnic": ("Pork picnic, smoker trim (SS)", "Paleta picnic de cerdo, recorte para ahumar (SS)"),
    "rs smoker trim picnic": ("Pork picnic, smoker trim (RS)", "Paleta picnic de cerdo, recorte para ahumar (RS)"),
    "": ("Pork ham", "Pierna de cerdo"), "ham": ("Pork ham", "Pierna de cerdo"), "2pc": ("Pork ham, two-piece", "Pierna de cerdo en dos piezas"),
    "3 muscle ham to blue": ("Three-muscle ham, to blue", "Pierna de tres músculos, al azul"),
    "4 muscle ham to blue": ("Four-muscle ham, to blue", "Pierna de cuatro músculos, al azul"),
    "collared ham": ("Collared ham", "Pierna con collar"), "inner shank": ("Ham inner shank", "Chamorro interior de pierna"),
    "outer shank": ("Ham outer shank", "Chamorro exterior de pierna"), "insides": ("Ham insides", "Cara interna de pierna"),
    "outsides": ("Ham outsides", "Cara externa de pierna"), "knuckles": ("Ham knuckles", "Bola de pierna"),
    "lite butt": ("Ham lite butt", "Cabeza de pierna (lite butt)"), "roll out ham": ("Roll-out ham", "Pierna roll-out"),
    "roll out ham rolled tied": ("Roll-out ham, rolled and tied", "Pierna roll-out, enrollada y atada"),
    "shanks": ("Ham shanks", "Chamorros de pierna"), "trmd selected ham": ("Trimmed selected ham", "Pierna seleccionada recortada"),
    "derind belly": ("Derind pork belly", "Panceta de cerdo sin cuero"), "skin-on belly": ("Skin-on pork belly", "Panceta de cerdo con cuero"),
    "bbq style spareribs": ("BBQ-style pork spareribs", "Costillas de cerdo estilo BBQ"),
    "st louis spareribs": ("St. Louis-style pork spareribs", "Costillas de cerdo estilo St. Louis"),
    "trmd sparerib - lgt": ("Trimmed pork spareribs, light", "Costillas de cerdo recortadas, ligeras"),
    "trmd sparerib - med": ("Trimmed pork spareribs, medium", "Costillas de cerdo recortadas, medianas"),
    "skin-on": ("Skin-on pork jowl", "Papada de cerdo con cuero"), "skinned": ("Skinned pork jowl", "Papada de cerdo sin cuero"),
    "trim": ("lean pork trim", "Recorte de cerdo"), "ham trim": ("lean ham trim", "Recorte de pierna"),
    "trim w/trace": ("Pork trim, with trace", "Recorte de cerdo, con traza"), "blade meat": ("Pork blade meat", "Carne de paleta (blade meat)"),
    "picnic meat cushion in": ("Pork picnic meat, cushion in", "Carne de paleta picnic, con cojín"),
    "picnic meat cushion out": ("Pork picnic meat, cushion out", "Carne de paleta picnic, sin cojín"),
    "breast bones": ("Pork breast bones", "Huesos de pecho de cerdo"),
    "brisket bones, full cut": ("Pork brisket bones, full cut", "Huesos de pecho (brisket) de cerdo, corte completo"),
    "front feet": ("Pork front feet", "Manitas delanteras de cerdo"), "front feet, split": ("Pork front feet, split", "Manitas delanteras de cerdo, partidas"),
    "hind feet": ("Pork hind feet", "Patas traseras de cerdo"), "hocks, picnic": ("Pork hocks, picnic", "Codillos de cerdo de paleta"),
    "tails": ("Pork tails", "Colas de cerdo"), "trimmed neckbones": ("Pork neckbones, trimmed", "Espinazo de cerdo recortado"),
    "untrimmed neckbones": ("Pork neckbones, untrimmed", "Espinazo de cerdo sin recortar"),
}
PORK_ALSO = {
    "Tenderloin": ("pork tenderloin", "filete de cerdo"), "Bnls CC Strap-off": ("boneless pork loin, boneless pork chops", "lomo de cerdo deshuesado, chuletas"),
    "Bnls CC Strap-on": ("boneless pork loin roast", "lomo de cerdo para asar"), "Bone-in CC, Tender-in Loin VAC": ("bone-in pork chops", "chuletas de cerdo con hueso"),
    "Backribs 2.0#/up": ("baby back ribs", "costillas baby back"), "Backribs 2.0#/up 1 Pc Vac": ("baby back ribs", "costillas baby back"),
    "St Louis Spareribs, VAC": ("St. Louis-style ribs", "costillas St. Louis"), "Trmd Sparerib - MED": ("spareribs", "costillas"),
    "Trmd Sparerib - LGT": ("spareribs", "costillas"), "1/4 Trim Bnls Butt VAC": ("Boston butt, pork shoulder, pulled pork", "pulpa de espaldilla, carnitas"),
    "1/4 Trim Butt VAC": ("Boston butt, pork shoulder roast", "espaldilla de cerdo"), "1/8 Trim Steak Ready Butt 1 Pc Vac": ("pork shoulder steaks", "bistec de espaldilla"),
    "SS Smoker Trim Picnic VAC": ("picnic shoulder, picnic roast", "pernil, paleta picnic"), "Derind Belly 13-17#": ("pork belly, bacon", "panceta, tocino"),
    "Derind Belly 9-13#": ("pork belly, bacon", "panceta, tocino"), "Skin-on Belly 10-12# Boxed": ("skin-on pork belly, chicharrón", "panceta con cuero, chicharrón"),
    "23-27# Trmd Selected Ham": ("fresh ham, pork leg", "pierna fresca"), "20-23# Trmd Selected Ham": ("fresh ham, pork leg", "pierna fresca"),
    "Skinned Combo": ("hog jowl", "papada"), "Skinned Boxed": ("hog jowl", "papada"), "Front Feet, Poly, FZN": ("pig feet, trotters", "manitas de cerdo"),
    "Hind Feet, Poly, FZN": ("pig feet, trotters", "patas de cerdo"), "Tails, Poly, FZN": ("pig tails", "colitas de cerdo"),
    "Hocks, Picnic, Poly, FZN": ("ham hocks, pork hocks", "codillo"), "Trimmed Neckbones Poly": ("pork neck bones", "espinazo"),
    "72% Trim Combo": ("sausage trim", "recorte para embutido"), "42% Trim Combo": ("sausage trim", "recorte para embutido"),
    "Boneless Sirloin": ("pork sirloin roast", "sirloin de cerdo"), "Bone-in Sirloin": ("pork sirloin chops", "chuletas de sirloin"),
    "Blade Ends": ("country-style ribs", "costillas estilo country"), "Riblets, FZN": ("pork riblets, rib tips", "costillitas"),
    "Knuckles": ("ham sirloin tip", "bola de pierna"), "Brisket Bones, Full Cut, 30#, FZN": ("pork brisket bones, rib tips", "huesos de pecho, puntas de costilla"),
}
_PACK = [(r"\bPaper/Poly\b", "paperpoly"), (r"\b(?:VAC|Vac|vac)(?: Pack)?\b", "vac"), (r"\bCombo\b", "combo"), (r"\bBoxed\b", "boxed"),
         (r"\b(?:POLY|Poly)\b", "poly"), (r"\bPaper\b", "paper"), (r"\bGas\b", "gas")]
_PACK_WORDS = {"vac": ("vacuum-packed", "al vacío"), "combo": ("combo bin", "en combo"), "boxed": ("boxed", "en caja"), "poly": ("poly bag", "en bolsa"),
               "paper": ("paper-wrapped", "en papel"), "paperpoly": ("paper or poly", "en papel o bolsa"), "gas": ("gas-flushed", "en atmósfera modificada")}


def pork_parts(desc):
    s, f = f" {desc} ", {"pack": []}
    def take(pat):
        nonlocal s
        m = re.search(pat, s)
        if m: s = s[:m.start()] + " " + s[m.end():]
        return m
    f["ai"] = bool(take(r"\bAI\b"))
    f["frozen"] = bool(take(r",?\s*\bFZN\b"))
    f["red"] = bool(take(r"\(RED\)"))
    for pat, key in _PACK:
        if take(pat): f["pack"].append(key)
    f["onepc"] = bool(take(r"\b1 (?:Pc|pc|PC)\b"))
    m = take(r"\b(?:Bnls|Boneless)\b"); f["bone"] = "boneless" if m else ""
    if not f["bone"] and take(r"\b(?:B-In|Bone-in|Bone In)\b"): f["bone"] = "bonein"
    m = take(r"\b(1/4|1/8) Trim(?:med)?\b"); f["trim"] = m.group(1) if m else ""
    f["wt"] = ""
    for pat, kind in ((r"\b2\.0#/up\b", "up"), (r"\b(\d+)-(\d+)#?", "range"), (r"\b(\d+)/dn\b", "down"), (r"\b(\d+)#", "one")):
        m = take(pat)
        if m: f["wt"] = (kind, m.groups()); break
    m = take(r"\b(\d+)%"); f["lean"] = m.group(1) if m else ""
    core = re.sub(r"\s*,\s*", ", ", re.sub(r"\s+", " ", s)).strip(" ,-").lower()
    core = core.replace("skin on", "skin-on").replace("rollout", "roll out").replace("strap off", "strap-off").replace("strap on", "strap-on")
    return core, f


def pork_name(desc, sec=""):
    """(English name, Spanish name) for one of USDA's pork item descriptions."""
    core, f = pork_parts(desc)
    en, es = PORK_CORE.get(core, (desc, desc))
    if f["lean"]: en, es = f"{f['lean']}% {en}", f"{es} {f['lean']}% magro"
    head_en = ("Boneless " + en[0].lower() + en[1:] if f["bone"] == "boneless" else "Bone-in " + en[0].lower() + en[1:] if f["bone"] == "bonein" else en)
    q_en, q_es = [], []
    if f["bone"] == "boneless": q_es.append("sin hueso")
    if f["bone"] == "bonein": q_es.append("con hueso")
    if f["trim"]: q_en.append(f"{f['trim']}-inch trim"); q_es.append(f"recorte de {f['trim']} de pulgada")
    if f["wt"]:
        kind, g = f["wt"]
        if kind == "up": q_en.append("2 lb and up"); q_es.append("2 lb o más")
        elif kind == "range": q_en.append(f"{g[0]}–{g[1]} lb"); q_es.append(f"{g[0]}–{g[1]} lb")
        elif kind == "down": q_en.append(f"{g[0]} lb and under"); q_es.append(f"{g[0]} lb o menos")
        else: q_en.append(f"{g[0]} lb"); q_es.append(f"{g[0]} lb")
    if f["red"]: q_en.append("RED"); q_es.append("RED")
    if f["onepc"]: q_en.append("one piece"); q_es.append("una pieza")
    for p in f["pack"]: q_en.append(_PACK_WORDS[p][0]); q_es.append(_PACK_WORDS[p][1])
    if f["frozen"]: q_en.append("frozen"); q_es.append("congelado")
    if f["ai"]: q_en.append("with added ingredients"); q_es.append("con ingredientes añadidos")
    name_en = ", ".join([head_en[0].upper() + head_en[1:]] + q_en)
    name_es = ", ".join([es[0].upper() + es[1:]] + q_es)
    return name_en, name_es


def pork_names():
    d = json.load(open(os.path.join(ROOT, "_data", "pork_cuts.json"), encoding="utf-8"))
    d.pop("_about", None)
    return d


def pork_usda(first, last):
    """USDA's whole pork report for every business day from `first` to `last`: days {day: [day,
    carcass, loin, butt, picnic, rib, ham, belly, loads, cut_loads, trim_loads]}, items {(section,
    item): {day: [day, low, high, wavg, None, lbs]}} and published {day: timestamp}. An item that
    didn't trade (no weighted average) is no row."""
    q = f"q=report_date={first:%m/%d/%Y}:{last:%m/%d/%Y}&allSections=true"
    req = urllib.request.Request(f"{PORK_USDA}?{q}", headers={"User-Agent": "site-snapshot (github.com/JuanTorresMI)", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        body = json.load(r)
    by = {sec.get("reportSection"): sec.get("results") or [] for sec in (body if isinstance(body, list) else [body])}
    def num(v):
        try: return None if v in (None, "") else float(str(v).replace(",", ""))
        except ValueError: return None
    tidy = lambda v: " ".join(str(v or "").split())
    day = lambda r: datetime.strptime(str(r["report_date"]).split(" ")[0], "%m/%d/%Y").date().isoformat()
    days, items, published = {}, {}, {}
    for r in by.get("Summary", []): published[day(r)] = r.get("published_date") or ""
    vol = {day(r): r for r in by.get("Current Volume", [])}
    for r in by.get("Cutout and Primal Values", []):
        d, v = day(r), vol.get(day(r), {})
        days[d] = [d] + [num(r.get(k)) for k in ("pork_carcass", "pork_loin", "pork_butt", "pork_picnic", "pork_rib", "pork_ham", "pork_belly")] + [
            num(r.get("total_loads_date_1")), num(v.get("temp_cuts_total_load")), num(v.get("temp_process_total_load"))]
    for name, section in PORK_TABLES:
        for r in by.get(name, []):
            wavg, item = num(r.get("weighted_average")), tidy(r.get("Item_Description"))
            if not item or not wavg: continue
            lbs = num(r.get("total_pounds"))
            items.setdefault((section, item), {})[day(r)] = [day(r), num(r.get("price_range_low")) or None, num(r.get("price_range_high")) or None, wavg, None, None if lbs is None else int(lbs)]
    days = {d: v for d, v in days.items() if v[1] is not None}
    return days, items, published


PORK_DAY_COLS = ["carcass", "loin", "butt", "picnic", "rib", "ham", "belly", "total_loads", "cut_loads", "trim_and_process_loads"]


def pork_archive():
    days, items = {}, {}
    f = lambda r, k: None if r.get(k, "") == "" else float(r[k])
    if os.path.exists(PORK_CUTOUT_CSV):
        with open(PORK_CUTOUT_CSV, encoding="utf-8", newline="") as fh:
            for r in csv.DictReader(fh):
                days[r["date"]] = [r["date"]] + [f(r, k) for k in PORK_DAY_COLS]
    for y in range(2000, datetime.now().year + 2):
        p = PORK_YEAR_CSV(y)
        if not os.path.exists(p): continue
        with open(p, encoding="utf-8", newline="") as fh:
            for r in csv.DictReader(fh):
                items.setdefault((r["section"], r["usda_description"]), {})[r["date"]] = [
                    r["date"], f(r, "low"), f(r, "high"), f(r, "weighted_average"), None, None if r["pounds"] == "" else int(float(r["pounds"]))]
    return days, items


def pork():
    names = pork_names()
    added = []

    days, items = pork_archive()
    have = {d[:7] for d in days}
    today_ct = datetime.now(ZoneInfo("America/Chicago")).date() if TZ is not timezone.utc else datetime.now(timezone.utc).date()
    recent = ((iso_day(max(days)) - timedelta(days=BEEF_RECENT_DAYS)).date() if days else BEEF_START).isoformat()[:7]
    published, fetched = {}, 0
    y, m = BEEF_START.year, BEEF_START.month
    while (y, m) <= (today_ct.year, today_ct.month):
        key = f"{y}-{m:02d}"
        if key not in have or key >= recent:
            got_days, got_items, got_pub = pork_usda(date(y, m, 1), min(date(y, m, calendar.monthrange(y, m)[1]), today_ct))
            fetched += 1
            if got_days:
                for k in items:
                    for d in got_days: items[k].pop(d, None)
                days.update(got_days); published.update(got_pub)
                for k, rows in got_items.items(): items.setdefault(k, {}).update(rows)
        m += 1
        if m > 12: y, m = y + 1, 1
    if not days: raise RuntimeError("USDA returned no pork reports")
    print(f"pork: asked USDA for {fetched} month{'s' if fetched != 1 else ''}")
    order = sorted(days)
    latest, first = order[-1], order[0]
    today, prior = days[latest], (days[order[-2]] if len(order) > 1 else None)
    series = {k: [v[d] for d in sorted(v)] for k, v in items.items() if v}
    year_start = (iso_day(latest) - timedelta(days=365)).date().isoformat()
    slugs = {v["slug"] for v in names.values()} | {v.get("slug_es") for v in names.values()}

    def info(section, item):
        if item not in names:
            en, es = pork_name(item, section)
            s_en, s_es = slugify(en), slugify(es)
            while s_en in slugs: s_en += "-2"
            while s_es in slugs: s_es += "-2"
            slugs.update((s_en, s_es))
            names[item] = {"name": en, "slug": s_en, "es": es, "slug_es": s_es, "primal": section}
            added.append(item)
        return names[item]

    # The primals are series too, so their pages work like any item's.
    prim_idx = {"carcass": 1, "loin": 2, "butt": 3, "picnic": 4, "rib": 5, "ham": 6, "belly": 7}
    for k, i in prim_idx.items():
        series[("primal", k)] = [[d, None, None, days[d][i], None, None] for d in order if days[d][i] is not None]
    PRIM_NAMES = {"carcass": ("Pork carcass cutout", "Valor de la canal de cerdo"), **{k: (f"Pork {en.lower()} primal", f"{es} de cerdo, primal") for k, en, es in PORK_PRIMALS}}
    PRIM_SLUG = {"carcass": ("pork-carcass-cutout", "valor-canal-de-cerdo"), "loin": ("pork-loin-primal", "lomo-de-cerdo-primal"),
                 "butt": ("pork-butt-primal", "espaldilla-de-cerdo-primal"), "picnic": ("pork-picnic-primal", "paleta-picnic-de-cerdo-primal"),
                 "rib": ("pork-rib-primal", "costilla-de-cerdo-primal"), "ham": ("pork-ham-primal", "pierna-de-cerdo-primal"),
                 "belly": ("pork-belly-primal", "panceta-de-cerdo-primal")}
    PRIM_OF = {"loin": "loin", "butt": "butt", "picnic": "picnic", "ham": "ham", "belly": "belly", "sparerib": "rib"}

    def meta(key):
        section, item = key
        if section == "primal":
            return {"name": PRIM_NAMES[item][0], "es": PRIM_NAMES[item][1], "slug": PRIM_SLUG[item][0], "slug_es": PRIM_SLUG[item][1], "primal": item}
        return info(section, item)

    def tool(rows):
        last = rows[-1]
        since30 = (iso_day(last[0]) - timedelta(days=30)).date().isoformat()
        d30 = [r[3] for r in rows if r[0] > since30]
        return [{"key": "", "grade": "Price", "date": d_full(last[0]), "date_es": d_full_es(last[0]), "current": last[0] == latest,
                 "v": last[3], "low": last[1], "high": last[2], "d30": [min(d30), max(d30)] if d30 else None,
                 "year": sorted(round(r[3], 2) for r in rows if r[0] > year_start)}]

    def also_of(key):
        """What stores call an item, in each language, unless that is just its own name."""
        if key[0] == "primal": return "", ""
        a, mt = PORK_ALSO.get(key[1]) or ("", ""), meta(key)
        return ("" if a[0].lower() == mt["name"].lower() else a[0]), ("" if a[1].lower() == mt["es"].lower() else a[1])

    pages = {}
    for key, rows in series.items():
        section, item = key
        mt = meta(key)
        traded = [r for r in rows if r[0] > year_start]
        if section != "primal" and len(traded) < PORK_PAGE_DAYS and not os.path.exists(os.path.join(PORK_CUTS_DIR, mt["slug"] + ".md")):
            continue
        fx = grade_facts(rows, latest, "business days" if section == "primal" else "days it traded")
        mavg = monthly(rows)
        recent_rows = rows[-20:][::-1]
        pages[mt["slug"]] = {
            "name": mt["name"], "es": mt["es"], "slug": mt["slug"], "slug_es": mt["slug_es"], "usda": item if section != "primal" else "",
            "section": section, "primal": PRIM_OF.get(mt.get("primal"), mt.get("primal") if section == "primal" else ""),
            "group": mt.get("primal", section), "also": also_of(key)[0], "also_es": also_of(key)[1],
            "f": fx, "current": fx["current"], "last_iso": rows[-1][0], "since": d_full(rows[0][0]), "since_es": d_full_es(rows[0][0]),
            "first_iso": rows[0][0], "days_all": fmt(len(rows)), "days_year": len(traded),
            "chart": beef_chart([("line", "Price", [(r[0], r[3]) for r in rows])], usd, weekly=True),
            "grid": year_grid(mavg, lambda v: f"{v / 100:,.2f}" if section != "primal" else f"{v:,.2f}"),
            "grid_unit": "$ per lb" if section != "primal" else "$ per cwt", "grid_unit_es": "$ por lb" if section != "primal" else "$ por cwt",
            "season": seasons(mavg, latest),
            "rows": [{"day": d_full(r[0]), "day_es": d_full_es(r[0]), "cwt": usd(r[3]), "lb": per_lb(r[3]),
                      "range": "" if r[1] is None or r[2] is None else f"{usd(r[1])}–{usd(r[2])}", "lbs": "" if r[5] is None else fmt(r[5])} for r in recent_rows],
            "tool": tool(rows),
        }

    # Siblings: what else from the same primal traded today, dearest first.
    today_items = {k: rows[-1] for k, rows in series.items() if rows[-1][0] == latest and k[0] != "primal"}
    for slug, pg in pages.items():
        pk = pg["primal"]
        sib = [{"name": meta(k)["name"], "es": meta(k)["es"], "slug": meta(k)["slug"], "slug_es": meta(k)["slug_es"], "lb": per_lb(r[3]),
                "here": meta(k)["slug"] == slug, "v": r[3]}
               for k, r in today_items.items() if pk and PRIM_OF.get(k[0]) == pk and meta(k)["slug"] in pages]
        pg["siblings"] = [{x: s[x] for x in s if x != "v"} for s in sorted(sib, key=lambda s: -s["v"])][:25]
        if pk and pg["section"] != "primal":
            pv = series.get(("primal", pk))
            pg["primal_slug"], pg["primal_slug_es"] = PRIM_SLUG[pk]
            pg["primal_value"] = usd(pv[-1][3]) if pv and pv[-1][0] == latest else ""
        else:
            pg["primal_slug"] = pg["primal_slug_es"] = pg["primal_value"] = ""

    # ---- the board
    carcass = [(d, days[d][1]) for d in order]
    c, pc = today[1], prior[1] if prior else None
    weekday, weekday_es = f"{iso_day(latest):%A}, {iso_day(latest):%B} {iso_day(latest).day}", f"{['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'][iso_day(latest).weekday()]} {iso_day(latest).day} de {MONTHS_ES_FULL[iso_day(latest).month - 1]}"
    say = lambda a, b, tail="": "" if a is None or b is None else ("unchanged" + tail if round(a - b, 2) == 0 else f"{'up' if a > b else 'down'} {usd(abs(a - b))}{tail}")
    say_es = lambda a, b, tail="": "" if a is None or b is None else ("sin cambio" + tail if round(a - b, 2) == 0 else f"{'un alza' if a > b else 'una baja'} de {usd(abs(a - b))}{tail}")
    hi_p = max(PORK_PRIMALS, key=lambda p: today[prim_idx[p[0]]] or 0)
    parts = [f"On {weekday}, the pork carcass cutout was {usd(c)} per hundredweight" + (f", {say(c, pc, ' from the day before')}" if say(c, pc) else "") + "."]
    parts_es = [f"El {weekday_es}, el valor de la canal de cerdo fue de {usd(c)} por quintal (cwt)" + (f", {say_es(c, pc, ' frente al día anterior')}" if say_es(c, pc) else "") + "."]
    ART = {"loin": "el lomo", "butt": "la espaldilla", "picnic": "la paleta picnic", "rib": "la costilla", "ham": "la pierna", "belly": "la panceta"}
    parts.append(f"The {hi_p[1].lower()} was the dearest primal, at {usd(today[prim_idx[hi_p[0]]])}.")
    parts_es.append(f"El primal más caro fue {ART[hi_p[0]]}, a {usd(today[prim_idx[hi_p[0]]])}.")
    if today[8] is not None:
        parts.append(f"Packers sold {fmt(round(today[8]))} loads of pork on negotiated deals that day.")
        parts_es.append(f"Los empacadores vendieron {fmt(round(today[8]))} cargas de cerdo en tratos negociados ese día.")
    year_c = [(d, v) for d, v in carcass if d > year_start and v is not None]
    hi52, lo52 = max(year_c, key=lambda x: x[1]), min(year_c, key=lambda x: x[1])
    rec = max(((d, v) for d, v in carcass if v is not None), key=lambda x: x[1])
    ago = near([[d, v] for d, v in carcass], (iso_day(latest) - timedelta(days=365)).date().isoformat())
    cutout = {"standing": standing([v for d, v in year_c if d < latest], c, "business days"),
              "high": usd(hi52[1]), "high_day": d_full(hi52[0]), "high_day_es": d_full_es(hi52[0]), "low": usd(lo52[1]), "low_day": d_full(lo52[0]), "low_day_es": d_full_es(lo52[0]),
              "avg": usd(sum(v for _, v in year_c) / len(year_c)), "record": usd(rec[1]), "record_day": d_full(rec[0]), "record_day_es": d_full_es(rec[0]),
              "record_now": rec[0] == latest, "carcass_lb": per_lb(c),
              "year_ago": None if not ago else {"date": d_full(ago[0]), "date_es": d_full_es(ago[0]), "cwt": usd(ago[1]), "change": pct_change(c, ago[1])}}
    LINES = [("line", "Carcass", "Canal", 1), ("line2", "Belly", "Panceta", 7)]
    chart_year = beef_chart([(cls, lab, [(d, days[d][i]) for d in order if d > year_start]) for cls, lab, _, i in LINES], usd)
    chart_all = beef_chart([("line", "Carcass", carcass)], usd, weekly=True)
    key_lines = [{"cls": cls, "en": en, "es": es} for cls, en, es, _ in LINES]
    recent_tbl = []
    for n, d in enumerate(order[::-1][:10]):
        r, p = days[d], (days[order[-2 - n]] if len(order) > n + 1 else None)
        recent_tbl.append({"day": d_label(d), "day_es": d_label_es(d), "cells": [usd(r[i]) for i in range(1, 8)],
                           "chg": money_change(r[1], p[1]) if p else "", "loads": fmt(round(r[8])) if r[8] is not None else ""})
    cmonths = monthly([[d, None, None, v, None, None] for d, v in carcass if v is not None])
    primals = [{"key": k, "name": en, "es": es, "slug": PRIM_SLUG[k][0], "slug_es": PRIM_SLUG[k][1], "v": usd(today[prim_idx[k]]),
                "chg": money_change(today[prim_idx[k]], prior[prim_idx[k]]) if prior else "", "lb": per_lb(today[prim_idx[k]])}
               for k, en, es in PORK_PRIMALS if today[prim_idx[k]] is not None]
    five = [days[d] for d in order[-5:]]
    five_avg = {k: usd(sum(r[i] for r in five if r[i] is not None) / max(1, sum(1 for r in five if r[i] is not None))) for k, i in prim_idx.items()}

    def row(key):
        rows = series[key]
        last = rows[-1]
        mt = meta(key)
        then = on_or_before(rows[:-1], (iso_day(latest) - timedelta(days=7)).date().isoformat())
        also = also_of(key)
        words = " ".join(x for x in (mt["name"], mt["es"], also[0], also[1], key[1]) if x)
        return {"name": mt["name"], "es": mt["es"], "slug": mt["slug"] if mt["slug"] in pages else "", "slug_es": mt["slug_es"] if mt["slug"] in pages else "",
                "also": also[0], "also_es": also[1], "find": " ".join(words.lower().replace(",", " ").split()),
                "week": pct_change(last[3], then[3]) if then else "", "then_v": then[3] if then else None, "grade": "Price",
                "price": usd(last[3]), "price_lb": per_lb(last[3]), "lbs": "" if last[5] is None else fmt(last[5]),
                "range": "" if last[1] is None or last[2] is None else f"{per_lb(last[1])}–{per_lb(last[2])}", "v": last[3]}
    groups, quiet = [], []
    for g, en, es in PORK_GROUPS:
        rows = [row(k) for k in today_items if k[0] == g]
        if rows: groups.append({"key": g, "name": en, "es": es, "rows": sorted(rows, key=lambda r: -r["v"])})
    for slug, pg in pages.items():
        if pg["section"] != "primal" and not pg["current"]:
            quiet.append({"name": pg["name"], "es": pg["es"], "slug": slug, "slug_es": pg["slug_es"], "last": d_full(pg["last_iso"]), "last_es": d_full_es(pg["last_iso"])})

    moves = []
    for k, r in today_items.items():
        if (r[5] or 0) < PORK_MOVER_LBS: continue
        then = on_or_before(series[k][:-1], (iso_day(latest) - timedelta(days=7)).date().isoformat())
        if not then: continue
        mt = meta(k)
        moves.append({"name": mt["name"], "es": mt["es"], "slug": mt["slug"] if mt["slug"] in pages else "", "slug_es": mt["slug_es"] if mt["slug"] in pages else "",
                      "lb": per_lb(r[3]), "then": per_lb(then[3]), "change": pct_change(r[3], then[3]), "p": (r[3] - then[3]) / then[3] * 100})
    ups = [{k: v for k, v in m.items() if k != "p"} for m in sorted([m for m in moves if m["p"] >= 0.5], key=lambda m: -m["p"])[:6]]
    downs = [{k: v for k, v in m.items() if k != "p"} for m in sorted([m for m in moves if m["p"] <= -0.5], key=lambda m: m["p"])[:6]]

    index = []
    for g, en, es in PORK_GROUPS:
        ent = sorted([(pg["name"], slug, pg["es"], pg["slug_es"]) for slug, pg in pages.items() if pg["section"] == g])
        if ent: index.append({"name": en, "es": es, "pages": [{"name": a, "slug": b, "es": c_, "slug_es": d_} for a, b, c_, d_ in ent]})
    prim_pages = [{"name": PRIM_NAMES[k][0], "es": PRIM_NAMES[k][1], "slug": PRIM_SLUG[k][0], "slug_es": PRIM_SLUG[k][1]} for k in prim_idx]

    # ---- the downloads (the archive the next run reads back)
    os.makedirs(PORK_DIR, exist_ok=True)
    num2 = lambda v: "" if v is None else f"{v:.2f}"
    with open(PORK_CUTOUT_CSV, "w", encoding="utf-8", newline="") as fh:
        wr = csv.writer(fh, lineterminator="\n")
        wr.writerow(["date"] + PORK_DAY_COLS)
        for d in order: wr.writerow([d] + [num2(v) for v in days[d][1:]])
    downloads = [{"file": os.path.basename(PORK_CUTOUT_CSV), "label": f"The cutout and primal values, every day since {d_full(first)}",
                  "label_es": f"El valor de la canal y de los primales, cada día desde el {d_full_es(first)}",
                  "rows": fmt(len(order)), "kb": fmt(round(os.path.getsize(PORK_CUTOUT_CSV) / 1024))}]
    sec_order = {g: n for n, (g, _, _) in enumerate(PORK_GROUPS)}
    flat = sorted(((r[0], sec_order.get(sec, 99), sec, item, r) for (sec, item), rows in series.items() if sec != "primal" for r in rows), key=lambda x: x[:2] + (x[3],))
    for yr, grp in groupby(flat, key=lambda x: x[0][:4]):
        grp = list(grp)
        with open(PORK_YEAR_CSV(yr), "w", encoding="utf-8", newline="") as fh:
            wr = csv.writer(fh, lineterminator="\n")
            wr.writerow(["date", "section", "usda_description", "name", "nombre", "low", "high", "weighted_average", "weighted_average_per_lb", "pounds"])
            for d, _, sec, item, r in grp:
                i = info(sec, item)
                wr.writerow([d, sec, item, i["name"], i["es"], num2(r[1]), num2(r[2]), num2(r[3]), "" if r[3] is None else f"{r[3] / 100:.4f}", "" if r[5] is None else str(r[5])])
        downloads.append({"file": os.path.basename(PORK_YEAR_CSV(yr)), "label": f"Every cut, every day of {yr}" + (" so far" if yr == latest[:4] else ""),
                          "label_es": f"Cada corte, cada día de {yr}" + (" hasta hoy" if yr == latest[:4] else ""),
                          "rows": fmt(len(grp)), "kb": fmt(round(os.path.getsize(PORK_YEAR_CSV(yr)) / 1024)), "year": yr})
    downloads = downloads[:1] + sorted(downloads[1:], key=lambda x: x["year"], reverse=True)

    # ---- page stubs, English and Spanish, never deleted
    os.makedirs(PORK_CUTS_DIR, exist_ok=True); os.makedirs(PORK_CUTS_ES_DIR, exist_ok=True)
    for slug, pg in pages.items():
        if pg["section"] == "primal":
            if pg["group"] == "carcass":
                title, title_es = "Pork carcass cutout value", "Valor de la canal de cerdo"
                seo, seo_es = "Pork Cutout Value Today · USDA Daily Carcass Cutout", "Valor de la canal de cerdo hoy · USDA"
            else:
                title, title_es = pg["name"] + " value", pg["es"] + ": valor"
                seo = fit(f"{pg['name']} Value Today · USDA Pork Cutout", f"{pg['name']} Value Today")
                seo_es = fit(f"{pg['es']}: valor hoy · USDA", f"{pg['es']}: valor hoy")
            desc = fit(f"USDA's daily {pg['name'].lower()} value, per hundredweight, from negotiated pork sales: the latest, every day since {pg['since']}, and its usual seasonal swing.",
                       f"USDA's daily {pg['name'].lower()} value: the latest and every day since {pg['since']}.", limit=160)
            desc_es = fit(f"El valor diario de {pg['es'].lower()} según el USDA, por quintal, de las ventas negociadas de cerdo: el último, cada día desde el {pg['since_es']} y su temporada.",
                          f"El valor diario de {pg['es'].lower()} según el USDA: el último y cada día desde el {pg['since_es']}.", limit=160)
        else:
            title, title_es = f"{pg['name']}: wholesale price", f"{pg['es']}: precio de mayoreo"
            seo = fit(f"{pg['name']} Price Today · USDA", f"{pg['name']} Price Today", f"{pg['name']} Price", pg["name"])
            seo_es = fit(f"{pg['es']}: precio hoy · USDA", f"{pg['es']}: precio hoy", f"{pg['es']}: precio", pg["es"])
            desc = fit(f"USDA's daily wholesale price for {pg['name'].lower()}, per pound and per hundredweight: the latest weighted average and every day since {pg['since']}.",
                       f"USDA's daily wholesale price for {pg['name'].lower()}: the latest per pound and every day since {pg['since']}.",
                       f"USDA's daily wholesale price for {pg['name'].lower()}, per pound.", limit=160)
            desc_es = fit(f"El precio de mayoreo diario de {pg['es'].lower()} según el USDA, por libra y por quintal: el último promedio y cada día desde el {pg['since_es']}.",
                          f"Precio de mayoreo diario de {pg['es'].lower()} según el USDA: el último por libra y cada día desde el {pg['since_es']}.",
                          f"Precio de mayoreo diario de {pg['es'].lower()} según el USDA, por libra.", limit=160)
        for d_, s_, t_, so_, de_, tr_ in ((PORK_CUTS_DIR, slug, title, seo, desc, f"/es/precios-de-cerdo/{pg['slug_es']}/"),
                                          (PORK_CUTS_ES_DIR, pg["slug_es"], title_es, seo_es, desc_es, f"/pork-prices/{slug}/")):
            f = os.path.join(d_, s_ + ".md")
            if os.path.exists(f): continue
            with open(f, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(f"---\ncut: {slug}\ntitle: {json.dumps(t_, ensure_ascii=False)}\nseo_title: {json.dumps(so_, ensure_ascii=False)}\n"
                         f"description: {json.dumps(de_, ensure_ascii=False)}\ntranslation: {json.dumps(tr_)}\n---\n")

    if added:
        with open(os.path.join(ROOT, "_data", "pork_cuts.json"), encoding="utf-8") as fh: allnames = json.load(fh)
        for item in added: allnames[item] = names[item]
        with open(os.path.join(ROOT, "_data", "pork_cuts.json"), "w", encoding="utf-8", newline="\n") as fh:
            json.dump(allnames, fh, ensure_ascii=False, indent=1); fh.write("\n")
        print(f"pork: named {len(added)} new item{'s' if len(added) != 1 else ''} in _data/pork_cuts.json")

    pub = None
    try: pub = datetime.strptime((published.get(latest) or "").split(" ")[0], "%m/%d/%Y")
    except ValueError: pass
    due = next_business_day(latest)
    feed = {"source": "USDA AMS Livestock Mandatory Reporting, LM_PK602 (National Daily Pork FOB Plant, Negotiated Sales, Afternoon)",
            "source_url": "https://mymarketnews.ams.usda.gov/viewReport/2498", "license": "U.S. government data, public domain. Credit USDA AMS.",
            "units": "USD per hundredweight (100 lb) unless a field says per_lb", "report_date": latest, "published": published.get(latest, ""),
            "cutout": {k: today[i] for k, i in prim_idx.items()}, "loads": {"total": today[8], "cuts": today[9], "trim_and_process": today[10]},
            "items": [{"name": meta(k)["name"], "nombre": meta(k)["es"], "usda_description": k[1], "section": k[0], "low": r[1], "high": r[2],
                       "weighted_average": r[3], "weighted_average_per_lb": round(r[3] / 100, 4), "pounds": r[5],
                       "page": f"https://juantorresmi.github.io/pork-prices/{meta(k)['slug']}/" if meta(k)["slug"] in pages else None}
                      for k, r in sorted(today_items.items())],
            "history": {"cutout_daily": "https://juantorresmi.github.io/pork-prices/pork-cutout-daily.csv",
                        "cuts_by_year": [f"https://juantorresmi.github.io/pork-prices/{x['file']}" for x in downloads[1:]]}}
    with open(os.path.join(PORK_DIR, "latest.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(feed, fh, ensure_ascii=False, indent=1); fh.write("\n")

    return {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "latest": latest, "date": d_full(latest), "date_es": d_full_es(latest),
            "day": d_label(latest), "day_es": d_label_es(latest), "on_day": f"{iso_day(latest):%A}, {d_full(latest)}", "on_day_es": weekday_es,
            "published": full_date(pub) if pub else "", "next_due": f"{due:%a}, {full_date(due)}",
            "next_due_es": f"{DIAS_ES[due.weekday()]} {due.day} {MONTHS_ES[due.month - 1]} {due.year}",
            "first_iso": first, "first": d_full(first), "first_es": d_full_es(first), "record_days": fmt(len(order)),
            "stamp": {"carcass": usd(c), "carcass_chg": money_change(c, pc), "belly": usd(today[7]), "loin": usd(today[2]), "ham": usd(today[6]),
                      "loads": fmt(round(today[8])) if today[8] is not None else ""},
            "raw": {k: today[i] for k, i in prim_idx.items()}, "summary": " ".join(parts), "summary_es": " ".join(parts_es),
            "cutout": cutout, "chart_year": chart_year, "chart_all": chart_all, "key_lines": key_lines, "recent": recent_tbl,
            "grid": year_grid(cmonths, lambda v: f"{v:,.2f}"), "season": seasons(cmonths, latest), "primals": primals, "five": five_avg,
            "groups": groups, "quiet": sorted(quiet, key=lambda q: q["name"])[:40], "quiet_count": len(quiet), "ups": ups, "downs": downs,
            "index": index, "prim_pages": prim_pages, "downloads": downloads,
            "traded": sum(len(g["rows"]) for g in groups), "page_count": len(pages), "items": pages}


# ------------------------------------------------------------------- the fed cattle board ----
# /fed-cattle-prices/ (and /es/precios-de-ganado-gordo/) and a page per region: what packers paid
# for slaughter steers and heifers on negotiated cash deals, from USDA's mandatory reports. USDA's
# datamart is the archive, as for beef and pork: the CSVs are read back and only the stretches they
# don't settle are fetched. Sources (all keyless, LMR datamart):
#   LM_CT150 (2477)  5-area weekly weighted average, by class, selling basis and grade
#   LM_CT156-158     Texas-Oklahoma, Kansas and Nebraska weekly negotiated purchases, the same detail
#   LM_CT154 (2481)  national weekly negotiated purchases; its Regional table has the six smaller
#                    regions (Colorado, the Cornbelts, the northern plains, the West, the Northeast)
#   LM_CT100 (2466)  5-area daily weighted average, for the days of the current week

CATTLE_DIR = os.path.join(ROOT, "fed-cattle-prices")
CATTLE_REG_DIR = os.path.join(ROOT, "_cattle_regions")
CATTLE_REG_ES_DIR = os.path.join(ROOT, "_cattle_regions_es")
CATTLE_WEEKLY_CSV = os.path.join(CATTLE_DIR, "fed-cattle-weekly.csv")
CATTLE_DAILY_CSV = os.path.join(CATTLE_DIR, "fed-cattle-5-area-daily.csv")
LMR = "https://mpr.datamart.ams.usda.gov/services/v1.1/reports"
# slug, slug_es, name, Spanish name, the states, the report and its table
CATTLE_REGIONS = [
    ("five-area", "cinco-areas", "5-area", "5 áreas", "Texas-Oklahoma-New Mexico, Kansas, Nebraska, Colorado and Iowa-Minnesota", "Texas-Oklahoma-Nuevo México, Kansas, Nebraska, Colorado e Iowa-Minnesota", 2477, "Detail", "LM_CT150"),
    ("texas-oklahoma", "texas-oklahoma", "Texas-Oklahoma", "Texas-Oklahoma", "Texas, Oklahoma and New Mexico", "Texas, Oklahoma y Nuevo México", 2483, "Detail", "LM_CT156"),
    ("kansas", "kansas", "Kansas", "Kansas", "Kansas", "Kansas", 2484, "Detail", "LM_CT157"),
    ("nebraska", "nebraska", "Nebraska", "Nebraska", "Nebraska", "Nebraska", 2485, "Detail", "LM_CT158"),
    ("colorado", "colorado", "Colorado", "Colorado", "Colorado", "Colorado", 2481, "COLORADO", "LM_CT154"),
    ("western-cornbelt", "cornbelt-occidental", "Western Cornbelt", "Cornbelt occidental", "Iowa, Minnesota and Missouri", "Iowa, Minnesota y Misuri", 2481, "WESTERN CORNBELT: MN/IA/MO", "LM_CT154"),
    ("eastern-cornbelt", "cornbelt-oriental", "Eastern Cornbelt", "Cornbelt oriental", "Michigan, Indiana, Illinois, Wisconsin and Kentucky", "Michigan, Indiana, Illinois, Wisconsin y Kentucky", 2481, "EASTERN CORNBELT: WI/IL/MI/IN/KY", "LM_CT154"),
    ("northern-plains", "planicies-del-norte", "Northern Plains", "Planicies del norte", "Wyoming, Montana, South Dakota and North Dakota", "Wyoming, Montana, Dakota del Sur y Dakota del Norte", 2481, "NORTH CENTRAL/EASTERN MOUNTAIN: WY/MT/SD/ND", "LM_CT154"),
    ("western-states", "estados-del-oeste", "Western States", "Estados del oeste", "Arizona, California, Nevada, Utah, Washington, Oregon and Idaho", "Arizona, California, Nevada, Utah, Washington, Oregón e Idaho", 2481, "WESTERN STATES: AZ/CA/NV/UT/WA/OR/ID", "LM_CT154"),
    ("northeast", "noreste", "Northeast", "Noreste", "Ohio, Pennsylvania, New York, Virginia, West Virginia and New England", "Ohio, Pensilvania, Nueva York, Virginia, Virginia Occidental y Nueva Inglaterra", 2481, "NORTH EASTERN STATES: OH/PA/NY/WV/VA/CT/DE/ME/MA/MD/NH/NJ/RI/VT", "LM_CT154"),
]
CATTLE_START = 2020
CATTLE_PAGE_WEEKS = 8                        # weeks with a price in the last year before a region gets a page
CLASS = {"ALL BEEF TYPE": "all", "ALL STEERS & HEIFERS": "all", "STEER": "steer", "HEIFER": "heifer", "MIXED STEER/HEIFER": "mixed",
         "DAIRYBRED STEER/HEIFER": "dairy", "MIXED STEER/HEIFER/COW": "mixed_cow"}
CLASS_WORDS = {"all": ("All steers and heifers", "Todos los novillos y vaquillas"), "steer": ("Steers", "Novillos"), "heifer": ("Heifers", "Vaquillas"),
               "mixed": ("Mixed steers and heifers", "Novillos y vaquillas mezclados"), "dairy": ("Dairy-bred steers and heifers", "Novillos y vaquillas de raza lechera"),
               "mixed_cow": ("Mixed steers, heifers and cows", "Novillos, vaquillas y vacas mezclados")}
BASIS = {"LIVE FOB": "live_fob", "LIVE DELIVERED": "live_delivered", "DRESSED FOB": "dressed_fob", "DRESSED DELIVERED": "dressed_delivered"}
BASIS_WORDS = {"live_fob": ("Live, FOB the feedlot", "En pie, LAB corral"), "live_delivered": ("Live, delivered", "En pie, entregado"),
               "dressed_fob": ("Dressed, FOB the feedlot", "En canal, LAB corral"), "dressed_delivered": ("Dressed, delivered", "En canal, entregado")}
GRADE = {"Total all grades": "total", "Over 80% Choice": "over80", "65 - 80% Choice": "65to80", "35 - 65% Choice": "35to65", "0 - 35% Choice": "0to35"}
GRADE_WORDS = {"total": ("All grades", "Todos los grados"), "over80": ("Over 80% Choice", "Más de 80% Choice"), "65to80": ("65–80% Choice", "65–80% Choice"),
               "35to65": ("35–65% Choice", "35–65% Choice"), "0to35": ("0–35% Choice", "0–35% Choice")}
PURCHASE = {"NEGOTIATED CASH": "cash", "NEGOTIATED GRID BASE": "grid"}
CW = ["head", "dress_pct", "weight_low", "weight_high", "weight_avg", "price_low", "price_high", "weighted_average"]


def lmr(rid, path, query, timeout=300):
    req = urllib.request.Request(f"{LMR}/{rid}{path}?{query}", headers={"User-Agent": "site-snapshot (github.com/JuanTorresMI)", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = json.load(r)
    return {sec.get("reportSection"): sec.get("results") or [] for sec in (body if isinstance(body, list) else [body])}


def _n(v):
    try: return None if v in (None, "") else float(str(v).replace(",", ""))
    except ValueError: return None


def _day(r):
    return datetime.strptime(str(r["report_date"]).split(" ")[0], "%m/%d/%Y").date().isoformat()


def cattle_fetch(region, first, last):
    """One region's weekly rows between two dates: {(region, purchase, class, basis, grade): {week: row}},
    row = [week, head, dress_pct, weight_low, weight_high, weight_avg, price_low, price_high, wavg]."""
    slug, _, _, _, _, _, rid, table, _ = region
    q = f"q=report_date={first:%m/%d/%Y}:{last:%m/%d/%Y}"
    out = {}
    if rid == 2481:
        for r in lmr(rid, "/Regional", q).get("Regional", []):
            if " ".join(str(r.get("Region", "")).split()) != " ".join(table.split()): continue
            b = BASIS.get(str(r.get("Selling_Basis", "")).upper())
            avg = _n(r.get("Prc_Rng_Avg"))
            if not b or not avg: continue
            out.setdefault((slug, "cash", "all", b, "total"), {})[_day(r)] = [_day(r), _n(r.get("Head_Count")), _n(r.get("Dress_Pct")), _n(r.get("Wgt_Rng_Low")),
                                                                        _n(r.get("Wgt_Rng_High")), _n(r.get("Wgt_Rng_Avg")), _n(r.get("Prc_Rng_Low")), _n(r.get("Prc_Rng_High")), avg]
        return out
    for r in lmr(rid, "/Detail", q).get("Detail", []):
        c, b, g = CLASS.get(str(r.get("class_description", "")).strip()), BASIS.get(str(r.get("selling_basis_description", "")).strip()), GRADE.get(" ".join(str(r.get("grade_description", "")).split()).replace("0 - 35", "0 - 35"))
        if g is None: g = GRADE.get(str(r.get("grade_description", "")).strip())
        p = PURCHASE.get(str(r.get("purchase_type_code", "NEGOTIATED CASH")).strip(), None) if rid != 2477 else "cash"
        avg = _n(r.get("weighted_avg_price"))
        if not (c and b and g and p and avg): continue
        if str(r.get("source_description") or "Domestic").strip() not in ("Domestic", ""): continue
        out.setdefault((slug, p, c, b, g), {})[_day(r)] = [_day(r), _n(r.get("head_count")), _n(r.get("dress_pct")), _n(r.get("weight_range_low")),
                                                         _n(r.get("weight_range_high")), _n(r.get("weight_range_avg")), _n(r.get("price_range_low")), _n(r.get("price_range_high")), avg]
    return out


def cattle_daily_fetch(first, last):
    """The 5-area daily report (LM_CT100): {(class, basis, grade): {day: row}} with the same row shape."""
    out = {}
    for r in lmr(2466, "/Detail", f"q=report_date={first:%m/%d/%Y}:{last:%m/%d/%Y}").get("Detail", []):
        c, b, g = CLASS.get(str(r.get("class_description", "")).strip()), BASIS.get(str(r.get("selling_basis_description", "")).strip()), GRADE.get(str(r.get("grade_description", "")).strip())
        avg = _n(r.get("weighted_avg_price"))
        if not (c and b and g and avg): continue
        out.setdefault((c, b, g), {})[_day(r)] = [_day(r), _n(r.get("head_count")), None, _n(r.get("weight_range_low")), _n(r.get("weight_range_high")),
                                                _n(r.get("weight_range_avg")), _n(r.get("price_range_low")), _n(r.get("price_range_high")), avg]
    return out


def cattle_archive():
    weekly, daily = {}, {}
    f = lambda r, k: None if r.get(k, "") == "" else float(r[k])
    if os.path.exists(CATTLE_WEEKLY_CSV):
        with open(CATTLE_WEEKLY_CSV, encoding="utf-8", newline="") as fh:
            for r in csv.DictReader(fh):
                weekly.setdefault((r["region"], r["purchase"], r["class"], r["basis"], r["grade"]), {})[r["report_date"]] = [r["report_date"]] + [f(r, k) for k in CW]
    if os.path.exists(CATTLE_DAILY_CSV):
        with open(CATTLE_DAILY_CSV, encoding="utf-8", newline="") as fh:
            for r in csv.DictReader(fh):
                daily.setdefault((r["class"], r["basis"], r["grade"]), {})[r["date"]] = [r["date"]] + [f(r, k) for k in CW]
    return weekly, daily


def week_of(report_date):
    """A weekly report dated Monday covers the week before it, Monday to Sunday."""
    d = iso_day(report_date)
    return (d - timedelta(days=7)).date().isoformat(), (d - timedelta(days=1)).date().isoformat()


def cattle():
    weekly, daily = cattle_archive()
    today_ct = datetime.now(ZoneInfo("America/Chicago")).date() if TZ is not timezone.utc else datetime.now(timezone.utc).date()
    have_years = {}
    for k, rows in weekly.items():
        for d in rows: have_years.setdefault(k[0], set()).add(d[:4])
    fetched = 0
    for reg in CATTLE_REGIONS:
        for y in range(CATTLE_START, today_ct.year + 1):
            if str(y) in have_years.get(reg[0], set()) and y < today_ct.year and not (y == today_ct.year - 1 and today_ct.month == 1): continue
            got = cattle_fetch(reg, date(y, 1, 1), min(date(y, 12, 31), today_ct)); fetched += 1
            for k in [k for k in weekly if k[0] == reg[0]]:
                for d in [d for d in weekly[k] if d[:4] == str(y)]: weekly[k].pop(d)
            for k, rows in got.items(): weekly.setdefault(k, {}).update(rows)
    have_m = {d[:7] for rows in daily.values() for d in rows}
    last_d = max((d for rows in daily.values() for d in rows), default=None)
    recent = ((iso_day(last_d) - timedelta(days=BEEF_RECENT_DAYS)).date() if last_d else BEEF_START).isoformat()[:7]
    y, m = CATTLE_START, 1
    while (y, m) <= (today_ct.year, today_ct.month):
        key = f"{y}-{m:02d}"
        if key not in have_m or key >= recent:
            got = cattle_daily_fetch(date(y, m, 1), min(date(y, m, calendar.monthrange(y, m)[1]), today_ct)); fetched += 1
            for k in daily:
                for d in [d for d in daily[k] if d[:7] == key]: daily[k].pop(d)
            for k, rows in got.items(): daily.setdefault(k, {}).update(rows)
        m += 1
        if m > 12: y, m = y + 1, 1
    print(f"cattle: asked USDA {fetched} times")
    W = {k: [v[d] for d in sorted(v)] for k, v in weekly.items() if v}
    D = {k: [v[d] for d in sorted(v)] for k, v in daily.items() if v}
    if not W.get(("five-area", "cash", "all", "live_fob", "total")): raise RuntimeError("USDA returned no 5-area weekly report")
    latest_week = max(r[0] for rows in W.values() for r in rows)
    year_start = (iso_day(latest_week) - timedelta(days=365)).date().isoformat()
    cwt = lambda v: "" if v is None else f"${v:,.2f}"
    lbs = lambda v: "" if v is None else f"{v:,.0f} lb"
    pct = lambda v: "" if v is None else f"{v:.1f}%"
    hd = lambda v: "" if v is None else fmt(int(v))
    wk_label = lambda d: f"week of {d_full(week_of(d)[0])}"          # read mid-sentence: "(week of Oct 5, 2026)"
    wk_label_es = lambda d: f"semana del {d_full_es(week_of(d)[0])}"

    # USDA's own notes on the week (the "trend" paragraph), where a report has one.
    notes = {}
    for rid, regs in ((2481, ("western-cornbelt",)),
                      (2483, ("texas-oklahoma",)), (2484, ("kansas",)), (2485, ("nebraska",))):
        try:
            s = (lmr(rid, "/Summary", "lastReports=1", timeout=60).get("Summary") or [{}])[0]
        except Exception:
            continue
        if s.get("trend"):
            for r in regs: notes[r] = {"text": " ".join(str(s["trend"]).split()), "date": d_full(_day(s)), "report": next(x[8] for x in CATTLE_REGIONS if x[0] == r)}

    def facts(rows, unit_days="weeks"):
        """Like grade_facts, for weekly cattle rows (the price is index 8)."""
        last, before = rows[-1], (rows[-2] if len(rows) > 1 else None)
        year = [r for r in rows if r[0] > year_start]
        lo = min(year, key=lambda r: r[8]) if year else None
        hi = max(year, key=lambda r: r[8]) if year else None
        ago = near([[r[0], r[8]] for r in rows], (iso_day(last[0]) - timedelta(days=364)).date().isoformat(), slack=6)
        return {"current": last[0] == latest_week, "iso": last[0], "week": wk_label(last[0]), "week_es": wk_label_es(last[0]),
                "v": last[8], "cwt": cwt(last[8]), "range": "" if last[6] is None or last[7] is None else f"{cwt(last[6])}–{cwt(last[7])}",
                "head": hd(last[1]), "weight": lbs(last[5]), "dress": pct(last[2]),
                "change": money_change(last[8], before[8]) if before else "", "change_pct": pct_change(last[8], before[8]) if before else "",
                "standing": standing([r[8] for r in year if r is not last], last[8], "weeks it traded"),
                "year_ago": None if not ago else {"week": wk_label(ago[0]), "week_es": wk_label_es(ago[0]), "cwt": cwt(ago[1]), "change": pct_change(last[8], ago[1])},
                "avg": cwt(sum(r[8] for r in year) / len(year)) if year else "", "low": cwt(lo[8]) if lo else "", "high": cwt(hi[8]) if hi else "",
                "low_week": wk_label(lo[0]) if lo else "", "high_week": wk_label(hi[0]) if hi else "",
                "low_week_es": wk_label_es(lo[0]) if lo else "", "high_week_es": wk_label_es(hi[0]) if hi else "", "weeks_year": len(year)}

    def series(slug, basis, cls="all", grade="total", purchase="cash"):
        return W.get((slug, purchase, cls, basis, grade), [])

    def mchart(lines, w=640, h=200):
        pts = [(cls, lab, [(r[0], r[8]) for r in rows]) for cls, lab, rows in lines if rows]
        ch = beef_chart(pts, cwt, w=w, h=h)
        return ch

    def head_monthly(rows):
        acc = {}
        for r in rows:
            k = (int(r[0][:4]), int(r[0][5:7]))
            wt = r[1] or 1
            a = acc.setdefault(k, [0.0, 0.0]); a[0] += r[8] * wt; a[1] += wt
        return {k: a[0] / a[1] for k, a in acc.items() if a[1]}

    regions, pages = [], {}
    for reg in CATTLE_REGIONS:
        slug, slug_es, name, name_es, states, states_es, rid, table, code = reg
        live, dressed = series(slug, "live_fob"), series(slug, "dressed_delivered")
        main_basis = "live_fob" if len([r for r in live if r[0] > year_start]) >= len([r for r in dressed if r[0] > year_start]) else "dressed_delivered"
        main = live if main_basis == "live_fob" else dressed
        if not main: continue
        weeks_year = len({r[0] for b in BASIS.values() for r in series(slug, b) if r[0] > year_start})
        fl, fd = (facts(live) if live else None), (facts(dressed) if dressed else None)
        # The latest week: every basis, and (where the report breaks it down) every class and grade.
        bases = []
        for b in ("live_fob", "live_delivered", "dressed_fob", "dressed_delivered"):
            rows = series(slug, b)
            if rows and rows[-1][0] == latest_week:
                r = rows[-1]
                bases.append({"basis": BASIS_WORDS[b][0], "basis_es": BASIS_WORDS[b][1], "key": b, "head": hd(r[1]), "weight": lbs(r[5]),
                              "weights": "" if r[3] is None or r[4] is None else f"{r[3]:,.0f}–{r[4]:,.0f}", "dress": pct(r[2]),
                              "range": "" if r[6] is None or r[7] is None else f"{cwt(r[6])}–{cwt(r[7])}", "cwt": cwt(r[8]), "v": r[8],
                              "chg": money_change(r[8], rows[-2][8]) if len(rows) > 1 else ""})
        detail = []
        for c in ("steer", "heifer", "mixed", "dairy", "mixed_cow"):
            for b in ("live_fob", "live_delivered", "dressed_fob", "dressed_delivered"):
                cells = []
                for g in ("total", "over80", "65to80", "35to65", "0to35"):
                    rows = series(slug, b, c, g)
                    r = rows[-1] if rows and rows[-1][0] == latest_week else None
                    cells.append({"cwt": cwt(r[8]) if r else "", "head": hd(r[1]) if r else ""})
                if cells[0]["cwt"]:
                    detail.append({"cls": CLASS_WORDS[c][0], "cls_es": CLASS_WORDS[c][1], "basis": BASIS_WORDS[b][0], "basis_es": BASIS_WORDS[b][1], "cells": cells})
        grid_rows = []
        for r in sorted({r[0] for b in ("live_fob", "dressed_delivered") for r in series(slug, b)}, reverse=True)[:12]:
            lv = next((x for x in live if x[0] == r), None); dv = next((x for x in dressed if x[0] == r), None)
            grid_rows.append({"week": wk_label(r), "week_es": wk_label_es(r), "live": cwt(lv[8]) if lv else "", "live_head": hd(lv[1]) if lv else "",
                              "dressed": cwt(dv[8]) if dv else "", "dressed_head": hd(dv[1]) if dv else ""})
        mavg = head_monthly(main)
        grid_fmt = lambda v: f"{v:,.2f}"
        grade_rows = []
        for g in ("over80", "65to80", "35to65", "0to35"):
            rows = series(slug, "live_fob", "steer", g)
            if rows and rows[-1][0] == latest_week: grade_rows.append(1)
        # Grid base prices (negotiated grid), where the report has them: the base a grid starts from.
        grid_base = []
        for b in ("live_fob", "dressed_delivered"):
            rows = series(slug, b, "all", "total", "grid")
            if rows and rows[-1][0] == latest_week:
                grid_base.append({"basis": BASIS_WORDS[b][0], "basis_es": BASIS_WORDS[b][1], "cwt": cwt(rows[-1][8]), "head": hd(rows[-1][1])})
        pg = {"slug": slug, "slug_es": slug_es, "name": name, "es": name_es, "states": states, "states_es": states_es, "report": code,
              "report_url": f"https://mymarketnews.ams.usda.gov/viewReport/{rid}", "main_basis": main_basis,
              "main_label": BASIS_WORDS[main_basis][0], "main_label_es": BASIS_WORDS[main_basis][1],
              "main_short": {"live_fob": "live, FOB the feedlot", "dressed_delivered": "dressed, delivered to the plant"}[main_basis],
              "main_short_es": {"live_fob": "en pie, LAB corral", "dressed_delivered": "en canal, entregado en la planta"}[main_basis],
              "live": fl, "dressed": fd, "main": fl if main_basis == "live_fob" else fd, "current": main[-1][0] == latest_week,
              "bases": bases, "detail": detail, "has_detail": rid != 2481, "grid_base": grid_base,
              "weeks_year": weeks_year, "first_iso": main[0][0], "since": d_full(week_of(min(r[0] for r in (live + dressed)))[0]),
              "since_es": d_full_es(week_of(min(r[0] for r in (live + dressed)))[0]), "last_iso": max(r[0] for r in (live + dressed)),
              "weeks_all": fmt(len({r[0] for r in live + dressed})),
              "chart_live": mchart([("line", "Live", live)]), "chart_dressed": mchart([("line2", "Dressed", dressed)]),
              "rows": grid_rows, "grid": year_grid(mavg, grid_fmt), "season": seasons(mavg, latest_week), "note": notes.get(slug),
              "tool": {"live": fl["v"] if fl and fl["current"] else (fl["v"] if fl else None), "dressed": fd["v"] if fd else None,
                       "dress": next((r[2] for b in ("dressed_delivered", "live_fob") for r in series(slug, b)[-1:] if r[2]), None),
                       "weight": next((r[5] for r in live[-1:] if r[5]), None)}}
        if weeks_year >= CATTLE_PAGE_WEEKS or os.path.exists(os.path.join(CATTLE_REG_DIR, slug + ".md")):
            pages[slug] = pg
        regions.append({"slug": slug if slug in pages else "", "slug_es": slug_es if slug in pages else "", "name": name, "es": name_es,
                        "states": states, "states_es": states_es, "current": pg["current"],
                        "live": fl["cwt"] if fl and fl["current"] else "", "live_chg": fl["change"] if fl and fl["current"] else "",
                        "dressed": fd["cwt"] if fd and fd["current"] else "", "dressed_chg": fd["change"] if fd and fd["current"] else "",
                        "head": fmt(int(sum((series(slug, b)[-1][1] or 0) for b in BASIS.values() if series(slug, b) and series(slug, b)[-1][0] == latest_week))),
                        "last": wk_label(main[-1][0]), "last_es": wk_label_es(main[-1][0])})

    # Other regions on each page.
    for slug, pg in pages.items():
        pg["others"] = [r for r in regions if r["slug"] != slug and (r["live"] or r["dressed"])]

    # ---- the board: 5-area steers, this week's days, and the regions
    fa = pages.get("five-area")
    sl, sd = series("five-area", "live_fob", "steer"), series("five-area", "dressed_delivered", "steer")
    fsl, fsd = facts(sl), facts(sd)
    hl, hdd = series("five-area", "live_fob", "heifer"), series("five-area", "dressed_delivered", "heifer")
    days_order = sorted({r[0] for k, rows in D.items() for r in rows})
    latest_day = days_order[-1] if days_order else None
    dl = D.get(("steer", "live_fob", "total"), []); ddr = D.get(("steer", "dressed_delivered", "total"), [])
    dall = {b: {r[0]: r for r in D.get(("all", b, "total"), [])} for b in BASIS.values()}
    day_rows = []
    for d in days_order[::-1][:10]:
        lv = next((r for r in dl if r[0] == d), None); dv = next((r for r in ddr if r[0] == d), None)
        heads = sum((dall[b].get(d) or [0, 0])[1] or 0 for b in BASIS.values())
        day_rows.append({"day": d_label(d), "day_es": d_label_es(d), "live": cwt(lv[8]) if lv else "", "live_head": hd(lv[1]) if lv else "",
                         "dressed": cwt(dv[8]) if dv else "", "dressed_head": hd(dv[1]) if dv else "", "head": fmt(int(heads)) if heads else ""})
    ld = next((r for r in dl[::-1]), None); dd = next((r for r in ddr[::-1]), None)
    weekday = lambda iso: f"{iso_day(iso):%A}, {iso_day(iso):%B} {iso_day(iso).day}"
    weekday_es = lambda iso: f"{['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'][iso_day(iso).weekday()]} {iso_day(iso).day} de {MONTHS_ES_FULL[iso_day(iso).month - 1]}"
    wk0, wk1 = week_of(latest_week)
    span_en = f"{iso_day(wk0):%b} {iso_day(wk0).day} to {d_full(wk1)}" if wk0[:4] == wk1[:4] else f"{d_full(wk0)} to {d_full(wk1)}"
    span_es = f"{iso_day(wk0).day} {MONTHS_ES[iso_day(wk0).month - 1]} al {d_full_es(wk1)}" if wk0[:4] == wk1[:4] else f"{d_full_es(wk0)} al {d_full_es(wk1)}"
    summ = [f"In the week of {span_en}, packers paid {fsl['cwt']} per hundredweight for live steers in the 5-area market"
            + (f" ({fsl['change']} from the week before)" if fsl["change"] else "") + f" and {fsd['cwt']} for dressed steers, delivered"
            + (f" ({fsd['change']})" if fsd["change"] else "") + "."]
    summ_es = [f"En la semana del {span_es}, los empacadores pagaron {fsl['cwt']} por quintal (cwt) por novillos en pie en el mercado de 5 áreas"
               + (f" ({fsl['change']} frente a la semana anterior)" if fsl["change"] else "") + f" y {fsd['cwt']} por novillos en canal, entregados"
               + (f" ({fsd['change']})" if fsd["change"] else "") + "."]
    tot = sum(int(x[1] or 0) for b in BASIS.values() for x in series("five-area", b)[-1:] if x[0] == latest_week)
    if tot:
        summ.append(f"USDA counted {fmt(tot)} head of steers and heifers bought on negotiated cash deals that week.")
        summ_es.append(f"El USDA contó {fmt(tot)} cabezas de novillos y vaquillas compradas en tratos negociados de contado esa semana.")
    if ld and ld[0] > latest_week:
        summ.append(f"So far this week, the latest daily report ({weekday(ld[0])}) has live steers at {cwt(ld[8])}" + (f" and dressed at {cwt(dd[8])}" if dd and dd[0] == ld[0] else "") + ".")
        summ_es.append(f"En lo que va de esta semana, el último reporte diario ({weekday_es(ld[0])}) tiene los novillos en pie a {cwt(ld[8])}" + (f" y en canal a {cwt(dd[8])}" if dd and dd[0] == ld[0] else "") + ".")
    rec = max(sl, key=lambda r: r[8])
    board_live_months = head_monthly(sl)
    chart_y = mchart([("line", "Steers", [r for r in sl if r[0] > year_start]), ("line2", "Heifers", [r for r in hl if r[0] > year_start])])
    chart_all_l = mchart([("line", "Live steers", sl)])
    chart_all_d = mchart([("line2", "Dressed steers", sd)])
    detail5 = fa["detail"] if fa else []

    # ---- the downloads (also the archive the next run reads back)
    os.makedirs(CATTLE_DIR, exist_ok=True)
    num = lambda v: "" if v is None else (f"{v:.0f}" if float(v).is_integer() else f"{v:.2f}")
    with open(CATTLE_WEEKLY_CSV, "w", encoding="utf-8", newline="") as fh:
        wr = csv.writer(fh, lineterminator="\n")
        wr.writerow(["report_date", "week_start", "week_end", "region", "purchase", "class", "basis", "grade"] + CW)
        for k in sorted(W):
            for r in W[k]:
                a, b = week_of(r[0]); wr.writerow([r[0], a, b, *k] + [num(v) for v in r[1:]])
    with open(CATTLE_DAILY_CSV, "w", encoding="utf-8", newline="") as fh:
        wr = csv.writer(fh, lineterminator="\n")
        wr.writerow(["date", "class", "basis", "grade"] + CW)
        for k in sorted(D):
            for r in D[k]: wr.writerow([r[0], *k] + [num(v) for v in r[1:]])
    downloads = [{"file": os.path.basename(CATTLE_WEEKLY_CSV), "label": "Every region, class, basis and grade, every week since 2020",
                  "label_es": "Cada región, clase, base y grado, cada semana desde 2020", "rows": fmt(sum(len(v) for v in W.values())),
                  "kb": fmt(round(os.path.getsize(CATTLE_WEEKLY_CSV) / 1024))},
                 {"file": os.path.basename(CATTLE_DAILY_CSV), "label": "The 5-area daily report, every business day since 2020",
                  "label_es": "El reporte diario de 5 áreas, cada día hábil desde 2020", "rows": fmt(sum(len(v) for v in D.values())),
                  "kb": fmt(round(os.path.getsize(CATTLE_DAILY_CSV) / 1024))}]

    # ---- stubs, English and Spanish, never deleted
    os.makedirs(CATTLE_REG_DIR, exist_ok=True); os.makedirs(CATTLE_REG_ES_DIR, exist_ok=True)
    for slug, pg in pages.items():
        # Region names with their article: "the Eastern Cornbelt", "el Cornbelt oriental".
        IN_EN = {"five-area": "the 5-area market", "western-cornbelt": "the Western Cornbelt", "eastern-cornbelt": "the Eastern Cornbelt",
                 "northern-plains": "the Northern Plains", "western-states": "the Western States", "northeast": "the Northeast"}
        IN_ES = {"five-area": "las 5 áreas", "western-cornbelt": "el Cornbelt occidental", "eastern-cornbelt": "el Cornbelt oriental",
                 "northern-plains": "las Planicies del norte", "western-states": "los Estados del oeste", "northeast": "el Noreste"}
        where, where_es = IN_EN.get(slug, pg["name"]), IN_ES.get(slug, pg["es"])
        since_y = pg["first_iso"][:4]
        if slug == "five-area":
            t, t_es = "5-area fed cattle prices", "Precio del ganado gordo en las 5 áreas"
            seo, seo_es = "5-Area Fed Cattle Price This Week · USDA Weighted Average", "Precio del ganado gordo, 5 áreas · USDA"
        else:
            t, t_es = f"Fed cattle prices in {where}", f"Precio del ganado gordo en {where_es}"
            seo = fit(f"{pg['name']} Fed Cattle Prices This Week · USDA", f"{pg['name']} Fed Cattle Prices This Week", f"{pg['name']} Fed Cattle Prices")
            seo_es = fit(f"Precio del ganado gordo en {where_es} · USDA", f"Ganado gordo en {where_es}: precio · USDA", f"Ganado gordo en {where_es}")
        states = "" if slug == "five-area" else f" ({pg['states']})"
        states_es = "" if slug == "five-area" else f" ({pg['states_es']})"
        desc = fit(f"What packers paid for fed steers and heifers in {where}{states} each week, live and dressed, from USDA's cash reports, every week since {since_y}.",
                   f"What packers paid for fed steers and heifers in {where} each week, live and dressed, from USDA's negotiated cash reports, every week since {since_y}.",
                   f"Weekly USDA fed cattle prices for {where}, live and dressed, every week since {since_y}.", limit=160)
        desc_es = fit(f"Lo que pagaron los empacadores por novillos y vaquillas gordos en {where_es}{states_es} cada semana, en pie y en canal, desde {since_y}.",
                      f"Lo que pagaron los empacadores por novillos y vaquillas gordos en {where_es} cada semana, en pie y en canal, según el USDA, desde {since_y}.",
                      f"Precio semanal del ganado gordo en {where_es} según el USDA, en pie y en canal, desde {since_y}.", limit=160)
        for d_, s_, t_, so_, de_, tr_ in ((CATTLE_REG_DIR, slug, t, seo, desc, f"/es/precios-de-ganado-gordo/{pg['slug_es']}/"),
                                          (CATTLE_REG_ES_DIR, pg["slug_es"], t_es, seo_es, desc_es, f"/fed-cattle-prices/{slug}/")):
            f = os.path.join(d_, s_ + ".md")
            if os.path.exists(f): continue
            with open(f, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(f"---\nregion: {slug}\ntitle: {json.dumps(t_, ensure_ascii=False)}\nseo_title: {json.dumps(so_, ensure_ascii=False)}\n"
                         f"description: {json.dumps(de_, ensure_ascii=False)}\ntranslation: {json.dumps(tr_)}\n---\n")

    feed = {"source": "USDA AMS Livestock Mandatory Reporting: LM_CT150 (5-area weekly), LM_CT156-158 (Texas-Oklahoma, Kansas, Nebraska weekly), LM_CT154 (national weekly, regional table), LM_CT100 (5-area daily)",
            "license": "U.S. government data, public domain. Credit USDA AMS.", "units": "USD per hundredweight (100 lb), live or dressed weight as the basis says",
            "week": {"report_date": latest_week, "start": wk0, "end": wk1},
            "five_area": {"steer_live_fob": fsl["v"], "steer_dressed_delivered": fsd["v"]},
            "regions": [{"region": p["slug"], "name": p["name"], "states": p["states"], "report": p["report"],
                         "live_fob": p["live"]["v"] if p["live"] and p["live"]["current"] else None,
                         "dressed_delivered": p["dressed"]["v"] if p["dressed"] and p["dressed"]["current"] else None,
                         "page": f"https://juantorresmi.github.io/fed-cattle-prices/{p['slug']}/"} for p in pages.values()],
            "latest_day": None if not ld else {"date": ld[0], "steer_live_fob": ld[8], "steer_dressed_delivered": dd[8] if dd and dd[0] == ld[0] else None},
            "history": [f"https://juantorresmi.github.io/fed-cattle-prices/{x['file']}" for x in downloads]}
    with open(os.path.join(CATTLE_DIR, "latest.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(feed, fh, ensure_ascii=False, indent=1); fh.write("\n")

    return {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "latest_week": latest_week, "week": wk_label(latest_week), "week_es": wk_label_es(latest_week),
            "week_start": d_full(wk0), "week_end": d_full(wk1), "week_start_es": d_full_es(wk0), "week_end_es": d_full_es(wk1),
            "latest_day": latest_day, "day": d_label(latest_day) if latest_day else "", "day_es": d_label_es(latest_day) if latest_day else "",
            "first": d_full(week_of(sl[0][0])[0]), "first_es": d_full_es(week_of(sl[0][0])[0]), "first_iso": sl[0][0], "weeks": fmt(len(sl)),
            "stamp": {"live": fsl["cwt"], "live_chg": fsl["change"], "dressed": fsd["cwt"], "dressed_chg": fsd["change"], "head": fmt(tot) if tot else "",
                      "day_live": cwt(ld[8]) if ld else "", "day_dressed": cwt(dd[8]) if dd else "", "day": d_label(ld[0]) if ld else "", "day_es": d_label_es(ld[0]) if ld else ""},
            "summary": " ".join(summ), "summary_es": " ".join(summ_es), "steer_live": fsl, "steer_dressed": fsd,
            "heifer_live": facts(hl) if hl else None, "heifer_dressed": facts(hdd) if hdd else None,
            "record": {"cwt": cwt(rec[8]), "week": wk_label(rec[0]), "week_es": wk_label_es(rec[0]), "now": rec[0] == latest_week},
            "chart_year": chart_y, "chart_live": chart_all_l, "chart_dressed": chart_all_d, "days": day_rows, "regions": regions, "detail": detail5,
            "grid": year_grid(board_live_months, lambda v: f"{v:,.2f}"), "season": seasons(board_live_months, latest_week),
            "span": span_en, "span_es": span_es,
            "downloads": downloads, "tool": None if not fa else {**fa["tool"], "dress": fa["tool"]["dress"] or (pages.get("nebraska") or {}).get("tool", {}).get("dress")}, "page_count": len(pages), "items": pages}


def main():
    base = worker_url()
    if not base: sys.exit("no worker_url in _config.yml")
    os.makedirs(OUT, exist_ok=True)
    failed = 0
    jobs = (("youtube", lambda: youtube(get(base + "/youtube"))), ("watching", lambda: watching(get(base + "/"))),
            ("reefer", lambda: reefer(base)), ("border", lambda: border(base)), ("beef", beef), ("pork", pork), ("cattle", cattle))
    only = sys.argv[1:]                          # `snapshot.py beef` runs just that one
    if only: jobs = tuple(j for j in jobs if j[0] in only)
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
