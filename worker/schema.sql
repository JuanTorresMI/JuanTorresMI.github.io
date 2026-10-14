-- The music page's counter and guestbook, and the YouTube page's snapshots (D1). Apply with:
--   npx.cmd wrangler d1 execute yokonjuan --remote --file=schema.sql
-- Safe to run again: nothing is dropped.

CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guestbook (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL,          -- UTC, "YYYY-MM-DD HH:MM:SS"
  ip_hash    TEXT NOT NULL           -- salted hash, only for the rate limit; never returned
);
CREATE INDEX IF NOT EXISTS guestbook_ip ON guestbook (ip_hash, created_at);

-- The YouTube page (src/youtube.js). The cron job writes both once an hour.
CREATE TABLE IF NOT EXISTS youtube_latest (
  id         INTEGER PRIMARY KEY CHECK (id = 1),   -- one row: the newest snapshot
  body       TEXT NOT NULL,                        -- the JSON GET /youtube serves
  updated_at TEXT NOT NULL                         -- ISO time of the poll
);

CREATE TABLE IF NOT EXISTS youtube_daily (
  day         TEXT PRIMARY KEY,                    -- UTC "YYYY-MM-DD"; holds the day's last reading
  subscribers INTEGER,                             -- null while the channel hides its count
  views       INTEGER,
  videos      INTEGER
);
