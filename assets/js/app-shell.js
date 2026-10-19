/* The project pages' app shell (_layouts/tool.html). Turns the page's marked parts into an app:
 *   [data-view="id"][data-title]   sections; "views" mode shows one at a time, "read" mode shows all
 *                                  and makes the rail a contents list that follows the reader.
 *                                  data-order sorts the rail (page order otherwise); data-n numbers a
 *                                  step, and numbered steps get Back / Next buttons at their end.
 *   [data-app-side]                moved into the right-hand column
 *   [data-app-tools]               its children moved into the top bar
 * The rail is built from the views in page order. A link to "#something" inside a hidden view opens
 * that view. The view is remembered per page (in the browser), never in the address, since some
 * tools keep their own state after the "#". Pages hear about changes through the "app:view" event.
 *   window.AppShell.show(id), .current()
 * Without JavaScript nothing is hidden.
 */
(function () {
  "use strict";
  const shell = document.getElementById("app-shell");
  if (!shell) return;
  const mode = shell.dataset.mode === "read" ? "read" : "views";
  const KEY = "app-view:" + location.pathname;
  const store = { get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }, set(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* private mode */ } } };
  const parts = [...document.querySelectorAll("[data-view]")];
  const views = [];
  const meta = {};
  for (const el of parts) {
    const v = el.dataset.view;
    if (!meta[v]) { meta[v] = { title: el.dataset.title || v, n: el.dataset.n || "", group: el.dataset.railGroup || "", order: el.dataset.order ? Number(el.dataset.order) : Infinity, first: el, last: el }; views.push(v); }
    else { if (el.dataset.title) meta[v].title = el.dataset.title; if (el.dataset.n) meta[v].n = el.dataset.n; if (el.dataset.railGroup) meta[v].group = el.dataset.railGroup; if (el.dataset.order) meta[v].order = Number(el.dataset.order); meta[v].last = el; }
  }
  if (!views.length) return;
  views.sort((a, b) => (meta[a].order === meta[b].order ? 0 : meta[a].order - meta[b].order));
  shell.classList.add("is-live");

  // The side panel and the top bar's tools.
  const side = document.querySelector("[data-app-side]");
  if (side) { const box = document.getElementById("app-side"); box.append(side); box.hidden = false; shell.classList.add("has-side"); }
  const tools = document.querySelector("[data-app-tools]");
  if (tools) document.getElementById("app-tools").append(...tools.childNodes);

  // The rail.
  const rail = document.getElementById("app-rail");
  const list = document.createElement("ol");
  list.className = "app-rail-list";
  const buttons = {};
  for (const v of views) {
    if (meta[v].group) { const g = document.createElement("li"); g.className = "app-rail-group"; g.textContent = meta[v].group; list.append(g); }
    const li = document.createElement("li");
    const b = document.createElement(mode === "read" ? "a" : "button");
    b.className = "app-rail-btn";
    if (mode === "read") { if (!meta[v].first.id) meta[v].first.id = "s-" + v; b.href = "#" + meta[v].first.id; }
    else { b.type = "button"; b.addEventListener("click", () => show(v)); }
    b.innerHTML = (meta[v].n ? `<span class="app-rail-n">${meta[v].n}</span>` : "") + `<span class="app-rail-t"></span>`;
    b.querySelector(".app-rail-t").textContent = meta[v].title;
    buttons[v] = b;
    li.append(b);
    list.append(li);
  }
  rail.append(list);

  // Numbered steps end with Back / Next (to the neighbouring steps, and from the last back to the start).
  if (mode === "views") {
    const steps = views.filter((v) => meta[v].n);
    steps.forEach((v, i) => {
      const row = document.createElement("div");
      row.className = "app-nextrow";
      const btn = (to, text, primary) => { const b = document.createElement("button"); b.type = "button"; b.className = "app-btn" + (primary ? " primary" : ""); b.dataset.show = to; b.textContent = text; return b; };
      row.append(i > 0 ? btn(steps[i - 1], "← " + meta[steps[i - 1]].title) : document.createElement("span"));
      const to = steps[i + 1] || shell.dataset.start || views[0];
      row.append(btn(to, (steps[i + 1] ? meta[to].title : shell.dataset.doneLabel || meta[to].title) + " →", true));
      row.dataset.view = v;
      meta[v].last.after(row);
      parts.push(row);
    });
  }

  let current = null;
  function mark(v) {
    for (const [k, b] of Object.entries(buttons)) { if (k === v) b.setAttribute("aria-current", mode === "read" ? "location" : "step"); else b.removeAttribute("aria-current"); }
    // On a phone the rail is a strip that scrolls sideways: keep the current entry in view.
    if (matchMedia("(max-width: 860px)").matches && buttons[v]) buttons[v].scrollIntoView({ inline: "center", block: "nearest" });
  }
  function show(v, opts) {
    if (!meta[v]) v = views[0];
    current = v;
    if (mode === "views") {
      for (const el of parts) el.classList.toggle("app-off", el.dataset.view !== v);
      store.set(v);
      if (!(opts && opts.stay)) window.scrollTo({ top: 0 });
    }
    mark(v);
    document.dispatchEvent(new CustomEvent("app:view", { detail: { view: v } }));
  }
  // Links into a section open it (views) or scroll to it (read).
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || mode !== "views") return;
    const id = decodeURIComponent(a.getAttribute("href").slice(1));
    const target = id && document.getElementById(id);
    const holder = target && target.closest("[data-view]");
    if (!holder) return;
    e.preventDefault();
    show(holder.dataset.view, { stay: true });
    target.scrollIntoView({ block: "start" });
  });
  // Buttons anywhere can open a view: data-show="view".
  document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest("[data-show]"); if (b) { e.preventDefault(); show(b.dataset.show); } });

  if (mode === "read") {
    // The rail follows the section on screen.
    const seen = new Map();
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) seen.set(en.target, en.isIntersecting ? en.boundingClientRect.top : null);
      let best = null, bestTop = Infinity;
      for (const v of views) { const t = seen.get(meta[v].first); if (t !== null && t !== undefined && Math.abs(t) < bestTop) { bestTop = Math.abs(t); best = v; } }
      if (best && best !== current) { current = best; mark(best); }
    }, { rootMargin: "-20% 0px -60% 0px" });
    for (const v of views) io.observe(meta[v].first);
    mark(views[0]);
  } else {
    // First view: a link to something inside a section, then where this reader was, then the page's pick.
    const hashEl = location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    const fromHash = hashEl && hashEl.closest("[data-view]");
    const start = fromHash ? fromHash.dataset.view : store.get() || shell.dataset.start || views[0];
    show(meta[start] ? start : views[0], { stay: true });
    if (fromHash) hashEl.scrollIntoView({ block: "start" });
  }
  window.AppShell = { show, current: () => current };
})();
