import { randomUUID, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { adminClient } from '../../../supabase';
import { executeFlow } from '../../../flow-engine';

export const runtime = 'nodejs';

function authorized(request) {
  const expected = String(process.env.TEST_DISPATCH_SECRET || process.env.PAYMENT_WEBHOOK_SECRET || '');
  const received = String(request.headers.get('x-test-dispatch-secret') || '');
  return Boolean(expected) && expected.length === received.length && timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

// Endpoint operacional para disparos internos de teste. Ele não simula o
// provedor: executa o mesmo motor e a mesma conexão WhatsApp do fluxo ativo.
export async function POST(request, { params }) {
  try {
    if (!authorized(request)) return new NextResponse(null, { status: 401 });
    const { id } = await params;
    const body = await request.json();
    const phone = String(body.phone || '').replace(/\D/g, '');
    if (!phone) return NextResponse.json({ error: 'Informe um telefone para o teste.' }, { status: 400 });

    const db = adminClient();
    const { data: flow, error: flowError } = await db.from('flows').select('*').eq('id', id).eq('status', 'active').maybeSingle();
    if (flowError) throw flowError;
    if (!flow) return NextResponse.json({ error: 'Fluxo ativo não encontrado.' }, { status: 404 });

    const connectionId = String(body.connection_id || '').trim();
    if (!connectionId) return NextResponse.json({ error: 'Informe a conexão do WhatsApp para o teste.' }, { status: 400 });
    const { data: connection, error: connectionError } = await db.from('connections').select('*').eq('id', connectionId).eq('owner_id', flow.owner_id).eq('status', 'connected').maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection) return NextResponse.json({ error: 'WhatsApp conectado não encontrado para este fluxo.' }, { status: 409 });

    const { data: lead, error: leadError } = await db.from('leads').insert({
      owner_id: flow.owner_id,
      name: String(body.name || 'Teste do fluxo').trim().slice(0, 120) || 'Teste do fluxo',
      phone,
      source: 'manual',
      status: 'in_progress',
      provider: connection.provider,
      connection_id: connection.id,
      external_order_id: `test:${flow.id}:${randomUUID()}`,
      order_context: { test_dispatch: true, flow_execution: { flow_id: flow.id } },
    }).select().single();
    if (leadError) throw leadError;

    try {
      const result = await executeFlow({ db, flow, lead, connection });
      return NextResponse.json({ received: true, execution_id: lead.id, result });
    } catch (error) {
      await db.from('leads').update({
        status: 'delivery_failed',
        order_context: { test_dispatch: true, flow_execution: { flow_id: flow.id, state: 'failed', error: error.message || String(error) }, delivery_error: error.message || String(error) },
        updated_at: new Date().toISOString(),
      }).eq('id', lead.id).eq('owner_id', flow.owner_id);
      throw error;
    }
  } catch (error) {
    console.error('[flow test dispatch] failed', { error: error?.message || String(error) });
    return NextResponse.json({ error: error.message || 'Não foi possível executar o teste.' }, { status: 500 });
  }
}
