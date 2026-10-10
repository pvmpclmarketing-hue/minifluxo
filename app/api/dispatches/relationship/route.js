import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../../supabase';
import { sendTemplate } from '../../provider';

export const runtime = 'nodejs';

export async function GET(request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const connectionId = String(url.searchParams.get('connection_id') || '').trim();
    const offset = Math.max(0, Math.min(10000, Number(url.searchParams.get('offset') || 0)));
    if (!connectionId) return NextResponse.json({ error: 'Selecione uma conexão Meta.' }, { status: 400 });
    const db = adminClient();
    const { data, error } = await db.from('leads').select('id,name,phone,status,created_at,order_context')
      .eq('owner_id', user.id).eq('connection_id', connectionId)
      .contains('order_context', { contact_origin: 'relationship_dispatch' })
      .order('created_at', { ascending: false }).range(offset, offset + 200);
    if (error) throw error;
    const rows = data || [];
    return NextResponse.json({ recipients: rows.slice(0, 200), has_more: rows.length > 200, next_offset: rows.length > 200 ? offset + 200 : null });
  } catch (error) {
    const status = error?.message === 'Não autenticado' ? 401 : 500;
    return NextResponse.json({ error: error?.message || 'Não foi possível consultar os resultados do disparo.' }, { status });
  }
}

function normalizeRecipients(value) {
  const source = Array.isArray(value) ? value : [];
  const unique = new Map();
  for (const recipient of source) {
    const phone = String(recipient?.phone || recipient || '').replace(/\D/g, '');
    if (phone.length < 10 || phone.length > 15) continue;
    unique.set(phone, { phone, name: String(recipient?.name || 'Contato de relacionamento').trim().slice(0, 120) || 'Contato de relacionamento' });
  }
  return [...unique.values()];
}

export async function POST(request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const connectionId = String(body.connection_id || '').trim();
    const campaignId = String(body.campaign_id || '').trim();
    const recipients = normalizeRecipients(body.recipients);
    if (!/^[0-9a-f-]{36}$/i.test(campaignId)) return NextResponse.json({ error: 'Informe uma chave de campanha válida para evitar envios duplicados.' }, { status: 400 });
    if (!connectionId) return NextResponse.json({ error: 'Selecione a conexão Meta configurada para relacionamento.' }, { status: 400 });
    if (!recipients.length || recipients.length > 100) return NextResponse.json({ error: 'Informe entre 1 e 100 números de WhatsApp válidos.' }, { status: 400 });

    const db = adminClient();
    const [{ data: connection, error: connectionError }, { data: config, error: configError }] = await Promise.all([
      db.from('connections').select('*').eq('id', connectionId).eq('owner_id', user.id).eq('provider', 'meta').eq('status', 'connected').maybeSingle(),
      db.from('connection_flow_configs').select('relationship_flow_id,relationship_template_name,relationship_template_language').eq('connection_id', connectionId).eq('owner_id', user.id).maybeSingle(),
    ]);
    if (connectionError) throw connectionError;
    if (configError) throw configError;
    if (!connection) return NextResponse.json({ error: 'A conexão Meta não está conectada à sua conta.' }, { status: 409 });
    if (!config?.relationship_flow_id || !config.relationship_template_name) return NextResponse.json({ error: 'Configure o template de relacionamento e o fluxo Curso na aba Disparos.' }, { status: 409 });
    const { data: flow, error: flowError } = await db.from('flows').select('*').eq('id', config.relationship_flow_id).eq('owner_id', user.id).eq('status', 'active').maybeSingle();
    if (flowError) throw flowError;
    if (!flow || !Array.isArray(flow.nodes) || !flow.nodes.length) return NextResponse.json({ error: 'O fluxo de relacionamento não está ativo ou não possui etapas.' }, { status: 409 });

    const results = [];
    for (const recipient of recipients) {
      const externalOrderId = `relationship:${campaignId}:${recipient.phone}`;
      const { data: prior, error: priorError } = await db.from('leads').select('id,status').eq('owner_id', user.id).eq('external_order_id', externalOrderId).maybeSingle();
      if (priorError) throw priorError;
      if (prior) {
        results.push({ phone: recipient.phone, lead_id: prior.id, status: prior.status, duplicate: true });
        continue;
      }

      const startedAt = new Date().toISOString();
      const orderContext = {
        contact_origin: 'relationship_dispatch',
        relationship_dispatch: { campaign_id: campaignId, template_name: config.relationship_template_name, created_at: startedAt },
        flow_execution: { flow_id: flow.id, template_trigger: 'relationship', template_name: config.relationship_template_name },
      };
      const { data: lead, error: insertError } = await db.from('leads').insert({
        owner_id: user.id, name: recipient.name, phone: recipient.phone, source: 'manual', status: 'waiting_response',
        provider: connection.provider, connection_id: connection.id, external_order_id: externalOrderId, order_context: orderContext,
      }).select().single();
      if (insertError?.code === '23505') {
        const { data: duplicate } = await db.from('leads').select('id,status').eq('owner_id', user.id).eq('external_order_id', externalOrderId).maybeSingle();
        results.push({ phone: recipient.phone, lead_id: duplicate?.id || null, status: duplicate?.status || 'duplicate', duplicate: true });
        continue;
      }
      if (insertError) throw insertError;

      try {
        const sent = await sendTemplate(connection, recipient.phone, config.relationship_template_name, config.relationship_template_language || 'pt_BR');
        const messageId = String(sent?.messages?.[0]?.id || '');
        const sentAt = new Date().toISOString();
        const updatedContext = {
          ...orderContext,
          flow_execution: { ...orderContext.flow_execution, template_message_id: messageId },
          relationship_dispatch: { ...orderContext.relationship_dispatch, sent_at: sentAt, message_id: messageId },
        };
        const { error: updateError } = await db.from('leads').update({ order_context: updatedContext, updated_at: sentAt }).eq('id', lead.id).eq('owner_id', user.id);
        if (updateError) throw updateError;
        results.push({ phone: recipient.phone, lead_id: lead.id, status: 'waiting_response', sent: true, message_id: messageId });
      } catch (error) {
        const failedAt = new Date().toISOString();
        await db.from('leads').update({ status: 'delivery_failed', order_context: { ...orderContext, relationship_dispatch: { ...orderContext.relationship_dispatch, failed_at: failedAt, error: error?.message || String(error) } }, updated_at: failedAt }).eq('id', lead.id).eq('owner_id', user.id);
        results.push({ phone: recipient.phone, lead_id: lead.id, status: 'delivery_failed', error: error?.message || 'Falha ao enviar template.' });
      }
    }
    return NextResponse.json({ campaign_id: campaignId, template: config.relationship_template_name, flow: flow.name, results, sent: results.filter(item => item.sent).length, failed: results.filter(item => item.status === 'delivery_failed').length, duplicates: results.filter(item => item.duplicate).length }, { status: 200 });
  } catch (error) {
    const status = error?.message === 'Não autenticado' ? 401 : 500;
    console.error('[relationship dispatch] failed', { error: error?.message || String(error) });
    return NextResponse.json({ error: error?.message || 'Não foi possível executar o disparo de relacionamento.' }, { status });
  }
}
