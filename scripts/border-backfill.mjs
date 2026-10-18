/* Fills the border board's history (D1 `border_waits`) from before the Worker started recording it.
 *
 * CBP keeps no history of its own: its feed only shows each port's latest reading, and its
 * "historical wait times" are last year's monthly averages by weekday and hour, not readings. So the
 * Worker records every reading itself, from Oct 14, 2026. Before that, an independent public
 * archive, github.com/gptcbp/border-crossing-data, saved CBP's whole feed about once an hour from
 * Sep 15, 2026 (about 83% of the hours; some days have gaps of several hours). The readings are
 * CBP's own (U.S. government data); the archive only kept them.
 *
 * Each archived snapshot goes through the Worker's own parser (`toPorts` in worker/src/border.js),
 * so a backfilled row is exactly what the Worker would have stored, and `INSERT OR IGNORE` keeps any
 * reading already there. Safe to run again.
 *
 *   node scripts/border-backfill.mjs [--until 2026-10-14T12:00:00Z]   writes border-backfill.sql
 *   cd worker && npx wrangler d1 execute yokonjuan --remote --file=../border-backfill.sql
 *
 * The .sql file is a one-off; delete it afterwards (it is in .gitignore).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { toPorts } from "../worker/src/border.js";

const REPO = "gptcbp/border-crossing-data";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const until = arg("--until") ? Date.parse(arg("--until")) : Infinity;

const tree = await (await fetch(`https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`, { headers: { "User-Agent": "juantorresmi border backfill" } })).json();
const files = (tree.tree || []).map((t) => t.path).filter((p) => /^data\/raw\/cbp\/cbp_\d{8}T\d{6}Z\.json$/.test(p)).sort();
const stamp = (p) => { const m = /cbp_(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(p); return Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5], m[6]); };
const wanted = files.filter((p) => stamp(p) < until);
console.log(`${files.length} snapshots in the archive, ${wanted.length} before ${arg("--until") || "now"}`);

const rows = new Map();     // "port|at" -> row, so a reading seen in several snapshots is kept once
let done = 0, bad = 0;
for (let i = 0; i < wanted.length; i += 8) {
  await Promise.all(wanted.slice(i, i + 8).map(async (p) => {
    try {
      const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${p}`);
      let d = JSON.parse((await r.text()).replace(/^﻿/, ""));
      if (typeof d === "string") d = JSON.parse(d);
      for (const x of toPorts(d)) {
        if (!x.reading || (x.std.delay == null && x.fast.delay == null)) continue;
        rows.set(x.port + "|" + x.reading.at, [x.port, x.reading.at, x.reading.dow, x.reading.hour, x.std.delay, x.std.lanes, x.fast.delay, x.fast.lanes]);
      }
    } catch (e) { bad++; }
    done++;
  }));
  if (done % 80 === 0 || done === wanted.length) process.stdout.write(`\r${done}/${wanted.length} snapshots, ${rows.size} readings`);
}
console.log(bad ? `\n${bad} snapshots couldn't be read` : "");

const q = (v) => (v == null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const all = [...rows.values()].sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
const out = [];
for (let i = 0; i < all.length; i += 400) {
  out.push("INSERT OR IGNORE INTO border_waits (port, at, dow, hour, std_delay, std_lanes, fast_delay, fast_lanes) VALUES\n" +
    all.slice(i, i + 400).map((r) => "(" + r.map(q).join(",") + ")").join(",\n") + ";");
}
fs.writeFileSync(path.join(root, "border-backfill.sql"), out.join("\n") + "\n");
const first = all.reduce((m, r) => (r[1] < m ? r[1] : m), "9999");
console.log(`wrote border-backfill.sql: ${all.length} readings from ${new Set(all.map((r) => r[0])).size} ports, earliest ${first}`);
