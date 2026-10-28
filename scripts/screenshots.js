/* Screenshots every page of a built site at desktop and phone widths, in light and dark,
 * and reports JavaScript errors. For looking at a change before pushing it.
 *
 *   NODE_PATH=$(npm root -g) node scripts/screenshots.js _site /tmp/shots
 *
 * Needs the playwright package and its Chromium (npm install -g playwright && npx playwright
 * install chromium). Errors from outside services (GitHub's API, the Worker, YouTube, Spotify and
 * Apple Music embeds) are expected when the network is restricted.
 */
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const [siteDir = "_site", outDir = "screenshots"] = process.argv.slice(2);
// One page of every kind: each family, each layout, one generated page per collection.
const PAGES = [
  "/", "/projects/", "/resume/", "/blog/", "/blog/fruit-fly-vs-or-tools/", "/404.html",
  "/fruit-fly-dispatcher/", "/craft-ledger.html", "/aggregate-planning/", "/plain-solver/",
  "/reefer-rates/", "/reefer-rates/south-texas-to-chicago/",
  "/border-waits/", "/border-waits/laredo-world-trade-bridge/", "/es/tiempos-de-espera/", "/es/tiempos-de-espera/laredo-puente-comercio-mundial/",
  "/border-waits/cars/", "/border-waits/cars/san-ysidro/", "/border-waits/cars/detroit-ambassador-bridge/", "/es/tiempos-de-espera/autos/", "/es/tiempos-de-espera/autos/garita-de-san-ysidro/",
  "/beef-prices/", "/beef-prices/ribeye-boneless-heavy-112a/", "/beef-prices/rib-primal/", "/beef-prices/ground-beef-81/",
  "/es/precios-de-carne-de-res/", "/es/precios-de-carne-de-res/rib-eye-sin-hueso-pesado-112a/",
  "/pork-prices/", "/pork-prices/pork-tenderloin/", "/pork-prices/pork-belly-primal/", "/es/precios-de-cerdo/", "/es/precios-de-cerdo/filete-de-cerdo/",
  "/fed-cattle-prices/", "/fed-cattle-prices/eastern-cornbelt/", "/es/precios-de-ganado-gordo/", "/es/precios-de-ganado-gordo/nebraska/",
  "/usda-market-prices/", "/es/precios-usda/", "/blog/usda-pork-prices-by-cut/",
  "/youtube/", "/watching/", "/music/", "/worker-usage/", "/mma-cards/",
];
const TYPES = { html: "text/html", css: "text/css", js: "text/javascript", png: "image/png", jpg: "image/jpeg", svg: "image/svg+xml", woff2: "font/woff2", xml: "application/xml", txt: "text/plain", json: "application/json", webmanifest: "application/manifest+json", wasm: "application/wasm", pdf: "application/pdf", csv: "text/csv" };

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
