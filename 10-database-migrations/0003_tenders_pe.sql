-- Link open tenders to their procuring entity id (same id OCDS uses as buyer.id).
ALTER TABLE tenders ADD COLUMN pe_id TEXT;
CREATE INDEX IF NOT EXISTS tenders_pe ON tenders (pe_id);
