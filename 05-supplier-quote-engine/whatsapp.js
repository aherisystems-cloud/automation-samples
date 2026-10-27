// WhatsApp Business (Cloud API) alerts to businesses that chose WhatsApp (Rita, 2026-10-27; docs/WHATSAPP-API-SETUP.md).
// Only to businesses that opted in (claimed, contact_pref 'whatsapp'), never cold outreach. Uses the approved
// template 'quote_request'. Off until the secrets WHATSAPP_TOKEN and WHATSAPP_PHONE_ID are set on the worker:
// returns false and email stays the only channel.
const phone = (v) => { let d = String(v || '').replace(/\D/g, ''); if (d.startsWith('0')) d = `254${d.slice(1)}`; return /^254\d{9}$/.test(d) ? d : null; };

export async function quoteRequestWhatsApp(env, { to, business, ref, need, deadline, token }) {
  const num = phone(to);
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID || !num) return false;
  const r = await fetch(`https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST', headers: { authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: num, type: 'template', template: { name: 'quote_request', language: { code: 'en' }, components: [
      { type: 'body', parameters: [business, ref, need.slice(0, 120), deadline].map((text) => ({ type: 'text', text: String(text) })) },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: token }] },
    ] } }),
  });
  if (!r.ok) console.error('whatsapp', r.status, (await r.text()).slice(0, 200));
  return r.ok;
}
