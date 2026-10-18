/* The beef and pork boards' tools, in English or Spanish (window.BF.lang). Everything they use is
 * already in the page, so they ask nothing of the Worker or USDA; without JavaScript the forms stay
 * hidden and the tables and figures still work. Links go under window.BF.base (/beef-prices/,
 * /pork-prices/, or their Spanish pages).
 *
 * A board: "Find a cut" filters every table on the page by name, code or what stores call it (?q=
 * in the address fills it in, so a search can be shared), and "Budget a buy" prices an order of
 * cuts and pounds at today's averages and a week earlier.
 * A cut page: "Check a price" puts a quoted price per pound against the latest day's sales, the last
 * 30 days and the past year (#bf-tool-data); "What it costs after trimming" turns a price, a yield
 * and labor into the cost of a sellable pound and of a portion. The yield and labor a visitor types
 * are remembered in this browser, per page, and the order per board.
 */
(() => {
  const C = window.BF || {};
  const es = C.lang === "es";
  const base = C.base || "/beef-prices/";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const money = (v) => "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lb = (cwt) => money(cwt / 100);
  const num = (el) => { const v = parseFloat(el && el.value); return Number.isFinite(v) ? v : NaN; };
  const n0 = (v) => Number(v).toLocaleString("en-US");
  const T = es ? {
    match: (n, q) => `${n} producto${n === 1 ? "" : "s"} vendido${n === 1 ? "" : "s"} hoy coincide${n === 1 ? "" : "n"} con “${q}”.`,
    none: (q) => `Nada de lo vendido hoy coincide con “${q}”. <a class="link" href="#every-cut">Todas las páginas de cortes</a> están más abajo, incluidas las que no se vendieron.`,
    all: "Mostrar todo", remove: "Quitar", total: "por el pedido a los promedios ponderados de hoy del USDA",
    head: ["Corte", "Libras", "Por lb", "Costo"],
    week: (then, diff, p, more) => `Hace una semana el mismo pedido habría costado ${then}, así que ahora cuesta ${diff} (${p}%) ${more ? "más" : "menos"}.`,
    noweek: "No todos los cortes se vendieron hace una semana, así que no hay total de hace una semana.",
    fob: "Precios de mayoreo LAB planta empacadora; el flete y el manejo van aparte.",
    below: "Abajo de las ventas del día", above: "Arriba de las ventas del día", inside: "Dentro del rango del día",
    belowW: (x) => `abajo de la venta más baja de ese día (${x})`, aboveW: (x) => `arriba de la venta más alta de ese día (${x})`,
    insideW: (a, b) => `dentro del rango del día, de ${a} a ${b}`,
    close: "Cerca del promedio del día", aboveAvg: "Arriba del promedio del día", belowAvg: "Abajo del promedio del día",
    noRange: "frente al promedio del día (el USDA no dio rango)",
    same: ", lo mismo que", vs: (d, p, up) => `, ${d} (${p}%) ${up ? "arriba" : "abajo"} d`,
    avg: (g, v, d) => `el promedio ${g}de ${v} del USDA el ${d}`, perLb: "por lb",
    dayS: "Las ventas de ese día", dayW: (w) => `Su precio está ${w}.`, d30: "Los últimos 30 días", d30W: (a, b) => `El promedio diario del USDA fue de ${a} a ${b}.`,
    yr: "El último año", yrW: (b, n) => `El promedio diario del USDA estuvo abajo de su precio en ${b === n ? `todos los ${n} días` : b === 0 ? `ninguno de los ${n} días` : `${b} de los ${n} días`} con ventas.`,
    meter: (b, n) => `Su precio frente al último año: más alto que ${b} de ${n} días`, lo: "El más bajo del año", hi: "El más alto del año",
    sell: "por libra que puede vender", portion: (o) => `Cada porción de ${o} oz`, perBought: "Porciones por libra comprada",
    perBoughtW: (x, n) => `${x}, así que 100 porciones necesitan unas ${n} lb`, lost: "Se pierde en el recorte", lostW: (p) => `${p}% de cada libra`, math: "La cuenta",
  } : {
    match: (n, q) => `${n} item${n === 1 ? "" : "s"} that traded today ${n === 1 ? "matches" : "match"} “${q}”.`,
    none: (q) => `Nothing that traded today matches “${q}”. <a class="link" href="#every-cut">Every cut page</a> is listed further down, including the ones that didn’t trade.`,
    all: "Show everything", remove: "Remove", total: "for the order at today’s USDA weighted averages",
    head: ["Cut", "Pounds", "Per lb", "Cost"],
    week: (then, diff, p, more) => `A week earlier the same order would have cost ${then}, so it’s ${diff} (${p}%) ${more ? "more" : "less"} now.`,
    noweek: "Not every cut traded a week ago, so there’s no week-ago total.",
    fob: "Wholesale prices, FOB the packing plant; freight and handling come on top.",
    below: "Below the day’s sales", above: "Above the day’s sales", inside: "Inside the day’s range",
    belowW: (x) => `below the lowest sale that day (${x})`, aboveW: (x) => `above the highest sale that day (${x})`,
    insideW: (a, b) => `inside the day’s range of ${a} to ${b}`,
    close: "Close to the day’s average", aboveAvg: "Above the day’s average", belowAvg: "Below the day’s average",
    noRange: "compared with the day’s average (USDA gave no range)",
    same: ", the same as", vs: (d, p, up) => `, ${d} (${p}%) ${up ? "above" : "below"}`,
    avg: (g, v, d) => `USDA’s ${g}average of ${v} on ${d}`, perLb: "per lb",
    dayS: "That day’s sales", dayW: (w) => `Your price is ${w}.`, d30: "The last 30 days", d30W: (a, b) => `USDA’s daily average ran from ${a} to ${b}.`,
    yr: "The past year", yrW: (b, n) => `USDA’s daily average was below your price on ${b === n ? `every one of the ${n} days` : b === 0 ? `none of the ${n} days` : `${b} of the ${n} days`} it traded.`,
    meter: (b, n) => `Your price against the past year: higher than ${b} of ${n} days`, lo: "Lowest of the year", hi: "Highest of the year",
    sell: "per pound you can sell", portion: (o) => `Each ${o} oz portion`, perBought: "Portions per pound bought",
    perBoughtW: (x, n) => `${x}, so 100 portions take about ${n} lb`, lost: "Lost to trim", lostW: (p) => `${p}% of every pound`, math: "The math",
  };

  /* ---------------------------------------------------------------- find a cut (a board) */
  const q = $("bf-q");
  if (q) {
    $("bf-find").hidden = false;
    const rows = [...document.querySelectorAll("tr[data-find]")];
    const groups = [...document.querySelectorAll(".bf-group")];
    const ground = $("ground");
    const note = $("bf-find-n");
    const fold = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");   // "panceta" finds "Panceta", "vacio" finds "vacío"
    for (const tr of rows) tr.dataset.f = fold(tr.dataset.find);
    const run = () => {
      const terms = fold(q.value).replace(/,/g, " ").split(/\s+/).filter(Boolean);
      let n = 0;
      for (const tr of rows) {
        const ok = terms.every((t) => tr.dataset.f.includes(t));
        tr.hidden = !ok;
        if (ok) n++;
      }
      for (const g of groups) g.hidden = !g.querySelector("tr[data-find]:not([hidden])");
      if (ground) ground.hidden = terms.length > 0 && !ground.querySelector("tr[data-find]:not([hidden])");
      note.hidden = !terms.length;
      const shown = esc(q.value.trim());
      note.innerHTML = !terms.length ? "" : (n ? T.match(n, shown) : T.none(shown)) + ` <button type="button" class="rb-chip" id="bf-clear">${T.all}</button>`;
      const url = new URL(location.href);
      if (terms.length) url.searchParams.set("q", q.value.trim()); else url.searchParams.delete("q");
      history.replaceState(null, "", url);
    };
    note.addEventListener("click", (e) => { if (e.target.id === "bf-clear") { q.value = ""; run(); q.focus(); } });
    q.addEventListener("input", run);
    const start = new URL(location.href).searchParams.get("q");
    if (start) { q.value = start; run(); }
  }

  /* ---------------------------------------------------------- budget a buy (a board) */
  const bgData = $("bg-data");
  if (bgData) {
    const cuts = JSON.parse(bgData.textContent).filter(Boolean);
    const key = "bf-budget" + (base === "/beef-prices/" ? "" : ":" + base);         // the beef order keeps its old key
    const sel = $("bg-cut"), lbsIn = $("bg-lbs"), bout = $("bg-out"), bblank = bout.innerHTML;
    sel.innerHTML = cuts.map((c, i) => `<option value="${i}">${esc(c.name)}${c.grade === "Choice" || c.grade === "Price" ? "" : ` (${esc(c.grade)})`} · ${lb(c.v)}/lb</option>`).join("");
    $("budget").hidden = false;
    let order = [];
    try { order = JSON.parse(localStorage.getItem(key) || "[]").filter((o) => cuts.some((c) => c.name === o.name)); } catch (e) { order = []; }
    const keep = () => { try { localStorage.setItem(key, JSON.stringify(order)); } catch (e) { /* private window */ } };
    const draw = () => {
      if (!order.length) { bout.innerHTML = bblank; return; }
      let total = 0, then = 0, thenAll = true;
      const rows = order.map((o, i) => {
        const c = cuts.find((x) => x.name === o.name);
        const cost = (c.v / 100) * o.lbs;
        total += cost;
        if (c.then) then += (c.then / 100) * o.lbs; else thenAll = false;
        return `<tr><th scope="row">${c.slug ? `<a href="${base}${esc(c.slug)}/">${esc(c.name)}</a>` : esc(c.name)}</th><td>${n0(o.lbs)} lb</td><td>${lb(c.v)}</td><td><strong>${money(cost)}</strong></td><td><button type="button" class="rb-chip" data-drop="${i}" aria-label="${T.remove} ${esc(c.name)}">${T.remove}</button></td></tr>`;
      }).join("");
      const diff = total - then;
      bout.innerHTML = `<p class="rb-price">${money(total)} <span>${T.total}</span></p>
        <div class="rb-scroll"><table class="rb-table"><thead><tr>${T.head.map((h) => `<th scope="col">${h}</th>`).join("")}<th scope="col"></th></tr></thead><tbody>${rows}</tbody></table></div>
        ${thenAll && then > 0 ? `<p>${T.week(money(then), money(Math.abs(diff)), Math.abs((diff / then) * 100).toFixed(1), diff >= 0)}</p>` : `<p class="rb-note">${T.noweek}</p>`}
        <p class="rb-note">${T.fob}</p>`;
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
      if (c < t.low) { tag = T.below; where = T.belowW(lb(t.low)); }
      else if (c > t.high) { tag = T.above; where = T.aboveW(lb(t.high)); }
      else { tag = T.inside; where = T.insideW(lb(t.low), lb(t.high)); }
    } else {
      tag = Math.abs(pct) <= 3 ? T.close : pct > 0 ? T.aboveAvg : T.belowAvg;
      where = T.noRange;
    }
    const below = t.year.filter((v) => v < c).length, n = t.year.length;
    const sameDay = Math.abs(diff) < 0.5;
    const date = es && t.date_es ? t.date_es : t.date;
    const g = t.key ? esc(t.grade) + " " : "";
    const avgText = es ? `el promedio ${g ? g.trim() + " " : ""}del USDA de ${lb(t.v)} el ${esc(date)}` : `USDA’s ${g}average of ${lb(t.v)} on ${esc(date)}`;
    out.innerHTML = `<p class="rb-tag">${esc(tag)}</p>
      <p class="rb-price">${money(p)} <span>${T.perLb}${sameDay ? T.same : `${es ? `, ${money(Math.abs(diff) / 100)} (${Math.abs(pct).toFixed(1)}%) ${diff > 0 ? "arriba de" : "abajo de"}` : `, ${money(Math.abs(diff) / 100)} (${Math.abs(pct).toFixed(1)}%) ${diff > 0 ? "above" : "below"}`}`} ${avgText}</span></p>
      <dl class="rb-facts">
        <div><dt>${T.dayS}</dt><dd>${T.dayW(where)}</dd></div>
        ${t.d30 ? `<div><dt>${T.d30}</dt><dd>${T.d30W(lb(t.d30[0]), lb(t.d30[1]))}</dd></div>` : ""}
        ${n ? `<div><dt>${T.yr}</dt><dd>${T.yrW(below, n)}</dd></div>` : ""}
      </dl>
      ${n ? `<div class="rb-meter" role="img" aria-label="${T.meter(below, n)}"><span style="left: ${Math.round((below / n) * 100)}%"></span></div><p class="rb-meter-k"><span>${T.lo}</span><span>${T.hi}</span></p>` : ""}`;
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
    tout.innerHTML = `<p class="rb-price">${money(sellable)} <span>${T.sell}</span></p>
      <dl class="rb-facts">
        ${portion != null ? `<div><dt>${T.portion(esc(o))}</dt><dd>${money(portion)}</dd></div>` : ""}
        ${perBought != null ? `<div><dt>${T.perBought}</dt><dd>${T.perBoughtW(perBought.toFixed(2), Math.ceil(100 / perBought))}</dd></div>` : ""}
        <div><dt>${T.lost}</dt><dd>${T.lostW((100 - y).toFixed(1))}</dd></div>
        <div><dt>${T.math}</dt><dd>(${money(p)} + ${money(l)}) ÷ ${y}% = ${money(sellable)}</dd></div>
      </dl>`;
  };
  for (const el of [price, yieldIn, labor, oz]) el.addEventListener("input", trim);
  trim();
})();
