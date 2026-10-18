# The site's Worker (`house-tv`)

One small Cloudflare Worker answers everything the site can't fetch from a browser itself:
Stremio and YouTube need keys that must never be public, USDA wants a key too, and Substack's
feed and CBP's wait times have no CORS headers. It is read-only toward every outside service,
holds its keys as Cloudflare secrets, and runs on the free plan. It is not part of the Jekyll
build (`_config.yml` excludes this folder); the site finds it through `worker_url` there.

It started as the house TV board, hence the name. It is served from
`https://house-tv.5342543fsd.workers.dev`, and deployed by hand from this folder:

```powershell
npx.cmd wrangler deploy
```

## At a glance

| Route | What it returns | Read by | Code |
| --- | --- | --- | --- |
| `GET /` | The house TV: what's on, lately, the shelf, the tally | `/watching/` (every 40 s while visible), `snapshot.py` | `src/index.js` |
| `GET /substack` | The newsletter's latest posts as JSON | `/blog/` | `src/index.js` |
| `GET /youtube` | The channel's numbers, uploads and daily history | `/youtube/`, `snapshot.py` | `src/youtube.js` |
| `GET /reefer`, `/reefer?week=YYYY-MM-DD` | USDA reefer truck rates for the newest (or any) week, plus two years of diesel | `snapshot.py` only | `src/reefer.js` |
| `GET /border`, `/border/port?id=P` | CBP truck waits now; one port by weekday and hour | border pages ("right now"), `snapshot.py` | `src/border.js` |
| `GET /beef` | USDA's newest boxed beef report: the cutout and every cut's price | the beef pages, when their copy is behind | `src/beef.js` |
| `GET /pork` | USDA's newest pork report: the carcass cutout, primals and every cut | the pork pages, when their copy is behind | `src/pork.js` |
| `GET /music`, `/music/visits`, `/music/guestbook` (+ `POST`, `DELETE /music/guestbook/<id>`) | Yokonjuan's catalog, visitor counter, guestbook | `/music/` | `src/music.js` |

**Cron triggers** (`wrangler.toml`): at :17 and :47 every hour it reads CBP's border waits; on
weekdays from 6 am to 8 pm Central (`lmrHours` in `src/index.js`) it also checks for a new boxed beef and pork report, the only hours USDA posts or corrects
them; the :17 run also polls YouTube. The fed cattle board
needs nothing from the Worker: `snapshot.py` reads USDA's datamart directly. The reefer rates need no cron:
USDA keeps them, and the Worker asks on request.

**Secrets** (`npx.cmd wrangler secret put NAME`, never in the repo): `STREMIO_AUTH_KEY`,
`YOUTUBE_API_KEY`, `USDA_MMN_KEY`, `EIA_API_KEY` (optional), `GUESTBOOK_ADMIN_KEY`.

**Vars** (`[vars]` in `wrangler.toml`): `LIVE_WINDOW_MIN`, `GUESTBOOK_DAILY_MAX`,
`MODERATION_MODEL`, `WRITE_ORIGINS`, `YOUTUBE_CHANNEL`, and optionally `ALLOW_ORIGIN`.

**Storage**: one D1 database, `yokonjuan` (binding `DB`), whose tables are all in `schema.sql`:
`counters` and `guestbook` (music), `youtube_latest` and `youtube_daily`, `border_waits` and
`border_latest`, `beef_latest` and `pork_latest`. The reefer board stores nothing. The schema only ever adds
what's missing, so it is safe to run again. Workers AI (binding `AI`) checks guestbook posts.

The sections below set up and explain each part. The last one, on the free plan's limits, is
worth reading before changing anything that runs on a schedule.

## The house TV (/watching/)

`/watching/` shows what the TV downstairs is playing. The page cannot talk to Stremio directly:
a Stremio `authKey` is full account access, and anything in a public page is readable by
everyone. The key lives here as a Cloudflare secret instead, and the Worker only ever *reads*.

### 1. Get a Stremio auth key

Run this in PowerShell. It asks for the password without echoing it, keeps it out of shell
history, and prints only the key. `ConvertTo-Json` escapes the password properly, so
characters like `!` and `"` are safe.

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$email = Read-Host "Stremio email"
$sec = Read-Host "Stremio password" -AsSecureString
$pass = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
$body = @{ email = $email; password = $pass } | ConvertTo-Json
$pass = $null; $sec = $null
$r = Invoke-RestMethod -Uri "https://api.strem.io/api/login" -Method Post -ContentType "application/json" -Body $body
$body = $null
if ($r.error) { "ERROR: " + $r.error.message } else { $r.result.authKey }
```

It prints one long string. Treat it like a password: it is a standing session, good until
you sign out of Stremio everywhere — or until you change the Stremio password, which
invalidates it. Mint the key *after* any password change, never before.

Check it before storing it, so a bad key fails here rather than three steps later:

```powershell
$key = Read-Host "authKey"
$body = @{ authKey = $key; collection = "libraryItem"; all = $true } | ConvertTo-Json
$r = Invoke-RestMethod -Uri "https://api.strem.io/api/datastoreGet" -Method Post -ContentType "application/json" -Body $body
if ($r.error) { "BAD: " + $r.error.message } else { "OK - " + $r.result.Count + " items in the library" }
```

### 2. Deploy

Use `npx.cmd`, not `npx` — PowerShell's default execution policy refuses to load the
`npx.ps1` wrapper, while the `.cmd` launcher runs fine without changing any machine setting.

```powershell
npx.cmd wrangler login
npx.cmd wrangler secret put STREMIO_AUTH_KEY
npx.cmd wrangler deploy
```

`secret put` prompts for the key and stores it encrypted at Cloudflare. It is never written
to this repo — `wrangler.toml` holds no secrets, which is why it is safe to commit.

Deploy prints a URL like `https://house-tv.<your-subdomain>.workers.dev`. Open it: you
should see JSON. Put that URL in `_config.yml` as `worker_url`; every page that uses the Worker,
and `scripts/snapshot.py`, reads it from there.

### 3. Check it

```powershell
Invoke-RestMethod "https://house-tv.<your-subdomain>.workers.dev" | ConvertTo-Json -Depth 4
```

- `{"error":"Couldn't reach Stremio: Session does not exist"}` — the key is wrong or expired, redo step 1.
- `"now": null` with a populated `lately` — working; nothing is playing this second.

### Knobs

`LIVE_WINDOW_MIN` in `wrangler.toml` (default 5) decides how recently Stremio must have
synced for something to count as playing *now* rather than merely recent. Stremio decides
when to sync, not us, so this is the dial to turn if the live tile feels too eager or too
shy. Change it and run `npx.cmd wrangler deploy` again.

### Rotating the key

Sign out of Stremio everywhere, then redo step 1 and `npx.cmd wrangler secret put STREMIO_AUTH_KEY`.

### What it costs

Nothing. Cloudflare's free plan allows 100,000 requests a day; a browser tab left open and
visible around the clock, polling every 40 seconds, uses about 2,200. Stremio's answer is kept
for 25 seconds, so any number of viewers at once is one call to Stremio.

## The Substack feed (/blog/)

`GET /substack` reads the newsletter's RSS feed and returns its latest posts as JSON, cached for
half an hour. Nothing to set up: the feed is public, and the address is `SUBSTACK` in
`src/index.js`. The writing index merges these with the site's own posts and drops any title
that appears in both.

## The music page: catalog, counter, guestbook

The same Worker also serves Yokonjuan's page (`/music/` on the site); the code is
`src/music.js`. The catalog needs nothing set up: it reads SoundCloud's public RSS and
Spotify's public player data, so new releases show up within the hour. The visitor counter
and the guestbook need a small database (D1) and Workers AI, which checks guestbook posts
before they're stored. Both are free at this size.

### Setting it up (once)

From `worker/`, in PowerShell:

```powershell
npx.cmd wrangler login
npx.cmd wrangler d1 create yokonjuan
```

`d1 create` prints a `database_id`. Put it in `wrangler.toml` as the `database_id` under
`[[d1_databases]]` (the one there now is this site's database), then:

```powershell
npx.cmd wrangler d1 execute yokonjuan --remote --file=schema.sql
npx.cmd wrangler secret put GUESTBOOK_ADMIN_KEY
npx.cmd wrangler deploy
```

`secret put` asks for a key: make up a long random one and keep it in your password manager.
It's what lets you delete guestbook posts, and it never goes in this repo.

### What a post has to get past

Posts go up the moment they pass, and anything that fails is refused and never stored. In order,
cheapest first:

1. A hidden field only bots fill in.
2. No links, 280 characters at most.
3. The site-wide cap: 25 posts a day in total (`GUESTBOOK_DAILY_MAX` in `wrangler.toml`).
4. Per visitor: one post a minute, five a day.
5. A word list of slurs and direct attacks (`BLOCKED` in `src/music.js`, edit freely).
6. Posts that talk to the moderator ("ignore your instructions", "reply ALLOW") are refused
   before any model sees them.
7. A small model on Workers AI is asked whether the post is mean. It gets the post inside a
   randomly named tag with angle brackets neutralised, and only an answer of exactly ALLOW
   passes. If it can't be reached, the post is refused, not let through. It has its own cap of
   300 checks a day.

Posts are always shown as plain text, so nothing in one can run in a visitor's browser, and
they reach the database only as bound parameters, never pasted into SQL.

### What it costs

Nothing. The Worker, D1 and Workers AI are all on Cloudflare's free plan, and on that plan going
past a limit makes requests fail until the next day. It never bills, unless the account is
upgraded to Workers Paid. The caps above keep the guestbook far inside the limits (Workers AI's
free allowance is 10,000 neurons a day; D1's is 100,000 writes), so a flood of spam can't use
them up or knock over the TV page, which runs on the same Worker.

### Deleting a post

Each post has a number (`id` in `GET /music/guestbook`). To remove number 12:

```powershell
$key = Read-Host "Guestbook admin key" -AsSecureString
$k = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($key))
Invoke-RestMethod -Method Delete -Uri "https://house-tv.5342543fsd.workers.dev/music/guestbook/12" -Headers @{ Authorization = "Bearer $k" }
$k = $null
```

## The YouTube page

The same Worker feeds `/youtube/` on the site; the code is `src/youtube.js`. Once an hour a cron
trigger (`crons` in `wrangler.toml`) asks YouTube for the channel's public numbers and its latest
uploads, and stores the answer in D1. The page only ever reads that stored snapshot.

### Setting it up (once)

1. **Get an API key.** In the [Google Cloud console](https://console.cloud.google.com/), pick or
   create a project, enable **YouTube Data API v3** (APIs & Services > Library), then create an
   **API key** (APIs & Services > Credentials > Create credentials > API key). Edit the key and,
   under *API restrictions*, restrict it to YouTube Data API v3. Don't set an application
   restriction: the Worker calls from Cloudflare's servers, not from a website or an app.
   An API key reads public data only. It can't sign in as you or change anything on the channel.
2. **Name the channel.** Set `YOUTUBE_CHANNEL` in `wrangler.toml` to its handle (`"@name"`) or
   its channel id (`"UC..."`, from YouTube Studio > Settings > Channel > Advanced settings).
3. **Create the tables, store the key, deploy.** From `worker/`, in PowerShell:

```powershell
npx.cmd wrangler d1 execute yokonjuan --remote --file=schema.sql
npx.cmd wrangler secret put YOUTUBE_API_KEY
npx.cmd wrangler deploy
```

`schema.sql` is safe to run again: it only adds the two `youtube_` tables and leaves the music
page's tables alone.

If `d1 execute --file` fails with `Authentication error [code: 10000]` (the `--file` route goes
through D1's import API, which can refuse the token `wrangler login` gives you), send the same SQL
as a plain query instead:

```powershell
$sql = ((Get-Content schema.sql) -replace '--.*$', '') -join ' ' -replace '\s+', ' '
npx.cmd wrangler d1 execute yokonjuan --remote --command $sql
```

### Check it

```powershell
Invoke-RestMethod "https://house-tv.5342543fsd.workers.dev/youtube" | ConvertTo-Json -Depth 4
```

The very first request polls YouTube on the spot (nothing is stored yet); after that, the cron
does the polling. To see the cron's own runs, `npx.cmd wrangler tail` around 17 past the hour.

- `YouTube said: API key not valid` — the key was pasted wrong; `secret put` it again.
- `YouTube said: ... has not been used in project ... or it is disabled` — enable YouTube Data API v3 for the key's project.
- `YouTube has no channel @name` — check the handle in `wrangler.toml`, then deploy again.

### What it costs

Nothing. One poll is three API calls (`channels.list`, `playlistItems.list`, `videos.list`), one
quota unit each, so 72 units a day out of the free 10,000. Uploads from the clip farm draw on a
separate bucket, so this can't block them. On Cloudflare's side it is one cron run and two D1
writes an hour; the page's requests are served from the edge cache for five minutes at a time.

### What the numbers mean

- **Subscribers** is YouTube's public count, rounded to three significant figures (12,345 shows as
  12,300). If the channel hides its count, the page shows none.
- **History** is one row a day (`youtube_daily`), holding that day's last reading in UTC. The page
  uses it for "last 7 days" and "last 30 days"; those appear once there are enough days stored.
- **Short** means the upload is three minutes or less, YouTube's own limit for a Short.

## The reefer rate board

`/reefer-rates/` on the site is built from USDA AMS's Specialty Crops National Truck Rate Report
(report 2375), read through the MyMarketNews API, plus EIA's weekly U.S. retail diesel price. The
code is `src/reefer.js`.

**This Worker stores none of it.** USDA and EIA keep every week and serve any of it, so the Worker
only holds the USDA key (which must never reach a browser or the repo) and asks on request:

- `GET /reefer` is the newest report, its quotes boiled down to lanes, plus the last 104 weeks of
  diesel. Cached an hour at the edge. EIA can be slow on the shared `DEMO_KEY` (51 seconds once, on
  Oct 18, 2026, which made the snapshot time out), so the diesel request runs beside USDA's and
  is cut off after 20 seconds (`DIESEL_TIMEOUT_MS`); the answer then has an empty `diesel` and the
  site keeps its last figures. With your own `EIA_API_KEY` this rarely happens.
- `GET /reefer?week=2026-10-05` is any week, by the Monday it covers. Cached six hours.

The site has no script for this page: the `Snapshot live pages` GitHub Action reads its committed
CSV back every three hours and asks here only for the weeks it doesn't settle, normally the newest and
the four before it (USDA sometimes corrects a report). The CSV is the long-term record, filled once
from USDA back to January 2020 (`REEFER_FILL=1 python3 scripts/snapshot.py reefer`).

### Setting it up (once)

1. **Get a MyMarketNews key.** Free, from [mymarketnews.ams.usda.gov](https://mymarketnews.ams.usda.gov/)
   (sign up and request an API key from your account). It reads public reports only.
2. **Optionally, an EIA key**, free from [eia.gov/opendata](https://www.eia.gov/opendata/register.php).
   Without one the Worker uses api.data.gov's shared `DEMO_KEY`, which works but is rate limited
   across everyone who uses it.
3. **Store the keys and deploy.** From `worker/`, in PowerShell:

```powershell
npx.cmd wrangler secret put USDA_MMN_KEY
npx.cmd wrangler secret put EIA_API_KEY      # optional
npx.cmd wrangler deploy
```

(The first version of this board kept a history in D1, in `reefer_quotes`, `diesel_weekly` and
`reefer_meta`, and backfilled it a week an hour; those were dropped on Oct 17, 2026.)

### Check it

```powershell
Invoke-RestMethod "https://house-tv.5342543fsd.workers.dev/reefer" | Select-Object latest, published
Invoke-RestMethod "https://house-tv.5342543fsd.workers.dev/reefer?week=2025-06-02" | Select-Object latest
```

- `USDA said: status 401` or `403` — the key is wrong; `secret put` it again.
- `diesel` empty — EIA didn't answer (with the shared demo key, `status 429` means it's busy). The
  site keeps its last diesel figures; add your own `EIA_API_KEY` if it happens often. Rates are unaffected.

### What the numbers mean

- USDA reports one row per shipping district, destination city and **commodity**, and repeats each
  rate for every commodity it covers. The Worker returns each distinct rate once, with the
  commodities it was listed for. **Quote 0** is the rate covering the most commodities, the lane's
  main rate; **quote 1+** is a separate rate a district gave for some crops that week (often citrus).
  Lane history and the CSV use quote 0.
- Rates are whole dollars per load, broker fees included. A range USDA left out is `null`, never 0.
- `latest` is the Monday the report covers; USDA publishes it on the Wednesday after.

### What it costs

Nothing, and nothing stored. The snapshot makes about six requests a run, eight runs a day, and each one
is a USDA call (one week is about 700 rows, a few milliseconds to boil down) or an edge-cache hit.

## The border wait board

`/border-waits/` on the site, and a page per major commercial crossing, come from CBP's public
[Border Wait Times](https://bwt.cbp.gov/) feed; the code is `src/border.js`. No key is needed.

Both cron triggers (:17 and :47) read the feed, so it is polled every half hour. Each port posts a
reading roughly once an hour, and a reading is stored once (`border_waits`, keyed on the port and
the time it was posted), however often it is asked for. The latest feed, trimmed to the ports with
commercial lanes, is kept whole in `border_latest` for the live board.

- `GET /border` — every commercial port right now. Cached five minutes at the edge; the board's
  script refreshes from it.
- `GET /border/port?id=230404` — one port's last 30 days averaged by weekday and hour, plus its
  last 7 days of readings. The snapshot (every three hours) reads this once per port; visitors never do.

### Setting it up (once)

```powershell
npx.cmd wrangler d1 execute yokonjuan --remote --file=schema.sql
npx.cmd wrangler deploy
```

`schema.sql` only adds `border_waits` and `border_latest`.

### Check it

```powershell
Invoke-RestMethod "https://house-tv.5342543fsd.workers.dev/border" | Select-Object -ExpandProperty ports | Select-Object -First 5
Invoke-RestMethod "https://house-tv.5342543fsd.workers.dev/border/port?id=230404"
```

The first request after a deploy reads CBP on the spot; after that the cron does.

### What the numbers mean

- Times are the port's own wall clock. CBP's feed already gives each port's date and time in local
  time, so nothing is converted (its zone labels are sometimes wrong, which no longer matters).
- A **closed lane, a pending update or "N/A" is `NULL`, never 0.** A wait of 0 means CBP said
  "no delay". NULLs drop out of every average, so a lane that is often closed isn't made to look fast.
- Hours a port is closed store nothing at all.

### What it costs

Nothing. CBP is asked 48 times a day. About 50 ports post about once an hour, so that is roughly
1,200 rows written a day, two D1 statements per run.

## The pork board

`/pork-prices/` works exactly like the beef board below, for USDA's National Daily Pork FOB Plant,
Negotiated Sales, afternoon (LM_PK602, report 2498): `src/pork.js` keeps one row, `pork_latest`,
the newest report, and the cron runs on weekdays from 6 am to 8 pm Central (`lmrHours` in `src/index.js`) call `porkTick` (a few-hundred-byte summary; the whole report,
about 150 KB, only when USDA has posted something new). `GET /pork` serves it to
`pork-prices/live.js`. The history is USDA's, read by `scripts/snapshot.py`. The fed cattle board
needs nothing from the Worker.

## The boxed beef board

`/beef-prices/` on the site, and a page per cut, come from USDA's National Daily Boxed Beef Cutout
and Boxed Beef Cuts, Negotiated Sales, afternoon edition (LM_XB403, report 2453), read from the
Livestock Mandatory Reporting datamart (`mpr.datamart.ams.usda.gov`). No key is needed. The code is
`src/beef.js`.

**This Worker keeps no beef history.** USDA keeps every report and serves any date range, so a
second copy would only cost writes and storage: `scripts/snapshot.py` reads the history from the
site's committed CSVs and asks USDA directly for the months they don't settle. The Worker keeps one
row, `beef_latest`: the newest report. The cron runs (:17 and :47) on weekdays from 6 am to 8 pm Central (`lmrHours` in `src/index.js`) ask USDA for the newest report's
summary, a few hundred bytes, and only when there is a report it hasn't stored (or a correction) fetch
the whole thing with `allSections=true`, about 110 KB, and replace the row. The board's page script
(`beef-prices/live.js`) reads `GET /beef` only when a page's copy is older than a report that should
be out, so a report shows on the site within about half an hour of USDA posting it, hours before the
evening rebuild.

### Setting it up (once)

```powershell
npx.cmd wrangler d1 execute yokonjuan --remote --file=schema.sql
npx.cmd wrangler deploy
```

`schema.sql` only adds `beef_latest`. (The first version of this board kept a history here, in
`beef_days`, `beef_items` and `beef_meta`; those were dropped on Oct 17, 2026.)

### Check it

```powershell
Invoke-RestMethod "https://house-tv.5342543fsd.workers.dev/beef" | Select-Object latest, published, stored
```

`latest` is the newest report's date; `stored` is when this Worker saw it. `npx.cmd wrangler tail`
around :17 or :47 shows each run.

### What the numbers mean

- Prices are dollars per hundredweight (100 lb), FOB the plant, delivery within 0 to 21 days. The
  cutout values are for 600 to 900 lb carcasses; a primal's value is per hundredweight of the primal.
- `items` holds one entry per item and grade. `section` says which table of the report it came from:
  `primal`, `cut` (Choice and Select), `mixed` (sold without a grade), `ground`, `blended` or `trim`.
  `item` is USDA's description with runs of spaces made one; the site maps it to a plain name and page
  address in `_data/beef_cuts.json`.
- A cut that didn't trade is printed by USDA as $0.00 with no trades. That is unknown, not free, so it
  is left out. Trades or pounds USDA kept confidential are `null`.

### What it costs

Nothing. USDA is asked 28 times a weekday for a few hundred bytes (none at night or on weekends,
when no report can appear), plus one full report on business days. Outside those hours `/beef` and
`/pork` stay an hour at the edge instead of ten minutes, since the stored report can't change.
That is one row written a business day. Visitors reach the Worker only when a page's copy is behind,
which happens between USDA posting a report (mid-afternoon) and the next rebuild, at most three hours later.

## Staying inside the free plan

The limits that matter: 100,000 requests a day, 10 ms of CPU per request or cron run, 50 outside
fetches per run, five cron triggers per account, and D1's 5 million rows read and 100,000 written a
day, in a database of at most 500 MB. On the free plan a limit is never billed: past it, requests
fail until the next day (00:00 UTC), and every page falls back to the copy in its HTML.

Where it stands (`npx.cmd wrangler d1 info yokonjuan`, Oct 18, 2026, the first full day after the
beef and reefer histories moved out of D1):

| Limit | Free plan | In use | Headroom |
| --- | --- | --- | --- |
| Rows read a day | 5,000,000 | about 40,000 with the snapshot twice a day; at most about 160,000 with it every three hours (since Oct 18) | 31× or more |
| Rows written a day | 100,000 | about 2,500 | 40× |
| Database size | 500 MB | 160 KB | grows about 10 MB a year (border readings): decades |
| Cron triggers | 5 per account | 2 | 3 spare |
| Outside fetches per run | 50 | at most about 9 (CBP, YouTube, a beef and a pork summary, and a full report when one is new) | |
| Cron requests a day | | 48 (24 + 24); USDA is asked only on 28 of them, weekdays | |

Requests from visitors are the only number that scales with traffic, and only the pages with
something live ask: `/watching/` (every 40 s while visible), `/youtube/`, `/blog/`, `/music/` and
the border pages (once per view), and the beef and pork pages only in the hours their copy is
behind a new report. The fed cattle pages never call it. The reefer board and every lane page are plain HTML and never call the Worker, so a burst of
search traffic to them costs nothing here.

What keeps it there, so a later change doesn't undo it:

- **Pages that poll stop when hidden.** `/watching/` asks every 40 s only while its tab is visible;
  a background tab used to make 2,000+ requests a day. The border pages ask once per view.
- **The house TV keeps Stremio's answer for 25 s**, in the edge cache and in the Worker's memory,
  so a burst of viewers is one Stremio call.
- **No query reads a whole table on a schedule.** "Is anything stored?" is `SELECT 1 … LIMIT 1`,
  never `COUNT(*)`; `/border/port` counts only a port's last 30 days. A growing history must never
  make a run read more rows.
- **Many rows go in one statement** (`json_each`), never one statement per row: the free plan
  allows 50 queries per run.
- **Pages read the snapshot's copy (every three hours), not the Worker**, wherever the data changes slowly (reefer,
  beef, the border averages). Visitors only reach the Worker for "right now".
- **Don't keep what the source keeps.** USDA serves the whole truck rate and boxed beef history,
  and EIA the diesel history, so the Worker stores none of it (just the newest beef and pork
  reports, for the page scripts) and `snapshot.py` asks for only the weeks or months its CSVs don't settle. Logging a
  history here is for sources that only show "now" (CBP, YouTube's counts).
- **Ask only when the copy could be behind.** `beef-prices/live.js` (and `pork-prices/live.js`) works out whether a new report
  should be out before it asks, so a visit to a current page makes no request.
