/* Yokonjuan's page, live: the catalog (so the avatar and "latest" follow the newest release
   without anyone editing the site), the visitor counter and the guestbook, all from the Worker
   (worker/src/music.js). Anything that fails leaves the page as the site built it. Everything
   from outside is written with textContent, never as HTML. */
(() => {
  const main = document.querySelector("main[data-worker]");
  const base = main && main.dataset.worker ? main.dataset.worker.replace(/\/+$/, "") + "/music" : null;
  if (!base) return;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  // Release dates are calendar dates (Spotify gives midnight UTC), so they are shown in UTC, or
  // a US visitor would see every release a day early.
  const day = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).toLowerCase();
  const get = (path, init) => fetch(base + path, init).then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(d.error || "failed"), { status: r.status }); return d; });

  /* ---------------- the catalog ---------------- */
  const playerSrc = (r) => r.links.soundcloud
    ? "https://w.soundcloud.com/player/?url=" + encodeURIComponent(r.links.soundcloud) + "&color=%23b9d7ff&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=true"
    : "https://open.spotify.com/embed/track/" + r.links.spotify.split("/").pop() + "?theme=0";

  function card(r) {
    const li = el("li"), a = el("a", "rel");
    a.href = r.links.soundcloud || r.links.spotify;
    const img = el("img"); img.src = r.cover || ""; img.alt = "Cover of " + r.title; img.width = 300; img.height = 300; img.loading = "lazy"; img.decoding = "async";
    const title = el("span", "rel-title", r.title);
    if (r.explicit) { title.append(" "); const e = el("span", "e", "e"); e.title = "Explicit"; title.append(e); }
    const meta = [new Date(r.date).getUTCFullYear(), r.links.soundcloud ? "soundcloud" : "spotify", r.cut, r.credit].filter(Boolean).join(" · ");
    a.append(img, title, el("span", "rel-meta", meta));
    li.append(a);
    if (r.versions && r.versions.length) {
      const v = el("span", "rel-versions");
      r.versions.forEach((x, i) => { if (i) v.append(" · "); const l = el("a", null, x.name); l.href = x.url; v.append(l); });
      li.append(v);
    }
    return li;
  }

  get("").then((d) => {
    const rs = (d.releases || []).filter((r) => r.links && (r.links.soundcloud || r.links.spotify));
    if (!rs.length) return;
    const n = rs[0];
    if (n.cover) { $("avatar").src = n.cover; $("avatar").alt = "Cover of " + n.title + ", the newest release"; }
    $("avatar-title").textContent = n.title;
    $("fact-count").textContent = rs.length;
    $("fact-last").textContent = day(n.date);
    $("latest-title").textContent = n.title;
    $("latest-meta").textContent = [day(n.date), n.cut, n.credit].filter(Boolean).join(" · ");
    const p = $("latest-player"), src = playerSrc(n);
    if (p.src !== src) { p.src = src; p.title = n.title; }
    $("music-count").textContent = rs.length;
    $("grid").replaceChildren(...rs.map(card));
  }).catch(() => {});

  /* ---------------- the counter ---------------- */
  // One count per visit, not per reload: the tab remembers that it already counted.
  let counted = false;
  try { counted = sessionStorage.getItem("yk-counted") === "1"; } catch (_) {}
  const origin = { headers: { "Content-Type": "application/json" } };
  get("/visits", counted ? undefined : { method: "POST", ...origin }).then((d) => {
    try { sessionStorage.setItem("yk-counted", "1"); } catch (_) {}
    const digits = String(Math.max(0, d.count | 0)).padStart(6, "0");
    $("odometer").replaceChildren(...[...digits].map((c) => el("span", null, c)));
    $("odometer").setAttribute("aria-label", d.count + " visitors");
    $("counter").hidden = false;
  }).catch(() => {});

  /* ---------------- the guestbook ---------------- */
  const list = $("gb-entries"), form = $("sign"), status = $("gb-status"), msg = $("gb-message"), left = $("gb-left");
  function entry(e) {
    const li = el("li"), who = el("div", "who");
    const t = el("time", null, day(e.at.replace(" ", "T") + "Z")); t.dateTime = e.at.replace(" ", "T") + "Z";
    who.append(el("b", null, e.name), t);
    li.append(who, el("p", null, e.message));
    return li;
  }
  function show(entries) {
    list.replaceChildren(...(entries.length ? entries.map(entry) : [el("li", "empty", "no messages yet. be the first")]));
    $("gb-count").textContent = entries.length ? entries.length : "";
  }
  let entries = [];
  get("/guestbook").then((d) => { entries = d.entries || []; show(entries); $("guestbook").hidden = false; }).catch(() => {});

  msg.addEventListener("input", () => { left.textContent = 280 - msg.value.length; });
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const btn = form.querySelector("button");
    btn.disabled = true; status.className = "status"; status.textContent = "checking…";
    get("/guestbook", { method: "POST", ...origin, body: JSON.stringify({ name: $("gb-name").value, message: msg.value, website: $("gb-website").value }) })
      .then((d) => {
        entries = [d.entry, ...entries]; show(entries);
        msg.value = ""; left.textContent = "280"; status.textContent = "signed ✦";
      })
      .catch((e) => { status.className = "status bad"; status.textContent = e.message && e.message !== "failed" ? e.message : "couldn't sign right now"; })
      .finally(() => { btn.disabled = false; });
  });
})();
