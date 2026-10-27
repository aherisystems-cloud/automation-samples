// Smart sourcing engine (docs/SMART-SOURCING-SPEC.md), shared by the site's functions and the bp-tenders worker.
// Flow: buyer request -> Rita approves (admin dashboard) -> invite matched businesses (verified first, then
// claimed, never unclaimed) -> they quote or decline by the deadline -> one comparison to the buyer ->
// buyer marks each quote -> every business hears its result. tick() runs every 5 minutes in the worker.
import { sendEmail } from '../03-scheduled-sync-worker/email.js';
import { quoteRequestWhatsApp } from './whatsapp.js';
import { DEADLINE_HOURS, PRIORITIES, URGENCY } from './requestTemplates.js';

export const SITE = 'https://biasharapros.com';
const OWNER = 'hello@biasharapros.com';
const H = 3600e3, DAY = 24 * H;
export const iso = (t = Date.now()) => new Date(t).toISOString();
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const token = () => crypto.randomUUID().replaceAll('-', '');
export const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
export const ksh = (n) => (n == null || n === '' ? '' : `KSh ${Math.round(Number(n)).toLocaleString('en-KE')}`);
const when = (s) => new Date(s).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const wrap = (body) => `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1d1d1b;max-width:640px">${body}</div>`;
const btn = (href, text) => `<p><a href="${href}" style="display:inline-block;background:#14532d;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">${esc(text)}</a></p>`;
export const RESULT_REASONS = { price: 'Price higher than others', late: 'Delivery too late', requirement: 'Did not meet a requirement', existing: 'Went with an existing supplier', cancelled: 'Request cancelled', other: 'Other' };

// Businesses that may receive a request: verified (current registration check) first, then claimed.
// Same category, based in or serving the delivery county. Never unclaimed (Rita, 2026-10-26).
// Only COMPLETE profiles (Rita, 2026-10-27): a person who handles requests, 2-3 sentences about the business,
// and 3+ services, so buyers never wait on a half-empty page. (Prices would block all 6 claimed businesses on
// 27 Oct, so "how you show prices" is a top dashboard item, not a gate, until owners have filled it in.)
// Test mode: requests from TEST_BUYER match only listings with status 'test' (hidden from the site), so the
// whole flow can be tested end to end without any real business being contacted.
export const TEST_BUYER = 'hello@biasharapros.com';
export const READY = `l.contact_name IS NOT NULL AND length(COALESCE(l.about, '')) >= 80
  AND length(COALESCE(l.services, '')) - length(replace(COALESCE(l.services, ''), ',', '')) >= 2`;
export async function match(env, req, limit = req.max_quotes) {
  const status = req.buyer_email === TEST_BUYER ? 'test' : 'claimed';
  const { results } = await env.DB.prepare(`
    SELECT l.id, l.slug, l.name, l.county, l.profile_rich IS NOT NULL AS rich,
      COALESCE(l.contact_email, l.claimed_email, l.email) AS to_email, l.contact_pref, COALESCE(l.contact_phone, l.whatsapp) AS wa,
      EXISTS (SELECT 1 FROM directory_verification_checks c WHERE c.listing_id = l.id AND c.label = 'registration_checked'
        AND c.outcome = 'passed' AND c.disputed_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > ?)) AS verified,
      (SELECT COUNT(*) FROM request_recipients r WHERE r.listing_id = l.id) AS invited,
      (SELECT COUNT(*) FROM request_recipients r WHERE r.listing_id = l.id AND r.status IN ('quoted', 'declined')) AS replied
    FROM listings l
    WHERE l.status = ? AND l.category = ?
      AND (l.county = ? OR l.serves_counties LIKE '%"all"%' OR l.serves_counties LIKE ?)
      AND COALESCE(l.contact_email, l.claimed_email, l.email) IS NOT NULL
      AND (l.status = 'test' OR (${READY}))`)
    .bind(iso(), status, req.category, req.county, `%"${req.county}"%`).all();
  const rate = (x) => (x.invited ? x.replied / x.invited : 0.5);
  return results
    .map((x) => ({ ...x, tier: x.verified ? 'verified' : 'claimed' }))
    .sort((a, b) => (b.verified - a.verified) || ((b.county === req.county) - (a.county === req.county)) || (rate(b) - rate(a)) || (b.rich - a.rich))
    .slice(0, limit);
}

const requirementRows = (req) => parse(req.answers, []).filter((a) => a.a);
function requestBlock(req) {
  const rows = requirementRows(req).map((a) => `<tr><td style="padding:4px 12px 4px 0;color:#555;vertical-align:top">${esc(a.q)}${a.must ? ' <b>(must have)</b>' : ''}</td><td style="padding:4px 0">${esc(a.a)}</td></tr>`).join('');
  return `<p style="white-space:pre-line;background:#f6f7f2;padding:12px;border-radius:8px">${esc(req.need)}</p>
    <table style="border-collapse:collapse;margin:8px 0">${rows}
    <tr><td style="padding:4px 12px 4px 0;color:#555">Delivery</td><td>${esc([req.town, req.county].filter(Boolean).join(', '))}</td></tr>
    ${req.priority ? `<tr><td style="padding:4px 12px 4px 0;color:#555">Buyer's priority</td><td>${esc(PRIORITIES[req.priority] || req.priority)}</td></tr>` : ''}
    <tr><td style="padding:4px 12px 4px 0;color:#555">Buyer</td><td>${req.buyer_type === 'organisation' ? `An organisation${req.buyer_org ? ` (${esc(req.buyer_org)})` : ''}` : 'An individual'}</td></tr>
    ${req.signed_needed ? '<tr><td style="padding:4px 12px 4px 0;color:#555">Quote must be</td><td><b>signed and stamped</b></td></tr>' : ''}
    </table>`;
}

// Invite more businesses into a request that is already collecting (team found them offline). Keeps the deadline.
export async function inviteMore(env, req, listingIds) {
  const picks = (await match(env, req, 50)).filter((p) => listingIds.includes(p.id));
  let invited = 0;
  for (const p of picks) {
    const k = token();
    const ins = await env.DB.prepare(`INSERT OR IGNORE INTO request_recipients (request_id, listing_id, token, tier, invited_at) VALUES (?, ?, ?, ?, ?)`).bind(req.id, p.id, k, p.tier, iso()).run();
    if (!ins.meta.changes) continue;
    await sendEmail(env, { to: p.to_email, subject: `Quote request ${req.ref}: ${req.need.slice(0, 60)}`, html: wrap(`<p>Hello ${esc(p.name)},</p><p>A buyer on Biashara Pros needs a quote, and your business matches. We checked this request before sending it to you.</p>${requestBlock(req)}<p><b>Please reply by ${esc(when(req.deadline_at))}.</b></p>${btn(`${SITE}/quote/?k=${k}`, 'Open the request and quote')}<p>Rita, Biashara Pros</p>`) }).then(() => invited++).catch(() => {});
    if (p.contact_pref === 'whatsapp') await quoteRequestWhatsApp(env, { to: p.wa, business: p.name, ref: req.ref, need: req.need, deadline: when(req.deadline_at), token: k }).catch(() => {});
  }
  return { invited };
}

// Approve: invite the chosen businesses (all matched if listingIds is empty) and start the clock.
export async function approveAndInvite(env, req, listingIds = []) {
  let picks = await match(env, req, 50);
  if (listingIds.length) picks = picks.filter((p) => listingIds.includes(p.id));
  picks = picks.slice(0, req.max_quotes);
  if (!picks.length) {
    await env.DB.prepare(`UPDATE requests SET status = 'no_match', approved_at = ? WHERE id = ?`).bind(iso(), req.id).run();
    await sendEmail(env, { to: req.buyer_email, subject: `Your request ${req.ref}: we are finding businesses`, html: wrap(`<p>Hello ${esc(req.buyer_name)},</p>
      <p>We checked your request. No business on Biashara Pros that has confirmed its page serves this in ${esc(req.county)} yet. We are inviting matching businesses now and will write to you within 7 days.</p>
      <p>Rita, Biashara Pros</p>`) }).catch(() => {});
    return { invited: 0 };
  }
  const deadline = iso(Date.now() + (DEADLINE_HOURS[req.urgency] || 48) * H);
  await env.DB.prepare(`UPDATE requests SET status = 'collecting', approved_at = ?, deadline_at = ? WHERE id = ?`).bind(iso(), deadline, req.id).run();
  req.deadline_at = deadline;
  let invited = 0;
  for (const p of picks) {
    const k = token();
    const ins = await env.DB.prepare(`INSERT OR IGNORE INTO request_recipients (request_id, listing_id, token, tier, invited_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(req.id, p.id, k, p.tier, iso()).run();
    if (!ins.meta.changes) continue;
    try {
      await sendEmail(env, { to: p.to_email, subject: `Quote request ${req.ref}: ${req.need.slice(0, 60)}`, html: wrap(`<p>Hello ${esc(p.name)},</p>
        <p>A buyer on Biashara Pros needs a quote, and your business matches. We checked this request before sending it to you.</p>
        ${requestBlock(req)}
        <p><b>Please reply by ${esc(when(deadline))}.</b> Quote on our form in about 3 minutes, attach your own quote, or tell us you can't quote this one. All three help the buyer.</p>
        ${btn(`${SITE}/quote/?k=${k}`, 'Open the request and quote')}
        <p style="color:#555;font-size:13px">The buyer sees your quote next to others, then tells you whether you were chosen. Your price is never shown to other businesses.</p>
        <p>Rita, Biashara Pros</p>`) });
      invited++;
      if (p.contact_pref === 'whatsapp') await quoteRequestWhatsApp(env, { to: p.wa, business: p.name, ref: req.ref, need: req.need, deadline: when(deadline), token: k }).catch(() => {});
    } catch {
      await env.DB.prepare(`UPDATE request_recipients SET status = 'email_failed' WHERE token = ?`).bind(k).run();
    }
  }
  await sendEmail(env, { to: req.buyer_email, subject: `Your request ${req.ref} is on its way`, html: wrap(`<p>Hello ${esc(req.buyer_name)},</p>
    <p>We checked your request and sent it to ${invited} business${invited === 1 ? '' : 'es'} on Biashara Pros that match it. You will get all their quotes together, side by side, by <b>${esc(when(deadline))}</b>.</p>
    ${btn(`${SITE}/requests/?t=${req.status_token}`, 'See progress')}
    <p>Rita, Biashara Pros</p>`) }).catch(() => {});
  return { invited };
}

// The buyer's comparison: requirements down the side, businesses across, then price and terms.
export async function quotesFor(env, requestId) {
  const { results } = await env.DB.prepare(`
    SELECT r.id AS recipient_id, r.status, r.decline_reason, r.result, r.result_reason, r.tier, l.name, l.slug, l.logo_url,
      l.stamp_key, l.signature_key, l.address, l.town, l.county, q.created_at AS quoted_at,
      l.contact_name, l.contact_role, COALESCE(q.contact_phone, l.contact_phone, l.phone) AS phone, COALESCE(l.contact_email, l.claimed_email, l.email) AS email,
      q.items, q.vat, q.delivery_cost, q.total_kes, q.lead_time, q.delivery_date, q.payment_terms, q.valid_until, q.warranty,
      q.checklist, q.pitch, q.alternative, q.photo_keys, q.video_links, q.attachment_key, q.authorised_name, q.authorised_role
    FROM request_recipients r JOIN listings l ON l.id = r.listing_id LEFT JOIN request_quotes q ON q.recipient_id = r.id
    WHERE r.request_id = ? ORDER BY r.id`).bind(requestId).all();
  return results.map((x) => ({ ...x, items: parse(x.items, []), checklist: parse(x.checklist, []), photo_keys: parse(x.photo_keys, []), video_links: parse(x.video_links, []) }));
}

const SYMBOL = { meets: '✓', partly: 'Partly', cant: '✗' };
export function summaryHtml(req, quotes) {
  const quoted = quotes.filter((q) => q.status === 'quoted');
  const reqs = requirementRows(req);
  const meetsAllMust = (q) => reqs.every((a, i) => !a.must || (q.checklist.find((c) => c.i === i)?.answer || 'meets') === 'meets');
  const cheapest = quoted.filter(meetsAllMust).sort((a, b) => (a.total_kes ?? 1e15) - (b.total_kes ?? 1e15))[0];
  const cell = 'padding:6px 8px;border:1px solid #e3e3dc;vertical-align:top;font-size:13px';
  const head = quoted.map((q) => `<th style="${cell};background:#f6f7f2">${esc(q.name)}${q.tier === 'verified' ? '<br><span style="color:#14532d">Verified</span>' : ''}${q === cheapest ? '<br><span style="color:#14532d">Lowest price that meets every must have</span>' : ''}</th>`).join('');
  const reqRows = reqs.map((a, i) => `<tr><td style="${cell}">${esc(a.q)}${/[?:]$/.test(a.q) ? " " : ": "}${esc(a.a)}${a.must ? ' <b>(must)</b>' : ''}</td>${quoted.map((q) => {
    const c = q.checklist.find((x) => x.i === i) || { answer: 'meets' };
    return `<td style="${cell}">${SYMBOL[c.answer] || '✓'}${c.note ? `<br>${esc(c.note)}` : ''}</td>`;
  }).join('')}</tr>`).join('');
  const row = (label, f) => `<tr><td style="${cell}"><b>${label}</b></td>${quoted.map((q) => `<td style="${cell}">${f(q)}</td>`).join('')}</tr>`;
  const table = quoted.length ? `<table style="border-collapse:collapse;margin:12px 0"><tr><th style="${cell}"></th>${head}</tr>${reqRows}
    ${row('Total', (q) => `<b>${esc(ksh(q.total_kes))}</b>${q.vat ? `<br>${q.vat === 'incl' ? 'VAT included' : q.vat === 'excl' ? '16% VAT added to their price' : 'no VAT charged'}` : ''}`)}
    ${row('Delivery', (q) => esc([q.delivery_date, q.lead_time].filter(Boolean).join(', ')) + (q.delivery_cost ? `<br>${esc(ksh(q.delivery_cost))} delivery` : ''))}
    ${row('Payment', (q) => esc(q.payment_terms || ''))}
    ${row('Valid until', (q) => esc(q.valid_until || ''))}
    ${row('Contact', (q) => `${esc([q.contact_name, q.contact_role].filter(Boolean).join(', '))}<br>${esc(q.phone || '')}<br>${esc(q.email || '')}`)}
    </table>` : '<p>No business sent a quote before the deadline.</p>';
  const declined = quotes.filter((q) => q.status === 'declined').map((q) => `${esc(q.name)}${q.decline_reason ? ` (${esc(q.decline_reason)})` : ''}`);
  return `${table}${declined.length ? `<p style="font-size:13px;color:#555">Could not quote: ${declined.join('; ')}.</p>` : ''}
    <p style="font-size:13px;color:#555">Answers are as stated by each business. Biashara Pros does not rank businesses: you decide.</p>`;
}

export async function deliver(env, req) {
  const quotes = await quotesFor(env, req.id);
  const n = quotes.filter((q) => q.status === 'quoted').length;
  await sendEmail(env, { to: req.buyer_email, subject: `Your quotes for ${req.ref}: ${n} quote${n === 1 ? '' : 's'} to compare`, html: wrap(`<p>Hello ${esc(req.buyer_name)},</p>
    <p>Here are the quotes for your request, side by side${req.priority ? `, with your priority (${esc(PRIORITIES[req.priority] || req.priority)}) in mind` : ''}. Open the full page for each business's own offer, photos and attached quote.</p>
    ${summaryHtml(req, quotes)}
    ${btn(`${SITE}/requests/?t=${req.status_token}`, 'See full quotes and choose')}
    <p>When you decide, tap who you chose on that page. Every business is told its result, so please take a minute.</p>
    <p>Rita, Biashara Pros</p>`) });
  await env.DB.prepare(`UPDATE requests SET status = 'delivered', delivered_at = ? WHERE id = ?`).bind(iso(), req.id).run();
  await env.DB.prepare(`UPDATE request_recipients SET status = 'no_reply' WHERE request_id = ? AND status IN ('invited', 'opened')`).bind(req.id).run();
}

async function resultEmails(env) {
  const { results } = await env.DB.prepare(`
    SELECT r.id, r.result, r.result_reason, q.ref, q.need, COALESCE(l.contact_email, l.claimed_email, l.email) AS to_email, l.name
    FROM request_recipients r JOIN requests q ON q.id = r.request_id JOIN listings l ON l.id = r.listing_id
    WHERE r.result IS NOT NULL AND r.result_sent_at IS NULL LIMIT 20`).all();
  for (const r of results) {
    const text = r.result === 'chosen' ? 'Good news: the buyer chose your quote. Expect them to contact you; you can also reach them through the details in your request email.'
      : r.result === 'shortlisted' ? 'The buyer has shortlisted your quote and may contact you with questions.'
      : `The buyer chose another business this time. Reason given: ${RESULT_REASONS[r.result_reason?.split(':')[0]] || 'not given'}${r.result_reason?.includes(':') ? ` (${r.result_reason.split(':').slice(1).join(':').trim()})` : ''}. Thank you for quoting; it counts toward your response record.`;
    await sendEmail(env, { to: r.to_email, subject: `Your quote for ${r.ref}: ${r.result === 'chosen' ? 'chosen' : r.result === 'shortlisted' ? 'shortlisted' : 'not chosen'}`,
      html: wrap(`<p>Hello ${esc(r.name)},</p><p>${esc(text)}</p><p style="color:#555;font-size:13px">Request: ${esc(r.need.slice(0, 140))}</p><p>Rita, Biashara Pros</p>`) }).catch(() => {});
    await env.DB.prepare(`UPDATE request_recipients SET result_sent_at = ? WHERE id = ?`).bind(iso(), r.id).run();
  }
}

// Every 5 minutes (bp-tenders worker): deliver at the deadline (or when all replied), remind halfway,
// follow up outcomes, close old requests, tell businesses their result, remind owners of expiring checks.
export async function tick(env) {
  const now = Date.now();
  const { results: open } = await env.DB.prepare(`SELECT * FROM requests WHERE status = 'collecting'`).all();
  for (const req of open) {
    const counts = await env.DB.prepare(`SELECT COUNT(*) AS n, SUM(status IN ('quoted', 'declined')) AS done, SUM(status = 'quoted') AS quoted FROM request_recipients WHERE request_id = ? AND status != 'email_failed'`).bind(req.id).first();
    const enough = Math.min(3, req.max_quotes);
    const due = now >= Date.parse(req.deadline_at) || (counts.n && counts.done === counts.n);
    // Never tell a buyer "no quotes" (Rita, 2026-10-26): with none in, hold the request and alert the team,
    // who invite more businesses or extend the deadline from the dashboard.
    if (due && !counts.quoted) {
      if (!req.needs_attention) {
        await env.DB.prepare(`UPDATE requests SET needs_attention = 1 WHERE id = ?`).bind(req.id).run();
        await alertRita(env, `ACTION: no quotes yet for ${req.ref}`, `<p>${esc(req.need.slice(0, 200))}</p><p>The deadline has passed (or every business declined) and no quote came in. The buyer has not been told. Find businesses who can quote, then invite them or extend the deadline on <a href="${SITE}/admin/requests/">the dashboard</a>.</p>`);
      }
      continue;
    }
    if (due) { await deliver(env, req).catch((e) => console.error('deliver', req.ref, e)); continue; }
    // Early warning at 75% of the time: too few quotes so far, so the team can bring in more businesses.
    const span = Date.parse(req.deadline_at) - Date.parse(req.approved_at);
    if (!req.low_alert_at && now >= Date.parse(req.approved_at) + span * 0.75 && (counts.quoted || 0) < enough) {
      await env.DB.prepare(`UPDATE requests SET low_alert_at = ? WHERE id = ?`).bind(iso(), req.id).run();
      await alertRita(env, `HEADS UP: ${req.ref} has ${counts.quoted || 0} of ${enough} quotes`, `<p>${esc(req.need.slice(0, 200))}</p><p>The deadline is ${esc(when(req.deadline_at))}. Invite more businesses or extend it on <a href="${SITE}/admin/requests/">the dashboard</a>.</p>`);
    }
    const half = Date.parse(req.approved_at) + (Date.parse(req.deadline_at) - Date.parse(req.approved_at)) / 2;
    if (now >= half) {
      const { results: slow } = await env.DB.prepare(`SELECT r.id, r.token, l.name, COALESCE(l.contact_email, l.claimed_email, l.email) AS to_email FROM request_recipients r JOIN listings l ON l.id = r.listing_id WHERE r.request_id = ? AND r.status IN ('invited', 'opened') AND r.reminded_at IS NULL`).bind(req.id).all();
      for (const r of slow) {
        await sendEmail(env, { to: r.to_email, subject: `Reminder: quote ${req.ref} closes ${when(req.deadline_at)}`, html: wrap(`<p>Hello ${esc(r.name)},</p><p>The buyer is waiting for your quote. It closes ${esc(when(req.deadline_at))}. If you can't quote this one, one tap tells them.</p>${btn(`${SITE}/quote/?k=${r.token}`, 'Quote or decline')}<p>Rita, Biashara Pros</p>`) }).catch(() => {});
        await env.DB.prepare(`UPDATE request_recipients SET reminded_at = ? WHERE id = ?`).bind(iso(), r.id).run();
      }
    }
  }
  // Outcome follow-ups: day 3 and day 10 to the buyer; day 10 honest note to businesses; close at day 30.
  const { results: done } = await env.DB.prepare(`SELECT * FROM requests WHERE status = 'delivered'`).all();
  for (const req of done) {
    const age = now - Date.parse(req.delivered_at);
    const pending = await env.DB.prepare(`SELECT COUNT(*) AS n, (SELECT COUNT(*) FROM request_recipients WHERE request_id = ? AND status IN ('quoted', 'late')) AS quotes
      FROM request_recipients WHERE request_id = ? AND status IN ('quoted', 'late') AND result IS NULL`).bind(req.id, req.id).first();
    // Close at 30 days, or earlier once there are quotes and the buyer has decided on every one.
    // Late quotes can still arrive and be accepted until then.
    if (age >= 30 * DAY || (pending.quotes && !pending.n)) { await env.DB.prepare(`UPDATE requests SET status = 'closed', closed_at = ? WHERE id = ?`).bind(iso(), req.id).run(); continue; }
    const ask = async (key) => {
      const sent = await env.DB.prepare(`SELECT 1 FROM sourcing_followups WHERE request_id = ? AND kind = ?`).bind(req.id, key).first().catch(() => null);
      if (sent) return;
      await sendEmail(env, { to: req.buyer_email, subject: `Who did you choose for ${req.ref}?`, html: wrap(`<p>Hello ${esc(req.buyer_name)},</p><p>One tap tells each business whether they were chosen. It takes a minute and helps them quote better.</p>${btn(`${SITE}/requests/?t=${req.status_token}#decide`, 'Mark who you chose')}<p>Rita, Biashara Pros</p>`) }).catch(() => {});
      await env.DB.prepare(`INSERT INTO sourcing_followups (request_id, kind, sent_at) VALUES (?, ?, ?)`).bind(req.id, key, iso()).run();
    };
    if (age >= 3 * DAY) await ask('day3');
    if (age >= 10 * DAY) {
      await ask('day10');
      if (!req.undecided_note_at) {
        const { results: waiting } = await env.DB.prepare(`SELECT l.name, COALESCE(l.contact_email, l.claimed_email, l.email) AS to_email FROM request_recipients r JOIN listings l ON l.id = r.listing_id WHERE r.request_id = ? AND r.status = 'quoted' AND r.result IS NULL`).bind(req.id).all();
        for (const w of waiting) await sendEmail(env, { to: w.to_email, subject: `Update on quote ${req.ref}`, html: wrap(`<p>Hello ${esc(w.name)},</p><p>The buyer has not decided yet. We will tell you if that changes.</p><p>Rita, Biashara Pros</p>`) }).catch(() => {});
        await env.DB.prepare(`UPDATE requests SET undecided_note_at = ? WHERE id = ?`).bind(iso(), req.id).run();
      }
    }
  }
  await resultEmails(env);
  await renewalReminders(env);
  await feedbackAsks(env);
  await rebuildIfChanged(env);
}

// Recommendations come only from real buyers: 7 days after an enquiry from a profile, or after choosing a
// business on a quote request, ask once: did they reply, did they deliver, would you recommend them?
async function feedbackAsks(env) {
  const weekAgo = iso(Date.now() - 7 * DAY);
  const { results: enquiries } = await env.DB.prepare(`SELECT i.id, i.name, i.email, l.name AS biz FROM listing_inquiries i JOIN listings l ON l.id = i.listing_id
    WHERE i.email IS NOT NULL AND i.feedback_asked_at IS NULL AND i.created_at <= ? AND l.status != 'removed' LIMIT 20`).bind(weekAgo).all();
  for (const e of enquiries) {
    const t = token();
    await env.DB.prepare(`UPDATE listing_inquiries SET feedback_token = ?, feedback_asked_at = ? WHERE id = ?`).bind(t, iso(), e.id).run();
    await sendEmail(env, { to: e.email, subject: `How did ${e.biz} do?`, html: wrap(`<p>Hello ${esc(e.name)},</p><p>Last week you contacted ${esc(e.biz)} through Biashara Pros. Three quick answers help other buyers choose well.</p>${btn(`${SITE}/feedback/?t=${t}`, 'Answer in 20 seconds')}<p>Rita, Biashara Pros</p>`) }).catch(() => {});
  }
  const { results: chosen } = await env.DB.prepare(`SELECT r.id, q.buyer_name, q.buyer_email, l.name AS biz FROM request_recipients r JOIN requests q ON q.id = r.request_id JOIN listings l ON l.id = r.listing_id
    WHERE r.result = 'chosen' AND r.feedback_token IS NULL AND r.result_at <= ? LIMIT 20`).bind(weekAgo).all();
  for (const c of chosen) {
    const t = token();
    await env.DB.prepare(`UPDATE request_recipients SET feedback_token = ? WHERE id = ?`).bind(t, c.id).run();
    await sendEmail(env, { to: c.buyer_email, subject: `How did ${c.biz} do?`, html: wrap(`<p>Hello ${esc(c.buyer_name)},</p><p>You chose ${esc(c.biz)} for your request. Did they deliver what they promised? Three quick answers help other buyers.</p>${btn(`${SITE}/feedback/?t=${t}`, 'Answer in 20 seconds')}<p>Rita, Biashara Pros</p>`) }).catch(() => {});
  }
}

// Rebuild the site soon after any listing changes (claims, owner edits, removals, new profiles), so pages
// do not wait for the next routine. Debounced (10 minutes since the last build) and capped at 15 builds a day
// to stay inside Cloudflare Pages' build allowance. Needs DEPLOY_HOOK_URL set on this worker.
async function rebuildIfChanged(env) {
  if (!env.DEPLOY_HOOK_URL) return;
  const last = (await env.DB.prepare(`SELECT MAX(triggered_at) AS t FROM site_rebuilds`).first())?.t || '1970-01-01T00:00:00Z';
  if (Date.now() - Date.parse(last) < 10 * 60e3) return;
  const today = await env.DB.prepare(`SELECT COUNT(*) AS n FROM site_rebuilds WHERE triggered_at >= ?`).bind(iso(Date.now() - DAY)).first();
  if (today.n >= 15) return;
  const changed = await env.DB.prepare(`SELECT COUNT(*) AS n FROM listings WHERE replace(COALESCE(updated_at, ''), ' ', 'T') > ?
    OR replace(COALESCE(claimed_at, ''), ' ', 'T') > ? OR replace(COALESCE(removed_at, ''), ' ', 'T') > ?`).bind(last, last, last).first();
  if (!changed.n) return;
  const res = await fetch(env.DEPLOY_HOOK_URL, { method: 'POST' });
  if (res.ok) await env.DB.prepare(`INSERT INTO site_rebuilds (triggered_at, reason) VALUES (?, ?)`).bind(iso(), `${changed.n} listings changed`).run();
}

// 30 days before a verification check expires, ask the owner for the renewed document (once).
async function renewalReminders(env) {
  const soon = iso(Date.now() + 30 * DAY);
  const { results } = await env.DB.prepare(`
    SELECT c.id, c.label, c.expires_at, l.name, COALESCE(l.contact_email, l.claimed_email, l.email) AS to_email
    FROM directory_verification_checks c JOIN listings l ON l.id = c.listing_id
    WHERE c.outcome = 'passed' AND c.expires_at IS NOT NULL AND c.expires_at <= ? AND c.expires_at > ? AND c.reminded_at IS NULL
      AND l.status = 'claimed' LIMIT 20`).bind(soon, iso()).all();
  const NAME = { contact_confirmed: 'contact details', registration_checked: 'business registration', tax_status_checked: 'KRA tax status (Tax Compliance Certificate)', professional_credential_checked: 'licence or professional membership', profile_reviewed: 'profile review' };
  for (const c of results) {
    if (c.to_email) await sendEmail(env, { to: c.to_email, subject: `Your ${NAME[c.label]} check runs out soon`, html: wrap(`<p>Hello ${esc(c.name)},</p><p>The check on your ${esc(NAME[c.label])} runs out on ${esc(new Date(c.expires_at).toLocaleDateString('en-KE'))}. Reply to this email with the renewed document so your page keeps showing it as checked, and you keep getting verified quote requests first.</p><p>Rita, Biashara Pros</p>`) }).catch(() => {});
    await env.DB.prepare(`UPDATE directory_verification_checks SET reminded_at = ? WHERE id = ?`).bind(iso(), c.id).run();
  }
}

export async function alertRita(env, subject, html) {
  await sendEmail(env, { to: OWNER, subject, html: wrap(html) }).catch((e) => console.error('alert', e));
}
export { URGENCY };

// Weekly email to each claimed owner (Rita, 2026-10-27): last 7 days on Biashara Pros against the week before,
// open quote requests, and the one next thing that brings buyers. Mondays (the 06:15 UTC run, 09:15 in Nairobi),
// once a week (KV guard). Owners who unsubscribed get nothing.
// test: { slug } sends only that listing (test listings allowed), any day, to its own email (hello@ for test listings).
export async function weeklyOwnerDigest(env, test = null) {
  const now = new Date();
  if (!test) {
    if (now.getUTCDay() !== 1 || now.getUTCHours() !== 6) return { skipped: true };
    const key = `digest/${now.toISOString().slice(0, 10)}`;
    if (await env.UPLOADS.get(key)) return { skipped: 'done' };
    await env.UPLOADS.put(key, '1', { expirationTtl: 8 * 86400 });
  }
  const week = iso(Date.now() - 7 * 86400000), before = iso(Date.now() - 14 * 86400000);
  const { results } = await env.DB.prepare(`SELECT l.id, l.name, l.slug, l.owner_token, l.unsub_token, COALESCE(l.contact_email, l.claimed_email, l.email) AS to_email,
      l.contact_name, l.about, l.services, l.price_style, l.photos,
      (SELECT COUNT(*) FROM listing_analytics_events e WHERE e.listing_id = l.id AND e.event_type = 'profile_view' AND e.created_at >= ?) AS views,
      (SELECT COUNT(*) FROM listing_analytics_events e WHERE e.listing_id = l.id AND e.event_type = 'profile_view' AND e.created_at >= ? AND e.created_at < ?) AS views_before,
      (SELECT COUNT(*) FROM listing_analytics_events e WHERE e.listing_id = l.id AND e.event_type = 'contact_click' AND e.created_at >= ?)
        + (SELECT COUNT(*) FROM listing_inquiries i WHERE i.listing_id = l.id AND i.created_at >= ?) AS contacts,
      (SELECT COUNT(*) FROM request_recipients r WHERE r.listing_id = l.id AND r.invited_at >= ?) AS requests,
      (SELECT COUNT(*) FROM request_recipients r JOIN requests q ON q.id = r.request_id WHERE r.listing_id = l.id AND r.status IN ('invited', 'opened') AND q.status = 'collecting') AS open_requests
    FROM listings l WHERE ${test ? "l.slug = ? AND l.status = 'test'" : "l.status = 'claimed'"} AND l.unsubscribed_at IS NULL AND l.owner_token IS NOT NULL`)
    .bind(week, before, week, week, week, week, ...(test ? [test.slug] : [])).all();
  let sent = 0;
  for (const l of results) {
    if (!l.to_email) continue;
    const services = String(l.services || '').split(',').filter((s) => s.trim()).length;
    const next = !l.contact_name ? ['Add the person who handles requests', 'You need this to receive quote requests.']
      : String(l.about || '').length < 80 ? ['Describe your business in 2 or 3 sentences', 'You need this to receive quote requests.']
      : services < 3 ? ['List at least 3 services', 'You need this to receive quote requests.']
      : !l.price_style ? ['Say how you show prices', 'Buyers compare prices first.']
      : !parse(l.photos, []).length ? ['Add photos of your work', 'Buyers trust what they can see.']
      : ['Ask 3 past clients to recommend you', 'We email them a private link. Their answers show on your page.'];
    const change = l.views_before ? Math.round((l.views - l.views_before) / l.views_before * 100) : null;
    const link = `${SITE}/directory/manage/?t=${l.owner_token}`;
    const row = (k, v) => `<tr><td style="padding:6px 16px 6px 0;color:#555">${k}</td><td style="padding:6px 0;font-weight:600">${v}</td></tr>`;
    await sendEmail(env, { to: l.to_email, subject: `${l.name}: your week on Biashara Pros`, html: `<p>Hello,</p><p>Here is how ${esc(l.name)} did on Biashara Pros in the last 7 days.</p>
      <table style="border-collapse:collapse">${row('Page views', `${l.views}${change != null ? ` (${change >= 0 ? '+' : ''}${change}% on the week before)` : ''}`)}${row('Calls, WhatsApp taps and messages', l.contacts)}${row('Quote requests sent to you', l.requests)}</table>
      ${l.open_requests ? `<p style="background:#fdecea;padding:10px 12px;border-radius:8px"><b>${l.open_requests} quote request${l.open_requests === 1 ? ' is' : 's are'} waiting for your reply.</b> Fast replies win more buyers.</p>` : ''}
      <p><b>Your next step:</b> ${esc(next[0])}. ${esc(next[1])}</p>
      <p><a href="${link}" style="display:inline-block;background:#14532d;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">Open my dashboard</a></p>
      <p style="color:#666;font-size:13px">Counts from Biashara Pros only, not all your sales.${l.unsub_token ? ` <a href="${SITE}/api/directory/unsubscribe?t=${l.unsub_token}" style="color:#666">Stop these emails</a>.` : ''}</p><p>Rita, Biashara Pros</p>` }).then(() => sent++).catch(() => {});
  }
  return { sent };
}
