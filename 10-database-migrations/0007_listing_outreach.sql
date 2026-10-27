-- Outreach steps sent by the daily task through Zoho CRM sendMail (no Zoho cadence needed).
ALTER TABLE listings ADD COLUMN email2_at TEXT;      -- second email sent
ALTER TABLE listings ADD COLUMN call_task_at TEXT;   -- call task created in CRM for Rita
