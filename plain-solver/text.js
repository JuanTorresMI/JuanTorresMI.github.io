/* The whole model as plain text, and back: for writing a big model in one go, pasting one in, or
 * having an AI chat write one. Same model either way; the text is just another view of the JSON.
 *
 *   PSText.write(model) -> text
 *   PSText.read(text)   -> { model } | { error, line }
 *
 * The format, one statement per line (indented lines belong to the statement above):
 *   title: Weekly staffing
 *   thing "Workers"
 *     "units per hour" = 10 [units/hour] ? How many units does one worker make in an hour?
 *   list "Routes" (one "Route")
 *     columns: "From" -> Warehouses, "Cost" [$/unit], "Mode" (text)
 *     R1: Reno, 4, truck
 *   grid "Freight" [$/unit] over Warehouses, Stores
 *     Reno: 4, 6, 9
 *   decide "Units to ship" [units] for each Warehouses, Stores: any amount, at least 0, at most Warehouses.Cap
 *   result "Units made" [units] = Workers.units_per_hour * Hours
 *   rule "Supply" for each Warehouses: sum(Stores, Units_to_ship) <= Warehouses.Supply
 *   rule "Trucks" for each Routes where Routes.Mode = "truck": Flow <= 40
 *   rule "Calories" : Calories between 1800 and 2400
 *   rule "Sites" : choose at most 2 of Open_the_site
 *   rule "Shifts" : each People gets a different Shifts using Assigned, every one taken
 *   minimize "Total cost": Total_cost
 *   options: engine auto, time limit 30, gap 0.0001
 * Formulas use names: a label with underscores for spaces (Units_made, Workers.units_per_hour).
 * "(off)" after a label turns a sentence off; "? question" marks a value the quick form asks for.
 */
(function (root) {
  "use strict";
  const M = typeof module !== "undefined" && module.exports ? require("./model.js") : root.PSModel;

  /* ---------- writing ---------- */
  const q = (s) => '"' + String(s ?? "").replace(/"/g, "'") + '"';
  const cell = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[,:"]|^\s|\s$/.test(s) || s === "" ? '"' + s.replace(/"/g, "'") + '"' : s;
  };
  const unit = (u) => (u ? ` [${u}]` : "");
  const off = (x) => (x.disabled ? " (off)" : "");
  function write(model) {
    const N = M.names(model);
    const nm = (id) => N.byId[id] || id;
    const F = (e) => M.formula(model, e, N);
    const as = (id, label) => (N.byId[id] && N.byId[id] !== M.toName(label) ? ` as ${N.byId[id]}` : "");
    const each = (sets) => (sets && sets.length ? ` for each ${sets.map(nm).join(", ")}` : "");
    const out = ["# Plain Solver model. Formulas use names: labels with underscores for spaces.", `title: ${model.title || "Model"}`, ""];
    for (const t of model.things || []) {
      const ask = t.blank ? ` ? ${t.prompt || ""}`.trimEnd() : "";
      if (t.kind === "single") {
        out.push(`thing ${q(t.label)}${as(t.id, t.label)}`);
        for (const p of t.properties || []) out.push(`  ${q(p.label)} = ${p.value === null || p.value === undefined ? "" : p.value}${unit(p.unit)}${p.blank ? ` ? ${p.prompt || ""}`.trimEnd() : ""}`);
      } else if (t.kind === "table") {
        out.push(`list ${q(t.label)}${as(t.id, t.label)} (one ${q(t.one || t.label)})${ask}`);
        const cols = t.columns || [];
        if (cols.length) out.push("  columns: " + cols.map((c) => q(c.label) + (c.kind === "link" ? ` -> ${nm(c.links)}` : c.kind === "text" ? " (text)" : unit(c.unit))).join(", "));
        for (const r of t.rows) out.push("  " + cell(r.key) + (cols.length ? ": " + cols.map((c) => cell(r[c.id])).join(", ") : ""));
      } else if (t.kind === "grid") {
        const [A, B] = t.over || [];
        out.push(`grid ${q(t.label)}${as(t.id, t.label)}${unit(t.unit)} over ${nm(A)}, ${nm(B)}${ask}`);
        const ix = M.index(model), kb = M.keysOf(ix, B);
        for (const a of M.keysOf(ix, A)) out.push("  " + cell(a) + ": " + kb.map((b) => cell(((t.values || {})[a] || {})[b])).join(", "));
      }
      out.push("");
    }
    for (const d of model.decisions || []) {
      const type = d.type === "binary" ? "yes or no" : d.type === "integer" ? "whole number" : "any amount";
      const parts = [type];
      if (d.type !== "binary") {
        if (d.lower === null) parts.push("can go negative");
        else if (d.lower !== undefined && d.lower !== 0) parts.push("at least " + (typeof d.lower === "number" ? d.lower : F(d.lower)));
        if (d.upper !== null && d.upper !== undefined) parts.push("at most " + (typeof d.upper === "number" ? d.upper : F(d.upper)));
      }
      out.push(`decide ${q(d.label)}${as(d.id, d.label)}${unit(d.unit)}${off(d)}${each(d.indexBy)}: ${parts.join(", ")}`);
    }
    if ((model.decisions || []).length) out.push("");
    for (const r of model.results || []) out.push(`result ${q(r.label)}${as(r.id, r.label)}${unit(r.unit)}${off(r)}${each(r.indexBy)} = ${F(r.expr)}`);
    if ((model.results || []).length) out.push("");
    for (const r of model.rules || []) {
      const head = `rule ${q(r.label)}${off(r)}`;
      if (r.kind === "pick") out.push(`${head}: choose ${{ "<=": "at most", ">=": "at least", "=": "exactly" }[r.op || "<="]} ${F(r.count)} of ${nm(r.decision)}`);
      else if (r.kind === "different") {
        const d = (model.decisions || []).find((x) => x.id === r.decision);
        const [A, B] = (d && d.indexBy) || [];
        out.push(`${head}: each ${nm(A)} gets a different ${nm(B)} using ${nm(r.decision)}${r.fillAll ? ", every one taken" : ""}`);
      } else {
        const w = r.where && (r.forEach || []).length ? ` where ${F(r.where)}` : "";
        const body = r.op === "between" ? `${F(r.lhs)} between ${F(r.rhs)} and ${F(r.rhs2)}` : `${F(r.lhs)} ${r.op || ">="} ${F(r.rhs)}`;
        out.push(`${head}${each(r.forEach)}${w}: ${body}`);
      }
    }
    if ((model.rules || []).length) out.push("");
    const g = model.goal;
    if (g && g.expr) {
      if (g.sense === "target") out.push(`make ${q(g.label)}${off(g)}: ${F(g.expr)} ${g.close ? "as close as possible to" : "equal to"} ${g.targetValue}`);
      else out.push(`${g.sense === "max" ? "maximize" : "minimize"} ${q(g.label)}${off(g)}: ${F(g.expr)}`);
    }
    const o = model.options || {};
    const opts = [`engine ${o.engine || "auto"}`, `time limit ${o.timeLimitSec ?? 30}`, `gap ${o.mipGap ?? 0.0001}`];
    if (o.multistart !== undefined) opts.push(`multistart ${o.multistart ? "on" : "off"}`);
    out.push(`options: ${opts.join(", ")}`);
    return out.join("\n") + "\n";
  }

  /* ---------- reading ---------- */
  // Splits at a separator outside quotes, parentheses and brackets.
  function splitTop(s, sep) {
    const out = [];
    let depth = 0, inQ = false, cur = "";
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"') inQ = !inQ;
      else if (!inQ && (c === "(" || c === "[")) depth++;
      else if (!inQ && (c === ")" || c === "]")) depth--;
      if (!inQ && depth === 0 && s.startsWith(sep, i)) { out.push(cur); cur = ""; i += sep.length - 1; continue; }
      cur += c;
    }
    out.push(cur);
    return out;
  }
  // The first top-level occurrence of any of the strings; returns [index, which] or [-1].
  function findTop(s, seps, from) {
    let depth = 0, inQ = false;
    for (let i = from || 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (inQ) continue;
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth--;
      else if (depth === 0) for (const sp of seps) if (s.startsWith(sp, i)) return [i, sp];
    }
    return [-1];
  }
  const unq = (s) => { s = s.trim(); return s.startsWith('"') && s.endsWith('"') && s.length >= 2 ? s.slice(1, -1) : s; };
  const cells = (s) => splitTop(s, ",").map((x) => unq(x));
  const numOrNull = (s) => { const t = String(s).trim().replace(/[,$€£%\s]/g, ""); if (t === "") return null; const v = Number(t); return Number.isFinite(v) ? v : NaN; };

  function read(text) {
    const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
    const model = { schemaVersion: 1, title: "Model", things: [], decisions: [], results: [], rules: [], goal: { label: "Total cost", sense: "min", expr: { hole: true } }, options: { engine: "auto", timeLimitSec: 30, mipGap: 0.0001 } };
    const taken = new Set();
    const uid = (name) => { let b = String(name).replace(/[^A-Za-z0-9]+/g, "") || "item"; if (/^\d/.test(b)) b = "n" + b; b = b[0].toLowerCase() + b.slice(1); let id = b, k = 2; while (taken.has(id)) id = b + k++; taken.add(id); return id; };
    const byName = {}; // name -> id, for lists (for each, over, links) and everything formulas reference
    const later = []; // formulas to read once every name is known
    let cur = null;
    const err = (line, msg) => ({ error: msg, line: line + 1 });
    // A head like:  "Label" as Name [unit] (off) (one "Row")  ? question
    function head(s) {
      const m = /^\s*("[^"]*"|[^\s\[(:=?]+)/.exec(s);
      if (!m) return null;
      let rest = s.slice(m[0].length);
      const label = unq(m[1]).replace(/_/g, (x) => (m[1].startsWith('"') ? x : " "));
      const o = { label, name: M.toName(label) };
      let k;
      if ((k = /^\s*as\s+([\w]+)/.exec(rest))) { o.name = k[1]; rest = rest.slice(k[0].length); }
      if ((k = /^\s*\[([^\]]*)\]/.exec(rest))) { o.unit = k[1].trim(); rest = rest.slice(k[0].length); }
      if ((k = /^\s*\(off\)/.exec(rest))) { o.off = true; rest = rest.slice(k[0].length); }
      if ((k = /^\s*\(one\s+("[^"]*"|[^)]+)\)/.exec(rest))) { o.one = unq(k[1]); rest = rest.slice(k[0].length); }
      const qm = findTop(rest, ["?"]);
      if (qm[0] >= 0) { o.ask = rest.slice(qm[0] + 1).trim(); rest = rest.slice(0, qm[0]); }
      o.rest = rest;
      return o;
    }
    const setsOf = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);

    for (let ln = 0; ln < lines.length; ln++) {
      const raw = lines[ln];
      if (!raw.trim() || /^\s*#/.test(raw)) continue;
      const indented = /^\s/.test(raw);
      const line = raw.trim();
      if (indented) {
        if (!cur) return err(ln, "An indented line has nothing above it to belong to.");
        if (cur.kind === "single") {
          const eq = findTop(line, ["="]);
          if (eq[0] < 0) return err(ln, `Expected “name = number” under ${cur.label}.`);
          const h = head(line.slice(0, eq[0]));
          // After "=": a number (or nothing), then [unit], then "? question".
          let after = line.slice(eq[0] + 1), ask;
          const qm = after.indexOf("?");
          if (qm >= 0) { ask = after.slice(qm + 1).trim(); after = after.slice(0, qm); }
          const um = /\[([^\]]*)\]/.exec(after);
          const valText = after.replace(/\[[^\]]*\]/, "");
          const v = numOrNull(valText);
          if (Number.isNaN(v)) return err(ln, `“${valText.trim()}” isn't a number.`);
          const p = { id: uid(h.name), label: h.label, value: v, unit: um ? um[1].trim() : "" };
          if (ask !== undefined) { p.blank = true; if (ask) p.prompt = ask; }
          cur.properties.push(p);
        } else if (cur.kind === "table") {
          if (/^columns\s*:/.test(line)) {
            for (const c of splitTop(line.replace(/^columns\s*:/, ""), ",")) {
              if (!c.trim()) continue;
              const link = /->\s*([\w]+)\s*$/.exec(c), isText = /\(text\)\s*$/.test(c);
              const h = head(c.replace(/->\s*[\w]+\s*$/, "").replace(/\(text\)\s*$/, ""));
              const col = { id: uid(h.name), label: h.label, unit: h.unit || "" };
              if (link) { col.kind = "link"; col.linkName = link[1]; } else if (isText) col.kind = "text";
              cur.columns.push(col);
              byName[(cur.name + "." + M.toName(h.label)).toLowerCase()] = cur.id + "." + col.id;
            }
          } else {
            const colon = findTop(line, [":"]);
            const key = unq(colon[0] >= 0 ? line.slice(0, colon[0]) : line);
            const vals = colon[0] >= 0 ? cells(line.slice(colon[0] + 1)) : [];
            const row = { key };
            for (let j = 0; j < cur.columns.length; j++) {
              const c = cur.columns[j], v = vals[j] === undefined ? "" : vals[j];
              if (c.kind === "link" || c.kind === "text") row[c.id] = v;
              else { const n = numOrNull(v); if (Number.isNaN(n)) return err(ln, `“${v}” in ${c.label} for ${key} isn't a number.`); row[c.id] = n; }
            }
            if (cur.rows.some((r) => r.key === key)) return err(ln, `“${key}” is listed twice in ${cur.label}.`);
            cur.rows.push(row);
          }
        } else if (cur.kind === "grid") {
          const colon = findTop(line, [":"]);
          if (colon[0] < 0) return err(ln, `Expected “row: numbers…” under ${cur.label}.`);
          cur._rows.push([unq(line.slice(0, colon[0])), cells(line.slice(colon[0] + 1)), ln]);
        }
        continue;
      }
      cur = null;
      const wm = /^(\w+)/.exec(line);
      if (!wm) return err(ln, "Lines start with title, thing, list, grid, decide, result, rule, minimize, maximize, make or options.");
      const word = wm[1].toLowerCase();
      const body = line.slice(word.length);
      if (word === "title") { model.title = body.replace(/^\s*:/, "").trim(); continue; }
      if (word === "options") {
        for (const part of body.replace(/^\s*:/, "").split(",")) {
          const p = part.trim().toLowerCase(), v = p.split(/\s+/).pop();
          if (p.startsWith("engine")) model.options.engine = v;
          else if (p.startsWith("time")) model.options.timeLimitSec = Number(v) || 30;
          else if (p.startsWith("gap")) model.options.mipGap = Number(v);
          else if (p.startsWith("multistart")) model.options.multistart = v === "on";
        }
        continue;
      }
      if (word === "thing" || word === "list" || word === "grid") {
        const h = head(body);
        if (!h) return err(ln, `A ${word} needs a name.`);
        const id = uid(h.name);
        byName[h.name.toLowerCase()] = id;
        if (word === "thing") cur = { id, label: h.label, kind: "single", properties: [], name: h.name };
        else if (word === "list") cur = { id, label: h.label, one: h.one || h.label.replace(/s$/, ""), kind: "table", columns: [], rows: [], name: h.name };
        else {
          const ov = /over\s+(.+)$/.exec(h.rest);
          if (!ov) return err(ln, `A grid needs “over ListA, ListB”.`);
          cur = { id, label: h.label, kind: "grid", unit: h.unit || "", overNames: setsOf(ov[1]), values: {}, _rows: [], name: h.name };
        }
        if (h.ask !== undefined) { cur.blank = true; if (h.ask) cur.prompt = h.ask; }
        model.things.push(cur);
        continue;
      }
      if (word === "decide" || word === "result" || word === "rule" || word === "minimize" || word === "maximize" || word === "make") {
        const h = head(body);
        if (!h) return err(ln, `“${word}” needs a name in quotes.`);
        let rest = h.rest;
        let forEach = [];
        const fe = /^\s*for each\s+/.exec(rest);
        if (fe) {
          const stop = findTop(rest, [" where ", ":", "="], fe[0].length);
          forEach = setsOf(rest.slice(fe[0].length, stop[0] < 0 ? undefined : stop[0]));
          rest = stop[0] < 0 ? "" : rest.slice(stop[0]);
        }
        if (word === "decide") {
          const d = { id: uid(h.name), label: h.label, unit: h.unit || "", type: "continuous", lower: 0, upper: null, indexBy: forEach, ...(h.off ? { disabled: true } : {}) };
          byName[h.name.toLowerCase()] = d.id;
          for (const part of splitTop(rest.replace(/^\s*:/, ""), ",")) {
            const p = part.trim();
            if (!p) continue;
            if (/^yes or no$/i.test(p)) d.type = "binary";
            else if (/^whole numbers?$/i.test(p)) d.type = "integer";
            else if (/^any amount$/i.test(p)) d.type = "continuous";
            else if (/^can go negative$/i.test(p)) d.lower = null;
            else if (/^at least\s+/i.test(p)) later.push([ln, p.replace(/^at least\s+/i, ""), (e) => (d.lower = e.const !== undefined ? e.const : e)]);
            else if (/^at most\s+/i.test(p)) later.push([ln, p.replace(/^at most\s+/i, ""), (e) => (d.upper = e.const !== undefined ? e.const : e)]);
            else return err(ln, `“${p}” isn't something a decision can be (try: any amount, whole number, yes or no, at least …, at most …, can go negative).`);
          }
          model.decisions.push(d);
        } else if (word === "result") {
          const eq = findTop(rest, ["="]);
          if (eq[0] < 0) return err(ln, "A result needs “= formula”.");
          const r = { id: uid(h.name), label: h.label, unit: h.unit || "", expr: null, indexBy: forEach, ...(h.off ? { disabled: true } : {}) };
          byName[h.name.toLowerCase()] = r.id;
          later.push([ln, rest.slice(eq[0] + 1), (e) => (r.expr = e)]);
          model.results.push(r);
        } else if (word === "rule") {
          let w = null;
          const wh = /^\s*where\s+/.exec(rest);
          if (wh) { const c = findTop(rest, [":"], wh[0].length); w = rest.slice(wh[0].length, c[0]); rest = rest.slice(c[0]); }
          const txt = rest.replace(/^\s*:/, "").trim();
          const r = { id: uid(h.name), label: h.label, ...(h.off ? { disabled: true } : {}) };
          let k;
          if ((k = /^choose\s+(at most|at least|exactly)\s+(.+)\s+of\s+([\w]+)\s*$/i.exec(txt))) {
            Object.assign(r, { kind: "pick", op: { "at most": "<=", "at least": ">=", exactly: "=" }[k[1].toLowerCase()], decisionName: k[3] });
            later.push([ln, k[2], (e) => (r.count = e)]);
          } else if ((k = /^each\s+([\w]+)\s+gets a different\s+([\w]+)(?:\s+using\s+([\w]+))?(,\s*every one taken)?\s*$/i.exec(txt))) {
            Object.assign(r, { kind: "different", aName: k[1], bName: k[2], decisionName: k[3], fillAll: !!k[4] });
          } else {
            const bt = findTop(txt, [" between "]);
            Object.assign(r, { kind: "compare", forEach });
            if (bt[0] >= 0) {
              const ands = splitTop(txt.slice(bt[0] + 9), " and ");
              if (ands.length < 2) return err(ln, "“between” needs “… and …”.");
              r.op = "between";
              later.push([ln, txt.slice(0, bt[0]), (e) => (r.lhs = e)], [ln, ands[0], (e) => (r.rhs = e)], [ln, ands.slice(1).join(" and "), (e) => (r.rhs2 = e)]);
            } else {
              const op = findTop(txt, [">=", "<=", "="]);
              if (op[0] < 0) return err(ln, "A rule needs a comparison: >=, <= or =, or “between … and …”.");
              r.op = op[1];
              later.push([ln, txt.slice(0, op[0]), (e) => (r.lhs = e)], [ln, txt.slice(op[0] + op[1].length), (e) => (r.rhs = e)]);
            }
            if (w) later.push([ln, w, (e) => (r.where = e)]);
          }
          model.rules.push(r);
        } else {
          const txt = rest.replace(/^\s*:/, "").trim();
          model.goal = { label: h.label, sense: word === "maximize" ? "max" : word === "minimize" ? "min" : "target", expr: null };
          if (word === "make") {
            const t = findTop(txt, [" as close as possible to ", " equal to "]);
            if (t[0] < 0) return err(ln, "“make” needs “… equal to N” or “… as close as possible to N”.");
            model.goal.close = t[1].includes("close");
            model.goal.targetValue = Number(txt.slice(t[0] + t[1].length));
            later.push([ln, txt.slice(0, t[0]), (e) => (model.goal.expr = e)]);
          } else later.push([ln, txt, (e) => (model.goal.expr = e)]);
        }
        continue;
      }
      return err(ln, `“${word}” isn't a statement here. Lines start with title, thing, list, grid, decide, result, rule, minimize, maximize, make or options.`);
    }

    // Names are all known now: wire up lists, links and grids, then read every formula.
    const setId = (name, ln, what) => { const id = byName[String(name).toLowerCase()]; if (!id || !model.things.some((t) => t.id === id && t.kind === "table")) throw err(ln, `${what}: “${name}” isn't a list.`); return id; };
    try {
      for (const t of model.things) {
        if (t.kind === "table") for (const c of t.columns) if (c.linkName) { c.links = setId(c.linkName, 0, `${t.label}' ${c.label}`); delete c.linkName; }
        if (t.kind === "grid") {
          t.over = t.overNames.map((n) => setId(n, 0, t.label));
          const kb = model.things.find((x) => x.id === t.over[1]).rows.map((r) => String(r.key));
          for (const [a, vals, ln] of t._rows) {
            t.values[a] = {};
            kb.forEach((b, j) => { const v = numOrNull(vals[j] === undefined ? "" : vals[j]); if (Number.isNaN(v)) throw err(ln, `“${vals[j]}” in ${t.label} isn't a number.`); t.values[a][b] = v; });
          }
          delete t.overNames; delete t._rows;
        }
        delete t.name;
      }
      for (const d of model.decisions) d.indexBy = d.indexBy.map((n) => setId(n, 0, d.label));
      for (const r of model.results) r.indexBy = r.indexBy.map((n) => setId(n, 0, r.label));
      for (const r of model.rules) {
        if (r.forEach) r.forEach = r.forEach.map((n) => setId(n, 0, r.label));
        if (r.kind === "pick") {
          const id = byName[r.decisionName.toLowerCase()];
          if (!id || !model.decisions.some((d) => d.id === id)) throw err(0, `${r.label}: “${r.decisionName}” isn't a decision.`);
          r.decision = id; delete r.decisionName;
        }
        if (r.kind === "different") {
          const A = setId(r.aName, 0, r.label), B = setId(r.bName, 0, r.label);
          let d = r.decisionName && model.decisions.find((x) => x.id === byName[r.decisionName.toLowerCase()]);
          if (!d) { d = { id: uid("assigned"), label: "Assigned", unit: "", type: "binary", indexBy: [A, B] }; model.decisions.push(d); }
          r.decision = d.id;
          delete r.aName; delete r.bName; delete r.decisionName;
        }
      }
    } catch (e) { if (e.error) return e; throw e; }
    const N = M.names(model);
    for (const [ln, src, put] of later) {
      const p = M.parseNamed(model, src.trim(), N);
      if (p.error) return err(ln, p.error);
      put(p.tree);
    }
    if (!model.goal.expr) model.goal.expr = { hole: true };
    return { model };
  }

  const api = { write, read };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PSText = api;
})(typeof self !== "undefined" ? self : this);
