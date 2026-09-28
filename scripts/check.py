#!/usr/bin/env python3
"""Checks a built site (the _site folder Jekyll writes) for the things that break quietly.

    python3 scripts/check.py _site

Fails (exit 1) on: unrendered Liquid, JSON-LD that does not parse, a page without a title,
description, canonical or share image, an internal link or asset that points at nothing,
a sitemap entry with no page behind it, or a feed / manifest that does not parse.
Warns on descriptions outside the length search engines show. Needs only the standard library.
"""
import json, os, re, sys, html
from urllib.parse import unquote
from html.parser import HTMLParser
from xml.dom import minidom

site = sys.argv[1] if len(sys.argv) > 1 else "_site"
errors, warnings = [], []
err = lambda f, m: errors.append(f"{f}: {m}")
warn = lambda f, m: warnings.append(f"{f}: {m}")

def exists(url):
    """Does an internal URL resolve to a file in the build? /x/ -> /x/index.html, /x -> /x or /x.html."""
    path = unquote(url.split("#")[0].split("?")[0])
    if not path.startswith("/"): return True
    p = os.path.join(site, path.lstrip("/"))
    return os.path.isfile(p) or os.path.isfile(os.path.join(p, "index.html")) or os.path.isfile(p + ".html")

class Links(HTMLParser):
    def __init__(self):
        super().__init__(); self.refs = []; self.metas = {}; self.title = None; self._in_title = False
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("a", "link") and a.get("href"): self.refs.append(a["href"])
        if tag in ("script", "img", "source") and a.get("src"): self.refs.append(a["src"])
        if tag == "meta":
            key = a.get("name") or a.get("property")
            if key: self.metas.setdefault(key, a.get("content", ""))
        if tag == "link" and a.get("rel") == "canonical": self.metas["canonical"] = a.get("href", "")
        if tag == "title": self._in_title = True
    def handle_endtag(self, tag):
        if tag == "title": self._in_title = False
    def handle_data(self, data):
        if self._in_title: self.title = (self.title or "") + data

pages = []
for root, _, files in os.walk(site):
    for f in files:
        if f.endswith(".html"): pages.append(os.path.join(root, f))
if not pages: err(site, "no HTML pages found; build the site first"); print(*errors, sep="\n"); sys.exit(1)

for f in sorted(pages):
    rel = "/" + os.path.relpath(f, site)
    s = open(f, encoding="utf-8").read()
    if rel.startswith("/google"): continue                       # search-console verification file
    # GitHub Pages turns any Markdown file into a page, even without front matter; a local build
    # does not. Catch the documentation files before the sitemap advertises them.
    if re.match(r"/(claude|readme|license|contributing)/index\.html$", rel, re.I):
        err(rel, "a documentation file is being published as a page; add it to `exclude` in _config.yml")
    for m in re.finditer(r"\{\{[^}]*\}\}|\{%[^%]*%\}", s):
        err(rel, f"unrendered Liquid: {m.group(0)[:60]}")
    for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', s, re.S):
        try: json.loads(m.group(1))
        except Exception as e: err(rel, f"JSON-LD does not parse: {e}")
    p = Links(); p.feed(s)
    if not (p.title or "").strip(): err(rel, "no <title>")
    for key in ("description", "canonical", "og:title", "og:description", "og:image", "twitter:card"):
        if not p.metas.get(key): err(rel, f"missing {key}")
    d = html.unescape(p.metas.get("description", ""))
    if d and not (70 <= len(d) <= 165): warn(rel, f"description is {len(d)} chars (aim for 70–160)")
    for ref in p.refs:
        if ref.startswith("/") and not ref.startswith("//") and not exists(ref):
            err(rel, f"points at nothing: {ref}")

def xml(name):
    try: return minidom.parse(os.path.join(site, name))
    except Exception as e: err(name, f"does not parse: {e}"); return None

sm = xml("sitemap.xml")
if sm:
    locs = [n.firstChild.data for n in sm.getElementsByTagName("loc")]
    for loc in locs:
        path = re.sub(r"^https?://[^/]+", "", loc)
        if not exists(path): err("sitemap.xml", f"lists a page that is not in the build: {loc}")
    if "/404.html" in " ".join(locs): err("sitemap.xml", "lists the 404 page")
feed = xml("feed.xml")
if feed and not feed.getElementsByTagName("channel"): err("feed.xml", "has no <channel>")
try:
    man = json.load(open(os.path.join(site, "site.webmanifest")))
    for icon in man.get("icons", []):
        if not exists(icon["src"]): err("site.webmanifest", f"icon is not in the build: {icon['src']}")
except Exception as e: err("site.webmanifest", f"does not parse: {e}")
if not os.path.isfile(os.path.join(site, "robots.txt")): err("robots.txt", "missing")

for w in warnings: print("warn ", w)
for e in errors: print("ERROR", e)
print(f"{len(pages)} pages, {len(errors)} errors, {len(warnings)} warnings")
sys.exit(1 if errors else 0)
