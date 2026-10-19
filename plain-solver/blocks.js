/* Building blocks: fill-in-the-blank sentences ("madlibs") that write a whole pattern of the model
 * at once: its decisions, rules, costs and its part of the goal, wired to your own lists and
 * columns. Whatever the blanks hold, the result is ordinary sentences you can then edit.
 *
 *   PSBlocks.list                    the blocks, in menu order
 *   PSBlocks.build(model, block, answers, uid) -> { added: [labels] } | { error }
 *
 * A block's `parts` are words and blanks. Blank kinds:
 *   list            one of your lists                     col    a column of the list in blank `of`
 *   grid            a grid over the lists in `over`       dec    a decision (optionally for each `of`)
 *   num             a number                              name   a name for something new
 * A blank with `optional` can be left at “none”. `type` narrows columns: number or link (to `to`).
 */
(function (root) {
  "use strict";
  const M = typeof module !== "undefined" && module.exports ? require("./model.js") : root.PSModel;
  const f = M.parse;

  // Adds a cost (or a value) to the goal, whichever way the goal points.
  function addToGoal(model, resultId, label, kind) {
    const g = model.goal || (model.goal = { label: "Total cost", sense: "min", expr: { hole: true } });
    const ref = { ref: resultId };
    if (!g.expr || g.expr.hole) {
      g.expr = ref;
      g.sense = kind === "value" ? "max" : "min";
      g.label = kind === "value" ? "Total value" : "Total cost";
      return;
    }
    if (g.sense === "target") return;
    const plus = (kind === "value") === (g.sense === "max");
    g.expr = { op: plus ? "add" : "sub", args: [g.expr, ref] };
  }
  const col = (model, list, id) => { const t = (model.things || []).find((x) => x.id === list); return t && (t.columns || []).find((c) => c.id === id); };
  const one = (model, list) => { const t = (model.things || []).find((x) => x.id === list); return t ? t.one || t.label : list; };

  const list = [
    {
      id: "network", title: "Flow through a network",
      blurb: "Goods move along a list of routes (arcs), each with a From and a To. Whatever goes into a place, minus what leaves, is what it uses up. Covers transshipment, multi-stop supply chains and any shape of network.",
      parts: ["Move", { b: "name", def: "Flow", key: "flow" }, "along each", { b: "list", key: "arcs", hint: "routes" }, "from its", { b: "col", key: "from", of: "arcs", type: "link" }, "to its", { b: "col", key: "to", of: "arcs", type: "link" },
        ". At each", { b: "list", key: "nodes", hint: "places" }, ", what goes out minus what comes in must equal its", { b: "col", key: "net", of: "nodes", type: "number", note: "supply (+) or demand (−)" },
        ". Each unit on a route costs its", { b: "col", key: "cost", of: "arcs", type: "number", optional: true }, ", and no route carries more than its", { b: "col", key: "cap", of: "arcs", type: "number", optional: true }, "."],
      build(model, a, uid) {
        if (col(model, a.arcs, a.from).links !== a.nodes || col(model, a.arcs, a.to).links !== a.nodes) return { error: `The From and To columns need to name ${one(model, a.nodes)} rows (set them to “names from ${one(model, a.nodes)}” in the list).` };
        const flow = uid(a.flow);
        model.decisions.push({ id: flow, label: a.flow, unit: "units", type: "continuous", lower: 0, upper: a.cap ? f(`${a.arcs}.${a.cap}`) : null, indexBy: [a.arcs] });
        model.rules.push({ id: uid("balance"), label: `Balance at each ${one(model, a.nodes).toLowerCase()}`, kind: "compare", forEach: [a.nodes],
          lhs: f(`sum(${a.arcs} where ${a.arcs}.${a.from} = this.${a.nodes}, ${flow}) - sum(${a.arcs} where ${a.arcs}.${a.to} = this.${a.nodes}, ${flow})`), op: "=", rhs: f(`${a.nodes}.${a.net}`) });
        const out = [a.flow, `Balance at each ${one(model, a.nodes).toLowerCase()}`];
        if (a.cost) {
          const r = uid(a.flow + " cost");
          model.results.push({ id: r, label: `${a.flow} cost`, unit: "$", expr: f(`sum(${a.arcs}, ${a.arcs}.${a.cost} * ${flow})`), indexBy: [] });
          addToGoal(model, r, `${a.flow} cost`, "cost");
          out.push(`${a.flow} cost (added to the goal)`);
        }
        return { added: out };
      },
    },
    {
      id: "transport", title: "Ship from sources to destinations",
      blurb: "Every source can ship to every destination at a cost per unit from a grid. Sources have a limit; destinations a need.",
      parts: ["Ship", { b: "name", def: "Units shipped", key: "ship" }, "from each", { b: "list", key: "src", hint: "warehouses" }, "to each", { b: "list", key: "dst", hint: "stores" },
        "at a cost per unit of", { b: "grid", key: "cost", over: ["src", "dst"], optional: true }, ". Each", { b: "ref", of: "src" }, "sends no more than its", { b: "col", key: "supply", of: "src", type: "number" },
        ", and each", { b: "ref", of: "dst" }, "gets at least its", { b: "col", key: "demand", of: "dst", type: "number" }, "."],
      build(model, a, uid) {
        const ship = uid(a.ship);
        model.decisions.push({ id: ship, label: a.ship, unit: "units", type: "continuous", lower: 0, upper: null, indexBy: [a.src, a.dst] });
        model.rules.push({ id: uid("supply"), label: `Each ${one(model, a.src).toLowerCase()}'s limit`, kind: "compare", forEach: [a.src], lhs: f(`sum(${a.dst}, ${ship})`), op: "<=", rhs: f(`${a.src}.${a.supply}`) });
        model.rules.push({ id: uid("demand"), label: `Each ${one(model, a.dst).toLowerCase()}'s need`, kind: "compare", forEach: [a.dst], lhs: f(`sum(${a.src}, ${ship})`), op: ">=", rhs: f(`${a.dst}.${a.demand}`) });
        const out = [a.ship, `Each ${one(model, a.src).toLowerCase()}'s limit`, `Each ${one(model, a.dst).toLowerCase()}'s need`];
        if (a.cost) {
          const r = uid(a.ship + " cost");
          model.results.push({ id: r, label: `${a.ship} cost`, unit: "$", expr: f(`sum(${a.src}, sum(${a.dst}, ${a.cost} * ${ship}))`), indexBy: [] });
          addToGoal(model, r, `${a.ship} cost`, "cost");
          out.push(`${a.ship} cost (added to the goal)`);
        }
        return { added: out };
      },
    },
    {
      id: "fixed", title: "Open or close, with a fixed cost",
      blurb: "Each place (plant, warehouse, machine…) costs a fixed amount if it's used at all, and can only handle anything once it's open.",
      parts: ["Each", { b: "list", key: "list", hint: "sites" }, "costs its", { b: "col", key: "fixed", of: "list", type: "number" }, "if it's open, and can handle up to its", { b: "col", key: "cap", of: "list", type: "number" },
        "of", { b: "dec", key: "use", of: "list", note: "a decision for each of them" }, ". At most", { b: "num", key: "most", def: "", optional: true }, "can be open."],
      build(model, a, uid) {
        const d = model.decisions.find((x) => x.id === a.use);
        const others = (d.indexBy || []).filter((s) => s !== a.list);
        const open = uid("open " + one(model, a.list));
        model.decisions.push({ id: open, label: `Open the ${one(model, a.list).toLowerCase()}`, unit: "", type: "binary", indexBy: [a.list] });
        const used = others.reduce((e, s) => `sum(${s}, ${e})`, a.use);
        model.rules.push({ id: uid("only open"), label: `Only open ${one(model, a.list).toLowerCase()}s are used`, kind: "compare", forEach: [a.list], lhs: f(used), op: "<=", rhs: f(`${a.list}.${a.cap} * ${open}`) });
        const out = [`Open the ${one(model, a.list).toLowerCase()}`, `Only open ${one(model, a.list).toLowerCase()}s are used`];
        if (a.most !== "" && a.most !== null && a.most !== undefined) { model.rules.push({ id: uid("most open"), label: "How many can be open", kind: "pick", decision: open, op: "<=", count: { const: Number(a.most) } }); out.push("How many can be open"); }
        const r = uid("fixed costs");
        model.results.push({ id: r, label: "Fixed costs", unit: "$", expr: f(`sum(${a.list}, ${a.list}.${a.fixed} * ${open})`), indexBy: [] });
        addToGoal(model, r, "Fixed costs", "cost");
        out.push("Fixed costs (added to the goal)");
        return { added: out };
      },
    },
    {
      id: "carry", title: "Carry stock from one period to the next",
      blurb: "Inventory (or cash, or water in a reservoir) at the end of each period is what was there before, plus what came in, minus what went out.",
      parts: ["Track", { b: "name", def: "Inventory", key: "inv" }, "at the end of each", { b: "list", key: "periods", hint: "months" }, ", starting from", { b: "num", key: "start", def: 0 },
        ", adding", { b: "dec", key: "in", of: "periods", note: "what comes in" }, "and taking away its", { b: "col", key: "out", of: "periods", type: "number", note: "what goes out" },
        ". Holding a unit for a period costs", { b: "num", key: "hold", def: 0, optional: true }, "."],
      build(model, a, uid) {
        const inv = uid(a.inv);
        model.decisions.push({ id: inv, label: a.inv, unit: "units", type: "continuous", lower: 0, upper: null, indexBy: [a.periods] });
        model.rules.push({ id: uid(a.inv + " balance"), label: `${a.inv} carries over`, kind: "compare", forEach: [a.periods], lhs: f(inv), op: "=",
          rhs: f(`${inv}[${a.periods}-1 or ${Number(a.start) || 0}] + ${a.in} - ${a.periods}.${a.out}`) });
        const out = [a.inv, `${a.inv} carries over`];
        if (Number(a.hold)) {
          const r = uid("holding cost");
          model.results.push({ id: r, label: "Holding cost", unit: "$", expr: f(`${Number(a.hold)} * sum(${a.periods}, ${inv})`), indexBy: [] });
          addToGoal(model, r, "Holding cost", "cost");
          out.push("Holding cost (added to the goal)");
        }
        return { added: out };
      },
    },
    {
      id: "cover", title: "Mix ingredients to meet requirements",
      blurb: "Choose amounts of each ingredient so every requirement (nutrient, spec, skill…) is met, with how much each ingredient gives from a grid.",
      parts: ["Choose", { b: "name", def: "Amount", key: "amt" }, "of each", { b: "list", key: "items", hint: "ingredients" }, "so that for each", { b: "list", key: "reqs", hint: "nutrients" },
        ", the total of", { b: "grid", key: "gives", over: ["items", "reqs"] }, "× amount is at least its", { b: "col", key: "min", of: "reqs", type: "number" },
        ". Each unit costs its", { b: "col", key: "cost", of: "items", type: "number", optional: true }, "."],
      build(model, a, uid) {
        const amt = uid(a.amt);
        model.decisions.push({ id: amt, label: a.amt, unit: "", type: "continuous", lower: 0, upper: null, indexBy: [a.items] });
        model.rules.push({ id: uid("requirement"), label: `Meet each ${one(model, a.reqs).toLowerCase()}`, kind: "compare", forEach: [a.reqs], lhs: f(`sum(${a.items}, ${a.gives} * ${amt})`), op: ">=", rhs: f(`${a.reqs}.${a.min}`) });
        const out = [a.amt, `Meet each ${one(model, a.reqs).toLowerCase()}`];
        if (a.cost) {
          const r = uid("ingredient cost");
          model.results.push({ id: r, label: "Ingredient cost", unit: "$", expr: f(`sum(${a.items}, ${a.items}.${a.cost} * ${amt})`), indexBy: [] });
          addToGoal(model, r, "Ingredient cost", "cost");
          out.push("Ingredient cost (added to the goal)");
        }
        return { added: out };
      },
    },
    {
      id: "assign", title: "Assign each one to exactly one",
      blurb: "Give each person (job, truck…) exactly one of something else, with a cost for every pair, and an optional limit on how many each can take.",
      parts: ["Give each", { b: "list", key: "a", hint: "people" }, "exactly one", { b: "list", key: "b", hint: "shifts" }, "at a cost of", { b: "grid", key: "cost", over: ["a", "b"] },
        ". Each", { b: "ref", of: "b" }, "takes at most", { b: "num", key: "cap", def: 1 }, "."],
      build(model, a, uid) {
        const x = uid("assigned");
        model.decisions.push({ id: x, label: "Assigned", unit: "", type: "binary", indexBy: [a.a, a.b] });
        model.rules.push({ id: uid("one each"), label: `Each ${one(model, a.a).toLowerCase()} gets one`, kind: "compare", forEach: [a.a], lhs: f(`sum(${a.b}, ${x})`), op: "=", rhs: f("1") });
        model.rules.push({ id: uid("takes at most"), label: `Each ${one(model, a.b).toLowerCase()} takes at most ${Number(a.cap) || 1}`, kind: "compare", forEach: [a.b], lhs: f(`sum(${a.a}, ${x})`), op: "<=", rhs: { const: Number(a.cap) || 1 } });
        const r = uid("assignment cost");
        model.results.push({ id: r, label: "Assignment cost", unit: "$", expr: f(`sum(${a.a}, sum(${a.b}, ${a.cost} * ${x}))`), indexBy: [] });
        addToGoal(model, r, "Assignment cost", "cost");
        return { added: ["Assigned", `Each ${one(model, a.a).toLowerCase()} gets one`, `Each ${one(model, a.b).toLowerCase()} takes at most ${Number(a.cap) || 1}`, "Assignment cost (added to the goal)"] };
      },
    },
    {
      id: "select", title: "Pick the best set of items",
      blurb: "Yes or no on each item, each with a value and a size, within a budget or capacity. Projects, loads, ads, investments.",
      parts: ["Pick which", { b: "list", key: "items", hint: "projects" }, "to take. Each is worth its", { b: "col", key: "value", of: "items", type: "number" }, "and uses its",
        { b: "col", key: "size", of: "items", type: "number" }, ", and the total used can't go over", { b: "num", key: "cap", def: 100 }, "."],
      build(model, a, uid) {
        const x = uid("take");
        model.decisions.push({ id: x, label: `Take the ${one(model, a.items).toLowerCase()}`, unit: "", type: "binary", indexBy: [a.items] });
        model.rules.push({ id: uid("capacity"), label: "Within the limit", kind: "compare", lhs: f(`sum(${a.items}, ${a.items}.${a.size} * ${x})`), op: "<=", rhs: { const: Number(a.cap) || 0 } });
        const r = uid("value taken");
        model.results.push({ id: r, label: "Value taken", unit: "", expr: f(`sum(${a.items}, ${a.items}.${a.value} * ${x})`), indexBy: [] });
        addToGoal(model, r, "Value taken", "value");
        return { added: [`Take the ${one(model, a.items).toLowerCase()}`, "Within the limit", "Value taken (added to the goal)"] };
      },
    },
  ];

  // Fills a block's blanks and builds it; checks every non-optional blank first.
  function build(model, block, answers, uid) {
    for (const p of block.parts) if (p.b && p.key && !p.optional && (answers[p.key] === undefined || answers[p.key] === null || answers[p.key] === "")) return { error: "Fill in every blank (the ones marked optional can stay at “none”)." };
    model.decisions = model.decisions || []; model.results = model.results || []; model.rules = model.rules || [];
    return block.build(model, answers, uid);
  }

  /* ---------- combining two models ---------- */
  // Adds another model's lists, data, decisions, results and rules to this one, renaming any id
  // that clashes, and adds its goal to this goal (subtracting it if the two point opposite ways).
  function merge(model, other) {
    other = JSON.parse(JSON.stringify(other));
    const taken = new Set();
    for (const t of model.things || []) taken.add(t.id);
    for (const k of ["decisions", "results", "rules"]) for (const x of model[k] || []) taken.add(x.id);
    const ren = {};
    const fresh = (id) => { if (!taken.has(id)) { taken.add(id); return id; } let k = 2; while (taken.has(id + k)) k++; taken.add(id + k); return id + k; };
    for (const t of other.things || []) ren[t.id] = fresh(t.id);
    for (const k of ["decisions", "results", "rules"]) for (const x of other[k] || []) ren[x.id] = fresh(x.id);
    const R = (id) => (id && ren[id] !== undefined ? ren[id] : id);
    const Rref = (ref) => { const [a, b] = String(ref).split("."); return b === undefined ? R(a) : R(a) + "." + b; };
    const walk = (n) => {
      if (!n || typeof n !== "object") return;
      if (n.ref !== undefined) n.ref = Rref(n.ref);
      if (n.at) { const at = {}; for (const [s, v] of Object.entries(n.at)) at[R(s)] = v && v.via ? { via: Rref(v.via) } : v; n.at = at; }
      if (n.over !== undefined) n.over = Array.isArray(n.over) ? n.over.map(R) : R(n.over);
      if (n.key !== undefined && !n.op) n.key = R(n.key);
      if (n.op === "lookup") n.table = R(n.table);
      (n.args || []).forEach(walk); walk(n.body); walk(n.where); walk(n.otherwise);
    };
    for (const t of other.things || []) {
      t.id = R(t.id);
      if (t.over) t.over = t.over.map(R);
      for (const c of t.columns || []) if (c.links) c.links = R(c.links);
    }
    for (const d of other.decisions || []) { d.id = R(d.id); d.indexBy = (d.indexBy || []).map(R); if (d.lower && typeof d.lower === "object") walk(d.lower); if (d.upper && typeof d.upper === "object") walk(d.upper); }
    for (const r of other.results || []) { r.id = R(r.id); r.indexBy = (r.indexBy || []).map(R); walk(r.expr); }
    for (const r of other.rules || []) { r.id = R(r.id); r.forEach = (r.forEach || []).map(R); if (r.decision) r.decision = R(r.decision); walk(r.lhs); walk(r.rhs); walk(r.rhs2); walk(r.count); walk(r.where); }
    model.things = (model.things || []).concat(other.things || []);
    model.decisions = (model.decisions || []).concat(other.decisions || []);
    model.results = (model.results || []).concat(other.results || []);
    model.rules = (model.rules || []).concat(other.rules || []);
    const g = other.goal;
    let note = "";
    if (g && g.expr && !g.expr.hole) {
      walk(g.expr);
      if (g.sense === "target") note = "Its goal was a target, so it wasn't added; turn it into a rule if you need it.";
      else {
        const rid = fresh("otherGoal");
        model.results.push({ id: rid, label: g.label || "Other goal", unit: "", expr: g.expr, indexBy: [] });
        addToGoal(model, rid, g.label, g.sense === "max" ? "value" : "cost");
        note = `Its goal, “${g.label}”, is now a result added to this goal.`;
      }
    }
    return { note };
  }

  const api = { list, build, merge, addToGoal };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PSBlocks = api;
})(typeof self !== "undefined" ? self : this);
