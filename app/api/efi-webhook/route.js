import { NextResponse } from 'next/server';
import { requireUser, adminClient } from '../supabase';
import { credentialsFor, efiRequest } from '../flow-engine';

export const runtime = 'nodejs';

function relayUrl() {
  const value = String(process.env.EFI_WEBHOOK_RELAY_URL || '').replace(/\/$/, '');
  if (!value.startsWith('https://')) throw new Error('O relay seguro da Efi ainda não está configurado. Tente novamente quando a infraestrutura Oracle estiver pronta.');
  return `${value}/efi`;
}

export async function GET() {
  try {
    const user = await requireUser();
    const { data } = await adminClient().from('efi_pix_charges').select('status,paid_at,created_at').eq('owner_id', user.id).order('created_at', { ascending: false }).limit(1);
    return NextResponse.json({ configured: Boolean(data?.length), latest: data?.[0] || null });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Não autenticado.' }, { status: 401 });
  }
}

export async function POST() {
  try {
    const user = await requireUser();
    const db = adminClient();
    const credentials = await credentialsFor(db, null, user.id);
    const efi = credentials.efi;
    if (!efi) return NextResponse.json({ error: 'Cadastre Client ID, Client Secret, certificado P12 e chave Pix da Efi antes de ativar o webhook.' }, { status: 400 });
    const hostname = efi.environment === 'homologation' ? 'pix-h.api.efipay.com.br' : 'pix.api.efipay.com.br';
    const pfx = Buffer.from(efi.certificateP12, 'base64');
    const basic = Buffer.from(`${efi.clientId}:${efi.clientSecret}`).toString('base64');
    const token = await efiRequest({ hostname, path: '/oauth/token', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials', pfx, passphrase: efi.certificatePassword });
    if (token.status < 200 || token.status >= 300 || !token.data?.access_token) throw new Error(`Efi OAuth: ${token.data?.mensagem || token.data?.message || token.raw || token.status}`);
    const result = await efiRequest({ hostname, path: `/v2/webhook/${encodeURIComponent(efi.pixKey)}`, method: 'PUT', headers: { Authorization: `Bearer ${token.data.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ webhookUrl: relayUrl() }), pfx, passphrase: efi.certificatePassword });
    if (result.status < 200 || result.status >= 300) throw new Error(`Efi webhook: ${result.data?.mensagem || result.data?.message || result.raw || result.status}`);
    return NextResponse.json({ ok: true, webhookUrl: relayUrl() });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Não foi possível ativar o webhook Efi.' }, { status: 500 });
  }
}
