// POST /api/paystack/webhook  (set as the Webhook URL in the Paystack dashboard)
// Verifies Paystack's HMAC-SHA512 signature, then re-verifies the payment via
// the API before marking the order paid.

import { markPaid, verifyPayment } from './tenders.js';

async function hmacHex(secret, body) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }) {
  const body = await request.text();
  const sig = request.headers.get('x-paystack-signature') || '';
  if (!env.PAYSTACK_SECRET_KEY || sig !== await hmacHex(env.PAYSTACK_SECRET_KEY, body)) {
    return new Response('Invalid signature', { status: 401 });
  }
  const event = JSON.parse(body);
  const reference = event?.data?.reference;
  if (event.event === 'charge.success' && reference?.startsWith('bpt_') && await verifyPayment(env, reference)) {
    await markPaid(env, reference);
  }
  return new Response('ok');
}
