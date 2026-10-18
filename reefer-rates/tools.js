/* The reefer board's calculators. They use only figures already in the page; without JavaScript
 * the forms stay hidden and the printed surcharge table and rates still stand.
 *
 * The board: the fuel surcharge calculator (#fsc-*): (diesel − base) ÷ mpg per mile, times the
 * load's miles. A lane page: rate per mile (#pm-*), the lane's latest range and "mostly" range
 * divided by the trip's miles, and freight per case (#pc-*), the same range spread over the cases
 * on the truck. The surcharge and case inputs are remembered in this browser.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const money = (v, d = 2) => "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const num = (el) => { const v = parseFloat(String(el && el.value).replace(/,/g, "")); return Number.isFinite(v) ? v : NaN; };
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } },
  };

  // Fuel surcharge (the board).
  const form = $("fsc-form");
  if (form) {
    form.hidden = false;
    const out = $("fsc-out"); out.hidden = false;
    const blank = out.innerHTML;
    const els = { diesel: $("fsc-diesel"), base: $("fsc-base"), mpg: $("fsc-mpg"), miles: $("fsc-miles") };
    for (const k of ["base", "mpg"]) { const v = store.get("fsc-" + k); if (v) els[k].value = v; }
    const run = () => {
      store.set("fsc-base", els.base.value); store.set("fsc-mpg", els.mpg.value);
      const d = num(els.diesel), b = num(els.base), m = num(els.mpg), mi = num(els.miles);
      if (!(d > 0) || !(b >= 0) || !(m > 0)) { out.innerHTML = blank; return; }
      const per = Math.max(0, (d - b) / m);
      out.innerHTML = `<p class="rb-price">${money(per, 3)} <span>surcharge per mile</span></p>
        <dl class="rb-facts">
          ${mi > 0 ? `<div><dt>On ${mi.toLocaleString("en-US")} miles</dt><dd>${money(per * mi)}</dd></div>` : ""}
          <div><dt>The math</dt><dd>(${money(d, 3)} − ${money(b)}) ÷ ${m} mpg${d <= b ? ", and diesel is at or under the base, so no surcharge" : ""}</dd></div>
        </dl>`;
    };
    Object.values(els).forEach((el) => el.addEventListener("input", run));
    run();
  }

  // Rate per mile (a lane page).
  const data = $("pm-data");
  if (data) {
    const r = JSON.parse(data.textContent);
    $("per-mile").hidden = false;
    const miles = $("pm-miles"), out = $("pm-out"), blank = out.innerHTML;
    const span = (a, b, mi) => (a === b ? money(a / mi) : `${money(a / mi)}–${money(b / mi)}`);
    miles.addEventListener("input", () => {
      const mi = num(miles);
      if (!(mi > 0)) { out.innerHTML = blank; return; }
      out.innerHTML = `<p class="rb-price">${span(r.low, r.high, mi)} <span>per mile, over ${mi.toLocaleString("en-US")} miles</span></p>
        ${r.mostly_low != null && r.mostly_high != null ? `<dl class="rb-facts"><div><dt>Where most loads moved</dt><dd>${span(r.mostly_low, r.mostly_high, mi)} per mile</dd></div></dl>` : ""}
        <p class="rb-note">USDA’s rates are for the whole load, broker fees included, so this is the all-in rate per mile, fuel and all.</p>`;
    });

    // Freight cost per case (the same lane): the load's rate spread over the cases on the truck.
    $("per-case").hidden = false;
    const cases = $("pc-cases"), lbs = $("pc-lbs"), pout = $("pc-out"), pblank = pout.innerHTML;
    const saved = store.get("pc-cases"), savedLbs = store.get("pc-lbs");
    if (saved) cases.value = saved;
    if (savedLbs) lbs.value = savedLbs;
    const perCase = () => {
      store.set("pc-cases", cases.value); store.set("pc-lbs", lbs.value);
      const n = num(cases), w = num(lbs);
      if (!(n > 0)) { pout.innerHTML = pblank; return; }
      const cs = (a, b) => (a === b ? money(a / n) : `${money(a / n)}–${money(b / n)}`);
      const lb = (a, b) => (a === b ? money(a / n / w, 3) : `${money(a / n / w, 3)}–${money(b / n / w, 3)}`);
      pout.innerHTML = `<p class="rb-price">${cs(r.low, r.high)} <span>freight per case, ${n.toLocaleString("en-US")} cases on the truck</span></p>
        <dl class="rb-facts">
          ${w > 0 ? `<div><dt>Per pound</dt><dd>${lb(r.low, r.high)}</dd></div>` : ""}
          ${r.mostly_low != null && r.mostly_high != null ? `<div><dt>At the rate most loads moved</dt><dd>${cs(r.mostly_low, r.mostly_high)} per case</dd></div>` : ""}
        </dl>
        <p class="rb-note">A full truck only; a partial load usually pays more per case.</p>`;
    };
    [cases, lbs].forEach((el) => el.addEventListener("input", perCase));
    perCase();
  }
})();
