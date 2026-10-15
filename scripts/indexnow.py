#!/usr/bin/env python3
"""Tells search engines which pages just changed, through IndexNow (Bing, Yandex, Seznam, Naver
and others share one endpoint; Google doesn't use it and reads the sitemap instead).

    python3 scripts/indexnow.py            # after a deploy: pages whose <lastmod> is today or yesterday
    python3 scripts/indexnow.py --all      # every page in the sitemap, once, e.g. after a big change

Reads the live sitemap, so run it after the site is deployed (the deploy workflow does). The key
is `indexnow_key` in _config.yml, and a file named after it at the root proves the site is ours;
both are public by design. Needs only the standard library. A failed ping never fails a deploy.
"""
import json, os, re, sys, urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENDPOINT = "https://api.indexnow.org/indexnow"


def config(key):
    for line in open(os.path.join(ROOT, "_config.yml"), encoding="utf-8"):
        if line.startswith(key + ":"):
            return line.split(":", 1)[1].strip().strip('"').strip("'")
    return ""


def main():
    site, key = config("url").rstrip("/"), config("indexnow_key")
    if not key: sys.exit("no indexnow_key in _config.yml")
    req = urllib.request.Request(site + "/sitemap.xml", headers={"User-Agent": "indexnow-ping (github.com/JuanTorresMI)"})
    xml = urllib.request.urlopen(req, timeout=30).read().decode("utf-8")
    since = (datetime.now(timezone.utc) - timedelta(days=1)).date().isoformat()
    urls = []
    for block in re.findall(r"<url>(.*?)</url>", xml, re.S):
        loc = re.search(r"<loc>(.*?)</loc>", block)
        mod = re.search(r"<lastmod>(\d{4}-\d{2}-\d{2})", block)
        if loc and ("--all" in sys.argv or (mod and mod.group(1) >= since)):
            urls.append(loc.group(1).replace("&amp;", "&"))
    if not urls:
        print("nothing changed since", since); return
    body = json.dumps({"host": site.split("//", 1)[1], "key": key, "keyLocation": f"{site}/{key}.txt", "urlList": urls[:10000]}).encode()
    req = urllib.request.Request(ENDPOINT, data=body, headers={"Content-Type": "application/json; charset=utf-8"})
    with urllib.request.urlopen(req, timeout=30) as r:
        print(f"IndexNow: {len(urls)} URLs, status {r.status}")


if __name__ == "__main__":
    main()
