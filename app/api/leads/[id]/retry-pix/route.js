import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../../../supabase';
import { executeFlow } from '../../../flow-engine';

export const runtime = 'nodejs';

export async function POST(_request,{params}) {
  try {
    const user=await requireUser();
    const {id}=await params;
    const db=adminClient();
    const {data:lead,error:leadError}=await db.from('leads').select('*').eq('id',id).eq('owner_id',user.id).maybeSingle();
    if(leadError)throw leadError;
    if(!lead)return NextResponse.json({error:'Lead não encontrado.'},{status:404});
    const {data:charges,error:chargeError}=await db.from('efi_pix_charges').select('txid,status,flow_id,node_id,expires_at').eq('lead_id',lead.id).eq('owner_id',user.id).order('created_at',{ascending:false}).limit(1);
    if(chargeError)throw chargeError;
    const charge=charges?.[0];
    if(!charge)return NextResponse.json({error:'Nenhuma cobrança Pix anterior encontrada para este lead.'},{status:409});
    if(charge.status==='paid')return NextResponse.json({error:'Este Pix já foi pago; não vou criar outra cobrança.'},{status:409});
    if(charge.status==='pending'&&Date.parse(charge.expires_at||'')>Date.now())return NextResponse.json({error:'A cobrança Pix ainda está válida. Use o código existente para evitar duplicidade.'},{status:409});
    const [{data:flow},{data:connection}]=await Promise.all([
      db.from('flows').select('*').eq('id',charge.flow_id).eq('owner_id',user.id).eq('status','active').maybeSingle(),
      db.from('connections').select('*').eq('id',lead.connection_id).eq('owner_id',user.id).eq('status','connected').maybeSingle()
    ]);
    if(!flow||!connection)return NextResponse.json({error:'O fluxo ou WhatsApp não está disponível.'},{status:409});
    const node=(Array.isArray(flow.nodes)?flow.nodes:[]).find(item=>item.id===charge.node_id&&item.data?.kind==='pixCopyPaste');
    if(!node)return NextResponse.json({error:'O card Pix não foi encontrado no fluxo.'},{status:409});
    const result=await executeFlow({db,flow,lead,connection,startAtId:node.id});
    return NextResponse.json({ok:result?.waiting===true,waiting:result?.waiting===true});
  } catch(error) {
    const message=error?.message||'Não foi possível gerar e enviar o Pix.';
    const status=message==='Não autenticado'?401:500;
    console.error('[pix retry] failed',{error:message});
    return NextResponse.json({error:message},{status});
  }
}
