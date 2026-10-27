// POST /api/submit  -> stores one form submission in D1 (binding DB).
// Every site form posts here: newsletter, partner/event/story/case-study
// intake, directory listing, sourcing and BRS requests, invoice lead.
// Read submissions: SELECT * FROM submissions ORDER BY id DESC;

import { forwardToZoho } from './zoho-webform.js';
import { sendEmail } from '../03-scheduled-sync-worker/email.js';

const FORMS = new Set([
  'newsletter', 'partner', 'event', 'story', 'case-study',
  'directory-listing', 'advisor-match', 'sourcing', 'brs-order', 'invoice-lead',
  'tender-waitlist', 'bid-help', 'tender-guide', 'tender-post', 'zabuni-pro-waitlist', 'funding-post', 'manufacturer-listing',
]);
const MAX_BYTES = 20_000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function onRequestPost({ request, env, waitUntil }) {
  const raw = await request.text();
  if (raw.length > MAX_BYTES) return json({ ok: false, error: 'Submission too large.' }, 413);

  let data;
  try {
    data = request.headers.get('content-type')?.includes('application/json')
      ? JSON.parse(raw)
      : Object.fromEntries(new URLSearchParams(raw));
  } catch {
    return json({ ok: false, error: 'Invalid submission.' }, 400);
  }

  // Honeypot: real people never fill the hidden "website_url" field.
  if (data.website_url) return json({ ok: true });

  const form = String(data.form || '');
  if (!FORMS.has(form)) return json({ ok: false, error: 'Unknown form.' }, 400);

  // ODPC: explicit opt-in is required before we keep anyone's data.
  const consent = data.consent === true || data.consent === 'on' || data.consent === 'yes';
  if (!consent) return json({ ok: false, error: 'Please tick the consent box so we can keep your details.' }, 400);

  const email = String(data.email || '').trim().slice(0, 200) || null;
  const phone = String(data.phone || '').trim().slice(0, 40) || null;
  if (!email && !phone) return json({ ok: false, error: 'Add an email or WhatsApp number so we can reply.' }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'That email address looks wrong.' }, 400);

  delete data.website_url;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO submissions (form, email, phone, name, payload, consent, consent_at, ip, user_agent, page)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
  ).bind(
    form, email, phone,
    String(data.name || '').trim().slice(0, 200) || null,
    JSON.stringify(data),
    now,
    request.headers.get('cf-connecting-ip'),
    (request.headers.get('user-agent') || '').slice(0, 300),
    (request.headers.get('referer') || '').slice(0, 300),
  ).run();

  // Notify the Biashara Pros team immediately when a buyer submits a tender/RFQ.
  // D1 is written first; email failure must never lose the submission.
  if (form === 'tender-post') {
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fields = [
      ['Organisation', data.organisation], ['Organisation type', data.organisation_type],
      ['Contact', data.name], ['Email', data.email], ['Phone', data.phone],
      ['Opportunity type', data.opportunity_type], ['Title', data.tender_title],
      ['Reference', data.reference], ['Category', data.category], ['Closing date', data.closing_date],
      ['Location', data.location], ['Official source URL', data.official_source_url], ['How to respond', data.how_to_respond], ['Description', data.description],
    ].filter(([, value]) => value).map(([label, value]) =>
      `<tr><td style="padding:5px 14px 5px 0;color:#666;vertical-align:top">${esc(label)}</td><td style="padding:5px 0">${esc(value).replace(/\\n/g, '<br>')}</td></tr>`
    ).join('');
    try {
      await sendEmail(env, {
        to: 'hello@biasharapros.com',
        subject: `Buyer submission: ${String(data.opportunity_type || 'Tender/RFQ')} · ${String(data.tender_title || data.organisation || 'Review needed').slice(0, 90)}`,
        html: `<div style="font:15px/1.5 Arial,sans-serif;max-width:640px"><p>A buyer submitted a tender/RFQ for manual review. The submission is saved in D1.</p><table style="border-collapse:collapse">${fields}</table><p>Check the official source and closing date before publishing. Do not publish private or invitation-only notices as open opportunities.</p></div>`,
      });
    } catch (err) { console.error('tender/RFQ submission alert failed; submission remains in D1', err); }
  }

  // Fire-and-forget to Zoho CRM so the visitor never waits on Zoho.
  const forward = forwardToZoho(data);
  if (waitUntil) waitUntil(forward); else await forward;

  return json({ ok: true });
}

export const onRequest = () => json({ ok: false, error: 'Method not allowed.' }, 405);
