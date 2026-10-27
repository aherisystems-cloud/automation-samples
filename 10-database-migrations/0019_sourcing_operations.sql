-- Additive audit trail for sourcing operations notes and admin actions.
CREATE TABLE IF NOT EXISTS sourcing_request_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_type TEXT NOT NULL,
  request_id INTEGER NOT NULL,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sourcing_request_notes_lookup ON sourcing_request_notes (request_type, request_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sourcing_request_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_type TEXT NOT NULL,
  request_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sourcing_request_events_lookup ON sourcing_request_events (request_type, request_id, created_at DESC);
