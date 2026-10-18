/* The border wait board (/border-waits/ on the site): how long trucks wait at the U.S. land ports
 * on the Mexican and Canadian borders, and, the part nobody else keeps, how long they usually wait
 * at each hour of each day of the week.
 *
 *   GET /border             { updated, ports: [{ port, border, name, crossing, hours, status, max, std, fast, notice, posted_at, age }] }
 *   GET /border/port?id=P   { port, first, days, profile: [[dow, hour, std_avg, std_n, fast_avg, fast_n]], recent: [[at, std, std_lanes, fast, fast_lanes]] }
 *
 * The source is CBP's public Border Wait Times feed (bwt.cbp.gov/api/waittimes), no key needed.
 * CBP keeps no past readings (its "historical" API is last year's monthly averages by weekday and
 * hour), so this records them, from Oct 14, 2026. Sep 13 to Oct 14 was filled once from an
 * independent hourly archive of the same feed (scripts/border-backfill.mjs).
 * It lists ~85 ports; about 50 have commercial lanes, and only those are kept. Each port's officers
 * post a reading roughly once an hour ("At 10:00 am CDT"), standard and FAST lanes together.
 *
 * Both cron ticks (:17 and :47) read the feed. A reading is stored once, keyed on the port and the
 * time it was posted, so asking twice an hour never stores one twice. Times are the port's own wall
 * clock, which is what "the best hour to cross" means; the feed's date and time fields are already
 * local to each port, so no time zone has to be guessed (CBP's zone labels are not always right:
 * Arizona ports say PST, Port Huron says EST in October).
 *
 * A closed lane or a reading still pending has no wait. That is unknown, not zero: it is stored as
 * NULL, and NULLs drop out of every average. Off-hours (a port that closes at 10 PM) store nothing.
 */

const CBP = "https://bwt.cbp.gov/api/waittimes";
export const BORDER_MAX_AGE = 300;          // the live board: five minutes at the edge
export const BORDER_PORT_MAX_AGE = 3600;    // a crossing's history moves slowly
const PROFILE_DAYS = 30;
const RECENT_DAYS = 7;

const num = (v) => (v == null || v === "" || !/^\d+$/.test(String(v).trim()) ? null : Number(v));
const pad = (n) => String(n).padStart(2, "0");

/* One lane group ("standard_lanes" or "FAST_lanes") -> { delay, lanes, status, update }. A wait is
   only a number when CBP says "delay" or "no delay"; "Lanes Closed", "Update Pending" and "N/A"
   are unknowns. */
function lane(l) {
  l = l || {};
  const status = String(l.operational_status || "").trim();
  const known = status === "delay" || status === "no delay";
  return { delay: known ? num(l.delay_minutes) : null, lanes: num(l.lanes_open), status: status || null, update: String(l.update_time || "").trim() || null };
}

/* "At 10:00 am CDT", "At Noon EDT", "At Midnight PST" -> minutes after local midnight. */
function clock(s) {
  const m = /At\s+(Noon|Midnight|(\d{1,2}):(\d{2})\s*([ap])\.?m\.?)/i.exec(s || "");
  if (!m) return null;
  if (/noon/i.test(m[1])) return 12 * 60;
  if (/midnight/i.test(m[1])) return 0;
  const h = Number(m[2]) % 12 + (m[4].toLowerCase() === "p" ? 12 : 0);
  return h * 60 + Number(m[3]);
}

const minutesOf = (time) => { const t = /^(\d{1,2}):(\d{2})/.exec(String(time || "").trim()); return t ? Number(t[1]) * 60 + Number(t[2]) : null; };

/* The port's local date ("M/D/YYYY": CBP doesn't pad, "10/1/2026") and time ("HH:MM:SS") of the feed, plus the posted clock
   time -> "YYYY-MM-DD HH:MM", the local moment the reading was posted. A posted time later than
   the feed's own clock was yesterday's (a port that last posted at 11 PM). */
function posted(date, time, minutes) {
  const d = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(date || "").trim());
  const t = /^(\d{1,2}):(\d{2})/.exec(String(time || "").trim());
  if (!d || !t || minutes == null) return null;
  let day = Date.UTC(Number(d[3]), Number(d[1]) - 1, Number(d[2]));
  if (minutes > Number(t[1]) * 60 + Number(t[2]) + 15) day -= 86400000;
  const when = new Date(day + minutes * 60000);
  return {
    at: `${when.getUTCFullYear()}-${pad(when.getUTCMonth() + 1)}-${pad(when.getUTCDate())} ${pad(when.getUTCHours())}:${pad(when.getUTCMinutes())}`,
    dow: (when.getUTCDay() + 6) % 7,          // 0 = Monday
    hour: when.getUTCHours(),
  };
}

/* The feed -> the commercial ports, shaped for the board. */
export function toPorts(feed) {
  const out = [];
  for (const x of Array.isArray(feed) ? feed : []) {
    const c = x && x.commercial_vehicle_lanes;
    const max = c && num(c.maximum_lanes);
    if (!max) continue;                                   // no truck lanes here
    const std = lane(c.standard_lanes), fast = lane(c.FAST_lanes);
    out.push({
      port: String(x.port_number),
      border: /mex/i.test(x.border) ? "mexico" : "canada",
      name: String(x.port_name || "").trim(),
      crossing: String(x.crossing_name || "").trim(),
      hours: String(x.hours || "").trim(),
      status: String(x.port_status || "").trim(),
      max,
      std, fast,
      notice: String(x.construction_notice || "").trim() || null,
      reading: x.port_status === "Open" ? posted(x.date, x.time, clock(std.update || fast.update)) : null,
    });
    // How old the reading was when the feed was read, in minutes, so a page can say "40 min ago"
    // or warn that a port hasn't posted since last night. The feed's own clock is the port's,
    // except in Arizona (CBP district 26), where it runs on daylight time the state doesn't keep.
    const r = out[out.length - 1].reading, now = posted(x.date, x.time, minutesOf(x.time));
    const skew = String(x.port_number).startsWith("26") ? 60 : 0;
    out[out.length - 1].posted_at = r ? r.at : null;
    out[out.length - 1].age = r && now ? Math.max(0, Math.round((Date.parse(now.at.replace(" ", "T") + "Z") - Date.parse(r.at.replace(" ", "T") + "Z")) / 60000 - skew)) : null;
  }
  return out;
}

export async function borderTick(env) {
  const r = await fetch(CBP, { headers: { "User-Agent": "juantorresmi.github.io border board" } });
  if (!r.ok) throw new Error("CBP said: status " + r.status);
  const ports = toPorts(await r.json());
  if (!ports.length) throw new Error("CBP sent no ports");

  const readings = ports
    .filter((p) => p.reading && (p.std.delay != null || p.fast.delay != null))
    .map((p) => [p.port, p.reading.at, p.reading.dow, p.reading.hour, p.std.delay, p.std.lanes, p.fast.delay, p.fast.lanes]);
  const now = new Date().toISOString();
  // Two statements however many ports: every reading from one JSON array (a reading already
  // stored is skipped), and the board as served. See reefer.js on the free plan's query limit.
  const stmts = [env.DB.prepare("INSERT INTO border_latest (id, body, updated_at) VALUES (1, ?1, ?2) ON CONFLICT(id) DO UPDATE SET body = ?1, updated_at = ?2")
    .bind(JSON.stringify({ ports: ports.map(({ reading, ...p }) => p), updated: now }), now)];
  if (readings.length) stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO border_waits (port, at, dow, hour, std_delay, std_lanes, fast_delay, fast_lanes)
    SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), json_extract(value, '$[3]'),
      json_extract(value, '$[4]'), json_extract(value, '$[5]'), json_extract(value, '$[6]'), json_extract(value, '$[7]')
    FROM json_each(?1)`).bind(JSON.stringify(readings)));
  await env.DB.batch(stmts);
  return { ports: ports.length, readings: readings.length };
}

/* GET /border: what the last tick saw. */
export async function borderNow(env) {
  const row = await env.DB.prepare("SELECT body FROM border_latest WHERE id = 1").first();
  if (row) return JSON.parse(row.body);
  await borderTick(env);                       // the very first request after deploying
  return JSON.parse((await env.DB.prepare("SELECT body FROM border_latest WHERE id = 1").first()).body);
}

/* GET /border/port?id=P: one crossing's last 30 days, averaged by weekday and hour, and its last
   7 days of readings. Local times compared as text, so the cut-off is a day or so loose; fine. */
export async function borderPort(env, port, now = new Date()) {
  const since = (days) => new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  const [profile, recent, first] = await env.DB.batch([
    env.DB.prepare(`SELECT dow, hour, ROUND(AVG(std_delay), 1) AS s, COUNT(std_delay) AS sn, ROUND(AVG(fast_delay), 1) AS f, COUNT(fast_delay) AS fn
      FROM border_waits WHERE port = ?1 AND at >= ?2 GROUP BY dow, hour ORDER BY dow, hour`).bind(port, since(PROFILE_DAYS)),
    env.DB.prepare("SELECT at, std_delay, std_lanes, fast_delay, fast_lanes FROM border_waits WHERE port = ?1 AND at >= ?2 ORDER BY at")
      .bind(port, since(RECENT_DAYS)),
    // The count is the 30-day window's, so it reads at most a month of one port's rows however long
    // the record gets; MIN(at) is answered from the primary key, one row.
    env.DB.prepare("SELECT (SELECT MIN(at) FROM border_waits WHERE port = ?1) AS first, COUNT(*) AS n FROM border_waits WHERE port = ?1 AND at >= ?2")
      .bind(port, since(PROFILE_DAYS)),
  ]);
  const f = first.results[0] || {};
  return {
    port,
    first: f.first || null,
    readings: f.n || 0,
    days: PROFILE_DAYS,
    profile: profile.results.map((r) => [r.dow, r.hour, r.s, r.sn, r.f, r.fn]),
    recent: recent.results.map((r) => [r.at, r.std_delay, r.std_lanes, r.fast_delay, r.fast_lanes]),
    updated: now.toISOString(),
  };
}
