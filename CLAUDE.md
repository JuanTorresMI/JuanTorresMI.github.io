# Working on this site

Personal site of Juan Torres, built with Jekyll and served by GitHub Pages from `main`.
Read this before changing anything; README.md covers the same ground for people.

## The shape of it

| Where | What |
| --- | --- |
| `_config.yml` | Name, tagline, description, social links, share image, Worker URL, build excludes |
| `_data/resume.yml` | The résumé. `/resume/` shows all of it; the home page shows each job's `summary` |
| `_data/projects.yml` | Every project, in display order. Feeds the home page, `/projects/`, the project bar and the JSON-LD |
| `_includes/head.html` | Title, description, canonical, Open Graph / Twitter tags, structured data, fonts. Every page goes through it |
| `_includes/navbar.html`, `footer.html`, `project-bar.html` | Site chrome |
| `_layouts/default.html` | Ordinary pages: content inside `<main class="page frame">` |
| `_layouts/post.html` | Writing. Adds date, reading time, tags, previous / next |
| `_layouts/app.html` | Full-width project pages: nav, project bar, the page's own markup, footer |
| `assets/css/style.css` | The only stylesheet. Fonts, tokens, grid, every component, print |
| `assets/fonts/` | Cormorant Garamond, Inter, IBM Plex Mono (latin woff2, self-hosted) |
| `assets/og/` | 1200×630 share pictures, drawn by `scripts/og-images.js` |
| `fruit-fly-dispatcher/` | The simulation: `index.html` (layout `app`), `showcase-data.js`, `runs/*.js` (loaded on demand) |
| `craft-ledger.html` | The ledger: one file (styles, markup, recipe JSON, script) inside layout `app`, styles scoped under `.cl` |
| `minecraft-crafting-profit-calculator.html` | The ledger's guide page: what search engines and SMP players land on. A project's `guide` in `projects.yml` links to it |
| `aggregate-planning/` | The planner: `index.html` (layout `app`), `planner.css` (scoped under `.ap`), `model.js` (the LP/MIP; no DOM, runs in Node), `solver.js` + `solver-worker.js` (HiGHS in a Web Worker), `app.js`, `xlsx.js` (the downloadable workbook, no library), `sw.js` (offline). `lib/` holds HiGHS and Chart.js, vendored unchanged |
| `worker/` | Cloudflare Worker for `/watching/` and the Substack feed. Not part of the Jekyll build; own README |
| `scripts/` | `check.py` (verifies a build), `screenshots.js` (visual pass), `og-images.js` (share pictures) |

## Before you push

```sh
jekyll build -d /tmp/_site && python3 scripts/check.py /tmp/_site
```

`check.py` fails on unrendered Liquid, broken JSON-LD, a page missing its title, description,
canonical or share image, an internal link that points at nothing, and a bad sitemap, feed or
manifest. The `Check the site` workflow runs the same thing on every pull request with the exact
Jekyll GitHub Pages uses (the `github-pages` gem, Jekyll 3.10). Stay inside what that build
supports: no plugins beyond the GitHub Pages allowlist, and the Liquid filters Jekyll 3.10 has.
There is no Gemfile on purpose: one would make `jekyll build` insist on `bundle exec`.

For anything visual, also run `scripts/screenshots.js` and look at the pictures. On the web,
the session hook in `.claude/hooks/` installs Jekyll; Playwright is only there if the container has it.

## Design rules

The look is stationery: bone and eggshell stock, near-black ink, one steel accent for links
and focus, no rounded corners, no fills except the one primary button. Cormorant Garamond
sets names and titles, Inter carries text and the spaced uppercase labels, IBM Plex Mono holds
dates and figures. Spacing steps are multiples of 8.

- Colors and fonts come from the tokens at the top of `style.css`. Never write a hex color in
  a page; add a token if one is missing. Dark mode is the same tokens redefined, once for
  `prefers-color-scheme` and once for `[data-theme="dark"]`: keep those two blocks identical.
- Pages sit on the 12-column grid: `.row` with `.key` (columns 1–3) and `.body` (4–12). The
  one list pattern is `.entries` / `.entry`; use it before inventing another.
- Components for ordinary pages are scoped under `.page` so they never leak into the project
  pages. A project page brings its own classes, scoped under a root class of its own (`.cl` for
  the ledger); it may use the tokens.
- Keep `.label` (11px, 0.16em tracking, uppercase) and `.data` (mono, 12px) for the small type.

## Adding things

- **A post**: `_posts/YYYY-MM-DD-slug.md` with `layout: post`, `title`, `date`, `tags` and a
  `description` (this becomes the meta description and the excerpt on `/blog/`). Nothing else
  to touch: the feed, sitemap, writing index and JSON-LD pick it up.
- **A project**: add it to `_data/projects.yml` (slug, title, url, kind, status, short, summary,
  metric, stack, keywords; optionally a schema.org `category` and a `features` list for the
  JSON-LD), then make the page with `layout: app`, `project: <slug>`, `title`,
  `description`, `image` and `image_alt`. Give it a share picture in `scripts/og-images.js` and
  re-run that script. The project bar, home page and `/projects/` update on their own.
- **A page**: `layout: default`, a `permalink`, `title`, `description`. Add `image` if a share
  picture exists, `noindex: true` and `sitemap: false` to keep it out of search.
- **Anything changing the head**: it is one include for every page. Test with `check.py`.

## Things that are the way they are on purpose

- Fonts are self-hosted and preloaded; do not add Google Fonts links to Jekyll pages.
- `/watching/` is `noindex` and out of the sitemap: public, but not for searches of his name.
- The Fruit Fly Dispatcher loads a 2–3 MB run file only when the reader nears "Watch a week".
- The Aggregate Planner serves its solver (`lib/highs.wasm`, 3.5 MB) from the repo, not a CDN, and keeps
  its inputs in the URL hash, never the query string. Its expected sample costs (Level 5,261,040, Band
  5,062,160, Chase 4,875,900 with whole teams) are a quick regression check after touching `model.js`.
  It is shaped like a textbook aggregate planning case (all three policies solved at once, the Solver
  layout with period 0, an Excel export with live formulas), but no real case's names or numbers go in the
  repo: case documents are copyrighted, and the sample is neutral on purpose.
- The writing index renders local posts in HTML and merges Substack items by script, so the
  list works without JavaScript and for crawlers.
- The sitemap and feed are written by hand (no plugins) so they build anywhere.
- The `.docx` résumé source, `worker/`, `scripts/` and the documentation files (README, this
  file) are excluded from the build in `_config.yml`. That last part matters: GitHub Pages
  renders every Markdown file as a page even without front matter, which a plain local build
  does not, so a new `.md` at the root must be added to `exclude` or it appears at `/<name>/`.
- The PDF résumé (`assets/Juan Torres Resume.pdf`, with its `.docx` source beside it) is a separate
  document from `_data/resume.yml`; update both together. The data file is written in the site's
  plain first-person voice, not the PDF's résumé phrasing, and leaves out the phone number.

## Secrets

None in the repo. The Stremio key is a Cloudflare secret on the Worker; `worker/README.md`
explains. Never put keys in `_config.yml` or any page.
