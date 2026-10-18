/* The site's /worker-usage/ page: how much of Cloudflare's free plan this account uses, from
 * Cloudflare's own GraphQL Analytics API (the numbers the dashboard shows).
 *
 *   GET /usage   { ready, updated, limits, today, days: [...] }   (ready is false without the token)
 *
 * Once an hour (the :47 cron run) `usageTick` asks for the last 30 UTC days, one request with three
 * datasets: Worker invocations (requests, errors, subrequests, CPU time), D1 queries and rows, and D1
 * storage. All for the whole account, because the free plan's limits are the account's, not one
 * Worker's. The answer is kept as one row, `usage_latest`, so a page view never calls the API.
 *
 * Secrets: CF_ANALYTICS_TOKEN, an API token with Account > Account Analytics > Read and nothing
 * else. Var: CF_ACCOUNT_ID (wrangler.toml; an account id is not a secret).
 *
 * Analytics lag a few minutes, and "today" is the UTC day, since that is when the limits reset.
 */
export const USAGE_MAX_AGE = 600;
const API = "https://api.cloudflare.com/client/v4/graphql";
const DAYS = 30;

// Cloudflare's Workers Free and D1 free limits, per day unless noted (developers.cloudflare.com).
export const LIMITS = {
  requests: 100000,            // Worker requests a day, account-wide
  cpu_ms: 10,                  // CPU time per invocation
  rows_read: 5000000,          // D1 rows read a day
  rows_written: 100000,        // D1 rows written a day
  storage_bytes: 5e9,          // D1 storage, all databases
  subrequests: 50,             // outside fetches per invocation
};

const QUERY = `query Usage($acct: string!, $since: Time!, $until: Time!, $sinceD: Date!, $untilD: Date!) {
  viewer { accounts(filter: { accountTag: $acct }) {
    workers: workersInvocationsAdaptive(limit: 2000, filter: { datetime_geq: $since, datetime_leq: $until }) {
      sum { requests errors subrequests }
      quantiles { cpuTimeP50 cpuTimeP99 }
      dimensions { date scriptName }
    }
    d1: d1AnalyticsAdaptiveGroups(limit: 2000, filter: { date_geq: $sinceD, date_leq: $untilD }) {
      sum { readQueries writeQueries rowsRead rowsWritten }
      dimensions { date }
    }
    storage: d1StorageAdaptiveGroups(limit: 2000, filter: { date_geq: $sinceD, date_leq: $untilD }) {
      max { databaseSizeBytes }
      dimensions { date }
    }
  } }
}`;

const day = (d) => d.toISOString().slice(0, 10);

export async function usageTick(env, now = new Date()) {
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT_ID) return null;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (DAYS - 1)));
  const res = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { acct: env.CF_ACCOUNT_ID, since: start.toISOString(), until: now.toISOString(), sinceD: day(start), untilD: day(now) } }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.errors) throw new Error("analytics said: " + res.status + " " + JSON.stringify(j.errors || j).slice(0, 300));
  const acct = ((j.data || {}).viewer || {}).accounts?.[0] || {};

  const days = new Map();
  const get = (d) => days.get(d) || days.set(d, { date: d, requests: 0, errors: 0, subrequests: 0, cpu_p50_ms: null, cpu_p99_ms: null, scripts: {},
    read_queries: 0, write_queries: 0, rows_read: 0, rows_written: 0, storage_bytes: null }).get(d);
  for (const r of acct.workers || []) {
    const d = get(r.dimensions.date), s = r.sum || {}, q = r.quantiles || {};
    d.requests += s.requests || 0; d.errors += s.errors || 0; d.subrequests += s.subrequests || 0;
    d.scripts[r.dimensions.scriptName] = (d.scripts[r.dimensions.scriptName] || 0) + (s.requests || 0);
    // CPU quantiles come per script and are in microseconds; keep the highest of the day's scripts.
    if (q.cpuTimeP50 != null) d.cpu_p50_ms = Math.max(d.cpu_p50_ms || 0, Math.round(q.cpuTimeP50 / 10) / 100);
    if (q.cpuTimeP99 != null) d.cpu_p99_ms = Math.max(d.cpu_p99_ms || 0, Math.round(q.cpuTimeP99 / 10) / 100);
  }
  for (const r of acct.d1 || []) {
    const d = get(r.dimensions.date), s = r.sum || {};
    d.read_queries += s.readQueries || 0; d.write_queries += s.writeQueries || 0;
    d.rows_read += s.rowsRead || 0; d.rows_written += s.rowsWritten || 0;
  }
  for (const r of acct.storage || []) {
    const d = get(r.dimensions.date);
    d.storage_bytes = Math.max(d.storage_bytes || 0, (r.max || {}).databaseSizeBytes || 0);
  }
  const list = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  const body = { updated: now.toISOString(), limits: LIMITS, today: day(now), days: list };
  await env.DB.prepare(`INSERT INTO usage_latest (id, body, updated_at) VALUES (1, ?1, ?2)
    ON CONFLICT(id) DO UPDATE SET body = ?1, updated_at = ?2`).bind(JSON.stringify(body), body.updated).run();
  return body;
}

export async function usageData(env) {
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT_ID) return { ready: false, limits: LIMITS };
  const row = await env.DB.prepare("SELECT body FROM usage_latest WHERE id = 1").first();
  const body = row ? JSON.parse(row.body) : await usageTick(env);     // the first request after setup
  return { ready: true, ...body };
}
