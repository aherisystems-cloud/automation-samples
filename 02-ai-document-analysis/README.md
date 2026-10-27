# 02 · AI document analysis (Claude API)

**Business problem.** Kenyan government tenders come as long PDFs, often hundreds of pages. Miss one mandatory document, stamp or binding rule and the bid is disqualified. Most small businesses don't have time to read the whole document, so they either skip the tender or lose on a technicality.

**What the code does** (`checklist.js`)

- Sends the tender PDF and every addendum to Claude as document blocks, with prompt caching on the documents.
- Forces **structured output** against a Zod schema. That covers key dates, eligibility, bid security, every mandatory requirement with its page number, forms to sign and stamp, disqualification traps, evaluation criteria, and a bid/no-bid questionnaire tied to exact quotes from the document.
- Runs **two passes**: a draft, then a verification pass that checks every item against the document again, adds anything missed and removes anything unsupported. The cached documents keep the second pass cheap.
- Fails loudly on a refusal or a truncated answer, so a broken result never reaches a paying customer.

**Guardrails**

- The system prompt forbids inventing requirements, amounts or dates, and anything unclear goes into `could_not_confirm`.
- Every item carries a page reference, so the buyer can check it against the source.
- The product is sold as a reading aid. The site and every email tell buyers to confirm against the official document.
- The job queue and owner alert on failure are in [03](../03-scheduled-sync-worker/worker.js) (`processPending`).

**Why AI here and not rules:** every tender is laid out differently, and the requirements are written in free text. That is exactly the kind of messy input where AI earns its place. Deciding who paid, when reminders go out and which job runs next stays plain code.
