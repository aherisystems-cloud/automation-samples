-- Late quotes (Rita, 2026-10-26): a business may still quote after the deadline, with a firm notice. The quote
-- waits as status 'late' until the team accepts it (status 'quoted', buyer told) or rejects it ('late_rejected').
ALTER TABLE request_recipients ADD COLUMN late INTEGER NOT NULL DEFAULT 0;
