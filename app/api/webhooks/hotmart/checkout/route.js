import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { adminClient } from '../../../supabase';
import { resolveOfficialSiteConnection } from '../../../site-connection';

export const runtime = 'nodejs';

function normaliseMexicoPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('52') && digits.length >= 12) return digits;
  // O checkout mexicano normalmente informa os 10 dígitos nacionais.
  return digits.length === 10 ? `52${digits}` : digits;
}

// Registra os dados criativos antes de o cliente abrir o checkout Hotmart.
// O sck retornado deve ser enviado pela página em `prefilledInfo.sck`.
export async function POST(request) {
  try {
    if (!process.env.SITE_WEBHOOK_SECRET || request.headers.get('x-site-secret') !== process.env.SITE_WEBHOOK_SECRET) return new NextResponse(null, { status: 401 });
    const body = await request.json();
    const phone = normaliseMexicoPhone(body.phone);
    const lyricText = String(body.lyric_text || body.lyricText || '').trim();
    if (!String(body.name || '').trim() || !phone || !lyricText) return NextResponse.json({ error: 'name, phone e lyric_text sao obrigatorios.' }, { status: 400 });

    const db = adminClient();
    const connection = await resolveOfficialSiteConnection(db, { integrationKey: body.integration_key, connectionId: body.connection_id });
    if (!connection) return NextResponse.json({ error: 'Canal oficial do site nao encontrado ou indisponivel.' }, { status: 400 });

    const { data: config } = await db.from('connection_flow_configs').select('owner_id,payment_generation_flow_id').eq('connection_id', connection.id).maybeSingle();
    if (!config?.owner_id || !config.payment_generation_flow_id) return NextResponse.json({ error: 'Configure o fluxo de pagamento que gera musica para o canal oficial.' }, { status: 409 });

    const sck = `mfmx_${randomUUID().replace(/-/g, '')}`;
    const context = {
      quiz: body.quiz || {},
      story: body.story || '',
      lyricText,
      paid: false,
      fulfillment_mode: 'generate_music_in_miniflux',
      hotmart: { sck, checkout_registered_at: new Date().toISOString(), country: 'MX' },
    };
    const { data: lead, error } = await db.from('leads').insert({
      owner_id: config.owner_id,
      name: String(body.name).trim(),
      phone,
      source: 'site',
      provider: 'hotmart',
      connection_id: connection.id,
      external_order_id: `hotmart:pending:${sck}`,
      music_request: body.music_request || body.musicRequest || lyricText,
      status: 'waiting_payment',
      order_context: context,
    }).select('id').single();
    if (error) throw error;

    return NextResponse.json({ received: true, lead_id: lead.id, sck, hotmart_checkout: { prefilledInfo: { sck } } }, { status: 201 });
  } catch (error) {
    console.error('[hotmart checkout] failed', { error: error?.message || String(error) });
    return NextResponse.json({ error: error?.message || 'Nao foi possivel preparar o checkout Hotmart.' }, { status: 500 });
  }
}
