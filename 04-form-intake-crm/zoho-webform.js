// Forwards a stored submission to the Zoho CRM web form ("BP Website Intake",
// Leads module, Aheri Systems org). The web form gives us CRM's auto-reply and
// owner notification. D1 stays the source of truth: if Zoho fails, the
// submission is still saved and the visitor still sees success.
//
// To enable: paste the values from CRM > Setup > Webforms > (form) > embed
// code into WEBFORM below. `fields` maps our keys to the form's input names
// exactly as they appear in that embed code.

const WEBFORM = null;
// Example shape once the form exists:
// const WEBFORM = {
//   url: 'https://crm.zoho.com/crm/WebToLeadForm',
//   hidden: { xnQsjsdp: '...', xmIwtLD: '...', actionType: 'TGVhZHM=', returnURL: 'https://biasharapros.com/' },
//   fields: { lastName: 'Last Name', company: 'Company', email: 'Email', mobile: 'Mobile',
//             inquiryType: 'LEADCF...', summary: 'LEADCF...', location: 'LEADCF...',
//             marketingConsent: 'LEADCF...' },
// };

const LABELS = {
  newsletter: 'Weekly briefing signup',
  partner: 'Partner application',
  event: 'Event listing',
  story: 'Founder story',
  'case-study': 'Founder story',
  'directory-listing': 'Directory listing',
  'advisor-match': 'Advisor match request',
  sourcing: 'Supplier sourcing request',
  'brs-order': 'Supplier registration check',
  'invoice-lead': 'Invoice tool: deadline reminders',
};

export async function forwardToZoho(data) {
  if (!WEBFORM) return;
  const f = WEBFORM.fields;
  const summary = Object.entries(data)
    .filter(([k]) => !['form', 'consent', 'website_url'].includes(k))
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const body = new URLSearchParams(WEBFORM.hidden);
  const set = (key, value) => f[key] && value && body.set(f[key], String(value).slice(0, 2000));
  set('lastName', data.name || data.business || data.firm || data.organiser || 'Website visitor');
  set('company', data.business || data.firm || data.organiser || data.supplier);
  set('email', data.email);
  set('mobile', data.phone);
  set('inquiryType', LABELS[data.form] || data.form);
  set('summary', summary);
  set('location', data.county);
  if (data.form === 'newsletter' || data.form === 'invoice-lead') set('marketingConsent', 'on');
  try {
    await fetch(WEBFORM.url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'manual',
    });
  } catch (err) {
    console.error('Zoho forward failed', err);
  }
}
