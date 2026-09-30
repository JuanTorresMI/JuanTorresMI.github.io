/* Screenshots every page of a built site at desktop and phone widths, in light and dark,
 * and reports JavaScript errors. For looking at a change before pushing it.
 *
 *   NODE_PATH=$(npm root -g) node scripts/screenshots.js _site /tmp/shots
 *
 * Needs the playwright package and its Chromium (npm install -g playwright && npx playwright
 * install chromium). Errors from outside services (GitHub's API, the Worker, Google Fonts on
 * pages that still use them) are expected when the network is restricted.
 */
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const [siteDir = "_site", outDir = "screenshots"] = process.argv.slice(2);
const PAGES = ["/", "/projects/", "/resume/", "/blog/", "/fruit-fly-dispatcher/", "/craft-ledger.html", "/aggregate-planning/", "/watching/", "/404.html"];
const TYPES = { html: "text/html", css: "text/css", js: "text/javascript", png: "image/png", svg: "image/svg+xml", woff2: "font/woff2", xml: "application/xml", txt: "text/plain", json: "application/json", webmanifest: "application/manifest+json", wasm: "application/wasm", pdf: "application/pdf" };

const server = http.createServer((req, res) => {
  let f = path.join(siteDir, decodeURIComponent(req.url.split("?")[0]));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f).slice(1)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const errors = [];
  for (const [device, viewport] of [["desktop", { width: 1360, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
    for (const colorScheme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport, colorScheme });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(`${device}/${colorScheme} ${page.url()}: ${e.message}`));
      for (const p of PAGES) {
        await page.goto(base + p, { waitUntil: "load" });
        await page.waitForTimeout(600);
        const slug = p.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";
        await page.screenshot({ path: path.join(outDir, `${slug}-${device}-${colorScheme}.png`), fullPage: true });
      }
      await ctx.close();
    }
  }
  await browser.close(); server.close();
  console.log(errors.length ? errors.join("\n") : "no JavaScript errors");
  console.log(`screenshots in ${outDir}`);
})();
