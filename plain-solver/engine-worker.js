/* Runs every solve off the main thread, so a long one never freezes the page.
 * HiGHS is the Aggregate Planner's copy (../aggregate-planning/lib), so the site serves one build.
 * Messages in:  { id, kind: "solve", model }  ·  { kind: "stop" } (the evolutionary engine stops early)
 * Messages out: { id, progress }  while evolving  ·  { id, answer }  when done (see solve.js)
 * If HiGHS throws, the instance is dropped and loaded fresh before the next solve.
 */
const v = self.location.search;
importScripts("../aggregate-planning/lib/highs.js", "model.js" + v, "engines.js" + v, "solve.js" + v);
const loadHighs = self.Module;
let highs = null, sink = null, stop = false, current = 0;

const env = {
  highs: async () => highs || (highs = await loadHighs({
    locateFile: (f) => new URL("../aggregate-planning/lib/" + f, self.location.href).href,
    print: (l) => { if (sink) sink.push(l); },
    printErr: (l) => { if (sink) sink.push(l); },
  })),
  reset: () => { highs = null; },
  capture: (fn) => { sink = []; try { return [fn(), sink]; } finally { sink = null; } },
  progress: (p) => self.postMessage({ id: current, progress: p }),
  stopped: () => stop,
};

self.onmessage = async (e) => {
  const { id, kind } = e.data;
  if (kind === "stop") { stop = true; return; }
  if (kind === "warm") { try { await env.highs(); } catch (err) { /* reported on the first solve */ } return; }
  current = id;
  stop = false;
  let answer;
  try { answer = await self.PSSolve.run(e.data.model, env); }
  catch (err) { highs = null; sink = null; answer = { ok: false, status: "error", message: "The solver hit an internal error on this model. Change something and it will try again with a fresh solver.", detail: String(err && err.message || err) }; }
  self.postMessage({ id, answer });
};
