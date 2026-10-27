-- Separate, optional consent for Zabuni tender-insight emails (unticked by default).
ALTER TABLE tender_orders ADD COLUMN insights_opt_in INTEGER NOT NULL DEFAULT 0;
