import { decryptSecret, hashSecret } from './connection-secrets';
import { sendAudio, sendText } from './provider';

const valueAt=(data,path)=>path.split('.').reduce((value,key)=>value?.[key],data);
const asText=value=>value==null?'':typeof value==='string'?value:JSON.stringify(value);
const render=(text,variables)=>String(text||'').replace(/\{([^}]+)\}/g,(_,path)=>asText(valueAt(variables,path.trim())));
const nextNode=(nodes,edges,nodeId,sourceHandle=null)=>{const matches=edges.filter(edge=>edge.source===nodeId);const selected=sourceHandle?matches.find(edge=>edge.sourceHandle===sourceHandle):matches.find(edge=>!edge.sourceHandle)||matches[0];return nodes.find(node=>node.id===selected?.target)||null;};
const modelName=value=>({ 'Suno V5':'V5','Suno V4.5':'V4_5' }[value]||value||'V5');
const delayMilliseconds=config=>{const amount=Math.max(1,Number(config.duration)||1);const multiplier={minutos:60000,horas:3600000,dias:86400000}[config.unit]||60000;return amount*multiplier;};
function assertExecutionScope(flow,lead,connection){
  if(!flow?.owner_id||!lead?.owner_id||!connection?.owner_id||!lead?.connection_id||flow.owner_id!==lead.owner_id||connection.owner_id!==lead.owner_id||connection.id!==lead.connection_id)throw new Error('Execução bloqueada: fluxo, conversa e WhatsApp não pertencem à mesma conta.');
}

function variablesFor(lead,extra={}){
  const context=lead.order_context||{};return {name:lead.name,phone:lead.phone,story:context.story||'',lyric_text:context.lyricText||lead.music_request||'',music_request:lead.music_request||'',last_message:context.last_message||'',quiz:context.quiz||{},flow_data:context.flow_data||{},paid:!!context.paid,lead:{id:lead.id,...lead},kie:{audios:extra.audios||[]},...extra};
}
function conditionMatches(config,variables){const received=valueAt(variables,config.field||'');const expected=render(config.value||'',variables);if(config.operator==='existe')return received!==undefined&&received!==null&&received!=='';if(config.operator==='contem')return asText(received).toLowerCase().includes(expected.toLowerCase());if(config.operator==='maior que')return Number(received)>Number(expected);return String(received).toLowerCase()===String(expected).toLowerCase();}
async function credentialsFor(db,flowId,ownerId){let owner=ownerId;if(!owner){const {data}=await db.from('flows').select('owner_id').eq('id',flowId).maybeSingle();owner=data?.owner_id;}const [{data:flowKeys},{data:accountKeys}]=await Promise.all([db.from('flow_credentials').select('kie_key_cipher,gpt_key_cipher').eq('flow_id',flowId).maybeSingle(),owner?db.from('account_credentials').select('kie_key_cipher,gpt_key_cipher').eq('owner_id',owner).maybeSingle():Promise.resolve({data:null})]);const keys={kie_key_cipher:accountKeys?.kie_key_cipher||flowKeys?.kie_key_cipher,gpt_key_cipher:accountKeys?.gpt_key_cipher||flowKeys?.gpt_key_cipher};return {kie:keys.kie_key_cipher?decryptSecret(keys.kie_key_cipher):null,gpt:keys.gpt_key_cipher?decryptSecret(keys.gpt_key_cipher):null};}
function setAt(object,path,value){const keys=String(path||'ai.response').split('.');const result={...(object||{})};let cursor=result;keys.forEach((key,index)=>{if(index===keys.length-1)cursor[key]=value;else {cursor[key]={...(cursor[key]||{})};cursor=cursor[key];}});return result;}
async function runAi(db,flow,lead,connection,node,variables){const config=node.data?.config||{};const key=(await credentialsFor(db,flow.id)).gpt||process.env.OPENAI_API_KEY;if(!key)throw new Error('Cadastre a chave GPT neste fluxo antes de usar o bloco de IA.');const context=lead.order_context||{};const history=Array.isArray(context.chat_history)?context.chat_history:[];const prompt=render(config.prompt||'Responda ao cliente de forma útil e objetiva.',variables);const messages=[{role:'system',content:prompt},{role:'user',content:`Dados do cliente: ${JSON.stringify({nome:lead.name,telefone:lead.phone,quiz:context.quiz||{},historia:context.story||''})}`},...history.slice(-8),{role:'user',content:context.last_message||'Inicie a conversa conforme sua instrução.'}];const response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:config.model||'gpt-4.1-mini',messages,temperature:0.7})});const raw=await response.text();let data={};try{data=JSON.parse(raw);}catch{}if(!response.ok)throw new Error(`GPT: ${response.status} ${data.error?.message||raw}`);const answer=data.choices?.[0]?.message?.content;if(!answer)throw new Error('GPT não retornou uma resposta.');const flowData=setAt(context.flow_data,config.saveTo||'ai.response',answer);const chatHistory=[...history,{role:'user',content:context.last_message||''},{role:'assistant',content:answer}].filter(item=>item.content);const orderContext={...context,flow_data:flowData,chat_history:chatHistory,flow_execution:null};const {data:updated,error}=await db.from('leads').update({order_context:orderContext,status:'in_progress',updated_at:new Date().toISOString()}).eq('id',lead.id).select().single();if(error)throw error;if(config.autoSend)await sendText(connection,lead.phone,answer);return {lead:updated,variables:variablesFor(updated)};}

async function startKie(db,flow,lead,node,variables){
  const key=(await credentialsFor(db,flow.id)).kie;if(!key)throw new Error('Cadastre a chave Kie.ai neste fluxo antes de gerar música.');
  const config=node.data?.config||{};
  // A URL fixa é preferível, mas o domínio da implantação é um fallback seguro
  // para que uma conta recém-publicada consiga receber o callback da Kie.
  const deploymentHost=process.env.VERCEL_PROJECT_PRODUCTION_URL||process.env.VERCEL_URL||'';
  const callbackBase=String(process.env.WHATSENTREGAVEL_URL||deploymentHost).replace(/^https?:\/\//,'').replace(/\/$/,'');
  if(!callbackBase)throw new Error('Não foi possível identificar a URL pública para o callback da Kie.');
  const callbackSecret=process.env.KIE_WEBHOOK_SECRET||(process.env.FLOW_SECRETS_KEY?hashSecret(`${process.env.FLOW_SECRETS_KEY}:kie-callback`):'');if(!callbackSecret)throw new Error('Configure KIE_WEBHOOK_SECRET ou FLOW_SECRETS_KEY na Vercel.');
  const quiz=variables.quiz||{};const prompt=variables.lyric_text||variables.music_request||variables.story;if(!prompt)throw new Error('O pedido não possui letra ou briefing para gerar a música.');
  const style=config.style||quiz.music_style||quiz.genre||quiz.genre_musical||'música personalizada emocionante';
  const title=`Música para ${lead.name}`.slice(0,80);const voice=quiz.voice_gender||quiz.vocal_gender||quiz.genero_voz;
  const payload={prompt:String(prompt).slice(0,5000),customMode:true,instrumental:!!config.instrumental,model:modelName(config.model),style:String(style).slice(0,1000),title,callBackUrl:`https://${callbackBase}/api/webhooks/kie?secret=${encodeURIComponent(callbackSecret)}`};
  if(voice==='m'||voice==='f')payload.vocalGender=voice;
  const response=await fetch(`${String(process.env.KIE_API_BASE_URL||'https://api.kie.ai').replace(/\/$/,'')}${process.env.KIE_MUSIC_ENDPOINT||'/api/v1/generate'}`,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});const raw=await response.text();let result={};try{result=JSON.parse(raw);}catch{}if(!response.ok)throw new Error(`Kie.ai: ${response.status} ${result.msg||raw}`);
  const taskId=result.data?.taskId||result.taskId;if(!taskId)throw new Error('A Kie.ai não retornou o identificador da geração.');
  const context={...(lead.order_context||{}),flow_execution:{flow_id:flow.id,kie_node_id:node.id}};await db.from('leads').update({status:'generating',kie_task_id:taskId,order_context:context,updated_at:new Date().toISOString()}).eq('id',lead.id);return {waitingKie:true,taskId};
}

export async function executeFlow({db,flow,lead,connection,resumeAfterId=null,audios=[]}){
  assertExecutionScope(flow,lead,connection);
  if(lead.status==='timed_out')return {completed:false,reason:'execution_timed_out'};
  const nodes=Array.isArray(flow.nodes)?flow.nodes:[];const edges=Array.isArray(flow.edges)?flow.edges:[];if(!nodes.length)return {completed:false,reason:'empty_flow'};
  const readyAudios=Array.isArray(audios)&&audios.length?audios:(Array.isArray(lead.order_context?.preview_audios)?lead.order_context.preview_audios:[]);
  let node=resumeAfterId?nextNode(nodes,edges,resumeAfterId):(nodes.find(item=>item.data?.kind==='start')||nodes[0]);if(node?.data?.kind==='start')node=nextNode(nodes,edges,node.id);let currentLead=lead;let variables=variablesFor(currentLead,{audios:readyAudios});
  for(let steps=0;node&&steps<50;steps+=1){const kind=node.data?.kind;const config=node.data?.config||{};
    if(kind==='message'){const text=render(config.message,variables);if(text)await sendText(connection,currentLead.phone,text);}
    if(kind==='wait'){if(config.preMessage)await sendText(connection,currentLead.phone,render(config.preMessage,variables));const context={...(currentLead.order_context||{}),flow_execution:{flow_id:flow.id,wait_node_id:node.id}};await db.from('leads').update({status:'waiting_response',order_context:context,updated_at:new Date().toISOString()}).eq('id',currentLead.id);return {waiting:true};}
    if(kind==='delay'){const resumeAt=new Date(Date.now()+delayMilliseconds(config)).toISOString();const context={...(currentLead.order_context||{}),flow_execution:{flow_id:flow.id,delay_node_id:node.id,resume_at:resumeAt}};await db.from('leads').update({status:'waiting_delay',order_context:context,updated_at:new Date().toISOString()}).eq('id',currentLead.id);return {waiting:true,resume_at:resumeAt};}
    if(kind==='ai'){const result=await runAi(db,flow,currentLead,connection,node,variables);currentLead=result.lead;variables={...result.variables,kie:{...(result.variables.kie||{}),audios:readyAudios}};}
    if(kind==='condition'){const matched=conditionMatches(config,variables);node=nextNode(nodes,edges,node.id,matched?'true':'false');if(!node)return {completed:false,reason:matched?'condition_true_path_missing':'condition_false_path_missing'};continue;}
    if(kind==='kie'){if(readyAudios.length){node=nextNode(nodes,edges,node.id);continue;}if(!variables.paid){await db.from('leads').update({status:'waiting_pix',updated_at:new Date().toISOString()}).eq('id',currentLead.id);return {waiting:true,reason:'payment_required'};}return startKie(db,flow,currentLead,node,variables);}
    if(kind==='deliver'||kind==='previewDeliver'){if(!readyAudios.length)return {completed:false,reason:kind==='previewDeliver'?'preview_audio_not_ready':'audio_not_ready'};const intro=render(config.intro||(kind==='previewDeliver'?'Sua música está pronta! Vou enviar as duas faixas da sua prévia em áudio.':'Sua música está pronta! Vou enviar as duas faixas em áudio.'),variables);if(intro)await sendText(connection,currentLead.phone,intro);for(let index=0;index<Math.min(2,readyAudios.length);index+=1)await sendAudio(connection,currentLead.phone,readyAudios[index],`Música ${index+1} de ${Math.min(2,readyAudios.length)}`);await db.from('leads').update({status:'completed',music_url:JSON.stringify(readyAudios.slice(0,2)),updated_at:new Date().toISOString()}).eq('id',currentLead.id);return {completed:true,delivered:Math.min(2,readyAudios.length)};}
    node=nextNode(nodes,edges,node.id);
  }return {completed:true};
}
