# Changelog

What changed on the site and why, newest first. Snapshot refreshes ("Refresh the live page
snapshots", twice a day) aren't listed; `git log` has every commit. Excluded from the Jekyll build
(`_config.yml`). Add an entry with each pull request that changes what a reader sees, how data is
collected, or what it costs to run.

## Open items

Things waiting on a decision or on Juan, so they aren't lost:

- **Renew `GH_DISPATCH_TOKEN`** before it expires (set Oct 18, 2026; fine-grained, this repo only,
  Actions: read and write). Steps in worker/README.md, "Updating the pages". If it lapses, GitHub's
  backup schedule keeps the pages updating, hours late, and the button hides itself.
- **Two Oct 16 posts** (YouTube, border) still describe the old timing ("once an hour", "twice a
  day"); Juan's call whether to update them.

- **Write-up reasons.** The pork and fed cattle posts (Oct 17) describe the boards and their
  numbers only; per CLAUDE.md they need Juan's own reasons for building them.
- **Spanish cut names** (`_data/beef_cuts.json` `es`, `pork_name()` in `snapshot.py`) follow Mexican
  usage and would benefit from a native butcher-trade review.
- **`EIA_API_KEY`.** The Worker still uses EIA's shared `DEMO_KEY`, which once took 51 s to answer.
  A free key (eia.gov/opendata) set with `wrangler secret put EIA_API_KEY` makes diesel dependable.
- **Colorado and Western States cattle pages** appear automatically once each has 8 priced weeks in a
  year (Colorado's last cash price was Dec 2022, the Western States' Sep 2025).
- **More USDA boards** (Juan wants all of them): next are hogs (LM_HG217/218), lamb (LM_XL502) and cow
  beef (LM_XB405) from the keyless datamart, then MyMarketNews reports (terminal markets, eggs, grain).
  CLAUDE.md, "A new USDA board", is the checklist.

## 2026-10-18 — Every permanent record in the repository; the database only runs the site

- **Border readings archive in the repository**: `border-waits/border-truck-wait-readings-2026.csv`, every
  reading since Sep 13 (15,396), each marked `worker` (1,874, caught by this site's Worker) or `archive`
  (13,522, the one-time backfill). `snapshot.py` adds the Worker's buffer on each run, never rewrites a kept
  reading, and computes every crossing's 30-day averages and 7-day chart from the files: identical to what
  the Worker's SQL gave (checked cell by cell, rounding included). The Worker's `/border/port` is gone
  (one request per run instead of 53); `/border/readings` serves the buffer, which is trimmed to 14 days at
  04:17 UTC daily.
- **CBP's published averages kept**: `border-waits/cbp-published-averages.csv`, all 12 months for every
  crossing CBP has them for (64,651 figures), refreshed when CBP changes them, to check the board's own
  readings against. CBP's weekday 0 is Monday (checked against the World Trade Bridge's weekend hours).
- **YouTube days** kept in `youtube/youtube-channel-daily.csv`; the Worker keeps 40 days.
- **Usage page**: tables always drawn and filled from the Worker (it showed nothing without its copy), a
  permanent `worker-usage/worker-usage-daily.csv` (Cloudflare keeps 30 days), typical and slowest CPU shown
  apart, empty days left out; a missing copy now fails `check.py`.
- Downloads on the border board for all three files; docs say where each record lives.

## 2026-10-18 — Worker usage page

- **`/worker-usage/`**, a project of its own: today's use of Cloudflare's free plan, used and available, against each limit (Worker requests, CPU
  per run, D1 rows read and written, storage) and the last 30 days, plus what runs when. The Worker reads
  Cloudflare's GraphQL Analytics hourly with a read-only token (`worker/src/usage.js`, table
  `usage_latest`, route `/usage`); the snapshot copies it into the page. Linked from the border and
  YouTube pages.

## 2026-10-18 — Border history back to Sep 13; a date bug that would have stopped it

- **CBP keeps no past readings** (checked: its feed shows the latest reading per port, and its
  historical API is last year's monthly averages by weekday and hour). So the Worker stays the
  record, unlike the USDA boards. An independent public archive, github.com/gptcbp/border-crossing-data,
  saved CBP's whole feed about hourly from Sep 13; `scripts/border-backfill.mjs` runs its 670 snapshots
  through the Worker's own parser and added 13,522 readings (D1 `border_waits`: 1,859 to 15,381; 49
  ports). Where both have a reading, they agree on 523 of 530; the archive has gaps of a few hours on
  some days, so those weeks rest on fewer readings. Credited on the board, the Spanish list and every
  crossing page.
- **Bug fixed:** the Worker read CBP's date as `MM/DD/YYYY`, but CBP writes `10/1/2026`. Every reading
  from the 1st to the 9th of a month, and all of January to September, would have been dropped, so the
  history would have stopped on Nov 1. The parser takes one- or two-digit months and days now.

## 2026-10-18 — Worker timed to the reports

- **Beef and pork checks only when USDA can post**: weekdays 1:30 to 6 pm Central, stopping once the
  day's report is stored, and 6 to 8 am for corrections (`lmrWindow()` in `worker/src/index.js`). About
  8 checks a weekday, down from 28.
- **The pages rebuild when the reports arrive.** Storing a new or corrected report starts the snapshot
  (`pagesTick()`); in the afternoon it waits for both beef and pork (one rebuild for both) or 6 pm,
  and a report stored during the cooldown waits as `refresh_pending`. New prices reach the pages about
  half an hour after USDA posts them, instead of hours.
- **One fixed start a day**, 11:47 UTC, for the border averages, the YouTube and TV copies and the
  weekly cattle and reefer reports; weekends get only that one. GitHub's backup schedule moved to
  13:41 UTC daily and 23:41 on weekdays, still stepping aside when a snapshot ran in the last six hours.
- **YouTube polled every three hours** instead of hourly (24 API units a day instead of 72); page
  wording, project card and share picture updated.

## 2026-10-18 — The Worker starts the page updates; an "Update now" button

- **Why the pages fell behind.** The `Snapshot live pages` workflow ran on GitHub's schedule, and
  GitHub ran every one of its runs 1.5 to 5 hours late (09:41 UTC runs started 13:10-14:23, 21:41 runs
  23:24-23:52) and can drop one. The Worker's data was current the whole time.
- **The Worker now starts it** (`worker/src/refresh.js`) at 09:47 and 21:47 UTC, from its cron, which
  runs on the minute. GitHub's schedule moved to 11:41 and 23:41 UTC as a backup that does nothing
  when a snapshot ran in the six hours before it.
- **"Update now" button** under the stamp of the border, reefer, beef, pork, fed cattle and hub boards,
  English and Spanish (`_includes/update-button.html`): starts the same workflow, with one global
  cooldown of an hour, and says when the next update can be asked for. Hidden until the Worker has
  its `GH_DISPATCH_TOKEN`.
- IndexNow is sent only pages whose `<lastmod>` changed since the sitemap that was live before the
  deploy (`indexnow.py --since`), not every page dated today or yesterday on each deploy.
- Briefly (PR #55) the snapshot ran every three hours; reverted to twice a day, which is enough once
  it runs on time.

## 2026-10-18 — Worker tuning

- The beef and pork report checks run only on weekdays, 6 am to 8 pm Central (`lmrHours()` in
  `worker/src/index.js`), the hours USDA posts and corrects them: 28 checks a weekday instead of 48
  every day, about 58% fewer calls to USDA. Nothing a visitor sees changes: reports still show up
  within half an hour, and the border, YouTube and TV polling is untouched.
- Outside those hours `/beef` and `/pork` stay an hour in the edge cache instead of ten minutes, so
  a stale page's question is answered without reading D1.
- Tested locally with `wrangler dev --test-scheduled` (the window's edges, a cron run, the routes), then
  deployed; every live route checked.

## 2026-10-18 — SEO, bug and speed passes

- **SEO** (audit of all 797 sitemap pages, beyond check.py): 30 pork search titles over 65
  characters now use the trade's shorter words where needed (`pork_seo_short()`), none duplicated;
  every description is 160 characters or less and `check.py` warns past 160; item pages carry
  four-level breadcrumbs (Home, the USDA hub, the board, the item), and the reefer board joins the
  hub. Canonicals, hreflang pairs, og tags, one h1 per page, heading order, Dataset fields, internal
  links and orphans all came back clean.
- **Speed**: the data boards preload IBM Plex Mono, the font their figures are set in
  (`_data/board_paths.yml` lists the board addresses).
- **Bugs**: the cattle snapshot's recent window reaches 60 days back instead of stopping at
  January 1, so late-December corrections aren't missed; a pork item USDA adds is written into
  `_data/pork_cuts.json` in its one-line-per-item layout instead of reformatting the file.

## 2026-10-18 — Docs and performance pass

- **Reefer snapshot timeouts fixed.** The Worker waited for EIA's diesel (51 s on the demo key)
  before answering, so the snapshot's 30 s timeout dropped the reefer update. Diesel now runs beside
  USDA with a 20 s cutoff (`DIESEL_TIMEOUT_MS` in `worker/src/reefer.js`), and `snapshot.py`'s `get()`
  waits 90 s and retries once on a timeout or a 5xx. Worker redeployed.
- **Pork downloads 31% smaller** (29 MB to 20 MB): the yearly CSVs keep the English name only, and
  `pork-prices/pork-cut-names.csv` holds every item's English and Spanish name and pages once.
- **Fed cattle snapshot asks less of USDA**: only the weeks since 45 days before each region's newest
  row, not the whole year, and the six regions in LM_CT154's table share one request (`lmr()` is
  memoized). A run of the beef, pork, cattle and reefer jobs takes about 20 s.
- Docs brought up to date: README (data flow, archive, structured data, hreflang), CLAUDE.md (how
  USDA sources differ from polled ones, the hub, a checklist for a new USDA board, the Liquid comment
  trap, why boards have no `last_modified_at`), worker/README (routes, crons, the free-plan audit at
  today's numbers, the diesel timeout). This changelog added.

## 2026-10-17 — Pork, fed cattle, Spanish boards and the USDA hub

- **Pork board** (`/pork-prices/`, LM_PK602): cutout, six primals and 156 cut pages, daily since
  2020. `pork_name()` names USDA's 270 item codes in English and Spanish from their parts; new items
  are named and kept in `_data/pork_cuts.json`. Worker route `/pork` with one stored row.
- **Fed cattle board** (`/fed-cattle-prices/`, LM_CT150, CT154, CT156–158, CT100): 5-area weekly and
  daily prices, 8 region pages (the Eastern Cornbelt covers Michigan), class and grade detail, and a
  "sell live or in the beef" calculator. No Worker.
- **Spanish twins** for every beef, pork and cattle board and item page (`/es/precios-de-carne-de-res/`,
  `/es/precios-de-cerdo/`, `/es/precios-de-ganado-gordo/`), paired with hreflang. Each board is one
  include rendered in either language; the tools and live scripts speak both.
- **USDA hub** (`/usda-market-prices/`, `/es/precios-usda/`): the parent project, a `DataCatalog`.
- Three projects added to `projects.yml`, with share pictures; two write-ups.
- Bug pass: Spanish price check grammar and dates, calculator prices for regions with no trade this
  week, board sitemap dates driven by their data, include tags removed from template comments.
- Earlier the same day: board tools (fuel surcharge, rate per mile and per case, when to cross,
  nearby crossings, find a cut, budget a buy, check a price, cost after trimming); the beef and
  reefer histories moved out of D1 to USDA's own archive (the Worker keeps one beef row; reefer and
  diesel are asked of USDA and EIA on request); phone layout fixes.

## 2026-10-16 — Boxed beef board and a site sweep

- **Boxed beef board** (`/beef-prices/`, LM_XB403): cutout, primals and 58 cut pages with daily
  history since 2020, CSVs and `latest.json`. Write-up posted.
- Write-ups for the reefer board, the border board and the YouTube page.
- Site sweep: shorter search titles, sized thumbnails, stricter `check.py`, docs rewritten, the CI
  build kept as an artifact.

## 2026-10-15 — Border wait board and Spanish crossings

- **Border truck waits** (`/border-waits/`): CBP's commercial lanes now and by hour, a page per
  major crossing, Spanish pages for the Mexico crossings, CBP's year-ago averages.
- SEO pass: search titles, crossing Q&A, lane links, IndexNow. Snapshot runs twice a day.

## 2026-10-14 — Reefer board, YouTube page, page families

- **Reefer rate board** (`/reefer-rates/`): USDA's weekly truck rates, a page per lane.
- **YouTube page** with live channel stats from the Worker.
- Every page given its family's design on one palette; versioned stylesheet and script addresses;
  Worker-backed pages prerendered; sitemap dates made real. Search Console verified.
- Craft Ledger fix (an apostrophe stopped the app); the Kalista Spike Ranker project removed.
