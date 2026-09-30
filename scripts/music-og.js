/* Draws music/og.jpg, the picture shown when a link to Yokonjuan's page is shared (1200×630).
 * Kept apart from og-images.js on purpose: the music page shares nothing with the portfolio,
 * and its picture must not name Juan Torres. It uses the page's look (music/music.css) and
 * the five newest covers from _data/music.yml, fetched from the platforms when it runs.
 *
 *   NODE_PATH=$(npm root -g) node scripts/music-og.js
 */
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");

const root = path.resolve(__dirname, "..");
// Fonts go in as data URLs: a page made with setContent may not load file:// fonts.
const font = (f) => "data:font/woff2;base64," + fs.readFileSync(path.join(root, "assets", "fonts", f)).toString("base64");
const yml = fs.readFileSync(path.join(root, "_data", "music.yml"), "utf8");
const covers = [...yml.matchAll(/^\s+cover:\s*(\S+)/gm)].map((m) => m[1]).slice(0, 5);
const tags = (yml.match(/^tags:\s*\[(.*)\]/m) || [, ""])[1].split(",").map((s) => s.trim()).join(" / ");

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: "Inter"; font-weight: 100 900; src: url("${font("inter.woff2")}") format("woff2"); }
@font-face { font-family: "Plex"; src: url("${font("ibm-plex-mono-400.woff2")}") format("woff2"); }
* { box-sizing: border-box; margin: 0; }
html, body { width: 1200px; height: 630px; overflow: hidden; }
body { position: relative; padding: 64px 72px; color: #e9eaee; font-family: "Inter";
  background: radial-gradient(760px 520px at 8% -10%, rgba(120,160,230,.20), transparent 70%),
              radial-gradient(640px 420px at 100% 60%, rgba(150,110,210,.10), transparent 70%), #060608; }
.grain { position: absolute; inset: 0; opacity: .08; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
.tags { font: 16px/1 "Plex"; letter-spacing: .3em; color: #80858f; }
.word { margin-top: 26px; margin-left: -6px; font-weight: 600; font-size: 176px; line-height: .86; letter-spacing: -.055em; padding-bottom: .14em;
  background: linear-gradient(178deg, #fff 8%, #d9e2ee 36%, #7f8b9b 52%, #c6d4e6 64%, #f4f7fb 92%);
  -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 0 42px rgba(185,215,255,.16)); }
.covers { position: absolute; left: 72px; right: 72px; bottom: 64px; display: grid; grid-template-columns: repeat(5, 1fr); gap: 20px; }
.covers img { width: 100%; aspect-ratio: 1; object-fit: cover; border: 1px solid rgba(233,234,238,.12); filter: saturate(.85) brightness(.92); }
</style></head><body><div class="grain"></div>
<p class="tags">${tags}</p><div class="word">yokonjuan</div>
<div class="covers">${covers.map((c) => `<img src="${c}">`).join("")}</div>
</body></html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(root, "music", "og.jpg"), type: "jpeg", quality: 88 });
  console.log("wrote music/og.jpg");
  await browser.close();
})();
