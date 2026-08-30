import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { adminClient } from '../../supabase';
import { executeFlow } from '../../flow-engine';

export const runtime = 'nodejs';

function secretMatches(received) {
  const expected = process.env.EFI_WEBHOOK_RELAY_SECRET || '';
  const actual = String(received || '');
  if (!expected || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function paymentsFrom(payload) {
  if (Array.isArray(payload?.pix)) return payload.pix;
  if (payload?.txid) return [payload];
  return [];
}

export async function POST(request) {
  if (!secretMatches(request.headers.get('x-efi-relay-secret'))) return new NextResponse(null, { status: 401 });
  let payload;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 }); }
  const db = adminClient();
  const processed = [];
  for (const payment of paymentsFrom(payload)) {
    const txid = String(payment?.txid || '').trim();
    if (!txid) continue;
    const { data: charge } = await db.from('efi_pix_charges').select('*').eq('txid', txid).eq('status', 'pending').maybeSingle();
    if (!charge) { processed.push({ txid, ignored: true }); continue; }
    const now = new Date().toISOString();
    const { data: claimed } = await db.from('efi_pix_charges').update({ status: 'paid', payment_payload: payment, paid_at: now, updated_at: now }).eq('txid', txid).eq('status', 'pending').select().maybeSingle();
    if (!claimed) { processed.push({ txid, duplicate: true }); continue; }
    const [{ data: lead }, { data: flow }, { data: connection }] = await Promise.all([
      db.from('leads').select('*').eq('id', claimed.lead_id).eq('owner_id', claimed.owner_id).eq('connection_id', claimed.connection_id).maybeSingle(),
      db.from('flows').select('*').eq('id', claimed.flow_id).eq('owner_id', claimed.owner_id).maybeSingle(),
      db.from('connections').select('*').eq('id', claimed.connection_id).eq('owner_id', claimed.owner_id).maybeSingle(),
    ]);
    if (!lead || !flow || !connection || connection.status !== 'connected') { processed.push({ txid, error: 'Execução não disponível.' }); continue; }
    const context = { ...(lead.order_context || {}), paid: true, efi_payment: payment, flow_execution: null };
    const { data: paidLead, error: leadError } = await db.from('leads').update({ status: 'in_progress', order_context: context, updated_at: now }).eq('id', lead.id).eq('owner_id', claimed.owner_id).eq('connection_id', claimed.connection_id).select().single();
    if (leadError) { processed.push({ txid, error: leadError.message }); continue; }
    try {
      const result = await executeFlow({ db, flow, lead: paidLead, connection, resumeAfterId: claimed.node_id });
      processed.push({ txid, ok: true, result });
    } catch (error) {
      console.error('[efi webhook] flow failed', { txid, lead_id: paidLead.id, error: error?.message || String(error) });
      processed.push({ txid, error: error?.message || 'Fluxo falhou.' });
    }
  }
  return NextResponse.json({ received: true, processed });
}
