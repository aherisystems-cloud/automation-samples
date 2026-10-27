-- Welcome series for claimed businesses (docs/WELCOME-SERIES.md), sent by the CRM sync routine.
ALTER TABLE listings ADD COLUMN welcome1_at TEXT;
ALTER TABLE listings ADD COLUMN welcome2_at TEXT;
ALTER TABLE listings ADD COLUMN welcome3_at TEXT;
