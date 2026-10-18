# Changelog

What changed on the site and why, newest first. Snapshot refreshes ("Refresh the live page
snapshots", twice a day) aren't listed; `git log` has every commit. Excluded from the Jekyll build
(`_config.yml`). Add an entry with each pull request that changes what a reader sees, how data is
collected, or what it costs to run.

## Open items

Things waiting on a decision or on Juan, so they aren't lost:

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
