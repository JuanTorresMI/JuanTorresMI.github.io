/* A model as a Solver-ready Excel workbook: one sheet with your data in yellow cells, the decisions
 * in blue cells (Solver's "variable cells", filled with Plain Solver's answer when there is one),
 * every result, rule and the goal as live formulas, and Excel's own Solver model stored in the
 * sheet, the way Excel saves it: hidden names solver_opt, solver_adj, solver_lhs1, … Open it, then
 * Data → Solver → Solve. Change the yellow cells and solve again.
 *
 *   PSExcel.build(model, answer) -> { sheets, notes, engine } | { error }
 *   (sheets go to APXlsx.blob, the planner's writer, which writes the names)
 *
 * Totals become SUM or SUMPRODUCT over ranges where the cells line up, and spill into helper cells
 * when a formula would be too long for Excel. "where" filters are applied with today's data; change
 * a list's links and download again. Runs in Node too (for the tests, which open the files in Excel).
 */
(function (root) {
  "use strict";
  const M = typeof module !== "undefined" && module.exports ? require("./model.js") : root.PSModel;
  const SHEET = "Model";
  const col = (i) => { let s = ""; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
  const A = (c, r) => "$" + col(c) + "$" + (r + 1);
  const num = (x) => String(Number(Number(x).toPrecision(15)));
  const SEP = "\u0001";
  const MAXF = 7000; // Excel allows 8,192 characters in a formula; leave room

  function combos(ix, sets) {
    let out = [[]];
    for (const s of sets) { const n = M.keysOf(ix, s).length, next = []; for (const c of out) for (let r = 0; r < n; r++) next.push(c.concat(r)); out = next; }
    return out;
  }
  // A list of cells as one range, if they are exactly one (in order: row by row, or column by column).
  function rect(cells) {
    if (!cells.length) return null;
    const cs = cells.map((p) => p[0]), rs = cells.map((p) => p[1]);
    const c0 = Math.min(...cs), c1 = Math.max(...cs), r0 = Math.min(...rs), r1 = Math.max(...rs);
    if ((c1 - c0 + 1) * (r1 - r0 + 1) !== cells.length) return null;
    const seen = new Set(cells.map((p) => p[0] + "," + p[1]));
    if (seen.size !== cells.length) return null;
    return { c0, c1, r0, r1, s: cells.length === 1 ? A(c0, r0) : A(c0, r0) + ":" + A(c1, r1) };
  }
  // Two lists of cells as ranges of the same shape, matched cell for cell (for SUMPRODUCT).
  function aligned(a, b) {
    const ra = rect(a), rb = rect(b);
    if (!ra || !rb || ra.c1 - ra.c0 !== rb.c1 - rb.c0 || ra.r1 - ra.r0 !== rb.r1 - rb.r0) return null;
    for (let i = 0; i < a.length; i++) if (a[i][0] - ra.c0 !== b[i][0] - rb.c0 || a[i][1] - ra.r0 !== b[i][1] - rb.r0) return null;
    return [ra.s, rb.s];
  }

  function build(model, answer) {
    const ix = M.index(model);
    const E = M.expand(model);
    if (E.errors.length) return { error: "The model has things to fix first: " + E.errors[0].text };
    if (!E.goal) return { error: "The model needs a goal first." };
    const rows = [], put = (c, r, v) => { (rows[r] = rows[r] || [])[c] = v; };
    const notes = [];
    let r = 0;
    const keys = (s) => M.keysOf(ix, s);
    const start = new Map();
    if (answer && answer.ok && answer.decisions) for (const [id, es] of Object.entries(answer.decisions)) for (const e of es) start.set(id + SEP + e.keys.join(SEP), e.value);

    put(0, r++, { v: `${model.title || "Model"}, from Plain Solver`, s: "bold" });
    put(0, r++, "To solve: Data → Solver → Solve. If Solver isn't on the Data tab: File → Options → Add-ins → Manage Excel Add-ins → Go → tick Solver Add-in.");
    put(0, r++, "Yellow cells are your data: change them and solve again. Blue cells are what Solver decides" + (answer && answer.ok ? " (Plain Solver's answer is already in them)." : "."));
    r++;

    // Where each piece of data, decision and result lives.
    const at = { prop: {}, col: {}, grid: {}, dec: {}, res: {} };
    const section = (t) => { put(0, r++, { v: t, s: "head" }); };
    // A block of cells for something indexed by 0, 1, 2 or more lists; returns a function from the
    // row numbers of its lists to the cell, and the block's cells in order.
    function block(sets, label, unit, cellFor) {
      const map = new Map(), order = [];
      if (!sets.length) {
        put(0, r, label); put(1, r, cellFor([], [])); if (unit) put(2, r, unit);
        map.set("", [1, r]); order.push([1, r]); r++;
      } else if (sets.length === 2) {
        const [a, b] = sets, ka = keys(a), kb = keys(b);
        put(0, r++, { v: label + (unit ? ` (${unit})` : ""), s: "bold" });
        put(0, r, M.setOne(ix, a) + " \\ " + M.setOne(ix, b));
        kb.forEach((k, j) => put(1 + j, r, { v: k, s: "bold" }));
        r++;
        ka.forEach((ka1, i) => { put(0, r, ka1); kb.forEach((kb1, j) => { put(1 + j, r, cellFor([i, j], [ka1, kb1])); map.set(i + SEP + j, [1 + j, r]); order.push([1 + j, r]); }); r++; });
      } else {
        put(0, r++, { v: label + (unit ? ` (${unit})` : ""), s: "bold" });
        for (const c of combos(ix, sets)) {
          const ks = c.map((x, k) => keys(sets[k])[x]);
          put(0, r, ks.join(" · ")); put(1, r, cellFor(c, ks));
          map.set(c.join(SEP), [1, r]); order.push([1, r]); r++;
        }
      }
      r++;
      return { map, order };
    }

    // 1. Data.
    section("WHAT YOU KNOW");
    for (const t of model.things) {
      if (t.kind === "single") {
        put(0, r++, { v: t.label, s: "bold" });
        for (const p of t.properties || []) { put(0, r, p.label); put(1, r, { v: Number(p.value), s: "input" }); if (p.unit) put(2, r, p.unit); at.prop[t.id + "." + p.id] = [1, r]; r++; }
        r++;
      } else if (t.kind === "table") {
        put(0, r++, { v: t.label, s: "bold" });
        const cols = t.columns || [];
        put(0, r, { v: t.one || t.label, s: "head" });
        cols.forEach((c, j) => put(1 + j, r, { v: c.label + (c.unit ? ` (${c.unit})` : ""), s: "head" }));
        r++;
        const r0 = r;
        t.rows.forEach((row, i) => {
          put(0, r, String(row.key));
          cols.forEach((c, j) => put(1 + j, r, !c.kind || c.kind === "number" ? { v: Number(row[c.id]), s: "input" } : String(row[c.id] ?? "")));
          r++;
        });
        cols.forEach((c, j) => { at.col[t.id + "." + c.id] = { c: 1 + j, r0 }; });
        at.col[t.id + ".#key"] = { c: 0, r0 };
        r++;
      } else if (t.kind === "grid") {
        const [a, b] = t.over || [];
        const ka = keys(a), kb = keys(b);
        put(0, r++, { v: t.label + (t.unit ? ` (${t.unit})` : ""), s: "bold" });
        put(0, r, M.setOne(ix, a) + " \\ " + M.setOne(ix, b));
        kb.forEach((k, j) => put(1 + j, r, { v: k, s: "bold" }));
        r++;
        const g = (at.grid[t.id] = {});
        ka.forEach((ka1) => { put(0, r, ka1); kb.forEach((kb1, j) => { put(1 + j, r, { v: Number(((t.values || {})[ka1] || {})[kb1]), s: "input" }); g[ka1 + SEP + kb1] = [1 + j, r]; }); r++; });
        r++;
      }
    }

    // 2. Decisions: Solver's variable cells.
    section("WHAT SOLVER DECIDES");
    const decBlocks = [];
    for (const d of model.decisions) {
      if (d.disabled) continue;
      const sets = d.indexBy || [];
      const kind = d.type === "binary" ? "yes (1) or no (0)" : d.type === "integer" ? "whole number" : "";
      const b = block(sets, d.label + (kind && sets.length ? `, ${kind}` : ""), d.unit, (c, ks) => ({ v: start.get(d.id + SEP + ks.join(SEP)) ?? 0, s: "change" }));
      if (!sets.length && kind) put(3, b.order[0][1], kind);
      at.dec[d.id] = b.map;
      decBlocks.push({ d, ...b });
    }

    // 3. Results: laid out now, filled in once every address is known.
    const resBlocks = [];
    if (model.results.some((x) => !x.disabled)) section("WHAT IT WORKS OUT TO");
    for (const res of model.results) {
      if (res.disabled) continue;
      const b = block(res.indexBy || [], res.label, res.unit, () => null);
      at.res[res.id] = b.map;
      resBlocks.push({ res, ...b });
    }

    // Formulas. f(node, env) -> { s, cell?, prod?, k? }: a formula, plus what it is when it's a single
    // cell, a product of two cells, or a number, so totals can become ranges.
    const workings = [];
    function cellOf(n, env) {
      const info = M.refInfo(ix, n.ref);
      if (!info) throw new Error("A sentence uses something that no longer exists.");
      const idx = [];
      for (const s of info.sets) {
        const a = n.at && n.at[s];
        let i;
        if (typeof a === "string") i = keys(s).indexOf(a);
        else if (a && a.via) { const [t, c] = a.via.split("."); i = keys(s).indexOf(String(ix.sets[t].rows[env[t]][c])); }
        else { i = env[s] + (a && a.shift ? a.shift : 0); if (i < 0 || i >= keys(s).length) return { out: true }; }
        idx.push(i);
      }
      if (info.kind === "prop") return { cell: at.prop[n.ref] };
      if (info.kind === "col") return { cell: [at.col[n.ref].c, at.col[n.ref].r0 + idx[0]] };
      if (info.kind === "grid") { const ks = info.sets.map((s, k) => keys(s)[idx[k]]); return { cell: at.grid[n.ref][ks.join(SEP)] }; }
      if (info.kind === "decision") { if (info.item.disabled) return { zero: true }; return { cell: at.dec[n.ref].get(idx.join(SEP)) }; }
      if (info.kind === "result") { if (info.item.disabled) return { zero: true }; return { cell: at.res[n.ref].get(idx.join(SEP)) }; }
    }
    // "where" filters, applied to today's data.
    function dv(n, env) {
      if (n.const !== undefined) return Number(n.const);
      if (n.text !== undefined) return n.text;
      if (n.key !== undefined && !n.op) return keys(n.key)[env[n.key]];
      if (n.ref !== undefined) {
        const info = M.refInfo(ix, n.ref), c = cellOf(n, env);
        if (c.out) return n.otherwise ? dv(n.otherwise, env) : 0;
        if (info.kind === "prop") return Number(info.prop.value);
        if (info.kind === "col") { const row = info.thing.rows[c.cell[1] - at.col[n.ref].r0]; const v = row[info.col.id]; return !info.col.kind || info.col.kind === "number" ? Number(v) : String(v ?? ""); }
        const ks = info.sets.map((s) => keys(s)[env[s]]);
        return Number(((info.item.values || {})[ks[0]] || {})[ks[1]]);
      }
      const a = n.args || [];
      const cmp = (x, y) => (x !== "" && y !== "" && Number.isFinite(Number(x)) && Number.isFinite(Number(y)) ? Math.sign(Number(x) - Number(y)) : String(x) === String(y) ? 0 : String(x) < String(y) ? -1 : 1);
      switch (n.op) {
        case "paren": return dv(a[0], env);
        case "and": return !!dv(a[0], env) && !!dv(a[1], env);
        case "or": return !!dv(a[0], env) || !!dv(a[1], env);
        case "not": return !dv(a[0], env);
        case "eq": return cmp(dv(a[0], env), dv(a[1], env)) === 0;
        case "ne": return cmp(dv(a[0], env), dv(a[1], env)) !== 0;
        case "ge": return cmp(dv(a[0], env), dv(a[1], env)) >= 0;
        case "le": return cmp(dv(a[0], env), dv(a[1], env)) <= 0;
        case "gt": return cmp(dv(a[0], env), dv(a[1], env)) > 0;
        case "lt": return cmp(dv(a[0], env), dv(a[1], env)) < 0;
        default: return Number(dv(a[0], env));
      }
    }
    function rowsOf(sets, where, env) {
      return combos(ix, sets).filter((c) => { if (!where) return true; const e2 = { ...env }; sets.forEach((s, k) => (e2[s] = c[k])); return !!dv(where, e2); });
    }
    const P = (x) => (x.cell || x.k !== undefined ? x.s : "(" + x.s + ")");
    // Every leaf term of a (possibly nested) total, so a total over a grid can be one SUMPRODUCT.
    function terms(n, env) {
      if (n.op === "sum") {
        const sets = [].concat(n.over);
        return rowsOf(sets, n.where, env).flatMap((c) => { const e2 = { ...env }; sets.forEach((s, k) => (e2[s] = c[k])); return terms(n.body, e2); });
      }
      if (n.op === "paren") return terms(n.args[0], env);
      return [f(n, env)];
    }
    function total(ts) {
      if (!ts.length) return { s: "0", k: 0 };
      if (ts.length === 1) return ts[0];
      if (ts.every((t) => t.cell)) { const g = rect(ts.map((t) => t.cell)); if (g) return { s: `SUM(${g.s})` }; }
      if (ts.every((t) => t.prod)) {
        const al = aligned(ts.map((t) => t.prod[0]), ts.map((t) => t.prod[1]));
        if (al) return { s: `SUMPRODUCT(${al[0]},${al[1]})` };
        for (const [x, y] of [[0, 1], [1, 0]]) {
          const first = ts[0].prod[x];
          if (ts.every((t) => t.prod[x][0] === first[0] && t.prod[x][1] === first[1])) { const g = rect(ts.map((t) => t.prod[y])); if (g) return { s: `${A(...first)}*SUM(${g.s})` }; }
        }
      }
      const joined = ts.map(P).join("+");
      if (joined.length <= MAXF) return { s: joined };
      // Too long for one formula: each term gets a helper cell, and the total sums them.
      const cells = ts.map((t) => { workings.push(t.s); return null; });
      const startAt = workings.length - ts.length;
      return { s: `SUM(@W${startAt}:${workings.length - 1}@)`, cells };
    }
    function f(n, env) {
      if (!n || n.hole) throw new Error("A sentence has an empty spot.");
      if (n.const !== undefined) return { s: num(n.const), k: Number(n.const) };
      if (n.ref !== undefined) {
        const c = cellOf(n, env);
        if (c.zero) return { s: "0", k: 0 };
        if (c.out) return n.otherwise ? f(n.otherwise, env) : { s: "0", k: 0 };
        if (!c.cell) throw new Error("A reference couldn't be placed on the sheet.");
        return { s: A(...c.cell), cell: c.cell };
      }
      const a = n.args || [];
      const two = (op) => { const x = f(a[0], env), y = f(a[1], env); return [x, y, P(x) + op + P(y)]; };
      switch (n.op) {
        case "paren": return f(a[0], env);
        case "add": return { s: two("+")[2] };
        case "sub": return { s: two("-")[2] };
        case "mul": { const [x, y, s] = two("*"); return x.cell && y.cell ? { s, prod: [x.cell, y.cell] } : { s }; }
        case "div": return { s: two("/")[2] };
        case "neg": return { s: "-" + P(f(a[0], env)) };
        case "pow": return { s: two("^")[2] };
        case "sqrt": return { s: `SQRT(${f(a[0], env).s})` };
        case "abs": return { s: `ABS(${f(a[0], env).s})` };
        case "exp": return { s: `EXP(${f(a[0], env).s})` };
        case "log": return { s: `LN(${f(a[0], env).s})` };
        case "max": case "min": return { s: `${n.op.toUpperCase()}(${f(a[0], env).s},${f(a[1], env).s})` };
        case "if": return { s: `IF(${cond(a[0], env)},${f(a[1], env).s},${f(a[2], env).s})` };
        case "ge": case "le": case "gt": case "lt": case "eq": case "ne": return { s: `IF(${cond(n, env)},1,0)` };
        case "sum": return total(terms(n, env));
        case "avg": { const sets = [].concat(n.over); const t = total(terms({ ...n, op: "sum" }, env)); return { s: `(${t.s})/${rowsOf(sets, n.where, env).length}` }; }
        case "count": return { s: String(rowsOf([].concat(n.over), n.where, env).length), k: rowsOf([].concat(n.over), n.where, env).length };
        case "lookup": {
          const t = ix.sets[n.table], kc = at.col[n.table + "." + (n.key === "#key" ? "#key" : n.key)], vc = at.col[n.table + "." + n.value];
          const rng = (c) => A(c.c, c.r0) + ":" + A(c.c, c.r0 + t.rows.length - 1);
          return { s: `LOOKUP(${f(a[0], env).s},${rng(kc)},${rng(vc)})` };
        }
      }
      throw new Error("Something in the model can't be written as an Excel formula.");
    }
    function cond(n, env) {
      const ops = { ge: ">=", le: "<=", gt: ">", lt: "<", eq: "=", ne: "<>" };
      if (ops[n.op]) return P(f(n.args[0], env)) + ops[n.op] + P(f(n.args[1], env));
      return P(f(n, env)) + "<>0";
    }
    const formula = (n, env, style) => { const x = f(n, env); return { f: x.s, s: style || "n2", _w: x.cells }; };

    try {
      // Results.
      for (const { res } of resBlocks) {
        const sets = res.indexBy || [];
        for (const c of combos(ix, sets)) {
          const env = {};
          sets.forEach((s, k) => (env[s] = c[k]));
          const [cc, rr] = at.res[res.id].get(c.join(SEP)) || at.res[res.id].get("");
          put(cc, rr, formula(res.expr, env));
        }
      }
      // Rules: one block of rows per rule part, so each is one Solver constraint (range ≤ range).
      const cons = [];
      section("RULES");
      put(0, r, { v: "Rule", s: "head" }); put(1, r, { v: "Left side", s: "head" }); put(2, r, { v: "", s: "head" }); put(3, r, { v: "Right side", s: "head" }); put(4, r, { v: "Room to spare", s: "head" });
      r++;
      const REL = { "<=": 1, "=": 2, ">=": 3 }, SIGN = { "<=": "≤", "=": "=", ">=": "≥" };
      const partRows = (label, list) => {
        // list: [{ keys, L: cell, op, R: cell }] all with the same op
        if (!list.length) return;
        const r0 = r;
        for (const it of list) {
          put(0, r, label + (it.keys.length ? " · " + it.keys.join(", ") : ""));
          put(1, r, it.L); put(2, r, SIGN[it.op]); put(3, r, it.R);
          put(4, r, { f: it.op === "<=" ? `${A(3, r)}-${A(1, r)}` : it.op === ">=" ? `${A(1, r)}-${A(3, r)}` : `ABS(${A(1, r)}-${A(3, r)})`, s: "n2" });
          r++;
        }
        cons.push([`${SHEET}!${A(1, r0)}${r - 1 > r0 ? ":" + A(1, r - 1) : ""}`, REL[list[0].op], `${SHEET}!${A(3, r0)}${r - 1 > r0 ? ":" + A(3, r - 1) : ""}`]);
      };
      for (const rule of model.rules) {
        if (rule.disabled) continue;
        const kind = rule.kind || "compare";
        if (kind === "compare") {
          const sets = rule.forEach || [];
          const cs = rowsOf(sets, sets.length ? rule.where : null, {});
          const parts = rule.op === "between" ? [[">=", "rhs"], ["<=", "rhs2"]] : [[rule.op || ">=", "rhs"]];
          for (const [op, side] of parts) {
            partRows(rule.label, cs.map((c) => {
              const env = {};
              sets.forEach((s, k) => (env[s] = c[k]));
              return { keys: c.map((x, k) => keys(sets[k])[x]), L: formula(rule.lhs, env), op, R: formula(rule[side], env) };
            }));
          }
        } else if (kind === "pick") {
          const d = ix.decisions[rule.decision];
          if (!d || d.disabled) continue;
          const cells = [...at.dec[d.id].values()];
          partRows(rule.label, [{ keys: [], L: { f: `SUM(${rect(cells) ? rect(cells).s : cells.map((c) => A(...c)).join(",")})`, s: "n2" }, op: rule.op || "<=", R: formula(rule.count, {}) }]);
        } else if (kind === "different") {
          const d = ix.decisions[rule.decision];
          if (!d || d.disabled) continue;
          const [Aset, Bset] = d.indexBy || [];
          const m = at.dec[d.id], ka = keys(Aset), kb = keys(Bset);
          partRows(rule.label, ka.map((k, i) => ({ keys: [k], L: { f: `SUM(${rect(kb.map((_, j) => m.get(i + SEP + j))).s})`, s: "n0" }, op: "=", R: 1 })));
          partRows(rule.label, kb.map((k, j) => ({ keys: [k], L: { f: `SUM(${rect(ka.map((_, i) => m.get(i + SEP + j))).s})`, s: "n0" }, op: rule.fillAll ? "=" : "<=", R: 1 })));
        }
      }
      r++;

      // Limits on decisions, as Solver constraints (with helper cells when they come from data).
      let needNeg = false;
      for (const { d, order, map } of decBlocks) {
        const range = (cells) => { const g = rect(cells); return g ? g.s : cells.map((c) => A(...c)).join(","); };
        const ref = `${SHEET}!${range(order)}`;
        if (d.type === "integer") cons.push([ref, 4, '"integer"']);
        if (d.type === "binary") { cons.push([ref, 5, '"binary"']); continue; }
        if (d.lower === null) needNeg = true;
        for (const [side, op] of [["upper", 1], ["lower", 3]]) {
          const b = d[side];
          if (b === undefined || b === null || (side === "lower" && b === 0)) continue;
          if (typeof b === "number") { cons.push([ref, op, num(b)]); continue; }
          // A limit from data: one helper cell per decision cell, below the others.
          put(0, r++, { v: `${d.label}: ${side === "upper" ? "at most" : "at least"}`, s: "bold" });
          const helpers = [];
          for (const c of combos(ix, d.indexBy || [])) {
            const env = {};
            (d.indexBy || []).forEach((s, k) => (env[s] = c[k]));
            put(0, r, c.map((x, k) => keys(d.indexBy[k])[x]).join(" · ") || d.label);
            put(1, r, formula(b, env));
            helpers.push([1, r]);
            r++;
          }
          r++;
          // Same shape as the decision cells only when they're one column; otherwise one constraint per cell.
          if (rect(order) && rect(helpers) && order.every((c) => c[0] === order[0][0])) cons.push([ref, op, `${SHEET}!${rect(helpers).s}`]);
          else order.forEach((c, i) => cons.push([`${SHEET}!${A(...c)}`, op, `${SHEET}!${A(...helpers[i])}`]));
          void map;
        }
      }
      // Decisions that must stay at or above zero, when some others may go negative.
      if (needNeg) for (const { d, order } of decBlocks) if (d.type !== "binary" && (d.lower === undefined || d.lower === 0)) cons.push([`${SHEET}!${rect(order) ? rect(order).s : order.map((c) => A(...c)).join(",")}`, 3, "0"]);

      // The goal.
      section("GOAL");
      const g = model.goal;
      put(0, r, g.label || "Goal");
      put(1, r, formula(g.expr, {}, "n2b"));
      put(2, r, g.sense === "max" ? "as high as possible" : g.sense === "min" ? "as low as possible" : g.close ? `as close as possible to ${g.targetValue}` : `equal to ${g.targetValue}`);
      const goalCell = [1, r];
      r += 2;
      if (g.sense === "target" && g.close) notes.push("Excel's Solver has no “as close as possible to”; the workbook asks for “value of” the target instead.");

      // Helper cells for long totals.
      if (workings.length) {
        section("WORKINGS (parts of long totals)");
        const w0 = r;
        workings.forEach((s) => { put(1, r, { f: s, s: "n2" }); r++; });
        // Point each SUM(@Wa:b@) at its helper cells.
        for (const row of rows) if (row) for (const c of row) if (c && c.f) c.f = c.f.replace(/@W(\d+):(\d+)@/g, (_, a, b) => `${A(1, w0 + Number(a))}:${A(1, w0 + Number(b))}`);
      }

      // Excel's Solver model, stored the way Excel stores it.
      const worst = M.worstKind(E);
      const eng = worst === 0 ? 2 : worst === 1 ? 1 : 3;
      const adj = decBlocks.map(({ order }) => { const g2 = rect(order); return g2 ? `${SHEET}!${g2.s}` : order.map((c) => `${SHEET}!${A(...c)}`).join(","); }).join(",");
      const names = [
        ["solver_adj", adj], ["solver_opt", `${SHEET}!${A(...goalCell)}`],
        ["solver_typ", String(g.sense === "max" ? 1 : g.sense === "min" ? 2 : 3)], ["solver_val", num(g.sense === "target" ? g.targetValue : 0)],
        ["solver_eng", String(eng)], ["solver_neg", needNeg ? "2" : "1"], ["solver_num", String(cons.length)],
        ["solver_tim", String((model.options && model.options.timeLimitSec) || 30)], ["solver_tol", num((model.options && model.options.mipGap) || 0)],
        ["solver_ver", "3"],
      ];
      cons.forEach(([l, rel, rh], i) => names.push([`solver_lhs${i + 1}`, l], [`solver_rel${i + 1}`, String(rel)], [`solver_rhs${i + 1}`, rh]));

      const nVars = decBlocks.reduce((s, b) => s + b.order.length, 0);
      if (nVars > 200) notes.push(`This model has ${nVars.toLocaleString("en-US")} decision cells; Excel's built-in Solver takes up to 200. The workbook opens and calculates; to solve it in Excel, use OpenSolver (free) or Analytic Solver, which read the same setup.`);
      if (eng === 3) notes.push("Excel's Evolutionary method needs a lowest and highest value on every decision; add limits to any decision that doesn't have them.");
      if (eng !== 2 && worst >= 1 && E.vars.length) notes.push(eng === 1 ? "Excel will use GRG Nonlinear for this model." : "Excel will use Evolutionary for this model.");
      if (rules().some((x) => x.where)) notes.push("“where” filters were applied with today's data; if you change which rows link where, download the workbook again.");

      const width = Math.max(...rows.filter(Boolean).map((x) => x.length), 5);
      const sheet = { name: SHEET, widths: [34].concat(Array(width - 1).fill(14)), rows: Array.from({ length: rows.length }, (_, i) => rows[i] || []), names };
      return { sheets: [sheet], notes, engine: ["", "GRG Nonlinear", "Simplex LP", "Evolutionary"][eng], cells: nVars, constraints: cons.length };
    } catch (e) {
      return { error: e.message || String(e) };
    }
    function rules() { return model.rules.filter((x) => !x.disabled); }
  }

  const api = { build };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PSExcel = api;
})(typeof self !== "undefined" ? self : this);
