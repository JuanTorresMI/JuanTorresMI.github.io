/* The boxed beef board (/beef-prices/ on the site): USDA's daily boxed beef cutout and the price
 * of every cut that traded, from negotiated sales between packers and their buyers.
 *
 *   GET /beef                         { latest, first, published, months, backfill_done, day, prior, items, updated }
 *   GET /beef/history?month=YYYY-MM   { month, days: [[day, choice, select, loads...]], items: [{ section, item, grade, days: [[day, low, high, wavg, trades, lbs]] }] }
 *
 * History comes a month at a time so no single request has to read and serialize every row (the
 * free plan gives a request 10 ms of CPU). The site's twice-daily snapshot (scripts/snapshot.py)
 * reads every month and writes the pages and the downloads; visitors never call this.
 *
 * The source is USDA AMS's National Daily Boxed Beef Cutout & Boxed Beef Cuts, Negotiated Sales,
 * afternoon edition (LM_XB403, report 2453), from the Livestock Mandatory Reporting datamart. It
 * needs no key. It posts every business day in the middle of the afternoon. Prices are dollars per
 * hundredweight (100 lb), FOB the plant, for product delivered within 0 to 21 days.
 *
 * One request with allSections=true returns the whole report: the cutout values, the seven primal
 * values, the volume in loads, and one row per cut for Choice and for Select, plus ground beef and
 * trimmings. A cut that didn't trade that day comes back as $0.00 with no trades; that is unknown,
 * not free, so it is not stored at all. Items are kept under USDA's own description (whitespace
 * tidied), which hasn't changed since 2020; the site maps those to plain names and page addresses.
 *
 * The cron job (`beefTick`, at :02 and :32, a trigger of its own so it never shares a run's CPU
 * with the other boards) first asks for the newest report's summary, which is a few hundred
 * bytes. A report it hasn't stored is fetched and stored, and that is the run's work. Otherwise it
 * backfills one older week (about 540 KB, a millisecond or two to parse), walking back to
 * BEEF_START, so the whole history fills in over about a week without anyone doing anything.
 */

const USDA = "https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2453";
const BEEF_START = "2020-01-01";        // how far back the backfill walks; earlier years exist if ever wanted
export const BEEF_MAX_AGE = 3600;      // a new report comes once a day; an hour at the edge is fine

const iso = (mdy) => { const [m, d, y] = String(mdy).split(" ")[0].split("/"); return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`; };
const mdy = (isoDay) => { const [y, m, d] = isoDay.split("-"); return `${m}/${d}/${y}`; };
const addDays = (isoDay, n) => new Date(Date.parse(isoDay + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
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

/* allSections answer -> { days: [{ day, ...cutout and loads }], items: [{ day, section, item, grade, ... }] } */
export function parse(sections) {
  const by = Object.fromEntries(sections.map((s) => [s.reportSection, s.results || []]));
  const days = new Map();
  const dayOf = (d) => {
    if (!days.has(d)) days.set(d, { day: d, choice_cutout: null, select_cutout: null, choice_loads: null, select_loads: null, trim_loads: null, coarse_loads: null, published: null });
    return days.get(d);
  };
  for (const r of by["Summary"] || []) dayOf(iso(r.report_date)).published = r.published_date || null;
  for (const r of by["Current Cutout Values"] || []) Object.assign(dayOf(iso(r.report_date)), { choice_cutout: num(r.choice_600_900_current), select_cutout: num(r.select_600_900_current) });
  for (const r of by["Current Volume"] || []) Object.assign(dayOf(iso(r.report_date)), {
    choice_loads: num(r.choice_volume_loads), select_loads: num(r.select_volume_loads),
    trim_loads: num(r.trimmings_volume_loads), coarse_loads: num(r.coarse_volume_loads) });

  const items = [];
  for (const r of by["Composite Primal Values"] || []) {
    const day = iso(r.report_date), item = tidy(r.primal_desc);
    for (const [grade, v] of [["choice", num(r.choice_600_900)], ["select", num(r.select_600_900)]]) {
      if (item && v) items.push({ day, section: "primal", item, grade, low: null, high: null, wavg: v, trades: null, lbs: null });
    }
  }
  for (const [name, section, grade, field] of TABLES) {
    for (const r of by[name] || []) {
      const wavg = num(r.weighted_average), item = tidy(r[field]);
      if (!item || !wavg) continue;          // didn't trade: unknown, never $0
      items.push({ day: iso(r.report_date), section, item, grade, low: num(r.price_range_low) || null, high: num(r.price_range_high) || null,
        wavg, trades: num(r.number_trades), lbs: num(r.total_pounds) });
    }
  }
  // A day with no cutout and no prices (a reporting gap, or a pre-2012 day with nulls) isn't a day.
  const kept = [...days.values()].filter((d) => d.choice_cutout != null || items.some((i) => i.day === d.day));
  return { days: kept, items: items.filter((i) => kept.some((d) => d.day === i.day)) };
}

async function store(env, { days, items }, from, to) {
  // Four statements however many rows: clear the span (a correction can drop a cut), then insert
  // everything from one JSON array each. The free plan allows only so many queries per run.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM beef_items WHERE day >= ?1 AND day <= ?2").bind(from, to),
    env.DB.prepare("DELETE FROM beef_days WHERE day >= ?1 AND day <= ?2").bind(from, to),
    env.DB.prepare(`INSERT INTO beef_days (day, choice_cutout, select_cutout, choice_loads, select_loads, trim_loads, coarse_loads, published)
      SELECT json_extract(value, '$.day'), json_extract(value, '$.choice_cutout'), json_extract(value, '$.select_cutout'),
        json_extract(value, '$.choice_loads'), json_extract(value, '$.select_loads'), json_extract(value, '$.trim_loads'),
        json_extract(value, '$.coarse_loads'), json_extract(value, '$.published')
      FROM json_each(?1)`).bind(JSON.stringify(days)),
    env.DB.prepare(`INSERT INTO beef_items (day, section, item, grade, low, high, wavg, trades, lbs)
      SELECT json_extract(value, '$.day'), json_extract(value, '$.section'), json_extract(value, '$.item'), json_extract(value, '$.grade'),
        json_extract(value, '$.low'), json_extract(value, '$.high'), json_extract(value, '$.wavg'), json_extract(value, '$.trades'), json_extract(value, '$.lbs')
      FROM json_each(?1)`).bind(JSON.stringify(items)),
  ]);
}

const meta = async (env, key) => ((await env.DB.prepare("SELECT value FROM beef_meta WHERE key = ?1").bind(key).first()) || {}).value;
const setMeta = (env, key, value) => env.DB.prepare("INSERT INTO beef_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2").bind(key, String(value)).run();

/* Stores the newest report if it is new (or was corrected since). True if it stored anything. */
async function latest(env) {
  const head = ((await usda("/Summary", "lastReports=1"))[0] || {}).results || [];
  if (!head.length) return false;
  const day = iso(head[0].report_date), published = head[0].published_date || null;
  const have = await env.DB.prepare("SELECT published FROM beef_days WHERE day = ?1").bind(day).first();
  if (have && have.published === published) return false;
  const parsed = parse(await usda("", `q=report_date=${encodeURIComponent(mdy(day))}&allSections=true`));
  if (!parsed.days.length) return false;
  await store(env, parsed, day, day);
  return true;
}

/* One older week per call, back to BEEF_START. A week USDA has nothing for (a federal shutdown
   suspended mandatory reporting in 2013, for one) just moves the walk along. */
async function backfill(env) {
  if ((await meta(env, "backfill_done")) === "1") return;
  let before = await meta(env, "backfill_before");
  if (!before) {
    const oldest = await env.DB.prepare("SELECT day FROM beef_days ORDER BY day LIMIT 1").first();
    if (!oldest) return;                                  // wait for the first report
    before = oldest.day;
  }
  const from = [addDays(before, -7), BEEF_START].sort()[1], to = addDays(before, -1);   // never before BEEF_START
  const parsed = parse(await usda("", `q=report_date=${encodeURIComponent(mdy(from) + ":" + mdy(to))}&allSections=true`));
  if (parsed.days.length) await store(env, parsed, from, to);
  await setMeta(env, "backfill_before", from);
  if (from <= BEEF_START) await setMeta(env, "backfill_done", 1);
}

export async function beefTick(env) {
  if (await latest(env)) return;
  await backfill(env);
}

const months = (first, last) => {
  const out = [];
  let [y, m] = first.slice(0, 7).split("-").map(Number);
  const end = last.slice(0, 7);
  for (;;) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    out.push(k);
    if (k >= end) return out;
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
};

/* GET /beef: the newest report whole, the day before it, and which months have history. */
export async function beefData(env) {
  // Two one-row reads, not MIN and MAX together, which SQLite answers by scanning the table.
  const [top, bottom] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM beef_days ORDER BY day DESC LIMIT 2"),
    env.DB.prepare("SELECT day FROM beef_days ORDER BY day LIMIT 1"),
  ]);
  const [day, prior] = top.results;
  if (!day) return { latest: null, items: [], months: [], updated: new Date().toISOString() };
  const { results } = await env.DB.prepare("SELECT section, item, grade, low, high, wavg, trades, lbs FROM beef_items WHERE day = ?1 ORDER BY section, item, grade").bind(day.day).all();
  const first = bottom.results[0].day;
  return {
    latest: day.day, first, start: BEEF_START, published: day.published,
    months: months(first, day.day),
    backfill_done: (await meta(env, "backfill_done")) === "1",
    day, prior: prior || null, items: results,
    updated: new Date().toISOString(),
  };
}

/* GET /beef/history?month=YYYY-MM: every day of that month, compact. */
export async function beefHistory(env, month) {
  const from = `${month}-01`, to = `${month}-31`;
  const [d, i] = await env.DB.batch([
    env.DB.prepare("SELECT day, choice_cutout, select_cutout, choice_loads, select_loads, trim_loads, coarse_loads FROM beef_days WHERE day >= ?1 AND day <= ?2 ORDER BY day").bind(from, to),
    env.DB.prepare("SELECT day, section, item, grade, low, high, wavg, trades, lbs FROM beef_items WHERE day >= ?1 AND day <= ?2 ORDER BY section, item, grade, day").bind(from, to),
  ]);
  const items = new Map();
  for (const r of i.results) {
    const k = r.section + "|" + r.item + "|" + r.grade;
    if (!items.has(k)) items.set(k, { section: r.section, item: r.item, grade: r.grade, days: [] });
    items.get(k).days.push([r.day, r.low, r.high, r.wavg, r.trades, r.lbs]);
  }
  return {
    month,
    days: d.results.map((r) => [r.day, r.choice_cutout, r.select_cutout, r.choice_loads, r.select_loads, r.trim_loads, r.coarse_loads]),
    items: [...items.values()],
  };
}
