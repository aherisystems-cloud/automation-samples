-- Owner self-service + unsubscribe (2026-10-19).
-- owner_token: private edit link given after a claim (/directory/manage/?t=...).
-- claimed_email: the inbox that confirmed the claim (may differ from the published email).
-- owner_edited_at: last time the owner saved changes; routines never overwrite a claimed listing.
ALTER TABLE listings ADD COLUMN owner_token TEXT;
ALTER TABLE listings ADD COLUMN claimed_email TEXT;
ALTER TABLE listings ADD COLUMN owner_edited_at TEXT;
-- One-click unsubscribe from outreach emails (listing stays unless they press Remove).
ALTER TABLE listings ADD COLUMN unsub_token TEXT;
ALTER TABLE listings ADD COLUMN unsubscribed_at TEXT;
UPDATE listings SET unsub_token = lower(hex(randomblob(16))) WHERE unsub_token IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS listings_unsub ON listings (unsub_token);
CREATE UNIQUE INDEX IF NOT EXISTS listings_owner ON listings (owner_token);
