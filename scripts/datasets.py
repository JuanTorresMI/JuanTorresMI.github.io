"""Keeps the open datasets in data/: USDA AMS datamart reports archived as published, one CSV per table.

What each dataset is lives in _data/datasets.json. For every table this reads its CSV back, asks the
datamart (keyless) only for the days since 45 days before the newest row (USDA corrects recent reports),
replaces those days, and writes the file. A new table is filled from START. Then it writes
_data/live/datasets.json (rows, first and newest date of every file) for /data/.

Rows are USDA's as given, minus the columns that are the same on every row (office, market type, title).
Columns keep the order they were first seen in; a column USDA adds later goes at the end, so a published
file never changes shape. Dates become YYYY-MM-DD and numbers lose their thousands commas.

    python3 scripts/datasets.py            # update every table
    python3 scripts/datasets.py hog        # only datasets whose slug contains "hog"
    python3 scripts/datasets.py --count    # fetch nothing; just recount the files (the boards' too)
"""
import csv, glob, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONF = os.path.join(ROOT, "_data", "datasets.json")
OUT = os.path.join(ROOT, "_data", "live", "datasets.json")
DATA = os.path.join(ROOT, "data")
LMR = "https://mpr.datamart.ams.usda.gov/services/v1.1/reports"
START = date(2020, 1, 1)
REFETCH_DAYS = 45
CHUNK_DAYS = 366                             # the datamart answers at most 99,999 rows a request
# A section's "/" is sent as is: the datamart answers %2F with a 400.
PAUSE = 1.5                                  # seconds between requests: twelve at once got this machine a 403 for hours
BUDGET = int(os.environ.get("DATASETS_BUDGET", "450"))   # requests per run; a table not reached is filled next run


class Blocked(Exception): pass
_sent = [0]
DROP = re.compile(r"^(narrative|report_title|slug_name|slug_id|office_.*|market_location_.*|market_type.*|published_date|is_correction)$")
MDY = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})(?: [\d:]+)?$")
NUM = re.compile(r"^-?[\d,]*\.?\d+$")


def snake(k):
    return re.sub(r"[^a-z0-9]+", "_", str(k).strip().lower()).strip("_")


def clean(v):
    if v is None: return ""
    s = str(v).strip()
    m = MDY.match(s)
    if m: return f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    if NUM.match(s): return s.replace(",", "")
    return s


def fetch(rid, section, field, first, last):
    """Every row of one report section between two dates, in chunks."""
    out, a = [], first
    while a <= last:
        b = min(last, a + timedelta(days=CHUNK_DAYS - 1))
        url = f"{LMR}/{rid}/{urllib.parse.quote(section, safe='/')}?q={field}={a:%m/%d/%Y}:{b:%m/%d/%Y}"
        req = urllib.request.Request(url, headers={"User-Agent": "site-datasets (github.com/JuanTorresMI)", "Accept": "application/json"})
        if _sent[0] >= BUDGET: raise Blocked("this run's request budget is spent")
        for attempt in range(3):
            _sent[0] += 1; time.sleep(PAUSE)
            try:
                with urllib.request.urlopen(req, timeout=300) as r: body = json.load(r)
                break
            except urllib.error.HTTPError as e:
                if e.code == 403: raise Blocked("the datamart answered 403; stopping for this run")
                if attempt == 2: raise
                print(f"  {rid} {section} {a}: {e}; again", file=sys.stderr); time.sleep(10)
            except Exception as e:
                if attempt == 2: raise
                print(f"  {rid} {section} {a}: {e}; again", file=sys.stderr); time.sleep(10)
        if isinstance(body, dict): out += body.get("results") or []
        elif isinstance(body, list):
            for s in body: out += (s.get("results") or []) if isinstance(s, dict) else []
        a = b + timedelta(days=1)
    return out


def table(t):
    path = os.path.join(DATA, t["slug"], t["file"] + ".csv")
    multi = len(t["sections"]) > 1
    header, rows = [], []
    if os.path.exists(path):
        with open(path, encoding="utf-8", newline="") as fh:
            rd = csv.reader(fh); header = next(rd, []); rows = [r for r in rd]
    di = header.index(snake(t["date_field"])) if header else None
    newest = max((r[di] for r in rows if r[di]), default=None) if header else None
    first = (date.fromisoformat(newest) - timedelta(days=REFETCH_DAYS)) if newest else START
    last = date.today()
    new = []
    for sec in t["sections"]:
        for r in fetch(t["report"], sec, t["date_field"], first, last):
            row, seen = {}, set()
            for k, v in r.items():
                if DROP.match(k): continue
                n = snake(k)
                if n in seen: n = "row_" + n                 # "Week Ending Date" beside week_ending_date
                seen.add(n); row[n] = clean(v)
            if multi: row = {"section": sec, **row}
            new.append(row)
    if not header and not new: return path, None
    for r in new:
        for k in r:
            if k not in header: header.append(k)
    df = header.index(snake(t["date_field"]))
    kept = [r + [""] * (len(header) - len(r)) for r in rows if r[df] and r[df] < first.isoformat()]
    fresh = [[r.get(k, "") for k in header] for r in new if r.get(snake(t["date_field"]), "") >= first.isoformat()]
    allr = sorted(kept + fresh, key=lambda r: r[df])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        w = csv.writer(fh, lineterminator="\n"); w.writerow(header); w.writerows(allr)
    dates = [r[df] for r in allr if r[df]]
    print(f"{t['slug']}/{t['file']}.csv: {len(allr):,} rows, {len(fresh):,} fetched since {first}")
    return path, {"rows": len(allr), "first": min(dates) if dates else "", "newest": max(dates) if dates else "",
                  "columns": header, "bytes": os.path.getsize(path)}


DATE_COLS = ("date", "report_date", "week_of", "posted_local")


def file_stats(rel):
    """Rows, first and newest date, columns and size of one published CSV (the boards' own files)."""
    path = os.path.join(ROOT, rel)
    with open(path, encoding="utf-8", newline="") as fh:
        rd = csv.reader(fh); header = next(rd, []); rows = list(rd)
    di = next((header.index(c) for c in DATE_COLS if c in header), None)
    dates = [r[di][:10] for r in rows if di is not None and len(r) > di and r[di]]
    n, b = len(rows), os.path.getsize(path)
    return {"file": os.path.basename(rel)[:-4], "url": "/" + rel.replace(os.sep, "/"), "rows": n, "rows_fmt": f"{n:,}",
            "first": min(dates) if dates else "", "newest": max(dates) if dates else "", "columns": header, "bytes": b,
            "size": f"{b / 1e6:.1f} MB" if b >= 1e5 else f"{b / 1e3:.0f} KB"}


def boards(conf):
    """The boards' own CSVs (they stay at their board's address), described the same way for /data/."""
    out = []
    for b in conf.get("boards", []):
        files = [file_stats(os.path.relpath(f, ROOT)) for g in b["files"] for f in sorted(glob.glob(os.path.join(ROOT, g)))]
        if not files: continue
        dated = [f for f in files if f["first"]]
        out.append({"slug": b["slug"], "rows": sum(f["rows"] for f in files), "rows_fmt": f"{sum(f['rows'] for f in files):,}",
                    "first": min((f["first"] for f in dated), default=""), "newest": max((f["newest"] for f in dated), default=""), "files": files})
    return out


def main():
    conf = json.load(open(CONF, encoding="utf-8"))
    only = sys.argv[1] if len(sys.argv) > 1 else ""
    old = {}
    if os.path.exists(OUT):
        old = {(d["slug"], f["file"]): f for d in json.load(open(OUT, encoding="utf-8")).get("datasets", []) for f in d["files"]}
    out, failed, blocked = [], 0, ""
    for d in conf["datasets"]:
        files = []
        for t in d["tables"]:
            t = {**t, "slug": d["slug"]}
            info = old.get((d["slug"], t["file"]))
            if only != "--count" and (not only or only in d["slug"]):
                if not blocked:
                    try: _, got = table(t); info = {**got, "file": t["file"]} if got else info
                    except Blocked as e: blocked = str(e); print(f"{d['slug']}/{t['file']}: {e}", file=sys.stderr)
                    except Exception as e: failed += 1; print(f"{d['slug']}/{t['file']}: {e}", file=sys.stderr)
            if info:
                info = {**info, "file": t["file"], "url": f"/data/{d['slug']}/{t['file']}.csv", "report": t["report"], "code": t["code"],
                        "rows_fmt": f"{info['rows']:,}", "size": f"{info['bytes'] / 1e6:.1f} MB" if info["bytes"] >= 1e5 else f"{info['bytes'] / 1e3:.0f} KB"}
                files.append(info)
        if files:
            out.append({"slug": d["slug"], "rows": sum(f["rows"] for f in files), "rows_fmt": f"{sum(f['rows'] for f in files):,}",
                        "first": min(f["first"] for f in files if f["first"]), "newest": max(f["newest"] for f in files), "files": files})
    bds = boards(conf)
    total = sum(d["rows"] for d in out)
    every = total + sum(b["rows"] for b in bds)
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        json.dump({"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "rows": total, "rows_fmt": f"{total:,}",
                   "files": sum(len(d["files"]) for d in out), "all_rows_fmt": f"{every:,}",
                   "all_files": sum(len(d["files"]) for d in out) + sum(len(b["files"]) for b in bds),
                   "datasets": out, "boards": bds}, fh, indent=1, ensure_ascii=False); fh.write("\n")
    print(f"{len(out)} datasets, {total:,} rows, {_sent[0]} requests" + (f"; {failed} table(s) failed" if failed else "") + (f"; stopped: {blocked}" if blocked else ""))
    if failed and not out: sys.exit(1)


if __name__ == "__main__":
    main()
