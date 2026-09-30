/* Draws the pictures that show up when a link to the site is shared (assets/og/*.png,
 * 1200×630) and the home-screen icons the web manifest lists (assets/icon-*.png).
 * They are drawn with the site's own fonts, in the style of the business card.
 *
 *   node scripts/og-images.js          (needs the playwright package and its Chromium;
 *                                       NODE_PATH=$(npm root -g) if it is installed globally)
 *
 * Re-run after changing a title below, then commit the PNGs: the site is static and
 * GitHub Pages does not run this.
 */
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");

const root = path.resolve(__dirname, "..");
const fontDir = "file://" + path.join(root, "assets", "fonts");
const outDir = path.join(root, "assets", "og");

const CARDS = {
  home: { top: ["Central Michigan University", "Class of 2027"], name: "Juan Torres", caps: true,
    sub: "Logistics Management", bottom: ["Torre10j@cmich.edu", "juantorresmi.github.io"] },
  projects: { top: ["Juan Torres", "Projects"], name: "Things I’ve built",
    sub: "A fruit-fly delivery simulation · A Minecraft price ledger", bottom: ["juantorresmi.github.io/projects", "Central Michigan University"] },
  resume: { top: ["Juan Torres", "Résumé"], name: "Résumé",
    sub: "Logistics Management · Central Michigan University · Class of 2027", bottom: ["juantorresmi.github.io/resume", "Torre10j@cmich.edu"] },
  writing: { top: ["Juan Torres", "Writing"], name: "Notes on finance, school and work",
    sub: "On Substack, collected here", bottom: ["juantorresmi.github.io/blog", "juantorresis.substack.com"] },
  "fruit-fly-dispatcher": { top: ["Juan Torres", "Simulation"], name: "Fruit Fly Dispatcher",
    sub: "A fly’s brain against Google OR-Tools · 55 stores · one week", bottom: ["juantorresmi.github.io/fruit-fly-dispatcher", "FlyWire · OR-Tools CP-SAT"] },
  "craft-ledger": { top: ["Juan Torres", "Tool"], name: "Craft Ledger",
    sub: "Which Minecraft crafts actually make money · 2,770 items", bottom: ["juantorresmi.github.io/craft-ledger.html", "Local-first web app"] },
  "aggregate-planning": { top: ["Juan Torres", "Tool"], name: "Aggregate Planner",
    sub: "The cheapest production plan · Level, band or chase · Solved exactly", bottom: ["juantorresmi.github.io/aggregate-planning", "HiGHS · in the browser"] },
};

const css = `
@font-face { font-family: "Cormorant Garamond"; font-weight: 500 600; src: url("${fontDir}/cormorant-garamond.woff2") format("woff2"); }
@font-face { font-family: "Inter"; font-weight: 400 600; src: url("${fontDir}/inter.woff2") format("woff2"); }
@font-face { font-family: "IBM Plex Mono"; font-weight: 400; src: url("${fontDir}/ibm-plex-mono-400.woff2") format("woff2"); }
* { box-sizing: border-box; margin: 0; }
html, body { width: 1200px; height: 630px; overflow: hidden; }
body { background: #eeebe3; font-family: "Inter", Helvetica, Arial, sans-serif; color: #0f0f0e; -webkit-font-smoothing: antialiased; }
.card { position: absolute; inset: 56px; background: #f7f5ef; display: grid; grid-template-rows: auto 1fr auto; padding: 52px 64px;
  box-shadow: 0 0 0 1px rgba(15,15,14,.06), 0 1px 0 rgba(15,15,14,.09), 0 2px 0 rgba(15,15,14,.04), 0 36px 64px -36px rgba(46,38,20,.28); overflow: hidden; }
.mark { position: absolute; right: -2%; top: 50%; transform: translateY(-52%); font-family: "Cormorant Garamond", serif; font-weight: 500; font-size: 560px; line-height: 1; letter-spacing: -0.06em; color: rgba(15,15,14,.03); pointer-events: none; }
.top, .bot { position: relative; display: flex; justify-content: space-between; align-items: baseline; gap: 24px; }
.label { font-size: 15px; font-weight: 500; letter-spacing: .24em; text-transform: uppercase; color: #55524c; }
.mid { position: relative; align-self: center; text-align: center; padding: 0 40px; }
.name { font-family: "Cormorant Garamond", serif; font-weight: 500; font-size: 92px; line-height: 1.05; letter-spacing: -0.012em; color: #0f0f0e; text-wrap: balance; }
.name.caps { text-transform: uppercase; letter-spacing: .2em; margin-right: -.2em; font-size: 88px; }
.rule { display: block; width: 44px; height: 2px; background: #3d5266; margin: 30px auto 24px; }
.sub { font-size: 17px; font-weight: 500; letter-spacing: .24em; text-transform: uppercase; color: #55524c; text-wrap: balance; line-height: 1.6; }
.bot .mono { font-family: "IBM Plex Mono", monospace; font-size: 16px; color: #55524c; }
`;
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const cardHtml = (c) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<div class="card"><span class="mark">JT</span>
  <div class="top"><span class="label">${esc(c.top[0])}</span><span class="label">${esc(c.top[1])}</span></div>
  <div class="mid"><div class="name${c.caps ? " caps" : ""}">${esc(c.name)}</div><span class="rule"></span><div class="sub">${esc(c.sub)}</div></div>
  <div class="bot"><span class="mono">${esc(c.bottom[0])}</span><span class="mono">${esc(c.bottom[1])}</span></div>
</div></body></html>`;

const iconHtml = (size) => {
  const svg = fs.readFileSync(path.join(root, "assets", "favicon.svg"), "utf8")
    .replace("<svg ", `<svg width="${size}" height="${size}" `);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: "Cormorant Garamond"; font-weight: 500 600; src: url("${fontDir}/cormorant-garamond.woff2") format("woff2"); }
html, body { margin: 0; width: ${size}px; height: ${size}px; overflow: hidden; background: #eeebe3; } svg { display: block; }
</style></head><body>${svg}</body></html>`;
};

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, colorScheme: "light" });
  for (const [name, c] of Object.entries(CARDS)) {
    await page.setContent(cardHtml(c), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(outDir, `${name}.png`), type: "png" });
    console.log("wrote", `assets/og/${name}.png`);
  }
  for (const size of [192, 512]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(iconHtml(size), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(root, "assets", `icon-${size}.png`), type: "png" });
    console.log("wrote", `assets/icon-${size}.png`);
  }
  await browser.close();
})();
