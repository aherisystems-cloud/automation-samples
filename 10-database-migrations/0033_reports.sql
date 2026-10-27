-- Buyers report a business (Rita, 2026-10-27): scam, wrong details, not a real business, bad behaviour. The team
-- reviews every report on /admin/trust/; nothing is shown publicly from a report.
CREATE TABLE IF NOT EXISTS business_reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id  INTEGER NOT NULL REFERENCES listings(id),
  reason      TEXT NOT NULL,      -- scam | wrong_details | not_real | behaviour | other
  details     TEXT NOT NULL,
  email       TEXT,               -- optional, to follow up
  ip          TEXT,               -- hash only
  status      TEXT NOT NULL DEFAULT 'new', -- new | done
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS business_reports_status ON business_reports (status, id);
