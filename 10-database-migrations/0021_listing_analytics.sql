-- Lightweight first-party directory analytics for owner dashboards.
-- No IP addresses, names, or contact details are collected by this event table.
CREATE TABLE IF NOT EXISTS listing_analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('profile_view', 'contact_click', 'search_click')),
  session_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS listing_analytics_listing_event_date
  ON listing_analytics_events (listing_id, event_type, created_at);
CREATE INDEX IF NOT EXISTS listing_analytics_listing_session_date
  ON listing_analytics_events (listing_id, session_key, created_at);
