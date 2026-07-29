import { NextResponse } from 'next/server';
import { adminClient } from '../../supabase';
import { executeFlow } from '../../flow-engine';

export async function POST(request) {
  if (!process.env.DELAY_CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.DELAY_CRON_SECRET}`) return new NextResponse(null, { status: 401 });
  const db = adminClient();
  const now = Date.now();
  const { data: pending, error } = await db.from('leads').select('*').eq('status', 'waiting_delay').limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let resumed = 0;
  for (const item of pending || []) {
    const execution = item.order_context?.flow_execution;
    if (!execution?.delay_node_id || !execution.resume_at || Date.parse(execution.resume_at) > now) continue;
    const { data: lead } = await db.from('leads').update({ status: 'in_progress', updated_at: new Date().toISOString() }).eq('id', item.id).eq('status', 'waiting_delay').select().maybeSingle();
    if (!lead) continue;
    try {
      const { data: flow } = await db.from('flows').select('*').eq('id', execution.flow_id).eq('owner_id', lead.owner_id).maybeSingle();
      const { data: connection } = await db.from('connections').select('*').eq('id', lead.connection_id).maybeSingle();
      if (!flow?.status || !connection || connection.status !== 'connected') throw new Error('Fluxo ou WhatsApp indisponivel para continuar o delay.');
      await executeFlow({ db, flow, lead, connection, resumeAfterId: execution.delay_node_id });
      resumed += 1;
    } catch (resumeError) {
      console.error('[flow delay] failed', { leadId: lead.id, error: resumeError.message });
      await db.from('leads').update({ status: 'waiting_delay', updated_at: new Date().toISOString() }).eq('id', lead.id);
    }
  }
  return NextResponse.json({ received: true, resumed });
}
