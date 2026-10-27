-- Assisted/automated sourcing requests. A sourcing request is routed only to claimed
-- listings in the exact requested category and delivery county. Individual supplier
-- deliveries are also recorded in listing_inquiries so the existing CRM sync can track them.
CREATE TABLE IF NOT EXISTS sourcing_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  need          TEXT NOT NULL,
  category      TEXT NOT NULL,
  county        TEXT NOT NULL,
  buyer_name    TEXT NOT NULL,
  buyer_phone   TEXT NOT NULL,
  buyer_email   TEXT,
  status        TEXT NOT NULL DEFAULT 'received', -- received | routed | manual | partial
  routed_count  INTEGER NOT NULL DEFAULT 0,
  consent_at    TEXT NOT NULL,
  ip            TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sourcing_requests_status ON sourcing_requests (status, created_at);

ALTER TABLE listing_inquiries ADD COLUMN sourcing_request_id INTEGER REFERENCES sourcing_requests(id);
CREATE INDEX IF NOT EXISTS listing_inquiries_sourcing_request ON listing_inquiries (sourcing_request_id);
