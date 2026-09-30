import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../supabase';

async function integrationFor(userId) {
  const db=adminClient(); const {data:existing,error}=await db.from('site_integrations').select('*').eq('owner_id',userId).maybeSingle();
  if(error) throw error; if(existing) return existing;
  const {data,error:insertError}=await db.from('site_integrations').insert({owner_id:userId}).select().single(); if(insertError) throw insertError; return data;
}
export async function GET() { try { const user=await requireUser(); return NextResponse.json(await integrationFor(user.id)); } catch(error) { return NextResponse.json({error:error.message},{status:500}); } }
export async function PATCH(request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const db = adminClient();
    const integration = await integrationFor(user.id);
    const connectionId = String(body.connection_id || '').trim();
    if (!connectionId) return NextResponse.json({ error: 'Escolha uma conexão para o site.' }, { status: 400 });
    const { data: connection } = await db.from('connections')
      .select('id,provider,status')
      .eq('id', connectionId)
      .eq('owner_id', user.id)
      .maybeSingle();
    if (!connection || !['meta', 'uazapi'].includes(connection.provider) || connection.status !== 'connected') {
      return NextResponse.json({ error: 'Escolha uma conexão Meta ou UazAPI conectada.' }, { status: 409 });
    }
    const { data, error } = await db.from('site_integrations')
      .update({ connection_id: connectionId, updated_at: new Date().toISOString() })
      .eq('owner_id', user.id)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ ...data, integration_key: integration.integration_key });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
