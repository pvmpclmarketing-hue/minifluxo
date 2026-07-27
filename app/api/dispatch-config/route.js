import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../supabase';

export async function POST(request) {
  try {
    const user=await requireUser(); const body=await request.json(); const db=adminClient();
    const {data:connection,error:connectionError}=await db.from('connections').select('id').eq('id',body.connection_id).eq('owner_id',user.id).single();
    if(connectionError || !connection)return NextResponse.json({error:'Conexao nao encontrada.'},{status:404});
    const payload={connection_id:connection.id,owner_id:user.id,payment_flow_id:body.payment_flow_id||null,site_flow_id:body.site_flow_id||null,updated_at:new Date().toISOString()};
    const {data,error}=await db.from('connection_flow_configs').upsert(payload,{onConflict:'connection_id'}).select().single();
    if(error)throw error; return NextResponse.json(data);
  } catch(error) { return NextResponse.json({error:error.message},{status:500}); }
}
