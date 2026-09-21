import { createHash, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { adminClient } from '../../../supabase';
import { credentialsFor, efiRequest } from '../../../flow-engine';

export const runtime = 'nodejs';

function cleanPhone(value) { return String(value || '').replace(/\D/g, ''); }
function qrImageDataUrl(value) {
  const image = String(value || '').trim();
  if (!image) return null;
  // A Efí devolve `imagemQrcode` já como data URL (normalmente SVG). Não
  // prefixar novamente, pois `data:image/png;base64,data:image/svg...`
  // produz uma imagem quebrada no navegador.
  if (/^data:image\/[^,]+,data:image\//i.test(image)) return image.slice(image.indexOf(',') + 1);
  if (/^data:image\//i.test(image)) return image;
  return `data:image/png;base64,${image}`;
}
function siteSecretMatches(value) {
  const received = String(value || '');
  // Em instalações já existentes, reutilizamos o segredo privado que também
  // autentica o callback Minifluxo -> Supabase. Uma instalação nova pode usar
  // SITE_WEBHOOK_SECRET dedicado sem alterar este endpoint.
  return [
    process.env.SITE_WEBHOOK_SECRET,
    process.env.EFI_SITE_PAYMENT_WEBHOOK_SECRET,
    process.env.WHATSENTREGAVEL_SITE_SECRET,
  ]
    .filter(Boolean)
    .some((expected) => received.length === expected.length && timingSafeEqual(Buffer.from(received), Buffer.from(expected)));
}
function efiError(prefix, response) { return new Error(`${prefix}: ${response.data?.mensagem || response.data?.message || response.raw || response.status}`); }
async function retryEfiRequest(operation) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await operation();
      const transient = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!transient || attempt === 2) return response;
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
  }
  throw lastError || new Error('A Efí não respondeu ao criar o Pix.');
}
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

async function resolveSiteIntegration(db, integrationKey) {
  const { data: integration } = await db.from('site_integrations').select('owner_id,connection_id').eq('integration_key', integrationKey).maybeSingle();
  if (!integration?.owner_id) return null;
  const connection = integration.connection_id
    ? (await db.from('connections').select('*').eq('id', integration.connection_id).eq('owner_id', integration.owner_id).maybeSingle()).data
    : null;
  return { ...integration, connection };
}

async function efiToken(efi) {
  const hostname = efi.environment === 'homologation' ? 'pix-h.api.efipay.com.br' : 'pix.api.efipay.com.br';
  const pfx = Buffer.from(efi.certificateP12, 'base64');
  if (!pfx.length) throw new Error('O certificado P12 da Efí está inválido. Envie-o novamente na aba APIs.');
  const basic = Buffer.from(`${efi.clientId}:${efi.clientSecret}`).toString('base64');
  const response = await retryEfiRequest(() => efiRequest({ hostname, path: '/oauth/token', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials', pfx, passphrase: efi.certificatePassword }));
  if (response.status < 200 || response.status >= 300 || !response.data?.access_token) throw efiError('Efí OAuth', response);
  return { hostname, pfx, token: response.data.access_token };
}

export async function POST(request) {
  try {
    if (!siteSecretMatches(request.headers.get('x-site-secret'))) return new NextResponse(null, { status: 401 });
    const body = await request.json();
    const phone = cleanPhone(body.phone), orderId = String(body.order_id || '').trim(), amountCents = Number(body.amount_cents);
    if (!body.integration_key || !orderId || !body.name || !phone || !Number.isInteger(amountCents) || amountCents < 1) {
      console.warn('[site efi pix] rejected invalid order', {
        order_id: orderId || null,
        has_integration_key: Boolean(body.integration_key), has_name: Boolean(body.name),
        has_phone: Boolean(phone), has_valid_amount: Number.isInteger(amountCents) && amountCents >= 1,
      });
      return NextResponse.json({ error: 'Pedido Efí inválido.' }, { status: 400 });
    }
    const db = adminClient();
    const integration = await resolveSiteIntegration(db, body.integration_key);
    if (!integration) {
      console.warn('[site efi pix] rejected invalid integration', { order_id: orderId, has_integration_key: Boolean(body.integration_key) });
      return NextResponse.json({ error: 'Informe uma integration_key válida.' }, { status: 400 });
    }
    // Este endpoint é um cofre de credenciais Efí, não um gatilho de WhatsApp.
    // A criação do QR não depende de conexão, card ou fluxo de pré-pagamento.
    const connection = integration.connection;
    const mode = fulfillmentMode(body);
    if (!['deliver_existing_preview_audio', 'generate_music_in_miniflux'].includes(mode)) return NextResponse.json({ error: 'fulfillment.mode deve ser deliver_existing_preview_audio ou generate_music_in_miniflux.' }, { status: 400 });
    const audios = previewAudios(body);
    if (mode === 'deliver_existing_preview_audio' && audios.length !== 2) return NextResponse.json({ error: 'A entrega da prévia exige exatamente duas URLs em preview.audios.' }, { status: 422 });
    let { data: config } = connection
      ? await db.from('connection_flow_configs').select('payment_preview_flow_id,payment_generation_flow_id,owner_id').eq('connection_id', connection.id).maybeSingle()
      : { data: null };
    // Caso a conexão seja removida ou esteja em manutenção, o checkout Efí
    // continua elegendo o último fluxo de entrega da mesma conta. Não há
    // dependência de status, número ou sessão de WhatsApp.
    if (!config) {
      const fallback = await db.from('connection_flow_configs').select('payment_preview_flow_id,payment_generation_flow_id,owner_id').eq('owner_id', integration.owner_id).not('payment_generation_flow_id', 'is', null).order('updated_at', { ascending: false }).limit(1).maybeSingle();
      config = fallback.data;
    }
    if (!config || config.owner_id !== integration.owner_id) return NextResponse.json({ error: 'Configure um fluxo de entrega para a integração do site.' }, { status: 409 });
    const paymentFlowId = mode === 'deliver_existing_preview_audio' ? config.payment_preview_flow_id : config.payment_generation_flow_id;
    if (!paymentFlowId) return NextResponse.json({ error: mode === 'deliver_existing_preview_audio' ? 'Configure o fluxo de pagamento com prévia pronta em Disparos.' : 'Configure o fluxo de pagamento sem prévia pronta em Disparos.' }, { status: 409 });
    const { data: paymentFlow } = await db.from('flows').select('*').eq('id', paymentFlowId).eq('owner_id', config.owner_id).maybeSingle();
    if (!paymentFlow || paymentFlow.status !== 'active') return NextResponse.json({ error: 'O fluxo de pagamento selecionado precisa estar ativo.' }, { status: 409 });

    let { data: lead } = await db.from('leads').select('*').eq('owner_id', integration.owner_id).eq('external_order_id', orderId).maybeSingle();
    if (!lead) {
      const { data, error } = await db.from('leads').insert({ owner_id: integration.owner_id, name: String(body.name).trim(), phone, source: 'site', provider: connection?.provider || 'efi', connection_id: connection?.id || null, external_order_id: orderId, music_request: body.lyric_text || body.story || null, status: 'waiting_pix', order_context: { quiz: body.quiz || {}, story: body.story || '', lyricText: body.lyric_text || body.lyricText || '', paid: false, sourceOrderId: orderId, payment_provider: 'efi', fulfillment_mode: mode, preview_audios: audios, preview_task_id: body.preview?.task_id || body.preview?.taskId || body.kie_task_id || null } }).select().single();
      if (error) throw error;
      lead = data;
    }
    const { data: existing } = await db.from('efi_pix_charges').select('*').eq('lead_id', lead.id).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (existing?.payment_payload?.pix_copia_e_cola) return NextResponse.json({ order_id: orderId, txid: existing.txid, pixPayload: existing.payment_payload.pix_copia_e_cola, qrCode: qrImageDataUrl(existing.payment_payload.qr_code), expiresAt: existing.expires_at });

    const efi = (await credentialsFor(db, paymentFlow.id, paymentFlow.owner_id)).efi;
    if (!efi) return NextResponse.json({ error: 'Cadastre Client ID, Client Secret, certificado P12 e chave Pix da Efí na aba APIs do Minifluxo.' }, { status: 409 });
    const auth = await efiToken(efi), txid = createHash('sha256').update(`site-efi:${orderId}`).digest('hex').slice(0, 32), expiration = 1800;
    const charge = await retryEfiRequest(() => efiRequest({ hostname: auth.hostname, path: `/v2/cob/${txid}`, method: 'PUT', headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ calendario: { expiracao: expiration }, valor: { original: (amountCents / 100).toFixed(2) }, chave: efi.pixKey, solicitacaoPagador: `Pedido música ${orderId.slice(0, 8)}` }), pfx: auth.pfx, passphrase: efi.certificatePassword }));
    if (charge.status < 200 || charge.status >= 300 || !charge.data?.pixCopiaECola) throw efiError('Efí Pix', charge);
    let qrCode = null;
    if (charge.data?.loc?.id) {
      const qr = await retryEfiRequest(() => efiRequest({ hostname: auth.hostname, path: `/v2/loc/${charge.data.loc.id}/qrcode`, method: 'GET', headers: { Authorization: `Bearer ${auth.token}` }, pfx: auth.pfx, passphrase: efi.certificatePassword }));
      if (qr.status >= 200 && qr.status < 300 && qr.data?.imagemQrcode) qrCode = qrImageDataUrl(qr.data.imagemQrcode);
    }
    if (!qrCode) throw new Error('A Efí criou a cobrança, mas não retornou a imagem do QR Code. Tente gerar novamente.');
    const expiresAt = new Date(Date.now() + expiration * 1000).toISOString();
    // A cobrança só registra o fluxo de entrega para o webhook Efí usar após
    // o pagamento; nenhum card do fluxo é executado para criar este QR Code.
    const { error: chargeError } = await db.from('efi_pix_charges').upsert({ txid, owner_id: integration.owner_id, lead_id: lead.id, connection_id: connection?.id || null, flow_id: paymentFlow.id, node_id: null, amount: (amountCents / 100).toFixed(2), status: 'pending', expires_at: expiresAt, updated_at: new Date().toISOString(), payment_payload: { pix_copia_e_cola: charge.data.pixCopiaECola, qr_code: qrCode, source_order_id: orderId, dispatch_like_asaas: true, fulfillment_mode: mode, preview_audios: audios } }, { onConflict: 'txid' });
    if (chargeError) throw chargeError;
    return NextResponse.json({ order_id: orderId, txid, pixPayload: charge.data.pixCopiaECola, qrCode, expiresAt });
  } catch (error) {
    console.error('[site efi pix] failed', error);
    return NextResponse.json({ error: error?.message || 'Não foi possível gerar o Pix da Efí.' }, { status: 500 });
  }
}
