# Automation Samples

**Rita Ndubi** · AI-native builder and strategist · Business Systems & AI Automation
Portfolio: [ritandubi.pages.dev](https://ritandubi.pages.dev) · System walkthrough: [ritandubi.pages.dev/walkthrough](https://ritandubi.pages.dev/walkthrough/)

Real production code from two platforms I designed, built and run myself:

- **Biashara Pros**: a Kenyan business marketplace. It has a business directory, a supplier quote engine, a public tender board and a paid AI tender analysis product.
- **WowGlamDecor**: an e-commerce publishing site with its catalog in a SQL database and a daily automated build.

Both run on Cloudflare (Pages, Workers, D1 SQL, KV storage). They connect to Zoho CRM, Zoho Social, a payment gateway, an email API, the WhatsApp Business API and the Claude API.

The full repositories are private, because they hold live customer data and keys. This repo has the files themselves, copied out unchanged except for one kind of edit: account IDs and keys now come from environment variables. Each folder explains the business problem first, then the code.

## How I work

Every system here follows my **CLEAR Method**:

| Step | What it means in this code |
|---|---|
| **C**hart the whole business | Each flow starts as a written process: who submits, who approves, what the customer hears and when. The comments carry the dated decisions behind each rule. |
| **L**ink the systems | One source of truth (D1) feeds everything else: CRM, email, WhatsApp, payment, site builds. If a downstream system fails, nothing is lost. |
| **E**liminate manual work | Scheduled workers sync data, send reminders, chase late replies and rebuild the site with nobody pressing a button. |
| **A**dd AI with guardrails | AI reads messy documents and drafts. Fixed rules handle money, status and deadlines. A person approves anything that goes out under the company name. |
| **R**un, review & refine | Health checks, self-checks and failure alerts mean problems are found by the system, not by a customer. |

## The samples

| # | Sample | Business problem it solves | Stack |
|---|---|---|---|
| 01 | [Payment webhook](01-payment-webhook/) | Take mobile money and card payments with no manual payment checks, and stop revenue leakage from fake or underpaid confirmations | Payment gateway API, HMAC-SHA512, D1 |
| 02 | [AI document analysis](02-ai-document-analysis/) | Turn a 200-page government tender PDF into a checklist a small business can act on, with page references | Claude API, structured outputs (Zod), two-pass verification |
| 03 | [Scheduled sync worker](03-scheduled-sync-worker/) | Keep a tender board current from two public APIs, run the AI job queue and send deadline reminders on a schedule | Cloudflare Cron Triggers, REST APIs, rate-limit handling, upserts |
| 04 | [Form intake to CRM](04-form-intake-crm/) | Capture every website lead safely, with consent and spam filtering, and pass it to Zoho CRM without ever losing one | Pages Functions, D1, Zoho CRM web form, email API |
| 05 | [Supplier quote engine](05-supplier-quote-engine/) | A buyer posts one request and gets side-by-side quotes from verified local businesses by a deadline | Matching SQL, tokenised links, file uploads, WhatsApp Business API |
| 06 | [Click tracking with bot filtering](06-click-tracking-bot-filter/) | Bots were inflating the click data sold to retail partners. This filters them out without ever blocking a real shopper | Cloudflare Worker, KV rate limiting |
| 07 | [Release health gate](07-release-health-gate/) | 56 automated checks (SEO, links, structured data, images, copy rules) that must pass before a release | Node.js, CI exit codes |
| 08 | [Zoho Social scheduler](08-zoho-social-scheduler/) | Schedule batches of product posts through the Zoho Social API, logging every response | Zoho Social via MCP (JSON-RPC), Node.js |
| 09 | [Operations monitoring](09-ops-monitoring/) | A daily routine that checks every automation actually ran, and reports failures and missed targets | D1 REST API, Cloudflare API, GitHub Actions |
| 10 | [Database migrations](10-database-migrations/) | 34 versioned SQL migrations behind the marketplace: listings, quotes, orders, consent, CRM sync state | SQLite (Cloudflare D1) |

## Patterns that show up across the code

- **Database first, side effects second.** Every write lands in D1 before any email, CRM or WhatsApp call. A failure downstream is logged and retried. It never loses the record.
- **Never trust the browser.** Payment status is re-checked against the gateway's API. Redirect targets are looked up on the server. Private links use unguessable random tokens.
- **Idempotent by design.** `ON CONFLICT` upserts, `INSERT OR IGNORE`, and jobs claimed with an atomic `UPDATE ... WHERE status = 'pending'`, so overlapping runs never double-send.
- **Consent and privacy built in.** Explicit opt-in is stored with a timestamp under Kenya's Data Protection Act. Personal data the public tender API returns is deliberately not copied.
- **Human in the loop where it matters.** Buyer requests are approved before businesses are contacted, late quotes wait for a person to decide, and AI output is labelled as a reading aid.

## Running the checks

```bash
npm run check
```

This runs the self-checks for the payment webhook and the form intake API against a fake database. Both need Node 18 or newer.

## How this code was written

I design the data model, the flows and the rules, and I use Claude Code as a pair programmer to write and test the code. I review, deploy and maintain all of it, and I can walk through any file line by line.
