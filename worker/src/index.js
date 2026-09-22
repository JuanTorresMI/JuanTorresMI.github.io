/* house-tv: the only thing that knows the Stremio auth key.
 *
 * Stremio's own API would answer the browser directly, but an authKey is full account
 * access, so it cannot sit in a public page. This Worker holds it, asks Stremio what the
 * TV has been doing, and hands back the few fields the page actually draws. Read-only:
 * there is no path through here that writes anything back to the account.
 *
 * GET /  ->  { now, last, lately, deck, tally, updated }
 */

const STREMIO = "https://api.strem.io/api/datastoreGet";
const CACHE_SECONDS = 25;          // one upstream call per this, however many people are looking
const LIVE_WINDOW_MIN = 5;         // "playing now" if the TV checked in this recently
const FINISHED_PCT = 98;           // past this it is credits, not viewing

export default {
  async fetch(request, env, ctx) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOW_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
    };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET") return json({ error: "GET only" }, 405, cors);
    if (!env.STREMIO_AUTH_KEY) {
      return json({ error: "This Worker has no STREMIO_AUTH_KEY set. See worker/README.md." }, 500, cors);
    }

    const cache = caches.default;
    const cacheKey = new Request(new URL(request.url).origin + "/__tv");
    const hit = await cache.match(cacheKey);
    if (hit) {
      const fresh = new Response(hit.body, hit);
      for (const [k, v] of Object.entries(cors)) fresh.headers.set(k, v);
      return fresh;
    }

    let library;
    try {
      const r = await fetch(STREMIO, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authKey: env.STREMIO_AUTH_KEY, collection: "libraryItem", all: true }),
      });
      const body = await r.json();
      if (body.error) throw new Error(body.error.message || "Stremio refused the key");
      library = Array.isArray(body.result) ? body.result : [];
    } catch (e) {
      return json({ error: "Couldn't reach Stremio: " + (e.message || e) }, 502, cors);
    }

    const res = json(shape(library, Number(env.LIVE_WINDOW_MIN) || LIVE_WINDOW_MIN), 200, cors);
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  },
};

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

const at = (v) => {
  const t = new Date(v || 0).getTime();
  return Number.isFinite(t) ? t : 0;
};
const pad = (n) => String(n).padStart(2, "0");

/* Stremio keeps one row per title, not per episode: a show is a single item carrying
   whichever episode you are up to. That is why "lately" is a list of titles. */
function one(item) {
  const s = item.state || {};
  const duration = Number(s.duration) || 0;
  const offset = Number(s.timeOffset) || 0;
  const series = item.type === "series";
  const imdb = typeof item._id === "string" && item._id.startsWith("tt") ? item._id.split(":")[0] : null;
  // Episode 0 means Stremio never recorded one, not "episode zero" — season 0 is real
  // (specials), so the episode number is what decides whether there is anything to show.
  const episode = Number(s.episode) || 0;
  return {
    id: item._id,
    title: item.name || "Untitled",
    sub: series && episode > 0 ? `S${pad(Number(s.season) || 0)}E${pad(episode)}`
      : item.year ? String(item.year) : "",
    poster: item.poster || null,
    type: item.type || "movie",
    watchedAt: s.lastWatched || null,
    at: at(s.lastWatched),
    pct: duration > 0 ? Math.min(100, Math.max(0, (offset / duration) * 100)) : null,
    leftMin: duration > 0 ? Math.max(0, Math.round((duration - offset) / 60000)) : null,
    link: imdb ? `https://www.imdb.com/title/${imdb}/` : null,
  };
}

function shape(library, liveWindowMin) {
  const now = Date.now();

  // Stremio's two flags do not mean what they look like. Playing something you never added
  // to the library still creates a row, marked removed *and* temp — so `removed` alone is
  // not "deleted", it is "not in the library", and filtering on it throws away most of the
  // watch history. Only removed-and-not-temp is a real deletion: something explicitly added
  // and later taken out, which is a decision to forget and is honoured here.
  const deleted = (i) => i.removed && !i.temp;

  const seen = library
    .filter((i) => i && !deleted(i) && i.state && at(i.state.lastWatched) > 0)
    .map(one)
    .sort((a, b) => b.at - a.at);

  // The newest row is the TV's last word. Whether that counts as "on" depends on how
  // recently Stremio synced it and whether the thing was actually finished.
  const top = seen[0] || null;
  const running = top && top.pct != null && top.pct < FINISHED_PCT;
  const live = running && now - top.at < liveWindowMin * 60000 ? top : null;

  const deck = library
    .filter((i) => i && !i.removed)
    .sort((a, b) => at(b._mtime) - at(a._mtime))
    .slice(0, 12)
    .map((i) => ({ id: i._id, title: i.name || "Untitled", poster: i.poster || null, type: i.type || "movie" }));

  const watchedMs = library.reduce((sum, i) => {
    const s = (i && i.state) || {};
    return sum + (Number(s.overallTimeWatched) || Number(s.timeWatched) || 0);
  }, 0);

  return {
    now: live,
    last: live ? null : running ? top : null,     // something part-watched, but not recent enough to call live
    lately: seen.slice(0, 20),
    deck,
    tally: {
      shows: seen.filter((i) => i.type === "series").length,
      films: seen.filter((i) => i.type !== "series").length,
      titles: library.filter((i) => i && !i.removed).length,
      minutes: Math.round(watchedMs / 60000),
    },
    updated: new Date(now).toISOString(),
  };
}
