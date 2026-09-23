import { NextResponse } from 'next/server';
import { adminClient } from '../../supabase';
import { sendText } from '../../provider';
import { executeFlow } from '../../flow-engine';
import { resolveOfficialSiteConnection } from '../../site-connection';

export async function POST(request) {
  if (process.env.SITE_WEBHOOK_SECRET && request.headers.get('x-site-secret') !== process.env.SITE_WEBHOOK_SECRET) return new NextResponse(null,{status:401});
  const body=await request.json(); const phone=String(body.phone||'').replace(/\D/g,'');
  if(!body.name||!phone) return NextResponse.json({error:'name e phone sao obrigatorios.'},{status:400});
  const db=adminClient(); const connection=await resolveOfficialSiteConnection(db,{integrationKey:body.integration_key,connectionId:body.connection_id});
  if(!connection)return NextResponse.json({error:'Canal oficial do site não encontrado ou indisponível.'},{status:400});
  const {data:config}=await db.from('connection_flow_configs').select('site_flow_id,owner_id').eq('connection_id',connection.id).maybeSingle();
  if(config?.owner_id!==connection.owner_id)return NextResponse.json({error:'A configuração não pertence à conta desta conexão.'},{status:403});
  if(!config?.site_flow_id)return NextResponse.json({error:'Nenhum fluxo de site configurado para esta conexao.'},{status:404});
  const context={quiz:body.quiz||{},story:body.story||'',lyricText:body.lyric_text||body.lyricText||'',paid:!!body.paid,sourceOrderId:body.order_id||body.orderId||null};
  const musicRequest=body.music_request||body.musicRequest||context.lyricText||context.story||null;
  const {data,error}=await db.from('leads').insert({owner_id:config.owner_id,name:body.name,phone,source:'site',music_request:musicRequest,status:'waiting_pix',provider:connection.provider,connection_id:connection.id,external_order_id:context.sourceOrderId,order_context:context}).select().single();
  if(error)return NextResponse.json({error:error.message},{status:400});
  if(connection.status==='connected'){
    const {data:flow}=await db.from('flows').select('*').eq('id',config.site_flow_id).eq('owner_id',config.owner_id).maybeSingle();
    if(flow?.status==='active')await executeFlow({db,flow,lead:data,connection});
    else await sendText(connection,phone,`Ola, ${body.name}! Recebi os dados da sua música. Envie aqui o comprovante do Pix para continuarmos.`);
  }
  return NextResponse.json({received:true,execution_id:data.id,flow_id:config.site_flow_id},{status:201});
}
