-- Evidence-based verification records. Private evidence metadata is never exposed by the public API.
CREATE TABLE IF NOT EXISTS directory_verification_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  label TEXT NOT NULL CHECK (label IN (
    'contact_confirmed',
    'registration_checked',
    'tax_status_checked',
    'professional_credential_checked',
    'profile_reviewed'
  )),
  outcome TEXT NOT NULL CHECK (outcome IN ('passed', 'failed', 'inconclusive', 'not_applicable')),
  source_name TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  expires_at TEXT,
  reviewer TEXT NOT NULL,
  evidence_ref TEXT,
  internal_notes TEXT,
  disputed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS directory_verification_listing_label
  ON directory_verification_checks (listing_id, label, checked_at DESC);
CREATE INDEX IF NOT EXISTS directory_verification_expiry
  ON directory_verification_checks (outcome, expires_at);
