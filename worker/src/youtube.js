/* The YouTube page (/youtube/ on the site): the channel's public numbers and its latest uploads.
 *
 *   GET /youtube   { channel, stats, recent: [...], history: [...], updated }
 *
 * The Worker polls YouTube itself, once an hour, on a cron trigger (`scheduled` in index.js),
 * and keeps what it got in D1. Visitors only ever read that snapshot, so however many people
 * open the page, YouTube is asked the same 24 times a day. One poll is three Data API calls
 * (channels.list, playlistItems.list, videos.list), one quota unit each: 72 units a day out of
 * the free 10,000. Uploads have their own bucket, so this can never get in their way.
 *
 * Only public data, read with an API key (secret YOUTUBE_API_KEY). The key can't sign in as
 * anyone and can't change anything on the channel; the worst a leaked one does is spend quota.
 * The channel is YOUTUBE_CHANNEL in wrangler.toml: its handle ("@name") or its id ("UC...").
 *
 * Two things YouTube decides, not us: the public subscriber count is rounded to three
 * significant figures (12,345 is reported as 12,300), and a channel that hides its count
 * reports none at all (stats.subscribers is then null).
 */

const API = "https://www.googleapis.com/youtube/v3";
const RECENT = 12;            // latest uploads kept in the snapshot
const HISTORY_DAYS = 90;      // daily rows returned to the page (the table keeps every day)
const SHORT_MAX_S = 180;      // YouTube's own ceiling for a Short; anything longer is a video
export const YOUTUBE_MAX_AGE = 300;   // edge cache on GET; the data only changes hourly anyway

async function api(env, path, params) {
  const q = new URLSearchParams({ ...params, key: env.YOUTUBE_API_KEY });
  const r = await fetch(`${API}/${path}?${q}`);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    // Google's message names the problem (bad key, API not enabled, quota) without echoing the key.
    const msg = body.error && body.error.message ? body.error.message : "status " + r.status;
    throw new Error("YouTube said: " + msg);
  }
  return body;
}

const num = (v) => (v == null || v === "" ? null : Number(v));

/* "PT1M5S" -> 65. Live streams and premieres can report P0D. */
function seconds(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || "");
  if (!m) return null;
  const [, d, h, mi, s] = m.map((x) => Number(x) || 0);
  return d * 86400 + h * 3600 + mi * 60 + s;
}

/* Asks YouTube for everything the page shows. Throws on any failure: a half-finished poll is
   never stored, so the page keeps the last good snapshot instead. */
export async function fetchChannel(env) {
  if (!env.YOUTUBE_API_KEY) throw new Error("This Worker has no YOUTUBE_API_KEY set. See worker/README.md.");
  const who = String(env.YOUTUBE_CHANNEL || "").trim();
  if (!who) throw new Error("YOUTUBE_CHANNEL is blank in wrangler.toml. See worker/README.md.");

  const by = who.startsWith("UC") ? { id: who } : { forHandle: who.startsWith("@") ? who : "@" + who };
  const ch = await api(env, "channels", { part: "snippet,statistics,contentDetails", ...by });
  const c = ch.items && ch.items[0];
  if (!c) throw new Error(`YouTube has no channel ${who}`);
  const s = c.statistics || {}, sn = c.snippet || {};
  const uploads = c.contentDetails && c.contentDetails.relatedPlaylists && c.contentDetails.relatedPlaylists.uploads;

  let recent = [];
  if (uploads) {
    const pl = await api(env, "playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: String(RECENT) });
    const ids = (pl.items || []).map((i) => i.contentDetails && i.contentDetails.videoId).filter(Boolean);
    if (ids.length) {
      const vs = await api(env, "videos", { part: "snippet,statistics,contentDetails,status", id: ids.join(",") });
      recent = (vs.items || [])
        .filter((v) => !v.status || v.status.privacyStatus === "public")
        .map((v) => {
          const len = seconds(v.contentDetails && v.contentDetails.duration);
          const st = v.statistics || {};
          return {
            id: v.id,
            title: v.snippet.title,
            url: `https://www.youtube.com/watch?v=${v.id}`,
            published: v.snippet.publishedAt,
            seconds: len,
            short: len != null && len > 0 && len <= SHORT_MAX_S,
            views: num(st.viewCount),
            likes: num(st.likeCount),        // null when the channel hides likes
            comments: num(st.commentCount),  // null when comments are off
            thumb: (v.snippet.thumbnails && (v.snippet.thumbnails.medium || v.snippet.thumbnails.default) || {}).url || null,
          };
        })
        .sort((a, b) => (a.published < b.published ? 1 : -1));
    }
  }

  return {
    channel: {
      id: c.id,
      title: sn.title,
      handle: sn.customUrl || null,
      url: sn.customUrl ? `https://www.youtube.com/${sn.customUrl}` : `https://www.youtube.com/channel/${c.id}`,
      thumb: (sn.thumbnails && (sn.thumbnails.medium || sn.thumbnails.default) || {}).url || null,
    },
    stats: {
      subscribers: s.hiddenSubscriberCount ? null : num(s.subscriberCount),
      views: num(s.viewCount),
      videos: num(s.videoCount),
    },
    recent,
    updated: new Date().toISOString(),
  };
}

/* The cron job: one poll, stored as the latest snapshot plus one row for today's date. Today's
   row is overwritten each hour, so it ends up holding the day's last reading. Two D1 writes an
   hour, far inside the free 100,000 a day. */
export async function poll(env) {
  const snap = await fetchChannel(env);
  const day = snap.updated.slice(0, 10);
  const { subscribers, views, videos } = snap.stats;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO youtube_latest (id, body, updated_at) VALUES (1, ?1, ?2) ON CONFLICT(id) DO UPDATE SET body = ?1, updated_at = ?2")
      .bind(JSON.stringify(snap), snap.updated),
    env.DB.prepare("INSERT INTO youtube_daily (day, subscribers, views, videos) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(day) DO UPDATE SET subscribers = ?2, views = ?3, videos = ?4")
      .bind(day, subscribers, views, videos),
  ]);
  return snap;
}

/* What GET /youtube returns. If nothing has been stored yet (the first hour after deploying),
   it polls once on the spot so the page isn't empty while it waits for the cron. */
export async function snapshot(env) {
  const row = await env.DB.prepare("SELECT body FROM youtube_latest WHERE id = 1").first();
  const snap = row ? JSON.parse(row.body) : await poll(env);
  const { results } = await env.DB.prepare("SELECT day, subscribers, views, videos FROM youtube_daily ORDER BY day DESC LIMIT ?1")
    .bind(HISTORY_DAYS).all();
  return { ...snap, history: (results || []).reverse() };
}
