-- Outcome follow-ups already sent to a buyer (day3, day10), so the 5-minute worker never repeats one.
CREATE TABLE IF NOT EXISTS sourcing_followups (
  request_id INTEGER NOT NULL REFERENCES requests(id),
  kind       TEXT NOT NULL,
  sent_at    TEXT NOT NULL,
  PRIMARY KEY (request_id, kind)
);
