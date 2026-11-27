#!/usr/bin/env python3
"""Cards from the MMA card shop to Instagram as Reels: the card front and back, its name, price, a few hashtags and a song.

  python3 scripts/post_listings.py post        posts the next card: a price drop, a sale, a set's collage, the dearest new card, an old one again
  python3 scripts/post_listings.py post "set:2025 Topps Chrome"    posts that set's collage now
  python3 scripts/post_listings.py post fight   posts the fighters on the next UFC card now (or "winners", the last one's winners)
  python3 scripts/post_listings.py preview     prints every card's caption
  python3 scripts/post_listings.py check       signs in, prints the account's name (never the token) and the songs it would use
  python3 scripts/post_listings.py test DIR    draws the next Reel with its song's preview into DIR, and publishes nothing
  python3 scripts/post_listings.py stats       each post's views, reach, likes, saves, shares and watch time, and the account's 28 days

Every post is a Reel (scripts/make_reel.py) in one of its looks (THEMES, in turn), and goes to the Facebook Page too
(to_facebook), since Instagram's own cross-posting skips posts made through the API. Only Reels can carry a song, with a hype song from Instagram's own
music (PLAYLIST), attached by Instagram. A Reel is drawn in the run that posts it and sits in R2 just long
enough for Instagram to fetch it, so no video is kept. Instagram's API can't choose where a song starts: CUES holds the
reveal until a song's good part.

Each run reads the shop live, so a newly listed card can go out at the next slot. What's posted is kept in
_data/social_posted.json, and each card's last known price in _data/social_prices.json: a drop of DROP_FROM or more jumps the
line with its own Reel. With no new cards, a card still for sale after REPEAT_DAYS comes round again, at most once a day. Without IG_USER_ID and
IG_ACCESS_TOKEN (GitHub secrets), `post` only prints what it would have sent.
"""
import io, json, os, re, sys, tempfile, time, urllib.error, urllib.parse, urllib.request
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
CARDS = os.path.join(ROOT, "_data", "live", "cards.json")
POSTED = os.path.join(ROOT, "_data", "social_posted.json")
PRICES = os.path.join(ROOT, "_data", "social_prices.json")
SONGS = os.path.join(ROOT, "_data", "social_songs.json")
FEED = os.path.join(ROOT, "_data", "social_feed.json")      # the /mma-cards/ page's On Instagram section, newest first
COVERS = os.path.join(ROOT, "mma-cards", "reels")           # its small cover pictures; Instagram's own addresses expire
FEED_KEEP = 12
HOSTS = ["https://graph.instagram.com/v22.0", "https://graph.facebook.com/v22.0"]    # Instagram login's tokens, Unified login's
# Songs: hand-picked from what Instagram's music offers apps, which is its own royalty-free library (a search for a famous
# artist brings back library tracks; the few real songs cleared for apps are mostly explicit). Hype hip-hop, trap and fight
# tracks that fit a card reveal, found with `post_listings.py music "hype;trap;fight"` (Nov 3, 2026). They take turns.
PLAYLIST = [
    ("523966117385305", "Big Leagues (Instrumental)", "Mike Floss"), ("1004757262558654", "Highlight Reel", "ill Think in ink"),
    ("1377485917727304", "Fighter", "LAVLO"), ("1068592065620532", "Legendary", "LAVLO"), ("1583825469924235", "Masterpiece", "LAVLO"),
    ("391037959442354", "Fight Club", "Mike Floss"), ("1108285910189784", "Knockout", "Adam Griffith"), ("5614637338649821", "Top 5", "Mike Floss"),
    ("266326379158916", "No Demons (Instrumental)", "Mike Floss"), ("748675236641409", "Crown (Instrumental)", "Mike Floss"),
    ("3550166498639096", "New Benz (Instrumental)", "Maxsickboy"), ("4319336215018695", "This What We Doin (Instrumental)", "Sbvce"),
    ("1130375707604333", "No Limit", "Maxsickboy"), ("1744948239772680", "Greatness", "Jordan Olmos"), ("1147923547185188", "Champions", "stereogully"),
    ("774667642107625", "Battle", "Sam Marshall"), ("791711906519334", "Fight (Instrumental)", "Sugartapes"), ("4111362749091905", "Go (Instrumental)", "Company Money"),
    ("1347176186322399", "Do Ma Thing", "Tony Dark Eyes"), ("1060743318649873", "Climb", "Maxsickboy"), ("1649979542404348", "Get It", "Mike Floss"),
]
DROP_FROM = 0.05            # a price this far under the last one is a drop
# Recycling ("STILL AVAILABLE"): only when there's nothing new, a drop or a sale to post. A card waits 7 days after its first
# post, then twice as long after each repeat (7, 14, 28), goes round MAX_REPEATS times at most (after that only a price drop
# brings it back), and the account repeats at most RECYCLE_WEEK cards a week and never within REPEAT_GAP_H of any post.
REPEAT_DAYS = 7
MAX_REPEATS = 3
RECYCLE_WEEK = 3
REPEAT_GAP_H = 20
MIN_POST = 10               # dollars: cheaper cards aren't posted (a drop counts when the card was at least this before it)
WORDS = {"again": "STILL AVAILABLE", "sold": "SOLD"}     # the opening words of a repeat and of a sale, in place of the card's rarity
# Set collages (Juan, Nov 8, 2026: "compile posts ... all of the Topps Chrome 2025 UFC set ... a collage"): a set with SET_MIN
# or more cards for sale (with photos) gets one Reel of them together, the dearest first, 12 at most. One collage every
# SET_EVERY_H at most, and the same set again after SET_AGAIN_DAYS. Every price counts here: a collage is where the cheaper
# cards get seen. A collage goes ahead of a new card's own post; a price drop or a sale still comes first.
SET_MIN = 4
SET_EVERY_H = 72
SET_AGAIN_DAYS = 21
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


# Nov 16, 2026: a study of ~25 UFC card accounts found plain "card, price, link in bio" feeds get ~3 likes a post, and
# what draws people in is a question, the fighter himself (tagged) and the hobby's own hashtags. So each caption asks
# something, tags the fighter's own account when it's verified (_data/fighter_handles.json, checked with Business
# Discovery: never a guess), and uses the tags those accounts share (#UFCCards #MMACards #TheHobby).
HANDLES = os.path.join(ROOT, "_data", "fighter_handles.json")
QUESTIONS = ["Stash or flip? 👀", "Keep it or sell it?", "Grade it or keep it raw?", "Where does this rank in your PC?", "Who's your favorite fighter to collect?",
             "Would this go in your binder or a top loader?"]
FIGHTS = {}      # folded fighter name: "Fights Saturday vs. Navajo Stirling" (fight_soon fills it each run)


def handle_of(player):
    import fight_week
    for name, h in load(HANDLES, {}).items():
        if player and fight_week.same(name, player):
            return h
    return None


def fight_soon(player):
    """"Fights Saturday vs. X" when the fighter is on a card in the next few days, else ""."""
    import fight_week
    return next((v for k, v in FIGHTS.items() if player and fight_week.same(k, player)), "")


def hashtags(c, extra=()):
    low = f"{c.get('name') or ''} {c.get('set') or ''}".lower()
    tags = ([tag(c["player"])] if c.get("player") else []) + list(extra) + ["#UFCCards"] + [f"#{t}" for p, t in PRODUCTS if p in low][:1]
    tags += ["#RookieCard"] if c.get("rookie") else ["#Autograph"] if c.get("auto") else ["#MMACards"]
    return " ".join((tags + ["#TheHobby", "#UFC"])[:5])


def caption(c, was=None, sold=False):
    """The card's name (and the fighter's own account), its price, a question, and five hashtags at most; for a price drop,
    what it was; for a sale, a thank-you instead."""
    name = c["name"].strip()
    if c.get("player") and c["player"].lower() not in name.lower():
        name = f"{c['player']}: {name}"
    h = handle_of(c.get("player"))
    who = f"\n@{h}" if h else ""
    soon = fight_soon(c.get("player"))
    if sold:
        return f"SOLD: {name}{who}\nThank you to the buyer. More UFC cards in the shop, link in bio\n\n{hashtags(c)}"
    price = f"Price drop: was {was}, now {c['price']}" if was else c["price"]
    ask = f"{soon}: who are you picking?" if soon else QUESTIONS[int(c["id"]) % len(QUESTIONS)] if str(c.get("id", "")).isdigit() else QUESTIONS[0]
    return f"{name}{who}\n{price} · shop link in bio\n\n{ask}\n\n{hashtags(c)}"


def caption_fight(g):
    """A fight-week or winners post: the event, each fighter's card and price, a question."""
    e, names = g["event"], [f"{f} {c['price'].replace('.00', '')}" for f, c in g["picks"][:6]]
    more = len(g["picks"]) - len(names)
    event_tag = tag(re.sub(r"[^A-Za-z0-9 ]", "", e["name"].split(":")[0]))
    if g["kind"] == "winners":
        won = ", ".join(f for f, _ in g["picks"][:4])
        head = f"Congrats to {won} at {e['name']}. Their cards are in the shop:"
        ask = "Who impressed you most?"
    else:
        head = f"{g['when'].title()} at {e['name']}. Cards of the fighters, in the shop now:"
        ask = "Who are you picking?"
    lines = " · ".join(names) + (f" and {more} more" if more > 0 else "")
    return f"{head}\n{lines}\nLink in bio\n\n{ask}\n\n{' '.join([event_tag, '#UFC', '#UFCCards', '#MMACards', '#TheHobby'])}"


def caption_set(g):
    """A collage's caption: the set, how many, the dearest few with their prices, five hashtags at most."""
    low = g["name"].lower()
    tags = ["#UFC", "#UFCCards"] + [f"#{t}" for p, t in PRODUCTS if p in low][:1] + ["#MMACards", "#TradingCards"]
    names = [f"{c.get('player') or c['name']} {c['price'].replace('.00', '')}" for c in g["cards"][:5]]
    more = g["count"] - len(names)
    return (f"{g['name']}: {g['count']} cards for sale\n" + " · ".join(names) + (f" and {more} more" if more > 0 else "") +
            "\nShop link in bio\n\n" + " ".join(tags[:5]))


CATALOG = {}      # the shop's catalog id, looked up once a run


def product_tags(host, user, c, why):
    """The Reel's cards as Instagram Shopping product tags (JSON for the container's product_tags), or None. The shop's
    catalog is the showcase Worker's /catalog.tsv, where each card is the product with Content ID JJ-<card id>; a Reel
    tags its card, a set or fight-week collage up to 30 of its cards. A sale's Reel tags nothing (the card is gone).
    Needs the account's Instagram Shop and a token with instagram_shopping_tag_products; without them the Reel goes out
    untagged, as before."""
    if why == "sold":
        return None
    try:
        if "id" not in CATALOG:
            me = read(host, user, fields="shopping_product_tag_eligibility,available_catalogs")
            cats = (me.get("available_catalogs") or {}).get("data") or []
            CATALOG["id"] = cats[0].get("catalog_id") if me.get("shopping_product_tag_eligibility") and cats else None
            if not CATALOG["id"]:
                print("Product tags: the account can't tag products yet (no approved shop or catalog)")
        if not CATALOG["id"]:
            return None
        tags, cards = [], (c.get("cards") or [c])[:30]
        for x in cards:
            sku = f"JJ-{x['id']}"
            hits = read(host, f"{user}/catalog_product_search", catalog_id=CATALOG["id"], q=sku).get("data", [])
            hit = next((h for h in hits if h.get("retailer_id") == sku), None)
            pid = hit and str(hit["product_id"])
            if hit and hit.get("review_status") != "approved":
                print(f"Product tags: {sku} is {hit.get('review_status')} in the shop (only approved tags show)")
            if pid and all(t["product_id"] != pid for t in tags):
                tags.append({"product_id": pid})
        print(f"Product tags: {len(tags)} of {len(cards)} card(s) found in the shop")
        return json.dumps(tags) if tags else None
    except urllib.error.HTTPError as e:
        print(f"Product tags skipped ({e.code}): {json.load(e).get('error', {}).get('message', '')[:200]}")
    except Exception as e:
        print(f"Product tags skipped: {e}")
    return None


def why_not(e):
    """Instagram's whole reason for refusing a call: message, subcode and the user-facing text, which "Invalid parameter" hides."""
    err = json.load(e).get("error", {})
    return " · ".join(str(x) for x in (err.get("message"), err.get("error_subcode"), err.get("error_user_title"), err.get("error_user_msg")) if x)[:400]


def tag_media(host, media, tags):
    """Tags a published Reel's products (Instagram's POST /{media}/product_tags): when the container wouldn't take them,
    and for the `tag` switch. Returns True when Instagram says it worked."""
    data = urllib.parse.urlencode({"updated_tags": tags, "access_token": os.environ["IG_ACCESS_TOKEN"]}).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(f"{host}/{media}/product_tags", data=data, method="POST"), timeout=60) as r:
            ok = bool(json.load(r).get("success"))
        print(f"Tagged Reel {media}: {'done' if ok else 'Instagram said no'}")
        return ok
    except urllib.error.HTTPError as e:
        print(f"Instagram refused tagging Reel {media} ({e.code}): {why_not(e)}")
        return False


def tag_existing(arg):
    """`tag` switch: "<media id>:<card id>[,<card id>...]" tags a Reel that's already up with those cards. Posts nothing."""
    media, _, ids = (arg or "").partition(":")
    host = account()[0]
    if not (media and ids and host):
        sys.exit("Use <media id>:<card id>, and a working token.")
    tags = product_tags(host, os.environ["IG_USER_ID"], {"cards": [{"id": i.strip()} for i in ids.split(",") if i.strip()]}, "new")
    if not tags or not tag_media(host, media, tags):
        sys.exit(1)


def facebook_caption(c, text, why):
    """The Facebook copy of a caption: links are clickable there (not on Instagram), so "link in bio" becomes the card's own
    eBay listing (the showcase's `ebay`), or the eBay store for a sale, a set or a fight-week post."""
    if c.get("ebay") and why != "sold":
        text = text.replace(" · shop link in bio", f"\nBuy it on eBay: {c['ebay']}")
    with open(os.path.join(ROOT, "_config.yml"), encoding="utf-8") as f:
        store = re.search(r'^ebay_store_url:\s*"([^"]+)"', f.read(), re.M)
    if not store:
        return text
    text = text.replace("in the shop, link in bio", f"on eBay: {store.group(1)}")
    return re.sub(r"(?i)(shop )?link in bio", f"Shop on eBay: {store.group(1)}", text)


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
    page, _, why = facebook_page()
    print(f"Facebook: posting to {why} ({page})" if page else f"Facebook: not posting, {why}")
    try:
        perms = read(host, "me/permissions").get("data", [])
        print("Token permissions: " + ", ".join(sorted(p["permission"] for p in perms if p.get("status") == "granted")))
        missing = {"instagram_shopping_tag_products", "catalog_management"} - {p["permission"] for p in perms if p.get("status") == "granted"}
        if missing:
            print("Missing for product tags: " + ", ".join(sorted(missing)))
        # Which businesses, catalogs and accounts each tagging permission was granted for (the token's own granular
        # scopes): a catalog or business left unticked when the token was made blocks tags with "Cannot Tag Product".
        tok = os.environ["IG_ACCESS_TOKEN"]
        dbg = read(host, "debug_token", input_token=tok).get("data", {})
        for g in dbg.get("granular_scopes", []):
            if g.get("scope") in ("catalog_management", "instagram_shopping_tag_products", "business_management", "instagram_basic"):
                print(f"Scope {g['scope']}: " + (", ".join(g.get("target_ids") or []) or "all"))
        me = read(host, os.environ["IG_USER_ID"], fields="shopping_product_tag_eligibility,available_catalogs")
        print("Tag eligibility: " + str(me.get("shopping_product_tag_eligibility")) + "; catalogs: " +
              ", ".join(f"{x.get('catalog_id')} ({x.get('catalog_name')})" for x in (me.get("available_catalogs") or {}).get("data", [])))
    except urllib.error.HTTPError as e:
        print(f"Couldn't read the token's permissions ({e.code}): {why_not(e)}")
    cards = listings()
    if cards:
        tags = product_tags(host, os.environ["IG_USER_ID"], cards[0], "new")
        print(f"Instagram Shopping: card {cards[0]['id']} would be tagged" if tags else "Instagram Shopping: Reels go out without product tags")
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


def pick_songs(used={}):
    """The playlist in the order it'd be used: least recently used first (never used before all), the list's order among equals."""
    out = [{"audio_id": i, "title": t, "display_artist": a} for i, t, a in PLAYLIST]
    return sorted(out, key=lambda s: used.get(s["audio_id"], ""))


def music(searches):
    """What Instagram's music for apps has for each search ("hype;trap;eminem"): title, artist, length and id, to choose songs by."""
    for words in [w.strip() for w in searches.split(";") if w.strip()]:
        found = songs(words)
        print(f"\n== {words}: {len(found)}")
        for s in found:
            print(f"  {s.get('audio_id')}  {round((s.get('duration_in_ms') or 0) / 1000)}s  {s.get('title')} - {s.get('display_artist')}")


def trending():
    picks = pick_songs()
    print(f"{len(picks)} songs to choose from:")
    for s in picks[:25]:
        print(f"  {s.get('title')} - {s.get('display_artist')}")


def lead_name(name):
    """The person a hand-written card name opens with ("Laura Sanko 2026 Champions Collection..."), for a card the shop has no fighter for."""
    m = re.match(r"([A-Z][\w'.-]+(?: [A-Z][\w'.-]+){1,3}) (?:19|20)\d\d\b", name or "")
    return m.group(1) if m and not re.search(r"\b(topps|panini|ufc|lot)\b", m.group(1), re.I) else ""


def recent_sales():
    """Cards sold this month or last (the shop gives only the month), for SOLD Reels."""
    first = date.today().replace(day=1)
    months = {first.strftime("%Y-%m"), (first - timedelta(days=1)).strftime("%Y-%m")}
    return [c for c in listings("sold") if c.get("month") in months]


def listings(part="for_sale"):
    """The cards for sale right now (or, with "sold", the latest sales), from the shop itself: the site's copy (a day old at
    worst) only if that's down."""
    try:
        with urllib.request.urlopen(urllib.request.Request(f"{showcase_url()}/showcase.json", headers={"User-Agent": "juantorresmi-site"}), timeout=30) as r:
            return [{**c, "player": c.get("player") or lead_name(c["name"]), "set": c.get("set") or "", "parallel": c.get("parallel") or "", "serial": c.get("serial") or "",
                     "auto": c.get("auto") or bool(re.search(r"\b(auto|autograph|signature)", c["name"], re.I)),
                     "price": f"${c['price'] / 100:,.2f}" if c.get("price") else ""} for c in json.load(r)[part]]
    except Exception as e:
        print(f"Using the site's copy of the shop ({e})")
        return load(CARDS, {}).get(part, [])


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


def feed_add(host, media, c, kind):
    """A posted Reel on the page: its link, name, price and a small copy of its cover. Only the latest few are kept."""
    from PIL import Image
    info = graph(host, media, fields="permalink,thumbnail_url")
    os.makedirs(COVERS, exist_ok=True)
    with urllib.request.urlopen(urllib.request.Request(info["thumbnail_url"], headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as r:
        pic = Image.open(io.BytesIO(r.read())).convert("RGB")
    pic.thumbnail((360, 640))
    pic.save(os.path.join(COVERS, f"{media}.jpg"), "JPEG", quality=82, optimize=True)
    name = c.get("player") or c["name"]
    rest = [p for p in load(FEED, []) if p["media"] != media]
    price = f"{c['count']} cards" if kind == "set" else (c.get("price") or "").replace(".00", "")
    feed = [{"media": media, "url": info["permalink"], "name": name, "title": c["name"], "price": price, "drop": kind == "drop",
             "sold": kind == "sold", "set": kind == "set"}, *rest]
    save(FEED, feed[:FEED_KEEP])
    keep = {f"{p['media']}.jpg" for p in feed[:FEED_KEEP]}
    for f in os.listdir(COVERS):
        if f not in keep:
            os.remove(os.path.join(COVERS, f))


def feed_backfill():
    """Puts what's already been posted on the page."""
    host = account()[0]
    cards = {str(c["id"]): c for c in listings()}
    for k, v in sorted(load(POSTED, {}).items(), key=lambda kv: when_posted(kv[1])):
        if isinstance(v, dict) and v.get("media") and k in cards:
            feed_add(host, v["media"], cards[k], v.get("kind"))


def set_of(c):
    """The card's set, year and product ("2025 Topps Chrome UFC"): the shop's, else read from the start of its name."""
    name = c.get("set") or ""
    if not name:
        m = re.match(r"((?:19|20)\d\d) (.+?) UFC\b", c.get("name") or "")
        name = f"{m.group(1)} {m.group(2)} UFC" if m else ""
    return re.sub(r"\bTopps Stadium Club\b", "Stadium Club", re.sub(r"\s+", " ", name)).strip()


def set_key(name):
    return "set-" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def collage(name, cards):
    """A set's collage, as one post: what next_up returns for it. The cards shown are the dearest 4, 6, 9 or 12."""
    group = sorted([c for c in cards if c.get("photo") and priced(c) and set_of(c) == name], key=worth, reverse=True)
    shown = max([k for k in (4, 6, 9, 12) if k <= len(group)], default=0)
    return {"id": set_key(name), "name": name, "set": name, "player": "", "price": "", "cards": group[:shown], "count": len(group)}


def sets_due(cards, posted):
    """The sets due a collage, the one whose collage shows the most money first, or none while the last collage is under
    SET_EVERY_H old."""
    if any(isinstance(v, dict) and v.get("kind") == "set" and hours_since(when_posted(v)) < SET_EVERY_H for v in posted.values()):
        return []
    names = {set_of(c) for c in cards if c.get("photo") and priced(c)} - {""}
    due = [collage(n, cards) for n in names]
    due = [g for g in due if g["count"] >= SET_MIN and (g["id"] not in posted or hours_since(when_posted(posted[g["id"]])) >= SET_AGAIN_DAYS * 24)]
    return sorted(due, key=lambda g: (sum(worth(c) for c in g["cards"]), g["count"]), reverse=True)


FIGHT_BEFORE_DAYS = 5      # the fighters on a card go out this many days before it at most
WINNERS_DAYS = 3           # and the winners within this many days after
FIGHT_MAX = 12


def fight_posts(cards, posted, force=None):
    """The fight-week posts due (Juan, Nov 16, 2026): before an event, a collage of the shop's cards of its fighters
    ("fight-<event>"); after it, of its winners ("winners-<event>"). Any price: these are the fighters people are looking
    up that week. Fills FIGHTS for the captions too. `force` ("fight" or "winners") takes the nearest one, posted or not."""
    import fight_week
    try:
        evs = fight_week.events()
    except Exception as e:
        print(f"No UFC schedule this run ({e})")
        return []
    today = datetime.now(fight_week.ET).date()
    ready = [{**c, "_worth": worth(c)} for c in cards if c.get("photo") and priced(c)]
    out = []
    for e in sorted(evs, key=lambda e: e["when"]):
        days = (e["day"] - today).days
        if not e["done"] and 0 <= days <= FIGHT_BEFORE_DAYS:
            for b in e["bouts"]:
                for i, f in enumerate(b["fighters"]):
                    other = b["fighters"][1 - i] if len(b["fighters"]) == 2 else ""
                    FIGHTS[f] = f"Fights {fight_week.day_word(e, today).title()}" + (f" vs. {other}" if other else "")
            kind, names = "fight", [f for b in e["bouts"] for f in b["fighters"]]
        elif e["done"] and 0 <= -days <= WINNERS_DAYS:
            kind, names = "winners", [b["winner"] for b in e["bouts"] if b["winner"]]
        else:
            continue
        key = f"{kind}-{e['id']}"
        if (key in posted and force != kind) or (force and force != kind):
            continue
        picks = fight_week.cards_of(names, ready)[:FIGHT_MAX]
        if not picks:
            continue
        when = fight_week.day_word(e, today)
        head, main = fight_week.headline(e)
        title = "WINNERS" if kind == "winners" else f"FIGHTING {when}" if when not in ("TONIGHT",) else "FIGHT NIGHT TONIGHT"
        out.append({"id": key, "kind": kind, "name": title, "set": "", "player": "", "price": "", "event": e, "when": when, "picks": picks,
                    "cards": [c for _, c in picks], "count": len(picks), "title": title, "sub": f"{head}  ·  {main}".upper()})
    return out


def next_up(cards, posted, prices, sold=()):
    """What goes next, as (card, old price or None, why): a fight-week post (the fighters on the next card, or the
    winners), a price drop, then a recent sale ("sold", kept in posted as sold-<id>), a set's collage, the dearest new
    card, then an old one again."""
    fights = fight_posts(cards, posted)
    if fights:
        return fights[0], None, fights[0]["kind"]
    ready = [c for c in cards if c.get("photo") and priced(c)]
    drops = [c for c in ready if prices.get(str(c["id"])) and prices[str(c["id"])] >= MIN_POST * 100 and cents_of(c) <= prices[str(c["id"])] * (1 - DROP_FROM)]
    ready = [c for c in ready if worth(c) >= MIN_POST]
    if drops:
        c = max(drops, key=lambda x: prices[str(x["id"])] - cents_of(x))
        return c, f"${prices[str(c['id'])] / 100:,.2f}", "drop"
    sales = [c for c in sold if c.get("photo") and priced(c) and worth(c) >= MIN_POST and f"sold-{c['id']}" not in posted]
    if sales:
        return max(sales, key=worth), None, "sold"
    sets = sets_due(cards, posted)
    if sets:
        return sets[0], None, "set"
    fresh = [c for c in ready if str(c["id"]) not in posted]
    if fresh:
        return max(fresh, key=worth), None, "new"
    # Nothing new: keep the page alive with what's still for sale, oldest post first, without repeating too often.
    if posted and min(hours_since(when_posted(v)) for v in posted.values()) < REPEAT_GAP_H:
        return None, None, "resting"
    week = [v for v in posted.values() if isinstance(v, dict) and v.get("kind") == "again" and hours_since(when_posted(v)) < 7 * 24]
    if len(week) >= RECYCLE_WEEK:
        return None, None, f"{len(week)} repeats this week already"
    again = [c for c in ready if repeats(posted[str(c["id"])]) < MAX_REPEATS
             and hours_since(when_posted(posted[str(c["id"])])) >= REPEAT_DAYS * 24 * 2 ** repeats(posted[str(c["id"])])]
    if again:
        # The dearest of the ones due, so the best cards come round first; the longest-waiting breaks a tie.
        return max(again, key=lambda c: (worth(c), hours_since(when_posted(posted[str(c["id"])])))), None, "again"
    return None, None, "out of cards"


def repeats(v):
    """How many times a card has gone round again since its first post (or its last price drop)."""
    return v.get("repeats", 1 if v.get("kind") == "again" else 0) if isinstance(v, dict) else 0


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


def test(folder, card=None, old=None):
    """The next Reel as it would go out, without its song, which only Instagram can add: nothing is published."""
    import make_reel
    os.makedirs(folder, exist_ok=True)
    cards = listings()
    c, was, why = choose(cards, load(POSTED, {}), load(PRICES, {}), card, old)
    if not c:
        return print(f"Nothing to post: {why}.")
    picks = pick_songs(used_songs())
    song = picks[0] if picks else None
    theme = pick_theme(load(POSTED, {}))
    print(f"{c['id']} ({why}, look {theme}): getting photos")
    draw(c, why, was, folder, os.path.join(folder, "next-reel.mp4"), CUES.get((song or {}).get("audio_id"), 0.0), theme, stills=os.path.join(folder, "frames.png"))
    text = caption_of(c, was, why)
    with open(os.path.join(folder, "caption.txt"), "w", encoding="utf-8") as f:
        f.write(f"{text}\n\nSong: {song.get('title')} - {song.get('display_artist')}\n" if song else f"{text}\n\nNo song found.\n")
    print(f"{c['id']} ({why}, look {theme}): {c['name']} | song: {(song or {}).get('title')} - {(song or {}).get('display_artist')}")


def front_of(c, folder):
    """Just the card's front photo, for a collage."""
    path = os.path.join(folder, f"{c['id']}-full.webp")
    with urllib.request.urlopen(urllib.request.Request(f"{showcase_url()}/photo/{c['id']}-full.webp", headers={"User-Agent": "juantorresmi-site"}), timeout=30) as r, open(path, "wb") as f:
        f.write(r.read())
    return path


def draw(c, why, was, folder, film, cue, theme, stills=None):
    """The Reel for a card or (why "set") a set's collage, into `film`."""
    import make_reel
    if why in ("fight", "winners"):
        items = []
        for x in c["cards"]:
            try:
                items.append((x, front_of(x, folder)))
            except urllib.error.HTTPError:
                pass
        items = items[:max([k for k in (1, 2, 3, 4, 6, 9, 12) if k <= len(items)], default=0)]
        if not items:
            raise RuntimeError(f"No photos for {c['name']}")
        return make_reel.make_set(c["title"], c["sub"], items, film, c["count"], cue=cue, theme=theme, stills=stills)
    if why == "set":
        items = []
        for x in c["cards"]:
            try:
                items.append((x, front_of(x, folder)))
            except urllib.error.HTTPError:
                pass        # a photo gone since the shop's list: the collage does without it
        items = items[:max([k for k in (4, 6, 9, 12) if k <= len(items)], default=0)]
        if len(items) < SET_MIN:
            raise RuntimeError(f"Only {len(items)} photos for {c['name']}")
        sub = f"{len(items)} CARDS FOR SALE" if c["count"] == len(items) else f"{c['count']} CARDS  ·  THE TOP {len(items)}"
        title = re.sub(r"\s*UFC$", "", c["name"]).upper()
        return make_reel.make_set(title, f"UFC  ·  {sub}", items, film, c["count"], cue=cue, theme=theme, stills=stills)
    front, back = photos_of(c, folder)
    make_reel.make(c, front, back, film, cue=cue, stills=stills, was=was, words=WORDS.get(why), theme=theme, soon=fight_soon(c.get("player")))


def caption_of(c, was, why):
    return caption_fight(c) if why in ("fight", "winners") else caption_set(c) if why == "set" else caption(c, was, why == "sold")


def pick_theme(posted):
    """The look (make_reel.THEMES) least recently used, so they take turns. Posts from before the looks were all "glow"."""
    import make_reel
    last = {}
    for v in posted.values():
        if isinstance(v, dict):
            t = v.get("theme") or "glow"
            last[t] = max(last.get(t, ""), when_posted(v))
    return min(make_reel.THEMES, key=lambda t: (last.get(t, ""), make_reel.THEMES.index(t)))


def choose(cards, posted, prices, card=None, old=None):
    """next_up, or the card asked for: one for sale, else one of the recent sales (a SOLD Reel)."""
    sold = recent_sales()
    if not card:
        return next_up(cards, posted, prices, sold)
    if str(card).lower() in ("fight", "winners"):
        g = fight_posts(cards, posted, force=str(card).lower())
        return (g[0], None, g[0]["kind"]) if g else (None, None, f"no {card} post: no UFC event near with the shop's fighters")
    fight_posts(cards, {}, force="none")      # only to know who fights soon, for the caption
    if str(card).lower().startswith("set:"):
        want = card[4:].strip().lower()
        name = next((n for n in sorted({set_of(c) for c in cards}) if n.lower() == want), None) or \
            next((n for n in sorted({set_of(c) for c in cards}) if want in n.lower()), None)
        g = name and collage(name, cards)
        return (g, None, "set") if g and len(g["cards"]) >= SET_MIN else (None, None, f"no set like {card[4:]!r} with {SET_MIN} cards with photos")
    c = next((x for x in cards if str(x["id"]) == str(card)), None)
    if c:
        return c, old or None, "asked"
    return next((x for x in sold if str(x["id"]) == str(card)), None), None, "sold"


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
    c, was, why = choose(cards, posted, prices, card, old)
    note_prices(cards, prices)
    if not c:
        save(PRICES, prices)
        return print(f"Nothing to post: {why}.")
    text = caption_of(c, was, why)
    if not (os.environ.get("IG_USER_ID") and os.environ.get("IG_ACCESS_TOKEN")):
        return print(f"No Instagram keys. Would post card {c['id']}:\n{text}")
    user, host = os.environ["IG_USER_ID"], account()[0]
    if not host:
        sys.exit("The Instagram token didn't work.")
    picks = pick_songs(used_songs())
    song = picks[0] if picks else None
    cue = CUES.get((song or {}).get("audio_id"), 0.0)
    theme = pick_theme(posted)
    slug = f"card-{c['id']}-{int(time.time())}"
    with tempfile.TemporaryDirectory() as tmp:
        film = os.path.join(tmp, "reel.mp4")
        print(f"{c['id']} ({why}, look {theme}), song {(song or {}).get('title')}: getting photos and drawing")
        t0 = time.time()
        draw(c, why, was, tmp, film, cue, theme)
        print(f"Drawn in {time.time() - t0:.0f}s; parking it for Instagram")
        # The cover is the finished frame: the card, its price and the shop.
        # A song only stays on when Instagram fetches the film from a link (a direct upload lost it), so it sits in R2 until then.
        reel_url = f"{showcase_url()}/reel/{slug}.mp4"
        with open(film, "rb") as f:
            shelf("PUT", reel_url, f.read())
        fields = {"media_type": "REELS", "video_url": reel_url, "caption": text, "share_to_feed": "true", "thumb_offset": str(int((cue + 11 + (make_reel.INTRO if c.get("player") and not c.get("cards") else 0)) * 1000))}
        if song:
            fields["audio_configuration"] = json.dumps({"audio_id": song["audio_id"], "audio_volume": 80, "video_volume": 100})
        tags = product_tags(host, user, c, why)
        if tags:
            fields["product_tags"] = tags
        made, tag_after = None, None
        for _ in range(3):
            try:
                made = graph(host, f"{user}/media", **fields)["id"]
                break
            except urllib.error.HTTPError as e:
                said = why_not(e)
                if "product_tags" in fields:
                    # Tags the container won't take: the Reel goes out, and they're added once it's published.
                    print(f"Instagram refused the product tags on the container ({e.code}): {said}. Tagging after publishing.")
                    tag_after = fields.pop("product_tags"); tags = None
                elif song:
                    # A song Instagram no longer offers apps: the post goes out with the card's own sounds, and the song is named in the log.
                    print(f"Instagram refused the song {song['title']} ({e.code}): {said}. Posting without it.")
                    fields.pop("audio_configuration"); song = None
                else:
                    sys.exit(f"Instagram refused the Reel ({e.code}): {said}")
        if not made:
            sys.exit("Instagram refused the Reel.")
    print("Instagram is processing it")
    for _ in range(60):
        state = graph(host, made, fields="status_code").get("status_code")
        if state == "FINISHED":
            break
        if state == "ERROR":
            sys.exit(f"Instagram couldn't process card {c['id']}.")
        time.sleep(5)
    media = graph(host, f"{user}/media_publish", creation_id=made).get("id")
    if tag_after and media and tag_media(host, media, tag_after):
        tags = tag_after
    fb = to_facebook(reel_url, facebook_caption(c, text, why))
    story = to_story(host, user, reel_url)
    shelf("DELETE", reel_url)
    # When each one went out, and its id: what the search for the best time reads back.
    key = f"sold-{c['id']}" if why == "sold" else str(c["id"])     # a sale's Reel is its own entry: the card's for-sale one stays
    # A repeat counts toward the card's limit and lengthens its next wait; a price drop starts it over.
    times = repeats(posted.get(key)) + 1 if why == "again" else 0 if why in ("drop", "new") or was else repeats(posted.get(key))
    posted[key] = {"date": date.today().isoformat(), "at": datetime.now(timezone.utc).isoformat(timespec="minutes"), "media": media, "kind": why,
                   "repeats": times, "song": song and song["audio_id"], "song_name": song and f"{song.get('title')} - {song.get('display_artist')}", "theme": theme}
    if tags:
        posted[key]["tags"] = len(json.loads(tags))
    if fb:
        posted[key]["facebook"] = fb
    if story:
        posted[key]["story"] = story
    if c.get("cards"):
        posted[key]["cards"] = [x["id"] for x in c["cards"]]
    if why not in ("sold", "set", "fight", "winners"):
        prices[str(c["id"])] = cents_of(c)    # the drop's been told: this is the new mark
    save(POSTED, posted)
    save(PRICES, prices)
    if song:
        save(SONGS, {**used_songs(), song["audio_id"]: posted[key]["at"]})
    try:
        feed_add(host, media, c, "drop" if was else "set" if c.get("cards") else why)
    except Exception as e:      # the post is out: the page can miss one
        print(f"Couldn't add it to the page: {e}")
    print(f"Posted {c['id']} ({why}, look {theme}): {c['name']}" + (f" with {posted[key]['song_name']}" if song else "") + (", and on Facebook" if fb else ""))


FB = "https://graph.facebook.com/v22.0"


def facebook_page():
    """The Facebook Page the Reels also go to, as (page id, page token, its name or why not). Instagram's own "share to
    Facebook" works only for posts made in the app, never for ones sent through the API (Juan, Nov 8, 2026: "cross posting
    to Facebook doesn't work at all"), so the run posts there itself. The Page and its token come from FB_PAGE_ID and
    FB_PAGE_TOKEN when they're set, else from the Instagram token's own Pages (a Facebook-login token with pages_manage_posts)."""
    if os.environ.get("FB_PAGE_ID") and os.environ.get("FB_PAGE_TOKEN"):
        return os.environ["FB_PAGE_ID"], os.environ["FB_PAGE_TOKEN"], "the FB_PAGE_ID Page"
    try:
        pages = read(FB, "me/accounts", fields="id,name,access_token,instagram_business_account").get("data", [])
    except urllib.error.HTTPError as e:
        return None, None, f"the token can't list Facebook Pages ({e.code}: {json.load(e).get('error', {}).get('message', '')[:160]})"
    except urllib.error.URLError as e:
        return None, None, f"Facebook didn't answer ({e})"
    for pg in pages:
        if (pg.get("instagram_business_account") or {}).get("id") == os.environ["IG_USER_ID"]:
            return pg["id"], pg["access_token"], pg.get("name")
    return None, None, f"none of the token's {len(pages)} Pages is linked to this Instagram account"


def fb_post(url, token, data=None, headers=None):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data or {}).encode(), method="POST", headers={"Authorization": f"OAuth {token}", **(headers or {})})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def to_facebook(video_url, text):
    """The Reel on the Facebook Page too, from the same parked film (Pages' Reels API: start, upload by link, publish).
    Facebook's API can't add Instagram's song, so it goes out with the card sounds. Returns the video's id, or None: a
    Facebook failure never stops the Instagram post."""
    page, token, name = facebook_page()
    if not page:
        print(f"Not posted to Facebook: {name}")
        return None
    try:
        vid = fb_post(f"{FB}/{page}/video_reels", token, {"upload_phase": "start"})["video_id"]
        fb_post(f"https://rupload.facebook.com/video-upload/v22.0/{vid}", token, headers={"file_url": video_url})
        fb_post(f"{FB}/{page}/video_reels", token, {"upload_phase": "finish", "video_id": vid, "video_state": "PUBLISHED", "description": text})
        print(f"Posted to Facebook ({name}): video {vid}")
        return vid
    except urllib.error.HTTPError as e:
        print(f"Facebook refused the Reel ({e.code}): {json.load(e).get('error', {}).get('message', '')[:200]}")
    except Exception as e:
        print(f"Facebook post failed: {e}")
    return None


STORIES = os.path.join(ROOT, "_data", "social_stories.json")
STORY_EVERY_H = 20         # one Story a day: the first Reel after this many hours goes to Stories too


def to_story(host, user, video_url):
    """The day's first Reel also as an Instagram Story (Juan, Nov 16, 2026: "daily stories would be good"), from the same
    parked film, so the followers who skip the feed see it at the top of their app. At most one a day; a Story that fails
    never stops the post. Returns the Story's id, or None."""
    kept = load(STORIES, {})
    if kept.get("at") and hours_since(kept["at"]) < STORY_EVERY_H:
        return None
    try:
        made = graph(host, f"{user}/media", media_type="STORIES", video_url=video_url)["id"]
        for _ in range(60):
            state = graph(host, made, fields="status_code").get("status_code")
            if state == "FINISHED":
                break
            if state == "ERROR":
                print("Instagram couldn't process the Story")
                return None
            time.sleep(5)
        sid = graph(host, f"{user}/media_publish", creation_id=made).get("id")
        save(STORIES, {"at": datetime.now(timezone.utc).isoformat(timespec="minutes"), "media": sid, "count": kept.get("count", 0) + 1})
        print(f"Posted as a Story too: {sid}")
        return sid
    except urllib.error.HTTPError as e:
        print(f"Instagram refused the Story ({e.code}): {json.load(e).get('error', {}).get('message', '')[:200]}")
    except Exception as e:
        print(f"Story failed: {e}")
    return None


REEL_METRICS = ("views", "reach", "likes", "comments", "saved", "shares", "total_interactions", "ig_reels_avg_watch_time")
REFUSED = set()      # each reason Instagram gives once, not once per post
ACCOUNT_METRICS = ("reach", "views", "profile_views", "website_clicks", "accounts_engaged", "follows_and_unfollows")


def read(host, path, **fields):
    """A GET from the Graph API (graph() POSTs to paths that end in /media)."""
    fields["access_token"] = os.environ["IG_ACCESS_TOKEN"]
    with urllib.request.urlopen(f"{host}/{path}?{urllib.parse.urlencode(fields)}", timeout=60) as r:
        return json.load(r)


def insights(host, path, metrics, **fields):
    """{metric: value}: all at once, else one by one, since a metric Meta won't give for one post refuses the whole request."""
    def values(d):
        out = {}
        for m in d.get("data", []):
            v = m.get("total_value", {}).get("value") if "total_value" in m else (m.get("values") or [{}])[0].get("value")
            out[m["name"]] = v
        return out
    try:
        return values(read(host, f"{path}/insights", metric=",".join(metrics), **fields))
    except urllib.error.HTTPError:
        out = {}
        for m in metrics:
            try:
                out.update(values(read(host, f"{path}/insights", metric=m, **fields)))
            except urllib.error.HTTPError as e:
                why = json.load(e).get("error", {}).get("message", "")[:200]
                if why not in REFUSED:
                    REFUSED.add(why)
                    print(f"Instagram refused {m} ({e.code}): {why}")
        return out


def stats():
    """Each Reel's views, reach, likes, saves, shares and watch time, and the account's last 28 days: a table in the log and the
    run's summary. Reads only; the token never reaches the log."""
    host, name = account()
    if not host:
        sys.exit(1)
    user = os.environ["IG_USER_ID"]
    me = read(host, user, fields="followers_count,follows_count,media_count")
    media = read(host, f"{user}/media", fields="id,caption,timestamp,permalink,like_count,comments_count,media_product_type", limit=50).get("data", [])
    rows = []
    for m in media:
        i = insights(host, m["id"], REEL_METRICS)
        title = (m.get("caption") or "").split("\n")[0][:60]
        rows.append({"when": m["timestamp"][:16].replace("T", " "), "title": title, "url": m.get("permalink"), **{k: i.get(k) for k in REEL_METRICS}})
        # Likes and comments come with the post itself, so they show even when the insights are refused.
        rows[-1]["likes"] = rows[-1]["likes"] if rows[-1]["likes"] is not None else m.get("like_count")
        rows[-1]["comments"] = rows[-1]["comments"] if rows[-1]["comments"] is not None else m.get("comments_count")
    until = int(time.time()); since = until - 28 * 86400
    acct = insights(host, user, ACCOUNT_METRICS, period="day", metric_type="total_value", since=since, until=until)
    lines = [f"## @{name}: {me.get('followers_count')} followers, following {me.get('follows_count')}, {me.get('media_count')} posts", "",
             "Last 28 days: " + ", ".join(f"{k.replace('_', ' ')} {v}" for k, v in acct.items()), "",
             "| Posted (UTC) | Post | Views | Reach | Likes | Comments | Saves | Shares | Avg watch (s) |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for r in rows:
        watch = r["ig_reels_avg_watch_time"]
        lines.append(f"| {r['when']} | [{r['title'] or 'post'}]({r['url']}) | {r['views']} | {r['reach']} | {r['likes']} | {r['comments']} | {r['saved']} | {r['shares']} | "
                     f"{round(watch / 1000, 1) if isinstance(watch, (int, float)) else watch} |")
    text = "\n".join(lines)
    print(text)
    print("JSON " + json.dumps({"account": me, "last_28_days": acct, "posts": rows}))
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(text + "\n")

if __name__ == "__main__":
    # A run that hangs (one did, twice, somewhere in drawing or posting) prints where every thread is stuck after 8 minutes and
    # ends, rather than holding the posting slot until the workflow's 20-minute limit kills it with nothing to show.
    import faulthandler
    faulthandler.dump_traceback_later(480, exit=True)
    what = sys.argv[1] if len(sys.argv) > 1 else "preview"
    if what == "post":
        post(*sys.argv[2:4])
    elif what == "check":
        check()
    elif what == "music":
        music(" ".join(sys.argv[2:]))
    elif what == "stats":
        stats()
    elif what == "backfill":
        feed_backfill()
    elif what == "tag":
        tag_existing(sys.argv[2] if len(sys.argv) > 2 else "")
    elif what == "test":
        test(*sys.argv[2:5])
    else:
        for c in load(CARDS, {}).get("for_sale", []):
            print(f"--- {c['id']}{' (no photo)' if not c.get('photo') else ''}\n{caption(c)}")
