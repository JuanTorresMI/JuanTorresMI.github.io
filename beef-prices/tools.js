/* The beef board's tools. Everything they use is already in the page, so they ask nothing of the
 * Worker or USDA; without JavaScript the forms stay hidden and the tables and figures still work.
 *
 * The board: "Find a cut" filters every table on the page by name, IMPS code or what stores call it
 * (?q= in the address fills it in, so a search can be shared).
 * A cut page: "Check a price" puts a quoted price per pound against the latest day's sales, the last
 * 30 days and the past year (#bf-tool-data); "What it costs after trimming" turns a price, a yield
 * and labor into the cost of a sellable pound and of a portion, and how much to buy. The yield and
 * labor a visitor types are remembered in this browser, per cut, so they're there next time.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const money = (v) => "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lb = (cwt) => money(cwt / 100);
  const num = (el) => { const v = parseFloat(el && el.value); return Number.isFinite(v) ? v : NaN; };

  /* ---------------------------------------------------------------- find a cut (the board) */
  const q = $("bf-q");
  if (q) {
    $("bf-find").hidden = false;
    const rows = [...document.querySelectorAll("tr[data-find]")];
    const groups = [...document.querySelectorAll(".bf-group")];
    const ground = $("ground");
    const note = $("bf-find-n");
    const run = () => {
      const terms = q.value.toLowerCase().replace(/,/g, " ").split(/\s+/).filter(Boolean);
      let n = 0;
      for (const tr of rows) {
        const ok = terms.every((t) => tr.dataset.find.includes(t));
        tr.hidden = !ok;
        if (ok) n++;
      }
      for (const g of groups) g.hidden = !g.querySelector("tr[data-find]:not([hidden])");
      if (ground) ground.hidden = terms.length > 0 && !ground.querySelector("tr[data-find]:not([hidden])");
      note.hidden = !terms.length;
      note.innerHTML = !terms.length ? "" : n
        ? `${n} item${n === 1 ? "" : "s"} that traded today ${n === 1 ? "matches" : "match"} “${esc(q.value.trim())}”. <button type="button" class="rb-chip" id="bf-clear">Show everything</button>`
        : `Nothing that traded today matches “${esc(q.value.trim())}”. <a class="link" href="#every-cut">Every cut page</a> is listed further down, including the ones that didn’t trade. <button type="button" class="rb-chip" id="bf-clear">Show everything</button>`;
      const url = new URL(location.href);
      if (terms.length) url.searchParams.set("q", q.value.trim()); else url.searchParams.delete("q");
      history.replaceState(null, "", url);
    };
    note.addEventListener("click", (e) => { if (e.target.id === "bf-clear") { q.value = ""; run(); q.focus(); } });
    q.addEventListener("input", run);
    const start = new URL(location.href).searchParams.get("q");
    if (start) { q.value = start; run(); }
  }

  /* ------------------------------------------------------------ the tools on a cut page */
  const data = $("bf-tool-data");
  if (!data) return;
  const grades = JSON.parse(data.textContent);
  $("bf-tools").hidden = false;
  const key = "bf-tool:" + location.pathname;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) { saved = {}; }
  const save = (k, v) => { saved[k] = v; try { localStorage.setItem(key, JSON.stringify(saved)); } catch (e) { /* private window */ } };

  // Check a price.
  const grade = $("bf-grade"), quote = $("bf-quote"), out = $("bf-quote-out");
  const blank = out.innerHTML;
  const check = () => {
    const t = grades[grade ? Number(grade.value) : 0];
    const p = num(quote);
    if (!t || !(p > 0)) { out.innerHTML = blank; return; }
    const c = p * 100, diff = c - t.v, pct = (diff / t.v) * 100;
    let tag, where;
    if (t.low != null && t.high != null) {
      if (c < t.low) { tag = "Below the day’s sales"; where = `below the lowest sale that day (${lb(t.low)})`; }
      else if (c > t.high) { tag = "Above the day’s sales"; where = `above the highest sale that day (${lb(t.high)})`; }
      else { tag = "Inside the day’s range"; where = `inside the day’s range of ${lb(t.low)} to ${lb(t.high)}`; }
    } else {
      tag = Math.abs(pct) <= 3 ? "Close to the day’s average" : pct > 0 ? "Above the day’s average" : "Below the day’s average";
      where = "compared with the day’s average (USDA gave no range)";
    }
    const below = t.year.filter((v) => v < c).length, n = t.year.length;
    const sameDay = Math.abs(diff) < 0.5;
    out.innerHTML = `<p class="rb-tag">${esc(tag)}</p>
      <p class="rb-price">${money(p)} <span>per lb${sameDay ? ", the same as" : `, ${money(Math.abs(diff) / 100)} (${Math.abs(pct).toFixed(1)}%) ${diff > 0 ? "above" : "below"}`} USDA’s ${t.key ? esc(t.grade) + " " : ""}average of ${lb(t.v)} on ${esc(t.date)}</span></p>
      <dl class="rb-facts">
        <div><dt>That day’s sales</dt><dd>Your price is ${where}.</dd></div>
        ${t.d30 ? `<div><dt>The last 30 days</dt><dd>USDA’s daily average ran from ${lb(t.d30[0])} to ${lb(t.d30[1])}.</dd></div>` : ""}
        ${n ? `<div><dt>The past year</dt><dd>USDA’s daily average was below your price on ${below === n ? `every one of the ${n} days` : below === 0 ? `none of the ${n} days` : `${below} of the ${n} days`} it traded.</dd></div>` : ""}
      </dl>
      ${n ? `<div class="rb-meter" role="img" aria-label="Your price against the past year: higher than ${below} of ${n} days"><span style="left: ${Math.round((below / n) * 100)}%"></span></div><p class="rb-meter-k"><span>Lowest of the year</span><span>Highest of the year</span></p>` : ""}`;
  };
  quote.addEventListener("input", check);
  if (grade) grade.addEventListener("change", check);

  // What it costs after trimming.
  const price = $("bf-price"), yieldIn = $("bf-yield"), labor = $("bf-labor"), oz = $("bf-oz"), tout = $("bf-trim-out");
  if (!price) return;
  const tblank = tout.innerHTML;
  for (const [el, k] of [[yieldIn, "yield"], [labor, "labor"], [oz, "oz"]]) if (saved[k] != null && saved[k] !== "") el.value = saved[k];
  const trim = () => {
    const p = num(price), y = num(yieldIn), l = num(labor) || 0, o = num(oz);
    save("yield", yieldIn.value); save("labor", labor.value); save("oz", oz.value);
    if (!(p > 0) || !(y > 0 && y <= 100)) { tout.innerHTML = tblank; return; }
    const sellable = (p + l) / (y / 100);
    const portion = o > 0 ? (sellable * o) / 16 : null;
    const perBought = o > 0 ? ((y / 100) * 16) / o : null;
    tout.innerHTML = `<p class="rb-price">${money(sellable)} <span>per pound you can sell</span></p>
      <dl class="rb-facts">
        ${portion != null ? `<div><dt>Each ${esc(o)} oz portion</dt><dd>${money(portion)}</dd></div>` : ""}
        ${perBought != null ? `<div><dt>Portions per pound bought</dt><dd>${perBought.toFixed(2)}, so 100 portions take about ${Math.ceil(100 / perBought)} lb</dd></div>` : ""}
        <div><dt>Lost to trim</dt><dd>${(100 - y).toFixed(1)}% of every pound</dd></div>
        <div><dt>The math</dt><dd>(${money(p)} + ${money(l)}) ÷ ${y}% = ${money(sellable)}</dd></div>
      </dl>`;
  };
  for (const el of [price, yieldIn, labor, oz]) el.addEventListener("input", trim);
  trim();
})();
