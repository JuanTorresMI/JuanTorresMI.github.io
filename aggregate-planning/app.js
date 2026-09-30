/* Aggregate Planner: the page. Reads the inputs, asks the solver (solver.js) for the level, band
 * and chase plans, and draws the answers table, the charts and the plan tables. The inputs live in
 * the address after "#", so a reload or a shared link brings the same scenario back. Add ?debug=1
 * to see every constraint's slack.
 */
(() => {
  "use strict";
  const M = window.APModel;
  const $ = (id) => document.getElementById(id);
  const DEBUG = new URLSearchParams(location.search).get("debug") === "1";

  /* ---------- the fields, described once ----------
     unit: shown beside the name. "$" is the currency label, "Q" the counted quantity ("units",
     "thousand units"), "u" one unit. optional: a blank field means "no limit" (the placeholder says which). */
  const FIELDS = {
    "band-fields": [
      { k: "Wmin", name: "Band: fewest teams", unit: "teams", tip: "In the band plan, the workforce never drops below this many teams." },
      { k: "Wmax", name: "Band: most teams", unit: "teams", tip: "In the band plan, the workforce never grows above this many teams." },
    ],
    "fields-labor": [
      { k: "teamSize", name: "Workers per team", unit: "workers", tip: "People hired, paid and laid off together as one team." },
      { k: "rate", name: "Output per team-hour", unit: "u / h", tip: "Units one team makes in one hour, regular time or overtime. 1,000 units per 8-hour shift is 125 an hour." },
      { k: "daysPerMonth", name: "Days per month", unit: "days", tip: "Regular working days in a month." },
      { k: "hoursPerDay", name: "Hours per day", unit: "hours", tip: "Regular hours in a working day." },
      { k: "maxOTPerWorker", name: "Overtime limit", unit: "h / worker", tip: "Most overtime hours one worker can put in a month. Everyone on a team works the same overtime." },
      { k: "wageReg", name: "Regular wage", unit: "$ / h", tip: "Pay per worker-hour of regular time. Every employed worker is paid for the full regular schedule." },
      { k: "wageOT", name: "Overtime wage", unit: "$ / h", tip: "Pay per worker-hour of overtime." },
      { k: "hireCost", name: "Hiring cost", unit: "$ / worker", tip: "Recruiting and training one new worker. A team costs this times its size." },
      { k: "layoffCost", name: "Layoff cost", unit: "$ / worker", tip: "Severance and paperwork for one worker let go. A team costs this times its size." },
    ],
    "fields-inv": [
      { k: "holdCost", name: "Holding cost", unit: "$ / u / mo", tip: "Cost of carrying one unit in inventory from one month to the next." },
      { k: "backlogCost", name: "Stockout cost", unit: "$ / u / mo", tip: "Cost of each unit of demand filled a month late from next month's production: discounts, lost goodwill." },
      { k: "maxBacklog", name: "Stockout cap", unit: "Q", optional: "no cap", tip: "The most unfilled orders allowed at the end of any month. 0 means every order ships on time." },
    ],
    "fields-mat": [
      { k: "materialCost", name: "Material cost", unit: "$ / u", tip: "Material in each unit you make yourself." },
      { k: "subCost", name: "Subcontract price", unit: "$ / u", tip: "What an outside supplier charges per finished unit." },
      { k: "subCap", name: "Subcontract cap", unit: "Q / mo", optional: "none", tip: "Most units an outside supplier can deliver in a month. Blank or 0 turns subcontracting off." },
    ],
    "fields-ends": [
      { k: "W0", name: "Starting teams", unit: "teams", tip: "Teams on the payroll just before month 1. The level plan keeps exactly this many." },
      { k: "endTeams", name: "Ending teams", unit: "teams", optional: "any", tip: "Teams that must be on the payroll after the last month. Blank leaves it to the optimizer." },
      { k: "I0", name: "Starting inventory", unit: "Q", tip: "Units in stock just before month 1." },
      { k: "endInvMin", name: "Ending inventory", unit: "Q, at least", tip: "Stock that must be left after the last month. Holding costs keep the plan from leaving more." },
      { k: "S0", name: "Starting stockout", unit: "Q", tip: "Orders already late when the plan starts." },
    ],
  };
  const ALL = Object.values(FIELDS).flat();
  const SCALES = { 1: "", 1000: "thousand", 1000000: "million" };

  /* ---------- formatting ---------- */
  const nf = (max) => new Intl.NumberFormat("en-US", { maximumFractionDigits: max });
  const f0 = nf(0), f2 = nf(2), f1 = nf(1);
  const q = (v) => f2.format(M.clean(v) || 0);
  let cur = "$", unit = "units", scale = 1;
  const counted = () => (SCALES[scale] ? SCALES[scale] + " " : "") + (unit || "units");
  // Money on screen: very large totals (some currencies run to trillions) are shown in
  // millions or billions, picked once per solve so a column never mixes scales. Downloads keep full values.
  let mdiv = 1, mword = "";
  const scaled = (v) => f2.format(Math.abs(v / mdiv) < 0.005 ? 0 : v / mdiv);
  const money = (v) => { const s = scaled(v); const neg = s.startsWith("-"); const a = neg ? s.slice(1) : s; return (neg ? "−" : "") + (cur.length > 1 ? cur + " " + a : cur + a) + (mword ? " " + mword : ""); };
  function pickMoneyScale(totals) {
    const top = Math.max(0, ...totals.map(Math.abs));
    [mdiv, mword] = top >= 1e12 ? [1e9, "bn"] : top >= 1e9 ? [1e6, "M"] : [1, ""];
  }
  const unitText = (u) => u.replace(/\$/g, cur || "$").replace(/\bQ\b/g, counted()).replace(/\bu\b/g, "unit");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const NAMES = M.POLICY_NAMES;

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
    $("unit-note").textContent = `${counted()} · ${cur || "$"}`;
  }
  function buildDemand(values) {
    $("demand").innerHTML = values.map((v, i) => `<label><span>M${i + 1}</span><input type="number" step="any" min="0" inputmode="decimal" data-m="${i}" value="${v === null || v === undefined || Number.isNaN(v) ? "" : v}" aria-label="Demand, month ${i + 1}"></label>`).join("");
  }

  /* ---------- state: DOM <-> object <-> address ---------- */
  const numOrNull = (s) => { if (s === null || s === undefined || String(s).trim() === "") return null; const v = Number(String(s).replace(/[,\s]/g, "")); return Number.isFinite(v) ? v : NaN; };
  const policyNow = () => (document.querySelector('input[name="policy"]:checked') || {}).value || "chase";
  function read() {
    const x = { demand: [...$("demand").querySelectorAll("input")].map((i) => { const v = numOrNull(i.value); return v === null ? NaN : v; }) };
    for (const f of ALL) {
      const v = numOrNull($("f-" + f.k).value);
      x[f.k] = v === null ? (f.optional ? null : NaN) : v;
    }
    if (x.subCap === 0) x.subCap = null;
    if (!Number.isFinite(x.subCost) && !x.subCap) x.subCost = 0;
    x.noEndBacklog = $("f-noEndBacklog").checked;
    x.scale = Number($("f-scale").value) || 1;
    return { x, policy: policyNow(), whole: $("f-whole").checked, cur: $("f-currency").value.trim() || "$", unit: $("f-unit").value.trim() || "units" };
  }
  function write(s) {
    $("f-months").value = s.x.demand.length;
    buildDemand(s.x.demand);
    for (const f of ALL) { const v = s.x[f.k]; $("f-" + f.k).value = v === null || v === undefined || Number.isNaN(v) ? "" : v; }
    $("f-noEndBacklog").checked = !!s.x.noEndBacklog;
    $("f-whole").checked = !!s.whole;
    $("f-scale").value = String(SCALES[s.x.scale] !== undefined ? s.x.scale : 1);
    for (const r of document.querySelectorAll('input[name="policy"]')) r.checked = r.value === s.policy;
    $("f-currency").value = s.cur; $("f-unit").value = s.unit;
  }
  const sample = () => ({ x: JSON.parse(JSON.stringify(M.SAMPLE)), policy: "chase", whole: true, cur: "$", unit: "units" });

  function toHash(s) {
    const p = new URLSearchParams();
    p.set("d", s.x.demand.map((v) => (Number.isFinite(v) ? v : "")).join(","));
    p.set("p", s.policy); p.set("wt", s.whole ? "1" : "0"); p.set("eb", s.x.noEndBacklog ? "1" : "0");
    if (s.x.scale !== 1) p.set("sc", String(s.x.scale));
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
      if (M.POLICIES.includes(p.get("p"))) s.policy = p.get("p");
      if (p.has("wt")) s.whole = p.get("wt") === "1";
      if (p.has("eb")) s.x.noEndBacklog = p.get("eb") === "1";
      s.x.scale = SCALES[p.get("sc")] !== undefined ? Number(p.get("sc")) : 1;
      for (const f of ALL) if (p.has(f.k)) { const n = numOrNull(p.get(f.k)); s.x[f.k] = n === null ? (f.optional ? null : NaN) : n; }
      if (p.get("cur")) s.cur = p.get("cur").slice(0, 6);
      if (p.get("unit")) s.unit = p.get("unit").slice(0, 16);
      return s;
    } catch (e) { return null; }
  }

  // Flags the fields that can't be used as they are; the model's own check says why.
  function markInvalid(s) {
    for (const i of $("demand").querySelectorAll("input")) { const v = numOrNull(i.value); i.setAttribute("aria-invalid", String(v === null || !(v >= 0))); }
    for (const f of ALL) {
      const v = s.x[f.k];
      $("f-" + f.k).setAttribute("aria-invalid", String(v === null ? false : !(v >= 0)));
    }
  }
  function saveHash(s) { try { history.replaceState(null, "", location.pathname + location.search + toHash(s)); } catch (e) {} }

  /* ---------- solving: all three policies, every time ---------- */
  let seq = 0, timer = 0, last = null;
  function schedule(delay = 300) { clearTimeout(timer); timer = setTimeout(run, delay); }

  function run() {
    clearTimeout(timer);
    const s = read();
    cur = s.cur; unit = s.unit; scale = s.x.scale; paintUnits();
    markInvalid(s);
    saveHash(s);
    const id = ++seq;
    $("out").classList.add("is-stale");
    $("status").textContent = "Solving the three plans…";
    APSolver.solve(s.x, M.POLICIES.map((p) => ({ policy: p, wholeTeams: s.whole })), DEBUG).then((results) => {
      if (id !== seq || !results) return; // a newer request is on its way
      render(s, results);
    }, (err) => {
      if (id !== seq) return;
      showError(err.message);
    });
  }

  function showError(message) {
    $("error").hidden = false; $("error").textContent = message;
    $("out").hidden = true; $("out").classList.remove("is-stale");
    $("status").textContent = "";
    if (DEBUG) $("debug").hidden = true;
  }

  function render(s, results) {
    const by = Object.fromEntries(results.map((r) => [r.policy, r]));
    last = { s, by };
    const ok = results.filter((r) => r.ok);
    // The same message for every policy means the inputs themselves are the problem.
    if (!ok.length && results.every((r) => r.message === results[0].message)) return showError(results[0].message);
    $("error").hidden = true; $("out").hidden = false; $("out").classList.remove("is-stale");
    const ms = ok.reduce((a, r) => a + r.plan.ms, 0);
    pickMoneyScale(ok.map((r) => r.plan.total));
    $("status").textContent = `${ok.length} of 3 plans optimal · ${s.whole ? "whole teams" : "fractional teams allowed"} · solved in ${f0.format(Math.max(1, ms))} ms`;
    renderAnswers(s, by);
    drawCompare(by);
    renderDetail();
  }

  const levelOf = (by) => (by.level && by.level.ok ? by.level.plan : null);
  const saving = (by, pol) => {
    const level = levelOf(by), r = by[pol];
    if (pol === "level" || !level || !r || !r.ok) return null;
    const d = level.total - r.plan.total;
    return { d, pct: level.total ? (d / level.total) * 100 : 0, base: level.total };
  };

  /* ---------- the answers table: what the case questions ask, for all three ---------- */
  function renderAnswers(s, by) {
    const pols = M.POLICIES, sel = s.policy;
    const th = (pol, i) => `<th scope="col"${pol === sel ? ' class="cur"' : ""}><span class="sw" style="background:var(--ap-s${i + 1})"></span>${NAMES[pol]}</th>`;
    const row = (label, fn, cls = "") => `<tr${cls ? ` class="${cls}"` : ""}><th scope="row">${label}</th>${pols.map((pol) => {
      const r = by[pol], c = pol === sel ? ' class="cur"' : "";
      if (!r || !r.ok) return `<td${c}>—</td>`;
      return `<td${c}>${fn(r.plan, pol)}</td>`;
    }).join("")}</tr>`;
    const T = s.x.demand.length;
    const monthRows = Array.from({ length: T }, (_, i) => row(`Month ${i + 1}`, (p) => q(p.months[i].P))).join("");
    const noPlan = pols.map((pol) => by[pol] && !by[pol].ok ? `<td${pol === sel ? ' class="cur"' : ""}>No feasible plan</td>` : null);
    $("t-answers").innerHTML = `<thead><tr><th scope="col"><span class="ap-hide">Question</span></th>${pols.map(th).join("")}</tr></thead><tbody>
      ${noPlan.some(Boolean) ? `<tr><th scope="row">Status</th>${pols.map((pol, i) => noPlan[i] || `<td${pol === sel ? ' class="cur"' : ""}>Optimal</td>`).join("")}</tr>` : ""}
      ${row("Annual cost", (p) => money(p.total), "key")}
      ${row("Savings vs. level", (p, pol) => { const v = saving(by, pol); return pol === "level" ? "—" : v ? `${money(v.d)}<span class="pct">${f1.format(v.pct)}%</span>` : "—"; })}
      ${row(`Maximum inventory <span class="u">${esc(counted())}</span>`, (p) => `${q(p.peakInv.v)}<span class="pct">${p.peakInv.v > 0 ? "month " + p.peakInv.t : ""}</span>`)}
      ${row("Teams hired · laid off", (p) => `${q(p.hires)} · ${q(p.layoffs)}`)}
      ${row("Teams, fewest–most", (p) => { const w = p.months.map((m) => m.W); return `${q(Math.min(...w))}–${q(Math.max(...w))}`; })}
      <tr class="grp"><th scope="colgroup" colspan="4">Production by month <span class="u">${esc(counted())}</span></th></tr>
      ${monthRows}
      ${row("Total production", (p) => q(p.production), "sum")}
    </tbody>`;
    const notes = pols.filter((pol) => by[pol] && !by[pol].ok).map((pol) => `${NAMES[pol]}: ${by[pol].message}`);
    $("answers-note").textContent = notes.join(" ");
  }

  /* ---------- one plan in detail ---------- */
  function renderDetail() {
    if (!last) return;
    const { s, by } = last, pol = policyNow(), r = by[pol];
    s.policy = pol;
    for (const el of $("t-answers").querySelectorAll(".cur")) el.classList.remove("cur");
    const col = M.POLICIES.indexOf(pol) + 2;
    for (const el of $("t-answers").querySelectorAll(`tr > :nth-child(${col})`)) if (!el.hasAttribute("colspan")) el.classList.add("cur");
    if (!r || !r.ok) {
      $("detail-error").hidden = false; $("detail-error").textContent = r ? r.message : "";
      $("plan-out").hidden = true; if (DEBUG) $("debug").hidden = true;
      return;
    }
    $("detail-error").hidden = true; $("plan-out").hidden = false;
    const p = r.plan, sv = saving(by, pol);
    const cards = [
      ["Annual cost", money(p.total), `${f0.format(p.months.length)} months`],
      ["Savings vs. level", pol === "level" ? "—" : sv ? money(sv.d) : "—", pol === "level" ? "This is the level plan" : sv ? `${f1.format(sv.pct)}% below ${money(sv.base)}` : "No feasible level plan"],
      ["Maximum inventory", q(p.peakInv.v), p.peakInv.v > 0 ? `${counted()}, month ${p.peakInv.t}` : counted()],
      ["Peak workforce", q(p.peakW.v), `teams, month ${p.peakW.t}`],
    ];
    $("cards").innerHTML = cards.map(([k, v, sub]) => `<div class="ap-card"><span class="ap-label">${esc(k)}</span><span class="v">${esc(v)}</span><span class="s">${esc(sub)}</span></div>`).join("");
    renderPlanTable(s, p);
    renderCosts(p);
    drawCharts(s, p);
    if (DEBUG) renderDebug(p);
  }

  function cell(v, fmt = q) { const c = M.clean(v); return `<td${c === 0 ? ' class="z"' : ""}>${fmt(c)}</td>`; }
  const hasSub = (s, p) => p.months.some((m) => m.C > 0) || s.x.subCap > 0;
  // The textbook layout: period 0 holds the starting position, then one row per month.
  function renderPlanTable(s, p) {
    const sub = hasSub(s, p);
    const head = [["", "Period"], ["H", "Hired"], ["L", "Laid off"], ["W", "Teams"], ["O", "Overtime team-h"], ["I", "Inventory"], ["S", "Stockout"], ["P", "Production"], ...(sub ? [["C", "Subcontract"]] : []), ["D", "Demand"]];
    const sum = (k) => p.months.reduce((a, m) => a + m[k], 0);
    const blank = '<td class="z"></td>';
    const p0 = `<tr class="p0"><td>0</td>${blank}${blank}${cell(s.x.W0)}${blank}${cell(s.x.I0)}${cell(s.x.S0)}${blank}${sub ? blank : ""}${blank}</tr>`;
    const rows = p.months.map((m) => `<tr><td>${m.t}</td>${cell(m.H)}${cell(m.L)}${cell(m.W)}${cell(m.O)}${cell(m.I)}${cell(m.S)}${cell(m.P)}${sub ? cell(m.C) : ""}${cell(m.D)}</tr>`).join("");
    $("t-plan").innerHTML = `<thead><tr>${head.map(([sym, name]) => `<th scope="col">${sym ? `<span class="sym">${sym}<sub>t</sub></span>` : ""}${name}</th>`).join("")}</tr></thead><tbody>${p0}${rows}</tbody>
      <tfoot><tr><td>Total</td><td>${q(sum("H"))}</td><td>${q(sum("L"))}</td><td></td><td>${q(sum("O"))}</td><td></td><td></td><td>${q(sum("P"))}</td>${sub ? `<td>${q(sum("C"))}</td>` : ""}<td>${q(sum("D"))}</td></tr></tfoot>`;
  }
  function renderCosts(p) {
    const names = p.costs.map((c) => c[0]);
    // Plain figures: the heading carries the currency, which keeps nine columns inside the page.
    const m2 = scaled;
    const rows = p.months.map((m) => `<tr><td>${m.t}</td>${m.cost.map((v) => cell(v, m2)).join("")}<td>${m2(m.total)}</td></tr>`).join("");
    $("t-costs").innerHTML = `<thead><tr><th scope="col">Month</th>${names.map((n) => `<th scope="col">${n}</th>`).join("")}<th scope="col">Total</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td>Total</td>${p.costs.map(([, v]) => `<td>${m2(v)}</td>`).join("")}<td>${m2(p.total)}</td></tr>
      <tr class="share"><td>Share</td>${p.costs.map(([, v]) => `<td>${p.total ? f1.format((v / p.total) * 100) + "%" : "—"}</td>`).join("")}<td>100%</td></tr></tfoot>`;
    $("cost-note").textContent = `in ${cur || "$"}${mword === "bn" ? " billions" : mword === "M" ? " millions" : ""}`;
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
    if (p.months.some((m) => m.S > 0)) ds.push({ ...line("Stockout", col("S"), s3, [6, 4]), stack: "s" });
    // Demand and production sit side by side (separate stacks); subcontracting stacks on production.
    const o = baseOptions(); o.scales.x.stacked = true; o.scales.y.stacked = true;
    put("units", "c-units", { data: { labels, datasets: ds }, options: o });

    const acc = css("--accent");
    const tds = [bars("Teams", col("W"), acc)];
    if (p.policy === "band" && Number.isFinite(s.x.Wmin) && Number.isFinite(s.x.Wmax)) {
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
    const ds = M.POLICIES.map((pol, i) => by[pol] && by[pol].ok ? line(NAMES[pol], by[pol].plan.months.map((m) => M.clean(m.I)), css(`--ap-s${i + 1}`)) : null).filter(Boolean);
    put("compare", "c-compare", { type: "line", data: { labels, datasets: ds }, options: baseOptions() });
  }
  function redraw() {
    if (!last) return;
    drawCompare(last.by);
    const r = last.by[policyNow()];
    if (r && r.ok) drawCharts(last.s, r.plan);
  }

  /* ---------- downloads ---------- */
  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  function csv() {
    if (!last) return;
    const pol = policyNow(), r = last.by[pol];
    if (!r || !r.ok) return;
    const p = r.plan, sub = hasSub(last.s, p), u = counted();
    const cellv = (v) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [["Period", "Hired (teams)", "Laid off (teams)", "Teams", "Overtime (team-hours)", `Inventory (${u})`, `Stockout (${u})`, `Production (${u})`, ...(sub ? [`Subcontracted (${u})`] : []), `Demand (${u})`]];
    lines.push([0, "", "", last.s.x.W0, "", last.s.x.I0, last.s.x.S0, "", ...(sub ? [""] : []), ""]);
    for (const m of p.months) lines.push([m.t, m.H, m.L, m.W, m.O, m.I, m.S, m.P, ...(sub ? [m.C] : []), m.D].map((v) => M.clean(v)));
    lines.push([], ["Month", ...p.costs.map(([k]) => `${k} (${last.s.cur})`), "Total"]);
    for (const m of p.months) lines.push([m.t, ...m.cost.map((v) => Math.round(v * 100) / 100), Math.round(m.total * 100) / 100]);
    lines.push(["Total", ...p.costs.map(([, v]) => v), p.total], [], ["Policy", NAMES[pol]], ["Whole teams only", last.s.whole ? "yes" : "no"], ["Scenario", location.href]);
    download(new Blob([lines.map((l) => l.map(cellv).join(",")).join("\r\n") + "\r\n"], { type: "text/csv" }), `aggregate-plan-${pol}.csv`);
  }

  /* The workbook: an answers sheet, the inputs, and each plan in the usual Solver layout. The plan
     values are the optimizer's; everything computed from them is a live formula. */
  function workbook() {
    const X = window.APXlsx, { s, by } = last, x = s.x, T = x.demand.length, u = counted();
    const sub = M.POLICIES.some((pol) => by[pol] && by[pol].ok && hasSub(s, by[pol].plan));
    const n = (v) => (Number.isFinite(v) ? v : null);
    const inp = (v) => ({ v: n(v), s: "input" });

    // Inputs sheet. REF[key] is the absolute address of that input.
    const REF = {}, irows = [[{ v: "Aggregate plan inputs", s: "bold" }], [`Quantities (demand, inventory, production, stockouts) are in ${u}. Money is in ${s.cur}. Shaded cells are inputs.`], [],
      [{ v: "Item", s: "head" }, { v: "Value", s: "head" }, { v: "Unit", s: "head" }]];
    const item = (k, label, v, un) => { REF[k] = `Inputs!$B$${irows.length + 1}`; irows.push([label, typeof v === "object" && v ? v : inp(v), un]); };
    item("materialCost", "Material cost", x.materialCost, `${s.cur} per unit`);
    item("holdCost", "Inventory holding cost", x.holdCost, `${s.cur} per unit per month`);
    item("backlogCost", "Stockout cost", x.backlogCost, `${s.cur} per unit per month`);
    item("hireCost", "Hiring and training cost", x.hireCost, `${s.cur} per worker`);
    item("layoffCost", "Layoff cost", x.layoffCost, `${s.cur} per worker`);
    item("wageReg", "Regular time wage", x.wageReg, `${s.cur} per worker-hour`);
    item("wageOT", "Overtime wage", x.wageOT, `${s.cur} per worker-hour`);
    item("maxOT", "Maximum overtime", x.maxOTPerWorker, "hours per worker per month");
    item("teamSize", "Workers per team", x.teamSize, "workers");
    item("rate", "Output per team-hour", x.rate, "units per hour");
    item("days", "Working days per month", x.daysPerMonth, "days");
    item("hours", "Regular hours per day", x.hoursPerDay, "hours");
    item("scale", "Units per counted unit", x.scale, `quantities are in ${u}`);
    item("W0", "Starting teams", x.W0, "teams");
    item("I0", "Starting inventory", x.I0, u);
    item("S0", "Starting stockout", x.S0, u);
    item("endTeams", "Ending teams", x.endTeams, x.endTeams === null ? "any (blank)" : "teams");
    item("endInv", "Ending inventory, at least", x.endInvMin, u);
    item("Wmin", "Band: fewest teams", x.Wmin, "teams");
    item("Wmax", "Band: most teams", x.Wmax, "teams");
    if (sub) { item("subCost", "Subcontract price", x.subCost, `${s.cur} per unit`); item("subCap", "Subcontract cap", x.subCap, `${u} per month`); }
    irows.push([], [{ v: "Worked out from the inputs", s: "bold" }]);
    item("capHour", "Output per team-hour, counted", { f: `${REF.rate}/${REF.scale}`, s: "n2" }, `${u} per team-hour`);
    item("regCap", "Regular-time output per team per month", { f: `${REF.capHour}*${REF.days}*${REF.hours}`, s: "n2" }, `${u} per team`);
    item("regCost", "Regular-time pay per team per month", { f: `${REF.wageReg}*${REF.teamSize}*${REF.days}*${REF.hours}`, s: "n2" }, `${s.cur} per team`);

    const sheetName = (pol) => `${NAMES[pol]} plan`;
    const q_ = (name) => `'${name}'`;
    const info = {}; // where each plan sheet keeps its answers

    function planSheet(pol) {
      const r = by[pol];
      if (!r || !r.ok) return { name: sheetName(pol), widths: [80], rows: [[{ v: `${NAMES[pol]} plan`, s: "bold" }], [r ? r.message : "Not solved."]] };
      const p = r.plan;
      const keys = ["t", "H", "L", "W", "O", "I", "S", "P", ...(sub ? ["C"] : []), "D"];
      const C = Object.fromEntries(keys.map((k, i) => [k, i]));
      const k0 = keys.length + 1; // constraint columns start after one blank column
      const K = { inv: k0, ot: k0 + 1, cap: k0 + 2, wf: k0 + 3 };
      const a = (k, y) => X.ref(C[k], y);
      const rule = pol === "level" ? "Level: teams stay at the starting number (W = starting teams, no hiring or layoffs)."
        : pol === "band" ? "Band: teams stay between the band's fewest and most (Inputs)." : "Chase: hire and lay off freely.";
      const rows = [
        [{ v: `${NAMES[pol]} plan · decision variables (quantities in ${u})`, s: "bold" }],
        [`${rule} Shaded cells are the decision variables. To re-solve in Excel: Solver, minimize the total cost cell below by changing the shaded cells, with the inventory and workforce balances = 0 and the slacks ≥ 0.`],
        [],
      ];
      const sym = ["Period", "Hₜ", "Lₜ", "Wₜ", "Oₜ", "Iₜ", "Sₜ", "Pₜ", ...(sub ? ["Cₜ"] : []), "Dₜ"];
      const head = ["Period", "Teams hired", "Teams laid off", "Teams", "Overtime (team-hours)", "Inventory", "Stockout", "Production", ...(sub ? ["Subcontracted"] : []), "Demand"];
      const hrow1 = sym.map((v) => ({ v, s: "head" })), hrow2 = head.map((v) => ({ v, s: "head" }));
      hrow1[K.inv] = { v: "Constraints", s: "head" };
      Object.assign(hrow2, { [K.inv]: { v: "Inventory balance (= 0)", s: "head" }, [K.ot]: { v: "Overtime slack (≥ 0)", s: "head" }, [K.cap]: { v: "Capacity slack (≥ 0)", s: "head" }, [K.wf]: { v: "Workforce balance (= 0)", s: "head" } });
      rows.push(hrow1, hrow2);
      const y0 = rows.length; // period 0
      const r0 = []; r0[C.t] = 0; r0[C.W] = { f: REF.W0, s: "n2" }; r0[C.I] = { f: REF.I0, s: "n2" }; r0[C.S] = { f: REF.S0, s: "n2" };
      rows.push(r0);
      p.months.forEach((m, i) => {
        const y = y0 + 1 + i, py = y - 1, row = [];
        row[C.t] = m.t;
        for (const k of ["H", "L", "W", "O", "I", "S", "P", ...(sub ? ["C"] : [])]) row[C[k]] = inp(M.clean(m[k]));
        row[C.D] = { v: m.D, s: "n2" };
        row[K.inv] = { f: `${a("I", py)}-${a("S", py)}+${a("P", y)}${sub ? "+" + a("C", y) : ""}-${a("D", y)}-${a("I", y)}+${a("S", y)}`, s: "n2" };
        row[K.ot] = { f: `${a("W", y)}*${REF.maxOT}-${a("O", y)}`, s: "n2" };
        row[K.cap] = { f: `${a("W", y)}*${REF.regCap}+${a("O", y)}*${REF.capHour}-${a("P", y)}`, s: "n2" };
        row[K.wf] = { f: `${a("W", py)}+${a("H", y)}-${a("L", y)}-${a("W", y)}`, s: "n2" };
        rows.push(row);
      });
      const y1 = y0 + 1, yT = y0 + T;
      const tot = []; tot[C.t] = { v: "Total", s: "bold" };
      for (const k of ["H", "L", "O", "P", ...(sub ? ["C"] : []), "D"]) tot[C[k]] = { f: `SUM(${a(k, y1)}:${a(k, yT)})`, s: "n2b" };
      rows.push(tot, []);

      // Costs, one formula per cell, in the textbook's column order.
      const cn = ["Hiring", "Layoffs", "Regular time", "Overtime", "Inventory", "Stockout", "Material", ...(sub ? ["Subcontracting"] : [])];
      rows.push([{ v: `Costs (${s.cur})`, s: "bold" }], [{ v: "Period", s: "head" }, ...cn.map((v) => ({ v, s: "head" })), { v: "Total", s: "head" }]);
      const c0 = rows.length;
      for (let i = 0; i < T; i++) {
        const y = y1 + i;
        const f = [`${a("H", y)}*${REF.hireCost}*${REF.teamSize}`, `${a("L", y)}*${REF.layoffCost}*${REF.teamSize}`, `${a("W", y)}*${REF.regCost}`,
          `${a("O", y)}*${REF.wageOT}*${REF.teamSize}`, `${a("I", y)}*${REF.holdCost}*${REF.scale}`, `${a("S", y)}*${REF.backlogCost}*${REF.scale}`,
          `${a("P", y)}*${REF.materialCost}*${REF.scale}`, ...(sub ? [`${a("C", y)}*${REF.subCost}*${REF.scale}`] : [])];
        const yy = c0 + i;
        rows.push([i + 1, ...f.map((v) => ({ f: v, s: "n2" })), { f: `SUM(${X.ref(1, yy)}:${X.ref(cn.length, yy)})`, s: "n2" }]);
      }
      const cT = rows.length;
      rows.push([{ v: "Total", s: "bold" }, ...cn.map((_, j) => ({ f: `SUM(${X.ref(j + 1, c0)}:${X.ref(j + 1, cT - 1)})`, s: "n2b" })), { f: `SUM(${X.ref(cn.length + 1, c0)}:${X.ref(cn.length + 1, cT - 1)})`, s: "n2b" }]);
      rows.push([]);
      const yCost = rows.length;
      rows.push([{ v: "Total cost", s: "bold" }, { f: `SUM(${X.ref(1, c0)}:${X.ref(cn.length, cT - 1)})`, s: "n2b" }]);
      const yMax = rows.length;
      rows.push([{ v: "Maximum inventory", s: "bold" }, { f: `MAX(${a("I", y1)}:${a("I", yT)})`, s: "n2b" }, u]);
      info[pol] = { cost: `${q_(sheetName(pol))}!$B$${yCost + 1}`, max: `${q_(sheetName(pol))}!$B$${yMax + 1}`,
        H: `${q_(sheetName(pol))}!${a("H", y1)}:${a("H", yT)}`, L: `${q_(sheetName(pol))}!${a("L", y1)}:${a("L", yT)}`,
        P: (i) => `${q_(sheetName(pol))}!${a("P", y1 + i)}` };
      const widths = keys.map((k, i) => (i ? 14 : 8)); widths.push(3, 22, 18, 18, 22);
      return { name: sheetName(pol), widths, rows, freeze: y0 };
    }
    const plans = M.POLICIES.map(planSheet);

    // Answers sheet, first in the book: the case questions, all formulas pointing at the plans.
    const pols = M.POLICIES, okp = (pol) => !!info[pol];
    const arow = (label, fn, st = "n2") => [label, ...pols.map((pol) => (okp(pol) ? fn(pol) : "No feasible plan")).map((v) => (typeof v === "string" && !v.startsWith("=") ? v : { f: v.slice(1), s: st }))];
    const arows = [[{ v: "Answers · three workforce policies", s: "bold" }],
      [`Quantities in ${u}; money in ${s.cur}. ${s.whole ? "Whole teams only." : "Fractional teams allowed."} Every number links to its plan sheet.`], [],
      [{ v: "", s: "head" }, ...pols.map((pol) => ({ v: NAMES[pol], s: "head" }))],
      arow("Annual cost", (pol) => `=${info[pol].cost}`, "n2b"),
      arow("Savings vs. level", (pol) => (pol === "level" || !okp("level") ? "—" : `=${info.level.cost}-${info[pol].cost}`)),
      arow("Savings vs. level (%)", (pol) => (pol === "level" || !okp("level") ? "—" : `=ROUND(100*(${info.level.cost}-${info[pol].cost})/${info.level.cost},2)`)),
      arow("Maximum inventory", (pol) => `=${info[pol].max}`),
      arow("Teams hired", (pol) => `=SUM(${info[pol].H})`),
      arow("Teams laid off", (pol) => `=SUM(${info[pol].L})`),
      [], [{ v: `Production by month (${u})`, s: "bold" }]];
    for (let i = 0; i < T; i++) arows.push(arow(`Month ${i + 1}`, (pol) => `=${info[pol].P(i)}`));
    const answers = { name: "Answers", widths: [30, 18, 18, 18], rows: arows };
    const inputs = { name: "Inputs", widths: [40, 16, 32], rows: irows };
    return X.blob([answers, inputs, ...plans]);
  }
  function xlsx() { if (last && window.APXlsx) download(workbook(), "aggregate-plan.xlsx"); }

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
      schedule(e.target.type === "checkbox" || e.target.tagName === "SELECT" ? 0 : 300);
    });
    form.addEventListener("submit", (e) => { e.preventDefault(); run(); });
    // Picking a policy only changes what is shown; all three are already solved.
    $("detail").addEventListener("change", (e) => {
      if (e.target.name !== "policy") return;
      renderDetail();
      if (last) saveHash(read());
    });
    $("b-same-end").addEventListener("click", () => { $("f-endTeams").value = $("f-W0").value; $("f-endInvMin").value = $("f-I0").value; run(); });
    $("b-reset").addEventListener("click", () => { write(sample()); run(); });
    $("b-paste").addEventListener("click", paste);
    $("b-csv").addEventListener("click", csv);
    $("b-xlsx").addEventListener("click", xlsx);
    $("b-share").addEventListener("click", share);
    window.addEventListener("hashchange", () => { const s = fromHash(location.hash); if (s && toHash(s) !== toHash(read())) { write(s); run(); } });
    // Charts read the theme's colors when drawn, so draw them again when the theme changes.
    new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw);
    if (window.Chart) { Chart.defaults.font.family = css("--sans"); }
    run();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/aggregate-planning/sw.js").catch(() => {});
  }
  init();
})();
