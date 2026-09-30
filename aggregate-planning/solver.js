/* The page's side of the solver: one Web Worker (solver-worker.js), one request at a time.
 * Only the newest request matters to the page, so a request that is still waiting its turn when
 * a newer one arrives is dropped: its promise resolves with null and it never reaches the worker.
 * If the worker dies or goes quiet, it is replaced and the request fails with a message instead
 * of hanging.
 */
(function (root) {
  "use strict";
  const base = document.currentScript.src;
  let worker = null, nextId = 1;
  const pending = new Map();

  function start() {
    worker = new Worker(new URL("solver-worker.js", base));
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      clearTimeout(p.timer); pending.delete(e.data.id); p.resolve(e.data.results);
    };
    worker.onerror = (e) => { e.preventDefault(); restart("The solver failed to start. Reload the page to try again."); };
  }
  function restart(message) {
    if (worker) worker.terminate();
    worker = null;
    const failed = [...pending.values()];
    pending.clear();
    for (const p of failed) { clearTimeout(p.timer); p.reject(new Error(message)); }
  }

  let waiting = null; // the next request, held until the worker is free

  function send(req) {
    if (!worker) start();
    const id = nextId++;
    // The solver's own time limit is 20 s per run; this catches a worker that never answers.
    const timer = setTimeout(() => restart("The solver stopped responding and was restarted. Try again."), 25000 * req.runs.length);
    const done = (fn) => (v) => { fn(v); if (waiting && !pending.size) { const next = waiting; waiting = null; send(next); } };
    pending.set(id, { resolve: done(req.resolve), reject: done(req.reject), timer });
    worker.postMessage({ id, inputs: req.inputs, runs: req.runs, debug: req.debug });
  }

  function solve(inputs, runs, debug) {
    return new Promise((resolve, reject) => {
      const req = { inputs, runs, debug: !!debug, resolve, reject };
      if (!pending.size) return send(req);
      if (waiting) waiting.resolve(null);
      waiting = req;
    });
  }

  root.APSolver = { solve, warm: () => { if (!worker) start(); } };
})(window);
