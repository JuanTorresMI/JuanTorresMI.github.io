/* "When to cross" on a crossing page: pick a day and a window of hours, and it finds the hour in
 * that window with the shortest usual wait, from the heat map's own numbers (#pl-data: this site's
 * last 30 days, or CBP's averages for the month last year). English or Spanish, as the page is.
 * Without JavaScript the section stays hidden and the heat map says the same thing.
 */
(() => {
  const el = document.getElementById("pl-data");
  if (!el) return;
  const D = JSON.parse(el.textContent);
  const es = D.es;
  const $ = (id) => document.getElementById(id);
  const day = $("pl-day"), from = $("pl-from"), to = $("pl-to"), out = $("pl-out");
  $("plan").hidden = false;
  // Today, Monday = 0 like the heat map.
  day.value = String((new Date().getDay() + 6) % 7);
  const wait = (v) => (v === 0 ? (es ? "sin demora" : "no wait") : `${v} min`);
  const run = () => {
    const d = Number(day.value), a = Number(from.value), b = Number(to.value);
    const hours = D.grid.filter((r) => (a <= b ? r.h >= a && r.h <= b : r.h >= a || r.h <= b))
      .map((r) => ({ h: r.h, v: r.cells[d] ? r.cells[d].v : null })).filter((x) => x.v != null);
    if (!hours.length) {
      out.innerHTML = `<p>${es ? "No hay promedios para esas horas: el cruce suele estar cerrado o sin lecturas." : "No averages for those hours: the crossing is usually closed or has no readings then."}</p>`;
      return;
    }
    const best = hours.reduce((x, y) => (y.v < x.v ? y : x));
    const worst = hours.reduce((x, y) => (y.v > x.v ? y : x));
    const top = Math.max(worst.v, 1);
    const dayName = D.days[d];
    out.innerHTML = `<p class="rb-tag">${es ? `Los ${dayName}` : `On ${dayName}`}</p>
      <p class="rb-price">${D.hours[best.h]} <span>${es ? "suele ser la mejor hora de ese rango" : "is usually the best hour in that window"}: ${wait(best.v)}</span></p>
      ${worst.v > best.v ? `<p>${es ? `La peor suele ser ${D.hours[worst.h]} (${wait(worst.v)}).` : `The worst is usually ${D.hours[worst.h]} (${wait(worst.v)}).`}</p>` : ""}
      <table class="rb-table bw-plan"><tbody>${hours.map((x) => `<tr${x === best ? ' class="rb-here"' : ""}><th scope="row">${D.hours[x.h]}</th><td>${wait(x.v)}</td><td class="bw-plan-bar"><span style="width:${Math.round((x.v / top) * 100)}%"></span></td></tr>`).join("")}</tbody></table>
      <p class="rb-note">${es ? "Son esperas habituales, no un pronóstico: la espera de hoy está arriba, en vivo desde CBP." : "These are usual waits, not a forecast: today’s wait is at the top of the page, live from CBP."}</p>`;
  };
  [day, from, to].forEach((x) => x.addEventListener("change", run));
  run();
})();
