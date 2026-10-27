-- B2B directory listings (DECISION 2026-10-13). Unclaimed listings come from information
-- the business published itself; claimed ones are confirmed by the owner by email.
CREATE TABLE IF NOT EXISTS listings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL,               -- key in src/lib/directoryCategories.js
  county        TEXT NOT NULL,               -- 'Nairobi' | 'Nakuru' | 'Kiambu' ...
  town          TEXT,
  services      TEXT,                        -- short, factual, from their own pages (comma list)
  phone         TEXT,                        -- business line as published by the business
  email         TEXT,                        -- business email as published by the business
  website       TEXT,
  source_url    TEXT NOT NULL,               -- where the details were published (proof)
  status        TEXT NOT NULL DEFAULT 'unclaimed',  -- unclaimed | claimed | removed
  origin        TEXT NOT NULL DEFAULT 'public',     -- public | submitted
  crm_lead_id   TEXT,                        -- Zoho CRM lead id (Aheri org)
  contacted_at  TEXT,                        -- first outreach email sent
  claimed_at    TEXT,
  removed_at    TEXT,
  remove_reason TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS listings_status ON listings (status, county, category);

-- Claim / remove requests. Confirmed by a one-time link emailed to the listing's own email.
CREATE TABLE IF NOT EXISTS listing_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id    INTEGER NOT NULL REFERENCES listings(id),
  action        TEXT NOT NULL,               -- claim | remove
  email         TEXT NOT NULL,
  name          TEXT,
  phone         TEXT,
  note          TEXT,
  token         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending (await email confirm) | review (email differs, manual) | done
  consent_at    TEXT,
  ip            TEXT,
  created_at    TEXT NOT NULL,
  done_at       TEXT
);
