// Owner alerts for directory claim/remove activity, so no request waits unseen (incident
// 2026-10-15: the confirm email failed and nobody knew). Never throws: D1 stays the record,
// and the hourly bp-crm-sync routine retries and logs to the CRM if this email fails too.
import { sendEmail } from '../03-scheduled-sync-worker/email.js';

const OWNER = 'hello@biasharapros.com';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function notifyOwner(env, subject, lines, link) {
  try {
    await sendEmail(env, {
      to: OWNER,
      subject,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">${lines.map((l) => `<p>${esc(l)}</p>`).join('')}${link ? `<p><a href="${esc(link)}">${esc(link)}</a></p>` : ''}</div>`,
    });
  } catch (err) { console.error('owner alert failed', err); }
}
