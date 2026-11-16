"""UFC events around now, and which of the shop's cards are of their fighters (Juan, Nov 16, 2026: fight-week posts).

ESPN's public scoreboard (no key) lists each event's bouts, and once a bout is over, its winner. post_listings.py uses it
for two posts per event: the fighters on the card a few days before ("FIGHTING SATURDAY"), and the winners after it.
Matching is by name, folded (accents, case, "Jr."), with a fallback of first initial and last name; nothing here guesses."""
import json, re, unicodedata, urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
URL = "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates={}-{}"


def fold(name):
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(jr|sr|ii|iii)\b\.?", "", s)
    return re.sub(r"[^a-z ]+", "", s.replace("-", " ")).split()


def same(a, b):
    """Two spellings of one fighter: the same folded name, or the same last name and first initial."""
    x, y = fold(a), fold(b)
    if not x or not y: return False
    return x == y or (x[-1] == y[-1] and x[0][0] == y[0][0] and len(x[-1]) > 2)


def events(now=None, back=4, ahead=8):
    """Events from `back` days ago to `ahead` days on: [{id, name, when (UTC datetime), day (ET date), done, bouts:
    [{fighters: [name, name], winner: name or None, record: {name: "12-3-0"}}]}]."""
    now = now or datetime.now(timezone.utc)
    a, b = (now - timedelta(days=back)).strftime("%Y%m%d"), (now + timedelta(days=ahead)).strftime("%Y%m%d")
    req = urllib.request.Request(URL.format(a, b), headers={"User-Agent": "juantorresmi-site"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode("utf-8"))
    out = []
    for e in data.get("events", []):
        when = datetime.fromisoformat(e["date"].replace("Z", "+00:00"))
        bouts = []
        for c in e.get("competitions", []):
            people = [(x.get("athlete") or {}).get("displayName", "") for x in c.get("competitors", [])]
            win = next(((x.get("athlete") or {}).get("displayName") for x in c.get("competitors", []) if x.get("winner")), None)
            rec = {(x.get("athlete") or {}).get("displayName", ""): (x.get("records") or [{}])[0].get("summary") for x in c.get("competitors", [])}
            bouts.append({"fighters": [p for p in people if p], "winner": win, "record": rec})
        done = (e.get("status") or {}).get("type", {}).get("completed", False)
        out.append({"id": str(e["id"]), "name": e.get("name", ""), "short": e.get("shortName", ""), "when": when, "day": when.astimezone(ET).date(),
                    "done": done, "bouts": bouts})
    return out


def headline(e):
    """"Procházka vs. Stirling" from "UFC Fight Night: Procházka vs. Stirling", and "UFC Fight Night" / "UFC 335" before it."""
    head, _, main = e["name"].partition(":")
    return head.strip(), main.strip()


def cards_of(names, cards):
    """The shop's cards of these fighters, the dearest one of each, dearest first: [(fighter, card)]."""
    out = []
    for n in names:
        mine = [c for c in cards if c.get("player") and same(c["player"], n)]
        if mine: out.append((n, max(mine, key=lambda c: c.get("_worth", 0))))
    return sorted(out, key=lambda fc: fc[1].get("_worth", 0), reverse=True)


def day_word(e, today):
    """When the event is, said the way a fan would: TONIGHT, TOMORROW, or the weekday."""
    d = (e["day"] - today).days
    return "TONIGHT" if d <= 0 else "TOMORROW" if d == 1 else e["day"].strftime("%A").upper()
