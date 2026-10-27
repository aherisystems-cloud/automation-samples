-- Never auto-email a buyer "no quotes" (Rita, 2026-10-26). At 75% of the time with too few quotes, alert the
-- team once (low_alert_at); at the deadline with none, hold the request for the team (needs_attention = 1).
ALTER TABLE requests ADD COLUMN low_alert_at TEXT;
ALTER TABLE requests ADD COLUMN needs_attention INTEGER NOT NULL DEFAULT 0;
