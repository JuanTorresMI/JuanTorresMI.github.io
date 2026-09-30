/* Runs HiGHS off the main thread, so a slow integer solve never freezes the inputs.
 * Messages in:  { id, kind: "solve", inputs, runs: [{ policy, wholeTeams }], debug }
 *               { id, kind: "explain", inputs, policy, wholeTeams }
 * Messages out: { id, results: [{ policy, ok, plan } | { policy, ok: false, message }] }
 *               { id, results: explanation } (see explain() below)
 * If HiGHS throws, the instance is thrown away and loaded again before the next solve:
 * some builds are left in a bad state after an error.
 */
importScripts("lib/highs.js", "model.js");
const loadHighs = self.Module;
let highs = null;
let sink = null; // collects HiGHS's log while explain() is listening

async function solver() {
  if (!highs) highs = await loadHighs({
    locateFile: (f) => new URL("lib/" + f, self.location.href).href,
    print: (line) => { if (sink) sink.push(line); },
    printErr: (line) => { if (sink) sink.push(line); },
  });
  return highs;
}

const OPTIONS = { mip_rel_gap: 0, output_flag: false, time_limit: 20 };

function friendly(status, policy) {
  if (/infeasible/i.test(status)) {
    const why = policy === "level" ? "a fixed workforce can't meet demand and the ending conditions"
      : policy === "band" ? "the workforce band is too tight for the demand and the ending conditions"
      : "the ending conditions can't be met";
    return `No feasible plan: ${why}. Try allowing stockouts before the last month, lowering the ending inventory, or widening the limits.`;
  }
  if (/time limit/i.test(status)) return "The solver ran out of time before it could prove the best plan. Try continuous teams, or a shorter horizon.";
  if (/unbounded/i.test(status)) return "The model is unbounded, which means a cost is negative somewhere. Check the cost inputs.";
  return `The solver stopped without a plan (${status}).`;
}

async function solveRuns(inputs, runs, debug) {
  const M = self.APModel, results = [];
  for (const { policy, wholeTeams } of runs) {
    const built = M.buildModel(inputs, policy, wholeTeams);
    if (built.error) { results.push({ policy, ok: false, message: built.error }); continue; }
    try {
      const h = await solver();
      const t0 = performance.now();
      const r = h.solve(built.lp, OPTIONS);
      const ms = performance.now() - t0;
      if (r.Status !== "Optimal") { results.push({ policy, ok: false, message: friendly(r.Status, policy), status: r.Status }); continue; }
      const plan = M.readPlan(inputs, built, r);
      plan.ms = ms;
      plan.wholeTeams = wholeTeams;
      if (debug) plan.lp = built.lp;
      results.push({ policy, ok: true, plan });
    } catch (err) {
      highs = null; // start over with a fresh instance next time
      results.push({ policy, ok: false, message: "The solver hit an internal error on these inputs. Change something and it will try again with a fresh solver.", status: String(err && err.message || err) });
    }
  }
  return results;
}

/* ---------- study mode: the same plan, taken apart ----------
   Everything here is re-derived from real solves, so the walk-through shows what actually
   happened for these inputs, not a textbook story:
     relaxed   the model with fractional teams allowed (the LP relaxation): its cost is a floor
     branch    the first split branch and bound would make, both halves solved
     search    HiGHS's own progress log for the real solve, parsed
     prices    shadow prices: with the final team plan held fixed, what one more unit of
               demand (or one more unit of capacity) in each month would change the cost by */
const INT_VARS = /^(H|L|W)_\d+$/;
const frac = (v) => Math.abs(v - Math.round(v));
const withRows = (lp, rows) => lp.replace("\nBounds", "\n" + rows.map((r) => " " + r).join("\n") + "\nBounds");
const relax = (lp) => lp.replace(/\nGeneral\n[^\n]*/, "");

function parseLog(lines) {
  const text = lines.join("\n"), num = (re) => { const m = re.exec(text); return m ? Number(m[1]) : null; };
  const out = { lines };
  const size = /has (\d+) rows; (\d+) cols; (\d+) nonzeros(?:; (\d+) integer)?/.exec(text);
  if (size) out.size = { rows: +size[1], cols: +size[2], nonzeros: +size[3], ints: size[4] ? +size[4] : 0 };
  const pre = /Presolve reductions: rows (\d+)\((-?\d+)\); columns (\d+)\((-?\d+)\)/.exec(text);
  if (pre) out.presolve = { rows: +pre[1], cols: +pre[3] };
  if (/Presolve: Optimal|Presolve reductions: rows 0\(/.test(text)) out.presolvedAway = true;
  out.nodes = num(/^\s*Nodes\s+(\d+)/m);
  out.lpIters = num(/^\s*LP iterations\s+(\d+)/m) ?? num(/Simplex\s+iterations:\s*(\d+)/);
  out.time = num(/^\s*Timing\s+([\d.]+)/m) ?? num(/HiGHS run time\s*:\s*([\d.]+)/);
  out.restart = /restarting/.test(text);
  // Progress rows of the branch-and-bound table.
  const rowRe = /^\s*([A-Za-z])?\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)%\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)s\s*$/;
  out.progress = [];
  for (const l of lines) {
    const m = rowRe.exec(l);
    if (!m) continue;
    const n = (s) => (/inf/.test(s) ? null : Number(s));
    out.progress.push({ src: m[1] || "", nodes: +m[2], queue: +m[3], leaves: +m[4], explored: +m[5], bound: n(m[6]), best: n(m[7]), gap: m[8], cuts: +m[9], lpIters: +m[12], time: +m[13] });
  }
  return out;
}

async function explain(inputs, policy, wholeTeams) {
  const M = self.APModel;
  const built = M.buildModel(inputs, policy, wholeTeams);
  if (built.error) return { ok: false, message: built.error };
  const h = await solver();
  const listen = (fn) => { sink = []; try { const r = fn(); return [r, parseLog(sink)]; } finally { sink = null; } };

  // 1. The real solve, with the log on.
  const [real, log] = listen(() => h.solve(built.lp, { ...OPTIONS, output_flag: true }));
  if (real.Status !== "Optimal") return { ok: false, message: friendly(real.Status, policy) };
  const plan = M.readPlan(inputs, built, real);

  // 2. The relaxation: same model, fractional teams allowed.
  const [rel, relLog] = listen(() => h.solve(relax(built.lp), { ...OPTIONS, output_flag: true }));
  const relaxed = rel.Status === "Optimal" ? {
    cost: rel.ObjectiveValue, iters: relLog.lpIters,
    fractional: Object.values(rel.Columns).filter((c) => INT_VARS.test(c.Name) && frac(c.Primal) > 1e-6).map((c) => ({ name: c.Name, value: c.Primal })),
    W: plan.months.map((m) => rel.Columns[`W_${m.t}`].Primal),
  } : null;

  // 3. The first branch: split the variable furthest from a whole number, solve both halves.
  let branch = null;
  if (wholeTeams && relaxed && relaxed.fractional.length) {
    const v = relaxed.fractional.slice().sort((a, b) => Math.abs(frac(b.value) - 0.5) < Math.abs(frac(a.value) - 0.5) ? 1 : -1)[0];
    const down = Math.floor(v.value), up = Math.ceil(v.value);
    const side = (row, label) => {
      const r = h.solve(withRows(relax(built.lp), [row]), OPTIONS);
      if (r.Status !== "Optimal") return { label, feasible: false };
      const left = Object.values(r.Columns).filter((c) => INT_VARS.test(c.Name) && frac(c.Primal) > 1e-6).length;
      return { label, feasible: true, cost: r.ObjectiveValue, fractionalLeft: left };
    };
    branch = { name: v.name, value: v.value, down: side(`br_dn: ${v.name} <= ${down}`, `${v.name} ≤ ${down}`), up: side(`br_up: ${v.name} >= ${up}`, `${v.name} ≥ ${up}`) };
  }

  // 4. Shadow prices: hold the final team plan fixed, solve what is left as an LP, read the duals.
  //    The dual of an equality row is how much the cost moves per unit of its right-hand side.
  let prices = null;
  const fixed = Object.values(real.Columns).filter((c) => INT_VARS.test(c.Name)).map((c) => `fx_${c.Name}: ${c.Name} = ${Math.round(c.Primal)}`);
  const fx = h.solve(wholeTeams ? withRows(relax(built.lp), fixed) : built.lp, OPTIONS);
  if (fx.Status === "Optimal" && fx.Rows.length && fx.Rows[0].Dual !== undefined) {
    const row = Object.fromEntries(fx.Rows.map((r) => [r.Name, r]));
    prices = plan.months.map((m) => ({
      t: m.t,
      demand: row[`inv_${m.t}`] ? row[`inv_${m.t}`].Dual : null,          // one more unit of demand in month t
      capacity: row[`cap_${m.t}`] ? -row[`cap_${m.t}`].Dual : null,        // one more unit of capacity in month t
      overtime: row[`ot_${m.t}`] ? -row[`ot_${m.t}`].Dual : null,          // one more overtime team-hour allowed
    }));
  }

  return { ok: true, policy, wholeTeams, plan, log, relaxed, branch, prices, lp: built.lp, derived: built.derived };
}

self.onmessage = async (e) => {
  const { id, kind } = e.data;
  let results;
  if (kind === "explain") {
    try { results = await explain(e.data.inputs, e.data.policy, e.data.wholeTeams); }
    catch (err) { sink = null; highs = null; results = { ok: false, message: "The solver hit an internal error while taking the plan apart. Change something and try again." }; }
  } else {
    results = await solveRuns(e.data.inputs, e.data.runs, e.data.debug);
  }
  self.postMessage({ id, results });
};
