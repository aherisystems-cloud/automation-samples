# 10 · Database migrations

The 34 versioned SQL migrations behind Biashara Pros, on Cloudflare D1 (SQLite), applied in order with `wrangler d1 migrations apply`.

Read in sequence, they show the platform growing one business need at a time:

- **Tenders:** tenders, procuring entities and their sources, then paid orders with opt-in.
- **Directory:** listings and their profiles, owners and unsubscribe, verification checks, credentials, contact preferences, logos, analytics.
- **CRM sync:** fields that track what has reached Zoho CRM, so nothing is synced twice and nothing is missed.
- **Sourcing and quotes:** RFQs, sourcing requests, follow-ups, late quotes, quote alerts, recommendations.
- **Trust and content:** reviews, media, offers, reports, product attributes, questions.

The migrations add tables, columns and indexes, and drop nothing. The one data change is a backfill: a new unsubscribe token for each existing listing, so every record works with the new feature from day one.
