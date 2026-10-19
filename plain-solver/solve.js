/* One solve, start to finish: the model in, everything the results page shows out.
 *
 *   PSSolve.run(model, env) -> Promise<answer>
 *     env.highs()      resolves to a HiGHS instance (highs-js); env.reset() throws it away after an error
 *     env.capture(fn)  runs fn with HiGHS's log collected: [result, lines] (optional)
 *     env.progress, env.stopped   for the evolutionary engine
 *
 * The answer: { ok, status, engine, cls, notes, goal, x, decisions, named, rows, sensitivity,
 *   limits, diagnosis, unbounded, lp, size, ms }. status is one of optimal | timeout | local |
 *   evolutionary | infeasible | unbounded | error | model. Runs in the worker and in Node.
 */
(function (root) {
  "use strict";
  const node = typeof module !== "undefined" && module.exports;
  const M = node ? require("./model.js") : root.PSModel;
  const EN = node ? require("./engines.js") : root.PSEngines;
  const INF = Infinity;

  const ENGINE = {
    lp: { name: "HiGHS · linear", line: "This problem is linear, so the answer is guaranteed to be the best possible." },
    mip: { name: "HiGHS · branch and bound", line: "This problem is linear with whole-number or yes-or-no decisions, so HiGHS searches until it can prove the best answer." },
    qp: { name: "HiGHS · quadratic", line: "The goal is a convex quadratic (squared terms) and the rules are linear, so the answer is guaranteed to be the best possible." },
    nlp: { name: "Nonlinear · gradient search", line: "This problem is nonlinear. It finds a very good answer, but can't guarantee it's the single best one." },
    nonsmooth: { name: "Evolutionary", line: "This problem has jumps or corners (if-then, larger-of, look-ups) or whole numbers in a nonlinear model, so it's solved by evolution: a population of answers that improves generation by generation. Good, but not guaranteed best." },
  };

  async function solveLP(env, lp, opts, mip) {
    const h = await env.highs();
    const run = () => h.solve(lp, opts);
    try {
      if (mip && env.capture) return env.capture(run);
      return [run(), []];
    } catch (err) {
      if (env.reset) env.reset();
      throw err;
    }
  }
  const relaxLm = (Lm) => ({ ...Lm, vars: Lm.vars.map((v) => (v.type === "continuous" ? v : { ...v, type: "continuous" })) });
  const primal = (r, Lm) => Lm.vars.map((v, i) => { const c = r.Columns["v" + (i + 1)]; return c ? c.Primal : Math.max(v.lo, Math.min(0, v.hi)); });
  function logGap(lines) {
    const text = lines.join("\n");
    const gap = /Gap\s+([\d.]+)%/.exec(text), bound = /Dual bound\s+(\S+)/.exec(text);
    return { gap: gap ? Number(gap[1]) / 100 : null, bound: bound ? Number(bound[1]) : null };
  }

  function report(E, x, extra) {
    const ev = (t) => M.evaluate(t, x);
    const decisions = {};
    E.vars.forEach((v) => { (decisions[v.decision] = decisions[v.decision] || []).push({ keys: v.keys, value: x[v.i], i: v.i }); });
    const named = {};
    for (const n of E.named) (named[n.id] = named[n.id] || []).push({ keys: n.keys, value: ev(n.tree) });
    const rows = E.rows.map((r, j) => {
      const lhs = ev(r.lhs), rhs = ev(r.rhs), d = lhs - rhs;
      const scale = 1e-6 * Math.max(1, Math.abs(lhs), Math.abs(rhs));
      const slack = r.op === "<=" ? -d : r.op === ">=" ? d : Math.abs(d);
      return { j, rule: r.rule, label: r.label, keys: r.keys, part: r.part, op: r.op, lhs, rhs, slack, binding: Math.abs(d) <= scale || r.op === "=", met: slack >= -scale * 10 };
    });
    return { decisions, named, rows, goal: E.goal ? ev(E.goal.tree) : null, x, ...extra };
  }

  // What each rule's limit is worth: duals read straight off an LP, or off the LP left when a MIP's
  // whole-number decisions are held where the solver put them (marked approximate).
  async function sensitivity(env, E, k, x, opts) {
    let Lm = k.Lm, approx = false;
    if (k.cls === "mip") {
      approx = true;
      Lm = { ...Lm, vars: Lm.vars.map((v, i) => (v.type === "continuous" ? v : { ...v, type: "continuous", lo: Math.round(x[i]), hi: Math.round(x[i]) })) };
    }
    const { lp } = M.writeLP(Lm, { bare: true });
    const [r] = await solveLP(env, lp, { ...opts, output_flag: false }, false);
    if (r.Status !== "Optimal" || !r.Rows.length || r.Rows[0].Dual === undefined) return null;
    const rows = E.rows.map((row, j) => { const R = r.Rows[j]; return R ? R.Dual : 0; });
    const reduced = E.vars.map((v, i) => { const c = r.Columns["v" + (i + 1)]; return c ? c.Dual : 0; });
    const cost = E.vars.map((v, i) => k.Lm.obj.t.get(i) || 0);
    const fixed = k.cls === "mip" ? E.vars.filter((v) => v.type !== "continuous").map((v) => v.decision) : [];
    // A dual is one number, but at a corner the price of one more unit and one fewer can differ
    // (one more unit of demand might be a lost sale, one fewer an hour of overtime saved). For the
    // rules that are tight, move the limit a little each way and re-solve to get both.
    const up = [], down = [];
    if (E.rows.length <= 200) {
      const obj0 = r.ObjectiveValue;
      for (let j = 0; j < E.rows.length; j++) {
        const R = r.Rows[j];
        if (!R) continue;
        const rhs = Lm.rows[j].rhs, slackRow = Math.abs(R.Primal - rhs) > 1e-7 * Math.max(1, Math.abs(rhs));
        if (slackRow && Lm.rows[j].op !== "=") { up[j] = 0; down[j] = 0; continue; }
        const d = 1e-3 * Math.max(1, Math.abs(rhs));
        const at = async (delta) => {
          const rows2 = Lm.rows.slice();
          rows2[j] = { ...rows2[j], rhs: rhs + delta };
          const [s] = await solveLP(env, M.writeLP({ ...Lm, rows: rows2 }, { bare: true }).lp, { ...opts, output_flag: false }, false);
          return s.Status === "Optimal" ? s.ObjectiveValue : null;
        };
        const a = await at(d), b = await at(-d);
        up[j] = a === null ? null : (a - obj0) / d;
        down[j] = b === null ? null : (obj0 - b) / d;
      }
    }
    const ranges = E.rows.length + E.vars.length <= 80 && !Lm.aux.length ? await ranging(env, Lm, opts, r.ObjectiveValue, up, down, primal(r, Lm)) : null;
    return { rows, up, down, reduced, cost, approx, fixed: [...new Set(fixed)], ranges };
  }

  // Excel's allowable increase and decrease. The goal is piecewise linear in any one right-hand side
  // or cost, so the range is how far that number can move while the goal stays on the same line:
  // for a right-hand side, the line with the one-sided price; for a cost, the line the current
  // answer gives (it stays the best answer). Found by doubling the step, then halving the gap.
  async function ranging(env, Lm, opts, obj0, up, down, x) {
    const solveWith = async (L) => {
      const [s] = await solveLP(env, M.writeLP(L, { bare: true }).lp, { ...opts, output_flag: false }, false);
      return s.Status === "Optimal" ? s.ObjectiveValue : null;
    };
    async function reach(test, scale) {
      // Largest t ≥ 0 with test(t) true, given test(0) is; Infinity past 1e9.
      let ok = 0, t = 1e-3 * Math.max(1, Math.abs(scale));
      while (await test(t)) { ok = t; t *= 4; if (t > 1e9 * Math.max(1, Math.abs(scale))) return Infinity; }
      let bad = t;
      for (let k = 0; k < 40 && bad - ok > 1e-7 * Math.max(1, ok); k++) { const mid = (ok + bad) / 2; if (await test(mid)) ok = mid; else bad = mid; }
      return ok;
    }
    const same = (a, b) => a !== null && Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(obj0), Math.abs(b));
    const rhs = [];
    for (let j = 0; j < up.length; j++) {
      if (up[j] === undefined) { rhs.push(null); continue; }
      const b = Lm.rows[j].rhs;
      const at = (delta) => { const rows = Lm.rows.slice(); rows[j] = { ...rows[j], rhs: b + delta }; return solveWith({ ...Lm, rows }); };
      const inc = up[j] === null ? 0 : await reach(async (t) => same(await at(t), obj0 + up[j] * t), b);
      const dec = down[j] === null ? 0 : await reach(async (t) => same(await at(-t), obj0 - down[j] * t), b);
      rhs.push({ inc, dec });
    }
    const cost = [];
    for (let i = 0; i < Lm.vars.length; i++) {
      const c = Lm.obj.t.get(i) || 0;
      const at = (delta) => { const t = new Map(Lm.obj.t); t.set(i, c + delta); return solveWith({ ...Lm, obj: { k: Lm.obj.k, t } }); };
      // With the cost moved by d, the current answer's goal moves by d·x; it stays best while the optimum does too.
      const inc = await reach(async (t) => same(await at(t), obj0 + t * x[i]), c);
      const dec = await reach(async (t) => same(await at(-t), obj0 - t * x[i]), c);
      cost.push({ inc, dec });
    }
    return { rhs, cost };
  }

  // Excel's Limits Report: each decision moved alone, the others held, as far as the rules allow.
  function limits(k, x, goalValue) {
    if (k.Lm.aux.length) return null;
    const Lm = k.Lm;
    return Lm.vars.map((v, j) => {
      let lo = v.lo, hi = v.hi;
      for (const r of Lm.rows) {
        const a = r.t.get(j);
        if (!a) continue;
        let rest = 0;
        for (const [i, c] of r.t) if (i !== j) rest += c * x[i];
        const b = (r.rhs - rest) / a;
        if (r.op === "=") { lo = Math.max(lo, b); hi = Math.min(hi, b); }
        else if ((r.op === "<=") === (a > 0)) hi = Math.min(hi, b); else lo = Math.max(lo, b);
      }
      if (v.type !== "continuous") { lo = Math.ceil(lo - 1e-9); hi = Math.floor(hi + 1e-9); }
      const c = Lm.obj.t.get(j) || 0;
      const at = (val) => (Number.isFinite(val) ? goalValue + c * (val - x[j]) : null);
      return { i: j, lo, hi, goalAtLo: at(lo), goalAtHi: at(hi) };
    });
  }

  // "Infeasible", in words: let every rule bend, find the least bending, and say who bent.
  async function diagnose(env, E, k, opts) {
    const el = M.elastic(k.Lm);
    const { lp } = M.writeLP(el.Lm, { bare: true });
    const [r] = await solveLP(env, lp, { ...opts, output_flag: false }, true);
    if (!r.Columns) return null;
    const xs = primal(r, el.Lm);
    const broken = [];
    for (const s of el.slacks) {
      const amt = xs[s.i];
      if (!(amt > 1e-6)) continue;
      if (s.row !== undefined) {
        const src = k.Lm.rows[s.row].src;
        if (src.goalRow) broken.push({ kind: "goal", label: src.label, amount: amt, dir: s.dir });
        else broken.push({ kind: "rule", rule: src.rule, label: src.label, keys: src.keys, op: src.op, amount: amt, dir: s.dir });
      } else {
        const v = k.Lm.vars[s.var];
        broken.push({ kind: "limit", decision: v.decision, label: v.label, limit: s.limit, amount: amt, dir: s.dir });
      }
    }
    // The rules pushing back: nonzero duals in the elastic problem's relaxation.
    let conflict = [];
    try {
      const [rr] = await solveLP(env, M.writeLP(relaxLm(el.Lm), { bare: true }).lp, { ...opts, output_flag: false }, false);
      if (rr.Status === "Optimal" && rr.Rows.length && rr.Rows[0].Dual !== undefined) {
        k.Lm.rows.forEach((row, j) => { if (!row.aux && !row.src.goalRow && Math.abs(rr.Rows[j].Dual) > 1e-9) conflict.push(row.src.rule); });
      }
    } catch (e) { /* the list of rules pushing back is a nicety */ }
    for (const b of broken) if (b.rule) conflict.push(b.rule);
    conflict = [...new Set(conflict)];
    return { broken, conflict };
  }

  async function unboundedWhich(env, E, k, opts) {
    const CAP = 1e7;
    const Lm = { ...k.Lm, vars: k.Lm.vars.map((v) => ({ ...v, lo: Number.isFinite(v.lo) ? v.lo : -CAP, hi: Number.isFinite(v.hi) ? v.hi : CAP })) };
    const [r] = await solveLP(env, M.writeLP(Lm, { bare: true }).lp, { ...opts, output_flag: false }, true);
    if (!r.Columns) return [];
    const xs = primal(r, Lm);
    return [...new Set(E.vars.filter((v) => Math.abs(xs[v.i]) >= CAP * 0.999).map((v) => v.decision))];
  }

  async function run(model, env) {
    const t0 = Date.now();
    const o = model.options || {};
    const E = M.expand(model);
    if (E.errors.length) return { ok: false, status: "model", errors: E.errors, notes: E.notes };
    if (!E.vars.length) return { ok: false, status: "model", errors: [{ text: "There's nothing to decide yet." }] };
    if (!E.goal) return { ok: false, status: "model", errors: [{ text: "Tell me what you want: the lowest cost, the most profit, or a number to hit.", where: "goal" }] };
    const k = M.classify(E, o.engine);
    const opts = { time_limit: Number(o.timeLimitSec) || 30, mip_rel_gap: o.mipGap === undefined ? 1e-4 : Number(o.mipGap), output_flag: false };
    const ints = E.vars.filter((v) => v.type !== "continuous").length;
    const size = { vars: E.vars.length, rows: E.rows.length, ints };
    const base = { cls: k.cls, engine: ENGINE[k.cls] ? ENGINE[k.cls].name : "", line: ENGINE[k.cls] ? ENGINE[k.cls].line : "", notes: (k.Lm ? k.Lm.notes : []).concat(E.notes.map((n) => n.text)), size };
    if (E.vars.length > 20000 || ints > 2000) base.notes.push(`This is a big one for a browser: ${E.vars.length.toLocaleString("en-US")} decisions (${ints.toLocaleString("en-US")} whole-number) and ${E.rows.length.toLocaleString("en-US")} rules. It still runs here; if it hits the time limit, you get the best plan found and how far from the best it could be. A longer limit is in Advanced.`);
    if (k.hint === "bound") base.notes.push("A yes-or-no decision multiplies an amount with no upper limit. Give that amount a limit and the model can be solved exactly as a linear one.");
    if (k.forced) base.notes.push("The engine was chosen by hand in Advanced.");
    if (k.cls === "nonsmooth" && k.ints && !k.forced && k.worst < 2) base.notes.push("Whole-number decisions in a nonlinear model go to the evolutionary engine, which rounds them as it searches.");

    if (k.cls === "lp" || k.cls === "mip") {
      const { lp, nameMap } = M.writeLP(k.Lm);
      let r, lines;
      try { [r, lines] = await solveLP(env, lp, { ...opts, output_flag: k.cls === "mip" && !!env.capture }, k.cls === "mip"); }
      catch (err) { return { ok: false, status: "error", ...base, lp, message: "The solver hit an internal error on this model. Change something and it will try again with a fresh solver." }; }
      const st = r.Status;
      const out = { ...base, lp, nameMap };
      if (st === "Optimal" || (/time limit/i.test(st) && r.Columns && Object.keys(r.Columns).length && Number.isFinite(r.ObjectiveValue))) {
        const xs = primal(r, k.Lm).slice(0, E.vars.length);
        const rep = report(E, xs, {});
        const timed = st !== "Optimal";
        if (timed) { const g = logGap(lines || []); out.gap = g.gap; out.bound = g.bound; }
        let sens = null;
        try { sens = await sensitivity(env, E, k, primal(r, k.Lm), opts); } catch (e) { sens = null; }
        return { ok: true, status: timed ? "timeout" : "optimal", ...out, ...rep, sensitivity: sens, limits: limits(k, primal(r, k.Lm), rep.goal), ms: Date.now() - t0 };
      }
      if (/time limit/i.test(st)) return { ok: false, status: "timeout", ...out, message: "The time limit ran out before any plan was found that meets every rule." };
      if (/infeasible/i.test(st)) {
        const diag = await diagnose(env, E, k, opts);
        if (diag && !diag.broken.length && /unbounded/i.test(st)) return { ok: false, status: "unbounded", ...out, unbounded: await unboundedWhich(env, E, k, opts) };
        return { ok: false, status: "infeasible", ...out, diagnosis: diag, ms: Date.now() - t0 };
      }
      if (/unbounded/i.test(st)) return { ok: false, status: "unbounded", ...out, unbounded: await unboundedWhich(env, E, k, opts) };
      return { ok: false, status: "error", ...out, message: `The solver stopped without an answer (${st}).` };
    }

    if (k.cls === "qp") {
      const Lm = { ...k.Lm, obj: { k: k.Q.k, t: k.Q.t }, sense: "min" };
      const { lp, nameMap } = M.writeLP(Lm, { Q: k.Q });
      try {
        const [r] = await solveLP(env, lp, opts, false);
        if (r.Status === "Optimal") {
          const xs = primal(r, Lm).slice(0, E.vars.length);
          return { ok: true, status: "optimal", ...base, lp, nameMap, ...report(E, xs, {}), ms: Date.now() - t0 };
        }
        if (/infeasible/i.test(r.Status)) {
          const diag = await diagnose(env, E, { ...k, Lm: { ...k.Lm, obj: { k: 0, t: new Map() } } }, opts);
          return { ok: false, status: "infeasible", ...base, lp, diagnosis: diag };
        }
      } catch (err) { /* fall through to the nonlinear engine */ }
      base.cls = "nlp"; base.engine = ENGINE.nlp.name; base.line = ENGINE.nlp.line;
      base.notes.push("HiGHS couldn't take this quadratic directly, so the nonlinear engine solved it.");
    }

    if (base.cls === "nlp" || k.cls === "nlp") {
      const P = M.numeric(E, "nlp");
      const multistart = o.multistart === undefined ? P.n <= 20 : !!o.multistart;
      const r = EN.nlp(P, { multistart, timeLimitSec: opts.time_limit });
      if (!r.feasible) return { ok: false, status: "infeasible", ...base, local: true, ...report(E, r.x, {}), message: `No answer was found that meets every rule${multistart ? ` from ${r.starts} starting points` : ""}. The rules may conflict, or the search may have missed the feasible region; try turning on multistart in Advanced.` };
      if (Math.abs(r.f) > 1e12) return { ok: false, status: "unbounded", ...base, unbounded: E.vars.filter((v) => Math.abs(r.x[v.i]) > 1e9).map((v) => v.decision) };
      base.notes.push(multistart ? `Searched from ${r.starts} starting points and kept the best.` : "Searched from one starting point. Turn on multistart in Advanced to try several.");
      return { ok: true, status: "local", ...base, ...report(E, r.x, {}), ms: Date.now() - t0 };
    }

    // Evolutionary.
    const P = M.numeric(E, "de");
    const r = await EN.de(P, { timeLimitSec: opts.time_limit }, { progress: env.progress, stopped: env.stopped });
    if (r.stopped) base.notes.push("Stopped by hand: this is the best answer found so far.");
    if (!r.feasible) return { ok: false, status: "infeasible", ...base, local: true, ...report(E, r.x, {}), message: "Evolution didn't find an answer that meets every rule. The rules may conflict; try loosening one, or give it more time in Advanced." };
    base.notes.push(`${r.generations} generations.`);
    return { ok: true, status: "evolutionary", ...base, ...report(E, r.x, {}), ms: Date.now() - t0 };
  }

  const api = { run, ENGINE };
  if (node) module.exports = api;
  else root.PSSolve = api;
})(typeof self !== "undefined" ? self : this);
