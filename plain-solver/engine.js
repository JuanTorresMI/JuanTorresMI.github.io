/* The page's side of the solver: one Web Worker (engine-worker.js), one solve at a time.
 * Lanes: "main" (the Solve button), "whatif" (the slider) and "curve" (the what-if chart's points).
 * Only the newest waiting request in each lane matters; an older one still waiting resolves with
 * null and never runs. Lanes go in that order. A worker that dies or goes quiet is replaced and
 * the solve fails with a message instead of hanging.
 *
 *   PSEngine.solve(model, lane, onProgress) -> Promise<answer | null>
 *   PSEngine.stop()    asks the evolutionary engine to stop and return its best so far
 */
(function (root) {
  "use strict";
  const base = document.currentScript.src;
  let worker = null, nextId = 1, busy = null;
  const LANES = ["main", "whatif", "curve"];
  const waiting = {};

  function start() {
    // The page's ?v= goes to the worker too, so a deploy never pairs a new page with an old engine.
    worker = new Worker(new URL("engine-worker.js" + new URL(base).search, base));
    worker.onmessage = (e) => {
      const d = e.data;
      if (!busy || d.id !== busy.id) return;
      if (d.progress) { if (busy.onProgress) busy.onProgress(d.progress); return; }
      const job = busy;
      clearTimeout(job.timer);
      busy = null;
      job.resolve(d.answer);
      next();
    };
    worker.onerror = (e) => { e.preventDefault(); restart("The solver failed to start. Reload the page to try again."); };
  }
  function restart(message) {
    if (worker) worker.terminate();
    worker = null;
    if (busy) { clearTimeout(busy.timer); const job = busy; busy = null; job.reject(new Error(message)); }
    next();
  }
  function next() {
    if (busy) return;
    const lane = LANES.find((l) => waiting[l]);
    if (!lane) return;
    const job = waiting[lane];
    waiting[lane] = null;
    if (!worker) start();
    job.id = nextId++;
    const limit = (Number((job.model.options || {}).timeLimitSec) || 30) * 1000;
    // Several solves can run for one answer (sensitivity, diagnosis), each up to the time limit.
    job.timer = setTimeout(() => restart("The solver stopped responding and was restarted. Try again, or lower the time limit in Advanced."), limit * 4 + 20000);
    busy = job;
    worker.postMessage({ id: job.id, kind: "solve", model: job.model });
  }

  root.PSEngine = {
    solve(model, lane, onProgress) {
      lane = lane || "main";
      return new Promise((resolve, reject) => {
        if (waiting[lane]) waiting[lane].resolve(null);
        waiting[lane] = { model: JSON.parse(JSON.stringify(model)), onProgress, resolve, reject };
        next();
      });
    },
    stop() { if (worker) worker.postMessage({ kind: "stop" }); },
    busy: () => !!busy,
    warm() { if (!worker) start(); worker.postMessage({ kind: "warm" }); },
  };
})(window);
