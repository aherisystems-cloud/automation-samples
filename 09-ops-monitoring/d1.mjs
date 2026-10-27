// Query D1 `biashara-intake` over the Cloudflare REST API (for cloud routines; local ones use wrangler).
// In the cloud the token is injected by the environment's "Bearer" secret for api.cloudflare.com, so no
// Authorization header is set here unless CLOUDFLARE_API_TOKEN exists (local testing).
// Usage: node d1.mjs "SELECT ..."     or     node d1.mjs --file path/to.sql
// Prints JSON: [{ results: [...], meta: {...} }, ...] (one entry per statement), same shape as wrangler --json.
import { readFileSync } from 'node:fs';

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const DB = process.env.D1_DATABASE_ID; // from wrangler.toml
const [flag, arg] = process.argv.slice(2);
const sql = flag === '--file' ? readFileSync(arg, 'utf8') : flag;
if (!sql) { console.error('usage: node d1.mjs "<SQL>" | --file <path>'); process.exit(1); }

const headers = { 'content-type': 'application/json' };
if (process.env.CLOUDFLARE_API_TOKEN) headers.authorization = `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`;
// Cloudflare throttles the D1 REST API (HTTP 429, seen 2026-10-21 when the brief ran): back off and retry.
let res;
for (let attempt = 0; ; attempt++) {
  res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DB}/query`, {
    method: 'POST', headers, body: JSON.stringify({ sql }),
  });
  if ((res.status !== 429 && res.status < 500) || attempt === 5) break;
  const wait = (Number(res.headers.get('retry-after')) || 2 ** attempt * 2) * 1000;
  console.error(`D1 HTTP ${res.status}, retrying in ${wait / 1000}s`);
  await new Promise((r) => setTimeout(r, wait));
}
const out = await res.json().catch(() => ({}));
if (!res.ok || !out.success) {
  console.error(`D1 error HTTP ${res.status}: ${JSON.stringify(out.errors || out).slice(0, 500)}`);
  if (res.status === 401 || res.status === 403) {
    // Shows whether a token arrives and its status (never the token itself).
    const v = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/tokens/verify`, { headers }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
    console.error('token check:', JSON.stringify(v.result || v.errors || v).slice(0, 300));
  }
  process.exit(1);
}
console.log(JSON.stringify(out.result, null, 1));
