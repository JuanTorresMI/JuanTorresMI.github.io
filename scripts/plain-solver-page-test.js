/* Plain Solver, clicked through in a real browser at phone and desktop widths: the staffing
 * example, building a model from a blank page with the four fill-in lines, a building block on an
 * imported workbook, and the model as text. Complements plain-solver-test.js, which tests the solver.
 *
 *   NODE_PATH=$(npm root -g) node scripts/plain-solver-page-test.js _site
 *   node scripts/plain-solver-page-test.js http://127.0.0.1:4000/plain-solver/   (a running server)
 *
 * Needs the playwright package and a browser (see screenshots.js; on Windows, a shim that adds
 * channel: "msedge" works, as CLAUDE.md describes).
 */
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const [siteDir = "_site"] = process.argv.slice(2);
const TYPES = { html: "text/html", css: "text/css", js: "text/javascript", png: "image/png", svg: "image/svg+xml", woff2: "font/woff2", json: "application/json", wasm: "application/wasm" };
const server = http.createServer((req, res) => {
  let f = path.join(siteDir, decodeURIComponent(req.url.split("?")[0]));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f).slice(1)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});

let failures = 0, passes = 0;
const check = (name, ok, detail) => { if (ok) passes++; else { failures++; console.log("FAIL " + name + (detail ? ": " + detail : "")); } };

(async () => {
  let url = siteDir;
  if (!/^https?:/.test(siteDir)) { await new Promise((r) => server.listen(0, r)); url = `http://127.0.0.1:${server.address().port}/plain-solver/`; }
  const browser = await chromium.launch();
  for (const width of [390, 1360]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const fresh = async () => { await page.goto(url); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForSelector("#app:not([hidden])"); };
    const solved = () => page.waitForFunction(() => !document.querySelector("#b-solve").disabled && !/Solving/.test(document.querySelector("#status").textContent), null, { timeout: 60000 });
    const at = `${width}px`;

    // 1. The staffing example: solve and see $13,250.
    await fresh();
    await page.click("#q-solve");
    await solved();
    check(`${at} staffing answer`, (await page.textContent("#a-goal")) === "$13,250", await page.textContent("#a-goal"));
    check(`${at} no sideways scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "");

    // 2. Build your own from a blank page, using only the fill-in lines.
    await page.click("#b-build");
    await page.waitForTimeout(600);
    for (const n of ["chairs to make", "tables to make"]) { await page.fill("#qd-name", n); await page.click("#qd-add"); }
    for (const [n, v, u] of [["profit per chair", "45", "$"], ["profit per table", "80", "$"], ["wood available", "400", ""], ["wood per chair", "5", ""], ["wood per table", "20", ""]]) {
      await page.fill("#qk-name", n); await page.fill("#qk-value", v); await page.fill("#qk-unit", u); await page.click("#qk-add");
    }
    await page.fill("#qr-lhs", "wood per chair times chairs to make plus wood per table times tables to make");
    await page.selectOption("#qr-op", "<=");
    await page.fill("#qr-rhs", "wood available");
    await page.click("#qr-add");
    await page.fill("#qg-expr", "profit per chair × chairs to make + profit per table × tables to make");
    await page.selectOption("#qg-sense", "max");
    await page.click("#qg-set");
    await page.click("#b-solve");
    await solved();
    check(`${at} built from blank`, (await page.textContent("#a-sentence")) === "Chairs to make: 80; Tables to make: 0. Total profit: $3,600.", await page.textContent("#a-sentence"));

    // 3. The model as text, written by hand, and a filter.
    await page.click("#b-text");
    await page.fill("#dt-text", `title: Lanes
list Plants (one Plant)
  columns: Capacity, Cost
  East: 500, 4
  West: 400, 3
list Markets (one Market)
  columns: Demand
  A: 300
  B: 250
list Lanes (one Lane)
  columns: From -> Plants, To -> Markets, Freight
  L1: East, A, 2
  L2: East, B, 4
  L3: West, B, 1
decide Ship for each Lanes: any amount
rule "Capacity" for each Plants: sum(Lanes where Lanes.From = this.Plants, Ship) <= Plants.Capacity
rule "Demand" for each Markets: sum(Lanes where Lanes.To = this.Markets, Ship) >= Markets.Demand
minimize "Cost": sum(Lanes, (Lanes.Freight + Plants.Cost[Plants via Lanes.From]) * Ship)
`);
    await page.click("#dt-apply");
    await page.click("#b-solve");
    await solved();
    // A from East at 6 (300), B from West at 4 (250): 2,800.
    check(`${at} text model`, (await page.textContent("#a-goal")) === "2,800", await page.textContent("#a-goal"));

    // 4. A building block on two lists from a workbook.
    await fresh();
    await page.click("#b-start-import");
    const bytes = await page.evaluate(async () => [...new Uint8Array(await APXlsx.blob([
      { name: "Nodes", rows: [["Node", "Net"], ["Plant", 100], ["DC", 0], ["Shop", -100]] },
      { name: "Arcs", rows: [["Arc", "From", "To", "Cost"], ["a1", "Plant", "DC", 2], ["a2", "DC", "Shop", 1], ["a3", "Plant", "Shop", 5]] },
    ]).arrayBuffer())]);
    await page.setInputFiles("#di-file", { name: "net.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from(bytes) });
    await page.waitForSelector("#di-all:not([hidden])");
    await page.click("#di-all");
    await page.click("#b-blocks");
    await page.locator("#db-list .ps-tpl-b", { hasText: "Flow through a network" }).click();
    for (const [key, text] of [["arcs", "Arcs"], ["from", "From"], ["to", "To"], ["nodes", "Nodes"], ["net", "Net"], ["cost", "Cost"]]) {
      const v = await page.evaluate(([key, text]) => [...document.querySelector(`#db-madlib [data-k="blank:${key}"]`).options].find((o) => o.textContent === text).value, [key, text]);
      await page.selectOption(`#db-madlib [data-k="blank:${key}"]`, v);
    }
    await page.click("#db-add");
    await page.click("#b-solve");
    await solved();
    check(`${at} building block`, (await page.textContent("#a-goal")) === "$300", await page.textContent("#a-goal"));

    check(`${at} no page errors`, !errors.length, errors.join(" | "));
    await page.close();
  }
  await browser.close();
  if (server.listening) server.close();
  console.log(`${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
