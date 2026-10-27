-- Photos and videos of the business's own work (Rita, 2026-10-27), added by the owner (or the team) on
-- /directory/manage/. Photos live in UPLOADS KV under photo/<random>/<name>; videos are links to the business's
-- own YouTube, TikTok, Instagram, Facebook or Vimeo posts. Shown on the profile.
ALTER TABLE listings ADD COLUMN photos TEXT;   -- JSON [{key, caption}], max 8
ALTER TABLE listings ADD COLUMN videos TEXT;   -- JSON [url], max 4
