-- Rita, 2026-10-27.
-- 1. Recommendations a business asks its own past clients for (LinkedIn-style), separate from buyers who came
--    through Biashara Pros. Safeguards: the client answers from a private link sent to their own inbox; no emails
--    on the business's own domains; one invite per client email per business; 5 invites a week; a client who
--    answers from the same network as the business's invite is held for the team; both sides are emailed.
CREATE TABLE IF NOT EXISTS recommendation_invites (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id     INTEGER NOT NULL REFERENCES listings(id),
  client_name    TEXT NOT NULL,
  client_email   TEXT NOT NULL,
  work           TEXT,                 -- what the business did for them, as the business describes it
  token          TEXT NOT NULL UNIQUE,
  inviter_ip     TEXT,                 -- hash only
  invited_at     TEXT NOT NULL,
  responded_at   TEXT,
  recommend      INTEGER,              -- 1 yes, 0 no
  comment        TEXT,
  show_comment   INTEGER NOT NULL DEFAULT 0,
  display_name   TEXT,                 -- first name + initial, chosen by the client
  responder_ip   TEXT,                 -- hash only
  status         TEXT NOT NULL DEFAULT 'invited', -- invited | live | held | hidden
  UNIQUE (listing_id, client_email)
);
CREATE INDEX IF NOT EXISTS rec_invites_listing ON recommendation_invites (listing_id, status);

-- 2. Certificates and licences the owner uploads for our team to check (files private in UPLOADS KV).
CREATE TABLE IF NOT EXISTS certificate_uploads (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id   INTEGER NOT NULL REFERENCES listings(id),
  kind         TEXT NOT NULL,          -- registration | kra | licence | membership | quality | other
  title        TEXT NOT NULL,          -- e.g. "NCA 4 Building Works"
  file_key     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'submitted', -- submitted | checked | rejected
  note         TEXT,                   -- team note (why rejected)
  uploaded_at  TEXT NOT NULL,
  checked_at   TEXT
);
CREATE INDEX IF NOT EXISTS cert_uploads_listing ON certificate_uploads (listing_id, status);
