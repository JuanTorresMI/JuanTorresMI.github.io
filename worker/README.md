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
