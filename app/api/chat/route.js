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
    return NextResponse.json({conversations:(data||[]).filter(lead=>!lead.order_context?.chat_archived_at).map(lead=>({...lead,messages:messagesFor(lead)}))});
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

export async function DELETE(){
  try{
    const user=await requireUser();const db=adminClient();const cutoff=new Date(Date.now()-72*60*60*1000).toISOString();
    const {data,error}=await db.from('leads').select('id,owner_id,order_context').eq('owner_id',user.id).lt('updated_at',cutoff).limit(1000);
    if(error)throw error;
    const eligible=(data||[]).filter(lead=>Array.isArray(lead.order_context?.chat_messages)||lead.order_context?.last_message);
    await Promise.all(eligible.map(lead=>{const {chat_messages,last_message,...context}=lead.order_context||{};return db.from('leads').update({order_context:{...context,chat_archived_at:new Date().toISOString()},updated_at:new Date().toISOString()}).eq('id',lead.id).eq('owner_id',user.id);}));
    return NextResponse.json({cleared:eligible.length,cutoff});
  }catch(error){return NextResponse.json({error:error.message||'Não foi possível limpar as conversas.'},{status:500});}
}
