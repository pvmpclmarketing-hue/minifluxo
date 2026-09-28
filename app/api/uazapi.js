import { encryptSecret, decryptSecret, hashSecret } from './connection-secrets';

const baseUrl=()=>String(process.env.UAZAPI_URL||'').replace(/\/$/,'');
const pause=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
async function call(path,options){
  if(!baseUrl())throw new Error('UAZAPI_URL não configurada na Vercel.');
  // A UazAPI pode responder 500 enquanto o socket recém-reconectado ainda é
  // sincronizado com o WhatsApp. Repetir somente estes erros transitórios evita
  // perder pedidos pagos, sem reenviar erros de credencial ou payload inválido.
  let lastError;
  for(let attempt=0;attempt<5;attempt+=1){
    try{
      const response=await fetch(`${baseUrl()}${path}`,options);
      const text=await response.text();let data={};try{data=JSON.parse(text);}catch{}
      if(response.ok)return data;
      lastError=new Error(`UazAPI: ${response.status} ${data.message||text}`);
      if(response.status<500||attempt===4)throw lastError;
    }catch(error){
      lastError=error;
      const transient=/^UazAPI: 5\d\d\b/.test(String(error?.message||''))||error?.name==='TypeError';
      if(!transient||attempt===4)throw error;
    }
    await pause(1000*2**attempt);
  }
  throw lastError;
}
const isUnauthorized=error=>/^UazAPI: 401\b/.test(String(error?.message||''));
async function adminCall(path,options){
  // UAZAPI_TOKEN era o nome usado pelas instalações anteriores. Mantemos a
  // compatibilidade sem deixar um ADMIN_TOKEN vencido derrubar o canal reserva.
  const tokens=[process.env.UAZAPI_ADMIN_TOKEN,process.env.UAZAPI_TOKEN].filter(Boolean).filter((token,index,list)=>list.indexOf(token)===index);
  if(!tokens.length)throw new Error('Configure UAZAPI_ADMIN_TOKEN na Vercel para criar conexões UazAPI.');
  let lastError;
  for(const adminToken of tokens){
    try{return await call(path,{...options,headers:{...(options.headers||{}),admintoken:adminToken}});}
    catch(error){lastError=error;if(!isUnauthorized(error))throw error;}
  }
  throw lastError;
}
function instanceToken(data){return data?.token||data?.instance?.token||data?.data?.token||data?.data?.instance?.token||null;}
function instanceName(data,fallback){return data?.instance?.name||data?.name||data?.data?.instance?.name||data?.data?.name||fallback;}
function listedInstances(data){
  if(Array.isArray(data))return data;
  for(const candidate of [data?.instances,data?.data?.instances,data?.data])if(Array.isArray(candidate))return candidate;
  return [];
}
export async function findUazInstance(name){
  const target=String(name||'').trim().toLowerCase();
  const data=await adminCall('/instance/all',{method:'GET'});
  return listedInstances(data).find(item=>String(item?.name||item?.instance?.name||'').trim().toLowerCase()===target)||null;
}
export async function createUazInstance(name){
  const payload={name:String(name||'').trim(),systemName:'minifluxo'};
  let data;
  try{
    // /instance/init é o endpoint oficial de criação. Ele devolve o token
    // individual que é obrigatório para gerar QR, status e mensagens.
    data=await adminCall('/instance/init',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  }catch(error){
    // Algumas instalações antigas expõem /instance/create. Mantemos esse
    // fallback apenas para compatibilidade de servidor, não como rota padrão.
    if(!/^UazAPI: 404\b/.test(String(error?.message||'')))throw error;
    data=await adminCall('/instance/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  }
  const token=instanceToken(data);
  if(!token)throw new Error('A UazAPI criou a instância, mas não retornou o token individual necessário para gerar o QR Code.');
  return {token,instanceName:instanceName(data,payload.name)};
}
export async function configureGlobalUazWebhook(){const base=String(process.env.WHATSENTREGAVEL_URL||'https://minifluxo.vercel.app').replace(/\/$/,'');await adminCall('/globalwebhook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:true,url:`${base}/api/webhooks/uazapi`,events:['messages','messages_update','connection'],excludeMessages:['isGroupYes'],addUrlEvents:false,addUrlTypesMessages:false})});}
export async function tokenForConnection(db,connection){
  if(connection.uazapi_token_cipher)return decryptSecret(connection.uazapi_token_cipher);
  // Conexões criadas pela versão que usava o token administrativo diretamente
  // não possuem token de instância. Criamos uma instância própria agora; nunca
  // reutilizamos UAZAPI_ADMIN_TOKEN/UAZAPI_TOKEN como se fossem token do QR.
  const created=await createUazInstance(connection.instance_name||connection.name);
  const {error}=await db.from('connections').update({instance_name:created.instanceName,uazapi_token_cipher:encryptSecret(created.token),uazapi_token_hash:hashSecret(created.token),status:'disconnected'}).eq('id',connection.id);
  if(error)throw error;
  return created.token;
}
export async function uazCall(token,path,body){return call(path,{method:'POST',headers:{token,'Content-Type':'application/json'},body:JSON.stringify(body)});}
export async function disconnectUazInstance(db,connection){return uazCall(await tokenForConnection(db,connection),'/instance/disconnect',{});}
export async function uazGet(token,path){return call(path,{headers:{token}});}
