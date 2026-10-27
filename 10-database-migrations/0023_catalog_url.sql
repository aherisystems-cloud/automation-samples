-- Product sellers link to the catalogue they already keep (WhatsApp catalogue, Instagram, website page)
-- instead of uploading items here (Rita, 2026-10-24). Shown only once the listing is claimed.
-- catalogue_items (0022) is no longer used; it is empty and can be dropped later.
ALTER TABLE listings ADD COLUMN catalog_url TEXT;
