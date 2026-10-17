/* The beef board's freshness check, on the board and on every cut page.
 *
 * The pages are rebuilt twice a day, but USDA posts the afternoon report around 3 pm Central, hours
 * before the evening rebuild. So when the copy in a page could be behind (a business day's report is
 * due and the copy is older), this asks the Worker for the newest report, and if it is newer, puts
 * its numbers in the page's top line and says so. Most visits find the copy current and ask nothing.
 *
 * window.BF = { endpoint, latest, values, item }  (set by the page)
 *   latest   the copy's report date, "YYYY-MM-DD"
 *   values   the copy's figures by key: { choice, select } (the board's cutout), or this item's
 *            price by grade, { choice, select } or { "": … } (a cut page)
 *   item     USDA's description of this page's item, and per_lb: true where it shows dollars a pound
 * Elements with data-bf="<key>" get the new figure and its change; data-bf="report", "spread" and
 * "loads" (the board) get theirs; data-bf="notice" says where the figures came from.
 */
(() => {
  const C = window.BF;
  if (!C || !C.endpoint || !C.latest) return;
  const pad = (n) => String(n).padStart(2, "0");
  const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const weekdayBefore = (d) => { do d.setDate(d.getDate() - 1); while (d.getDay() === 0 || d.getDay() === 6); return d; };

  // The newest report that should exist by now: the latest weekday whose afternoon (2:45 pm Central)
  // has passed. Holidays aren't known here; on one, the Worker just answers with the same report.
  const ct = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const due = new Date(ct);
  if (ct.getHours() * 60 + ct.getMinutes() < 14 * 60 + 45 || due.getDay() === 0 || due.getDay() === 6) weekdayBefore(due);
  if (isoOf(due) <= C.latest) return;                            // the copy is current: ask nothing

  const money = (v) => "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signed = (v, f) => (Math.abs(v) < 0.005 ? "±" : v > 0 ? "+" : "−") + f(Math.abs(v));
  const day = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const each = (key, fn) => document.querySelectorAll(`[data-bf="${key}"]`).forEach(fn);
  const fill = (key, main, change) => each(key, (el) => {
    el.textContent = main;
    if (change) { const s = document.createElement("span"); s.textContent = change; el.append(" ", s); }
  });

  fetch(C.endpoint.replace(/\/+$/, "") + "/beef").then((r) => r.json()).then((d) => {
    if (!d || !d.latest || d.latest <= C.latest || !d.day) return;
    // A change is only "from the day before" when the copy is the report just before this one.
    const follows = isoOf(weekdayBefore(new Date(d.latest + "T12:00:00"))) === C.latest;
    const was = C.values || {};

    if (C.item) {
      for (const it of d.items || []) {
        if (it.item !== C.item.usda || !(it.grade in was)) continue;
        const before = was[it.grade];
        if (C.item.per_lb) fill(it.grade || "price", money(it.wavg / 100) + "/lb", follows && before ? signed((it.wavg - before) / before * 100, (v) => v.toFixed(1) + "%") : "");
        else fill(it.grade || "price", money(it.wavg), follows && before ? signed(it.wavg - before, money) : "");
      }
    } else {
      const c = d.day.choice_cutout, s = d.day.select_cutout, cl = d.day.choice_loads, sl = d.day.select_loads;
      each("report", (el) => { el.textContent = day(d.latest); });
      if (c != null) fill("choice", money(c), follows && was.choice != null ? signed(c - was.choice, money) : "");
      if (s != null) fill("select", money(s), follows && was.select != null ? signed(s - was.select, money) : "");
      if (c != null && s != null) fill("spread", money(c - s), "");
      if (cl != null && sl != null) fill("loads", String(Math.round(cl + sl)), "");
    }
    const [, clock] = String(d.published || "").split(" ");
    const [h, m] = (clock || "").split(":").map(Number);
    const at = Number.isFinite(h) && Number.isFinite(m) ? ` at ${h % 12 || 12}:${pad(m)} ${h < 12 ? "am" : "pm"} Central` : "";
    each("notice", (el) => {
      el.textContent = `USDA posted the report for ${day(d.latest)}${at}. The figures at the top are from it; the rest of the page catches up when the site is rebuilt this evening.`;
      el.hidden = false;
    });
  }).catch(() => {});                                            // the copy stands
})();
