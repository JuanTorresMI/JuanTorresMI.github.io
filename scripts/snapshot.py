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
    _data/live/beef.json        /beef-prices/ and every cut page

plus a front-matter stub for each reefer lane (_reefer_lanes/), each named border crossing
(_border_crossings/, _border_crossings_es/) and each beef cut (_beef_cuts/), never deleted, and the
CSV downloads. A source that fails or answers with an error is skipped and its last good file
stays. The `Snapshot live pages` workflow runs this twice a day and commits whatever changed.
Needs only the standard library.
"""
import csv, json, os, re, sys, urllib.request
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

LANES_DIR = os.path.join(ROOT, "_reefer_lanes")
LANE_MIN_WEEKS = 4                          # fewer quotes than this makes too thin a page
CITY_CODES = {"Atlanta": "ATL", "Baltimore": "BAL", "Boston": "BOS", "Chicago": "CHI", "Dallas": "DAL", "Los Angeles": "LA",
              "Miami": "MIA", "New York": "NYC", "Philadelphia": "PHL", "Seattle": "SEA"}


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
    if not cur.get("latest"): raise RuntimeError("the Worker has no reefer data yet")
    names = districts()
    def place(d):
        if d not in names:
            print(f"reefer: add {d!r} to _data/reefer_districts.json", file=sys.stderr)
            names[d] = {"name": d.title(), "short": d.title(), "slug": slugify(d)}
        return names[d]
    lane_slug = lambda district, dest: f"{place(district)['slug']}-to-{slugify(dest)}"

    # History: the archive (the committed CSV), with the Worker's weeks laid over it.
    merged = archive()
    for y in cur.get("years") or []:
        for l in get(f"{base}/reefer/history?year={y}")["lanes"]:
            got = merged.setdefault((l["district"], l["dest"]), {})
            for w in l["weeks"]: got[w[0]] = w
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
    if cur.get("backfill_done") or not older:
        history = f"Every week back to {week_of(have[0])}." if cur.get("backfill_done") else \
            f"Every week back to {week_of(run)} so far; the rest of USDA’s history is still being collected, one week an hour."
    else:
        history = (f"Every week back to {week_of(run)} so far, plus {len(older)} week{'s' if len(older) != 1 else ''} from "
                   f"{week_of(older[0])} to {week_of(older[-1])}. The gap between is still being collected, one week an hour.")

    # When USDA published this week's report, and when the next one is due (Wednesdays, for the
    # week that started the Monday before).
    pub = None
    try: pub = datetime.strptime((cur.get("published") or "").split(" ")[0], "%m/%d/%Y")
    except ValueError: pass
    due = datetime.fromisoformat(latest) + timedelta(days=9)

    # 6. Diesel.
    fuel = cur.get("diesel") or []
    diesel = None
    if fuel:
        a, b = fuel[-1], (fuel[-2] if len(fuel) > 1 else None)
        d = None if not b else round((a["price"] - b["price"]) * 100, 1)
        peak = max(fuel, key=lambda x: x["price"])
        diesel = {"price": f"${a['price']:.3f}", "week": week_of(a["week"]),
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
        desc = f"USDA's weekly spot rates for a reefer truck from {p['short']} to {p['dest']}: the latest rate, every week on record, and every origin into {p['dest']}."
        with open(f, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(f"---\nlane: {slug}\ntitle: {json.dumps(title, ensure_ascii=False)}\nseo_title: {json.dumps(seo, ensure_ascii=False)}\n"
                     f"description: {json.dumps(desc, ensure_ascii=False)}\n---\n")

    return {"generated": cur["updated"], "latest": latest, "week": week_of(latest), "first": week_of(record[0] + "-01") if record else week_of(cur["first"]),
            "first_iso": min(x[0] for weeks in lanes.values() for x in weeks), "record_months": len(record),
            "backfill_done": bool(cur.get("backfill_done")), "diesel": diesel, "lanes": pages, "history": history,
            "published": full_date(pub) if pub else "", "next_due": f"{due:%a}, {full_date(due)}",
            "summary": " ".join(parts), "ups": [public(x) for x in ups], "downs": [public(x) for x in downs],
            "capacity": capacity, "city_tables": city_tables, "seasons": seasons, "lookup": lookup,
            "cities": [{"name": c, "code": CITY_CODES.get(c, c[:3].upper())} for c in cities], "sheet": sheet, "also": also,
            "quoted": len(cells), "origin_count": len(sheet), "lane_count": len(pages),
            "row_count": sum(len(w) for w in lanes.values())}


# ------------------------------------------------------------------- the boxed beef board ----
# /beef-prices/ and a page per cut (/beef-prices/<slug>/), from the Worker's /beef (the newest
# report) and /beef/history (a month at a time). Like the reefer board, no page script: USDA posts
# once a day, so the copy is the page. The CSV downloads are also the archive: they are read back
# first and the Worker's days laid over them, so a day once collected is never lost, and the pages
# keep the whole history even while a freshly deployed Worker is still backfilling.

BEEF_DIR = os.path.join(ROOT, "beef-prices")
BEEF_CUTS_DIR = os.path.join(ROOT, "_beef_cuts")
BEEF_CUTOUT_CSV = os.path.join(BEEF_DIR, "boxed-beef-cutout-daily.csv")
BEEF_YEAR_CSV = lambda y: os.path.join(BEEF_DIR, f"boxed-beef-cut-prices-{y}.csv")
BEEF_PAGE_DAYS = 26                          # days with a price in the last year before an item gets a page
BEEF_RECENT_DAYS = 45                        # the Worker's months this close to the latest are always re-read
BEEF_MOVER_TRADES = 10                       # trades a cut needs today to count as a mover (thin days are noise)
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
    if value is None or len(prior) < 20:
        return {"text": "Too few days on record yet to say how this price compares.", "tag": "", "pos": None}
    n, lower, higher = len(prior), sum(1 for p in prior if p < value), sum(1 for p in prior if p > value)
    if lower == n: text = f"Higher than on any of the other {n} {days} in the past year."
    elif higher == n: text = f"Lower than on any of the other {n} {days} in the past year."
    else: text = f"Higher than on {lower} of the other {n} {days} in the past year."
    tag = "On the high side" if lower / n > 2 / 3 else "On the low side" if lower / n < 1 / 3 else "About average"
    return {"text": text, "tag": tag, "pos": round(lower / n * 100)}


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
    return {"w": w, "h": h, "lines": out, "top": fmt(hi), "bottom": fmt(lo), "start": d_full(min(seen)), "end": d_full(max(seen))}


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
    return {"years": f"{full[0][0]}–{full[-1][0]}", "count": len(full),
            "cells": [{"m": MONTH_ABBR[m], "v": "" if v is None else f"{'+' if v >= 0.05 else '−' if v <= -0.05 else '±'}{abs(v):.1f}%",
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
        "cwt": usd(last[3]), "lb": per_lb(last[3]), "v": last[3],
        "range": "" if last[1] is None or last[2] is None else (usd(last[1]) if last[1] == last[2] else f"{usd(last[1])}–{usd(last[2])}"),
        "trades": "" if last[4] is None else fmt(last[4]), "lbs": "" if last[5] is None else fmt(last[5]),
        "change": money_change(last[3], before[3]) if before else "", "change_pct": pct_change(last[3], before[3]) if before else "",
        "change_since": d_label(before[0]) if before else "",
        "standing": standing([r[3] for r in year if r is not last], last[3], days),
        "year_ago": None if not ago else {"date": d_full(ago[0]), "cwt": usd(ago[3]), "lb": per_lb(ago[3]), "change": pct_change(last[3], ago[3])},
        "avg": usd(sum(vals) / len(vals)) if vals else "", "low": usd(lo[3]) if lo else "", "low_day": d_full(lo[0]) if lo else "",
        "high": usd(hi[3]) if hi else "", "high_day": d_full(hi[0]) if hi else "", "days_year": len(year),
    }


def beef(base):
    cur = get(base + "/beef")
    if not cur.get("latest"): raise RuntimeError("the Worker has no beef data yet")
    names = cut_names()

    # History: the archive (the committed CSVs), with the Worker's days laid over it. Old months the
    # archive already holds aren't asked for again; recent ones always are, in case USDA corrected
    # them, and so is the archive's oldest month, which is where a backfill still running stopped.
    days, items = beef_archive()
    have = {d[:7] for d in days}
    have.discard(min(have, default=None))
    recent = (iso_day(cur["latest"]) - timedelta(days=BEEF_RECENT_DAYS)).date().isoformat()[:7]
    for m in cur.get("months") or []:
        if m in have and m < recent: continue
        h = get(f"{base}/beef/history?month={m}")
        got = {r[0] for r in h.get("days") or []}
        if not got: continue
        for k in items:
            for d in got: items[k].pop(d, None)
        for r in h["days"]: days[r[0]] = r
        for it in h.get("items") or []:
            bucket = items.setdefault((it["section"], it["item"], it["grade"]), {})
            for r in it["days"]: bucket[r[0]] = r
    series = {k: [v[d] for d in sorted(v)] for k, v in items.items() if v}
    order = sorted(days)
    latest, first = order[-1], order[0]
    # The history is whole once it reaches the Worker's start date, whether the Worker walked there
    # itself or the archive already held it (a freshly deployed Worker is still backfilling).
    complete = bool(cur.get("backfill_done")) or (iso_day(first) - iso_day(cur.get("start") or first)).days < 7
    today, prior = days[latest], (days[order[-2]] if len(order) > 1 else None)

    def info(item):
        if item not in names:
            print(f"beef: add {item!r} to _data/beef_cuts.json", file=sys.stderr)
            names[item] = {"name": item, "slug": slugify(item)}
        return names[item]

    # Every item, its grades together: {(section, item): {grade: rows}}.
    by_item = {}
    for (section, item, grade), rows in series.items():
        by_item.setdefault((section, item), {})[grade] = rows
    year_start = (iso_day(latest) - timedelta(days=365)).date().isoformat()
    grade_order = {"choice": 0, "select": 1, "": 2}

    # ---- the item pages
    pages = {}
    for (section, item), grades in by_item.items():
        traded = {r[0] for rows in grades.values() for r in rows if r[0] > year_start}
        if section != "primal" and len(traded) < BEEF_PAGE_DAYS and not os.path.exists(os.path.join(BEEF_CUTS_DIR, info(item)["slug"] + ".md")):
            continue
        i = info(item)
        gs = sorted(grades, key=lambda g: grade_order.get(g, 3))
        main = gs[0]
        facts = [{"grade": g, "label": GRADE_NAMES.get(g, g), **grade_facts(grades[g], latest, "business days" if section == "primal" else "days it traded")} for g in gs]
        lines = [("line" if n == 0 else "line2", GRADE_NAMES.get(g, g), [(r[0], r[3]) for r in grades[g]]) for n, g in enumerate(gs)]
        mavg = monthly(grades[main])
        # The last 20 days it traded, in any grade, newest first.
        recent_days = sorted({r[0] for g in gs for r in grades[g]})[-20:][::-1]
        lookup = {g: {r[0]: r for r in grades[g]} for g in gs}
        rows = []
        for d in recent_days:
            cells = [lookup[g].get(d) for g in gs]
            rows.append({"day": d_full(d), "cells": [{"cwt": usd(c[3]) if c else "", "lb": per_lb(c[3]) if c else "",
                                                       "range": "" if not c or c[1] is None or c[2] is None else f"{usd(c[1])}–{usd(c[2])}",
                                                       "lbs": "" if not c or c[5] is None else fmt(c[5]), "trades": "" if not c or c[4] is None else fmt(c[4])} for c in cells]})
        all_days = sorted({r[0] for g in gs for r in grades[g]})
        pk = i.get("primal")
        pages[i["slug"]] = {
            "name": i["name"], "usda": item, "section": section, "kind": SECTIONS.get(section, section),
            "imps": i.get("imps", ""), "fl": i.get("fl"), "fat": FAT.get(i.get("fl"), ""), "also": i.get("also", ""),
            "primal": pk or "", "primal_name": dict(PRIMALS).get(pk, ""), "grades": facts, "main": GRADE_NAMES.get(main, main),
            "current": any(f["current"] for f in facts), "last_iso": max(f["iso"] for f in facts),
            "since": d_full(all_days[0]), "days_all": fmt(len(all_days)), "days_year": len(traded),
            "chart": beef_chart(lines, usd, weekly=True),
            "grid": year_grid(mavg, lambda v: f"{v / 100:,.2f}" if section != "primal" else f"{v:,.0f}"),
            "grid_unit": "$ per lb" if section != "primal" else "$ per cwt",
            "season": seasons(mavg, latest),
            "heads": [GRADE_NAMES.get(g, g) for g in gs], "rows": rows,
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
                sib.append({"name": info(item)["name"], "slug": slug_of[(section, item)], "lb": per_lb(last[3]), "grade": GRADE_NAMES.get(g, g),
                            "here": slug_of[(section, item)] == slug, "v": last[3]})
        pg["siblings"] = [{k: v for k, v in s.items() if k != "v"} for s in sorted(sib, key=lambda s: -s["v"])]
        pv = series.get(("primal", PRIMAL_ITEM[pg["primal"]], "choice"))
        pg["primal_slug"] = slug_of.get(("primal", PRIMAL_ITEM[pg["primal"]]), "")
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
              "high": usd(hi52[1]), "high_day": d_full(hi52[0]), "low": usd(lo52[1]), "low_day": d_full(lo52[0]),
              "avg": usd(sum(year_c) / len(year_c)), "record": usd(rec[1]), "record_day": d_full(rec[0]),
              "record_now": rec[0] == latest, "carcass_lb": per_lb(c),
              "year_ago": None if not ago else {"date": d_full(ago[0]), "cwt": usd(ago[1]), "change": pct_change(c, ago[1])}}
    chart_year = beef_chart([("line", "Choice", [x for x in cday if x[0] > year_start]), ("line2", "Select", [x for x in sday if x[0] > year_start])], usd)
    chart_all = beef_chart([("line", "Choice", cday), ("line2", "Select", sday)], usd, weekly=True)
    recent = []
    for n, d in enumerate(order[::-1][:10]):
        r, p = days[d], (days[order[-2 - n]] if len(order) > n + 1 else None)
        recent.append({"day": d_label(d), "choice": usd(r[1]), "choice_chg": money_change(r[1], p[1]) if p else "",
                       "select": usd(r[2]), "select_chg": money_change(r[2], p[2]) if p else "",
                       "spread": usd(r[1] - r[2]) if r[1] is not None and r[2] is not None else "",
                       "loads": fmt(round(r[3] + r[4])) if r[3] is not None and r[4] is not None else ""})
    cmonths = monthly([[d, None, None, v, None, None] for d, v in cday])

    # The primal values.
    primals = []
    for k, label in PRIMALS:
        ch, se = series.get(("primal", PRIMAL_ITEM[k], "choice"), []), series.get(("primal", PRIMAL_ITEM[k], "select"), [])
        if not ch or ch[-1][0] != latest: continue
        primals.append({"name": label, "slug": slug_of.get(("primal", PRIMAL_ITEM[k]), ""),
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
        return {"name": info(item)["name"], "slug": slug_of[(section, item)] if slug_of[(section, item)] in pages else "",
                "imps": info(item).get("imps", ""), "fl": info(item).get("fl", ""),
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
                quiet.append({"name": r["name"], "slug": r["slug"], "last": d_full(last)})
        if rows: groups.append({"name": label, "key": k, "rows": sorted(rows, key=lambda r: -r["v"])})
    ground = [row(section, item) for (section, item) in by_item if section in ("ground", "blended", "trim")]
    ground = sorted([g for g in ground if g["traded"]], key=lambda r: -r["v"])

    # Movers: today's weighted average against the same cut a week earlier, busy cuts only.
    moves = []
    for (section, item, grade), rows in series.items():
        if section not in ("cut", "mixed") or grade == "select" or rows[-1][0] != latest or (rows[-1][4] or 0) < BEEF_MOVER_TRADES: continue
        then = on_or_before(rows[:-1], (iso_day(latest) - timedelta(days=7)).date().isoformat())
        if not then: continue
        p = (rows[-1][3] - then[3]) / then[3] * 100
        moves.append({"name": info(item)["name"], "slug": slug_of[(section, item)] if slug_of[(section, item)] in pages else "",
                      "lb": per_lb(rows[-1][3]), "then": per_lb(then[3]), "then_day": d_label(then[0]), "change": pct_change(rows[-1][3], then[3]), "p": p})
    ups = [{k: v for k, v in m.items() if k != "p"} for m in sorted([m for m in moves if m["p"] >= 0.5], key=lambda m: -m["p"])[:6]]
    downs = [{k: v for k, v in m.items() if k != "p"} for m in sorted([m for m in moves if m["p"] <= -0.5], key=lambda m: m["p"])[:6]]

    # The index of every page, grouped the way a meat case is.
    index = []
    for k, label in PRIMALS:
        entries = sorted([(pg["name"], slug, pg["imps"]) for slug, pg in pages.items() if pg["primal"] == k and pg["section"] != "primal"])
        prim = next((slug for slug, pg in pages.items() if pg["section"] == "primal" and pg["primal"] == k), None)
        index.append({"name": label, "primal": prim, "pages": [{"name": n, "slug": sl, "imps": im} for n, sl, im in entries]})
    other = sorted([(pg["name"], slug, pg["imps"]) for slug, pg in pages.items() if not pg["primal"] and pg["section"] in ("cut", "mixed")])
    if other: index.append({"name": "Other cuts", "primal": None, "pages": [{"name": n, "slug": sl, "imps": im} for n, sl, im in other]})
    grinds = sorted([(pg["name"], slug, pg["imps"]) for slug, pg in pages.items() if pg["section"] in ("ground", "blended", "trim")])
    if grinds: index.append({"name": "Ground beef and trimmings", "primal": None, "pages": [{"name": n, "slug": sl, "imps": im} for n, sl, im in grinds]})

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
        if os.path.exists(f):
            ensure_front(f, "seo_title", seo)
            continue
        with open(f, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(f"---\ncut: {slug}\ntitle: {json.dumps(title, ensure_ascii=False)}\nseo_title: {json.dumps(seo, ensure_ascii=False)}\n"
                     f"description: {json.dumps(desc, ensure_ascii=False)}\n---\n")

    pub = None
    try: pub = datetime.strptime((cur.get("published") or "").split(" ")[0], "%m/%d/%Y")
    except ValueError: pass
    due = next_business_day(latest)
    return {"generated": cur["updated"], "latest": latest, "date": d_full(latest), "day": d_label(latest), "on_day": f"{iso_day(latest):%A}, {d_full(latest)}",
            "published": full_date(pub) if pub else "", "next_due": f"{due:%a}, {full_date(due)}",
            "first_iso": first, "first": d_full(first), "record_days": fmt(len(order)), "backfill_done": complete,
            "stamp": {"choice": usd(c), "choice_chg": money_change(c, pc), "select": usd(s), "select_chg": money_change(s, ps),
                      "spread": usd(spread) if spread is not None else "", "loads": fmt(round(loads[0] + loads[1])) if loads[0] is not None and loads[1] is not None else ""},
            "summary": " ".join(parts), "cutout": cutout, "chart_year": chart_year, "chart_all": chart_all, "recent": recent,
            "grid": year_grid(cmonths, lambda v: f"{v:,.0f}"), "season": seasons(cmonths, latest),
            "primals": primals, "groups": groups, "quiet": sorted(quiet, key=lambda q: q["name"]), "ground": ground,
            "ups": ups, "downs": downs, "index": index, "downloads": downloads,
            "traded": sum(len(g["rows"]) for g in groups), "page_count": len(pages), "items": pages}


def main():
    base = worker_url()
    if not base: sys.exit("no worker_url in _config.yml")
    os.makedirs(OUT, exist_ok=True)
    failed = 0
    jobs = (("youtube", lambda: youtube(get(base + "/youtube"))), ("watching", lambda: watching(get(base + "/"))),
            ("reefer", lambda: reefer(base)), ("border", lambda: border(base)), ("beef", lambda: beef(base)))
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
