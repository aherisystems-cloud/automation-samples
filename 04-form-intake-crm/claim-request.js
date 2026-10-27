// POST /api/directory/request  {slug, action: 'claim'|'remove', email, name?, phone?, note?, consent}
// Claim: any work email is fine. We email a one-time link to that address; clicking it proves they
// control the inbox and claims the page straight away (confirm.js). A claim from an email other than
// the published one also notifies the published address and gives Rita a check task (CRM sync).
// Remove: needs the published email, otherwise Rita reviews it (stops a competitor deleting a listing).
// If our email service fails, the request is saved as 'unsent' and the CRM sync sends the link via Zoho.

import { sendEmail } from '../03-scheduled-sync-worker/email.js';
import { notifyOwner } from './notify.js';

const json = (body, status = 200) => Response.json(body, { status });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function onRequestPost({ request, env }) {
  let d;
  try { d = await request.json(); } catch { return json({ ok: false, error: 'Invalid request.' }, 400); }
  if (d.website_url) return json({ ok: true }); // honeypot

  const action = d.action === 'remove' ? 'remove' : d.action === 'claim' ? 'claim' : null;
  if (!action) return json({ ok: false, error: 'Choose claim or remove.' }, 400);
  if (!(d.consent === true || d.consent === 'on')) return json({ ok: false, error: 'Please tick the consent box so we can act on your request.' }, 400);
  const email = String(d.email || '').trim().toLowerCase().slice(0, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'Please enter a valid email address.' }, 400);

  const listing = await env.DB.prepare('SELECT id, slug, name, email, claimed_email, status FROM listings WHERE slug = ?').bind(String(d.slug || '')).first();
  if (!listing || listing.status === 'removed') return json({ ok: false, error: 'Listing not found.' }, 404);

  const matches = [listing.email, listing.claimed_email].some((address) => !!address && address.toLowerCase() === email);
  const needsReview = action === 'remove' && !matches;
  const token = crypto.randomUUID().replaceAll('-', '');
  const now = new Date().toISOString();
  const { meta } = await env.DB.prepare(
    `INSERT INTO listing_requests (listing_id, action, email, name, phone, note, token, status, consent_at, ip, created_at, role)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(listing.id, action, email, String(d.name || '').slice(0, 200) || null, String(d.phone || '').slice(0, 40) || null,
    String(d.note || '').slice(0, 1000) || null, token, needsReview ? 'review' : 'pending', now,
    request.headers.get('cf-connecting-ip'), now, String(d.role || '').slice(0, 120) || null).run();
  const id = meta.last_row_id;

  const origin = new URL(request.url).origin;
  const page = `${origin}/directory/b/${listing.slug}/`;
  const who = `${String(d.name || '').trim() || 'Someone'} (${email})`;

  if (needsReview) {
    await notifyOwner(env, `REVIEW: remove request for ${listing.name}`, [`${who} asked to remove this listing, but not from the email the business published. Check with the business before removing (request #${id}). A CRM task is created too.`], page);
    return json({ ok: true, review: true, message: 'Thank you. To protect the business, we check removal requests from other emails with them first. We reply within one working day.' });
  }

  const link = `${origin}/api/directory/confirm?id=${id}&t=${token}`;
  try {
    await sendEmail(env, {
      to: email,
      subject: action === 'claim' ? `Confirm: claim ${listing.name} on Biashara Pros` : `Confirm: remove ${listing.name} from Biashara Pros`,
      html: `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#1a1a1a;max-width:560px">
        <p>Someone asked to ${action} the Biashara Pros listing for <strong>${esc(listing.name)}</strong> using this email address.</p>
        <p style="margin:24px 0"><a href="${link}" style="background:#14532d;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Yes, ${action} this listing</a></p>
        ${action === 'claim' ? '<p>After you click, you go straight to a private page where you can add your phone, WhatsApp, website, hours and services.</p>' : ''}
        <p>If this was not you, ignore this email and nothing will change.</p>
        <p style="font-size:13px;color:#666">Biashara Pros, Nairobi. Reply to this email if you need help.</p></div>`,
    });
  } catch (err) {
    // Email service down: keep the request; the CRM sync sends the same link through Zoho.
    console.error('directory confirm email failed', err);
    await env.DB.prepare(`UPDATE listing_requests SET status = 'unsent' WHERE id = ?`).bind(id).run();
    await notifyOwner(env, `ACTION: confirm email failed for ${listing.name}`, [`${who} asked to ${action} this listing, but the confirmation email could not be sent. The CRM sync resends it through Zoho; you can also forward this link:`, link], page);
    return json({ ok: true, message: `Thank you. We are sending a confirmation link to ${email}. It can take a few hours to arrive; check your spam folder too.` });
  }
  await notifyOwner(env, `New ${action} request: ${listing.name}`, [`${who} asked to ${action} this listing${matches ? '' : ' (not the published email)'}. We emailed them a one-time link; you get another alert when they click it.`], page);
  return json({ ok: true, message: `Check ${email}: we sent a link to confirm. It works once.` });
}
