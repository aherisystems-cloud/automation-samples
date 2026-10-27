-- Contact person, rich profiles, verification renewals and smart sourcing (Rita, 2026-10-26).
-- Spec: docs/SMART-SOURCING-SPEC.md, docs/PROFILE-STANDARD.md.

-- Person who handles customer requests. Given by the owner; private (never shown to buyers).
ALTER TABLE listings ADD COLUMN contact_name TEXT;
ALTER TABLE listings ADD COLUMN contact_role TEXT;
ALTER TABLE listings ADD COLUMN contact_phone TEXT;
ALTER TABLE listings ADD COLUMN contact_email TEXT;
ALTER TABLE listing_requests ADD COLUMN role TEXT;
-- Rich profile sections summarised from the business's own site: JSON {highlights, industries, coverage,
-- process, quote_needs, good_to_know, owner_faqs, summary_source, summary_checked, services_detail?}.
ALTER TABLE listings ADD COLUMN profile_rich TEXT;
-- Stamp and signature images (UPLOADS KV keys), uploaded once by the owner, reused on every quote.
ALTER TABLE listings ADD COLUMN stamp_key TEXT;
ALTER TABLE listings ADD COLUMN signature_key TEXT;

-- Renewal reminder sent to the owner (30 days before expires_at).
ALTER TABLE directory_verification_checks ADD COLUMN reminded_at TEXT;

-- One buyer request, reviewed by Biashara Pros before it goes out.
CREATE TABLE IF NOT EXISTS requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ref           TEXT NOT NULL UNIQUE,            -- e.g. BP-7K3QX, shown to the buyer
  status_token  TEXT NOT NULL UNIQUE,            -- private link for the buyer's status page
  category      TEXT NOT NULL,
  county        TEXT NOT NULL,
  town          TEXT,
  need          TEXT NOT NULL,
  answers       TEXT NOT NULL DEFAULT '[]',      -- JSON [{q, a, must}] = the requirements checklist
  priority      TEXT,                            -- price | speed | quality | terms
  urgency       TEXT NOT NULL DEFAULT '48h',     -- today | 24h | 48h | 72h
  max_quotes    INTEGER NOT NULL DEFAULT 10,
  buyer_type    TEXT NOT NULL DEFAULT 'individual', -- individual | organisation
  signed_needed INTEGER NOT NULL DEFAULT 0,
  buyer_name    TEXT NOT NULL,
  buyer_org     TEXT,
  buyer_phone   TEXT NOT NULL,
  buyer_email   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'new',     -- new | collecting | delivered | closed | rejected | no_match
  review_note   TEXT,
  deadline_at   TEXT,
  approved_at   TEXT,
  delivered_at  TEXT,
  undecided_note_at TEXT,
  closed_at     TEXT,
  consent_at    TEXT NOT NULL,
  ip            TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS requests_status ON requests (status, deadline_at);

-- Each business a request went to, and what happened.
CREATE TABLE IF NOT EXISTS request_recipients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id    INTEGER NOT NULL REFERENCES requests(id),
  listing_id    INTEGER NOT NULL REFERENCES listings(id),
  token         TEXT NOT NULL UNIQUE,            -- one-time link to the quote form
  tier          TEXT NOT NULL,                   -- verified | claimed
  status        TEXT NOT NULL DEFAULT 'invited', -- invited | opened | quoted | declined | no_reply | email_failed
  decline_reason TEXT,
  invited_at    TEXT NOT NULL,
  opened_at     TEXT,
  replied_at    TEXT,
  reminded_at   TEXT,
  result        TEXT,                            -- chosen | shortlisted | not_chosen
  result_reason TEXT,
  result_at     TEXT,
  result_sent_at TEXT,
  win_reported  TEXT,                            -- business's own answer: yes | no
  UNIQUE (request_id, listing_id)
);
CREATE INDEX IF NOT EXISTS request_recipients_listing ON request_recipients (listing_id, status);

-- The quote itself.
CREATE TABLE IF NOT EXISTS request_quotes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_id  INTEGER NOT NULL UNIQUE REFERENCES request_recipients(id),
  items         TEXT NOT NULL DEFAULT '[]',      -- JSON [{item, qty, unit, unit_price}]
  vat           TEXT,                            -- incl | excl | none
  delivery_cost REAL,
  total_kes     REAL,
  lead_time     TEXT,
  delivery_date TEXT,
  payment_terms TEXT,
  valid_until   TEXT,
  warranty      TEXT,
  checklist     TEXT NOT NULL DEFAULT '[]',      -- JSON [{i, answer: meets|partly|cant, note}]
  pitch         TEXT,
  alternative   TEXT,
  photo_keys    TEXT NOT NULL DEFAULT '[]',      -- UPLOADS KV keys
  video_links   TEXT NOT NULL DEFAULT '[]',
  attachment_key TEXT,                           -- their own signed and stamped quote
  authorised_name TEXT,
  authorised_role TEXT,
  contact_phone TEXT,
  created_at    TEXT NOT NULL
);
