// Shared D1 query helper for scripts: runs scripts/d1.mjs (works in the cloud routines and locally
// with CLOUDFLARE_API_TOKEN set, e.g. CLOUDFLARE_API_TOKEN=$(npx wrangler auth token)). Returns rows; throws on error.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const D1 = fileURLToPath(new URL('./d1.mjs', import.meta.url));
export const q = (sql) => JSON.parse(execFileSync('node', [D1, sql.replace(/\s+/g, ' ')], { encoding: 'utf8' }))[0].results;
export const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
