// The shop's cart page (/shop/cart/): the cards a Facebook or Instagram shop cart named, from the showcase Worker's
// /cart.json (the address's own `products`, like JJ-568:1,JJ-469:2). Each card links to its eBay listing. A cart whose
// cards have all sold says so and points to the store; the shop's coupon shows when the cart came with it or one is set.
(function () {
  var list = document.querySelector("[data-cart]");
  if (!list || !window.fetch) return;
  var base = list.getAttribute("data-cart"), store = list.getAttribute("data-store"), code = list.getAttribute("data-code");
  var q = new URLSearchParams(location.search);
  var money = function (cents) { return "$" + (cents / 100).toFixed(2); };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  var none = function () {
    list.textContent = "";
    var li = el("li", "cart-none");
    li.appendChild(document.createTextNode("These cards have just sold. There are plenty more in the "));
    var a = el("a", null, "JuanJulio Cards eBay store"); a.href = store; a.rel = "noopener";
    li.appendChild(a); li.appendChild(document.createTextNode("."));
    list.appendChild(li);
  };

  var coupon = (q.get("coupon") || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  var box = document.querySelector("[data-coupon]");
  if (box && (code || coupon)) {
    if (coupon && coupon.toUpperCase() !== (code || "").toUpperCase()) {
      box.querySelector(".coupon-what").textContent = "Your code";
      box.querySelector("[data-coupon-code]").textContent = coupon;
    }
    box.hidden = false;
  }

  if (!q.get("products")) return none();
  fetch(base + "/cart.json?products=" + encodeURIComponent(q.get("products"))).then(function (r) {
    if (!r.ok) throw new Error(r.status); return r.json();
  }).then(function (d) {
    var items = d.items || [];
    if (!items.length) return none();
    list.textContent = "";
    var count = 0, total = 0;
    items.forEach(function (c) {
      count += c.qty; total += c.price * c.qty;
      var li = el("li"), a = el("a", "line"), info = el("span", "line-info"), foot = el("span", "card-foot");
      a.href = c.ebay; a.rel = "noopener";
      if (c.photo) {
        var img = document.createElement("img");
        img.src = base + "/photo/" + c.id + ".webp"; img.alt = c.title; img.width = 120; img.height = 168; img.loading = "lazy";
        a.appendChild(img);
      } else a.appendChild(el("span", "line-nopic", "JJ"));
      info.appendChild(el("span", "card-who", c.player || c.title.split(" 20")[0].split(" ").slice(0, 4).join(" ")));
      info.appendChild(el("span", "card-what", c.player && c.set ? c.set + (c.parallel ? " · " + c.parallel : "") : c.title));
      foot.appendChild(el("span", "card-price", money(c.price)));
      if (c.qty > 1) foot.appendChild(el("span", "chip qty", "× " + c.qty));
      if (c.serial) foot.appendChild(el("span", "chip", c.serial));
      if (c.auto) foot.appendChild(el("span", "chip", "Auto"));
      if (c.rookie) foot.appendChild(el("span", "chip", "RC"));
      info.appendChild(foot);
      info.appendChild(el("span", "line-go", c.qty > 1 ? "Buy " + c.qty + " on eBay" : "Buy on eBay"));
      a.appendChild(info); li.appendChild(a); list.appendChild(li);
    });
    var sum = document.querySelector("[data-sum]");
    if (sum) { sum.textContent = count + (count === 1 ? " card · " : " cards · ") + money(total) + " before shipping"; sum.hidden = false; }
  }).catch(none);
})();
