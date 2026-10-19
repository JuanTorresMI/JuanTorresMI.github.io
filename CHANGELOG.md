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
- **First border buffer trim**: the Worker drops readings older than 14 days at 04:17 UTC daily, from
  Oct 19 on. Everything it drops is already in `border-waits/border-truck-wait-readings-2026.csv`; worth a
  glance at that file's row count after the first trim (it should only ever grow).
- **CBP's averages next year**: `cbp-published-averages.csv` gains a new set each year (rows keyed by the
  year they were read), so last year's official figures stay to compare against.
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
- **Plain Solver write-up**: per CLAUDE.md a new project gets a post, written from Juan's answers
  (why he built it, what surprised him). Not written yet. Also still open from the spec: the optional
  server tier for very large models (the 50 × 500 test solves in the browser in about 2 s).
- **More USDA boards** (Juan wants all of them): next are hogs (LM_HG217/218), lamb (LM_XL502) and cow
  beef (LM_XB405) from the keyless datamart, then MyMarketNews reports (terminal markets, eggs, grain).
  CLAUDE.md, "A new USDA board", is the checklist.

## 2026-10-19 — No layout shift on the app pages

- **Layout shift (CLS, a ranking signal)** on every page in the app layout measured 0.17–1.6: the page
  painted as one column, then the script added the rail and hid the other views. The layout now keeps
  the page invisible under its top bar until `app-shell.js` has laid it out (a 3 s timer shows it
  anyway if the script never runs; without JavaScript nothing is hidden). Now 0–0.07 on every app page
  at desktop and phone widths, under Google's 0.1 "good".
- **The planner's answers table** fills in after the solve; its usual height is held while it's empty,
  so the chart below doesn't jump (CLS 1.6 → 0.015).
- The music page's cover image loads first (`fetchpriority`); the TV page's posters carry their size.
- A site-wide audit of all 805 pages (titles, descriptions, duplicates, canonicals, sitemap, headings,
  social tags, structured data, link text) found nothing else.

## 2026-10-19 — Plain Solver search pass, cleanup

- **Plain Solver**: search title leads with what it does ("Build Your Own Solver: Free Optimization in
  Plain English", the page title "Build Your Own Solver in Plain English: Plain Solver"); the description names the Excel Solver alternative and the profit and cost menus. A `HowTo`
  is generated from the guide's four questions, beside the FAQ, and the guide ends with links to the
  Aggregate Planner, its write-up, the Fruit Fly Dispatcher and every project.
- **Cleanup**: every branch already merged into `main` was deleted on GitHub. README and CLAUDE.md
  describe the app layouts, the boards' automatic views, the history and focus behaviour and the new
  structured data; the page test clicks "The most profit" and checks its answer.

## 2026-10-19 — Datasets on every item page, a phone fix

- **Border crossing pages** now carry a schema.org `Dataset` (CBP's data, the crossing's place, the
  readings' date range, the CSV downloads, `isPartOf` the board's), like the cut, region and lane pages.
- **Every item page's Dataset** (beef and pork cuts, cattle regions, reefer lanes) gains `dateModified`
  (its newest row) and `keywords`.
- **The app layout's top bar** lets a long page name shrink with an ellipsis; the Spanish border board's
  name ran 84 px past a phone's screen. That page also gets a shorter top-bar name (`app_name`).
- The reefer board's "Week of" dates are right again on the live site (snapshot refreshed after the fix).

## 2026-10-19 — Review pass: the app pages and Plain Solver's profit goal

- **Back goes back a section.** In the app layout and in Plain Solver, each change of section or step is
  an entry in the browser's history (same address, the view in the entry's state), so Back on a phone
  returns to the last section instead of leaving the page. The planner's, the beef tools' and Plain
  Solver's own address updates keep that state.
- **Focus follows the rail**: picking a section moves keyboard and screen-reader focus to its heading
  (after the page has shown its own parts, which the ledger and planner do on `app:view`).
- **Print** shows every section in its own layout (the hiding is screen-only) and leaves out the
  Back / Next rows.
- **Plain Solver's money lists**: undo after picking a goal no longer says it "was changed by hand";
  a decision that's turned off still shows in its line; deleting a decision or number drops the lines
  that used it.
- **Search**: Plain Solver's guide answers "How do I maximize profit?" and "Can I use the model in
  Excel?", and its questions are marked up as an FAQPage, generated from the visible text. Its
  features and search terms in `projects.yml` include the profit goal and the Excel workbook.

## 2026-10-19 — Plain Solver: profit without writing a formula

- **Step 4 asks what you're after**: "The most profit", "The lowest cost" or "Something else". Profit opens
  two lists, *Money coming in* and *Money going out*, each line a number times one of your decisions
  (or a fixed amount), chosen from menus. The first click fills them in from the names you gave things
  (prices and profits come in, costs go out, each paired with the decision or list it shares a word
  with). The lines are stored as two ordinary results, "Money in" and "Money out", so the answer shows
  both and nothing new goes in the model's JSON; the goal is in minus out.
- **The typed goal is more forgiving**: a word that starts a decision's name stands for it ("chairs"
  for "Chairs to make"), a plural on its own means the one decision it names ("tables"), and a number
  before a name multiplies it ("50 chairs"). A phrase only inside another name ("per chair") isn't taken.
- **"Price minus cost times chairs"** reads as price − (cost × chairs), which maximizes nothing. The
  goal box now says so and offers "(price minus cost) × chairs" with one click.
- **No-limit answers** say what kind of rule is missing and link to the rules step.
- Five new tests (168 in all).

## 2026-10-19 — The data boards as apps

- **Every board in the app layout.** Beef, pork, fed cattle (English and Spanish), reefer rates, border
  waits (both languages), Worker usage and the USDA hub now use `_layouts/tool.html` with `app_auto`:
  each section with a heading becomes a rail entry (named from the board's jump links), shown one at a
  time, with a link back to the hub. Without JavaScript the page is unchanged, so crawlers read it all.
- **Friendlier type inside the app**: the boards' serif summaries, answer boxes and lane lookup take the
  app's sans type, 1px rules and rounded corners; the stamps and tables keep their mono figures.
- **Reefer sheet buttons** (Rates / Change / Trucks) use `data-sheet`, so the app shell doesn't take
  them for its own views.
- **Fix: reefer "Week of" dates.** The cattle job's `week_of()` in `snapshot.py` replaced the reefer
  board's helper of the same name, so the board read "Week of 2026-10-052026-10-11". The cattle one is
  now `cattle_week()`; the next snapshot writes the dates properly.

## 2026-10-19 — Project pages as apps

- **A shared app layout** for the project pages people use (`_layouts/tool.html`, `assets/css/app.css`,
  `assets/js/app-shell.js`): a top bar with the tool's own buttons, a rail of the page's sections shown one
  at a time (or, for long reads, a contents list that follows you), a side panel, and every section still in
  the page for readers without JavaScript and for search engines.
- **Aggregate Planner** in it: opens on the answers, with the three plans' costs live in the side panel;
  the inputs are four numbered steps (Demand, Workforce & policies, Costs, Start & end) with Back / Next;
  Month by month, Study and the guide are sections of their own. Same model and numbers.
- **Craft Ledger** in it: its four tabs are the rail; Import / Export in the top bar; the sales fee, fuel
  and scanner link in the side panel with a three-step how-to; a first visit opens on the ranked recipes
  (with the example prices) instead of the instructions. Night colors kept.

## 2026-10-19 — Plain Solver: its own app, one step at a time

- **A full-screen app layout** (`_layouts/solver.html`), replacing the long builder page: a top bar (home,
  the model's name, Undo, More, Solve), a step rail (What you decide · What you know · What has to be true ·
  What makes it best · The answer), one screen per step, and the model in plain English beside it with the
  Solve button. Phone: the rail becomes a strip and the summary moves under the step.
- **A start screen** that asks how to begin: from scratch, a spreadsheet, text (or an AI), a saved file, or
  an example. Returning visitors go straight back to their model.
- **Each step** has one fill-in line with examples to click, and lists what it holds as plain-English
  cards with Edit, On/Off and Delete. Rules and goals have the model's names as chips: click them to write
  the rule. Until the basics are in, the checks are a to-do list that links to the step that's missing.
- The detailed sentence editor stays, as “Edit every detail”. Same color tokens; Inter for everything,
  rounded cards, pill buttons (CLAUDE.md notes the exception).

## 2026-10-19 — Plain Solver: Excel + Solver

- **“Excel + Solver”** downloads the model as one Excel sheet: data in yellow cells, decisions in blue (with
  Plain Solver's answer in them when it has one), every result, rule and the goal as live formulas
  (SUM and SUMPRODUCT where the cells line up), and Excel's Solver model already stored in the file, the way
  Excel saves it (hidden `solver_*` names). Data → Solver → Solve; change the yellow cells and solve again.
  The engine is chosen for Excel (Simplex LP, GRG Nonlinear or Evolutionary), since Excel can't make Plain
  Solver's exact rewrites. In Excel itself, every template and a lanes network reach Plain Solver's answer,
  both from the answer and from zeros (`scripts/plain-solver-excel-check.js` + `.ps1`).
- `aggregate-planning/xlsx.js` can write sheet-scoped hidden names and has a style for Solver's cells; the
  planner's workbook is unchanged.

## 2026-10-19 — Plain Solver: build your own, at any size

- **Build your own solver is the front of the page**: four plain questions (what you decide, what you know,
  what has to be true, what makes one plan better), each with a fill-in line; the examples come second.
  Rules and goals can be typed the way people say them (“wood per chair times chairs to make plus …”), with
  the names already in the model suggested as you type; every expression has a pencil to retype it.
- **Large custom models**: list columns can name rows of another list (links), totals, counts and rules can
  filter rows (“where the lane's From is this plant”), and a value can follow a link. Building blocks
  write whole patterns from one sentence (network flow, shipping, fixed costs, carry-over, blending,
  assignment, selection); models combine; a whole workbook imports at once with links detected; the model
  reads and writes as text, with a format guide to give an AI chat.
- **The review's fixes**: the nonlinear engine stopped early on “at most” rules (max x·y with x + y ≤ 10
  gave 24.86, now 25); writing a big model out rebuilt every list's names per reference, and the Limits
  Report scanned every rule per decision (100 × 2,000 transportation: 71 s, now about 5 s). An answer
  stuck at its starting point says to try multistart; evolutionary answers are tidied (480, not 479.999996);
  very large models skip the per-keystroke checks and ask before solving on a phone.
- Tests: 131 solver checks (including the review's cases and a 2,000-node, 20,000-route network) and a new
  page test, `scripts/plain-solver-page-test.js` (12 checks at 390 px and desktop).

## 2026-10-19 — Plain Solver: fixes and search

- **Fix: `projects.yml`**: adding Plain Solver split the Aggregate Planner's entry, so the planner lost its
  JSON-LD feature list and Project-log keywords and Plain Solver's page listed the planner's features. Both
  entries are whole again.
- The answer now opens with one sentence (every decision, then the goal), as the spec asks; large LPs show
  their shadow prices from the duals; a model over 20,000 decisions says plainly that it's big for a browser;
  imported tables ask for each column's unit; Undo after a typed formula takes one press, not two.
- Search: the guide gains a “Questions people ask” section (free Excel Solver alternative, problem size,
  shadow prices, infeasible, nonlinear) and links to the Aggregate Planner; the planner's guide links back.

## 2026-10-18 — Plain Solver

- **New project, `/plain-solver/`**: a general optimization solver set up in plain-English sentences, built
  from the handoff spec (milestones 1–9; the optional server tier and typed-formula mode aren't built). Linear
  and integer models go to HiGHS (the planner's copy), convex quadratic goals to HiGHS's QP solver, smooth
  nonlinear ones to a new augmented-Lagrangian gradient search with multistart, and the rest to differential
  evolution; abs, larger-of and yes-or-no × amount are rewritten as exact linear models first. Infeasible
  models are diagnosed by an elastic re-solve; shadow prices are shown both ways (re-solved), since at a
  corner one more and one fewer differ. Ten templates, quick questions, what-if slider and curve, the math
  in notation and LaTeX, Excel-style Answer/Sensitivity/Limits reports, LP and JSON downloads, paste and
  .csv/.xlsx import, share links in the hash, saved templates in the browser.
- **Power mode** (Advanced): every expression as a typed formula, names suggested as you type, the sentence
  version underneath; it parses to the same model (all 71 template formulas round-trip to identical LPs).
- **Allowable increase and decrease** in the Sensitivity Report, for every cost and every limit, found by
  re-solving (they match the textbook values on the spec's product-mix test); models up to 80 rules and
  decisions.
- `scripts/plain-solver-test.js` runs the spec's acceptance tests (94 checks, including a 50 × 500
  transportation model, about 2 s); the `Check the site` workflow now runs it too.

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
