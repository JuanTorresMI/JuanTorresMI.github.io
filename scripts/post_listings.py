#!/usr/bin/env python3
"""Cards from the MMA card shop to Instagram as Reels: the card front and back, its name, price, a few hashtags and a song.

  python3 scripts/post_listings.py post        posts the dearest card not posted yet
  python3 scripts/post_listings.py preview     prints every card's caption
  python3 scripts/post_listings.py check       signs in, prints the account's name (never the token) and the songs it would use
  python3 scripts/post_listings.py test DIR    draws the next Reel with its song's preview into DIR, and publishes nothing

Every post is a Reel (scripts/make_reel.py), since only Reels can carry a song, with a trending corrido or other Latin song
from Instagram's own music, attached by Instagram. A Reel is drawn in the run that posts it and goes
straight to Instagram, so no video is ever stored. Instagram's API can't choose where a song starts: CUES holds the
reveal until a song's good part.

What's posted is kept in _data/social_posted.json, so a card never goes out twice. Without IG_USER_ID and
IG_ACCESS_TOKEN (GitHub secrets), `post` only prints what it would have sent.
"""
import json, os, re, sys, tempfile, time, urllib.error, urllib.parse, urllib.request
from datetime import date, datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CARDS = os.path.join(ROOT, "_data", "live", "cards.json")
POSTED = os.path.join(ROOT, "_data", "social_posted.json")
HOSTS = ["https://graph.instagram.com/v22.0", "https://graph.facebook.com/v22.0"]    # Instagram login's tokens, Unified login's
# Songs: what's trending by these first, then searches. Instagram has no genre filter, so the artists and words are the filter.
CORRIDOS = ("fuerza regida", "peso pluma", "natanael cano", "junior h", "gabito ballesteros", "tito double p", "luis r conriquez", "grupo firme", "xavi",
            "oscar maydon", "chino pacas", "ivan cornejo", "eslabon armado", "banda ms", "carin leon", "calle 24", "grupo frontera", "los tigres del norte")
LATIN = ("bad bunny", "karol g", "feid", "rauw alejandro", "humbe", "bago villain", "christian nodal", "kali uchis", "anuel aa", "ozuna", "j balvin")
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
    """The dearest card with a photo not posted yet, or None."""
    posted = load(POSTED, {})
    todo = [c for c in load(CARDS, {}).get("for_sale", []) if c.get("photo") and priced(c) and str(c["id"]) not in posted]
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
    """The next Reel as it would go out, without its song, which only Instagram can add: nothing is published."""
    import make_reel
    os.makedirs(folder, exist_ok=True)
    c = reel_due()
    if not c:
        return print("No card due a Reel.")
    picks = pick_songs(used_songs()) or pick_songs()
    song = picks[0] if picks else None
    front, back = photos_of(c, folder)
    make_reel.make(c, front, back, os.path.join(folder, "next-reel.mp4"), cue=CUES.get((song or {}).get("audio_id"), 0.0), stills=os.path.join(folder, "frames.png"))
    with open(os.path.join(folder, "caption.txt"), "w", encoding="utf-8") as f:
        f.write(f"{caption(c)}\n\nSong: {song.get('title')} - {song.get('display_artist')}\n" if song else f"{caption(c)}\n\nNo song found.\n")
    print(f"Card {c['id']}: {c['name']} | song: {(song or {}).get('title')} - {(song or {}).get('display_artist')} | back photo: {bool(back)}")


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


def post():
    """The dearest listed card with a photo not posted yet, as a Reel: drawn here and uploaded straight to Instagram."""
    import make_reel
    posted = load(POSTED, {})
    c = reel_due()
    if not c:
        return print("Nothing to post.")
    text = caption(c)
    if not (os.environ.get("IG_USER_ID") and os.environ.get("IG_ACCESS_TOKEN")):
        return print(f"No Instagram keys. Would post card {c['id']}:\n{text}")
    user, host = os.environ["IG_USER_ID"], account()[0]
    if not host:
        sys.exit("The Instagram token didn't work.")
    # Few corridos are cleared for apps: when they've all been used, one comes round again instead of a silent Reel.
    picks = pick_songs(used_songs()) or pick_songs()
    song = picks[0] if picks else None
    cue = CUES.get((song or {}).get("audio_id"), 0.0)
    with tempfile.TemporaryDirectory() as tmp:
        film = os.path.join(tmp, "reel.mp4")
        front, back = photos_of(c, tmp)
        make_reel.make(c, front, back, film, cue=cue)
        # The cover is the finished frame: the card, its price and the shop.
        fields = {"media_type": "REELS", "upload_type": "resumable", "caption": text, "share_to_feed": "true", "thumb_offset": str(int((cue + 11) * 1000))}
        if song:
            fields["audio_configuration"] = json.dumps({"audio_id": song["audio_id"], "audio_volume": 80, "video_volume": 100})
        made = graph(host, f"{user}/media", **fields)["id"]
        with open(film, "rb") as f:
            body = f.read()
        # The film itself goes to Instagram, so nothing has to host it.
        up = urllib.request.Request(f"https://rupload.facebook.com/ig-api-upload/v22.0/{made}", data=body, method="POST",
                                    headers={"Authorization": f"OAuth {os.environ['IG_ACCESS_TOKEN']}", "offset": "0", "file_size": str(len(body))})
        with urllib.request.urlopen(up, timeout=180) as r:
            r.read()
    for _ in range(60):
        state = graph(host, made, fields="status_code").get("status_code")
        if state == "FINISHED":
            break
        if state == "ERROR":
            sys.exit(f"Instagram couldn't process card {c['id']}.")
        time.sleep(5)
    media = graph(host, f"{user}/media_publish", creation_id=made).get("id")
    # When each one went out, and its id: what the search for the best time reads back.
    posted[str(c["id"])] = {"date": date.today().isoformat(), "at": datetime.now(timezone.utc).isoformat(timespec="minutes"), "media": media,
                            "song": song and song["audio_id"], "song_name": song and f"{song.get('title')} - {song.get('display_artist')}"}
    with open(POSTED, "w", encoding="utf-8", newline="\n") as f:
        json.dump(posted, f, indent=2, sort_keys=True)
        f.write("\n")
    print(f"Posted card {c['id']}: {c['name']}" + (f" with {posted[str(c['id'])]['song_name']}" if song else ""))


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "preview"
    if what == "post":
        post()
    elif what == "check":
        check()
    elif what == "test":
        test(sys.argv[2])
    else:
        for c in load(CARDS, {}).get("for_sale", []):
            print(f"--- {c['id']}{' (no photo)' if not c.get('photo') else ''}\n{caption(c)}")
