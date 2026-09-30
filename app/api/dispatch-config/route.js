import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../supabase';

export async function POST(request) {
  try {
    const user=await requireUser(); const body=await request.json(); const db=adminClient();
    const {data:connection,error:connectionError}=await db.from('connections').select('id,provider').eq('id',body.connection_id).eq('owner_id',user.id).single();
    if(connectionError || !connection)return NextResponse.json({error:'Conexao nao encontrada.'},{status:404});
    if(!['meta','uazapi'].includes(connection.provider))return NextResponse.json({error:'Escolha uma conexão Meta ou UazAPI.'},{status:400});
    const backupConnectionId=connection.provider==='meta'?(body.backup_connection_id||null):null;
    if(backupConnectionId){
      const {data:backup}=await db.from('connections').select('id,provider,status').eq('id',backupConnectionId).eq('owner_id',user.id).maybeSingle();
      if(!backup || backup.provider!=='uazapi')return NextResponse.json({error:'Escolha uma conexão UazAPI válida como número reserva.'},{status:400});
    }
    const backupMinutes=Math.max(5,Math.min(1440,Number(body.backup_response_timeout_minutes||50)));
    const payload={
      connection_id:connection.id,
      owner_id:user.id,
      payment_preview_flow_id:body.payment_preview_flow_id||null,
      payment_generation_flow_id:body.payment_generation_flow_id||null,
      site_flow_id:body.site_flow_id||null,
      remarketing_flow_id:body.remarketing_flow_id||null,
      backup_connection_id:backupConnectionId,
      backup_flow_id:body.backup_flow_id||null,
      backup_response_timeout_minutes:backupMinutes,
      // O WhatsEntregavel continua ouvindo respostas para blocos "Aguardar resposta",
      // mas novas conversas não iniciam mais um fluxo por esta configuração.
      conversation_flow_id:null,
      updated_at:new Date().toISOString()
    };
    const {data,error}=await db.from('connection_flow_configs').upsert(payload,{onConflict:'connection_id'}).select().single();
    if(error)throw error; return NextResponse.json(data);
  } catch(error) { return NextResponse.json({error:error.message},{status:500}); }
}
