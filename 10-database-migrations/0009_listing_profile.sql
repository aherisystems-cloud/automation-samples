-- Richer listing profiles (2026-10-15). Every field comes only from the business's own
-- published pages (CLAUDE.md DECISION 2026-10-13), written in our own words. Never reviews,
-- ratings, client counts or owners' personal details.
ALTER TABLE listings ADD COLUMN about TEXT;          -- 2-3 sentence summary in our own words
ALTER TABLE listings ADD COLUMN areas_served TEXT;   -- as the business states it
ALTER TABLE listings ADD COLUMN address TEXT;        -- business premises as published
ALTER TABLE listings ADD COLUMN hours TEXT;          -- opening hours as published
ALTER TABLE listings ADD COLUMN whatsapp TEXT;       -- business WhatsApp, digits only (2547...)
ALTER TABLE listings ADD COLUMN socials TEXT;        -- JSON object {facebook, instagram, linkedin, x, tiktok, youtube}
ALTER TABLE listings ADD COLUMN founded TEXT;        -- year the business says it started
ALTER TABLE listings ADD COLUMN credentials TEXT;    -- licences/memberships the business states (we have not checked)
ALTER TABLE listings ADD COLUMN enriched_at TEXT;    -- when the profile fields were last collected
ALTER TABLE listings ADD COLUMN services_detail TEXT; -- JSON [{name, plain}]: each service + a plain-language explanation of what it is
ALTER TABLE listings ADD COLUMN serves_counties TEXT; -- JSON array of county names it says it serves, or ["all"]

-- Buyer enquiries sent through an unclaimed listing (its contacts stay hidden until claimed).
-- Forwarded to the business's published email with a claim link; phone-only businesses go to Rita to call.
CREATE TABLE IF NOT EXISTS listing_inquiries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id    INTEGER NOT NULL REFERENCES listings(id),
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL,
  email         TEXT,
  county        TEXT,                        -- where the buyer needs the work done
  message       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'new', -- new | forwarded | manual (no business email, or email failed)
  consent_at    TEXT NOT NULL,
  ip            TEXT,
  created_at    TEXT NOT NULL,
  forwarded_at  TEXT
);
CREATE INDEX IF NOT EXISTS listing_inquiries_listing ON listing_inquiries (listing_id, created_at);
