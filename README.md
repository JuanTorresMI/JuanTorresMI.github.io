# juantorresmi.github.io

Personal site of Juan Torres: a home page, a résumé, a writing index that mirrors Substack,
and two projects that run in the browser (the Fruit Fly Dispatcher simulation and Craft Ledger).

Built with Jekyll and published by GitHub Pages from `main`
(`.github/workflows/jekyll-gh-pages.yml`). There is no build step to run locally for ordinary
edits: change a file, push, and the site updates.

## Where things live

| Path | What it is |
| --- | --- |
| `_config.yml` | Site name, tagline, description, social links, the Worker URL, and what is excluded from the build |
| `_data/resume.yml` | The résumé as the site shows it (the PDF in `assets/` is separate; change both) |
| `_data/projects.yml` | Every project, in the order the Projects page shows them |
| `_includes/head.html` | Titles, descriptions, link-preview tags and structured data for every page |
| `_layouts/` | `default` for ordinary pages, `post` for writing, `app` for full-width project pages |
| `assets/css/style.css` | The one stylesheet, fonts included (served from `assets/fonts/`) |
| `assets/og/` | Link-preview pictures, drawn by `scripts/og-images.js` |
| `fruit-fly-dispatcher/` | The simulation page and its data (`runs/` are loaded on demand) |
| `craft-ledger.html` | The ledger, a single self-contained file |
| `worker/` | The Cloudflare Worker behind `/watching/` and the Substack feed; see its README |

## Previewing locally

```sh
gem install jekyll
jekyll serve
```

## Link-preview pictures and icons

`assets/og/*.png` and `assets/icon-*.png` are drawn from the site's fonts by a small
Playwright script. After changing a title in it, re-run it and commit the PNGs:

```sh
npm install -g playwright && npx playwright install chromium
NODE_PATH=$(npm root -g) node scripts/og-images.js
```
