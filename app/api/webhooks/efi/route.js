import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { adminClient } from '../../supabase';
import { executeFlow } from '../../flow-engine';
import { resolveOfficialSiteConnection } from '../../site-connection';

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

async function notifySitePayment(lead, charge, payment) {
  const url = String(process.env.EFI_SITE_PAYMENT_WEBHOOK_URL || '').replace(/\/$/, '');
  const secret = String(process.env.EFI_SITE_PAYMENT_WEBHOOK_SECRET || '');
  const orderId = lead?.order_context?.sourceOrderId;
  if (!url || !secret || !orderId) return { skipped: true };
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-efi-site-secret': secret }, body: JSON.stringify({ order_id: orderId, txid: charge.txid, payment }) });
  if (!response.ok) throw new Error(`Site de música respondeu ${response.status} ao confirmar o Pix Efí.`);
  return { delivered: true };
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
    // O payload recebido da Efí descreve somente o pagamento. Preserve os
    // metadados criados junto com a cobrança (em especial
    // `dispatch_like_asaas`), pois eles dizem se este Pix deve iniciar o
    // fluxo de entrega desde o primeiro card ou apenas retomar um card Pix.
    const originalPaymentPayload = charge.payment_payload || {};
    const { data: claimed } = await db.from('efi_pix_charges').update({
      status: 'paid',
      payment_payload: { ...originalPaymentPayload, efi_payment: payment },
      paid_at: now,
      updated_at: now,
    }).eq('txid', txid).eq('status', 'pending').select().maybeSingle();
    if (!claimed) { processed.push({ txid, duplicate: true }); continue; }
    // A confirmação do pedido no site é independente do canal de entrega.
    // Mesmo que o WhatsApp esteja em manutenção, o Pix Efí pago não pode
    // ficar como pendente no checkout do cliente.
    const { data: paymentLead } = await db.from('leads').select('*').eq('id', claimed.lead_id).eq('owner_id', claimed.owner_id).maybeSingle();
    let sitePayment = null;
    try { sitePayment = await notifySitePayment(paymentLead, claimed, payment); }
    catch (error) { console.error('[efi webhook] site payment status failed', { txid, error: error?.message || String(error) }); }
    const [{ data: lead }, { data: flow }] = await Promise.all([
      db.from('leads').select('*').eq('id', claimed.lead_id).eq('owner_id', claimed.owner_id).maybeSingle(),
      db.from('flows').select('*').eq('id', claimed.flow_id).eq('owner_id', claimed.owner_id).maybeSingle(),
    ]);
    // A confirmação financeira não pode depender da sessão do WhatsApp. Primeiro
    // transformamos o lead em um pagamento recuperável; se a conexão estiver
    // indisponível, o cron retoma pela conexão ativa assim que ela voltar.
    if (!lead) { processed.push({ txid, error: 'Lead do pagamento não encontrado.' }); continue; }
    const connection = await resolveOfficialSiteConnection(db, { connectionId: claimed.connection_id || lead.connection_id });
    const context = { ...(lead.order_context || {}), paid: true, efi_payment: payment, flow_execution: null };
    const leadValues = { status: 'in_progress', order_context: context, updated_at: now, ...(connection ? { connection_id: connection.id, provider: connection.provider } : {}) };
    const { data: paidLead, error: leadError } = await db.from('leads').update(leadValues).eq('id', lead.id).eq('owner_id', claimed.owner_id).select().single();
    if (leadError) { processed.push({ txid, error: leadError.message }); continue; }
    if (!flow || !connection || connection.status !== 'connected') {
      processed.push({ txid, queued: true, reason: 'WhatsApp indisponível; execução será retomada automaticamente.' });
      continue;
    }
    try {
      // Cobranças criadas pelo endpoint do site Efí carregam este marcador. Elas
      // devem iniciar o fluxo configurado em Disparos desde a entrada, exatamente
      // como um PAYMENT_APPROVED do Asaas. As cobranças antigas preservam o
      // comportamento de continuar após o card Pagamento confirmado.
      const startsPaymentFlow = originalPaymentPayload.dispatch_like_asaas === true;
      const audios = Array.isArray(paidLead.order_context?.preview_audios) ? paidLead.order_context.preview_audios : [];
      const result = await executeFlow({ db, flow, lead: paidLead, connection, audios, resumeAfterId: startsPaymentFlow ? null : claimed.node_id });
      processed.push({ txid, ok: true, site_payment: sitePayment, result });
    } catch (error) {
      console.error('[efi webhook] flow failed', { txid, lead_id: paidLead.id, error: error?.message || String(error) });
      processed.push({ txid, error: error?.message || 'Fluxo falhou.' });
    }
  }
  return NextResponse.json({ received: true, processed });
}
