import { NextResponse } from 'next/server';
import { adminClient, requireUser } from '../supabase';
import { encryptSecret, hashSecret } from '../connection-secrets';
import { createUazInstance } from '../uazapi';

export async function POST(request) {
  try {
    const user=await requireUser(); const body=await request.json();
    if(!['meta','uazapi'].includes(body.provider)||!body.name)return NextResponse.json({error:'Dados da conexão inválidos.'},{status:400});
    const payload={owner_id:user.id,name:body.name,provider:body.provider,instance_name:body.instance_name||null};
    if(body.provider==='uazapi'){const instance=await createUazInstance(body.instance_name||body.name);payload.instance_name=instance.instanceName;payload.uazapi_token_cipher=encryptSecret(instance.token);payload.uazapi_token_hash=hashSecret(instance.token);}
    const {data,error}=await adminClient().from('connections').insert(payload).select().single();
    if(error)throw error;return NextResponse.json(data,{status:201});
  }catch(error){return NextResponse.json({error:error.message},{status:400});}
}
