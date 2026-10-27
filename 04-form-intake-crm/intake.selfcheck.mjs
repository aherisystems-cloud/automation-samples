// ponytail: self-check for functions/api/submit.js with a fake D1.
// Run: node 04-form-intake-crm/intake.selfcheck.mjs
import assert from 'node:assert/strict';
import { onRequestPost } from './submit.js';

const rows = [];
const env = { DB: { prepare: () => ({ bind: (...a) => ({ run: async () => rows.push(a) }) }) } };
const post = (body) =>
  onRequestPost({
    env,
    request: new Request('https://x/api/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4' },
      body: JSON.stringify(body),
    }),
  }).then(async (r) => ({ status: r.status, ...(await r.json()) }));

let r = await post({ form: 'newsletter', email: 'a@b.co', consent: 'on' });
assert.equal(r.ok, true); assert.equal(rows.length, 1); assert.equal(rows[0][0], 'newsletter');

r = await post({ form: 'newsletter', email: 'a@b.co' });
assert.equal(r.status, 400, 'consent required');

r = await post({ form: 'hack', email: 'a@b.co', consent: 'on' });
assert.equal(r.status, 400, 'unknown form rejected');

r = await post({ form: 'sourcing', consent: 'on', name: 'x' });
assert.equal(r.status, 400, 'needs email or phone');

r = await post({ form: 'newsletter', email: 'not-an-email', consent: 'on' });
assert.equal(r.status, 400, 'bad email rejected');

const before = rows.length;
r = await post({ form: 'newsletter', email: 'a@b.co', consent: 'on', website_url: 'spam' });
assert.equal(r.ok, true); assert.equal(rows.length, before, 'honeypot silently dropped');

r = await post({ form: 'partner', phone: '0700', consent: 'on', name: 'N', extra: 'y' });
assert.equal(r.ok, true); assert.ok(!JSON.parse(rows.at(-1)[3 + 1]).website_url);

console.log('All intake self-checks passed.');
