#!/usr/bin/env python3
"""Cards from the MMA card shop to Instagram as Reels: the card front and back, its name, price, a few hashtags and a song.

  python3 scripts/post_listings.py post        posts the next card: a price drop, else the dearest new card, else an old one again
  python3 scripts/post_listings.py preview     prints every card's caption
  python3 scripts/post_listings.py check       signs in, prints the account's name (never the token) and the songs it would use
  python3 scripts/post_listings.py test DIR    draws the next Reel with its song's preview into DIR, and publishes nothing

Every post is a Reel (scripts/make_reel.py), since only Reels can carry a song, with a trending corrido or other Latin song
from Instagram's own music, attached by Instagram. A Reel is drawn in the run that posts it and sits in R2 just long
enough for Instagram to fetch it, so no video is kept. Instagram's API can't choose where a song starts: CUES holds the
reveal until a song's good part.

Each run reads the shop live, so a newly listed card can go out at the next slot. What's posted is kept in
_data/social_posted.json, and each card's last known price in _data/social_prices.json: a drop of DROP_FROM or more jumps the
line with its own Reel. With no new cards, a card still for sale after REPEAT_DAYS comes round again, at most once a day. Without IG_USER_ID and
IG_ACCESS_TOKEN (GitHub secrets), `post` only prints what it would have sent.
"""
import json, os, re, sys, tempfile, time, urllib.error, urllib.parse, urllib.request
from datetime import date, datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CARDS = os.path.join(ROOT, "_data", "live", "cards.json")
POSTED = os.path.join(ROOT, "_data", "social_posted.json")
PRICES = os.path.join(ROOT, "_data", "social_prices.json")
SONGS = os.path.join(ROOT, "_data", "social_songs.json")
HOSTS = ["https://graph.instagram.com/v22.0", "https://graph.facebook.com/v22.0"]    # Instagram login's tokens, Unified login's
# Songs: what's trending by these first, then searches. Instagram has no genre filter, so the artists and words are the filter.
CORRIDOS = ("fuerza regida", "peso pluma", "natanael cano", "junior h", "gabito ballesteros", "tito double p", "luis r conriquez", "grupo firme", "xavi",
            "oscar maydon", "chino pacas", "ivan cornejo", "eslabon armado", "banda ms", "carin leon", "calle 24", "grupo frontera", "los tigres del norte",
            "los tucanes de tijuana", "gerardo ortiz", "alfredo olivas", "ariel camacho", "grupo codiciado", "legado 7", "banda el recodo", "julion alvarez",
            "los dos carnales", "lenin ramirez", "el fantasma", "t3r elemento", "yahritza", "dannylux", "luis angel", "el komander", "calibre 50", "los plebes del rancho",
            "marca registrada", "enigma norteno", "hector rubio", "grupo arriesgado", "edgardo nunez", "pepe aguilar", "los alegres del barranco", "los inquietos del norte")
LATIN = ("bad bunny", "karol g", "feid", "rauw alejandro", "humbe", "bago villain", "christian nodal", "kali uchis", "anuel aa", "ozuna", "j balvin",
         "maluma", "daddy yankee", "don omar", "wisin", "myke towers", "arcangel", "nicky jam", "becky g", "sech", "jhayco", "eladio carrion", "villa", "azabache")
DROP_FROM = 0.05            # a price this far under the last one is a drop
REPEAT_DAYS = 14            # how long before a card still for sale can go out again
REPEAT_GAP_H = 20           # and how far apart those repeats are
CUES = {}                   # audio_id: seconds into the song that its good part starts (scripts/make_reel.py holds the reveal for them)
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


def caption(c, was=None):
    """The card's name, its price, and five hashtags at most; for a price drop, what it was."""
    name = c["name"].strip()
    if c.get("player") and c["player"].lower() not in name.lower():
        name = f"{c['player']}: {name}"
    tags = [tag(c["player"])] if c.get("player") else []
    tags += ["#UFC", "#UFCCards"]
    low = f"{name} {c.get('set') or ''}".lower()
    tags += [f"#{t}" for p, t in PRODUCTS if p in low][:1]
    tags += ["#Refractor"] if re.search("refractor", f"{name} {c.get('parallel') or ''}", re.I) else []
    tags += ["#RookieCard"] if c.get("rookie") else ["#Autograph"] if c.get("auto") else ["#MMACards"]
    price = f"Price drop: was {was}, now {c['price']}" if was else c["price"]
    return f"{name}\n{price} · shop link in bio\n\n{' '.join(tags[:5])}"


def showcase_url():
    with open(os.path.join(ROOT, "_config.yml"), encoding="utf-8") as f:
        return os.environ.get("CARDS_URL") or re.search(r'^cards_url:\s*"([^"]+)"', f.read(), re.M).group(1)


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


def pick_songs(used={}):
    """Songs in the order they'd be used: trending corridos, the corrido artists' other songs, then Latin, longest unused first. Clean titles."""
    now = songs()
    found = [s for s in now if by(s, CORRIDOS)]
    # Instagram's search is loose (a genre's name brings back anything): ask for each artist, and keep only theirs.
    for name in CORRIDOS:
        found += [s for s in songs(name) if by(s, CORRIDOS)]
    found += [s for s in now if by(s, LATIN)]
    for name in LATIN:
        found += [s for s in songs(name) if by(s, LATIN)]
    seen, out = set(), []
    for s in found:
        key = s.get("audio_id")
        if key and key not in seen and (s.get("duration_in_ms") or 0) >= 20000 and not UNCLEAN.search(f"{s.get('title')} {s.get('display_artist')}"):
            seen.add(key)
            out.append(s)
    # Least recently used first (never used before all), keeping that order among equals: the songs take turns.
    return sorted(out, key=lambda s: used.get(s["audio_id"], ""))


def trending():
    picks = pick_songs()
    print(f"{len(picks)} songs to choose from:")
    for s in picks[:25]:
        print(f"  {s.get('title')} - {s.get('display_artist')} ({(s.get('duration_in_ms') or 0) // 1000}s)")


def listings():
    """The cards for sale right now, from the shop itself: the site's copy (a day old at worst) only if that's down."""
    try:
        with urllib.request.urlopen(urllib.request.Request(f"{showcase_url()}/showcase.json", headers={"User-Agent": "juantorresmi-site"}), timeout=30) as r:
            return [{**c, "player": c.get("player") or "", "set": c.get("set") or "", "parallel": c.get("parallel") or "", "serial": c.get("serial") or "",
                     "price": f"${c['price'] / 100:,.2f}" if c.get("price") else ""} for c in json.load(r)["for_sale"]]
    except Exception as e:
        print(f"Using the site's copy of the shop ({e})")
        return load(CARDS, {}).get("for_sale", [])


def cents_of(c):
    return round(worth(c) * 100)


def hours_since(when):
    return (datetime.now(timezone.utc) - datetime.fromisoformat(when)).total_seconds() / 3600


def when_posted(v):
    """When a card went out (the first posts kept only a date, or nothing but that)."""
    at = v.get("at") if isinstance(v, dict) else None
    day = v.get("date") if isinstance(v, dict) else v
    return at or f"{day}T00:00:00+00:00"


def shelf(method, url, body=None):
    """Puts a film on, or takes it off, the shop Worker's shelf in R2."""
    req = urllib.request.Request(url, data=body, method=method, headers={"x-social-key": os.environ["SOCIAL_KEY"], "User-Agent": "juantorresmi-site", "Content-Type": "video/mp4"})
    with urllib.request.urlopen(req, timeout=120) as r:
        r.read()


def next_up(cards, posted, prices):
    """What goes next, as (card, old price or None, why): a price drop, then the dearest new card, then an old one again."""
    ready = [c for c in cards if c.get("photo") and priced(c)]
    drops = [c for c in ready if prices.get(str(c["id"])) and cents_of(c) <= prices[str(c["id"])] * (1 - DROP_FROM)]
    if drops:
        c = max(drops, key=lambda x: prices[str(x["id"])] - cents_of(x))
        return c, f"${prices[str(c['id'])] / 100:,.2f}", "drop"
    fresh = [c for c in ready if str(c["id"]) not in posted]
    if fresh:
        return max(fresh, key=worth), None, "new"
    # Nothing new: keep the page alive with what's still for sale, oldest post first, without repeating too often.
    if posted and min(hours_since(when_posted(v)) for v in posted.values()) < REPEAT_GAP_H:
        return None, None, "resting"
    again = [c for c in ready if hours_since(when_posted(posted[str(c["id"])])) >= REPEAT_DAYS * 24]
    if again:
        return min(again, key=lambda c: when_posted(posted[str(c["id"])])), None, "again"
    return None, None, "out of cards"


def note_prices(cards, prices):
    """Remember each card's price. A drop stays waiting at its old price until it's posted; a raise moves the mark up."""
    for c in cards:
        if priced(c):
            now, was = cents_of(c), prices.get(str(c["id"]))
            if not was or now > was * (1 - DROP_FROM):
                prices[str(c["id"])] = now
    live = {str(c["id"]) for c in cards}
    for k in [k for k in prices if k not in live]:
        del prices[k]        # sold or taken down


def save(path, data):
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, indent=2, sort_keys=True)
        f.write("\n")


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
    """The next Reel as it would go out, without its song, which only Instagram can add: nothing is published."""
    import make_reel
    os.makedirs(folder, exist_ok=True)
    c, was, why = next_up(listings(), load(POSTED, {}), load(PRICES, {}))
    if not c:
        return print(f"Nothing to post: {why}.")
    picks = pick_songs(used_songs())
    song = picks[0] if picks else None
    front, back = photos_of(c, folder)
    make_reel.make(c, front, back, os.path.join(folder, "next-reel.mp4"), cue=CUES.get((song or {}).get("audio_id"), 0.0), stills=os.path.join(folder, "frames.png"),
                   was=was, words="STILL AVAILABLE" if why == "again" else None)
    with open(os.path.join(folder, "caption.txt"), "w", encoding="utf-8") as f:
        f.write(f"{caption(c, was)}\n\nSong: {song.get('title')} - {song.get('display_artist')}\n" if song else f"{caption(c, was)}\n\nNo song found.\n")
    print(f"Card {c['id']} ({why}): {c['name']} | song: {(song or {}).get('title')} - {(song or {}).get('display_artist')} | back photo: {bool(back)}")


def used_songs():
    return load(SONGS, {})


def graph(host, path, **fields):
    fields["access_token"] = os.environ["IG_ACCESS_TOKEN"]
    url = f"{host}/{path}"
    if path.endswith(("/media", "/media_publish")):
        req = urllib.request.Request(url, data=urllib.parse.urlencode(fields).encode(), method="POST")
    else:
        req = urllib.request.Request(f"{url}?{urllib.parse.urlencode(fields)}")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def post(card=None, old=None):
    """The next card (next_up), or the one asked for, as a Reel. No card is fine: the run just ends."""
    import make_reel
    posted, prices, cards = load(POSTED, {}), load(PRICES, {}), listings()
    c, was, why = next_up(cards, posted, prices)
    if card:
        c, was, why = next((x for x in cards if str(x["id"]) == str(card)), None), old or None, "asked"
    note_prices(cards, prices)
    if not c:
        save(PRICES, prices)
        return print(f"Nothing to post: {why}.")
    text = caption(c, was)
    if not (os.environ.get("IG_USER_ID") and os.environ.get("IG_ACCESS_TOKEN")):
        return print(f"No Instagram keys. Would post card {c['id']}:\n{text}")
    user, host = os.environ["IG_USER_ID"], account()[0]
    if not host:
        sys.exit("The Instagram token didn't work.")
    picks = pick_songs(used_songs())
    song = picks[0] if picks else None
    cue = CUES.get((song or {}).get("audio_id"), 0.0)
    slug = f"card-{c['id']}-{int(time.time())}"
    with tempfile.TemporaryDirectory() as tmp:
        film = os.path.join(tmp, "reel.mp4")
        front, back = photos_of(c, tmp)
        make_reel.make(c, front, back, film, cue=cue, was=was, words="STILL AVAILABLE" if why == "again" else None)
        # The cover is the finished frame: the card, its price and the shop.
        # A song only stays on when Instagram fetches the film from a link (a direct upload lost it), so it sits in R2 until then.
        reel_url = f"{showcase_url()}/reel/{slug}.mp4"
        with open(film, "rb") as f:
            shelf("PUT", reel_url, f.read())
        fields = {"media_type": "REELS", "video_url": reel_url, "caption": text, "share_to_feed": "true", "thumb_offset": str(int((cue + 11) * 1000))}
        if song:
            fields["audio_configuration"] = json.dumps({"audio_id": song["audio_id"], "audio_volume": 80, "video_volume": 100})
        made = graph(host, f"{user}/media", **fields)["id"]
    for _ in range(60):
        state = graph(host, made, fields="status_code").get("status_code")
        if state == "FINISHED":
            break
        if state == "ERROR":
            sys.exit(f"Instagram couldn't process card {c['id']}.")
        time.sleep(5)
    media = graph(host, f"{user}/media_publish", creation_id=made).get("id")
    shelf("DELETE", reel_url)
    # When each one went out, and its id: what the search for the best time reads back.
    posted[str(c["id"])] = {"date": date.today().isoformat(), "at": datetime.now(timezone.utc).isoformat(timespec="minutes"), "media": media, "kind": why,
                            "song": song and song["audio_id"], "song_name": song and f"{song.get('title')} - {song.get('display_artist')}"}
    prices[str(c["id"])] = cents_of(c)    # the drop's been told: this is the new mark
    save(POSTED, posted)
    save(PRICES, prices)
    if song:
        save(SONGS, {**used_songs(), song["audio_id"]: posted[str(c["id"])]["at"]})
    print(f"Posted card {c['id']} ({why}): {c['name']}" + (f" with {posted[str(c['id'])]['song_name']}" if song else ""))


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "preview"
    if what == "post":
        post(*sys.argv[2:4])
    elif what == "check":
        check()
    elif what == "test":
        test(sys.argv[2])
    else:
        for c in load(CARDS, {}).get("for_sale", []):
            print(f"--- {c['id']}{' (no photo)' if not c.get('photo') else ''}\n{caption(c)}")
