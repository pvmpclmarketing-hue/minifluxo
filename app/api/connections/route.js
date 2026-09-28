import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../supabase';
import { createUazInstance } from '../uazapi';
import { encryptSecret, hashSecret } from '../connection-secrets';

export async function POST(request) {
  try {
    const user=await requireUser(); const body=await request.json();
    const provider=body.provider==='uazapi'?'uazapi':'meta';
    const name=String(body.name||'').trim();
    if(!name)return NextResponse.json({error:'Informe o nome da conexão.'},{status:400});
    let payload={owner_id:user.id,name,provider,instance_name:body.instance_name||null};
    if(provider==='uazapi'){
      // A criação usa o token administrativo e devolve o token individual da
      // instância. Este segundo token é o único aceito por /instance/connect.
      const created=await createUazInstance(body.instance_name||name);
      payload={...payload,instance_name:created.instanceName,uazapi_token_cipher:encryptSecret(created.token),uazapi_token_hash:hashSecret(created.token),status:'disconnected'};
    }
    const {data,error}=await adminClient().from('connections').insert(payload).select().single();
    if(error)throw error;return NextResponse.json(data,{status:201});
  }catch(error){return NextResponse.json({error:error.message},{status:400});}
}
