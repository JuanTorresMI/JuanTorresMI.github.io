/* Aggregate planning: the optimization model. No DOM here, so it runs the same in the page
 * and in Node (see the bottom of the file).
 *
 *   buildModel(inputs, policy, wholeTeams) -> { lp, T, derived } or { error }
 *   readPlan(inputs, built, result)        -> the monthly plan, the cost breakdown and the slacks
 *
 * Variables per month t (all >= 0): H hired teams, L laid-off teams, W teams employed,
 * O overtime team-hours, I ending inventory, S ending stockout (orders filled late), P production, C subcontracted
 * units (only when a subcontract cap is set). The model is written as CPLEX LP text, which
 * HiGHS reads directly.
 */
(function (root) {
  "use strict";

  const POLICIES = ["level", "band", "chase"];
  const POLICY_NAMES = { level: "Level", band: "Band", chase: "Chase" };

  // The neutral sample: a seasonal product that peaks in the fourth quarter.
  const SAMPLE = {
    demand: [1600, 1900, 2100, 2200, 2300, 2500, 2700, 2900, 3200, 3700, 4100, 4000],
    W0: 12, endTeams: 12, I0: 300, endInvMin: 300, S0: 0, noEndBacklog: true,
    teamSize: 5, rate: 1.5, daysPerMonth: 21, hoursPerDay: 8, maxOTPerWorker: 12,
    wageReg: 25, wageOT: 37.5, hireCost: 500, layoffCost: 800,
    holdCost: 12, backlogCost: 30, maxBacklog: null, materialCost: 60,
    subCost: 90, subCap: 0,
    Wmin: 10, Wmax: 14,
    scale: 1,
  };

  const EPS = 1e-6;

  /* Demand, stock and production can be counted in thousands (scale 1000) or millions, the way
     textbook cases state them. Rates and per-unit costs stay per single unit, as a case gives them;
     here they are turned into "per counted unit" so the model itself never sees the scale. */
  function derive(x) {
    const regHours = x.daysPerMonth * x.hoursPerDay;
    const k = x.scale || 1;
    return {
      regHours, scale: k,
      capPerTeamHour: x.rate / k,
      regCapPerTeam: (x.rate / k) * regHours,
      hold: x.holdCost * k, backlog: x.backlogCost * k, material: x.materialCost * k, sub: (x.subCost || 0) * k,
      regCostPerTeam: x.wageReg * x.teamSize * regHours,
      otCostPerTeamHour: x.wageOT * x.teamSize,
      otMaxPerTeam: x.maxOTPerWorker,
      hirePerTeam: x.hireCost * x.teamSize,
      layoffPerTeam: x.layoffCost * x.teamSize,
    };
  }

  const isNum = (v) => typeof v === "number" && isFinite(v);
  const has = (v) => v !== null && v !== undefined && v !== "" && isNum(v);

  // Numbers for LP text: plain decimal, no "1e+21" surprises for the values this tool sees.
  function num(v) {
    if (Object.is(v, -0) || Math.abs(v) < 1e-12) return "0";
    const s = String(v);
    return s.includes("e") ? v.toPrecision(17).replace(/\.?0+e/, "e") : s;
  }
  // One linear expression from [[coef, name], ...], dropping zero terms.
  function expr(terms) {
    const out = [];
    for (const [c, name] of terms) {
      if (!c) continue;
      const sign = c < 0 ? "-" : "+";
      const mag = Math.abs(c);
      out.push(`${out.length || sign === "-" ? sign + " " : ""}${mag === 1 ? "" : num(mag) + " "}${name}`);
    }
    return out.length ? out.join(" ") : "0 W_1";
  }

  /* Checks the inputs and says what is wrong in words, before the solver gets involved.
     Returns null when everything is usable. */
  function validate(x, policy, wholeTeams) {
    const T = x.demand.length;
    if (T < 1 || T > 24) return "The plan needs between 1 and 24 months of demand.";
    for (let t = 0; t < T; t++) if (!isNum(x.demand[t]) || x.demand[t] < 0) return `Demand for month ${t + 1} needs to be a number, zero or more.`;
    const need = { W0: "Starting teams", I0: "Starting inventory", S0: "Starting backlog", teamSize: "Workers per team", rate: "Units per team-hour",
      daysPerMonth: "Days per month", hoursPerDay: "Hours per day", maxOTPerWorker: "Overtime limit", wageReg: "Regular wage", wageOT: "Overtime wage",
      hireCost: "Hiring cost", layoffCost: "Layoff cost", holdCost: "Holding cost", backlogCost: "Stockout cost", materialCost: "Material cost" };
    for (const k in need) if (!isNum(x[k]) || x[k] < 0) return `${need[k]} needs to be a number, zero or more.`;
    if (x.teamSize <= 0) return "A team needs at least one worker.";
    if (!isNum(x.scale || 1) || (x.scale || 1) <= 0) return "Pick how demand is counted: in units, thousands or millions.";
    if (has(x.endTeams) && x.endTeams < 0) return "Ending teams can't be negative.";
    if (has(x.endInvMin) && x.endInvMin < 0) return "Minimum ending inventory can't be negative.";
    if (has(x.maxBacklog) && x.maxBacklog < 0) return "The stockout cap can't be negative.";
    if (has(x.subCap) && x.subCap > 0 && (!isNum(x.subCost) || x.subCost < 0)) return "Subcontract cost needs to be a number, zero or more.";
    if (wholeTeams) {
      if (!Number.isInteger(x.W0)) return "With whole teams only, starting teams must be a whole number.";
      if (has(x.endTeams) && !Number.isInteger(x.endTeams)) return "With whole teams only, ending teams must be a whole number.";
    }
    if (policy === "level" && has(x.endTeams) && x.endTeams !== x.W0)
      return `A level plan keeps all ${fmtN(x.W0)} starting teams, but the plan must end with ${fmtN(x.endTeams)}. Clear “Ending teams” or pick Band or Chase.`;
    if (policy === "band") {
      if (!isNum(x.Wmin) || !isNum(x.Wmax) || x.Wmin < 0) return "The band needs a minimum and a maximum number of teams.";
      if (x.Wmin > x.Wmax) return "The band's minimum is above its maximum.";
      if (wholeTeams && Math.ceil(x.Wmin - EPS) > Math.floor(x.Wmax + EPS)) return "There is no whole number of teams inside that band.";
      if (has(x.endTeams) && (x.endTeams < x.Wmin || x.endTeams > x.Wmax))
        return `The plan must end with ${fmtN(x.endTeams)} teams, which is outside the ${fmtN(x.Wmin)}–${fmtN(x.Wmax)} band.`;
    }
    return null;
  }
  function fmtN(v) { return Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 }); }

  function buildModel(x, policy, wholeTeams) {
    const err = validate(x, policy, wholeTeams);
    if (err) return { error: err };
    const T = x.demand.length, d = derive(x);
    const useSub = has(x.subCap) && x.subCap > 0;
    const v = (n, t) => `${n}_${t}`;

    const obj = [];
    for (let t = 1; t <= T; t++) {
      obj.push([d.hirePerTeam, v("H", t)], [d.layoffPerTeam, v("L", t)], [d.regCostPerTeam, v("W", t)],
        [d.otCostPerTeamHour, v("O", t)], [d.hold, v("I", t)], [d.backlog, v("S", t)], [d.material, v("P", t)]);
      if (useSub) obj.push([d.sub, v("C", t)]);
    }

    const rows = [];
    for (let t = 1; t <= T; t++) {
      // W[t] - W[t-1] - H[t] + L[t] = 0
      const wf = [[1, v("W", t)], [-1, v("H", t)], [1, v("L", t)]];
      let wfRhs = 0;
      if (t === 1) wfRhs = x.W0; else wf.push([-1, v("W", t - 1)]);
      rows.push(`wf_${t}: ${expr(wf)} = ${num(wfRhs)}`);
      // I[t-1] - S[t-1] + P[t] + C[t] = D[t] + I[t] - S[t]
      const inv = [[1, v("P", t)], [-1, v("I", t)], [1, v("S", t)]];
      if (useSub) inv.push([1, v("C", t)]);
      let invRhs = x.demand[t - 1];
      if (t === 1) invRhs += -x.I0 + x.S0; else inv.push([1, v("I", t - 1)], [-1, v("S", t - 1)]);
      rows.push(`inv_${t}: ${expr(inv)} = ${num(invRhs)}`);
      // O[t] <= otMax * W[t]
      rows.push(`ot_${t}: ${expr([[1, v("O", t)], [-d.otMaxPerTeam, v("W", t)]])} <= 0`);
      // P[t] <= regCap * W[t] + rate * O[t]
      rows.push(`cap_${t}: ${expr([[1, v("P", t)], [-d.regCapPerTeam, v("W", t)], [-d.capPerTeamHour, v("O", t)]])} <= 0`);
    }

    const bounds = [];
    for (let t = 1; t <= T; t++) {
      let wLo = 0, wHi = Infinity;
      if (policy === "level") { wLo = wHi = x.W0; bounds.push(`${v("H", t)} = 0`, `${v("L", t)} = 0`); }
      if (policy === "band") { wLo = x.Wmin; wHi = x.Wmax; }
      if (t === T && has(x.endTeams)) { wLo = Math.max(wLo, x.endTeams); wHi = Math.min(wHi, x.endTeams); }
      bounds.push(wHi === Infinity ? `${v("W", t)} >= ${num(wLo)}` : wLo === wHi ? `${v("W", t)} = ${num(wLo)}` : `${num(wLo)} <= ${v("W", t)} <= ${num(wHi)}`);
      let sHi = has(x.maxBacklog) ? x.maxBacklog : Infinity;
      if (t === T && x.noEndBacklog) sHi = 0;
      if (sHi !== Infinity) bounds.push(`0 <= ${v("S", t)} <= ${num(sHi)}`);
      if (t === T && has(x.endInvMin) && x.endInvMin > 0) bounds.push(`${v("I", t)} >= ${num(x.endInvMin)}`);
      if (useSub) bounds.push(`0 <= ${v("C", t)} <= ${num(x.subCap)}`);
    }

    const ints = [];
    if (wholeTeams) for (let t = 1; t <= T; t++) ints.push(v("H", t), v("L", t), v("W", t));

    // The LP reader limits line length, so the objective goes out a month per line.
    const objLines = [];
    for (let i = 0; i < obj.length; i += 8) {
      const line = expr(obj.slice(i, i + 8));
      objLines.push(i && !line.startsWith("-") ? "+ " + line : line);
    }
    const lp = ["Minimize", " cost: " + objLines.join("\n "), "Subject To", ...rows.map((r) => " " + r),
      "Bounds", ...bounds.map((b) => " " + b), ...(ints.length ? ["General", " " + ints.join(" ")] : []), "End"].join("\n");
    return { lp, T, derived: d, useSub, policy, wholeTeams };
  }

  // Solver values carry float noise; snap anything within a hair of a whole number.
  function clean(v) {
    if (!isNum(v) || Math.abs(v) < EPS) return 0;
    const r = Math.round(v);
    return Math.abs(v - r) <= EPS * Math.max(1, Math.abs(v)) ? r : v;
  }
  // Money to cents, so the total can be the exact sum of the rows people see.
  const cents = (v) => Math.round(v * 100) / 100;

  function readPlan(x, built, result) {
    const T = built.T, d = built.derived;
    const col = (n, t) => { const c = result.Columns[`${n}_${t}`]; return clean(c ? c.Primal : 0); };
    const months = [];
    for (let t = 1; t <= T; t++) {
      const m = { t, H: col("H", t), L: col("L", t), W: col("W", t), O: col("O", t), P: col("P", t),
        C: built.useSub ? col("C", t) : 0, D: x.demand[t - 1], I: col("I", t), S: col("S", t) };
      // The month's costs, in the order a textbook cost table lists them.
      m.cost = [d.hirePerTeam * m.H, d.layoffPerTeam * m.L, d.regCostPerTeam * m.W, d.otCostPerTeamHour * m.O,
        d.hold * m.I, d.backlog * m.S, d.material * m.P, ...(built.useSub ? [d.sub * m.C] : [])];
      m.total = m.cost.reduce((a, c) => a + c, 0);
      months.push(m);
    }
    const sum = (k) => months.reduce((a, m) => a + m[k], 0);
    const names = ["Hiring", "Layoffs", "Regular time", "Overtime", "Holding", "Stockout", "Material", ...(built.useSub ? ["Subcontracting"] : [])];
    const costs = names.map((n, i) => [n, cents(months.reduce((a, m) => a + m.cost[i], 0))]);
    const total = cents(costs.reduce((a, c) => a + c[1], 0));

    // Every constraint's slack, for ?debug=1. Equalities should read 0; inequalities >= 0.
    const slacks = months.map((m, i) => {
      const prev = i ? months[i - 1] : { W: x.W0, I: x.I0, S: x.S0 };
      return {
        t: m.t,
        workforce: m.W - (prev.W + m.H - m.L),
        balance: (prev.I - prev.S + m.P + m.C) - (m.D + m.I - m.S),
        overtime: d.otMaxPerTeam * m.W - m.O,
        capacity: d.regCapPerTeam * m.W + d.capPerTeamHour * m.O - m.P,
      };
    });

    let peakInv = { v: -1, t: 0 }, peakW = { v: -1, t: 0 };
    for (const m of months) {
      if (m.I > peakInv.v) peakInv = { v: m.I, t: m.t };
      if (m.W > peakW.v) peakW = { v: m.W, t: m.t };
    }
    return { months, costs, total, objective: result.ObjectiveValue, slacks, peakInv, peakW,
      hires: sum("H"), layoffs: sum("L"), production: sum("P"), policy: built.policy };
  }

  const api = { POLICIES, POLICY_NAMES, SAMPLE, derive, validate, buildModel, readPlan, clean };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.APModel = api;
})(typeof self !== "undefined" ? self : this);
