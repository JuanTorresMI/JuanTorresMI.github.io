/* Plain Solver's page: the sentence builder, the results, what-if, reports, sharing.
 * The model (see model.js) is the only state that matters; everything on screen is drawn from it.
 * Structural edits (a select, a button) redraw the builder; typing edits the model in place and
 * only refreshes the checks, so the cursor stays where it is.
 */
(function () {
  "use strict";
  const M = window.PSModel, TPL = window.PSTemplates, ENG = window.PSEngine;
  const $ = (s, r) => (r || document).querySelector(s);
  const KEY = "plain-solver:model:v1", MINE = "plain-solver:templates:v1";
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode: nothing to keep */ } },
  };

  /* ---------- tiny DOM helper ---------- */
  function h(sel, attrs, ...kids) {
    const [tag, ...cls] = sel.split(".");
    const e = document.createElement(tag || "div");
    if (cls.length) e.className = cls.join(" ");
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "on") for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
      else if (k === "text") e.textContent = v;
      else if (k === "html") e.innerHTML = v;
      else if (k in e && typeof v !== "string") e[k] = v;
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
    return e;
  }
  const opt = (value, label, selected) => h("option", { value, selected: !!selected }, label);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const fmt = M.fmt;
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  /* ---------- state ---------- */
  const blankModel = () => ({ schemaVersion: 1, title: "My model", things: [], decisions: [], results: [], rules: [], goal: { label: "Total cost", sense: "min", expr: { hole: true } }, options: { engine: "auto", timeLimitSec: 30, mipGap: 0.0001 } });
  let model = blankModel();
  let past = [], future = [];
  let last = null;          // the last answer
  let lastModel = null;     // the model it answered
  let fromTemplate = null;
  let showMath = false;

  function normalize(m) {
    m.schemaVersion = m.schemaVersion || 1;
    for (const k of ["things", "decisions", "results", "rules"]) m[k] = m[k] || [];
    m.goal = m.goal || { label: "Total cost", sense: "min", expr: { hole: true } };
    m.options = Object.assign({ engine: "auto", timeLimitSec: 30, mipGap: 0.0001 }, m.options || {});
    return m;
  }
  function snapshot() { past.push(JSON.stringify(model)); if (past.length > 200) past.shift(); future = []; }
  // A structural edit: remember the model, change it, redraw.
  function edit(fn) { snapshot(); fn(model); changed(true); }
  // After any change: save, check, and redraw the builder only when the structure changed.
  function changed(redraw) {
    store.set(KEY, JSON.stringify(model));
    if (redraw) renderBuilder();
    soft();
  }
  const soft = debounce(() => { renderChecks(); renderPreview(); markStale(); if (showMath) renderMath(); }, 120);
  function undo() { if (!past.length) return; future.push(JSON.stringify(model)); model = JSON.parse(past.pop()); changed(true); }
  function redo() { if (!future.length) return; past.push(JSON.stringify(model)); model = JSON.parse(future.pop()); changed(true); }

  // Typing: remember the model when a field is entered, and keep that as an undo step if it changed.
  let typingFrom = null;
  document.addEventListener("focusin", (e) => { if (e.target.closest && e.target.closest(".ps") && /INPUT|TEXTAREA/.test(e.target.tagName)) typingFrom = JSON.stringify(model); });
  document.addEventListener("change", (e) => {
    if (!typingFrom || !/INPUT|TEXTAREA/.test(e.target.tagName)) return;
    const now = JSON.stringify(model);
    // An edit() in this field's own change handler may already have kept the same step.
    if (now !== typingFrom && past[past.length - 1] !== typingFrom) { past.push(typingFrom); future = []; }
    typingFrom = now;
  });

  /* ---------- ids ---------- */
  function allIds() {
    const s = new Set();
    for (const t of model.things) { s.add(t.id); for (const p of t.properties || []) s.add(t.id + "." + p.id); for (const c of t.columns || []) s.add(t.id + "." + c.id); }
    for (const k of ["decisions", "results", "rules"]) for (const x of model[k]) s.add(x.id);
    return s;
  }
  function uid(label, taken) {
    taken = taken || allIds();
    let base = String(label || "item").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 3).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join("") || "item";
    if (/^\d/.test(base)) base = "n" + base;
    let id = base, k = 2;
    while (taken.has(id)) id = base + k++;
    return id;
  }
  const tables = () => model.things.filter((t) => t.kind === "table");
  const ix = () => M.index(model);

  /* ---------- walking every expression in the model ---------- */
  function eachExpr(fn) {
    const walk = (n) => { if (!n || typeof n !== "object") return; fn(n); (n.args || []).forEach(walk); if (n.body) walk(n.body); if (n.otherwise) walk(n.otherwise); if (n.where) walk(n.where); };
    for (const d of model.decisions) { if (d.lower && typeof d.lower === "object") walk(d.lower); if (d.upper && typeof d.upper === "object") walk(d.upper); }
    for (const r of model.results) walk(r.expr);
    for (const r of model.rules) { walk(r.lhs); walk(r.rhs); walk(r.rhs2); walk(r.count); walk(r.where); }
    walk(model.goal && model.goal.expr);
  }
  function renameKey(setId, from, to) {
    for (const t of model.things) if (t.kind === "grid" && t.values) {
      if (t.over[0] === setId && t.values[from]) { t.values[to] = t.values[from]; delete t.values[from]; }
      if (t.over[1] === setId) for (const r of Object.values(t.values)) if (r && from in r) { r[to] = r[from]; delete r[from]; }
    }
    eachExpr((n) => { if (n.at && n.at[setId] === from) n.at[setId] = to; });
    // Link cells that name the row follow it.
    for (const t of model.things) if (t.kind === "table") for (const c of t.columns || []) if (c.kind === "link" && c.links === setId) for (const r of t.rows) if (String(r[c.id]) === from) r[c.id] = to;
  }

  /* ---------- the expression editor ---------- */
  // An expression is edited as a flat run of values and operators; groups keep their parentheses.
  const SUMS = { add: 1, sub: 1 }, PRODS = { mul: 1, div: 1 };
  const group = (n) => ({ t: "v", n: { op: "paren", args: [n] } });
  function toTokens(n) {
    if (n && SUMS[n.op]) {
      const R = n.args[1];
      const right = R && SUMS[R.op] ? (n.op === "add" ? toTokens(R) : [group(R)]) : prodTokens(R);
      return [...toTokens(n.args[0]), { t: "o", op: n.op }, ...right];
    }
    return prodTokens(n);
  }
  function prodTokens(n) {
    if (n && PRODS[n.op]) {
      const L = n.args[0], R = n.args[1];
      const left = L && SUMS[L.op] ? [group(L)] : prodTokens(L);
      const right = R && (SUMS[R.op] || (n.op === "div" && PRODS[R.op])) ? [group(R)] : prodTokens(R);
      return [...left, { t: "o", op: n.op }, ...right];
    }
    if (n && SUMS[n.op]) return [group(n)];
    return [{ t: "v", n: n || { hole: true } }];
  }
  function fromTokens(ts) {
    let i = 0;
    const prod = () => { let a = ts[i++].n; while (i < ts.length && PRODS[ts[i].op]) { const op = ts[i++].op; a = { op, args: [a, ts[i++].n] }; } return a; };
    let a = prod();
    while (i < ts.length) { const op = ts[i++].op; a = { op, args: [a, prod()] }; }
    return a;
  }

  const FUNCS = [
    ["sum", "total of … across …"], ["avg", "average of … across …"], ["count", "number of …"], ["paren", "( … ) a group"],
    ["sq", "… squared"], ["pow", "… to the power of …"], ["sqrt", "square root of …"], ["abs", "size of … (ignoring sign)"],
    ["max", "larger of … and …"], ["min", "smaller of … and …"], ["if", "if … then … otherwise …"], ["lookup", "look up … in a table"],
    ["exp", "e to the power of …"], ["log", "natural log of …"],
  ];
  const OPWORD = { add: "plus", sub: "minus", mul: "times", div: "divided by" };
  const CMP = [["ge", "is at least"], ["le", "is at most"], ["gt", "is more than"], ["lt", "is less than"], ["eq", "equals"]];

  // What a value slot can hold here: data, decisions and results, with tables' columns only where
  // a row is known ("for each" or "total of" around it), or else with a row picked.
  function catalog(ctx) {
    // One menu group per thing or list, so a chip shows just the name ("profit per chair").
    const groups = {}, grids = [];
    for (const t of model.things) {
      if (t.kind === "single") groups[t.label] = (t.properties || []).map((p) => ["ref:" + t.id + "." + p.id, p.label]);
      if (t.kind === "table") groups[t.label] = (t.columns || []).filter((c) => !c.kind || c.kind === "number").map((c) => ["ref:" + t.id + "." + c.id, `${c.label} (${ctx.bound.includes(t.id) ? "this " + (t.one || t.label).toLowerCase() : anA((t.one || t.label).toLowerCase(), "pick")})`]);
      if (t.kind === "grid") grids.push(["ref:" + t.id, t.label]);
    }
    if (grids.length) groups.Grids = grids;
    groups.Decisions = model.decisions.map((d) => ["ref:" + d.id, d.label + (d.disabled ? " (off)" : "")]);
    groups.Results = model.results.filter((r) => r.id !== ctx.self).map((r) => ["ref:" + r.id, r.label]);
    return groups;
  }
  const anA = (w, verb) => `${verb} ${/^[aeiou]/i.test(w) ? "an" : "a"} ${w}`;
  function kindSelect(cur, ctx, onPick, label, removable) {
    const s = h("select.ps-chip.ps-pick", { "aria-label": label || "Choose what goes here", "data-k": ctx.key + ":k" });
    if (cur === "hole") s.append(opt("", "choose…", true));
    s.append(h("optgroup", { label: "Type" }, opt("#num", "a number", cur === "#num")));
    const g = catalog(ctx);
    for (const [name, items] of Object.entries(g)) if (items.length) s.append(h("optgroup", { label: name }, items.map(([v, l]) => opt(v, l, v === cur))));
    s.append(h("optgroup", { label: "Math" }, FUNCS.map(([v, l]) => opt("#" + v, l, "#" + v === cur))));
    if (removable) s.append(h("optgroup", { label: "—" }, opt("#remove", "remove this")));
    s.addEventListener("change", () => onPick(s.value));
    return s;
  }
  // The node a choice makes, keeping what was there inside it where that makes sense.
  function nodeFor(choice, old, ctx) {
    const inner = old && !old.hole ? old : { hole: true };
    if (choice === "#num") return { const: old && old.const !== undefined ? old.const : 0 };
    if (choice.startsWith("ref:")) {
      const id = choice.slice(4), info = M.refInfo(ix(), id), n = { ref: id };
      for (const s of (info && info.sets) || []) if (!ctx.bound.includes(s)) {
        n.at = n.at || {};
        const I = ix(), link = ctx.bound.map((b) => [b, ((I.sets[b] || {}).columns || []).find((c) => c.kind === "link" && c.links === s)]).find(([, c]) => c);
        n.at[s] = link ? { via: link[0] + "." + link[1].id } : M.keysOf(I, s)[0];
      }
      return n;
    }
    const f = choice.slice(1);
    const firstFree = () => { const need = []; collectSets(inner, need); return need.find((s) => !ctx.bound.includes(s)) || (tables()[0] && tables()[0].id); };
    switch (f) {
      case "sum": case "avg": { const over = firstFree(); if (inner.at && over) { delete inner.at[over]; if (!Object.keys(inner.at).length) delete inner.at; } return { op: f, over, body: inner }; }
      case "count": return { op: "count", over: tables()[0] && tables()[0].id };
      case "paren": case "sqrt": case "abs": case "exp": case "log": return { op: f, args: [inner] };
      case "sq": return { op: "pow", args: [inner, { const: 2 }] };
      case "pow": return { op: "pow", args: [inner, { const: 2 }] };
      case "max": case "min": return { op: f, args: [inner, { const: 0 }] };
      case "if": return { op: "if", args: [{ op: "ge", args: [inner, { const: 0 }] }, { const: 1 }, { const: 0 }] };
      case "lookup": { const t = tables().find((x) => (x.columns || []).length >= 2) || tables()[0]; const cols = (t && t.columns) || []; return { op: "lookup", table: t && t.id, key: cols[0] && cols[0].id, value: (cols[1] || cols[0] || {}).id, args: [inner] }; }
    }
    return { hole: true };
  }
  function collectSets(n, out) {
    if (!n || typeof n !== "object") return;
    if (n.ref) { const i = M.refInfo(ix(), n.ref); if (i) for (const s of i.sets) if (!(n.at && typeof n.at[s] === "string") && !out.includes(s)) out.push(s); }
    (n.args || []).forEach((a) => collectSets(a, out));
    if (n.body) { const inner = []; collectSets(n.body, inner); const over = [].concat(n.over || []); for (const s of inner) if (!over.includes(s) && !out.includes(s)) out.push(s); }
  }

  // Power mode: the expression as a typed formula, with names suggested as you type and the
  // sentence version underneath. It parses to the same tree the menus build.
  let typed = store.get("plain-solver:typed") === "1";
  const FN_WORDS = ["sum(", "avg(", "count(", "sqrt(", "abs(", "max(", "min(", "if(", "lookup(", "exp(", "log("];
  // The words of a formula as people would say them, when that reads back to the same thing.
  function plainText(ast) {
    if (!ast || ast.hole) return "";
    const said = M.say(model, ast).replace(/^the /, "");
    const back = M.parsePlain(model, said);
    return !back.error && M.formula(model, back.tree) === M.formula(model, ast) ? said : M.formula(model, ast);
  }
  function plainNames() {
    const out = new Set();
    for (const t of model.things) {
      if (t.kind === "single") for (const p of t.properties || []) out.add(p.label);
      if (t.kind === "table") { out.add(t.label); for (const c of t.columns || []) if (!c.kind || c.kind === "number") out.add(c.label); }
      if (t.kind === "grid") out.add(t.label);
    }
    for (const d of model.decisions) out.add(d.label.toLowerCase());
    for (const r of model.results) out.add(r.label.toLowerCase());
    return [...out].concat(["total of … across …"]);
  }
  const typing = new Set(); // expressions switched to typing by their pencil
  function typedEl(ast, ctx, set, plain) {
    const N = M.names(model);
    const text = plain ? plainText(ast) : M.formula(model, ast, N);
    const inp = h("input.ps-chip.ps-formula", { type: "text", value: text, spellcheck: "false", autocomplete: "off", "aria-label": "Formula", "aria-autocomplete": "list", "data-k": ctx.key + ":f" });
    const say = h("span.ps-say", {}, ast && !ast.hole ? M.say(model, ast) : plain ? "Type it the way you'd say it: wood per chair times chairs to make" : "Type a formula, like Units_made + Units_short");
    const list = h("ul.ps-suggest", { role: "listbox", hidden: true });
    const all = plain ? plainNames() : Object.entries(N.byId).filter(([id]) => !id.includes("#col#")).map(([, n]) => n).concat(FN_WORDS);
    let matches = [], sel = -1;
    // The words being typed: in plain mode everything since the last operator, so names with spaces match.
    const word = () => {
      const before = inp.value.slice(0, inp.selectionStart);
      if (!plain) return (/[\w.]*$/.exec(before) || [""])[0];
      const cut = before.split(/[+\-*/(),×÷^−]|\b(?:plus|minus|times|divided by|across|over|of)\b/i).pop();
      return cut.replace(/^\s+/, "");
    };
    const mark = () => [...list.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === sel)));
    const check = () => {
      const p = M.readFormula(model, inp.value, N);
      inp.setAttribute("aria-invalid", p.error ? "true" : "false");
      say.textContent = p.error || M.say(model, p.tree);
      say.classList.toggle("is-bad", !!p.error);
      return p;
    };
    const accept = (i) => {
      const w = word(), pos = inp.selectionStart;
      inp.value = inp.value.slice(0, pos - w.length) + matches[i] + inp.value.slice(pos);
      const c = pos - w.length + matches[i].length;
      inp.setSelectionRange(c, c);
      list.hidden = true;
      check();
    };
    const show = () => {
      const w = word().toLowerCase();
      matches = w ? all.filter((n) => n.toLowerCase().includes(w) && n.toLowerCase() !== w).sort((a, b) => a.toLowerCase().indexOf(w) - b.toLowerCase().indexOf(w)).slice(0, 8) : [];
      sel = matches.length ? 0 : -1;
      list.replaceChildren(...matches.map((n, i) => h("li", { role: "option", on: { mousedown: (e) => { e.preventDefault(); accept(i); } } }, n)));
      list.hidden = !matches.length;
      mark();
    };
    inp.addEventListener("input", () => { check(); show(); });
    inp.addEventListener("keydown", (e) => {
      if (!list.hidden && matches.length) {
        if (e.key === "ArrowDown") { sel = (sel + 1) % matches.length; mark(); e.preventDefault(); return; }
        if (e.key === "ArrowUp") { sel = (sel - 1 + matches.length) % matches.length; mark(); e.preventDefault(); return; }
        if ((e.key === "Tab" || e.key === "Enter") && sel >= 0) { e.preventDefault(); accept(sel); return; }
        if (e.key === "Escape") { list.hidden = true; return; }
      }
      if (e.key === "Enter") inp.blur();
    });
    inp.addEventListener("blur", () => { list.hidden = true; });
    inp.addEventListener("change", () => { const p = check(); if (!p.error && inp.value.trim()) { typing.delete(ctx.key); edit(() => set(p.tree)); } });
    const back = plain ? h("button.ps-tool", { type: "button", title: "Back to the menus", "aria-label": "Back to the menus", on: { click: () => { typing.delete(ctx.key); renderBuilder(); } } }, "≡") : null;
    return h("span.ps-typed" + (plain ? ".is-plain" : ""), {}, h("span.ps-typed-row", {}, inp, back), list, say);
  }

  function exprEl(ast, ctx, set) {
    if (typed) return typedEl(ast, ctx, (nn) => set(nn));
    if (typing.has(ctx.key)) return typedEl(ast, ctx, (nn) => set(nn), true);
    const ts = toTokens(ast);
    const wrap = h("span.ps-expr");
    const commit = (nts) => edit(() => set(fromTokens(nts)));
    ts.forEach((tok, i) => {
      const key = ctx.key + "." + i;
      if (tok.t === "o") {
        const s = h("select.ps-chip.ps-op", { "aria-label": "Operation", "data-k": key }, Object.entries(OPWORD).map(([v, l]) => opt(v, l, v === tok.op)));
        s.addEventListener("change", () => { const nts = ts.slice(); nts[i] = { t: "o", op: s.value }; commit(nts); });
        wrap.append(s);
      } else {
        wrap.append(valueEl(tok.n, { ...ctx, key }, (nn) => {
          const nts = ts.slice();
          if (nn === null) { if (ts.length === 1) nts[0] = { t: "v", n: { hole: true } }; else if (i === 0) nts.splice(0, 2); else nts.splice(i - 1, 2); }
          else nts[i] = { t: "v", n: nn };
          commit(nts);
        }, ts.length > 1));
      }
    });
    const more = h("select.ps-chip.ps-more", { "aria-label": "Add to this", title: "Add to this", "data-k": ctx.key + ":more" }, opt("", "+", true), Object.entries(OPWORD).map(([v, l]) => opt(v, l)));
    more.addEventListener("change", () => { if (!more.value) return; commit([...ts, { t: "o", op: more.value }, { t: "v", n: { const: more.value === "mul" || more.value === "div" ? 1 : 0 } }]); });
    const pencil = h("button.ps-tool.ps-pencil", { type: "button", title: "Type it instead", "aria-label": "Type this instead of picking from menus", "data-k": ctx.key + ":type", on: { click: () => { typing.add(ctx.key); renderBuilder(); const e = document.querySelector(`.ps [data-k="${CSS.escape(ctx.key + ":f")}"]`); if (e) { e.focus(); e.select(); } } } }, "✎");
    wrap.append(more, pencil);
    return wrap;
  }

  function setSelect(cur, onPick, label, key, allowNone) {
    const s = h("select.ps-chip", { "aria-label": label, "data-k": key });
    if (allowNone || !cur) s.append(opt("", allowNone ? "—" : "choose a list…", !cur));
    for (const t of tables()) s.append(opt(t.id, t.label, t.id === cur));
    s.addEventListener("change", () => onPick(s.value));
    return s;
  }

  // One value: a number, a reference (with its row pickers), or a function with its own slots.
  function valueEl(n, ctx, set, removable) {
    const pick = (choice) => {
      if (choice === "#remove") return set(null);
      if (!choice) return;
      set(nodeFor(choice, n, ctx));
    };
    if (!n || n.hole) return h("span.ps-val.is-hole", {}, kindSelect("hole", ctx, pick, "Choose what goes here", removable));
    if (n.const !== undefined) {
      const inp = h("input.ps-chip.ps-num", { type: "text", inputmode: "decimal", value: n.const === null ? "" : String(n.const), size: Math.max(2, String(n.const ?? "").length + 1), "aria-label": "Number", "data-k": ctx.key + ":n" });
      inp.addEventListener("input", () => { const v = parseNum(inp.value); n.const = v; inp.size = Math.max(2, inp.value.length + 1); inp.setAttribute("aria-invalid", v === null ? "true" : "false"); changed(false); });
      return h("span.ps-val.is-num", {}, inp, kindSelect("#num", ctx, pick, "Change this number to something else", removable));
    }
    if (n.ref !== undefined) {
      const info = M.refInfo(ix(), n.ref);
      const box = h("span.ps-val.is-ref", {}, kindSelect("ref:" + n.ref, ctx, pick, "What this refers to", removable));
      if (!info) { box.classList.add("is-bad"); return box; }
      for (const s of info.sets) box.append(atSelect(n, s, ctx));
      const shifted = info.sets.some((s) => n.at && n.at[s] && n.at[s].shift);
      if (shifted) {
        box.append(h("span.ps-word", {}, "(before the first:"), valueEl(n.otherwise || { const: 0 }, { ...ctx, key: ctx.key + ":o" }, (nn) => edit(() => { n.otherwise = nn || { const: 0 }; }), false), h("span.ps-word", {}, ")"));
      }
      return box;
    }
    const sub = (k, node, extra) => exprEl(node, { ...ctx, ...(extra || {}), key: ctx.key + "." + k }, (nn) => replaceArg(n, k, nn));
    const fn = h("span.ps-val.is-fn", {});
    const head = (c) => kindSelect(c, ctx, (choice) => {
      if (choice === "#remove") return set(null);
      // Swapping one function for another keeps the first argument.
      const firstArg = n.op === "sum" || n.op === "avg" ? n.body : (n.args || [])[0];
      set(nodeFor(choice, firstArg && firstArg.op === "ge" ? firstArg.args[0] : firstArg, ctx));
    }, "Function", true);
    const word = (t) => h("span.ps-word", {}, t);
    switch (n.op) {
      case "sum": case "avg": {
        const over = [].concat(n.over || [])[0];
        fn.append(head("#" + n.op), sub("body", n.body, { bound: ctx.bound.concat(over ? [over] : []) }), word("across"),
          setSelect(over, (v) => edit(() => { n.over = v; delete n.where; }), "Across which list", ctx.key + ":over"), over ? whereEl(n, [over], ctx.bound, ctx.key + ":w") : null);
        break;
      }
      case "count": { const over = [].concat(n.over || [])[0]; fn.append(head("#count"), setSelect(over, (v) => edit(() => { n.over = v; delete n.where; }), "Which list", ctx.key + ":over"), over ? whereEl(n, [over], ctx.bound, ctx.key + ":w") : null); break; }
      case "paren": fn.append(word("("), sub(0, n.args[0]), word(")"), head("#paren")); fn.classList.add("is-paren"); break;
      case "pow":
        if (n.args[1] && n.args[1].const === 2) { fn.append(sub(0, n.args[0]), word("squared"), head("#sq")); fn.classList.add("is-sq"); }
        else fn.append(sub(0, n.args[0]), word("to the power of"), sub(1, n.args[1]), head("#pow"));
        break;
      case "sqrt": case "abs": case "exp": case "log": fn.append(head("#" + n.op), sub(0, n.args[0])); break;
      case "max": case "min": fn.append(head("#" + n.op), sub(0, n.args[0]), word("and"), sub(1, n.args[1])); break;
      case "if": fn.append(head("#if"), condEl(n, ctx), word("then"), sub(1, n.args[1]), word("otherwise"), sub(2, n.args[2])); break;
      case "lookup": {
        const t = tables().find((x) => x.id === n.table);
        const colSel = (cur, k, label) => {
          const s = h("select.ps-chip", { "aria-label": label, "data-k": ctx.key + ":" + k }, ((t && t.columns) || []).map((c) => opt(c.id, c.label, c.id === cur)));
          s.addEventListener("change", () => edit(() => { n[k] = s.value; }));
          return s;
        };
        fn.append(head("#lookup"), sub(0, n.args[0]), word("in"), setSelect(n.table, (v) => edit(() => { n.table = v; const tt = tables().find((x) => x.id === v); const cs = (tt && tt.columns) || []; n.key = cs[0] && cs[0].id; n.value = (cs[1] || cs[0] || {}).id; }), "Table to look in", ctx.key + ":tbl"),
          word("by"), colSel(n.key, "key", "Column to match"), word("→"), colSel(n.value, "value", "Column to return"));
        break;
      }
      default: fn.append(head("hole"));
    }
    return fn;
  }
  function replaceArg(n, k, nn) {
    if (k === "body") n.body = nn; else n.args[k] = nn;
  }
  function condEl(n, ctx) {
    const c = n.args[0];
    const isCmp = c && CMP.some(([v]) => v === c.op);
    const s = h("select.ps-chip.ps-op", { "aria-label": "Comparison", "data-k": ctx.key + ":cmp" }, CMP.map(([v, l]) => opt(v, l, isCmp && c.op === v)), opt("yes", "is yes", !isCmp));
    s.addEventListener("change", () => edit(() => {
      if (s.value === "yes") n.args[0] = isCmp ? c.args[0] : c;
      else n.args[0] = isCmp ? { op: s.value, args: c.args } : { op: s.value, args: [c, { const: 0 }] };
    }));
    if (isCmp) return h("span.ps-cond", {}, exprEl(c.args[0], { ...ctx, key: ctx.key + ".c0" }, (nn) => { c.args[0] = nn; }), s, exprEl(c.args[1], { ...ctx, key: ctx.key + ".c1" }, (nn) => { c.args[1] = nn; }));
    return h("span.ps-cond", {}, exprEl(c, { ...ctx, key: ctx.key + ".c" }, (nn) => { n.args[0] = nn; }), s);
  }
  /* "where": conditions on the rows of a list, joined by "and". Each compares one of the list's
     columns (or the row's own name) with "this <row>" of a list around it, or a value. Anything
     the menus can't show (an "or", say) is edited as a typed formula instead. */
  const WOPS = [["eq", "is"], ["ne", "isn't"], ["ge", "is at least"], ["le", "is at most"], ["gt", "is more than"], ["lt", "is less than"]];
  const condList = (w) => { const out = []; (function f(x) { if (x && x.op === "and") x.args.forEach(f); else if (x) out.push(x); })(w); return out; };
  const andAll = (cs) => (cs.length ? cs.reduce((a, b) => ({ op: "and", args: [a, b] })) : undefined);
  function whereEl(holder, sets, outer, key) {
    const I = ix();
    const cs = condList(holder.where);
    const leftOk = (x) => x && ((x.ref && !x.at && sets.some((s) => x.ref.startsWith(s + "."))) || (x.key !== undefined && !x.op && sets.includes(x.key)));
    const rightOk = (x) => x && ((x.key !== undefined && !x.op) || x.const !== undefined || x.text !== undefined);
    const simple = cs.every((c) => WOPS.some(([o]) => o === c.op) && leftOk(c.args[0]) && rightOk(c.args[1]));
    const box = h("span.ps-where", {});
    if (!simple) {
      box.append(word("where"), typedEl(holder.where, { bound: outer.concat(sets), key }, (nn) => { holder.where = nn; }));
      return box;
    }
    const lefts = [];
    for (const s of sets) {
      const t = I.sets[s], one = (t.one || t.label);
      lefts.push(["k:" + s, `the ${one.toLowerCase()} itself`]);
      for (const c of t.columns || []) lefts.push(["c:" + s + "." + c.id, `${one}'s ${c.label}`]);
    }
    const rights = outer.concat(sets.length > 1 ? sets : []).map((b) => ["k:" + b, `this ${M.setOne(I, b).toLowerCase()}`]);
    const setConds = (fn) => edit(() => { const next = condList(holder.where); fn(next); holder.where = andAll(next.filter(Boolean)); if (!holder.where) delete holder.where; });
    cs.forEach((c, i) => {
      const L = c.args[0], R = c.args[1];
      const lv = L.key !== undefined ? "k:" + L.key : "c:" + L.ref;
      const ls = h("select.ps-chip", { "aria-label": "Which column", "data-k": `${key}:${i}:l` }, lefts.map(([v, l]) => opt(v, l, v === lv)));
      ls.addEventListener("change", () => setConds((n) => { n[i] = { ...n[i], args: [ls.value.startsWith("k:") ? { key: ls.value.slice(2) } : { ref: ls.value.slice(2) }, n[i].args[1]] }; }));
      const os = h("select.ps-chip.ps-op", { "aria-label": "Comparison", "data-k": `${key}:${i}:o` }, WOPS.map(([v, l]) => opt(v, l, v === c.op)));
      os.addEventListener("change", () => setConds((n) => { n[i] = { ...n[i], op: os.value }; }));
      const rv = R.key !== undefined ? "k:" + R.key : "v";
      const rs = h("select.ps-chip", { "aria-label": "Compared with", "data-k": `${key}:${i}:r` }, rights.map(([v, l]) => opt(v, l, v === rv)), opt("v", "a value…", rv === "v"));
      rs.addEventListener("change", () => setConds((n) => { n[i] = { ...n[i], args: [n[i].args[0], rs.value === "v" ? { text: "" } : { key: rs.value.slice(2) }] }; }));
      const parts = [word(i ? "and" : "where"), ls, os, rs];
      if (rv === "v") {
        const lc = L.ref ? (I.props[L.ref] || {}).col : null;
        const inp = h("input.ps-chip.ps-name", { type: "text", value: R.const !== undefined ? String(R.const) : R.text || "", size: 8, "aria-label": "Value", "data-k": `${key}:${i}:v`, list: lc && lc.kind === "link" ? "dl-" + lc.links : L.key !== undefined ? "dl-" + L.key : null });
        inp.addEventListener("input", () => { const v = parseNum(inp.value); c.args[1] = v !== null && (!lc || !lc.kind || lc.kind === "number") ? { const: v } : { text: inp.value }; changed(false); });
        parts.push(inp);
      }
      parts.push(h("button.ps-tool", { type: "button", "aria-label": "Remove this condition", title: "Remove", on: { click: () => setConds((n) => { n.splice(i, 1); }) } }, "✕"));
      box.append(...parts);
    });
    const add = h("select.ps-chip.ps-more.ps-more-wide", { "aria-label": "Add a condition", "data-k": key + ":add" }, opt("", cs.length ? "+ and…" : "+ where…", true), lefts.map(([v, l]) => opt(v, l)));
    add.addEventListener("change", () => {
      if (!add.value) return;
      const v = add.value, L = v.startsWith("k:") ? { key: v.slice(2) } : { ref: v.slice(2) };
      const col = L.ref ? (I.props[L.ref] || {}).col : null;
      // A link column to a list that has a current row: "is this <row>" is almost always the point.
      const target = col && col.kind === "link" ? col.links : null;
      const R = target && outer.concat(sets).includes(target) && !sets.includes(target) ? { key: target } : col && (!col.kind || col.kind === "number") ? { const: 0 } : { text: "" };
      setConds((n) => n.push({ op: "eq", args: [L, R] }));
    });
    box.append(add);
    return box;
  }

  function atSelect(n, s, ctx) {
    const I = ix(), keys = M.keysOf(I, s), one = M.setOne(I, s).toLowerCase();
    const at = n.at && n.at[s];
    const bound = ctx.bound.includes(s);
    const cur = typeof at === "string" ? "k:" + at : at && at.shift ? "s:" + at.shift : at && at.via ? "v:" + at.via : bound ? "this" : "k:" + keys[0];
    const sel = h("select.ps-chip.ps-at", { "aria-label": `Which ${one}`, "data-k": ctx.key + ":at:" + s });
    if (bound) sel.append(opt("this", `this ${one}`, cur === "this"), opt("s:-1", `previous ${one}`, cur === "s:-1"), opt("s:1", `next ${one}`, cur === "s:1"));
    const vias = [];
    for (const b of ctx.bound) { const t = I.sets[b]; if (t) for (const c of t.columns || []) if (c.kind === "link" && c.links === s) vias.push(["v:" + b + "." + c.id, `the ${(t.one || t.label).toLowerCase()}'s ${c.label}`]); }
    if (vias.length) sel.append(h("optgroup", { label: "Follow a link" }, vias.map(([v, l]) => opt(v, l, v === cur))));
    sel.append(h("optgroup", { label: M.setLabel(I, s) }, keys.map((k) => opt("k:" + k, k, cur === "k:" + k))));
    if (typeof at === "string" && !keys.includes(at)) sel.append(opt("k:" + at, at + " (missing)", true));
    sel.addEventListener("change", () => edit(() => {
      n.at = n.at || {};
      if (sel.value === "this") delete n.at[s];
      else if (sel.value.startsWith("s:")) { n.at[s] = { shift: Number(sel.value.slice(2)) }; if (!n.otherwise) n.otherwise = { const: 0 }; }
      else if (sel.value.startsWith("v:")) n.at[s] = { via: sel.value.slice(2) };
      else n.at[s] = sel.value.slice(2);
      if (!Object.keys(n.at).length) delete n.at;
      if (!(n.at && Object.values(n.at).some((a) => a && a.shift))) delete n.otherwise;
    }));
    return h("span.ps-word.ps-for", {}, "for ", sel);
  }
  function parseNum(s) {
    const t = String(s).replace(/[,$€£%\s]/g, "").replace(/^−/, "-");
    if (t === "") return null;
    const v = Number(t);
    return Number.isFinite(v) ? v : null;
  }

  /* ---------- sentences ---------- */
  function tools(list, i, opts) {
    const item = list[i];
    const b = (label, text, fn, extra) => h("button.ps-tool", { type: "button", title: label, "aria-label": label, on: { click: fn }, ...(extra || {}) }, text);
    return h("span.ps-tools", {},
      b("Move up", "↑", () => edit(() => { if (i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]]; }), { disabled: i === 0 }),
      b("Move down", "↓", () => edit(() => { if (i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]]; }), { disabled: i === list.length - 1 }),
      b("Duplicate", "⧉", () => edit(() => { const c = clone(item); c.id = uid(c.label); c.label = c.label + " (copy)"; list.splice(i + 1, 0, c); })),
      opts && opts.toggle ? b(item.disabled ? "Turn on" : "Turn off (leave it out of the solve)", item.disabled ? "Off" : "On", () => edit(() => { item.disabled = !item.disabled; }), { "aria-pressed": item.disabled ? "false" : "true", class: "ps-tool ps-toggle" + (item.disabled ? " is-off" : "") }) : null,
      b("Delete", "✕", () => edit(() => { list.splice(i, 1); })),
    );
  }
  function nameInput(obj, key, label, cls) {
    const inp = h("input.ps-chip.ps-name" + (cls ? "." + cls : ""), { type: "text", value: obj[key] || "", "aria-label": label, size: Math.max(4, (obj[key] || "").length + 1), "data-k": "name:" + (obj.id || "") + ":" + key });
    inp.addEventListener("input", () => { obj[key] = inp.value; inp.size = Math.max(4, inp.value.length + 1); changed(false); });
    inp.addEventListener("change", () => renderBuilder());
    return inp;
  }
  function unitInput(obj, label) {
    const inp = h("input.ps-chip.ps-unit", { type: "text", value: obj.unit || "", placeholder: "unit", "aria-label": label || "Unit", size: Math.max(4, (obj.unit || "").length + 1), "data-k": "unit:" + (obj.id || "") });
    inp.addEventListener("input", () => { obj.unit = inp.value; inp.size = Math.max(4, inp.value.length + 1); changed(false); });
    return inp;
  }
  const word = (t) => h("span.ps-word", {}, t);
  const row = (cls, item, ...kids) => h("div.ps-s" + (cls ? "." + cls : "") + (item && item.disabled ? ".is-off" : ""), { "data-id": item && item.id }, ...kids);

  function thingEl(t, i) {
    const list = model.things;
    if (t.kind === "single") {
      const props = (t.properties || []).map((p, j) => {
        const val = h("input.ps-chip.ps-num", { type: "text", inputmode: "decimal", value: p.value === null || p.value === undefined ? "" : String(p.value), "aria-label": `${t.label}: ${p.label}`, size: Math.max(3, String(p.value ?? "").length + 1), "data-k": "pv:" + t.id + "." + p.id, title: p.prompt || "" });
        val.addEventListener("input", () => { p.value = parseNum(val.value); val.size = Math.max(3, val.value.length + 1); val.setAttribute("aria-invalid", p.value === null ? "true" : "false"); changed(false); });
        return h("li.ps-prop", {}, nameInput(p, "label", "Name of this number"), word("="), val, unitInput(p), p.blank ? h("span.ps-q", { title: p.prompt || "Asked in the quick questions" }, "?") : null,
          h("button.ps-tool", { type: "button", "aria-label": `Delete ${p.label}`, title: "Delete", on: { click: () => edit(() => t.properties.splice(j, 1)) } }, "✕"));
      });
      return row("is-thing", t, h("p.ps-line", {}, word("I have"), nameInput(t, "label", "Name"), word(t.properties && t.properties.length ? "with:" : ""), tools(list, i)),
        h("ul.ps-props", {}, props),
        h("button.ps-add-small", { type: "button", on: { click: () => edit(() => { t.properties = t.properties || []; const id = uid("number", new Set(t.properties.map((p) => p.id))); t.properties.push({ id, label: "new number", value: 0, unit: "" }); }) } }, "+ a number"));
    }
    if (t.kind === "table") {
      return row("is-thing", t, h("p.ps-line", {}, word("A list of"), nameInput(t, "label", "Name of the list"), word("— one of them is a"), nameInput(t, "one", "Name for one row"), tools(list, i)),
        tableEditor(t), importLinks(t));
    }
    if (t.kind === "grid") {
      const [A, B] = t.over || [];
      return row("is-thing", t, h("p.ps-line", {}, nameInput(t, "label", "Name of the grid"), unitInput(t), word("for each"),
        setSelect(A, (v) => edit(() => { t.over = [v, B]; t.values = {}; }), "Rows", "g:" + t.id + ":a"), word("and each"),
        setSelect(B, (v) => edit(() => { t.over = [A, v]; t.values = {}; }), "Columns", "g:" + t.id + ":b"), tools(list, i)),
        gridEditor(t), importLinks(t));
    }
    return row("", t, word("?"));
  }
  function importLinks(t) {
    return h("p.ps-imports", {},
      h("button.ps-link", { type: "button", on: { click: () => openImport(t) } }, "Paste from a spreadsheet"),
      h("button.ps-link", { type: "button", on: { click: () => openImport(t, true) } }, "Upload .csv or .xlsx"));
  }
  function cellInput(get, put, label, key) {
    const v = get();
    const inp = h("input.ps-cell", { type: "text", inputmode: "decimal", value: v === null || v === undefined ? "" : String(v), "aria-label": label, "data-k": key });
    inp.addEventListener("input", () => { const n = parseNum(inp.value); put(n); inp.setAttribute("aria-invalid", n === null && inp.value.trim() ? "true" : "false"); changed(false); });
    return inp;
  }
  // A column holds numbers, names of another list's rows (a link), or any text.
  function colKind(t, c) {
    const cur = c.kind === "link" ? "link:" + c.links : c.kind === "text" ? "text" : "number";
    const s = h("select.ps-chip.ps-colkind", { "aria-label": `What ${c.label} holds`, "data-k": "ck:" + t.id + ":" + c.id },
      opt("number", "numbers", cur === "number"),
      h("optgroup", { label: "Names of…" }, tables().filter((x) => x.id !== t.id).map((x) => opt("link:" + x.id, `${x.one || x.label} names`, cur === "link:" + x.id))),
      opt("text", "text", cur === "text"));
    s.addEventListener("change", () => edit(() => {
      const v = s.value;
      if (v === "number") { delete c.kind; delete c.links; for (const r of t.rows) r[c.id] = parseNum(r[c.id]); }
      else { c.kind = v === "text" ? "text" : "link"; if (c.kind === "link") c.links = v.slice(5); else delete c.links; delete c.unit; for (const r of t.rows) r[c.id] = r[c.id] === null || r[c.id] === undefined ? "" : String(r[c.id]); }
    }));
    return s;
  }
  function nameCell(get, put, label, key, list) {
    const v = get();
    const inp = h("input.ps-cell.ps-namecell", { type: "text", value: v === null || v === undefined ? "" : String(v), "aria-label": label, "data-k": key, list: list ? "dl-" + list : null });
    inp.addEventListener("input", () => { put(inp.value.trim()); const ok = !list || !inp.value.trim() || M.keysOf(ix(), list).includes(inp.value.trim()); inp.setAttribute("aria-invalid", ok ? "false" : "true"); changed(false); });
    return inp;
  }
  // One <datalist> of row names per list, so link cells suggest the names they can hold.
  function renderDatalists() {
    let box = document.getElementById("ps-datalists");
    if (!box) { box = h("div", { id: "ps-datalists", hidden: true }); document.body.append(box); }
    box.replaceChildren(...tables().map((t) => h("datalist", { id: "dl-" + t.id }, t.rows.slice(0, 3000).map((r) => h("option", { value: String(r.key) })))));
  }
  const BIG = 2500;
  function tableEditor(t) {
    const cols = t.columns || [];
    const many = t.rows.length * Math.max(1, cols.length) > BIG && !t._open;
    const head = h("tr", {}, h("th", { scope: "col" }, t.one || "Row"), cols.map((c, j) => h("th", { scope: "col" },
      h("span.ps-colhead", {}, nameInput(c, "label", "Column name"), colKind(t, c), !c.kind || c.kind === "number" ? unitInput(c, "Column unit") : null,
        h("button.ps-tool", { type: "button", "aria-label": `Delete column ${c.label}`, title: "Delete column", on: { click: () => edit(() => { cols.splice(j, 1); for (const r of t.rows) delete r[c.id]; }) } }, "✕")))),
      h("th", {}, h("button.ps-tool", { type: "button", title: "Add a column", "aria-label": "Add a column", on: { click: () => edit(() => { t.columns = cols; const id = uid("column", new Set(cols.map((c) => c.id).concat(["key"]))); cols.push({ id, label: "New column", unit: "" }); }) } }, "+")));
    const shown = many ? t.rows.slice(0, 50) : t.rows;
    const body = shown.map((r, i) => {
      const key = h("input.ps-cell.ps-key", { type: "text", value: r.key, "aria-label": `Name of row ${i + 1}`, "data-k": "tk:" + t.id + ":" + i });
      key.addEventListener("change", () => {
        const nv = key.value.trim();
        if (!nv || t.rows.some((x, j) => j !== i && String(x.key) === nv)) { key.value = r.key; return; }
        edit(() => { renameKey(t.id, String(r.key), nv); r.key = nv; });
      });
      return h("tr", {}, h("th", { scope: "row" }, key), cols.map((c) => h("td", {}, !c.kind || c.kind === "number"
          ? cellInput(() => r[c.id], (v) => { r[c.id] = v; }, `${c.label} for ${r.key}`, "tc:" + t.id + ":" + i + ":" + c.id)
          : nameCell(() => r[c.id], (v) => { r[c.id] = v; }, `${c.label} for ${r.key}`, "tc:" + t.id + ":" + i + ":" + c.id, c.kind === "link" ? c.links : null))),
        h("td", {}, h("button.ps-tool", { type: "button", "aria-label": `Delete ${r.key}`, title: "Delete row", on: { click: () => edit(() => { t.rows.splice(i, 1); }) } }, "✕")));
    });
    const add = h("button.ps-add-small", { type: "button", on: { click: () => edit(() => {
      const keys = new Set(t.rows.map((r) => String(r.key)));
      let n = t.rows.length + 1, k = `${t.one || "Row"} ${n}`;
      while (keys.has(k)) k = `${t.one || "Row"} ${++n}`;
      const r = { key: k };
      for (const c of cols) r[c.id] = !c.kind || c.kind === "number" ? 0 : "";
      t.rows.push(r);
    }) } }, "+ a row");
    return h("div.ps-table-wrap", {}, h("div.ps-scroll", { tabindex: "0", role: "region", "aria-label": t.label }, h("table.ps-edit", {}, h("thead", {}, head), h("tbody", {}, body))),
      many ? h("p.ps-hint", {}, `Showing 50 of ${t.rows.length} rows. `, h("button.ps-link", { type: "button", on: { click: () => { t._open = true; renderBuilder(); } } }, "Show them all")) : null, add);
  }
  function gridEditor(t) {
    const I = ix();
    const [A, B] = t.over || [];
    if (!I.sets[A] || !I.sets[B]) return h("p.ps-hint", {}, "Pick the two lists this grid is for.");
    const ka = M.keysOf(I, A), kb = M.keysOf(I, B);
    t.values = t.values || {};
    if (ka.length * kb.length > BIG && !t._open) {
      const filled = ka.reduce((s, a) => s + kb.filter((b) => t.values[a] && Number.isFinite(t.values[a][b])).length, 0);
      return h("p.ps-hint", {}, `${ka.length} × ${kb.length} values (${filled.toLocaleString()} filled). `, h("button.ps-link", { type: "button", on: { click: () => { t._open = true; renderBuilder(); } } }, "Show the grid"));
    }
    return h("div.ps-scroll", { tabindex: "0", role: "region", "aria-label": t.label }, h("table.ps-edit.ps-grid-edit", {},
      h("thead", {}, h("tr", {}, h("th", {}, ""), kb.map((b) => h("th", { scope: "col" }, b)))),
      h("tbody", {}, ka.map((a) => h("tr", {}, h("th", { scope: "row" }, a), kb.map((b) => h("td", {}, cellInput(() => (t.values[a] || {})[b], (v) => { (t.values[a] = t.values[a] || {})[b] = v; }, `${t.label}, ${a} and ${b}`, "gc:" + t.id + ":" + a + ":" + b))))))));
  }

  const TYPE_WORDS = [["continuous", "any amount"], ["integer", "a whole number"], ["binary", "yes or no"]];
  function boundEl(d, side) {
    const v = d[side];
    const kind = v === undefined ? (side === "lower" ? "num" : "none") : v === null ? "none" : typeof v === "number" ? "num" : "data";
    const ctx = { bound: d.indexBy || [], key: "b:" + d.id + ":" + side };
    const sel = h("select.ps-chip", { "aria-label": side === "lower" ? "Lowest value" : "Highest value", "data-k": ctx.key + ":kind" },
      opt("none", side === "lower" ? "can go negative" : "no upper limit", kind === "none"), opt("num", side === "lower" ? "at least a number" : "at most a number", kind === "num"), opt("data", side === "lower" ? "at least, from data" : "at most, from data", kind === "data"));
    sel.addEventListener("change", () => edit(() => { d[side] = sel.value === "none" ? null : sel.value === "num" ? 0 : { hole: true }; }));
    const parts = [sel];
    if (kind === "num") {
      const cur = v === undefined ? 0 : v;
      const inp = h("input.ps-chip.ps-num", { type: "text", inputmode: "decimal", value: String(cur), size: Math.max(2, String(cur).length + 1), "aria-label": side === "lower" ? "At least" : "At most", "data-k": ctx.key + ":n" });
      inp.addEventListener("input", () => { const n = parseNum(inp.value); d[side] = n === null ? 0 : n; inp.size = Math.max(2, inp.value.length + 1); changed(false); });
      parts.push(inp);
    } else if (kind === "data") parts.push(exprEl(v, ctx, (nn) => { d[side] = nn; }));
    return h("span.ps-bound", {}, parts);
  }
  function eachEl(obj, key, label) {
    const sets = obj[key] || [];
    const out = h("span.ps-each", {});
    sets.forEach((s, k) => out.append(word(k ? "and each" : "for each"), setSelect(s, (v) => edit(() => { if (v) obj[key][k] = v; else obj[key].splice(k, 1); }), label, "e:" + obj.id + ":" + key + ":" + k, true)));
    if (tables().length && sets.length < 3) {
      const add = h("select.ps-chip.ps-more", { "aria-label": sets.length ? "And for each…" : "For each…", "data-k": "e:" + obj.id + ":" + key + ":add" }, opt("", sets.length ? "+ and each…" : "+ for each…", true), tables().filter((t) => !sets.includes(t.id)).map((t) => opt(t.id, t.one || t.label)));
      add.addEventListener("change", () => { if (add.value) edit(() => { obj[key] = sets.concat(add.value); }); });
      out.append(add);
    }
    return out;
  }
  function decisionEl(d, i) {
    const type = h("select.ps-chip", { "aria-label": "Kind of number", "data-k": "dt:" + d.id }, TYPE_WORDS.map(([v, l]) => opt(v, l, (d.type || "continuous") === v)));
    type.addEventListener("change", () => edit(() => { d.type = type.value; }));
    return row("is-decision", d, h("p.ps-line", {}, word("Decide"), nameInput(d, "label", "Name of the decision"), unitInput(d), word("as"), type, eachEl(d, "indexBy", "For each"), tools(model.decisions, i, { toggle: true })),
      d.type === "binary" ? null : h("p.ps-line.ps-sub", {}, boundEl(d, "lower"), word("·"), boundEl(d, "upper")));
  }
  function feeds(id) {
    const out = [];
    for (const r of model.results) if (r.id !== id && refsDirect(r.expr).has(id)) out.push(r.label);
    for (const r of model.rules) if (refsDirect(r.lhs).has(id) || refsDirect(r.rhs).has(id) || refsDirect(r.rhs2).has(id) || refsDirect(r.count).has(id)) out.push(r.label);
    if (model.goal && refsDirect(model.goal.expr).has(id)) out.push("the goal");
    return out;
  }
  function refsDirect(n, out) {
    out = out || new Set();
    if (!n || typeof n !== "object") return out;
    if (n.ref) out.add(n.ref);
    (n.args || []).forEach((a) => refsDirect(a, out));
    if (n.body) refsDirect(n.body, out);
    if (n.otherwise) refsDirect(n.otherwise, out);
    if (n.where) refsDirect(n.where, out);
    return out;
  }
  function resultEl(r, i) {
    const f = feeds(r.id);
    return row("is-result", r, h("p.ps-line", {}, nameInput(r, "label", "Name of the result"), unitInput(r), word("="), exprEl(r.expr, { bound: r.indexBy || [], key: "r:" + r.id, self: r.id }, (nn) => { r.expr = nn; }), eachEl(r, "indexBy", "For each"), tools(model.results, i, { toggle: true })),
      f.length ? h("p.ps-feeds", {}, "→ feeds ", f.join(" · ")) : h("p.ps-feeds.is-loose", {}, "→ not used yet"));
  }
  const OPSEL = [[">=", "must be at least"], ["<=", "must be at most"], ["=", "must equal"], ["between", "must be between"]];
  function ruleEl(r, i) {
    const label = nameInput(r, "label", "Name of the rule", "ps-rule-name");
    const t = tools(model.rules, i, { toggle: true });
    if (r.kind === "pick") {
      const bins = model.decisions.filter((d) => d.type === "binary" && (d.indexBy || []).length === 1);
      const op = h("select.ps-chip", { "aria-label": "How many", "data-k": "po:" + r.id }, [["<=", "at most"], [">=", "at least"], ["=", "exactly"]].map(([v, l]) => opt(v, l, (r.op || "<=") === v)));
      op.addEventListener("change", () => edit(() => { r.op = op.value; }));
      const dec = h("select.ps-chip", { "aria-label": "Of which", "data-k": "pd:" + r.id }, bins.map((d) => opt(d.id, `${M.setLabel(ix(), d.indexBy[0])} (${d.label})`, d.id === r.decision)), h("optgroup", { label: "New" }, tables().map((tb) => opt("new:" + tb.id, `${tb.label} (a new yes-or-no decision)`))));
      if (!bins.some((d) => d.id === r.decision)) dec.prepend(opt("", "choose…", true));
      dec.addEventListener("change", () => edit(() => {
        if (dec.value.startsWith("new:")) { const s = dec.value.slice(4), tb = tables().find((x) => x.id === s); const id = uid("pick " + tb.label); model.decisions.push({ id, label: `Choose the ${(tb.one || tb.label).toLowerCase()}`, unit: "", type: "binary", indexBy: [s] }); r.decision = id; }
        else r.decision = dec.value;
      }));
      return row("is-rule", r, h("p.ps-line", {}, label, word(": choose"), op, exprEl(r.count, { bound: [], key: "pc:" + r.id }, (nn) => { r.count = nn; }), word("of the"), dec, t));
    }
    if (r.kind === "different") {
      const d = model.decisions.find((x) => x.id === r.decision);
      const [A, B] = (d && d.indexBy) || [];
      const fix = (a, b) => {
        if (!a || !b) return;
        let dd = model.decisions.find((x) => x.type === "binary" && x.indexBy && x.indexBy[0] === a && x.indexBy[1] === b);
        if (!dd) { dd = { id: uid("assign"), label: "Assigned", unit: "", type: "binary", indexBy: [a, b] }; model.decisions.push(dd); }
        r.decision = dd.id;
      };
      const fill = h("input", { type: "checkbox", checked: !!r.fillAll, "data-k": "df:" + r.id });
      fill.addEventListener("change", () => edit(() => { r.fillAll = fill.checked; }));
      return row("is-rule", r, h("p.ps-line", {}, label, word(": each"), setSelect(A, (v) => edit(() => fix(v, B)), "Each of", "da:" + r.id), word("gets a different"), setSelect(B, (v) => edit(() => fix(A, v)), "A different", "db:" + r.id), t),
        h("label.ps-check", {}, fill, ` and every ${B ? M.setOne(ix(), B).toLowerCase() : "one"} is taken`));
    }
    const ctx = { bound: r.forEach || [], key: "ru:" + r.id };
    const op = h("select.ps-chip.ps-op", { "aria-label": "Comparison", "data-k": ctx.key + ":op" }, OPSEL.map(([v, l]) => opt(v, l, (r.op || ">=") === v)));
    op.addEventListener("change", () => edit(() => { r.op = op.value; if (r.op === "between" && !r.rhs2) r.rhs2 = { const: 0 }; }));
    return row("is-rule", r, h("p.ps-line", {}, label, word(":"), eachEl(r, "forEach", "For each"), (r.forEach || []).length ? whereEl(r, r.forEach, [], ctx.key + ":w") : null, exprEl(r.lhs, { ...ctx, key: ctx.key + ".l" }, (nn) => { r.lhs = nn; }), op,
      exprEl(r.rhs, { ...ctx, key: ctx.key + ".r" }, (nn) => { r.rhs = nn; }), r.op === "between" ? [word("and"), exprEl(r.rhs2, { ...ctx, key: ctx.key + ".r2" }, (nn) => { r.rhs2 = nn; })] : null, t));
  }
  function goalEl() {
    const g = model.goal;
    const sense = h("select.ps-chip.ps-op", { "aria-label": "What you want", "data-k": "goal:sense" },
      opt("min", "as low as possible", g.sense === "min" || !g.sense), opt("max", "as high as possible", g.sense === "max"), opt("target", "equal to", g.sense === "target" && !g.close), opt("close", "as close as possible to", g.sense === "target" && g.close));
    sense.addEventListener("change", () => edit(() => {
      if (sense.value === "close" || sense.value === "target") { g.sense = "target"; g.close = sense.value === "close"; if (g.targetValue === undefined) g.targetValue = 0; }
      else { g.sense = sense.value; delete g.close; }
      if (g.sense === "max" && g.label === "Total cost") g.label = "Total profit";
      if (g.sense === "min" && g.label === "Total profit") g.label = "Total cost";
    }));
    let target = null;
    if (g.sense === "target") {
      target = h("input.ps-chip.ps-num", { type: "text", inputmode: "decimal", value: String(g.targetValue ?? 0), size: 6, "aria-label": "Target", "data-k": "goal:t" });
      target.addEventListener("input", () => { g.targetValue = parseNum(target.value); changed(false); });
    }
    return row("is-goal", { id: "goal" }, h("p.ps-line", {}, word("Make"), exprEl(g.expr, { bound: [], key: "goal" }, (nn) => { g.expr = nn; }), sense, target, word("— call it"), nameInput(g, "label", "Name of the goal")));
  }

  function renderBuilder() {
    const active = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.k;
    const sel = active && document.activeElement.selectionStart;
    const lists = { things: $("#s-things"), decisions: $("#s-decisions"), results: $("#s-results"), rules: $("#s-rules") };
    lists.things.replaceChildren(...model.things.map(thingEl));
    lists.decisions.replaceChildren(...model.decisions.map(decisionEl));
    lists.results.replaceChildren(...model.results.map(resultEl));
    lists.rules.replaceChildren(...model.rules.map(ruleEl));
    renderDatalists();
    renderSteps();
    $("#s-goal").replaceChildren(goalEl());
    renderQuestions();
    $("#m-title").value = model.title || "";
    for (const [k, el] of Object.entries(lists)) el.closest("section").classList.toggle("is-empty", !model[k].length);
    if (active) {
      const e = document.querySelector(`.ps [data-k="${CSS.escape(active)}"]`);
      if (e) { e.focus(); if (sel !== null && sel !== undefined && e.setSelectionRange && e.type === "text") try { e.setSelectionRange(sel, sel); } catch (x) { /* not a text field */ } }
    }
    $("#b-undo").disabled = !past.length;
    $("#b-redo").disabled = !future.length;
  }

  /* ---------- the four steps ---------- */
  function renderSteps() {
    const g = model.goal;
    const done = {
      decide: model.decisions.some((d) => !d.disabled),
      know: model.things.length > 0,
      rules: model.rules.some((r) => !r.disabled),
      best: !!(g && g.expr && !g.expr.hole),
    };
    document.querySelectorAll("#steps li").forEach((li) => { const ok = done[li.dataset.step]; li.classList.toggle("is-done", ok); li.querySelector("a").setAttribute("aria-label", `${li.textContent.trim()}: ${ok ? "done" : "to do"}`); });
    for (const id of ["#qd-each", "#qr-each"]) {
      const each = $(id), cur = each.value;
      each.replaceChildren(opt("", id === "#qd-each" ? "(just one)" : "(once)", !cur), ...tables().map((t) => opt(t.id, `for each ${(t.one || t.label).toLowerCase()}`, t.id === cur)));
    }
  }
  // "I decide how many workers to hire (for each store)": one line, one decision.
  function quickDecide() {
    const name = $("#qd-name").value.trim();
    if (!name) { $("#qd-name").focus(); return; }
    const type = $("#qd-type").value, each = $("#qd-each").value;
    const label = name[0].toUpperCase() + name.slice(1);
    edit(() => model.decisions.push({ id: uid(label), label, unit: "", type, lower: 0, upper: null, indexBy: each ? [each] : [] }));
    $("#qd-name").value = "";
    $("#qd-name").focus();
    flash(`Added the decision “${label}”${type === "binary" ? " (yes or no)" : type === "integer" ? " (a whole number)" : ""}.`);
  }
  // "cost per hour is 15 $/hour": one line, one number, kept in a group called "My numbers".
  function quickKnow() {
    const name = $("#qk-name").value.trim(), v = parseNum($("#qk-value").value);
    if (!name) { $("#qk-name").focus(); return; }
    if (v === null) { $("#qk-value").focus(); $("#qk-value").setAttribute("aria-invalid", "true"); return; }
    $("#qk-value").setAttribute("aria-invalid", "false");
    edit(() => {
      let t = model.things.find((x) => x.kind === "single" && x.label === "My numbers");
      if (!t) { t = { id: uid("my numbers"), label: "My numbers", kind: "single", properties: [] }; model.things.unshift(t); }
      t.properties.push({ id: uid(name, new Set(t.properties.map((x) => x.id))), label: name, value: v, unit: $("#qk-unit").value.trim() });
    });
    for (const id of ["#qk-name", "#qk-value", "#qk-unit"]) $(id).value = "";
    $("#qk-name").focus();
  }
  // "[…] must be at most […] (for each …)": a whole rule from two typed phrases.
  function quickRule() {
    const msg = $("#qr-msg"), each = $("#qr-each").value;
    const L = M.readFormula(model, $("#qr-lhs").value), R = M.readFormula(model, $("#qr-rhs").value);
    const bad = !$("#qr-lhs").value.trim() ? "Say what the rule is about, on the left." : L.error ? "Left side: " + L.error : !$("#qr-rhs").value.trim() ? "Say what it's compared with, on the right." : R.error ? "Right side: " + R.error : "";
    if (bad) { msg.textContent = bad; return; }
    msg.textContent = "";
    const op = $("#qr-op").value;
    // Named after what it protects: "No more than wood available", "At least demand".
    const rhsSaid = M.say(model, R.tree).replace(/^the /, ""), lhsSaid = M.say(model, L.tree).replace(/^the /, "");
    const short = (t) => t.length <= 40;
    const label = short(rhsSaid) && !(R.tree.const !== undefined && short(lhsSaid))
      ? { "<=": "No more than ", ">=": "At least ", "=": "Exactly " }[op] + rhsSaid
      : short(lhsSaid) ? `${lhsSaid[0].toUpperCase() + lhsSaid.slice(1)} ${{ "<=": "at most", ">=": "at least", "=": "exactly" }[op]} ${M.say(model, R.tree)}`
      : "Rule " + (model.rules.length + 1);
    edit(() => model.rules.push({ id: uid("rule"), label, kind: "compare", lhs: L.tree, op, rhs: R.tree, forEach: each ? [each] : [] }));
    for (const id of ["#qr-lhs", "#qr-rhs"]) $(id).value = "";
    $("#qr-lhs").focus();
    flash(`Added the rule “${label}”.`);
  }
  // "Make […] as high as possible".
  function quickGoal() {
    const msg = $("#qg-msg");
    const G = M.readFormula(model, $("#qg-expr").value);
    if (!$("#qg-expr").value.trim()) { msg.textContent = "Say what to make as high or as low as possible."; return; }
    if (G.error) { msg.textContent = G.error; return; }
    msg.textContent = "";
    const sense = $("#qg-sense").value;
    edit(() => {
      const g = model.goal;
      g.expr = G.tree; g.sense = sense; delete g.close;
      g.label = G.tree.ref && M.refInfo(ix(), G.tree.ref) ? M.refInfo(ix(), G.tree.ref).label : sense === "max" ? "Total profit" : "Total cost";
    });
    $("#qg-expr").value = "";
    flash(`The goal: make ${model.goal.label.toLowerCase()} as ${sense === "max" ? "high" : "low"} as possible.`);
  }
  // The quick lines' text boxes suggest names as you type, like the pencil does.
  function suggestOn(inp) {
    const list = h("ul.ps-suggest", { role: "listbox", hidden: true });
    inp.parentNode.style.position = "relative";
    inp.after(list);
    let matches = [], sel = -1;
    const word = () => inp.value.slice(0, inp.selectionStart).split(/[+\-*/(),×÷^−]|\b(?:plus|minus|times|divided by|across|over|of)\b/i).pop().replace(/^\s+/, "");
    const show = () => {
      const w = word().toLowerCase();
      matches = w ? plainNames().filter((n) => n.toLowerCase().includes(w) && n.toLowerCase() !== w).slice(0, 8) : [];
      sel = matches.length ? 0 : -1;
      list.style.left = inp.offsetLeft + "px"; list.style.top = inp.offsetTop + inp.offsetHeight + "px"; list.style.minWidth = inp.offsetWidth + "px";
      list.replaceChildren(...matches.map((n, i) => h("li", { role: "option", "aria-selected": String(i === sel), on: { mousedown: (e) => { e.preventDefault(); accept(i); } } }, n)));
      list.hidden = !matches.length;
    };
    const accept = (i) => { const w = word(), pos = inp.selectionStart; inp.value = inp.value.slice(0, pos - w.length) + matches[i] + inp.value.slice(pos); const c = pos - w.length + matches[i].length; inp.setSelectionRange(c, c); list.hidden = true; };
    inp.addEventListener("input", show);
    inp.addEventListener("blur", () => { list.hidden = true; });
    inp.addEventListener("keydown", (e) => {
      if (list.hidden || !matches.length) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { sel = (sel + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length; [...list.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === sel))); e.preventDefault(); }
      else if (e.key === "Tab" && sel >= 0) { e.preventDefault(); accept(sel); }
      else if (e.key === "Escape") list.hidden = true;
    });
  }
  function startBlank(note) {
    fromTemplate = null;
    load(blankModel(), note || "A blank model. Undo goes back to what you had.");
    $("#builder-wrap").open = true;
  }

  /* ---------- adding things ---------- */
  const ADD = {
    single: () => { const id = uid("thing"); model.things.push({ id, label: "Thing", kind: "single", properties: [{ id: "amount", label: "amount", value: 0, unit: "" }] }); return id; },
    table: () => { const id = uid("list"); model.things.push({ id, label: "Items", one: "Item", kind: "table", columns: [{ id: "amount", label: "Amount", unit: "" }], rows: [{ key: "Item 1", amount: 0 }, { key: "Item 2", amount: 0 }] }); return id; },
    grid: () => { const ts = tables(); const id = uid("grid"); model.things.push({ id, label: "Grid", kind: "grid", over: [ts[0] && ts[0].id, (ts[1] || ts[0] || {}).id], unit: "", values: {} }); return id; },
    decision: () => { const id = uid("decision"); model.decisions.push({ id, label: "How much", unit: "", type: "continuous", lower: 0, upper: null, indexBy: [] }); return id; },
    result: () => { const id = uid("result"); model.results.push({ id, label: "Result", unit: "", expr: { hole: true }, indexBy: [] }); return id; },
    rule: () => { const id = uid("rule"); model.rules.push({ id, label: "Rule", kind: "compare", lhs: { hole: true }, op: ">=", rhs: { const: 0 }, forEach: [] }); return id; },
    limit: () => { const id = uid("limit"); model.rules.push({ id, label: "Limit", kind: "compare", lhs: { hole: true }, op: "<=", rhs: { const: 0 }, forEach: [] }); return id; },
    pick: () => { const id = uid("pick"); model.rules.push({ id, label: "Choose some", kind: "pick", decision: "", op: "<=", count: { const: 1 } }); return id; },
    different: () => { const id = uid("different"); model.rules.push({ id, label: "Each gets a different one", kind: "different", decision: "" }); return id; },
  };
  function add(kind) {
    if (kind === "grid" && tables().length < 1) { flash("A grid needs a list first: add a list (or two) of things, then a grid of numbers for each pair."); return; }
    let id;
    edit(() => { id = ADD[kind](); });
    const e = document.querySelector(`.ps-s[data-id="${CSS.escape(id)}"] input, .ps-s[data-id="${CSS.escape(id)}"] select`);
    if (e) { e.focus(); if (e.select) e.select(); }
  }

  /* ---------- checks and the plain-English preview ---------- */
  function sizeOf(m) {
    const I = M.index(m);
    let n = 0;
    for (const d of m.decisions) if (!d.disabled) n += (d.indexBy || []).reduce((p, s) => p * M.keysOf(I, s).length, 1);
    return n;
  }
  const BIG_CHECKS = 40000, BIG_PHONE = 100000;
  function renderChecks(full) {
    let cards;
    const n = sizeOf(model);
    if (n > BIG_CHECKS && !full) cards = [{ level: "note", text: `This model has about ${n.toLocaleString("en-US")} decisions, so the full checks run when you solve, to keep typing quick.` }];
    else try { cards = M.validate(model); } catch (e) { cards = [{ level: "error", text: "Something in the model couldn't be read: " + e.message }]; }
    const box = $("#checks");
    box.replaceChildren(...cards.slice(0, 12).map((c) => h("li.ps-card.is-" + c.level, {}, h("span.ps-card-k", {}, c.level === "error" ? "Fix" : c.level === "warn" ? "Check" : "Note"),
      h("span", {}, c.text), c.where ? h("button.ps-link", { type: "button", on: { click: () => jump(c.where) } }, "Show") : null)));
    if (cards.length > 12) box.append(h("li.ps-card.is-note", {}, `…and ${cards.length - 12} more.`));
    document.querySelectorAll(".ps-s.has-error").forEach((e) => e.classList.remove("has-error"));
    for (const c of cards) if (c.level === "error" && c.where) { const e = document.querySelector(`.ps-s[data-id="${CSS.escape(c.where)}"]`); if (e) e.classList.add("has-error"); }
    $("#b-solve").setAttribute("aria-describedby", cards.some((c) => c.level === "error") ? "checks" : "");
    return cards;
  }
  function jump(id) {
    $("#builder-wrap").open = true;
    const e = document.querySelector(`.ps-s[data-id="${CSS.escape(id)}"]`);
    if (!e) return;
    e.scrollIntoView({ behavior: "smooth", block: "center" });
    e.classList.add("is-flash");
    setTimeout(() => e.classList.remove("is-flash"), 1200);
    const f = e.querySelector("input, select");
    if (f) f.focus({ preventScroll: true });
  }
  function renderPreview() { $("#preview").textContent = M.describe(model); }

  /* ---------- quick questions (a template's blanks) ---------- */
  function blanks() {
    const out = [];
    for (const t of model.things) {
      if (t.kind === "single") for (const p of t.properties || []) if (p.blank) out.push({ t, p });
      if ((t.kind === "table" || t.kind === "grid") && t.blank) out.push({ t });
    }
    return out;
  }
  function renderQuestions() {
    const qs = blanks(), box = $("#questions");
    box.hidden = !qs.length;
    if (!qs.length) return;
    const list = $("#q-list");
    list.replaceChildren(...qs.map(({ t, p }) => {
      if (p) {
        const inp = h("input.ps-q-in", { type: "text", inputmode: "decimal", value: p.value === null || p.value === undefined ? "" : String(p.value), "data-k": "q:" + t.id + "." + p.id });
        inp.addEventListener("input", () => { p.value = parseNum(inp.value); inp.setAttribute("aria-invalid", p.value === null ? "true" : "false"); changed(false); syncBuilderValue(t, p); });
        return h("label.ps-q-row", {}, h("span.ps-q-text", {}, p.prompt || `${t.label}: ${p.label}`), h("span.ps-q-field", {}, inp, p.unit ? h("span.ps-q-unit", {}, p.unit) : null));
      }
      return h("div.ps-q-row.is-wide", {}, h("span.ps-q-text", {}, t.prompt || t.label), t.kind === "table" ? tableEditor(t) : gridEditor(t));
    }));
    // The same tables appear in the builder; keep their focus keys apart.
    list.querySelectorAll("[data-k]").forEach((e) => { if (!e.dataset.k.startsWith("q:")) e.dataset.k = "q|" + e.dataset.k; });
  }
  function syncBuilderValue(t, p) {
    const e = document.querySelector(`.ps [data-k="${CSS.escape("pv:" + t.id + "." + p.id)}"]`);
    if (e && e !== document.activeElement) e.value = p.value === null ? "" : String(p.value);
  }

  /* ---------- solving ---------- */
  function markStale() {
    if (!last) return;
    const stale = JSON.stringify(stripUi(model)) !== lastModel;
    $("#out").classList.toggle("is-stale", stale);
    if (stale) status("The model changed. Solve again to update the answer.");
  }
  const stripUi = (m) => JSON.parse(JSON.stringify(m, (k, v) => (k === "_open" ? undefined : v)));
  const status = (t) => { $("#status").textContent = t; };
  let solving = false;
  async function solve() {
    // A phone has far less memory than a laptop; a model this size can take a gigabyte to solve.
    const n = sizeOf(model);
    const small = (navigator.deviceMemory && navigator.deviceMemory <= 4) || Math.min(screen.width, screen.height) < 600;
    if (n > BIG_PHONE && small && !window.confirm(`This model has about ${n.toLocaleString("en-US")} decisions. Solving it can need a gigabyte of memory, which may be too much for this device. Solve anyway?`)) return;
    const cards = renderChecks(true);
    const errs = cards.filter((c) => c.level === "error");
    if (errs.length) { status("Fix the cards marked “Fix” first."); showError(errs.map((e) => e.text), "Not ready to solve"); return; }
    solving = true;
    $("#b-solve").disabled = true;
    $("#progress").hidden = true;
    status("Solving…");
    const m = stripUi(model);
    const t0 = performance.now();
    let ans;
    try {
      ans = await ENG.solve(m, "main", (p) => {
        $("#progress").hidden = false;
        $("#prog-bar").value = p.gen / p.of;
        $("#prog-text").textContent = `Generation ${p.gen.toLocaleString()} of ${p.of.toLocaleString()} · best so far: ${fmt(goalShown(p.best, m), unitOfGoal(m))}${p.feasible ? "" : " (not yet meeting every rule)"}`;
      });
    } catch (err) { ans = { ok: false, status: "error", message: err.message }; }
    solving = false;
    $("#b-solve").disabled = false;
    $("#progress").hidden = true;
    if (!ans) return;
    last = ans;
    lastModel = JSON.stringify(m);
    renderAnswer(ans, m, performance.now() - t0);
  }
  const goalShown = (f, m) => (m.goal.sense === "max" ? -f : f);
  function unitOfGoal(m) {
    // The goal's unit: the unit of the result it names, or of a result with the goal's name.
    const I = M.index(m), g = m.goal;
    if (g.expr && g.expr.ref) { const i = M.refInfo(I, g.expr.ref); if (i && i.unit) return i.unit; }
    return (m.results.find((r) => r.label === g.label) || {}).unit || (g.expr ? M.unitOf(m, g.expr) : "");
  }
  function showError(lines, title) {
    const e = $("#error");
    e.hidden = false;
    e.replaceChildren(h("p.ps-msg-k", {}, title || "No answer"), ...[].concat(lines).map((l) => (typeof l === "string" ? h("p", {}, l) : l)));
  }

  /* ---------- the answer ---------- */
  const STATUS = {
    optimal: "Best possible answer (guaranteed)",
    local: "Good answer (nonlinear, not guaranteed best)",
    evolutionary: "Good answer (evolutionary, not guaranteed best)",
  };
  function decisionUnit(m, id) { const d = m.decisions.find((x) => x.id === id); return d ? d.unit || "" : ""; }
  function renderAnswer(a, m, ms) {
    const out = $("#out");
    out.classList.remove("is-stale");
    $("#error").hidden = true;
    $("#answer").hidden = true;
    const I = M.index(m);
    if (!a.ok) {
      status(a.status === "infeasible" ? "No plan meets every rule." : a.status === "unbounded" ? "The goal has no limit." : a.status === "model" ? "The model isn't finished." : "No answer.");
      if (a.status === "model") return showError((a.errors || []).map((e) => e.text), "Not ready to solve");
      if (a.status === "unbounded") {
        const names = (a.unbounded || []).map((id) => `“${(I.decisions[id] || {}).label || id}”`);
        const g = m.goal.label || "The goal";
        return showError([`${g} can ${m.goal.sense === "max" ? "grow" : "fall"} forever. ${names.length ? `You're probably missing a limit on ${joinAnd(names)}.` : "Some decision is missing a limit."}`], "No limit");
      }
      if (a.status === "infeasible") return showError(diagnosisEls(a, m), "These rules can't all be true at once");
      return showError([a.message || "The solver stopped without an answer."], "No answer");
    }
    $("#answer").hidden = false;
    const gu = unitOfGoal(m);
    const statusLine = a.status === "timeout" ? `Best found in ${m.options.timeLimitSec} s${a.gap !== null && a.gap !== undefined ? `, within ${(a.gap * 100).toFixed(a.gap < 0.01 ? 2 : 1)}% of the best possible` : ", not proven best"}` : STATUS[a.status];
    status(`${statusLine} · ${a.engine} · ${Math.round(ms)} ms`);
    // Headline.
    const how = m.goal.sense === "max" ? "as high as it can go" : m.goal.sense === "min" ? "as low as it can go" : m.goal.close ? `as close to ${fmt(m.goal.targetValue)} as it can get` : `on target`;
    $("#a-goal-k").textContent = m.goal.label || "Goal";
    $("#a-goal").textContent = fmt(a.goal, gu);
    $("#a-goal-s").textContent = a.status === "optimal" ? how : statusLine;
    $("#a-sentence").textContent = headlineSentence(a, m, gu);
    $("#a-head").replaceChildren(...headline(a, m));
    $("#a-engine").textContent = a.line;
    $("#a-notes").replaceChildren(...(a.notes || []).map((n) => h("li", {}, n)));
    // Decisions.
    $("#a-decisions").replaceChildren(...decisionTables(a, m));
    // Results.
    const named = m.results.filter((r) => !r.disabled && a.named[r.id]);
    $("#a-named-wrap").hidden = !named.length;
    $("#a-named").replaceChildren(...named.map((r) => {
      const es = a.named[r.id];
      if (es.length === 1 && !es[0].keys.length) return h("tr", {}, h("th", { scope: "row" }, r.label), h("td", {}, fmt(es[0].value, r.unit)));
      return h("tr", {}, h("th", { scope: "row" }, r.label), h("td", {}, es.slice(0, 24).map((e) => `${e.keys.join(", ")}: ${fmt(e.value, r.unit)}`).join(" · ") + (es.length > 24 ? " …" : "")));
    }));
    $("#a-why").replaceChildren(...why(a, m));
    renderLimiting(a, m);
    $("#a-rules").replaceChildren(...rulesTable(a, m).filter(Boolean));
    $("#exports").hidden = false;
    $("#b-lp").disabled = !a.lp;
    setupWhatIf();
  }
  function joinAnd(xs) { return xs.length <= 1 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1]; }
  // The answer as one sentence: every decision, then the goal.
  function headlineSentence(a, m, gu) {
    const bits = [];
    for (const d of m.decisions) {
      if (d.disabled || !a.decisions[d.id]) continue;
      const es = a.decisions[d.id];
      if (es.length === 1 && !es[0].keys.length) bits.push(d.type === "binary" ? `${d.label}: ${es[0].value > 0.5 ? "yes" : "no"}` : `${d.label}: ${fmt(es[0].value, d.unit)}`);
      else if (d.type === "binary") { const yes = es.filter((e) => e.value > 0.5); bits.push(`${d.label}: ${yes.length && yes.length <= 4 ? yes.map((e) => e.keys.join(" → ")).join(", ") : `${yes.length} of ${es.length}`}`); }
      else bits.push(`${d.label}: ${fmt(es.reduce((s, e) => s + e.value, 0), d.unit)} in all`);
      if (bits.length === 6) break;
    }
    return `${bits.join("; ")}. ${m.goal.label}: ${fmt(a.goal, gu)}.`;
  }
  function headline(a, m) {
    const parts = [];
    for (const d of m.decisions) {
      if (d.disabled || !a.decisions[d.id]) continue;
      const es = a.decisions[d.id];
      if (es.length === 1 && !es[0].keys.length) { parts.push([d.label, fmt(es[0].value, d.type === "binary" ? "" : d.unit), d.type === "binary" ? (es[0].value > 0.5 ? "yes" : "no") : null]); continue; }
      if (d.type === "binary") {
        const yes = es.filter((e) => e.value > 0.5);
        parts.push([d.label, `${yes.length} of ${es.length}`, yes.length && yes.length <= 6 ? yes.map((e) => e.keys.join(" → ")).join(", ") : null]);
      } else {
        const total = es.reduce((s, e) => s + e.value, 0), used = es.filter((e) => Math.abs(e.value) > 1e-7).length;
        parts.push([d.label, fmt(total, d.unit) + " in all", `${used} of ${es.length} non-zero`]);
      }
    }
    return parts.map(([k, v, s]) => h("li", {}, h("span.ps-hl-k", {}, k), h("span.ps-hl-v", {}, s && /^(yes|no)$/.test(s) ? s : v), s && !/^(yes|no)$/.test(s) ? h("span.ps-hl-s", {}, s) : null));
  }
  const CAP_ROWS = 100, CAP_COLS = 30;
  function decisionTables(a, m) {
    const out = [];
    const I = M.index(m);
    const scalars = m.decisions.filter((d) => !d.disabled && a.decisions[d.id] && !(d.indexBy || []).length);
    if (scalars.length) out.push(h("div.ps-scroll", { tabindex: "0", role: "region", "aria-label": "Decisions" }, h("table.ps-table", {},
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Decision"), h("th", { scope: "col" }, "Value"))),
      h("tbody", {}, scalars.map((d) => { const v = a.decisions[d.id][0].value; return h("tr", {}, h("th", { scope: "row" }, d.label), h("td", { class: Math.abs(v) < 1e-7 ? "z" : "" }, d.type === "binary" ? (v > 0.5 ? "yes" : "no") : fmt(v, d.unit))); })))));
    for (const d of m.decisions) {
      if (d.disabled || !a.decisions[d.id] || !(d.indexBy || []).length) continue;
      const es = a.decisions[d.id];
      const show = (v) => (d.type === "binary" ? (v > 0.5 ? "yes" : "·") : fmt(v));
      const cell = (v) => h("td", { class: Math.abs(v) < 1e-7 ? "z" : "" }, show(v));
      let table;
      if (d.indexBy.length === 2) {
        const [A, B] = d.indexBy, ka = M.keysOf(I, A), kb = M.keysOf(I, B);
        const at = new Map(es.map((e) => [e.keys.join("\u0001"), e.value]));
        table = h("table.ps-table.ps-gridtab", {}, h("thead", {}, h("tr", {}, h("th", {}, ""), kb.slice(0, CAP_COLS).map((b) => h("th", { scope: "col" }, b)), h("th", { scope: "col" }, "Total"))),
          h("tbody", {}, ka.slice(0, CAP_ROWS).map((x) => h("tr", {}, h("th", { scope: "row" }, x), kb.slice(0, CAP_COLS).map((b) => cell(at.get(x + "\u0001" + b) || 0)), h("td.tot", {}, d.type === "binary" ? String(kb.filter((b) => (at.get(x + "\u0001" + b) || 0) > 0.5).length) : fmt(kb.reduce((s, b) => s + (at.get(x + "\u0001" + b) || 0), 0)))))));
        if (ka.length > CAP_ROWS || kb.length > CAP_COLS) out.push(h("p.ps-hint", {}, `Showing ${Math.min(ka.length, CAP_ROWS)} × ${Math.min(kb.length, CAP_COLS)} of ${ka.length} × ${kb.length}. The Answer Report download has every value.`));
      } else {
        table = h("table.ps-table", {}, h("thead", {}, h("tr", {}, h("th", { scope: "col" }, d.indexBy.map((s) => M.setOne(I, s)).join(" · ")), h("th", { scope: "col" }, d.unit || "Value"))),
          h("tbody", {}, es.slice(0, CAP_ROWS * 2).map((e) => h("tr", {}, h("th", { scope: "row" }, e.keys.join(" · ")), cell(e.value)))));
      }
      out.push(h("p.ps-label.ps-subhead", {}, d.label + (d.unit && d.indexBy.length === 2 ? ` (${d.unit})` : "")), h("div.ps-scroll", { tabindex: "0", role: "region", "aria-label": d.label }, table));
    }
    return out;
  }
  function why(a, m) {
    const out = [];
    const tight = new Map();
    for (const r of a.rows) if (r.binding && r.op !== "=" && Math.abs(r.lhs) + Math.abs(r.rhs) > 1e-9) tight.set(r.rule, (tight.get(r.rule) || []).concat([r]));
    for (const [rule, rs] of tight) {
      const r = m.rules.find((x) => x.id === rule);
      if (!r) continue;
      const all = a.rows.filter((x) => x.rule === rule && x.op !== "=").length;
      out.push(h("li", {}, `“${r.label}” is used to the full${all > 1 ? ` in ${rs.length} of ${all} cases${rs.length <= 4 ? " (" + rs.map((x) => x.keys.join(", ")).join("; ") + ")" : ""}` : ""}.`));
    }
    const s = a.sensitivity;
    if (s) {
      const gu = unitOfGoal(m), sign = m.goal.sense === "max" ? -1 : 1;
      const notes = [];
      for (const v of a.x.map((val, i) => ({ val, i }))) {
        const rc = s.reduced[v.i] * sign;
        const vv = (lastVars(a, m) || [])[v.i];
        if (!vv || Math.abs(v.val) > 1e-7 || !(rc > 1e-7)) continue;
        notes.push([vv, rc]);
      }
      const byDec = new Map();
      for (const [vv, rc] of notes) if (!byDec.has(vv.decision)) byDec.set(vv.decision, [vv, rc]);
      for (const [id, [vv, rc]] of byDec) {
        const d = m.decisions.find((x) => x.id === id);
        out.push(h("li", {}, `“${vv.label}” stays at 0: each ${d && d.unit ? M.fmt(1, d.unit).replace(/^1 /, "") : "unit"} of it would make ${m.goal.label} worse by ${fmt(rc, gu)}${s.approx ? " (with the whole-number decisions held where they are)" : ""}.`));
      }
    }
    if (!out.length) out.push(h("li", {}, "No rule is at its limit: the goal settled where the costs and values balance."));
    return out;
  }
  // The variables in the order the answer has them, rebuilt from the decisions.
  function lastVars(a, m) {
    if (a._vars) return a._vars;
    const vs = [];
    for (const [id, es] of Object.entries(a.decisions)) { const d = m.decisions.find((x) => x.id === id); for (const e of es) vs[e.i] = { decision: id, keys: e.keys, label: (d ? d.label : id) + (e.keys.length ? " · " + e.keys.join(", ") : "") }; }
    a._vars = vs;
    return vs;
  }
  function ruleUnit(m, r) {
    const I = M.index(m);
    const u = r && r.lhs && r.lhs.ref ? (M.refInfo(I, r.lhs.ref) || {}).unit : r && r.rhs && r.rhs.ref ? (M.refInfo(I, r.rhs.ref) || {}).unit : "";
    return u || "";
  }
  function renderLimiting(a, m) {
    const box = $("#a-limit"), s = a.sensitivity;
    const wrap = $("#a-limit-wrap");
    if (s && !s.up.length) s.up = s.down = a.rows.map((r, j) => (r.binding ? s.rows[j] : undefined));
    if (!s || !s.up.length) {
      wrap.hidden = a.cls !== "nlp" && a.cls !== "nonsmooth" && a.cls !== "qp";
      box.replaceChildren(h("li", {}, a.cls === "qp" ? "Shadow prices aren't shown for quadratic goals yet." : "Shadow prices only make sense for linear models. For this one, try the what-if slider instead: it re-solves as you drag."));
      return;
    }
    wrap.hidden = false;
    const gu = unitOfGoal(m), g = m.goal.label;
    const items = [];
    a.rows.forEach((r, j) => {
      const up = s.up[j], down = s.down[j];
      if (up === undefined) return;
      if (Math.abs(up || 0) < 1e-9 && Math.abs(down || 0) < 1e-9) return;
      items.push({ r, up, down, mag: Math.max(Math.abs(up || 0), Math.abs(down || 0)) });
    });
    items.sort((x, y) => y.mag - x.mag);
    const say = (delta) => (delta === null ? "isn't possible (no plan could do it)" : Math.abs(delta) < 1e-9 ? `wouldn't change ${g}` : `would ${delta > 0 ? "raise" : "lower"} ${g} by ${fmt(Math.abs(delta), gu)}`);
    const lis = items.slice(0, 10).map(({ r, up, down }) => {
      const rule = m.rules.find((x) => x.id === r.rule);
      const u = ruleUnit(m, rule) || "unit";
      const one = M.fmt(1, u).replace(/^1 /, "");
      const what = `“${r.label}”${r.keys.length ? ` (${r.keys.join(", ")})` : ""}`;
      const more = r.op === "<=" ? `allowing 1 more ${one}` : r.op === ">=" ? `asking for 1 more ${one}` : `raising it by 1 ${one}`;
      const less = r.op === "<=" ? `allowing 1 ${one} less` : r.op === ">=" ? `asking for 1 ${one} less` : `lowering it by 1 ${one}`;
      if (up !== null && down !== null && Math.abs(up - down) <= 1e-6 * Math.max(1, Math.abs(up))) return h("li", {}, `${what}: ${more} ${say(up)}; ${less} ${say(-down)}.`);
      return h("li", {}, `${what}: ${more} ${say(up)}, but ${less} ${say(down === null ? null : -down)}. It's at a corner, so the two directions have different prices.`);
    });
    if (items.length > 10) lis.push(h("li.ps-muted", {}, `…and ${items.length - 10} more in the Sensitivity Report.`));
    if (!lis.length) lis.push(h("li", {}, "No rule is holding the goal back: loosening any one of them a little wouldn't change it."));
    if (s.approx) lis.unshift(h("li.ps-muted", {}, `Approximate: based on keeping ${joinAnd(s.fixed.map((id) => "“" + ((m.decisions.find((d) => d.id === id) || {}).label || id) + "”"))} fixed where the solver put ${s.fixed.length > 1 ? "them" : "it"}. Whole-number decisions don't have exact shadow prices.`));
    box.replaceChildren(...lis);
  }
  function rulesTable(a, m) {
    const rows = a.rows.slice(0, 200);
    return [h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Rule"), h("th", { scope: "col" }, "Left side"), h("th", { scope: "col" }, ""), h("th", { scope: "col" }, "Right side"), h("th", { scope: "col" }, "Room to spare"))),
      h("tbody", {}, rows.map((r) => h("tr", { class: r.binding ? "is-tight" : "" }, h("th", { scope: "row" }, r.label + (r.keys.length ? " · " + r.keys.join(", ") : "")), h("td", {}, fmt(r.lhs)), h("td.op", {}, { "<=": "≤", ">=": "≥", "=": "=" }[r.op]), h("td", {}, fmt(r.rhs)), h("td", { class: r.binding ? "z" : "" }, r.op === "=" ? "—" : r.binding ? "none (tight)" : fmt(r.slack))))),
      a.rows.length > 200 ? h("caption.ps-hint", {}, `First 200 of ${a.rows.length} rules.`) : null];
  }
  function diagnosisEls(a, m) {
    const I = M.index(m);
    const d = a.diagnosis;
    if (!d) return [h("p", {}, a.message || "No plan meets every rule, and the diagnosis couldn't run. Try turning rules off one at a time to see which ones clash.")];
    const words = d.broken.map((b) => {
      if (b.kind === "limit") return `the limit on “${b.label}” (it would have to ${b.dir < 0 ? "go above" : "go below"} ${fmt(b.limit, decisionUnit(m, b.decision))} by ${fmt(b.amount, decisionUnit(m, b.decision))})`;
      if (b.kind === "goal") return `the goal's target (off by ${fmt(b.amount)})`;
      const u = ruleUnit(m, m.rules.find((r) => r.id === b.rule));
      return `“${b.label}”${b.keys && b.keys.length ? " for " + b.keys.join(", ") : ""} (${b.dir > 0 ? "short" : "over"} by ${fmt(b.amount, u)})`;
    });
    const others = d.conflict.filter((id) => !d.broken.some((b) => b.rule === id)).map((id) => `“${(m.rules.find((r) => r.id === id) || {}).label || id}”`);
    const lines = [h("p", {}, `To find a plan, the solver would have to break ${joinAnd(words) || "a rule"}${others.length ? `. The rules pushing against ${words.length > 1 ? "them" : "it"}: ${joinAnd(others)}` : ""}. Try relaxing one of them.`)];
    // One-click fixes: a decision that's turned off but used by a rule that broke; turning a rule off.
    const fixes = [];
    const brokenRules = new Set(d.broken.filter((b) => b.rule).map((b) => b.rule).concat(d.conflict));
    for (const dec of model.decisions) if (dec.disabled) {
      const usedBy = model.rules.filter((r) => brokenRules.has(r.id) && M.uses(model, r).has(dec.id));
      if (usedBy.length) fixes.push(h("button.ps-btn.ps-fix", { type: "button", on: { click: () => { edit(() => { dec.disabled = false; }); solve(); } } }, `Turn “${dec.label}” back on`));
    }
    for (const b of d.broken) if (b.kind === "limit") {
      const dec = model.decisions.find((x) => x.id === b.decision);
      if (dec && typeof dec[b.dir < 0 ? "upper" : "lower"] === "number") fixes.push(h("button.ps-btn.ps-fix", { type: "button", on: { click: () => { edit(() => { dec[b.dir < 0 ? "upper" : "lower"] = b.limit + (b.dir < 0 ? b.amount : -b.amount); }); solve(); } } }, `${b.dir < 0 ? "Raise" : "Lower"} the limit on “${dec.label}” to ${fmt(b.limit + (b.dir < 0 ? b.amount : -b.amount))}`));
    }
    for (const id of [...new Set(d.broken.filter((b) => b.rule).map((b) => b.rule))].slice(0, 3)) {
      const r = model.rules.find((x) => x.id === id);
      if (r) fixes.push(h("button.ps-btn.ps-fix", { type: "button", on: { click: () => { edit(() => { r.disabled = true; }); solve(); } } }, `Turn “${r.label}” off`));
    }
    if (fixes.length) lines.push(h("p.ps-fixes", {}, fixes));
    return lines;
  }

  /* ---------- what-if ---------- */
  let wi = null;
  function inputsList(m) {
    const out = [];
    for (const t of m.things) {
      if (t.kind === "single") for (const p of t.properties || []) out.push({ id: `p|${t.id}|${p.id}`, label: `${t.label}: ${p.label}`, get: (mm) => thingOf(mm, t.id).properties.find((x) => x.id === p.id), unit: p.unit });
      if (t.kind === "table") for (const c of t.columns || []) for (const r of t.rows.slice(0, 60)) out.push({ id: `c|${t.id}|${c.id}|${r.key}`, label: `${c.label} · ${r.key}`, cell: true, unit: c.unit });
    }
    return out;
  }
  const thingOf = (mm, id) => mm.things.find((t) => t.id === id);
  function getInput(mm, id) {
    const [k, t, a, b] = id.split("|");
    const th = thingOf(mm, t);
    if (!th) return null;
    if (k === "p") { const p = (th.properties || []).find((x) => x.id === a); return p ? p.value : null; }
    const r = th.rows.find((x) => String(x.key) === b);
    return r ? r[a] : null;
  }
  function setInput(mm, id, v) {
    const [k, t, a, b] = id.split("|");
    const th = thingOf(mm, t);
    if (k === "p") (th.properties || []).find((x) => x.id === a).value = v;
    else th.rows.find((x) => String(x.key) === b)[a] = v;
  }
  function setupWhatIf() {
    const m = JSON.parse(lastModel);
    const list = inputsList(m);
    const sel = $("#wi-input");
    const keep = sel.value;
    sel.replaceChildren(opt("", "choose a number…", !keep), ...list.map((x) => opt(x.id, x.label, x.id === keep)));
    $("#whatif").hidden = !list.length;
    if (keep && list.some((x) => x.id === keep)) pickWhatIf(keep, true); else $("#wi-body").hidden = true;
  }
  function pickWhatIf(id, quiet) {
    if (!id) { $("#wi-body").hidden = true; return; }
    const m = JSON.parse(lastModel);
    const v0 = Number(getInput(m, id)) || 0;
    const lo = v0 > 0 ? 0 : v0 < 0 ? 2 * v0 : 0, hi = v0 > 0 ? 2 * v0 : v0 < 0 ? 0 : 10;
    const step = niceStep((hi - lo) / 200);
    wi = { id, v0, lo, hi, step, base: m, unit: (inputsList(m).find((x) => x.id === id) || {}).unit };
    const r = $("#wi-range");
    r.min = lo; r.max = hi; r.step = step; r.value = v0;
    $("#wi-body").hidden = false;
    $("#wi-chart").replaceChildren();
    showWi(v0, last);
    if (!quiet) r.focus();
  }
  function niceStep(x) { if (!(x > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(x))); const n = x / p; return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p; }
  function showWi(v, a) {
    $("#wi-val").textContent = fmt(v, wi.unit);
    if (!a) { $("#wi-out").textContent = "…"; return; }
    if (!a.ok) { $("#wi-out").textContent = a.status === "infeasible" ? "No plan meets every rule at this value." : a.status === "unbounded" ? "The goal has no limit at this value." : "No answer at this value."; return; }
    const m = wi.base;
    const parts = m.decisions.filter((d) => !d.disabled && a.decisions[d.id] && !(d.indexBy || []).length).slice(0, 4).map((d) => `${d.label} ${d.type === "binary" ? (a.decisions[d.id][0].value > 0.5 ? "yes" : "no") : fmt(a.decisions[d.id][0].value, d.unit)}`);
    $("#wi-out").replaceChildren(h("strong", {}, `${m.goal.label}: ${fmt(a.goal, unitOfGoal(m))}`), parts.length ? " · " + parts.join(" · ") : "");
  }
  const wiSolve = debounce(async (v) => {
    const m = clone(wi.base);
    setInput(m, wi.id, v);
    const a = await ENG.solve(m, "whatif");
    if (a && wi && Number($("#wi-range").value) === v) showWi(v, a);
  }, 250);
  async function drawCurve() {
    if (!wi) return;
    const n = 21, pts = [];
    $("#wi-chart").replaceChildren(h("p.ps-hint", {}, "Solving 21 points…"));
    for (let k = 0; k < n; k++) {
      const v = wi.lo + ((wi.hi - wi.lo) * k) / (n - 1);
      const m = clone(wi.base);
      setInput(m, wi.id, v);
      const a = await ENG.solve(m, "curve");
      if (!a) return; // a newer curve replaced this one
      pts.push([v, a.ok ? a.goal : null]);
    }
    $("#wi-chart").replaceChildren(curveSvg(pts));
  }
  function curveSvg(pts) {
    const W = 560, H = 200, L = 64, R = 16, T = 16, B = 32;
    const ys = pts.map((p) => p[1]).filter((y) => y !== null);
    if (!ys.length) return h("p.ps-hint", {}, "No point in this range had an answer.");
    let y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; }
    const X = (x) => L + ((x - wi.lo) / (wi.hi - wi.lo || 1)) * (W - L - R), Y = (y) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
    let d = "", pen = false;
    for (const [x, y] of pts) { if (y === null) { pen = false; continue; } d += (pen ? "L" : "M") + X(x).toFixed(1) + " " + Y(y).toFixed(1); pen = true; }
    const gu = unitOfGoal(wi.base);
    const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(wi.base.goal.label)} as the chosen number changes, from ${esc(fmt(wi.lo))} to ${esc(fmt(wi.hi))}">
      <line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" class="ax"/>
      <text x="${L - 8}" y="${Y(y1) + 4}" class="tk" text-anchor="end">${esc(fmt(y1, gu))}</text>
      <text x="${L - 8}" y="${Y(y0) + 4}" class="tk" text-anchor="end">${esc(fmt(y0, gu))}</text>
      <text x="${L}" y="${H - 10}" class="tk">${esc(fmt(wi.lo))}</text>
      <text x="${W - R}" y="${H - 10}" class="tk" text-anchor="end">${esc(fmt(wi.hi))}</text>
      <line x1="${X(wi.v0)}" y1="${T}" x2="${X(wi.v0)}" y2="${H - B}" class="now"/>
      <path d="${d}" class="ln"/>
      ${pts.filter((p) => p[1] !== null).map(([x, y]) => `<circle cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="2.5" class="pt"><title>${esc(fmt(x))}: ${esc(fmt(y, gu))}</title></circle>`).join("")}
    </svg>`;
    return h("div.ps-curve", { html: svg + `<p class="ps-hint">${esc(wi.base.goal.label)} against ${esc((inputsList(wi.base).find((x) => x.id === wi.id) || {}).label || "")}. The vertical line is today's value; gaps are values with no answer.</p>` });
  }

  /* ---------- the math ---------- */
  function renderMath() {
    let mm;
    try { mm = M.math(model); } catch (e) { mm = { html: "<p>The model can't be written out yet.</p>", tex: "" }; }
    $("#math-body").innerHTML = mm.html;
    $("#math").dataset.tex = mm.tex;
  }

  /* ---------- reports ---------- */
  function download(name, blob) {
    const a = h("a", { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  const slug = (s) => String(s || "model").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "model";
  function reportSheets(a, m) {
    const vars = lastVars(a, m), gu = unitOfGoal(m);
    const decType = (id) => ((m.decisions.find((d) => d.id === id) || {}).type || "continuous");
    const S = [];
    const title = (t) => [[{ v: `Plain Solver ${t}`, s: "bold" }], [m.title || "Model"], [`Solved ${new Date().toLocaleString()} · ${a.engine} · ${STATUS[a.status] || a.status}`], []];
    const ans = title("Answer Report");
    ans.push([{ v: "Objective", s: "head" }, { v: "Sense", s: "head" }, { v: "Final value", s: "head" }]);
    ans.push([m.goal.label, m.goal.sense === "max" ? "Max" : m.goal.sense === "min" ? "Min" : "Value of " + m.goal.targetValue, { v: a.goal, s: "n2" }]);
    ans.push([]);
    ans.push([{ v: "Variable", s: "head" }, { v: "Final value", s: "head" }, { v: "Unit", s: "head" }, { v: "Integer", s: "head" }]);
    vars.forEach((v, i) => { if (v) ans.push([v.label, { v: a.x[i], s: "n2" }, decisionUnit(m, v.decision), decType(v.decision) === "continuous" ? "Contin" : decType(v.decision) === "binary" ? "Binary" : "Integer"]); });
    ans.push([]);
    ans.push([{ v: "Constraint", s: "head" }, { v: "Cell value", s: "head" }, { v: "Formula", s: "head" }, { v: "Status", s: "head" }, { v: "Slack", s: "head" }]);
    for (const r of a.rows) {
      const rule = m.rules.find((x) => x.id === r.rule);
      ans.push([r.label + (r.keys.length ? " · " + r.keys.join(", ") : ""), { v: r.lhs, s: "n2" }, `${fmt(r.lhs)} ${{ "<=": "<=", ">=": ">=", "=": "=" }[r.op]} ${fmt(r.rhs)}${rule ? "  (" + M.sayRule(m, rule) + ")" : ""}`, r.binding ? "Binding" : "Not Binding", { v: r.op === "=" ? 0 : Math.max(0, r.slack), s: "n2" }]);
    }
    S.push({ name: "Answer Report", widths: [40, 16, 60, 14, 14], rows: ans });
    if (a.sensitivity) {
      const s = a.sensitivity, sen = title("Sensitivity Report");
      if (s.approx) sen.push([`Approximate: whole-number decisions held at their values (${s.fixed.map((id) => (m.decisions.find((d) => d.id === id) || {}).label).join(", ")}); a MIP has no exact duals.`], []);
      const R = s.ranges, rng = (v) => (v === undefined || v === null ? "" : v === Infinity ? "1E+30" : { v, s: "n2" });
      sen.push([{ v: "Variable", s: "head" }, { v: "Final value", s: "head" }, { v: "Reduced cost", s: "head" }, { v: "Objective coefficient", s: "head" }, { v: "Allowable increase", s: "head" }, { v: "Allowable decrease", s: "head" }]);
      vars.forEach((v, i) => { if (v) sen.push([v.label, { v: a.x[i], s: "n2" }, { v: s.reduced[i], s: "n2" }, { v: s.cost[i], s: "n2" }, rng(R && R.cost[i] && R.cost[i].inc), rng(R && R.cost[i] && R.cost[i].dec)]); });
      sen.push([]);
      sen.push([{ v: "Constraint", s: "head" }, { v: "Final value", s: "head" }, { v: "Shadow price", s: "head" }, { v: "Goal change, 1 unit more", s: "head" }, { v: "Goal change, 1 unit less", s: "head" }, { v: "Constraint R.H. side", s: "head" }, { v: "Allowable increase", s: "head" }, { v: "Allowable decrease", s: "head" }]);
      a.rows.forEach((r, j) => sen.push([r.label + (r.keys.length ? " · " + r.keys.join(", ") : ""), { v: r.lhs, s: "n2" }, { v: s.rows[j], s: "n2" }, s.up[j] === undefined ? "" : s.up[j] === null ? "infeasible" : { v: s.up[j], s: "n2" }, s.down[j] === undefined ? "" : s.down[j] === null ? "infeasible" : { v: -s.down[j], s: "n2" }, { v: r.rhs, s: "n2" }, rng(R && R.rhs[j] && R.rhs[j].inc), rng(R && R.rhs[j] && R.rhs[j].dec)]));
      sen.push([], ["Shadow price is HiGHS's dual value: the change in the goal per unit added to the right-hand side. At a corner it holds in one direction only; the two columns after it come from re-solving with the limit moved a little each way. Allowable increase and decrease: how far one number can move, the others held, before the price (or, for a cost, the answer) changes; 1E+30 means no limit. Found by re-solving; computed for models with up to 80 rules and decisions."]);
      S.push({ name: "Sensitivity Report", widths: [40, 14, 14, 22, 22, 18, 18, 18], rows: sen });
    }
    if (a.limits) {
      const lim = title("Limits Report");
      lim.push([{ v: "Objective", s: "head" }, { v: "Value", s: "head" }], [m.goal.label, { v: a.goal, s: "n2" }], []);
      lim.push([{ v: "Variable", s: "head" }, { v: "Value", s: "head" }, { v: "Lower limit", s: "head" }, { v: "Objective result", s: "head" }, { v: "Upper limit", s: "head" }, { v: "Objective result", s: "head" }]);
      a.limits.forEach((L, i) => { const v = vars[i]; if (v) lim.push([v.label, { v: a.x[i], s: "n2" }, Number.isFinite(L.lo) ? { v: L.lo, s: "n2" } : "no limit", L.goalAtLo === null ? "" : { v: L.goalAtLo, s: "n2" }, Number.isFinite(L.hi) ? { v: L.hi, s: "n2" } : "no limit", L.goalAtHi === null ? "" : { v: L.goalAtHi, s: "n2" }]); });
      lim.push([], ["Each decision moved on its own with every other decision held at its final value, as far as the rules allow."]);
      S.push({ name: "Limits Report", widths: [40, 14, 14, 18, 14, 18], rows: lim });
    }
    return S;
  }
  function downloadReports() {
    if (!last || !last.ok) return;
    const m = JSON.parse(lastModel);
    download(`${slug(m.title)}-reports.xlsx`, window.APXlsx.blob(reportSheets(last, m)));
  }
  function printReports() {
    if (!last || !last.ok) return;
    const m = JSON.parse(lastModel);
    const box = $("#print");
    box.innerHTML = reportSheets(last, m).map((sh) => `<section><h2>${esc(sh.name)}</h2><table>${sh.rows.map((r) => `<tr>${(r || []).map((c) => { const o = c && typeof c === "object" ? c : { v: c }; const v = typeof o.v === "number" ? fmt(o.v) : o.v === undefined || o.v === null ? "" : o.v; return o.s === "head" ? `<th>${esc(v)}</th>` : `<td>${esc(v)}</td>`; }).join("")}</tr>`).join("")}</table></section>`).join("") + (showMath ? `<section><h2>The model</h2>${$("#math-body").innerHTML}</section>` : "");
    document.body.classList.add("ps-printing");
    window.print();
    setTimeout(() => document.body.classList.remove("ps-printing"), 500);
  }

  /* ---------- share links, files ---------- */
  async function encode(obj) {
    const json = JSON.stringify(stripUi(obj));
    const b64 = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    if (window.CompressionStream) {
      const s = new Blob([json]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      const buf = new Uint8Array(await new Response(s).arrayBuffer());
      let out = "";
      for (let i = 0; i < buf.length; i += 8192) out += String.fromCharCode(...buf.subarray(i, i + 8192));
      return "z." + btoa(out).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
    return "j." + b64(new TextEncoder().encode(json));
  }
  async function decode(s) {
    const kind = s.slice(0, 2), data = s.slice(2).replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(data + "===".slice((data.length + 3) % 4)), (c) => c.charCodeAt(0));
    if (kind === "z.") return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text());
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  async function share() {
    const code = await encode(model);
    const url = location.origin + location.pathname + "#m=" + code;
    history.replaceState(null, "", "#m=" + code);
    try { await navigator.clipboard.writeText(url); flash(`Link copied. It carries the whole model (${Math.round(url.length / 1024 * 10) / 10} KB of address), nothing stored anywhere.`); }
    catch (e) { flash("The link is in the address bar: copy it from there."); }
  }
  function flash(t) { const f = $("#flash"); f.textContent = t; f.hidden = false; clearTimeout(flash.t); flash.t = setTimeout(() => { f.hidden = true; }, 5000); }
  function load(m, note) {
    snapshot();
    model = normalize(m);
    last = null; lastModel = null;
    $("#out").classList.remove("is-stale");
    $("#answer").hidden = true; $("#error").hidden = true; $("#exports").hidden = true; $("#whatif").hidden = true;
    status("Ready. Press Solve when the model says what you want.");
    renderAdvanced();
    changed(true);
    $("#builder-wrap").open = !blanks().length;
    if (note) flash(note);
  }

  /* ---------- templates ---------- */
  function mine() { try { return JSON.parse(store.get(MINE) || "[]"); } catch (e) { return []; } }
  function renderTemplates() {
    const card = (t, own) => h("li.ps-tpl", {},
      h("button.ps-tpl-b", { type: "button", on: { click: () => { fromTemplate = t.id; load(clone(t.model), `Loaded “${t.title}”. Undo goes back to what you had.`); $("#workspace").scrollIntoView({ behavior: "smooth" }); } } },
        h("span.ps-tpl-tags", {}, own ? "Yours" : t.tags), h("span.ps-tpl-t", {}, t.title), h("span.ps-tpl-d", {}, t.blurb || "")),
      own ? h("button.ps-tool.ps-tpl-x", { type: "button", "aria-label": `Delete your template ${t.title}`, title: "Delete this template", on: { click: () => { store.set(MINE, JSON.stringify(mine().filter((x) => x.id !== t.id))); renderTemplates(); } } }, "✕") : null);
    $("#tpls").replaceChildren(...TPL.list.map((t) => card(t)), ...mine().map((t) => card(t, true)));
  }
  function openSaveTemplate() {
    const dlg = $("#d-save");
    const items = [];
    for (const t of model.things) {
      if (t.kind === "single") for (const p of t.properties || []) items.push({ t, p, label: `${t.label}: ${p.label}`, on: !!p.blank, prompt: p.prompt || "" });
      else items.push({ t, label: `${t.label} (the whole ${t.kind === "grid" ? "grid" : "list"})`, on: !!t.blank, prompt: t.prompt || "" });
    }
    $("#ds-name").value = model.title || "My template";
    $("#ds-list").replaceChildren(...items.map((it, k) => {
      const cb = h("input", { type: "checkbox", checked: it.on, id: "ds-c" + k });
      const pr = h("input.ps-in", { type: "text", value: it.prompt, placeholder: "Question to ask (optional)", "aria-label": `Question for ${it.label}` });
      it.cb = cb; it.pr = pr;
      return h("li", {}, h("label", { for: "ds-c" + k }, cb, " ", it.label), pr);
    }));
    $("#ds-blank").checked = true;
    dlg._items = items;
    dlg.showModal();
  }
  function saveTemplate() {
    const dlg = $("#d-save");
    const m = clone(stripUi(model));
    m.title = $("#ds-name").value || "My template";
    const clear = $("#ds-blank").checked;
    for (const it of dlg._items) {
      const t = m.things.find((x) => x.id === it.t.id);
      const target = it.p ? t.properties.find((x) => x.id === it.p.id) : t;
      if (it.cb.checked) { target.blank = true; target.prompt = it.pr.value || undefined; if (clear && it.p) target.value = null; }
      else { delete target.blank; delete target.prompt; }
    }
    const list = mine();
    list.push({ id: "mine-" + Date.now(), title: m.title, blurb: m.description || "", model: m });
    store.set(MINE, JSON.stringify(list));
    dlg.close();
    renderTemplates();
    flash(`Saved “${m.title}” to your templates (in this browser).`);
  }

  /* ---------- importing tables: paste, .csv, .xlsx ---------- */
  function parseDelimited(text) {
    const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
    if (!lines.length) return [];
    const tab = lines[0].includes("\t"), sep = tab ? "\t" : lines[0].split(";").length > lines[0].split(",").length ? ";" : ",";
    return lines.map((l) => {
      if (tab) return l.split("\t");
      const out = []; let cur = "", q = false;
      for (let i = 0; i < l.length; i++) {
        const c = l[i];
        if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
        else if (c === '"') q = true; else if (c === sep) { out.push(cur); cur = ""; } else cur += c;
      }
      out.push(cur);
      return out;
    }).map((r) => r.map((c) => c.trim()));
  }
  async function readXlsx(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let e = buf.byteLength - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error("That file isn't a readable .xlsx.");
    const n = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const files = {};
    for (let k = 0; k < n; k++) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
      files[name] = { method, csize, off };
      p += 46 + nlen + xlen + clen;
    }
    const text = async (name) => {
      const f = files[name];
      if (!f) return null;
      const start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true);
      const raw = u8.subarray(start, start + f.csize);
      if (f.method === 0) return new TextDecoder().decode(raw);
      return new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
    };
    const xml = (s) => new DOMParser().parseFromString(s, "application/xml");
    const shared = [];
    const ss = await text("xl/sharedStrings.xml");
    if (ss) for (const si of xml(ss).getElementsByTagName("si")) shared.push([...si.getElementsByTagName("t")].map((t) => t.textContent).join(""));
    const wb = xml(await text("xl/workbook.xml"));
    const rels = xml((await text("xl/_rels/workbook.xml.rels")) || "<x/>");
    const target = {};
    for (const r of rels.getElementsByTagName("Relationship")) target[r.getAttribute("Id")] = r.getAttribute("Target");
    const sheets = [];
    for (const s of wb.getElementsByTagName("sheet")) {
      const rid = s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      let path = target[rid] || "";
      path = path.startsWith("/") ? path.slice(1) : "xl/" + path.replace(/^\.\//, "");
      sheets.push({ name: s.getAttribute("name"), path });
    }
    const readSheet = async (path) => {
      const doc = xml(await text(path));
      const grid = [];
      for (const c of doc.getElementsByTagName("c")) {
        const ref = c.getAttribute("r") || "", m = /^([A-Z]+)(\d+)$/.exec(ref);
        if (!m) continue;
        const col = m[1].split("").reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1, rowI = Number(m[2]) - 1;
        const t = c.getAttribute("t"), v = c.getElementsByTagName("v")[0];
        let val = v ? v.textContent : "";
        if (t === "s") val = shared[Number(val)] || "";
        else if (t === "inlineStr") val = [...c.getElementsByTagName("t")].map((x) => x.textContent).join("");
        (grid[rowI] = grid[rowI] || [])[col] = val;
      }
      const w = Math.max(0, ...grid.map((r) => (r ? r.length : 0)));
      return grid.filter(Boolean).map((r) => Array.from({ length: w }, (_, i) => (r[i] === undefined ? "" : String(r[i]))));
    };
    return { sheets, readSheet };
  }
  function cutRange(grid, range) {
    const m = /^\s*([A-Z]+)(\d+)\s*:\s*([A-Z]+)(\d+)\s*$/i.exec(range || "");
    if (!m) return grid;
    const col = (s) => s.toUpperCase().split("").reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const c0 = col(m[1]), r0 = Number(m[2]) - 1, c1 = col(m[3]), r1 = Number(m[4]) - 1;
    return grid.slice(r0, r1 + 1).map((r) => r.slice(c0, c1 + 1));
  }
  let imp = null;
  function openImport(target, upload) {
    imp = { target: target || null, grid: null, xlsx: null, units: {} };
    const d = $("#d-import");
    $("#di-text").value = "";
    $("#di-file").value = "";
    $("#di-sheet-wrap").hidden = true;
    $("#di-all").hidden = true;
    $("#di-preview").replaceChildren();
    $("#di-name").value = target ? target.label : "";
    $("#di-as").value = target ? target.kind : "table";
    $("#di-as").disabled = !!target;
    $("#di-ok").disabled = true;
    $("#di-paste").hidden = !!upload;
    d.showModal();
    if (upload) $("#di-file").click(); else $("#di-text").focus();
  }
  function previewImport() {
    const g = imp.grid || [];
    $("#di-ok").disabled = g.length < 2;
    const as = $("#di-as").value;
    const shown = g.slice(0, 8).map((r) => r.slice(0, 8));
    $("#di-preview").replaceChildren(g.length ? h("table.ps-table.ps-mini", {}, shown.map((r, i) => h("tr", {}, r.map((c, j) => (i === 0 || j === 0 ? h("th", {}, c) : h("td", {}, c)))))) : "",
      g.length ? unitFields(g, as) : "",
      g.length ? h("p.ps-hint", {}, as === "grid" ? `A grid: ${g.length - 1} rows × ${(g[0] || []).length - 1} columns of numbers. The first row and first column are the names.` : `A list of ${g.length - 1} rows. The first column is each row's name; the first row names the columns.`) : "");
  }
  // The spec asks for the units to be confirmed at import: one per column, or one for a grid.
  function unitFields(g, as) {
    imp.units = imp.units || {};
    const heads = as === "grid" ? ["the numbers"] : g[0].slice(1).map((c, j) => c || `Column ${j + 1}`);
    return h("div.ps-fields", {}, heads.slice(0, 12).map((c, j) => {
      const inp = h("input", { type: "text", value: imp.units[j] || "", placeholder: "unit, like $ or hours", "aria-label": `Unit for ${c}` });
      inp.addEventListener("input", () => { imp.units[j] = inp.value; });
      return h("label.ps-field", {}, h("span.ps-name", {}, `Unit for ${c}`), inp);
    }));
  }
  function finishImport() {
    const g = imp.grid;
    if (!g || g.length < 2) return;
    const as = imp.target ? imp.target.kind : $("#di-as").value;
    const name = $("#di-name").value.trim() || "Imported";
    const num = (s) => { const v = parseNum(s); return v; };
    const uniq = (keys) => { const seen = new Map(); return keys.map((k, i) => { let kk = String(k || `Row ${i + 1}`).trim() || `Row ${i + 1}`; if (seen.has(kk)) { const n = seen.get(kk) + 1; seen.set(kk, n); kk = `${kk} (${n})`; } else seen.set(kk, 1); return kk; }); };
    edit(() => {
      if (as === "grid") {
        const rowKeys = uniq(g.slice(1).map((r) => r[0])), colKeys = uniq(g[0].slice(1));
        const findOrMake = (keys, label) => {
          const hit = tables().find((t) => t.rows.length === keys.length && t.rows.every((r, i) => String(r.key) === keys[i]));
          if (hit) return hit.id;
          const id = uid(label);
          model.things.push({ id, label, one: label.replace(/s$/, ""), kind: "table", columns: [], rows: keys.map((k) => ({ key: k })) });
          return id;
        };
        let t = imp.target;
        const A = t ? t.over[0] : findOrMake(rowKeys, "Rows of " + name), B = t ? t.over[1] : findOrMake(colKeys, "Columns of " + name);
        if (!t) { t = { id: uid(name), label: name, kind: "grid", over: [A, B], unit: "", values: {} }; model.things.push(t); }
        if (imp.units && imp.units[0]) t.unit = imp.units[0];
        t.values = {};
        rowKeys.forEach((a, i) => { t.values[a] = {}; colKeys.forEach((b, j) => { t.values[a][b] = num(g[i + 1][j + 1]); }); });
      } else {
        let t = imp.target;
        const head = g[0];
        const cols = head.slice(1).map((label, j) => ({ id: "c" + (j + 1), label: String(label || `Column ${j + 1}`), unit: (imp.units && imp.units[j]) || "" }));
        if (!t) { t = { id: uid(name), label: name, one: name.replace(/s$/, ""), kind: "table", columns: [], rows: [] }; model.things.push(t); }
        const taken = new Set(["key"]);
        t.columns = cols.map((c) => { const id = uid(c.label, taken); taken.add(id); return { ...c, id }; });
        const keys = uniq(g.slice(1).map((r) => r[0]));
        t.rows = g.slice(1).map((r, i) => { const o = { key: keys[i] }; t.columns.forEach((c, j) => { o[c.id] = num(r[j + 1]); }); return o; });
      }
    });
    $("#d-import").close();
    flash(`Imported ${g.length - 1} rows.`);
  }

  /* ---------- building blocks: fill-in-the-blank sentences that write a whole pattern ---------- */
  let blk = null;
  function openBlocks() {
    blk = { block: null, answers: {} };
    $("#db-list").replaceChildren(...window.PSBlocks.list.map((b) => h("li", {}, h("button.ps-tpl-b", { type: "button", on: { click: () => { blk.block = b; blk.answers = {}; for (const p of b.parts) if (p.b === "name" || p.b === "num") blk.answers[p.key] = p.def; renderMadlib(); } } },
      h("span.ps-tpl-t", {}, b.title), h("span.ps-tpl-d", {}, b.blurb)))));
    $("#db-fill").hidden = true;
    $("#db-none").hidden = tables().length > 0;
    $("#d-blocks").showModal();
  }
  function renderMadlib() {
    const b = blk.block, A = blk.answers, I = ix();
    $("#db-fill").hidden = false;
    $("#db-title").textContent = b.title;
    const redo = () => renderMadlib();
    const sel = (key, items, optional, label) => {
      const sl = h("select.ps-chip.ps-blank", { "aria-label": label, "data-k": "blank:" + key });
      sl.append(opt("", optional ? "none" : "choose…", !A[key]));
      for (const [v, l] of items) sl.append(opt(v, l, A[key] === v));
      if (A[key] && !items.some(([v]) => v === A[key])) A[key] = "";
      sl.addEventListener("change", () => { A[key] = sl.value; redo(); });
      return sl;
    };
    const parts = b.parts.map((p) => {
      if (typeof p === "string") return h("span.ps-word", {}, " " + p + " ");
      const opt2 = p.optional;
      switch (p.b) {
        case "list": return sel(p.key, tables().map((t) => [t.id, t.label]), opt2, `Which list (${p.hint || "a list"})`);
        case "col": {
          const t = I.sets[A[p.of]];
          const cols = t ? (t.columns || []).filter((c) => (p.type === "link" ? c.kind === "link" : p.type === "number" ? !c.kind || c.kind === "number" : true)) : [];
          return sel(p.key, cols.map((c) => [c.id, c.label]), opt2, `Which column${p.note ? " (" + p.note + ")" : ""}`);
        }
        case "grid": {
          const [x, y] = p.over.map((k) => A[k]);
          const gs = model.things.filter((t) => t.kind === "grid" && x && y && ((t.over[0] === x && t.over[1] === y) || (t.over[0] === y && t.over[1] === x)));
          return sel(p.key, gs.map((g) => [g.id, g.label]), opt2, "Which grid");
        }
        case "dec": return sel(p.key, model.decisions.filter((d) => !p.of || (d.indexBy || []).includes(A[p.of])).map((d) => [d.id, d.label]), opt2, `Which decision${p.note ? " (" + p.note + ")" : ""}`);
        case "ref": return h("span.ps-word.ps-blank-ref", {}, A[p.of] ? M.setOne(I, A[p.of]).toLowerCase() : "…");
        case "num": case "name": {
          const inp = h("input.ps-chip.ps-name.ps-blank", { type: "text", value: A[p.key] ?? "", size: Math.max(4, String(A[p.key] ?? "").length + 1), placeholder: opt2 ? "optional" : "", "aria-label": p.key, "data-k": "blank:" + p.key, inputmode: p.b === "num" ? "decimal" : null });
          inp.addEventListener("input", () => { A[p.key] = p.b === "num" ? (inp.value.trim() === "" ? "" : parseNum(inp.value)) : inp.value; inp.size = Math.max(4, inp.value.length + 1); });
          return inp;
        }
      }
      return "";
    });
    const active = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.k;
    $("#db-madlib").replaceChildren(...parts);
    if (active) { const e = document.querySelector(`#db-madlib [data-k="${CSS.escape(active)}"]`); if (e) e.focus(); }
    $("#db-msg").textContent = "";
  }
  function addBlock() {
    if (!blk || !blk.block) return;
    let res;
    const before = JSON.stringify(model);
    const m = JSON.parse(before);
    const taken = new Set();
    for (const t of m.things) taken.add(t.id);
    for (const k of ["decisions", "results", "rules"]) for (const x of m[k]) taken.add(x.id);
    const fresh = (label) => { const id = uid(label, taken); taken.add(id); return id; };
    try { res = window.PSBlocks.build(m, blk.block, blk.answers, fresh); }
    catch (e) { res = { error: "That didn't fit together: " + e.message }; }
    if (res.error) { $("#db-msg").textContent = res.error; return; }
    snapshot();
    model = normalize(m);
    changed(true);
    $("#d-blocks").close();
    flash(`Added: ${res.added.join(", ")}. Undo takes it out again.`);
  }

  /* ---------- combining another model into this one ---------- */
  function openCombine() {
    $("#dc-list").replaceChildren(...TPL.list.concat(mine()).map((t) => h("li", {}, h("button.ps-tpl-b", { type: "button", on: { click: () => combine(clone(t.model), t.title) } }, h("span.ps-tpl-t", {}, t.title), h("span.ps-tpl-d", {}, t.blurb || "")))));
    $("#d-combine").showModal();
  }
  function combine(other, title) {
    snapshot();
    const res = window.PSBlocks.merge(model, other);
    normalize(model);
    changed(true);
    $("#d-combine").close();
    flash(`Combined “${title}” into this model. ${res.note} Undo takes it out again.`);
  }

  /* ---------- the model as text ---------- */
  const AI_GUIDE = () => `Write an optimization model for Plain Solver (juantorresmi.github.io/plain-solver) in its text format. One statement per line; indented lines belong to the statement above.

title: <name>
thing "<name>"                       a single thing with numbers
  "<number name>" = <value> [<unit>]
list "<name>" (one "<singular>")     a list of rows (also something to do "for each" of)
  columns: "<col>" [<unit>], "<col>" -> <OtherList>, "<col>" (text)
  <row name>: <value>, <value>, ...  (quote names with commas: "C, north")
grid "<name>" [<unit>] over <ListA>, <ListB>
  <ListA row>: <one number per ListB row, in order>
decide "<name>" [<unit>] for each <List>, <List>: any amount | whole number | yes or no, at least <f>, at most <f>, can go negative
result "<name>" [<unit>] for each <List> = <formula>
rule "<name>" for each <List> where <condition>: <formula> <= | >= | = <formula>
rule "<name>": <formula> between <formula> and <formula>
rule "<name>": choose at most <n> of <yes-or-no decision for each of a list>
rule "<name>": each <ListA> gets a different <ListB>, every one taken
minimize "<name>": <formula>     (or maximize, or: make "<name>": <formula> equal to <n>)

Formulas refer to things by name, with underscores for spaces: Units_made, Workers.units_per_hour, Stores.Demand (a list's column, for the current row), Freight (a grid). Decisions and results with "for each" are used inside "for each" or totals.
Totals: sum(<List>, <formula>), sum(<List> where <List>.<col> = this.<OtherList>, <formula>), avg(...), count(<List> where ...).
Other rows: Inventory[Months-1 or 0] (the previous row, 0 before the first), Plants.Cost[Plants via Lanes.From] (follow a link column), Demand[Stores=Store A] (a fixed row).
Math: + - * / ^, sqrt, abs, max(a, b), min(a, b), if(condition, a, b), exp, log. Conditions: = != < <= > >= and or not, "text" in quotes.
Linear models are solved exactly; use whole number / yes or no where needed. Prefer a list of links (From -> A, To -> B) over a full grid when most pairs don't exist.

Current model, for reference:
${window.PSText.write(model)}`;
  function openText() {
    $("#dt-text").value = window.PSText.write(stripUi(model));
    $("#dt-msg").textContent = "";
    $("#d-text").showModal();
  }
  function applyText() {
    const r = window.PSText.read($("#dt-text").value);
    if (r.error) {
      $("#dt-msg").textContent = `Line ${r.line}: ${r.error}`;
      const ta = $("#dt-text"), lines = ta.value.split("\n"), start = lines.slice(0, r.line - 1).join("\n").length + (r.line > 1 ? 1 : 0);
      ta.focus(); ta.setSelectionRange(start, start + (lines[r.line - 1] || "").length);
      return;
    }
    $("#d-text").close();
    load(r.model, "Read the model from text. Undo goes back to what you had.");
  }

  /* ---------- a whole workbook at once ---------- */
  // Every sheet becomes a list, or a grid when its first row and first column both name rows of
  // lists. A column whose names are all rows of one list becomes a link to it.
  async function importWorkbook() {
    if (!imp.xlsx) return;
    const sheets = [];
    for (const sh of imp.xlsx.sheets) {
      const g = (await imp.xlsx.readSheet(sh.path)).filter((r) => r.some((c) => String(c).trim() !== ""));
      if (g.length >= 2) sheets.push({ name: sh.name, g });
    }
    if (!sheets.length) { flash("No sheet had at least a header row and one row of data."); return; }
    edit(() => {
      const keysByList = new Map(tables().map((t) => [t.id, new Set(t.rows.map((r) => String(r.key)))]));
      const matchList = (vals) => { const vs = vals.map((v) => String(v).trim()).filter(Boolean); if (!vs.length) return null; for (const [id, ks] of keysByList) if (vs.every((v) => ks.has(v))) return id; return null; };
      const isNum = (v) => String(v).trim() === "" || parseNum(v) !== null;
      // First pass: sheets that are lists (their first column names the rows).
      const pending = [];
      for (const sh of sheets) {
        const rowKeys = sh.g.slice(1).map((r) => String(r[0]).trim()), colKeys = sh.g[0].slice(1).map((c) => String(c).trim());
        sh.rowKeys = rowKeys; sh.colKeys = colKeys;
        const allNum = sh.g.slice(1).every((r) => r.slice(1).every(isNum));
        if (allNum && colKeys.length > 1 && matchList(colKeys) && matchList(rowKeys)) { pending.push(sh); continue; }
        const t = { id: uid(sh.name), label: sh.name, one: sh.name.replace(/s$/, ""), kind: "table", columns: [], rows: [] };
        const taken = new Set(["key"]);
        t.columns = colKeys.map((label, j) => { const id = uid(label || "column", taken); taken.add(id); return { id, label: label || `Column ${j + 1}`, unit: "" }; });
        const seen = new Map();
        t.rows = sh.g.slice(1).map((r, i) => { let k = String(r[0] || `Row ${i + 1}`).trim(); if (seen.has(k)) { seen.set(k, seen.get(k) + 1); k += ` (${seen.get(k)})`; } else seen.set(k, 1); const o = { key: k }; t.columns.forEach((c, j) => { o[c.id] = r[j + 1]; }); return o; });
        model.things.push(t);
        keysByList.set(t.id, new Set(t.rows.map((r) => r.key)));
        sh.table = t;
      }
      // Columns: numbers, links to a list whose names they all are, or text.
      for (const sh of sheets) if (sh.table) for (const c of sh.table.columns) {
        const vals = sh.table.rows.map((r) => r[c.id]);
        if (vals.every(isNum)) { for (const r of sh.table.rows) r[c.id] = parseNum(r[c.id]); continue; }
        const link = matchList(vals);
        if (link && link !== sh.table.id) { c.kind = "link"; c.links = link; } else c.kind = "text";
        for (const r of sh.table.rows) r[c.id] = String(r[c.id] ?? "").trim();
        delete c.unit;
      }
      // Then the grids.
      for (const sh of pending) {
        const A = matchList(sh.rowKeys), B = matchList(sh.colKeys);
        const t = { id: uid(sh.name), label: sh.name, kind: "grid", over: [A, B], unit: "", values: {} };
        sh.rowKeys.forEach((a, i) => { t.values[a] = {}; sh.colKeys.forEach((b, j) => { t.values[a][b] = parseNum(sh.g[i + 1][j + 1]); }); });
        model.things.push(t);
      }
    });
    $("#d-import").close();
    flash(`Brought in ${sheets.length} sheet${sheets.length > 1 ? "s" : ""}: ${sheets.map((s) => s.name).join(", ")}. Check the column types (numbers, names, text) in each list.`);
  }

  /* ---------- advanced ---------- */
  function renderAdvanced() {
    const o = model.options;
    $("#o-engine").value = o.engine || "auto";
    $("#o-time").value = o.timeLimitSec;
    $("#o-gap").value = Math.round((o.mipGap === undefined ? 0.0001 : o.mipGap) * 1e6) / 1e4;
    $("#o-multi").value = o.multistart === undefined ? "auto" : o.multistart ? "on" : "off";
  }
  function wireAdvanced() {
    const set = (fn) => () => { snapshot(); fn(model.options); changed(false); };
    $("#o-engine").addEventListener("change", set((o) => { o.engine = $("#o-engine").value; }));
    $("#o-time").addEventListener("change", set((o) => { o.timeLimitSec = Math.max(1, Math.min(600, Number($("#o-time").value) || 30)); }));
    $("#o-gap").addEventListener("change", set((o) => { o.mipGap = Math.max(0, Math.min(50, Number($("#o-gap").value) || 0)) / 100; }));
    $("#o-multi").addEventListener("change", set((o) => { const v = $("#o-multi").value; if (v === "auto") delete o.multistart; else o.multistart = v === "on"; }));
    $("#o-typed").checked = typed;
    $("#o-typed").addEventListener("change", () => { typed = $("#o-typed").checked; store.set("plain-solver:typed", typed ? "1" : "0"); renderBuilder(); });
  }

  /* ---------- start ---------- */
  async function init() {
    $("#app").hidden = false;
    renderTemplates();
    wireAdvanced();
    $("#b-solve").addEventListener("click", solve);
    $("#q-solve").addEventListener("click", solve);
    $("#b-stop").addEventListener("click", () => ENG.stop());
    $("#b-undo").addEventListener("click", undo);
    $("#b-redo").addEventListener("click", redo);
    $("#b-blank").addEventListener("click", () => startBlank());
    $("#b-build").addEventListener("click", () => {
      startBlank("A blank page. Start with step 1: what do you decide? Undo goes back to what you had.");
      $("#workspace").scrollIntoView({ behavior: "smooth" });
      setTimeout(() => $("#qd-name").focus({ preventScroll: true }), 300);
    });
    $("#b-start-import").addEventListener("click", () => { startBlank("A blank model, ready for your spreadsheet."); openImport(null, true); });
    $("#b-start-text").addEventListener("click", () => {
      startBlank();
      openText();
      $("#dt-text").value = "title: My model\n\n# Write one line per sentence, or copy the format guide into an AI chat with a description of your problem.\n";
    });
    $("#qd-add").addEventListener("click", quickDecide);
    $("#qd-name").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); quickDecide(); } });
    $("#qk-add").addEventListener("click", quickKnow);
    for (const id of ["#qk-name", "#qk-value", "#qk-unit"]) $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); quickKnow(); } });
    $("#b-blocks2").addEventListener("click", () => openBlocks());
    $("#qr-add").addEventListener("click", quickRule);
    $("#qg-set").addEventListener("click", quickGoal);
    for (const id of ["#qr-lhs", "#qr-rhs"]) $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); quickRule(); } });
    $("#qg-expr").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); quickGoal(); } });
    for (const id of ["#qr-lhs", "#qr-rhs", "#qg-expr"]) suggestOn($(id));
    $("#b-share").addEventListener("click", share);
    $("#b-json").addEventListener("click", () => download(`${slug(model.title)}.json`, new Blob([JSON.stringify(stripUi(model), null, 2)], { type: "application/json" })));
    $("#b-open").addEventListener("click", () => $("#f-json").click());
    $("#f-json").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const m = JSON.parse(await f.text()); if (!m || !Array.isArray(m.decisions)) throw new Error(); load(m, `Opened ${f.name}.`); }
      catch (err) { flash("That file isn't a Plain Solver model (.json)."); }
      e.target.value = "";
    });
    $("#b-save-tpl").addEventListener("click", openSaveTemplate);
    $("#ds-ok").addEventListener("click", (e) => { e.preventDefault(); saveTemplate(); });
    $("#ds-cancel").addEventListener("click", () => $("#d-save").close());
    $("#m-title").addEventListener("input", () => { model.title = $("#m-title").value; changed(false); });
    $("#b-math").addEventListener("click", () => { showMath = !showMath; $("#b-math").setAttribute("aria-pressed", String(showMath)); $("#math").hidden = !showMath; if (showMath) renderMath(); });
    $("#b-tex").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("#math").dataset.tex || ""); flash("LaTeX copied."); } catch (e) { flash("Couldn't reach the clipboard."); } });
    $("#b-reports").addEventListener("click", downloadReports);
    $("#b-print").addEventListener("click", printReports);
    $("#b-lp").addEventListener("click", () => last && last.lp && download(`${slug(model.title)}.lp`, new Blob([last.lp], { type: "text/plain" })));
    $("#wi-input").addEventListener("change", () => pickWhatIf($("#wi-input").value));
    $("#wi-range").addEventListener("input", () => { const v = Number($("#wi-range").value); $("#wi-val").textContent = fmt(v, wi.unit); $("#wi-out").textContent = "…"; wiSolve(v); });
    $("#wi-curve").addEventListener("click", drawCurve);
    $("#wi-keep").addEventListener("click", () => { if (!wi) return; const v = Number($("#wi-range").value); edit((mm) => setInput(mm, wi.id, v)); solve(); });
    // Adding sentences.
    document.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => add(b.dataset.add)));
    $("#b-paste").addEventListener("click", () => openImport(null));
    $("#b-blocks").addEventListener("click", openBlocks);
    $("#db-add").addEventListener("click", (e) => { e.preventDefault(); addBlock(); });
    $("#db-cancel").addEventListener("click", () => $("#d-blocks").close());
    $("#b-combine").addEventListener("click", openCombine);
    $("#dc-cancel").addEventListener("click", () => $("#d-combine").close());
    $("#dc-file").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const m = JSON.parse(await f.text()); if (!m || !Array.isArray(m.decisions)) throw new Error(); combine(m, f.name); }
      catch (err) { flash("That file isn't a Plain Solver model (.json)."); }
      e.target.value = "";
    });
    $("#b-text").addEventListener("click", openText);
    $("#dt-apply").addEventListener("click", (e) => { e.preventDefault(); applyText(); });
    $("#dt-cancel").addEventListener("click", () => $("#d-text").close());
    $("#dt-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("#dt-text").value); $("#dt-msg").textContent = "Copied."; } catch (e) { $("#dt-msg").textContent = "Couldn't reach the clipboard."; } });
    $("#dt-ai").addEventListener("click", async () => { try { await navigator.clipboard.writeText(AI_GUIDE()); $("#dt-msg").textContent = "Copied the format guide, with this model as an example. Paste it into an AI chat with a description of your problem, then paste its answer here."; } catch (e) { $("#dt-msg").textContent = "Couldn't reach the clipboard."; } });
    $("#di-all").addEventListener("click", (e) => { e.preventDefault(); importWorkbook(); });
    $("#b-upload").addEventListener("click", () => openImport(null, true));
    // The import dialog.
    $("#di-text").addEventListener("input", () => { imp.grid = parseDelimited($("#di-text").value); previewImport(); });
    $("#di-as").addEventListener("change", previewImport);
    $("#di-cancel").addEventListener("click", () => $("#d-import").close());
    $("#di-ok").addEventListener("click", (e) => { e.preventDefault(); finishImport(); });
    $("#di-range").addEventListener("change", async () => { if (imp.xlsx) { imp.grid = cutRange(await imp.xlsx.readSheet(imp.xlsx.sheets[$("#di-sheet").value].path), $("#di-range").value); previewImport(); } });
    $("#di-sheet").addEventListener("change", () => $("#di-range").dispatchEvent(new Event("change")));
    $("#di-file").addEventListener("change", async (e) => {
      const f = e.target.files[0]; if (!f) return;
      $("#di-paste").hidden = false;
      if (!$("#di-name").value) $("#di-name").value = f.name.replace(/\.\w+$/, "");
      try {
        if (/\.xlsx$/i.test(f.name)) {
          imp.xlsx = await readXlsx(await f.arrayBuffer());
          $("#di-sheet").replaceChildren(...imp.xlsx.sheets.map((s, i) => opt(i, s.name)));
          $("#di-sheet-wrap").hidden = false;
          $("#di-all").hidden = imp.xlsx.sheets.length < 2;
          imp.grid = cutRange(await imp.xlsx.readSheet(imp.xlsx.sheets[0].path), $("#di-range").value);
        } else { imp.xlsx = null; imp.grid = parseDelimited(await f.text()); }
        $("#di-text").value = imp.grid.map((r) => r.join("\t")).join("\n");
        previewImport();
      } catch (err) { flash(err.message || "Couldn't read that file."); }
    });
    document.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey) || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
      else if (e.key === "Enter") { e.preventDefault(); solve(); }
    });

    // What to open with: a share link, the model from last time, or the first template.
    let start = null, note = null;
    const hash = /[#&]m=([^&]+)/.exec(location.hash);
    if (hash) { try { start = await decode(hash[1]); note = "Opened the shared model. It's yours to change: nothing is sent back."; } catch (e) { note = "That share link couldn't be read."; } }
    if (!start) { try { start = JSON.parse(store.get(KEY) || "null"); } catch (e) { start = null; } }
    if (!start) { start = clone(TPL.list[0].model); fromTemplate = TPL.list[0].id; }
    model = normalize(start);
    renderAdvanced();
    changed(true);
    $("#builder-wrap").open = !blanks().length;
    status("Ready. Press Solve when the model says what you want.");
    if (note) flash(note);
    ENG.warm();
  }
  init();
})();
