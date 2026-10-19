/* Plain Solver's acceptance tests (the spec's §11), run against the page's own files and the
 * HiGHS build the site serves.
 *
 *   node scripts/plain-solver-test.js
 */
const path = require("path");
const dir = path.resolve(__dirname, "..", "plain-solver");
const M = require(path.join(dir, "model.js"));
const S = require(path.join(dir, "solve.js"));
const T = require(path.join(dir, "templates.js"));
const lib = path.resolve(__dirname, "..", "aggregate-planning", "lib");

let failures = 0, passes = 0;
const near = (a, b, tol) => Math.abs(a - b) <= (tol || 1e-6) * Math.max(1, Math.abs(b));
function check(name, ok, detail) {
  if (ok) passes++; else { failures++; console.log("FAIL " + name + (detail ? ": " + detail : "")); }
}
const clone = (x) => JSON.parse(JSON.stringify(x));
const val = (ans, id, keys) => { const e = ans.decisions[id].find((d) => (keys || []).join() === d.keys.join()); return e ? e.value : NaN; };

(async () => {
  let highs = null;
  const load = require(path.join(lib, "highs.js"));
  const sink = { lines: null };
  const env = {
    highs: async () => highs || (highs = await load({ locateFile: (f) => path.join(lib, f), print: (l) => sink.lines && sink.lines.push(l), printErr: (l) => sink.lines && sink.lines.push(l) })),
    reset: () => { highs = null; },
    capture: (fn) => { sink.lines = []; try { return [fn(), sink.lines]; } finally { sink.lines = null; } },
  };

  // Test 1: warehouse staffing (MIP).
  const staffing = clone(T.get("staffing").model);
  let a = await S.run(staffing, env);
  check("1 status", a.ok && a.status === "optimal", a.status + " " + (a.message || ""));
  check("1 engine", a.cls === "mip", a.cls);
  check("1 hires", near(val(a, "hires"), 5), val(a, "hires"));
  check("1 regular", near(val(a, "reg"), 400), val(a, "reg"));
  check("1 overtime", near(val(a, "ot"), 100), val(a, "ot"));
  check("1 short", near(val(a, "short"), 0), val(a, "short"));
  check("1 cost", near(a.goal, 13250), a.goal);
  // 6 hires costs $13,950; 4 hires leaves 500 units short.
  for (const [h, cost] of [[6, 13950], [4, 4 * 1000 + 360 * 15 + 90 * 22.5 + 500 * 100]]) {
    const m = clone(staffing);
    m.decisions[0].lower = h; m.decisions[0].upper = h;
    const b = await S.run(m, env);
    check(`1 with ${h} hires`, near(b.goal, cost), b.goal);
  }
  // The dual of "Meet demand": one more unit of demand costs what the cheapest way to cover it costs.
  check("1 sensitivity approx", a.sensitivity && a.sensitivity.approx, JSON.stringify(a.sensitivity && a.sensitivity.approx));
  const meetRow = a.rows.findIndex((r) => r.rule === "meet");
  // It's a corner: one more unit of demand is a lost sale ($100), one fewer saves an overtime unit ($2.25).
  check("1 demand: one more costs a lost sale", a.sensitivity && near(a.sensitivity.up[meetRow], 100, 1e-4), a.sensitivity && a.sensitivity.up[meetRow]);
  check("1 demand: one fewer saves overtime", a.sensitivity && near(a.sensitivity.down[meetRow], 2.25, 1e-4), a.sensitivity && a.sensitivity.down[meetRow]);

  // Test 2: product mix (LP).
  const mix = {
    schemaVersion: 1, things: [],
    decisions: [{ id: "x1", label: "x1", type: "continuous" }, { id: "x2", label: "x2", type: "continuous" }],
    results: [],
    rules: [
      { id: "a", label: "a", lhs: M.parse("x1"), op: "<=", rhs: M.parse("4") },
      { id: "b", label: "b", lhs: M.parse("2 * x2"), op: "<=", rhs: M.parse("12") },
      { id: "c", label: "c", lhs: M.parse("3 * x1 + 2 * x2"), op: "<=", rhs: M.parse("18") },
    ],
    goal: { label: "z", sense: "max", expr: M.parse("3 * x1 + 5 * x2") },
  };
  a = await S.run(mix, env);
  check("2 status", a.ok && a.cls === "lp", a.status + " " + a.cls);
  check("2 x1", near(val(a, "x1"), 2), val(a, "x1"));
  check("2 x2", near(val(a, "x2"), 6), val(a, "x2"));
  check("2 objective", near(a.goal, 36), a.goal);
  check("2 dual b (max)", near(a.sensitivity.rows[1], 1.5), a.sensitivity.rows[1]);
  check("2 dual c (max)", near(a.sensitivity.rows[2], 1), a.sensitivity.rows[2]);
  // Allowable ranges, as Excel's Sensitivity Report gives them for this LP.
  const R = a.sensitivity.ranges, unlimited = (v) => v === Infinity;
  check("2 ranges exist", !!R, "");
  if (R) {
    check("2 cost x1 range", near(R.cost[0].inc, 4.5, 1e-5) && near(R.cost[0].dec, 3, 1e-5), JSON.stringify(R.cost[0]));
    check("2 cost x2 range", unlimited(R.cost[1].inc) && near(R.cost[1].dec, 3, 1e-5), JSON.stringify(R.cost[1]));
    check("2 rhs a range", unlimited(R.rhs[0].inc) && near(R.rhs[0].dec, 2, 1e-5), JSON.stringify(R.rhs[0]));
    check("2 rhs b range", near(R.rhs[1].inc, 6, 1e-5) && near(R.rhs[1].dec, 6, 1e-5), JSON.stringify(R.rhs[1]));
    check("2 rhs c range", near(R.rhs[2].inc, 6, 1e-5) && near(R.rhs[2].dec, 6, 1e-5), JSON.stringify(R.rhs[2]));
  }
  check("2 limits", a.limits && near(a.limits[0].hi, 2) && near(a.limits[1].hi, 6), JSON.stringify(a.limits));

  // Test 3: infeasible, diagnosed in words.
  const inf = clone(staffing);
  inf.decisions.find((d) => d.id === "hires").disabled = true;
  inf.decisions.find((d) => d.id === "short").disabled = true;
  a = await S.run(inf, env);
  check("3 status", a.status === "infeasible", a.status);
  const broke = a.diagnosis && a.diagnosis.broken;
  check("3 blames demand", broke && broke.length === 1 && broke[0].rule === "meet" && near(broke[0].amount, 2500), JSON.stringify(broke));
  check("3 conflict lists the hour limits", a.diagnosis && ["meet", "regLimit", "otLimit"].every((r) => a.diagnosis.conflict.includes(r)), JSON.stringify(a.diagnosis && a.diagnosis.conflict));

  // Test 4: smooth nonlinear. Auto routes this convex quadratic to HiGHS; forced, the nonlinear engine.
  const bowl = {
    schemaVersion: 1, things: [],
    decisions: [{ id: "x", label: "x", lower: null, upper: null }, { id: "y", label: "y", lower: null, upper: null }],
    results: [], rules: [],
    goal: { label: "f", sense: "min", expr: M.parse("(x - 3)^2 + (y + 1)^2") },
  };
  a = await S.run(bowl, env);
  check("4 auto is QP", a.cls === "qp" && a.ok, a.cls + " " + a.status);
  check("4 QP answer", near(val(a, "x"), 3, 1e-5) && near(val(a, "y"), -1, 1e-5) && Math.abs(a.goal) < 1e-8, `${val(a, "x")} ${val(a, "y")} ${a.goal}`);
  a = await S.run({ ...bowl, options: { engine: "nonlinear" } }, env);
  check("4 forced NLP", a.cls === "nlp" && a.status === "local", a.cls + " " + a.status);
  check("4 NLP answer", near(val(a, "x"), 3, 1e-6) && near(val(a, "y"), -1, 1e-6) && Math.abs(a.goal) < 1e-9, `${val(a, "x")} ${val(a, "y")} ${a.goal}`);
  // A constrained, truly nonlinear one: the closest point on the circle x² + y² = 1 to (2, 2).
  a = await S.run({ ...bowl, rules: [{ id: "c", label: "On the circle", lhs: M.parse("x^2 + y^2"), op: "=", rhs: M.parse("1") }], goal: { label: "d", sense: "min", expr: M.parse("(x - 2)^2 + (y - 2)^2") } }, env);
  check("4b circle", a.cls === "nlp" && near(val(a, "x"), Math.SQRT1_2, 1e-5) && near(val(a, "y"), Math.SQRT1_2, 1e-5), `${a.cls} ${val(a, "x")} ${val(a, "y")}`);

  // Test 5: evolutionary, forced by an if-then on a decision.
  a = await S.run({ ...bowl, goal: { label: "f", sense: "min", expr: M.parse("abs(x - 3) + abs(y + 1) + if(x > 50, 100, 0)") } }, env);
  check("5 engine", a.cls === "nonsmooth" && a.status === "evolutionary", a.cls + " " + a.status);
  check("5 answer", near(val(a, "x"), 3, 1e-4) && near(val(a, "y"), -1, 1e-4), `${val(a, "x")} ${val(a, "y")}`);
  // Without the if-then, the absolute values are rewritten exactly and HiGHS takes it.
  a = await S.run({ ...bowl, goal: { label: "f", sense: "min", expr: M.parse("abs(x - 3) + abs(y + 1)") } }, env);
  check("5b abs rewritten", a.cls === "lp" && near(val(a, "x"), 3) && near(val(a, "y"), -1), `${a.cls} ${val(a, "x")} ${val(a, "y")}`);

  // Test 6: every template compiles to valid LP (where linear), solves, and maps names back.
  for (const t of T.list) {
    const m = clone(t.model);
    const cards = M.validate(m).filter((c) => c.level !== "note");
    check(`6 ${t.id} validates clean`, !cards.length, JSON.stringify(cards));
    const c = M.compileToLP(m);
    if (c.lp) {
      check(`6 ${t.id} names map back`, Object.values(c.nameMap).every((n) => n && !/^v\d+$/.test(n)), "");
      check(`6 ${t.id} no user text in names`, !/^ c\d+:.*[^\w\s.+\-*^\[\]\/:<>=]/m.test(c.lp.split("Subject To")[1]), "");
    }
    const ans = await S.run(m, env);
    check(`6 ${t.id} solves`, ans.ok && ["optimal", "local"].includes(ans.status), `${ans.status} ${ans.message || ""} ${JSON.stringify(ans.errors || "")}`);
    if (process.env.VERBOSE) console.log(t.id, ans.cls, ans.status, M.fmt(ans.goal), ans.ms + "ms");
  }
  // Typed formulas: every template expression written out by name and read back gives the same model.
  for (const t of T.list) {
    const m = clone(t.model);
    let bad = null;
    const re = (e) => {
      if (!e || typeof e !== "object") return e;
      const s = M.formula(m, e), p = M.parseNamed(m, s);
      if (p.error || M.formula(m, p.tree) !== s) { bad = s + " → " + (p.error || M.formula(m, p.tree)); return e; }
      return p.tree;
    };
    for (const r of m.results) r.expr = re(r.expr);
    for (const r of m.rules) { r.lhs = re(r.lhs); r.rhs = re(r.rhs); r.rhs2 = re(r.rhs2); r.count = re(r.count); }
    for (const d of m.decisions) { d.lower = re(d.lower); d.upper = re(d.upper); }
    m.goal.expr = re(m.goal.expr);
    check(`typed ${t.id} round trip`, !bad && M.compileToLP(m).lp === M.compileToLP(clone(t.model)).lp, bad || "LP differs");
  }
  check("typed: unknown name", /isn't a name/.test(M.parseNamed(staffing, "Workers_to_hire + nope").error || ""), "");

  // Specific template answers worth pinning down.
  a = await S.run(clone(T.get("pricing").model), env);
  check("6 pricing peak", near(val(a, "price"), 31, 1e-5) && near(a.goal, 7220, 1e-5), `${val(a, "price")} ${a.goal}`);
  a = await S.run(clone(T.get("shifts").model), env);
  check("6 shifts one each", T.get("shifts").model.things[0].rows.every((p) => near(a.decisions.assign.filter((d) => d.keys[0] === p.key).reduce((s, d) => s + d.value, 0), 1)), "");
  const agg = clone(T.get("aggregate").model);
  const chase = await S.run(agg, env);
  agg.rules.find((r) => r.id === "level").disabled = false;
  const level = await S.run(agg, env);
  check("6 level costs more than chase", level.ok && chase.ok && level.goal > chase.goal, `${level.goal} vs ${chase.goal}`);

  // Units: adding dollars to hours is a warning, not a block.
  const bad = clone(staffing);
  bad.results[2].expr = M.parse("crew.pay * reg + reg");
  check("units warning", M.validate(bad).some((c) => c.level === "warn" && /adding/.test(c.text)), JSON.stringify(M.validate(bad)));
  // A result that refers to itself.
  const loop = clone(staffing);
  loop.results[0].expr = M.parse("crew.count + hires + made");
  loop.results[1].expr = M.parse("crew.rate * staff");
  check("cycle caught", M.validate(loop).some((c) => /depends on itself/.test(c.text)), "");
  // Unbounded.
  a = await S.run({ schemaVersion: 1, things: [], decisions: [{ id: "q", label: "Units to sell" }], results: [], rules: [], goal: { label: "Profit", sense: "max", expr: M.parse("5 * q") } }, env);
  check("unbounded named", a.status === "unbounded" && a.unbounded.includes("q"), JSON.stringify(a.unbounded));

  // Test 7: a big transportation model (50 × 500).
  const W = 50, Sx = 500;
  const wk = Array.from({ length: W }, (_, i) => "W" + i), sk = Array.from({ length: Sx }, (_, i) => "S" + i);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const big = {
    schemaVersion: 1,
    things: [
      { id: "w", label: "Warehouses", one: "Warehouse", kind: "table", columns: [{ id: "supply", label: "Supply" }], rows: wk.map((k) => ({ key: k, supply: 1200 })) },
      { id: "s", label: "Stores", one: "Store", kind: "table", columns: [{ id: "demand", label: "Demand" }], rows: sk.map((k) => ({ key: k, demand: 50 + Math.floor(rnd() * 50) })) },
      { id: "cost", label: "Cost", kind: "grid", over: ["w", "s"], values: Object.fromEntries(wk.map((a) => [a, Object.fromEntries(sk.map((b) => [b, 1 + Math.round(rnd() * 20)]))])) },
    ],
    decisions: [{ id: "ship", label: "Ship", indexBy: ["w", "s"] }],
    results: [],
    rules: [
      { id: "sup", label: "Supply", lhs: M.parse("sum(s, ship)"), op: "<=", rhs: M.parse("w.supply"), forEach: ["w"] },
      { id: "dem", label: "Demand", lhs: M.parse("sum(w, ship)"), op: ">=", rhs: M.parse("s.demand"), forEach: ["s"] },
    ],
    goal: { label: "Cost", sense: "min", expr: M.parse("sum(w, sum(s, cost * ship))") },
  };
  const t0 = Date.now();
  a = await S.run(big, env);
  check("7 big solves", a.ok && a.status === "optimal" && a.size.vars === W * Sx, `${a.status} ${a.size && a.size.vars}`);
  console.log(`7 big model: ${a.size.vars} variables, ${a.size.rows} rules, ${Date.now() - t0} ms`);

  console.log(`${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
