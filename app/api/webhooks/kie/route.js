import { NextResponse } from 'next/server';
import { adminClient } from '../../supabase';
import { hashSecret } from '../../connection-secrets';
import { executeFlow } from '../../flow-engine';

function audioUrls(value, found = new Set()) {
  if (!value) return [...found];
  if (Array.isArray(value)) { value.forEach((item) => audioUrls(item, found)); return [...found]; }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => {
      const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
      if (normalizedKey === 'audiourl' && typeof item === 'string' && /^https?:\/\//.test(item)) found.add(item);
      else if (item && typeof item === 'object') audioUrls(item, found);
    });
  }
  return [...found];
}

function callbackSecret() {
  return process.env.KIE_WEBHOOK_SECRET || (process.env.FLOW_SECRETS_KEY ? hashSecret(`${process.env.FLOW_SECRETS_KEY}:kie-callback`) : '');
}

export async function POST(request) {
  const db = adminClient();
  let claimedLead = null;
  try {
    const url = new URL(request.url);
    const secret = callbackSecret();
    if (!secret || (url.searchParams.get('secret') !== secret && request.headers.get('x-kie-signature') !== secret)) return new NextResponse(null, { status: 401 });
    const body = await request.json();
    const taskId = body.task_id || body.taskId || body.data?.task_id || body.data?.taskId;
    if (!taskId) return NextResponse.json({ received: true, ignored: true, reason: 'missing_task_id' });
    const urls = audioUrls(body).slice(0, 2);
    const stage = String(body.stage || body.status || body.callbackType || body.data?.stage || body.data?.status || body.data?.callbackType || '').toLowerCase();
    const { data: lead } = await db.from('leads').select('*').eq('kie_task_id', taskId).eq('status', 'generating').maybeSingle();
    console.info('[kie webhook] callback received', { task_id: taskId, stage, audio_count: urls.length, lead_found: !!lead });
    if (!lead) return NextResponse.json({ received: true, already_processed: true });
    const generationComplete = stage.includes('complete') || stage.includes('success');
    if (!generationComplete) return NextResponse.json({ received: true, waiting: true, reason: 'generation_not_complete' });
    if (urls.length < 2) return NextResponse.json({ received: true, waiting: true, reason: 'two_audio_urls_required' });

    const execution = lead.order_context?.flow_execution;
    if (!execution?.flow_id || !execution.kie_node_id || !lead.owner_id || !lead.connection_id) return NextResponse.json({ received: true, ignored: true, reason: 'invalid_execution_scope' });
    const { data: flow } = await db.from('flows').select('*').eq('id', execution.flow_id).eq('owner_id', lead.owner_id).eq('status', 'active').maybeSingle();
    const { data: connection } = await db.from('connections').select('*').eq('id', lead.connection_id).eq('owner_id', lead.owner_id).eq('status', 'connected').maybeSingle();
    if (!flow || !connection) return NextResponse.json({ received: true, ignored: true, reason: 'flow_or_connection_unavailable' });

    // Claim this exact task before sending anything: callbacks repeated by Kie cannot duplicate or cross-deliver audio.
    const { data: claimed, error: claimError } = await db.from('leads').update({ status: 'delivering', order_context: { ...(lead.order_context || {}), kie_audios: urls }, updated_at: new Date().toISOString() }).eq('id', lead.id).eq('owner_id', lead.owner_id).eq('connection_id', connection.id).eq('kie_task_id', taskId).eq('status', 'generating').select().maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) return NextResponse.json({ received: true, already_processed: true });
    claimedLead = claimed;
    const result = await executeFlow({ db, flow, lead: claimed, connection, resumeAfterId: execution.kie_node_id, audios: urls });
    console.info('[kie webhook] delivery flow finished', { task_id: taskId, lead_id: claimed.id, owner_id: claimed.owner_id, result });
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    if (claimedLead) await db.from('leads').update({ status: 'delivery_failed', updated_at: new Date().toISOString() }).eq('id', claimedLead.id).eq('owner_id', claimedLead.owner_id).eq('connection_id', claimedLead.connection_id).eq('status', 'delivering');
    console.error('[kie webhook] failed', { lead_id: claimedLead?.id || null, error: error?.message || String(error) });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
