-- Buyers ask a business a question on its profile (Rita, 2026-10-27). The business answers from a private link
-- in its email; the buyer gets the answer by email; with the buyer's OK the question and answer show on the
-- profile (never the buyer's name or email). The team can hide any question.
CREATE TABLE IF NOT EXISTS listing_questions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id   INTEGER NOT NULL REFERENCES listings(id),
  question     TEXT NOT NULL,
  asker_name   TEXT NOT NULL,
  asker_email  TEXT NOT NULL,
  public_ok    INTEGER NOT NULL DEFAULT 0,  -- buyer agreed to show the Q&A (without their name)
  token        TEXT NOT NULL UNIQUE,        -- the business's private answer link
  answer       TEXT,
  answered_at  TEXT,
  status       TEXT NOT NULL DEFAULT 'new', -- new | answered | hidden
  ip           TEXT,                        -- hash only
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS listing_questions_listing ON listing_questions (listing_id, status);
