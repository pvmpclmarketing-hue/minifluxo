import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { adminClient } from '../../../supabase';

// O site e o Mini Fluxo são serviços distintos e podem estar em fases de
// rotação de segredo diferentes. Aceitamos somente os segredos privados já
// configurados para essa integração, sempre em comparação de tempo constante.
// Assim, um Pix novo nunca deixa de entrar no remarketing por depender do nome
// antigo ou novo da variável de ambiente.
function siteSecretMatches(value) {
  const received = String(value || '');
  return [
    process.env.SITE_WEBHOOK_SECRET,
    process.env.EFI_SITE_PAYMENT_WEBHOOK_SECRET,
    process.env.WHATSENTREGAVEL_SITE_SECRET,
  ].filter(Boolean).some((expected) => (
    received.length === expected.length && timingSafeEqual(Buffer.from(received), Buffer.from(expected))
  ));
}

async function resolveConnection(db, integrationKey) {
  if (!integrationKey) return null;
  const { data: integration } = await db.from('site_integrations').select('connection_id').eq('integration_key', integrationKey).maybeSingle();
  if (integration?.connection_id) return (await db.from('connections').select('*').eq('id', integration.connection_id).maybeSingle()).data;
  return (await db.from('connections').select('*').eq('site_integration_key', integrationKey).maybeSingle()).data;
}

// O site chama este endpoint somente depois que o QR Code foi criado. Ele não
// cria nem altera o Pix: apenas agenda um contato de remarketing idempotente.
export async function POST(request) {
  try {
    const body = await request.json();
    // A chave de integração é um token aleatório, mantido somente nos
    // servidores (Supabase/Vercel) e confirmado abaixo no banco. Ela permite
    // que uma rotação de SITE_WEBHOOK_SECRET nunca interrompa o checkout.
    if (!siteSecretMatches(request.headers.get('x-site-secret')) && !String(body.integration_key || '').trim()) return new NextResponse(null, { status: 401 });
    const orderId = String(body.order_id || body.orderId || '').trim();
    const phone = String(body.customer?.phone || body.phone || '').replace(/\D/g, '');
    const name = String(body.customer?.name || body.name || '').trim();
    const lyricText = String(body.lyric_text || body.lyricText || '').trim();
    if (!orderId || !name || !lyricText) {
      return NextResponse.json({ error: 'order_id, customer e lyric_text sao obrigatorios.' }, { status: 400 });
    }
    // Sem um telefone brasileiro válido não há um destinatário seguro para
    // WhatsApp. Confirmamos o recebimento para o site não repetir o webhook,
    // mas não criamos lead nem tentamos um disparo.
    if (!/^55\d{10,11}$/.test(phone)) {
      return NextResponse.json({ received: true, skipped: true, reason: 'missing_or_invalid_phone' });
    }

    const db = adminClient();
    const connection = await resolveConnection(db, body.integration_key);
    if (!connection) return NextResponse.json({ error: 'Informe uma integration_key valida.' }, { status: 400 });
    const { data: config } = await db.from('connection_flow_configs').select('owner_id,remarketing_flow_id').eq('connection_id', connection.id).maybeSingle();
    if (!config?.remarketing_flow_id || config.owner_id !== connection.owner_id) return NextResponse.json({ error: 'Configure o fluxo de remarketing desta conexao.' }, { status: 409 });
    const { data: flow } = await db.from('flows').select('id,status').eq('id', config.remarketing_flow_id).eq('owner_id', config.owner_id).maybeSingle();
    if (!flow || flow.status !== 'active') return NextResponse.json({ error: 'O fluxo de remarketing configurado nao esta ativo.' }, { status: 409 });

    const eligibleAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const context = {
      quiz: body.quiz && typeof body.quiz === 'object' ? body.quiz : {},
      story: String(body.story || ''),
      lyricText,
      paid: false,
      sourceOrderId: orderId,
      fulfillment_mode: body.fulfillment?.mode || 'generate_music_in_miniflux',
      remarketing: { origin: 'site_unpaid_pix', flow_id: flow.id, eligible_at: eligibleAt, scheduled_at: new Date().toISOString(), dispatched_at: null },
      flow_execution: { flow_id: flow.id, remarketing_eligible_at: eligibleAt },
    };
    const { data: existing } = await db.from('leads').select('id,status').eq('owner_id', config.owner_id).eq('external_order_id', orderId).maybeSingle();
    if (existing) return NextResponse.json({ received: true, duplicate: true, execution_id: existing.id, status: existing.status });

    const { data: lead, error } = await db.from('leads').insert({
      owner_id: config.owner_id,
      name,
      phone,
      source: 'site_remarketing',
      music_request: lyricText,
      status: 'waiting_delay',
      provider: connection.provider,
      connection_id: connection.id,
      external_order_id: orderId,
      order_context: context,
    }).select('id').single();
    if (error?.code === '23505') return NextResponse.json({ received: true, duplicate: true });
    if (error) throw error;
    return NextResponse.json({ received: true, execution_id: lead.id, eligible_at: eligibleAt }, { status: 201 });
  } catch (error) {
    console.error('[site remarketing] failed', { error: error?.message || String(error) });
    return NextResponse.json({ error: error?.message || 'Falha ao agendar remarketing.' }, { status: 500 });
  }
}
