/* The beef board's tools. Everything they use is already in the page, so they ask nothing of the
 * Worker or USDA; without JavaScript the forms stay hidden and the tables and figures still work.
 *
 * The board: "Find a cut" filters every table on the page by name, IMPS code or what stores call it
 * (?q= in the address fills it in, so a search can be shared), and "Budget a buy" prices an order
 * of cuts and pounds at today's averages and a week earlier.
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

  /* ---------------------------------------------------------- budget a buy (the board) */
  // An order of cuts and pounds priced at today's weighted averages, and the same order a week
  // earlier where the cut traded then. The order is remembered in this browser.
  const bgData = $("bg-data");
  if (bgData) {
    const cuts = JSON.parse(bgData.textContent).filter(Boolean);
    const sel = $("bg-cut"), lbsIn = $("bg-lbs"), bout = $("bg-out"), bblank = bout.innerHTML;
    sel.innerHTML = cuts.map((c, i) => `<option value="${i}">${esc(c.name)}${c.grade === "Choice" || c.grade === "Price" ? "" : ` (${esc(c.grade)})`} · ${lb(c.v)}/lb</option>`).join("");
    $("budget").hidden = false;
    let order = [];
    try { order = JSON.parse(localStorage.getItem("bf-budget") || "[]").filter((o) => cuts.some((c) => c.name === o.name)); } catch (e) { order = []; }
    const keep = () => { try { localStorage.setItem("bf-budget", JSON.stringify(order)); } catch (e) { /* private window */ } };
    const draw = () => {
      if (!order.length) { bout.innerHTML = bblank; return; }
      let total = 0, then = 0, thenAll = true;
      const rows = order.map((o, i) => {
        const c = cuts.find((x) => x.name === o.name);
        const cost = (c.v / 100) * o.lbs;
        total += cost;
        if (c.then) then += (c.then / 100) * o.lbs; else thenAll = false;
        return `<tr><th scope="row">${c.slug ? `<a href="/beef-prices/${esc(c.slug)}/">${esc(c.name)}</a>` : esc(c.name)}</th><td>${o.lbs.toLocaleString("en-US")} lb</td><td>${lb(c.v)}</td><td><strong>${money(cost)}</strong></td><td><button type="button" class="rb-chip" data-drop="${i}" aria-label="Remove ${esc(c.name)}">Remove</button></td></tr>`;
      }).join("");
      const diff = total - then;
      bout.innerHTML = `<p class="rb-price">${money(total)} <span>for the order at today’s USDA weighted averages</span></p>
        <div class="rb-scroll"><table class="rb-table"><thead><tr><th scope="col">Cut</th><th scope="col">Pounds</th><th scope="col">Per lb</th><th scope="col">Cost</th><th scope="col"></th></tr></thead><tbody>${rows}</tbody></table></div>
        ${thenAll && then > 0 ? `<p>A week earlier the same order would have cost ${money(then)}, so it’s ${money(Math.abs(diff))} (${Math.abs((diff / then) * 100).toFixed(1)}%) ${diff >= 0 ? "more" : "less"} now.</p>` : `<p class="rb-note">Not every cut traded a week ago, so there’s no week-ago total.</p>`}
        <p class="rb-note">Wholesale boxed prices, FOB the packing plant; freight and handling come on top.</p>`;
    };
    $("bg-form").addEventListener("submit", () => {
      const lbs = num(lbsIn);
      if (!(lbs > 0)) { lbsIn.focus(); return; }
      const c = cuts[Number(sel.value)];
      const had = order.find((o) => o.name === c.name);
      if (had) had.lbs += lbs; else order.push({ name: c.name, lbs });
      lbsIn.value = ""; keep(); draw();
    });
    bout.addEventListener("click", (e) => { const b = e.target.closest("[data-drop]"); if (b) { order.splice(Number(b.dataset.drop), 1); keep(); draw(); } });
    draw();
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
