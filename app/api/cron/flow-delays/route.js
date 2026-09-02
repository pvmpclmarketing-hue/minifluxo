import { NextResponse } from 'next/server';
import { adminClient } from '../../supabase';
import { executeFlow, recoverKieGeneration, retryKieDelivery } from '../../flow-engine';

export async function POST(request) {
  if (!process.env.DELAY_CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.DELAY_CRON_SECRET}`) return new NextResponse(null, { status: 401 });
  const db = adminClient();
  const now = Date.now();
  const timeoutHours = Math.max(1, Number(process.env.FLOW_EXECUTION_TIMEOUT_HOURS || 24));
  const timeoutAt = new Date(now - timeoutHours * 60 * 60 * 1000).toISOString();
  // Estas etapas deveriam avançar sem uma nova ação do cliente. Se ficarem presas,
  // encerramos somente esta execução para que ela nunca volte a enviar mensagens depois.
  const { data: expired, error: expireError } = await db.from('leads').update({ status: 'timed_out', updated_at: new Date().toISOString() }).in('status', ['in_progress', 'generating', 'delivering', 'delivery_failed', 'waiting_response', 'waiting_payment', 'waiting_pix', 'waiting_delay']).lt('updated_at', timeoutAt).select('id');
  if (expireError) return NextResponse.json({ error: expireError.message }, { status: 500 });
  const { data: pending, error } = await db.from('leads').select('*').eq('status', 'waiting_delay').limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let resumed = 0; let recoveredKie = 0; let stopped = expired?.length || 0;
  for (const item of pending || []) {
    const execution = item.order_context?.flow_execution;
    if (!execution?.delay_node_id || !execution.resume_at || Date.parse(execution.resume_at) > now) continue;
    if (Date.parse(execution.resume_at) < Date.parse(timeoutAt)) {
      const { data: stoppedLead } = await db.from('leads').update({ status: 'timed_out', updated_at: new Date().toISOString() }).eq('id', item.id).eq('status', 'waiting_delay').select('id').maybeSingle();
      if (stoppedLead) stopped += 1;
      continue;
    }
    const { data: lead } = await db.from('leads').update({ status: 'in_progress', updated_at: new Date().toISOString() }).eq('id', item.id).eq('status', 'waiting_delay').select().maybeSingle();
    if (!lead) continue;
    try {
      const { data: flow } = await db.from('flows').select('*').eq('id', execution.flow_id).eq('owner_id', lead.owner_id).maybeSingle();
      const { data: connection } = await db.from('connections').select('*').eq('id', lead.connection_id).eq('owner_id', lead.owner_id).maybeSingle();
      if (!flow?.status || !connection || connection.status !== 'connected') throw new Error('Fluxo ou WhatsApp indisponivel para continuar o delay.');
      await executeFlow({ db, flow, lead, connection, resumeAfterId: execution.delay_node_id });
      resumed += 1;
    } catch (resumeError) {
      console.error('[flow delay] failed', { leadId: lead.id, error: resumeError.message });
      await db.from('leads').update({ status: 'waiting_delay', updated_at: new Date().toISOString() }).eq('id', lead.id);
    }
  }
  // A Kie pode concluir a geração sem que o callback chegue. Consultamos apenas
  // tarefas que já aguardam há dois minutos e retomamos exatamente o mesmo lead.
  const staleAt = new Date(now - 2 * 60 * 1000).toISOString();
  const { data: generating, error: generatingError } = await db.from('leads').select('*').eq('status', 'generating').lt('updated_at', staleAt).limit(25);
  if (generatingError) return NextResponse.json({ error: generatingError.message }, { status: 500 });
  for (const item of generating || []) {
    try {
      const result = await recoverKieGeneration({ db, lead: item });
      if (result.completed || result.waitingKie === false) recoveredKie += 1;
    } catch (recoverError) {
      console.error('[kie recovery] failed', { leadId: item.id, error: recoverError.message });
    }
  }
  // Uma URL temporária de áudio também pode expirar durante o envio. Tentamos
  // recuperar cada entrega falha uma única vez, respeitando as faixas já enviadas.
  let recoveredDelivery = 0;
  const { data: failedDeliveries, error: failedError } = await db.from('leads').select('*').eq('status', 'delivery_failed').limit(25);
  if (failedError) return NextResponse.json({ error: failedError.message }, { status: 500 });
  for (const item of failedDeliveries || []) {
    const recovery = item.order_context?.delivery_recovery || {};
    if (Number(recovery.retry_attempts || 0) >= 1) continue;
    const execution = item.order_context?.flow_execution;
    try {
      const [{ data: flow }, { data: connection }] = await Promise.all([
        db.from('flows').select('*').eq('id', execution?.flow_id).eq('owner_id', item.owner_id).eq('status', 'active').maybeSingle(),
        db.from('connections').select('*').eq('id', item.connection_id).eq('owner_id', item.owner_id).eq('status', 'connected').maybeSingle()
      ]);
      if (!flow || !connection) continue;
      const { data: claimed } = await db.from('leads').update({ order_context: { ...(item.order_context || {}), delivery_recovery: { ...recovery, retry_attempts: Number(recovery.retry_attempts || 0) + 1, retried_at: new Date().toISOString() } }, updated_at: new Date().toISOString() }).eq('id', item.id).eq('owner_id', item.owner_id).eq('connection_id', connection.id).eq('status', 'delivery_failed').select().maybeSingle();
      if (!claimed) continue;
      await retryKieDelivery({ db, flow, lead: claimed, connection });
      recoveredDelivery += 1;
    } catch (deliveryError) {
      console.error('[kie delivery recovery] failed', { leadId: item.id, error: deliveryError.message });
    }
  }
  return NextResponse.json({ received: true, resumed, kie_recovered: recoveredKie, delivery_recovered: recoveredDelivery, timed_out: stopped, timeout_hours: timeoutHours });
}
