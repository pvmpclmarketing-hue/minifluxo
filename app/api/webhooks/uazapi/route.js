import { NextResponse } from 'next/server';
import { adminClient } from '../../supabase';
import { hashSecret } from '../../connection-secrets';
import { executeFlow } from '../../flow-engine';

const digits=value=>String(value||'').replace(/\D/g,'');
const eventName=body=>String(body.EventType||body.event||body.type||body.data?.EventType||body.data?.event||'').toLowerCase();
function messageText(body){const data=body.data||body;const message=data.message||data.data?.message||{};const content=message.message||message;return data.text||data.body||message.text||content.conversation||content.extendedTextMessage?.text||content.imageMessage?.caption||content.videoMessage?.caption||'';}
function phoneFrom(body){const data=body.data||body;const message=data.message||data.data?.message||{};const chat=data.chat||data.data?.chat||{};const jid=data.phone||message.key?.remoteJidAlt||data.key?.remoteJidAlt||chat.phone||chat.remoteJidAlt||data.key?.remoteJid||message.key?.remoteJid||data.remoteJid||chat.remoteJid||chat.id||chat.jid||data.from||data.sender||'';return digits(String(jid).replace(/@.+$/,''));}
function eventToken(body){return body.token||body.instanceToken||body.data?.token||body.data?.instanceToken||'';}
function eventInstanceName(body){const data=body.data||body;return body.instanceName||body.instance?.name||data.instanceName||data.instance?.name||data.instance||body.instance||'';}
function contactName(body){const data=body.data||body;const chat=data.chat||data.data?.chat||{};const message=data.message||data.data?.message||{};const value=chat.lead_fullName||chat.lead_name||chat.name||chat.pushName||message.pushName||message.key?.pushName||data.pushName||'';return String(value).trim().slice(0,120);}
function fromMe(body){const data=body.data||body;const message=data.message||data.data?.message||{};return !!(data.key?.fromMe||message.key?.fromMe||data.fromMe||message.fromMe||data.wasSentByApi);}
function isConnected(body){const data=body.data||body;const value=data.status?.connected??data.connected??data.loggedIn??data.status??data.connection;return value===true||String(value||'').toLowerCase()==='connected'||String(value||'').toLowerCase()==='open';}

export async function POST(request){
  try{
    const body=await request.json();const event=eventName(body);const token=eventToken(body);const instanceName=String(eventInstanceName(body)||'');const phone=phoneFrom(body);const name=contactName(body);const ownMessage=fromMe(body);const db=adminClient();let connection=null;
    if(token){const result=await db.from('connections').select('*').eq('uazapi_token_hash',hashSecret(token)).maybeSingle();connection=result.data;}
    if(!connection&&instanceName){const result=await db.from('connections').select('*').eq('instance_name',instanceName).maybeSingle();connection=result.data;}
    console.info('[uazapi webhook]',{event,hasToken:Boolean(token),instanceName:instanceName||null,connectionMatched:Boolean(connection),hasPhone:Boolean(phone),hasName:Boolean(name),ownMessage,rootKeys:Object.keys(body).slice(0,12),dataKeys:Object.keys(body.data||{}).slice(0,12),chatKeys:Object.keys(body.chat||{}).slice(0,16),messageKeyKeys:Object.keys(body.message?.key||{}).slice(0,16)});
    if(!connection)return NextResponse.json({received:true,ignored:true});
    if(event==='connection'){const status=isConnected(body)?'connected':'disconnected';await db.from('connections').update({status}).eq('id',connection.id);return NextResponse.json({received:true,connection:status});}
    if(event!=='messages'||ownMessage)return NextResponse.json({received:true,ignored:true});
    const text=messageText(body);if(!phone)return NextResponse.json({received:true,ignored:true});
    const {data:config}=await db.from('connection_flow_configs').select('conversation_flow_id,owner_id').eq('connection_id',connection.id).maybeSingle();if(!config?.conversation_flow_id)return NextResponse.json({received:true,ignored:true});
    const {data:contacts=[]}=await db.from('leads').select('*').eq('connection_id',connection.id).eq('phone',phone).order('updated_at',{ascending:false});const existing=contacts.find(item=>item.status==='waiting_response'&&item.order_context?.flow_execution?.wait_node_id);
    if(existing){const context={...(existing.order_context||{}),last_message:text};const values={order_context:context,status:'in_progress',updated_at:new Date().toISOString()};if(name)values.name=name;const {data:lead}=await db.from('leads').update(values).eq('id',existing.id).select().single();const {data:flow}=await db.from('flows').select('*').eq('id',existing.order_context.flow_execution.flow_id).eq('owner_id',existing.owner_id).maybeSingle();if(flow?.status==='active')await executeFlow({db,flow,lead,connection,resumeAfterId:existing.order_context.flow_execution.wait_node_id});return NextResponse.json({received:true,resumed:true});}
    if(contacts.length){if(name)await db.from('leads').update({name,updated_at:new Date().toISOString()}).eq('id',contacts[0].id);return NextResponse.json({received:true,ignored:true,reason:'contact_already_in_history'});}
    const {data:flow}=await db.from('flows').select('*').eq('id',config.conversation_flow_id).eq('owner_id',config.owner_id).maybeSingle();if(!flow||flow.status!=='active')return NextResponse.json({received:true,ignored:true});const {data:lead,error}=await db.from('leads').insert({owner_id:config.owner_id,name:name||'Cliente WhatsApp',phone,source:'inbound',music_request:text,status:'in_progress',provider:'uazapi',connection_id:connection.id,order_context:{last_message:text,chat_history:[{role:'user',content:text}]}}).select().single();if(error)throw error;await executeFlow({db,flow,lead,connection});return NextResponse.json({received:true,started:true});
  }catch(error){console.error('[uazapi webhook] failed',{error:String(error)});return NextResponse.json({error:error.message},{status:500});}
}
