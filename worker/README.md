# house-tv

The little service behind [/watching/](../watching.html). It holds the Stremio auth key,
asks Stremio what the TV has been doing, and returns the handful of fields the page draws.

The page cannot talk to Stremio directly: a Stremio `authKey` is full account access, and
anything in a public page is readable by everyone. The key lives here as a Cloudflare
secret instead, and the Worker only ever *reads*.

Cost is nothing. Cloudflare's free plan allows 100,000 requests a day; a browser tab left
open around the clock polling every 40 seconds uses about 2,200.

## Setting it up

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
should see JSON. Put that URL in `_config.yml` as `worker_url`; the site reads it from there
for both the TV board and the blog's Substack feed.

### 3. Check it

```powershell
Invoke-RestMethod "https://house-tv.<your-subdomain>.workers.dev" | ConvertTo-Json -Depth 4
```

- `{"error":"Couldn't reach Stremio: Session does not exist"}` — the key is wrong or expired, redo step 1.
- `"now": null` with a populated `lately` — working; nothing is playing this second.

## Knobs

`LIVE_WINDOW_MIN` in `wrangler.toml` (default 5) decides how recently Stremio must have
synced for something to count as playing *now* rather than merely recent. Stremio decides
when to sync, not us, so this is the dial to turn if the live tile feels too eager or too
shy. Change it and run `npx.cmd wrangler deploy` again.

## Rotating the key

Sign out of Stremio everywhere, then redo step 1 and `npx.cmd wrangler secret put STREMIO_AUTH_KEY`.

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

`d1 create` prints a `database_id`. Paste it into `wrangler.toml` in place of
`PASTE-FROM-wrangler-d1-create`, then:

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
