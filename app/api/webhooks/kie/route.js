import { NextResponse } from 'next/server';
import { adminClient } from '../../supabase';
import { executeFlow } from '../../flow-engine';

function audioUrls(value, found = new Set()) {
  if (!value) return [...found];
  if (Array.isArray(value)) { value.forEach((item) => audioUrls(item, found)); return [...found]; }
  if (typeof value === 'object') { Object.values(value).forEach((item) => audioUrls(item, found)); return [...found]; }
  if (typeof value === 'string' && /^https?:\/\//.test(value) && (/\.mp3([?#]|$)/i.test(value) || /audio|music/i.test(value))) found.add(value);
  return [...found];
}

export async function POST(request) {
  try {
    const url = new URL(request.url);
    const callbackSecret = process.env.KIE_WEBHOOK_SECRET || process.env.FLOW_SECRETS_KEY;
    if (callbackSecret && url.searchParams.get('secret') !== callbackSecret && request.headers.get('x-kie-signature') !== callbackSecret) return new NextResponse(null, { status: 401 });
    const body = await request.json();
    const db = adminClient();
    const taskId = body.task_id || body.taskId || body.data?.task_id || body.data?.taskId;
    const { data: lead } = await db.from('leads').select('*').eq('kie_task_id', taskId).maybeSingle();
    const urls = audioUrls(body).slice(0, 2);
    const stage = String(body.stage || body.status || body.callbackType || body.data?.stage || body.data?.status || body.data?.callbackType || '').toLowerCase();
    console.info('[kie webhook] callback received', { task_id: taskId || null, stage, audio_count: urls.length, lead_found: !!lead });
    if (!lead || (!stage.includes('complete') && urls.length < 2)) return NextResponse.json({ received: true, waiting: true });
    if (!urls.length) return NextResponse.json({ received: true, ignored: true });
    const execution = lead.order_context?.flow_execution;
    if (!execution) return NextResponse.json({ received: true, ignored: true });
    const { data: flow } = await db.from('flows').select('*').eq('id', execution.flow_id).eq('owner_id', lead.owner_id).maybeSingle();
    const connection = lead.connection_id ? (await db.from('connections').select('*').eq('id', lead.connection_id).maybeSingle()).data : null;
    if (!connection) throw new Error('WhatsApp da entrega não está conectado.');
    const result = await executeFlow({ db, flow, lead, connection, resumeAfterId: execution.kie_node_id, audios: urls });
    console.info('[kie webhook] delivery flow finished', { task_id: taskId, result });
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
