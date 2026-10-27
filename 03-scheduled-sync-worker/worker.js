// bp-tenders: syncs PPIP (tenders.go.ke) active tenders into D1, and generates
// paid tender checklists (tender_checklists.status = 'pending') with Claude.

import { generateChecklist } from '../02-ai-document-analysis/checklist.js';
import { sendDueReminders, alertOwner, sendEmail, reminderEmail } from './email.js';
import { tick as sourcingTick, weeklyOwnerDigest } from '../05-supplier-quote-engine/sourcing.js';
// PPIP allows 60 requests/minute; we make ~1 request per page with a pause between.
// Keep only public tender fields. The API also returns officer personal data
// (ID numbers, phones, tokens): never copy it.

const PPIP = 'https://tenders.go.ke';
const PER_PAGE = 50;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${PPIP}/api/active-tenders?perpage=${PER_PAGE}&page=${page}`, {
      headers: { accept: 'application/json', 'user-agent': 'Biashara Pros tender board (hello@biasharapros.com)' },
    });
    if (res.status === 429) { await sleep((Number(res.headers.get('retry-after')) || 15) * 1000); continue; }
    if (!res.ok) throw new Error(`PPIP page ${page}: HTTP ${res.status}`);
    return res.json();
  }
  throw new Error(`PPIP page ${page}: rate limited`);
}

const abs = (u) => (u ? (u.startsWith('http') ? u : PPIP + u) : null);

export function toRow(t, now) {
  const docs = t.documents || [];
  const doc = (code) => abs(docs.find((d) => d.type?.code === code)?.url);
  return {
    source_id: String(t.id),
    pe_id: t.pe_id != null ? String(t.pe_id) : null,
    ref: t.tender_ref || null,
    title: String(t.title || '').trim(),
    entity: t.pe?.name || null,
    category: t.procurement_category?.title || null,
    method: t.procurement_method?.title || null,
    county_id: t.pe?.county_id ?? null,
    is_agpo: t.is_agpo || (t.agpo_groups || []).length ? 1 : 0,
    tender_fee: t.tender_fee ?? null,
    published_at: t.published_at || null,
    close_at: t.close_at || null,
    submission: (t.submission_methods || []).map((s) => s.title).join(', ') || null,
    doc_url: doc('tenderDocument'),
    notice_url: doc('tenderNotice'),
    addenda: JSON.stringify((t.addenda || []).map((a) => ({
      title: a.title, new_close: a.new_closing_date || null, doc_url: abs(a.documents?.[0]?.url),
    }))),
    synced_at: now,
  };
}

export async function syncTenders(env) {
  const now = new Date().toISOString();
  let page = 1, lastPage = 1, saved = 0;
  do {
    const body = await fetchPage(page);
    lastPage = body.last_page || 1;
    const rows = (body.data || []).map((t) => toRow(t, now)).filter((r) => r.title);
    if (rows.length) {
      await env.DB.batch(rows.map((r) => env.DB.prepare(
        `INSERT INTO tenders (source, source_id, pe_id, ref, title, entity, category, method, county_id, is_agpo,
           tender_fee, published_at, close_at, submission, doc_url, notice_url, addenda, synced_at)
         VALUES ('ppip', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (source, source_id) DO UPDATE SET
           pe_id=excluded.pe_id, ref=excluded.ref, title=excluded.title, entity=excluded.entity, category=excluded.category,
           method=excluded.method, county_id=excluded.county_id, is_agpo=excluded.is_agpo,
           tender_fee=excluded.tender_fee, published_at=excluded.published_at, close_at=excluded.close_at,
           submission=excluded.submission, doc_url=excluded.doc_url, notice_url=excluded.notice_url,
           addenda=excluded.addenda, synced_at=excluded.synced_at`
      ).bind(r.source_id, r.pe_id, r.ref, r.title, r.entity, r.category, r.method, r.county_id, r.is_agpo,
        r.tender_fee, r.published_at, r.close_at, r.submission, r.doc_url, r.notice_url, r.addenda, r.synced_at)));
      saved += rows.length;
    }
    page++;
    if (page <= lastPage) await sleep(1500);
  } while (page <= lastPage);
  return { saved, pages: lastPage };
}

// World Bank-financed procurement in Kenya, from the official open API.
// Notices carry the full notice text; the bidding document comes from the
// implementing agency, so paid analysis for these uses the upload path.
const WB = 'https://search.worldbank.org/api/v2/procnotices';
const WB_TYPES = new Set(['Invitation for Bids', 'Request for Expression of Interest', 'Invitation for Prequalification', 'Request for Quotations', 'Request for Proposals']);
const WB_GROUP = { GO: 'Goods', CW: 'Works', CS: 'Consultancy Services', NC: 'Non Consultancy Services', Goods: 'Goods', Works: 'Works', 'Consultant Services': 'Consultancy Services', 'Non-consulting Services': 'Non Consultancy Services' };
const stripHtml = (h) => String(h || '').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();

export async function syncWorldBank(env) {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const res = await fetch(`${WB}?format=json&project_ctry_name=Kenya&rows=200&srt=noticedate&order=desc`, {
    headers: { 'user-agent': 'Biashara Pros tender board (hello@biasharapros.com)' },
  });
  if (!res.ok) throw new Error(`World Bank API: HTTP ${res.status}`);
  const body = await res.json();
  const rows = (body.procnotices || [])
    .filter((n) => WB_TYPES.has(n.notice_type) && n.submission_deadline_date && n.submission_deadline_date.slice(0, 10) >= today)
    .map((n) => ({
      source_id: n.id,
      ref: n.bid_reference_no || null,
      title: String(n.bid_description || n.project_name || '').trim(),
      entity: n.contact_organization || n.project_name || null,
      category: WB_GROUP[n.procurement_group] || n.procurement_group || null,
      method: n.notice_type + (n.procurement_method_name ? ` (${n.procurement_method_name})` : ''),
      published_at: n.noticedate ? new Date(n.noticedate).toISOString().slice(0, 10) + ' 00:00:00' : null,
      close_at: `${n.submission_deadline_date.slice(0, 10)} ${/^\d{2}:\d{2}/.test(n.submission_deadline_time || '') ? n.submission_deadline_time.slice(0, 5) : '23:59'}:00`,
      notice_url: `https://projects.worldbank.org/en/projects-operations/procurement-detail/${n.id}`,
      description: stripHtml(n.notice_text).slice(0, 20000) || null,
      contact: [n.contact_name, n.contact_organization, n.contact_email, n.contact_phone_no].filter(Boolean).join(', ') || null,
    }))
    .filter((r) => r.title);
  if (rows.length) {
    await env.DB.batch(rows.map((r) => env.DB.prepare(
      `INSERT INTO tenders (source, source_id, ref, title, entity, category, method, published_at, close_at, notice_url, description, contact, submission, synced_at)
       VALUES ('worldbank', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'See notice', ?)
       ON CONFLICT (source, source_id) DO UPDATE SET ref=excluded.ref, title=excluded.title, entity=excluded.entity,
         category=excluded.category, method=excluded.method, close_at=excluded.close_at, notice_url=excluded.notice_url,
         description=excluded.description, contact=excluded.contact, synced_at=excluded.synced_at`
    ).bind(r.source_id, r.ref, r.title, r.entity, r.category, r.method, r.published_at, r.close_at, r.notice_url, r.description, r.contact, now)));
  }
  return { saved: rows.length };
}

// Generate at most one pending checklist per run (each takes a few minutes).
export async function processPending(env) {
  const job = await env.DB.prepare(
    `SELECT t.* FROM tender_checklists c JOIN tenders t ON t.id = c.tender_id
     WHERE c.status = 'pending' ORDER BY c.created_at LIMIT 1`
  ).first();
  if (!job) return { processed: 0 };
  const now = () => new Date().toISOString();
  // Claim it so an overlapping run doesn't start the same job.
  const claimed = await env.DB.prepare(
    `UPDATE tender_checklists SET status = 'working', updated_at = ? WHERE tender_id = ? AND status = 'pending'`
  ).bind(now(), job.id).run();
  if (!claimed.meta.changes) return { processed: 0 };
  try {
    const { checklist, model, usage } = await generateChecklist(env, job);
    await env.DB.prepare(
      `UPDATE tender_checklists SET status = 'ready', checklist = ?, model = ?, addenda_hash = ?, error = NULL, updated_at = ?
       WHERE tender_id = ?`
    ).bind(JSON.stringify(checklist), model, job.addenda, now(), job.id).run();
    console.log('checklist ready', job.id, JSON.stringify(usage));
    return { processed: 1, tender_id: job.id, usage };
  } catch (err) {
    await env.DB.prepare(
      `UPDATE tender_checklists SET status = 'failed', error = ?, updated_at = ? WHERE tender_id = ?`
    ).bind(String(err?.message || err).slice(0, 500), now(), job.id).run();
    console.error('checklist failed', job.id, err);
    await alertOwner(env, job.id, String(err?.message || err).slice(0, 500)).catch((e) => console.error('alert failed', e));
    return { processed: 0, tender_id: job.id, error: String(err?.message || err) };
  }
}

export default {
  async scheduled(event, env, ctx) {
    if (event.cron === '15 */6 * * *') {
      ctx.waitUntil(syncTenders(env).then((r) => console.log('ppip', r)));
      ctx.waitUntil(syncWorldBank(env).then((r) => console.log('worldbank', r)));
      // Monday 06:15 UTC run: weekly email to claimed owners.
      ctx.waitUntil(weeklyOwnerDigest(env).then((r) => r.sent != null && console.log('owner digest', r)).catch((e) => console.error('digest', e)));
    }
    else {
      ctx.waitUntil(processPending(env));
      ctx.waitUntil(sendDueReminders(env).then((r) => r.due && console.log('reminders', r)));
      // Quote requests: deadlines, reminders, buyer follow-ups, result emails, verification renewals.
      ctx.waitUntil(sourcingTick(env).catch((e) => console.error('sourcing tick', e)));
    }
  },
  // Manual triggers for testing (key-protected):
  //   /sync?key=K            run the PPIP sync now
  //   /generate?key=K&t=ID   queue + generate the checklist for tender ID now
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!env.SYNC_KEY || url.searchParams.get('key') !== env.SYNC_KEY) return new Response('Not found', { status: 404 });
    // /digest-test?key=K  send the weekly owner email for the hidden test listing (goes to hello@).
    if (url.pathname === '/digest-test') return Response.json(await weeklyOwnerDigest(env, { slug: 'bp-test-supplier' }));
    // /email-test?key=K  send one of each reminder, using the latest paid order's tender, to the owner only.
    if (url.pathname === '/email-test') {
      const r = await env.DB.prepare(
        `SELECT o.reference, t.title, t.close_at FROM tender_orders o JOIN tenders t ON t.id = o.tender_id
         WHERE o.status = 'paid' ORDER BY o.id DESC LIMIT 1`
      ).first();
      const kinds = ['paid_receipt', 'close_7d', 'close_3d', 'close_1d'];
      for (const kind of kinds) await sendEmail(env, reminderEmail({ ...r, kind, email: 'hello@biasharapros.com' }));
      return Response.json({ sent: kinds });
    }
    if (url.pathname === '/sync') return Response.json({ ppip: await syncTenders(env), worldbank: await syncWorldBank(env) });
    if (url.pathname === '/generate') {
      const t = Number(url.searchParams.get('t'));
      const ts = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO tender_checklists (tender_id, status, created_at, updated_at) VALUES (?, 'pending', ?, ?)
         ON CONFLICT (tender_id) DO UPDATE SET status = 'pending', updated_at = excluded.updated_at`
      ).bind(t, ts, ts).run();
      return Response.json(await processPending(env));
    }
    return new Response('Not found', { status: 404 });
  },
};
