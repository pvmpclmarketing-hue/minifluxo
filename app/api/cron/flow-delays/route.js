import { NextResponse } from 'next/server';
import { adminClient } from '../../supabase';
import { executeFlow } from '../../flow-engine';

export async function POST(request) {
  if (!process.env.DELAY_CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.DELAY_CRON_SECRET}`) return new NextResponse(null, { status: 401 });
  const db = adminClient();
  const now = Date.now();
  const timeoutHours = Math.max(1, Number(process.env.FLOW_EXECUTION_TIMEOUT_HOURS || 8));
  const timeoutAt = new Date(now - timeoutHours * 60 * 60 * 1000).toISOString();
  // Estas etapas deveriam avançar sem uma nova ação do cliente. Se ficarem presas,
  // encerramos somente esta execução para que ela nunca volte a enviar mensagens depois.
  const { data: expired, error: expireError } = await db.from('leads').update({ status: 'timed_out', updated_at: new Date().toISOString() }).in('status', ['in_progress', 'generating', 'delivering', 'delivery_failed']).lt('updated_at', timeoutAt).select('id');
  if (expireError) return NextResponse.json({ error: expireError.message }, { status: 500 });
  const { data: pending, error } = await db.from('leads').select('*').eq('status', 'waiting_delay').limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let resumed = 0; let stopped = expired?.length || 0;
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
  return NextResponse.json({ received: true, resumed, timed_out: stopped, timeout_hours: timeoutHours });
}
