#!/usr/bin/env python3
"""Copies the Worker's live data into the site, so pages that fill themselves in by script
also have real content in their HTML: for search engines, AI crawlers and readers with
JavaScript off. The script on each page still fetches fresh numbers for everyone else.

    python3 scripts/snapshot.py

Writes _data/live/youtube.json and _data/live/watching.json, already formatted the way the
pages show them (Liquid on GitHub Pages can't put commas in numbers or say "Oct 14"), so the
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


def main():
    base = worker_url()
    if not base: sys.exit("no worker_url in _config.yml")
    os.makedirs(OUT, exist_ok=True)
    failed = 0
    for name, path, shape in (("youtube", "/youtube", youtube), ("watching", "/", watching)):
        try:
            data = shape(get(base + path))
        except Exception as e:
            print(f"{name}: kept the last snapshot ({e})", file=sys.stderr); failed += 1; continue
        with open(os.path.join(OUT, name + ".json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, ensure_ascii=False, indent=1); f.write("\n")
        print(f"{name}: written")
    sys.exit(1 if failed == 2 else 0)


if __name__ == "__main__":
    main()
