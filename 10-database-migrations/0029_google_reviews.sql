-- Google reviews panel (Rita, 2026-10-27): live rating, count and up to 5 reviews from the Google Places API,
-- shown with Google's attribution, never copied into our database. Only the place ID is stored (Google allows it).
ALTER TABLE listings ADD COLUMN google_place_id TEXT;        -- Places ID, or 'none' when no confident match
ALTER TABLE listings ADD COLUMN google_place_checked TEXT;   -- when we last looked (retry 'none' after 30 days)
