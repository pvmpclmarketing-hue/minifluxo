import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { adminClient } from '../../supabase';

export const runtime = 'nodejs';

function secretMatches(received) {
  const expected = String(process.env.HOTMART_HOTTOK || '');
  const actual = String(received || '');
  return Boolean(expected) && expected.length === actual.length && timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

function normaliseMexicoPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('52') && digits.length >= 12) return digits;
  return digits.length === 10 ? `52${digits}` : digits;
}

function purchaseFrom(payload) {
  // V2 é a versão recomendada. A leitura V1 mantém compatibilidade caso a
  // configuração antiga ainda exista no painel Hotmart.
  const data = payload?.data || {};
  const purchase = data.purchase || payload || {};
  const buyer = data.buyer || payload || {};
  const event = String(payload?.event || '');
  const transaction = String(purchase.transaction || payload?.transaction || '').trim();
  const sck = String(purchase?.origin?.sck || payload?.sck || '').trim();
  return {
    approved: event === 'PURCHASE_APPROVED' && String(purchase.status || payload?.status || '').toUpperCase() === 'APPROVED',
    event,
    transaction,
    sck,
    name: String(buyer.name || payload?.name || '').trim(),
    phone: normaliseMexicoPhone(buyer.checkout_phone || payload?.phone_checkout_number || payload?.phone_number),
    amount: purchase?.full_price?.value ?? purchase?.price?.value ?? payload?.full_price ?? payload?.price ?? null,
    currency: purchase?.full_price?.currency_value || purchase?.price?.currency_value || payload?.currency || 'MXN',
  };
}

export async function POST(request) {
  if (!secretMatches(request.headers.get('x-hotmart-hottok'))) return new NextResponse(null, { status: 401 });
  try {
    const payload = await request.json();
    const purchase = purchaseFrom(payload);
    if (!purchase.approved) return NextResponse.json({ received: true, ignored: true, event: purchase.event });
    if (!purchase.transaction || !purchase.sck) return NextResponse.json({ error: 'PURCHASE_APPROVED sem transaction ou origin.sck.' }, { status: 422 });

    const db = adminClient();
    const externalOrderId = `hotmart:${purchase.transaction}`;
    const { data: duplicate } = await db.from('leads').select('id,status').eq('external_order_id', externalOrderId).maybeSingle();
    if (duplicate) return NextResponse.json({ received: true, duplicate: true, execution_id: duplicate.id, status: duplicate.status });

    const { data: lead } = await db.from('leads').select('*').eq('external_order_id', `hotmart:pending:${purchase.sck}`).eq('status', 'waiting_payment').maybeSingle();
    if (!lead) return NextResponse.json({ error: 'Checkout Hotmart nao encontrado para este sck. Registre a letra antes de abrir o checkout.' }, { status: 422 });

    const phone = purchase.phone || lead.phone;
    if (!phone) return NextResponse.json({ error: 'A compra aprovada nao possui telefone para entrega.' }, { status: 422 });
    const context = {
      ...(lead.order_context || {}),
      paid: true,
      sourceOrderId: externalOrderId,
      hotmart: {
        ...(lead.order_context?.hotmart || {}),
        transaction: purchase.transaction,
        event: purchase.event,
        approved_at: new Date().toISOString(),
        amount: purchase.amount,
        currency: purchase.currency,
      },
    };
    const { data: claimed, error } = await db.from('leads').update({
      name: purchase.name || lead.name,
      phone,
      provider: 'hotmart',
      external_order_id: externalOrderId,
      order_context: context,
      status: 'in_progress',
      updated_at: new Date().toISOString(),
    }).eq('id', lead.id).eq('status', 'waiting_payment').select().maybeSingle();
    if (error) throw error;
    if (!claimed) return NextResponse.json({ received: true, duplicate: true, execution_id: lead.id });

    // O processador existente é a fonte única do disparo: aplica o template
    // oficial, aguarda a resposta do cliente e só então libera áudio/vídeo.
    const paymentResponse = await fetch(new URL('/api/webhooks/payment', request.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-payment-secret': String(process.env.PAYMENT_WEBHOOK_SECRET || '') },
      body: JSON.stringify({
        event: 'PAYMENT_APPROVED',
        order_id: externalOrderId,
        connection_id: claimed.connection_id,
        customer: { name: claimed.name, phone: claimed.phone },
        fulfillment: { mode: 'generate_music_in_miniflux' },
        quiz: context.quiz || {},
        story: context.story || '',
        lyric_text: context.lyricText || '',
        music_request: claimed.music_request || context.lyricText || '',
        idempotency_key: `hotmart:${purchase.transaction}`,
      }),
    });
    const result = await paymentResponse.json().catch(() => ({}));
    if (!paymentResponse.ok) throw new Error(result.error || `Processador de pagamento respondeu ${paymentResponse.status}.`);
    return NextResponse.json({ received: true, execution_id: claimed.id, hotmart_transaction: purchase.transaction, result });
  } catch (error) {
    console.error('[hotmart webhook] failed', { error: error?.message || String(error) });
    return NextResponse.json({ error: error?.message || 'Nao foi possivel processar a compra Hotmart.' }, { status: 500 });
  }
}
