# Working on this site

Personal site of Juan Torres, built with Jekyll and served by GitHub Pages from `main`.
Read this before changing anything. CHANGELOG.md logs every change worth knowing and the open
items; add an entry with each pull request that changes what readers see or how data is collected.
README.md is the overview for people: what each page is,
how the live data flows, the workflows and scripts.

## The shape of it

| Where | What |
| --- | --- |
| `_config.yml` | Name, tagline, description, social links, default share picture, Worker URL, collections and their defaults, build excludes |
| `_data/resume.yml` | The résumé. `/resume/` shows all of it; the home page shows each job's `summary` |
| `_data/projects.yml` | Every project, in display order, with its fields documented at the top. Feeds the home page, `/projects/`, the project bar and the JSON-LD |
| `_includes/head.html` | Title, description, canonical, hreflang, Open Graph / Twitter tags, structured data, fonts, the stylesheet. Every page but the music page goes through it |
| `_includes/navbar.html`, `footer.html`, `project-bar.html` | Site chrome. `border-heat.html` is the crossing pages' heat map |
| `_layouts/default.html` | Ordinary pages: content inside `<main class="page frame">` |
| `_layouts/post.html` | Writing. Adds date, reading time, tags, previous / next |
| `_layouts/app.html` | Full-width project pages: nav, project bar, the page's own markup, footer |
| `_layouts/tool.html`, `assets/css/app.css`, `assets/js/app-shell.js` | The app layout for project pages people use: a top bar, a rail of the page's sections (one at a time in `app_mode: views`, a contents list in `app_mode: read`), an optional side panel. Pages mark parts with `data-view` / `data-title` (and `data-n`, `data-order`, `data-rail-group`), `data-app-side`, `data-app-tools`; the layout's comment documents them. The data boards set `app_auto: true` instead: every top-level `section[id]` with an `h2` becomes a view, named from the board's jump links. So no page may use `data-view` for anything of its own (the reefer sheet's buttons use `data-sheet`). Each view change is a history entry (Back returns to the last view; page scripts that call `replaceState` pass `history.state` through) and the rail moves focus to the view's heading. Nothing is hidden without JavaScript |
| `_layouts/reefer-lane.html`, `border-crossing.html`, `beef-cut.html`, `pork-cut.html`, `cattle-region.html` | One generated page per reefer lane / border crossing / beef cut / pork cut / cattle region, each in English and Spanish where the board has both (see "Live data pages") |
| `_layouts/artist.html`, `music/`, `_data/music.yml` | Yokonjuan's page (`/music/`); see "The music page" |
| `_layouts/redirect.html`, `redirects/` | Old addresses that moved |
| `assets/css/style.css` | The only stylesheet for the portfolio. Fonts, tokens, grid, every component, print |
| `assets/fonts/` | Cormorant Garamond, Inter, IBM Plex Mono (latin woff2, self-hosted) |
| `assets/og/` | 1200×630 share pictures, drawn by `scripts/og-images.js` |
| `fruit-fly-dispatcher/` | The simulation: `index.html` (layout `app`, its own unscoped styles and copy of the tokens), `showcase-data.js`, `runs/*.js` (loaded on demand) |
| `craft-ledger.html` | The ledger: one file (styles, markup, recipe JSON, script) inside layout `app`, styles scoped under `.cl`. Below the app sits its guide (`#guide`, ordinary `.page` markup): what search engines and SMP players read. The old guide address redirects there |
| `aggregate-planning/` | The planner: `index.html` (layout `app`), `planner.css` (scoped under `.ap`), `model.js` (the LP/MIP; no DOM, runs in Node), `solver.js` + `solver-worker.js` (HiGHS in a Web Worker), `app.js`, `study.js` (study mode: the plan taken apart step by step; the worker's `explain()` does the extra solves), `xlsx.js` (the downloadable workbook, no library), `sw.js` (offline). `lib/` holds HiGHS and Chart.js, vendored unchanged |
| `plain-solver/` | The general solver: `index.html` (its own layout, `_layouts/solver.html`: a full-screen app with a top bar, a step rail, one screen per step and a plain-English summary; the guide at `#guide` below it), `solver.css` (scoped under `.ps`), `model.js` (the model JSON and everything that compiles it: expand, classify, LP writer, units, checks, the math; no DOM, runs in Node), `engines.js` (nonlinear and evolutionary engines), `solve.js` (one solve: routing, HiGHS, diagnosis, two-sided shadow prices, limits), `engine-worker.js` + `engine.js` (the Web Worker), `templates.js`, `blocks.js` (building blocks: fill-in-the-blank sentences that write a whole pattern, and combining models), `text.js` (the whole model as text, read and write), `excel.js` (the model as one Excel sheet with live formulas and Excel's own Solver model stored in it, as hidden `solver_*` names; `aggregate-planning/xlsx.js` writes them), `app.js` (the build-your-own flow, sentence builder, results, what-if, reports, imports; step 4's "The most profit" / "The lowest cost" lines are stored as two ordinary results, `moneyIn` and `moneyOut`, and read back from them). The guide's FAQ and four questions are also its `FAQPage` and `HowTo` JSON-LD: change the visible text and the JSON-LD together. It uses the planner's HiGHS (`aggregate-planning/lib`) and `.xlsx` writer, so changing either changes both. Tests: `node scripts/plain-solver-test.js` (the CI runs them) `scripts/plain-solver-page-test.js` (Playwright, clicks through the page at phone and desktop widths), and `scripts/plain-solver-excel-check.js` + `.ps1` (on Windows with Excel: opens every exported workbook, runs its Solver, compares answers) |
| `reefer-rates/`, `border-waits/`, `es/tiempos-de-espera/`, `beef-prices/`, `pork-prices/`, `fed-cattle-prices/`, `usda-market-prices/`, `es/precios-*/` | The data boards' index pages, their CSVs and scripts (see "Live data pages"). The beef, pork and cattle boards are each one include (`_includes/beef-board.html`, `pork-board.html`, `cattle-board.html`) that the English and Spanish index pages both render; `usda-hub.html` is the parent page; `price-chart`, `price-grid`, `price-season`, `cut-tools`, `cattle-detail`, `cattle-calc` and `usda-boards` are their shared parts |
| `worker/` | The Cloudflare Worker behind every live page. Not part of the Jekyll build; its README lists its routes, crons, secrets and tables |
| `scripts/` | `check.py` (verifies a build), `screenshots.js` (visual pass), `og-images.js` and `music-og.js` (share pictures), `snapshot.py` (Worker data → `_data/live/`), `lastmod.py` (git dates for the sitemap), `indexnow.py` (pings Bing and other IndexNow engines after each deploy), `border-backfill.mjs` (one-off: border history from before the Worker, from an archive of CBP's feed) |
| `data/`, `_data/datasets.json`, `scripts/datasets.py` | The open datasets: USDA datamart reports archived as published (hogs, sows, cow beef, trimmings, lamb, dairy, comprehensive reports), one CSV per table from 2020, listed on `/data/` (the catalog of every published CSV, boards' too). The boards' own CSVs stay at their board's address (published, never moved); `datasets.json` lists them under `boards` and `datasets.py` counts their rows and dates, so `/data/` shows every file the same way, and every board's download section links to its entry there. `/data/` is also a card on `/projects/` (group `data`). A new dataset is an entry in `datasets.json`; the snapshot workflow runs `datasets.py` after the boards, paced (1.5 s a request, 450 a run, stops on a 403: parallel requests got a 403 for hours). `check.py` treats every file `_data/live/datasets.json` lists as published |
| `_data/live/` | Daily copies of the Worker's answers, already formatted. Written by `snapshot.py` from the `Snapshot live pages` workflow, which commits them and starts a deploy. The Worker starts that workflow (every morning at 11:47 UTC, when it stores a new beef or pork report, and from the boards' "Update now" button; at most once an hour; `worker/src/refresh.js`), because GitHub's own schedule runs hours late; that schedule is only the backup. Don't edit these files by hand |

## Before you push

```sh
jekyll build && python3 scripts/check.py _site
```

`check.py` fails on unrendered Liquid, broken JSON-LD, a page missing its title, description,
canonical or share image, an internal link, canonical or hreflang that points at nothing, an
hreflang pair that only points one way, an `<img>` without `alt`, and a bad sitemap, feed or
manifest. It warns on description lengths, duplicate titles or descriptions, and indexable pages
without exactly one `<h1>`. The `Check the site` workflow runs the same thing on every pull
request with the exact Jekyll GitHub Pages uses (the `github-pages` gem, Jekyll 3.10). Stay
inside what that build supports: no plugins beyond the GitHub Pages allowlist, and only the
Liquid filters Jekyll 3.10 has. There is no Gemfile on purpose: one would make `jekyll build`
insist on `bundle exec`.

For anything visual, also run `scripts/screenshots.js` and look at the pictures. On the web,
the session hook in `.claude/hooks/` installs Jekyll; Playwright is only there if the container
has it. Without Jekyll (a Windows machine with no Ruby, say), push a branch and let the
`Check the site` workflow build it; it keeps the build as the run's `site` artifact
(`gh run download <run id> -n site -D _site`), so the screenshots can still run on the real thing.
Playwright can drive an installed Edge or Chrome (`channel: "msedge"`) instead of downloading Chromium.

## Design rules

The look is stationery: bone and eggshell stock, near-black ink, one steel accent for links
and focus, no rounded corners, no fills except the one primary button. Cormorant Garamond
sets names and titles, Inter carries text and the spaced uppercase labels, IBM Plex Mono holds
dates and figures. Spacing steps are multiples of 8.

- Colors and fonts come from the tokens at the top of `style.css`. Never write a hex color in
  a page or a component rule; add a token if one is missing. Dark mode is the same tokens
  redefined, once for `prefers-color-scheme`, once for `[data-theme="dark"]` and once as
  `.stock-night` (the dark stock that gamer and chill pages pin with `stock: night` in front
  matter): keep the three identical. The Fruit Fly Dispatcher keeps its own copy of the
  neutrals and type tokens in its page; keep that in step too.
- Pages sit on the 12-column grid: `.row` with `.key` (columns 1–3) and `.body` (4–12). The
  one list pattern is `.entries` / `.entry`; use it before inventing another.
- Components for ordinary pages are scoped under `.page` so they never leak into the project
  pages. A project page brings its own classes, scoped under a root class of its own (`.cl` for
  the ledger); it may use the tokens.
- Keep `.label` (11px, 0.16em tracking, uppercase) and `.data` (mono, 12px) for the small type.
- The business card, the résumé card, the featured project and the writing letter share one
  "raised stock" shadow in `style.css`; a new raised surface joins that rule.
- The project pages people use are the deliberate exception to the stationery look: Juan asked for them
  to be as friendly as possible. Plain Solver has its own app layout (`_layouts/solver.html`); the others
  use `_layouts/tool.html`. Both: Inter throughout, rounded cards and fields, pill buttons, the site's
  color tokens (and so dark mode and night stock), a link home. A page's own stylesheet adapts its insides
  under its root class (the planner's `.ap-in-app` block, for example).
- Pages are not all one layout. Each belongs to a family and takes that family's form while
  keeping the tokens, fonts, square corners and nav. Put the family label (`.family`, or
  `.rb-family` on the boards) above each page title, and give a project its `family` in
  `projects.yml` (its card takes that stock).

| Family | Form | Pages (root class) |
| --- | --- | --- |
| **Work** | A dense rate sheet or control panel, mono figures | Reefer board (`.rb`), border waits (`.rb .bw`), beef prices (`.rb .bf`), planner (`.ap`), Fruit Fly Dispatcher |
| **Professional** | The raised eggshell card | Home, résumé (`.cv`), projects (`.pj`) |
| **Gamer** | Night stock, 2px HUD frames, mono labels, slot grids | YouTube (`.yt`), Craft Ledger's gamer layer (`.cl`) |
| **Chill** | Night stock, italic serif, posters, lots of air | The house TV (`.tv`) |
| **Personal** | A letter, serif reading text | Writing (`.wr`) and the posts |

Gamer and chill pages set `stock: night`.

## Live data pages

Some pages show data the Worker collects (`worker/`, see its README). The pattern is always
the same: a source that only shows "now" (CBP, YouTube's counts, the TV) is polled by the Worker,
which keeps its history in D1; a source that keeps its own history (USDA, EIA) is read straight from
it, and the committed CSVs are the archive. Either way `snapshot.py` writes `_data/live/<name>.json`,
already formatted (Liquid on GitHub Pages can't format
numbers or dates); the page renders that copy into its HTML, so crawlers and readers without
JavaScript get real content; and, where it matters, a page script swaps in fresh numbers.

**Where data lives:** every permanent record is a file in this repository, written by `snapshot.py`
(the USDA boards' CSVs, the border readings and CBP's published averages, `youtube/youtube-channel-daily.csv`,
`worker-usage/worker-usage-daily.csv`). The Worker's D1 database holds only what the Worker needs to run
the site between snapshots: the newest report or reading of each kind, short buffers (border 14 days,
YouTube 40) that it trims itself, and the music page's own counter and guestbook. Don't add a table
that grows without a trim and a CSV that keeps it.

- **`/youtube/`, `/watching/`**: render the copy, and the script replaces it (and leaves it
  standing if the fetch fails). `/watching/` is `noindex` and out of the sitemap: public, but not
  for searches of his name.
- **The reefer board (`/reefer-rates/`, one page per lane)**: built only from
  `_data/live/reefer.json`, with no page script. `snapshot.py` writes that, the lane stubs in
  `_reefer_lanes/` (front matter only, never deleted) and `reefer-rates/usda-reefer-truck-rates.csv`.
  USDA keeps the history, so nothing else does: the CSV is read back first and the Worker, which
  holds the USDA key, is asked only for the newest week and the four before it.
  District names and lane slugs come from `_data/reefer_districts.json`; never change a slug
  once its page is live. Rates are USDA's (report 2375): credit them, and make no claims about a
  lane that the data doesn't show.
- **The border board (`/border-waits/`, a page per major commercial crossing, and a Spanish
  page under `/es/tiempos-de-espera/` for each Mexico crossing)**: built from
  `_data/live/border.json`; `border-waits/live.js` only refreshes "right now". `snapshot.py`
  writes that, the stubs in `_border_crossings/` and `_border_crossings_es/` (never deleted) and
  the CSV of 30-day averages. Crossings with pages, their slugs and Spanish names are in
  `_data/border_crossings.json`; never change a slug once live. A closed lane is unknown, never 0.
  The Spanish pages are live and paired with hreflang (`translations_live` in `_config.yml`);
  their wording follows CBP's own Spanish ("sin demora", "carriles generales"), kept in
  `_data/border_text.yml`. CBP keeps no past readings, so the Worker catches each one and holds the last
  14 days (D1 `border_waits`); the permanent archive is `border-waits/border-truck-wait-readings-YYYY.csv`,
  which `snapshot.py` adds the buffer to on every run and computes every crossing's averages from (never
  from the Worker). Each row's `source` is `worker` or `archive` (Sep 13 to Oct 14, filled once by
  `scripts/border-backfill.mjs` from an independent archive of the feed, credited on the pages); a kept
  reading is never rewritten. CBP's dates aren't zero-padded ("10/1/2026"). Beside the board's own readings,
  `snapshot.py` pulls CBP's published averages (`bwt.cbp.gov/api/historicalwaittimes`; weekday 0 is Monday),
  keeps every month of them in `border-waits/cbp-published-averages.csv`, and shows the current month's
  until the board has its own. Data is CBP's Border Wait Times: credit it.
  The same feed's **car and pedestrian lanes** are archived too (D1 `border_people`, 14 days, the
  `border_people` job in `snapshot.py`): `border-car-pedestrian-wait-readings-YYYY.csv` (from Sep 13, the
  early part from the same independent archive), their 30-day averages, and CBP's published averages for
  them (CBP lists a lane a port doesn't have as "N/A" and averages it as 0; that's kept blank). They make
  the **car and pedestrian board** (`/border-waits/cars/`, a page per major crossing, and a Spanish page
  under `/es/tiempos-de-espera/autos/` for each Mexico crossing): `_data/live/border_people.json`, the stubs
  in `_border_people/` and `_border_people_es/` (never deleted), crossings and slugs in
  `_data/border_people_crossings.json` (never change a slug once live), `_layouts/border-people.html`.
  Its "right now" is `border-waits/people.js`, which reads CBP's feed straight from the browser (CBP allows
  any origin), so these pages cost the Worker nothing; keep it that way while the Worker's CPU is tight.
  SENTRI is NEXUS on the Canadian border: lane names swap the word for the port's `sentri`.
- **The beef board (`/beef-prices/`, one page per cut, primal and ground beef item)**: built
  from `_data/live/beef.json`. The source is USDA's LM_XB403 report (boxed beef cutout and cuts,
  negotiated sales, afternoon), from the LMR datamart, which needs no key and serves any date range,
  so nothing keeps a second copy of USDA's history: `snapshot.py` reads the committed CSVs back and
  asks USDA directly only for the months they don't settle (normally the last one or two). It
  writes the JSON, the stubs in `_beef_cuts/` (front matter only, never deleted), the CSVs in
  `beef-prices/` (the daily cutout and primals, and one file per year of every cut) and
  `beef-prices/latest.json` (the newest report, for anyone's code). The Worker stores one row, the
  newest report; `beef-prices/live.js` asks it only when a page's copy is older than a report that
  should be out, and then shows the new figures at the top. `beef-prices/tools.js` adds the board's find-a-cut box and, on each cut page, a price
  check and a trim-cost calculator; they use only data already in the page (`tool` in beef.json). Names and slugs come from
  `_data/beef_cuts.json`, keyed on USDA's description; never change a slug once its page is live.
  Prices are dollars per hundredweight; a cut with no sales that day has no row, never $0. Credit
  USDA AMS, and make no claims the numbers don't show (seasonal swings are computed against each
  year's own average, so the drift in prices doesn't read as a season).
- **The pork board (`/pork-prices/`, a page per cut and primal)**: the beef board's pattern for USDA's
  LM_PK602 (pork cutout, primals and cuts; no grades). `_data/pork_cuts.json` names USDA's ~270 item
  codes in English and Spanish; `pork_name()` in `snapshot.py` builds a name from the code's parts
  (bone, trim, weight, lean, pack, frozen, added ingredients) and adds any new item to the file on its
  own. Never change a slug once live. `pork-prices/live.js` asks the Worker's `/pork` when the copy is
  behind; the tools are the beef board's `beef-prices/tools.js`. Downloads: the daily cutout, one CSV
  per year of every cut (English name only, to keep them small) and `pork-cut-names.csv`, every item's
  English and Spanish name and pages, which joins on `usda_description`; plus `latest.json`.
- **The fed cattle board (`/fed-cattle-prices/`, a page per region)**: weekly negotiated cash prices
  from LM_CT150 (5-area), LM_CT156-158 (Texas-Oklahoma, Kansas, Nebraska), LM_CT154's regional table
  (the six smaller regions) and LM_CT100 (5-area daily), all keyless from the datamart. No Worker:
  the snapshot reads the CSVs back and asks USDA only for the weeks since 45 days before each
  region's newest row (the six LM_CT154 regions share one request). A weekly report dated Monday
  covers the week before; a daily report covers the business day before it. A region gets a page
  after 8 weeks with a price in a year; a week with too few trades has no price, never zero.
- **Kaggle and Spanish**: each source is one Kaggle dataset pulling the published CSVs, with an English
  description and a Spanish section in the same description. No separate Spanish datasets or Spanish
  copies of a CSV: a duplicate splits the votes and reads as spam. Spanish belongs on the site's pages.
- **Spanish for the USDA boards**: every beef, pork and cattle page has a Spanish twin under
  `/es/precios-de-carne-de-res/`, `/es/precios-de-cerdo/` and `/es/precios-de-ganado-gordo/`, paired by
  each stub's `translation` (`snapshot.py` writes both stubs). The snapshots carry the formatted Spanish
  dates and sentences in `*_es` fields; the templates hold the Spanish words beside the English ones.
  Spanish cut names follow Mexican usage (beef names are in `_data/beef_cuts.json`, `es`).
- **The USDA hub (`/usda-market-prices/`, `/es/precios-usda/`)**: the parent project of the beef,
  pork, cattle and reefer boards (`_includes/usda-hub.html`, a schema.org `DataCatalog` that each
  board's `Dataset` names in `isPartOf`). Every board ends with `_includes/usda-boards.html`, the
  list of the others, so a new board is added there once.
- **`/worker-usage/`**: the account's use of Cloudflare's free plan (Worker requests, CPU, D1 rows and
  size), today and for 30 days. The Worker reads Cloudflare's GraphQL Analytics hourly with a read-only
  token (`CF_ANALYTICS_TOKEN`, `worker/src/usage.js`) and keeps one row; the page renders the snapshot's
  copy (`_data/live/usage.json`) and its script swaps in `/usage`.
- **`/blog/`**: renders the local posts in HTML and merges Substack's items by script, so the
  list works without JavaScript and for crawlers.

## The music page

`/music/` is Yokonjuan's page, Juan's music, and it is **deliberately separate from the
portfolio**: its own layout (`_layouts/artist.html`, which doesn't use `head.html`), stylesheet
(`music/music.css`), script (`music/music.js`), icon and share picture (`scripts/music-og.js`).
Nothing on it may name or link Juan Torres, and the portfolio's JSON-LD doesn't connect the two
names: the portfolio links in (nav, home About), the music page never links back. Any words in
Juan's voice (`about` in the data file) are his; don't write them. The page reads the live
catalog, visitor counter and guestbook from the Worker; the data file is the fallback and what
crawlers see.

## Adding things

- **A post**: `_posts/YYYY-MM-DD-slug.md` with `layout: post`, `title`, `date`, `tags` and a
  `description` (this becomes the meta description and the excerpt on `/blog/`). Nothing else
  to touch: the feed, sitemap, writing index and JSON-LD pick it up. It is published at
  `/blog/<slug>/` (a default in `_config.yml`), so choose the slug as the address you want.
- **When to write a post**: only when a new project ships or an existing one changes in a deep
  way. The post is the write-up of that work and goes in the same pull request. No standalone
  SEO articles and no posting schedule: the site should never read like a content farm.
  - Ask Juan first why he built it and what surprised him, and use his answers. Never invent his
    experiences, motives or feelings.
  - Every number comes from the project's real output (the page, its data, the code). If a result
    only holds in some conditions, say where it breaks; that is usually the interesting part.
  - Shape: the hook (the question), the setup, how it works in plain words, results with real
    numbers (a small Markdown table where it helps), what went wrong or surprised, what it means,
    and a link to try it.
  - Voice: the site's plain first person. No hype, no filler openers, search phrases only where
    they read naturally (title, first paragraph). Juan reviews every post before it merges.
  - Link both ways: set the project's `writeup` in `projects.yml` (shows on `/projects/`, in the
    project bar, and links the post and the project in the JSON-LD), and link the project from
    the post.
- **A moved page**: never just delete the old address. Add a stub in `redirects/` with
  `layout: redirect`, the old address as `permalink`, the new one as `to`, and `sitemap: false`.
- **A project**: add it to `_data/projects.yml` (slug, family, title, url, kind, status, short,
  summary, metric, stack, keywords; optionally `writeup` or `guide`, a schema.org `category`, a
  `features` list, `search` terms and a `learning` block for the JSON-LD; the file's header says
  what each does), then make the page with `layout: app`, `project: <slug>`, `title`,
  `description`, `image` and `image_alt`. Give it a share picture in `scripts/og-images.js` and
  re-run that script. The project bar, home page and `/projects/` update on their own.
- **A page**: `layout: default`, a `permalink`, `title`, `description`. Add `image` (and an
  `image_alt` that describes the picture) if a share picture exists; `seo_title` when the search
  title should say more than the page title; `noindex: true` and `sitemap: false` to keep it out
  of search.
- **A real change to a page's content**: set `last_modified_at: YYYY-MM-DD` in its front matter.
  It becomes the page's `<lastmod>` in the sitemap (a post's `dateModified` too). Pages without
  it get the date `scripts/lastmod.py` finds in git at deploy: the newest commit to the page or to
  any data file it reads (through includes too), so the home page moves with `projects.yml` and
  `/youtube/` with its snapshot. Layouts and chrome don't count. `_data/lastmod.json` is
  written at build time and never committed.
- **A new Worker-backed page**: give `snapshot.py` a function that shapes the Worker's answer
  for display, render `site.data.live.<name>` in the page as the fallback, and have the script
  replace it (and leave it standing if the fetch fails). Add the page's placeholder to the
  snapshot check in `check.py`, and the page to `screenshots.js`.
- **A new USDA board** (the way the beef, pork and cattle boards were made): look at the report's
  sections in the datamart first (`/reports/<id>?lastReports=1&allSections=true`); add a job to
  `snapshot.py` that reads its CSVs back and asks only for what they don't settle; write the board as
  one include rendered by an English and a Spanish index page, and an item layout that reads
  `page.lang`; reuse `price-chart`, `price-grid`, `price-season` and `cut-tools`. Then: collections
  and defaults for both languages in `_config.yml`, the stubs' `translation` pairs, the sitemap,
  `check.py`'s snapshot list, `snapshot.yml`'s `git add` paths, a `projects.yml` entry, a card in
  `og-images.js`, the board in `usda-boards.html` and the hub, `screenshots.js`, and the docs.
- **Anything changing the head**: it is one include for every page. Test with `check.py`.
- **Breadcrumbs**: every page but the home page, the 404 and the music page has one trail, the same in its
  `BreadcrumbList` (`head.html`; posts get their own beside the `BlogPosting`) and in the visible
  `crumbs.html` (in the `default`, `tool` and `app` layouts; Plain Solver's full-screen layout has the JSON-LD
  only). `_includes/crumb-chain.html` builds it from `_data/crumbs.yml`: the data boards are rooted at
  `/data/` and `/es/datos/`, posts sit under Writing, project pages under Projects. A new board adds its
  address there with its parent; its item pages follow from their `parent`.

## Things that are the way they are on purpose

- Fonts are self-hosted and preloaded; do not add Google Fonts links to Jekyll pages.
- Stylesheets and page scripts are linked with `?v={{ site.time | date: '%s' }}`, so each deploy
  changes their address and no browser pairs new HTML with a cached old file. Do the same for any
  new stylesheet or script a page links.
- The Fruit Fly Dispatcher loads a 2–3 MB run file only when the reader nears "Watch a week".
- Plain Solver's model JSON (`schemaVersion` in `model.js`) is what share links and saved `.json` files
  carry, so a change to its shape needs a migration in `normalize()` (`app.js`), not just new code.
  Its templates' numbers are made-up samples, for the same reason as the planner's.
- The Aggregate Planner serves its solver (`lib/highs.wasm`, 3.5 MB) from the repo, not a CDN, and
  keeps its inputs in the URL hash, never the query string. Its expected sample costs (Level
  5,261,040, Band 5,062,160, Chase 4,875,900 with whole teams) are a quick regression check after
  touching `model.js`. It is shaped like a textbook aggregate planning case (all three policies
  solved at once, the Solver layout with period 0, an Excel export with live formulas), but no
  real case's names or numbers go in the repo: case documents are copyrighted, and the sample is
  neutral on purpose.
- Liquid parses tags even inside `{% comment %}` blocks, so a comment never shows an include
  call with its braces (write `include x.html es=…` in backticks); one did, and broke the build.
- Board and hub pages have no `last_modified_at`: their sitemap date comes from `lastmod.py`, which
  follows their includes to the snapshot they read, so it moves when the data does.
- The sitemap and feed are written by hand (no plugins) so they build anywhere; the sitemap has no
  `<changefreq>` or `<priority>`, which search engines ignore, and a `<lastmod>` only when it is
  true. Redirects are the same: `_layouts/redirect.html` rather than jekyll-redirect-from, whose
  bare pages `check.py` would reject.
- `robots.txt` blocks nothing: a noindex page has to stay crawlable for its noindex to be seen.
- Analytics is Cloudflare Web Analytics (cookieless), switched on by `cloudflare_analytics_token`
  in `_config.yml` and written in `_includes/analytics.html`.
- The `.docx` résumé source, `worker/`, `scripts/` and the documentation files (README, this
  file, CHANGELOG) are excluded from the build in `_config.yml`. That last part matters: GitHub Pages
  renders every Markdown file as a page even without front matter, which a plain local build
  does not, so a new `.md` at the root must be added to `exclude` or it appears at `/<name>/`.
- The PDF résumé (`assets/Juan Torres Resume.pdf`, with its `.docx` source beside it) is a separate
  document from `_data/resume.yml`; update both together. The data file is written in the site's
  plain first-person voice, not the PDF's résumé phrasing, and leaves out the phone number.
- The data boards' CSVs are **published addresses**: the Kaggle datasets pull them by URL on a schedule
  (README, "Published data addresses"), and anyone's code may too. Never rename, move or delete one, and
  never rename or reorder its columns; a new column goes at the end, and then gets its description on
  Kaggle. `check.py`'s `PUBLISHED` list holds every one with its header and fails the build if one goes
  missing or changes shape. Each January the boards start new `-YYYY.csv` files: add them to `YEARS` /
  `PUBLISHED` and to the Kaggle datasets. A custom domain would keep these working only through GitHub's
  redirect from `juantorresmi.github.io`, so keep that redirect.
- Text files are LF everywhere (`.gitattributes`, `.editorconfig`), Windows checkouts included.

## Secrets

None in the repo. The Worker's keys (Stremio, YouTube, USDA, EIA, the guestbook admin key) are
Cloudflare secrets; `worker/README.md` explains each. Never put keys in `_config.yml` or any
page. The analytics token, IndexNow key and search-console codes there are public by design.
