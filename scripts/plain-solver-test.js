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

  // Review, Bug 1: the nonlinear engine stopped short on "at most" rules (24.86 for 25).
  const xy = (sense, goal, cap, opts) => ({
    schemaVersion: 1, things: [], results: [],
    decisions: [{ id: "x", label: "x" }, { id: "y", label: "y" }],
    rules: [{ id: "r", label: "Budget", lhs: M.parse("x + y"), op: "<=", rhs: { const: cap } }],
    goal: { label: "g", sense, expr: M.parse(goal) }, options: opts || {},
  });
  for (const [sense, goal, cap, want] of [["max", "x * y", 10, 25], ["min", "-x * y", 10, -25], ["max", "x * y", 100, 2500]]) {
    a = await S.run(xy(sense, goal, cap), env);
    check(`bug 1: ${sense} ${goal} with x + y <= ${cap}`, a.ok && near(a.goal, want, 1e-6) && near(val(a, "x"), cap / 2, 1e-6) && near(val(a, "y"), cap / 2, 1e-6), `${a.status} ${a.goal} (${val(a, "x")}, ${val(a, "y")})`);
  }
  // With multistart off, max x·y starts at (0, 0), where the slope is flat: the page says so.
  a = await S.run(xy("max", "x * y", 10, { multistart: false }), env);
  check("stuck at the start says try multistart", a.notes.some((n) => /multistart/.test(n) && /started/.test(n)), JSON.stringify(a.notes));

  // Test 5: evolutionary, forced by an if-then on a decision.
  a = await S.run({ ...bowl, goal: { label: "f", sense: "min", expr: M.parse("abs(x - 3) + abs(y + 1) + if(x > 50, 100, 0)") } }, env);
  check("5 engine", a.cls === "nonsmooth" && a.status === "evolutionary", a.cls + " " + a.status);
  check("5 answer", near(val(a, "x"), 3, 1e-4) && near(val(a, "y"), -1, 1e-4), `${val(a, "x")} ${val(a, "y")}`);
  // Evolutionary answers are tidied to round numbers when that's no worse (480, not 479.999996).
  a = await S.run({ ...bowl, goal: { label: "f", sense: "min", expr: M.parse("abs(x - 480) + abs(y - 2.5) + if(x > 900, 100, 0)") } }, env);
  check("evolutionary answers are tidy", a.status === "evolutionary" && val(a, "x") === 480 && val(a, "y") === 2.5, `${val(a, "x")} ${val(a, "y")}`);
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

  // Sparse models: a list of arcs whose From and To link to a list of nodes. Flow balance at every
  // node is "total of Flow across Arcs where the arc's To is this node" minus the same for From.
  const net = (extraRules, arcs) => ({
    schemaVersion: 1,
    things: [
      { id: "nodes", label: "Nodes", one: "Node", kind: "table", columns: [{ id: "net", label: "Net supply" }, { id: "handle", label: "Handling" }],
        rows: [{ key: "Plant", net: 100, handle: 1 }, { key: "DC1", net: 0, handle: 2 }, { key: "DC2", net: 0, handle: 0.5 }, { key: "S1", net: -40, handle: 0 }, { key: "S2", net: -60, handle: 0 }] },
      { id: "arcs", label: "Arcs", one: "Arc", kind: "table",
        columns: [{ id: "from", label: "From", kind: "link", links: "nodes" }, { id: "to", label: "To", kind: "link", links: "nodes" }, { id: "cost", label: "Cost" }, { id: "cap", label: "Capacity" }, { id: "mode", label: "Mode", kind: "text" }],
        rows: arcs || [
          { key: "a1", from: "Plant", to: "DC1", cost: 2, cap: 70, mode: "rail" }, { key: "a2", from: "Plant", to: "DC2", cost: 3, cap: 100, mode: "truck" },
          { key: "a3", from: "DC1", to: "S1", cost: 1, cap: 100, mode: "truck" }, { key: "a4", from: "DC1", to: "S2", cost: 4, cap: 100, mode: "truck" },
          { key: "a5", from: "DC2", to: "S2", cost: 1, cap: 100, mode: "truck" }, { key: "a6", from: "DC2", to: "S1", cost: 3, cap: 100, mode: "truck" }] },
    ],
    decisions: [{ id: "flow", label: "Flow", indexBy: ["arcs"], lower: 0, upper: M.parse("arcs.cap") }],
    results: [],
    rules: [{ id: "bal", label: "Balance", forEach: ["nodes"], lhs: M.parse("sum(arcs where arcs.from = this.nodes, flow) - sum(arcs where arcs.to = this.nodes, flow)"), op: "=", rhs: M.parse("nodes.net") }].concat(extraRules || []),
    goal: { label: "Cost", sense: "min", expr: M.parse("sum(arcs, (arcs.cost + nodes.handle[nodes via arcs.from]) * flow)") },
  });
  // By hand: S1's 40 go Plant→DC1→S1 at (2+1)+(1+2) = 6; S2's 60 go Plant→DC2→S2 at (3+1)+(1+0.5) = 5.5. Cost 240 + 330 = 570.
  a = await S.run(net(), env);
  check("network solves", a.ok && near(a.goal, 570), `${a.status} ${a.goal} ${JSON.stringify(a.errors || a.message || "")}`);
  check("network flows", near(val(a, "flow", ["a1"]), 40) && near(val(a, "flow", ["a5"]), 60) && near(val(a, "flow", ["a4"]), 0), JSON.stringify(a.decisions && a.decisions.flow));
  // A filtered rule: trucks carry at most 40 per arc. Now 60 to S2 can't all go DC2→S2 by truck.
  a = await S.run(net([{ id: "truck", label: "Truck limit", forEach: ["arcs"], where: M.parse('arcs.mode = "truck"'), lhs: M.parse("flow"), op: "<=", rhs: M.parse("40") }]), env);
  check("filtered rule rows", a.rows && a.rows.filter((r) => r.rule === "truck").length === 5, a.rows && a.rows.filter((r) => r.rule === "truck").length);
  check("filtered rule binds", a.ok && a.goal > 570 + 1e-6, `${a.status} ${a.goal}`);
  // count where, and errors in words.
  const cnt = clone(net());
  cnt.rules.push({ id: "c", label: "Count", lhs: M.parse('count(arcs where arcs.mode = "truck")'), op: "=", rhs: M.parse("5") });
  check("count where", M.expand(cnt).errors.length === 0, JSON.stringify(M.expand(cnt).errors));
  const badLink = net(null, [{ key: "a1", from: "Plant", to: "Nowhere", cost: 1, cap: 1, mode: "x" }]);
  check("bad link named", M.expand(badLink).errors.some((e) => /Nowhere/.test(e.text)), JSON.stringify(M.expand(badLink).errors));
  const nameAsNumber = clone(net());
  nameAsNumber.goal.expr = M.parse("sum(arcs, arcs.from)");
  check("name used as number", M.expand(nameAsNumber).errors.some((e) => /holds names/.test(e.text)), "");
  // Typed formulas round-trip the new pieces.
  const nm = net();
  for (const e of [nm.rules[0].lhs, nm.goal.expr]) {
    const s2 = M.formula(nm, e), p2 = M.parseNamed(nm, s2);
    check("typed where/via round trip", !p2.error && M.formula(nm, p2.tree) === s2, s2 + " → " + (p2.error || M.formula(nm, p2.tree)));
  }
  // Building blocks: a network written entirely by the "flow through a network" block.
  {
    const B = require(path.join(dir, "blocks.js"));
    const m = clone(net());
    m.decisions = []; m.rules = []; m.results = []; m.goal = { label: "Total cost", sense: "min", expr: { hole: true } };
    const taken = new Set(["nodes", "arcs"]);
    const uid = (l) => { let b = String(l).toLowerCase().replace(/[^a-z0-9]+/g, ""), id = b, k = 2; while (taken.has(id)) id = b + k++; taken.add(id); return id; };
    const r = B.build(m, B.list.find((b) => b.id === "network"), { flow: "Flow", arcs: "arcs", from: "from", to: "to", nodes: "nodes", net: "net", cost: "cost", cap: "cap" }, uid);
    check("block builds", r.added && r.added.length === 3, JSON.stringify(r));
    a = await S.run(m, env);
    check("block model solves", a.ok && near(a.goal, 360), `${a.status} ${a.goal} ${JSON.stringify(a.errors || "")}`);
    const bad = B.build(clone(m), B.list.find((b) => b.id === "network"), { flow: "F", arcs: "arcs", from: "cost", to: "to", nodes: "nodes", net: "net" }, uid);
    check("block checks its links", !!bad.error, JSON.stringify(bad));
    check("block wants every blank", !!B.build(clone(m), B.list.find((b) => b.id === "transport"), { ship: "S" }, uid).error, "");
    // Two models combined: their goals add.
    const both = clone(T.get("staffing").model);
    const note = B.merge(both, clone(T.get("transportation").model));
    a = await S.run(both, env);
    check("merged models", a.ok && near(a.goal, 13250 + 3100), `${a.status} ${a.goal} ${note.note} ${JSON.stringify(a.errors || "")}`);
    const twice = clone(T.get("transportation").model);
    B.merge(twice, clone(T.get("transportation").model));
    a = await S.run(twice, env);
    check("merging a model with itself renames", a.ok && near(a.goal, 6200), `${a.status} ${a.goal} ${JSON.stringify(a.errors || "")}`);
  }
  // The model as text: every template, the network, and one written by hand.
  {
    const X = require(path.join(dir, "text.js"));
    for (const m of T.list.map((t) => t.model).concat([net([{ id: "truck", label: "Truck limit", forEach: ["arcs"], where: M.parse('arcs.mode = "truck"'), lhs: M.parse("flow"), op: "<=", rhs: M.parse("40") }])])) {
      const txt = X.write(m), r = X.read(txt);
      check(`text round trip ${m.title || "network"}`, !r.error && X.write(r.model) === txt && (M.compileToLP(r.model).lp || "") === (M.compileToLP(m).lp || ""), r.error ? `line ${r.line}: ${r.error}` : "differs");
    }
    const hand = `title: Two plants, three markets
list Plants (one Plant)
  columns: Capacity [units], Cost [$/unit]
  East: 500, 4
  West: 400, 3
list Markets (one Market)
  columns: Demand [units]
  A: 300
  B: 250
  "C, north": 200
list Lanes (one Lane)
  columns: From -> Plants, To -> Markets, Freight [$/unit]
  L1: East, A, 2
  L2: East, B, 4
  L3: West, B, 1
  L4: West, "C, north", 2
  L5: East, "C, north", 5
decide Ship [units] for each Lanes: any amount
rule "Plant capacity" for each Plants: sum(Lanes where Lanes.From = this.Plants, Ship) <= Plants.Capacity
rule "Market demand" for each Markets: sum(Lanes where Lanes.To = this.Markets, Ship) >= Markets.Demand
result "Total cost" [$] = sum(Lanes, (Lanes.Freight + Plants.Cost[Plants via Lanes.From]) * Ship)
minimize "Total cost": Total_cost
`;
    const r = X.read(hand);
    check("hand-written text reads", !r.error, r.error ? `line ${r.line}: ${r.error}` : "");
    if (!r.error) {
      a = await S.run(r.model, env);
      // West (3 + freight) is cheapest where it reaches: B at 4 (250) and C at 5 (150 of its 400 left); East covers A at 6 (300) and C's other 50 at 9.
      check("hand-written text solves", a.ok && near(a.goal, 250 * 4 + 150 * 5 + 300 * 6 + 50 * 9), `${a.status} ${a.goal} ${JSON.stringify(a.errors || "")}`);
    }
    const oops = X.read("title: x\ndecide Ship: sometimes");
    check("text errors name the line", oops.error && oops.line === 2, JSON.stringify(oops));
  }
  // A giant sparse network: 2,000 nodes and 20,000 arcs.
  {
    const N = 2000, A = 20000, nodes = [], arcs = [];
    let sd = 11;
    const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    for (let i = 0; i < N; i++) nodes.push({ key: "n" + i, net: i === 0 ? 5000 : i < 51 ? -100 : 0, handle: 0 });
    for (let i = 0; i < A; i++) { const f = i < N - 1 ? i : Math.floor(rnd() * N), t = i < N - 1 ? i + 1 : Math.floor(rnd() * N); arcs.push({ key: "e" + i, from: "n" + f, to: "n" + t, cost: 1 + Math.round(rnd() * 9), cap: 1e6, mode: "truck" }); }
    const g = net(null, arcs);
    g.things[0].rows = nodes;
    const t1 = Date.now();
    a = await S.run(g, env);
    check("giant network solves", a.ok && a.status === "optimal" && a.size.vars === A, `${a.status} ${a.message || ""}`);
    console.log(`giant network: ${N} nodes, ${A} arcs, ${Date.now() - t1} ms`);
  }

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

  // The Excel export: every template becomes a workbook with Excel's Solver model in it. (Whether
  // Excel's Solver then gets the same answer is checked in Excel by plain-solver-excel-check.js.)
  {
    global.window = global;
    require(path.resolve(__dirname, "..", "aggregate-planning", "xlsx.js"));
    const XL = require(path.join(dir, "excel.js"));
    for (const t of T.list) {
      const x = XL.build(clone(t.model), null);
      const names = x.sheets ? Object.fromEntries(x.sheets[0].names) : {};
      const nCons = Number(names.solver_num);
      const ok = !x.error && names.solver_opt && names.solver_adj && nCons > 0 && names[`solver_lhs${nCons}`] && names[`solver_rel${nCons}`] && names[`solver_rhs${nCons}`] && !names[`solver_lhs${nCons + 1}`];
      check(`excel ${t.id} has a Solver model`, ok, x.error || JSON.stringify(names).slice(0, 200));
      const want = t.id === "pricing" ? "GRG Nonlinear" : "Simplex LP";
      check(`excel ${t.id} engine`, x.engine === want, x.engine);
      const zip = Buffer.from(await window.APXlsx.blob(x.sheets).arrayBuffer());
      check(`excel ${t.id} is a zip with the names`, zip.readUInt32LE(0) === 0x04034b50 && zip.includes(Buffer.from('definedName name="solver_opt" localSheetId="0" hidden="1"')), "");
    }
    // Plain Solver's answer goes into the decision cells.
    a = await S.run(clone(staffing), env);
    const x = XL.build(clone(staffing), a);
    const blue = x.sheets[0].rows.flat().filter((c) => c && c.s === "change").map((c) => c.v);
    check("excel starts from the answer", JSON.stringify(blue) === JSON.stringify([5, 400, 100, 0]), JSON.stringify(blue));
    // Long totals spill into helper cells instead of going past Excel's formula limit.
    const longOne = clone(big);
    longOne.goal.expr = M.parse("sum(w, sum(s, cost * ship * 2))");
    const xl2 = XL.build(longOne, null);
    const formulas = xl2.sheets ? xl2.sheets[0].rows.flat().filter((c) => c && c.f).map((c) => c.f) : [];
    check("excel long totals fit", !xl2.error && formulas.every((f) => f.length < 8192), xl2.error || Math.max(...formulas.map((f) => f.length)));
  }

  // Review, Bug 2: a 100 × 2,000 transportation model (200,000 decisions) took 71 s, 31 of them
  // writing the model out. Target: under 10 s in all; expansion alone in a couple of seconds.
  {
    const W2 = 100, S2 = 2000, wk2 = Array.from({ length: W2 }, (_, i) => "W" + i), sk2 = Array.from({ length: S2 }, (_, i) => "S" + i);
    const huge = clone(big);
    huge.things[0].rows = wk2.map((k) => ({ key: k, supply: 1500 }));
    huge.things[1].rows = sk2.map((k) => ({ key: k, demand: 50 + Math.floor(rnd() * 50) }));
    huge.things[2].values = Object.fromEntries(wk2.map((x) => [x, Object.fromEntries(sk2.map((y) => [y, 1 + Math.round(rnd() * 20)]))]));
    huge.options = { timeLimitSec: 60 };
    let t2 = Date.now();
    const E2 = M.expand(huge);
    const expandMs = Date.now() - t2;
    check("bug 2: expansion is fast", E2.vars.length === W2 * S2 && expandMs < 5000, `${expandMs} ms`);
    t2 = Date.now();
    a = await S.run(huge, env);
    const runMs = Date.now() - t2;
    check("bug 2: 200,000 decisions solve in under 10 s", a.ok && a.status === "optimal" && runMs < 10000, `${a.status} ${runMs} ms`);
    console.log(`bug 2 model: ${W2 * S2} variables, expand ${expandMs} ms, whole solve ${runMs} ms`);
  }

  console.log(`${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
