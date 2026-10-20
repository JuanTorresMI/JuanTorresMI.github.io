/* Fills the border's car and pedestrian archive (border-waits/border-car-pedestrian-wait-readings-YYYY.csv)
 * from before the Worker kept those lanes.
 *
 * The truck history's backfill (border-backfill.mjs) read an independent public archive of CBP's whole
 * feed, github.com/gptcbp/border-crossing-data, saved about once an hour from Sep 15, 2026. The same
 * snapshots hold the car and pedestrian lanes. Each one goes through the Worker's own parser (`toPeople`
 * in worker/src/border.js), so a row is exactly what the Worker would have stored, and it is written
 * straight into the CSVs with source "archive". A reading already in a file is never rewritten, so this
 * is safe to run again.
 *
 *   node scripts/border-people-backfill.mjs [--until 2026-10-21T00:00:00Z]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { toPeople } from "../worker/src/border.js";

const REPO = "gptcbp/border-crossing-data";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = (y) => path.join(root, "border-waits", `border-car-pedestrian-wait-readings-${y}.csv`);
const FIELDS = ["port_number", "posted_local", "car_standard_wait_min", "car_standard_lanes_open", "car_sentri_wait_min", "car_sentri_lanes_open",
  "car_ready_wait_min", "car_ready_lanes_open", "pedestrian_standard_wait_min", "pedestrian_standard_lanes_open",
  "pedestrian_ready_wait_min", "pedestrian_ready_lanes_open", "source"];
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const until = arg("--until") ? Date.parse(arg("--until")) : Infinity;

// What's already kept wins.
const rows = new Map();
for (const f of fs.readdirSync(path.join(root, "border-waits")).filter((f) => /^border-car-pedestrian-wait-readings-\d{4}\.csv$/.test(f))) {
  const lines = fs.readFileSync(path.join(root, "border-waits", f), "utf8").trim().split("\n").slice(1);
  for (const l of lines) { const c = l.split(","); rows.set(c[0] + "|" + c[1], c); }
}
const kept = rows.size;

const tree = await (await fetch(`https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`, { headers: { "User-Agent": "juantorresmi border backfill" } })).json();
const files = (tree.tree || []).map((t) => t.path).filter((p) => /^data\/raw\/cbp\/cbp_\d{8}T\d{6}Z\.json$/.test(p)).sort();
const stamp = (p) => { const m = /cbp_(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(p); return Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5], m[6]); };
const wanted = files.filter((p) => stamp(p) < until);
console.log(`${files.length} snapshots in the archive, ${wanted.length} before ${arg("--until") || "now"}`);

let done = 0, bad = 0, added = 0;
for (let i = 0; i < wanted.length; i += 8) {
  await Promise.all(wanted.slice(i, i + 8).map(async (p) => {
    try {
      const r = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${p}`);
      let d = JSON.parse((await r.text()).replace(/^﻿/, ""));
      if (typeof d === "string") d = JSON.parse(d);
      for (const [port, at, , , ...v] of toPeople(d)) {
        const k = port + "|" + at;
        if (rows.has(k)) continue;
        rows.set(k, [port, at, ...v.map((x) => (x == null ? "" : String(x))), "archive"]); added++;
      }
    } catch (e) { bad++; }
    done++;
  }));
  if (done % 80 === 0 || done === wanted.length) process.stdout.write(`\r${done}/${wanted.length} snapshots, ${added} readings added`);
}
console.log(bad ? `\n${bad} snapshots couldn't be read` : "");

const byYear = new Map();
for (const c of rows.values()) { const y = c[1].slice(0, 4); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(c); }
for (const [y, list] of byYear) {
  list.sort((a, b) => (a[1] + a[0]).localeCompare(b[1] + b[0]));
  fs.writeFileSync(file(y), [FIELDS.join(","), ...list.map((c) => c.join(","))].join("\n") + "\n");
}
console.log(`${kept} readings were on file; ${added} added from the archive; ${rows.size} now, in ${byYear.size} file(s)`);
