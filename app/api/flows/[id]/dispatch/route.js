import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { adminClient } from '../../../supabase';
import { executeFlow } from '../../../flow-engine';

export const runtime = 'nodejs';

function authorized(request) {
  const expected = String(process.env.BULK_DISPATCH_SECRET || process.env.TEST_DISPATCH_SECRET || process.env.PAYMENT_WEBHOOK_SECRET || '');
  const received = String(request.headers.get('x-bulk-dispatch-secret') || '');
  return Boolean(expected) && expected.length === received.length && timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

// Rota operacional privada: cada chave de disparo só pode criar uma execução.
// Assim uma retomada do lote nunca repete uma oferta para o mesmo telefone.
export async function POST(request, { params }) {
  try {
    if (!authorized(request)) return new NextResponse(null, { status: 401 });
    const { id } = await params;
    const body = await request.json();
    const phone = String(body.phone || '').replace(/\D/g, '');
    const dispatchKey = String(body.dispatch_key || '').trim();
    if (!phone || !dispatchKey) return NextResponse.json({ error: 'Telefone e chave de disparo são obrigatórios.' }, { status: 400 });

    const db = adminClient();
    const { data: flow, error: flowError } = await db.from('flows').select('*').eq('id', id).eq('status', 'active').maybeSingle();
    if (flowError) throw flowError;
    if (!flow) return NextResponse.json({ error: 'Fluxo ativo não encontrado.' }, { status: 404 });

    const connectionId = String(body.connection_id || '').trim();
    const { data: connection, error: connectionError } = await db.from('connections').select('*').eq('id', connectionId).eq('owner_id', flow.owner_id).eq('status', 'connected').maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection) return NextResponse.json({ error: 'WhatsApp conectado não encontrado para este fluxo.' }, { status: 409 });

    const externalOrderId = `bulk:${flow.id}:${dispatchKey}`;
    const { data: prior, error: priorError } = await db.from('leads').select('id,status').eq('owner_id', flow.owner_id).eq('external_order_id', externalOrderId).maybeSingle();
    if (priorError) throw priorError;
    if (prior) return NextResponse.json({ received: true, already_dispatched: true, execution_id: prior.id, status: prior.status });

    const context = { contact_origin: 'bulk_dispatch', bulk_dispatch: { key: dispatchKey, sent_at: new Date().toISOString() }, flow_execution: { flow_id: flow.id } };
    const { data: lead, error: leadError } = await db.from('leads').insert({
      owner_id: flow.owner_id,
      name: String(body.name || 'Contato').trim().slice(0, 120) || 'Contato',
      phone,
      source: 'manual',
      status: 'in_progress',
      provider: connection.provider,
      connection_id: connection.id,
      external_order_id: externalOrderId,
      order_context: context,
    }).select().single();
    if (leadError) throw leadError;

    try {
      const result = await executeFlow({ db, flow, lead, connection });
      return NextResponse.json({ received: true, execution_id: lead.id, result });
    } catch (error) {
      await db.from('leads').update({
        status: 'delivery_failed',
        order_context: { ...context, flow_execution: { flow_id: flow.id, state: 'failed', error: error.message || String(error) }, delivery_error: error.message || String(error) },
        updated_at: new Date().toISOString(),
      }).eq('id', lead.id).eq('owner_id', flow.owner_id);
      throw error;
    }
  } catch (error) {
    console.error('[flow bulk dispatch] failed', { error: error?.message || String(error) });
    return NextResponse.json({ error: error.message || 'Não foi possível disparar o fluxo.' }, { status: 500 });
  }
}
