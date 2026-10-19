/* Plain Solver's Excel export, checked in Excel itself. Writes a Solver-ready workbook for every
 * template and a lanes network, twice (with Plain Solver's answer filled in, and from zeros), with
 * Plain Solver's goal for each; then plain-solver-excel-check.ps1 opens each in Excel, runs the Solver
 * model stored in it, and compares. Needs Windows with Excel and its Solver add-in.
 *
 *   node scripts/plain-solver-excel-check.js <dir>
 *   powershell -File scripts/plain-solver-excel-check.ps1 -Dir <dir>
 */
const path = require("path"), fs = require("fs");
const repo = path.resolve(__dirname, "..");
const out = path.resolve(process.argv[2] || "excel-check");
fs.mkdirSync(out, { recursive: true });
global.window = global;
require(path.join(repo, "aggregate-planning/xlsx.js"));
const M = require(path.join(repo, "plain-solver/model.js")), S = require(path.join(repo, "plain-solver/solve.js"));
const T = require(path.join(repo, "plain-solver/templates.js")), X = require(path.join(repo, "plain-solver/excel.js"));
const lib = path.join(repo, "aggregate-planning/lib"), load = require(path.join(lib, "highs.js"));
let h = null;
const env = { highs: async () => h || (h = await load({ locateFile: (f) => path.join(lib, f) })), reset: () => { h = null; } };
const net = require(path.join(repo, "plain-solver/text.js")).read(`title: Lanes
list Plants (one Plant)
  columns: Capacity, Cost
  East: 500, 4
  West: 400, 3
list Markets (one Market)
  columns: Demand
  A: 300
  B: 250
  C: 200
list Lanes (one Lane)
  columns: From -> Plants, To -> Markets, Freight
  L1: East, A, 2
  L2: East, B, 4
  L3: West, B, 1
  L4: West, C, 2
  L5: East, C, 5
decide Ship for each Lanes: any amount
rule "Capacity" for each Plants: sum(Lanes where Lanes.From = this.Plants, Ship) <= Plants.Capacity
rule "Demand" for each Markets: sum(Lanes where Lanes.To = this.Markets, Ship) >= Markets.Demand
minimize "Cost": sum(Lanes, (Lanes.Freight + Plants.Cost[Plants via Lanes.From]) * Ship)
`).model;
(async () => {
  const models = T.list.map((t) => [t.id, t.model]).concat([["lanes", net]]);
  const summary = [];
  for (const [id, m] of models) {
    const ans = await S.run(JSON.parse(JSON.stringify(m)), env);
    // Write it twice: with Plain Solver's answer filled in, and from zeros (so Excel has to find it).
    for (const [tag, a] of [["answer", ans], ["zeros", null]]) {
      const x = X.build(m, a);
      if (x.error) { summary.push({ id, tag, error: x.error }); continue; }
      const blob = APXlsx.blob(x.sheets);
      fs.writeFileSync(path.join(out, `${id}-${tag}.xlsx`), Buffer.from(await blob.arrayBuffer()));
      summary.push({ id, tag, want: ans.goal, engine: x.engine, cells: x.cells, constraints: x.constraints, notes: x.notes });
    }
  }
  fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary, null, 1));
  for (const s of summary) console.log(s.id, s.tag, s.error || `${s.engine} cells=${s.cells} cons=${s.constraints} want=${s.want}`);
})();
