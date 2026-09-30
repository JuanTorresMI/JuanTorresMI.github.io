/* The page's side of the solver: one Web Worker (solver-worker.js), one request at a time.
 * Two kinds of request: "solve" (the three plans) and "explain" (study mode's walk-through).
 * Only the newest request of each kind matters to the page, so one still waiting its turn when
 * a newer one of the same kind arrives is dropped: its promise resolves with null and it never
 * reaches the worker. Solves go before explanations. If the worker dies or goes quiet, it is
 * replaced and the request fails with a message instead of hanging.
 */
(function (root) {
  "use strict";
  const base = document.currentScript.src;
  let worker = null, nextId = 1;
  const pending = new Map();
  const waiting = { solve: null, explain: null }; // the next request of each kind, held until the worker is free

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

  function next() {
    if (pending.size) return;
    const kind = waiting.solve ? "solve" : waiting.explain ? "explain" : null;
    if (!kind) return;
    const req = waiting[kind]; waiting[kind] = null;
    send(req);
  }
  function send(req) {
    if (!worker) start();
    const id = nextId++;
    // The solver's own time limit is 20 s per run; this catches a worker that never answers.
    const timer = setTimeout(() => restart("The solver stopped responding and was restarted. Try again."), 25000 * req.runs);
    const done = (fn) => (v) => { fn(v); next(); };
    pending.set(id, { resolve: done(req.resolve), reject: done(req.reject), timer });
    worker.postMessage({ id, ...req.message });
  }
  function queue(kind, message, runs) {
    return new Promise((resolve, reject) => {
      if (waiting[kind]) waiting[kind].resolve(null);
      waiting[kind] = { message: { kind, ...message }, runs, resolve, reject };
      next();
    });
  }

  root.APSolver = {
    solve: (inputs, runs, debug) => queue("solve", { inputs, runs, debug: !!debug }, runs.length),
    // Several solves in one: the real one with its log, the relaxation, a branch, the shadow prices.
    explain: (inputs, policy, wholeTeams) => queue("explain", { inputs, policy, wholeTeams }, 4),
    warm: () => { if (!worker) start(); },
  };
})(window);
