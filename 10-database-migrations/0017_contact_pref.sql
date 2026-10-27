-- How the owner of a claimed listing wants BiasharaPros to contact them: 'email' | 'whatsapp' (NULL = not chosen).
ALTER TABLE listings ADD COLUMN contact_pref TEXT;
