/* "Sell live or in the beef?" on the fed cattle board and region pages (#calc), in English or
 * Spanish (the page's lang). A pen's value at the live price on its live weight, and at the dressed
 * price on its carcass weight (live weight × dressing percentage), and the dressing percentage at
 * which the two pay the same (live price ÷ dressed price). Uses only the numbers the visitor types;
 * the head count, weight and dressing percentage are remembered in this browser.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const form = $("cc-form");
  if (!form) return;
  const es = (document.documentElement.lang || "").startsWith("es");
  $("calc").hidden = false;
  const money = (v, d = 2) => "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const num = (el) => { const v = parseFloat(String(el.value).replace(/,/g, "")); return Number.isFinite(v) ? v : NaN; };
  const els = { head: $("cc-head"), wt: $("cc-wt"), dress: $("cc-dress"), live: $("cc-live"), dressed: $("cc-dressed") };
  const out = $("cc-out"), blank = out.innerHTML;
  for (const k of ["head", "wt", "dress"]) { try { const v = localStorage.getItem("cc-" + k); if (v) els[k].value = v; } catch (e) { /* private window */ } }
  const run = () => {
    for (const k of ["head", "wt", "dress"]) { try { localStorage.setItem("cc-" + k, els[k].value); } catch (e) { /* private window */ } }
    const n = num(els.head) > 0 ? num(els.head) : 1, w = num(els.wt), d = num(els.dress), lp = num(els.live), dp = num(els.dressed);
    if (!(w > 0) || !(d > 0 && d < 100) || !(lp > 0) || !(dp > 0)) { out.innerHTML = blank; return; }
    const carcass = w * d / 100;
    const liveHead = w * lp / 100, dressedHead = carcass * dp / 100;
    const even = lp / dp * 100, better = dressedHead > liveHead;
    const diff = Math.abs(dressedHead - liveHead);
    const many = num(els.head) > 0;
    out.innerHTML = es
      ? `<p class="rb-tag">${better ? "En canal paga más" : Math.abs(dressedHead - liveHead) < 0.5 ? "Pagan lo mismo" : "En pie paga más"}</p>
        <p class="rb-price">${money(diff)} <span>por cabeza de diferencia${many ? `, ${money(diff * n, 0)} por las ${n.toLocaleString("en-US")} cabezas` : ""}</span></p>
        <dl class="rb-facts">
          <div><dt>En pie</dt><dd>${w.toLocaleString("en-US")} lb × ${money(lp)}/cwt = ${money(liveHead)} por cabeza</dd></div>
          <div><dt>En canal</dt><dd>${Math.round(carcass).toLocaleString("en-US")} lb de canal × ${money(dp)}/cwt = ${money(dressedHead)} por cabeza</dd></div>
          <div><dt>Punto de equilibrio</dt><dd>Con un rendimiento de ${even.toFixed(1)}% las dos pagan lo mismo; arriba de eso conviene en canal.</dd></div>
          <div><dt>Precio en pie equivalente</dt><dd>${money(dp * d / 100)}/cwt: lo que vale el precio en canal en peso vivo con su rendimiento.</dd></div>
        </dl>`
      : `<p class="rb-tag">${better ? "Dressed pays more" : Math.abs(dressedHead - liveHead) < 0.5 ? "They pay the same" : "Live pays more"}</p>
        <p class="rb-price">${money(diff)} <span>a head between them${many ? `, ${money(diff * n, 0)} on ${n.toLocaleString("en-US")} head` : ""}</span></p>
        <dl class="rb-facts">
          <div><dt>Live</dt><dd>${w.toLocaleString("en-US")} lb × ${money(lp)}/cwt = ${money(liveHead)} a head</dd></div>
          <div><dt>In the beef</dt><dd>${Math.round(carcass).toLocaleString("en-US")} lb of carcass × ${money(dp)}/cwt = ${money(dressedHead)} a head</dd></div>
          <div><dt>Break-even dress</dt><dd>At ${even.toFixed(1)}% they pay the same; cattle that dress better than that are worth more in the beef.</dd></div>
          <div><dt>Live equivalent</dt><dd>${money(dp * d / 100)}/cwt: the dressed price at your dressing percentage, on live weight.</dd></div>
        </dl>`;
  };
  Object.values(els).forEach((el) => el.addEventListener("input", run));
  run();
})();
