# 05 · Supplier quote engine

**Business problem.** A buyer who needs, say, 40 office chairs delivered to Kisumu calls around for days and still can't compare the quotes fairly. Good local suppliers miss work because they never hear about the request. Biashara Pros fixes both: one request goes out, and the buyer gets side-by-side quotes by a deadline.

**The flow** (`sourcing.js`, `quote.js`)

1. **Request in, a person approves.** Nothing reaches a business until the team has checked the request.
2. **Matching:** `match()` is one SQL query. It picks businesses in the same category that are based in or serve the delivery county, and only those with a complete profile. Results are ranked: registration-verified first, then location, past reply rate and profile depth. Unclaimed listings are never contacted.
3. **Invitations** go by email, and by WhatsApp Business API template for businesses that chose WhatsApp. Each carries a private, single-use link.
4. **Quoting:** `quote.js` handles a form-based quote or the supplier's own PDF, with photos and a requirement checklist.
   - VAT is normalised so totals compare fairly.
   - Organisation buyers can require a **signed and stamped** quote.
   - Late quotes are held for a person to accept or reject.
5. **Every 5 minutes**, `tick()` does the time-based work:
   - Delivers the comparison at the deadline.
   - Warns the team at 75% of the time if too few quotes are in.
   - Never tells a buyer "no quotes". It holds the request and alerts the team instead.
   - Follows up on day 3 and day 10.
   - Tells every business whether it won, with a reason.
   - Asks buyers for a recommendation.
   - Rebuilds the site after listing changes, debounced and capped to stay inside the build allowance.
   - Reminds owners 30 days before a verification document expires.
6. A **test mode** routes requests from the team's own address only to hidden test listings, so the whole flow can be run end to end without contacting a real business.

**Why it matters:** every rule is a business decision written in code, with the decision and its date kept in the comments. That makes the system auditable by the people who run it, not just by developers.
