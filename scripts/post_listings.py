#!/usr/bin/env python3
"""One card a day from the MMA card shop to Instagram: its photo, name, price and a few hashtags.

  python3 scripts/post_listings.py prepare     draws a 1080x1350 JPEG per listed card with a photo (mma-cards/social/)
  python3 scripts/post_listings.py post        posts the dearest card not posted yet, once its JPEG is live on the site
  python3 scripts/post_listings.py preview     prints every card's caption

Instagram fetches a picture from a public address, and only JPEGs, so a run posts what the last run drew and deployed.
What's posted is kept in _data/social_posted.json, so a card never goes out twice. Without IG_USER_ID and
IG_ACCESS_TOKEN (GitHub secrets), `post` only prints what it would have sent.
"""
import io, json, os, re, sys, time, urllib.parse, urllib.request
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARDS = os.path.join(ROOT, "_data", "live", "cards.json")
POSTED = os.path.join(ROOT, "_data", "social_posted.json")
SOCIAL = os.path.join(ROOT, "mma-cards", "social")
SITE = "https://juantorresmi.github.io"
GRAPH = "https://graph.instagram.com/v21.0"
SIZE = (1080, 1350)         # Instagram's tallest feed picture
STOCK = (240, 236, 226)     # the site's bone stock
PRODUCTS = [("stadium club", "StadiumClub"), ("chrome", "ToppsChrome"), ("prizm", "PaniniPrizm"), ("select", "PaniniSelect"), ("knockout", "ToppsKnockout"),
            ("royalty", "ToppsRoyalty"), ("midnight", "ToppsMidnight"), ("optic", "DonrussOptic"), ("donruss", "Donruss"), ("finest", "ToppsFinest")]


def load(path, fallback):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return fallback


def priced(c):
    return bool(re.search(r"\d", c.get("price") or ""))


def worth(c):
    return float(re.sub(r"[^\d.]", "", c["price"]) or 0)


def tag(words):
    return "#" + re.sub(r"[^A-Za-z0-9]", "", "".join(w[:1].upper() + w[1:] for w in words.split()))


def caption(c):
    """The card's name, its price, and five hashtags at most."""
    name = c["name"].strip()
    if c.get("player") and c["player"].lower() not in name.lower():
        name = f"{c['player']}: {name}"
    tags = [tag(c["player"])] if c.get("player") else []
    tags += ["#UFC", "#UFCCards"]
    low = f"{name} {c.get('set') or ''}".lower()
    tags += [f"#{t}" for p, t in PRODUCTS if p in low][:1]
    tags += ["#RookieCard"] if c.get("rookie") else ["#Autograph"] if c.get("auto") else ["#MMACards"]
    return f"{name}\n{c['price']} · shop link in bio\n\n{' '.join(tags[:5])}"


def showcase_url():
    with open(os.path.join(ROOT, "_config.yml"), encoding="utf-8") as f:
        return os.environ.get("CARDS_URL") or re.search(r'^cards_url:\s*"([^"]+)"', f.read(), re.M).group(1)


def prepare():
    """A JPEG per listed card with a photo; the ones no longer listed are removed."""
    from PIL import Image
    os.makedirs(SOCIAL, exist_ok=True)
    listed = [c for c in load(CARDS, {}).get("for_sale", []) if c.get("photo")]
    keep = set()
    for c in listed:
        path = os.path.join(SOCIAL, f"{c['id']}.jpg")
        keep.add(path)
        if os.path.exists(path):
            continue
        try:
            # Cloudflare refuses Python's default user agent.
            with urllib.request.urlopen(urllib.request.Request(f"{showcase_url()}/photo/{c['id']}-full.webp", headers={"User-Agent": "juantorresmi-site"}), timeout=30) as r:
                pic = Image.open(io.BytesIO(r.read())).convert("RGB")
        except Exception as e:
            print(f"no full photo for card {c['id']}: {e}", file=sys.stderr)
            keep.discard(path)
            continue
        # The whole card on the stock, never cropped; a small photo isn't blown up past 2x.
        scale = min(SIZE[0] * 0.9 / pic.width, SIZE[1] * 0.9 / pic.height, 2)
        pic = pic.resize((round(pic.width * scale), round(pic.height * scale)), Image.LANCZOS)
        page = Image.new("RGB", SIZE, STOCK)
        page.paste(pic, ((SIZE[0] - pic.width) // 2, (SIZE[1] - pic.height) // 2))
        page.save(path, "JPEG", quality=88, optimize=True)
    for f in os.listdir(SOCIAL):
        if os.path.join(SOCIAL, f) not in keep:
            os.remove(os.path.join(SOCIAL, f))
    print(f"{len(keep)} pictures ready")


def graph(path, **fields):
    fields["access_token"] = os.environ["IG_ACCESS_TOKEN"]
    url = f"{GRAPH}/{path}"
    if path.endswith(("/media", "/media_publish")):
        req = urllib.request.Request(url, data=urllib.parse.urlencode(fields).encode(), method="POST")
    else:
        req = urllib.request.Request(f"{url}?{urllib.parse.urlencode(fields)}")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def is_live(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=20) as r:
            return r.status == 200
    except Exception:
        return False


def post():
    posted = load(POSTED, {})
    todo = [c for c in load(CARDS, {}).get("for_sale", []) if str(c["id"]) not in posted and priced(c)]
    for c in sorted(todo, key=worth, reverse=True):
        image = f"{SITE}/mma-cards/social/{c['id']}.jpg"
        if not os.path.exists(os.path.join(SOCIAL, f"{c['id']}.jpg")) or not is_live(image):
            continue
        text = caption(c)
        if not (os.environ.get("IG_USER_ID") and os.environ.get("IG_ACCESS_TOKEN")):
            print(f"No Instagram keys. Would post {image}:\n{text}")
            return
        user = os.environ["IG_USER_ID"]
        made = graph(f"{user}/media", image_url=image, caption=text)["id"]
        for _ in range(12):
            if graph(made, fields="status_code").get("status_code") == "FINISHED":
                break
            time.sleep(5)
        graph(f"{user}/media_publish", creation_id=made)
        posted[str(c["id"])] = date.today().isoformat()
        with open(POSTED, "w", encoding="utf-8", newline="\n") as f:
            json.dump(posted, f, indent=2, sort_keys=True)
            f.write("\n")
        print(f"Posted card {c['id']}: {c['name']}")
        return
    print("Nothing to post.")


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "preview"
    if what == "prepare":
        prepare()
    elif what == "post":
        post()
    else:
        for c in load(CARDS, {}).get("for_sale", []):
            print(f"--- {c['id']}{' (no photo)' if not c.get('photo') else ''}\n{caption(c)}")
