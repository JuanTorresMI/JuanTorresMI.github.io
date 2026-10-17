/* The reefer rate board (/reefer-rates/ on the site): USDA's weekly spot rates for refrigerated
 * trucks, from the produce shipping districts to ten big cities.
 *
 *   GET /reefer                  the newest report: { latest, published, quotes: [...], diesel: [...], updated }
 *   GET /reefer?week=YYYY-MM-DD  any week USDA has (the Monday it covers): { latest, published, quotes, updated }
 *
 * Nothing is stored. USDA and EIA keep their own history and serve any week of it, so this Worker
 * only holds the key and does the asking: the site's snapshot (scripts/snapshot.py) reads its
 * committed CSV back first and asks here only for the weeks it doesn't settle, normally the newest
 * and the few before it (USDA sometimes corrects a report). The key never leaves Cloudflare.
 *
 * The source is USDA AMS's Specialty Crops National Truck Rate Report (report 2375), read from
 * the MyMarketNews API with a free key (secret USDA_MMN_KEY). The report posts on Wednesdays,
 * for the week starting the Monday before. Rates are per load, broker fees included.
 *
 * What the API returns is one row per district × destination × commodity, and each rate is
 * repeated for every commodity it covers (often twice). Commodities are not reliable keys: in
 * the same week lemons can appear under two different rates. So each distinct rate a district
 * quotes to a city is returned once, as a "quote", with the commodities it was listed for. Quote 0
 * is the main one, the rate that covers the most commodities; a district sometimes quotes a
 * second rate for one group (citrus, often) and that is quote 1. One week is ~700 API rows, small
 * enough to parse well inside the free plan's 10 ms of CPU.
 *
 * Diesel comes from EIA: the weekly U.S. average retail price of No. 2 diesel, which most fuel
 * surcharge schedules key to, the last two years of it. EIA_API_KEY is optional; without it the
 * Worker uses api.data.gov's shared DEMO_KEY, which is plenty for a couple of calls a day.
 */

const USDA = "https://marsapi.ams.usda.gov/services/v1.2/reports/2375";
const EIA = "https://api.eia.gov/v2/petroleum/pri/gnd/data/";
const DIESEL_SERIES = "EMD_EPD2D_PTE_NUS_DPG";
const DIESEL_WEEKS = 104;
export const REEFER_MAX_AGE = 3600;        // the newest report: it changes once a week; an hour at the edge is fine
export const REEFER_WEEK_MAX_AGE = 21600;  // a past week: six hours (a correction still shows up the same day)

const int = (v) => (v == null || v === "" ? null : Number.parseInt(String(v).replace(/[^\d+-]/g, ""), 10));
const iso = (mdy) => { const [m, d, y] = String(mdy).split(" ")[0].split("/"); return `${y}-${m}-${d}`; };
const mdy = (isoDay) => { const [y, m, d] = isoDay.split("-"); return `${m}/${d}/${y}`; };

async function usda(env, query) {
  if (!env.USDA_MMN_KEY) throw new Error("This Worker has no USDA_MMN_KEY set. See worker/README.md.");
  const r = await fetch(`${USDA}?${query}`, { headers: { Authorization: "Basic " + btoa(env.USDA_MMN_KEY + ":") } });
  if (!r.ok) throw new Error("USDA said: status " + r.status);
  const body = await r.json();
  const sec = Array.isArray(body) ? body[0] : body;
  return (sec && sec.results) || [];
}

/* API rows -> one quote per distinct rate per district and city. */
export function toQuotes(rows) {
  const groups = new Map();
  for (const r of rows) {
    const week = iso(r.report_Begin_Date || r.report_Date);
    const key = [week, r.district, r.destination_city].join("|");
    const rate = [int(r.low_price), int(r.high_price), int(r.mostly_low_price), int(r.mostly_high_price), r.truck_availability || null].join("|");
    if (!groups.has(key)) groups.set(key, new Map());
    const g = groups.get(key);
    if (!g.has(rate)) g.set(rate, { row: r, commodities: new Set() });
    g.get(rate).commodities.add(r.commodity);
  }
  const out = [];
  for (const [key, rates] of groups) {
    const [week, district, dest] = key.split("|");
    [...rates.values()]
      .sort((a, b) => b.commodities.size - a.commodities.size || int(a.row.low_price) - int(b.row.low_price))
      .forEach(({ row, commodities }, quote) => out.push({
        week, district, dest, quote,
        low: int(row.low_price), high: int(row.high_price),
        mostly_low: int(row.mostly_low_price), mostly_high: int(row.mostly_high_price),
        change_pct: int(row["price_change (%)"]),
        availability: row.truck_availability || null,
        commodities: [...commodities].sort(),
        published: row.published_date || null,
      }));
  }
  return out.sort((a, b) => a.district.localeCompare(b.district) || a.dest.localeCompare(b.dest) || a.quote - b.quote);
}

/* EIA's weekly U.S. diesel price, oldest first. A failure here never blocks the rates. */
async function diesel(env) {
  const q = new URLSearchParams({ frequency: "weekly", "data[0]": "value", "facets[series][]": DIESEL_SERIES,
    "sort[0][column]": "period", "sort[0][direction]": "desc", length: String(DIESEL_WEEKS),
    api_key: env.EIA_API_KEY || "DEMO_KEY" });
  const r = await fetch(`${EIA}?${q}`);
  if (!r.ok) throw new Error("EIA said: status " + r.status);
  const rows = ((await r.json()).response || {}).data || [];
  return rows.filter((x) => x.period && x.value != null).map((x) => ({ week: x.period, price: Number(x.value) })).reverse();
}

/* GET /reefer and /reefer?week=: one week's quotes, straight from USDA. */
export async function reeferWeek(env, week) {
  const quotes = toQuotes(await usda(env, week ? "q=report_begin_date=" + encodeURIComponent(mdy(week)) : "lastReports=1"));
  const newest = quotes.reduce((w, q) => (q.week > w ? q.week : w), "");
  const mine = quotes.filter((q) => q.week === newest);
  const out = {
    latest: newest || null,
    published: mine.reduce((p, q) => (q.published && q.published > p ? q.published : p), "") || null,
    quotes: mine.map(({ week: _w, published: _p, ...q }) => q),
    updated: new Date().toISOString(),
  };
  if (!week) {
    try { out.diesel = await diesel(env); }
    catch (e) { console.error("diesel:", e.message || e); out.diesel = []; }
  }
  return out;
}
