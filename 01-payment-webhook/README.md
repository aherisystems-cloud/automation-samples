# 01 · Payment webhook

**Business problem.** Biashara Pros sells a KES 799 AI tender kit, paid by M-Pesa or card. Checking payments by hand doesn't scale. And trusting the browser's "payment successful" redirect lets someone get the product without paying. That is revenue leakage you only find at month end.

**What the code does**

1. `checkout.js` logs the buyer's acceptance of the terms (version and timestamp), creates the order in D1 with a unique reference, and asks the payment gateway (Paystack) for a checkout URL. If the gateway call fails, the order is marked `failed`, so no order is left half-made.
2. `webhook.js` receives the gateway's server-to-server event and checks its **HMAC-SHA512 signature** using the Web Crypto API. It only accepts references from this product (`bpt_` prefix).
3. `tenders.js` **verifies the payment a second time** against the gateway's API, checking status, currency and exact amount. Then `markPaid` runs one atomic D1 batch: it marks the order paid, queues the AI analysis job and schedules the receipt plus the 7, 3 and 1 day deadline reminders.

**Design choices**

- Two independent checks before money counts: the webhook signature, then a server-side verify.
- Idempotent: a repeated webhook does nothing (`status = 'paid'` short-circuits, and reminders use `INSERT OR IGNORE`).
- A failed AI job is re-queued only if it actually failed, so a paid buyer is never charged twice or left without the product.

**Check:** `node 01-payment-webhook/webhook.selfcheck.mjs` covers forged signatures, wrong product references, underpaid amounts and a valid payment.
