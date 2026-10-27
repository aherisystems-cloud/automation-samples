// Excerpt from the WowGlamDecor Cloudflare Worker (src/worker.js): the outbound click route.
// Router, CORS and the other routes are omitted. Bindings: DB (D1), WGD_CACHE (KV).

// ── GET /api/go/:slug/:retailer — first-party click tracking + redirect ───────
// The buy buttons point here instead of straight at the retailer, so every
// outbound click is logged (per product, per retailer, per country) for the
// paid-listing metrics. The destination is resolved SERVER-SIDE from our own
// retailer_links (never from a client-supplied URL — that would be an open
// redirect). Logging is best-effort and never blocks the redirect.
//
// Bot/rate filtering (added 2026-09-22 — see docs/TODO.md item 113): from
// 2026-09-11 this table was found logging 400-600 "clicks" a day touching
// 70-95% of the catalog, clearly automated, not shoppers. The redirect itself
// must NEVER be blocked (a bot, a privacy-stripped browser, whatever — the
// link still has to work), only the INSERT is gated:
//   1. Known bot/tool user-agents are never logged.
//   2. A real click only ever happens from our own product/shop page (the
//      buy button is JS-rendered), so it always carries a same-site Referer.
//      No/foreign referer = not logged (still redirected).
//   3. Per-IP-per-slug rate limit via the existing WGD_CACHE KV: at most one
//      logged click per IP per product per hour, so one scripted loop can't
//      inflate a single slug even from a real-looking browser UA.
const BOT_UA_RE = /bot|crawl|spider|slurp|headless|python-requests|python-urllib|curl\/|wget\/|go-http-client|scrapy|node-fetch|axios\/|okhttp|ahrefsbot|semrushbot|mj12bot|dotbot|petalbot|bytespider|gptbot|ccbot|claudebot|facebookexternalhit|prerender/i;

function isLikelyBot(request) {
  const ua = request.headers.get('User-Agent') || '';
  if (!ua || BOT_UA_RE.test(ua)) return true;
  const ref = request.headers.get('Referer') || request.headers.get('Referrer') || '';
  if (!ref) return true;
  try {
    const refHost = new URL(ref).hostname;
    if (!/(^|\.)wowglamdecor\.com$/i.test(refHost) && !/\.pages\.dev$/i.test(refHost)) return true;
  } catch {
    return true;
  }
  return false;
}

async function withinRateLimit(env, ip, slug) {
  if (!env.WGD_CACHE || !ip) return true; // fail open — never block a real redirect over a missing binding
  const key = `go-rl:${ip}:${slug}`;
  try {
    const seen = await env.WGD_CACHE.get(key);
    if (seen) return false;
    await env.WGD_CACHE.put(key, '1', { expirationTtl: 3600 }); // 1 logged click / IP / product / hour
    return true;
  } catch {
    return true; // KV hiccup — don't lose a real click over it
  }
}

async function handleGo(request, env, slug, retailerName) {
  try {
    const row = await env.DB.prepare(
      'SELECT affiliate_url, retailer_links FROM products WHERE slug = ? AND published = 1'
    ).bind(slug).first();
    if (!row) return new Response('Not found', { status: 404 });

    const want = String(retailerName).toLowerCase();
    let target = '';
    if (row.retailer_links) {
      try {
        const links = JSON.parse(row.retailer_links);
        const m = links.find((r) => String(r.name).toLowerCase() === want);
        if (m) target = m.url;
      } catch {}
    }
    if (!target) target = row.affiliate_url || '';
    if (!/^https?:\/\//i.test(target)) return new Response('No destination', { status: 404 });

    try {
      if (!isLikelyBot(request)) {
        const ip = request.headers.get('CF-Connecting-IP') || '';
        if (await withinRateLimit(env, ip, slug)) {
          const country = request.headers.get('CF-IPCountry') || (request.cf && request.cf.country) || '';
          await env.DB.prepare(
            'INSERT INTO events (slug, retailer, type, country, ts) VALUES (?, ?, ?, ?, ?)'
          ).bind(slug, want, 'click', country, Math.floor(Date.now() / 1000)).run();
        }
      }
    } catch {}

    return new Response(null, { status: 302, headers: { Location: target, 'Cache-Control': 'no-store' } });
  } catch (err) {
    return new Response('Error', { status: 500 });
  }
}

// ── GET /api/report — click aggregates for the listing report ─────────────────
// SYNC_SECRET-gated (same secret the sync pipeline uses). Returns grouped click
// counts; the listing-report.js script formats them. Kept on the worker so the
