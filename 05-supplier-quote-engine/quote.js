// GET  /api/quote?k=<recipient token>  -> the request a business was invited to quote (marks it opened).
// POST /api/quote (multipart form)     -> the business quotes (form and/or own attached quote) or declines.
// Signed and stamped is required when the request says so (organisation buyers): attach your own signed and
// stamped quote, or authorise ours with your stamp and signature (uploaded once, kept on the listing).
import { alertRita, esc, iso, parse, SITE, token } from './sourcing.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const num = (v) => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return String(v ?? '').trim() !== '' && Number.isFinite(n) && n >= 0 ? n : null; };
const IMG = /^image\/(jpeg|png|webp)$/;

async function load(env, k) {
  if (!/^[0-9a-f]{32}$/.test(String(k || ''))) return null;
  return env.DB.prepare(`SELECT r.id AS rid, r.status AS rstatus, r.listing_id, q.*, l.name AS biz, l.stamp_key, l.signature_key,
      l.contact_name, l.contact_role, COALESCE(l.contact_phone, l.phone) AS biz_phone
    FROM request_recipients r JOIN requests q ON q.id = r.request_id JOIN listings l ON l.id = r.listing_id WHERE r.token = ?`).bind(k).first();
}
// Quotes are accepted while the request is collecting or delivered. After the deadline they are LATE: held
// for the team to accept (added for the buyer) or reject (Rita, 2026-10-26).
const isOpen = (x) => ['collecting', 'delivered'].includes(x.status);
const isLate = (x) => Date.now() >= Date.parse(x.deadline_at);
const REPLIED = ['quoted', 'declined', 'late', 'late_rejected'];

export async function onRequestGet({ request, env }) {
  const x = await load(env, new URL(request.url).searchParams.get('k'));
  if (!x) return json({ ok: false, error: 'This link is not valid.' }, 404);
  if (x.rstatus === 'invited') await env.DB.prepare(`UPDATE request_recipients SET status = 'opened', opened_at = ? WHERE id = ?`).bind(iso(), x.rid).run();
  return json({ ok: true, open: isOpen(x), late: isLate(x), replied: REPLIED.includes(x.rstatus), business: x.biz,
    request: { ref: x.ref, need: x.need, answers: parse(x.answers, []), county: x.county, town: x.town, priority: x.priority,
      deadline_at: x.deadline_at, signed_needed: !!x.signed_needed, buyer_type: x.buyer_type, buyer_org: x.buyer_org },
    defaults: { name: x.contact_name || '', role: x.contact_role || '', phone: x.biz_phone || '', has_stamp: !!x.stamp_key, has_signature: !!x.signature_key } });
}

async function store(env, prefix, file, maxMb, types) {
  if (!file || typeof file === 'string' || !file.size) return null;
  if (file.size > maxMb * 1048576) throw new Error(`${file.name} is larger than ${maxMb} MB.`);
  if (!types.test(file.type)) throw new Error(`${file.name}: use ${types === IMG ? 'a JPG, PNG or WebP photo' : 'a PDF or photo'}.`);
  const key = `${prefix}/${token()}/${clip(file.name, 60).replace(/[^a-z0-9._-]/gi, '_') || 'file'}`;
  await env.UPLOADS.put(key, await file.arrayBuffer(), { metadata: { name: clip(file.name, 120), type: file.type } });
  return key;
}

export async function onRequestPost({ request, env }) {
  let f;
  try { f = await request.formData(); } catch { return json({ ok: false, error: 'Invalid form.' }, 400); }
  const x = await load(env, f.get('k'));
  if (!x) return json({ ok: false, error: 'This link is not valid.' }, 404);
  if (!isOpen(x)) return json({ ok: false, error: 'This request has closed. The buyer already has the quotes.' }, 400);
  if (REPLIED.includes(x.rstatus)) return json({ ok: false, error: 'You already replied to this request.' }, 400);
  const late = isLate(x);

  if (f.get('action') === 'decline') {
    await env.DB.prepare(`UPDATE request_recipients SET status = 'declined', decline_reason = ?, replied_at = ? WHERE id = ?`)
      .bind(clip(f.get('decline_reason'), 200) || 'No reason given', iso(), x.rid).run();
    return json({ ok: true, message: "Thank you. We have told the buyer you can't quote this one." });
  }

  try {
    const items = parse(f.get('items'), []).slice(0, 30).map((i) => ({ item: clip(i.item, 160), qty: num(i.qty) ?? 1, unit: clip(i.unit, 30), unit_price: num(i.unit_price) }))
      .filter((i) => i.item && i.unit_price != null);
    const vat = ['incl', 'excl', 'none'].includes(f.get('vat')) ? f.get('vat') : null;
    const delivery = num(f.get('delivery_cost')) || 0;
    let total = items.length ? items.reduce((s, i) => s + i.qty * i.unit_price, 0) + delivery : num(f.get('total'));
    if (total != null && vat === 'excl') total = Math.round(total * 1.16); // every total compares with VAT included
    const attachment = await store(env, 'q', f.get('attachment'), 10, /^(application\/pdf|image\/(jpeg|png|webp))$/);
    if (total == null && !attachment) throw new Error('Add your prices, or attach your own quote.');
    const photos = [];
    for (const p of f.getAll('photos').slice(0, 6)) { const k = await store(env, 'q', p, 3, IMG); if (k) photos.push(k); }
    const stampKey = (await store(env, 'stamp', f.get('stamp'), 2, IMG)) || x.stamp_key;
    const sigKey = (await store(env, 'sig', f.get('signature'), 2, IMG)) || x.signature_key;
    const authName = clip(f.get('authorised_name'), 120), authRole = clip(f.get('authorised_role'), 120);
    if (x.signed_needed && !attachment && !(stampKey && sigKey && authName)) throw new Error('This buyer needs a signed and stamped quote: attach yours, or add your stamp, signature and the name of the person authorising it.');
    if (stampKey !== x.stamp_key || sigKey !== x.signature_key)
      await env.DB.prepare(`UPDATE listings SET stamp_key = ?, signature_key = ? WHERE id = ?`).bind(stampKey, sigKey, x.listing_id).run();

    const answers = parse(x.answers, []);
    const checklist = parse(f.get('checklist'), []).filter((c) => Number.isInteger(c.i) && c.i < answers.length)
      .map((c) => ({ i: c.i, answer: ['meets', 'partly', 'cant'].includes(c.answer) ? c.answer : 'meets', note: clip(c.note, 200) }));
    const videos = clip(f.get('video_links'), 1000).split(/\s+/).filter((u) => /^https:\/\/\S+$/.test(u)).slice(0, 4);
    await env.DB.prepare(`INSERT INTO request_quotes (recipient_id, items, vat, delivery_cost, total_kes, lead_time, delivery_date, payment_terms,
        valid_until, warranty, checklist, pitch, alternative, photo_keys, video_links, attachment_key, authorised_name, authorised_role, contact_phone, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(x.rid, JSON.stringify(items), vat, delivery || null, total, clip(f.get('lead_time'), 120) || null, clip(f.get('delivery_date'), 20) || null,
        clip(f.get('payment_terms'), 200) || null, clip(f.get('valid_until'), 20) || null, clip(f.get('warranty'), 300) || null,
        JSON.stringify(checklist), clip(f.get('pitch'), 1500) || null, clip(f.get('alternative'), 800) || null, JSON.stringify(photos),
        JSON.stringify(videos), attachment, authName || null, authRole || null, clip(f.get('contact_phone'), 40) || null, iso()).run();
    await env.DB.prepare(`UPDATE request_recipients SET status = ?, late = ?, replied_at = ? WHERE id = ?`).bind(late ? 'late' : 'quoted', late ? 1 : 0, iso(), x.rid).run();
    if (late) {
      await alertRita(env, `LATE quote for ${x.ref} from ${x.biz}`, `<p>${esc(x.biz)} quoted after the deadline. Accept it (the buyer gets it) or reject it on <a href="${SITE}/admin/requests/">the dashboard</a>.</p>`);
      return json({ ok: true, message: 'Received after the deadline. Biashara Pros will decide whether to add it for the buyer, and we will tell you either way.' });
    }
    return json({ ok: true, message: 'Quote sent. The buyer gets all quotes together at the deadline, and we will tell you if you are chosen.' });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, 400);
  }
}
