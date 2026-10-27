# 03 · Scheduled sync worker

**Business problem.** A tender board is only useful if it's current. A paid product is only trustworthy if it's delivered on time and the buyer is reminded before the deadline. None of that should depend on someone remembering to do it.

**What the code does** (`worker.js`, a Cloudflare Worker with two cron schedules)

- **Every 6 hours:**
  - Pulls active tenders from Kenya's public procurement portal (PPIP), page by page. It respects the 60 requests per minute limit and retries on HTTP 429 using `retry-after`.
  - Pulls World Bank financed procurement notices for Kenya from the official open API.
  - On Mondays, it also sends the weekly digest to business owners.
- **Every 5 minutes:**
  - Processes one pending AI checklist job, from [02](../02-ai-document-analysis/).
  - Sends any due reminder emails.
  - Runs the quote engine's deadline tick, from [05](../05-supplier-quote-engine/).
- A **key-protected manual route** lets me run a sync, generate a checklist or send test emails on demand while debugging.

**Design choices**

- **Upserts** (`INSERT ... ON CONFLICT DO UPDATE`) in D1 batches, so a rerun never creates duplicates.
- **Only public fields are copied.** The procurement API also returns officers' personal data (ID numbers, phone numbers), and the code deliberately leaves it out.
- **Job claiming:** `UPDATE ... SET status = 'working' WHERE status = 'pending'`, then a check that a row actually changed. Overlapping cron runs can't start the same paid job twice.
- **Failure path:** a failed job is marked `failed` with the error. The owner gets the list of affected paid buyers and the exact SQL to retry.
- `email.js`: transactional email through the Brevo API. Reminders are marked sent only after the API accepts them, so a failed send retries on the next run. Reminders for a tender that has already closed are never sent late.
