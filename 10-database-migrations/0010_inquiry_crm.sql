-- Each buyer enquiry becomes a CRM lead (hourly bp-crm-sync). Marks which ones are done.
ALTER TABLE listing_inquiries ADD COLUMN crm_lead_id TEXT;
ALTER TABLE listing_inquiries ADD COLUMN crm_synced_at TEXT;
