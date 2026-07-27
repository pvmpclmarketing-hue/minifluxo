import { NextResponse } from 'next/server';
import { adminClient } from '../../supabase';
import { sendText } from '../../provider';

async function resolveConnection(db,body) {
  if(body.integration_key){const {data:integration}=await db.from('site_integrations').select('connection_id').eq('integration_key',body.integration_key).maybeSingle();if(integration?.connection_id)return (await db.from('connections').select('*').eq('id',integration.connection_id).maybeSingle()).data;return (await db.from('connections').select('*').eq('site_integration_key',body.integration_key).maybeSingle()).data;}
  if(body.connection_id)return (await db.from('connections').select('*').eq('id',body.connection_id).maybeSingle()).data;
  return null;
}

export async function POST(request) {
  try {
    if(!process.env.PAYMENT_WEBHOOK_SECRET||request.headers.get('x-payment-secret')!==process.env.PAYMENT_WEBHOOK_SECRET)return new NextResponse(null,{status:401});
    const body=await request.json(); if(body.event!== 'PAYMENT_APPROVED')return NextResponse.json({received:true,ignored:true});
    if(!body.customer?.name||!body.customer?.phone)return NextResponse.json({error:'customer.name e customer.phone sao obrigatorios.'},{status:400});
    const db=adminClient(); const connection=await resolveConnection(db,body); if(!connection)return NextResponse.json({error:'Informe uma integration_key valida.'},{status:400});
    const {data:config,error:configError}=await db.from('connection_flow_configs').select('payment_flow_id,owner_id').eq('connection_id',connection.id).single();
    if(configError||!config?.payment_flow_id)return NextResponse.json({error:'Nenhum fluxo de pagamento configurado para esta conexao.'},{status:404});
    const {data:flow,error:flowError}=await db.from('flows').select('id,owner_id').eq('id',config.payment_flow_id).eq('owner_id',config.owner_id).single(); if(flowError||!flow)return NextResponse.json({error:'Fluxo configurado nao encontrado.'},{status:404});
    const phone=String(body.customer.phone).replace(/\D/g,''); const musicRequest=body.music_request||body.custom_fields?.story||body.custom_fields?.music_style||body.story||body.lyric_text||null;
    const orderContext={quiz:body.quiz||body.custom_fields?.quiz||{},story:body.story||'',lyricText:body.lyric_text||'',paid:true,sourceOrderId:body.order_id||body.orderId||null}; let lead;
    if(orderContext.sourceOrderId){const {data:existing}=await db.from('leads').select('id').eq('owner_id',flow.owner_id).eq('external_order_id',orderContext.sourceOrderId).maybeSingle();if(existing){const {data,error}=await db.from('leads').update({name:body.customer.name,phone,music_request:musicRequest,status:'generating',connection_id:connection.id,order_context:orderContext,updated_at:new Date().toISOString()}).eq('id',existing.id).select().single();if(error)throw error;lead=data;}}
    if(!lead){const {data,error}=await db.from('leads').insert({owner_id:flow.owner_id,name:body.customer.name,phone,source:'payment',music_request:musicRequest,status:'generating',provider:'payment',connection_id:connection.id,external_order_id:orderContext.sourceOrderId,order_context:orderContext}).select().single();if(error)throw error;lead=data;}
    if(connection.status==='connected')await sendText(connection,phone,`Pagamento confirmado, ${body.customer.name}! Sua musica entrou na fila de criacao.`);
    return NextResponse.json({received:true,execution_id:lead.id});
  } catch(error) { return NextResponse.json({error:error.message},{status:500}); }
}
