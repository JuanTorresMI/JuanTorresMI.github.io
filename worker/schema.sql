-- The music page's counter and guestbook, the YouTube page's snapshots and the reefer rate board (D1). Apply with:
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

-- The reefer rate board (src/reefer.js). One row per distinct rate a shipping district quoted to
-- a city in a week: quote 0 is the main rate, quote 1+ a separate rate for some commodities.
-- Prices are whole US dollars per load; a range USDA didn't give is NULL, never 0.
CREATE TABLE IF NOT EXISTS reefer_quotes (
  week         TEXT NOT NULL,                      -- "YYYY-MM-DD", the Monday the report covers
  district     TEXT NOT NULL,                      -- USDA's shipping district, as USDA writes it
  dest         TEXT NOT NULL,                      -- destination city
  quote        INTEGER NOT NULL,
  low          INTEGER,
  high         INTEGER,
  mostly_low   INTEGER,
  mostly_high  INTEGER,
  change_pct   INTEGER,                            -- USDA's change from the week before
  availability TEXT,                               -- Surplus … Shortage
  commodities  TEXT NOT NULL,                      -- JSON array of the commodities it was listed for
  published    TEXT,                               -- USDA's "MM/DD/YYYY HH:MM:SS"
  PRIMARY KEY (week, district, dest, quote)
);
CREATE INDEX IF NOT EXISTS reefer_lane ON reefer_quotes (quote, district, dest, week);

CREATE TABLE IF NOT EXISTS diesel_weekly (
  week  TEXT PRIMARY KEY,                          -- EIA's period, "YYYY-MM-DD"
  price REAL NOT NULL                              -- U.S. retail No. 2 diesel, $/gal
);

CREATE TABLE IF NOT EXISTS reefer_meta (           -- the backfill's place in history
  key   TEXT PRIMARY KEY,
  value TEXT
);
