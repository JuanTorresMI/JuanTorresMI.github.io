-- The music page's counter and guestbook, the YouTube page's snapshots, the reefer rate board, the border wait board and the boxed beef board (D1). Apply with:
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

-- The boxed beef board (src/beef.js). Prices are US dollars per hundredweight (100 lb). A cut that
-- didn't trade has no row at all: USDA prints $0.00 for it, which is unknown, never free.
CREATE TABLE IF NOT EXISTS beef_days (
  day           TEXT PRIMARY KEY,                  -- "YYYY-MM-DD", the report date
  choice_cutout REAL,                              -- Choice cutout, 600-900 lb carcasses
  select_cutout REAL,
  choice_loads  REAL,                              -- volume, in loads of 40,000 lb
  select_loads  REAL,
  trim_loads    REAL,
  coarse_loads  REAL,                              -- coarse ground beef
  published     TEXT                               -- USDA's "MM/DD/YYYY HH:MM:SS"
);

CREATE TABLE IF NOT EXISTS beef_items (
  day     TEXT NOT NULL,
  section TEXT NOT NULL,                           -- primal, cut, mixed, ground, blended or trim
  item    TEXT NOT NULL,                           -- USDA's description, whitespace tidied: "Rib, ribeye, bnls, heavy (112A 3)"
  grade   TEXT NOT NULL,                           -- choice, select, or "" for items sold without a grade
  low     REAL,
  high    REAL,
  wavg    REAL NOT NULL,                           -- weighted average; for a primal, its composite value
  trades  INTEGER,
  lbs     INTEGER,
  PRIMARY KEY (day, item, grade)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS beef_meta (             -- the backfill's place in history
  key   TEXT PRIMARY KEY,
  value TEXT
);
