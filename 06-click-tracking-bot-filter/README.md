# 06 · Click tracking with bot filtering

**Business problem.** WowGlamDecor reports outbound clicks to retail partners for paid listings. In September 2026 the click table suddenly showed 400 to 600 "clicks" a day, touching 70 to 95% of the catalog. That was automated traffic, not shoppers. Selling partners numbers like that would destroy trust. Blocking it carelessly would break the buy button for real people.

**What the code does** (`go-handler.js`, a Cloudflare Worker route)

- Buy buttons point to `/api/go/:slug/:retailer`. The destination is looked up **on the server** from the product's own retailer links, never taken from the request, so the route can't be used as an open redirect.
- The redirect **always** happens. Only the logging is filtered:
  1. Known bot and tool user agents are not logged.
  2. A click with no referer, or a referer from another site, is not logged. A real click always comes from the site's own product page.
  3. Per-IP, per-product rate limit in Workers KV: at most one logged click per hour.
- Fails open: a missing KV binding or a KV error never blocks a real redirect.

**Result:** after tracing the spike to bot traffic, I purged 6,471 bad rows. These filters keep the data clean at the source, so the partner reports reflect real shoppers.
