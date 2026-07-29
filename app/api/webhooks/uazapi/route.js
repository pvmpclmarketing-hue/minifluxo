import { NextResponse } from 'next/server';
import { adminClient } from '../../supabase';
import { hashSecret } from '../../connection-secrets';
import { executeFlow } from '../../flow-engine';

const digits=value=>String(value||'').replace(/\D/g,'');
function messageText(body){const data=body.data||body;const message=data.message||data.data?.message||{};return data.text||data.body||message.conversation||message.extendedTextMessage?.text||message.imageMessage?.caption||message.videoMessage?.caption||'';}
function phoneFrom(body){const data=body.data||body;const jid=data.key?.remoteJid||data.remoteJid||data.from||data.sender||'';return digits(String(jid).replace(/@.+$/,''));}
function eventToken(body){return body.token||body.instanceToken||body.data?.token||body.data?.instanceToken||'';}
function fromMe(body){const data=body.data||body;return !!(data.key?.fromMe||data.fromMe||data.wasSentByApi);}

export async function POST(request){
  try{
    const body=await request.json();if(body.EventType!=='messages'&&body.event!=='messages')return NextResponse.json({received:true,ignored:true});if(fromMe(body))return NextResponse.json({received:true,ignored:true});
    const token=eventToken(body);const phone=phoneFrom(body);const text=messageText(body);if(!token||!phone)return NextResponse.json({received:true,ignored:true});
    const db=adminClient();const {data:connection}=await db.from('connections').select('*').eq('uazapi_token_hash',hashSecret(token)).maybeSingle();if(!connection)return NextResponse.json({received:true,ignored:true});
    const {data:config}=await db.from('connection_flow_configs').select('conversation_flow_id,owner_id').eq('connection_id',connection.id).maybeSingle();if(!config?.conversation_flow_id)return NextResponse.json({received:true,ignored:true});
    const {data:existing}=await db.from('leads').select('*').eq('connection_id',connection.id).eq('phone',phone).eq('status','waiting_response').order('updated_at',{ascending:false}).limit(1).maybeSingle();
    if(existing?.order_context?.flow_execution?.wait_node_id){const context={...(existing.order_context||{}),last_message:text};const {data:lead}=await db.from('leads').update({order_context:context,status:'in_progress',updated_at:new Date().toISOString()}).eq('id',existing.id).select().single();const {data:flow}=await db.from('flows').select('*').eq('id',existing.order_context.flow_execution.flow_id).eq('owner_id',existing.owner_id).maybeSingle();if(flow?.status==='active')await executeFlow({db,flow,lead,connection,resumeAfterId:existing.order_context.flow_execution.wait_node_id});return NextResponse.json({received:true,resumed:true});}
    const {data:flow}=await db.from('flows').select('*').eq('id',config.conversation_flow_id).eq('owner_id',config.owner_id).maybeSingle();if(!flow||flow.status!=='active')return NextResponse.json({received:true,ignored:true});const {data:lead,error}=await db.from('leads').insert({owner_id:config.owner_id,name:'Cliente WhatsApp',phone,source:'manual',music_request:text,status:'in_progress',provider:'uazapi',connection_id:connection.id,order_context:{last_message:text,chat_history:[{role:'user',content:text}]}}).select().single();if(error)throw error;await executeFlow({db,flow,lead,connection});return NextResponse.json({received:true,started:true});
  }catch(error){console.error('[uazapi webhook] failed',{error:String(error)});return NextResponse.json({error:error.message},{status:500});}
}
