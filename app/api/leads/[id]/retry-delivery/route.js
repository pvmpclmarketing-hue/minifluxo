import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../../../supabase';
import { retryKieDelivery } from '../../../flow-engine';

export async function POST(_request,{params}){
  try{
    const user=await requireUser();const {id}=await params;const db=adminClient();
    const {data:lead}=await db.from('leads').select('*').eq('id',id).eq('owner_id',user.id).eq('status','delivery_failed').maybeSingle();
    if(!lead)return NextResponse.json({error:'Entrega com falha não encontrada.'},{status:404});
    const execution=lead.order_context?.flow_execution;const {data:flow}=await db.from('flows').select('*').eq('id',execution?.flow_id).eq('owner_id',user.id).eq('status','active').maybeSingle();
    const {data:connection}=await db.from('connections').select('*').eq('id',lead.connection_id).eq('owner_id',user.id).eq('status','connected').maybeSingle();
    if(!flow||!connection)return NextResponse.json({error:'Fluxo ativo ou WhatsApp conectado não encontrado.'},{status:409});
    const result=await retryKieDelivery({db,flow,lead,connection});return NextResponse.json({received:true,result,status:'completed'});
  }catch(error){return NextResponse.json({error:error.message||'Não foi possível reenviar a música.'},{status:500});}
}
