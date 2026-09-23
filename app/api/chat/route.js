import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../supabase';
import { sendText } from '../provider';
import { appendChatMessage, messagesFor } from '../chat-history';

export const runtime='nodejs';

export async function GET(){
  try{
    const user=await requireUser();const db=adminClient();
    const {data,error}=await db.from('leads').select('id,name,phone,status,source,connection_id,created_at,updated_at,order_context').eq('owner_id',user.id).not('connection_id','is',null).order('updated_at',{ascending:false}).limit(100);
    if(error)throw error;
    return NextResponse.json({conversations:(data||[]).map(lead=>({...lead,messages:messagesFor(lead)}))});
  }catch(error){return NextResponse.json({error:error.message||'Não foi possível carregar as conversas.'},{status:500});}
}

export async function POST(request){
  try{
    const user=await requireUser();const body=await request.json();const leadId=String(body.lead_id||'');const text=String(body.text||'').trim();
    if(!leadId||!text)return NextResponse.json({error:'Conversa e mensagem são obrigatórias.'},{status:400});
    if(text.length>4096)return NextResponse.json({error:'A mensagem pode ter no máximo 4.096 caracteres.'},{status:400});
    const db=adminClient();const {data:lead,error}=await db.from('leads').select('*').eq('id',leadId).eq('owner_id',user.id).single();if(error||!lead)return NextResponse.json({error:'Conversa não encontrada.'},{status:404});
    const {data:connection}=await db.from('connections').select('*').eq('id',lead.connection_id).eq('owner_id',user.id).eq('provider','meta').eq('status','connected').maybeSingle();
    if(!connection)return NextResponse.json({error:'O canal oficial desta conversa não está conectado.'},{status:409});
    await sendText(connection,lead.phone,text);
    const updated=await appendChatMessage(db,lead,{direction:'out',type:'text',text});
    return NextResponse.json({conversation:{...updated,messages:messagesFor(updated)}});
  }catch(error){return NextResponse.json({error:error.message||'Não foi possível enviar a mensagem.'},{status:500});}
}
