import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { adminClient } from '../../../supabase';
import { credentialsFor, efiRequest, executeFlow } from '../../../flow-engine';

export const runtime = 'nodejs';

function cleanPhone(value) { return String(value || '').replace(/\D/g, ''); }
function siteSecretMatches(value) {
  const received = String(value || '');
  // Em instalações já existentes, reutilizamos o segredo privado que também
  // autentica o callback Minifluxo -> Supabase. Uma instalação nova pode usar
  // SITE_WEBHOOK_SECRET dedicado sem alterar este endpoint.
  return [process.env.SITE_WEBHOOK_SECRET, process.env.EFI_SITE_PAYMENT_WEBHOOK_SECRET]
    .filter(Boolean)
    .some((expected) => received.length === expected.length && timingSafeEqual(Buffer.from(received), Buffer.from(expected)));
}
function efiError(prefix, response) { return new Error(`${prefix}: ${response.data?.mensagem || response.data?.message || response.raw || response.status}`); }
function urlsFrom(value, result = new Set()) {
  if (!value) return result;
  if (Array.isArray(value)) { value.forEach((item) => urlsFrom(item, result)); return result; }
  if (typeof value === 'string') { value.split(/[\s,]+/).filter((item) => /^https?:\/\//i.test(item)).forEach((item) => result.add(item)); return result; }
  if (typeof value === 'object') Object.values(value).forEach((item) => urlsFrom(item, result));
  return result;
}
function previewAudios(body) {
  return [...urlsFrom([
    body.preview_audios, body.previewAudios, body.preview_audio_urls, body.previewAudioUrls,
    body.preview?.audios, body.preview?.audio_urls, body.preview?.audioUrls,
    body.quiz?.preview_audio_urls, body.quiz?.previewAudios,
  ])].slice(0, 2);
}
function fulfillmentMode(body) { return body.fulfillment?.mode || body.quiz?.fulfillment_mode || 'generate_music_in_miniflux'; }

async function resolveConnection(db, integrationKey) {
  const { data: integration } = await db.from('site_integrations').select('connection_id').eq('integration_key', integrationKey).maybeSingle();
  if (!integration?.connection_id) return null;
  return (await db.from('connections').select('*').eq('id', integration.connection_id).maybeSingle()).data;
}

async function efiToken(efi) {
  const hostname = efi.environment === 'homologation' ? 'pix-h.api.efipay.com.br' : 'pix.api.efipay.com.br';
  const pfx = Buffer.from(efi.certificateP12, 'base64');
  if (!pfx.length) throw new Error('O certificado P12 da Efí está inválido. Envie-o novamente na aba APIs.');
  const basic = Buffer.from(`${efi.clientId}:${efi.clientSecret}`).toString('base64');
  const response = await efiRequest({ hostname, path: '/oauth/token', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials', pfx, passphrase: efi.certificatePassword });
  if (response.status < 200 || response.status >= 300 || !response.data?.access_token) throw efiError('Efí OAuth', response);
  return { hostname, pfx, token: response.data.access_token };
}

export async function POST(request) {
  try {
    if (!siteSecretMatches(request.headers.get('x-site-secret'))) return new NextResponse(null, { status: 401 });
    const body = await request.json();
    const phone = cleanPhone(body.phone), orderId = String(body.order_id || '').trim(), amountCents = Number(body.amount_cents);
    if (!body.integration_key || !orderId || !body.name || !phone || !Number.isInteger(amountCents) || amountCents < 1) return NextResponse.json({ error: 'Pedido Efí inválido.' }, { status: 400 });
    const db = adminClient();
    const connection = await resolveConnection(db, body.integration_key);
    if (!connection) return NextResponse.json({ error: 'Informe uma integration_key válida.' }, { status: 400 });
    if (connection.status !== 'connected') return NextResponse.json({ error: 'O WhatsApp desta integração não está conectado.' }, { status: 409 });
    const mode = fulfillmentMode(body);
    if (!['deliver_existing_preview_audio', 'generate_music_in_miniflux'].includes(mode)) return NextResponse.json({ error: 'fulfillment.mode deve ser deliver_existing_preview_audio ou generate_music_in_miniflux.' }, { status: 400 });
    const audios = previewAudios(body);
    if (mode === 'deliver_existing_preview_audio' && audios.length !== 2) return NextResponse.json({ error: 'A entrega da prévia exige exatamente duas URLs em preview.audios.' }, { status: 422 });
    const { data: config } = await db.from('connection_flow_configs').select('site_flow_id,payment_preview_flow_id,payment_generation_flow_id,owner_id').eq('connection_id', connection.id).maybeSingle();
    if (!config?.site_flow_id || config.owner_id !== connection.owner_id) return NextResponse.json({ error: 'Configure o fluxo de pedido vindo do site para esta conexão.' }, { status: 409 });
    const { data: flow } = await db.from('flows').select('*').eq('id', config.site_flow_id).eq('owner_id', config.owner_id).maybeSingle();
    if (!flow || flow.status !== 'active') return NextResponse.json({ error: 'O fluxo de pedido vindo do site precisa estar ativo.' }, { status: 409 });
    const paymentFlowId = mode === 'deliver_existing_preview_audio' ? config.payment_preview_flow_id : config.payment_generation_flow_id;
    if (!paymentFlowId) return NextResponse.json({ error: mode === 'deliver_existing_preview_audio' ? 'Configure o fluxo de pagamento com prévia pronta em Disparos.' : 'Configure o fluxo de pagamento sem prévia pronta em Disparos.' }, { status: 409 });
    const { data: paymentFlow } = await db.from('flows').select('*').eq('id', paymentFlowId).eq('owner_id', config.owner_id).maybeSingle();
    if (!paymentFlow || paymentFlow.status !== 'active') return NextResponse.json({ error: 'O fluxo de pagamento selecionado precisa estar ativo.' }, { status: 409 });

    let { data: lead } = await db.from('leads').select('*').eq('owner_id', flow.owner_id).eq('external_order_id', orderId).maybeSingle();
    if (!lead) {
      const { data, error } = await db.from('leads').insert({ owner_id: flow.owner_id, name: String(body.name).trim(), phone, source: 'site', provider: connection.provider, connection_id: connection.id, external_order_id: orderId, music_request: body.lyric_text || body.story || null, status: 'in_progress', order_context: { quiz: body.quiz || {}, story: body.story || '', lyricText: body.lyric_text || body.lyricText || '', paid: false, sourceOrderId: orderId, payment_provider: 'efi', fulfillment_mode: mode, preview_audios: audios, preview_task_id: body.preview?.task_id || body.preview?.taskId || body.kie_task_id || null } }).select().single();
      if (error) throw error;
      lead = data;
      await executeFlow({ db, flow, lead, connection });
      const { data: refreshed, error: refreshError } = await db.from('leads').select('*').eq('id', lead.id).single();
      if (refreshError || !refreshed) throw new Error('Não foi possível preparar o pedido no fluxo.');
      lead = refreshed;
    }
    const paymentNodeId = lead.order_context?.flow_execution?.payment_node_id;
    if (lead.status !== 'waiting_payment' || !paymentNodeId) return NextResponse.json({ error: 'O fluxo de pedido vindo do site precisa ter o card “Pagamento confirmado” antes da entrega.' }, { status: 409 });
    const { data: existing } = await db.from('efi_pix_charges').select('*').eq('lead_id', lead.id).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (existing?.payment_payload?.pix_copia_e_cola) return NextResponse.json({ order_id: orderId, txid: existing.txid, pixPayload: existing.payment_payload.pix_copia_e_cola, qrCode: existing.payment_payload.qr_code || null, expiresAt: existing.expires_at });

    const efi = (await credentialsFor(db, flow.id, flow.owner_id)).efi;
    if (!efi) return NextResponse.json({ error: 'Cadastre Client ID, Client Secret, certificado P12 e chave Pix da Efí na aba APIs do Minifluxo.' }, { status: 409 });
    const auth = await efiToken(efi), txid = createHash('sha256').update(`site-efi:${orderId}`).digest('hex').slice(0, 32), expiration = 1800;
    const charge = await efiRequest({ hostname: auth.hostname, path: `/v2/cob/${txid}`, method: 'PUT', headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ calendario: { expiracao: expiration }, valor: { original: (amountCents / 100).toFixed(2) }, chave: efi.pixKey, solicitacaoPagador: `Pedido música ${orderId.slice(0, 8)}` }), pfx: auth.pfx, passphrase: efi.certificatePassword });
    if (charge.status < 200 || charge.status >= 300 || !charge.data?.pixCopiaECola) throw efiError('Efí Pix', charge);
    let qrCode = null;
    if (charge.data?.loc?.id) {
      const qr = await efiRequest({ hostname: auth.hostname, path: `/v2/loc/${charge.data.loc.id}/qrcode`, method: 'GET', headers: { Authorization: `Bearer ${auth.token}` }, pfx: auth.pfx, passphrase: efi.certificatePassword });
      if (qr.status >= 200 && qr.status < 300 && qr.data?.imagemQrcode) qrCode = `data:image/png;base64,${qr.data.imagemQrcode}`;
    }
    if (!qrCode) throw new Error('A Efí criou a cobrança, mas não retornou a imagem do QR Code. Tente gerar novamente.');
    const expiresAt = new Date(Date.now() + expiration * 1000).toISOString();
    // O fluxo `site_flow_id` só prepara o pedido e espera no card Pagamento
    // confirmado. Após a Efí aprovar, o fluxo abaixo é iniciado pela entrada,
    // igual ao webhook de pagamento do Asaas.
    const { error: chargeError } = await db.from('efi_pix_charges').upsert({ txid, owner_id: flow.owner_id, lead_id: lead.id, connection_id: connection.id, flow_id: paymentFlow.id, node_id: paymentNodeId, amount: (amountCents / 100).toFixed(2), status: 'pending', expires_at: expiresAt, updated_at: new Date().toISOString(), payment_payload: { pix_copia_e_cola: charge.data.pixCopiaECola, qr_code: qrCode, source_order_id: orderId, dispatch_like_asaas: true, fulfillment_mode: mode, pre_payment_flow_id: flow.id, preview_audios: audios } }, { onConflict: 'txid' });
    if (chargeError) throw chargeError;
    return NextResponse.json({ order_id: orderId, txid, pixPayload: charge.data.pixCopiaECola, qrCode, expiresAt });
  } catch (error) {
    console.error('[site efi pix] failed', error);
    return NextResponse.json({ error: error?.message || 'Não foi possível gerar o Pix da Efí.' }, { status: 500 });
  }
}
