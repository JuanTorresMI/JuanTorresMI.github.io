/* The boxed beef board (/beef-prices/ on the site): USDA's daily boxed beef cutout and the price
 * of every cut that traded, from negotiated sales between packers and their buyers.
 *
 *   GET /beef    the newest report: { latest, published, day, items, updated }
 *
 * The source is USDA AMS's National Daily Boxed Beef Cutout & Boxed Beef Cuts, Negotiated Sales,
 * afternoon edition (LM_XB403, report 2453), from the Livestock Mandatory Reporting datamart. It
 * needs no key. It posts every business day in the middle of the afternoon. Prices are dollars per
 * hundredweight (100 lb), FOB the plant, for product delivered within 0 to 21 days.
 *
 * USDA keeps every report back to the 2000s and serves any date range, so nothing here keeps a
 * history: the site's snapshot (scripts/snapshot.py) reads the history from USDA and from the CSVs
 * it has already committed. The Worker holds one row, the newest report, so the board's page script
 * can show a report within half an hour of USDA posting it instead of waiting for the evening rebuild.
 *
 * The cron runs (:17 and :47) on weekdays, 6 am to 8 pm Central (lmrHours in index.js), call `beefTick`. It asks for the newest report's summary, a few
 * hundred bytes; only when USDA has posted something it hasn't stored (a new report, or a correction)
 * does it fetch the whole report with allSections=true, about 110 KB, and replace the row.
 */

const USDA = "https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2453";
export const BEEF_MAX_AGE = 600;       // ten minutes at the edge: a new report should show up soon after USDA posts it

const iso = (mdy) => { const [m, d, y] = String(mdy).split(" ")[0].split("/"); return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`; };
const mdy = (isoDay) => { const [y, m, d] = isoDay.split("-"); return `${m}/${d}/${y}`; };
const num = (v) => { if (v == null || v === "") return null; const n = Number(String(v).replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
const tidy = (s) => String(s || "").replace(/\s+/g, " ").trim();

/* GET from the datamart, always as a list of report sections. */
async function usda(path, query) {
  const r = await fetch(`${USDA}${path}?${query}`, { headers: { "User-Agent": "juantorresmi.github.io (boxed beef board)", Accept: "application/json" } });
  if (!r.ok) throw new Error("USDA said: status " + r.status);
  const body = await r.json();
  return Array.isArray(body) ? body : [body];
}

/* The cut tables: [USDA's section name, our section, grade, the field holding the description]. */
const TABLES = [
  ["Choice Cuts", "cut", "choice", "item_description"],
  ["Select Cuts", "cut", "select", "item_description"],
  ["Choice and Select Cuts", "mixed", "", "trim_description"],
  ["Ground Beef", "ground", "", "trim_description"],
  ["Blended Ground Beef", "blended", "", "trim_description"],
  ["Beef Trimmings", "trim", "", "trim_description"],
];

/* One day's allSections answer -> { day: { day, cutout and loads, published }, items: [...] }.
   scripts/snapshot.py parses the same report the same way (beef_parse); keep the two in step. */
export function parse(sections) {
  const by = Object.fromEntries(sections.map((s) => [s.reportSection, s.results || []]));
  const one = (name) => (by[name] || [])[0] || {};
  const cut = one("Current Cutout Values"), vol = one("Current Volume"), sum = one("Summary");
  const date = sum.report_date || cut.report_date;
  if (!date) return null;
  const day = {
    day: iso(date), published: sum.published_date || null,
    choice_cutout: num(cut.choice_600_900_current), select_cutout: num(cut.select_600_900_current),
    choice_loads: num(vol.choice_volume_loads), select_loads: num(vol.select_volume_loads),
    trim_loads: num(vol.trimmings_volume_loads), coarse_loads: num(vol.coarse_volume_loads),
  };
  const items = [];
  for (const r of by["Composite Primal Values"] || []) {
    for (const [grade, v] of [["choice", num(r.choice_600_900)], ["select", num(r.select_600_900)]]) {
      if (tidy(r.primal_desc) && v) items.push({ section: "primal", item: tidy(r.primal_desc), grade, low: null, high: null, wavg: v, trades: null, lbs: null });
    }
  }
  for (const [name, section, grade, field] of TABLES) {
    for (const r of by[name] || []) {
      const wavg = num(r.weighted_average), item = tidy(r[field]);
      if (!item || !wavg) continue;          // didn't trade: unknown, never $0
      items.push({ section, item, grade, low: num(r.price_range_low) || null, high: num(r.price_range_high) || null,
        wavg, trades: num(r.number_trades), lbs: num(r.total_pounds) });
    }
  }
  return { day, items };
}

const stored = async (env) => {
  const row = await env.DB.prepare("SELECT body FROM beef_latest WHERE id = 1").first();
  return row ? JSON.parse(row.body) : null;
};

/* Stores the newest report if USDA has posted one this Worker hasn't seen (or corrected one). */
export async function beefTick(env) {
  const head = ((await usda("/Summary", "lastReports=1"))[0] || {}).results || [];
  if (!head.length) return;
  const day = iso(head[0].report_date), published = head[0].published_date || null;
  const have = await stored(env);
  if (have && have.latest === day && have.published === published) return;
  const report = parse(await usda("", `q=report_date=${encodeURIComponent(mdy(day))}&allSections=true`));
  if (!report || !report.items.length) return;
  const body = { latest: report.day.day, published: report.day.published, day: report.day, items: report.items, stored: new Date().toISOString() };
  await env.DB.prepare(`INSERT INTO beef_latest (id, body, updated_at) VALUES (1, ?1, ?2)
    ON CONFLICT(id) DO UPDATE SET body = ?1, updated_at = ?2`).bind(JSON.stringify(body), body.stored).run();
}

/* GET /beef: the stored newest report. The very first request after deploying fetches it on the spot. */
export async function beefData(env) {
  let body = await stored(env);
  if (!body) { await beefTick(env); body = await stored(env); }
  return { ...(body || { latest: null, items: [] }), updated: new Date().toISOString() };
}
