/* The pork board (/pork-prices/ on the site): USDA's daily pork carcass cutout, its six primals and
 * the price of every pork cut that traded, from negotiated sales.
 *
 *   GET /pork    the newest report: { latest, published, day, items, updated }
 *
 * The source is USDA AMS's National Daily Pork FOB Plant, Negotiated Sales, afternoon edition
 * (LM_PK602, report 2498), from the Livestock Mandatory Reporting datamart, which needs no key. It
 * posts every business day mid-afternoon, Central time. Prices are dollars per hundredweight, FOB
 * the plant. The pork report has no grades: each item has one price a day.
 *
 * As with beef (beef.js), USDA keeps the history and scripts/snapshot.py reads it from there, so the
 * Worker holds one row, the newest report, for the page script that shows it within half an hour.
 * The cron runs on weekdays, 6 am to 8 pm Central, call `porkTick`: a summary of a few hundred bytes, and the whole report only when
 * USDA has posted something new or corrected.
 */

const USDA = "https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2498";
export const PORK_MAX_AGE = 600;

const iso = (mdy) => { const [m, d, y] = String(mdy).split(" ")[0].split("/"); return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`; };
const mdy = (isoDay) => { const [y, m, d] = isoDay.split("-"); return `${m}/${d}/${y}`; };
const num = (v) => { if (v == null || v === "") return null; const n = Number(String(v).replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
const tidy = (s) => String(s || "").replace(/\s+/g, " ").trim();

async function usda(path, query) {
  const r = await fetch(`${USDA}${path}?${query}`, { headers: { "User-Agent": "juantorresmi.github.io (pork board)", Accept: "application/json" } });
  if (!r.ok) throw new Error("USDA said: status " + r.status);
  const body = await r.json();
  return Array.isArray(body) ? body : [body];
}

const TABLES = ["Loin Cuts", "Butt Cuts", "Picnic Cuts", "Ham Cuts", "Belly Cuts", "Sparerib Cuts", "Jowl Cuts", "Trim Cuts", "Variety Cuts", "Added Ingredients Cuts"];

/* One day's allSections answer -> { day, items }. scripts/snapshot.py (pork_usda) reads the same
   report the same way; keep the two in step. */
export function parse(sections) {
  const by = Object.fromEntries(sections.map((s) => [s.reportSection, s.results || []]));
  const one = (name) => (by[name] || [])[0] || {};
  const v = one("Cutout and Primal Values"), vol = one("Current Volume"), sum = one("Summary");
  const date = sum.report_date || v.report_date;
  if (!date || num(v.pork_carcass) == null) return null;
  const day = {
    day: iso(date), published: sum.published_date || null,
    carcass: num(v.pork_carcass), loin: num(v.pork_loin), butt: num(v.pork_butt), picnic: num(v.pork_picnic),
    rib: num(v.pork_rib), ham: num(v.pork_ham), belly: num(v.pork_belly),
    loads: num(v.total_loads_date_1), cut_loads: num(vol.temp_cuts_total_load),
  };
  const items = [];
  for (const name of TABLES) {
    for (const r of by[name] || []) {
      const wavg = num(r.weighted_average), item = tidy(r.Item_Description);
      if (!item || !wavg) continue;          // didn't trade: unknown, never $0
      items.push({ item, low: num(r.price_range_low) || null, high: num(r.price_range_high) || null, wavg, lbs: num(r.total_pounds) });
    }
  }
  return { day, items };
}

const stored = async (env) => {
  const row = await env.DB.prepare("SELECT body FROM pork_latest WHERE id = 1").first();
  return row ? JSON.parse(row.body) : null;
};

export async function porkTick(env) {
  const head = ((await usda("/Summary", "lastReports=1"))[0] || {}).results || [];
  if (!head.length) return;
  const day = iso(head[0].report_date), published = head[0].published_date || null;
  const have = await stored(env);
  if (have && have.latest === day && have.published === published) return;
  const report = parse(await usda("", `q=report_date=${encodeURIComponent(mdy(day))}&allSections=true`));
  if (!report || !report.items.length) return;
  const body = { latest: report.day.day, published: report.day.published, day: report.day, items: report.items, stored: new Date().toISOString() };
  await env.DB.prepare(`INSERT INTO pork_latest (id, body, updated_at) VALUES (1, ?1, ?2)
    ON CONFLICT(id) DO UPDATE SET body = ?1, updated_at = ?2`).bind(JSON.stringify(body), body.stored).run();
}

export async function porkData(env) {
  let body = await stored(env);
  if (!body) { await porkTick(env); body = await stored(env); }
  return { ...(body || { latest: null, items: [] }), updated: new Date().toISOString() };
}
