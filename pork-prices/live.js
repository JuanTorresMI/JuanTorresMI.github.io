/* The pork board's freshness check, on the board and every cut page, the same as beef-prices/live.js:
 * when a page's copy could be behind (a report is due and the copy is older), ask the Worker for the
 * newest report and, if it is newer, put its figures in the page's top line and say so.
 *
 * window.BF = { endpoint, path: "/pork", lang, latest, values, item }  (set by the page)
 *   values   the copy's figures: { carcass, loin, … } on the board, { "": price } on a cut page
 *   item     a cut page's USDA description, or the primal key on a primal page ("carcass", "loin", …)
 */
(() => {
  const C = window.BF;
  if (!C || !C.endpoint || !C.latest) return;
  const es = C.lang === "es";
  const pad = (n) => String(n).padStart(2, "0");
  const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const weekdayBefore = (d) => { do d.setDate(d.getDate() - 1); while (d.getDay() === 0 || d.getDay() === 6); return d; };

  const ct = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const due = new Date(ct);
  if (ct.getHours() * 60 + ct.getMinutes() < 14 * 60 + 45 || due.getDay() === 0 || due.getDay() === 6) weekdayBefore(due);
  if (isoOf(due) <= C.latest) return;                            // the copy is current: ask nothing

  const money = (v) => "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const signed = (v, f) => (Math.abs(v) < 0.005 ? "±" : v > 0 ? "+" : "−") + f(Math.abs(v));
  const day = (iso) => new Date(iso + "T12:00:00").toLocaleDateString(es ? "es-MX" : "en-US", { weekday: "short", month: "short", day: "numeric" });
  const each = (key, fn) => document.querySelectorAll(`[data-bf="${key}"]`).forEach(fn);
  const fill = (key, main, change) => each(key, (el) => {
    el.textContent = main;
    if (change) { const s = document.createElement("span"); s.textContent = change; el.append(" ", s); }
  });

  fetch(C.endpoint.replace(/\/+$/, "") + (C.path || "/pork")).then((r) => r.json()).then((d) => {
    if (!d || !d.latest || d.latest <= C.latest || !d.day) return;
    const follows = isoOf(weekdayBefore(new Date(d.latest + "T12:00:00"))) === C.latest;
    const was = C.values || {};
    if (C.item && C.item.primal) {
      const v = d.day[C.item.primal], before = was[""];
      if (v != null) fill("price", money(v), follows && before ? signed(v - before, money) : "");
    } else if (C.item) {
      const it = (d.items || []).find((x) => x.item === C.item.usda);
      if (!it) return;
      const before = was[""];
      fill("price", money(it.wavg / 100) + "/lb", follows && before ? signed((it.wavg - before) / before * 100, (v) => v.toFixed(1) + "%") : "");
    } else {
      each("report", (el) => { el.textContent = day(d.latest); });
      for (const k of ["carcass", "belly", "loin", "ham"]) {
        const v = d.day[k];
        if (v != null) fill(k, money(v), k === "carcass" && follows && was.carcass != null ? signed(v - was.carcass, money) : "");
      }
      if (d.day.loads != null) fill("loads", String(Math.round(d.day.loads)), "");
    }
    const [, clock] = String(d.published || "").split(" ");
    const [h, m] = (clock || "").split(":").map(Number);
    const ok = Number.isFinite(h) && Number.isFinite(m);
    const at = !ok ? "" : es ? ` a las ${h}:${pad(m)}, hora del Centro` : ` at ${h % 12 || 12}:${pad(m)} ${h < 12 ? "am" : "pm"} Central`;
    each("notice", (el) => {
      el.textContent = es
        ? `El USDA publicó el reporte del ${day(d.latest)}${at}. Las cifras de arriba son de ese reporte; el resto de la página se pone al día cuando el sitio se reconstruye esta noche.`
        : `USDA posted the report for ${day(d.latest)}${at}. The figures at the top are from it; the rest of the page catches up when the site is rebuilt this evening.`;
      el.hidden = false;
    });
  }).catch(() => {});                                            // the copy stands
})();
