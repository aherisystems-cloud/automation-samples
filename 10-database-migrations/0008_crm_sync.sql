-- Hourly CRM sync (bp-crm-sync task): mark rows once copied into Zoho CRM (Aheri org, Business = BiasharaPros).
ALTER TABLE submissions ADD COLUMN crm_lead_id TEXT;
ALTER TABLE submissions ADD COLUMN crm_synced_at TEXT;
ALTER TABLE tender_orders ADD COLUMN crm_lead_id TEXT;
ALTER TABLE tender_orders ADD COLUMN crm_synced_at TEXT;
ALTER TABLE listings ADD COLUMN crm_synced_status TEXT;  -- last listing status pushed to the CRM
