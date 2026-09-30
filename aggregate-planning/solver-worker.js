/* Runs HiGHS off the main thread, so a slow integer solve never freezes the inputs.
 * Messages in:  { id, inputs, runs: [{ policy, wholeTeams }], debug }
 * Messages out: { id, results: [{ policy, ok, plan } | { policy, ok: false, message }] }
 * If HiGHS throws, the instance is thrown away and loaded again before the next solve:
 * some builds are left in a bad state after an error.
 */
importScripts("lib/highs.js", "model.js");
const loadHighs = self.Module;
let highs = null;

async function solver() {
  if (!highs) highs = await loadHighs({ locateFile: (f) => new URL("lib/" + f, self.location.href).href });
  return highs;
}

const OPTIONS = { mip_rel_gap: 0, output_flag: false, time_limit: 20 };

function friendly(status, policy) {
  if (/infeasible/i.test(status)) {
    const why = policy === "level" ? "a fixed workforce can't meet demand and the ending conditions"
      : policy === "band" ? "the workforce band is too tight for the demand and the ending conditions"
      : "the ending conditions can't be met";
    return `No feasible plan: ${why}. Try allowing backlog, lowering the minimum ending inventory, or widening the limits.`;
  }
  if (/time limit/i.test(status)) return "The solver ran out of time before it could prove the best plan. Try continuous teams, or a shorter horizon.";
  if (/unbounded/i.test(status)) return "The model is unbounded, which means a cost is negative somewhere. Check the cost inputs.";
  return `The solver stopped without a plan (${status}).`;
}

self.onmessage = async (e) => {
  const { id, inputs, runs, debug } = e.data;
  const M = self.APModel;
  const results = [];
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
  self.postMessage({ id, results });
};
