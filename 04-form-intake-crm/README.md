# 04 · Form intake to database and CRM

**Business problem.** Seventeen forms on the site (newsletter, directory listings, sourcing requests, tender posts and more) all create leads. Each lead has to be stored with proof of consent, kept free of spam, and passed to Zoho CRM, and not one can be lost if the CRM or email is down.

**What the code does**

- `submit.js`: one endpoint for every form.
  1. Size limit and parsing.
  2. Honeypot spam trap.
  3. Allow-list of form types.
  4. Explicit consent, required under Kenya's Data Protection Act.
  5. Email or phone check, then the write to D1 with the consent timestamp, IP and source page.
  - A buyer's tender post also emails the team at once, with every field HTML-escaped.
- `zoho-webform.js`: forwards the lead to a Zoho CRM web form, mapping site fields to CRM fields. That triggers Zoho's own auto-reply and owner notification. It runs fire-and-forget (`waitUntil`), so the visitor never waits on Zoho.
- `claim-request.js` and `notify.js`: a business owner claims or removes their listing.
  - **Claim:** a one-time email link proves they control the inbox.
  - **Remove:** a request that isn't from the published email goes to a person for review, so a competitor can't delete a rival's listing.
  - **Email down:** if the email service fails, the request is saved as `unsent`, the owner is alerted, and the CRM sync resends it through Zoho.

**Design choices**

- D1 is the source of truth. The CRM and email are side effects that can fail without losing data, and the [daily health check](../09-ops-monitoring/) catches anything not synced within 6 hours.
- Every limit is enforced on the server: field lengths, form types and email format.

**Check:** `node 04-form-intake-crm/intake.selfcheck.mjs` runs the endpoint against a fake D1 and covers consent, unknown forms, missing contact details and bad emails.
