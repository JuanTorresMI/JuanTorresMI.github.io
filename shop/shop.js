// The shop's landing page, kept current (Juan, Nov 16, 2026: "make sure it auto updates well"). The page is built from
// the site's daily snapshot of the shop; this asks the shop itself (the showcase Worker's /showcase.json, which allows
// any origin and is cached 30 minutes) and swaps in the count of cards for sale and the top cards, so a card that sold
// an hour ago is gone and a new one is there. If the shop doesn't answer, the snapshot's copy stays as it is.
(function () {
  var list = document.querySelector(".cards[data-live]");
  if (!list || !window.fetch) return;
  var base = list.getAttribute("data-live"), store = list.getAttribute("data-store"), max = list.children.length || 8;
  var money = function (cents) { var d = cents / 100; return "$" + (cents % 100 ? d.toFixed(2) : d.toLocaleString("en-US")); };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  fetch(base + "/showcase.json").then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
    var total = d.totals && (d.totals.listed_all || d.totals.listed);
    if (total) document.querySelectorAll("[data-total]").forEach(function (n) { n.textContent = total.toLocaleString("en-US"); });

    var top = (d.for_sale || []).filter(function (c) { return c.photo && c.price > 0; }).slice(0, max);
    if (top.length < 4) return;                               // too few to trust: keep the snapshot's
    var have = {};
    list.querySelectorAll("li[data-id]").forEach(function (li) { have[li.getAttribute("data-id")] = li; });
    var same = top.length === list.children.length && top.every(function (c, i) {
      var li = list.children[i]; return li.getAttribute("data-id") === String(c.id) && li.getAttribute("data-price") === String(c.price);
    });
    if (same) return;

    var frag = document.createDocumentFragment();
    top.forEach(function (c) {
      var old = have[c.id];
      if (old && old.getAttribute("data-price") === String(c.price)) { frag.appendChild(old); return; }
      var li = el("li"), a = el("a", "card"), img = document.createElement("img"), foot = el("span", "card-foot");
      li.setAttribute("data-id", c.id); li.setAttribute("data-price", c.price);
      a.href = store; a.rel = "noopener";
      // A card already on the page keeps its local photo; a new one takes the shop's own thumbnail.
      img.src = old ? old.querySelector("img").getAttribute("src") : base + "/photo/" + c.id + ".webp";
      img.alt = c.name; img.width = 160; img.height = 224; img.loading = "lazy";
      var who = c.player || c.name.split(" 20")[0].split(" ").slice(0, 4).join(" ");
      var what = c.player && c.set ? c.set + (c.parallel ? " · " + c.parallel : "") : c.name;
      a.appendChild(img); a.appendChild(el("span", "card-who", who)); a.appendChild(el("span", "card-what", what));
      foot.appendChild(el("span", "card-price", money(c.price)));
      if (c.serial) foot.appendChild(el("span", "chip", c.serial));
      if (c.auto) foot.appendChild(el("span", "chip", "Auto"));
      if (c.rookie) foot.appendChild(el("span", "chip", "RC"));
      a.appendChild(foot); li.appendChild(a); frag.appendChild(li);
    });
    list.textContent = "";
    list.appendChild(frag);
  }).catch(function () { /* the snapshot's copy stands */ });
})();
