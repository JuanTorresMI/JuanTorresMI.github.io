/* Starts the site's `Snapshot live pages` workflow (.github/workflows/snapshot.yml), which copies
 * the Worker's data into the pages and redeploys them. GitHub's own schedule for it is late by hours
 * or skipped often enough that the pages fell a day behind, so the Worker starts it instead:
 *
 *   - every morning, from the :47 cron run at 11 UTC (SNAPSHOT_HOUR_UTC): the border averages, the
 *     YouTube and TV copies, and any weekly cattle or reefer report;
 *   - when a new or corrected beef or pork report is stored (index.js marks it pending; see
 *     `pagesTick` there): the new prices reach the pages about half an hour after USDA posts them;
 *   - on request, from the "Update now" button on the data boards (POST /refresh).
 *
 * All share one global cooldown (REFRESH_COOLDOWN_MS, an hour): however many people press the
 * button, the workflow starts at most once an hour. The time of the last start is one row of the
 * `counters` table (name 'refresh_at', milliseconds), claimed with a single conditional UPDATE so two
 * presses in the same instant can't both win. If GitHub refuses the start, the claim is given back.
 * A report that arrives during the cooldown isn't lost: it stays pending ('refresh_pending') and the
 * next cron run after the cooldown starts it.
 *
 *   GET  /refresh   { ready, last, next }   ready is false until GH_DISPATCH_TOKEN is set
 *   POST /refresh   202 { started: true, last, next } | 429 { started: false, last, next }
 *
 * The secret GH_DISPATCH_TOKEN is a fine-grained GitHub token for this one repository with
 * "Actions: read and write" and nothing else (see README.md). Without it nothing here runs.
 */
export const REFRESH_COOLDOWN_MS = 60 * 60 * 1000;
export const SNAPSHOT_HOUR_UTC = 11;     // 6:47 am Central in summer, 5:47 in winter
const REPO = "JuanTorresMI/JuanTorresMI.github.io";
const WORKFLOW = "snapshot.yml";

async function lastStart(env) {
  const row = await env.DB.prepare("SELECT value FROM counters WHERE name = 'refresh_at'").first();
  return row ? Number(row.value) : 0;
}

function state(env, last) {
  return { ready: Boolean(env.GH_DISPATCH_TOKEN), last: last ? new Date(last).toISOString() : null,
    next: new Date(Math.max(Date.now(), last + REFRESH_COOLDOWN_MS)).toISOString() };
}

export async function refreshState(env) {
  return state(env, await lastStart(env));
}

/* Claims the cooldown and starts the workflow. Returns { started, ...state }. Throws if GitHub
   refuses (after giving the claim back), so the caller can log it. */
export async function startSnapshot(env, why) {
  if (!env.GH_DISPATCH_TOKEN) return { started: false, ...state(env, await lastStart(env)) };
  const now = Date.now();
  await env.DB.prepare("INSERT OR IGNORE INTO counters (name, value) VALUES ('refresh_at', 0)").run();
  const prev = await lastStart(env);
  const claim = await env.DB.prepare("UPDATE counters SET value = ?1 WHERE name = 'refresh_at' AND value = ?2 AND value <= ?3")
    .bind(now, prev, now - REFRESH_COOLDOWN_MS).run();
  if (!claim.meta.changes) return { started: false, ...state(env, await lastStart(env)) };
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "house-tv-worker",
    },
    body: JSON.stringify({ ref: "main" }),
    signal: AbortSignal.timeout(15000),
  }).catch((e) => ({ ok: false, status: 0, text: async () => String(e && e.message) }));
  if (!res.ok) {
    await env.DB.prepare("UPDATE counters SET value = ?1 WHERE name = 'refresh_at' AND value = ?2").bind(prev, now).run();
    throw new Error(`GitHub refused the ${why} start: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  console.log(`snapshot started (${why})`);
  return { started: true, ...state(env, now) };
}

/* The cron's daily start: the :47 run at SNAPSHOT_HOUR_UTC. */
export function snapshotDue(now, cron) {
  return cron === "47 * * * *" && now.getUTCHours() === SNAPSHOT_HOUR_UTC;
}

/* A new report waiting for the pages: set when one is stored, cleared when a start goes through. */
export async function setPending(env, on) {
  await env.DB.prepare("INSERT INTO counters (name, value) VALUES ('refresh_pending', ?1) ON CONFLICT(name) DO UPDATE SET value = ?1")
    .bind(on ? 1 : 0).run();
}
export async function isPending(env) {
  const row = await env.DB.prepare("SELECT value FROM counters WHERE name = 'refresh_pending'").first();
  return Boolean(row && row.value);
}
