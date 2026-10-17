-- The music page's counter and guestbook, the YouTube page's snapshots, the border wait board and the boxed beef board (D1). Apply with:
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

-- The reefer rate board (src/reefer.js) keeps nothing here: USDA and EIA keep the history, and the
-- Worker asks them on request. (Its first version kept reefer_quotes, diesel_weekly and reefer_meta;
-- those were dropped on Oct 17, 2026.)

-- The border wait board (src/border.js). One row per commercial port per posted reading. Times are
-- the port's own wall clock. A closed or pending lane is NULL, never 0: unknown is not "no wait".
CREATE TABLE IF NOT EXISTS border_waits (
  port       TEXT NOT NULL,                        -- CBP's port number, "230404"
  at         TEXT NOT NULL,                        -- local "YYYY-MM-DD HH:MM" CBP posted the reading
  dow        INTEGER NOT NULL,                     -- 0 = Monday … 6 = Sunday, local
  hour       INTEGER NOT NULL,                     -- 0-23, local
  std_delay  INTEGER,                              -- minutes, standard commercial lanes
  std_lanes  INTEGER,                              -- standard lanes open
  fast_delay INTEGER,                              -- minutes, FAST lanes
  fast_lanes INTEGER,
  PRIMARY KEY (port, at)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS border_latest (
  id         INTEGER PRIMARY KEY CHECK (id = 1),   -- one row: the board as the last poll saw it
  body       TEXT NOT NULL,                        -- the JSON GET /border serves
  updated_at TEXT NOT NULL
);

-- The boxed beef board (src/beef.js). One row: USDA's newest report. USDA keeps the history and
-- serves any date range, so nothing here duplicates it (scripts/snapshot.py reads it from USDA).
CREATE TABLE IF NOT EXISTS beef_latest (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  body       TEXT NOT NULL,                        -- the JSON GET /beef serves
  updated_at TEXT NOT NULL
);
