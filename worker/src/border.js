/* The border wait board (/border-waits/ on the site): how long trucks wait at the U.S. land ports
 * on the Mexican and Canadian borders, and, the part nobody else keeps, how long they usually wait
 * at each hour of each day of the week.
 *
 *   GET /border             { updated, ports: [{ port, border, name, crossing, hours, status, max, std, fast, notice, posted_at, age }] }
 *   GET /border/readings?since=YYYY-MM-DD   { since, oldest, buffer_days, readings: [[port, at, std, std_lanes, fast, fast_lanes]] }
 *   GET /border/people/readings?since=...   the same for cars and pedestrians: [[port, at, car std, lanes, car SENTRI, lanes,
 *                                            car Ready, lanes, walk std, lanes, walk Ready, lanes]]
 *
 * The source is CBP's public Border Wait Times feed (bwt.cbp.gov/api/waittimes), no key needed.
 * CBP keeps no past readings (its "historical" API is last year's monthly averages by weekday and
 * hour), so this catches each one as it's posted, from Oct 14, 2026 (Sep 13 to Oct 14 was filled once
 * from an independent hourly archive of the same feed, scripts/border-backfill.mjs). The permanent
 * archive is the site's: the snapshot copies the readings into border-waits/*.csv, and this keeps
 * only the last BORDER_BUFFER_DAYS.
 * It lists ~85 ports; about 50 have commercial lanes, and those make the truck board. The same feed
 * has the car lanes (standard, SENTRI / NEXUS, Ready) and pedestrian lanes (standard, Ready) at ~80
 * ports; those readings go to border_people the same way (toPeople), for the site's archive only:
 * no live board reads them, so they cost one more statement per tick and nothing else. Each port's officers
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
// The Worker is not the archive: the site's snapshot copies every reading into border-waits/*.csv, and
// this only holds the readings it hasn't been sure to copy yet (two weeks of failed snapshots).
export const BORDER_BUFFER_DAYS = 14;

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

/* The feed -> one reading per port of its car and pedestrian lanes, for the archive:
   [port, at, dow, hour, car std, lanes, car SENTRI, lanes, car Ready, lanes, walk std, lanes, walk Ready, lanes].
   The officers post every lane at once; the time is the first lane's that has one. */
const PEOPLE_LANES = [["passenger_vehicle_lanes", "standard_lanes"], ["passenger_vehicle_lanes", "NEXUS_SENTRI_lanes"],
  ["passenger_vehicle_lanes", "ready_lanes"], ["pedestrian_lanes", "standard_lanes"], ["pedestrian_lanes", "ready_lanes"]];
const PEOPLE_COLUMNS = Array.from({ length: 14 }, (_, i) => `json_extract(value, '$[${i}]')`).join(", ");
export function toPeople(feed) {
  const out = [];
  for (const x of Array.isArray(feed) ? feed : []) {
    if (!x || x.port_status !== "Open") continue;
    if (!num((x.passenger_vehicle_lanes || {}).maximum_lanes) && !num((x.pedestrian_lanes || {}).maximum_lanes)) continue;
    const lanes = PEOPLE_LANES.map(([g, k]) => lane((x[g] || {})[k]));
    if (lanes.every((l) => l.delay == null)) continue;
    const r = posted(x.date, x.time, clock((lanes.find((l) => l.update) || {}).update));
    if (r) out.push([String(x.port_number), r.at, r.dow, r.hour, ...lanes.flatMap((l) => [l.delay, l.lanes])]);
  }
  return out;
}

export async function borderTick(env) {
  const r = await fetch(CBP, { headers: { "User-Agent": "juantorresmi.github.io border board" } });
  if (!r.ok) throw new Error("CBP said: status " + r.status);
  const feed = await r.json();
  const ports = toPorts(feed), people = toPeople(feed);
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
  if (people.length) stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO border_people (port, at, dow, hour, car_std, car_std_lanes,
      car_sentri, car_sentri_lanes, car_ready, car_ready_lanes, walk_std, walk_std_lanes, walk_ready, walk_ready_lanes)
    SELECT ${PEOPLE_COLUMNS} FROM json_each(?1)`).bind(JSON.stringify(people)));
  await env.DB.batch(stmts);
  return { ports: ports.length, readings: readings.length, people: people.length };
}

/* GET /border: what the last tick saw. */
export async function borderNow(env) {
  const row = await env.DB.prepare("SELECT body FROM border_latest WHERE id = 1").first();
  if (row) return JSON.parse(row.body);
  await borderTick(env);                       // the very first request after deploying
  return JSON.parse((await env.DB.prepare("SELECT body FROM border_latest WHERE id = 1").first()).body);
}

/* GET /border/readings?since=YYYY-MM-DD: every reading in the buffer posted on or after that local date,
   for the site's snapshot to add to its permanent archive (border-waits/*.csv), and the oldest reading
   still held, so the snapshot can tell if it fell behind the buffer. */
export async function borderReadings(env, since) {
  const [rows, oldest] = await env.DB.batch([
    env.DB.prepare("SELECT port, at, std_delay, std_lanes, fast_delay, fast_lanes FROM border_waits WHERE at >= ?1 ORDER BY at, port").bind(since),
    env.DB.prepare("SELECT MIN(at) AS at FROM border_waits"),
  ]);
  return {
    since, oldest: (oldest.results[0] || {}).at || null, buffer_days: BORDER_BUFFER_DAYS,
    readings: rows.results.map((r) => [r.port, r.at, r.std_delay, r.std_lanes, r.fast_delay, r.fast_lanes]),
    updated: new Date().toISOString(),
  };
}

/* GET /border/people/readings?since=YYYY-MM-DD: the same for the car and pedestrian lanes. */
export async function borderPeopleReadings(env, since) {
  const [rows, oldest] = await env.DB.batch([
    env.DB.prepare(`SELECT port, at, car_std, car_std_lanes, car_sentri, car_sentri_lanes, car_ready, car_ready_lanes,
      walk_std, walk_std_lanes, walk_ready, walk_ready_lanes FROM border_people WHERE at >= ?1 ORDER BY at, port`).bind(since),
    env.DB.prepare("SELECT MIN(at) AS at FROM border_people"),
  ]);
  return {
    since, oldest: (oldest.results[0] || {}).at || null, buffer_days: BORDER_BUFFER_DAYS,
    readings: rows.results.map((r) => [r.port, r.at, r.car_std, r.car_std_lanes, r.car_sentri, r.car_sentri_lanes, r.car_ready,
      r.car_ready_lanes, r.walk_std, r.walk_std_lanes, r.walk_ready, r.walk_ready_lanes]),
    updated: new Date().toISOString(),
  };
}

/* Once a day: drop readings older than the buffer. By then the snapshot (at least daily) has copied
   them to the site's archive many times over; the buffer only has to outlast a run of failed snapshots. */
export async function borderPrune(env, now = new Date()) {
  const cut = new Date(now.getTime() - BORDER_BUFFER_DAYS * 86400000).toISOString().slice(0, 10);
  const [a, b] = await env.DB.batch([env.DB.prepare("DELETE FROM border_waits WHERE at < ?1").bind(cut),
    env.DB.prepare("DELETE FROM border_people WHERE at < ?1").bind(cut)]);
  return { cut, deleted: a.meta.changes, people_deleted: b.meta.changes };
}
