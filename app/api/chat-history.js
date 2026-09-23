const MAX_MESSAGES=120;

export function messagesFor(lead){
  const saved=Array.isArray(lead?.order_context?.chat_messages)?lead.order_context.chat_messages:[];
  const legacy=lead?.order_context?.last_message;
  return saved.length?saved:(legacy?[{id:'legacy-last-message',direction:'in',type:'text',text:String(legacy),created_at:lead.updated_at||lead.created_at}]:[]);
}

export async function appendChatMessage(db,lead,message){
  const current=messagesFor(lead);
  const entry={id:message.id||`${Date.now()}-${Math.random().toString(36).slice(2,8)}`,direction:message.direction==='in'?'in':'out',type:message.type||'text',text:String(message.text||''),created_at:message.created_at||new Date().toISOString()};
  if(current.some(item=>item.id===entry.id))return lead;
  const order_context={...(lead.order_context||{}),chat_messages:[...current,entry].slice(-MAX_MESSAGES),...(entry.direction==='in'?{last_message:entry.text}:{})};
  const {data,error}=await db.from('leads').update({order_context,updated_at:new Date().toISOString()}).eq('id',lead.id).eq('owner_id',lead.owner_id).select().single();
  if(error)throw error;
  return data;
}
