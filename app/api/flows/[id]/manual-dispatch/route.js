import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../../../supabase';
import { executeFlow } from '../../../flow-engine';

export const runtime = 'nodejs';

export async function POST(request, { params }) {
  let lead = null;
  let flow = null;
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = await request.json();
    const phone = String(body.phone || '').replace(/\D/g, '');
    const name = String(body.name || 'Contato manual').trim().slice(0, 120) || 'Contato manual';
    const connectionId = String(body.connection_id || '').trim();
    const requestId = String(body.request_id || '').trim();

    if (phone.length < 10 || phone.length > 15) {
      return NextResponse.json({ error: 'Informe um número de WhatsApp com DDI válido.' }, { status: 400 });
    }
    if (!connectionId) return NextResponse.json({ error: 'Selecione uma conexão de WhatsApp.' }, { status: 400 });
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) return NextResponse.json({ error: 'Não foi possível validar esta tentativa. Tente novamente.' }, { status: 400 });

    const db = adminClient();
    const { data: selectedFlow, error: flowError } = await db.from('flows').select('*').eq('id', id).eq('owner_id', user.id).eq('status', 'active').maybeSingle();
    if (flowError) throw flowError;
    if (!selectedFlow) return NextResponse.json({ error: 'Fluxo ativo não encontrado na sua conta.' }, { status: 404 });
    flow = selectedFlow;
    if (!Array.isArray(flow.nodes) || flow.nodes.length === 0) return NextResponse.json({ error: 'Este fluxo ainda não tem etapas para executar.' }, { status: 409 });

    const { data: connection, error: connectionError } = await db.from('connections').select('*').eq('id', connectionId).eq('owner_id', user.id).eq('status', 'connected').maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection) return NextResponse.json({ error: 'A conexão selecionada não está conectada à sua conta.' }, { status: 409 });

    const externalOrderId = `manual:${id}:${requestId}`;
    const { data: priorExecution, error: priorExecutionError } = await db.from('leads').select('id,status').eq('owner_id', user.id).eq('external_order_id', externalOrderId).maybeSingle();
    if (priorExecutionError) throw priorExecutionError;
    if (priorExecution) return NextResponse.json({ execution_id: priorExecution.id, status: priorExecution.status, duplicate: true });
    const orderContext = {
      contact_origin: 'manual_dispatch',
      manual_dispatch: { request_id: requestId, started_at: new Date().toISOString() },
      flow_execution: { flow_id: id },
    };
    const { data: inserted, error: insertError } = await db.from('leads').insert({
      owner_id: user.id,
      name,
      phone,
      source: 'manual',
      status: 'in_progress',
      provider: connection.provider,
      connection_id: connection.id,
      external_order_id: externalOrderId,
      order_context: orderContext,
    }).select().single();

    if (insertError?.code === '23505') {
      const { data: existing, error: lookupError } = await db.from('leads').select('id,status').eq('owner_id', user.id).eq('external_order_id', externalOrderId).maybeSingle();
      if (lookupError) throw lookupError;
      if (existing) return NextResponse.json({ execution_id: existing.id, status: existing.status, duplicate: true });
    }
    if (insertError) throw insertError;
    lead = inserted;

    try {
      const result = await executeFlow({ db, flow, lead, connection });
      return NextResponse.json({ execution_id: lead.id, status: result.waiting ? 'waiting' : result.completed ? 'completed' : 'in_progress', result }, { status: 201 });
    } catch (error) {
      const message = error?.message || 'Falha ao iniciar o fluxo.';
      await db.from('leads').update({
        status: 'delivery_failed',
        order_context: { ...orderContext, flow_execution: { flow_id: id, state: 'failed', error: message }, delivery_error: message, manual_dispatch: { ...orderContext.manual_dispatch, failed_at: new Date().toISOString() } },
        updated_at: new Date().toISOString(),
      }).eq('id', lead.id).eq('owner_id', user.id);
      throw error;
    }
  } catch (error) {
    console.error('[manual flow dispatch] failed', { flow_id: flow?.id || null, lead_id: lead?.id || null, error: error?.message || String(error) });
    const status = error?.message === 'Não autenticado' ? 401 : lead ? 502 : 500;
    return NextResponse.json({ error: error?.message || 'Não foi possível iniciar o fluxo.', execution_id: lead?.id || null }, { status });
  }
}
