/* Refreshes the "right now" cells on the car and pedestrian pages (/border-waits/cars/, each crossing
 * page and their Spanish twins) straight from CBP's public feed, which CBP serves to any site
 * (Access-Control-Allow-Origin: *, about 9 KB gzipped), so the Worker does no work for these pages.
 * Without it the pages show the copy they were built with, which says when it was made.
 *
 * The page sets window.BW = { lang, words } (words from _data/border_text.yml). Every element with
 * data-port holds that port's cells: data-now="car_standard" | "car_sentri" | "car_ready" |
 * "pedestrian_standard" | "pedestrian_ready" (the wait), "<lane>_lanes" (lanes open) or "posted".
 * A row with data-hot="<lane>" gets .rb-hot when that lane is at 60 min or more.
 */
(() => {
  const C = window.BW;
  if (!C) return;
  const W = C.words, es = C.lang === "es";
  const OLD = 180;                       // minutes; matches STALE_MIN in scripts/snapshot.py
  const LANES = { car_standard: ["passenger_vehicle_lanes", "standard_lanes"], car_sentri: ["passenger_vehicle_lanes", "NEXUS_SENTRI_lanes"],
    car_ready: ["passenger_vehicle_lanes", "ready_lanes"], pedestrian_standard: ["pedestrian_lanes", "standard_lanes"],
    pedestrian_ready: ["pedestrian_lanes", "ready_lanes"] };

  // A wait is only a number when CBP says "delay" or "no delay"; anything else is unknown, never 0.
  const wait = (l) => {
    const st = String(l.operational_status || "").trim().toLowerCase();
    if ((st === "delay" || st === "no delay") && /^\d+$/.test(String(l.delay_minutes || "").trim())) {
      const v = Number(l.delay_minutes);
      return { v, text: v === 0 ? W.no_wait : v + " min" };
    }
    return { v: null, text: /closed/.test(st) ? W.closed : /pending/.test(st) ? W.pending : "—" };
  };
  // "At 10:00 pm CDT" -> minutes after midnight, and "10:00 PM CDT" (or "22:00 CDT" in Spanish).
  const parse = (s) => {
    const m = /At\s+(Noon|Midnight|(\d{1,2}):(\d{2})\s*([ap])\.?m\.?)\s*(.*)$/i.exec(String(s || "").trim());
    if (!m) return null;
    let h, mm = 0;
    if (/noon/i.test(m[1])) h = 12; else if (/midnight/i.test(m[1])) h = 0;
    else { h = (Number(m[2]) % 12) + (m[4].toLowerCase() === "p" ? 12 : 0); mm = Number(m[3]); }
    const z = m[5] ? " " + m[5].trim() : "", p = String(mm).padStart(2, "0");
    return { min: h * 60 + mm, text: es ? `${h}:${p}${z}` : `${h % 12 || 12}:${p} ${h < 12 ? "AM" : "PM"}${z}` };
  };
  const ago = (min) => {
    const s = min < 60 ? `${min} min` : min < 600 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`
      : min < 2880 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} d`;
    return es ? `hace ${s}` : `${s} ago`;
  };

  fetch("https://bwt.cbp.gov/api/waittimes").then((r) => r.json()).then((feed) => {
    if (!Array.isArray(feed)) return;
    const ports = new Map(feed.map((x) => [String(x.port_number), x]));
    document.querySelectorAll("[data-port]").forEach((el) => {
      const x = ports.get(el.dataset.port);
      if (!x) return;
      const lane = (k) => (x[LANES[k][0]] || {})[LANES[k][1]] || {};
      el.querySelectorAll("[data-now]").forEach((c) => {
        const k = c.dataset.now;
        if (LANES[k]) c.textContent = wait(lane(k)).text;
        else if (k.endsWith("_lanes") && LANES[k.slice(0, -6)]) {
          const n = String(lane(k.slice(0, -6)).lanes_open || "").trim();
          c.textContent = /^\d+$/.test(n) ? n : "—";
        } else if (k === "posted") {
          const up = Object.keys(LANES).map((key) => lane(key).update_time).find((u) => u && String(u).trim());
          const at = parse(up), now = /^(\d{1,2}):(\d{2})/.exec(String(x.time || ""));
          if (!at) { c.textContent = "—"; return; }
          c.textContent = at.text;
          if (now) {
            // A port that posts the coming hour early counts as now; a time much later than the feed's clock was yesterday's.
            let age = Number(now[1]) * 60 + Number(now[2]) - at.min;
            if (age < -60) age += 1440;
            age = Math.max(0, age - (String(x.port_number).startsWith("26") ? 60 : 0));
            c.textContent += ` · ${ago(age)}`;
            if (age >= OLD) {
              const tag = document.createElement("span");
              tag.className = "bw-stale";
              tag.textContent = W.old;
              c.append(" ", tag);
            }
          }
        }
      });
      if (el.dataset.hot && LANES[el.dataset.hot]) el.classList.toggle("rb-hot", (wait(lane(el.dataset.hot)).v || 0) >= 60);
    });
    const when = new Date().toLocaleString(es ? "es-MX" : "en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
    const copy = document.getElementById("bw-copy");
    if (copy) copy.textContent = `${W.live} ${when}.`;
    const asof = document.getElementById("bw-asof");
    if (asof) asof.textContent = when;
  }).catch(() => {});
})();
