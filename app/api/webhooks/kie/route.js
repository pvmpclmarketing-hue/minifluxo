import { NextResponse } from 'next/server';
import { adminClient } from '../../supabase';
import { sendAudio, sendText } from '../../provider';

function audioUrls(value, found=new Set()) {
  if (!value) return [...found];
  if (Array.isArray(value)) { value.forEach(item=>audioUrls(item,found)); return [...found]; }
  if (typeof value==='object') { Object.entries(value).forEach(([key,item])=>{if(/audio|mp3|music/i.test(key)) audioUrls(item,found);}); return [...found]; }
  if (typeof value==='string' && /^https?:\/\//.test(value) && (/\.mp3([?#]|$)/i.test(value) || /audio|music/i.test(value))) found.add(value);
  return [...found];
}

export async function POST(request) {
  try {
    if(process.env.KIE_WEBHOOK_SECRET && request.headers.get('x-kie-signature')!==process.env.KIE_WEBHOOK_SECRET) return new NextResponse(null,{status:401});
    const body=await request.json(); const db=adminClient();
    const leadId=body.lead_id || body.leadId || body.metadata?.lead_id || body.data?.lead_id;
    const taskId=body.task_id || body.taskId || body.data?.task_id || body.data?.taskId;
    let query=db.from('leads').select('*'); query=leadId?query.eq('id',leadId):query.eq('kie_task_id',taskId); const {data:lead}=await query.maybeSingle();
    const urls=audioUrls(body).slice(0,2);
    if(!lead || urls.length===0) return NextResponse.json({received:true,ignored:true});
    let connection=lead.connection_id ? (await db.from('connections').select('*').eq('id',lead.connection_id).maybeSingle()).data : null;
    if(!connection) connection=(await db.from('connections').select('*').eq('owner_id',lead.owner_id).eq('status','connected').limit(1).maybeSingle()).data;
    if(!connection) throw new Error('WhatsApp da entrega nao esta conectado.');
    await sendText(connection,lead.phone,`Sua musica esta pronta, ${lead.name}! Vou enviar as ${urls.length} faixas em audio.`);
    for (let index=0; index<urls.length; index+=1) await sendAudio(connection,lead.phone,urls[index],`Musica ${index+1} de ${urls.length}`);
    await db.from('leads').update({status:'delivered',music_url:JSON.stringify(urls),updated_at:new Date().toISOString()}).eq('id',lead.id);
    return NextResponse.json({received:true,delivered:urls.length});
  } catch(error) { return NextResponse.json({error:error.message},{status:500}); }
}
