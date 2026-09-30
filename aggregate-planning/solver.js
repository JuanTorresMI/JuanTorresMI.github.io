/* The page's side of the solver: one Web Worker (solver-worker.js), requests answered in order.
 * solve() resolves with the worker's results; only the newest request matters to the page,
 * so the caller drops answers that arrive after a newer request went out. If the worker dies
 * or goes quiet, it is replaced and the request fails with a message instead of hanging.
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
    for (const [, p] of pending) { clearTimeout(p.timer); p.reject(new Error(message)); }
    pending.clear();
  }

  function solve(inputs, runs, debug) {
    if (!worker) start();
    const id = nextId++;
    return new Promise((resolve, reject) => {
      // The solver's own time limit is 20 s per run; this catches a worker that never answers.
      const timer = setTimeout(() => restart("The solver stopped responding and was restarted. Try again."), 25000 * runs.length);
      pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, inputs, runs, debug: !!debug });
    });
  }

  root.APSolver = { solve, warm: () => { if (!worker) start(); } };
})(window);
