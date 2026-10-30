#!/usr/bin/env python3
"""One card a day from the MMA card shop to Instagram: its photo, name, price and a few hashtags.

  python3 scripts/post_listings.py prepare     draws a 1080x1350 JPEG per listed card with a photo (mma-cards/social/)
  python3 scripts/post_listings.py post        posts the dearest card not posted yet, once its JPEG is live on the site
  python3 scripts/post_listings.py preview     prints every card's caption
  python3 scripts/post_listings.py check       signs in, prints the account's name (never the token) and the songs it would use
  python3 scripts/post_listings.py test DIR    draws the next Reel with its song's preview into DIR, and publishes nothing

Cards from REEL_FROM up go out as Reels (scripts/make_reel.py) with a trending corrido or other Latin song from
Instagram's own music, attached by Instagram; the rest as photos.

Instagram fetches a picture from a public address, and only JPEGs, so a run posts what the last run drew and deployed.
What's posted is kept in _data/social_posted.json, so a card never goes out twice. Without IG_USER_ID and
IG_ACCESS_TOKEN (GitHub secrets), `post` only prints what it would have sent.
"""
import io, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CARDS = os.path.join(ROOT, "_data", "live", "cards.json")
POSTED = os.path.join(ROOT, "_data", "social_posted.json")
SOCIAL = os.path.join(ROOT, "mma-cards", "social")
SITE = "https://juantorresmi.github.io"
HOSTS = ["https://graph.instagram.com/v22.0", "https://graph.facebook.com/v22.0"]    # Instagram login's tokens, Unified login's
SIZE = (1080, 1350)         # Instagram's tallest feed picture
STOCK = (240, 236, 226)     # the site's bone stock
REEL_FROM = 5.0             # dollars: dearer cards get a Reel
# Songs: what's trending by these first, then searches. Instagram has no genre filter, so the artists and words are the filter.
CORRIDOS = ("fuerza regida", "peso pluma", "natanael cano", "junior h", "gabito ballesteros", "tito double p", "luis r conriquez", "grupo firme", "xavi",
            "oscar maydon", "chino pacas", "ivan cornejo", "eslabon armado", "banda ms", "carin leon", "calle 24", "grupo frontera", "los tigres del norte")
LATIN = ("bad bunny", "karol g", "feid", "rauw alejandro", "humbe", "bago villain", "natalia lafourcade", "christian nodal", "kali uchis", "anuel aa", "ozuna", "j balvin")
UNCLEAN = re.compile(r"fuck|shit|bitch|bxtch|nigga|puta|verga|cabr[oó]n|chinga", re.I)
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
    # One Reel at a time, the next one due: a posted Reel's file goes, so videos don't pile up in the repo.
    c = reel_due()
    if c:
        import make_reel
        path = os.path.join(SOCIAL, f"reel-{c['id']}.mp4")
        keep.add(path)
        if not os.path.exists(path):
            tmp = os.path.join(ROOT, ".reel-photos")
            os.makedirs(tmp, exist_ok=True)
            front, back = photos_of(c, tmp)
            make_reel.make(c, front, back, path)
    for f in os.listdir(SOCIAL):
        if os.path.join(SOCIAL, f) not in keep:
            os.remove(os.path.join(SOCIAL, f))
    print(f"{len(keep)} pictures ready")


def account():
    """Which of Meta's hosts takes this token, and the account it signs in as: (host, username), or (None, None)."""
    for host in HOSTS:
        try:
            token = urllib.parse.urlencode({"fields": "username", "access_token": os.environ["IG_ACCESS_TOKEN"]})
            with urllib.request.urlopen(f"{host}/{os.environ['IG_USER_ID']}?{token}", timeout=30) as r:
                return host, json.load(r).get("username")
        except urllib.error.HTTPError as e:
            print(f"{host.split('/')[2]} refused it ({e.code}): {json.load(e).get('error', {}).get('message', '')[:160]}")
    return None, None


def check():
    """Signs in and prints only the account's name: the token never reaches the log."""
    host, name = account()
    print(f"Signed in as {name} through {host.split('/')[2]}" if host else "The token didn't work on either host.")
    if not host:
        sys.exit(1)
    trending()


def songs(words=None):
    """The music Instagram offers apps: with no search words, what's trending. Unified login's host only."""
    fields = {"audio_type": "music", "user_id": os.environ["IG_USER_ID"], "access_token": os.environ["IG_ACCESS_TOKEN"]}
    if words:
        fields["search_query"] = words
    try:
        with urllib.request.urlopen(f"https://graph.facebook.com/v22.0/ig_audio?{urllib.parse.urlencode(fields)}", timeout=30) as r:
            return json.load(r).get("audio", [])
    except urllib.error.HTTPError as e:
        print(f"Music refused ({e.code}): {json.load(e).get('error', {}).get('message', '')[:200]}")
        return []


def by(song, names):
    artist = (song.get("display_artist") or "").lower()
    return any(n in artist for n in names)


def pick_songs(used=()):
    """Songs in the order they'd be used: trending corridos, the corrido artists' other songs, trending Latin. Clean titles, none used before."""
    now = songs()
    found = [s for s in now if by(s, CORRIDOS)]
    # Instagram's search is loose (a genre's name brings back anything): ask for each artist, and keep only theirs.
    for name in CORRIDOS:
        found += [s for s in songs(name) if by(s, CORRIDOS)]
    found += [s for s in now if by(s, LATIN)]
    seen, out = set(used), []
    for s in found:
        key = s.get("audio_id")
        if key and key not in seen and (s.get("duration_in_ms") or 0) >= 20000 and not UNCLEAN.search(f"{s.get('title')} {s.get('display_artist')}"):
            seen.add(key)
            out.append(s)
    return out


def trending():
    picks = pick_songs()
    print(f"{len(picks)} songs to choose from:")
    for s in picks[:25]:
        print(f"  {s.get('title')} - {s.get('display_artist')} ({(s.get('duration_in_ms') or 0) // 1000}s)")


def reel_due():
    """The dearest card not posted yet that gets a Reel, or None."""
    posted = load(POSTED, {})
    todo = [c for c in load(CARDS, {}).get("for_sale", []) if c.get("photo") and priced(c) and worth(c) >= REEL_FROM and str(c["id"]) not in posted]
    return max(todo, key=worth, default=None)


def photos_of(c, folder):
    """The card's front and, if it has one, back photo: their paths."""
    paths = []
    for end in ("full", "back"):
        path = os.path.join(folder, f"{c['id']}-{end}.webp")
        try:
            with urllib.request.urlopen(urllib.request.Request(f"{showcase_url()}/photo/{c['id']}-{end}.webp", headers={"User-Agent": "juantorresmi-site"}), timeout=30) as r, open(path, "wb") as f:
                f.write(r.read())
            paths.append(path)
        except urllib.error.HTTPError:
            paths.append(None)
    return paths


def test(folder):
    """The next Reel as it would go out, with a preview of its song: nothing is published."""
    import make_reel
    os.makedirs(folder, exist_ok=True)
    c = reel_due()
    if not c:
        return print("No card due a Reel.")
    picks = pick_songs(used_songs()) or pick_songs()
    song = picks[0] if picks else None
    audio = None
    if song and song.get("download_url"):
        audio = os.path.join(folder, "song.m4a")
        with urllib.request.urlopen(urllib.request.Request(song["download_url"], headers={"User-Agent": "Mozilla/5.0"}), timeout=60) as r, open(audio, "wb") as f:
            f.write(r.read())
    front, back = photos_of(c, folder)
    make_reel.make(c, front, back, os.path.join(folder, "next-reel.mp4"), audio=audio, stills=os.path.join(folder, "frames.png"))
    with open(os.path.join(folder, "caption.txt"), "w", encoding="utf-8") as f:
        f.write(f"{caption(c)}\n\nSong: {song.get('title')} - {song.get('display_artist')}\n" if song else f"{caption(c)}\n\nNo song found.\n")
    print(f"Card {c['id']}: {c['name']} | song: {(song or {}).get('title')} - {(song or {}).get('display_artist')} | preview audio: {bool(audio)} | back photo: {bool(back)}")


def used_songs():
    return [v["song"] for v in load(POSTED, {}).values() if isinstance(v, dict) and v.get("song")]


def graph(host, path, **fields):
    fields["access_token"] = os.environ["IG_ACCESS_TOKEN"]
    url = f"{host}/{path}"
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
        video = f"{SITE}/mma-cards/social/reel-{c['id']}.mp4"
        reel = worth(c) >= REEL_FROM and os.path.exists(os.path.join(SOCIAL, f"reel-{c['id']}.mp4")) and is_live(video)
        if worth(c) >= REEL_FROM and c.get("photo") and not reel:
            print(f"Waiting for card {c['id']}'s Reel, which this run draws.")
            return      # Reels go first, dearest first: nothing cheaper jumps ahead of one still being drawn
        if not reel and (not os.path.exists(os.path.join(SOCIAL, f"{c['id']}.jpg")) or not is_live(image)):
            continue
        text = caption(c)
        if not (os.environ.get("IG_USER_ID") and os.environ.get("IG_ACCESS_TOKEN")):
            print(f"No Instagram keys. Would post {image}:\n{text}")
            return
        user, host = os.environ["IG_USER_ID"], account()[0]
        if not host:
            sys.exit("The Instagram token didn't work.")
        song = None
        if reel:
            # Few corridos are cleared for apps: when they've all been used, one comes round again instead of a silent Reel.
            picks = pick_songs(used_songs()) or pick_songs()
            song = picks[0] if picks else None
            fields = {"media_type": "REELS", "video_url": video, "caption": text, "share_to_feed": "true"}
            if song:
                fields["audio_configuration"] = json.dumps({"audio_id": song["audio_id"], "audio_volume": 100, "video_volume": 1})
            made = graph(host, f"{user}/media", **fields)["id"]
        else:
            made = graph(host, f"{user}/media", image_url=image, caption=text)["id"]
        for _ in range(60):
            state = graph(host, made, fields="status_code").get("status_code")
            if state == "FINISHED":
                break
            if state == "ERROR":
                sys.exit(f"Instagram couldn't process card {c['id']}.")
            time.sleep(5)
        graph(host, f"{user}/media_publish", creation_id=made)
        posted[str(c["id"])] = {"date": date.today().isoformat(), "song": song and song["audio_id"], "song_name": song and f"{song.get('title')} - {song.get('display_artist')}"}
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
    elif what == "check":
        check()
    elif what == "test":
        test(sys.argv[2])
    else:
        for c in load(CARDS, {}).get("for_sale", []):
            print(f"--- {c['id']}{' (no photo)' if not c.get('photo') else ''}\n{caption(c)}")
