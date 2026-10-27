-- Offers and deals (Rita, 2026-10-27): claimed businesses post time-limited offers, shown on their profile and on
-- /offers/. Every offer must end within 60 days and disappears when it ends. Max 3 live per business.
CREATE TABLE IF NOT EXISTS offers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id  INTEGER NOT NULL REFERENCES listings(id),
  title       TEXT NOT NULL,          -- e.g. "20% off branded T-shirts for school events"
  details     TEXT,                   -- what is included, conditions
  price_was   REAL,                   -- optional, KSh
  price_now   REAL,                   -- optional, KSh
  ends_at     TEXT NOT NULL,          -- ISO date; hidden after this day
  removed_at  TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS offers_live ON offers (ends_at, removed_at);
CREATE INDEX IF NOT EXISTS offers_listing ON offers (listing_id);
