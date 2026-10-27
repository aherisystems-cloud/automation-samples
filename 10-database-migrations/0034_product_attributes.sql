-- Product attributes the shop ticks per product type (Rita approved 27 Oct 2026; src/lib/productAttributes.js).
-- JSON {"<attribute key>": ["option", ...], "other": "anything else, typed by the owner"}.
ALTER TABLE listing_products ADD COLUMN attributes TEXT;
