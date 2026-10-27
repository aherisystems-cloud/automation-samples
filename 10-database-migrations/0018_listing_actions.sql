-- One-tap choices from the welcome series and outreach (email or WhatsApp links): /api/directory/act?t=<unsub_token>&a=<action>.
-- The CRM sync routine turns each new row into a lead tag + task, then sets crm_synced_at.
CREATE TABLE IF NOT EXISTS listing_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  action TEXT NOT NULL, -- verify | followup | rfq | partner
  source TEXT,          -- e.g. w1-email, w3-whatsapp
  created_at TEXT NOT NULL,
  crm_synced_at TEXT,
  UNIQUE(listing_id, action)
);
