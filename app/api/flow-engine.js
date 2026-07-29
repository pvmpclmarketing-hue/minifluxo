import { decryptSecret } from './connection-secrets';
import { sendAudio, sendText } from './provider';

const valueAt=(data,path)=>path.split('.').reduce((value,key)=>value?.[key],data);
const asText=value=>value==null?'':typeof value==='string'?value:JSON.stringify(value);
const render=(text,variables)=>String(text||'').replace(/\{([^}]+)\}/g,(_,path)=>asText(valueAt(variables,path.trim())));
const nextNode=(nodes,edges,nodeId)=>nodes.find(node=>node.id===edges.find(edge=>edge.source===nodeId)?.target)||null;
const modelName=value=>({ 'Suno V5':'V5','Suno V4.5':'V4_5' }[value]||value||'V5');

function variablesFor(lead,extra={}){
  const context=lead.order_context||{};return {name:lead.name,phone:lead.phone,story:context.story||'',lyric_text:context.lyricText||lead.music_request||'',music_request:lead.music_request||'',quiz:context.quiz||{},paid:!!context.paid,lead:{id:lead.id,...lead},kie:{audios:extra.audios||[]},...extra};
}
function conditionMatches(config,variables){const received=valueAt(variables,config.field||'');const expected=render(config.value||'',variables);if(config.operator==='existe')return received!==undefined&&received!==null&&received!=='';if(config.operator==='contem')return asText(received).toLowerCase().includes(expected.toLowerCase());if(config.operator==='maior que')return Number(received)>Number(expected);return String(received).toLowerCase()===String(expected).toLowerCase();}
async function credentialsFor(db,flowId){const {data}=await db.from('flow_credentials').select('kie_key_cipher').eq('flow_id',flowId).maybeSingle();return data?.kie_key_cipher?decryptSecret(data.kie_key_cipher):null;}

async function startKie(db,flow,lead,node,variables){
  const key=await credentialsFor(db,flow.id);if(!key)throw new Error('Cadastre a chave Kie.ai neste fluxo antes de gerar música.');
  const config=node.data?.config||{};const callbackBase=String(process.env.WHATSENTREGAVEL_URL||'').replace(/\/$/,'');if(!callbackBase)throw new Error('Configure WHATSENTREGAVEL_URL na Vercel.');
  const callbackSecret=process.env.KIE_WEBHOOK_SECRET;if(!callbackSecret)throw new Error('Configure KIE_WEBHOOK_SECRET na Vercel.');
  const quiz=variables.quiz||{};const prompt=variables.lyric_text||variables.music_request||variables.story;if(!prompt)throw new Error('O pedido não possui letra ou briefing para gerar a música.');
  const style=config.style||quiz.music_style||quiz.genre||quiz.genre_musical||'música personalizada emocionante';
  const title=`Música para ${lead.name}`.slice(0,80);const voice=quiz.voice_gender||quiz.vocal_gender||quiz.genero_voz;
  const payload={prompt:String(prompt).slice(0,5000),customMode:true,instrumental:!!config.instrumental,model:modelName(config.model),style:String(style).slice(0,1000),title,callBackUrl:`${callbackBase}/api/webhooks/kie?secret=${encodeURIComponent(callbackSecret)}`};
  if(voice==='m'||voice==='f')payload.vocalGender=voice;
  const response=await fetch(`${String(process.env.KIE_API_BASE_URL||'https://api.kie.ai').replace(/\/$/,'')}${process.env.KIE_MUSIC_ENDPOINT||'/api/v1/generate'}`,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});const raw=await response.text();let result={};try{result=JSON.parse(raw);}catch{}if(!response.ok)throw new Error(`Kie.ai: ${response.status} ${result.msg||raw}`);
  const taskId=result.data?.taskId||result.taskId;if(!taskId)throw new Error('A Kie.ai não retornou o identificador da geração.');
  const context={...(lead.order_context||{}),flow_execution:{flow_id:flow.id,kie_node_id:node.id}};await db.from('leads').update({status:'generating',kie_task_id:taskId,order_context:context,updated_at:new Date().toISOString()}).eq('id',lead.id);return {waitingKie:true,taskId};
}

export async function executeFlow({db,flow,lead,connection,resumeAfterId=null,audios=[]}){
  const nodes=Array.isArray(flow.nodes)?flow.nodes:[];const edges=Array.isArray(flow.edges)?flow.edges:[];if(!nodes.length)return {completed:false,reason:'empty_flow'};
  let node=resumeAfterId?nextNode(nodes,edges,resumeAfterId):(nodes.find(item=>item.data?.kind==='start')||nodes[0]);if(node?.data?.kind==='start')node=nextNode(nodes,edges,node.id);let currentLead=lead;let variables=variablesFor(currentLead,{audios});
  for(let steps=0;node&&steps<50;steps+=1){const kind=node.data?.kind;const config=node.data?.config||{};
    if(kind==='message'){const text=render(config.message,variables);if(text)await sendText(connection,currentLead.phone,text);}
    if(kind==='wait'){if(config.preMessage)await sendText(connection,currentLead.phone,render(config.preMessage,variables));await db.from('leads').update({status:'waiting_response',updated_at:new Date().toISOString()}).eq('id',currentLead.id);return {waiting:true};}
    if(kind==='condition'&&!conditionMatches(config,variables))return {completed:false,reason:'condition_not_matched'};
    if(kind==='kie'){if(!variables.paid){await db.from('leads').update({status:'waiting_pix',updated_at:new Date().toISOString()}).eq('id',currentLead.id);return {waiting:true,reason:'payment_required'};}return startKie(db,flow,currentLead,node,variables);}
    if(kind==='deliver'){if(!audios.length)return {completed:false,reason:'audio_not_ready'};const intro=render(config.intro||'Sua música está pronta! Vou enviar as duas faixas em áudio.',variables);if(intro)await sendText(connection,currentLead.phone,intro);for(let index=0;index<Math.min(2,audios.length);index+=1)await sendAudio(connection,currentLead.phone,audios[index],`Música ${index+1} de ${Math.min(2,audios.length)}`);await db.from('leads').update({status:'completed',music_url:JSON.stringify(audios.slice(0,2)),updated_at:new Date().toISOString()}).eq('id',currentLead.id);return {completed:true,delivered:Math.min(2,audios.length)};}
    node=nextNode(nodes,edges,node.id);
  }return {completed:true};
}
