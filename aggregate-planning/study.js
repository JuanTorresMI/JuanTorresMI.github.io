/* Study mode: the selected plan taken apart, step by step, with the page's real numbers.
 * app.js asks the worker for an explanation (solver-worker.js, explain()) and hands it here.
 *
 *   APStudy.render(el, ex, ctx)   ex: the explanation; ctx: { x, cur, counted, money, q, name }
 *
 * Nothing here solves anything: every number shown is either an input, arithmetic on the
 * inputs, or something HiGHS reported for these inputs.
 */
(function (root) {
  "use strict";
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const nf = (d) => new Intl.NumberFormat("en-US", { maximumFractionDigits: d });
  const n4 = nf(4), n2 = nf(2), n0 = nf(0);
  const sub = (v, t) => `${v}<sub>${t}</sub>`;
  const EPS = 1e-6;
  let month = null; // the month shown in step 4, kept while the reader edits inputs

  // What each letter in HiGHS's progress log means.
  const SRC = {
    "": "Search", B: "Branching", C: "Central rounding", F: "Feasibility pump", H: "Heuristic", I: "Shifting",
    J: "Feasibility jump", L: "Sub-MIP", P: "Empty MIP", R: "Randomized rounding", S: "Solve LP", T: "Evaluate node",
    U: "Unbounded", X: "User solution", Y: "HiGHS solution", Z: "ZI round", l: "Trivial lower", p: "Trivial point", u: "Trivial upper", z: "Trivial zero",
  };

  function render(el, ex, ctx) {
    const { x, money, q, cur } = ctx;
    const u = ctx.counted(), p = ex.plan, d = ex.derived, T = p.months.length, k = x.scale || 1;
    const $ = (v) => money(v);
    if (month === null || month > T) month = p.months.reduce((a, m) => (m.D > a.D ? m : a), p.months[0]).t;

    const eq = (rows) => `<dl class="ap-eq">${rows.map(([dt, dd]) => `<dt>${dt}</dt><dd>${dd}</dd>`).join("")}</dl>`;
    const step = (n, title, body) => `<li class="ap-step"><h3><span class="n">${n}</span>${title}</h3>${body}</li>`;
    const steps = [];

    /* 1. inputs -> coefficients */
    const per = k > 1 ? ` per ${esc(u.replace(/s$/, ""))}` : " per unit";
    steps.push(step(1, "From the case to the model’s numbers", `
      <p>The solver never sees wages, shifts or workers. It sees one cost for each decision and one number for each limit. Every one of them comes from the inputs:</p>
      ${eq([
        ["Regular hours", `${n2.format(x.daysPerMonth)} days × ${n2.format(x.hoursPerDay)} h = <b>${n2.format(d.regHours)} h</b> per team per month`],
        ["Output per team", `${n4.format(x.rate)} units/h × ${n2.format(d.regHours)} h${k > 1 ? ` ÷ ${n0.format(k)}` : ""} = <b>${n4.format(d.regCapPerTeam)}</b> ${esc(u)} per team per month`],
        ["Regular pay", `${$(x.wageReg)}/h × ${n2.format(x.teamSize)} workers × ${n2.format(d.regHours)} h = <b>${$(d.regCostPerTeam)}</b> per team per month`],
        ["Overtime pay", `${$(x.wageOT)}/h × ${n2.format(x.teamSize)} workers = <b>${$(d.otCostPerTeamHour)}</b> per team-hour`],
        ["Overtime limit", `<b>${n2.format(d.otMaxPerTeam)}</b> team-hours per team per month (everyone on a team works the same overtime)`],
        ["Hire · lay off", `${$(x.hireCost)} × ${n2.format(x.teamSize)} = <b>${$(d.hirePerTeam)}</b> · ${$(x.layoffCost)} × ${n2.format(x.teamSize)} = <b>${$(d.layoffPerTeam)}</b> per team`],
        ["Hold · stockout · material", `<b>${$(d.hold)}</b> · <b>${$(d.backlog)}</b> · <b>${$(d.material)}</b>${per}${k > 1 ? ` (the per-unit cost × ${n0.format(k)})` : ""}`],
      ])}
      <p class="ap-aside">Regular pay is charged for every team on the payroll, busy or not. That is why keeping idle teams is never free, and why the plan trades teams against inventory.</p>`));

    /* 2. variables */
    const nv = T * (ex.plan.months.some((m) => m.C > 0) ? 8 : 7);
    steps.push(step(2, "The decisions", `
      <p>For each of the ${T} months the solver chooses seven numbers, ${nv} in all. ${ex.wholeTeams ? `The three about teams must be whole numbers, which makes this a <b>mixed-integer program</b>.` : `All of them may be fractional, which makes this a <b>linear program</b>.`}</p>
      <div class="ap-scroll" tabindex="0" role="region" aria-label="Decision variables"><table class="ap-table ap-mini ap-defs">
        <thead><tr><th scope="col">Symbol</th><th scope="col">Meaning</th><th scope="col">Unit</th></tr></thead><tbody>
        ${[["H", "teams hired at the start of the month", "teams"], ["L", "teams laid off", "teams"], ["W", "teams employed", "teams"], ["O", "overtime worked", "team-hours"],
          ["P", "production", u], ["I", "inventory at the end of the month", u], ["S", "stockout: demand not yet filled at month end", u]]
          .map(([s, m, un]) => `<tr><td class="sym">${sub(s, "t")}</td><td>${m}</td><td>${esc(un)}</td></tr>`).join("")}
      </tbody></table></div>`));

    /* 3. objective */
    const coefs = [[d.hirePerTeam, "H", "Hiring"], [d.layoffPerTeam, "L", "Layoffs"], [d.regCostPerTeam, "W", "Regular time"], [d.otCostPerTeamHour, "O", "Overtime"],
      [d.hold, "I", "Holding"], [d.backlog, "S", "Stockout"], [d.material, "P", "Material"]];
    const tot = (v) => p.months.reduce((a, m) => a + m[v], 0);
    steps.push(step(3, "The objective: what “cheapest” means", `
      <p>Every decision has a price. The objective adds them up over the year, and the solver makes it as small as it can:</p>
      <p class="ap-formula">minimize&nbsp; Σ<sub>t</sub> ( ${coefs.map(([c, v]) => `${n2.format(c)} ${sub(v, "t")}`).join(" + ")} )</p>
      <p>For the ${esc(ctx.name)} plan, each price times how much of it the plan uses:</p>
      <div class="ap-scroll" tabindex="0" role="region" aria-label="Objective, term by term"><table class="ap-table ap-mini">
        <thead><tr><th scope="col">Term</th><th scope="col">Price</th><th scope="col">× total used</th><th scope="col">= cost</th></tr></thead><tbody>
        ${coefs.map(([c, v, name]) => `<tr><td>${name} <span class="sym">Σ${sub(v, "t")}</span></td><td>${$(c)}</td><td>${q(tot(v))}</td><td>${$(c * tot(v))}</td></tr>`).join("")}
        </tbody><tfoot><tr><td>Total</td><td></td><td></td><td>${$(p.total)}</td></tr></tfoot></table></div>`));

    /* 4. constraints, one month at a time */
    const m = p.months[month - 1], prev = month > 1 ? p.months[month - 2] : { W: x.W0, I: x.I0, S: x.S0 };
    const check = (lhs, rhs, kind) => {
      const gap = rhs - lhs, tol = EPS * Math.max(1, Math.abs(rhs));
      if (kind === "=") return `<span class="ok">holds</span>`;
      return Math.abs(gap) <= tol ? `<span class="bind">binding</span> — every bit of it is used` : `<span class="slack">slack</span> — ${q(gap)} to spare`;
    };
    const capR = d.regCapPerTeam * m.W + d.capPerTeamHour * m.O, otR = d.otMaxPerTeam * m.W;
    const pol = ex.policy;
    const policyRow = pol === "level" ? [`${sub("W", "t")} = ${n2.format(x.W0)}`, `${q(m.W)} = ${n2.format(x.W0)}`, "no hiring or layoffs, all year"]
      : pol === "band" ? [`${n2.format(x.Wmin)} ≤ ${sub("W", "t")} ≤ ${n2.format(x.Wmax)}`, `${n2.format(x.Wmin)} ≤ ${q(m.W)} ≤ ${n2.format(x.Wmax)}`, "the band"]
      : [`${sub("W", "t")} ≥ 0`, `${q(m.W)} ≥ 0`, "hire and lay off freely"];
    const card = (name, words, sym, nums, status) => `<div class="ap-con"><p class="ap-label">${name}</p><p class="w">${words}</p><p class="ap-formula">${sym}</p><p class="ap-formula nums">${nums}</p><p class="st">${status}</p></div>`;
    const ends = [];
    if (month === T) {
      if (x.noEndBacklog) ends.push(`${sub("S", "T")} = 0 → ${q(m.S)} = 0`);
      if (x.endTeams !== null && x.endTeams !== undefined) ends.push(`${sub("W", "T")} = ${n2.format(x.endTeams)} → ${q(m.W)}`);
      if (x.endInvMin) ends.push(`${sub("I", "T")} ≥ ${n2.format(x.endInvMin)} → ${q(m.I)}`);
    }
    steps.push(step(4, "The constraints, month by month", `
      <p>Four rules tie each month to the last. Pick a month to see each rule with the plan’s numbers plugged in. A limit that is used to the full is <b>binding</b>: it is what stops the plan from being cheaper.</p>
      <label class="ap-field ap-month"><span class="ap-name">Month</span><select id="study-month">${p.months.map((mm) => `<option value="${mm.t}"${mm.t === month ? " selected" : ""}>Month ${mm.t}</option>`).join("")}</select></label>
      <div class="ap-cons">
        ${card("Workforce balance", "Teams this month are last month’s, plus hires, minus layoffs.", `${sub("W", "t")} = ${sub("W", "t−1")} + ${sub("H", "t")} − ${sub("L", "t")}`,
          `${q(m.W)} = ${q(prev.W)} + ${q(m.H)} − ${q(m.L)}`, check(0, 0, "="))}
        ${card("Inventory balance", "Stock carried in, minus orders already late, plus production, covers demand; what is left is stock, what is short is stockout.",
          `${sub("I", "t−1")} − ${sub("S", "t−1")} + ${sub("P", "t")} = ${sub("D", "t")} + ${sub("I", "t")} − ${sub("S", "t")}`,
          `${q(prev.I)} − ${q(prev.S)} + ${q(m.P)} = ${q(m.D)} + ${q(m.I)} − ${q(m.S)} &nbsp;→&nbsp; ${q(prev.I - prev.S + m.P)} = ${q(m.D + m.I - m.S)}`, check(0, 0, "="))}
        ${card("Capacity", "Production can’t exceed what the teams make in regular time plus overtime.", `${sub("P", "t")} ≤ ${n4.format(d.regCapPerTeam)} ${sub("W", "t")} + ${n4.format(d.capPerTeamHour)} ${sub("O", "t")}`,
          `${q(m.P)} ≤ ${n4.format(d.regCapPerTeam)} × ${q(m.W)} + ${n4.format(d.capPerTeamHour)} × ${q(m.O)} = ${q(capR)}`, check(m.P, capR, "≤"))}
        ${card("Overtime limit", "Overtime can’t exceed the limit for every team employed.", `${sub("O", "t")} ≤ ${n2.format(d.otMaxPerTeam)} ${sub("W", "t")}`,
          `${q(m.O)} ≤ ${n2.format(d.otMaxPerTeam)} × ${q(m.W)} = ${q(otR)}`, check(m.O, otR, "≤"))}
        ${card(`Policy: ${esc(ctx.name)}`, policyRow[2][0].toUpperCase() + policyRow[2].slice(1) + ".", policyRow[0], policyRow[1], `<span class="ok">holds</span>`)}
        ${ends.length ? card("End of the year", "Conditions on the last month only.", ends.map((e) => e.split(" → ")[0]).join(" · "), ends.map((e) => e.split(" → ")[1]).join(" · "), `<span class="ok">holds</span>`) : ""}
      </div>`));

    /* 5. how HiGHS found it */
    const L = ex.log, R = ex.relaxed, B = ex.branch;
    const sizeLine = L.size ? `The model has <b>${n0.format(L.size.rows)}</b> constraints and <b>${n0.format(L.size.cols)}</b> variables${L.size.ints ? `, ${n0.format(L.size.ints)} of them whole numbers` : ""}.` : "";
    const pre = L.presolve ? ` Before solving, HiGHS’s <b>presolve</b> simplified it to ${n0.format(L.presolve.rows)} constraints and ${n0.format(L.presolve.cols)} variables, by fixing variables that can only take one value and dropping limits that can never bind${pol === "level" ? ". Under a level plan every W is fixed, so a lot goes" : ""}.` : "";
    const wRow = R ? `<div class="ap-scroll" tabindex="0" role="region" aria-label="Teams, fractional and whole"><table class="ap-table ap-mini ap-wide">
        <thead><tr><th scope="col">Month</th>${p.months.map((mm) => `<th scope="col">${mm.t}</th>`).join("")}</tr></thead><tbody>
        <tr><td>${ex.wholeTeams ? "Teams, relaxed" : "Teams"}</td>${R.W.map((w) => `<td${Math.abs(w - Math.round(w)) > EPS ? ' class="frac"' : ""}>${n2.format(w)}</td>`).join("")}</tr>
        ${ex.wholeTeams ? `<tr><td>Teams, final</td>${p.months.map((mm) => `<td>${q(mm.W)}</td>`).join("")}</tr>` : ""}</tbody></table></div>` : "";
    let relaxText = "";
    if (R && !ex.wholeTeams) relaxText = `<p>With fractional teams allowed, the model is a linear program, and HiGHS solves it with the <b>simplex method</b>. Every possible plan is a point inside a many-sided shape, and the cheapest one is always at a corner. Simplex starts at one corner and keeps stepping to a cheaper neighbor; when no neighbor is cheaper, that corner is the answer. It took <b>${n0.format(R.iters || 0)}</b> steps here, and the answer is the plan: <b>${$(R.cost)}</b>.</p>${wRow}`;
    else if (R) relaxText = `<p><b>First, the relaxation.</b> HiGHS drops the whole-teams rule and solves the easier linear program with the simplex method (${n0.format(R.iters || 0)} corner-to-corner steps). That plan costs <b>${$(R.cost)}</b>. It is a floor: the whole-team plan has fewer options, so it can’t cost less. ${R.fractional.length ? `But ${n0.format(R.fractional.length)} of its team numbers are fractions, which can’t be hired:` : `Here every team number came out whole, so the relaxation <em>is</em> the answer and there is nothing left to search.`}</p>${wRow}`;
    let branchText = "";
    if (B) {
      const side = (s) => s.feasible ? `<span>floor <b>${$(s.cost)}</b></span><span>${s.fractionalLeft ? `${n0.format(s.fractionalLeft)} fractions left` : `<b>all whole</b>: a real plan`}</span>` : "<span>no possible plan</span>";
      const lab = (t) => t.replace(/^([A-Z])_(\d+)/, (_, v, i) => sub(v, i));
      branchText = `<p><b>Then, branch and bound.</b> The relaxation wants ${sub(B.name[0], B.name.slice(2))} = ${n2.format(B.value)}. Every whole-team plan has either ${lab(esc(B.down.label))} or ${lab(esc(B.up.label))}, so the search splits into those two smaller problems and solves each relaxation:</p>
        <div class="ap-tree"><div class="root"><span class="ap-label">Relaxation</span><b>${$(R.cost)}</b><span>${sub(B.name[0], B.name.slice(2))} = ${n2.format(B.value)}</span></div>
          <div class="kids"><div><span class="lab">${lab(esc(B.down.label))}</span>${side(B.down)}</div><div><span class="lab">${lab(esc(B.up.label))}</span>${side(B.up)}</div></div></div>
        <p>Each split can only raise the floor. A branch whose floor is already above the best whole-team plan found so far is thrown away unexplored: that is the “bound”. HiGHS repeats this, and adds shortcuts of its own (cutting planes that trim fractional corners, and heuristics that look for good whole plans early).</p>`;
    }
    const prog = L.progress || [];
    const searchText = ex.wholeTeams && prog.length ? `<p><b>The search, in HiGHS’s own log.</b> The <em>floor</em> is the best cost still possible; the <em>best plan</em> is the cheapest whole-team plan found so far. The gap between them is what is left to prove.</p>
      <div class="ap-scroll" tabindex="0" role="region" aria-label="Search progress"><table class="ap-table ap-mini">
        <thead><tr><th scope="col">Step</th><th scope="col">Nodes</th><th scope="col">Floor</th><th scope="col">Best plan</th><th scope="col">Gap</th><th scope="col">Time</th></tr></thead><tbody>
        ${prog.map((r) => `<tr><td>${esc(SRC[r.src] || r.src)}</td><td>${n0.format(r.nodes)}</td><td>${r.bound === null ? "—" : $(r.bound)}</td><td>${r.best === null ? "—" : $(r.best)}</td><td>${esc(r.gap === "Large" ? "large" : r.gap)}</td><td>${n2.format(r.time)} s</td></tr>`).join("")}
        </tbody></table></div>
      <p>It explored <b>${n0.format(L.nodes || 1)}</b> node${L.nodes === 1 ? "" : "s"} with ${n0.format(L.lpIters || 0)} simplex steps in all. The floor and the best plan met at <b>${$(p.total)}</b>, a gap of 0%: that is the proof no cheaper plan exists, not just a good guess.</p>` : "";
    steps.push(step(5, "How the solver found it", `<p>${sizeLine}${pre}</p>${relaxText}${branchText}${searchText}
      <details class="ap-paste"><summary>The solver’s full log</summary><pre class="ap-lp">${esc(L.lines.join("\n"))}</pre></details>
      <details class="ap-paste"><summary>The model exactly as HiGHS read it</summary><pre class="ap-lp">${esc(ex.lp)}</pre></details>`));

    /* 6. shadow prices */
    const P = ex.prices;
    if (P) {
      const top = Math.max(...P.map((r) => r.demand), d.material);
      const holdRun = P.slice(1).filter((r, i) => Math.abs(r.demand - P[i].demand - d.hold) < 1e-6).length;
      const otUnit = d.material + d.otCostPerTeamHour / Math.max(d.capPerTeamHour, EPS);
      steps.push(step(6, "Why this plan: what each month’s demand really costs", `
        <p>Hold the teams where the plan puts them and ask what one more ${esc(u.replace(/s$/, ""))} of demand in a given month would add to the cheapest cost. That is the month’s <b>shadow price</b>, and it shows how the plan is filling demand at the margin.</p>
        <div class="ap-bars" role="img" aria-label="Shadow price of demand by month; the table below has the numbers.">
          ${P.map((r) => `<div class="bar"><span class="fill" style="height:${Math.max(2, (r.demand / top) * 100)}%"><span class="mat" style="height:${Math.min(100, (d.material / Math.max(r.demand, EPS)) * 100)}%"></span></span><span class="t">${r.t}</span></div>`).join("")}
        </div>
        <p class="ap-legend"><span class="k mat"></span>material, ${$(d.material)} <span class="k rest"></span>everything else it takes to fill one more</p>
        <div class="ap-scroll" tabindex="0" role="region" aria-label="Shadow prices"><table class="ap-table ap-mini ap-wide">
          <thead><tr><th scope="col">Month</th>${P.map((r) => `<th scope="col">${r.t}</th>`).join("")}</tr></thead><tbody>
          <tr><td>One more unit of demand</td>${P.map((r) => `<td>${$(r.demand)}</td>`).join("")}</tr>
          <tr><td>One more unit of capacity saves</td>${P.map((r) => `<td${Math.abs(r.capacity) < EPS ? ' class="z"' : ""}>${$(r.capacity)}</td>`).join("")}</tr></tbody></table></div>
        <p>How to read it: a price of just ${$(d.material)} means the month has idle capacity, so an extra unit costs only its material. ${holdRun ? `Where the price climbs by exactly ${$(d.hold)} a month, the extra unit is being built a month earlier and carried in stock, so each month adds one more month of holding.` : ""} Making a unit on overtime costs ${$(d.material)} + ${$(d.otCostPerTeamHour)} ÷ ${n4.format(d.capPerTeamHour)} = ${$(otUnit)}, so no month’s price goes above that while overtime is still free to use. Where capacity has a price, one more unit of it would save that much: those are the months where the teams are the bottleneck.</p>`));
    }

    el.innerHTML = `<ol class="ap-steps">${steps.join("")}</ol>`;
    const sel = el.querySelector("#study-month");
    if (sel) sel.addEventListener("change", () => { month = Number(sel.value); render(el, ex, ctx); el.querySelector("#study-month").focus(); });
  }

  root.APStudy = { render };
})(window);
