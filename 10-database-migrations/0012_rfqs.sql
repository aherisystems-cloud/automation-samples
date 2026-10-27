-- RFQ intake, routing and quotation responses (2026-10-21).
-- Buyer contact details are shared only with matched suppliers after explicit consent.
CREATE TABLE IF NOT EXISTS rfqs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  buyer_name TEXT NOT NULL,
  buyer_company TEXT,
  buyer_email TEXT NOT NULL,
  buyer_phone TEXT,
  category TEXT NOT NULL,
  county TEXT,
  need TEXT NOT NULL,
  quantity TEXT,
  budget TEXT,
  deadline TEXT,
  extra_details TEXT,
  status TEXT NOT NULL DEFAULT 'new', -- new | routed | manual_review | closed
  consent_at TEXT NOT NULL,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rfqs_status_created ON rfqs(status, created_at);

CREATE TABLE IF NOT EXISTS rfq_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rfq_id INTEGER NOT NULL REFERENCES rfqs(id),
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'invited', -- invited | quoted | email_failed
  invited_at TEXT NOT NULL,
  quoted_at TEXT,
  UNIQUE(rfq_id, listing_id)
);
CREATE INDEX IF NOT EXISTS rfq_recipients_rfq ON rfq_recipients(rfq_id, status);

CREATE TABLE IF NOT EXISTS rfq_quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rfq_id INTEGER NOT NULL REFERENCES rfqs(id),
  recipient_id INTEGER NOT NULL UNIQUE REFERENCES rfq_recipients(id),
  amount_kes REAL NOT NULL,
  delivery_timeline TEXT,
  valid_until TEXT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rfq_quotes_rfq ON rfq_quotes(rfq_id, created_at);
