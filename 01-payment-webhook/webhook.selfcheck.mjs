// Self-check for webhook.js with a fake D1 and a stubbed payment API.
// Run: node 01-payment-webhook/webhook.selfcheck.mjs
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { onRequestPost } from './webhook.js';
import { PRICE_KES } from './tenders.js';

const SECRET = 'test_secret';
const batches = [];
const order = { id: 1, tender_id: 7, status: 'initiated', reference: 'bpt_abc' };
const env = {
  PAYSTACK_SECRET_KEY: SECRET,
  DB: {
    prepare: (sql) => ({
      bind: () => ({
        first: async () => (sql.includes('tender_orders') ? order : { id: 7, close_at: '2099-01-01 10:00:00' }),
      }),
    }),
    batch: async (stmts) => batches.push(stmts.length),
  },
};
let verifyResult = { status: 'success', currency: 'KES', amount: PRICE_KES * 100 };
globalThis.fetch = async () => new Response(JSON.stringify({ data: verifyResult }), { status: 200 });

const send = (event, sig) => {
  const body = JSON.stringify(event);
  return onRequestPost({
    env,
    request: new Request('https://x/api/paystack/webhook', {
      method: 'POST', body,
      headers: { 'x-paystack-signature': sig ?? createHmac('sha512', SECRET).update(body).digest('hex') },
    }),
  });
};
const paid = { event: 'charge.success', data: { reference: 'bpt_abc' } };

assert.equal((await send(paid, 'forged')).status, 401, 'forged signature rejected');
assert.equal(batches.length, 0, 'nothing written on a forged call');

assert.equal((await send({ event: 'charge.success', data: { reference: 'other_123' } })).status, 200);
assert.equal(batches.length, 0, 'references from other products ignored');

verifyResult = { status: 'success', currency: 'KES', amount: 100 };
await send(paid);
assert.equal(batches.length, 0, 'wrong amount on server-side verify: not marked paid');

verifyResult = { status: 'success', currency: 'KES', amount: PRICE_KES * 100 };
assert.equal((await send(paid)).status, 200);
assert.equal(batches.length, 1, 'valid signature + verified amount: order marked paid in one batch');

console.log('webhook selfcheck: all passed');
