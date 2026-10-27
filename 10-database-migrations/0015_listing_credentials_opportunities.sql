-- Owner-managed B2B profile fields. These fields contain business-submitted information,
-- not independently verified evidence. Keep them clearly labelled on public profiles.
ALTER TABLE listings ADD COLUMN licences TEXT;
ALTER TABLE listings ADD COLUMN certifications TEXT;
ALTER TABLE listings ADD COLUMN experience TEXT;
ALTER TABLE listings ADD COLUMN projects TEXT;
ALTER TABLE listings ADD COLUMN opportunities TEXT;
ALTER TABLE listings ADD COLUMN partnership_interests TEXT;
