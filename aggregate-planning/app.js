/* Aggregate Planner: the page. Reads the inputs, asks the solver (solver.js) for a plan, and
 * draws the cards, charts and tables. The inputs live in the address after "#", so a reload
 * or a shared link brings the same scenario back. Add ?debug=1 to see every constraint's slack.
 */
(() => {
  "use strict";
  const M = window.APModel;
  const $ = (id) => document.getElementById(id);
  const DEBUG = new URLSearchParams(location.search).get("debug") === "1";
  const POLICY_HINT = {
    level: "Keeps the starting workforce all year. Inventory, overtime and backlog absorb the swings in demand.",
    band: "Lets the workforce move, but only between a minimum and a maximum number of teams.",
    chase: "Hires and lays off freely so the workforce follows demand.",
  };

  /* ---------- the fields, described once ----------
     unit: shown beside the name; "$" and "u" are swapped for the currency and unit labels.
     optional: a blank field means "no limit" (the placeholder says which). */
  const FIELDS = {
    "band-fields": [
      { k: "Wmin", name: "Fewest teams", unit: "teams", tip: "The workforce can never drop below this many teams." },
      { k: "Wmax", name: "Most teams", unit: "teams", tip: "The workforce can never grow above this many teams." },
    ],
    "fields-labor": [
      { k: "teamSize", name: "Workers per team", unit: "workers", tip: "People hired, paid and laid off together as one team." },
      { k: "rate", name: "Output per team-hour", unit: "u / h", tip: "Units one team makes in one hour, regular time or overtime." },
      { k: "daysPerMonth", name: "Days per month", unit: "days", tip: "Regular working days in a month." },
      { k: "hoursPerDay", name: "Hours per day", unit: "hours", tip: "Regular hours in a working day." },
      { k: "maxOTPerWorker", name: "Overtime limit", unit: "h / worker", tip: "Most overtime hours one worker can put in a month. Everyone on a team works the same overtime." },
      { k: "wageReg", name: "Regular wage", unit: "$ / h", tip: "Pay per worker-hour of regular time. Every employed worker is paid for the full regular schedule." },
      { k: "wageOT", name: "Overtime wage", unit: "$ / h", tip: "Pay per worker-hour of overtime." },
      { k: "hireCost", name: "Hiring cost", unit: "$ / worker", tip: "Recruiting and training one new worker." },
      { k: "layoffCost", name: "Layoff cost", unit: "$ / worker", tip: "Severance and paperwork for one worker let go." },
    ],
    "fields-inv": [
      { k: "holdCost", name: "Holding cost", unit: "$ / u / mo", tip: "Cost of keeping one unit in stock at the end of a month: storage, capital, spoilage." },
      { k: "backlogCost", name: "Backlog cost", unit: "$ / u / mo", tip: "Cost of making a customer wait one more month for one unit: discounts, lost goodwill." },
      { k: "maxBacklog", name: "Backlog cap", unit: "u", optional: "no cap", tip: "The most unfilled orders allowed at the end of any month. 0 means every order ships on time." },
    ],
    "fields-mat": [
      { k: "materialCost", name: "Material cost", unit: "$ / u", tip: "Material in each unit you make yourself." },
      { k: "subCost", name: "Subcontract price", unit: "$ / u", tip: "What an outside supplier charges per finished unit." },
      { k: "subCap", name: "Subcontract cap", unit: "u / mo", optional: "none", tip: "Most units an outside supplier can deliver in a month. Blank or 0 turns subcontracting off." },
    ],
    "fields-ends": [
      { k: "W0", name: "Starting teams", unit: "teams", tip: "Teams on the payroll just before month 1." },
      { k: "endTeams", name: "Ending teams", unit: "teams", optional: "any", tip: "Teams that must be on the payroll after the last month. Blank leaves it to the optimizer." },
      { k: "I0", name: "Starting inventory", unit: "u", tip: "Units in stock just before month 1." },
      { k: "endInvMin", name: "Ending inventory", unit: "u, at least", tip: "Stock that must be left after the last month, as a buffer for what comes next." },
      { k: "S0", name: "Starting backlog", unit: "u", tip: "Orders already late when the plan starts." },
    ],
  };
  const ALL = Object.values(FIELDS).flat();

  /* ---------- formatting ---------- */
  const nf = (max) => new Intl.NumberFormat("en-US", { maximumFractionDigits: max });
  const f0 = nf(0), f2 = nf(2), f1 = nf(1);
  const q = (v) => f2.format(M.clean(v) || 0);
  let cur = "$", unit = "units";
  const money = (v) => { const s = f2.format(Math.abs(v) < 0.005 ? 0 : v); const neg = s.startsWith("-"); const a = neg ? s.slice(1) : s; return (neg ? "−" : "") + (cur.length > 1 ? cur + " " + a : cur + a); };
  const unitText = (u) => u.replace(/\$/g, cur || "$").replace(/\bu\b/g, unit || "units");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- building the inputs ---------- */
  function buildFields() {
    for (const [box, list] of Object.entries(FIELDS)) {
      $(box).innerHTML = list.map((f) => `
        <label class="ap-field"><span class="ap-name">${esc(f.name)}
          <span class="ap-tip" tabindex="0" role="note" aria-label="${esc(f.tip)}">?<span class="ap-tip-text" aria-hidden="true">${esc(f.tip)}</span></span>
          <span class="ap-unit" data-unit="${esc(f.unit)}"></span></span>
          <input id="f-${f.k}" type="number" step="any" min="0" inputmode="decimal"${f.optional ? ` placeholder="${esc(f.optional)}"` : ""} aria-describedby="d-${f.k}">
          <span id="d-${f.k}" hidden>${esc(f.tip)}</span></label>`).join("");
    }
  }
  function paintUnits() {
    for (const el of document.querySelectorAll(".ap-unit")) el.textContent = unitText(el.dataset.unit);
    $("unit-note").textContent = `${unit || "units"} · ${cur || "$"}`;
  }
  function buildDemand(values) {
    $("demand").innerHTML = values.map((v, i) => `<label><span>M${i + 1}</span><input type="number" step="any" min="0" inputmode="decimal" data-m="${i}" value="${v === null || v === undefined || Number.isNaN(v) ? "" : v}" aria-label="Demand, month ${i + 1}"></label>`).join("");
  }

  /* ---------- state: DOM <-> object <-> address ---------- */
  const numOrNull = (s) => { if (s === null || s === undefined || String(s).trim() === "") return null; const v = Number(String(s).replace(/[,\s]/g, "")); return Number.isFinite(v) ? v : NaN; };
  function read() {
    const x = { demand: [...$("demand").querySelectorAll("input")].map((i) => { const v = numOrNull(i.value); return v === null ? NaN : v; }) };
    for (const f of ALL) {
      const v = numOrNull($("f-" + f.k).value);
      x[f.k] = v === null ? (f.optional ? null : NaN) : v;
    }
    if (x.subCap === 0) x.subCap = null;
    if (!Number.isFinite(x.subCost) && !x.subCap) x.subCost = 0;
    x.noEndBacklog = $("f-noEndBacklog").checked;
    const policy = (document.querySelector('input[name="policy"]:checked') || {}).value || "chase";
    return { x, policy, whole: $("f-whole").checked, cur: $("f-currency").value.trim() || "$", unit: $("f-unit").value.trim() || "units" };
  }
  function write(s) {
    $("f-months").value = s.x.demand.length;
    buildDemand(s.x.demand);
    for (const f of ALL) { const v = s.x[f.k]; $("f-" + f.k).value = v === null || v === undefined || Number.isNaN(v) ? "" : v; }
    $("f-noEndBacklog").checked = !!s.x.noEndBacklog;
    $("f-whole").checked = !!s.whole;
    for (const r of document.querySelectorAll('input[name="policy"]')) r.checked = r.value === s.policy;
    $("f-currency").value = s.cur; $("f-unit").value = s.unit;
    showPolicy(s.policy);
  }
  const sample = () => ({ x: JSON.parse(JSON.stringify(M.SAMPLE)), policy: "chase", whole: true, cur: "$", unit: "units" });

  function toHash(s) {
    const p = new URLSearchParams();
    p.set("d", s.x.demand.map((v) => (Number.isFinite(v) ? v : "")).join(","));
    p.set("p", s.policy); p.set("wt", s.whole ? "1" : "0"); p.set("eb", s.x.noEndBacklog ? "1" : "0");
    for (const f of ALL) { const v = s.x[f.k]; p.set(f.k, v === null || v === undefined || Number.isNaN(v) ? "" : String(v)); }
    p.set("cur", s.cur); p.set("unit", s.unit);
    return "#" + p.toString().replace(/%2C/g, ","); // commas read better in a shared link
  }
  function fromHash(h) {
    if (!h || h.length < 3) return null;
    try {
      const p = new URLSearchParams(h.slice(1));
      if (!p.has("d")) return null;
      const s = sample();
      s.x.demand = p.get("d").split(",").slice(0, 24).map((v) => { const n = numOrNull(v); return n === null ? NaN : n; });
      if (!s.x.demand.length) return null;
      if (["level", "band", "chase"].includes(p.get("p"))) s.policy = p.get("p");
      if (p.has("wt")) s.whole = p.get("wt") === "1";
      if (p.has("eb")) s.x.noEndBacklog = p.get("eb") === "1";
      for (const f of ALL) if (p.has(f.k)) { const n = numOrNull(p.get(f.k)); s.x[f.k] = n === null ? (f.optional ? null : NaN) : n; }
      if (p.get("cur")) s.cur = p.get("cur").slice(0, 6);
      if (p.get("unit")) s.unit = p.get("unit").slice(0, 16);
      return s;
    } catch (e) { return null; }
  }

  function showPolicy(policy) {
    $("policy-hint").textContent = POLICY_HINT[policy];
    $("band-fields").hidden = policy !== "band";
  }
  // Flags the fields that can't be used as they are; the model's own check says why.
  function markInvalid(s) {
    for (const i of $("demand").querySelectorAll("input")) { const v = numOrNull(i.value); i.setAttribute("aria-invalid", String(v === null || !(v >= 0))); }
    for (const f of ALL) {
      const v = s.x[f.k], el = $("f-" + f.k);
      const bad = (f.k === "Wmin" || f.k === "Wmax") && s.policy !== "band" ? false : (v === null ? false : !(v >= 0));
      el.setAttribute("aria-invalid", String(bad));
    }
  }

  /* ---------- solving ---------- */
  let seq = 0, timer = 0, compareOpen = false, last = null;
  function schedule(delay = 300) { clearTimeout(timer); timer = setTimeout(run, delay); }

  function run() {
    clearTimeout(timer);
    const s = read();
    cur = s.cur; unit = s.unit; paintUnits();
    markInvalid(s);
    try { history.replaceState(null, "", location.pathname + location.search + toHash(s)); } catch (e) {}
    const runs = compareOpen ? M.POLICIES.map((p) => ({ policy: p, wholeTeams: s.whole }))
      : [{ policy: s.policy, wholeTeams: s.whole }, ...(s.policy === "level" ? [] : [{ policy: "level", wholeTeams: s.whole }])];
    const id = ++seq;
    $("plan-out").classList.add("is-stale");
    $("status").textContent = "Solving…";
    APSolver.solve(s.x, runs, DEBUG).then((results) => {
      if (id !== seq) return; // a newer request is on its way
      render(s, results);
    }, (err) => {
      if (id !== seq) return;
      showError(err.message);
    });
  }

  function showError(message) {
    $("error").hidden = false; $("error").textContent = message;
    $("plan-out").hidden = true; $("plan-out").classList.remove("is-stale");
    $("status").textContent = "";
  }

  function render(s, results) {
    const by = Object.fromEntries(results.map((r) => [r.policy, r]));
    const main = by[s.policy], level = by.level;
    last = { s, results };
    if (compareOpen) renderCompare(s, by);
    if (!main.ok) { showError(main.message); if (DEBUG) $("debug").hidden = true; return; }
    const p = main.plan;
    $("error").hidden = true; $("plan-out").hidden = false; $("plan-out").classList.remove("is-stale");
    $("status").textContent = `Optimal plan · ${M.POLICY_NAMES[s.policy]} · ${s.whole ? "whole teams" : "fractional teams allowed"} · solved in ${f0.format(Math.max(1, p.ms))} ms`;

    // headline cards
    let save = { v: "—", s: "This is the level plan" };
    if (s.policy !== "level") {
      if (level && level.ok) {
        const d = level.plan.total - p.total, pct = level.plan.total ? (d / level.plan.total) * 100 : 0;
        save = { v: money(d), s: `${f1.format(pct)}% below ${money(level.plan.total)}` };
      } else save = { v: "—", s: "No feasible level plan" };
    }
    const cards = [
      ["Total cost", money(p.total), `${f0.format(p.months.length)} months`],
      ["Savings vs. level", save.v, save.s],
      ["Peak inventory", q(p.peakInv.v), p.peakInv.v > 0 ? `${unit}, month ${p.peakInv.t}` : unit],
      ["Peak workforce", q(p.peakW.v), `teams, month ${p.peakW.t}`],
    ];
    $("cards").innerHTML = cards.map(([k, v, sub]) => `<div class="ap-card"><span class="ap-label">${esc(k)}</span><span class="v">${esc(v)}</span><span class="s">${esc(sub)}</span></div>`).join("");

    renderPlanTable(p);
    renderCosts(p);
    drawCharts(s, p);
    if (DEBUG) renderDebug(p);
  }

  function cell(v, fmt = q) { const c = M.clean(v); return `<td${c === 0 ? ' class="z"' : ""}>${fmt(c)}</td>`; }
  function renderPlanTable(p) {
    const sub = p.months.some((m) => m.C > 0) || last.s.x.subCap > 0;
    const head = ["Month", "Hired", "Laid off", "Teams", "OT team-h", "Production", ...(sub ? ["Subcontracted"] : []), "Demand", "Inventory", "Backlog"];
    const sum = (k) => p.months.reduce((a, m) => a + m[k], 0);
    const rows = p.months.map((m) => `<tr><td>${m.t}</td>${cell(m.H)}${cell(m.L)}${cell(m.W)}${cell(m.O)}${cell(m.P)}${sub ? cell(m.C) : ""}${cell(m.D)}${cell(m.I)}${cell(m.S)}</tr>`).join("");
    $("t-plan").innerHTML = `<caption class="ap-label" hidden>Monthly plan</caption><thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td>Total</td><td>${q(sum("H"))}</td><td>${q(sum("L"))}</td><td></td><td>${q(sum("O"))}</td><td>${q(sum("P"))}</td>${sub ? `<td>${q(sum("C"))}</td>` : ""}<td>${q(sum("D"))}</td><td></td><td></td></tr></tfoot>`;
  }
  function renderCosts(p) {
    const rows = p.costs.map(([k, v]) => `<tr><td>${k}</td>${cell(v, money)}<td>${p.total ? f1.format((v / p.total) * 100) + "%" : "—"}</td></tr>`).join("");
    $("t-costs").innerHTML = `<thead><tr><th scope="col">Category</th><th scope="col">Cost</th><th scope="col">Share</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td>Total</td><td>${money(p.total)}</td><td>100%</td></tr></tfoot>`;
  }
  function renderDebug(p) {
    $("debug").hidden = false;
    const tol = 1e-6 * Math.max(1, ...p.months.map((m) => m.D));
    const c = (v, eq) => { if (Math.abs(v) < tol * 1e-3) v = 0; /* float dust reads as 0 */ const bad = eq ? Math.abs(v) > tol : v < -tol; return `<td${bad ? ' class="bad"' : ""}>${v.toPrecision(6)}</td>`; };
    $("t-debug").innerHTML = `<thead><tr><th>Month</th><th>Workforce balance (=0)</th><th>Inventory balance (=0)</th><th>Overtime slack (≥0)</th><th>Capacity slack (≥0)</th></tr></thead><tbody>${
      p.slacks.map((r) => `<tr><td>${r.t}</td>${c(r.workforce, true)}${c(r.balance, true)}${c(r.overtime)}${c(r.capacity)}</tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="5">Solver objective ${p.objective} · breakdown total ${p.total} · difference ${(p.objective - p.total).toPrecision(4)}</td></tr></tfoot>`;
    $("lp").textContent = p.lp || "";
  }

  function renderCompare(s, by) {
    $("compare").hidden = false;
    const level = by.level && by.level.ok ? by.level.plan : null;
    $("t-compare").innerHTML = `<thead><tr><th scope="col">Policy</th><th scope="col">Total cost</th><th scope="col">Savings vs. level</th><th scope="col">Peak inventory</th><th scope="col">Peak teams</th><th scope="col">Teams hired</th><th scope="col">Teams laid off</th></tr></thead><tbody>${
      M.POLICIES.map((pol, i) => {
        const r = by[pol], name = `<span class="sw" style="background:var(--ap-s${i + 1})"></span>${M.POLICY_NAMES[pol]}`;
        const cls = pol === s.policy ? ' class="cur"' : "";
        if (!r || !r.ok) return `<tr${cls}><td>${name}</td><td colspan="6" style="text-align:left">No feasible plan${r && r.message ? ": " + esc(r.message.replace(/^No feasible plan: /, "")) : ""}</td></tr>`;
        const p = r.plan, sv = level ? level.total - p.total : null;
        return `<tr${cls}><td>${name}</td><td>${money(p.total)}</td><td>${sv === null ? "—" : pol === "level" ? "—" : `${money(sv)} (${f1.format((sv / level.total) * 100)}%)`}</td><td>${q(p.peakInv.v)} <span class="z">(m${p.peakInv.t})</span></td><td>${q(p.peakW.v)}</td>${cell(p.hires)}${cell(p.layoffs)}</tr>`;
      }).join("")}</tbody>`;
    drawCompare(by);
  }

  /* ---------- charts ---------- */
  const charts = {};
  const css = (name) => getComputedStyle($("tool")).getPropertyValue(name).trim();
  const alpha = (hex, a) => { const m = hex.match(/^#([0-9a-f]{6})$/i); if (!m) return hex; const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
  function baseOptions() {
    const ink = css("--text-2"), muted = css("--muted"), rule = css("--rule");
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      layout: { padding: { top: 4 } },
      plugins: {
        legend: { position: "top", align: "start", labels: { usePointStyle: true, boxWidth: 10, boxHeight: 10, padding: 16, color: ink, font: { family: css("--sans"), size: 12 } } },
        tooltip: {
          backgroundColor: css("--ink"), titleColor: css("--on-ink"), bodyColor: css("--on-ink"), cornerRadius: 0, padding: 10, boxPadding: 4, usePointStyle: true,
          titleFont: { family: css("--sans"), size: 11, weight: "500" }, bodyFont: { family: css("--mono"), size: 12 },
          callbacks: { title: (it) => `Month ${it[0].label}`, label: (c) => ` ${c.dataset.label}: ${q(c.parsed.y)}` },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { color: rule }, ticks: { color: muted, font: { family: css("--mono"), size: 11 } } },
        y: { beginAtZero: true, grid: { color: rule }, border: { display: false }, ticks: { color: muted, font: { family: css("--mono"), size: 11 }, maxTicksLimit: 6, callback: (v) => compact.format(v) } },
      },
    };
  }
  const put = (key, canvas, config) => { if (charts[key]) charts[key].destroy(); charts[key] = new Chart($(canvas), config); };
  const line = (label, data, color, dash) => ({ type: "line", label, data, borderColor: color, backgroundColor: color, borderWidth: 2, borderDash: dash || [], pointRadius: 0, pointHoverRadius: 4, pointStyle: "line", tension: 0, order: 0 });
  const bars = (label, data, color, stack) => ({ type: "bar", label, data, backgroundColor: color, borderWidth: 0, borderRadius: 0, categoryPercentage: 0.72, barPercentage: 0.92, pointStyle: "rect", stack, order: 1 });

  function drawCharts(s, p) {
    if (!window.Chart) return;
    const labels = p.months.map((m) => String(m.t));
    const col = (k) => p.months.map((m) => M.clean(m[k]));
    const s1 = css("--ap-s1"), s2 = css("--ap-s2"), s3 = css("--ap-s3");
    const ds = [bars("Demand", col("D"), css("--ap-demand"), "d"), bars("Production", col("P"), s1, "p")];
    if (p.months.some((m) => m.C > 0)) ds.push(bars("Subcontracted", col("C"), alpha(s1, 0.4), "p"));
    ds.push({ ...line("Inventory", col("I"), s2), stack: "i" });
    if (p.months.some((m) => m.S > 0)) ds.push({ ...line("Backlog", col("S"), s3, [6, 4]), stack: "s" });
    // Demand and production sit side by side (separate stacks); subcontracting stacks on production.
    const o = baseOptions(); o.scales.x.stacked = true; o.scales.y.stacked = true;
    put("units", "c-units", { data: { labels, datasets: ds }, options: o });

    const acc = css("--accent");
    const tds = [bars("Teams", col("W"), acc)];
    if (s.policy === "band" && Number.isFinite(s.x.Wmin) && Number.isFinite(s.x.Wmax)) {
      const edge = (label, v) => ({ ...line(label, labels.map(() => v), css("--muted"), [3, 3]), pointHoverRadius: 0 });
      tds.push(edge("Most teams", s.x.Wmax), edge("Fewest teams", s.x.Wmin));
    }
    const to = baseOptions();
    to.plugins.legend.display = false;
    to.plugins.tooltip.filter = (c) => c.dataset.label === "Teams";
    to.scales.y.ticks.maxTicksLimit = 4; to.scales.y.ticks.callback = (v) => f2.format(v);
    put("teams", "c-teams", { data: { labels, datasets: tds }, options: to });
  }
  function drawCompare(by) {
    if (!window.Chart) return;
    const any = M.POLICIES.map((pol) => by[pol]).find((r) => r && r.ok);
    if (!any) { if (charts.compare) { charts.compare.destroy(); delete charts.compare; } return; }
    const labels = any.plan.months.map((m) => String(m.t));
    const ds = M.POLICIES.map((pol, i) => by[pol] && by[pol].ok ? line(M.POLICY_NAMES[pol], by[pol].plan.months.map((m) => M.clean(m.I)), css(`--ap-s${i + 1}`)) : null).filter(Boolean);
    put("compare", "c-compare", { type: "line", data: { labels, datasets: ds }, options: baseOptions() });
  }
  function redraw() {
    if (!last) return;
    const by = Object.fromEntries(last.results.map((r) => [r.policy, r]));
    const main = by[last.s.policy];
    if (main && main.ok) drawCharts(last.s, main.plan);
    if (compareOpen) drawCompare(by);
  }

  /* ---------- CSV and share link ---------- */
  function csv() {
    if (!last) return;
    const r = last.results.find((x) => x.policy === last.s.policy);
    if (!r || !r.ok) return;
    const p = r.plan, sub = p.months.some((m) => m.C > 0);
    const cellv = (v) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [["Month", "Hired (teams)", "Laid off (teams)", "Teams", "Overtime (team-hours)", `Production (${last.s.unit})`, ...(sub ? [`Subcontracted (${last.s.unit})`] : []), `Demand (${last.s.unit})`, `Inventory (${last.s.unit})`, `Backlog (${last.s.unit})`]];
    for (const m of p.months) lines.push([m.t, m.H, m.L, m.W, m.O, m.P, ...(sub ? [m.C] : []), m.D, m.I, m.S].map((v) => M.clean(v)));
    lines.push([], ["Cost category", `Cost (${last.s.cur})`]);
    for (const [k, v] of p.costs) lines.push([k, v]);
    lines.push(["Total", p.total], [], ["Policy", M.POLICY_NAMES[last.s.policy]], ["Whole teams only", last.s.whole ? "yes" : "no"], ["Scenario", location.href]);
    const blob = new Blob([lines.map((l) => l.map(cellv).join(",")).join("\r\n") + "\r\n"], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `aggregate-plan-${last.s.policy}.csv`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  async function share() {
    const b = $("b-share"), was = "Copy share link";
    try { await navigator.clipboard.writeText(location.href); b.textContent = "Link copied"; }
    catch (e) { window.prompt("Copy this link:", location.href); }
    setTimeout(() => { b.textContent = was; }, 2000);
  }

  /* ---------- paste a column ---------- */
  function paste() {
    const raw = $("f-paste").value.trim();
    if (!raw) return;
    let parts = raw.split(/[\r\n\t;]+/).map((x) => x.trim()).filter(Boolean);
    if (parts.length === 1) parts = parts[0].split(/\s+/);
    const vals = parts.map((x) => numOrNull(x.replace(/[^\d.,\-]/g, ""))).filter((v) => v !== null && Number.isFinite(v)).slice(0, 24);
    if (!vals.length) { $("status").textContent = "Couldn't find any numbers in what was pasted."; return; }
    $("f-months").value = vals.length;
    buildDemand(vals);
    $("f-paste").value = "";
    run();
  }

  /* ---------- wiring ---------- */
  function init() {
    buildFields();
    write(fromHash(location.hash) || sample());
    $("tool").hidden = false;
    const form = $("inputs");
    form.addEventListener("input", (e) => {
      if (e.target.id === "f-paste") return;
      if (e.target.id === "f-months") {
        const n = Math.round(Number(e.target.value));
        if (!(n >= 1 && n <= 24)) return;
        const d = [...$("demand").querySelectorAll("input")].map((i) => numOrNull(i.value));
        const next = Array.from({ length: n }, (_, i) => (i < d.length ? d[i] : d[d.length - 1] ?? 0));
        buildDemand(next);
      }
      if (e.target.name === "policy") showPolicy(e.target.value);
      schedule(e.target.type === "radio" || e.target.type === "checkbox" ? 0 : 300);
    });
    form.addEventListener("submit", (e) => { e.preventDefault(); run(); });
    $("b-compare").addEventListener("click", () => { compareOpen = true; run(); $("compare").scrollIntoView({ behavior: "smooth", block: "start" }); });
    $("b-compare-close").addEventListener("click", () => { compareOpen = false; $("compare").hidden = true; if (charts.compare) { charts.compare.destroy(); delete charts.compare; } });
    $("b-reset").addEventListener("click", () => { write(sample()); run(); });
    $("b-paste").addEventListener("click", paste);
    $("b-csv").addEventListener("click", csv);
    $("b-share").addEventListener("click", share);
    window.addEventListener("hashchange", () => { const s = fromHash(location.hash); if (s) { write(s); run(); } });
    // Charts read the theme's colors when drawn, so draw them again when the theme changes.
    new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
    if (window.Chart) { Chart.defaults.font.family = css("--sans"); }
    run();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/aggregate-planning/sw.js").catch(() => {});
  }
  init();
})();
