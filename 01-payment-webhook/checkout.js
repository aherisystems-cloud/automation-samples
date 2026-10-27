// POST /api/tenders/checkout  {tender_id, email, phone?, accept_terms}
// Logs the disclaimer acceptance, creates the order and a Paystack payment,
// and returns the Paystack checkout URL (M-Pesa or card).

import { PRICE_KES, TERMS_VERSION, json } from './tenders.js';

export async function onRequestPost({ request, env }) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'Invalid request.' }, 400); }

  if (data.accept_terms !== true) {
    return json({ ok: false, error: 'Please tick the box to confirm you will check every requirement against the official tender document.' }, 400);
  }
  const email = String(data.email || '').trim().toLowerCase().slice(0, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
  const phone = String(data.phone || '').replace(/[^\d+]/g, '').slice(0, 20) || null;

  const tender = await env.DB.prepare('SELECT id, title, ref, close_at FROM tenders WHERE id = ?')
    .bind(Number(data.tender_id) || 0).first();
  if (!tender) return json({ ok: false, error: 'Tender not found.' }, 404);
  if (new Date(tender.close_at.replace(' ', 'T') + '+03:00') < Date.now()) {
    return json({ ok: false, error: 'This tender has already closed.' }, 400);
  }

  const reference = 'bpt_' + crypto.randomUUID().replaceAll('-', '');
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO tender_orders (reference, tender_id, email, phone, amount_kes, status, terms_version, terms_at, ip, user_agent, created_at, insights_opt_in)
     VALUES (?, ?, ?, ?, ?, 'initiated', ?, ?, ?, ?, ?, ?)`
  ).bind(reference, tender.id, email, phone, PRICE_KES, TERMS_VERSION, now,
    request.headers.get('cf-connecting-ip'), (request.headers.get('user-agent') || '').slice(0, 300), now, data.insights_opt_in === true ? 1 : 0).run();

  const origin = new URL(request.url).origin;
  const res = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      amount: PRICE_KES * 100, // KES in cents
      currency: 'KES',
      reference,
      callback_url: `${origin}/tenders/order/?ref=${reference}`,
      metadata: { product: 'zabuni_prepare', tender_id: tender.id, tender_ref: tender.ref },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.data?.authorization_url) {
    await env.DB.prepare(`UPDATE tender_orders SET status = 'failed' WHERE reference = ?`).bind(reference).run();
    console.error('paystack init failed', res.status, body?.message);
    return json({ ok: false, error: 'Payment could not be started. Please try again in a minute.' }, 502);
  }
  return json({ ok: true, url: body.data.authorization_url });
}
