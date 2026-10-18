#!/usr/bin/env python3
"""Checks a built site (the _site folder Jekyll writes) for the things that break quietly.

    python3 scripts/check.py _site

Fails (exit 1) on:
  - unrendered Liquid, or JSON-LD that does not parse;
  - a page without a title, description, canonical or share image;
  - an internal link, asset, canonical or hreflang that points at nothing, an hreflang pair that
    doesn't point both ways, or an <img> without alt text;
  - a sitemap entry with no page behind it, or a sitemap / feed / manifest that does not parse;
  - a documentation file published as a page, or a Worker-backed page missing its snapshot.
Warns on: a description outside the length search engines show, two indexable pages sharing a
title or a description, and an indexable page without exactly one <h1>.
Needs only the standard library.
"""
import json, os, re, sys, html
from collections import defaultdict
from urllib.parse import unquote
from html.parser import HTMLParser
from xml.dom import minidom

site = sys.argv[1] if len(sys.argv) > 1 else "_site"
errors, warnings = [], []
err = lambda f, m: errors.append(f"{f}: {m}")
warn = lambda f, m: warnings.append(f"{f}: {m}")
local = lambda url: re.sub(r"^https?://[^/]+", "", url)       # absolute URL on this site -> path

def exists(url):
    """Does an internal URL resolve to a file in the build? /x/ -> /x/index.html, /x -> /x or /x.html."""
    path = unquote(url.split("#")[0].split("?")[0])
    if not path.startswith("/"): return True
    p = os.path.join(site, path.lstrip("/"))
    return os.path.isfile(p) or os.path.isfile(os.path.join(p, "index.html")) or os.path.isfile(p + ".html")

class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs, self.metas, self.alternates, self.imgs = [], {}, {}, []
        self.title, self._in_title, self.h1 = None, False, 0
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("a", "link") and a.get("href"): self.refs.append(a["href"])
        if tag in ("script", "img", "source") and a.get("src"): self.refs.append(a["src"])
        if tag == "meta":
            key = a.get("name") or a.get("property")
            if key: self.metas.setdefault(key, a.get("content", ""))
        if tag == "link" and a.get("rel") == "canonical": self.metas["canonical"] = a.get("href", "")
        if tag == "link" and a.get("rel") == "alternate" and a.get("hreflang"): self.alternates[a["hreflang"]] = a.get("href", "")
        if tag == "img": self.imgs.append(a)
        if tag == "h1": self.h1 += 1
        if tag == "title": self._in_title = True
    def handle_endtag(self, tag):
        if tag == "title": self._in_title = False
    def handle_data(self, data):
        if self._in_title: self.title = (self.title or "") + data

files = []
for root, _, names in os.walk(site):
    for f in names:
        if f.endswith(".html"): files.append(os.path.join(root, f))
if not files: err(site, "no HTML pages found; build the site first"); print(*errors, sep="\n"); sys.exit(1)

parsed = {}                                      # canonical URL -> Page, for the hreflang check
titles, descriptions = defaultdict(list), defaultdict(list)
for f in sorted(files):
    rel = "/" + os.path.relpath(f, site).replace(os.sep, "/")
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
    p = Page(); p.feed(s)
    title = html.unescape(p.title or "").strip()
    if not title: err(rel, "no <title>")
    for key in ("description", "canonical", "og:title", "og:description", "og:image", "twitter:card"):
        if not p.metas.get(key): err(rel, f"missing {key}")
    d = html.unescape(p.metas.get("description", ""))
    if d and not (70 <= len(d) <= 160): warn(rel, f"description is {len(d)} chars (aim for 70–160)")
    for ref in p.refs:
        if ref.startswith("/") and not ref.startswith("//") and not exists(ref):
            err(rel, f"points at nothing: {ref}")
    for img in p.imgs:
        if "alt" not in img: err(rel, f"<img> without alt (use alt=\"\" if it's decoration): {img.get('src', '')[:60]}")
    canonical = p.metas.get("canonical", "")
    if canonical and not exists(local(canonical)): err(rel, f"canonical points at nothing: {canonical}")
    for lang, href in p.alternates.items():
        if not exists(local(href)): err(rel, f"hreflang {lang} points at nothing: {href}")
    redirect = 'http-equiv="refresh"' in s
    if canonical and not redirect: parsed[canonical] = p
    # Search engines only compare pages they may index; redirects and noindex pages are left out.
    if not redirect and "noindex" not in p.metas.get("robots", ""):
        titles[title].append(rel)
        if d: descriptions[d].append(rel)
        if p.h1 != 1: warn(rel, f"has {p.h1} <h1> elements (an indexable page should have one)")

for url, p in parsed.items():
    for lang, href in p.alternates.items():
        other = parsed.get(href)
        if other and url not in other.alternates.values():
            err(local(url), f"hreflang {lang} points at {local(href)}, which doesn't point back")
for what, seen in (("title", titles), ("description", descriptions)):
    for text, rels in seen.items():
        if len(rels) > 1: warn(rels[0], f"shares its {what} with {', '.join(rels[1:4])}: {text[:60]!r}")

def xml(name):
    try: return minidom.parse(os.path.join(site, name))
    except Exception as e: err(name, f"does not parse: {e}"); return None

sm = xml("sitemap.xml")
if sm:
    locs = [n.firstChild.data for n in sm.getElementsByTagName("loc")]
    for loc in locs:
        if not exists(local(loc)): err("sitemap.xml", f"lists a page that is not in the build: {loc}")
    if "/404.html" in " ".join(locs): err("sitemap.xml", "lists the 404 page")
feed = xml("feed.xml")
if feed and not feed.getElementsByTagName("channel"): err("feed.xml", "has no <channel>")
try:
    man = json.load(open(os.path.join(site, "site.webmanifest"), encoding="utf-8"))
    for icon in man.get("icons", []):
        if not exists(icon["src"]): err("site.webmanifest", f"icon is not in the build: {icon['src']}")
except Exception as e: err("site.webmanifest", f"does not parse: {e}")
if not os.path.isfile(os.path.join(site, "robots.txt")): err("robots.txt", "missing")
# The Worker-backed pages carry a copy of their data (scripts/snapshot.py). Without it, a crawler
# or a browser with JavaScript off sees only the placeholder.
for page, placeholder in (("youtube/index.html", "Asking YouTube…"), ("watching/index.html", "Asking the TV…"),
                          ("worker-usage/index.html", "Asking Cloudflare…"),
                          ("reefer-rates/index.html", "The first report hasn’t been collected yet"),
                          ("border-waits/index.html", "The first readings haven’t been collected yet"),
                          ("beef-prices/index.html", "The first report hasn’t been collected yet"),
                          ("pork-prices/index.html", "The first report hasn’t been collected yet"),
                          ("fed-cattle-prices/index.html", "The first report hasn’t been collected yet"),
                          ("es/precios-de-carne-de-res/index.html", "The first report hasn’t been collected yet"),
                          ("es/precios-de-cerdo/index.html", "The first report hasn’t been collected yet"),
                          ("es/precios-de-ganado-gordo/index.html", "The first report hasn’t been collected yet"),
                          ("es/tiempos-de-espera/index.html", "Todavía no hay lecturas")):
    f = os.path.join(site, page)
    if os.path.isfile(f) and placeholder in open(f, encoding="utf-8").read():
        err("/" + page, "has no snapshot in its HTML; run scripts/snapshot.py")

for w in warnings: print("warn ", w)
for e in errors: print("ERROR", e)
print(f"{len(files)} pages, {len(errors)} errors, {len(warnings)} warnings")
sys.exit(1 if errors else 0)
