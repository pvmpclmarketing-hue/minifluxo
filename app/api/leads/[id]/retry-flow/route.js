import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../../../supabase';
import { executeFlow } from '../../../flow-engine';

// Recupera uma execução que falhou depois de um Pix já confirmado. A rota é
// autenticada e usa o node_id gravado na própria cobrança, portanto não cria
// outro Pix nem reinicia as etapas anteriores do pedido.
export async function POST(_request,{params}){
  try{
    const user=await requireUser();const {id}=await params;const db=adminClient();
    const {data:lead}=await db.from('leads').select('*').eq('id',id).eq('owner_id',user.id).in('status',['in_progress','failed','error']).maybeSingle();
    if(!lead)return NextResponse.json({error:'Execução recuperável não encontrada.'},{status:404});
    const {data:charge}=await db.from('efi_pix_charges').select('flow_id,node_id').eq('lead_id',lead.id).eq('owner_id',user.id).eq('status','paid').order('paid_at',{ascending:false}).limit(1).maybeSingle();
    if(!charge?.flow_id||!charge?.node_id)return NextResponse.json({error:'Nenhum Pix pago disponível para retomar este fluxo.'},{status:409});
    const [{data:flow},{data:connection}]=await Promise.all([
      db.from('flows').select('*').eq('id',charge.flow_id).eq('owner_id',user.id).eq('status','active').maybeSingle(),
      db.from('connections').select('*').eq('id',lead.connection_id).eq('owner_id',user.id).eq('status','connected').maybeSingle(),
    ]);
    if(!flow||!connection)return NextResponse.json({error:'Fluxo ativo ou WhatsApp conectado não encontrado.'},{status:409});
    const {data:claimed,error}=await db.from('leads').update({status:'in_progress',order_context:{...(lead.order_context||{}),flow_execution:null},updated_at:new Date().toISOString()}).eq('id',lead.id).eq('owner_id',user.id).select().single();
    if(error)throw error;
    const result=await executeFlow({db,flow,lead:claimed,connection,resumeAfterId:charge.node_id});
    return NextResponse.json({received:true,result});
  }catch(error){console.error('[retry flow] failed',{lead_id:params?.id||null,error:error?.message||String(error)});return NextResponse.json({error:error.message||'Não foi possível retomar o fluxo.'},{status:500});}
}
