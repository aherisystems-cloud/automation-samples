-- Multiple sources: PPIP, World Bank (open API), customer uploads, org-posted tenders.
ALTER TABLE tenders ADD COLUMN listed INTEGER NOT NULL DEFAULT 1;   -- 0 = private upload, never on the board
ALTER TABLE tenders ADD COLUMN description TEXT;                     -- notice text (World Bank, org posts)
ALTER TABLE tenders ADD COLUMN contact TEXT;                         -- issuing agency contact from the public notice
