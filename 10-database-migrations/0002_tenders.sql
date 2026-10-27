-- Tenders feature (2026-10-09). Public tender fields only: never store officer
-- personal data from the PPIP API (ID numbers, phones, tokens).

CREATE TABLE IF NOT EXISTS tenders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT NOT NULL,            -- 'ppip'
  source_id     TEXT NOT NULL,            -- PPIP tender id
  ref           TEXT,
  title         TEXT NOT NULL,
  entity        TEXT,
  category      TEXT,                     -- Goods / Works / Consultancy / Non-Consultancy
  method        TEXT,                     -- Open Tender, RFQ ...
  county_id     INTEGER,
  is_agpo       INTEGER DEFAULT 0,
  tender_fee    REAL,
  published_at  TEXT,
  close_at      TEXT,
  submission    TEXT,                     -- e.g. "Written (Physical/Hard Copy)"
  doc_url       TEXT,                     -- full bid document PDF
  notice_url    TEXT,                     -- advert PDF
  addenda       TEXT,                     -- JSON [{title,new_close,doc_url}]
  synced_at     TEXT NOT NULL,
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS tenders_close ON tenders (close_at);

-- One AI checklist per tender, reused by every buyer (refreshed when addenda change).
CREATE TABLE IF NOT EXISTS tender_checklists (
  tender_id     INTEGER PRIMARY KEY REFERENCES tenders(id),
  status        TEXT NOT NULL,            -- pending | ready | failed
  checklist     TEXT,                     -- JSON
  model         TEXT,
  addenda_hash  TEXT,
  error         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- A purchase: one buyer, one tender, KES 799.
CREATE TABLE IF NOT EXISTS tender_orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  reference     TEXT NOT NULL UNIQUE,     -- Paystack reference, also the private access token
  tender_id     INTEGER NOT NULL REFERENCES tenders(id),
  email         TEXT NOT NULL,
  phone         TEXT,
  amount_kes    INTEGER NOT NULL,
  status        TEXT NOT NULL,            -- initiated | paid | failed | refunded
  terms_version TEXT NOT NULL,
  terms_at      TEXT NOT NULL,            -- disclaimer accepted (logged before payment)
  ip            TEXT,
  user_agent    TEXT,
  paid_at       TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_tender ON tender_orders (tender_id);

-- Reminder schedule per paid order.
CREATE TABLE IF NOT EXISTS tender_reminders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL REFERENCES tender_orders(id),
  kind          TEXT NOT NULL,            -- close_7d | close_3d | close_1d | prebid | site_visit
  due_at        TEXT NOT NULL,
  sent_at       TEXT,
  UNIQUE (order_id, kind)
);
