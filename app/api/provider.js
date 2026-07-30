import { adminClient } from './supabase';
import { tokenForConnection, uazCall } from './uazapi';

async function uazAudioFile(audioUrl){
  const response=await fetch(audioUrl);if(!response.ok)throw new Error(`Não foi possível baixar o áudio gerado: ${response.status}`);
  const contentType=response.headers.get('content-type')?.split(';')[0]||'audio/mpeg';const bytes=Buffer.from(await response.arrayBuffer());
  if(!bytes.length)throw new Error('O arquivo de áudio gerado está vazio.');
  if(bytes.length>18*1024*1024)throw new Error('O arquivo de áudio excede o limite seguro de envio.');
  return `data:${contentType};base64,${bytes.toString('base64')}`;
}

export async function sendText(connection,phone,text){
  if(!connection)throw new Error('Conecte um WhatsApp antes de iniciar atendimentos.');
  if(connection.provider==='meta'){const response=await fetch(`https://graph.facebook.com/${process.env.META_API_VERSION||'v22.0'}/${process.env.META_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${process.env.META_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:phone,type:'text',text:{body:text}})});if(!response.ok)throw new Error(`Meta: ${response.status} ${await response.text()}`);return response.json();}
  return uazCall(await tokenForConnection(adminClient(),connection),'/send/text',{number:phone,text});
}
export async function sendAudio(connection,phone,audioUrl,caption=''){
  if(!connection)throw new Error('Conecte um WhatsApp antes de enviar o áudio.');
  if(connection.provider==='meta'){const response=await fetch(`https://graph.facebook.com/${process.env.META_API_VERSION||'v22.0'}/${process.env.META_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${process.env.META_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:phone,type:'audio',audio:{link:audioUrl}})});if(!response.ok)throw new Error(`Meta: ${response.status} ${await response.text()}`);return response.json();}
  const file=await uazAudioFile(audioUrl);
  return uazCall(await tokenForConnection(adminClient(),connection),'/send/media',{number:phone,type:'audio',file,mimetype:'audio/mpeg',text:caption});
}
