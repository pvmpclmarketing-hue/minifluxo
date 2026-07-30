import { NextResponse } from 'next/server';
import { encryptSecret } from '../connection-secrets';
import { adminClient, requireUser } from '../supabase';

export async function GET() {
  try {
    const user = await requireUser();
    const { data, error } = await adminClient().from('account_credentials').select('gpt_key_cipher,kie_key_cipher,updated_at').eq('owner_id', user.id).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ gptConfigured: !!data?.gpt_key_cipher, kieConfigured: !!data?.kie_key_cipher, updatedAt: data?.updated_at || null });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const db = adminClient();
    const { data: existing, error: findError } = await db.from('account_credentials').select('gpt_key_cipher,kie_key_cipher').eq('owner_id', user.id).maybeSingle();
    if (findError) throw findError;
    const values = { owner_id: user.id, updated_at: new Date().toISOString() };
    if (typeof body.gptKey === 'string' && body.gptKey.trim()) values.gpt_key_cipher = encryptSecret(body.gptKey.trim());
    if (typeof body.kieKey === 'string' && body.kieKey.trim()) values.kie_key_cipher = encryptSecret(body.kieKey.trim());
    if (!values.gpt_key_cipher && !values.kie_key_cipher) return NextResponse.json({ error: 'Informe ao menos uma chave.' }, { status: 400 });
    const query = existing ? db.from('account_credentials').update(values).eq('owner_id', user.id) : db.from('account_credentials').insert(values);
    const { error } = await query;
    if (error) throw error;
    return NextResponse.json({ ok: true, gptConfigured: !!(values.gpt_key_cipher || existing?.gpt_key_cipher), kieConfigured: !!(values.kie_key_cipher || existing?.kie_key_cipher) });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
