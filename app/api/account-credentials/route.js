import { NextResponse } from 'next/server';
import { encryptSecret } from '../connection-secrets';
import { adminClient, requireUser } from '../supabase';

export async function GET() {
  try {
    const user = await requireUser();
    const { data, error } = await adminClient().from('account_credentials').select('gpt_key_cipher,kie_key_cipher,efi_client_id_cipher,efi_client_secret_cipher,efi_certificate_p12_cipher,efi_certificate_password_cipher,efi_pix_key_cipher,efi_environment,updated_at').eq('owner_id', user.id).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ gptConfigured: !!data?.gpt_key_cipher, kieConfigured: !!data?.kie_key_cipher, efiConfigured: !!(data?.efi_client_id_cipher&&data?.efi_client_secret_cipher&&data?.efi_certificate_p12_cipher&&data?.efi_pix_key_cipher), efiEnvironment:data?.efi_environment||'production', updatedAt: data?.updated_at || null });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const db = adminClient();
    const { data: existing, error: findError } = await db.from('account_credentials').select('gpt_key_cipher,kie_key_cipher,efi_client_id_cipher,efi_client_secret_cipher,efi_certificate_p12_cipher,efi_certificate_password_cipher,efi_pix_key_cipher,efi_environment').eq('owner_id', user.id).maybeSingle();
    if (findError) throw findError;
    const values = { owner_id: user.id, updated_at: new Date().toISOString() };
    if (typeof body.gptKey === 'string' && body.gptKey.trim()) values.gpt_key_cipher = encryptSecret(body.gptKey.trim());
    if (typeof body.kieKey === 'string' && body.kieKey.trim()) values.kie_key_cipher = encryptSecret(body.kieKey.trim());
    if (typeof body.efiClientId === 'string' && body.efiClientId.trim()) values.efi_client_id_cipher = encryptSecret(body.efiClientId.trim());
    if (typeof body.efiClientSecret === 'string' && body.efiClientSecret.trim()) values.efi_client_secret_cipher = encryptSecret(body.efiClientSecret.trim());
    if (typeof body.efiCertificateP12 === 'string' && body.efiCertificateP12.trim()) {
      if (body.efiCertificateP12.length>1024*1024) return NextResponse.json({ error: 'O certificado P12 excede o limite de 1 MB.' }, { status: 400 });
      values.efi_certificate_p12_cipher = encryptSecret(body.efiCertificateP12.trim());
    }
    if (typeof body.efiCertificatePassword === 'string' && body.efiCertificatePassword.trim()) values.efi_certificate_password_cipher = encryptSecret(body.efiCertificatePassword.trim());
    if (typeof body.efiPixKey === 'string' && body.efiPixKey.trim()) values.efi_pix_key_cipher = encryptSecret(body.efiPixKey.trim());
    if (body.efiEnvironment==='homologation'||body.efiEnvironment==='production') values.efi_environment=body.efiEnvironment;
    if (Object.keys(values).length===2) return NextResponse.json({ error: 'Informe ao menos uma credencial.' }, { status: 400 });
    const query = existing ? db.from('account_credentials').update(values).eq('owner_id', user.id) : db.from('account_credentials').insert(values);
    const { error } = await query;
    if (error) throw error;
    const efiConfigured=!!((values.efi_client_id_cipher||existing?.efi_client_id_cipher)&&(values.efi_client_secret_cipher||existing?.efi_client_secret_cipher)&&(values.efi_certificate_p12_cipher||existing?.efi_certificate_p12_cipher)&&(values.efi_pix_key_cipher||existing?.efi_pix_key_cipher));
    return NextResponse.json({ ok: true, gptConfigured: !!(values.gpt_key_cipher || existing?.gpt_key_cipher), kieConfigured: !!(values.kie_key_cipher || existing?.kie_key_cipher), efiConfigured, efiEnvironment:values.efi_environment||existing?.efi_environment||'production' });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
