/* Plain Solver's model: the one JSON format every part of the page reads and writes, and
 * everything that turns it into something a solver can take. No DOM; runs in Node too.
 *
 *   index(model)          the model's parts by id
 *   parse(text)           a formula ("workers.rate * (regular + overtime)") -> expression tree.
 *                         Only the templates and the tests use it; people build sentences from chips.
 *   expand(model)         every "for each" and "total of" written out: variables, rows and a goal
 *                         as scalar trees over variable numbers, with constants folded
 *   classify(E)           lp | mip | qp | nlp | nonsmooth, and the linear form when there is one
 *   writeLP(E, L)         CPLEX LP text for HiGHS, with safe names (v1, c1) and a map back to labels
 *   compileToLP(model)    all of the above in one call
 *   numeric(E, kind)      the same problem as functions of a vector, for the nonlinear engines
 *   evaluate / gradient   value and reverse-mode gradient of a scalar tree
 *   validate(model)       plain-English cards: errors, warnings and notes
 *   describe, say, math   the model in words, an expression in words, the model in standard notation
 *   fmt(value, unit)      a number the way the page prints it
 *
 * The model (schemaVersion 1):
 *   things     single: { id, label, kind: "single", properties: [{ id, label, value, unit, blank, prompt }] }
 *              table:  { id, label, one, kind: "table", columns: [{ id, label, unit }], rows: [{ key, <col>: n }] }
 *                      A table's rows are also a set: decisions, results and rules can be "for each" of them.
 *              grid:   { id, label, kind: "grid", over: [setA, setB], unit, values: { rowKey: { colKey: n } } }
 *   decisions  { id, label, unit, type: continuous|integer|binary, lower, upper, indexBy: [sets], disabled }
 *              lower/upper: a number, null for no limit, or an expression of data (per row when indexed).
 *              A missing lower is 0. A turned-off decision counts as 0 wherever it is used.
 *   results    { id, label, unit, expr, indexBy: [sets], disabled }   named expressions, used by reference
 *   rules      { id, label, kind: "compare", lhs, op: ">="|"<="|"="|"between", rhs, rhs2, forEach: [sets] }
 *              { id, label, kind: "pick", decision, op, count }            choose N of a yes-or-no decision
 *              { id, label, kind: "different", decision, sets: [A, B], fillAll }  each A gets a different B
 *   goal       { label, sense: min|max|target, expr, targetValue, close }
 *   options    { engine: auto|linear|nonlinear|evolutionary, timeLimitSec, mipGap, multistart }
 *
 * Expressions: { const, unit } · { ref, at, otherwise } · { op, args } · { op: "sum"|"avg", over, body }
 *   · { op: "count", over } · { op: "lookup", table, key, value, args: [x] } · { hole: true } (an empty slot).
 *   ref is "thing.property", "table.column", a grid, a decision or a result. at pins or shifts a set:
 *   { stores: "Store A" } or { months: { shift: -1 } }; otherwise is used when a shift runs off the table.
 *   ops: add sub mul div neg paren pow sqrt abs max min if exp log ge le gt lt eq.
 */
(function (root) {
  "use strict";
  const SCHEMA = 1;
  const INF = Infinity;
  const SEP = "\u0001";

  /* ---------- the model's parts ---------- */
  function index(model) {
    const ix = { model, things: {}, props: {}, sets: {}, grids: {}, decisions: {}, named: {} };
    for (const t of model.things || []) {
      ix.things[t.id] = t;
      if (t.kind === "table") {
        ix.sets[t.id] = t;
        for (const c of t.columns || []) ix.props[t.id + "." + c.id] = { kind: "col", thing: t, col: c };
      } else if (t.kind === "grid") ix.grids[t.id] = t;
      else for (const p of t.properties || []) ix.props[t.id + "." + p.id] = { kind: "prop", thing: t, prop: p };
    }
    for (const d of model.decisions || []) ix.decisions[d.id] = d;
    for (const r of model.results || []) ix.named[r.id] = r;
    return ix;
  }
  // What a reference points at, and the sets it is indexed by.
  function refInfo(ix, id) {
    if (ix.props[id]) { const p = ix.props[id]; return p.kind === "col" ? { ...p, sets: [p.thing.id], label: p.col.label, unit: p.col.unit } : { ...p, sets: [], label: p.prop.label, unit: p.prop.unit }; }
    if (ix.grids[id]) return { kind: "grid", item: ix.grids[id], sets: ix.grids[id].over || [], label: ix.grids[id].label, unit: ix.grids[id].unit };
    if (ix.decisions[id]) return { kind: "decision", item: ix.decisions[id], sets: ix.decisions[id].indexBy || [], label: ix.decisions[id].label, unit: ix.decisions[id].unit };
    if (ix.named[id]) return { kind: "result", item: ix.named[id], sets: ix.named[id].indexBy || [], label: ix.named[id].label, unit: ix.named[id].unit };
    return null;
  }
  // A list's row names, and where each one sits, worked out once per model (big lists are read often).
  const keysOf = (ix, s) => { ix._keys = ix._keys || {}; return ix._keys[s] || (ix._keys[s] = ix.sets[s] ? ix.sets[s].rows.map((r) => String(r.key)) : []); };
  const keyPos = (ix, s) => { ix._pos = ix._pos || {}; return ix._pos[s] || (ix._pos[s] = new Map(keysOf(ix, s).map((k, i) => [k, i]))); };
  const colOf = (ix, ref) => { const p = ix.props[ref]; return p && p.kind === "col" ? p.col : null; };
  const isNumCol = (c) => !c.kind || c.kind === "number";
  const setLabel = (ix, s) => (ix.sets[s] ? ix.sets[s].label : s);
  const setOne = (ix, s) => (ix.sets[s] ? ix.sets[s].one || ix.sets[s].label : s);

  /* ---------- a small formula language, for templates and tests ---------- */
  const FUNCS = { sqrt: 1, abs: 1, exp: 1, log: 1, max: 2, min: 2, if: 3 };
  function parse(src) {
    let i = 0;
    const s = String(src);
    const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    const peek = (t) => { ws(); return s.startsWith(t, i); };
    const eat = (t) => { if (!peek(t)) throw new Error(`Expected "${t}" at ${i} in: ${s}`); i += t.length; };
    const ident = () => { ws(); const m = /^[A-Za-z_][\w.#]*/.exec(s.slice(i)); if (!m) throw new Error(`Expected a name at ${i} in: ${s}`); i += m[0].length; return m[0]; };
    const kw = (w) => { ws(); const m = new RegExp("^" + w + "\\b").exec(s.slice(i)); if (m) i += w.length; return !!m; };
    // Conditions: or of ands of (not) comparisons. "=" and "==" both mean equals.
    function expr() { let a = conj(); while (kw("or")) a = { op: "or", args: [a, conj()] }; return a; }
    function conj() { let a = neg(); while (kw("and")) a = { op: "and", args: [a, neg()] }; return a; }
    function neg() { return kw("not") ? { op: "not", args: [neg()] } : cmp(); }
    function cmp() {
      const a = sum();
      for (const [t, op] of [[">=", "ge"], ["<=", "le"], ["==", "eq"], ["!=", "ne"], ["<>", "ne"], ["=", "eq"], [">", "gt"], ["<", "lt"]]) if (peek(t)) { eat(t); return { op, args: [a, sum()] }; }
      return a;
    }
    function sum() {
      let a = prod();
      for (;;) {
        if (peek("+")) { eat("+"); a = { op: "add", args: [a, prod()] }; } else if (peek("-")) { eat("-"); a = { op: "sub", args: [a, prod()] }; } else return a;
      }
    }
    function prod() {
      let a = unary();
      for (;;) {
        if (peek("*")) { eat("*"); a = { op: "mul", args: [a, unary()] }; } else if (peek("/")) { eat("/"); a = { op: "div", args: [a, unary()] }; } else return a;
      }
    }
    function unary() { if (peek("-")) { eat("-"); return { op: "neg", args: [unary()] }; } return power(); }
    function power() { const a = atom(); if (peek("^")) { eat("^"); return { op: "pow", args: [a, unary()] }; } return a; }
    function atom() {
      ws();
      const num = /^\d+(\.\d+)?([eE][-+]?\d+)?/.exec(s.slice(i));
      if (num) { i += num[0].length; return { const: Number(num[0]) }; }
      if (peek("(")) { eat("("); const e = expr(); eat(")"); return { op: "paren", args: [e] }; }
      if (peek('"')) { const end = s.indexOf('"', i + 1); if (end < 0) throw new Error(`Unclosed quote in: ${s}`); const t = s.slice(i + 1, end); i = end + 1; return { text: t }; }
      const name = ident();
      if (name.startsWith("this.")) return { key: name.slice(5) };
      if (peek("(")) {
        eat("(");
        if (name === "sum" || name === "avg") { const over = ident(); const where = kw("where") ? expr() : null; eat(","); const body = expr(); eat(")"); return { op: name, over, ...(where ? { where } : {}), body }; }
        if (name === "count") { const over = ident(); const where = kw("where") ? expr() : null; eat(")"); return { op: "count", over, ...(where ? { where } : {}) }; }
        if (name === "lookup") { const k = ident().split("."), v = ident().split("."); eat(","); const x = expr(); eat(")"); return { op: "lookup", table: k[0], key: k[1], value: v[1], args: [x] }; }
        if (!FUNCS[name]) throw new Error(`Unknown function ${name}`);
        const args = [expr()];
        while (peek(",")) { eat(","); args.push(expr()); }
        eat(")");
        return { op: name, args };
      }
      const node = { ref: name };
      if (peek("[")) {
        eat("[");
        const close = s.indexOf("]", i);
        let inner = s.slice(i, close);
        i = close + 1;
        const orAt = inner.indexOf(" or ");
        if (orAt >= 0) { node.otherwise = parse(inner.slice(orAt + 4)); inner = inner.slice(0, orAt); }
        node.at = {};
        for (const part of inner.split(",")) {
          const p = part.trim();
          const eq = p.indexOf("=");
          const via = /^([\w]+)\s+via\s+([\w.]+)$/.exec(p);
          if (via) node.at[via[1]] = { via: via[2] };
          else if (eq > 0) node.at[p.slice(0, eq).trim()] = p.slice(eq + 1).trim();
          else { const m = /^([\w]+)\s*([-+])\s*(\d+)$/.exec(p); if (!m) throw new Error(`Bad index ${p}`); node.at[m[1]] = { shift: (m[2] === "-" ? -1 : 1) * Number(m[3]) }; }
        }
      }
      return node;
    }
    const out = expr();
    ws();
    if (i < s.length) throw new Error(`Unexpected "${s.slice(i)}" in: ${s}`);
    return out;
  }

  /* ---------- typed formulas: names people can type ---------- */
  // Every reference gets a name from its label, spaces as underscores: Units_made, Workers.units_per_hour,
  // Stores.Demand. A name that clashes, or has no letters to spare, falls back to its id.
  const toName = (s) => { let n = String(s || "").trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, ""); if (!n || /^\d/.test(n)) n = "_" + n; return n; };
  function names(model) {
    const byId = {}, used = new Set();
    const claim = (id, n) => { if (!n || n === "_" || used.has(n.toLowerCase())) n = id; used.add(n.toLowerCase()); byId[id] = n; };
    for (const t of model.things || []) claim(t.id, toName(t.label));
    for (const t of model.things || []) {
      if (t.kind === "single") for (const p of t.properties || []) byId[t.id + "." + p.id] = byId[t.id] + "." + toName(p.label);
      if (t.kind === "table") for (const c of t.columns || []) byId[t.id + "." + c.id] = byId[t.id] + "." + toName(c.label);
      if (t.kind === "table") for (const c of t.columns || []) byId[t.id + "#col#" + c.id] = toName(c.label);
    }
    for (const d of model.decisions || []) claim(d.id, toName(d.label));
    for (const r of model.results || []) claim(r.id, toName(r.label));
    const toId = {};
    for (const [id, n] of Object.entries(byId)) if (!id.includes("#col#")) toId[n.toLowerCase()] = id;
    return { byId, toId };
  }
  function formula(model, n, N) {
    N = N || names(model);
    const F = (x, p) => { const [s, q] = fm(x); return q < p ? "(" + s + ")" : s; };
    const nm = (id) => N.byId[id] || id;
    const col = (t, c) => N.byId[t + "#col#" + c] || c;
    function fm(x) {
      // [text, precedence]: 4 atom, 3 power, 2 product, 1 sum, 0 comparison
      if (!x || x.hole) return ["?", 4];
      if (x.const !== undefined) return [x.const === null ? "?" : String(x.const), x.const < 0 ? 1 : 4];
      if (x.text !== undefined) return ['"' + x.text + '"', 4];
      if (x.key !== undefined && !x.op) return ["this." + nm(x.key), 4];
      if (x.ref !== undefined) {
        let s = nm(x.ref);
        if (x.at && Object.keys(x.at).length) {
          const parts = Object.entries(x.at).map(([set, a]) => (typeof a === "string" ? `${nm(set)}=${a}` : a.via ? `${nm(set)} via ${nm(a.via)}` : `${nm(set)}${a.shift < 0 ? "-" : "+"}${Math.abs(a.shift)}`));
          s += "[" + parts.join(", ") + (x.otherwise ? " or " + formula(model, x.otherwise, N) : "") + "]";
        }
        return [s, 4];
      }
      const a = x.args || [];
      switch (x.op) {
        case "add": return [F(a[0], 1) + " + " + F(a[1], 2), 1];
        case "sub": return [F(a[0], 1) + " - " + F(a[1], 2), 1];
        case "mul": return [F(a[0], 2) + " * " + F(a[1], 3), 2];
        case "div": return [F(a[0], 2) + " / " + F(a[1], 3), 2];
        case "neg": return ["-" + F(a[0], 3), 2];
        case "pow": return [F(a[0], 4) + "^" + F(a[1], 4), 3];
        case "paren": return ["(" + formula(model, a[0], N) + ")", 4];
        case "sum": case "avg": return [`${x.op}(${[].concat(x.over).map(nm).join(", ")}${x.where ? " where " + formula(model, x.where, N) : ""}, ${formula(model, x.body, N)})`, 4];
        case "count": return [`count(${[].concat(x.over).map(nm).join(", ")}${x.where ? " where " + formula(model, x.where, N) : ""})`, 4];
        case "and": return [F(a[0], -1) + " and " + F(a[1], -1), -1];
        case "or": return [F(a[0], -2) + " or " + F(a[1], -1), -2];
        case "not": return ["not " + F(a[0], 0), -1];
        case "lookup": return [`lookup(${nm(x.table)}.${col(x.table, x.key)}, ${nm(x.table)}.${col(x.table, x.value)}, ${formula(model, a[0], N)})`, 4];
        case "ge": case "le": case "gt": case "lt": case "eq": case "ne": return [F(a[0], 1) + " " + { ge: ">=", le: "<=", gt: ">", lt: "<", eq: "=", ne: "!=" }[x.op] + " " + F(a[1], 1), 0];
        default: return [`${x.op}(${a.map((y) => formula(model, y, N)).join(", ")})`, 4];
      }
    }
    return fm(n)[0];
  }
  // A typed formula -> an expression tree with ids, or { error }.
  function parseNamed(model, text, N) {
    N = N || names(model);
    let tree;
    try { tree = parse(text); } catch (e) { return { error: e.message.replace(/ in: .*$/, "") }; }
    const ix = index(model);
    const id = (n) => N.toId[String(n).toLowerCase()] || (refInfo(ix, n) || ix.sets[n] ? n : null);
    const colId = (tableId, name) => { const t = ix.sets[tableId]; const c = t && (t.columns || []).find((c) => names(model).byId[tableId + "#col#" + c.id].toLowerCase() === String(name).toLowerCase() || c.id === name); return c ? c.id : null; };
    let error = null;
    const fix = (n) => {
      if (!n || typeof n !== "object" || error) return;
      if (n.ref !== undefined) {
        const r = id(n.ref);
        if (!r || !refInfo(ix, r)) { error = `“${n.ref}” isn't a name here.`; return; }
        n.ref = r;
        if (n.at) {
          const at = {};
          for (const [k, v] of Object.entries(n.at)) {
            const s = id(k);
            if (!s || !ix.sets[s]) { error = `“${k}” isn't a list.`; return; }
            if (v && v.via) { const c = id(v.via); if (!c || !colOf(ix, c)) { error = `“${v.via}” isn't a column.`; return; } at[s] = { via: c }; }
            else at[s] = v;
          }
          n.at = at;
        }
        fix(n.otherwise);
      }
      if (n.over !== undefined) {
        const s = id(n.over);
        if (!s || !ix.sets[s]) { error = `“${n.over}” isn't a list.`; return; }
        n.over = s;
      }
      if (n.key !== undefined && !n.op) {
        const s = id(n.key);
        if (!s || !ix.sets[s]) { error = `“${n.key}” isn't a list.`; return; }
        n.key = s;
      }
      fix(n.where);
      if (n.op === "lookup") {
        const t = id(n.table);
        if (!t || !ix.sets[t]) { error = `“${n.table}” isn't a list.`; return; }
        // parse() split "Table.Column" at the first dot; the column names come back here.
        n.key = colId(t, n.key); n.value = colId(t, n.value); n.table = t;
        if (!n.key || !n.value) { error = "The look-up names a column that isn't in that list."; return; }
      }
      (n.args || []).forEach(fix);
      fix(n.body);
    };
    fix(tree);
    return error ? { error } : { tree };
  }

  /* ---------- formulas the way people say them ---------- */
  // "wood per chair times chairs to make plus 20", "total of cost × units to ship across routes":
  // the names people gave things, with spaces, and operators as words or symbols. Each run of words
  // between operators has to match one name (ignoring case, "the" and plurals); numbers are numbers.
  // Falls back to the underscore form (parseNamed) when that reads it and this doesn't.
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9$%.\s]/g, " ").split(/\s+/).filter((w) => w && w !== "the" && w !== "a" && w !== "an")
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)).join(" ");
  function plainIndex(model) {
    const ix = index(model), out = new Map();
    const add = (key, id) => { const k = norm(key); if (!k) return; if (!out.has(k)) out.set(k, new Set()); out.get(k).add(id); };
    for (const t of model.things || []) {
      if (t.kind === "single") for (const p of t.properties || []) { add(p.label, t.id + "." + p.id); add(t.label + " " + p.label, t.id + "." + p.id); }
      if (t.kind === "table") for (const c of t.columns || []) if (!c.kind || c.kind === "number") { add(c.label, t.id + "." + c.id); add((t.one || t.label) + " " + c.label, t.id + "." + c.id); add(t.label + " " + c.label, t.id + "." + c.id); }
      if (t.kind === "grid") add(t.label, t.id);
    }
    for (const d of model.decisions || []) add(d.label, d.id);
    for (const r of model.results || []) add(r.label, r.id);
    const lists = new Map();
    for (const t of model.things || []) if (t.kind === "table") { lists.set(norm(t.label), t.id); lists.set(norm(t.one || t.label), t.id); lists.set(norm("each " + (t.one || t.label)), t.id); }
    return { ix, names: out, lists };
  }
  function parsePlain(model, text) {
    const P = plainIndex(model);
    let s = " " + String(text) + " ";
    s = s.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-")
      .replace(/\s+divided by\s+/gi, " / ").replace(/\s+times\s+/gi, " * ").replace(/\s+plus\s+/gi, " + ").replace(/\s+minus\s+/gi, " - ")
      .replace(/\s+squared\b/gi, "^2").replace(/\s+to the power of\s+/gi, "^");
    // "total of X across Stores" / "sum of X over Stores" / "average of X across Stores"
    let guard = 0, m;
    const tot = /\b(total|sum|average)\s+of\s+(.+?)\s+(?:across|over|for each|for every|for all)\s+([A-Za-z][\w ]*?)(?=\s*(?:$|[)+\-*/,^]|\s(?:and|plus|minus)\b))/i;
    while ((m = tot.exec(s)) && guard++ < 20) {
      const list = P.lists.get(norm(m[3]));
      if (!list) return { error: `“${m[3].trim()}” isn't one of your lists.` };
      s = s.slice(0, m.index) + `${/^av/i.test(m[1]) ? "avg" : "sum"}(${list}, ${m[2]})` + s.slice(m.index + m[0].length);
    }
    // Swap every run of words for the id it names.
    const parts = s.split(/([+\-*/^(),])/);
    let unknown = null, ambiguous = null;
    const out = parts.map((part) => {
      if (/^[+\-*/^(),]$/.test(part) || !part.trim()) return part;
      const w = part.trim();
      if (/^(sum|avg)$/i.test(w) || P.lists.has(norm(w)) && /^[a-z]\w*$/.test(w) && index(model).sets[w]) return part;
      if (/^\$?\d[\d,]*(\.\d+)?%?$/.test(w)) { const v = Number(w.replace(/[$,%]/g, "")) / (w.endsWith("%") ? 100 : 1); return " " + v + " "; }
      if (index(model).sets[w]) return part;
      const ids = P.names.get(norm(w));
      if (!ids) { unknown = unknown || w; return part; }
      if (ids.size > 1) { ambiguous = ambiguous || w; return part; }
      return " " + [...ids][0] + " ";
    });
    if (unknown) return { error: `“${unknown}” isn't something in your model. Use the names you gave things (or pick from the menus).` };
    if (ambiguous) return { error: `“${ambiguous}” could mean more than one thing. Add the name of its group or list to say which.` };
    try { return { tree: parse(out.join("")) }; }
    catch (e) { return { error: "That doesn't read as a formula yet. Use plus, minus, times, divided by (or + − × ÷) between the names and numbers." }; }
  }
  // Reads either way of writing: the way people say it, or the underscore names of power mode.
  function readFormula(model, text, N) {
    const a = parsePlain(model, text);
    if (!a.error) return a;
    const b = parseNamed(model, text, N);
    return b.error ? a : b;
  }

  /* ---------- scalar trees ---------- */
  // { c } a constant · { v } a variable number · { op, a: [...] } · lookup carries keys and vals.
  const C = (c) => ({ c });
  const isC = (n) => n.c !== undefined;
  function apply(op, x, n) {
    switch (op) {
      case "add": return x.reduce((a, b) => a + b, 0);
      case "mul": return x[0] * x[1];
      case "div": return x[0] / x[1];
      case "pow": return Math.pow(x[0], x[1]);
      case "sqrt": return Math.sqrt(x[0]);
      case "abs": return Math.abs(x[0]);
      case "max": return Math.max(...x);
      case "min": return Math.min(...x);
      case "exp": return Math.exp(x[0]);
      case "log": return Math.log(x[0]);
      case "if": return Math.abs(x[0]) > 1e-9 ? x[1] : x[2];
      case "ge": return x[0] >= x[1] - 1e-9 ? 1 : 0;
      case "le": return x[0] <= x[1] + 1e-9 ? 1 : 0;
      case "gt": return x[0] > x[1] ? 1 : 0;
      case "lt": return x[0] < x[1] ? 1 : 0;
      case "eq": return Math.abs(x[0] - x[1]) <= 1e-9 * Math.max(1, Math.abs(x[1])) ? 1 : 0;
      case "lookup": { let j = 0; for (let k = 0; k < n.keys.length; k++) if (n.keys[k] <= x[0]) j = k; return n.vals[j]; }
    }
    throw new Error("Unknown operation " + op);
  }
  function add(terms) {
    const out = [];
    let k = 0;
    for (const t of terms) {
      if (isC(t)) k += t.c;
      else if (t.op === "add") for (const u of t.a) { if (isC(u)) k += u.c; else out.push(u); }
      else out.push(t);
    }
    if (!out.length) return C(k);
    if (k !== 0) out.push(C(k));
    return out.length === 1 ? out[0] : { op: "add", a: out };
  }
  function mul(a, b) {
    if (isC(a) && isC(b)) return C(a.c * b.c);
    if ((isC(a) && a.c === 0) || (isC(b) && b.c === 0)) return C(0);
    if (isC(a) && a.c === 1) return b;
    if (isC(b) && b.c === 1) return a;
    if (isC(b)) [a, b] = [b, a];
    if (isC(a) && b.op === "mul" && isC(b.a[0])) return mul(C(a.c * b.a[0].c), b.a[1]);
    if (isC(a) && b.op === "add") return add(b.a.map((t) => mul(a, t)));
    return { op: "mul", a: [a, b] };
  }

  /* ---------- expand: every "for each" and "total of" written out ---------- */
  function combos(ix, sets) {
    let out = [[]];
    for (const s of sets) {
      const n = keysOf(ix, s).length;
      const next = [];
      for (const c of out) for (let r = 0; r < n; r++) next.push(c.concat(r));
      out = next;
    }
    return out;
  }

  function expand(model) {
    const ix = index(model);
    const vars = [], varAt = new Map(), rows = [], errors = [], notes = [];
    const memo = new Map(), stack = [];
    let where = null;
    const fail = (text) => { throw { modelError: true, text, where }; };
    const OUT = {};

    function value(v, what) {
      if (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) fail(`${what} has no number yet.`);
      return C(Number(v));
    }
    function rowOf(n, s, env, label) {
      const at = n.at && n.at[s];
      const keys = keysOf(ix, s);
      if (!ix.sets[s]) fail(`“${label}” is listed by ${s}, which no longer exists.`);
      if (typeof at === "string") {
        const r = keyPos(ix, s).get(at);
        if (r === undefined) fail(`“${at}” isn't one of the ${setLabel(ix, s)} any more.`);
        return r;
      }
      if (at && at.via) {
        // Follow a link column: the row of s named in the current row of another list.
        const [t, c] = at.via.split("."), tb = ix.sets[t], col = colOf(ix, at.via);
        if (!tb || !col) fail(`“${label}” follows a link that no longer exists.`);
        if (env[t] === undefined) fail(`“${label}” follows each ${setOne(ix, t)}'s ${col.label}, so it has to sit inside “for each ${setOne(ix, t)}” or a total across ${tb.label}.`);
        const v = String(tb.rows[env[t]][c] ?? "");
        const r = keyPos(ix, s).get(v);
        if (r === undefined) fail(`“${v}” in ${tb.label}' ${col.label} (row ${tb.rows[env[t]].key}) isn't one of the ${setLabel(ix, s)}.`);
        return r;
      }
      if (env[s] === undefined) fail(`“${label}” is different for each ${setOne(ix, s)}. Say which one: use it inside “for each ${setOne(ix, s)}” or “total of … across ${setLabel(ix, s)}”, or pick a row.`);
      if (at && at.shift) { const r = env[s] + at.shift; return r < 0 || r >= keys.length ? OUT : r; }
      return env[s];
    }
    function exRef(n, env) {
      const info = refInfo(ix, n.ref);
      if (!info) fail("Something this sentence uses no longer exists.");
      const idx = [];
      for (const s of info.sets) {
        const r = rowOf(n, s, env, info.label);
        if (r === OUT) return n.otherwise ? ex(n.otherwise, env) : C(0);
        idx.push(r);
      }
      const keys = info.sets.map((s, k) => keysOf(ix, s)[idx[k]]);
      switch (info.kind) {
        case "prop": return value(info.prop.value, `“${info.thing.label}: ${info.prop.label}”`);
        case "col":
          if (!isNumCol(info.col)) fail(`“${info.col.label}” holds names, not numbers. Use it in a “where”, or to follow a link to another list.`);
          return value(info.thing.rows[idx[0]][info.col.id], `“${info.col.label}” for ${keys[0]}`);
        case "grid": { const row = (info.item.values || {})[keys[0]] || {}; return value(row[keys[1]], `“${info.label}” for ${keys.join(" and ")}`); }
        case "decision": {
          if (info.item.disabled) { addNote(`“${info.label}” is turned off, so it counts as 0 wherever it's used.`); return C(0); }
          return { v: varAt.get(info.item.id + SEP + keys.join(SEP)) };
        }
        case "result": {
          const r = info.item;
          if (r.disabled) { addNote(`“${r.label}” is turned off, so it counts as 0 wherever it's used.`); return C(0); }
          const key = r.id + SEP + idx.join(SEP);
          if (memo.has(key)) return memo.get(key);
          if (stack.includes(r.id)) {
            const chain = stack.slice(stack.indexOf(r.id)).concat(r.id).map((id) => ix.named[id].label);
            fail(`“${r.label}” depends on itself (${chain.join(" → ")}).`);
          }
          stack.push(r.id);
          const outer = where;
          where = r.id;
          const env2 = {};
          (r.indexBy || []).forEach((s, k) => (env2[s] = idx[k]));
          try { memo.set(key, ex(r.expr, env2)); } finally { stack.pop(); where = outer; }
          return memo.get(key);
        }
      }
    }
    // Data only (no decisions), for "where" filters: numbers, names and true/false.
    function dv(n, env) {
      if (!n || n.hole) fail("This filter has an empty spot.");
      if (n.const !== undefined) return Number(n.const);
      if (n.text !== undefined) return String(n.text);
      if (n.key !== undefined && !n.op) {
        if (!ix.sets[n.key]) fail("A filter mentions a list that no longer exists.");
        if (env[n.key] === undefined) fail(`“this ${setOne(ix, n.key).toLowerCase()}” only makes sense inside “for each ${setOne(ix, n.key)}” or a total across ${setLabel(ix, n.key)}.`);
        return keysOf(ix, n.key)[env[n.key]];
      }
      if (n.ref !== undefined) {
        const info = refInfo(ix, n.ref);
        if (!info) fail("A filter uses something that no longer exists.");
        if (info.kind === "decision" || info.kind === "result") fail("A “where” can only use your data, not decisions or results (those aren't known until the solve).");
        const idx = [];
        for (const s of info.sets) { const r = rowOf(n, s, env, info.label); if (r === OUT) return n.otherwise ? dv(n.otherwise, env) : 0; idx.push(r); }
        if (info.kind === "prop") return Number(info.prop.value);
        if (info.kind === "col") { const v = info.thing.rows[idx[0]][info.col.id]; return isNumCol(info.col) ? Number(v) : String(v ?? ""); }
        const ks = info.sets.map((s, k) => keysOf(ix, s)[idx[k]]);
        return Number(((info.item.values || {})[ks[0]] || {})[ks[1]]);
      }
      const a = n.args || [];
      const num2 = (x, y) => x !== "" && y !== "" && Number.isFinite(Number(x)) && Number.isFinite(Number(y));
      switch (n.op) {
        case "paren": return dv(a[0], env);
        case "and": return truthy(dv(a[0], env)) && truthy(dv(a[1], env));
        case "or": return truthy(dv(a[0], env)) || truthy(dv(a[1], env));
        case "not": return !truthy(dv(a[0], env));
        case "eq": case "ne": case "ge": case "le": case "gt": case "lt": {
          const x = dv(a[0], env), y = dv(a[1], env);
          let c;
          if (num2(x, y)) { const d = Number(x) - Number(y); c = Math.abs(d) <= 1e-9 * Math.max(1, Math.abs(Number(y))) ? 0 : Math.sign(d); }
          else c = String(x) === String(y) ? 0 : String(x) < String(y) ? -1 : 1;
          return { eq: c === 0, ne: c !== 0, ge: c >= 0, le: c <= 0, gt: c > 0, lt: c < 0 }[n.op];
        }
        case "add": return Number(dv(a[0], env)) + Number(dv(a[1], env));
        case "sub": return Number(dv(a[0], env)) - Number(dv(a[1], env));
        case "mul": return Number(dv(a[0], env)) * Number(dv(a[1], env));
        case "div": return Number(dv(a[0], env)) / Number(dv(a[1], env));
        case "neg": return -Number(dv(a[0], env));
      }
      fail("A filter can only compare data: equals, is not, at least, at most, more than, less than, and, or, not.");
    }
    const truthy = (v) => (typeof v === "string" ? v !== "" : !!v);
    // Rows of a list grouped by one column's value, built once, so "where Route's From is this
    // Warehouse" over a big list looks its rows up instead of scanning them all for every warehouse.
    const groups = new Map();
    function groupOf(set, col) {
      const k = set + "." + col;
      if (!groups.has(k)) {
        const m = new Map(), num = isNumCol(colOf(ix, k));
        ix.sets[set].rows.forEach((r, i) => { const v = num ? String(Number(r[col])) : String(r[col] ?? ""); if (!m.has(v)) m.set(v, []); m.get(v).push(i); });
        groups.set(k, m);
      }
      return groups.get(k);
    }
    const mentions = (n, set) => !!n && typeof n === "object" && ((n.key === set && !n.op) || (n.ref !== undefined && (refInfo(ix, n.ref) || { sets: [] }).sets.includes(set) && !(n.at && typeof n.at[set] === "string")) || (n.args || []).some((x) => mentions(x, set)));
    // The rows of one list that pass a filter (all of them without one).
    function rowsWhere(set, where, env) {
      const all = () => keysOf(ix, set).map((_, i) => i);
      if (!where) return all();
      let cand = null;
      const conj = [];
      (function flat(w) { if (w && w.op === "and") w.args.forEach(flat); else conj.push(w); })(where);
      for (const c of conj) {
        if (cand || !c || c.op !== "eq") continue;
        for (const [l, r] of [[c.args[0], c.args[1]], [c.args[1], c.args[0]]]) {
          if (l && l.ref && !l.at && l.ref.startsWith(set + ".") && colOf(ix, l.ref) && !mentions(r, set)) {
            const col = colOf(ix, l.ref), v = dv(r, env);
            cand = groupOf(set, col.id).get(isNumCol(col) ? String(Number(v)) : String(v)) || [];
            break;
          }
        }
      }
      return (cand || all()).filter((i) => truthy(dv(where, { ...env, [set]: i })));
    }
    // Every combination of rows for several lists, with an optional filter over all of them.
    function combosWhere(sets, where, env) {
      if (sets.length === 1) return rowsWhere(sets[0], where, env).map((i) => [i]);
      const out = [];
      for (const c of combos(ix, sets)) {
        if (!where) { out.push(c); continue; }
        const e2 = { ...env };
        sets.forEach((s, k) => (e2[s] = c[k]));
        if (truthy(dv(where, e2))) out.push(c);
      }
      return out;
    }

    function ex(n, env) {
      if (!n || n.hole) fail("This sentence has an empty spot.");
      if (n.text !== undefined || (n.key !== undefined && !n.op)) fail("Names (like “this warehouse”) can only be compared in a “where”, not used as numbers.");
      if (n.const !== undefined) { if (n.const === null || !Number.isFinite(Number(n.const))) fail("A number here is missing."); return C(Number(n.const)); }
      if (n.ref !== undefined) return exRef(n, env);
      const a = n.args || [];
      switch (n.op) {
        case "paren": return ex(a[0], env);
        case "sum": case "avg": {
          const sets = [].concat(n.over || []);
          for (const s of sets) if (!ix.sets[s]) fail("A “total of” here is across a list that no longer exists.");
          const terms = [];
          for (const c of combosWhere(sets, n.where, env)) { const e2 = { ...env }; sets.forEach((s, k) => (e2[s] = c[k])); terms.push(ex(n.body, e2)); }
          if (n.op === "avg") { if (!terms.length) fail(`There's nothing in ${setLabel(ix, sets[0])} to average.`); return mul(C(1 / terms.length), add(terms)); }
          return add(terms);
        }
        case "count": {
          const sets = [].concat(n.over || []);
          for (const s of sets) if (!ix.sets[s]) fail("A “number of” here counts a list that no longer exists.");
          return C(n.where ? combosWhere(sets, n.where, env).length : sets.reduce((p, s) => p * keysOf(ix, s).length, 1));
        }
        case "lookup": {
          const t = ix.sets[n.table];
          if (!t) fail("A “look up” here uses a table that no longer exists.");
          const keys = t.rows.map((r) => Number(r[n.key === "#key" ? "key" : n.key]));
          const vals = t.rows.map((r) => Number(r[n.value]));
          if (keys.some((k) => !Number.isFinite(k)) || vals.some((v) => !Number.isFinite(v))) fail(`The look-up in ${t.label} needs a number in every row.`);
          const x = ex(a[0], env);
          const node = { op: "lookup", keys, vals, a: [x] };
          return isC(x) ? C(apply("lookup", [x.c], node)) : node;
        }
        case "add": return add(a.map((x) => ex(x, env)));
        case "sub": return add([ex(a[0], env), mul(C(-1), ex(a[1], env))]);
        case "neg": return mul(C(-1), ex(a[0], env));
        case "mul": return a.map((x) => ex(x, env)).reduce(mul);
        case "div": {
          const p = ex(a[0], env), q = ex(a[1], env);
          if (isC(q)) { if (q.c === 0) fail("This divides by zero."); return mul(C(1 / q.c), p); }
          return isC(p) && p.c === 0 ? C(0) : { op: "div", a: [p, q] };
        }
        case "if": {
          const c = ex(a[0], env), t = ex(a[1], env), f = ex(a[2], env);
          if (isC(c)) return Math.abs(c.c) > 1e-9 ? t : f;
          return { op: "if", a: [c, t, f] };
        }
        default: {
          if (!n.op) fail("Something in this sentence isn't finished.");
          const xs = a.map((x) => ex(x, env));
          if (n.op === "pow" && isC(xs[1]) && xs[1].c === 1) return xs[0];
          if (n.op === "pow" && isC(xs[1]) && xs[1].c === 0) return C(1);
          if (xs.every(isC)) {
            const v = apply(n.op, xs.map((x) => x.c));
            if (!Number.isFinite(v)) fail("This works out to a number that isn't defined (a square root of a negative number, say).");
            return C(v);
          }
          return { op: n.op, a: xs };
        }
      }
    }
    const noted = new Set();
    function addNote(t) { if (!noted.has(t)) { noted.add(t); notes.push({ text: t, where }); } }
    function attempt(id, fn) {
      where = id;
      try { fn(); } catch (e) { if (!e.modelError) throw e; if (!errors.some((x) => x.text === e.text)) errors.push({ text: e.text, where: e.where || id }); }
      where = null;
    }
    function bound(b, dflt, env) {
      if (b === undefined) return dflt;
      if (b === null || b === "") return dflt === 0 ? -INF : INF;
      if (typeof b === "number") return b;
      const t = ex(b, env);
      if (!isC(t)) fail("A limit on a decision can only use numbers and data, not other decisions. Write it as a rule instead.");
      return t.c;
    }

    // A link column has to name rows of the list it links to.
    for (const t of model.things || []) {
      if (t.kind !== "table") continue;
      for (const c of t.columns || []) {
        if (c.kind !== "link") continue;
        attempt(t.id, () => {
          if (!ix.sets[c.links]) fail(`“${c.label}” in ${t.label} links to a list that no longer exists.`);
          const pos = keyPos(ix, c.links);
          const bad = t.rows.find((r) => !pos.has(String(r[c.id] ?? "")));
          if (bad) fail(`“${bad[c.id] ?? ""}” in ${t.label}' ${c.label} (row ${bad.key}) isn't one of the ${setLabel(ix, c.links)}.`);
        });
      }
    }

    // Variables, one per decision per combination of its rows.
    for (const d of model.decisions || []) {
      if (d.disabled) continue;
      attempt(d.id, () => {
        const sets = d.indexBy || [];
        for (const s of sets) if (!ix.sets[s]) fail(`“${d.label}” is for each row of a list that no longer exists.`);
        for (const c of combos(ix, sets)) {
          const keys = c.map((r, k) => keysOf(ix, sets[k])[r]);
          const env = {};
          sets.forEach((s, k) => (env[s] = c[k]));
          let lo = bound(d.lower, 0, env), hi = bound(d.upper, INF, env);
          const type = d.type || "continuous";
          if (type === "binary") { lo = Math.max(lo, 0); hi = Math.min(hi, 1); }
          if (lo > hi) fail(`“${d.label}” has a lowest value (${fmt(lo)}) above its highest (${fmt(hi)}).`);
          varAt.set(d.id + SEP + keys.join(SEP), vars.length);
          vars.push({ i: vars.length, decision: d.id, keys, label: d.label + (keys.length ? " · " + keys.join(", ") : ""), type, lo, hi, unit: d.unit || "" });
        }
      });
    }

    // Rows, one per rule per combination of its "for each" rows.
    const push = (r, keys, part, op, lhs, rhs) => {
      const expr = add([lhs, mul(C(-1), rhs)]);
      if (isC(expr)) {
        const ok = op === "<=" ? expr.c <= 1e-9 : op === ">=" ? expr.c >= -1e-9 : Math.abs(expr.c) <= 1e-9;
        if (!ok) fail(`“${r.label}”${keys.length ? " for " + keys.join(", ") : ""} can never be true: it works out to ${fmt(lhs.c)} ${OPS[op]} ${fmt(rhs.c)}, and nothing you decide changes that.`);
        return;
      }
      rows.push({ rule: r.id, label: r.label, keys, part, op, expr, lhs, rhs });
    };
    for (const r of model.rules || []) {
      if (r.disabled) continue;
      attempt(r.id, () => {
        const kind = r.kind || "compare";
        if (kind === "compare") {
          const sets = r.forEach || [];
          for (const s of sets) if (!ix.sets[s]) fail(`“${r.label}” is for each row of a list that no longer exists.`);
          for (const c of combosWhere(sets, sets.length ? r.where : null, {})) {
            const env = {};
            sets.forEach((s, k) => (env[s] = c[k]));
            const keys = c.map((x, k) => keysOf(ix, sets[k])[x]);
            const L = ex(r.lhs, env), R = ex(r.rhs, env);
            if (r.op === "between") { push(r, keys, 0, ">=", L, R); push(r, keys, 1, "<=", L, ex(r.rhs2, env)); }
            else push(r, keys, 0, r.op || ">=", L, R);
          }
        } else if (kind === "pick") {
          const d = ix.decisions[r.decision];
          if (!d) fail(`“${r.label}” picks from a decision that no longer exists.`);
          if (d.disabled) return;
          const s = (d.indexBy || [])[0];
          const terms = keysOf(ix, s).map((k) => ({ v: varAt.get(d.id + SEP + k) }));
          push(r, [], 0, r.op || "<=", add(terms), ex(r.count, {}));
        } else if (kind === "different") {
          const d = ix.decisions[r.decision];
          if (!d) fail(`“${r.label}” uses a decision that no longer exists.`);
          if (d.disabled) return;
          const [A, B] = d.indexBy || [];
          const ka = keysOf(ix, A), kb = keysOf(ix, B);
          ka.forEach((a) => push(r, [a], 0, "=", add(kb.map((b) => ({ v: varAt.get(d.id + SEP + a + SEP + b) }))), C(1)));
          kb.forEach((b) => push(r, [b], 1, r.fillAll ? "=" : "<=", add(ka.map((a) => ({ v: varAt.get(d.id + SEP + a + SEP + b) }))), C(1)));
        }
      });
    }

    let goal = null;
    const g = model.goal;
    if (g && g.expr && !g.disabled) attempt("goal", () => {
      const tree = ex(g.expr, {});
      let target = null;
      if (g.sense === "target") { target = Number(g.targetValue); if (!Number.isFinite(target)) fail("The goal needs the number to aim for."); }
      goal = { tree, sense: g.sense || "min", target, close: !!g.close, label: g.label || "the goal" };
    });
    // Every result written out too, so the answer can show what each works out to.
    const named = [];
    for (const r of model.results || []) {
      if (r.disabled) continue;
      attempt(r.id, () => {
        const sets = r.indexBy || [];
        for (const c of combos(ix, sets)) named.push({ id: r.id, keys: c.map((x, k) => keysOf(ix, sets[k])[x]), tree: exRef({ ref: r.id, at: Object.fromEntries(sets.map((s, k) => [s, keysOf(ix, s)[c[k]]])) }, {}) });
      });
    }
    return { ix, vars, rows, goal, named, errors, notes };
  }
  const OPS = { "<=": "≤", ">=": "≥", "=": "=" };

  /* ---------- linear form ---------- */
  // A linear expression is { k, t: Map(var -> coefficient) }.
  const lin = (k, t) => ({ k, t: t || new Map() });
  function linAdd(acc, x, s) { acc.k += s * x.k; for (const [i, c] of x.t) { const v = (acc.t.get(i) || 0) + s * c; if (v === 0) acc.t.delete(i); else acc.t.set(i, v); } return acc; }
  const scale = (x, s) => linAdd(lin(0), x, s);
  function nonlinear(kind, hint) { return { nonlinear: kind, hint }; }

  // Rewrites the problem as a linear one, if it is one or can be made one exactly:
  //   |e|, larger of, smaller of where the goal or rule pushes them the convex way (an extra variable
  //   and two rows each), and a yes-or-no decision times an expression with known limits (four rows).
  // pol says which way the surrounding row pushes a term: +1 wants it small, -1 large, 0 either.
  function linearize(E, opt) {
    const aux = [], rows = [], notes = [];
    let nv = E.vars.length, ctx = "";
    const varOf = (i) => (i < E.vars.length ? E.vars[i] : aux[i - E.vars.length]);
    const newVar = (lo, hi, label) => { aux.push({ i: nv, lo, hi, type: "continuous", aux: true, label }); return nv++; };
    const note = (t) => { if (!notes.includes(t)) notes.push(t); };
    const auxRow = (e, op) => rows.push({ t: e.t, op, rhs: -e.k, aux: true });
    const isBinary = (n) => n.v !== undefined && (varOf(n.v).type === "binary" || (varOf(n.v).type === "integer" && varOf(n.v).lo >= 0 && varOf(n.v).hi <= 1));
    function range(e) {
      let lo = e.k, hi = e.k;
      for (const [i, c] of e.t) { const v = varOf(i); lo += c > 0 ? c * v.lo : c * v.hi; hi += c > 0 ? c * v.hi : c * v.lo; }
      return [Number.isNaN(lo) ? -INF : lo, Number.isNaN(hi) ? INF : hi];
    }
    function product(b, other) {
      // z = b · e for a yes-or-no b: exact with four rows when e has finite limits.
      const e = L(other, 0);
      const [lo, hi] = range(e);
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw nonlinear("smooth", "bound");
      const z = newVar(Math.min(0, lo), Math.max(0, hi), "product");
      const Z = lin(0, new Map([[z, 1]])), B = lin(0, new Map([[b.v, 1]]));
      auxRow(linAdd(scale(Z, 1), B, -hi), "<=");
      auxRow(linAdd(scale(Z, 1), B, -lo), ">=");
      auxRow(linAdd(linAdd(linAdd(scale(Z, 1), e, -1), B, -lo), lin(lo), 1), "<=");
      auxRow(linAdd(linAdd(linAdd(scale(Z, 1), e, -1), B, -hi), lin(hi), 1), ">=");
      note(`In “${ctx}”, a yes-or-no decision multiplies another amount; that was rewritten exactly as a linear model, so the answer is still guaranteed.`);
      return Z;
    }
    function L(n, pol) {
      if (isC(n)) return lin(n.c);
      if (n.v !== undefined) return lin(0, new Map([[n.v, 1]]));
      switch (n.op) {
        case "add": { const acc = lin(0); for (const t of n.a) linAdd(acc, L(t, pol), 1); return acc; }
        case "mul": {
          const [a, b] = n.a;
          if (isC(a)) return scale(L(b, pol * Math.sign(a.c)), a.c);
          if (isBinary(a)) return product(a, b);
          if (isBinary(b)) return product(b, a);
          throw nonlinear("smooth");
        }
        case "abs": case "max": case "min": {
          const want = n.op === "min" ? -1 : 1;
          if (pol !== want) throw nonlinear("nonsmooth");
          const t = newVar(-INF, INF, n.op);
          const T = lin(0, new Map([[t, 1]]));
          const parts = n.op === "abs" ? [L(n.a[0], 0), scale(L(n.a[0], 0), -1)] : n.a.map((x) => L(x, pol));
          for (const p of parts) auxRow(linAdd(scale(p, 1), T, -1), want > 0 ? "<=" : ">=");
          const word = n.op === "abs" ? "a size ignoring sign" : n.op === "max" ? "a “larger of”" : "a “smaller of”";
          note(`“${ctx}” uses ${word}; since the goal pushes it the right way, it was rewritten exactly as a linear model.`);
          return T;
        }
        case "if": {
          const [c, a, b] = n.a;
          if (!isBinary(c)) throw nonlinear("nonsmooth");
          // if c then a else b  =  c·a + b − c·b
          return linAdd(linAdd(product(c, a), L(b, 0), 1), product(c, b), -1);
        }
        case "div": case "pow": case "sqrt": case "exp": case "log": throw nonlinear("smooth");
        default: throw nonlinear("nonsmooth");
      }
    }
    const polOf = (op) => (op === "<=" ? 1 : op === ">=" ? -1 : 0);
    const out = [];
    for (const r of E.rows) {
      ctx = r.label;
      const e = L(r.expr, polOf(r.op));
      out.push({ t: e.t, op: r.op, rhs: -e.k, src: r });
    }
    let obj = lin(0), sense = "min";
    const g = E.goal;
    if (g && !(opt && opt.skipGoal)) {
      ctx = g.label;
      if (g.sense === "target") {
        const e = L(g.tree, 0);
        if (g.close) {
          const dp = newVar(0, INF, "over"), dn = newVar(0, INF, "under");
          const row = linAdd(linAdd(scale(e, 1), lin(0, new Map([[dp, 1]])), -1), lin(0, new Map([[dn, 1]])), 1);
          out.push({ t: row.t, op: "=", rhs: g.target - row.k, src: { rule: "goal", label: g.label, keys: [], op: "=", goalRow: true } });
          obj = lin(0, new Map([[dp, 1], [dn, 1]]));
        } else out.push({ t: e.t, op: "=", rhs: g.target - e.k, src: { rule: "goal", label: g.label, keys: [], op: "=", goalRow: true } });
      } else {
        sense = g.sense === "max" ? "max" : "min";
        obj = L(g.tree, sense === "min" ? 1 : -1);
      }
    }
    return { nVars: nv, vars: E.vars.concat(aux), aux, rows: out.concat(rows), obj, sense, notes };
  }

  /* ---------- quadratic goals (HiGHS solves convex QPs) ---------- */
  // { k, t, q: Map("i,j" -> coefficient of x_i·x_j, i ≤ j) } or null.
  function quad(n) {
    if (isC(n)) return { k: n.c, t: new Map(), q: new Map() };
    if (n.v !== undefined) return { k: 0, t: new Map([[n.v, 1]]), q: new Map() };
    const sum = (x, y, s) => {
      const o = { k: x.k + s * y.k, t: new Map(x.t), q: new Map(x.q) };
      for (const [i, c] of y.t) o.t.set(i, (o.t.get(i) || 0) + s * c);
      for (const [i, c] of y.q) o.q.set(i, (o.q.get(i) || 0) + s * c);
      return o;
    };
    const times = (x, y) => {
      if (x.q.size && (y.q.size || y.t.size)) return null;
      if (y.q.size && x.t.size) return null;
      let o = { k: x.k * y.k, t: new Map(), q: new Map() };
      const addT = (i, c) => o.t.set(i, (o.t.get(i) || 0) + c);
      const addQ = (i, j, c) => { const key = i <= j ? i + "," + j : j + "," + i; o.q.set(key, (o.q.get(key) || 0) + c); };
      for (const [i, c] of x.t) addT(i, c * y.k);
      for (const [i, c] of y.t) addT(i, c * x.k);
      for (const [key, c] of x.q) o.q.set(key, (o.q.get(key) || 0) + c * y.k);
      for (const [key, c] of y.q) o.q.set(key, (o.q.get(key) || 0) + c * x.k);
      for (const [i, a] of x.t) for (const [j, b] of y.t) addQ(i, j, a * b);
      return o;
    };
    switch (n.op) {
      case "add": { let o = { k: 0, t: new Map(), q: new Map() }; for (const a of n.a) { const x = quad(a); if (!x) return null; o = sum(o, x, 1); } return o; }
      case "mul": { const x = quad(n.a[0]), y = quad(n.a[1]); return x && y ? times(x, y) : null; }
      case "pow": { if (!isC(n.a[1]) || n.a[1].c !== 2) return null; const x = quad(n.a[0]); return x ? times(x, x) : null; }
      default: return null;
    }
  }
  // Is the quadratic form convex (positive semidefinite)? Cholesky with a small shift.
  function convex(q) {
    const ids = [...new Set([...q.keys()].flatMap((k) => k.split(",").map(Number)))];
    if (ids.length > 400) return true; // too big to check here; HiGHS refuses a nonconvex one and the page falls back
    const pos = new Map(ids.map((v, k) => [v, k]));
    const n = ids.length, H = Array.from({ length: n }, () => new Array(n).fill(0));
    for (const [key, c] of q) { const [i, j] = key.split(",").map((x) => pos.get(Number(x))); if (i === j) H[i][i] += 2 * c; else { H[i][j] += c; H[j][i] += c; } }
    const scaleH = Math.max(1e-12, ...H.map((r, i) => Math.abs(r[i])));
    for (let i = 0; i < n; i++) H[i][i] += 1e-9 * scaleH;
    for (let j = 0; j < n; j++) {
      let d = H[j][j];
      for (let k = 0; k < j; k++) d -= H[j][k] * H[j][k];
      if (d < -1e-9 * scaleH) return false;
      const s = Math.sqrt(Math.max(d, 1e-300));
      H[j][j] = s;
      for (let i = j + 1; i < n; i++) { let v = H[i][j]; for (let k = 0; k < j; k++) v -= H[i][k] * H[j][k]; H[i][j] = v / s; }
    }
    return true;
  }

  /* ---------- what kind of problem is it ---------- */
  function kindOf(n) {
    // 0 linear, 1 smooth nonlinear, 2 not smooth; and whether the tree uses a variable.
    if (isC(n)) return [0, false];
    if (n.v !== undefined) return [0, true];
    let worst = 0, uses = false;
    const kids = n.a.map(kindOf);
    for (const [k, u] of kids) { worst = Math.max(worst, k); uses = uses || u; }
    if (!uses) return [0, false];
    const used = (i) => kids[i] && kids[i][1];
    switch (n.op) {
      case "add": return [worst, true];
      case "mul": return [Math.max(worst, used(0) && used(1) ? 1 : 0), true];
      case "div": return [Math.max(worst, used(1) ? 1 : 0), true];
      case "pow": case "sqrt": case "exp": case "log": return [Math.max(worst, 1), true];
      default: return [2, true];
    }
  }

  function classify(E, engine) {
    if (E.errors.length) return { cls: "error" };
    if (!E.vars.length) return { cls: "error", why: "nothing" };
    const ints = E.vars.some((v) => v.type !== "continuous");
    const trees = E.rows.map((r) => r.expr).concat(E.goal ? [E.goal.tree] : []);
    const worst = Math.max(0, ...trees.map((t) => kindOf(t)[0]));
    let hint = null;
    if (engine !== "nonlinear" && engine !== "evolutionary") {
      try { const Lm = linearize(E); return { cls: ints ? "mip" : "lp", Lm }; }
      catch (e) { if (!e.nonlinear) throw e; hint = e.hint; }
      if (!ints && E.goal && E.goal.sense !== "target") {
        const q = quad(E.goal.tree);
        let rowsLinear = null;
        try { rowsLinear = linearize(E, { skipGoal: true }); } catch (e) { if (!e.nonlinear) throw e; }
        if (q && rowsLinear) {
          const s = E.goal.sense === "max" ? -1 : 1;
          const qs = new Map([...q.q].map(([k, c]) => [k, s * c]));
          if (convex(qs)) return { cls: "qp", Lm: rowsLinear, Q: { k: s * q.k, t: new Map([...q.t].map(([i, c]) => [i, s * c])), q: qs, flip: s < 0 } };
        }
      }
    }
    if (engine === "evolutionary" || worst >= 2 || ints) return { cls: "nonsmooth", ints, worst, hint, forced: engine === "evolutionary" };
    return { cls: "nlp", hint, forced: engine === "nonlinear" };
  }

  /* ---------- CPLEX LP text ---------- */
  const num = (x) => { const r = Math.abs(x) < 1e-300 ? 0 : x; return String(Number(r.toPrecision(15))); };
  function terms(t, name) {
    const parts = [];
    for (const [i, c] of t) {
      if (c === 0) continue;
      const sign = c < 0 ? "-" : "+";
      const a = Math.abs(c);
      parts.push((parts.length ? sign + " " : c < 0 ? "- " : "") + (a === 1 ? "" : num(a) + " ") + name(i));
    }
    if (!parts.length) return "0 " + name(0);
    const lines = [];
    for (let i = 0; i < parts.length; i += 8) lines.push(parts.slice(i, i + 8).join(" "));
    return lines.join("\n   ");
  }
  function writeLP(Lm, opt) {
    opt = opt || {};
    const name = (i) => "v" + (i + 1);
    const vars = Lm.vars;
    const out = [];
    const nameMap = {};
    out.push("\\ Plain Solver model. Names: v = a decision (or a helper), c = a rule.");
    vars.forEach((v, i) => { nameMap[name(i)] = v.aux ? `(helper: ${v.label})` : v.label; if (!opt.bare && !v.aux) out.push(`\\ ${name(i)} = ${clean(v.label)}`); });
    out.push(Lm.sense === "max" ? "Maximize" : "Minimize");
    let obj = " obj: " + terms(Lm.obj.t, name);
    if (opt.Q && opt.Q.q.size) {
      const qt = [...opt.Q.q].filter(([, c]) => c !== 0).map(([key, c], k) => {
        const [i, j] = key.split(",").map(Number);
        const a = 2 * c;
        return (k ? (a < 0 ? "- " : "+ ") : a < 0 ? "- " : "") + num(Math.abs(a)) + " " + (i === j ? name(i) + "^2" : name(i) + " * " + name(j));
      });
      if (qt.length) obj += " + [ " + qt.join(" ") + " ] / 2";
    }
    out.push(obj);
    out.push("Subject To");
    Lm.rows.forEach((r, j) => {
      const c = "c" + (j + 1);
      nameMap[c] = r.aux ? "(helper row)" : r.src.label + (r.src.keys && r.src.keys.length ? " · " + r.src.keys.join(", ") : "");
      out.push(` ${c}: ${terms(r.t, name)} ${r.op} ${num(r.rhs)}`);
    });
    out.push("Bounds");
    const gen = [], bin = [];
    vars.forEach((v, i) => {
      const n = name(i);
      if (v.type === "binary") { bin.push(n); if (v.lo > 0 || v.hi < 1) out.push(` ${num(v.lo)} <= ${n} <= ${num(v.hi)}`); return; }
      if (v.type === "integer") gen.push(n);
      if (v.lo === 0 && v.hi === INF) return;
      if (v.lo === -INF && v.hi === INF) out.push(` ${n} free`);
      else if (v.lo === -INF) out.push(` -inf <= ${n} <= ${num(v.hi)}`);
      else if (v.hi === INF) out.push(` ${n} >= ${num(v.lo)}`);
      else out.push(` ${num(v.lo)} <= ${n} <= ${num(v.hi)}`);
    });
    if (gen.length) { out.push("General"); for (let i = 0; i < gen.length; i += 12) out.push(" " + gen.slice(i, i + 12).join(" ")); }
    if (bin.length) { out.push("Binary"); for (let i = 0; i < bin.length; i += 12) out.push(" " + bin.slice(i, i + 12).join(" ")); }
    out.push("End");
    return { lp: out.join("\n") + "\n", nameMap };
  }
  const clean = (s) => String(s).replace(/[\r\n]+/g, " ");

  // The elastic version: every rule may bend, at a price per unit of bending, scaled so a big rule
  // and a small one count alike. The bends that remain say which rules can't all hold together.
  function elastic(Lm) {
    const vars = Lm.vars.map((v) => ({ ...v }));
    const rows = [], slacks = [];
    const obj = new Map();
    const newSlack = (w, info) => { const i = vars.length; vars.push({ i, lo: 0, hi: INF, type: "continuous", aux: true, label: "slack" }); obj.set(i, w); slacks.push({ i, ...info }); return i; };
    Lm.rows.forEach((r, j) => {
      if (r.aux) { rows.push(r); return; }
      const t = new Map(r.t), w = 1 / Math.max(1, Math.abs(r.rhs));
      if (r.op !== "<=") t.set(newSlack(w, { row: j, dir: +1 }), 1);   // short of a "≥"
      if (r.op !== ">=") t.set(newSlack(w, { row: j, dir: -1 }), -1);  // over a "≤"
      rows.push({ ...r, t });
    });
    // Limits on decisions bend too (except the usual "not below zero" and yes-or-no).
    Lm.vars.forEach((v, i) => {
      if (v.aux || v.type === "binary") return;
      if (Number.isFinite(v.hi)) { const s = newSlack(1 / Math.max(1, Math.abs(v.hi)), { var: i, dir: -1, limit: v.hi }); rows.push({ t: new Map([[i, 1], [s, -1]]), op: "<=", rhs: v.hi, aux: true }); vars[i].hi = INF; }
      if (Number.isFinite(v.lo) && v.lo !== 0) { const s = newSlack(1 / Math.max(1, Math.abs(v.lo)), { var: i, dir: +1, limit: v.lo }); rows.push({ t: new Map([[i, 1], [s, 1]]), op: ">=", rhs: v.lo, aux: true }); vars[i].lo = -INF; }
    });
    return { Lm: { ...Lm, vars, rows, obj: lin(0, obj), sense: "min" }, slacks };
  }

  function compileToLP(model) {
    const E = expand(model);
    if (E.errors.length) return { errors: E.errors };
    const k = classify(E, (model.options || {}).engine);
    if (!k.Lm) return { cls: k.cls, errors: [] };
    return { cls: k.cls, ...writeLP(k.Lm, { Q: k.Q }), E, Lm: k.Lm, Q: k.Q };
  }

  /* ---------- the same problem as numbers, for the nonlinear engines ---------- */
  function numeric(E, engine) {
    const g = E.goal;
    let f = C(0);
    const eq = [], ineq = [], labels = [];
    for (const r of E.rows) {
      if (r.op === "=") eq.push(r.expr); else ineq.push(r.op === "<=" ? r.expr : mul(C(-1), r.expr));
      labels.push(r);
    }
    if (g) {
      if (g.sense === "min") f = g.tree;
      else if (g.sense === "max") f = mul(C(-1), g.tree);
      else {
        const d = add([g.tree, C(-g.target)]);
        if (g.close) f = engine === "de" ? { op: "abs", a: [d] } : { op: "mul", a: [d, d] };
        else eq.push(d);
      }
    }
    return {
      n: E.vars.length, f, eq, ineq,
      lo: E.vars.map((v) => v.lo), hi: E.vars.map((v) => v.hi),
      int: E.vars.map((v) => v.type !== "continuous"),
    };
  }

  /* ---------- evaluating trees ---------- */
  let stamp = 0;
  function forward(root, x) {
    const order = [], s = ++stamp;
    (function walk(n) {
      if (n._s === s) return;
      n._s = s;
      if (n.a) for (const k of n.a) walk(k);
      n._v = isC(n) ? n.c : n.v !== undefined ? x[n.v] : apply(n.op, n.a.map((k) => k._v), n);
      n._g = 0;
      order.push(n);
    })(root);
    return order;
  }
  const evaluate = (root, x) => { forward(root, x); return root._v; };
  function gradient(root, x, g, w) {
    // Adds w · ∇root to g; returns root's value.
    const order = forward(root, x);
    root._g = w === undefined ? 1 : w;
    for (let k = order.length - 1; k >= 0; k--) {
      const n = order[k], d = n._g;
      if (!d) continue;
      if (n.v !== undefined) { g[n.v] += d; continue; }
      if (!n.a) continue;
      const a = n.a, v = (i) => a[i]._v;
      switch (n.op) {
        case "add": for (const c of a) c._g += d; break;
        case "mul": a[0]._g += d * v(1); a[1]._g += d * v(0); break;
        case "div": a[0]._g += d / v(1); a[1]._g -= d * v(0) / (v(1) * v(1)); break;
        case "pow": {
          a[0]._g += v(0) === 0 && v(1) < 1 ? 0 : d * v(1) * Math.pow(v(0), v(1) - 1);
          if (!isC(a[1]) && v(0) > 0) a[1]._g += d * n._v * Math.log(v(0));
          break;
        }
        case "sqrt": a[0]._g += n._v > 0 ? d / (2 * n._v) : 0; break;
        case "exp": a[0]._g += d * n._v; break;
        case "log": a[0]._g += d / v(0); break;
        case "abs": a[0]._g += d * Math.sign(v(0)); break;
        case "max": case "min": { let j = 0; for (let i = 1; i < a.length; i++) if (n.op === "max" ? v(i) > v(j) : v(i) < v(j)) j = i; a[j]._g += d; break; }
        case "if": (Math.abs(v(0)) > 1e-9 ? a[1] : a[2])._g += d; break;
        default: break; // comparisons and look-ups are flat almost everywhere
      }
    }
    return root._v;
  }

  /* ---------- units ---------- */
  // "$/hour" -> { $: 1, hour: -1 }. Plurals and a few spellings are folded; a number or % is no unit.
  const UNIT_ALIASES = { hr: "hour", hrs: "hour", h: "hour", min: "minute", mins: "minute", dollar: "$", usd: "$", lbs: "lb", pound: "lb", kgs: "kg" };
  function parseUnit(u) {
    if (!u || typeof u !== "string") return null;
    const s = u.trim().toLowerCase().replace(/\bper\b/g, "/").replace(/[×·*]/g, " ");
    if (!s || /^[%x\d.\s]*$/.test(s)) return null;
    const out = {};
    s.split("/").forEach((part, k) => {
      for (let w of part.split(/[\s-]+/)) {
        w = w.replace(/[^\w$€£]/g, "");
        if (!w || /^\d+$/.test(w)) continue;
        if (UNIT_ALIASES[w]) w = UNIT_ALIASES[w];
        else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
        out[w] = (out[w] || 0) + (k === 0 ? 1 : -1);
        if (!out[w]) delete out[w];
      }
    });
    return Object.keys(out).length ? out : null;
  }
  const unitText = (u) => {
    if (!u) return "";
    const top = Object.keys(u).filter((k) => u[k] > 0), bot = Object.keys(u).filter((k) => u[k] < 0);
    const w = (k) => k + (Math.abs(u[k]) > 1 ? "²" : "");
    return (top.map(w).join("·") || "1") + (bot.length ? "/" + bot.map(w).join("·") : "");
  };
  const shares = (a, b) => Object.keys(a).some((k) => b[k] && Math.sign(a[k]) === Math.sign(b[k]));
  function unitsOf(ix, n, warn) {
    if (!n || n.hole) return null;
    if (n.const !== undefined) return parseUnit(n.unit);
    if (n.ref !== undefined) { const i = refInfo(ix, n.ref); return i ? parseUnit(i.unit) : null; }
    const a = n.args || [];
    switch (n.op) {
      case "paren": case "neg": case "abs": return unitsOf(ix, a[0], warn);
      case "sum": case "avg": return unitsOf(ix, n.body, warn);
      case "and": case "or": case "not": case "eq": case "ne": return null;
      case "add": case "sub": case "max": case "min": {
        const us = a.map((x) => unitsOf(ix, x, warn));
        if (us[0] && us[1] && !shares(us[0], us[1])) warn(us[0], us[1]);
        return us[0] || us[1];
      }
      case "mul": case "div": {
        const x = unitsOf(ix, a[0], warn), y = unitsOf(ix, a[1], warn);
        if (!x || !y) return x && n.op === "mul" ? x : y && n.op === "mul" ? y : n.op === "div" ? x : null;
        const o = { ...x };
        for (const k in y) { o[k] = (o[k] || 0) + (n.op === "mul" ? y[k] : -y[k]); if (!o[k]) delete o[k]; }
        return Object.keys(o).length ? o : null;
      }
      case "if": { unitsOf(ix, a[0], warn); const t = unitsOf(ix, a[1], warn), f = unitsOf(ix, a[2], warn); if (t && f && !shares(t, f)) warn(t, f); return t || f; }
      default: a.forEach((x) => unitsOf(ix, x, warn)); return null;
    }
  }

  /* ---------- checks, in plain English ---------- */
  function refsIn(n, out) {
    if (!n || typeof n !== "object") return out;
    if (n.ref !== undefined) { out.add(n.ref); if (n.otherwise) refsIn(n.otherwise, out); }
    if (n.args) n.args.forEach((a) => refsIn(a, out));
    if (n.body) refsIn(n.body, out);
    if (n.where) refsIn(n.where, out);
    return out;
  }
  function uses(model, item) {
    // Every reference an item makes, through the results it uses.
    const ix = index(model);
    const seen = new Set(), stack = [];
    const push = (n) => refsIn(n, new Set()).forEach((r) => stack.push(r));
    if (item.kind === "pick" || item.kind === "different") stack.push(item.decision);
    if (item.count) push(item.count);
    push(item.lhs); push(item.rhs); push(item.rhs2); push(item.expr);
    while (stack.length) {
      const r = stack.pop();
      if (seen.has(r)) continue;
      seen.add(r);
      if (ix.named[r]) push(ix.named[r].expr);
    }
    return seen;
  }
  function validate(model, E) {
    const cards = [];
    const ix = index(model);
    const card = (level, text, where) => cards.push({ level, text, where });
    if (!model.goal || !model.goal.expr || model.goal.expr.hole) card("error", "Tell me what you want: the lowest cost, the most profit, or a number to hit.", "goal");
    const live = (model.rules || []).filter((r) => !r.disabled).concat(model.goal && model.goal.expr ? [model.goal] : []);
    const used = new Set();
    for (const it of live) for (const r of uses(model, it)) used.add(r);
    for (const d of model.decisions || []) if (!d.disabled && !used.has(d.id)) card("warn", `“${d.label}” isn't connected to anything yet: no rule or goal uses it.`, d.id);
    if (!(model.decisions || []).some((d) => !d.disabled)) card("error", "There's nothing to decide yet. Add a decision: what the solver gets to choose.", null);
    // Units.
    const check = (n, where, label) => unitsOf(ix, n, (a, b) => card("warn", `You're adding ${unitText(a)} to ${unitText(b)} in “${label}”. Is that intended?`, where));
    for (const r of model.results || []) if (!r.disabled) check(r.expr, r.id, r.label);
    for (const r of model.rules || []) {
      if (r.disabled || (r.kind && r.kind !== "compare")) continue;
      const a = check(r.lhs, r.id, r.label), b = check(r.rhs, r.id, r.label);
      if (a && b && !shares(a, b)) card("warn", `“${r.label}” compares ${unitText(a)} with ${unitText(b)}. Is that intended?`, r.id);
    }
    if (model.goal && model.goal.expr) check(model.goal.expr, "goal", model.goal.label || "the goal");
    // Everything that only shows up once the model is written out.
    E = E || expand(model);
    for (const e of E.errors) card("error", e.text, e.where);
    for (const n of E.notes) card("note", n.text, n.where);
    // A rule that can't be met even with every decision at its own limit.
    if (!E.errors.length && E.rows.length < 5000) {
      for (const r of E.rows) {
        let e;
        try { e = linearize({ vars: E.vars, rows: [r], goal: null }).rows[0]; } catch (x) { continue; }
        let lo = -e.rhs, hi = -e.rhs;
        for (const [i, c] of e.t) { const v = E.vars[i]; if (!v) { lo = -INF; hi = INF; break; } lo += c > 0 ? c * v.lo : c * v.hi; hi += c > 0 ? c * v.hi : c * v.lo; }
        const what = `“${r.label}”${r.keys.length ? " for " + r.keys.join(", ") : ""}`;
        if ((r.op !== "<=") && hi < -1e-7) { card("error", `${what} can't be met even with every decision at its limit: it falls short by ${fmt(-hi)} at best. Loosen a limit or add a way to cover the gap.`, r.rule); break; }
        if ((r.op !== ">=") && lo > 1e-7) { card("error", `${what} can't be met even with every decision at its limit: it's over by ${fmt(lo)} at best. Loosen a limit or add a way to cover the gap.`, r.rule); break; }
      }
    }
    return cards;
  }

  /* ---------- in words ---------- */
  function joinAnd(xs) { return xs.length <= 1 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1]; }
  function say(model, n, ix) {
    ix = ix || index(model);
    const S = (x) => say(model, x, ix);
    if (!n || n.hole) return "…";
    if (n.const !== undefined) return fmt(n.const, n.unit);
    if (n.text !== undefined) return `“${n.text}”`;
    if (n.key !== undefined && !n.op) return `this ${setOne(ix, n.key).toLowerCase()}`;
    if (n.ref !== undefined) {
      const info = refInfo(ix, n.ref);
      if (!info) return "(missing)";
      const name = info.kind === "prop" ? info.prop.label : info.label;
      const ats = info.sets.map((s) => {
        const at = n.at && n.at[s];
        if (typeof at === "string") return at;
        if (at && at.shift) return `${at.shift < 0 ? "the previous" : "the next"} ${setOne(ix, s).toLowerCase()}'s`;
        if (at && at.via) { const [t] = at.via.split("."), c = colOf(ix, at.via); return `the ${setOne(ix, t).toLowerCase()}'s ${c ? c.label : "link"}'s`; }
        return null;
      });
      const pinned = ats.filter((a) => a && !a.endsWith("'s"));
      const shifted = ats.find((a) => a && a.endsWith("'s"));
      return (shifted ? shifted + " " : "") + name + (pinned.length ? ` for ${pinned.join(", ")}` : "") + (shifted && n.otherwise ? ` (${S(n.otherwise)} before the first)` : "");
    }
    const a = n.args || [];
    switch (n.op) {
      case "add": return `${S(a[0])} plus ${S(a[1])}`;
      case "sub": return `${S(a[0])} minus ${S(a[1])}`;
      case "mul": return `${S(a[0])} × ${S(a[1])}`;
      case "div": return `${S(a[0])} ÷ ${S(a[1])}`;
      case "neg": return `minus ${S(a[0])}`;
      case "paren": return `(${S(a[0])})`;
      case "sum": return `the total of ${S(n.body)} across ${joinAnd([].concat(n.over).map((s) => setLabel(ix, s)))}${n.where ? " where " + S(n.where) : ""}`;
      case "avg": return `the average of ${S(n.body)} across ${joinAnd([].concat(n.over).map((s) => setLabel(ix, s)))}`;
      case "count": return `the number of ${joinAnd([].concat(n.over).map((s) => setLabel(ix, s)))}${n.where ? " where " + S(n.where) : ""}`;
      case "and": return `${S(a[0])} and ${S(a[1])}`;
      case "or": return `${S(a[0])} or ${S(a[1])}`;
      case "not": return `not (${S(a[0])})`;
      case "ne": return `${S(a[0])} isn't ${S(a[1])}`;
      case "pow": return a[1] && a[1].const === 2 ? `${S(a[0])} squared` : `${S(a[0])} to the power of ${S(a[1])}`;
      case "sqrt": return `the square root of ${S(a[0])}`;
      case "abs": return `the size of ${S(a[0])}, ignoring its sign`;
      case "max": return `the larger of ${S(a[0])} and ${S(a[1])}`;
      case "min": return `the smaller of ${S(a[0])} and ${S(a[1])}`;
      case "exp": return `e to the power of ${S(a[0])}`;
      case "log": return `the natural log of ${S(a[0])}`;
      case "if": return `${S(a[1])} if ${S(a[0])}, otherwise ${S(a[2])}`;
      case "ge": return `${S(a[0])} is at least ${S(a[1])}`;
      case "le": return `${S(a[0])} is at most ${S(a[1])}`;
      case "gt": return `${S(a[0])} is more than ${S(a[1])}`;
      case "lt": return `${S(a[0])} is less than ${S(a[1])}`;
      case "eq": return `${S(a[0])} equals ${S(a[1])}`;
      case "lookup": { const t = ix.sets[n.table]; const c = t && (t.columns || []).find((x) => x.id === n.value); return `${c ? c.label : "a value"} looked up in ${t ? t.label : "a table"} for ${S(a[0])}`; }
    }
    return "…";
  }
  const OP_WORDS = { ">=": "must be at least", "<=": "must be at most", "=": "must equal", between: "must be between" };
  function sayRule(model, r, ix) {
    ix = ix || index(model);
    if (r.kind === "pick") { const d = ix.decisions[r.decision]; const s = d && (d.indexBy || [])[0]; return `choose ${r.op === ">=" ? "at least" : r.op === "=" ? "exactly" : "at most"} ${say(model, r.count, ix)} of the ${s ? setLabel(ix, s) : "options"}`; }
    if (r.kind === "different") { const d = ix.decisions[r.decision]; const [A, B] = (d && d.indexBy) || []; return `each ${setOne(ix, A)} gets a different ${setOne(ix, B)}`; }
    const each = (r.forEach || []).length ? `for each ${joinAnd(r.forEach.map((s) => setOne(ix, s)))}, ` : "";
    const rhs = r.op === "between" ? `${say(model, r.rhs, ix)} and ${say(model, r.rhs2, ix)}` : say(model, r.rhs, ix);
    return `${each}${say(model, r.lhs, ix)} ${OP_WORDS[r.op] || OP_WORDS[">="]} ${rhs}`;
  }
  function describe(model) {
    const ix = index(model);
    const ds = (model.decisions || []).filter((d) => !d.disabled).map((d) => d.label.toLowerCase());
    const rules = (model.rules || []).filter((r) => !r.disabled);
    const g = model.goal;
    if (!ds.length) return "Start by saying what the solver gets to decide.";
    let want;
    if (!g || !g.expr || g.expr.hole) want = "works best (step 4 says what “best” means)";
    else if (g.sense === "max") want = `gives the highest ${g.label.toLowerCase()}`;
    else if (g.sense === "target") want = `brings ${g.label.toLowerCase()} ${g.close ? "as close as possible to" : "to exactly"} ${fmt(g.targetValue)}`;
    else want = `gives the lowest ${g.label.toLowerCase()}`;
    const keep = rules.length ? `, while ${rules.length === 1 ? "keeping to one rule: " : `keeping to ${rules.length} rules: `}${joinAnd(rules.slice(0, 4).map((r) => r.label.toLowerCase()))}${rules.length > 4 ? " and more" : ""}` : "";
    return `You're asking: what choice of ${joinAnd(ds)} ${want}${keep}?`;
  }

  /* ---------- the model in standard notation ---------- */
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function math(model) {
    const ix = index(model);
    const letters = "xyzuvwpqrstabcdefghk".split("");
    const sym = {}, legend = [];
    let li = 0;
    const take = (pref) => (li < letters.length ? letters[li++] : pref + li++);
    const idx = {};
    for (const t of model.things || []) if (t.kind === "table") {
      let c = (t.one || t.label || "i")[0].toLowerCase();
      if (!/[a-z]/.test(c) || Object.values(idx).includes(c)) c = "ijklmn".split("").find((x) => !Object.values(idx).includes(x)) || "i";
      idx[t.id] = c;
    }
    for (const d of model.decisions || []) if (!d.disabled) { sym[d.id] = take("x"); legend.push(["decision", d.id]); }
    for (const r of model.results || []) if (!r.disabled) { sym[r.id] = r.label.replace(/[^A-Za-z]/g, "").slice(0, 1).toUpperCase() || "R"; }
    // Results get capital letters, made unique.
    const usedCaps = new Set();
    for (const r of model.results || []) { let s = sym[r.id]; if (!s) continue; let k = 1; while (usedCaps.has(s)) s = sym[r.id] + (++k); usedCaps.add(s); sym[r.id] = s; }
    // Data gets a short word ("demand", "freight"), so it never reads like an index letter.
    const word = (label) => (String(label).toLowerCase().match(/[a-z]+/g) || ["data"]).find((w) => w.length > 2 && !/^(the|per|and|for|cost|most|each)$/.test(w)) || (String(label).toLowerCase().match(/[a-z]+/) || ["data"])[0];
    for (const t of model.things || []) {
      if (t.kind === "table") for (const c of t.columns || []) sym[t.id + "." + c.id] = word(c.label).slice(0, 10);
      if (t.kind === "grid") sym[t.id] = word(t.label).slice(0, 10);
    }
    // Data symbols get primes when they clash.
    const seen = {};
    for (const k of Object.keys(sym)) if (!ix.decisions[k] && !ix.named[k]) { const s = sym[k] || "a"; seen[s] = (seen[s] || 0) + 1; if (seen[s] > 1) sym[k] = s + "′".repeat(seen[s] - 1); }

    const sub = (sets, n) => {
      const ks = sets.map((s) => {
        const at = n && n.at && n.at[s];
        if (typeof at === "string") return `\\text{${at}}|${esc(at)}`;
        if (at && at.shift) return `${idx[s]}${at.shift < 0 ? "-" : "+"}${Math.abs(at.shift)}|${idx[s]}${at.shift < 0 ? "−" : "+"}${Math.abs(at.shift)}`;
        return `${idx[s]}|${idx[s]}`;
      });
      return ks.length ? { tex: "_{" + ks.map((k) => k.split("|")[0]).join(",") + "}", html: "<sub>" + ks.map((k) => k.split("|")[1]).join(",") + "</sub>" } : { tex: "", html: "" };
    };
    // Each renderer returns [tex, html, precedence]; 3 atom, 2 product, 1 sum.
    function R(n) {
      if (!n || n.hole) return ["\\square", "□", 3];
      if (n.const !== undefined) return [num(n.const), esc(fmt(n.const)), 3];
      if (n.ref !== undefined) {
        const info = refInfo(ix, n.ref);
        if (!info) return ["?", "?", 3];
        if (info.kind === "prop") return [num(info.prop.value), esc(fmt(info.prop.value)), 3];
        const s = sym[n.ref] || "?", b = sub(info.sets, n);
        const ts = /^[a-z]{2,}/.test(s) ? `\\mathit{${s.replace(/′/g, "")}}${"'".repeat((s.match(/′/g) || []).length)}` : s;
        return [ts + b.tex, `<var>${esc(s)}</var>${b.html}`, 3];
      }
      const a = (n.args || []).map(R);
      const P = (x, p) => (x[2] < p ? ["\\left(" + x[0] + "\\right)", "(" + x[1] + ")"] : [x[0], x[1]]);
      switch (n.op) {
        case "add": { const l = P(a[0], 1), r = P(a[1], 1); return [l[0] + " + " + r[0], l[1] + " + " + r[1], 1]; }
        case "sub": { const l = P(a[0], 1), r = P(a[1], 2); return [l[0] + " - " + r[0], l[1] + " − " + r[1], 1]; }
        case "mul": { const l = P(a[0], 2), r = P(a[1], 2); return [l[0] + " \\cdot " + r[0], l[1] + "·" + r[1], 2]; }
        case "div": return ["\\frac{" + a[0][0] + "}{" + a[1][0] + "}", P(a[0], 3)[1] + " / " + P(a[1], 3)[1], 2];
        case "neg": { const x = P(a[0], 2); return ["-" + x[0], "−" + x[1], 2]; }
        case "paren": return ["\\left(" + a[0][0] + "\\right)", "(" + a[0][1] + ")", 3];
        case "pow": { const x = P(a[0], 3); return [x[0] + "^{" + a[1][0] + "}", x[1] + "<sup>" + a[1][1] + "</sup>", 3]; }
        case "sqrt": return ["\\sqrt{" + a[0][0] + "}", "√(" + a[0][1] + ")", 3];
        case "abs": return ["\\left|" + a[0][0] + "\\right|", "|" + a[0][1] + "|", 3];
        case "max": case "min": return [`\\${n.op}\\left(${a[0][0]}, ${a[1][0]}\\right)`, `${n.op}(${a[0][1]}, ${a[1][1]})`, 3];
        case "exp": return ["e^{" + a[0][0] + "}", "e<sup>" + a[0][1] + "</sup>", 3];
        case "log": return ["\\ln\\left(" + a[0][0] + "\\right)", "ln(" + a[0][1] + ")", 3];
        case "if": return [`\\begin{cases}${a[1][0]} & \\text{if } ${a[0][0]}\\\\ ${a[2][0]} & \\text{otherwise}\\end{cases}`, `(${a[1][1]} if ${a[0][1]}, else ${a[2][1]})`, 3];
        case "ge": case "le": case "gt": case "lt": case "eq": { const o = { ge: ["\\ge", "≥"], le: ["\\le", "≤"], gt: [">", "&gt;"], lt: ["<", "&lt;"], eq: ["=", "="] }[n.op]; return [a[0][0] + " " + o[0] + " " + a[1][0], a[0][1] + " " + o[1] + " " + a[1][1], 1]; }
        case "sum": case "avg": {
          const sets = [].concat(n.over), b = R(n.body), body = P(b, 2);
          const under = sets.map((s) => idx[s]).join(",");
          const t = (n.op === "avg" ? `\\frac{1}{|${idx[sets[0]].toUpperCase()}|}` : "") + `\\sum_{${under}} ` + body[0];
          return [t, (n.op === "avg" ? "avg" : "Σ") + `<sub>${under}</sub> ` + body[1], 2];
        }
        case "count": return [`|${[].concat(n.over).map((s) => idx[s].toUpperCase()).join("\\times ")}|`, `|${[].concat(n.over).map((s) => esc(setLabel(ix, s))).join(" × ")}|`, 3];
        case "lookup": return [`\\operatorname{lookup}\\left(${a[0][0]}\\right)`, `lookup(${a[0][1]})`, 3];
      }
      return ["?", "?", 3];
    }
    const forAll = (sets) => (sets && sets.length ? { tex: `\\quad \\forall ${sets.map((s) => idx[s]).join(",")}`, html: ` <span class="ps-m-all">for all ${sets.map((s) => `<var>${idx[s]}</var> ∈ ${esc(setLabel(ix, s))}`).join(", ")}</span>` } : { tex: "", html: "" });
    const opT = { ">=": ["\\ge", "≥"], "<=": ["\\le", "≤"], "=": ["=", "="] };
    const html = [], tex = [];
    // Index sets and data.
    const sets = Object.keys(idx);
    if (sets.length) html.push(`<p class="ps-m-h">Sets</p><ul>${sets.map((s) => `<li><var>${idx[s]}</var> ∈ ${esc(setLabel(ix, s))} (${keysOf(ix, s).length})</li>`).join("")}</ul>`);
    const data = [];
    for (const t of model.things || []) {
      if (t.kind === "table") for (const c of t.columns || []) data.push(`<li><var>${esc(sym[t.id + "." + c.id])}</var><sub>${idx[t.id]}</sub> = ${esc(c.label)}${c.unit ? " (" + esc(c.unit) + ")" : ""}</li>`);
      if (t.kind === "grid") data.push(`<li><var>${esc(sym[t.id])}</var><sub>${(t.over || []).map((s) => idx[s]).join(",")}</sub> = ${esc(t.label)}${t.unit ? " (" + esc(t.unit) + ")" : ""}</li>`);
    }
    if (data.length) html.push(`<p class="ps-m-h">Data</p><ul>${data.join("")}</ul>`);
    const dv = (model.decisions || []).filter((d) => !d.disabled).map((d) => {
      const b = sub(d.indexBy || []);
      const kind = d.type === "binary" ? "∈ {0, 1}" : d.type === "integer" ? "whole number" : "";
      return `<li><var>${esc(sym[d.id])}</var>${b.html} = ${esc(d.label)}${d.unit ? " (" + esc(d.unit) + ")" : ""}${kind ? ", " + kind : ""}</li>`;
    });
    html.push(`<p class="ps-m-h">Decision variables</p><ul>${dv.join("")}</ul>`);
    const named = (model.results || []).filter((r) => !r.disabled);
    if (named.length) {
      html.push(`<p class="ps-m-h">Where</p><ul>${named.map((r) => { const b = sub(r.indexBy || []), x = R(r.expr); tex.push(`${sym[r.id]}${b.tex} = ${x[0]}`); return `<li><var>${esc(sym[r.id])}</var>${b.html} = ${x[1]}${forAll(r.indexBy).html} <span class="ps-m-note">${esc(r.label)}</span></li>`; }).join("")}</ul>`);
    }
    const g = model.goal;
    if (g && g.expr) {
      const x = R(g.expr);
      const word = g.sense === "max" ? "Maximize" : g.sense === "target" ? (g.close ? "Minimize the distance of" : "Make") : "Minimize";
      const tail = g.sense === "target" ? ` = ${esc(fmt(g.targetValue))}` : "";
      html.push(`<p class="ps-m-h">${word}</p><p class="ps-m-goal"><var>Z</var> = ${x[1]}${tail} <span class="ps-m-note">${esc(g.label)}</span></p>`);
      tex.unshift(`\\${g.sense === "max" ? "max" : "min"}\\; Z = ${x[0]}${g.sense === "target" ? " = " + num(Number(g.targetValue)) : ""}`);
    }
    const st = [];
    for (const r of (model.rules || []).filter((r) => !r.disabled)) {
      if (r.kind === "pick") {
        const d = ix.decisions[r.decision]; if (!d) continue;
        const s = (d.indexBy || [])[0];
        st.push([`\\sum_{${idx[s]}} ${sym[d.id]}_{${idx[s]}} ${opT[r.op || "<="][0]} ${R(r.count)[0]}`, `Σ<sub>${idx[s]}</sub> <var>${sym[d.id]}</var><sub>${idx[s]}</sub> ${opT[r.op || "<="][1]} ${R(r.count)[1]}`, r.label]);
      } else if (r.kind === "different") {
        const d = ix.decisions[r.decision]; if (!d) continue;
        const [A, B] = d.indexBy || [];
        const v = sym[d.id], a = idx[A], b = idx[B];
        st.push([`\\sum_{${b}} ${v}_{${a},${b}} = 1 \\quad \\forall ${a}`, `Σ<sub>${b}</sub> <var>${v}</var><sub>${a},${b}</sub> = 1 <span class="ps-m-all">for all <var>${a}</var></span>`, r.label]);
        st.push([`\\sum_{${a}} ${v}_{${a},${b}} ${r.fillAll ? "=" : "\\le"} 1 \\quad \\forall ${b}`, `Σ<sub>${a}</sub> <var>${v}</var><sub>${a},${b}</sub> ${r.fillAll ? "=" : "≤"} 1 <span class="ps-m-all">for all <var>${b}</var></span>`, r.label]);
      } else {
        const l = R(r.lhs), rr = R(r.rhs), fa = forAll(r.forEach);
        if (r.op === "between") { const r2 = R(r.rhs2); st.push([`${rr[0]} \\le ${l[0]} \\le ${r2[0]}${fa.tex}`, `${rr[1]} ≤ ${l[1]} ≤ ${r2[1]}${fa.html}`, r.label]); }
        else { const o = opT[r.op || ">="]; st.push([`${l[0]} ${o[0]} ${rr[0]}${fa.tex}`, `${l[1]} ${o[1]} ${rr[1]}${fa.html}`, r.label]); }
      }
    }
    if (st.length) html.push(`<p class="ps-m-h">Subject to</p><ol>${st.map((s) => `<li>${s[1]} <span class="ps-m-note">${esc(s[2])}</span></li>`).join("")}</ol>`);
    const bounds = (model.decisions || []).filter((d) => !d.disabled && d.type !== "binary").map((d) => {
      const b = sub(d.indexBy || []), v = `<var>${esc(sym[d.id])}</var>${b.html}`;
      const lo = d.lower === undefined ? 0 : d.lower, hi = d.upper;
      const lt = typeof lo === "number" ? esc(fmt(lo)) : lo === null ? null : R(lo)[1];
      const ht = typeof hi === "number" ? esc(fmt(hi)) : hi === null || hi === undefined ? null : R(hi)[1];
      if (lt === null && ht === null) return `${v} free`;
      return (lt !== null ? lt + " ≤ " : "") + v + (ht !== null ? " ≤ " + ht : "");
    });
    if (bounds.length) html.push(`<p class="ps-m-h">Limits</p><p>${bounds.join(" ; ")}</p>`);
    for (const s of st) tex.push(s[0]);
    return { html: html.join(""), tex: tex.join("\\\\\n") };
  }

  /* ---------- numbers the way the page prints them ---------- */
  function fmt(v, unit) {
    if (v === null || v === undefined || v === "") return "—";
    v = Number(v);
    if (!Number.isFinite(v)) return v > 0 ? "no limit" : v < 0 ? "−no limit" : "—";
    if (Math.abs(v) < 1e-9) v = 0;
    const r = Math.round(v);
    const near = Math.abs(v - r) <= 1e-6 * Math.max(1, Math.abs(v));
    const a = Math.abs(v);
    const digits = near ? 0 : a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : 4;
    const money = unit && /^\s*[$€£]\s*$/.test(unit);
    let s = (near ? Math.abs(r) : a).toLocaleString("en-US", { maximumFractionDigits: money && !near ? 2 : digits, minimumFractionDigits: money && !near ? 2 : 0 });
    if (s === "0" && a > 0) s = a.toPrecision(2);
    const neg = v < 0 && s !== "0" ? "−" : "";
    if (money) return neg + unit.trim() + s;
    if (!unit) return neg + s;
    let u = unit.trim();
    if (/^[$€£]\s*\//.test(u)) return neg + u[0] + s + u.slice(1).replace(/^\s*\//, "/");
    if (near && Math.abs(r) === 1 && /[a-z]s$/i.test(u) && !/ss$/i.test(u)) u = u.slice(0, -1);
    return neg + s + (u === "%" ? "%" : " " + u);
  }

  // How nonlinear the model is as written, before any rewrite: 0 linear, 1 smooth, 2 jumps or corners.
  // (The Excel export uses it: Excel's Solver can't make Plain Solver's exact linear rewrites.)
  const worstKind = (E) => E.rows.reduce((w, r) => Math.max(w, kindOf(r.expr)[0]), E.goal ? kindOf(E.goal.tree)[0] : 0);

  // An expression's unit as text ("$" for $/chair × chairs), or "" when it has none or it's unclear.
  function unitOf(model, n) { const u = unitsOf(index(model), n, () => {}); return u ? unitText(u) : ""; }

  const api = { SCHEMA, unitOf, worstKind, index, refInfo, keysOf, setLabel, setOne, parse, expand, linearize, classify, writeLP, elastic, compileToLP,
    numeric, evaluate, gradient, names, toName, formula, parseNamed, parsePlain, readFormula, parseUnit, unitText, validate, uses, describe, say, sayRule, math, fmt, isC };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PSModel = api;
})(typeof self !== "undefined" ? self : this);
