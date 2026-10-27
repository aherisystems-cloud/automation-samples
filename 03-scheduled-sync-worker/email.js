// Transactional email through Brevo (BREVO_API_KEY secret on this worker).
// Reminder copy for Zabuni Tender Kit buyers, plus an owner alert when a kit fails.

const SITE = 'https://biasharapros.com';
const FROM = { name: 'Biashara Pros', email: 'hello@biasharapros.com' };
const OWNER = 'hello@biasharapros.com';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Every outgoing email carries our address (Rita, 2026-10-21).
const ADDRESS = '<p style="font-size:12px;color:#888;margin-top:24px">Biashara Pros, Nairobi, Kenya</p>';

export async function sendEmail(env, { to, subject, html }) {
  if (!html.includes('Nairobi, Kenya')) html += ADDRESS;
  if (!env.BREVO_API_KEY) throw new Error('BREVO_API_KEY not set on bp-tenders');
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: FROM, replyTo: FROM, to: [{ email: to }], subject, htmlContent: html }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

const closeText = (close_at) =>
  new Date(close_at.replace(' ', 'T') + '+03:00').toLocaleString('en-KE', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi',
  });

// One message per reminder kind. r = reminder joined with order + tender.
export function reminderEmail(r) {
  const link = `${SITE}/tenders/order/?ref=${encodeURIComponent(r.reference)}`;
  const title = esc(r.title);
  const when = esc(closeText(r.close_at));
  const button = (label) => `<p style="margin:24px 0"><a href="${link}" style="background:#14532d;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${label}</a></p>`;
  const copy = {
    paid_receipt: {
      subject: `Payment received: your Zabuni Tender Kit is on its way`,
      body: `<p>Thank you for your payment of KES 799.</p>
        <p>We are reading the full tender document for <strong>${title}</strong> now. Your Zabuni Tender Kit is usually ready within a few minutes.</p>
        ${button('Open your Zabuni Tender Kit')}
        <p>Keep this email. The link above is your private access, and it works on any phone or computer.</p>
        <p>This tender closes on <strong>${when}</strong>. We will remind you 7 days, 3 days and 1 day before it closes.</p>`,
    },
    close_7d: {
      subject: `One week left: ${r.title.slice(0, 80)}`,
      body: `<p>The tender <strong>${title}</strong> closes on <strong>${when}</strong>.</p>
        <p>A week is enough time to fix anything still missing. Go through your kit and tick off each mandatory document. If a bank guarantee is needed for bid security, request it now: banks can take several days.</p>
        ${button('See what this tender requires')}`,
    },
    close_3d: {
      subject: `3 days left: ${r.title.slice(0, 80)}`,
      body: `<p>Three days until <strong>${title}</strong> closes on <strong>${when}</strong>.</p>
        <p>Time to put the bid together: fill, sign and stamp every form, number the pages, and check the binding and copies rules. Your kit lists the traps that get bids thrown out.</p>
        ${button('Check the disqualification traps')}`,
    },
    close_1d: {
      subject: `Closes tomorrow: ${r.title.slice(0, 80)}`,
      body: `<p><strong>${title}</strong> closes on <strong>${when}</strong>.</p>
        <p>Submit early. Confirm where and how to submit in your kit, and give yourself time for traffic or a slow portal. Late bids are not opened.</p>
        ${button('Confirm how to submit')}`,
    },
  }[r.kind];
  if (!copy) return null;
  return {
    to: r.email,
    subject: copy.subject,
    html: `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#1a1a1a;max-width:560px">
      ${copy.body}
      <p style="font-size:13px;color:#666;margin-top:32px">Always confirm every requirement against the official tender document and any addenda before you submit.
      You are getting this because you bought a Zabuni Tender Kit on biasharapros.com. Questions? Just reply to this email.</p>
      <p style="font-size:13px;color:#666">Biashara Pros, Nairobi</p></div>`,
  };
}

// Send reminders that are due, for paid orders on tenders still open.
// Marked sent only after Brevo accepts, so a failed send retries next run.
export async function sendDueReminders(env) {
  const now = new Date().toISOString();
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.kind, o.email, o.reference, t.title, t.close_at
     FROM tender_reminders r
     JOIN tender_orders o ON o.id = r.order_id AND o.status = 'paid'
     JOIN tenders t ON t.id = o.tender_id
     WHERE r.sent_at IS NULL AND r.due_at <= ? ORDER BY r.due_at LIMIT 20`
  ).bind(now).all();
  let sent = 0;
  for (const r of results) {
    const closed = new Date(r.close_at.replace(' ', 'T') + '+03:00') < Date.now();
    const mail = closed ? null : reminderEmail(r);
    try {
      if (mail) { await sendEmail(env, mail); sent++; }
      // Closed tender or unknown kind: mark done so it never sends late.
      await env.DB.prepare('UPDATE tender_reminders SET sent_at = ? WHERE id = ?').bind(new Date().toISOString(), r.id).run();
    } catch (err) {
      console.error('reminder failed', r.id, err);
    }
  }
  return { due: results.length, sent };
}

// Tell the owner a paid kit failed, so the buyer hears from us within a working day.
export async function alertOwner(env, tenderId, error) {
  const { results } = await env.DB.prepare(
    `SELECT email, reference FROM tender_orders WHERE tender_id = ? AND status = 'paid'`
  ).bind(tenderId).all();
  await sendEmail(env, {
    to: OWNER,
    subject: `Action needed: Zabuni Tender Kit failed for tender ${tenderId}`,
    html: `<p>The kit for tender ${tenderId} failed. Buyers were promised an email within one working day or a full refund.</p>
      <p>Error: ${esc(error)}</p>
      <p>Paid buyers:</p><ul>${results.map((o) => `<li>${esc(o.email)} (${esc(o.reference)})</li>`).join('')}</ul>
      <p>To retry after fixing the cause: UPDATE tender_checklists SET status = 'pending' WHERE tender_id = ${Number(tenderId)};</p>`,
  });
}
