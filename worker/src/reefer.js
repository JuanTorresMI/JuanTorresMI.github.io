/* The reefer rate board (/reefer-rates/ on the site): USDA's weekly spot rates for refrigerated
 * trucks, from the produce shipping districts to ten big cities.
 *
 *   GET /reefer                 { latest, published, quotes: [...], diesel: [...], years: [...], updated }
 *   GET /reefer/history?year=Y  { year, lanes: [{ district, dest, weeks: [[week, low, high, ...]] }] }
 *
 * History comes a year at a time so no single request has to read and serialize every row:
 * the free plan gives a request 10 ms of CPU. For the same reason there is no CSV here: the
 * site's daily snapshot (scripts/snapshot.py) writes the download as a static file.
 *
 * The source is USDA AMS's Specialty Crops National Truck Rate Report (report 2375), read from
 * the MyMarketNews API with a free key (secret USDA_MMN_KEY). The report posts on Wednesdays,
 * for the week starting the Monday before. Rates are per load, broker fees included.
 *
 * What the API returns is one row per district × destination × commodity, and each rate is
 * repeated for every commodity it covers (often twice). Commodities are not reliable keys: in
 * the same week lemons can appear under two different rates. So each distinct rate a district
 * quotes to a city is stored once, as a "quote", with the commodities it was listed for. Quote 0
 * is the main one, the rate that covers the most commodities; a district sometimes quotes a
 * second rate for one group (citrus, often) and that is quote 1.
 *
 * Diesel comes from EIA: the weekly U.S. average retail price of No. 2 diesel, which most fuel
 * surcharge schedules key to. EIA_API_KEY is optional; without it the Worker uses api.data.gov's
 * shared DEMO_KEY, which is plenty for one call every few hours.
 *
 * The cron job (`reeferTick`, every hour at :47) does one of two things: every sixth hour it asks
 * for the newest report and the diesel price, and the other hours it backfills one older week,
 * walking back until USDA has nothing older. One week is ~700 API rows, small enough to parse
 * inside the free plan's CPU limit, so the full history (back to early 2024) fills in over a
 * week or so without anyone doing anything.
 */

const USDA = "https://marsapi.ams.usda.gov/services/v1.2/reports/2375";
const EIA = "https://api.eia.gov/v2/petroleum/pri/gnd/data/";
const DIESEL_SERIES = "EMD_EPD2D_PTE_NUS_DPG";
const BACKFILL_GIVE_UP = 26;       // half a year of empty weeks in a row: the history has ended, not paused
export const REEFER_MAX_AGE = 3600;   // the data changes once a week; an hour at the edge is fine

const int = (v) => (v == null || v === "" ? null : Number.parseInt(String(v).replace(/[^\d+-]/g, ""), 10));
const iso = (mdy) => { const [m, d, y] = String(mdy).split(" ")[0].split("/"); return `${y}-${m}-${d}`; };
const mdy = (isoDay) => { const [y, m, d] = isoDay.split("-"); return `${m}/${d}/${y}`; };
const addDays = (isoDay, n) => new Date(Date.parse(isoDay + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

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
        commodities: JSON.stringify([...commodities].sort()),
        published: row.published_date || null,
      }));
  }
  return out;
}

async function store(env, quotes) {
  const sql = `INSERT INTO reefer_quotes (week, district, dest, quote, low, high, mostly_low, mostly_high, change_pct, availability, commodities, published)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
    ON CONFLICT(week, district, dest, quote) DO UPDATE SET low = ?5, high = ?6, mostly_low = ?7, mostly_high = ?8,
      change_pct = ?9, availability = ?10, commodities = ?11, published = ?12`;
  const stmts = quotes.map((q) => env.DB.prepare(sql).bind(q.week, q.district, q.dest, q.quote, q.low, q.high,
    q.mostly_low, q.mostly_high, q.change_pct, q.availability, q.commodities, q.published));
  // A week can lose a quote on a correction; clear the week first so no stale quote 1 survives.
  const weeks = [...new Set(quotes.map((q) => q.week))];
  const clear = weeks.map((w) => env.DB.prepare("DELETE FROM reefer_quotes WHERE week = ?1").bind(w));
  for (let i = 0; i < stmts.length; i += 400) await env.DB.batch(i === 0 ? [...clear, ...stmts.slice(0, 400)] : stmts.slice(i, i + 400));
}

const meta = async (env, key) => ((await env.DB.prepare("SELECT value FROM reefer_meta WHERE key = ?1").bind(key).first()) || {}).value;
const setMeta = (env, key, value) => env.DB.prepare("INSERT INTO reefer_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2").bind(key, String(value)).run();

async function latest(env) {
  const quotes = toQuotes(await usda(env, "lastReports=1"));
  if (!quotes.length) return;
  // Asked every six hours, but a new report comes once a week: skip the rewrite if this one,
  // published at this time, is already stored.
  const have = await env.DB.prepare("SELECT MAX(published) AS p FROM reefer_quotes WHERE week = ?1").bind(quotes[0].week).first();
  if (have && have.p && have.p === quotes[0].published) return;
  await store(env, quotes);
}

async function diesel(env) {
  const have = await env.DB.prepare("SELECT COUNT(*) AS n FROM diesel_weekly").first();
  const q = new URLSearchParams({ frequency: "weekly", "data[0]": "value", "facets[series][]": DIESEL_SERIES,
    "sort[0][column]": "period", "sort[0][direction]": "desc", length: have && have.n > 0 ? "8" : "520",
    api_key: env.EIA_API_KEY || "DEMO_KEY" });
  const r = await fetch(`${EIA}?${q}`);
  if (!r.ok) throw new Error("EIA said: status " + r.status);
  const rows = ((await r.json()).response || {}).data || [];
  const stmts = rows.filter((x) => x.period && x.value != null).map((x) =>
    env.DB.prepare("INSERT INTO diesel_weekly (week, price) VALUES (?1, ?2) ON CONFLICT(week) DO UPDATE SET price = ?2").bind(x.period, Number(x.value)));
  for (let i = 0; i < stmts.length; i += 400) await env.DB.batch(stmts.slice(i, i + 400));
}

/* One older week per call, until BACKFILL_GIVE_UP empty weeks in a row. */
async function backfill(env) {
  if ((await meta(env, "backfill_done")) === "1") return false;
  let before = await meta(env, "backfill_before");
  if (!before) {
    const oldest = await env.DB.prepare("SELECT MIN(week) AS w FROM reefer_quotes").first();
    if (!oldest || !oldest.w) return false;            // wait for the first report
    before = oldest.w;
  }
  const week = addDays(before, -7);
  const quotes = toQuotes(await usda(env, "q=report_begin_date=" + encodeURIComponent(mdy(week))));
  if (quotes.length) { await store(env, quotes); await setMeta(env, "backfill_misses", 0); }
  else {
    const misses = Number((await meta(env, "backfill_misses")) || 0) + 1;
    await setMeta(env, "backfill_misses", misses);
    if (misses >= BACKFILL_GIVE_UP) await setMeta(env, "backfill_done", 1);
  }
  await setMeta(env, "backfill_before", week);
  return true;
}

export async function reeferTick(env, when = new Date()) {
  const fresh = (await env.DB.prepare("SELECT COUNT(*) AS n FROM reefer_quotes").first()).n === 0;
  if (fresh || when.getUTCHours() % 6 === 0) {
    await latest(env);
    await diesel(env).catch((e) => console.error("diesel:", e.message || e));   // never blocks the rates
    return;
  }
  await backfill(env);
}

/* GET /reefer: the newest week's quotes, the diesel line, and which years have history. */
export async function reeferData(env) {
  const top = await env.DB.prepare("SELECT MAX(week) AS w, MIN(week) AS first FROM reefer_quotes").first();
  if (!top || !top.w) return { latest: null, quotes: [], diesel: [], years: [], updated: new Date().toISOString() };
  const [cur, fuel, pub] = await env.DB.batch([
    env.DB.prepare("SELECT district, dest, quote, low, high, mostly_low, mostly_high, change_pct, availability, commodities FROM reefer_quotes WHERE week = ?1 ORDER BY district, dest, quote").bind(top.w),
    env.DB.prepare("SELECT week, price FROM diesel_weekly ORDER BY week DESC LIMIT 104"),
    env.DB.prepare("SELECT MAX(published) AS p FROM reefer_quotes WHERE week = ?1").bind(top.w),
  ]);
  const years = [];
  for (let y = Number(top.first.slice(0, 4)); y <= Number(top.w.slice(0, 4)); y++) years.push(y);
  return {
    latest: top.w,
    first: top.first,
    published: (pub.results[0] || {}).p || null,
    quotes: cur.results.map((q) => ({ ...q, commodities: JSON.parse(q.commodities || "[]") })),
    diesel: fuel.results.reverse(),
    years,
    backfill_done: (await meta(env, "backfill_done")) === "1",
    updated: new Date().toISOString(),
  };
}

/* GET /reefer/history?year=Y: every lane's main quote for each week of that year, as compact
   rows [week, low, high, mostly_low, mostly_high, change_pct, availability]. */
export async function reeferHistory(env, year) {
  const { results } = await env.DB.prepare(`SELECT week, district, dest, low, high, mostly_low, mostly_high, change_pct, availability
    FROM reefer_quotes WHERE quote = 0 AND week >= ?1 AND week <= ?2 ORDER BY district, dest, week`).bind(`${year}-01-01`, `${year}-12-31`).all();
  const lanes = new Map();
  for (const r of results) {
    const k = r.district + "|" + r.dest;
    if (!lanes.has(k)) lanes.set(k, { district: r.district, dest: r.dest, weeks: [] });
    lanes.get(k).weeks.push([r.week, r.low, r.high, r.mostly_low, r.mostly_high, r.change_pct, r.availability]);
  }
  return { year, lanes: [...lanes.values()] };
}
