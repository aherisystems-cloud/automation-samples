-- Buyer recommendations (Rita, 2026-10-26): only from real buyers who used a business through Biashara Pros
-- (a quote request they chose it on, or an enquiry they sent from its page). Profiles show counts, never stars.
CREATE TABLE IF NOT EXISTS recommendations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id      INTEGER NOT NULL REFERENCES listings(id),
  source          TEXT NOT NULL,                  -- request | enquiry
  source_id       INTEGER NOT NULL,               -- request_recipients.id or listing_inquiries.id
  replied         TEXT,                           -- yes | late | no (did the business reply?)
  delivered       TEXT,                           -- yes | partly | no | not_used
  recommend       INTEGER,                        -- 1 = would recommend, 0 = would not
  comment         TEXT,                           -- private, for Rita only
  created_at      TEXT NOT NULL,
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS recommendations_listing ON recommendations (listing_id);
ALTER TABLE listing_inquiries ADD COLUMN feedback_token TEXT;
ALTER TABLE listing_inquiries ADD COLUMN feedback_asked_at TEXT;
ALTER TABLE request_recipients ADD COLUMN feedback_token TEXT;

-- Site rebuilds triggered by the bp-tenders worker when listings change (debounced, capped per day).
CREATE TABLE IF NOT EXISTS site_rebuilds (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  triggered_at TEXT NOT NULL,
  reason       TEXT
);
