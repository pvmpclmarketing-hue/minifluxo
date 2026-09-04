import { adminClient } from './supabase';
import { tokenForConnection, uazCall } from './uazapi';

async function uazAudioFile(audioUrl){
  const response=await fetch(audioUrl);if(!response.ok)throw new Error(`Não foi possível baixar o áudio gerado: ${response.status}`);
  const contentType=response.headers.get('content-type')?.split(';')[0]||'audio/mpeg';const bytes=Buffer.from(await response.arrayBuffer());
  if(!bytes.length)throw new Error('O arquivo de áudio gerado está vazio.');
  if(!contentType.startsWith('audio/'))throw new Error(`A Kie.ai devolveu mídia inválida no lugar do áudio (${contentType}).`);
  if(bytes.length>18*1024*1024)throw new Error('O arquivo de áudio excede o limite seguro de envio.');
  return `data:${contentType};base64,${bytes.toString('base64')}`;
}

function uazPhoneCandidates(phone){
  const normalized=String(phone||'').replace(/\D/g,'');
  // Alguns sites ainda enviam celular brasileiro sem o nono dígito. Mantemos
  // primeiro o número informado e só tentamos a forma móvel quando ela se
  // aplica, sem alterar números internacionais ou telefones fixos longos.
  if(/^55\d{10}$/.test(normalized))return [normalized,`${normalized.slice(0,4)}9${normalized.slice(4)}`];
  return [normalized];
}
async function uazSendWithPhoneFallback(connection,phone,path,payload){
  const token=await tokenForConnection(adminClient(),connection);let lastError;
  for(const candidate of uazPhoneCandidates(phone)){
    try{return await uazCall(token,path,{...payload,number:candidate});}
    catch(error){
      lastError=error;
      const unavailable=/not on whatsapp|nao esta no whatsapp|não está no whatsapp/i.test(String(error?.message||''));
      if(!unavailable||candidate===uazPhoneCandidates(phone).at(-1))throw error;
      console.warn('[uazapi] retrying Brazilian phone with ninth digit',{original:phone,candidate});
    }
  }
  throw lastError;
}

export async function sendText(connection,phone,text){
  if(!connection)throw new Error('Conecte um WhatsApp antes de iniciar atendimentos.');
  if(connection.provider==='meta'){const response=await fetch(`https://graph.facebook.com/${process.env.META_API_VERSION||'v22.0'}/${process.env.META_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${process.env.META_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:phone,type:'text',text:{body:text}})});if(!response.ok)throw new Error(`Meta: ${response.status} ${await response.text()}`);return response.json();}
  return uazSendWithPhoneFallback(connection,phone,'/send/text',{text});
}
export async function sendMenu(connection,phone,text,choices){
  if(!connection)throw new Error('Conecte um WhatsApp antes de enviar o menu.');
  const options=(Array.isArray(choices)?choices:[]).slice(0,3).map((choice,index)=>({label:String(choice?.label||'').trim(),id:`menu-option-${index}`})).filter(choice=>choice.label);
  if(!options.length)throw new Error('Adicione ao menos uma opção ao card Menu.');
  if(connection.provider==='meta'){
    const response=await fetch(`https://graph.facebook.com/${process.env.META_API_VERSION||'v22.0'}/${process.env.META_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${process.env.META_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:phone,type:'interactive',interactive:{type:'button',body:{text},action:{buttons:options.map(option=>({type:'reply',reply:{id:option.id,title:option.label.slice(0,20)}}))}}})});
    if(!response.ok)throw new Error(`Meta: ${response.status} ${await response.text()}`);
    return response.json();
  }
  return uazSendWithPhoneFallback(connection,phone,'/send/menu',{type:'button',text,choices:options.map(option=>`${option.label}|${option.id}`)});
}
export async function sendPixCopyButton(connection,phone,code,amount){
  if(!connection)throw new Error('Conecte um WhatsApp antes de enviar o Pix.');
  const text=`Seu Pix de R$ ${amount} está pronto. Toque em *Copiar código Pix* e cole no aplicativo do seu banco para pagar.`;
  // A API oficial não expõe um botão nativo de cópia. Nela mantemos o código
  // no texto para que o cliente ainda possa copiá-lo manualmente.
  if(connection.provider==='meta')return sendText(connection,phone,`${text}\n\n${code}`);
  // A UazAPI transforma copy: em ação nativa de copiar no WhatsApp.
  return uazSendWithPhoneFallback(connection,phone,'/send/menu',{type:'button',text,choices:[`Copiar código Pix|copy:${code}`],footerText:'Pagamento seguro via Pix'});
}
export async function sendAudio(connection,phone,audioUrl,caption=''){
  if(!connection)throw new Error('Conecte um WhatsApp antes de enviar o áudio.');
  if(connection.provider==='meta'){const response=await fetch(`https://graph.facebook.com/${process.env.META_API_VERSION||'v22.0'}/${process.env.META_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${process.env.META_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:phone,type:'audio',audio:{link:audioUrl}})});if(!response.ok)throw new Error(`Meta: ${response.status} ${await response.text()}`);return response.json();}
  const file=await uazAudioFile(audioUrl);
  return uazSendWithPhoneFallback(connection,phone,'/send/media',{type:'audio',file,mimetype:'audio/mpeg',text:caption});
}
