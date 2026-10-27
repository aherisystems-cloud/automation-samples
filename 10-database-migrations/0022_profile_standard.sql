-- Profile standard (Rita, 2026-10-24; docs/PROFILE-STANDARD.md): buyer decision facts as set choices,
-- product micro-categories for product sellers, and a short showcase catalogue (no stock counts).
ALTER TABLE listings ADD COLUMN business_type TEXT;     -- 'service' | 'product' | 'professional'
ALTER TABLE listings ADD COLUMN sells_to TEXT;          -- JSON ['individuals','businesses','institutions','government']
ALTER TABLE listings ADD COLUMN price_style TEXT;       -- 'list' | 'range' | 'from' | 'quote'
ALTER TABLE listings ADD COLUMN negotiable TEXT;        -- 'fixed' | 'negotiable' | 'depends'
ALTER TABLE listings ADD COLUMN payment_methods TEXT;   -- JSON ['mpesa','cash','card','bank','invoice']
ALTER TABLE listings ADD COLUMN fulfilment TEXT;        -- JSON {mode:'delivery'|'pickup'|'both', counties:[], cost:'free'|'fixed'|'depends', fee}
ALTER TABLE listings ADD COLUMN returns_policy TEXT;    -- JSON {type:'none'|'exchange'|'refund', days}
ALTER TABLE listings ADD COLUMN start_time TEXT;        -- 'same-day' | 'week' | 'book-ahead'
ALTER TABLE listings ADD COLUMN visit_fee TEXT;         -- JSON {type:'none'|'fee'|'deducted', amount}
ALTER TABLE listings ADD COLUMN professional_body TEXT; -- e.g. 'Law Society of Kenya'
ALTER TABLE listings ADD COLUMN membership_no TEXT;
ALTER TABLE listings ADD COLUMN brands TEXT;            -- short text, comma list
ALTER TABLE listings ADD COLUMN min_order TEXT;         -- short text, e.g. '6 pieces'

-- Product micro-categories (keys from src/lib/productCategories.js), 1 to 20 per listing.
CREATE TABLE IF NOT EXISTS listing_products (
  listing_id   INTEGER NOT NULL REFERENCES listings(id),
  micro_key    TEXT NOT NULL,
  price_from   INTEGER,                 -- KSh, optional
  price_to     INTEGER,                 -- KSh, optional
  note         TEXT,                    -- short, e.g. 'matte and gloss, local and imported brands'
  confirmed_at TEXT NOT NULL,           -- owner reconfirms every 90 days
  PRIMARY KEY (listing_id, micro_key)
);
CREATE INDEX IF NOT EXISTS listing_products_micro ON listing_products (micro_key);

-- Showcase catalogue: claimed product sellers only, owner's own photos, reviewed before showing.
CREATE TABLE IF NOT EXISTS catalogue_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id   INTEGER NOT NULL REFERENCES listings(id),
  micro_key    TEXT NOT NULL,
  name         TEXT NOT NULL,
  price_type   TEXT NOT NULL,           -- 'fixed' | 'range' | 'from' | 'ask'
  price_from   INTEGER,
  price_to     INTEGER,
  note         TEXT,
  image_key    TEXT NOT NULL,           -- R2 object key
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | live | hidden
  confirmed_at TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS catalogue_items_listing ON catalogue_items (listing_id, status);
