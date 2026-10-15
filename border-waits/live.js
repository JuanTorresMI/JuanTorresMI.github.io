/* Refreshes the "right now" cells on the border pages (/border-waits/ and each crossing page) from
 * the Worker's /border, which Cloudflare's edge caches for five minutes. Without it the pages show
 * the copy they were built with, which says when it was made.
 *
 * The page sets window.BW = { endpoint, lang, words } (words from _data/border_text.yml). Every
 * element with data-port holds that port's cells: data-now="std" | "fast" | "lanes" | "posted".
 * A lanes cell with data-max appends "/ max". A row with data-hot gets .rb-hot at 40 min or more.
 */
(() => {
  const C = window.BW;
  if (!C || !C.endpoint) return;
  const W = C.words, es = C.lang === "es";
  const OLD = 180;                       // minutes; matches STALE_MIN in scripts/snapshot.py

  const wait = (l) => (l.delay != null ? (l.delay === 0 ? W.no_wait : l.delay + " min")
    : /closed/i.test(l.status || "") ? W.closed : /pending/i.test(l.status || "") ? W.pending : "—");

  // "At 10:00 pm CDT" -> "10:00 PM CDT", or "22:00 CDT" in Spanish.
  const clock = (s) => {
    s = String(s || "").replace(/^At\s+/i, "").trim();
    if (!s) return "";
    const m = /^(Noon|Midnight|(\d{1,2}):(\d{2})\s*([ap])m)\s*(.*)$/i.exec(s);
    if (!m) return s;
    let h, mm = "00";
    if (/noon/i.test(m[1])) h = 12; else if (/midnight/i.test(m[1])) h = 0;
    else { h = (Number(m[2]) % 12) + (m[4].toLowerCase() === "p" ? 12 : 0); mm = m[3]; }
    const zone = m[5] ? " " + m[5] : "";
    return es ? `${h}:${mm}${zone}` : `${h % 12 || 12}:${mm} ${h < 12 ? "AM" : "PM"}${zone}`;
  };
  const ago = (min) => {
    const s = min < 60 ? `${min} min` : min < 2880 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} d`;
    return es ? `hace ${s}` : `${s} ago`;
  };

  fetch(C.endpoint + "/border").then((r) => r.json()).then((d) => {
    if (!d || !Array.isArray(d.ports)) return;
    const since = Math.max(0, (Date.now() - Date.parse(d.updated)) / 60000) || 0;
    const ports = new Map(d.ports.map((p) => [p.port, p]));
    let reporting = 0;
    for (const p of d.ports) if (p.std.delay != null || p.fast.delay != null) reporting++;

    document.querySelectorAll("[data-port]").forEach((el) => {
      const p = ports.get(el.dataset.port);
      if (!p) return;
      const cell = (k) => el.querySelector(`[data-now="${k}"]`);
      const put = (k, text) => { const c = cell(k); if (c) c.textContent = text; };
      put("std", wait(p.std));
      put("fast", wait(p.fast));
      const lanes = cell("lanes");
      if (lanes) lanes.textContent = (p.std.lanes != null ? p.std.lanes + (p.fast.lanes ? ` + ${p.fast.lanes} FAST` : "") : "—")
        + (lanes.dataset.max != null ? ` / ${p.max}` : "");
      const posted = cell("posted");
      if (posted) {
        const age = p.age != null ? Math.round(p.age + since) : null;
        posted.textContent = clock(p.std.update || p.fast.update) || "—";
        if (age != null) posted.textContent += ` · ${ago(age)}`;
        if (age != null && age >= OLD) {
          const tag = document.createElement("span");
          tag.className = "bw-stale";
          tag.textContent = W.old;
          posted.append(" ", tag);
        }
      }
      if (el.dataset.hot != null) el.classList.toggle("rb-hot", (p.std.delay || 0) >= 40);
    });

    const t = new Date(d.updated);
    const when = isNaN(t) ? "" : t.toLocaleString(es ? "es-MX" : "en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
    const copy = document.getElementById("bw-copy");
    if (copy && when) copy.textContent = `${W.live} ${when}.`;
    const asof = document.getElementById("bw-asof");
    if (asof && when) asof.textContent = when;
    const rep = document.getElementById("bw-reporting");
    if (rep) rep.textContent = `${reporting} of ${d.ports.length}`;
  }).catch(() => {});
})();
