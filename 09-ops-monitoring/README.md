# 09 · Operations monitoring

**Business problem.** Biashara Pros runs on many automations: tender sync, reminders, the CRM sync, the directory routine and daily outreach. If one stops, nobody notices until a customer complains. Automation without monitoring just moves the manual work to firefighting.

**What the code does**

- `health-check.mjs` runs daily from a scheduled routine and prints `{ problems, watch }` as JSON, exiting 1 when there are problems so the routine raises an alert. It checks:
  - The site and its own health endpoint: database reachable, email key working.
  - The latest production build on Cloudflare Pages, and any listing edits not yet live because no rebuild ran.
  - The directory routine: no listing touched in 26 hours.
  - The CRM sync: any submission, enquiry or claim waiting more than 6 hours.
  - The tender worker: the sync, overdue reminder emails and failed AI kits.
  - Business targets on a separate watch list: 25 first outreach emails a day, follow-ups past due, and claims not confirmed after 3 days.
- `d1.mjs`: queries D1 over the Cloudflare REST API, so it runs from a cloud routine with no local tooling. It backs off and retries on HTTP 429 and 5xx. On an auth failure it reports the token's status, never the token.
- `query-helper.mjs`: a small wrapper the checks use.
- `daily-build.yml`: a GitHub Actions cron that triggers the daily Cloudflare Pages rebuild for WowGlamDecor, so the site always reflects the current catalog in D1.

**Design choice:** problems and the watch list are kept apart. A failed job is an incident. A missed outreach target is a conversation. Mixing them trains people to ignore alerts.
