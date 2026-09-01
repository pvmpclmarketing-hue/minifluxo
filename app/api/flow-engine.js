import https from 'https';
import { createHash } from 'crypto';
import { decryptSecret, hashSecret } from './connection-secrets';
import { sendAudio, sendMenu, sendPixCopyButton, sendText } from './provider';

const valueAt=(data,path)=>path.split('.').reduce((value,key)=>value?.[key],data);
const asText=value=>value==null?'':typeof value==='string'?value:JSON.stringify(value);
const render=(text,variables)=>String(text||'').replace(/\{([^}]+)\}/g,(_,path)=>asText(valueAt(variables,path.trim())));
const nextNode=(nodes,edges,nodeId,sourceHandle=null)=>{const matches=edges.filter(edge=>edge.source===nodeId);const selected=sourceHandle?matches.find(edge=>edge.sourceHandle===sourceHandle):matches.find(edge=>!edge.sourceHandle)||matches[0];return nodes.find(node=>node.id===selected?.target)||null;};
const modelName=value=>({ 'Suno V5':'V5','Suno V4.5':'V4_5' }[value]||value||'V5');
const delayMilliseconds=config=>{const amount=Math.max(1,Number(config.duration)||1);const multiplier={minutos:60000,horas:3600000,dias:86400000}[config.unit]||60000;return amount*multiplier;};
function assertExecutionScope(flow,lead,connection){
  if(!flow?.owner_id||!lead?.owner_id||!connection?.owner_id||!lead?.connection_id||flow.owner_id!==lead.owner_id||connection.owner_id!==lead.owner_id||connection.id!==lead.connection_id)throw new Error('Execução bloqueada: fluxo, conversa e WhatsApp não pertencem à mesma conta.');
}
function audioUrls(value,found=new Set()){
  if(!value)return [...found];if(Array.isArray(value)){value.forEach(item=>audioUrls(item,found));return [...found];}
  if(typeof value==='object'){Object.entries(value).forEach(([key,item])=>{const normalizedKey=key.replace(/[^a-z0-9]/gi,'').toLowerCase();if(normalizedKey==='audiourl'&&typeof item==='string'&&/^https?:\/\//.test(item))found.add(item);else if(item&&typeof item==='object')audioUrls(item,found);});return [...found];}
  return [...found];
}
async function saveDeliveryProgress(db,lead,connection,audios,progress,status='delivering'){
  const orderContext={...(lead.order_context||{}),delivery:{...(lead.order_context?.delivery||{}),audios,sent_indexes:progress.sent_indexes||[],intro_sent:!!progress.intro_sent}};
  const {data,error}=await db.from('leads').update({status,order_context:orderContext,updated_at:new Date().toISOString()}).eq('id',lead.id).eq('owner_id',lead.owner_id).eq('connection_id',connection.id).select().single();if(error)throw error;return data;
}
async function completeLead(db,lead,connection,extra={}){
  const orderContext={...(lead.order_context||{}),flow_execution:null};
  const {data,error}=await db.from('leads').update({status:'completed',order_context:orderContext,updated_at:new Date().toISOString(),...extra}).eq('id',lead.id).eq('owner_id',lead.owner_id).eq('connection_id',connection.id).select().single();
  if(error)throw error;
  return data;
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function sendAudioConfirmed(connection,phone,audio,index,total){
  let lastError;for(let attempt=1;attempt<=3;attempt+=1){try{console.info('[music delivery] sending track',{track:index+1,attempt});const result=await sendAudio(connection,phone,audio,`Música ${index+1} de ${total}`);console.info('[music delivery] track accepted',{track:index+1,attempt});return result;}catch(error){lastError=error;console.error('[music delivery] track failed',{track:index+1,attempt,error:error?.message||String(error)});if(attempt<3)await wait(attempt*1500);}}throw lastError;
}
async function deliverAudioTracks(db,lead,connection,audios,intro){
  const saved=lead.order_context?.delivery||{};let currentLead=lead;let sentIndexes=Array.isArray(saved.sent_indexes)?saved.sent_indexes:[];let introSent=!!saved.intro_sent;
  if(intro&&!introSent){await sendText(connection,currentLead.phone,intro);introSent=true;currentLead=await saveDeliveryProgress(db,currentLead,connection,audios,{sent_indexes:sentIndexes,intro_sent:introSent});}
  const total=Math.min(2,audios.length);for(let index=0;index<total;index+=1){if(sentIndexes.includes(index))continue;await sendAudioConfirmed(connection,currentLead.phone,audios[index],index,total);sentIndexes=[...sentIndexes,index];currentLead=await saveDeliveryProgress(db,currentLead,connection,audios,{sent_indexes:sentIndexes,intro_sent:introSent});if(index<total-1)await wait(Number(process.env.AUDIO_SEND_INTERVAL_MS||2000));}
  return currentLead;
}

function variablesFor(lead,extra={}){
  const context=lead.order_context||{};return {name:lead.name,phone:lead.phone,story:context.story||'',lyric_text:context.lyricText||lead.music_request||'',music_request:lead.music_request||'',last_message:context.last_message||'',quiz:context.quiz||{},flow_data:context.flow_data||{},paid:!!context.paid,lead:{id:lead.id,...lead},kie:{audios:extra.audios||[]},...extra};
}
function conditionMatches(config,variables){const received=valueAt(variables,config.field||'');const expected=render(config.value||'',variables);if(config.operator==='existe')return received!==undefined&&received!==null&&received!=='';if(config.operator==='contem')return asText(received).toLowerCase().includes(expected.toLowerCase());if(config.operator==='maior que')return Number(received)>Number(expected);return String(received).toLowerCase()===String(expected).toLowerCase();}
const comparable=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
export function resolveMenuChoice(node,text){const config=node?.data?.config||{};const choices=Array.isArray(config.choices)?config.choices.filter(item=>String(item?.label||'').trim()).slice(0,3):[];const received=comparable(text);const internalMatch=received.match(/^menu-option-(\d+)$/);const number=Number(received);let index=internalMatch?Number(internalMatch[1]):Number.isInteger(number)&&number>=1&&number<=choices.length?number-1:choices.findIndex(item=>comparable(item.label)===received);if(!Number.isInteger(index)||index<0||index>=choices.length)index=-1;const option=index>=0?choices[index]:null;return {sourceHandle:option?`option-${index}`:'other',saveTo:/^[a-zA-Z0-9_.]+$/.test(config.saveTo||'menu.escolha')?config.saveTo||'menu.escolha':'menu.escolha',selection:{index:index>=0?index+1:null,label:option?.label||null,resposta:String(text||'')}};}
export async function credentialsFor(db,flowId,ownerId){let owner=ownerId;if(!owner){const {data}=await db.from('flows').select('owner_id').eq('id',flowId).maybeSingle();owner=data?.owner_id;}const [{data:flowKeys},{data:accountKeys}]=await Promise.all([db.from('flow_credentials').select('kie_key_cipher,gpt_key_cipher').eq('flow_id',flowId).maybeSingle(),owner?db.from('account_credentials').select('gpt_key_cipher,kie_key_cipher,efi_client_id_cipher,efi_client_secret_cipher,efi_certificate_p12_cipher,efi_certificate_password_cipher,efi_pix_key_cipher,efi_environment').eq('owner_id',owner).maybeSingle():Promise.resolve({data:null})]);const keys={kie_key_cipher:accountKeys?.kie_key_cipher||flowKeys?.kie_key_cipher,gpt_key_cipher:accountKeys?.gpt_key_cipher||flowKeys?.gpt_key_cipher};return {kie:keys.kie_key_cipher?decryptSecret(keys.kie_key_cipher):null,gpt:keys.gpt_key_cipher?decryptSecret(keys.gpt_key_cipher):null,efi:accountKeys?.efi_client_id_cipher&&accountKeys?.efi_client_secret_cipher&&accountKeys?.efi_certificate_p12_cipher&&accountKeys?.efi_pix_key_cipher?{clientId:decryptSecret(accountKeys.efi_client_id_cipher),clientSecret:decryptSecret(accountKeys.efi_client_secret_cipher),certificateP12:decryptSecret(accountKeys.efi_certificate_p12_cipher),certificatePassword:accountKeys.efi_certificate_password_cipher?decryptSecret(accountKeys.efi_certificate_password_cipher):undefined,pixKey:decryptSecret(accountKeys.efi_pix_key_cipher),environment:accountKeys.efi_environment==='homologation'?'homologation':'production'}:null};}
function setAt(object,path,value){const keys=String(path||'ai.response').split('.');const result={...(object||{})};let cursor=result;keys.forEach((key,index)=>{if(index===keys.length-1)cursor[key]=value;else {cursor[key]={...(cursor[key]||{})};cursor=cursor[key];}});return result;}
export function efiRequest({hostname,path,method='POST',headers={},body='',pfx,passphrase}){return new Promise((resolve,reject)=>{const request=https.request({hostname,path,method,servername:hostname,family:4,minVersion:'TLSv1.2',headers:{...headers,'Content-Length':Buffer.byteLength(body)},pfx,passphrase,rejectUnauthorized:true,timeout:45000},response=>{let raw='';response.setEncoding('utf8');response.on('data',chunk=>{raw+=chunk;});response.on('end',()=>{let data={};try{data=JSON.parse(raw);}catch{}resolve({status:response.statusCode||500,data,raw});});});request.on('timeout',()=>request.destroy(new Error('A Efi demorou demais para responder.')));request.on('error',reject);if(body)request.write(body);request.end();});}
function pixAmount(value){const raw=String(value??'').trim();const normalized=raw.includes(',')?raw.replace(/\./g,'').replace(',','.'):raw;const amount=Number(normalized);if(!Number.isFinite(amount)||amount<=0)throw new Error('Defina um valor Pix maior que zero no card.');return amount.toFixed(2);}
async function runPixCopyPaste(db,flow,lead,connection,node,variables){
  const config=node.data?.config||{};const saveTo=/^[a-zA-Z0-9_.]+$/.test(config.saveTo||'pix')?config.saveTo||'pix':'pix';const context=lead.order_context||{};const existing=valueAt(context.flow_data||{},saveTo);
  if(existing?.copia_e_cola){await sendPixCopyButton(connection,lead.phone,existing.copia_e_cola,existing.valor||'');return {lead,variables};}
  const efi=(await credentialsFor(db,flow.id,flow.owner_id)).efi;if(!efi)throw new Error('Cadastre Client ID, Client Secret, certificado P12 e chave Pix da Efi na aba APIs antes de usar este card.');
  const hostname=efi.environment==='homologation'?'pix-h.api.efipay.com.br':'pix.api.efipay.com.br';const pfx=Buffer.from(efi.certificateP12,'base64');if(!pfx.length)throw new Error('O certificado P12 da Efi está inválido. Envie-o novamente na aba APIs.');
  const basic=Buffer.from(`${efi.clientId}:${efi.clientSecret}`).toString('base64');const tokenResponse=await efiRequest({hostname,path:'/oauth/token',headers:{Authorization:`Basic ${basic}`,'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials',pfx,passphrase:efi.certificatePassword});
  if(tokenResponse.status<200||tokenResponse.status>=300||!tokenResponse.data.access_token)throw new Error(`Efi OAuth: ${tokenResponse.data?.mensagem||tokenResponse.data?.message||tokenResponse.raw||tokenResponse.status}`);
  const expiration=Math.max(1,Math.floor(Number(config.expiration)||3600));const txid=createHash('sha256').update(`${lead.id}:${node.id}`).digest('hex').slice(0,32);const payload={calendario:{expiracao:expiration},valor:{original:pixAmount(render(config.amount||'',variables))},chave:efi.pixKey,solicitacaoPagador:render(config.description||'Pagamento do pedido',variables).slice(0,140)};
  const charge=await efiRequest({hostname,path:`/v2/cob/${txid}`,method:'PUT',headers:{Authorization:`Bearer ${tokenResponse.data.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(payload),pfx,passphrase:efi.certificatePassword});
  const code=charge.data?.pixCopiaECola;if(charge.status<200||charge.status>=300||!code)throw new Error(`Efi Pix: ${charge.data?.mensagem||charge.data?.message||charge.raw||charge.status}`);
  const actualTxid=charge.data.txid||txid;const flowData=setAt(context.flow_data,saveTo,{copia_e_cola:code,txid:actualTxid,valor:payload.valor.original,expira_em_segundos:expiration,criado_em:new Date().toISOString()});const {data:updated,error}=await db.from('leads').update({order_context:{...context,flow_data:flowData,flow_execution:{flow_id:flow.id,pix_node_id:node.id}},status:'waiting_pix',updated_at:new Date().toISOString()}).eq('id',lead.id).eq('owner_id',lead.owner_id).eq('connection_id',connection.id).select().single();if(error)throw error;
  const {error:chargeError}=await db.from('efi_pix_charges').upsert({txid:actualTxid,owner_id:flow.owner_id,lead_id:updated.id,connection_id:connection.id,flow_id:flow.id,node_id:node.id,status:'pending',amount:payload.valor.original,expires_at:new Date(Date.now()+expiration*1000).toISOString(),updated_at:new Date().toISOString()},{onConflict:'txid'});if(chargeError)throw chargeError;
  await sendPixCopyButton(connection,updated.phone,code,payload.valor.original);return {waiting:true,lead:updated,variables:variablesFor(updated)};
}
async function runAi(db,flow,lead,connection,node,variables){const config=node.data?.config||{};const key=(await credentialsFor(db,flow.id)).gpt||process.env.OPENAI_API_KEY;if(!key)throw new Error('Cadastre a chave GPT neste fluxo antes de usar o bloco de IA.');const context=lead.order_context||{};const history=Array.isArray(context.chat_history)?context.chat_history:[];const prompt=render(config.prompt||'Responda ao cliente de forma útil e objetiva.',variables);const messages=[{role:'system',content:prompt},{role:'user',content:`Dados do cliente: ${JSON.stringify({nome:lead.name,telefone:lead.phone,quiz:context.quiz||{},historia:context.story||''})}`},...history.slice(-8),{role:'user',content:context.last_message||'Inicie a conversa conforme sua instrução.'}];const response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:config.model||'gpt-4.1-mini',messages})});const raw=await response.text();let data={};try{data=JSON.parse(raw);}catch{}if(!response.ok)throw new Error(`GPT: ${response.status} ${data.error?.message||raw}`);const answer=data.choices?.[0]?.message?.content;if(!answer)throw new Error('GPT não retornou uma resposta.');const flowData=setAt(context.flow_data,config.saveTo||'ai.response',answer);const chatHistory=[...history,{role:'user',content:context.last_message||''},{role:'assistant',content:answer}].filter(item=>item.content);const orderContext={...context,flow_data:flowData,chat_history:chatHistory,flow_execution:null};const {data:updated,error}=await db.from('leads').update({order_context:orderContext,status:'in_progress',updated_at:new Date().toISOString()}).eq('id',lead.id).select().single();if(error)throw error;if(config.autoSend)await sendText(connection,lead.phone,answer);return {lead:updated,variables:variablesFor(updated)};}

const MESSAGE_AGENT_PROMPT=`Você é um agente especialista em criar mensagens emocionais, naturais e personalizadas para acompanhar o envio de uma música feita especialmente para alguém.

Você receberá nome da pessoa homenageada, história contada pelo cliente, relação entre quem envia e quem recebe e contexto da homenagem. Crie exatamente 3 mensagens diferentes.

As mensagens acompanham uma música personalizada e devem preparar a pessoa para a surpresa. Cada uma deve parecer escrita pela própria pessoa que envia, ter ligação clara com fatos reais da história, demonstrar sentimento específico, avisar naturalmente que há uma surpresa e deixar claro que é uma música feita especialmente para a pessoa. Convide a pessoa a ouvir com atenção, sem contar toda a história antes da música.

Escreva como WhatsApp real: íntimo, espontâneo, emocional, sem formalidade e sem frases genéricas. Cada mensagem deve ter 5 a 8 frases curtas e entre 60 e 120 palavras. Escolha só um ou dois elementos fortes da história. Respeite nome, relação, pronomes, ocasião e apelidos existentes; nunca invente fatos, apelidos ou sentimentos contraditórios.

Mensagem 1 — EMOCIONAL: a mais sentimental, com construção emocional antes de revelar a música.
Mensagem 2 — NATURAL: espontânea e cotidiana, como uma mensagem real antes de enviar um áudio.
Mensagem 3 — SURPRESA: comece despertando curiosidade e revele a música ao longo do texto. A última frase deve incentivar o play.

No máximo 2 emojis por mensagem, apenas se combinarem. Nunca mencione IA, tecnologia, prompt, algoritmo, plataforma, preço, compra ou processo de criação. Não transforme o texto em letra de música ou propaganda.

Escreva em parágrafos naturais de WhatsApp. Não use hífen, travessão, marcadores, listas ou linhas começando com "-" no texto das mensagens. Use frases corridas, pontuação comum e quebras de parágrafo somente quando ajudarem a leitura.

Retorne somente neste formato exato:
Mensagem 1:
[texto]

Mensagem 2:
[texto]

Mensagem 3:
[texto]`;
function parsePersonalizedMessages(answer){
  // GPT pode devolver os mesmos títulos em Markdown (por exemplo, **Mensagem
  // 1 — Emocional:**). Aceitamos a apresentação, mas nunca seguimos sem as 3.
  const clean=String(answer||'').replace(/\r/g,'').replace(/\*\*/g,'').replace(/__/g,'').replace(/^\s*#{1,6}\s*/gm,'');
  const markers=[...clean.matchAll(/(?:^|\n)\s*Mensagem\s*([123])(?:\s*[-—–]\s*[^\n:]*)?\s*:?\s*/gi)];
  const parts={};markers.forEach((marker,index)=>{const next=markers[index+1];parts[marker[1]]=clean.slice((marker.index||0)+marker[0].length,next?.index).trim();});
  if(!parts[1]||!parts[2]||!parts[3])throw new Error('O agente não retornou as três mensagens no formato esperado.');
  return {emocional:parts[1],natural:parts[2],surpresa:parts[3]};
}
async function runMessageAgent(db,flow,lead,connection,node){
  const config=node.data?.config||{};const key=(await credentialsFor(db,flow.id,flow.owner_id)).gpt||process.env.OPENAI_API_KEY;
  if(!key)throw new Error('Cadastre a chave GPT neste fluxo antes de usar o Agente de mensagens.');
  const context=lead.order_context||{};const quiz=context.quiz||{};
  const leadContext={nome_homenageado:quiz.honoree||quiz.nome_homenageado||lead.name||'',historia:context.story||lead.music_request||'',relacao:quiz.relationship||quiz.relacao||context.relationship||context.relacao||quiz.recipient||'',contexto:quiz.occasion||quiz.ocasion||context.occasion||context.ocasion||'',genero_voz:quiz.voice_gender||quiz.vocal_gender||''};
  // Modelos GPT-5 aceitam somente a temperatura padrão. Omitimos a opção para
  // manter compatibilidade também com os demais modelos selecionáveis no canvas.
  const response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:config.model||'gpt-5.4-mini',messages:[{role:'system',content:MESSAGE_AGENT_PROMPT},{role:'user',content:`Dados reais do lead (use somente estes dados): ${JSON.stringify(leadContext)}`}]})});
  const raw=await response.text();let data={};try{data=JSON.parse(raw);}catch{}if(!response.ok)throw new Error(`GPT: ${response.status} ${data.error?.message||raw}`);
  const answer=data.choices?.[0]?.message?.content;if(!answer)throw new Error('GPT não retornou as mensagens personalizadas.');
  const messages=parsePersonalizedMessages(answer);const flowData=setAt(context.flow_data,config.saveTo||'mensagens_personalizadas',messages);
  const {data:updated,error}=await db.from('leads').update({order_context:{...context,flow_data:flowData,flow_execution:null},status:'in_progress',updated_at:new Date().toISOString()}).eq('id',lead.id).eq('owner_id',lead.owner_id).eq('connection_id',lead.connection_id).select().single();
  if(error)throw error;
  const intro=render(config.intro||'Aqui estão as 3 versões das suas mensagens. Escolha a que mais combina com você e copie para enviar junto da música:',variablesFor(updated));
  if(intro)await sendText(connection,updated.phone,intro);
  // Cada versão chega isolada, pronta para o cliente copiar, sem um título
  // que interfira no texto que ele deseja encaminhar.
  await sendText(connection,updated.phone,messages.emocional);
  await sendText(connection,updated.phone,messages.natural);
  await sendText(connection,updated.phone,messages.surpresa);
  return {lead:updated,variables:variablesFor(updated)};
}

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
  const endpoint=`${String(process.env.KIE_API_BASE_URL||'https://api.kie.ai').replace(/\/$/,'')}${process.env.KIE_MUSIC_ENDPOINT||'/api/v1/generate'}`;
  const response=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const raw=await response.text();let result={};try{result=JSON.parse(raw);}catch{}
  const providerMessage=result.msg||result.message||result.error?.message||'';
  if(!response.ok)throw new Error(`Kie.ai: ${response.status} ${providerMessage||'não foi possível iniciar a geração.'}`);
  if(result.code!==undefined&&Number(result.code)!==200)throw new Error(`Kie.ai: ${providerMessage||`código ${result.code}`}`);
  const taskId=result.data?.taskId||result.data?.task_id||result.taskId||result.task_id||result.data?.id||result.id;
  if(!taskId){console.error('[kie generation] missing task id',{status:response.status,api_code:result.code??null,message:providerMessage||null,endpoint:new URL(endpoint).pathname,result_keys:Object.keys(result),data_keys:result.data&&typeof result.data==='object'?Object.keys(result.data):[]});throw new Error(`Kie.ai não iniciou a geração: ${providerMessage||'resposta sem identificador da tarefa.'}`);}
  console.info('[kie generation] task accepted',{task_id:String(taskId),endpoint:new URL(endpoint).pathname});
  const context={...(lead.order_context||{}),flow_execution:{flow_id:flow.id,kie_node_id:node.id}};await db.from('leads').update({status:'generating',kie_task_id:taskId,order_context:context,updated_at:new Date().toISOString()}).eq('id',lead.id);return {waitingKie:true,taskId};
}

export async function executeFlow({db,flow,lead,connection,resumeAfterId=null,resumeHandle=null,audios=[]}){
  assertExecutionScope(flow,lead,connection);
  if(lead.status==='timed_out')return {completed:false,reason:'execution_timed_out'};
  const nodes=Array.isArray(flow.nodes)?flow.nodes:[];const edges=Array.isArray(flow.edges)?flow.edges:[];if(!nodes.length)return {completed:false,reason:'empty_flow'};
  const readyAudios=Array.isArray(audios)&&audios.length?audios:(Array.isArray(lead.order_context?.preview_audios)?lead.order_context.preview_audios:[]);
  let node=resumeAfterId?nextNode(nodes,edges,resumeAfterId,resumeHandle):(nodes.find(item=>item.data?.kind==='start')||nodes[0]);if(node?.data?.kind==='start')node=nextNode(nodes,edges,node.id);let currentLead=lead;let variables=variablesFor(currentLead,{audios:readyAudios});
  for(let steps=0;node&&steps<50;steps+=1){const kind=node.data?.kind;const config=node.data?.config||{};
    if(kind==='message'){const text=render(config.message,variables);if(text)await sendText(connection,currentLead.phone,text);}
    if(kind==='menu'){const choices=(Array.isArray(config.choices)?config.choices:[]).filter(item=>String(item?.label||'').trim()).slice(0,3);if(!choices.length)throw new Error('Adicione ao menos uma opção ao card Menu.');const text=render(config.message||'Escolha uma opção:',variables);await sendMenu(connection,currentLead.phone,text,choices.map(item=>({...item,label:render(item.label,variables)})));const context={...(currentLead.order_context||{}),flow_execution:{flow_id:flow.id,menu_node_id:node.id}};await db.from('leads').update({status:'waiting_response',order_context:context,updated_at:new Date().toISOString()}).eq('id',currentLead.id).eq('owner_id',currentLead.owner_id).eq('connection_id',connection.id);return {waiting:true};}
    if(kind==='wait'){if(config.preMessage)await sendText(connection,currentLead.phone,render(config.preMessage,variables));const context={...(currentLead.order_context||{}),flow_execution:{flow_id:flow.id,wait_node_id:node.id}};await db.from('leads').update({status:'waiting_response',order_context:context,updated_at:new Date().toISOString()}).eq('id',currentLead.id);return {waiting:true};}
    if(kind==='delay'){const resumeAt=new Date(Date.now()+delayMilliseconds(config)).toISOString();const context={...(currentLead.order_context||{}),flow_execution:{flow_id:flow.id,delay_node_id:node.id,resume_at:resumeAt}};await db.from('leads').update({status:'waiting_delay',order_context:context,updated_at:new Date().toISOString()}).eq('id',currentLead.id);return {waiting:true,resume_at:resumeAt};}
    if(kind==='ai'){const result=await runAi(db,flow,currentLead,connection,node,variables);currentLead=result.lead;variables={...result.variables,kie:{...(result.variables.kie||{}),audios:readyAudios}};}
    if(kind==='messageAgent'){const result=await runMessageAgent(db,flow,currentLead,connection,node);currentLead=result.lead;variables={...result.variables,kie:{...(result.variables.kie||{}),audios:readyAudios}};}
    if(kind==='pixCopyPaste'){const result=await runPixCopyPaste(db,flow,currentLead,connection,node,variables);if(result.waiting)return {waiting:true,reason:'payment_required'};currentLead=result.lead;variables={...result.variables,kie:{...(result.variables.kie||{}),audios:readyAudios}};}
    if(kind==='paymentConfirmed'){if(!variables.paid){const context={...(currentLead.order_context||{}),flow_execution:{flow_id:flow.id,payment_node_id:node.id}};await db.from('leads').update({status:'waiting_payment',order_context:context,updated_at:new Date().toISOString()}).eq('id',currentLead.id).eq('owner_id',currentLead.owner_id).eq('connection_id',connection.id);return {waiting:true,reason:'payment_required'};}if(config.message){await sendText(connection,currentLead.phone,render(config.message,variables));}}
    if(kind==='condition'){const matched=conditionMatches(config,variables);node=nextNode(nodes,edges,node.id,matched?'true':'false');if(!node)return {completed:false,reason:matched?'condition_true_path_missing':'condition_false_path_missing'};continue;}
    if(kind==='kie'){if(readyAudios.length){node=nextNode(nodes,edges,node.id);continue;}if(!variables.paid){await db.from('leads').update({status:'waiting_pix',updated_at:new Date().toISOString()}).eq('id',currentLead.id);return {waiting:true,reason:'payment_required'};}return startKie(db,flow,currentLead,node,variables);}
    if(kind==='deliver'||kind==='previewDeliver'){
      if(!readyAudios.length)return {completed:false,reason:kind==='previewDeliver'?'preview_audio_not_ready':'audio_not_ready'};
      const intro=render(config.intro||(kind==='previewDeliver'?'Sua música está pronta! Vou enviar as duas faixas da sua prévia em áudio.':'Sua música está pronta! Vou enviar as duas faixas em áudio.'),variables);
      currentLead=await deliverAudioTracks(db,currentLead,connection,readyAudios,intro);
      const followingNode=nextNode(nodes,edges,node.id);
      if(!followingNode){
        await completeLead(db,currentLead,connection,{music_url:JSON.stringify(readyAudios.slice(0,2))});
        return {completed:true,delivered:Math.min(2,readyAudios.length)};
      }
      const {data:updated,error}=await db.from('leads').update({status:'in_progress',music_url:JSON.stringify(readyAudios.slice(0,2)),order_context:{...(currentLead.order_context||{}),flow_execution:null},updated_at:new Date().toISOString()}).eq('id',currentLead.id).eq('owner_id',currentLead.owner_id).eq('connection_id',connection.id).select().single();
      if(error)throw error;
      currentLead=updated;
      variables=variablesFor(currentLead,{audios:readyAudios});
      node=followingNode;
      continue;
    }
    node=nextNode(nodes,edges,node.id);
  }
  if(node)return {completed:false,reason:'flow_step_limit'};
  await completeLead(db,currentLead,connection);
  return {completed:true};
}

export async function retryKieDelivery({db,flow,lead,connection,assumeFirstTrackDelivered=false}){
  assertExecutionScope(flow,lead,connection);
  if(lead.status!=='delivery_failed')throw new Error('Somente entregas que falharam podem ser reenviadas.');
  const key=(await credentialsFor(db,flow.id,flow.owner_id)).kie;if(!key)throw new Error('A chave Kie.ai desta conta não está configurada.');
  const response=await fetch(`${String(process.env.KIE_API_BASE_URL||'https://api.kie.ai').replace(/\/$/,'')}/api/v1/generate/record-info?taskId=${encodeURIComponent(lead.kie_task_id||'')}`,{headers:{Authorization:`Bearer ${key}`}});
  const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(`Kie.ai: ${response.status} ${payload.msg||'Não foi possível consultar a música.'}`);
  const audios=audioUrls(payload.data?.response?.sunoData||payload).slice(0,2);if(audios.length<2)throw new Error('A Kie.ai ainda não disponibilizou as duas faixas para reenvio.');
  const savedIndexes=Array.isArray(lead.order_context?.delivery?.sent_indexes)?lead.order_context.delivery.sent_indexes:[];const context={...(lead.order_context||{}),kie_audios:audios,delivery:{...(lead.order_context?.delivery||{}),audios,sent_indexes:savedIndexes.length||!assumeFirstTrackDelivered?savedIndexes:[0],intro_sent:lead.order_context?.delivery?.intro_sent||assumeFirstTrackDelivered}};const {data:claimed,error}=await db.from('leads').update({status:'delivering',order_context:context,updated_at:new Date().toISOString()}).eq('id',lead.id).eq('owner_id',lead.owner_id).eq('connection_id',connection.id).eq('status','delivery_failed').select().single();if(error)throw error;
  try{return await executeFlow({db,flow,lead:claimed,connection,resumeAfterId:context.flow_execution?.kie_node_id,audios});}
  catch(error){await db.from('leads').update({status:'delivery_failed',updated_at:new Date().toISOString()}).eq('id',claimed.id).eq('owner_id',claimed.owner_id).eq('connection_id',connection.id).eq('status','delivering');throw error;}
}
