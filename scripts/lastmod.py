#!/usr/bin/env python3
"""Works out when each page last really changed, from git, for the sitemap's <lastmod>.

    python3 scripts/lastmod.py

Writes _data/lastmod.json: { "<page source path>": "<ISO date>" }. A page's date is the
newest commit touching its own file or any data file it reads, directly or through an
include: the home page changes when projects.yml does, /youtube/ when the daily snapshot in
_data/live/ does. Layouts and site chrome don't count; a new footer is not new content.

The deploy and check workflows run this before Jekyll (with the full history checked out).
The file is not committed: a committed date file would change on every commit, including
its own. Without it the sitemap falls back to `last_modified_at` alone, as it always did.
Needs only the standard library.
"""
import json, os, re, subprocess
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP = ("_site/", "_layouts/", "_includes/", "_posts/", "worker/", "scripts/", "node_modules/", "vendor/", ".")

def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout

# Newest commit date for every file, from one pass over the log. All in UTC, so the strings
# compare in the right order.
dates = {}
when = None
for line in git("log", "--format=%x00%ct", "--name-only", "HEAD").splitlines():
    if line.startswith("\0"): when = datetime.fromtimestamp(int(line[1:]), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    elif line and line not in dates: dates[line] = when

def data_file(name):
    for ext in ("yml", "yaml", "json", "csv"):
        p = f"_data/{name}.{ext}"
        if p in dates: return p
    return None

def sources(path, seen):
    """The file itself plus every data file and include it reads, recursively."""
    if path in seen or not os.path.isfile(os.path.join(ROOT, path)): return
    seen.add(path)
    text = open(os.path.join(ROOT, path), encoding="utf-8", errors="replace").read()
    for m in re.finditer(r"site\.data\.([A-Za-z0-9_-]+)(?:\.([A-Za-z0-9_-]+))?", text):
        f = data_file(m.group(1)) or (m.group(2) and data_file(f"{m.group(1)}/{m.group(2)}"))
        if f: seen.add(f)
    if "site.posts" in text:                                  # the writing index lists every post
        seen.update(p for p in dates if p.startswith("_posts/"))
    for m in re.finditer(r"\{%-?\s*include\s+([\w./-]+)", text):
        sources("_includes/" + m.group(1), seen)

out = {}
for path in git("ls-files", "*.html", "*.md").splitlines():
    if path.startswith(SKIP): continue
    with open(os.path.join(ROOT, path), encoding="utf-8", errors="replace") as f:
        if f.readline().strip() != "---": continue            # not a Jekyll page
    seen = set(); sources(path, seen)
    newest = max((dates[p] for p in seen if p in dates), default=None)
    if newest: out[path] = newest

with open(os.path.join(ROOT, "_data", "lastmod.json"), "w", encoding="utf-8", newline="\n") as f:
    json.dump(out, f, indent=1, sort_keys=True); f.write("\n")
print(f"lastmod: {len(out)} pages dated")
