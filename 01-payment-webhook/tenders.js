// Shared helpers for the paid tender checklist (KES 799 per tender).

export const PRICE_KES = 799;
export const TERMS_VERSION = '2026-10-09';

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Paystack: confirm a payment server-side; never trust the browser redirect alone.
export async function verifyPayment(env, reference) {
  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` },
  });
  const body = await res.json().catch(() => ({}));
  const d = body?.data;
  return Boolean(res.ok && d?.status === 'success' && d.currency === 'KES' && d.amount === PRICE_KES * 100);
}

// Mark an order paid (idempotent), queue the tender's checklist unless one is
// already ready or in progress, and schedule close-date reminders.
export async function markPaid(env, reference) {
  const now = new Date().toISOString();
  const order = await env.DB.prepare('SELECT * FROM tender_orders WHERE reference = ?').bind(reference).first();
  if (!order) return null;
  if (order.status === 'paid') return order;

  const tender = await env.DB.prepare('SELECT id, close_at FROM tenders WHERE id = ?').bind(order.tender_id).first();
  const closeUtc = new Date(tender.close_at.replace(' ', 'T') + '+03:00');
  // paid_receipt goes out on the worker's next run (within 5 min) with the private kit link.
  const reminders = [['paid_receipt', 0], ['close_7d', 7], ['close_3d', 3], ['close_1d', 1]]
    .map(([kind, d]) => [kind, d ? new Date(closeUtc - d * 86400e3) : new Date()])
    .filter(([kind, due]) => kind === 'paid_receipt' || due > Date.now());

  await env.DB.batch([
    env.DB.prepare(`UPDATE tender_orders SET status = 'paid', paid_at = ? WHERE id = ? AND status != 'paid'`).bind(now, order.id),
    env.DB.prepare(
      `INSERT INTO tender_checklists (tender_id, status, created_at, updated_at) VALUES (?, 'pending', ?, ?)
       ON CONFLICT (tender_id) DO UPDATE SET status = 'pending', updated_at = excluded.updated_at
       WHERE tender_checklists.status = 'failed'`
    ).bind(order.tender_id, now, now),
    ...reminders.map(([kind, due]) => env.DB.prepare(
      'INSERT OR IGNORE INTO tender_reminders (order_id, kind, due_at) VALUES (?, ?, ?)'
    ).bind(order.id, kind, due.toISOString())),
  ]);
  return { ...order, status: 'paid', paid_at: now };
}
