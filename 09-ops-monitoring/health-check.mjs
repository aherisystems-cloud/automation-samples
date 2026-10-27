// Daily health check for BiasharaPros (run by a cloud routine; alerts Rita if anything fails).
// Prints JSON { problems: [...], watch: [...] } and exits 1 when there are problems.
// Uses scripts/d1.mjs for D1 and the injected Cloudflare token for the Pages API.
// Usage: node scripts/health-check.mjs
import { q as query, ago } from './query-helper.mjs';

const SITE = process.env.SITE_URL || 'https://biasharapros.com';
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const problems = [];
const watch = [];

const q = (sql) => {
  try { return query(sql); }
  catch (e) { problems.push(`D1 query failed: ${String(e.stderr || e.message).slice(0, 200)}`); return null; }
};
const count = (sql) => q(sql)?.[0]?.n ?? 0;

// 1. Site and its own email key + database binding.
try {
  const home = await fetch(`${SITE}/`);
  if (!home.ok) problems.push(`Homepage returned HTTP ${home.status}`);
  const h = await fetch(`${SITE}/api/health`).then((r) => r.json()).catch(() => ({ d1: false, brevo: false }));
  if (!h.d1) problems.push('Website cannot reach the database (D1)');
  if (!h.brevo) problems.push('Website email (Brevo key on Pages) is not working: claim links, enquiries and alerts will not send');
} catch (e) { problems.push(`Site unreachable: ${e.message}`); }

// 2. Last production build.
try {
  const headers = process.env.CLOUDFLARE_API_TOKEN ? { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } : {};
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/pages/projects/biashara-professionals/deployments?env=production&per_page=1`, { headers }).then((x) => x.json());
  const d = r.result?.[0];
  if (!d) problems.push('Could not read the latest site build from Cloudflare');
  else {
    if (d.latest_stage?.status === 'failure') problems.push(`Latest site build failed (${d.created_on})`);
    const changed = count(`SELECT COUNT(*) n FROM listings WHERE MAX(COALESCE(claimed_at,''),COALESCE(removed_at,''),COALESCE(owner_edited_at,'')) > '${d.created_on}' AND MAX(COALESCE(claimed_at,''),COALESCE(removed_at,''),COALESCE(owner_edited_at,'')) < '${ago(6)}'`);
    if (changed) problems.push(`${changed} claimed/removed/edited listing(s) not live: no rebuild since ${d.created_on}`);
  }
} catch (e) { problems.push(`Cloudflare Pages API failed: ${e.message}`); }

// 3. Directory daily routine (03:00 UTC) touched listings in the last 26 hours.
if (q(`SELECT 1 FROM listings LIMIT 1`) && !count(`SELECT COUNT(*) n FROM listings WHERE updated_at > '${ago(26)}'`))
  problems.push('Directory daily routine: no listing added or updated in 26 hours (routine may have failed)');

// 4. CRM sync routine (4x daily): nothing should wait more than 6 hours.
const unsynced = count(`SELECT COUNT(*) n FROM submissions WHERE crm_synced_at IS NULL AND created_at < '${ago(6)}'`)
  + count(`SELECT COUNT(*) n FROM listing_inquiries WHERE crm_synced_at IS NULL AND created_at < '${ago(6)}'`)
  + count(`SELECT COUNT(*) n FROM listing_requests WHERE status IN ('unsent','review') AND created_at < '${ago(6)}'`)
  + count(`SELECT COUNT(*) n FROM listings WHERE status='claimed' AND crm_lead_id IS NOT NULL AND COALESCE(crm_synced_status,'') != 'claimed' AND claimed_at < '${ago(6)}'`);
if (unsynced) problems.push(`CRM sync: ${unsynced} item(s) waiting more than 6 hours (routine may have failed)`);

// 5. bp-tenders worker: tender sync every 6h, reminders every 5 min, kits.
if (!count(`SELECT COUNT(*) n FROM tenders WHERE synced_at > '${ago(8)}'`)) problems.push('Tender sync (bp-tenders worker) has not run in 8 hours');
const late = count(`SELECT COUNT(*) n FROM tender_reminders WHERE sent_at IS NULL AND due_at < '${ago(1)}'`);
if (late) problems.push(`${late} Tender Kit email(s) overdue: bp-tenders Brevo key or worker cron failing`);
const failed = count(`SELECT COUNT(*) n FROM tender_checklists WHERE status='failed' AND updated_at > '${ago(26)}'`);
if (failed) problems.push(`${failed} Tender Kit(s) failed to generate in the last day`);

// Outreach goal (Rita, 2026-10-19): 25 Email 1 sends a day; phone-only finds do not count.
const email1 = count(`SELECT COUNT(*) n FROM listings WHERE email IS NOT NULL AND contacted_at > '${ago(24)}'`);
if (email1 < 25) watch.push(`Outreach goal missed: ${email1}/25 Email 1 sent in the last 24 hours (see the directory routine's run summary)`);

const email2Late = count(`SELECT COUNT(*) n FROM listings WHERE status='unclaimed' AND email IS NOT NULL AND email2_at IS NULL AND unsubscribed_at IS NULL AND contacted_at < '${ago(24 * 5)}' AND id NOT IN (SELECT listing_id FROM listing_requests)`);
if (email2Late) watch.push(`${email2Late} business(es) a day or more past due for Email 2`);

// Watch list (not failures): claims nobody confirmed after 3 days.
const stale = q(`SELECT r.id, l.name FROM listing_requests r JOIN listings l ON l.id=r.listing_id WHERE r.status='pending' AND r.created_at < '${ago(72)}'`) || [];
for (const s of stale) watch.push(`Claim request #${s.id} (${s.name}) not confirmed after 3+ days: call them`);

console.log(JSON.stringify({ checked_at: new Date().toISOString(), problems, watch }, null, 1));
process.exit(problems.length ? 1 : 0);
