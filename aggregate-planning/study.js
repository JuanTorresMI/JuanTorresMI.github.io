/* Study mode: the selected plan taken apart, step by step, with the page's real numbers.
 * app.js asks the worker for an explanation (solver-worker.js, explain()) and hands it here.
 *
 *   APStudy.render(el, ex, ctx)   ex: the explanation; ctx: { x, cur, counted, money, q, name }
 *
 * Nothing here solves anything: every number shown is either an input, arithmetic on the
 * inputs, or something HiGHS reported for these inputs. The writing is for a student who knows
 * what aggregate planning is but not what goes on inside a solver: plain words first, the
 * technical term after, in parentheses.
 */
(function (root) {
  "use strict";
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const nf = (d) => new Intl.NumberFormat("en-US", { maximumFractionDigits: d });
  const n4 = nf(4), n2 = nf(2), n0 = nf(0);
  const sub = (v, t) => `${v}<sub>${t}</sub>`;
  const EPS = 1e-6;
  let month = null; // the month shown in step 4, kept while the reader edits inputs

  // What each letter in HiGHS's progress log means, in plain words.
  const SRC = {
    "": "Search update", B: "Split a branch", C: "Rounded toward the middle", F: "Feasibility pump", H: "Quick guess", I: "Shifted a guess",
    J: "Quick first guess", L: "Solved a smaller version", P: "Empty problem", R: "Rounded the fractions", S: "Solved a relaxation", T: "Checked a branch",
    U: "Unbounded", X: "Given plan", Y: "Earlier plan", Z: "Rounded the fractions", l: "Simple guess", p: "Simple guess", u: "Simple guess", z: "Tried all zeros",
  };

  function render(el, ex, ctx) {
    const { x, money, q } = ctx;
    const u = ctx.counted(), p = ex.plan, d = ex.derived, T = p.months.length, k = x.scale || 1;
    const one = u.replace(/s$/, "");
    const $ = (v) => money(v);
    if (month === null || month > T) month = p.months.reduce((a, m) => (m.D > a.D ? m : a), p.months[0]).t;

    const eq = (rows) => `<dl class="ap-eq">${rows.map(([dt, dd]) => `<dt>${dt}</dt><dd>${dd}</dd>`).join("")}</dl>`;
    const step = (n, title, body) => `<li class="ap-step"><h3><span class="n">${n}</span>${title}</h3>${body}</li>`;
    const steps = [];

    /* 1. inputs -> coefficients */
    const per = k > 1 ? ` per ${esc(one)} (the per-unit cost × ${n0.format(k)})` : " per unit";
    steps.push(step(1, "Turning the case into numbers", `
      <p>The solver doesn’t know what a worker or a shift is. All it sees is a cost for each decision and a limit for each rule. Here’s how your inputs become those numbers:</p>
      ${eq([
        ["Hours per team", `${n2.format(x.daysPerMonth)} days × ${n2.format(x.hoursPerDay)} h = <b>${n2.format(d.regHours)} hours</b> per team each month`],
        ["Output per team", `${n4.format(x.rate)} units an hour × ${n2.format(d.regHours)} h${k > 1 ? ` ÷ ${n0.format(k)}` : ""} = <b>${n4.format(d.regCapPerTeam)}</b> ${esc(u)} per team each month`],
        ["Regular pay", `${$(x.wageReg)} an hour × ${n2.format(x.teamSize)} workers × ${n2.format(d.regHours)} h = <b>${$(d.regCostPerTeam)}</b> per team each month`],
        ["Overtime pay", `${$(x.wageOT)} an hour × ${n2.format(x.teamSize)} workers = <b>${$(d.otCostPerTeamHour)}</b> for each hour a team works overtime`],
        ["Overtime cap", `<b>${n2.format(d.otMaxPerTeam)} hours</b> per team each month (the whole team works overtime together)`],
        ["Hiring and layoffs", `hiring a team costs ${$(x.hireCost)} × ${n2.format(x.teamSize)} = <b>${$(d.hirePerTeam)}</b>; laying one off costs ${$(x.layoffCost)} × ${n2.format(x.teamSize)} = <b>${$(d.layoffPerTeam)}</b>`],
        ["Holding, stockout, material", `<b>${$(d.hold)}</b> to store for a month, <b>${$(d.backlog)}</b> for each month an order is late, <b>${$(d.material)}</b> in material,${per}`],
      ])}
      <p class="ap-aside">One thing to notice: every team on the payroll gets paid for the full month, busy or not. An idle team isn’t free. That’s the core tradeoff in aggregate planning: pay for extra people, or pay to store extra stock.</p>`));

    /* 2. variables */
    const nv = T * (ex.plan.months.some((m) => m.C > 0) ? 8 : 7);
    steps.push(step(2, "What the solver gets to decide", `
      <p>Each month, the solver picks seven numbers, so ${n0.format(nv)} in all for a ${T}-month plan. ${ex.wholeTeams
        ? `Team counts have to be whole numbers, since you can’t hire half a team. That makes this a <b>mixed-integer program</b> (MIP).`
        : `Here team counts are allowed to be fractions, which makes this a <b>linear program</b> (LP).`}</p>
      <div class="ap-scroll" tabindex="0" role="region" aria-label="Decision variables"><table class="ap-table ap-mini ap-defs">
        <thead><tr><th scope="col">Symbol</th><th scope="col">What it is</th><th scope="col">Measured in</th></tr></thead><tbody>
        ${[["H", "Teams hired this month", "teams"], ["L", "Teams laid off this month", "teams"], ["W", "Teams on the payroll", "teams"], ["O", "Overtime worked", "team-hours"],
          ["P", "Units made", u], ["I", "Units left in stock at the end of the month", u], ["S", "Orders still unfilled at the end of the month (stockout)", u]]
          .map(([s, m, un]) => `<tr><td class="sym">${sub(s, "t")}</td><td>${m}</td><td>${esc(un)}</td></tr>`).join("")}
      </tbody></table></div>`));

    /* 3. objective */
    const coefs = [[d.hirePerTeam, "H", "Hiring"], [d.layoffPerTeam, "L", "Layoffs"], [d.regCostPerTeam, "W", "Regular pay"], [d.otCostPerTeamHour, "O", "Overtime"],
      [d.hold, "I", "Holding"], [d.backlog, "S", "Stockouts"], [d.material, "P", "Material"]];
    const tot = (v) => p.months.reduce((a, m) => a + m[v], 0);
    steps.push(step(3, "What “cheapest” means", `
      <p>Every decision has a price. The solver’s goal, called the <b>objective</b>, is the total of all those prices over the year, and it looks for the plan that makes that total as small as possible:</p>
      <p class="ap-formula">minimize&nbsp; Σ<sub>t</sub> ( ${coefs.map(([c, v]) => `${n2.format(c)} ${sub(v, "t")}`).join(" + ")} )</p>
      <p>Here’s that total for the ${esc(ctx.name.toLowerCase())} plan, piece by piece:</p>
      <div class="ap-scroll" tabindex="0" role="region" aria-label="Objective, term by term"><table class="ap-table ap-mini">
        <thead><tr><th scope="col">Cost</th><th scope="col">Price</th><th scope="col">Amount used</th><th scope="col">Total</th></tr></thead><tbody>
        ${coefs.map(([c, v, name]) => `<tr><td>${name} <span class="sym">Σ${sub(v, "t")}</span></td><td>${$(c)}</td><td>${q(tot(v))}</td><td>${$(c * tot(v))}</td></tr>`).join("")}
        </tbody><tfoot><tr><td>Total</td><td></td><td></td><td>${$(p.total)}</td></tr></tfoot></table></div>`));

    /* 4. constraints, one month at a time */
    const m = p.months[month - 1], prev = month > 1 ? p.months[month - 2] : { W: x.W0, I: x.I0, S: x.S0 };
    const ok = `<span class="ok">checks out</span>`;
    const check = (lhs, rhs) => {
      const gap = rhs - lhs, tol = EPS * Math.max(1, Math.abs(rhs));
      return Math.abs(gap) <= tol ? `<span class="bind">binding</span> fully used` : `<span class="slack">slack</span> ${q(gap)} left over`;
    };
    const capR = d.regCapPerTeam * m.W + d.capPerTeamHour * m.O, otR = d.otMaxPerTeam * m.W;
    const pol = ex.policy;
    const policyRow = pol === "level" ? [`${sub("W", "t")} = ${n2.format(x.W0)}`, `${q(m.W)} = ${n2.format(x.W0)}`, "The team count never changes."]
      : pol === "band" ? [`${n2.format(x.Wmin)} ≤ ${sub("W", "t")} ≤ ${n2.format(x.Wmax)}`, `${n2.format(x.Wmin)} ≤ ${q(m.W)} ≤ ${n2.format(x.Wmax)}`, "The team count stays inside the band."]
      : [`${sub("W", "t")} ≥ 0`, `${q(m.W)} ≥ 0`, "Hire and lay off as needed."];
    const card = (name, words, sym, nums, status) => `<div class="ap-con"><p class="ap-label">${name}</p><p class="w">${words}</p><p class="ap-formula">${sym}</p><p class="ap-formula nums">${nums}</p><p class="st">${status}</p></div>`;
    const ends = [];
    if (month === T) {
      if (x.noEndBacklog) ends.push(`${sub("S", "T")} = 0 → ${q(m.S)} = 0`);
      if (x.endTeams !== null && x.endTeams !== undefined) ends.push(`${sub("W", "T")} = ${n2.format(x.endTeams)} → ${q(m.W)}`);
      if (x.endInvMin) ends.push(`${sub("I", "T")} ≥ ${n2.format(x.endInvMin)} → ${q(m.I)}`);
    }
    steps.push(step(4, "The rules each month has to follow", `
      <p>Every month follows the same four rules, and each one links it to the month before. Pick a month to see the rules with its numbers filled in.</p>
      <p>When a limit is used all the way up, it’s called <b>binding</b>. Binding limits are the ones holding the plan back: loosen one and the cost would drop. A limit with room left over is <b>slack</b>.</p>
      <label class="ap-field ap-month"><span class="ap-name">Month</span><select id="study-month">${p.months.map((mm) => `<option value="${mm.t}"${mm.t === month ? " selected" : ""}>Month ${mm.t}</option>`).join("")}</select></label>
      <div class="ap-cons">
        ${card("Workforce", "This month’s teams are last month’s teams, plus hires, minus layoffs.", `${sub("W", "t")} = ${sub("W", "t−1")} + ${sub("H", "t")} − ${sub("L", "t")}`,
          `${q(m.W)} = ${q(prev.W)} + ${q(m.H)} − ${q(m.L)}`, ok)}
        ${card("Inventory", "Last month’s stock, minus last month’s late orders, plus what you make, has to cover this month’s demand. Anything extra becomes stock; any shortfall becomes a stockout.",
          `${sub("I", "t−1")} − ${sub("S", "t−1")} + ${sub("P", "t")} = ${sub("D", "t")} + ${sub("I", "t")} − ${sub("S", "t")}`,
          `${q(prev.I)} − ${q(prev.S)} + ${q(m.P)} = ${q(m.D)} + ${q(m.I)} − ${q(m.S)} &nbsp;→&nbsp; ${q(prev.I - prev.S + m.P)} = ${q(m.D + m.I - m.S)}`, ok)}
        ${card("Capacity", "You can’t make more than the teams produce in regular hours plus overtime.", `${sub("P", "t")} ≤ ${n4.format(d.regCapPerTeam)} ${sub("W", "t")} + ${n4.format(d.capPerTeamHour)} ${sub("O", "t")}`,
          `${q(m.P)} ≤ ${n4.format(d.regCapPerTeam)} × ${q(m.W)} + ${n4.format(d.capPerTeamHour)} × ${q(m.O)} = ${q(capR)}`, check(m.P, capR))}
        ${card("Overtime", "Overtime can’t go past the cap for the teams you have.", `${sub("O", "t")} ≤ ${n2.format(d.otMaxPerTeam)} ${sub("W", "t")}`,
          `${q(m.O)} ≤ ${n2.format(d.otMaxPerTeam)} × ${q(m.W)} = ${q(otR)}`, check(m.O, otR))}
        ${card(`${esc(ctx.name)} policy`, policyRow[2], policyRow[0], policyRow[1], ok)}
        ${ends.length ? card("End of the year", "Extra rules for the last month only.", ends.map((e) => e.split(" → ")[0]).join(" · "), ends.map((e) => e.split(" → ")[1]).join(" · "), ok) : ""}
      </div>`));

    /* 5. how HiGHS found it */
    const L = ex.log, R = ex.relaxed, B = ex.branch;
    const sizeLine = L.size ? `Written out in full, the model has <b>${n0.format(L.size.rows)}</b> rules (constraints) and <b>${n0.format(L.size.cols)}</b> unknowns (variables)${L.size.ints ? `, and ${n0.format(L.size.ints)} of the unknowns have to be whole numbers` : ""}.` : "";
    const pre = L.presolve ? ` Before it starts, HiGHS tidies the model up (a step called presolve). It locks in anything that can only have one value and drops rules that can never matter, which left ${n0.format(L.presolve.rows)} rules and ${n0.format(L.presolve.cols)} unknowns.${pol === "level" ? " In a level plan the team count is already fixed every month, so a lot gets removed." : ""}` : "";
    const wRow = R ? `<div class="ap-scroll" tabindex="0" role="region" aria-label="Teams, fractional and whole"><table class="ap-table ap-mini ap-wide">
        <thead><tr><th scope="col">Month</th>${p.months.map((mm) => `<th scope="col">${mm.t}</th>`).join("")}</tr></thead><tbody>
        <tr><td>${ex.wholeTeams ? "Teams, relaxed" : "Teams"}</td>${R.W.map((w) => `<td${ex.wholeTeams && Math.abs(w - Math.round(w)) > EPS ? ' class="frac"' : ""}>${n2.format(w)}</td>`).join("")}</tr>
        ${ex.wholeTeams ? `<tr><td>Teams, final</td>${p.months.map((mm) => `<td>${q(mm.W)}</td>`).join("")}</tr>` : ""}</tbody></table></div>` : "";
    const simplex = `Picture every possible plan as a point inside a many-sided shape. The cheapest plan is always at one of its corners, so the <b>simplex method</b> starts at a corner and keeps moving to a neighboring corner that costs less. When no neighbor is cheaper, it’s done.`;
    let relaxText = "";
    if (R && !ex.wholeTeams) relaxText = `<p>Because fractional teams are allowed, this is a linear program, and HiGHS can solve it directly. ${simplex} Here that took <b>${n0.format(R.iters || 0)}</b> moves and landed on <b>${$(R.cost)}</b>, which is the plan.</p>${wRow}`;
    else if (R) relaxText = `<p><b>First, ignore the whole-number rule.</b> HiGHS starts with an easier version where teams can be fractions (called the relaxation). ${simplex} That took ${n0.format(R.iters || 0)} moves and gives a cost of <b>${$(R.cost)}</b>. No real plan can beat that, since a real plan has fewer options, so it works as a floor. ${R.fractional.length
      ? `The catch is that ${n0.format(R.fractional.length)} of its numbers are fractions, and you can’t hire ${n2.format(B ? B.value : (R.fractional.find((f) => f.name[0] === "W") || R.fractional[0]).value)} teams:`
      : `Here every team number already came out whole, so the relaxation is the answer and there’s nothing left to search.`}</p>${wRow}`;
    let branchText = "";
    if (B) {
      const side = (s) => s.feasible ? `<span>costs at least <b>${$(s.cost)}</b></span><span>${s.fractionalLeft ? `${n0.format(s.fractionalLeft)} still fractional` : `<b>all whole</b>: a real plan`}</span>` : "<span>no possible plan</span>";
      const lab = (t) => t.replace(/^([A-Z])_(\d+)/, (_, v, i) => sub(v, i));
      const nm = sub(B.name[0], B.name.slice(2));
      branchText = `<p><b>Next, split the problem (branch and bound).</b> Take one of the fractions, ${nm} = ${n2.format(B.value)}. Any real plan has either ${lab(esc(B.down.label))} or ${lab(esc(B.up.label))}, so HiGHS splits into those two cases and solves each one:</p>
        <div class="ap-tree"><div class="root"><span class="ap-label">Relaxed version</span><b>${$(R.cost)}</b><span>${nm} = ${n2.format(B.value)}</span></div>
          <div class="kids"><div><span class="lab">${lab(esc(B.down.label))}</span>${side(B.down)}</div><div><span class="lab">${lab(esc(B.up.label))}</span>${side(B.up)}</div></div></div>
        <p>Splitting can only push the floor up, never down. If a branch’s floor is already higher than the best real plan found so far, HiGHS drops it without looking any further. That’s the “bound” part, and it’s what saves the search from trying every combination. HiGHS also has a few shortcuts: extra rules that cut off fractional answers (cutting planes), and quick guesses that find good whole-number plans early.</p>`;
    }
    const prog = L.progress || [];
    const noSplit = (L.nodes || 1) <= 1;
    const searchText = ex.wholeTeams && prog.length && R && R.fractional.length ? `<p><b>Then, close the gap.</b> This table comes straight from HiGHS’s log. The <b>floor</b> is the lowest cost still possible, and the <b>best plan</b> is the cheapest real plan found so far. The search is finished when the two meet.</p>
      <div class="ap-scroll" tabindex="0" role="region" aria-label="Search progress"><table class="ap-table ap-mini">
        <thead><tr><th scope="col">What happened</th><th scope="col">Branches</th><th scope="col">Floor</th><th scope="col">Best plan</th><th scope="col">Gap</th><th scope="col">Time</th></tr></thead><tbody>
        ${prog.map((r) => `<tr><td>${esc(SRC[r.src] || r.src)}</td><td>${n0.format(r.nodes)}</td><td>${r.bound === null ? "—" : $(r.bound)}</td><td>${r.best === null ? "—" : $(r.best)}</td><td>${esc(r.gap === "Large" ? "large" : r.gap)}</td><td>${n2.format(r.time)} s</td></tr>`).join("")}
        </tbody></table></div>
      <p>${noSplit
        ? `For this plan, HiGHS never actually had to split. Its cutting planes and quick guesses closed the gap before any branching, so the split shown above is the one it would have made next.`
        : `In all, it checked <b>${n0.format(L.nodes)}</b> branches and made ${n0.format(L.lpIters || 0)} simplex moves.`} The floor and the best plan met at <b>${$(p.total)}</b>, a gap of 0%. That’s the proof: no cheaper plan exists, so this isn’t just a good answer, it’s the best one.</p>` : "";
    steps.push(step(5, "How the solver found the answer", `<p>${sizeLine}${pre}</p>${relaxText}${branchText}${searchText}
      <details class="ap-paste"><summary>Show HiGHS’s full log</summary><pre class="ap-lp">${esc(L.lines.join("\n"))}</pre></details>
      <details class="ap-paste"><summary>Show the model as HiGHS received it</summary><pre class="ap-lp">${esc(ex.lp)}</pre></details>`));

    /* 6. shadow prices */
    const P = ex.prices;
    if (P) {
      const top = Math.max(...P.map((r) => r.demand), d.material);
      const idle = P.some((r) => Math.abs(r.demand - d.material) < 1e-6);
      const holdRun = P.slice(1).some((r, i) => Math.abs(r.demand - P[i].demand - d.hold) < 1e-6);
      const bottleneck = P.some((r) => r.capacity > EPS);
      const otUnit = d.material + d.otCostPerTeamHour / Math.max(d.capPerTeamHour, EPS);
      const read = [
        idle ? `In months where it’s just ${$(d.material)}, there’s spare capacity, so the extra unit only costs its material.` : "",
        holdRun ? `When the price goes up by exactly ${$(d.hold)} from one month to the next, the extra unit is being made a month earlier and stored, and each extra month in storage adds another ${$(d.hold)}.` : "",
        `Making a unit on overtime costs ${$(d.material)} + ${$(d.otCostPerTeamHour)} ÷ ${n4.format(d.capPerTeamHour)} = ${$(otUnit)}, so while there’s overtime left to use, no month’s price goes above that.`,
        bottleneck ? `The capacity row works the other way: it shows how much one more unit of capacity would save. The months with a value there are the months where the teams are the bottleneck.` : "",
      ].filter(Boolean).join(" ");
      steps.push(step(6, "Why the plan looks the way it does", `
        <p>Here’s a useful question: if a customer ordered one more ${esc(one)} in a given month, how much would the cheapest plan go up? Keeping the team schedule as it is, that number is the month’s <b>shadow price</b>. It shows what the plan is doing to meet demand at that point in the year.</p>
        <div class="ap-bars" role="img" aria-label="Shadow price of demand by month; the table below has the numbers.">
          ${P.map((r) => `<div class="bar"><span class="fill" style="height:${Math.max(2, (r.demand / top) * 100)}%"><span class="mat" style="height:${Math.min(100, (d.material / Math.max(r.demand, EPS)) * 100)}%"></span></span><span class="t">${r.t}</span></div>`).join("")}
        </div>
        <p class="ap-legend"><span class="k mat"></span>material (${$(d.material)}) <span class="k rest"></span>the rest: overtime, storage, or filling it late</p>
        <div class="ap-scroll" tabindex="0" role="region" aria-label="Shadow prices"><table class="ap-table ap-mini ap-wide">
          <thead><tr><th scope="col">Month</th>${P.map((r) => `<th scope="col">${r.t}</th>`).join("")}</tr></thead><tbody>
          <tr><td>Cost of one more unit of demand</td>${P.map((r) => `<td>${$(r.demand)}</td>`).join("")}</tr>
          <tr><td>Savings from one more unit of capacity</td>${P.map((r) => `<td${Math.abs(r.capacity) < EPS ? ' class="z"' : ""}>${$(r.capacity)}</td>`).join("")}</tr></tbody></table></div>
        <p><b>How to read it.</b> ${read}</p>`));
    }

    el.innerHTML = `<ol class="ap-steps">${steps.join("")}</ol>`;
    const sel = el.querySelector("#study-month");
    if (sel) sel.addEventListener("change", () => { month = Number(sel.value); render(el, ex, ctx); el.querySelector("#study-month").focus(); });
  }

  root.APStudy = { render };
})(window);
