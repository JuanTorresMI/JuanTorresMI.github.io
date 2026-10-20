# juantorresmi.github.io

The personal site of Juan Torres, a Logistics Management student at Central Michigan University:
a résumé, the projects he builds (simulations, planners and live freight data that all run in
the browser), his writing, and a few pages fed by live data. It also hosts Yokonjuan's music
page, which is kept deliberately separate from the rest.

Built with Jekyll and published by GitHub Pages from `main`. There is nothing to compile for an
ordinary edit: change a file, open a pull request, and the `Check the site` workflow builds it
exactly the way GitHub Pages will and checks the result. Merging deploys it.

**[CHANGELOG.md](CHANGELOG.md)** logs what changed and why, with the open items at the top.

**[CLAUDE.md](CLAUDE.md) is the working guide** for anyone (or any AI) changing the site: the
design rules, the page families, how to add a post, project or page, and what is the way it is
on purpose. This README is the overview.

## What's on the site

| Address | Page | Family | Built from |
| --- | --- | --- | --- |
| `/` | Home: business card, about, projects, work, contact | Professional | `_data/projects.yml`, `_data/resume.yml` |
| `/resume/` | Résumé, printable, with the PDF to download | Professional | `_data/resume.yml`, `assets/Juan Torres Resume.pdf` |
| `/projects/` | Every project as a card, plus a log of recent commits | Professional | `_data/projects.yml`, GitHub's API (in the browser) |
| `/blog/`, `/blog/<slug>/` | Writing: project write-ups here, newsletter posts from Substack | Personal | `_posts/`, Substack through the Worker |
| `/fruit-fly-dispatcher/` | A fruit fly's brain routing deliveries against Google OR-Tools | Work | `fruit-fly-dispatcher/` (run files load on demand) |
| `/craft-ledger.html` | Minecraft crafting profit calculator, with a guide below it | Gamer | One self-contained file; prices stay in the browser |
| `/aggregate-planning/` | Aggregate production planning optimizer and study tool | Work | `aggregate-planning/` (HiGHS solver in a Web Worker) |
| `/plain-solver/` | General optimization solver built from plain-English sentences (an Excel Solver alternative) | Work | `plain-solver/` (HiGHS plus its own nonlinear and evolutionary engines, in a Web Worker) |
| `/reefer-rates/`, `/reefer-rates/<lane>/` | USDA's weekly reefer truck rates, a page per lane | Work | `_data/live/reefer.json` |
| `/border-waits/`, `/border-waits/<crossing>/` | CBP truck waits at the land border, now and by hour | Work | `_data/live/border.json`, plus the Worker for "right now" |
| `/es/tiempos-de-espera/`, `…/<cruce>/` | The same for the Mexico crossings, in Spanish | Work | `_data/live/border.json` |
| `/beef-prices/`, `/beef-prices/<cut>/` | USDA's daily boxed beef cutout and the price of every cut, a page per cut | Work | `_data/live/beef.json` (history from USDA's own archive), plus the Worker for a report posted since the last rebuild |
| `/pork-prices/`, `/pork-prices/<cut>/` | USDA's daily pork cutout, the six primals and every pork cut, a page per cut | Work | `_data/live/pork.json` (from USDA's archive), plus the Worker's `/pork` for a report posted since the last rebuild |
| `/fed-cattle-prices/`, `/fed-cattle-prices/<region>/` | What packers pay for fed cattle each week, 5-area and by region, live and dressed | Work | `_data/live/cattle.json` (from USDA's archive; no Worker) |
| `/usda-market-prices/` | The parent of the four USDA boards | Work | the boards' snapshots |
| `/es/precios-de-carne-de-res/`, `/es/precios-de-cerdo/`, `/es/precios-de-ganado-gordo/`, `/es/precios-usda/` and every item under them | The same boards and pages in Spanish, paired with hreflang | Work | the same snapshots |
| `/youtube/` | The YouTube channel's numbers and uploads | Gamer | `_data/live/youtube.json`, refreshed live by the Worker |
| `/watching/` | What's on the house TV (public, but `noindex`) | Chill | `_data/live/watching.json`, refreshed live by the Worker |
| `/music/` | Yokonjuan, the music page (its own layout and look) | Separate | `_data/music.yml`, refreshed live by the Worker |

Plus `/feed.xml` (RSS), `/sitemap.xml`, `/robots.txt`, `/site.webmanifest`, a 404 page and a few
redirect stubs for addresses that moved (`redirects/`).

## How it fits together

```
                     ┌─ Stremio, YouTube, USDA (truck rates, newest beef and pork), EIA, CBP, Substack, SoundCloud, Spotify
                     │
Cloudflare Worker  ◄─┘  worker/: polls on cron triggers, holds short buffers in D1 (no permanent history), holds the keys
     │
     ├─► browsers: the live parts of /watching/, /youtube/, /blog/, /music/ and the border pages
     │
     └─► scripts/snapshot.py, at least once a day (Snapshot live pages workflow)
              │  also reads USDA's LMR datamart directly for the beef, pork and cattle history
              │  writes _data/live/*.json, the generated pages' stubs (both languages), CSVs; commits; starts a deploy
              ▼
         Jekyll on GitHub Pages ─► the site ─► scripts/indexnow.py pings Bing and others
```

Every page that shows live data also carries a copy of it in its HTML, so search engines and
readers without JavaScript see real numbers; the page's script then swaps in fresh ones. The
reefer and cattle boards have no live script at all: they are rebuilt from the copy. The reefer,
beef, pork and cattle CSVs double as the archive each snapshot reads back, so a week or a day once
collected is never lost, and USDA, which keeps every report, is asked only for the recent stretch;
the Worker stores only the newest beef and pork reports, for the pages' freshness check. The same goes for
the sources that keep no history: the border readings (CBP), the YouTube days and the Worker's own usage
are copied from the Worker's short buffers into CSVs here (`border-waits/`, `youtube/`, `worker-usage/`),
which are the permanent record; CBP's published averages are kept beside the border readings to check
them against.

### Published data addresses

These CSVs are pulled by URL, on a schedule, by the site's Kaggle datasets (and by anyone else's code).
**They never change:** no renaming, moving or deleting a file, and no renaming or reordering columns; new
columns go at the end. `scripts/check.py` (`PUBLISHED`) fails the build if one is missing or its header
changes. Each January adds a new `-YYYY.csv` beside last year's (add it to `PUBLISHED` and to Kaggle).

| Kaggle dataset | URLs (all `https://juantorresmi.github.io/…`) |
| --- | --- |
| USDA Boxed Beef Prices by Cut | `beef-prices/boxed-beef-cutout-daily.csv`, `beef-prices/boxed-beef-cut-prices-2020.csv` … `-2026.csv` |
| USDA Pork Cutout and Pork Cut Prices | `pork-prices/pork-cutout-daily.csv`, `pork-prices/pork-cut-prices-2020.csv` … `-2026.csv`, `pork-prices/pork-cut-names.csv` |
| USDA Fed Cattle Cash Prices | `fed-cattle-prices/fed-cattle-weekly.csv`, `fed-cattle-prices/fed-cattle-5-area-daily.csv` |
| USDA Refrigerated Truck Rates by Lane | `reefer-rates/usda-reefer-truck-rates.csv` |
| US Border Truck Wait Times (CBP) | `border-waits/border-truck-wait-readings-2026.csv`, `border-waits/border-truck-wait-times.csv`, `border-waits/cbp-published-averages.csv` |
| US Border Car and Pedestrian Wait Times (CBP), not on Kaggle yet | `border-waits/border-car-pedestrian-wait-readings-2026.csv`, `border-waits/border-car-pedestrian-wait-times.csv`, `border-waits/cbp-published-car-pedestrian-averages.csv` |

### Workflows (`.github/workflows/`)

| Workflow | When | What it does |
| --- | --- | --- |
| `jekyll-gh-pages.yml` (Deploy) | Every push to `main`, or when the snapshot starts it | Dates each page from git (`lastmod.py`), builds with GitHub Pages' Jekyll, publishes, then pings IndexNow |
| `check.yml` (Check the site) | Every pull request and every push to another branch | The same build, then `scripts/check.py` on the result; the build is kept as the run's `site` artifact for five days |
| `snapshot.yml` (Snapshot live pages) | 09:41 and 21:41 UTC daily, or by hand | Runs `snapshot.py`, commits only if something changed, then starts a deploy |

## Where things live

| Path | What it is |
| --- | --- |
| `_config.yml` | Name, tagline, description, social links, default share picture, Worker URL, collections, build excludes |
| `_data/` | `projects.yml`, `resume.yml`, `music.yml`, the border, reefer, beef and pork reference lists (`pork_cuts.json` grows on its own as USDA adds items), and `live/` (the snapshots, written by `snapshot.py`, never edited by hand) |
| `_includes/` | `head.html` (titles, meta tags, structured data, for every page), the nav, footer and project bar, the border heat map |
| `_layouts/` | `default` (ordinary pages), `post`, `app` (full-width projects), `tool` (the app layout: a top bar, a rail of the page's sections shown one at a time, an optional side panel; the planner, Craft Ledger and every data board use it, with `assets/css/app.css` and `assets/js/app-shell.js`), `solver` (Plain Solver's own app layout), `reefer-lane`, `border-crossing`, `beef-cut`, `pork-cut`, `cattle-region`, `artist` (the music page), `redirect` |
| `_posts/` | Writing published on this site (`/blog/<slug>/`) |
| `_reefer_lanes/`, `_border_crossings/`, `_border_crossings_es/`, `_beef_cuts/`, `_beef_cuts_es/`, `_pork_cuts/`, `_pork_cuts_es/`, `_cattle_regions/`, `_cattle_regions_es/` | Front-matter stubs, one per generated page, written by `snapshot.py` |
| `assets/` | `css/style.css` (the site's stylesheet; `css/app.css` and `js/app-shell.js` are the app layout's), self-hosted fonts, share pictures (`og/`), icons, the résumé PDF and its `.docx` source |
| `fruit-fly-dispatcher/`, `craft-ledger.html`, `aggregate-planning/`, `plain-solver/` | The browser projects |
| `reefer-rates/`, `border-waits/`, `es/`, `beef-prices/`, `pork-prices/`, `fed-cattle-prices/`, `usda-market-prices/` | The data boards' index pages and their CSV downloads. The beef, pork and cattle boards are one include each (`_includes/beef-board.html`, `pork-board.html`, `cattle-board.html`), rendered in English or Spanish |
| `music/` | The music page, its stylesheet, script, icon and share picture |
| `worker/` | The Cloudflare Worker; see [worker/README.md](worker/README.md) |
| `scripts/` | Build checks, the snapshot, and the image and screenshot generators (below) |
| `redirects/` | Stubs that send old addresses to new ones |

## Working locally

You need Ruby with Jekyll for a build, Python 3 for the scripts, and Node with Playwright only
for pictures.

```sh
gem install jekyll
jekyll serve                                   # http://localhost:4000
jekyll build && python3 scripts/check.py _site # what the PR check runs (python on Windows)
```

A plain local build uses a newer Jekyll than GitHub Pages does (3.10), so the pull request check
is the one that counts. Without Ruby, push a branch and download what the check built:
`gh run download <run id> -n site -D _site`, then run the screenshots on that. `check.py` needs only Python's standard library; it fails on unrendered
Liquid, broken structured data, missing titles, descriptions, canonicals or share pictures,
links and hreflang that point at nothing, images without alt text and a bad sitemap, feed or
manifest, and warns about duplicate titles or descriptions.

### Scripts

| Script | Run | What it does |
| --- | --- | --- |
| `check.py` | On every PR (and before you push) | Verifies a built site; see above |
| `screenshots.js` | By hand, for anything visual | Photographs one page of every kind at desktop and phone widths, light and dark, and reports script errors |
| `og-images.js` | After changing a share picture's words | Redraws `assets/og/*.png` and the home-screen icons from the site's fonts |
| `music-og.js` | After changing the music page's picture | Redraws `music/og.jpg` |
| `snapshot.py` | By the snapshot workflow | Copies the Worker's data (and USDA's, for beef, pork and cattle) into `_data/live/` and writes the generated pages' stubs and CSVs; `snapshot.py pork cattle` runs just those |
| `lastmod.py` | By the deploy and check workflows | Dates every page from git for the sitemap (`_data/lastmod.json`, never committed) |
| `indexnow.py` | By the deploy workflow | Tells IndexNow engines which pages changed since the last deploy |
| `border-backfill.mjs` | Once, by hand (done Oct 18, 2026) | Filled the border history from Sep 13 to Oct 14 from an independent archive of CBP's feed, through the Worker's own parser |
| `border-people-backfill.mjs` | By hand (done Oct 20, 2026; safe to re-run) | The same for the car and pedestrian lanes, written straight into `border-waits/border-car-pedestrian-wait-readings-YYYY.csv` |

```sh
# screenshots and share pictures need Playwright and its Chromium:
npm install -g playwright && npx playwright install chromium
NODE_PATH=$(npm root -g) node scripts/screenshots.js _site screenshots
NODE_PATH=$(npm root -g) node scripts/og-images.js
```

`snapshot.py` writes straight into the repo, so leave it to the workflow unless you mean to
commit what it fetches. `python3 scripts/snapshot.py beef` runs one source alone. Playwright can
use an installed Chrome or Edge instead of its own Chromium (`chromium.launch({ channel: "msedge" })`).

## Search and sharing

Every page goes through `_includes/head.html`, which writes its title, description, canonical
address, Open Graph and Twitter tags and schema.org structured data: a `Person`, `WebSite` and
`ProfilePage` on the home page, a `BlogPosting` for each post (linked to the project it writes
up), a `WebApplication` for each project, a `Dataset` for each data board and each beef cut, pork
cut, cattle region, reefer lane and border crossing (with `dateModified` and keywords), a
`DataCatalog` for the USDA hub, an `FAQPage` and a `HowTo` on Plain Solver (generated from its visible
guide) and an `FAQPage` on Craft Ledger, and breadcrumbs on every other page. In the app layout every
section is in the HTML and only hidden by script, so crawlers and readers without JavaScript get all
of it. The
sitemap and feed are written by hand, so no plugin is needed, and each sitemap date is only ever a
real change. The border pages and every USDA board and item page exist in English and Spanish and
point at each other with hreflang (each Spanish page sets `lang: es` and a `translation`). Search Console and Bing verify through `_config.yml`; IndexNow's key file
sits at the root.

## Secrets

None in this repository. The Worker's keys are Cloudflare secrets (see its README); the
analytics token, IndexNow key and search-console codes in `_config.yml` are public by design.
