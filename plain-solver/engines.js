/* The two engines for problems HiGHS can't take, both on the numeric form from PSModel.numeric():
 * minimize f(x) subject to h(x) = 0, g(x) ≤ 0 and lo ≤ x ≤ hi.
 *
 *   PSEngines.nlp(P, opt)          smooth problems (Excel's GRG Nonlinear does this job): an augmented
 *                                  Lagrangian around a spectral projected-gradient search, with exact
 *                                  gradients from the expression trees, run from several starting
 *                                  points when opt.multistart is on. Finds a local best; says so.
 *   PSEngines.de(P, opt, hooks)    anything else (Excel's Evolutionary): differential evolution with
 *                                  feasibility-first comparison, whole numbers rounded, then a pattern
 *                                  search to polish. Async: it yields between generations so a Stop
 *                                  message gets through, and reports progress.
 * No DOM; runs in Node too.
 */
(function (root) {
  "use strict";
  const M = typeof module !== "undefined" && module.exports ? require("./model.js") : root.PSModel;

  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }
  const clip = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

  function violation(P, x) {
    let v = 0;
    for (const h of P.eq) v = Math.max(v, Math.abs(M.evaluate(h, x)));
    for (const g of P.ineq) v = Math.max(v, M.evaluate(g, x));
    return v;
  }

  /* ---------- smooth: augmented Lagrangian + spectral projected gradient ---------- */
  function spg(fg, x, lo, hi, maxIter, tol) {
    const n = x.length;
    let g = new Array(n).fill(0);
    let f = fg(x, g);
    const hist = [f];
    const proj = (y) => y.map((v, i) => clip(v, lo[i], hi[i]));
    let pg = 0;
    for (let i = 0; i < n; i++) pg = Math.max(pg, Math.abs(clip(x[i] - g[i], lo[i], hi[i]) - x[i]));
    let alpha = pg > 0 ? 1 / pg : 1;
    for (let it = 0; it < maxIter; it++) {
      const d = proj(x.map((v, i) => v - alpha * g[i])).map((v, i) => v - x[i]);
      let dn = 0, gd = 0;
      for (let i = 0; i < n; i++) { dn = Math.max(dn, Math.abs(d[i])); gd += g[i] * d[i]; }
      if (dn <= tol * (1 + Math.max(...x.map(Math.abs))) || gd > -1e-20) break;
      const fmax = Math.max(...hist.slice(-10));
      let lam = 1, xn, gn = new Array(n).fill(0), fn;
      for (let k = 0; k < 40; k++) {
        xn = x.map((v, i) => v + lam * d[i]);
        gn.fill(0);
        fn = fg(xn, gn);
        if (Number.isFinite(fn) && fn <= fmax + 1e-4 * lam * gd) break;
        lam *= 0.5;
      }
      if (!Number.isFinite(fn)) break;
      let sy = 0, ss = 0;
      for (let i = 0; i < n; i++) { const s = xn[i] - x[i], y = gn[i] - g[i]; sy += s * y; ss += s * s; }
      alpha = sy > 0 ? clip(ss / sy, 1e-30, 1e30) : 1e4 * alpha;
      x = xn; g = gn; f = fn;
      hist.push(f);
    }
    return { x, f };
  }

  function nlpFrom(P, x0, opt) {
    const n = P.n, lo = P.lo, hi = P.hi;
    let x = x0.map((v, i) => clip(v, lo[i], hi[i]));
    const lam = new Array(P.eq.length).fill(0), mu = new Array(P.ineq.length).fill(0);
    let rho = 10, prevV = Infinity;
    const tolV = opt.tolV || 1e-7;
    for (let outer = 0; outer < 40; outer++) {
      const fg = (y, g) => {
        let L = M.gradient(P.f, y, g, 1);
        P.eq.forEach((h, j) => {
          const hv = M.evaluate(h, y);
          const w = lam[j] + rho * hv;
          L += lam[j] * hv + 0.5 * rho * hv * hv;
          if (w) M.gradient(h, y, g, w);
        });
        P.ineq.forEach((gg, j) => {
          const gv = M.evaluate(gg, y);
          const w = Math.max(0, mu[j] + rho * gv);
          L += (w * w - mu[j] * mu[j]) / (2 * rho);
          if (w) M.gradient(gg, y, g, w);
        });
        return L;
      };
      x = spg(fg, x, lo, hi, opt.maxIter || 3000, 1e-11).x;
      // Done when the rules hold and their multipliers have settled. For an "at most" rule that is
      // |max(g, −μ/ρ)|: a point strictly inside a rule whose multiplier is still above zero isn't
      // converged yet (stopping there left max x·y with x + y ≤ 10 at 24.86 instead of 25).
      let v = 0;
      P.eq.forEach((h, j) => { const hv = M.evaluate(h, x); lam[j] += rho * hv; v = Math.max(v, Math.abs(hv)); });
      P.ineq.forEach((g, j) => { const gv = M.evaluate(g, x); v = Math.max(v, Math.abs(Math.max(gv, -mu[j] / rho))); mu[j] = Math.max(0, mu[j] + rho * gv); });
      if (v <= tolV && outer > 0) break;
      if (v > 0.25 * prevV) rho = Math.min(rho * 10, 1e10);
      prevV = v;
    }
    return { x, f: M.evaluate(P.f, x), viol: violation(P, x) };
  }

  function startBox(lo, hi) {
    // Where random starting points come from when a decision has no limit on one side or both.
    const a = Number.isFinite(lo) ? lo : Number.isFinite(hi) ? hi - 100 : -100;
    const b = Number.isFinite(hi) ? hi : Number.isFinite(lo) ? lo + 100 : 100;
    return [a, b];
  }

  function nlp(P, opt) {
    opt = opt || {};
    const rand = rng(opt.seed || 12345);
    const starts = opt.multistart ? Math.max(1, opt.starts || (P.n <= 20 ? 12 : 4)) : 1;
    const t0 = Date.now(), limit = (opt.timeLimitSec || 30) * 1000;
    let best = null, tried = 0;
    for (let s = 0; s < starts; s++) {
      const x0 = P.lo.map((l, i) => {
        const [a, b] = startBox(l, P.hi[i]);
        if (s === 0) return clip(0, a, b) === 0 ? 0 : (a + b) / 2;
        return a + rand() * (b - a);
      });
      const r = nlpFrom(P, x0, opt);
      if (s === 0) r.stuck = r.x.every((v, i) => Math.abs(v - x0[i]) <= 1e-9 * (1 + Math.abs(x0[i])));
      tried++;
      const tol = 1e-6 * (1 + Math.abs(r.f));
      const ok = r.viol <= 1e-6;
      if (!best || (ok && !best.ok) || (ok === best.ok && (ok ? r.f < best.f - tol : r.viol < best.viol))) best = { ...r, ok };
      if (Date.now() - t0 > limit) break;
    }
    return { x: best.x, f: best.f, viol: best.viol, feasible: best.ok, starts: tried, stuck: tried === 1 && !!best.stuck };
  }

  /* ---------- anything: differential evolution ---------- */
  async function de(P, opt, hooks) {
    opt = opt || {};
    hooks = hooks || {};
    const rand = rng(opt.seed || 98765);
    const n = P.n;
    const box = P.lo.map((l, i) => startBox(l, P.hi[i]));
    const tolV = 1e-6;
    const round = (x) => x.map((v, i) => (P.int[i] ? clip(Math.round(v), Math.ceil(P.lo[i] - 1e-9), Math.floor(P.hi[i] + 1e-9)) : v));
    const score = (x) => { const v = violation(P, x); return { x, f: M.evaluate(P.f, x), v: v <= tolV ? 0 : v }; };
    const better = (a, b) => (a.v === 0 && b.v === 0 ? a.f <= b.f : a.v < b.v || (a.v === b.v && a.f <= b.f));
    const NP = Math.max(20, Math.min(150, 10 * n));
    const G = opt.generations || 2000;
    const t0 = Date.now(), limit = (opt.timeLimitSec || 30) * 1000;
    let pop = [];
    for (let k = 0; k < NP; k++) pop.push(score(round(box.map(([a, b]) => a + rand() * (b - a)))));
    if (opt.x0) pop[0] = score(round(opt.x0.map((v, i) => clip(v, P.lo[i], P.hi[i]))));
    let best = pop.reduce((a, b) => (better(a, b) ? a : b));
    let lastBest = best.f, quiet = 0, gen = 0, stopped = false;
    for (gen = 1; gen <= G; gen++) {
      for (let i = 0; i < NP; i++) {
        let r1, r2, r3;
        do r1 = Math.floor(rand() * NP); while (r1 === i);
        do r2 = Math.floor(rand() * NP); while (r2 === i || r2 === r1);
        do r3 = Math.floor(rand() * NP); while (r3 === i || r3 === r1 || r3 === r2);
        const F = 0.5 + 0.4 * rand(), CR = 0.9, jr = Math.floor(rand() * n);
        const a = pop[r1].x, b = pop[r2].x, c = pop[r3].x, xi = pop[i].x;
        const trial = xi.map((v, j) => {
          if (j !== jr && rand() > CR) return v;
          let y = a[j] + F * (b[j] - c[j]);
          if (y < P.lo[j]) y = (P.lo[j] + v) / 2;
          if (y > P.hi[j]) y = (P.hi[j] + v) / 2;
          return y;
        });
        const s = score(round(trial));
        if (better(s, pop[i])) { pop[i] = s; if (better(s, best)) best = s; }
      }
      if (Math.abs(best.f - lastBest) > 1e-12 * (1 + Math.abs(best.f))) { lastBest = best.f; quiet = 0; } else quiet++;
      if (gen % 10 === 0) {
        if (hooks.progress) hooks.progress({ gen, of: G, best: best.f, feasible: best.v === 0 });
        await new Promise((r) => setTimeout(r, 0));
        if (hooks.stopped && hooks.stopped()) { stopped = true; break; }
        if (Date.now() - t0 > limit) break;
      }
      if (quiet > 200) break;
    }
    // Polish: a pattern search around the best point (whole-number decisions move by 1).
    let x = best.x.slice(), cur = best;
    let step = x.map((v, i) => (P.int[i] ? 1 : Math.max(1e-3, 0.05 * (box[i][1] - box[i][0]))));
    for (let it = 0; it < 4000 && !stopped; it++) {
      let moved = false;
      for (let i = 0; i < n; i++) for (const s of [1, -1]) {
        const y = x.slice();
        y[i] = clip(y[i] + s * step[i], P.lo[i], P.hi[i]);
        const t = score(round(y));
        if (better(t, cur) && (t.f < cur.f - 1e-15 || t.v < cur.v)) { cur = t; x = t.x; moved = true; }
      }
      if (!moved) {
        let any = false;
        step = step.map((v, i) => { if (P.int[i]) return v; const w = v / 2; if (w > 1e-10 * (1 + Math.abs(x[i]))) any = true; return w; });
        if (!any) break;
      }
    }
    return { x: cur.x, f: cur.f, viol: violation(P, cur.x), feasible: cur.v === 0, generations: Math.min(gen, G), stopped };
  }

  // Evolution lands near round numbers, not on them (479.999996 for 480): snap each value to a whole
  // number, or else to 7 significant digits, wherever the snapped point is no worse and still fits.
  function tidy(P, x) {
    const snap = x.map((v) => { const r = Math.round(v); if (Math.abs(v - r) <= 1e-5 * Math.max(1, Math.abs(v))) return r; return Number(v.toPrecision(7)); });
    const f0 = M.evaluate(P.f, x), f1 = M.evaluate(P.f, snap);
    return violation(P, snap) <= Math.max(1e-6, violation(P, x)) && f1 <= f0 + 1e-9 * (1 + Math.abs(f0)) ? snap : x;
  }

  const api = { nlp, de, violation, tidy };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PSEngines = api;
})(typeof self !== "undefined" ? self : this);
